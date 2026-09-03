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
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-super-long-key-vtc-app-2026")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 24 * 7
MODERATOR_EMAILS = {e.strip().lower() for e in os.environ.get("MODERATOR_EMAILS", "chauffeur@test.com,passager@test.com").split(",") if e.strip()}

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
security = HTTPBearer(auto_error=False)

# ---------- Business rules ----------
CITY_CENTER = {"lat": 48.8583, "lng": 2.3477, "name": "Paris – Châtelet"}
SURCHARGE_PER_KM = 1.20
PRIVATE_COMMISSION_RATE = 0.15
ARRIVAL_ALERT_MIN = 2
REMINDER_MIN = 45
AVG_SPEED_KMH = 24.0
CITY_MATCH_RADIUS_KM = 60.0

# Default world city centers (moderators can adjust / add via /admin/cities)
DEFAULT_CITIES = [
    ("Paris", "France", 48.8583, 2.3477), ("Lyon", "France", 45.7640, 4.8357), ("Marseille", "France", 43.2965, 5.3698),
    ("Toulouse", "France", 43.6045, 1.4440), ("Nice", "France", 43.7102, 7.2620), ("Bordeaux", "France", 44.8378, -0.5792),
    ("Lille", "France", 50.6292, 3.0573), ("Nantes", "France", 47.2184, -1.5536), ("Strasbourg", "France", 48.5734, 7.7521),
    ("Bruxelles", "Belgique", 50.8467, 4.3525), ("Genève", "Suisse", 46.2044, 6.1432), ("Londres", "Royaume-Uni", 51.5074, -0.1278),
    ("Madrid", "Espagne", 40.4168, -3.7038), ("Barcelone", "Espagne", 41.3874, 2.1686), ("Rome", "Italie", 41.9028, 12.4964),
    ("Milan", "Italie", 45.4642, 9.1900), ("Berlin", "Allemagne", 52.5200, 13.4050), ("Amsterdam", "Pays-Bas", 52.3676, 4.9041),
    ("Lisbonne", "Portugal", 38.7223, -9.1393), ("Casablanca", "Maroc", 33.5731, -7.5898), ("Alger", "Algérie", 36.7538, 3.0588),
    ("Tunis", "Tunisie", 36.8065, 10.1815), ("Dakar", "Sénégal", 14.7167, -17.4677), ("Abidjan", "Côte d'Ivoire", 5.3600, -4.0083),
    ("Montréal", "Canada", 45.5017, -73.5673), ("New York", "États-Unis", 40.7128, -74.0060), ("Dubaï", "Émirats", 25.2048, 55.2708),
    ("Istanbul", "Turquie", 41.0082, 28.9784), ("Tokyo", "Japon", 35.6762, 139.6503), ("Sydney", "Australie", -33.8688, 151.2093),
]

