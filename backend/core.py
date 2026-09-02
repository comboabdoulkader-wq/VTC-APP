"""Shared config, DB, auth helpers and pricing rules."""
import math
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-super-long-key-vtc-app-2026")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
security = HTTPBearer(auto_error=False)

# ---------- Business rules ----------
CITY_CENTER = {"lat": 48.8583, "lng": 2.3477, "name": "Paris – Châtelet"}
SURCHARGE_PER_KM = 1.20
PRIVATE_COMMISSION_RATE = 0.15
ARRIVAL_ALERT_MIN = 2
AVG_SPEED_KMH = 24.0

VEHICLE_PRICING = {
    "standard": {"base": 3.0, "per_km": 1.5, "per_min": 0.3, "label": "Standard", "eta": 3},
    "premium": {"base": 5.0, "per_km": 2.5, "per_min": 0.5, "label": "Premium", "eta": 5},
    "van": {"base": 6.0, "per_km": 2.0, "per_min": 0.4, "label": "Van", "eta": 7},
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def trip_metrics(pickup: dict, dropoff: dict) -> tuple[float, int]:
    dist = max(haversine_km(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"]), 0.5)
    duration = max(int(dist / AVG_SPEED_KMH * 60), 3)
    return round(dist, 2), duration


def base_fare(vehicle_type: str, dist: float, duration: int) -> float:
    cfg = VEHICLE_PRICING[vehicle_type]
    return round(cfg["base"] + dist * cfg["per_km"] + duration * cfg["per_min"], 2)


def surcharge_for(pickup: dict) -> dict:
    km = haversine_km(pickup["lat"], pickup["lng"], CITY_CENTER["lat"], CITY_CENTER["lng"])
    km = round(km, 1)
    return {
        "distance_to_center_km": km,
        "per_km": SURCHARGE_PER_KM,
        "amount": round(km * SURCHARGE_PER_KM, 2),
        "center_name": CITY_CENTER["name"],
    }


def eta_minutes(from_lat, from_lng, to_lat, to_lng) -> int:
    dist = haversine_km(from_lat, from_lng, to_lat, to_lng)
    return max(int(round(dist / AVG_SPEED_KMH * 60)), 0)


# ---------- Auth helpers ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(pw: str, pw_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), pw_hash.encode("utf-8"))
    except Exception:
        return False


def make_token(user: dict) -> str:
    now = now_utc()
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


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
    if user.get("is_active") is False:
        raise HTTPException(403, "Compte désactivé par votre gestionnaire")
    return user


def require_role(*roles: str):
    async def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user
    return dep


# ---------- Notifications ----------
async def notify(user_id: Optional[str], type_: str, title: str, body: str, ride_id: Optional[str] = None, sms_phone: Optional[str] = None):
    if not user_id:
        return
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "type": type_,
        "title": title,
        "body": body,
        "ride_id": ride_id,
        "read": False,
        "created_at": now_utc(),
    }
    await db.notifications.insert_one(doc)
    if sms_phone:
        await send_sms(sms_phone, f"{title} – {body}")


async def send_sms(phone: str, text: str):
    """SMS gateway. Uses Twilio when credentials are configured, otherwise logs only."""
    import logging
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    sender = os.environ.get("TWILIO_FROM_NUMBER")
    if not (sid and token and sender):
        logging.getLogger("sms").info("SMS (non envoyé, Twilio non configuré) -> %s: %s", phone, text)
        return
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            await http.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={"To": phone, "From": sender, "Body": text},
                auth=(sid, token),
            )
    except Exception as e:  # never break the ride flow because of SMS
        logging.getLogger("sms").warning("SMS failed: %s", e)
