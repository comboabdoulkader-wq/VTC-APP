"""Business accounts: a company invites employees and controls their ride budgets."""
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from core import current_user, db, new_id, now_utc, require_role
from models import PartnerBookingIn, EmployeeOut, EmployeeUpdateIn, GuestIn, JoinCompanyIn, PayoutIn, PayoutDecisionIn, RideOut
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
async def report(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(company_only)):
    rides = await rides_for({"company_id": user["id"], "business": True}, month)
    groups = group_rides(rides, "passenger_id", "passenger_name")
    return {"month": month, "label": month_label(month), "count": len(rides), "total": round(sum(r["price"] for r in rides), 2),
            "groups": [{k: v for k, v in g.items() if k != "rides"} for g in groups]}


@router.get("/export.csv")
async def export_csv(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(company_only)):
    rides = await rides_for({"company_id": user["id"], "business": True}, month)
    return Response(build_csv(rides), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="courses-pro-{month}.csv"'})


@router.get("/export.pdf")
async def export_pdf(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(company_only)):
    rides = await rides_for({"company_id": user["id"], "business": True}, month)
    pdf = build_pdf(f"Relevé de courses professionnelles — {user.get('company_name')}", f"Période : {month_label(month)} · {len(rides)} course(s)",
                    group_rides(rides, "passenger_id", "passenger_name"), "employé")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="releve-pro-{month}.pdf"'})


# ---------- Partner space (hotels, concierges, agencies): book & follow rides for guests ----------
@router.post("/bookings", response_model=RideOut, status_code=201)
async def create_partner_booking(data: PartnerBookingIn, user=Depends(company_only)):
    from routes.rides import build_ride, push_new_rides_to_drivers
    from core import normalize_phone, send_sms, tracking_url
    from models import RideCreateIn
    phone = None
    if data.guest_phone and data.guest_phone.strip():
        phone = normalize_phone(data.guest_phone)
        if not phone:
            raise HTTPException(422, "Téléphone du client invalide (format +33 6 12 34 56 78)")
    label = f"{data.guest_name.strip()}" + (f" · ch. {data.room.strip()}" if data.room and data.room.strip() else "")
    ride_in = RideCreateIn(**data.model_dump(exclude={"guest_name", "guest_phone", "room", "notes"}), for_other=True,
                           passenger_label=label, notes=data.notes, payment_method="cash", business=False)
    ride = await build_ride(ride_in, user)
    discount = float(user.get("partner_discount") or 0)
    partner_discount_amount = round(ride["price"] * discount, 2) if discount else 0.0
    ride.update({
        "business": True, "company_id": user["id"], "partner_booking": True, "partner_name": user.get("company_name"),
        "passenger_phone": phone, "guest_name": data.guest_name.strip(), "room": (data.room or "").strip() or None,
        "partner_discount": discount, "partner_discount_amount": partner_discount_amount,
        "price": round(ride["price"] - partner_discount_amount, 2), "due_amount": round(ride["price"] - partner_discount_amount, 2),
        "payment_status": "invoiced",  # settled on the partner's monthly invoice
    })
    await db.rides.insert_one(ride.copy())
    await push_new_rides_to_drivers([ride])
    await upsert_partner_guest(user["id"], data.guest_name.strip(), phone, (data.room or "").strip() or None, data.vehicle_type, booked=True)
    if phone:
        # Remember this guest so that, if they create their own account later with the same number,
        # the partner becomes their sponsor and keeps earning cascading commissions on future rides.
        await db.partner_leads.update_one({"phone": phone}, {"$set": {
            "phone": phone, "sponsor_id": user["id"], "partner_name": user.get("company_name"), "updated_at": now_utc(),
        }}, upsert=True)
        when = ride["scheduled_at"].strftime("%d/%m à %H:%M") if ride.get("scheduled_at") else "dès maintenant"
        url = tracking_url(ride)
        await send_sms(phone, f"RideGo · {user.get('company_name')} vous a réservé un chauffeur ({when}) : {ride['pickup']['address']} → {ride['dropoff']['address']}."
                              + (f" Suivi : {url}" if url else ""))
    return ride_to_out(ride)


@router.get("/bookings", response_model=List[RideOut])
async def partner_bookings(status: Optional[str] = None, user=Depends(company_only)):
    q = {"company_id": user["id"], "partner_booking": True}
    if status == "active":
        q["status"] = {"$in": ["requested", "accepted", "in_progress"]}
    elif status:
        q["status"] = status
    return [ride_to_out(r) async for r in db.rides.find(q, {"_id": 0}).sort("created_at", -1).limit(200)]


@router.get("/partner")
async def partner_info(user=Depends(company_only)):
    from core import tracking_url
    from routes.referral import partner_tier_info
    active = [r async for r in db.rides.find({"company_id": user["id"], "partner_booking": True, "status": {"$in": ["requested", "accepted", "in_progress"]}}, {"_id": 0})]
    tier = await partner_tier_info(user["id"])
    return {
        "partner_type": user.get("partner_type", "company"), "partner_discount": user.get("partner_discount", 0.0),
        "commission_rate": tier["rate"], "tier": tier, "wallet_balance": round(user.get("wallet_balance", 0) or 0, 2),
        "company_name": user.get("company_name"), "active_bookings": len(active),
        "tracking_base": tracking_url({"share_token": "X"}).rsplit("/X", 1)[0] if tracking_url({"share_token": "X"}) else None,
    }


COMMISSION_TYPES = ["partner_commission", "referral_l1", "referral_l2"]


async def _commission_lines(user_id: str, month: Optional[str]):
    q = {"user_id": user_id, "type": {"$in": COMMISSION_TYPES}}
    if month:
        from reports import month_bounds
        start, end = month_bounds(month)
        q["created_at"] = {"$gte": start, "$lt": end}
    return [t async for t in db.wallet_tx.find(q, {"_id": 0}).sort("created_at", -1).limit(500)]


@router.get("/commissions")
async def commissions(month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(company_only)):
    from reports import month_label
    from routes.referral import partner_tier_info
    lines = await _commission_lines(user["id"], month)
    direct = round(sum(l["amount"] for l in lines if l["type"] == "partner_commission"), 2)
    network = round(sum(l["amount"] for l in lines if l["type"] in ("referral_l1", "referral_l2")), 2)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    payouts = [p async for p in db.payouts.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(50)]
    tier = await partner_tier_info(user["id"])
    return {
        "month": month, "label": month_label(month) if month else "Toutes périodes",
        "rate": tier["rate"], "tier": tier, "balance": round((fresh or {}).get("wallet_balance", 0) or 0, 2),
        "earned": round(direct + network, 2), "direct": direct, "network": network, "count": len(lines),
        "lines": lines, "payouts": payouts,
    }


@router.get("/commissions/export.pdf")
async def commissions_pdf(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(company_only)):
    from reports import build_commission_pdf, month_label
    lines = await _commission_lines(user["id"], month)
    direct = round(sum(l["amount"] for l in lines if l["type"] == "partner_commission"), 2)
    network = round(sum(l["amount"] for l in lines if l["type"] in ("referral_l1", "referral_l2")), 2)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    totals = {"earned": round(direct + network, 2), "direct": direct, "network": network, "count": len(lines),
              "balance": round((fresh or {}).get("wallet_balance", 0) or 0, 2)}
    pdf = build_commission_pdf(f"Relevé de commissions — {user.get('company_name')}", f"Période : {month_label(month)}", lines, totals)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="commissions-{month}.pdf"'})


MIN_PAYOUT = 10.0


@router.post("/wallet/payout")
async def request_payout(data: PayoutIn, user=Depends(company_only)):
    from routes.referral import credit_wallet
    from core import notify, MODERATOR_EMAILS
    amount = round(data.amount, 2)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "wallet_balance": 1})
    balance = round((fresh or {}).get("wallet_balance", 0) or 0, 2)
    if amount < MIN_PAYOUT:
        raise HTTPException(422, f"Montant minimum de versement : {MIN_PAYOUT:.0f} €")
    if amount > balance + 1e-6:
        raise HTTPException(400, f"Solde insuffisant : {balance:.2f} € disponibles")
    # Debit (hold) the wallet now; the amount is released to the partner once an admin marks the payout as paid.
    await credit_wallet(user["id"], -amount, "payout", f"Versement demandé · {user.get('company_name')}")
    payout = {"id": new_id(), "user_id": user["id"], "partner_name": user.get("company_name"),
              "amount": amount, "status": "pending", "note": None, "created_at": now_utc(),
              "settled_at": None, "settled_by": None}
    await db.payouts.insert_one(payout.copy())
    async for mod in db.users.find({"email": {"$in": list(MODERATOR_EMAILS)}}, {"_id": 0, "id": 1}):
        await notify(mod["id"], "wallet", "Demande de versement", f"{user.get('company_name')} demande un versement de {amount:.2f} €")
    return {"ok": True, "amount": amount, "balance": round(balance - amount, 2)}


