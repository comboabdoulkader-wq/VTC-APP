"""Geocoding proxy + city-center moderation."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import geo
from core import current_user, db, new_id, now_utc
from models import CityIn, CityOut, CityUpdateIn

router = APIRouter(tags=["geo"])


@router.get("/geo/search")
async def geo_search(q: str = Query(min_length=2), lat: Optional[float] = None, lng: Optional[float] = None):
    return await geo.search(q, lat, lng)


@router.get("/geo/reverse")
async def geo_reverse(lat: float, lng: float):
    place = await geo.reverse(lat, lng)
    return place or {"id": "gps", "name": "Ma position", "address": f"{lat:.5f}, {lng:.5f}", "lat": lat, "lng": lng}


def moderator(user=Depends(current_user)):
    if not user.get("is_moderator"):
        raise HTTPException(403, "Réservé aux modérateurs")
    return user


@router.get("/admin/cities", response_model=List[CityOut])
async def list_cities(user=Depends(current_user)):
    return [CityOut(**c) async for c in db.cities.find({}, {"_id": 0}).sort("name", 1)]


@router.post("/admin/cities", response_model=CityOut)
async def create_city(data: CityIn, user=Depends(moderator)):
    doc = {"id": new_id(), "source": "moderator", "created_at": now_utc(), **data.model_dump()}
    await db.cities.insert_one(doc.copy())
    return CityOut(**doc)


@router.patch("/admin/cities/{city_id}", response_model=CityOut)
async def update_city(city_id: str, data: CityUpdateIn, user=Depends(moderator)):
    c = await db.cities.find_one({"id": city_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Ville introuvable")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    update["source"] = "moderator"
    update["updated_by"] = user["email"]
    await db.cities.update_one({"id": city_id}, {"$set": update})
    c.update(update)
    return CityOut(**c)


@router.delete("/admin/cities/{city_id}")
async def delete_city(city_id: str, user=Depends(moderator)):
    res = await db.cities.delete_one({"id": city_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Ville introuvable")
    return {"ok": True}


@router.get("/geo/route")
async def geo_route(from_lat: float, from_lng: float, to_lat: float, to_lng: float):
    """Driving route (OSRM public server) for the in-app travel plan."""
    import httpx
    url = f"https://router.project-osrm.org/route/v1/driving/{from_lng},{from_lat};{to_lng},{to_lat}"
    try:
        async with httpx.AsyncClient(timeout=8) as http:
            r = await http.get(url, params={"overview": "full", "geometries": "geojson", "steps": "false"})
            r.raise_for_status()
            route = r.json()["routes"][0]
            coords = [{"latitude": c[1], "longitude": c[0]} for c in route["geometry"]["coordinates"]]
            if len(coords) > 400:  # thin out for rendering
                step = len(coords) // 400 + 1
                coords = coords[::step] + [coords[-1]]
            return {"coords": coords, "distance_km": round(route["distance"] / 1000, 2), "duration_min": int(round(route["duration"] / 60))}
    except Exception:
        return {"coords": [{"latitude": from_lat, "longitude": from_lng}, {"latitude": to_lat, "longitude": to_lng}], "distance_km": None, "duration_min": None, "fallback": True}
