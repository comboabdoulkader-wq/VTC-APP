"""Driver compliance: documents with validity dates, expiry alerts, automatic blocking, admin review, on-demand selfie."""
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from core import MODERATOR_EMAILS, current_user, db, new_id, notify, now_utc, require_role
from storage import get_object, object_path, put_object

router = APIRouter(tags=["documents"])
log = logging.getLogger("documents")

BLOCK_MESSAGE = "Votre compte est temporairement bloqué car un ou plusieurs documents obligatoires ont expiré. Merci de les mettre à jour pour réactiver votre compte."
WARN_DAYS = 30
WARN_STEPS = [30, 7, 1]  # reminders J-30, J-7, J-1
MAX_SIZE = 10 * 1024 * 1024
ALLOWED = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"}

# key, label, category, required rule, has expiry
DOC_TYPES = [
    {"key": "id_card", "label": "Pièce d'identité", "category": "driver", "required": "always", "expires": True},
    {"key": "driving_license", "label": "Permis de conduire", "category": "driver", "required": "always", "expires": True},
    {"key": "vtc_card", "label": "Carte professionnelle VTC", "category": "driver", "required": "if_applicable", "expires": True},
    {"key": "rc_pro", "label": "RC Pro (Responsabilité Civile Professionnelle)", "category": "driver", "required": "if_independent", "expires": True},
    {"key": "registration", "label": "Carte grise", "category": "vehicle", "required": "always", "expires": False},
    {"key": "vehicle_insurance", "label": "Assurance du véhicule", "category": "vehicle", "required": "always", "expires": True},
    {"key": "rc_circulation", "label": "RC Circulation", "category": "vehicle", "required": "always", "expires": True},
    {"key": "technical_inspection", "label": "Contrôle technique", "category": "vehicle", "required": "if_applicable", "expires": True},
]
TYPE_MAP = {d["key"]: d for d in DOC_TYPES}


class ReviewIn(BaseModel):
    status: str  # valid | rejected
    note: Optional[str] = None


def is_required(dt: dict, driver: dict, doc: Optional[dict]) -> bool:
    if dt["required"] == "always":
        return True
    if dt["required"] == "if_independent":
        return not driver.get("manager_id")
    return not (doc and doc.get("not_applicable"))


def doc_state(dt: dict, doc: Optional[dict], today: datetime) -> str:
    """missing | not_applicable | valid | expiring | expired | rejected | pending"""
    if not doc:
        return "missing"
    if doc.get("not_applicable"):
        return "not_applicable"
    if doc.get("status") == "rejected":
        return "rejected"
    if doc.get("status") == "pending":
        return "pending"
    until = doc.get("valid_until")
    if until and until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if dt["expires"] and until:
        if until <= today:
            return "expired"
        if until <= today + timedelta(days=WARN_DAYS):
            return "expiring"
    return "valid"


async def alert_supervisors(driver: dict, title: str, body: str, admins: bool = True):
    """Notify the team manager (if any) and, optionally, platform admins."""
    if driver.get("manager_id"):
        await notify(driver["manager_id"], "team_document", title, body)
    if admins:
        for admin in MODERATOR_EMAILS:
            a = await db.users.find_one({"email": admin}, {"_id": 0, "id": 1})
            if a and a["id"] != driver.get("manager_id"):
                await notify(a["id"], "document", title, body)


