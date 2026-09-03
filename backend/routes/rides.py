import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (
    VEHICLE_PRICING, base_fare, current_user, db, new_id, notify, now_utc,
    require_role, send_tracking_link, surcharge_for, trip_metrics, working_driver,
)
from push import push_safe
from catalog import CANCELLATION_POLICY, SERVICES, VEHICLES, booking_ref, fits, hourly_price, match_fixed_route
from flights import lookup_flight, normalize_flight
from models import EstimateIn, EstimateOut, RateIn, RideBatchIn, RideCreateIn, RideOut, VehicleEstimate
from serializers import ride_to_out

router = APIRouter(prefix="/rides", tags=["rides"])

ACTIVE = ["requested", "accepted", "in_progress"]


@router.post("/estimate", response_model=EstimateOut)
async def estimate(data: EstimateIn):
    pickup, dropoff = data.pickup.model_dump(), data.dropoff.model_dump()
    dist, duration = trip_metrics(pickup, dropoff)
    sur = await surcharge_for(pickup)
    mult = sur["price_multiplier"]
    svc = SERVICES[data.service_type]
    hours = max(data.hours, svc["min_hours"]) if svc["pricing"] == "hourly" else 0
    fixed = await match_fixed_route(pickup, dropoff) if svc["pricing"] == "distance" else None
    total_pax = data.passengers + data.children
    options = []
    for vt, cfg in VEHICLE_PRICING.items():
        v = VEHICLES[vt]
        if hours:
            price = hourly_price(vt, hours)
        elif fixed and vt in fixed["prices"]:
            price = round(float(fixed["prices"][vt]), 2)
        else:
            price = round(base_fare(vt, dist, duration) * mult, 2)
        options.append(VehicleEstimate(
            vehicle_type=vt, label=v["label"], price=price, distance_km=dist, duration_min=duration, eta_min=cfg["eta"],
            category=v["category"], description=v["description"], image_url=v["image_url"], passengers=v["passengers"], luggage=v["luggage"],
            fits=fits(vt, total_pax, data.luggage), fixed_price=bool(fixed and not hours and vt in fixed["prices"]),
            fixed_route_name=fixed["name"] if fixed and not hours else None, hourly_rate=v["hourly"] if hours else None,
        ))
    return EstimateOut(options=options, surcharge=sur, pricing="hourly" if hours else "fixed" if fixed else "distance", hours=hours,
                       cancellation_policy=CANCELLATION_POLICY["text"])


