"""Emergent managed push notifications (SuprSend relay). Backend-only: the frontend never talks to the relay directly."""
import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import current_user

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)
log = logging.getLogger("push")

router = APIRouter(tags=["push"])


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str = Field(pattern="^(android|ios)$")
    device_token: str = Field(min_length=8, max_length=4096)


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user=Depends(current_user)):
    # The token owner is always the authenticated user (never trust the body's user_id).
    payload = {"user_id": user["id"], "platform": body.platform, "device_token": body.device_token}
    resp = await _client.post("/api/v1/push/users/register", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


async def send_push(recipients: list[str], data: dict, idempotency_key: str | None = None) -> None:
    """Relay a push to up to 100 user ids. `data` must include title and message (+ optional action_url)."""
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


async def push_safe(recipients: list[str], title: str, message: str, action_url: str | None = None, idempotency_key: str | None = None) -> None:
    """send_push wrapped so a push failure never blocks the business operation. Chunks recipients by 100."""
    data = {"title": title, "message": message}
    if action_url:
        data["action_url"] = action_url
    if PUSH_KEY == "placeholder":
        # Dev/preview: the real key is injected by the deployment pipeline. Avoid useless network calls here.
        log.info("Push (non envoyé, clé non configurée) -> %s: %s", recipients[:3], title)
        return
    for i in range(0, len(recipients), 100):
        try:
            await send_push(recipients[i:i + 100], data, idempotency_key)
        except Exception as e:
            log.warning("Push failed (non-blocking): %s", e)
