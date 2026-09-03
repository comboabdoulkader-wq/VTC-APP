"""Iteration 16 tests: email receipts, Google session, PDF endpoints."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email: str, password: str = "password123") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def passenger_token():
    return _login("passager@test.com")


@pytest.fixture(scope="module")
def driver_token():
    return _login("chauffeur@test.com")


# ---------------- Receipt PDF endpoints ----------------

class TestReceiptPDF:
    def _pick_completed_paid(self, token: str) -> dict | None:
        r = requests.get(f"{API}/rides/mine", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200, r.text
        rides = r.json()
        # Prefer paid-completed
        paid = [x for x in rides if x.get("status") == "completed" and x.get("payment_status") == "paid"]
        if paid:
            return paid[0]
        completed = [x for x in rides if x.get("status") == "completed"]
        return completed[0] if completed else None

    def test_receipt_pdf_with_bearer(self, passenger_token):
        ride = self._pick_completed_paid(passenger_token)
        if not ride:
            pytest.skip("No completed ride available for passager@test.com")
        r = requests.get(f"{API}/rides/{ride['id']}/receipt.pdf",
                         headers={"Authorization": f"Bearer {passenger_token}"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
        assert len(r.content) > 1024, f"PDF too small: {len(r.content)}"
        assert r.content[:4] == b"%PDF", f"Bad PDF magic: {r.content[:8]!r}"

    def test_receipt_pdf_with_query_token(self, passenger_token):
        ride = self._pick_completed_paid(passenger_token)
        if not ride:
            pytest.skip("No completed ride available")
        r = requests.get(f"{API}/rides/{ride['id']}/receipt.pdf?token={passenger_token}", timeout=20)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 1024

    def test_receipt_pdf_non_completed_returns_404(self, passenger_token):
        r = requests.get(f"{API}/rides/mine", headers={"Authorization": f"Bearer {passenger_token}"}, timeout=15)
        rides = r.json()
        non_completed = [x for x in rides if x.get("status") != "completed"]
        if not non_completed:
            pytest.skip("No non-completed ride available")
        rid = non_completed[0]["id"]
        r = requests.get(f"{API}/rides/{rid}/receipt.pdf",
                        headers={"Authorization": f"Bearer {passenger_token}"}, timeout=15)
        assert r.status_code == 404, f"Expected 404 got {r.status_code}: {r.text}"

    def test_send_receipt_test_domain_ok_false(self, passenger_token):
        ride = self._pick_completed_paid(passenger_token)
        if not ride:
            pytest.skip("No completed paid ride")
        r = requests.post(f"{API}/rides/{ride['id']}/send-receipt",
                          headers={"Authorization": f"Bearer {passenger_token}"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Expected: proxy rejects @test.com so ok:false, email echoed back
        assert body.get("email") == "passager@test.com", body
        assert body.get("ok") in (False, True), body
        # Per requirements it should be False for @test.com
        assert body["ok"] is False, f"Expected ok:false for @test.com recipient, got {body}"


class TestSignedPublicReceipt:
    def test_bad_signature_forbidden(self, passenger_token):
        # Any ride id works — endpoint checks sig before touching DB
        r = requests.get(f"{API}/receipts/{uuid.uuid4()}.pdf?sig=bad", timeout=15)
        assert r.status_code == 403, f"Expected 403 got {r.status_code}: {r.text}"


# ---------------- Google session ----------------

class TestGoogleSession:
    def test_invalid_session_id_401(self):
        r = requests.post(f"{API}/auth/session", json={"session_id": "invalid-abc", "role": "passenger"}, timeout=20)
        assert r.status_code == 401, f"Expected 401 got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert "Google" in detail or "invalide" in detail.lower(), detail

    def test_missing_body_422(self):
        r = requests.post(f"{API}/auth/session", json={}, timeout=15)
        assert r.status_code == 422, f"Expected 422 got {r.status_code}: {r.text}"


# ---------------- Auto-send via delivered@resend.dev ----------------

class TestAutoSendReceipt:
    """Register a deliverable passenger, run a full ride cash flow, expect receipt_sent_at set."""

    @pytest.fixture(scope="class")
    def deliverable_passenger_token(self):
        email = "delivered@resend.dev"
        # Try login first (already registered)
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": "password123"}, timeout=15)
        if r.status_code == 200:
            return r.json()["access_token"]
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "password123", "full_name": "Receipt Test", "role": "passenger"
        }, timeout=15)
        assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
        return r.json()["access_token"]

    def test_full_cash_ride_flow_triggers_receipt(self, deliverable_passenger_token, driver_token):
        pax_hdr = {"Authorization": f"Bearer {deliverable_passenger_token}"}
        drv_hdr = {"Authorization": f"Bearer {driver_token}"}

        # Ensure driver is online
        r = requests.post(f"{API}/driver/status", json={"is_online": True}, headers=drv_hdr, timeout=15)
        # 423 could mean docs_blocked; allow proceeding if 200 else skip
        if r.status_code == 423:
            pytest.skip(f"Driver is docs_blocked: {r.text}")
        assert r.status_code == 200, r.text

        # Create a simple ride (cash)
        payload = {
            "pickup": {"address": "Châtelet, Paris", "lat": 48.8583, "lng": 2.3472},
            "dropoff": {"address": "Gare de Lyon, Paris", "lat": 48.8443, "lng": 2.3742},
            "payment_method": "cash",
            "vehicle_type": "standard",
        }
        r = requests.post(f"{API}/rides", json=payload, headers=pax_hdr, timeout=20)
        assert r.status_code in (200, 201), f"Create ride failed: {r.status_code} {r.text}"
        ride = r.json()
        ride_id = ride["id"]

        # Driver: list available and accept
        r = requests.get(f"{API}/rides/available", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, r.text
        available_ids = [x["id"] for x in r.json()]
        if ride_id not in available_ids:
            # Maybe already picked up or filter mismatch; try to accept anyway
            pass

        r = requests.post(f"{API}/rides/{ride_id}/accept", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, f"Accept failed: {r.status_code} {r.text}"

        r = requests.post(f"{API}/rides/{ride_id}/start", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, f"Start failed: {r.status_code} {r.text}"

        r = requests.post(f"{API}/rides/{ride_id}/complete", headers=drv_hdr, timeout=30)
        assert r.status_code == 200, f"Complete failed: {r.status_code} {r.text}"

        # Wait briefly for async receipt send
        time.sleep(4)
        r = requests.get(f"{API}/rides/{ride_id}", headers=pax_hdr, timeout=15)
        assert r.status_code == 200, r.text
        ride_after = r.json()
        assert ride_after.get("status") == "completed", ride_after
        assert ride_after.get("payment_status") == "paid", f"payment_status not paid: {ride_after.get('payment_status')}"
        # receipt_sent_at is not exposed via RideOut → verify directly in MongoDB
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _check():
            c = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db = c[os.environ.get("DB_NAME", "test_database")]
            return await db.rides.find_one(
                {"id": ride_id}, {"_id": 0, "receipt_sent_at": 1, "receipt_email_id": 1}
            )

        info = asyncio.run(_check())
        assert info and info.get("receipt_sent_at"), f"receipt_sent_at missing in DB: {info}"
        assert info.get("receipt_email_id"), f"receipt_email_id missing (proxy call may have failed): {info}"
