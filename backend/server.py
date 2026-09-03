"""FastAPI backend for VTC ride-hailing app."""
import asyncio
import logging
from datetime import timedelta

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import REMINDER_MIN, client, db, notify, now_utc, seed_cities
import push
from catalog import seed_fixed_routes
from flights import refresh_ride_flights
from routes import auth, booking, company, documents, driver, extras, geo_routes, integrations, notifications, passenger_extras, payments, referral, rides, team
from routes import adminpanel
from routes.documents import compliance_sweep
from storage import init_storage

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="VTC API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "VTC API", "status": "ok"}


for r in (auth.router, rides.router, driver.router, team.router, payments.router, notifications.router, company.router, geo_routes.router, documents.router, extras.router, passenger_extras.router, referral.router):
    api.include_router(r)
api.include_router(push.router)
api.include_router(booking.router)
api.include_router(integrations.router)
api.include_router(adminpanel.router)

app.include_router(api)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=()"
    response.headers["Cache-Control"] = "no-store"
    return response


# Bearer tokens only (no cookies) → wildcard origins are safe and credentials are not needed.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
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
                             f"Départ dans {REMINDER_MIN} min : {r['pickup']['address']} → {r['dropoff']['address']}", r["id"], sms=True)
                await notify(r.get("driver_id"), "reminder", f"Course programmée à {when}",
                             f"Prise en charge dans {REMINDER_MIN} min : {r['pickup']['address']} ({r.get('passenger_label') or r['passenger_name']})", r["id"], sms=True)
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


async def flights_loop():
    """Every 10 min: refresh flights of upcoming airport transfers and alert driver/passenger on delays (needs AviationStack key)."""
    while True:
        await asyncio.sleep(600)
        try:
            await refresh_ride_flights()
        except Exception as e:
            logging.getLogger("flights").warning("refresh error: %s", e)


async def statements_loop():
    """Once a day: at the start of a new month, email each partner the previous month's commission statement (idempotent)."""
    from routes.company import monthly_statement_sweep
    while True:
        try:
            await monthly_statement_sweep()
        except Exception as e:
            logging.getLogger("statements").warning("statement sweep error: %s", e)
        await asyncio.sleep(6 * 3600)


@app.on_event("startup")
async def on_startup():
    await seed_cities()
    await seed_fixed_routes()
    await init_storage()
    asyncio.create_task(reminder_loop())
    asyncio.create_task(compliance_loop())
    asyncio.create_task(flights_loop())
    asyncio.create_task(statements_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
