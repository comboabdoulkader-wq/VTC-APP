"""In-ride chat (passenger ↔ driver, no phone number shared) and promo codes."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import current_user, db, new_id, notify, now_utc

router = APIRouter(tags=["chat", "promos"])


# ---------------- Chat ----------------
class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


async def ride_party(ride_id: str, user: dict) -> dict:
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or user["id"] not in (r.get("passenger_id"), r.get("driver_id")):
        raise HTTPException(404, "Course introuvable")
    return r


@router.get("/rides/{ride_id}/messages")
async def list_messages(ride_id: str, user=Depends(current_user)):
    await ride_party(ride_id, user)
    msgs = [m async for m in db.messages.find({"ride_id": ride_id}, {"_id": 0}).sort("created_at", 1).limit(200)]
    await db.messages.update_many({"ride_id": ride_id, "sender_id": {"$ne": user["id"]}, "read": False}, {"$set": {"read": True}})
    return msgs


@router.post("/rides/{ride_id}/messages")
async def send_message(ride_id: str, data: MessageIn, user=Depends(current_user)):
    r = await ride_party(ride_id, user)
    if r["status"] not in ("accepted", "in_progress"):
        raise HTTPException(409, "La messagerie est disponible pendant la course uniquement")
    msg = {"id": new_id(), "ride_id": ride_id, "sender_id": user["id"], "sender_name": user["full_name"], "sender_role": user["role"],
           "text": data.text.strip(), "read": False, "created_at": now_utc()}
    await db.messages.insert_one(msg.copy())
    other = r.get("driver_id") if user["id"] == r.get("passenger_id") else r.get("passenger_id")
    await notify(other, "message", f"Message de {user['full_name']}", msg["text"][:120], ride_id)
    return msg


@router.get("/rides/{ride_id}/messages/unread")
async def unread_count(ride_id: str, user=Depends(current_user)):
    await ride_party(ride_id, user)
    return {"unread": await db.messages.count_documents({"ride_id": ride_id, "sender_id": {"$ne": user["id"]}, "read": False})}


# ---------------- Promo codes ----------------
class PromoIn(BaseModel):
    code: str = Field(min_length=3, max_length=20)
    kind: str = Field(pattern="^(percent|amount)$")
    value: float = Field(gt=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[datetime] = None
    min_price: float = Field(default=0, ge=0)


class PromoUpdateIn(BaseModel):
    active: Optional[bool] = None


class PromoValidateIn(BaseModel):
    code: str
    price: float = Field(ge=0)


def promo_manager(user=Depends(current_user)):
    if user["role"] != "company" and not user.get("is_moderator"):
        raise HTTPException(403, "Réservé aux entreprises et administrateurs")
    return user


def compute_discount(promo: dict, price: float) -> float:
    d = price * promo["value"] / 100 if promo["kind"] == "percent" else promo["value"]
    return round(min(max(d, 0), price), 2)


async def resolve_promo(code: str, user: dict, price: float, business: bool = False) -> dict:
    """Validate a promo code for this passenger. Company promos only apply to employees on business rides."""
    p = await db.promos.find_one({"code": code.strip().upper()}, {"_id": 0})
    if not p or not p.get("active", True):
        raise HTTPException(404, "Code promo invalide")
    now = now_utc()
    exp = p.get("expires_at")
    if exp is not None and (exp if exp.tzinfo else exp.replace(tzinfo=None)) < (now if exp.tzinfo else now.replace(tzinfo=None)):
        raise HTTPException(409, "Code promo expiré")
    if p.get("max_uses") and p.get("uses", 0) >= p["max_uses"]:
        raise HTTPException(409, "Code promo épuisé")
    if p.get("company_id") and (user.get("company_id") != p["company_id"] or not business):
        raise HTTPException(409, "Ce code est réservé aux déplacements professionnels de l'entreprise")
    if price < p.get("min_price", 0):
        raise HTTPException(409, f"Montant minimum {p['min_price']:.2f} €")
    return {"promo": p, "discount": compute_discount(p, price)}


@router.post("/promos/validate")
async def validate_promo(data: PromoValidateIn, user=Depends(current_user)):
    res = await resolve_promo(data.code, user, data.price, business=bool(user.get("company_id")))
    p = res["promo"]
    return {"code": p["code"], "kind": p["kind"], "value": p["value"], "discount": res["discount"], "company_only": bool(p.get("company_id"))}


@router.get("/promos")
async def list_promos(user=Depends(promo_manager)):
    q = {"company_id": user["id"]} if user["role"] == "company" else {"company_id": None}
    return [p async for p in db.promos.find(q, {"_id": 0}).sort("created_at", -1)]


@router.post("/promos")
async def create_promo(data: PromoIn, user=Depends(promo_manager)):
    code = data.code.strip().upper()
    if await db.promos.find_one({"code": code}):
        raise HTTPException(409, "Ce code existe déjà")
    if data.kind == "percent" and data.value > 100:
        raise HTTPException(422, "Pourcentage invalide")
    p = {"id": new_id(), "code": code, "kind": data.kind, "value": data.value, "max_uses": data.max_uses, "uses": 0, "expires_at": data.expires_at,
         "min_price": data.min_price, "active": True, "created_by": user["id"], "created_by_name": user.get("company_name") or user["full_name"],
         "company_id": user["id"] if user["role"] == "company" else None, "created_at": now_utc()}
    await db.promos.insert_one(p.copy())
    return p


@router.patch("/promos/{promo_id}")
async def update_promo(promo_id: str, data: PromoUpdateIn, user=Depends(promo_manager)):
    q = {"id": promo_id, "company_id": user["id"] if user["role"] == "company" else None}
    p = await db.promos.find_one(q, {"_id": 0})
    if not p:
        raise HTTPException(404, "Code introuvable")
    if data.active is not None:
        await db.promos.update_one({"id": promo_id}, {"$set": {"active": data.active}})
        p["active"] = data.active
    return p


@router.delete("/promos/{promo_id}")
async def delete_promo(promo_id: str, user=Depends(promo_manager)):
    q = {"id": promo_id, "company_id": user["id"] if user["role"] == "company" else None}
    res = await db.promos.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(404, "Code introuvable")
    return {"ok": True}