VEHICLE_PRICING = {
    "standard": {"base": 3.0, "per_km": 1.5, "per_min": 0.3, "label": "Berline", "eta": 3},
    "premium": {"base": 5.0, "per_km": 2.5, "per_min": 0.5, "label": "Business Class", "eta": 5},
    "van": {"base": 6.0, "per_km": 2.0, "per_min": 0.4, "label": "Van", "eta": 7},
    "van_premium": {"base": 9.0, "per_km": 2.9, "per_min": 0.6, "label": "Van Premium", "eta": 10},
    "group": {"base": 15.0, "per_km": 3.4, "per_min": 0.7, "label": "Minibus Groupe", "eta": 20},
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


async def seed_cities():
    if await db.cities.count_documents({}) == 0:
        await db.cities.insert_many([
            {"id": new_id(), "name": n, "country": c, "lat": la, "lng": ln, "source": "default", "created_at": now_utc()}
            for n, c, la, ln in DEFAULT_CITIES
        ])


async def nearest_city(lat: float, lng: float) -> Optional[dict]:
    best, best_d = None, None
    async for c in db.cities.find({}, {"_id": 0}):
        d = haversine_km(lat, lng, c["lat"], c["lng"])
        if best_d is None or d < best_d:
            best, best_d = c, d
    if best and best_d <= CITY_MATCH_RADIUS_KM:
        return best
    # Unknown area: discover the city via reverse geocoding and remember its center
    from geo import reverse_city
    found = await reverse_city(lat, lng)
    if found:
        doc = {"id": new_id(), "source": "auto", "created_at": now_utc(), **found}
        await db.cities.insert_one(doc.copy())
        return doc
    return best


async def surcharge_for(pickup: dict) -> dict:
    city = await nearest_city(pickup["lat"], pickup["lng"])
    center = city or {"lat": CITY_CENTER["lat"], "lng": CITY_CENTER["lng"], "name": "Paris", "country": "France"}
    km = round(haversine_km(pickup["lat"], pickup["lng"], center["lat"], center["lng"]), 1)
    return {
        "distance_to_center_km": km,
        "per_km": SURCHARGE_PER_KM,
        "amount": round(km * SURCHARGE_PER_KM, 2),
        "center_name": f"{center['name']} – centre-ville",
        "city_id": center.get("id"),
        "city_name": center.get("name"),
        "price_multiplier": float(center.get("price_multiplier") or 1.0),
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
    request: Request,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(security)],
) -> dict:
    raw = credentials.credentials if credentials and credentials.scheme.lower() == "bearer" else request.query_params.get("token")
    if not raw:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(raw, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    if user.get("is_active") is False:
        raise HTTPException(403, "Compte désactivé par votre gestionnaire")
    if user.get("company_active") is False:
        user["company_id"] = None
    user["is_moderator"] = user["email"] in MODERATOR_EMAILS
    return user


def require_role(*roles: str):
    async def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Forbidden")
        return user
    return dep


BLOCKED_DRIVER_MESSAGE = "Votre compte est temporairement bloqué car un ou plusieurs documents obligatoires ont expiré. Merci de les mettre à jour pour réactiver votre compte."


async def working_driver(user=Depends(current_user)) -> dict:
    """Driver allowed to work: not blocked by expired/missing mandatory documents."""
    if user["role"] != "driver":
        raise HTTPException(403, "Forbidden")
    if user.get("docs_blocked"):
        raise HTTPException(423, BLOCKED_DRIVER_MESSAGE)
    return user


# ---------- Rate limiting (in-memory, per process) ----------
_RATE: dict[str, list[float]] = {}


def rate_limit(key: str, limit: int, window_sec: int, message: str = "Trop de tentatives, réessayez plus tard"):
    """Sliding-window limiter. Raises 429 when `limit` calls were made for `key` within `window_sec`."""
    import time
    now = time.time()
    hits = [t for t in _RATE.get(key, []) if now - t < window_sec]
    if len(hits) >= limit:
        raise HTTPException(429, message)
    hits.append(now)
    _RATE[key] = hits
    if len(_RATE) > 20000:  # keep memory bounded
        for k in [k for k, v in _RATE.items() if not v or now - v[-1] > window_sec]:
            _RATE.pop(k, None)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?"))


# ---------- Phone / SMS (Twilio) ----------
DEFAULT_COUNTRY_CODE = os.environ.get("DEFAULT_COUNTRY_CODE", "+33")


def normalize_phone(raw: str) -> Optional[str]:
    """Return an E.164 number (+33612345678) or None when the input is not a plausible phone number."""
    import re
    s = re.sub(r"[\s().-]", "", raw or "")
    if s.startswith("00"):
        s = "+" + s[2:]
    if s.startswith("0") and len(s) >= 9:
        s = DEFAULT_COUNTRY_CODE + s[1:]
    if not re.fullmatch(r"\+[1-9]\d{7,14}", s):
        return None
    return s


def sms_configured() -> bool:
    return bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN") and os.environ.get("TWILIO_FROM_NUMBER"))


async def send_sms(phone: str, text: str) -> bool:
    """SMS gateway. Uses Twilio when credentials are configured, otherwise logs only. Returns True when delivered to Twilio."""
    import logging
    log = logging.getLogger("sms")
    if not sms_configured():
        log.info("SMS (non envoyé, Twilio non configuré) -> %s: %s", phone, text)
        return False
    sid, token, sender = os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"], os.environ["TWILIO_FROM_NUMBER"]
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            res = await http.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={"To": phone, "From": sender, "Body": text},
                auth=(sid, token),
            )
        if res.status_code >= 400:
            log.warning("Twilio error %s: %s", res.status_code, res.text[:200])
            return False
        await db.sms_log.insert_one({"id": new_id(), "to": phone, "sid": res.json().get("sid"), "created_at": now_utc()})
        return True
    except Exception as e:  # never break the ride flow because of SMS
        log.warning("SMS failed: %s", e)
        return False


# ---------- Notifications ----------
async def notify(user_id: Optional[str], type_: str, title: str, body: str, ride_id: Optional[str] = None,
                 sms_phone: Optional[str] = None, sms: bool = False):
    """In-app notification. `sms=True` also texts the user if their number is verified and SMS alerts are enabled.
    `sms_phone` texts an arbitrary number (e.g. private-ride client who has no account)."""
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
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "role": 1, "phone": 1, "phone_verified": 1, "sms_enabled": 1})
    # Push notification (works on native builds; silently skipped when the relay is unavailable)
    from push import push_safe
    role = (u or {}).get("role")
    action_url = f"/(passenger)/ride/{ride_id}" if role == "passenger" and ride_id else f"/({role})" if role in ("driver", "company") else None
    await push_safe([user_id], title, body, action_url, idempotency_key=doc["id"])
    text = f"RideGo · {title} – {body}"
    if sms:
        if u and u.get("phone_verified") and u.get("sms_enabled", True) and u.get("phone"):
            await send_sms(u["phone"], text)
    elif sms_phone:
        p = normalize_phone(sms_phone)
        if p:
            await send_sms(p, text)


def tracking_url(ride: dict) -> Optional[str]:
    base = os.environ.get("FRONTEND_URL", "").strip('"').rstrip("/")
    return f"{base}/track/{ride['share_token']}" if base and ride.get("share_token") else None


async def send_tracking_link(ride: dict):
    """SMS the passenger a live tracking link once a driver is assigned (verified phone + SMS alerts enabled)."""
    url = tracking_url(ride)
    if not url or not ride.get("passenger_id"):
        return
    u = await db.users.find_one({"id": ride["passenger_id"]}, {"_id": 0, "phone": 1, "phone_verified": 1, "sms_enabled": 1})
    if u and u.get("phone_verified") and u.get("sms_enabled", True) and u.get("phone"):
        await send_sms(u["phone"], f"RideGo · {ride.get('driver_name', 'Votre chauffeur')} arrive ({ride.get('driver_vehicle', '')} {ride.get('driver_plate', '')}). Suivez-le en direct : {url}")
