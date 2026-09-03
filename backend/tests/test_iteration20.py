"""Iteration 20 — Admin payouts (versements), partner ranking, signed statement PDF."""
import asyncio
import hashlib
import hmac
import os
import sys
from datetime import datetime, timezone

import pytest
import requests

sys.path.insert(0, "/app/backend")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

HOTEL_EMAIL = "hotel.ritz@test.com"
DRIVER_EMAIL = "chauffeur@test.com"


def _login(email, password="password123"):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def hotel_token():
    r = _login(HOTEL_EMAIL)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def moderator_token():
    r = _login(DRIVER_EMAIL)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hotel_id(hotel_token):
    return requests.get(f"{API}/auth/me", headers=_h(hotel_token), timeout=10).json()["id"]


# ---------- Wallet top-up helper (hotel may have depleted balance from prior tests) ----------
def _ensure_hotel_balance(hotel_token, need=30.0):
    info = requests.get(f"{API}/company/partner", headers=_h(hotel_token), timeout=10).json()
    balance = float(info.get("wallet_balance", 0) or 0)
    if balance >= need:
        return balance
    from core import db, now_utc
    from routes.referral import distribute_partner_commission

    booking = {
        "pickup": {"lat": 48.8681, "lng": 2.3292, "address": "Hôtel Ritz Paris"},
        "dropoff": {"lat": 49.0097, "lng": 2.5479, "address": "CDG"},
        "vehicle_type": "premium", "service_type": "airport",
        "passengers": 2, "luggage": 3,
        "guest_name": "TEST_Iter20 Guest", "guest_phone": "06 55 66 77 89", "room": "202",
    }

    async def topup():
        for _ in range(8):
            r = requests.post(f"{API}/company/bookings", json=booking, headers=_h(hotel_token), timeout=15)
            if r.status_code != 201:
                return
            rid = r.json()["id"]
            ride = await db.rides.find_one({"id": rid}, {"_id": 0})
            await db.rides.update_one({"id": rid}, {"$set": {"status": "completed", "completed_at": now_utc()}})
            ride["status"] = "completed"
            await distribute_partner_commission(ride)
            info2 = requests.get(f"{API}/company/partner", headers=_h(hotel_token), timeout=10).json()
            if float(info2.get("wallet_balance", 0) or 0) >= need:
                return
    asyncio.get_event_loop().run_until_complete(topup())
    info = requests.get(f"{API}/company/partner", headers=_h(hotel_token), timeout=10).json()
    return float(info.get("wallet_balance", 0) or 0)


