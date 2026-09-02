"""Emergent managed object storage (documents, selfies). Backend-only access."""
import logging
import os

import requests
from fastapi.concurrency import run_in_threadpool

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "ridego-vtc"
log = logging.getLogger("storage")
_storage_key = None


def _init() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    for attempt in range(2):
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": _init(), "Content-Type": content_type}, data=data, timeout=120)
        if resp.status_code == 503 and attempt == 0:
            _storage_key = None
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("storage unavailable")


def _get(path: str) -> tuple:
    global _storage_key
    for attempt in range(2):
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": _init()}, timeout=60)
        if resp.status_code == 503 and attempt == 0:
            _storage_key = None
            continue
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    raise RuntimeError("storage unavailable")


async def init_storage():
    try:
        await run_in_threadpool(_init)
    except Exception as e:
        log.warning("storage init failed: %s", e)


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await run_in_threadpool(_put, path, data, content_type)


async def get_object(path: str) -> tuple:
    return await run_in_threadpool(_get, path)


def object_path(user_id: str, ext: str, uid: str) -> str:
    return f"{APP_NAME}/uploads/{user_id}/{uid}.{ext}"
