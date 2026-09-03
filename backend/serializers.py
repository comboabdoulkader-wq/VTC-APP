"""Dict -> API model serializers."""
from datetime import timezone

from catalog import SERVICE_LABELS, SERVICES
from core import WAIT_FREE_DEPARTURE_MIN, WAIT_STOP_FREE_MIN, now_utc, wait_fee
from models import DriverLocation, LocationIn, RideOut, UserOut


def _aware(dt):
    return dt.replace(tzinfo=timezone.utc) if dt and getattr(dt, "tzinfo", None) is None else dt


def user_to_out(u: dict, **extra) -> UserOut:
    return UserOut(
        id=u["id"],
        email=u["email"],
        full_name=u["full_name"],
        role=u["role"],
        phone=u.get("phone"),
        phone_verified=bool(u.get("phone_verified")),
        sms_enabled=u.get("sms_enabled", True),
        language=u.get("language", "fr"),
        vehicle_model=u.get("vehicle_model"),
        license_plate=u.get("license_plate"),
        rating=u.get("rating", 5.0),
        total_rides=u.get("total_rides", 0),
        manager_id=u.get("manager_id"),
        manager_name=u.get("manager_name"),
        is_active=u.get("is_active", True),
        is_online=u.get("is_online", False),
        is_moderator=u.get("is_moderator", False),
        docs_blocked=u.get("docs_blocked", False),
        selfie_requested=u.get("selfie_requested", False),
        has_photo=bool(u.get("photo_path")),
        wallet_balance=round(u.get("wallet_balance", 0) or 0, 2),
        referral_code=u.get("referral_code"),
        company_name=u.get("company_name"),
        invite_code=u.get("invite_code"),
        company_id=u.get("company_id"),
        budget_amount=u.get("budget_amount"),
        budget_period=u.get("budget_period"),
        company_active=u.get("company_active"),
        **extra,
    )


def ride_to_out(r: dict) -> RideOut:
    loc = r.get("driver_location")
    now = now_utc()
    dep_fee = round(r.get("waiting_departure_fee") or 0, 2)
    dep_min = 0.0
    waiting_active = False
    if r.get("arrived_at") and r.get("status") == "accepted":
        dep_min = round((now - _aware(r["arrived_at"])).total_seconds() / 60, 1)
        dep_fee = wait_fee(WAIT_FREE_DEPARTURE_MIN, dep_min)
        waiting_active = True
    stop_waits = []
    for w in (r.get("stop_waits") or []):
        fee = round(w.get("fee") or 0, 2)
        active = bool(w.get("arrived_at") and not w.get("departed_at"))
        if active:
            mins = round((now - _aware(w["arrived_at"])).total_seconds() / 60, 1)
            fee = wait_fee(WAIT_STOP_FREE_MIN, mins)
            waiting_active = True
        stop_waits.append({"arrived_at": w.get("arrived_at"), "departed_at": w.get("departed_at"), "fee": fee, "active": active})
    live_wait = round(dep_fee + sum(s["fee"] for s in stop_waits), 2)
    toll = round(r.get("toll_amount") or 0, 2)
    breakdown = {
        "base": round(r.get("base_price", r.get("price", 0)), 2),
        "surcharge": round(r.get("surcharge_amount", 0), 2),
        "discount": round(r.get("discount_amount", 0), 2),
        "waiting": live_wait, "toll": toll,
        "total": round(r.get("price", 0) + (0 if r.get("status") == "completed" else live_wait + toll), 2),
    }
    return RideOut(
        id=r["id"],
        source=r.get("source", "platform"),
        batch_id=r.get("batch_id"),
        passenger_id=r.get("passenger_id"),
        passenger_name=r["passenger_name"],
        passenger_label=r.get("passenger_label"),
        passenger_phone=r.get("passenger_phone"),
        notes=r.get("notes"),
        driver_id=r.get("driver_id"),
        driver_name=r.get("driver_name"),
        driver_vehicle=r.get("driver_vehicle"),
        driver_plate=r.get("driver_plate"),
        driver_rating=r.get("driver_rating"),
        driver_has_photo=bool(r.get("driver_has_photo")),
        driver_location=DriverLocation(**loc) if loc else None,
        driver_eta_min=r.get("driver_eta_min"),
        pickup=LocationIn(**r["pickup"]),
        dropoff=LocationIn(**r["dropoff"]),
        stops=[LocationIn(**s) for s in (r.get("stops") or [])],
        vehicle_type=r["vehicle_type"],
        base_price=r.get("base_price", r["price"]),
        surcharge_enabled=r.get("surcharge_enabled", False),
        surcharge_km=r.get("surcharge_km", 0),
        surcharge_amount=r.get("surcharge_amount", 0),
        price=r["price"],
        distance_km=r.get("distance_km", 0),
        duration_min=r.get("duration_min", 0),
        status=r["status"],
        scheduled_at=r.get("scheduled_at"),
        payment_method=r.get("payment_method", "cash"),
        payment_status=r.get("payment_status", "unpaid"),
        commission_rate=r.get("commission_rate", 0),
        commission_amount=r.get("commission_amount", 0),
        business=r.get("business", False),
        promo_code=r.get("promo_code"),
        discount_amount=r.get("discount_amount", 0),
        price_multiplier=r.get("price_multiplier", 1.0),
        city_name=r.get("city_name"),
        tip_paid=bool(r.get("tip_paid")),
        share_token=r.get("share_token"),
        cancellation_fee=r.get("cancellation_fee", 0),
        wallet_amount=r.get("wallet_amount", 0),
        due_amount=round(r["price"] - r.get("wallet_amount", 0), 2),
        assigned_by_name=r.get("assigned_by_name"),
        created_at=r["created_at"],
        accepted_at=r.get("accepted_at"),
        completed_at=r.get("completed_at"),
        rating=r.get("rating"),
        tip=r.get("tip"),
        booking_ref=r.get("booking_ref"),
        service_type=r.get("service_type", "private"),
        service_label=SERVICES.get(r.get("service_type", "private"), SERVICES["private"])["label"],
        service_labels={"fr": SERVICES.get(r.get("service_type", "private"), SERVICES["private"])["label"], **SERVICE_LABELS.get(r.get("service_type", "private"), SERVICE_LABELS["private"])},
        hours=r.get("hours", 0),
        passengers=r.get("passengers", 1),
        children=r.get("children", 0),
        child_seats=r.get("child_seats", 0),
        luggage=r.get("luggage", 0),
        fixed_price=bool(r.get("fixed_price")),
        fixed_route_name=r.get("fixed_route_name"),
        flight=r.get("flight"),
        review=r.get("review"),
        partner_booking=bool(r.get("partner_booking")),
        partner_name=r.get("partner_name"),
        partner_discount_amount=r.get("partner_discount_amount", 0),
        guest_name=r.get("guest_name"),
        room=r.get("room"),
        arrived_at=r.get("arrived_at"),
        waiting_departure_min=dep_min,
        waiting_departure_fee=dep_fee,
        waiting_active=waiting_active,
        stop_waits=stop_waits,
        waiting_fee=round(r.get("waiting_fee") or 0, 2),
        toll_amount=toll,
        breakdown=breakdown,
    )
