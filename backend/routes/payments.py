"""Stripe hosted Checkout for card payments."""
import logging
import os
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request

from core import db, notify, now_utc, require_role, current_user
from models import CheckoutIn

router = APIRouter(prefix="/payments", tags=["payments"])
log = logging.getLogger("payments")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
stripe.api_key = STRIPE_SECRET_KEY


def allowed_return_url(value: Optional[str]) -> str:
    if value and (value.startswith("https://") or value.startswith("exp://") or value.startswith("frontend://")):
        return value
    return f"{os.environ.get('FRONTEND_URL', '').rstrip('/')}/payment-result"


@router.get("/config")
async def config():
    return {"card_enabled": bool(STRIPE_SECRET_KEY)}


@router.post("/checkout/{ride_id}")
async def create_checkout(ride_id: str, body: CheckoutIn, user=Depends(require_role("passenger"))):
    if not STRIPE_SECRET_KEY:
        raise HTTPException(503, "Paiement par carte non configuré")
    ride = await db.rides.find_one({"id": ride_id, "passenger_id": user["id"]}, {"_id": 0})
    if not ride:
        raise HTTPException(404, "Course introuvable")
    if ride.get("payment_status") == "paid":
        raise HTTPException(409, "Course déjà payée")
    if ride["status"] == "cancelled":
        raise HTTPException(409, "Course annulée")
    amount = int(round(ride["price"] * 100))
    return_url = allowed_return_url(body.return_url)
    sep = "&" if "?" in return_url else "?"
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": f"Course VTC → {ride['dropoff']['address'][:60]}"},
                    "unit_amount": amount,
                },
                "quantity": 1,
            }],
            success_url=f"{return_url}{sep}ride_id={ride_id}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{return_url}{sep}ride_id={ride_id}&cancelled=1",
            client_reference_id=ride_id,
            metadata={"ride_id": ride_id, "user_id": user["id"]},
            customer_email=user["email"],
        )
    except stripe.StripeError as exc:
        log.error("Stripe error: %s", exc)
        raise HTTPException(502, f"Stripe indisponible : {getattr(exc, 'user_message', None) or str(exc)}")
    await db.payments.update_one(
        {"ride_id": ride_id},
        {"$set": {"ride_id": ride_id, "user_id": user["id"], "amount_cents": amount, "currency": "eur",
                  "status": "pending", "checkout_session_id": session.id, "updated_at": now_utc()},
         "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
    )
    await db.rides.update_one({"id": ride_id}, {"$set": {"payment_status": "pending", "payment_method": "card"}})
    return {"checkout_url": session.url, "session_id": session.id}


async def mark_paid(ride_id: str, payment_intent: Optional[str], session_id: str):
    await db.payments.update_one(
        {"ride_id": ride_id},
        {"$set": {"status": "paid", "stripe_payment_intent": payment_intent, "checkout_session_id": session_id, "paid_at": now_utc()}},
    )
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if ride and ride.get("payment_status") != "paid":
        await db.rides.update_one({"id": ride_id}, {"$set": {"payment_status": "paid", "payment_method": "card"}})
        await notify(ride.get("passenger_id"), "paid", "Paiement confirmé", f"{ride['price']:.2f} € réglés par carte", ride_id)
        await notify(ride.get("driver_id"), "paid", "Course payée par carte", f"{ride['price']:.2f} € — {ride['passenger_name']}", ride_id)


@router.get("/status/{ride_id}")
async def payment_status(ride_id: str, user=Depends(current_user)):
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(404, "Course introuvable")
    if user["id"] not in (ride.get("passenger_id"), ride.get("driver_id")):
        raise HTTPException(403, "Forbidden")
    payment = await db.payments.find_one({"ride_id": ride_id}, {"_id": 0})
    # Without a webhook secret we confirm directly with Stripe when the client returns.
    if payment and payment["status"] == "pending" and payment.get("checkout_session_id") and STRIPE_SECRET_KEY:
        try:
            session = stripe.checkout.Session.retrieve(payment["checkout_session_id"])
            if session.get("payment_status") == "paid":
                await mark_paid(ride_id, session.get("payment_intent"), session["id"])
                return {"ride_id": ride_id, "status": "paid"}
        except stripe.StripeError as exc:
            log.warning("Stripe retrieve failed: %s", exc)
    return {"ride_id": ride_id, "status": ride.get("payment_status", "unpaid")}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(400, "Webhook non configuré")
    try:
        event = stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(400, "Invalid webhook")
    if await db.webhook_events.find_one({"event_id": event["id"]}):
        return {"ok": True, "duplicate": True}
    await db.webhook_events.insert_one({"event_id": event["id"], "type": event["type"], "received_at": now_utc()})
    obj = event["data"]["object"]
    if event["type"] == "checkout.session.completed" and obj.get("payment_status") == "paid":
        ride_id = (obj.get("metadata") or {}).get("ride_id")
        if ride_id:
            await mark_paid(ride_id, obj.get("payment_intent"), obj["id"])
    return {"ok": True}
