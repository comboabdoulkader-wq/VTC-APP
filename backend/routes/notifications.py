from typing import List

from fastapi import APIRouter, Depends

from core import current_user, db
from models import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=List[NotificationOut])
async def list_notifications(unread_only: bool = False, user=Depends(current_user)):
    q = {"user_id": user["id"]}
    if unread_only:
        q["read"] = False
    cursor = db.notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(30)
    return [NotificationOut(**n) async for n in cursor]


@router.post("/{notif_id}/read")
async def mark_read(notif_id: str, user=Depends(current_user)):
    await db.notifications.update_one({"id": notif_id, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(user=Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}
