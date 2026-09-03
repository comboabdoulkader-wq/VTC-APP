"""Iteration 18 - Partner commissions (5%) for hotels/concierges/agencies.

Backend tests: partner info exposes commission_rate=0.05 and wallet_balance, partner booking creation,
commission crediting on completion (idempotent), monthly statement endpoint, payout validation,
PDF export via ?token= query.
"""
import asyncio
import os
import sys
import time
from datetime import datetime, timezone

import pytest
import requests

# Make backend importable so we can trigger distribute_partner_commission directly.
sys.path.insert(0, "/app/backend")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TS = int(time.time())

HOTEL_EMAIL = "hotel.ritz@test.com"
DRIVER_EMAIL = "chauffeur@test.com"
PASSENGER_EMAIL = "passager@test.com"


# ---------------- Helpers ----------------
def _login(email, password="password123"):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


def _headers(t):
    return {"Authorization": f"Bearer {t}"}


BOOKING_BODY = {
    "pickup": {"lat": 48.8681, "lng": 2.3292, "address": "Hôtel Ritz Paris"},
    "dropoff": {"lat": 49.0097, "lng": 2.5479, "address": "Aéroport CDG T2"},
    "vehicle_type": "premium",
    "service_type": "airport",
    "passengers": 2,
    "luggage": 3,
    "guest_name": "TEST_Commission Guest",
    "guest_phone": "06 55 66 77 88",
    "room": "101",
}


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def hotel_token():
    r = _login(HOTEL_EMAIL)
    if r.status_code != 200:
        pytest.skip(f"hotel.ritz login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def passenger_token():
    r = _login(PASSENGER_EMAIL)
    if r.status_code != 200:
        pytest.skip(f"passenger login failed: {r.status_code}")
    return r.json()["access_token"]


# ---------------- Partner info ----------------
class TestPartnerInfo:
    def test_partner_info_returns_commission_rate_and_wallet(self, hotel_token):
        r = requests.get(f"{API}/company/partner", headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["commission_rate"] == 0.05, data
        assert "wallet_balance" in data
        assert isinstance(data["wallet_balance"], (int, float))
        assert data["partner_type"] == "hotel"
        assert data["partner_discount"] == 0.1

    def test_passenger_role_forbidden(self, passenger_token):
        r = requests.get(f"{API}/company/partner", headers=_headers(passenger_token), timeout=15)
        assert r.status_code == 403


# ---------------- Partner booking creation ----------------
class TestPartnerBookingCreate:
    booking_id = None
    price = None

    def test_create_partner_booking(self, hotel_token):
        r = requests.post(f"{API}/company/bookings", json=BOOKING_BODY, headers=_headers(hotel_token), timeout=20)
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["partner_booking"] is True
        assert d["payment_status"] == "invoiced"
        assert d["price"] > 0
        TestPartnerBookingCreate.booking_id = d["id"]
        TestPartnerBookingCreate.price = d["price"]


# ---------------- Commission crediting via direct completion ----------------
class TestCommissionCrediting:
    """Since chauffeur@test.com is docs_blocked, we cannot go through the driver accept/start/complete
    HTTP flow. We reproduce completion the same way the /rides/{id}/complete route does:
    - mark ride status=completed in DB
    - call distribute_partner_commission(ride) — the exact function invoked by the route.
    Then we assert the commission was credited AND is idempotent when called twice.
    """

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_credit_and_idempotency(self, hotel_token):
        from core import db, now_utc
        from routes.referral import distribute_partner_commission, PARTNER_RATE

        assert TestPartnerBookingCreate.booking_id, "partner booking not created — cannot test crediting"
        ride_id = TestPartnerBookingCreate.booking_id
        expected = round(TestPartnerBookingCreate.price * PARTNER_RATE, 2)

        async def scenario():
            # Grab hotel user id + starting wallet
            hotel = await db.users.find_one({"email": HOTEL_EMAIL}, {"_id": 0, "id": 1, "wallet_balance": 1})
            start_balance = round(hotel.get("wallet_balance", 0) or 0, 2)
            hotel_id = hotel["id"]

            # Mark ride completed exactly like /rides/{id}/complete does
            ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
            assert ride, "ride not found in DB"
            assert ride.get("partner_booking") is True
            await db.rides.update_one({"id": ride_id}, {"$set": {"status": "completed", "completed_at": now_utc()}})
            ride["status"] = "completed"

            # First credit
            await distribute_partner_commission(ride)
            fresh = await db.users.find_one({"id": hotel_id}, {"_id": 0, "wallet_balance": 1})
            new_balance = round(fresh.get("wallet_balance", 0) or 0, 2)
            delta = round(new_balance - start_balance, 2)
            assert delta == expected, f"expected +{expected} credit, got +{delta} (start={start_balance}, new={new_balance})"

            # wallet_tx of type partner_commission should exist for this ride
            tx = await db.wallet_tx.find_one({"user_id": hotel_id, "ride_id": ride_id, "type": "partner_commission"}, {"_id": 0})
            assert tx, "partner_commission wallet_tx not found"
            assert tx["amount"] == expected

            # Idempotency: second call must NOT double-credit
            ride2 = await db.rides.find_one({"id": ride_id}, {"_id": 0})
            await distribute_partner_commission(ride2)
            fresh2 = await db.users.find_one({"id": hotel_id}, {"_id": 0, "wallet_balance": 1})
            assert round(fresh2.get("wallet_balance", 0) or 0, 2) == new_balance, "second call double-credited!"

            # ride flagged partner_commission_paid
            r2 = await db.rides.find_one({"id": ride_id}, {"_id": 0})
            assert r2.get("partner_commission_paid") is True
            assert r2.get("partner_commission_amount") == expected

        self._run(scenario())


# ---------------- Monthly statement ----------------
class TestCommissionsEndpoint:
    def test_current_month_statement(self, hotel_token):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/company/commissions?month={month}", headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("balance", "earned", "direct", "network", "count", "lines", "payouts", "rate"):
            assert key in d, f"missing '{key}' in commissions response: {d}"
        assert d["rate"] == 0.05
        assert isinstance(d["lines"], list)
        assert isinstance(d["payouts"], list)
        # After crediting, there must be at least one partner_commission line this month
        pc_lines = [l for l in d["lines"] if l["type"] == "partner_commission"]
        assert len(pc_lines) >= 1, f"expected ≥1 partner_commission line this month, got {d['lines']}"
        assert d["direct"] > 0
        assert d["balance"] >= d["direct"]  # balance includes past + present

    def test_no_month_returns_all(self, hotel_token):
        r = requests.get(f"{API}/company/commissions", headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["label"] == "Toutes périodes"


# ---------------- Payout validation ----------------
class TestPayout:
    def test_amount_below_min_returns_422(self, hotel_token):
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": 5}, headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 422, r.text
        assert "10" in r.text  # message references the 10 € minimum

    def test_amount_above_balance_returns_400(self, hotel_token):
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": 999999}, headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 400, r.text
        assert "insuffisant" in r.text.lower() or "solde" in r.text.lower()

    def test_amount_zero_or_negative_422(self, hotel_token):
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": 0}, headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 422, r.text

    def test_success_debits_wallet(self, hotel_token):
        # Read current balance
        info = requests.get(f"{API}/company/partner", headers=_headers(hotel_token), timeout=10).json()
        balance = float(info["wallet_balance"])
        if balance < 10:
            # Top up via multiple ride completions to reach the 10 € minimum payout threshold
            import asyncio
            from core import db, now_utc
            from routes.referral import distribute_partner_commission

            async def topup():
                for _ in range(3):
                    r = requests.post(f"{API}/company/bookings", json=BOOKING_BODY,
                                      headers=_headers(hotel_token), timeout=15)
                    if r.status_code != 201:
                        return
                    rid = r.json()["id"]
                    ride = await db.rides.find_one({"id": rid}, {"_id": 0})
                    await db.rides.update_one({"id": rid}, {"$set": {"status": "completed", "completed_at": now_utc()}})
                    ride["status"] = "completed"
                    await distribute_partner_commission(ride)
            asyncio.get_event_loop().run_until_complete(topup())
            info = requests.get(f"{API}/company/partner", headers=_headers(hotel_token), timeout=10).json()
            balance = float(info["wallet_balance"])
        if balance < 10:
            pytest.skip(f"could not accumulate ≥10€ wallet balance (got {balance:.2f}€)")
        amount = 10.0
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": amount}, headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert d["amount"] == amount
        assert round(d["balance"], 2) == round(balance - amount, 2)

        # Verify balance really debited
        info2 = requests.get(f"{API}/company/partner", headers=_headers(hotel_token), timeout=10).json()
        assert round(float(info2["wallet_balance"]), 2) == round(balance - amount, 2)

        # Verify statement now shows a payout line
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        stmt = requests.get(f"{API}/company/commissions?month={month}", headers=_headers(hotel_token), timeout=15).json()
        assert any(p["type"] == "payout" and abs(p["amount"] + amount) < 0.01 for p in stmt["payouts"]), stmt["payouts"]


# ---------------- PDF export with ?token= ----------------
class TestPdfExport:
    def test_pdf_export_via_query_token(self, hotel_token):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/company/commissions/export.pdf?month={month}&token={hotel_token}", timeout=20)
        assert r.status_code == 200, r.text[:300]
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, ct
        assert r.content[:4] == b"%PDF", r.content[:20]

    def test_pdf_invalid_month_422(self, hotel_token):
        # The regex ^\d{4}-\d{2}$ is applied first — use a non-matching value
        r = requests.get(f"{API}/company/commissions/export.pdf?month=abcd&token={hotel_token}", timeout=15)
        assert r.status_code == 422

    def test_pdf_without_auth_401(self):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/company/commissions/export.pdf?month={month}", timeout=15)
        assert r.status_code in (401, 403), r.status_code
