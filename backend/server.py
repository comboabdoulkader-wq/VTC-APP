"""FastAPI backend for VTC ride-hailing app."""
import os
import uuid
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, List, Literal, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-super-long-key-vtc-app-2026")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="VTC API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

Role = Literal["passenger", "driver"]
RideStatus = Literal["requested", "accepted", "in_progress", "completed", "cancelled"]
VehicleType = Literal["standard", "premium", "van"]

VEHICLE_PRICING = {
    "standard": {"base": 3.0, "per_km": 1.5, "per_min": 0.3, "label": "Standard"},
    "premium": {"base": 5.0, "per_km": 2.5, "per_min": 0.5, "label": "Premium"},
    "van": {"base": 6.0, "per_km": 2.0, "per_min": 0.4, "label": "Van"},
}


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)
    full_name: str = Field(min_length=1, max_length=80)
    role: Role
    phone: Optional[str] = None
    vehicle_model: Optional[str] = None
    license_plate: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: Role
    phone: Optional[str] = None
    vehicle_model: Optional[str] = None
    license_plate: Optional[str] = None
    rating: float = 5.0
    total_rides: int = 0


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class LocationIn(BaseModel):
    lat: float
    lng: float
    address: str


class EstimateIn(BaseModel):
    pickup: LocationIn
    dropoff: LocationIn


class EstimateOut(BaseModel):
    vehicle_type: VehicleType
    label: str
    price: float
    distance_km: float
    duration_min: int
    eta_min: int


class RideCreateIn(BaseModel):
    pickup: LocationIn
    dropoff: LocationIn
    vehicle_type: VehicleType
    price: float
    distance_km: float
    duration_min: int


class RideOut(BaseModel):
    id: str
    passenger_id: str
    passenger_name: str
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    driver_vehicle: Optional[str] = None
    driver_plate: Optional[str] = None
    driver_rating: Optional[float] = None
    pickup: LocationIn
    dropoff: LocationIn
    vehicle_type: VehicleType
    price: float
    distance_km: float
    duration_min: int
    status: RideStatus
    created_at: datetime
    accepted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    rating: Optional[int] = None
    tip: Optional[float] = None


class RateIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    tip: float = Field(default=0, ge=0)


class DriverStatusIn(BaseModel):
    is_online: bool
    lat: Optional[float] = None
    lng: Optional[float] = None


# ---------- Helpers ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(pw: str, pw_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), pw_hash.encode("utf-8"))
    except Exception:
        return False


def make_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def user_to_out(u: dict) -> UserOut:
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
    )


def ride_to_out(r: dict) -> RideOut:
    return RideOut(
        id=r["id"],
        passenger_id=r["passenger_id"],
        passenger_name=r["passenger_name"],
        driver_id=r.get("driver_id"),
        driver_name=r.get("driver_name"),
        driver_vehicle=r.get("driver_vehicle"),
        driver_plate=r.get("driver_plate"),
        driver_rating=r.get("driver_rating"),
        pickup=LocationIn(**r["pickup"]),
        dropoff=LocationIn(**r["dropoff"]),
        vehicle_type=r["vehicle_type"],
        price=r["price"],
        distance_km=r["distance_km"],
        duration_min=r["duration_min"],
        status=r["status"],
        created_at=r["created_at"],
        accepted_at=r.get("accepted_at"),
        completed_at=r.get("completed_at"),
        rating=r.get("rating"),
        tip=r.get("tip"),
    )


async def current_user(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)]
) -> dict:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


def require_role(*roles: Role):
    async def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user
    return dep


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    import math
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ---------- Auth routes ----------
@api.get("/")
async def root():
    return {"message": "VTC API", "status": "ok"}


@api.post("/auth/register", response_model=TokenOut)
async def register(data: RegisterIn):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email déjà enregistré")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(data.password),
        "full_name": data.full_name,
        "role": data.role,
        "phone": data.phone,
        "vehicle_model": data.vehicle_model,
        "license_plate": data.license_plate,
        "rating": 5.0,
        "total_rides": 0,
        "is_online": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user.copy())
    token = make_token(user)
    return TokenOut(access_token=token, user=user_to_out(user))


