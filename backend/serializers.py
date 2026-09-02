"""Dict -> API model serializers."""
from models import DriverLocation, LocationIn, RideOut, UserOut


def user_to_out(u: dict, **extra) -> UserOut:
    return UserOut(
        id=u["id"],
        email=u["email"],
        full_name=u["full_name"],
        role=u["role"],
        phone=u.get("phone"),
        vehicle_model=u.get("vehicle_model"),
        license_plate=u.get("license_plate"),
        rating=u.get("rating", 5.0),
        total_rides=u.get("total_rides", 0),
        manager_id=u.get("manager_id"),
        manager_name=u.get("manager_name"),
        is_active=u.get("is_active", True),
        is_online=u.get("is_online", False),
        **extra,
    )


def ride_to_out(r: dict) -> RideOut:
    loc = r.get("driver_location")
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
        driver_location=DriverLocation(**loc) if loc else None,
        driver_eta_min=r.get("driver_eta_min"),
        pickup=LocationIn(**r["pickup"]),
        dropoff=LocationIn(**r["dropoff"]),
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
        assigned_by_name=r.get("assigned_by_name"),
        created_at=r["created_at"],
        accepted_at=r.get("accepted_at"),
        completed_at=r.get("completed_at"),
        rating=r.get("rating"),
        tip=r.get("tip"),
    )
