"""Service catalogue, fixed-price routes (moderator CRUD) and flight lookup."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

import os

from fastapi import File, Response, UploadFile

from catalog import CANCELLATION_POLICY, FAQ, LEGAL, SERVICE_LABELS, SERVICES, VEHICLES
from core import current_user, db, new_id, now_utc
from flights import configured as flights_configured, lookup_flight
from models import FixedRouteIn
from routes.geo_routes import moderator
from storage import get_object, put_object

PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _public_base() -> str:
    return os.environ.get("FRONTEND_URL", "").strip('"').rstrip("/")


async def vehicle_photo_overrides() -> dict:
    doc = await db.settings.find_one({"key": "vehicle_photos"}, {"_id": 0})
    return (doc or {}).get("photos", {})

router = APIRouter(tags=["booking"])


@router.get("/catalog")
async def catalog(lang: str = "fr"):
    photos = await vehicle_photo_overrides()
    base = _public_base()
    vehicles = []
    for k, v in VEHICLES.items():
        img = f"{base}/api/vehicle-photos/{photos[k]}" if photos.get(k) else v["image_url"]
        vehicles.append({"key": k, **v, "image_url": img, "custom_photo": bool(photos.get(k))})
    services = []
    for k, v in SERVICES.items():
        label = v["label"] if lang == "fr" else SERVICE_LABELS[k].get(lang, v["label_en"])
        services.append({"key": k, **v, "label": label, "labels": {"fr": v["label"], **SERVICE_LABELS[k]}})
    return {
        "services": services,
        "vehicles": vehicles,
        "cancellation_policy": CANCELLATION_POLICY,
        "flight_tracking": flights_configured(),
    }


@router.get("/fixed-routes")
async def list_fixed_routes(all: bool = False, user=Depends(current_user)):
    q = {} if (all and user.get("is_moderator")) else {"active": True}
    return [r async for r in db.fixed_routes.find(q, {"_id": 0}).sort("name", 1)]


@router.post("/admin/fixed-routes", status_code=201)
async def create_fixed_route(data: FixedRouteIn, user=Depends(moderator)):
    _check_prices(data.prices)
    doc = {"id": new_id(), **data.model_dump(), "created_at": now_utc(), "created_by": user["id"]}
    await db.fixed_routes.insert_one(doc.copy())
    return doc


@router.patch("/admin/fixed-routes/{route_id}")
async def update_fixed_route(route_id: str, data: FixedRouteIn, user=Depends(moderator)):
    _check_prices(data.prices)
    res = await db.fixed_routes.update_one({"id": route_id}, {"$set": {**data.model_dump(), "updated_at": now_utc()}})
    if not res.matched_count:
        raise HTTPException(404, "Trajet introuvable")
    return await db.fixed_routes.find_one({"id": route_id}, {"_id": 0})


@router.delete("/admin/fixed-routes/{route_id}")
async def delete_fixed_route(route_id: str, user=Depends(moderator)):
    res = await db.fixed_routes.delete_one({"id": route_id})
    if not res.deleted_count:
        raise HTTPException(404, "Trajet introuvable")
    return {"ok": True}


def _check_prices(prices: dict):
    bad = [k for k in prices if k not in VEHICLES]
    if bad or not prices:
        raise HTTPException(422, f"Catégories de véhicule invalides : {', '.join(bad) or 'aucun prix'}")
    if any(p <= 0 for p in prices.values()):
        raise HTTPException(422, "Les prix doivent être positifs")


@router.get("/flights/{number}")
async def flight_status(number: str, date: Optional[str] = None, user=Depends(current_user)):
    try:
        return await lookup_flight(number, date)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))


# ---- Vehicle photos (moderator upload, public read) ----
@router.post("/admin/vehicles/{vehicle_type}/photo")
async def upload_vehicle_photo(vehicle_type: str, file: UploadFile = File(...), user=Depends(moderator)):
    if vehicle_type not in VEHICLES:
        raise HTTPException(404, "Catégorie inconnue")
    ct = (file.content_type or "").split(";")[0]
    if ct not in PHOTO_TYPES:
        raise HTTPException(415, "Format accepté : JPG, PNG ou WEBP")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Photo trop volumineuse (5 Mo max)")
    path = f"vehicles/{vehicle_type}-{new_id()}.{PHOTO_TYPES[ct]}"
    try:
        await put_object(path, data, ct)
    except Exception:
        raise HTTPException(502, "Stockage indisponible, réessayez")
    await db.settings.update_one({"key": "vehicle_photos"}, {"$set": {f"photos.{vehicle_type}": path, "updated_at": now_utc()}}, upsert=True)
    return {"ok": True, "image_url": f"{_public_base()}/api/vehicle-photos/{path}"}


@router.delete("/admin/vehicles/{vehicle_type}/photo")
async def reset_vehicle_photo(vehicle_type: str, user=Depends(moderator)):
    await db.settings.update_one({"key": "vehicle_photos"}, {"$unset": {f"photos.{vehicle_type}": ""}})
    return {"ok": True}


@router.get("/vehicle-photos/{path:path}")
async def vehicle_photo(path: str):
    photos = await vehicle_photo_overrides()
    if path not in photos.values():
        raise HTTPException(404, "Photo introuvable")
    try:
        content, ct = await get_object(path)
    except Exception:
        raise HTTPException(502, "Photo indisponible")
    return Response(content=content, media_type=ct, headers={"Cache-Control": "public, max-age=86400"})


# ---- Support & FAQ ----
@router.get("/support/config")
async def support_config(lang: str = "fr"):
    faq = FAQ.get(lang) or FAQ["en"]
    return {
        "company_name": os.environ.get("COMPANY_NAME", "RideGo"),
        "whatsapp": os.environ.get("SUPPORT_WHATSAPP", ""),
        "email": os.environ.get("SUPPORT_EMAIL", ""),
        "phone": os.environ.get("SUPPORT_PHONE", ""),
        "hours": os.environ.get("SUPPORT_HOURS", "7j/7 · 6h–23h"),
        "languages": ["fr", "en", "es", "ar", "zh", "pt"],
        "faq": [{"q": q, "a": a} for q, a in faq],
    }


@router.get("/legal")
async def legal(lang: str = "fr"):
    pages = LEGAL.get(lang) or LEGAL["en"]
    company = os.environ.get("COMPANY_NAME", "RideGo")
    email = os.environ.get("SUPPORT_EMAIL") or "support@ridego.app"
    fill = lambda t: t.replace("{company}", company).replace("{email}", email)
    return {
        "company_name": company, "email": email, "updated_at": "2026-06-01",
        "pages": {k: {"title": v[0], "sections": [{"heading": h, "text": fill(t)} for h, t in v[1]]} for k, v in pages.items()},
    }