async def build_ride(data: RideCreateIn, user: dict, batch_id: Optional[str] = None) -> dict:
    pickup, dropoff = data.pickup.model_dump(), data.dropoff.model_dump()
    dist, duration = trip_metrics(pickup, dropoff)
    city = await surcharge_for(pickup)
    svc = SERVICES[data.service_type]
    hours = max(data.hours, svc["min_hours"]) if svc["pricing"] == "hourly" else 0
    fixed = await match_fixed_route(pickup, dropoff) if not hours else None
    if not fits(data.vehicle_type, data.passengers + data.children, data.luggage):
        v = VEHICLES[data.vehicle_type]
        raise HTTPException(422, f"{v['label']} : {v['passengers']} passagers et {v['luggage']} bagages maximum. Choisissez un véhicule plus grand.")
    if hours:
        base = hourly_price(data.vehicle_type, hours)
    elif fixed and data.vehicle_type in fixed["prices"]:
        base = round(float(fixed["prices"][data.vehicle_type]), 2)
    else:
        base = round(base_fare(data.vehicle_type, dist, duration) * city["price_multiplier"], 2)
    flight = None
    if data.flight_number and data.flight_number.strip():
        flight = {"number": normalize_flight(data.flight_number), "airline": (data.airline or "").strip() or None,
                  "date": data.scheduled_at.date().isoformat() if data.scheduled_at else None}
        try:
            info = await lookup_flight(flight["number"], flight["date"])
            flight.update({k: v for k, v in info.items() if k != "cached"})
            flight["airline"] = flight.get("airline") or info.get("airline")
        except Exception as e:  # manual entry still accepted when tracking is unavailable
            flight["tracking_error"] = str(e)
    sur = city if data.surcharge_enabled else None
    sur_amount = sur["amount"] if sur else 0.0
    discount, promo_code = 0.0, None
    if data.promo_code:
        from routes.extras import resolve_promo
        res = await resolve_promo(data.promo_code, user, round(base + sur_amount, 2), business=bool(data.business))
        discount, promo_code = res["discount"], res["promo"]["code"]
        await db.promos.update_one({"code": promo_code}, {"$inc": {"uses": 1}})
    return {
        "id": new_id(),
        "source": "platform",
        "batch_id": batch_id,
        "passenger_id": user["id"],
        "passenger_name": user["full_name"],
        "passenger_phone": user.get("phone"),
        "passenger_label": data.passenger_label or None,
        "notes": data.notes or None,
        "driver_id": None,
        "pickup": pickup,
        "dropoff": dropoff,
        "vehicle_type": data.vehicle_type,
        "base_price": base,
        "surcharge_enabled": bool(sur),
        "surcharge_km": sur["distance_to_center_km"] if sur else 0,
        "surcharge_amount": sur_amount,
        "price": round(max(base + sur_amount - discount, 0), 2),
        "promo_code": promo_code,
        "discount_amount": discount,
        "price_multiplier": city["price_multiplier"],
        "city_name": city.get("city_name"),
        "distance_km": dist,
        "duration_min": duration,
        "status": "requested",
        "scheduled_at": data.scheduled_at,
        "payment_method": data.payment_method,
        "payment_status": "unpaid",
        "business": bool(data.business),
        "company_id": user.get("company_id") if data.business else None,
        "arrival_notified": False,
        "reminder_sent": False,
        "share_token": secrets.token_urlsafe(12),
        "cancellation_fee": 0,
        "use_wallet": bool(data.use_wallet),
        "wallet_amount": 0,
        "booking_ref": booking_ref(),
        "service_type": data.service_type,
        "hours": hours,
        "passengers": data.passengers,
        "children": data.children,
        "child_seats": data.child_seats,
        "luggage": data.luggage,
        "fixed_price": bool(fixed and data.vehicle_type in fixed["prices"]),
        "fixed_route_name": fixed["name"] if fixed and data.vehicle_type in fixed["prices"] else None,
        "flight": flight,
        "created_at": now_utc(),
    }


async def check_budget(user: dict, rides: list):
    """Business rides must fit into the employee's remaining company budget."""
    total = sum(r["price"] for r in rides if r.get("business"))
    if total <= 0:
        return
    if not user.get("company_id"):
        raise HTTPException(409, "Vous n'êtes rattaché à aucune entreprise")
    from routes.company import remaining_budget
    remaining = await remaining_budget(user)
    if remaining is not None and total > remaining + 1e-6:
        raise HTTPException(402, f"Budget professionnel insuffisant : {remaining:.2f} € restants")


async def apply_wallet(user: dict, rides: list):
    """Pay all or part of the rides with the rewards wallet (credit, never cash)."""
    from routes.referral import credit_wallet
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    balance = round((fresh or {}).get("wallet_balance", 0) or 0, 2)
    for r in rides:
        if not r.pop("use_wallet", False) or balance <= 0:
            r.pop("use_wallet", None)
            continue
        amt = round(min(balance, r["price"]), 2)
        balance -= amt
        r["wallet_amount"] = amt
        if amt >= r["price"]:
            r["payment_status"] = "paid"
        await credit_wallet(user["id"], -amt, "ride_payment", f"Paiement course → {r['dropoff']['address'][:40]}", r["id"])


async def push_new_rides_to_drivers(rides: list[dict]):
    """Wake up online drivers (push works even when the app is closed on native builds)."""
    public = [r for r in rides if not r.get("assigned_driver_id")]
    if not public:
        return
    ids = [d["id"] async for d in db.users.find(
        {"role": "driver", "is_online": True, "is_active": {"$ne": False}, "docs_blocked": {"$ne": True}}, {"_id": 0, "id": 1}).limit(300)]
    r = public[0]
    when = "programmée" if r.get("scheduled_at") else "immédiate"
    title = f"Nouvelle course {when}" if len(public) == 1 else f"{len(public)} nouvelles courses"
    body = f"{r['pickup']['address']} → {r['dropoff']['address']} · {r['price']:.2f} €"
    await push_safe(ids, title, body, "/(driver)", idempotency_key=f"new-{r['id']}")


@router.post("", response_model=RideOut)
async def create_ride(data: RideCreateIn, user=Depends(require_role("passenger"))):
    ride = await build_ride(data, user)
    await check_budget(user, [ride])
    await apply_wallet(user, [ride])
    await db.rides.insert_one(ride.copy())
    await push_new_rides_to_drivers([ride])
    return ride_to_out(ride)


