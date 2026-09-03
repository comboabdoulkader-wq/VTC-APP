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
    if ride["status"] == "cancelled":
        raise HTTPException(409, "Course annulée")
    if body.kind == "tip":
        if not ride.get("tip") or ride["tip"] <= 0:
            raise HTTPException(409, "Aucun pourboire à régler")
        if ride.get("tip_paid"):
            raise HTTPException(409, "Pourboire déjà réglé")
        amount = int(round(ride["tip"] * 100))
        label = f"Pourboire pour {ride.get('driver_name') or 'votre chauffeur'}"
    else:
        if ride.get("payment_status") == "paid":
            raise HTTPException(409, "Course déjà payée")
        due = round(ride["price"] - ride.get("wallet_amount", 0), 2)
        if due <= 0:
            raise HTTPException(409, "Course déjà réglée par le portefeuille")
        amount = int(round(due * 100))
        label = f"Course VTC → {ride['dropoff']['address'][:60]}"
    return_url = allowed_return_url(body.return_url)
    sep = "&" if "?" in return_url else "?"
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": label},
                    "unit_amount": amount,
                },
                "quantity": 1,
            }],
            success_url=f"{return_url}{sep}ride_id={ride_id}&kind={body.kind}&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{return_url}{sep}ride_id={ride_id}&kind={body.kind}&cancelled=1",
            client_reference_id=ride_id,
            metadata={"ride_id": ride_id, "user_id": user["id"], "kind": body.kind},
            customer_email=user["email"],
        )
    except stripe.StripeError as exc:
        log.error("Stripe error: %s", exc)
        raise HTTPException(502, f"Stripe indisponible : {getattr(exc, 'user_message', None) or str(exc)}")
    await db.payments.update_one(
        {"ride_id": ride_id, "kind": body.kind},
        {"$set": {"ride_id": ride_id, "kind": body.kind, "user_id": user["id"], "amount_cents": amount, "currency": "eur",
                  "status": "pending", "checkout_session_id": session.id, "updated_at": now_utc()},
         "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
    )
    if body.kind == "ride":
        await db.rides.update_one({"id": ride_id}, {"$set": {"payment_status": "pending", "payment_method": "card"}})
    return {"checkout_url": session.url, "session_id": session.id}


async def mark_paid(ride_id: str, payment_intent: Optional[str], session_id: str, kind: str = "ride"):
    await db.payments.update_one(
        {"ride_id": ride_id, "kind": kind},
        {"$set": {"status": "paid", "stripe_payment_intent": payment_intent, "checkout_session_id": session_id, "paid_at": now_utc()}},
    )
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if kind == "tip":
        if ride and not ride.get("tip_paid"):
            await db.rides.update_one({"id": ride_id}, {"$set": {"tip_paid": True}})
            await notify(ride.get("driver_id"), "paid", "Pourboire reçu 🎉", f"{ride.get('tip', 0):.2f} € de {ride['passenger_name']}", ride_id)
        return
    if ride and ride.get("payment_status") != "paid":
        await db.rides.update_one({"id": ride_id}, {"$set": {"payment_status": "paid", "payment_method": "card"}})
        await notify(ride.get("passenger_id"), "paid", "Paiement confirmé", f"{ride['price']:.2f} € réglés par carte", ride_id)
        await notify(ride.get("driver_id"), "paid", "Course payée par carte", f"{ride['price']:.2f} € — {ride['passenger_name']}", ride_id)


@router.get("/status/{ride_id}")
async def payment_status(ride_id: str, kind: str = "ride", user=Depends(current_user)):
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(404, "Course introuvable")
    if user["id"] not in (ride.get("passenger_id"), ride.get("driver_id")):
        raise HTTPException(403, "Forbidden")
    payment = await db.payments.find_one({"ride_id": ride_id, "kind": kind}, {"_id": 0}) or (await db.payments.find_one({"ride_id": ride_id, "kind": {"$exists": False}}, {"_id": 0}) if kind == "ride" else None)
    if kind == "tip":
        if payment and payment["status"] == "pending" and payment.get("checkout_session_id") and STRIPE_SECRET_KEY:
            try:
                session = stripe.checkout.Session.retrieve(payment["checkout_session_id"])
                if session.get("payment_status") == "paid":
                    await mark_paid(ride_id, session.get("payment_intent"), session["id"], "tip")
                    return {"ride_id": ride_id, "kind": "tip", "status": "paid"}
            except stripe.StripeError as exc:
                log.warning("Stripe retrieve failed: %s", exc)
        return {"ride_id": ride_id, "kind": "tip", "status": "paid" if ride.get("tip_paid") else (payment["status"] if payment else "unpaid")}
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
        meta = obj.get("metadata") or {}
        if meta.get("ride_id"):
            await mark_paid(meta["ride_id"], obj.get("payment_intent"), obj["id"], meta.get("kind", "ride"))
    return {"ok": True}
