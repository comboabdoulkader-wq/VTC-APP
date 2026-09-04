"""Favorites, driver statistics, public ride tracking."""
from collections import defaultdict
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import current_user, db, new_id, now_utc, require_role

router = APIRouter(tags=["favorites", "stats", "tracking"])
CANCEL_FEE = 3.0
DAYS_FR = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]


# ---------------- Favorites ----------------
class FavoriteIn(BaseModel):
    label: str = Field(min_length=1, max_length=40)  # Maison, Travail, ...
    name: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=200)
    lat: float
    lng: float
    icon: str = "star"


@router.get("/favorites")
async def list_favorites(user=Depends(current_user)):
    return [f async for f in db.favorites.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1)]


@router.post("/favorites")
async def add_favorite(data: FavoriteIn, user=Depends(current_user)):
    fav = {"id": new_id(), "user_id": user["id"], **data.model_dump(), "created_at": now_utc()}
    await db.favorites.delete_many({"user_id": user["id"], "label": data.label})  # one address per label (Maison/Travail)
    await db.favorites.insert_one(fav.copy())
    return fav


@router.delete("/favorites/{fav_id}")
async def delete_favorite(fav_id: str, user=Depends(current_user)):
    res = await db.favorites.delete_one({"id": fav_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Favori introuvable")
    return {"ok": True}


# ---------------- Driver decline + stats ----------------
@router.post("/rides/{ride_id}/decline")
async def decline_ride(ride_id: str, user=Depends(require_role("driver"))):
    r = await db.rides.find_one({"id": ride_id, "status": "requested"}, {"_id": 0, "id": 1})
    if not r:
        raise HTTPException(404, "Course introuvable")
    await db.ride_declines.update_one({"ride_id": ride_id, "driver_id": user["id"]}, {"$set": {"declined_at": now_utc()}}, upsert=True)
    from routes.adminpanel import advance_offer
    await advance_offer(ride_id)
    return {"ok": True}


def _aware(d):
    from datetime import timezone
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


@router.get("/driver/stats")
async def driver_stats(user=Depends(require_role("driver"))):
    now = now_utc()
    week_ago = now - timedelta(days=7)
    # Online time from sessions (+ current open session)
    total_s = week_s = 0.0
    async for s in db.driver_sessions.find({"driver_id": user["id"]}, {"_id": 0}):
        start, end = _aware(s["start"]), _aware(s.get("end") or now)
        dur = (end - start).total_seconds()
        total_s += dur
        if end > week_ago:
            week_s += (end - max(start, week_ago)).total_seconds()
    if user.get("online_since"):
        start = _aware(user["online_since"])
        dur = (now - start).total_seconds()
        total_s += dur
        week_s += (now - max(start, week_ago)).total_seconds()
    accepted = await db.rides.count_documents({"driver_id": user["id"], "source": {"$ne": "private"}})
    declined = await db.ride_declines.count_documents({"driver_id": user["id"]})
    completed = await db.rides.count_documents({"driver_id": user["id"], "status": "completed"})
    cancelled = await db.rides.count_documents({"driver_id": user["id"], "status": "cancelled"})
    # Best slots: weekday + 2h bucket, by earnings
    slots: dict = defaultdict(lambda: {"count": 0, "earnings": 0.0})
    by_day = [0.0] * 7
    async for r in db.rides.find({"driver_id": user["id"], "status": "completed"}, {"_id": 0, "completed_at": 1, "price": 1, "tip": 1}):
        d = _aware(r["completed_at"])
        amt = r.get("price", 0) + (r.get("tip") or 0)
        key = (d.weekday(), (d.hour // 2) * 2)
        slots[key]["count"] += 1
        slots[key]["earnings"] += amt
        if d > week_ago:
            by_day[d.weekday()] += amt
    best = sorted(({"label": f"{DAYS_FR[k[0]]} {k[1]:02d}h–{k[1] + 2:02d}h", **v} for k, v in slots.items()), key=lambda x: -x["earnings"])[:3]
    for b in best:
        b["earnings"] = round(b["earnings"], 2)
    offers = accepted + declined
    return {
        "online_hours_week": round(week_s / 3600, 1), "online_hours_total": round(total_s / 3600, 1),
        "acceptance_rate": round(accepted / offers * 100) if offers else None, "accepted": accepted, "declined": declined,
        "completed": completed, "cancelled": cancelled, "completion_rate": round(completed / accepted * 100) if accepted else None,
        "best_slots": best, "earnings_by_day": [{"day": DAYS_FR[i][:3], "amount": round(a, 2)} for i, a in enumerate(by_day)],
        "avg_rating": round(user.get("rating", 5.0), 2),
    }


# ---------------- Public tracking ----------------
@router.get("/public/track/{token}")
async def public_track(token: str):
    r = await db.rides.find_one({"share_token": token}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Lien de suivi invalide")
    return {
        "status": r["status"], "passenger_name": r["passenger_name"], "pickup": r["pickup"], "dropoff": r["dropoff"],
        "driver_name": r.get("driver_name"), "driver_vehicle": r.get("driver_vehicle"), "driver_plate": r.get("driver_plate"),
        "driver_rating": r.get("driver_rating"), "driver_location": r.get("driver_location"), "driver_eta_min": r.get("driver_eta_min"),
        "scheduled_at": r.get("scheduled_at"), "updated_at": now_utc(),
    }