async def evaluate_driver(driver: dict, send_alerts: bool = False) -> dict:
    """Compute compliance, persist blocked flag, optionally send J-30 / expiry notifications."""
    today = now_utc()
    docs = {d["type"]: d async for d in db.documents.find({"driver_id": driver["id"], "type": {"$ne": "selfie"}, "archived": {"$ne": True}}, {"_id": 0})}
    items, blocking, expiring = [], [], []
    for dt in DOC_TYPES:
        doc = docs.get(dt["key"])
        state = doc_state(dt, doc, today)
        required = is_required(dt, driver, doc)
        if required and state in ("missing", "expired", "rejected"):
            blocking.append(dt["label"])
        if state == "expiring":
            expiring.append({"label": dt["label"], "valid_until": doc["valid_until"]})
        if doc and send_alerts:
            if state == "expiring":
                until = doc["valid_until"] if doc["valid_until"].tzinfo else doc["valid_until"].replace(tzinfo=timezone.utc)
                days_left = max((until - today).days, 0)
                warned = set(doc.get("warned_days") or ([30] if doc.get("warned_30") else []))
                due = [t for t in WARN_STEPS if days_left <= t and t not in warned]
                if due:
                    step = min(due)
                    await db.documents.update_one({"id": doc["id"]}, {"$set": {"warned_days": sorted(warned | set(due))}})
                    when = until.strftime("%d/%m/%Y")
                    urgency = "demain" if step == 1 else f"dans {days_left} jour(s)"
                    await notify(driver["id"], "document", f"{dt['label']} expire {urgency}", f"Expiration le {when}. Renouvelez-le pour éviter le blocage de votre compte.")
                    await alert_supervisors(driver, f"Document bientôt expiré – {driver['full_name']}", f"{dt['label']} expire le {when} ({urgency})")
            if state == "expired" and doc.get("status") != "expired":
                await db.documents.update_one({"id": doc["id"]}, {"$set": {"status": "expired"}})
                await notify(driver["id"], "document", f"{dt['label']} expiré", "Merci de téléverser une nouvelle version pour réactiver votre compte.")
                await alert_supervisors(driver, f"Document expiré – {driver['full_name']}", f"{dt['label']} a expiré. Le chauffeur est bloqué jusqu'au renouvellement.")
        items.append({**dt, "state": state, "required": required, "doc": doc and {k: v for k, v in doc.items() if k not in ("storage_path",)}})
    blocked = len(blocking) > 0
    if bool(driver.get("docs_blocked")) != blocked:
        await db.users.update_one({"id": driver["id"]}, {"$set": {"docs_blocked": blocked, "is_online": driver.get("is_online") and not blocked}})
        if blocked and send_alerts:
            await notify(driver["id"], "blocked", "Compte bloqué", BLOCK_MESSAGE)
            await alert_supervisors(driver, f"Chauffeur bloqué – {driver['full_name']}", f"Documents manquants/expirés : {', '.join(blocking)}", admins=False)
        if not blocked and driver.get("docs_blocked") and driver.get("manager_id"):
            await notify(driver["manager_id"], "unblocked", f"Chauffeur réactivé – {driver['full_name']}", "Ses documents sont à jour, il peut reprendre les courses.")
        if not blocked and driver.get("docs_blocked"):
            await notify(driver["id"], "unblocked", "Compte réactivé", "Vos documents sont à jour. Vous pouvez reprendre les courses.")
    selfie = await db.documents.find_one({"driver_id": driver["id"], "type": "selfie", "archived": {"$ne": True}}, {"_id": 0, "storage_path": 0}, sort=[("uploaded_at", -1)])
    return {"blocked": blocked, "block_message": BLOCK_MESSAGE if blocked else None, "blocking": blocking, "expiring": expiring,
            "items": items, "selfie_requested": bool(driver.get("selfie_requested")), "selfie": selfie}


async def compliance_sweep():
    """Hourly: refresh states, send J-30 / expiry alerts, block/unblock drivers."""
    async for drv in db.users.find({"role": "driver"}, {"_id": 0}):
        try:
            await evaluate_driver(drv, send_alerts=True)
        except Exception as e:
            log.warning("sweep failed for %s: %s", drv.get("email"), e)


async def archive_current(driver_id: str, type_: str):
    """Keep previous versions for audit: never delete, archive."""
    await db.documents.update_many({"driver_id": driver_id, "type": type_, "archived": {"$ne": True}},
                                   {"$set": {"archived": True, "archived_at": now_utc()}})


async def history_for(driver_id: str, with_paths: bool = False) -> list:
    proj = {"_id": 0} if with_paths else {"_id": 0, "storage_path": 0}
    out = []
    async for d in db.documents.find({"driver_id": driver_id, "archived": True}, proj).sort("archived_at", -1).limit(100):
        if d["type"] == "selfie":
            d["label"] = "Selfie de vérification"
        elif d["type"] == "profile_photo":
            d["label"] = "Photo de profil"
        else:
            d["label"] = TYPE_MAP.get(d["type"], {}).get("label", d["type"])
        if with_paths and d.get("storage_path"):
            d["file_path"] = d.pop("storage_path")
        out.append(d)
    return out


