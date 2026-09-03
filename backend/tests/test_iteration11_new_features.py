"""Iteration 11 - new features:
 - Forgot password by SMS OTP (/api/auth/forgot-password, /api/auth/reset-password)
 - Push registration guardrails (/api/register-push)
 - Ride tracking-link SMS + push logs on driver accept
"""
import os
import secrets
import time

import pytest
import requests

from pathlib import Path
def _load_public_url() -> str:
    env = Path("/app/frontend/.env")
    for line in env.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not found in /app/frontend/.env")

BASE = _load_public_url() + "/api"

PASSENGER = {"email": "passager@test.com", "password": "password123"}
DRIVER = {"email": "chauffeur@test.com", "password": "password123"}


# -------- fixtures --------
@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _login(s, creds):
    r = s.post(f"{BASE}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"], r.json()["user"]


@pytest.fixture(scope="module")
def passenger_token(s):
    tok, _ = _login(s, PASSENGER)
    return tok


@pytest.fixture(scope="module")
def driver_token(s):
    tok, _ = _login(s, DRIVER)
    return tok


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# -------- FRONTEND FLOW GUARD: run forgot-password backend flow FIRST so
# passenger's forgot quota (3/10min) is not exhausted. Keep to <=1 code use.


# ---- register-push guardrails ----
class TestRegisterPush:
    def test_register_push_requires_auth(self, s):
        r = s.post(f"{BASE}/register-push",
                   json={"user_id": "x", "platform": "android", "device_token": "abcdefghijkl"},
                   timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_register_push_web_rejected_by_pydantic(self, s, passenger_token):
        r = s.post(f"{BASE}/register-push",
                   headers=_auth(passenger_token),
                   json={"user_id": "x", "platform": "web", "device_token": "abcdefghijkl"},
                   timeout=15)
        assert r.status_code == 422, r.text

    def test_register_push_relay_placeholder_returns_500(self, s, passenger_token):
        # With placeholder EMERGENT_PUSH_KEY, relay returns 401 → our route maps to 500
        r = s.post(f"{BASE}/register-push",
                   headers=_auth(passenger_token),
                   json={"user_id": "ignored", "platform": "android", "device_token": "abcdefghijkl"},
                   timeout=20)
        # We expect the endpoint to be reached & protected. Accept 500 (relay 401 → mapped) or 502 (relay 5xx).
        assert r.status_code in (500, 502), r.text


# ---- Reset password short new_password ----
class TestResetPasswordValidation:
    def test_reset_password_short_password_422(self, s):
        r = s.post(f"{BASE}/auth/reset-password",
                   json={"identifier": "passager@test.com", "code": "000000", "new_password": "short"},
                   timeout=15)
        assert r.status_code == 422, r.text


# ---- Forgot password: use a fresh throwaway user (passenger quota kept for the frontend flow) ----
class TestForgotPasswordFlow:
    def test_forgot_unknown_email_404(self, s):
        r = s.post(f"{BASE}/auth/forgot-password",
                   json={"identifier": f"nobody_{secrets.token_hex(3)}@example.com"},
                   timeout=15)
        assert r.status_code == 404

    @pytest.fixture(scope="class")
    def fresh_user(self, s):
        email = f"TEST_forgot_{secrets.token_hex(4)}@example.com"
        phone = f"+3361{secrets.randbelow(10**8):08d}"  # unique FR mobile
        pwd = "password123"
        r = s.post(f"{BASE}/auth/register",
                   json={"email": email, "password": pwd, "full_name": "TEST Forgot",
                         "role": "passenger", "phone": phone},
                   timeout=15)
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        # Send + verify OTP so the user has a verified phone
        r = s.post(f"{BASE}/auth/phone/send-code",
                   headers=_auth(tok), json={"phone": phone}, timeout=15)
        assert r.status_code == 200, r.text
        otp = r.json()["dev_code"]
        r = s.post(f"{BASE}/auth/phone/verify",
                   headers=_auth(tok), json={"code": otp}, timeout=15)
        assert r.status_code == 200, r.text
        return {"email": email, "phone": phone, "password": pwd, "token": tok}

    def test_forgot_flow_full(self, s, fresh_user):
        email = fresh_user["email"]
        r = s.post(f"{BASE}/auth/forgot-password", json={"identifier": email}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body.get("masked_phone")
        assert body["delivered"] is False
        assert body["expires_in_min"] == 10
        code = body["dev_code"]
        assert len(code) == 6

        # wrong code
        r = s.post(f"{BASE}/auth/reset-password",
                   json={"identifier": email, "code": "999999", "new_password": "password1234"},
                   timeout=15)
        assert r.status_code == 400
        assert "Code incorrect" in r.json().get("detail", "")

        # correct code
        r = s.post(f"{BASE}/auth/reset-password",
                   json={"identifier": email, "code": code, "new_password": "password1234"},
                   timeout=15)
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

        # login with new password
        r = s.post(f"{BASE}/auth/login",
                   json={"email": email, "password": "password1234"}, timeout=15)
        assert r.status_code == 200

    def test_forgot_password_reused_code_400(self, s, fresh_user):
        # After a successful reset the OTP was $unset → reset returns 400 "Aucun code en attente"
        r = s.post(f"{BASE}/auth/reset-password",
                   json={"identifier": fresh_user["email"], "code": "111111", "new_password": "password1234"},
                   timeout=15)
        assert r.status_code == 400

    def test_forgot_phone_identifier_works(self, s, fresh_user):
        # Second forgot request for the same fresh user → still under 3/10min quota
        r = s.post(f"{BASE}/auth/forgot-password",
                   json={"identifier": fresh_user["phone"]}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("dev_code")

    def test_forgot_rate_limit_429(self, s):
        # Fresh identifier just for this test to guarantee a clean rate-limit window.
        email = f"TEST_rl_{secrets.token_hex(4)}@example.com"
        phone = f"+3361{secrets.randbelow(10**8):08d}"
        r = s.post(f"{BASE}/auth/register",
                   json={"email": email, "password": "password123", "full_name": "TEST RL",
                         "role": "passenger", "phone": phone}, timeout=15)
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        r = s.post(f"{BASE}/auth/phone/send-code", headers=_auth(tok), json={"phone": phone}, timeout=15)
        assert r.status_code == 200
        otp = r.json()["dev_code"]
        r = s.post(f"{BASE}/auth/phone/verify", headers=_auth(tok), json={"code": otp}, timeout=15)
        assert r.status_code == 200
        # 3 requests allowed, 4th trips 429 (per-identifier 3/600s)
        for _ in range(3):
            r = s.post(f"{BASE}/auth/forgot-password", json={"identifier": email}, timeout=15)
            assert r.status_code == 200, r.text
        r = s.post(f"{BASE}/auth/forgot-password", json={"identifier": email}, timeout=15)
        assert r.status_code == 429, r.text


# ---- Ride flow: log sanity check for SMS tracking link + push new-ride ----
class TestRideAcceptTrackingSMS:
    def test_ride_accept_logs_tracking_and_push(self, s, passenger_token, driver_token):
        # Ensure driver online
        r = s.post(f"{BASE}/driver/status",
                   headers=_auth(driver_token),
                   json={"is_online": True, "lat": 43.6, "lng": 3.88},
                   timeout=15)
        assert r.status_code == 200, r.text

        # Passenger creates a ride
        pickup = {"lat": 43.6108, "lng": 3.8767, "address": "Place de la Comédie, Montpellier"}
        dropoff = {"lat": 43.6047, "lng": 3.8802, "address": "Gare Saint-Roch, Montpellier"}
        r = s.post(f"{BASE}/rides",
                   headers=_auth(passenger_token),
                   json={"pickup": pickup, "dropoff": dropoff, "vehicle_type": "standard",
                         "payment_method": "cash", "surcharge_enabled": False},
                   timeout=20)
        assert r.status_code == 200, r.text
        ride = r.json()
        ride_id = ride["id"]

        # Driver accepts
        r = s.post(f"{BASE}/rides/{ride_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text

        # Give the async SMS/log a moment to flush
        time.sleep(1.5)

        # Verify tracking link and push logs in backend.err.log
        try:
            with open("/var/log/supervisor/backend.err.log", "r") as fh:
                # tail-like
                data = fh.read()[-40000:]
        except FileNotFoundError:
            pytest.skip("backend.err.log not available in this environment")

        assert "SMS (non envoyé" in data, "Expected an SMS log line for tracking link"
        assert "Suivez-le en direct" in data, "Expected the tracking link SMS body"
        assert "/track/" in data, "Expected /track/ URL in the SMS log"
        assert "Push (non envoyé" in data, "Expected a Push (non envoyé) log for new ride/notify"

        # Start & complete for cleanup
        r = s.post(f"{BASE}/rides/{ride_id}/start", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        r = s.post(f"{BASE}/rides/{ride_id}/complete", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
