"""AviationStack flight tracking (server-side only, cached in Mongo) + monitoring loop for airport transfers."""
import logging
import os
import re
from datetime import timedelta
from typing import Optional

import httpx

from core import db, notify, now_utc

log = logging.getLogger("flights")
CACHE_TTL_MIN = 10
BASE_URL = "https://api.aviationstack.com/v1"


def api_key() -> Optional[str]:
    k = os.environ.get("AVIATIONSTACK_API_KEY", "").strip()
    return k or None


def configured() -> bool:
    return api_key() is not None


def normalize_flight(number: str) -> str:
    return re.sub(r"[\s-]", "", (number or "").upper())


def _summarize(item: dict, requested: str) -> dict:
    dep, arr = item.get("departure") or {}, item.get("arrival") or {}
    return {
        "number": (item.get("flight") or {}).get("iata") or requested,
        "airline": (item.get("airline") or {}).get("name"),
        "status": item.get("flight_status"),  # scheduled | active | landed | cancelled | incident | diverted
        "departure_airport": dep.get("airport"), "departure_iata": dep.get("iata"),
        "departure_scheduled": dep.get("scheduled"), "departure_delay_min": dep.get("delay"),
        "arrival_airport": arr.get("airport"), "arrival_iata": arr.get("iata"),
        "arrival_terminal": arr.get("terminal"), "arrival_gate": arr.get("gate"), "arrival_baggage": arr.get("baggage"),
        "arrival_scheduled": arr.get("scheduled"), "arrival_estimated": arr.get("estimated") or arr.get("scheduled"),
        "arrival_actual": arr.get("actual"), "arrival_delay_min": arr.get("delay"),
        "checked_at": now_utc(),
    }


async def lookup_flight(number: str, flight_date: Optional[str] = None) -> dict:
    """Return a flight summary. Raises ValueError (not found / bad input), RuntimeError (not configured / upstream)."""
    requested = normalize_flight(number)
    if not re.fullmatch(r"[A-Z0-9]{2,3}\d{1,4}[A-Z]?", requested):
        raise ValueError("Numéro de vol invalide (ex. AF1234)")
    if not configured():
        raise RuntimeError("Suivi de vol non configuré (clé AviationStack manquante)")
    key = f"{requested}:{flight_date or 'live'}"
    cached = await db.flight_cache.find_one({"key": key}, {"_id": 0})
    if cached and cached["expires_at"].replace(tzinfo=cached["expires_at"].tzinfo or now_utc().tzinfo) > now_utc():
        return {**cached["data"], "cached": True}
    params = {"access_key": api_key(), "flight_iata": requested, "limit": 5}
    if flight_date:
        params["flight_date"] = flight_date
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=httpx.Timeout(10.0, connect=5.0)) as http:
            res = await http.get("/flights", params=params)
        payload = res.json()
    except Exception as e:
        raise RuntimeError(f"Service de suivi de vol indisponible ({e.__class__.__name__})")
    if payload.get("error"):
        err = payload["error"]
        raise RuntimeError(f"AviationStack : {err.get('message') or err.get('code')}")
    items = payload.get("data") or []
    items = [i for i in items if normalize_flight((i.get("flight") or {}).get("iata") or "") == requested] or items
    if not items:
        raise ValueError("Vol introuvable – vérifiez le numéro (ex. AF1234) et la date")
    # Prefer the record that is still relevant (not landed yesterday)
    items.sort(key=lambda i: (i.get("flight_date") or ""), reverse=True)
    data = _summarize(items[0], requested)
    await db.flight_cache.replace_one({"key": key}, {"key": key, "data": data, "expires_at": now_utc() + timedelta(minutes=CACHE_TTL_MIN)}, upsert=True)
    return {**data, "cached": False}


def _fmt_delay(d: Optional[int]) -> str:
    if d is None:
        return "à l'heure (aucun retard publié)"
    return f"retard {d} min" if d > 0 else "à l'heure"


async def refresh_ride_flights():
    """Refresh flights of upcoming airport rides; alert driver + passenger when the delay changes (≥ 10 min) or the flight lands."""
    if not configured():
        return
    horizon = now_utc() + timedelta(hours=24)
    q = {"status": {"$in": ["requested", "accepted"]}, "flight.number": {"$exists": True},
         "$or": [{"scheduled_at": None}, {"scheduled_at": {"$lte": horizon}}]}
    async for r in db.rides.find(q, {"_id": 0}):
        try:
            f = await lookup_flight(r["flight"]["number"], r["flight"].get("date"))
        except Exception as e:
            log.info("flight refresh skipped for %s: %s", r["id"], e)
            continue
        prev = r["flight"]
        new = {**prev, **{k: v for k, v in f.items() if k != "cached"}}
        await db.rides.update_one({"id": r["id"]}, {"$set": {"flight": new}})
        old_delay, new_delay = prev.get("arrival_delay_min") or 0, new.get("arrival_delay_min") or 0
        landed = new.get("status") == "landed" and prev.get("status") != "landed"
        if abs(new_delay - old_delay) >= 10 or landed or (new.get("status") == "cancelled" and prev.get("status") != "cancelled"):
            what = "Vol atterri" if landed else "Vol annulé" if new.get("status") == "cancelled" else "Horaire de vol modifié"
            body = f"{new['number']} · {_fmt_delay(new.get('arrival_delay_min'))}" + (f" · terminal {new['arrival_terminal']}" if new.get("arrival_terminal") else "")
            await notify(r.get("driver_id"), "flight", what, body, r["id"])
            await notify(r.get("passenger_id"), "flight", f"{what} – votre chauffeur est informé", body, r["id"], sms=True)