@router.post("/batch", response_model=List[RideOut])
async def create_batch(data: RideBatchIn, user=Depends(require_role("passenger"))):
    batch_id = new_id()
    rides = [await build_ride(r, user, batch_id) for r in data.rides]
    await check_budget(user, rides)
    await apply_wallet(user, rides)
    await db.rides.insert_many([r.copy() for r in rides])
    await push_new_rides_to_drivers(rides)
    return [ride_to_out(r) for r in rides]


@router.get("/mine", response_model=List[RideOut])
async def my_rides(user=Depends(current_user)):
    key = "passenger_id" if user["role"] == "passenger" else "driver_id"
    cursor = db.rides.find({key: user["id"]}, {"_id": 0}).sort("created_at", -1)
    return [ride_to_out(r) async for r in cursor]


@router.get("/active", response_model=Optional[RideOut])
async def active_ride(user=Depends(current_user)):
    key = "passenger_id" if user["role"] == "passenger" else "driver_id"
    q = {key: user["id"], "status": {"$in": ACTIVE}}
    if user["role"] == "driver":
        q["status"] = {"$in": ["accepted", "in_progress"]}
    r = await db.rides.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
    return ride_to_out(r) if r else None


@router.get("/active-list", response_model=List[RideOut])
async def active_rides(user=Depends(current_user)):
    key = "passenger_id" if user["role"] == "passenger" else "driver_id"
    cursor = db.rides.find({key: user["id"], "status": {"$in": ACTIVE}}, {"_id": 0}).sort("created_at", -1)
    return [ride_to_out(r) async for r in cursor]


@router.get("/available", response_model=List[RideOut])
async def available_rides(user=Depends(working_driver)):
    q = {
        "status": "requested",
        "source": "platform",
        "$or": [{"assigned_driver_id": None}, {"assigned_driver_id": {"$exists": False}}, {"assigned_driver_id": user["id"]}],
    }
    declined = {d["ride_id"] async for d in db.ride_declines.find({"driver_id": user["id"]}, {"_id": 0, "ride_id": 1})}
    cursor = db.rides.find(q, {"_id": 0}).sort([("surcharge_amount", -1), ("created_at", -1)])
    return [ride_to_out(r) async for r in cursor if r["id"] not in declined]


@router.get("/{ride_id}", response_model=RideOut)
async def get_ride(ride_id: str, user=Depends(current_user)):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course introuvable")
    allowed = user["id"] in (r.get("passenger_id"), r.get("driver_id"), r.get("manager_id"))
    if not allowed and not (user["role"] == "driver" and r["status"] == "requested"):
        raise HTTPException(403, "Forbidden")
    return ride_to_out(r)


def driver_fields(user: dict) -> dict:
    return {
        "driver_id": user["id"],
        "driver_name": user["full_name"],
        "driver_vehicle": user.get("vehicle_model") or "Véhicule",
        "driver_plate": user.get("license_plate") or "N/A",
        "driver_rating": user.get("rating", 5.0),
        "driver_has_photo": bool(user.get("photo_path")),
        "manager_id": user.get("manager_id"),
    }


@router.post("/{ride_id}/accept", response_model=RideOut)
async def accept_ride(ride_id: str, user=Depends(working_driver)):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "requested":
        raise HTTPException(409, "Course déjà prise")
    if r.get("assigned_driver_id") and r["assigned_driver_id"] != user["id"]:
        raise HTTPException(403, "Course affectée à un autre chauffeur")
    update = {"status": "accepted", "accepted_at": now_utc(), **driver_fields(user)}
    await db.rides.update_one({"id": ride_id}, {"$set": update})
    r.update(update)
    await notify(r.get("passenger_id"), "accepted", "Chauffeur trouvé",
                 f"{user['full_name']} arrive avec {update['driver_vehicle']} ({update['driver_plate']})", ride_id, sms=True)
    await send_tracking_link(r)
    if r.get("flight") and r["flight"].get("number"):
        await notify(r.get("passenger_id"), "flight", "Votre chauffeur suit votre vol",
                     f"{r['flight']['number']} · nous adaptons la prise en charge en cas de retard", ride_id)
    return ride_to_out(r)


