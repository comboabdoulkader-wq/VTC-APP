"""FastAPI backend for VTC ride-hailing app."""
import logging

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import client
from routes import auth, driver, notifications, payments, rides, team

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="VTC API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "VTC API", "status": "ok"}


for r in (auth.router, rides.router, driver.router, team.router, payments.router, notifications.router):
    api.include_router(r)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