def admin_only(user=Depends(current_user)):
    if not user.get("is_moderator"):
        raise HTTPException(403, "Réservé aux administrateurs")
    return user


# ---------- Driver side ----------
@router.get("/documents/types")
async def types():
    return DOC_TYPES


@router.get("/documents/mine")
async def my_documents(user=Depends(require_role("driver"))):
    return await evaluate_driver(user)


@router.get("/documents/history")
async def my_history(user=Depends(require_role("driver"))):
    return await history_for(user["id"])


@router.post("/documents/upload")
async def upload(file: UploadFile = File(...), type: str = Form(...), valid_from: Optional[str] = Form(None), valid_until: Optional[str] = Form(None), user=Depends(require_role("driver"))):
    if type not in ("selfie", "profile_photo") and type not in TYPE_MAP:
        raise HTTPException(422, "Type de document inconnu")
    ct = (file.content_type or "").split(";")[0]
    if ct not in ALLOWED:
        raise HTTPException(415, "Format accepté : JPG, PNG, WEBP ou PDF")
    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(413, "Fichier trop volumineux (10 Mo max)")
    def parse(s):
        if not s:
            return None
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    vf, vu = parse(valid_from), parse(valid_until)
    if type in TYPE_MAP and TYPE_MAP[type]["expires"] and not vu:
        raise HTTPException(422, "Date d'expiration requise")
    uid = new_id()
    path = object_path(user["id"], ALLOWED[ct], uid)
    try:
        await put_object(path, data, ct)
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else 500
        raise HTTPException(402 if code == 402 else 502, "Stockage indisponible, réessayez plus tard" if code != 402 else "Quota de stockage épuisé")
    doc = {"id": uid, "driver_id": user["id"], "driver_name": user["full_name"], "type": type, "storage_path": path, "content_type": ct,
           "filename": file.filename, "valid_from": vf, "valid_until": vu, "status": "pending" if type == "selfie" else "valid", "archived": False,
           "uploaded_at": now_utc(), "warned_30": False, "not_applicable": False}
    await archive_current(user["id"], type)
    await db.documents.insert_one(doc.copy())
    if type == "profile_photo":
        if not ct.startswith("image/"):
            raise HTTPException(415, "La photo de profil doit être une image")
        await db.users.update_one({"id": user["id"]}, {"$set": {"photo_path": path}})
    if type == "selfie":
        await db.users.update_one({"id": user["id"]}, {"$set": {"selfie_requested": False}})
        user["selfie_requested"] = False
        for admin in MODERATOR_EMAILS:
            a = await db.users.find_one({"email": admin}, {"_id": 0, "id": 1})
            if a:
                await notify(a["id"], "selfie", f"Selfie reçu – {user['full_name']}", "À vérifier dans l'administration des chauffeurs")
    return await evaluate_driver(user)


@router.post("/documents/{type}/not-applicable")
async def not_applicable(type: str, user=Depends(require_role("driver"))):
    dt = TYPE_MAP.get(type)
    if not dt or dt["required"] != "if_applicable":
        raise HTTPException(409, "Ce document est obligatoire")
    await archive_current(user["id"], type)
    await db.documents.insert_one({"id": new_id(), "driver_id": user["id"], "driver_name": user["full_name"], "type": type, "not_applicable": True, "status": "valid", "uploaded_at": now_utc()})
    return await evaluate_driver(user)


@router.get("/files/{path:path}")
async def get_file(path: str, user=Depends(current_user)):
    doc = await db.documents.find_one({"storage_path": path}, {"_id": 0})
    if not doc or (doc["driver_id"] != user["id"] and not user.get("is_moderator")):
        raise HTTPException(404, "Fichier introuvable")
    try:
        content, ct = await get_object(path)
    except Exception:
        raise HTTPException(502, "Fichier indisponible")
    return Response(content, media_type=ct, headers={"Cache-Control": "private, max-age=3600"})


