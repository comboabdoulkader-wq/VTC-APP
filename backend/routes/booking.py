"""Service catalogue, fixed-price routes (moderator CRUD) and flight lookup."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from catalog import CANCELLATION_POLICY, SERVICES, VEHICLES
from core import current_user, db, new_id, now_utc
from flights import configured as flights_configured, lookup_flight
from models import FixedRouteIn
from routes.geo_routes import moderator

router = APIRouter(tags=["booking"])


@router.get("/catalog")
async def catalog():
    return {
        "services": [{"key": k, **v} for k, v in SERVICES.items()],
        "vehicles": [{"key": k, **v} for k, v in VEHICLES.items()],
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
