"""Geocoding via Photon (OpenStreetMap data, no API key)."""
import logging
from typing import List, Optional

import httpx

PHOTON = "https://photon.komoot.io"
log = logging.getLogger("geo")
HEADERS = {"User-Agent": "RideGo-VTC/1.0"}


def _format(f: dict) -> dict:
    p = f.get("properties", {})
    lng, lat = f["geometry"]["coordinates"]
    name = p.get("name") or " ".join(x for x in [p.get("housenumber"), p.get("street")] if x) or p.get("city") or "Adresse"
    parts = []
    street = " ".join(x for x in [p.get("housenumber"), p.get("street")] if x)
    if street and street != name:
        parts.append(street)
    loc = " ".join(x for x in [p.get("postcode"), p.get("city") or p.get("district") or p.get("county")] if x)
    if loc:
        parts.append(loc)
    if p.get("country"):
        parts.append(p["country"])
    address = ", ".join(parts) or name
    return {
        "id": f"{p.get('osm_type', 'N')}{p.get('osm_id', '')}",
        "name": name,
        "address": address,
        "lat": lat,
        "lng": lng,
        "city": p.get("city") or p.get("district") or p.get("county"),
        "country": p.get("country"),
    }


async def search(q: str, lat: Optional[float] = None, lng: Optional[float] = None, limit: int = 6) -> List[dict]:
    params = {"q": q, "limit": limit, "lang": "fr"}
    # Bias results towards the user's position, or Paris (our main market) when unknown – avoids "Ritz" → Finland.
    if lat is None or lng is None:
        lat, lng = 48.8566, 2.3522
    params.update({"lat": lat, "lon": lng, "zoom": 11, "location_bias_scale": 0.5})
    try:
        async with httpx.AsyncClient(timeout=6, headers=HEADERS) as http:
            r = await http.get(f"{PHOTON}/api/", params=params)
            r.raise_for_status()
            return [_format(f) for f in r.json().get("features", [])]
    except Exception as e:
        log.warning("geo search failed: %s", e)
        return []


async def reverse(lat: float, lng: float) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=6, headers=HEADERS) as http:
            r = await http.get(f"{PHOTON}/reverse", params={"lat": lat, "lon": lng, "lang": "fr"})
            r.raise_for_status()
            feats = r.json().get("features", [])
            return _format(feats[0]) if feats else None
    except Exception as e:
        log.warning("geo reverse failed: %s", e)
        return None


async def reverse_city(lat: float, lng: float) -> Optional[dict]:
    """Find the city containing a point and return its center {name, country, lat, lng}."""
    place = await reverse(lat, lng)
    if not place or not place.get("city"):
        return None
    q = f"{place['city']}, {place.get('country') or ''}".strip(", ")
    try:
        async with httpx.AsyncClient(timeout=6, headers=HEADERS) as http:
            r = await http.get(f"{PHOTON}/api/", params={"q": q, "limit": 5, "lang": "fr", "osm_tag": "place"})
            r.raise_for_status()
            for f in r.json().get("features", []):
                p = f.get("properties", {})
                if p.get("osm_value") in ("city", "town", "village", "municipality"):
                    lng2, lat2 = f["geometry"]["coordinates"]
                    return {"name": p.get("name") or place["city"], "country": p.get("country") or place.get("country"), "lat": lat2, "lng": lng2}
    except Exception as e:
        log.warning("geo city lookup failed: %s", e)
    return {"name": place["city"], "country": place.get("country"), "lat": lat, "lng": lng}
