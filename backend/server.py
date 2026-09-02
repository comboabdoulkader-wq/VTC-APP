"""FastAPI backend for VTC ride-hailing app."""
import asyncio
import logging
from datetime import timedelta

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import REMINDER_MIN, client, db, notify, now_utc, seed_cities
from routes import auth, company, documents, driver, extras, geo_routes, notifications, payments, rides, team
from routes.documents import compliance_sweep
from storage import init_storage

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="VTC API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "VTC API", "status": "ok"}


for r in (auth.router, rides.router, driver.router, team.router, payments.router, notifications.router, company.router, geo_routes.router, documents.router, extras.router):
    api.include_router(r)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def reminder_loop():
    """Every minute: warn passenger + driver 45 min before a scheduled ride."""
    while True:
        try:
            now = now_utc()
            q = {"scheduled_at": {"$gte": now - timedelta(minutes=5), "$lte": now + timedelta(minutes=REMINDER_MIN)},
                 "status": {"$in": ["requested", "accepted"]}, "reminder_sent": {"$ne": True}}
            async for r in db.rides.find(q, {"_id": 0}):
                await db.rides.update_one({"id": r["id"]}, {"$set": {"reminder_sent": True}})
                when = r["scheduled_at"].strftime("%H:%M")
                await notify(r.get("passenger_id"), "reminder", f"Course programmée à {when}",
                             f"Départ dans {REMINDER_MIN} min : {r['pickup']['address']} → {r['dropoff']['address']}", r["id"], sms_phone=r.get("passenger_phone"))
                await notify(r.get("driver_id"), "reminder", f"Course programmée à {when}",
                             f"Prise en charge dans {REMINDER_MIN} min : {r['pickup']['address']} ({r.get('passenger_label') or r['passenger_name']})", r["id"])
        except Exception as e:  # keep the loop alive
            logging.getLogger("reminders").warning("reminder loop error: %s", e)
        await asyncio.sleep(60)


async def compliance_loop():
    while True:
        try:
            await compliance_sweep()
        except Exception as e:
            logging.getLogger("compliance").warning("sweep error: %s", e)
        await asyncio.sleep(3600)


@app.on_event("startup")
async def on_startup():
    await seed_cities()
    await init_storage()
    asyncio.create_task(reminder_loop())
    asyncio.create_task(compliance_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
