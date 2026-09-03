"""Admin panel: configurable commission/cashback engine + KPI dashboard (moderators only).

- Commission is configurable globally and per city / per vehicle.
- Cashback is credited to the passenger wallet on ride completion; a loyalty tier
  (Bronze -> Platinum, by number of completed rides) adds a bonus rate.
Everything is stored in db.settings (single doc) and applied non-destructively.
"""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import current_user, db, now_utc

router = APIRouter(prefix="/admin", tags=["adminpanel"])

DEFAULT_SETTINGS = {
    "commission": {"platform": 0.20, "driver": 0.80},
    "commission_by_city": {},          # {"Paris": 0.18}
    "commission_by_vehicle": {},        # {"van": 0.22}
    "cashback": {
        "enabled": False, "rate": 0.05, "by_vehicle": {},
        "tiers": {"bronze": 0.0, "silver": 0.01, "gold": 0.02, "platinum": 0.03},
    },
}

PASSENGER_TIERS = [
    {"key": "platinum", "label": "Platine", "min_rides": 75},
    {"key": "gold", "label": "Or", "min_rides": 30},
    {"key": "silver", "label": "Argent", "min_rides": 10},
    {"key": "bronze", "label": "Bronze", "min_rides": 0},
]


def passenger_tier(count: int) -> dict:
    for t in PASSENGER_TIERS:
        if count >= t["min_rides"]:
            return t
    return PASSENGER_TIERS[-1]


def moderator_only(user=Depends(current_user)):
    if not user.get("is_moderator"):
        raise HTTPException(403, "Réservé aux administrateurs")
    return user


async def get_settings() -> dict:
    doc = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}
    s = {**DEFAULT_SETTINGS, **{k: v for k, v in doc.items() if k != "id"}}
    for k in ("commission", "cashback"):
        s[k] = {**DEFAULT_SETTINGS[k], **(doc.get(k) or {})}
    s["cashback"]["tiers"] = {**DEFAULT_SETTINGS["cashback"]["tiers"], **((doc.get("cashback") or {}).get("tiers") or {})}
    return s


class SettingsIn(BaseModel):
    commission: Optional[dict] = None
    commission_by_city: Optional[dict] = None
    commission_by_vehicle: Optional[dict] = None
    cashback: Optional[dict] = None


@router.get("/settings")
async def read_settings(user=Depends(moderator_only)):
    return await get_settings()


@router.put("/settings")
async def write_settings(data: SettingsIn, user=Depends(moderator_only)):
    upd = {k: v for k, v in data.model_dump(exclude_none=True).items()}
    upd["id"] = "global"; upd["updated_at"] = now_utc(); upd["updated_by"] = user.get("full_name") or user["email"]
    await db.settings.update_one({"id": "global"}, {"$set": upd}, upsert=True)
    return await get_settings()


def commission_rate_for(settings: dict, ride: dict) -> float:
    city = (ride.get("pickup") or {}).get("city") or (ride.get("dropoff") or {}).get("city")
    if city and city in (settings.get("commission_by_city") or {}):
        return float(settings["commission_by_city"][city])
    veh = ride.get("vehicle_type")
    if veh and veh in (settings.get("commission_by_vehicle") or {}):
        return float(settings["commission_by_vehicle"][veh])
    return float(settings["commission"]["platform"])


async def apply_cashback(ride: dict):
    """Credit passenger cashback on completion (loyalty-tier aware). Also records platform commission on the ride."""
    settings = await get_settings()
    # Record commission (informational) using configurable rate.
    rate = commission_rate_for(settings, ride)
    await db.rides.update_one({"id": ride["id"]}, {"$set": {"platform_fee": round(ride.get("price", 0) * rate, 2), "commission_rate": rate}})
    cb = settings.get("cashback") or {}
    if not cb.get("enabled") or ride.get("business") or ride.get("partner_booking") or not ride.get("passenger_id") or ride.get("cashback_paid"):
        return
    from routes.referral import credit_wallet
    from core import notify
    base = cb.get("by_vehicle", {}).get(ride.get("vehicle_type")) or cb.get("rate", 0)
    done = await db.rides.count_documents({"passenger_id": ride["passenger_id"], "status": "completed"})
    tier = passenger_tier(done)
    bonus = (cb.get("tiers") or {}).get(tier["key"], 0)
    amount = round(ride.get("price", 0) * (float(base) + float(bonus)), 2)
    if amount <= 0:
        return
    await credit_wallet(ride["passenger_id"], amount, "cashback", f"Cashback {tier['label']} · course {ride.get('id', '')[:8]}", ride["id"])
    await db.rides.update_one({"id": ride["id"]}, {"$set": {"cashback_paid": True, "cashback_amount": amount}})
    await notify(ride["passenger_id"], "wallet", "Cashback crédité", f"+{amount:.2f} € ajoutés à votre portefeuille ({tier['label']}).", ride["id"])


@router.get("/dashboard")
async def dashboard(user=Depends(moderator_only)):
    now = now_utc()
    since30 = now - timedelta(days=30)
    by_status = {}
    async for row in db.rides.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        by_status[row["_id"]] = row["n"]
    completed = by_status.get("completed", 0)
    cancelled = by_status.get("cancelled", 0)
    total_rides = sum(by_status.values())
    rev = await db.rides.aggregate([{"$match": {"status": "completed"}}, {"$group": {"_id": None, "revenue": {"$sum": "$price"}, "fees": {"$sum": "$platform_fee"}}}]).to_list(1)
    revenue = round((rev[0]["revenue"] if rev else 0) or 0, 2)
    commissions = round((rev[0]["fees"] if rev else 0) or 0, 2)
    cashback = await db.wallet_tx.aggregate([{"$match": {"type": "cashback"}}, {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1)
    users = {}
    async for row in db.users.aggregate([{"$group": {"_id": "$role", "n": {"$sum": 1}}}]):
        users[row["_id"]] = row["n"]
    # daily rides over last 30 days
    daily = []
    async for row in db.rides.aggregate([
        {"$match": {"created_at": {"$gte": since30}}},
        {"$group": {"_id": {"$dateToString": {"format": "%m-%d", "date": "$created_at"}}, "n": {"$sum": 1}, "rev": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, "$price", 0]}}}},
        {"$sort": {"_id": 1}},
    ]):
        daily.append({"day": row["_id"], "rides": row["n"], "revenue": round(row.get("rev", 0) or 0, 2)})
    return {
        "rides": {"total": total_rides, "completed": completed, "cancelled": cancelled, "in_progress": by_status.get("in_progress", 0), "requested": by_status.get("requested", 0), "accepted": by_status.get("accepted", 0)},
        "cancellation_rate": round((cancelled / total_rides * 100) if total_rides else 0, 1),
        "revenue": revenue, "commissions": commissions, "cashback_paid": round((cashback[0]["s"] if cashback else 0) or 0, 2),
        "users": {"passengers": users.get("passenger", 0), "drivers": users.get("driver", 0), "companies": users.get("company", 0), "total": sum(users.values())},
        "daily": daily,
    }
