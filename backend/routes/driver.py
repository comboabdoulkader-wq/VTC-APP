from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core import (
    ARRIVAL_ALERT_MIN, CITY_CENTER, PRIVATE_COMMISSION_RATE, db, eta_minutes, new_id,
    notify, now_utc, require_role, working_driver,
)
from models import DriverStatusIn, LocationUpdateIn, PrivateRideIn, PrivateRideUpdateIn, RideOut
from serializers import ride_to_out

router = APIRouter(prefix="/driver", tags=["driver"])
driver_only = require_role("driver")


@router.post("/status")
async def driver_status(data: DriverStatusIn, user=Depends(driver_only)):
    if data.is_online and user.get("docs_blocked"):
        from core import BLOCKED_DRIVER_MESSAGE
        raise HTTPException(423, BLOCKED_DRIVER_MESSAGE)
    update = {"is_online": data.is_online}
    if data.lat is not None and data.lng is not None:
        update["last_location"] = {"lat": data.lat, "lng": data.lng, "updated_at": now_utc()}
    # Online sessions for driver statistics
    if data.is_online and not user.get("online_since"):
        update["online_since"] = now_utc()
    if not data.is_online and user.get("online_since"):
        await db.driver_sessions.insert_one({"driver_id": user["id"], "start": user["online_since"], "end": now_utc()})
        update["online_since"] = None
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return {"ok": True, "is_online": data.is_online}


@router.post("/location")
async def driver_location(data: LocationUpdateIn, user=Depends(driver_only)):
    """Live GPS ping. Updates the driver position on their active ride and fires the 2-minute arrival alert."""
    loc = {"lat": data.lat, "lng": data.lng, "updated_at": now_utc()}
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_location": loc}})
    ride = await db.rides.find_one(
        {"driver_id": user["id"], "status": {"$in": ["accepted", "in_progress"]}}, {"_id": 0}
    )
    if not ride:
        return {"ok": True}
    target = ride["pickup"] if ride["status"] == "accepted" else ride["dropoff"]
    eta = eta_minutes(data.lat, data.lng, target["lat"], target["lng"])
    update = {"driver_location": loc, "driver_eta_min": eta}
    arrival_alert = False
    if ride["status"] == "accepted" and eta <= ARRIVAL_ALERT_MIN and not ride.get("arrival_notified"):
        update["arrival_notified"] = True
        arrival_alert = True
    await db.rides.update_one({"id": ride["id"]}, {"$set": update})
    if arrival_alert:
        await notify(
            ride.get("passenger_id"), "arriving", "Votre chauffeur arrive",
            f"{user['full_name']} est à moins de {ARRIVAL_ALERT_MIN} min ({ride['driver_vehicle']} · {ride['driver_plate']})",
            ride["id"], sms=True,
        )
    return {"ok": True, "eta_min": eta, "arrival_alert": arrival_alert}


@router.get("/earnings")
async def driver_earnings(user=Depends(driver_only)):
    cursor = db.rides.find({"driver_id": user["id"], "status": "completed"}, {"_id": 0})
    out = {"platform": {"count": 0, "gross": 0.0}, "private": {"count": 0, "gross": 0.0, "commission": 0.0}, "cancellation_fees": 0.0}
    async for c in db.rides.find({"driver_id": user["id"], "status": "cancelled", "cancellation_fee": {"$gt": 0}}, {"_id": 0, "cancellation_fee": 1}):
        out["cancellation_fees"] += c["cancellation_fee"]
    async for r in cursor:
        amt = r.get("price", 0) + (r.get("tip") or 0)
        if r.get("source") == "private":
            out["private"]["count"] += 1
            out["private"]["gross"] += amt
            out["private"]["commission"] += r.get("commission_amount", 0)
        else:
            out["platform"]["count"] += 1
            out["platform"]["gross"] += amt
    gross = out["platform"]["gross"] + out["private"]["gross"] + out["cancellation_fees"]
    commission = out["private"]["commission"]
    out["cancellation_fees"] = round(out["cancellation_fees"], 2)
    for k in (out["platform"], out["private"]):
        for kk in k:
            k[kk] = round(k[kk], 2)
    return {
        "total": round(gross, 2),
        "commission": round(commission, 2),
        "net": round(gross - commission, 2),
        "rides_count": out["platform"]["count"] + out["private"]["count"],
        "commission_rate": PRIVATE_COMMISSION_RATE,
        **out,
    }


# ---------- Private rides ----------
@router.get("/private-rides", response_model=List[RideOut])
async def list_private(user=Depends(driver_only)):
    cursor = db.rides.find({"driver_id": user["id"], "source": "private"}, {"_id": 0}).sort("scheduled_at", -1)
    return [ride_to_out(r) async for r in cursor]


@router.post("/private-rides", response_model=RideOut)
async def create_private(data: PrivateRideIn, user=Depends(driver_only)):
    ride = {
        "id": new_id(),
        "source": "private",
        "passenger_id": None,
        "passenger_name": data.client_name,
        "passenger_phone": data.client_phone,
        "notes": data.notes,
        "driver_id": user["id"],
        "driver_name": user["full_name"],
        "driver_vehicle": user.get("vehicle_model") or "Véhicule",
        "driver_plate": user.get("license_plate") or "N/A",
        "driver_rating": user.get("rating", 5.0),
        "manager_id": user.get("manager_id"),
        "pickup": {"lat": CITY_CENTER["lat"], "lng": CITY_CENTER["lng"], "address": data.pickup_address},
        "dropoff": {"lat": CITY_CENTER["lat"], "lng": CITY_CENTER["lng"], "address": data.dropoff_address},
        "vehicle_type": data.vehicle_type,
        "base_price": data.price,
        "price": data.price,
        "distance_km": 0,
        "duration_min": 0,
        "status": "accepted",
        "scheduled_at": data.scheduled_at,
        "payment_method": data.payment_method,
        "payment_status": "unpaid",
        "commission_rate": PRIVATE_COMMISSION_RATE,
        "commission_amount": 0,
        "created_at": now_utc(),
        "accepted_at": now_utc(),
    }
    await db.rides.insert_one(ride.copy())
    return ride_to_out(ride)


@router.patch("/private-rides/{ride_id}", response_model=RideOut)
async def update_private(ride_id: str, data: PrivateRideUpdateIn, user=Depends(driver_only)):
    r = await db.rides.find_one({"id": ride_id, "driver_id": user["id"], "source": "private"}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course privée introuvable")
    if r["status"] in ("completed", "cancelled"):
        raise HTTPException(409, "Course déjà clôturée")
    update = {}
    if data.price is not None:
        update["price"] = update["base_price"] = data.price
    if data.notes is not None:
        update["notes"] = data.notes
    if data.scheduled_at is not None:
        update["scheduled_at"] = data.scheduled_at
    if data.status:
        update["status"] = data.status
        if data.status == "completed":
            price = update.get("price", r["price"])
            update["completed_at"] = now_utc()
            update["commission_amount"] = round(price * PRIVATE_COMMISSION_RATE, 2)
            update["payment_status"] = "paid"
            await db.users.update_one({"id": user["id"]}, {"$inc": {"total_rides": 1}})
    await db.rides.update_one({"id": ride_id}, {"$set": update})
    r.update(update)
    return ride_to_out(r)


@router.delete("/private-rides/{ride_id}")
async def delete_private(ride_id: str, user=Depends(driver_only)):
    res = await db.rides.delete_one({"id": ride_id, "driver_id": user["id"], "source": "private", "status": {"$ne": "completed"}})
    if res.deleted_count == 0:
        raise HTTPException(404, "Suppression impossible")
    return {"ok": True}