@router.post("/{ride_id}/start", response_model=RideOut)
async def start_ride(ride_id: str, user=Depends(require_role("driver"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or r.get("driver_id") != user["id"]:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "accepted":
        raise HTTPException(409, "Statut invalide")
    await db.rides.update_one({"id": ride_id}, {"$set": {"status": "in_progress", "started_at": now_utc()}})
    r["status"] = "in_progress"
    await notify(r.get("passenger_id"), "started", "Course démarrée", f"Direction {r['dropoff']['address']}", ride_id, sms=True)
    return ride_to_out(r)


@router.post("/{ride_id}/complete", response_model=RideOut)
async def complete_ride(ride_id: str, user=Depends(require_role("driver"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or r.get("driver_id") != user["id"]:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "in_progress":
        raise HTTPException(409, "Statut invalide")
    now = now_utc()
    update = {"status": "completed", "completed_at": now}
    if r.get("payment_method") == "cash":
        update["payment_status"] = "paid"
    await db.rides.update_one({"id": ride_id}, {"$set": update})
    await db.users.update_one({"id": user["id"]}, {"$inc": {"total_rides": 1}})
    if r.get("passenger_id"):
        await db.users.update_one({"id": r["passenger_id"]}, {"$inc": {"total_rides": 1}})
    r.update(update)
    from routes.referral import distribute_referral
    await distribute_referral(r)
    await notify(r.get("passenger_id"), "completed", "Course terminée",
                 f"Merci d'avoir voyagé avec {user['full_name']}. Notez votre chauffeur !", ride_id, sms=True)
    return ride_to_out(r)


@router.post("/{ride_id}/cancel", response_model=RideOut)
async def cancel_ride(ride_id: str, user=Depends(current_user)):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course introuvable")
    if user["id"] not in (r.get("passenger_id"), r.get("driver_id"), r.get("manager_id")):
        raise HTTPException(403, "Forbidden")
    if r["status"] in ("completed", "cancelled"):
        raise HTTPException(409, "Statut invalide")
    if r["status"] == "in_progress" and user["id"] == r.get("passenger_id"):
        raise HTTPException(409, "Impossible d'annuler une course en cours")
    update = {"status": "cancelled", "cancelled_at": now_utc(), "cancelled_by": user["role"]}
    # Passenger cancels after a driver accepted → cancellation fee goes to the driver
    if user["id"] == r.get("passenger_id") and r["status"] == "accepted" and r.get("driver_id"):
        from routes.passenger_extras import CANCEL_FEE
        update["cancellation_fee"] = CANCEL_FEE
        update["payment_status"] = "unpaid" if r.get("payment_method") == "card" else "paid"
    await db.rides.update_one({"id": ride_id}, {"$set": update})
    r.update(update)
    if r.get("wallet_amount"):
        from routes.referral import credit_wallet
        refund = round(r["wallet_amount"] - update.get("cancellation_fee", 0), 2)
        await credit_wallet(r["passenger_id"], max(refund, 0), "refund", "Remboursement course annulée", ride_id)
    other = r.get("driver_id") if user["id"] == r.get("passenger_id") else r.get("passenger_id")
    await notify(other, "cancelled", "Course annulée", f"Trajet vers {r['dropoff']['address']} annulé", ride_id)
    return ride_to_out(r)


@router.post("/{ride_id}/rate", response_model=RideOut)
async def rate_ride(ride_id: str, data: RateIn, user=Depends(require_role("passenger"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or r.get("passenger_id") != user["id"]:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "completed":
        raise HTTPException(409, "La course n'est pas terminée")
    if r.get("rating"):
        raise HTTPException(409, "Déjà noté")
    review = {k: getattr(data, k) for k in ("punctuality", "cleanliness", "driving", "vehicle") if getattr(data, k)}
    if data.comment and data.comment.strip():
        review["comment"] = data.comment.strip()
    review["created_at"] = now_utc()
    await db.rides.update_one({"id": ride_id}, {"$set": {"rating": data.rating, "tip": data.tip, "review": review}})
    r["review"] = review
    if r.get("driver_id"):
        driver = await db.users.find_one({"id": r["driver_id"]}, {"_id": 0})
        if driver:
            prev, cnt = driver.get("rating", 5.0), driver.get("rated_count", 0)
            new_rating = ((prev * cnt) + data.rating) / (cnt + 1)
            await db.users.update_one({"id": r["driver_id"]}, {"$set": {"rating": round(new_rating, 2)}, "$inc": {"rated_count": 1}})
    r["rating"], r["tip"] = data.rating, data.tip
    return ride_to_out(r)