# ---------- Payout lifecycle ----------
class TestPayoutRequest:
    def test_below_min_returns_422(self, hotel_token):
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": 5}, headers=_h(hotel_token), timeout=10)
        assert r.status_code == 422, r.text

    def test_above_balance_returns_400(self, hotel_token):
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": 999999}, headers=_h(hotel_token), timeout=10)
        assert r.status_code == 400, r.text

    def test_valid_debits_wallet_and_creates_pending_row(self, hotel_token, hotel_id):
        bal = _ensure_hotel_balance(hotel_token, need=15.0)
        if bal < 10:
            pytest.skip(f"cannot reach 10 EUR balance for payout (got {bal:.2f})")
        r = requests.post(f"{API}/company/wallet/payout", json={"amount": 10}, headers=_h(hotel_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        # Verify a pending payout row exists
        from core import db as _db
        async def _find():
            return await _db.payouts.find_one({"user_id": hotel_id, "amount": 10, "status": "pending"}, {"_id": 0}, sort=[("created_at", -1)])
        row = asyncio.get_event_loop().run_until_complete(_find())
        assert row is not None, "expected a pending payout row for this user"
        assert row["status"] == "pending"
        TestPayoutRequest.pending_id = row["id"]


# ---------- Admin list ----------
class TestAdminList:
    def test_moderator_can_list_pending(self, moderator_token):
        r = requests.get(f"{API}/company/admin/payouts?status=pending", headers=_h(moderator_token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("payouts", "pending_count", "pending_total"):
            assert k in d
        assert isinstance(d["payouts"], list)
        assert d["pending_count"] >= 1  # from previous test
        # each payout in pending list has status=pending
        for p in d["payouts"]:
            assert p["status"] == "pending"

    def test_non_moderator_is_403(self, hotel_token):
        r = requests.get(f"{API}/company/admin/payouts", headers=_h(hotel_token), timeout=10)
        assert r.status_code == 403, r.text


# ---------- Admin decision ----------
class TestAdminDecision:
    def test_paid_then_conflict_and_reject_refunds(self, hotel_token, moderator_token, hotel_id):
        # Create two fresh pending payouts (need enough balance)
        bal = _ensure_hotel_balance(hotel_token, need=30.0)
        if bal < 20:
            pytest.skip(f"cannot reach 20 EUR balance (got {bal:.2f})")
        r1 = requests.post(f"{API}/company/wallet/payout", json={"amount": 10}, headers=_h(hotel_token), timeout=10)
        r2 = requests.post(f"{API}/company/wallet/payout", json={"amount": 10}, headers=_h(hotel_token), timeout=10)
        assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)

        # Get pending ids
        lst = requests.get(f"{API}/company/admin/payouts?status=pending", headers=_h(moderator_token), timeout=10).json()["payouts"]
        mine = [p for p in lst if p["amount"] == 10][:2]
        assert len(mine) >= 2, mine
        pay_id, rej_id = mine[0]["id"], mine[1]["id"]

        # Mark as paid
        rp = requests.patch(f"{API}/company/admin/payouts/{pay_id}", json={"status": "paid"}, headers=_h(moderator_token), timeout=10)
        assert rp.status_code == 200, rp.text
        assert rp.json()["status"] == "paid"

        # Re-decide same id -> 409
        rp2 = requests.patch(f"{API}/company/admin/payouts/{pay_id}", json={"status": "paid"}, headers=_h(moderator_token), timeout=10)
        assert rp2.status_code == 409, rp2.text

        # Record balance before reject to verify refund
        bal_before = float(requests.get(f"{API}/company/partner", headers=_h(hotel_token), timeout=10).json()["wallet_balance"])

        # Reject the other -> wallet is refunded
        rr = requests.patch(f"{API}/company/admin/payouts/{rej_id}", json={"status": "rejected"}, headers=_h(moderator_token), timeout=10)
        assert rr.status_code == 200, rr.text
        assert rr.json()["status"] == "rejected"

        bal_after = float(requests.get(f"{API}/company/partner", headers=_h(hotel_token), timeout=10).json()["wallet_balance"])
        assert round(bal_after - bal_before, 2) == 10.0, f"expected +10 EUR refund, got {bal_after - bal_before:.2f}"

        # And a wallet_tx of type payout_refund exists
        from core import db as _db
        async def _tx():
            return await _db.wallet_tx.find_one({"user_id": hotel_id, "type": "payout_refund"}, {"_id": 0}, sort=[("created_at", -1)])
        tx = asyncio.get_event_loop().run_until_complete(_tx())
        assert tx is not None, "expected payout_refund wallet_tx"
        assert tx["amount"] == 10.0


# ---------- Ranking ----------
class TestRanking:
    def test_ranking_shape(self, hotel_token):
        r = requests.get(f"{API}/company/ranking", headers=_h(hotel_token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("rank", "total_partners", "commissioned_partners", "my_total", "leaderboard", "best_months"):
            assert k in d, d
        assert isinstance(d["leaderboard"], list)
        assert isinstance(d["best_months"], list)
        assert d["my_total"] > 0  # hotel.ritz has seeded commissions
        assert d["rank"] >= 1


# ---------- Signed statement PDF ----------
class TestSignedStatement:
    def _sig(self, uid: str, month: str) -> str:
        from core import JWT_SECRET
        return hmac.new(JWT_SECRET.encode(), f"statement:{uid}:{month}".encode(), hashlib.sha256).hexdigest()[:32]

    def test_valid_sig_returns_pdf(self, hotel_id):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        sig = self._sig(hotel_id, month)
        r = requests.get(f"{API}/company/commission-statements/{hotel_id}.pdf?month={month}&sig={sig}", timeout=15)
        assert r.status_code == 200, r.text[:300]
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"

    def test_bad_sig_returns_403(self, hotel_id):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/company/commission-statements/{hotel_id}.pdf?month={month}&sig=deadbeef", timeout=15)
        assert r.status_code == 403, r.text

    def test_missing_sig_returns_403(self, hotel_id):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/company/commission-statements/{hotel_id}.pdf?month={month}", timeout=15)
        assert r.status_code == 403, r.text


# ---------- Monthly email code path exists ----------
class TestEmailCodePath:
    def test_monthly_sweep_importable_and_callable(self):
        from routes.company import monthly_statement_sweep
        # just verify it's a coroutine function; do not actually run in test env
        assert asyncio.iscoroutinefunction(monthly_statement_sweep)

    def test_send_partner_statement_importable(self):
        from emailer import send_partner_statement
        assert asyncio.iscoroutinefunction(send_partner_statement)