@api.post("/auth/login", response_model=TokenOut)
async def login(data: LoginIn):
    email = data.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Email ou mot de passe incorrect")
    token = make_token(user)
    return TokenOut(access_token=token, user=user_to_out(user))


@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return user_to_out(user)


# ---------- Estimate ----------
@api.post("/rides/estimate", response_model=List[EstimateOut])
async def estimate(data: EstimateIn):
    dist = haversine_km(data.pickup.lat, data.pickup.lng, data.dropoff.lat, data.dropoff.lng)
    dist = max(dist, 0.5)
    duration = max(int(dist * 2.5), 3)  # ~24km/h city
    out = []
    for vt, cfg in VEHICLE_PRICING.items():
        price = cfg["base"] + dist * cfg["per_km"] + duration * cfg["per_min"]
        out.append(EstimateOut(
            vehicle_type=vt,
            label=cfg["label"],
            price=round(price, 2),
            distance_km=round(dist, 2),
            duration_min=duration,
            eta_min=3 if vt == "standard" else (5 if vt == "premium" else 7),
        ))
    return out


# ---------- Rides ----------
@api.post("/rides", response_model=RideOut)
async def create_ride(data: RideCreateIn, user=Depends(require_role("passenger"))):
    ride = {
        "id": str(uuid.uuid4()),
        "passenger_id": user["id"],
        "passenger_name": user["full_name"],
        "driver_id": None,
        "driver_name": None,
        "driver_vehicle": None,
        "driver_plate": None,
        "driver_rating": None,
        "pickup": data.pickup.model_dump(),
        "dropoff": data.dropoff.model_dump(),
        "vehicle_type": data.vehicle_type,
        "price": data.price,
        "distance_km": data.distance_km,
        "duration_min": data.duration_min,
        "status": "requested",
        "created_at": datetime.now(timezone.utc),
    }
    await db.rides.insert_one(ride.copy())
    return ride_to_out(ride)


@api.get("/rides/mine", response_model=List[RideOut])
async def my_rides(user=Depends(current_user)):
    key = "passenger_id" if user["role"] == "passenger" else "driver_id"
    cursor = db.rides.find({key: user["id"]}, {"_id": 0}).sort("created_at", -1)
    return [ride_to_out(r) async for r in cursor]


@api.get("/rides/active", response_model=Optional[RideOut])
async def active_ride(user=Depends(current_user)):
    key = "passenger_id" if user["role"] == "passenger" else "driver_id"
    q = {key: user["id"], "status": {"$in": ["requested", "accepted", "in_progress"]}}
    r = await db.rides.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
    if not r:
        return None
    return ride_to_out(r)


@api.get("/rides/available", response_model=List[RideOut])
async def available_rides(user=Depends(require_role("driver"))):
    cursor = db.rides.find({"status": "requested"}, {"_id": 0}).sort("created_at", -1)
    return [ride_to_out(r) async for r in cursor]


@api.get("/rides/{ride_id}", response_model=RideOut)
async def get_ride(ride_id: str, user=Depends(current_user)):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course introuvable")
    if user["id"] not in (r["passenger_id"], r.get("driver_id") or ""):
        # allow driver to view any requested ride
        if not (user["role"] == "driver" and r["status"] == "requested"):
            raise HTTPException(403, "Forbidden")
    return ride_to_out(r)


