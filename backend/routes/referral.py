"""Referral program + rewards wallet. Commissions are credited as in-app credit, never cash."""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import current_user, db, new_id, notify, now_utc

router = APIRouter(tags=["wallet"])

PLATFORM_FEE_RATE = 0.20        # informational share kept by the platform on each ride
REFERRAL_RATE = {"driver": 0.05, "passenger": 0.03, "company": 0.03}  # level-1 sponsor share of the ride price, by sponsor role
LEVEL2_RATE = 0.03              # level-2 sponsor gets 3 % of the level-1 commission
PARTNER_RATE = 0.05             # hotels / concierges / agencies earn 5 % on their clients' rides (like drivers)
PARTNER_TYPES = {"hotel", "concierge", "agency"}


def sponsor_rate(sponsor: dict) -> float:
    """Level-1 commission rate for a sponsor. Partners (hotels/concierges/agencies) get the partner rate."""
    if sponsor.get("role") == "company" and sponsor.get("partner_type") in PARTNER_TYPES:
        return PARTNER_RATE
    return REFERRAL_RATE.get(sponsor.get("role"), 0.03)


class ApplyCodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


def new_code() -> str:
    return secrets.token_hex(3).upper()


async def ensure_code(user: dict) -> str:
    if user.get("referral_code"):
        return user["referral_code"]
    code = new_code()
    await db.users.update_one({"id": user["id"]}, {"$set": {"referral_code": code}})
    return code


async def credit_wallet(user_id: Optional[str], amount: float, type_: str, label: str, ride_id: Optional[str] = None):
    if not user_id or abs(amount) < 0.005:
        return
    amount = round(amount, 2)
    await db.users.update_one({"id": user_id}, {"$inc": {"wallet_balance": amount}})
    await db.wallet_tx.insert_one({"id": new_id(), "user_id": user_id, "amount": amount, "type": type_, "label": label, "ride_id": ride_id, "created_at": now_utc()})


async def distribute_referral(ride: dict):
    """Called once when a ride is completed: level-1 and level-2 sponsors of the passenger earn wallet credit."""
    if ride.get("source") == "private" or not ride.get("passenger_id") or ride.get("referral_paid") or ride.get("partner_booking"):
        return
    passenger = await db.users.find_one({"id": ride["passenger_id"]}, {"_id": 0, "sponsor_id": 1, "full_name": 1})
    if not passenger or not passenger.get("sponsor_id"):
        return
    l1 = await db.users.find_one({"id": passenger["sponsor_id"]}, {"_id": 0, "id": 1, "role": 1, "partner_type": 1, "sponsor_id": 1, "full_name": 1})
    if not l1:
        return
    price = ride.get("price", 0)
    c1 = round(price * sponsor_rate(l1), 2)
    await credit_wallet(l1["id"], c1, "referral_l1", f"Commission parrainage · course de {passenger['full_name']}", ride["id"])
    await notify(l1["id"], "wallet", "Portefeuille crédité", f"+{c1:.2f} € grâce à la course de {passenger['full_name']}", ride["id"])
    if l1.get("sponsor_id"):
        c2 = round(c1 * LEVEL2_RATE, 2)
        await credit_wallet(l1["sponsor_id"], c2, "referral_l2", f"Commission réseau niveau 2 · via {l1['full_name']}", ride["id"])
    await db.rides.update_one({"id": ride["id"]}, {"$set": {"referral_paid": True, "platform_fee": round(price * PLATFORM_FEE_RATE, 2), "referral_l1_amount": c1}})


async def distribute_partner_commission(ride: dict):
    """Partner booking (hotel/concierge/agency) completed → the partner earns 5 % of the ride, credited to its wallet.
    Cascades level-2 to the partner's own sponsor, exactly like the referral network."""
    if not ride.get("partner_booking") or not ride.get("company_id") or ride.get("partner_commission_paid"):
        return
    partner = await db.users.find_one({"id": ride["company_id"]}, {"_id": 0, "id": 1, "sponsor_id": 1, "company_name": 1})
    if not partner:
        return
    price = ride.get("price", 0)
    guest = ride.get("guest_name") or ride.get("passenger_label") or "un client"
    c1 = round(price * PARTNER_RATE, 2)
    await credit_wallet(partner["id"], c1, "partner_commission", f"Commission client · course de {guest}", ride["id"])
    await notify(partner["id"], "wallet", "Portefeuille crédité", f"+{c1:.2f} € de commission sur la course de {guest}", ride["id"])
    if partner.get("sponsor_id"):
        c2 = round(c1 * LEVEL2_RATE, 2)
        await credit_wallet(partner["sponsor_id"], c2, "referral_l2", f"Commission réseau niveau 2 · via {partner.get('company_name') or 'partenaire'}", ride["id"])
    await db.rides.update_one({"id": ride["id"]}, {"$set": {
        "partner_commission_paid": True, "partner_commission_rate": PARTNER_RATE, "partner_commission_amount": c1,
        "platform_fee": round(price * PLATFORM_FEE_RATE, 2),
    }})


@router.get("/wallet")
async def wallet(user=Depends(current_user)):
    code = await ensure_code(user)
    sponsor = await db.users.find_one({"id": user.get("sponsor_id")}, {"_id": 0, "full_name": 1}) if user.get("sponsor_id") else None
    referrals = await db.users.count_documents({"sponsor_id": user["id"]})
    tx = [t async for t in db.wallet_tx.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50)]
    earned = sum(t["amount"] for t in tx if t["amount"] > 0)
    return {"balance": round(user.get("wallet_balance", 0) or 0, 2), "referral_code": code, "sponsor_name": sponsor["full_name"] if sponsor else None,
            "referrals_count": referrals, "earned_total": round(earned, 2), "transactions": tx,
            "rates": {"driver": REFERRAL_RATE["driver"], "other": REFERRAL_RATE["passenger"], "level2": LEVEL2_RATE}}


@router.post("/wallet/apply-code")
async def apply_code(data: ApplyCodeIn, user=Depends(current_user)):
    if user.get("sponsor_id"):
        raise HTTPException(409, "Vous avez déjà un parrain")
    sponsor = await db.users.find_one({"referral_code": data.code.strip().upper()}, {"_id": 0, "id": 1, "full_name": 1})
    if not sponsor or sponsor["id"] == user["id"]:
        raise HTTPException(404, "Code de parrainage invalide")
    await db.users.update_one({"id": user["id"]}, {"$set": {"sponsor_id": sponsor["id"], "sponsored_at": now_utc()}})
    await notify(sponsor["id"], "wallet", "Nouveau filleul", f"{user['full_name']} a rejoint votre réseau. Vous gagnerez des crédits sur ses courses.")
    return {"ok": True, "sponsor_name": sponsor["full_name"]}
