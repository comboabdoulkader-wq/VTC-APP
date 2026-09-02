"""Business accounts: a company invites employees and controls their ride budgets."""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from core import current_user, db, now_utc, require_role
from models import EmployeeOut, EmployeeUpdateIn, JoinCompanyIn, RideOut
from reports import build_csv, build_pdf, group_rides, month_label, rides_for
from serializers import ride_to_out, user_to_out

router = APIRouter(prefix="/company", tags=["company"])
company_only = require_role("company")


def period_start(period: Optional[str]) -> datetime:
    now = now_utc()
    if period == "day":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "week":
        start = now - timedelta(days=now.weekday())
        return start.replace(hour=0, minute=0, second=0, microsecond=0)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def spent_since(employee: dict) -> float:
    q = {"passenger_id": employee["id"], "business": True, "status": {"$ne": "cancelled"}, "created_at": {"$gte": period_start(employee.get("budget_period"))}}
    total = 0.0
    async for r in db.rides.find(q, {"_id": 0, "price": 1}):
        total += r.get("price", 0)
    return round(total, 2)


async def remaining_budget(employee: dict) -> Optional[float]:
    if employee.get("budget_amount") is None:
        return None
    return round(employee["budget_amount"] - await spent_since(employee), 2)


async def employee_out(e: dict) -> EmployeeOut:
    spent = await spent_since(e)
    count = await db.rides.count_documents({"passenger_id": e["id"], "business": True, "status": {"$ne": "cancelled"}})
    remaining = None if e.get("budget_amount") is None else round(e["budget_amount"] - spent, 2)
    return EmployeeOut(**user_to_out(e).model_dump(), spent=spent, remaining=remaining, rides_count=count)


# ---- Passenger side ----
@router.post("/join")
async def join_company(data: JoinCompanyIn, user=Depends(require_role("passenger"))):
    company = await db.users.find_one({"role": "company", "invite_code": data.code.strip().upper()}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Code d'invitation invalide")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "company_id": company["id"], "company_name": company["company_name"], "company_active": True,
        "budget_amount": None, "budget_period": "month", "joined_company_at": now_utc(),
    }})
    return {"ok": True, "company_name": company["company_name"]}


@router.post("/leave")
async def leave_company(user=Depends(require_role("passenger"))):
    await db.users.update_one({"id": user["id"]}, {"$set": {"company_id": None, "company_name": None, "company_active": None, "budget_amount": None, "budget_period": None}})
    return {"ok": True}


@router.get("/my-budget")
async def my_budget(user=Depends(require_role("passenger"))):
    raw = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not raw.get("company_id"):
        return {"company": None}
    spent = await spent_since(raw)
    return {
        "company": raw.get("company_name"), "active": raw.get("company_active", True),
        "budget_amount": raw.get("budget_amount"), "budget_period": raw.get("budget_period", "month"),
        "spent": spent, "remaining": None if raw.get("budget_amount") is None else round(raw["budget_amount"] - spent, 2),
    }


# ---- Company side ----
@router.get("/employees", response_model=List[EmployeeOut])
async def employees(user=Depends(company_only)):
    return [await employee_out(e) async for e in db.users.find({"company_id": user["id"]}, {"_id": 0}).sort("full_name", 1)]


@router.patch("/employees/{emp_id}", response_model=EmployeeOut)
async def update_employee(emp_id: str, data: EmployeeUpdateIn, user=Depends(company_only)):
    e = await db.users.find_one({"id": emp_id, "company_id": user["id"]}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Employé introuvable")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        await db.users.update_one({"id": emp_id}, {"$set": update})
        e.update(update)
    return await employee_out(e)


@router.delete("/employees/{emp_id}")
async def remove_employee(emp_id: str, user=Depends(company_only)):
    res = await db.users.update_one({"id": emp_id, "company_id": user["id"]}, {"$set": {"company_id": None, "company_name": None, "company_active": None, "budget_amount": None}})
    if res.matched_count == 0:
        raise HTTPException(404, "Employé introuvable")
    return {"ok": True}


@router.get("/rides", response_model=List[RideOut])
async def company_rides(month: Optional[str] = None, user=Depends(company_only)):
    q = {"company_id": user["id"], "business": True}
    if month:
        from reports import month_bounds
        start, end = month_bounds(month)
        q["created_at"] = {"$gte": start, "$lt": end}
    return [ride_to_out(r) async for r in db.rides.find(q, {"_id": 0}).sort("created_at", -1).limit(200)]


@router.get("/overview")
async def overview(user=Depends(company_only)):
    emps = [e async for e in db.users.find({"company_id": user["id"]}, {"_id": 0})]
    month_start = period_start("month")
    spent_month = 0.0
    async for r in db.rides.find({"company_id": user["id"], "business": True, "status": {"$ne": "cancelled"}, "created_at": {"$gte": month_start}}, {"_id": 0, "price": 1}):
        spent_month += r.get("price", 0)
    active = await db.rides.count_documents({"company_id": user["id"], "business": True, "status": {"$in": ["requested", "accepted", "in_progress"]}})
    budget_total = sum(e.get("budget_amount") or 0 for e in emps)
    return {
        "employees_count": len(emps), "active_employees": sum(1 for e in emps if e.get("company_active", True)),
        "spent_month": round(spent_month, 2), "budget_total": round(budget_total, 2), "active_rides": active,
        "invite_code": user.get("invite_code"), "company_name": user.get("company_name"),
    }


@router.get("/report")
async def report(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(company_only)):
    rides = await rides_for({"company_id": user["id"], "business": True}, month)
    groups = group_rides(rides, "passenger_id", "passenger_name")
    return {"month": month, "label": month_label(month), "count": len(rides), "total": round(sum(r["price"] for r in rides), 2),
            "groups": [{k: v for k, v in g.items() if k != "rides"} for g in groups]}


@router.get("/export.csv")
async def export_csv(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(company_only)):
    rides = await rides_for({"company_id": user["id"], "business": True}, month)
    return Response(build_csv(rides), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="courses-pro-{month}.csv"'})


@router.get("/export.pdf")
async def export_pdf(month: str = Query(pattern=r"^\d{4}-\d{2}$"), user=Depends(company_only)):
    rides = await rides_for({"company_id": user["id"], "business": True}, month)
    pdf = build_pdf(f"Relevé de courses professionnelles — {user.get('company_name')}", f"Période : {month_label(month)} · {len(rides)} course(s)",
                    group_rides(rides, "passenger_id", "passenger_name"), "employé")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="releve-pro-{month}.pdf"'})