@api.post("/rides/{ride_id}/accept", response_model=RideOut)
async def accept_ride(ride_id: str, user=Depends(require_role("driver"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "requested":
        raise HTTPException(409, "Course déjà prise")
    update = {
        "status": "accepted",
        "driver_id": user["id"],
        "driver_name": user["full_name"],
        "driver_vehicle": user.get("vehicle_model") or "Véhicule",
        "driver_plate": user.get("license_plate") or "N/A",
        "driver_rating": user.get("rating", 5.0),
        "accepted_at": datetime.now(timezone.utc),
    }
    await db.rides.update_one({"id": ride_id}, {"$set": update})
    r.update(update)
    return ride_to_out(r)


@api.post("/rides/{ride_id}/start", response_model=RideOut)
async def start_ride(ride_id: str, user=Depends(require_role("driver"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or r.get("driver_id") != user["id"]:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "accepted":
        raise HTTPException(409, "Statut invalide")
    await db.rides.update_one({"id": ride_id}, {"$set": {"status": "in_progress"}})
    r["status"] = "in_progress"
    return ride_to_out(r)


@api.post("/rides/{ride_id}/complete", response_model=RideOut)
async def complete_ride(ride_id: str, user=Depends(require_role("driver"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or r.get("driver_id") != user["id"]:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "in_progress":
        raise HTTPException(409, "Statut invalide")
    now = datetime.now(timezone.utc)
    await db.rides.update_one(
        {"id": ride_id},
        {"$set": {"status": "completed", "completed_at": now}},
    )
    # Increment total_rides for both users
    await db.users.update_one({"id": user["id"]}, {"$inc": {"total_rides": 1}})
    await db.users.update_one({"id": r["passenger_id"]}, {"$inc": {"total_rides": 1}})
    r["status"] = "completed"
    r["completed_at"] = now
    return ride_to_out(r)


@api.post("/rides/{ride_id}/cancel", response_model=RideOut)
async def cancel_ride(ride_id: str, user=Depends(current_user)):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Course introuvable")
    if user["id"] not in (r["passenger_id"], r.get("driver_id") or ""):
        raise HTTPException(403, "Forbidden")
    if r["status"] in ("completed", "cancelled"):
        raise HTTPException(409, "Statut invalide")
    await db.rides.update_one({"id": ride_id}, {"$set": {"status": "cancelled"}})
    r["status"] = "cancelled"
    return ride_to_out(r)


@api.post("/rides/{ride_id}/rate", response_model=RideOut)
async def rate_ride(ride_id: str, data: RateIn, user=Depends(require_role("passenger"))):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not r or r["passenger_id"] != user["id"]:
        raise HTTPException(404, "Course introuvable")
    if r["status"] != "completed":
        raise HTTPException(409, "La course n'est pas terminée")
    if r.get("rating"):
        raise HTTPException(409, "Déjà noté")
    await db.rides.update_one(
        {"id": ride_id},
        {"$set": {"rating": data.rating, "tip": data.tip}},
    )
    # Update driver's rating average (track rated_count separately from total_rides)
    if r.get("driver_id"):
        driver = await db.users.find_one({"id": r["driver_id"]}, {"_id": 0})
        if driver:
            prev = driver.get("rating", 5.0)
            rated_count = driver.get("rated_count", 0)
            new_rating = ((prev * rated_count) + data.rating) / (rated_count + 1)
            await db.users.update_one(
                {"id": r["driver_id"]},
                {"$set": {"rating": round(new_rating, 2)}, "$inc": {"rated_count": 1}},
            )
    r["rating"] = data.rating
    r["tip"] = data.tip
    return ride_to_out(r)


# ---------- Driver ----------
@api.post("/driver/status")
async def driver_status(data: DriverStatusIn, user=Depends(require_role("driver"))):
    update = {"is_online": data.is_online}
    if data.lat is not None and data.lng is not None:
        update["last_location"] = {"lat": data.lat, "lng": data.lng, "updated_at": datetime.now(timezone.utc)}
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    return {"ok": True, "is_online": data.is_online}


@api.get("/driver/earnings")
async def driver_earnings(user=Depends(require_role("driver"))):
    cursor = db.rides.find({"driver_id": user["id"], "status": "completed"}, {"_id": 0})
    total = 0.0
    count = 0
    async for r in cursor:
        total += r.get("price", 0) + (r.get("tip") or 0)
        count += 1
    return {"total": round(total, 2), "rides_count": count}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