# ---------- Ranking (gamification for partners) ----------
@router.get("/ranking")
async def partner_ranking(user=Depends(company_only)):
    from reports import month_label
    partners = {}
    async for p in db.users.find({"role": "company"}, {"_id": 0, "id": 1, "company_name": 1}):
        partners[p["id"]] = p.get("company_name") or "Partenaire"
    totals = {}
    async for row in db.wallet_tx.aggregate([{"$match": {"type": "partner_commission"}}, {"$group": {"_id": "$user_id", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}]):
        if row["_id"] in partners:
            totals[row["_id"]] = {"total": round(row["total"], 2), "count": row["count"]}
    board = sorted(totals.items(), key=lambda kv: -kv[1]["total"])
    rank = next((i + 1 for i, (uid, _) in enumerate(board) if uid == user["id"]), len(board) + 1)
    my_total = totals.get(user["id"], {}).get("total", 0.0)
    leaderboard = [{
        "position": i + 1, "is_me": uid == user["id"],
        "name": "Vous" if uid == user["id"] else (partners[uid][:1] + "•••" if partners.get(uid) else "Partenaire"),
        "total": v["total"], "count": v["count"],
    } for i, (uid, v) in enumerate(board[:5])]
    best = []
    async for row in db.wallet_tx.aggregate([
        {"$match": {"user_id": user["id"], "type": "partner_commission"}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m", "date": "$created_at"}}, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}},
        {"$sort": {"total": -1}}, {"$limit": 3},
    ]):
        best.append({"month": row["_id"], "label": month_label(row["_id"]), "total": round(row["total"], 2), "count": row["count"]})
    return {"rank": rank, "total_partners": len(partners), "commissioned_partners": len(board),
            "my_total": my_total, "leaderboard": leaderboard, "best_months": best}


# ---------- Admin: manage partner payout requests (moderators) ----------
def moderator_only(user=Depends(current_user)):
    if not user.get("is_moderator"):
        raise HTTPException(403, "Réservé aux administrateurs")
    return user


@router.get("/admin/payouts")
async def admin_payouts(status: Optional[str] = None, user=Depends(moderator_only)):
    q = {}
    if status in ("pending", "paid", "rejected"):
        q["status"] = status
    items = [p async for p in db.payouts.find(q, {"_id": 0}).sort("created_at", -1).limit(300)]
    pending_total = round(sum(p["amount"] for p in items if p["status"] == "pending"), 2)
    return {"payouts": items, "pending_count": sum(1 for p in items if p["status"] == "pending"), "pending_total": pending_total}


async def _payouts_for_export(status: Optional[str], month: Optional[str]):
    q = {}
    if status in ("pending", "paid", "rejected"):
        q["status"] = status
    if month:
        from reports import month_bounds
        start, end = month_bounds(month)
        q["created_at"] = {"$gte": start, "$lt": end}
    return [p async for p in db.payouts.find(q, {"_id": 0}).sort("created_at", -1).limit(2000)]


@router.get("/admin/payouts/export.csv")
async def admin_payouts_csv(status: Optional[str] = None, month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(moderator_only)):
    from reports import build_payouts_csv
    items = await _payouts_for_export(status, month)
    return Response(build_payouts_csv(items), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="versements-partenaires{("-" + month) if month else ""}.csv"'})


@router.get("/admin/payouts/export.pdf")
async def admin_payouts_pdf(status: Optional[str] = None, month: Optional[str] = Query(default=None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user=Depends(moderator_only)):
    from reports import build_payouts_pdf, month_label
    items = await _payouts_for_export(status, month)
    sub = f"Période : {month_label(month)}" if month else "Toutes périodes"
    if status:
        sub += f" · statut : {status}"
    pdf = build_payouts_pdf("Versements partenaires — comptabilité", sub, items)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="versements-partenaires{("-" + month) if month else ""}.pdf"'})


@router.patch("/admin/payouts/{payout_id}")
async def decide_payout(payout_id: str, data: PayoutDecisionIn, user=Depends(moderator_only)):
    from routes.referral import credit_wallet
    from core import notify
    p = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Demande introuvable")
    if p["status"] != "pending":
        raise HTTPException(409, "Cette demande a déjà été traitée")
    upd = {"status": data.status, "note": (data.note or "").strip() or None, "settled_at": now_utc(), "settled_by": user.get("full_name") or user["email"]}
    if data.status == "rejected":
        # release the hold back to the partner's wallet
        await credit_wallet(p["user_id"], p["amount"], "payout_refund", f"Versement refusé · retour au portefeuille")
        await notify(p["user_id"], "wallet", "Versement refusé", f"Votre demande de {p['amount']:.2f} € a été refusée. Le montant est de nouveau disponible.")
    else:
        await notify(p["user_id"], "wallet", "Versement effectué", f"Votre versement de {p['amount']:.2f} € a été validé et réglé.")
    await db.payouts.update_one({"id": payout_id}, {"$set": upd})
    p.update(upd)
    return p


# ---------- Public signed commission statement PDF (used in the monthly email) ----------
def statement_sig(user_id: str, month: str) -> str:
    from core import JWT_SECRET
    return hmac.new(JWT_SECRET.encode(), f"statement:{user_id}:{month}".encode(), hashlib.sha256).hexdigest()[:32]


@router.get("/commission-statements/{user_id}.pdf")
async def public_statement_pdf(user_id: str, month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), sig: str = ""):
    from reports import build_commission_pdf, month_label
    if not hmac.compare_digest(sig, statement_sig(user_id, month)):
        raise HTTPException(403, "Lien invalide")
    owner = await db.users.find_one({"id": user_id}, {"_id": 0, "company_name": 1, "wallet_balance": 1})
    if not owner:
        raise HTTPException(404, "Introuvable")
    lines = await _commission_lines(user_id, month)
    direct = round(sum(l["amount"] for l in lines if l["type"] == "partner_commission"), 2)
    network = round(sum(l["amount"] for l in lines if l["type"] in ("referral_l1", "referral_l2")), 2)
    totals = {"earned": round(direct + network, 2), "direct": direct, "network": network, "count": len(lines),
              "balance": round(owner.get("wallet_balance", 0) or 0, 2)}
    pdf = build_commission_pdf(f"Relevé de commissions — {owner.get('company_name')}", f"Période : {month_label(month)}", lines, totals)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="commissions-{month}.pdf"'})


# ---------- Monthly statement email sweep (called by a daily loop in server.py) ----------
async def monthly_statement_sweep():
    """Once, at the start of each month, email every partner the previous month's commission statement."""
    from reports import month_label
    from emailer import send_partner_statement
    now = now_utc()
    y, m = (now.year - 1, 12) if now.month == 1 else (now.year, now.month - 1)
    prev_month = f"{y:04d}-{m:02d}"
    frontend = os.environ.get("FRONTEND_URL", "").strip('"').rstrip("/")
    async for u in db.users.find({"role": "company"}, {"_id": 0, "id": 1, "email": 1, "company_name": 1, "language": 1, "last_statement_month": 1}):
        if u.get("last_statement_month") == prev_month or not u.get("email"):
            continue
        lines = await _commission_lines(u["id"], prev_month)
        await db.users.update_one({"id": u["id"]}, {"$set": {"last_statement_month": prev_month}})  # mark even if empty (avoid re-scan)
        if not lines:
            continue
        direct = round(sum(l["amount"] for l in lines if l["type"] == "partner_commission"), 2)
        network = round(sum(l["amount"] for l in lines if l["type"] in ("referral_l1", "referral_l2")), 2)
        totals = {"earned": round(direct + network, 2), "direct": direct, "network": network, "count": len(lines)}
        pdf_url = f"{frontend}/api/company/commission-statements/{u['id']}.pdf?month={prev_month}&sig={statement_sig(u['id'], prev_month)}" if frontend.startswith("https://") else None
        await send_partner_statement(to=u["email"], name=u.get("company_name") or "Partenaire", month_label=month_label(prev_month),
                                      totals=totals, pdf_url=pdf_url, lang="fr" if u.get("language", "fr") == "fr" else "en")


# ---------- Saved clients (partner guest book): store preferences to pre-fill bookings ----------
async def upsert_partner_guest(company_id: str, name: str, phone: Optional[str], room: Optional[str], vehicle_type: Optional[str], booked: bool = False):
    """Create or refresh a saved client for a partner, keyed by phone when available, else by lower-cased name."""
    key = {"company_id": company_id}
    key.update({"phone": phone} if phone else {"name_key": name.lower()})
    existing = await db.partner_guests.find_one(key, {"_id": 0})
    now = now_utc()
    fields = {"company_id": company_id, "name": name, "name_key": name.lower(), "phone": phone, "updated_at": now}
    if room:
        fields["room"] = room
    if vehicle_type:
        fields["vehicle_type"] = vehicle_type
    if existing:
        inc = {"bookings_count": 1} if booked else {}
        upd = {"$set": {**fields, **({"last_booked_at": now} if booked else {})}}
        if inc:
            upd["$inc"] = inc
        await db.partner_guests.update_one({"id": existing["id"]}, upd)
    else:
        await db.partner_guests.insert_one({"id": new_id(), **fields, "notes": None, "room": room, "vehicle_type": vehicle_type,
                                            "bookings_count": 1 if booked else 0, "last_booked_at": now if booked else None, "created_at": now})


@router.get("/guests")
async def list_guests(user=Depends(company_only)):
    return [g async for g in db.partner_guests.find({"company_id": user["id"]}, {"_id": 0, "name_key": 0}).sort([("last_booked_at", -1), ("name", 1)]).limit(200)]


@router.post("/guests")
async def save_guest(data: GuestIn, user=Depends(company_only)):
    from core import normalize_phone
    phone = None
    if data.phone and data.phone.strip():
        phone = normalize_phone(data.phone)
        if not phone:
            raise HTTPException(422, "Téléphone invalide (format +33 6 12 34 56 78)")
    await upsert_partner_guest(user["id"], data.name.strip(), phone, (data.room or "").strip() or None, data.vehicle_type)
    key = {"company_id": user["id"]}
    key.update({"phone": phone} if phone else {"name_key": data.name.strip().lower()})
    g = await db.partner_guests.find_one(key, {"_id": 0, "name_key": 0})
    if data.notes is not None:
        await db.partner_guests.update_one({"id": g["id"]}, {"$set": {"notes": data.notes.strip() or None}})
        g["notes"] = data.notes.strip() or None
    return g


@router.delete("/guests/{guest_id}")
async def delete_guest(guest_id: str, user=Depends(company_only)):
    res = await db.partner_guests.delete_one({"id": guest_id, "company_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Client introuvable")
    return {"ok": True}
