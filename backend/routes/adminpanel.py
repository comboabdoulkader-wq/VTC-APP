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
    "dispatch": {
        "enabled": True, "radius_km": 8.0, "max_drivers": 8, "response_seconds": 15,
        "priority": "eta",  # distance | eta | rating | fairness
        "alarm": {"enabled": True, "sound": "default", "volume": 1.0, "duration_seconds": 30, "repeats": 3},
        "planning": {"allow_scheduled": True, "min_lead_minutes": 30, "max_lead_days": 30},
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
    for k in ("commission", "cashback", "dispatch"):
        s[k] = {**DEFAULT_SETTINGS[k], **(doc.get(k) or {})}
    s["cashback"]["tiers"] = {**DEFAULT_SETTINGS["cashback"]["tiers"], **((doc.get("cashback") or {}).get("tiers") or {})}
    s["dispatch"]["alarm"] = {**DEFAULT_SETTINGS["dispatch"]["alarm"], **((doc.get("dispatch") or {}).get("alarm") or {})}
    s["dispatch"]["planning"] = {**DEFAULT_SETTINGS["dispatch"]["planning"], **((doc.get("dispatch") or {}).get("planning") or {})}
    return s


class SettingsIn(BaseModel):
    commission: Optional[dict] = None
    commission_by_city: Optional[dict] = None
    commission_by_vehicle: Optional[dict] = None
    cashback: Optional[dict] = None
    dispatch: Optional[dict] = None


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


# ---------- Intelligent instant-ride dispatch (driver scoring) ----------
async def compute_candidates(ride: dict) -> list:
    """Rank eligible online drivers for an immediate ride by a weighted score and store them on the ride.
    Non-destructive: the broadcast still happens; this just adds an ordered candidate queue + best driver."""
    from core import haversine_km, AVG_SPEED_KMH
    settings = await get_settings()
    disp = settings.get("dispatch") or {}
    if not disp.get("enabled", True) or ride.get("scheduled_at"):
        return []
    pickup = ride.get("pickup") or {}
    radius = float(disp.get("radius_km", 8) or 8)
    priority = disp.get("priority", "eta")
    weights = {
        "distance": {"dist": 0.6, "eta": 0.15, "rating": 0.15, "fair": 0.10},
        "eta": {"dist": 0.2, "eta": 0.55, "rating": 0.15, "fair": 0.10},
        "rating": {"dist": 0.2, "eta": 0.2, "rating": 0.5, "fair": 0.10},
        "fairness": {"dist": 0.2, "eta": 0.2, "rating": 0.1, "fair": 0.5},
    }.get(priority, {"dist": 0.3, "eta": 0.4, "rating": 0.2, "fair": 0.1})
    drivers = [d async for d in db.users.find(
        {"role": "driver", "is_online": True, "is_active": {"$ne": False}, "docs_blocked": {"$ne": True}},
        {"_id": 0, "id": 1, "full_name": 1, "rating": 1, "driver_location": 1, "last_location": 1, "vehicle_type": 1, "last_assigned_at": 1}).limit(300)]
    cands = []
    now = now_utc()
    for d in drivers:
        # Vehicle compatibility (only when the driver has a declared vehicle type).
        if d.get("vehicle_type") and ride.get("vehicle_type") and d["vehicle_type"] != ride["vehicle_type"]:
            continue
        loc = d.get("driver_location") or d.get("last_location") or {}
        if loc.get("lat") is not None and pickup.get("lat") is not None:
            dist = round(haversine_km(loc["lat"], loc["lng"], pickup["lat"], pickup["lng"]), 2)
            if dist > radius:
                continue
        else:
            dist = radius  # unknown location: neutral (least-preferred within radius)
        eta = max(1, int(dist / AVG_SPEED_KMH * 60))
        last = d.get("last_assigned_at")
        idle_min = 60.0
        if last:
            la = last.replace(tzinfo=now.tzinfo) if getattr(last, "tzinfo", None) is None else last
            idle_min = max(0.0, (now - la).total_seconds() / 60)
        dist_s = max(0.0, 1 - dist / radius)
        eta_s = max(0.0, 1 - eta / 20)
        rating_s = (d.get("rating", 5.0) or 5.0) / 5.0
        fair_s = min(1.0, idle_min / 30.0)
        score = round(100 * (weights["dist"] * dist_s + weights["eta"] * eta_s + weights["rating"] * rating_s + weights["fair"] * fair_s), 1)
        cands.append({"driver_id": d["id"], "name": d.get("full_name"), "score": score, "distance_km": dist, "eta_min": eta, "rating": round(d.get("rating", 5.0) or 5.0, 2)})
    cands.sort(key=lambda c: -c["score"])
    cands = cands[: int(disp.get("max_drivers", 8) or 8)]
    await db.rides.update_one({"id": ride["id"]}, {"$set": {
        "candidates": cands, "best_driver_id": cands[0]["driver_id"] if cands else None,
        "dispatch_priority": priority, "offer_seconds": int(disp.get("response_seconds", 15) or 15),
    }})
    return cands


@router.get("/rides/{ride_id}/candidates")
async def ride_candidates(ride_id: str, user=Depends(moderator_only)):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0, "candidates": 1, "best_driver_id": 1, "dispatch_priority": 1, "status": 1})
    if not r:
        raise HTTPException(404, "Course introuvable")
    return {"candidates": r.get("candidates") or [], "best_driver_id": r.get("best_driver_id"), "priority": r.get("dispatch_priority"), "status": r.get("status")}


async def advance_offer(ride_id: str):
    """Cascade: offer the ride to the next best candidate who hasn't declined; else fall back to broadcast."""
    from core import notify
    r = await db.rides.find_one({"id": ride_id, "status": "requested"}, {"_id": 0})
    if not r:
        return None
    declined = {d["driver_id"] async for d in db.ride_declines.find({"ride_id": ride_id}, {"_id": 0, "driver_id": 1})}
    offer_seconds = int(r.get("offer_seconds", 15) or 15)
    nxt = next((c for c in (r.get("candidates") or []) if c["driver_id"] not in declined), None)
    if nxt:
        exp = now_utc() + timedelta(seconds=offer_seconds)
        await db.rides.update_one({"id": ride_id}, {"$set": {"assigned_driver_id": nxt["driver_id"], "offer_expires_at": exp}})
        await notify(nxt["driver_id"], "ride", "Nouvelle course", f"Course à {nxt.get('distance_km', '?')} km · répondez sous {offer_seconds}s", ride_id)
        return nxt["driver_id"]
    # No candidate left -> open to everyone (broadcast fallback), never dead-end.
    await db.rides.update_one({"id": ride_id}, {"$set": {"assigned_driver_id": None, "offer_expires_at": None}})
    return None


async def dispatch_expiry_sweep():
    """Timeout handler: assigned candidate didn't answer in time -> auto-decline and cascade to the next."""
    from core import notify
    now = now_utc()
    async for r in db.rides.find({"status": "requested", "assigned_driver_id": {"$ne": None}, "offer_expires_at": {"$lt": now}}, {"_id": 0, "id": 1, "assigned_driver_id": 1}):
        await db.ride_declines.update_one({"ride_id": r["id"], "driver_id": r["assigned_driver_id"]}, {"$set": {"declined_at": now, "reason": "timeout"}}, upsert=True)
        await advance_offer(r["id"])
