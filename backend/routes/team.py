"""Team management: a driver (manager) can create and supervise other drivers."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core import db, hash_password, new_id, notify, now_utc, require_role, send_tracking_link
from models import AssignIn, RideOut, TeamMemberIn, TeamMemberOut, TeamMemberUpdateIn
from serializers import ride_to_out, user_to_out

router = APIRouter(prefix="/team", tags=["team"])
driver_only = require_role("driver")


async def member_stats(member: dict) -> TeamMemberOut:
    gross = commission = 0.0
    count = 0
    async for r in db.rides.find({"driver_id": member["id"], "status": "completed"}, {"_id": 0, "price": 1, "tip": 1, "commission_amount": 1}):
        gross += r.get("price", 0) + (r.get("tip") or 0)
        commission += r.get("commission_amount", 0)
        count += 1
    active = await db.rides.find_one({"driver_id": member["id"], "status": {"$in": ["accepted", "in_progress"]}}, {"_id": 0, "id": 1, "status": 1})
    return TeamMemberOut(
        **user_to_out(member).model_dump(),
        completed_rides=count, gross=round(gross, 2), commission=round(commission, 2),
        net=round(gross - commission, 2),
        active_ride_id=active["id"] if active else None,
        active_ride_status=active["status"] if active else None,
    )


async def get_member(manager_id: str, member_id: str) -> dict:
    m = await db.users.find_one({"id": member_id, "manager_id": manager_id}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Chauffeur introuvable dans votre équipe")
    return m


@router.get("/members", response_model=List[TeamMemberOut])
async def list_members(user=Depends(driver_only)):
    cursor = db.users.find({"manager_id": user["id"]}, {"_id": 0}).sort("created_at", 1)
    return [await member_stats(m) async for m in cursor]


@router.post("/members", response_model=TeamMemberOut)
async def add_member(data: TeamMemberIn, user=Depends(driver_only)):
    if user.get("manager_id"):
        raise HTTPException(403, "Un membre d'équipe ne peut pas gérer sa propre équipe")
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email déjà enregistré")
    member = {
        "id": new_id(), "email": email, "password_hash": hash_password(data.password),
        "full_name": data.full_name, "role": "driver", "phone": data.phone,
        "vehicle_model": data.vehicle_model, "license_plate": data.license_plate,
        "rating": 5.0, "total_rides": 0, "is_online": False, "is_active": True, "docs_blocked": True,
        "manager_id": user["id"], "manager_name": user["full_name"], "created_at": now_utc(),
    }
    await db.users.insert_one(member.copy())
    return await member_stats(member)


@router.patch("/members/{member_id}", response_model=TeamMemberOut)
async def update_member(member_id: str, data: TeamMemberUpdateIn, user=Depends(driver_only)):
    m = await get_member(user["id"], member_id)
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update.get("is_active") is False:
        update["is_online"] = False
    if update:
        await db.users.update_one({"id": member_id}, {"$set": update})
        m.update(update)
    return await member_stats(m)


@router.delete("/members/{member_id}")
async def remove_member(member_id: str, user=Depends(driver_only)):
    await get_member(user["id"], member_id)
    await db.users.update_one({"id": member_id}, {"$set": {"manager_id": None, "manager_name": None}})
    return {"ok": True}


@router.get("/members/{member_id}/rides", response_model=List[RideOut])
async def member_rides(member_id: str, user=Depends(driver_only)):
    await get_member(user["id"], member_id)
    cursor = db.rides.find({"driver_id": member_id}, {"_id": 0}).sort("created_at", -1).limit(50)
    return [ride_to_out(r) async for r in cursor]


@router.get("/rides", response_model=List[RideOut])
async def team_rides(user=Depends(driver_only)):
    """All rides of the team (manager + members), most recent first."""
    ids = [user["id"]] + [m["id"] async for m in db.users.find({"manager_id": user["id"]}, {"_id": 0, "id": 1})]
    cursor = db.rides.find({"driver_id": {"$in": ids}}, {"_id": 0}).sort("created_at", -1).limit(100)
    return [ride_to_out(r) async for r in cursor]


@router.post("/assign", response_model=RideOut)
async def assign_ride(data: AssignIn, user=Depends(driver_only)):
    """Manager assigns an open ride request directly to one of their drivers."""
    m = await get_member(user["id"], data.driver_id)
    if not m.get("is_active", True):
        raise HTTPException(409, "Ce chauffeur est désactivé")
    r = await db.rides.find_one({"id": data.ride_id}, {"_id": 0})
    if not r or r["status"] != "requested":
        raise HTTPException(409, "Course non disponible")
    busy = await db.rides.find_one({"driver_id": m["id"], "status": {"$in": ["accepted", "in_progress"]}})
    if busy:
        raise HTTPException(409, "Ce chauffeur a déjà une course en cours")
    update = {
        "status": "accepted", "accepted_at": now_utc(),
        "driver_id": m["id"], "driver_name": m["full_name"],
        "driver_vehicle": m.get("vehicle_model") or "Véhicule", "driver_plate": m.get("license_plate") or "N/A",
        "driver_rating": m.get("rating", 5.0), "driver_has_photo": bool(m.get("photo_path")), "manager_id": user["id"],
        "assigned_by": user["id"], "assigned_by_name": user["full_name"],
    }
    await db.rides.update_one({"id": r["id"]}, {"$set": update})
    r.update(update)
    await notify(m["id"], "assigned", "Nouvelle course affectée",
                 f"{user['full_name']} vous a affecté : {r['pickup']['address']} → {r['dropoff']['address']}", r["id"])
    await notify(r.get("passenger_id"), "accepted", "Chauffeur trouvé",
                 f"{m['full_name']} arrive avec {update['driver_vehicle']} ({update['driver_plate']})", r["id"], sms=True)
    await send_tracking_link(r)
    return ride_to_out(r)


@router.get("/overview")
async def overview(user=Depends(driver_only)):
    members = [await member_stats(m) async for m in db.users.find({"manager_id": user["id"]}, {"_id": 0})]
    return {
        "members_count": len(members),
        "online_count": sum(1 for m in members if m.is_online),
        "active_count": sum(1 for m in members if m.active_ride_id),
        "gross": round(sum(m.gross for m in members), 2),
        "commission": round(sum(m.commission for m in members), 2),
        "net": round(sum(m.net for m in members), 2),
        "completed_rides": sum(m.completed_rides for m in members),
    }


# ---------- Accounting exports ----------
from fastapi import Query  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from reports import build_csv, build_pdf, group_rides, month_label, rides_for  # noqa: E402


async def team_query(user: dict) -> dict:
    ids = [user["id"]] + [m["id"] async for m in db.users.find({"manager_id": user["id"]}, {"_id": 0, "id": 1})]
    return {"driver_id": {"$in": ids}}


@router.get("/invoices")
async def invoices(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(driver_only)):
    rides = await rides_for(await team_query(user), month)
    groups = group_rides(rides, "driver_id", "driver_name")
    return {
        "month": month, "label": month_label(month), "count": len(rides),
        "gross": round(sum(g["gross"] for g in groups), 2), "commission": round(sum(g["commission"] for g in groups), 2),
        "net": round(sum(g["net"] for g in groups), 2),
        "groups": [{k: v for k, v in g.items() if k != "rides"} for g in groups],
    }


@router.get("/export.csv")
async def export_csv(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(driver_only)):
    rides = await rides_for(await team_query(user), month)
    return Response(build_csv(rides), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="courses-{month}.csv"'})


@router.get("/export.pdf")
async def export_pdf(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(driver_only)):
    rides = await rides_for(await team_query(user), month)
    pdf = build_pdf(f"Relevé mensuel — {user['full_name']}", f"Période : {month_label(month)} · {len(rides)} course(s) · commissions 15 % sur courses privées",
                    group_rides(rides, "driver_id", "driver_name"), "chauffeur")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="releve-{month}.pdf"'})