# ---------- Admin side ----------
@router.get("/admin/drivers")
async def admin_drivers(user=Depends(admin_only)):
    out = []
    async for drv in db.users.find({"role": "driver"}, {"_id": 0}):
        c = await evaluate_driver(drv)
        out.append({"id": drv["id"], "full_name": drv["full_name"], "email": drv["email"], "vehicle_model": drv.get("vehicle_model"), "license_plate": drv.get("license_plate"),
                    "is_online": drv.get("is_online", False), "blocked": c["blocked"], "blocking": c["blocking"], "expiring": c["expiring"],
                    "selfie_requested": c["selfie_requested"], "selfie_status": c["selfie"]["status"] if c["selfie"] else None,
                    "pending_docs": sum(1 for i in c["items"] if i["state"] == "pending")})
    return sorted(out, key=lambda d: (not d["blocked"], d["full_name"]))


@router.get("/admin/drivers/{driver_id}/documents")
async def admin_driver_docs(driver_id: str, user=Depends(admin_only)):
    drv = await db.users.find_one({"id": driver_id, "role": "driver"}, {"_id": 0})
    if not drv:
        raise HTTPException(404, "Chauffeur introuvable")
    c = await evaluate_driver(drv)
    paths = {d["id"]: d.get("storage_path") async for d in db.documents.find({"driver_id": driver_id}, {"_id": 0, "id": 1, "storage_path": 1})}
    for it in c["items"]:
        if it["doc"]:
            it["doc"]["file_path"] = paths.get(it["doc"]["id"])
    if c["selfie"]:
        c["selfie"]["file_path"] = paths.get(c["selfie"]["id"])
    return {"driver": {"id": drv["id"], "full_name": drv["full_name"], "email": drv["email"], "phone": drv.get("phone"), "vehicle_model": drv.get("vehicle_model"), "license_plate": drv.get("license_plate"), "manager_name": drv.get("manager_name")},
            "history": await history_for(driver_id, with_paths=True), **c}


@router.patch("/admin/documents/{doc_id}")
async def review(doc_id: str, data: ReviewIn, user=Depends(admin_only)):
    if data.status not in ("valid", "rejected"):
        raise HTTPException(422, "Statut invalide")
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Document introuvable")
    await db.documents.update_one({"id": doc_id}, {"$set": {"status": data.status, "review_note": data.note, "reviewed_by": user["email"], "reviewed_at": now_utc()}})
    label = "Selfie de vérification" if doc["type"] == "selfie" else TYPE_MAP[doc["type"]]["label"]
    if data.status == "rejected":
        await notify(doc["driver_id"], "document", f"{label} refusé", data.note or "Merci de téléverser un document conforme.")
        if doc["type"] == "selfie":
            await db.users.update_one({"id": doc["driver_id"]}, {"$set": {"selfie_requested": True}})
    else:
        await notify(doc["driver_id"], "document", f"{label} validé", "Merci, votre document a été vérifié par l'administrateur.")
    drv = await db.users.find_one({"id": doc["driver_id"]}, {"_id": 0})
    return await evaluate_driver(drv, send_alerts=True)


@router.post("/admin/drivers/{driver_id}/request-selfie")
async def request_selfie(driver_id: str, user=Depends(admin_only)):
    res = await db.users.update_one({"id": driver_id, "role": "driver"}, {"$set": {"selfie_requested": True, "selfie_requested_at": now_utc()}})
    if res.matched_count == 0:
        raise HTTPException(404, "Chauffeur introuvable")
    await notify(driver_id, "selfie", "Vérification d'identité demandée", "Le gérant de l'application vous demande un selfie de vérification. Ouvrez l'onglet Documents.")
    return {"ok": True}


@router.get("/users/{user_id}/photo")
async def user_photo(user_id: str, user=Depends(current_user)):
    """Driver profile photo, visible to any authenticated user (passengers see it during a ride)."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "photo_path": 1})
    if not u or not u.get("photo_path"):
        raise HTTPException(404, "Pas de photo")
    try:
        content, ct = await get_object(u["photo_path"])
    except Exception:
        raise HTTPException(502, "Photo indisponible")
    return Response(content, media_type=ct, headers={"Cache-Control": "private, max-age=600"})
