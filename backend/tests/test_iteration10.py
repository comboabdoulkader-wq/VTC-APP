"""Iteration 10 tests: phone OTP, wallet payment, security hardening, PATCH /auth/me, password change."""
import os
import time
import uuid

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

PASS_EMAIL = "passager@test.com"
PASS_PWD = "password123"
DRIVER_EMAIL = "chauffeur@test.com"
COMPANY_EMAIL = "entreprise@test.com"


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="session")
def s():
    return requests.Session()


def _login(s, email, pwd=PASS_PWD):
    r = s.post(f"{BASE_URL}/auth/login", json={"email": email, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def passenger_token(s):
    return _login(s, PASS_EMAIL)["access_token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- BACKEND TESTS ----------------

class TestLogin:
    def test_login_contains_new_fields(self, s, passenger_token):
        r = s.get(f"{BASE_URL}/auth/me", headers=_auth(passenger_token))
        assert r.status_code == 200
        u = r.json()
        assert "phone_verified" in u
        assert "sms_enabled" in u
        assert "wallet_balance" in u
        assert u["email"] == PASS_EMAIL


class TestSecurityHeaders:
    def test_security_headers_present(self, s, passenger_token):
        r = s.get(f"{BASE_URL}/auth/phone/status", headers=_auth(passenger_token))
        assert r.headers.get("x-content-type-options", "").lower() == "nosniff"
        assert r.headers.get("x-frame-options", "").upper() == "DENY"


class TestPhoneStatus:
    def test_phone_status_shape(self, s, passenger_token):
        r = s.get(f"{BASE_URL}/auth/phone/status", headers=_auth(passenger_token))
        assert r.status_code == 200
        d = r.json()
        assert "phone" in d and "verified" in d and "sms_enabled" in d
        assert d["sms_configured"] is False


class TestPhoneSendCode:
    """Rate limit uses a fresh user to avoid poisoning passager@test.com's slot."""

    @pytest.fixture(scope="class")
    def fresh_user(self, s):
        email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{BASE_URL}/auth/register", json={
            "email": email, "password": "password123",
            "full_name": "Test OTP", "role": "passenger",
        })
        assert r.status_code == 200, r.text
        return r.json()["access_token"], email

    def test_send_code_valid(self, s, fresh_user):
        tok, _ = fresh_user
        r = s.post(f"{BASE_URL}/auth/phone/send-code", json={"phone": "06 12 34 56 78"}, headers=_auth(tok))
        assert r.status_code == 200
        d = r.json()
        assert d["phone"] == "+33612345678"
        assert d["delivered"] is False
        assert "dev_code" in d and len(d["dev_code"]) == 6 and d["dev_code"].isdigit()

    def test_send_code_invalid_phone(self, s, fresh_user):
        tok, _ = fresh_user
        r = s.post(f"{BASE_URL}/auth/phone/send-code", json={"phone": "123"}, headers=_auth(tok))
        assert r.status_code == 422

    def test_send_code_rate_limit(self, s, fresh_user):
        tok, _ = fresh_user
        # already 1 call above (successful). Two more to reach 3, then the 4th → 429.
        for _ in range(2):
            r = s.post(f"{BASE_URL}/auth/phone/send-code", json={"phone": "06 12 34 56 78"}, headers=_auth(tok))
            assert r.status_code == 200
        r = s.post(f"{BASE_URL}/auth/phone/send-code", json={"phone": "06 12 34 56 78"}, headers=_auth(tok))
        assert r.status_code == 429


class TestPhoneVerify:
    @pytest.fixture(scope="class")
    def fresh_user_with_code(self, s):
        email = f"TEST_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{BASE_URL}/auth/register", json={
            "email": email, "password": "password123",
            "full_name": "Verify User", "role": "passenger",
        })
        tok = r.json()["access_token"]
        r = s.post(f"{BASE_URL}/auth/phone/send-code", json={"phone": "+33698765432"}, headers=_auth(tok))
        assert r.status_code == 200
        return tok, r.json()["dev_code"]

    def test_verify_wrong_code(self, s, fresh_user_with_code):
        tok, _ = fresh_user_with_code
        r = s.post(f"{BASE_URL}/auth/phone/verify", json={"code": "000000"}, headers=_auth(tok))
        assert r.status_code == 400
        assert "incorrect" in r.json()["detail"].lower()

    def test_verify_correct_code(self, s, fresh_user_with_code):
        tok, code = fresh_user_with_code
        r = s.post(f"{BASE_URL}/auth/phone/verify", json={"code": code}, headers=_auth(tok))
        assert r.status_code == 200
        assert r.json()["phone_verified"] is True


class TestPatchMe:
    def test_patch_sms_enabled(self, s, passenger_token):
        r = s.patch(f"{BASE_URL}/auth/me", json={"sms_enabled": False}, headers=_auth(passenger_token))
        assert r.status_code == 200
        assert r.json()["sms_enabled"] is False
        r = s.patch(f"{BASE_URL}/auth/me", json={"sms_enabled": True}, headers=_auth(passenger_token))
        assert r.json()["sms_enabled"] is True

    def test_patch_full_name(self, s, passenger_token):
        r = s.patch(f"{BASE_URL}/auth/me", json={"full_name": "X"}, headers=_auth(passenger_token))
        assert r.status_code == 200
        assert r.json()["full_name"] == "X"
        # revert
        r = s.patch(f"{BASE_URL}/auth/me", json={"full_name": "Passager"}, headers=_auth(passenger_token))
        assert r.json()["full_name"] == "Passager"

    def test_patch_phone_resets_verified(self, s, mongo, passenger_token):
        r = s.patch(f"{BASE_URL}/auth/me", json={"phone": "+33700000000"}, headers=_auth(passenger_token))
        assert r.status_code == 200
        assert r.json()["phone_verified"] is False
        # revert: restore phone + verified flag directly in Mongo
        mongo.users.update_one({"email": PASS_EMAIL}, {"$set": {"phone": "+33612345678", "phone_verified": True}})


class TestPasswordChange:
    def test_wrong_current(self, s, passenger_token):
        r = s.post(f"{BASE_URL}/auth/password", json={
            "current_password": "wrongpwd", "new_password": "password9999"
        }, headers=_auth(passenger_token))
        assert r.status_code == 401

    def test_change_and_revert(self, s, passenger_token):
        r = s.post(f"{BASE_URL}/auth/password", json={
            "current_password": "password123", "new_password": "password1234"
        }, headers=_auth(passenger_token))
        assert r.status_code == 200
        # login with new password (fresh session)
        s2 = requests.Session()
        r = s2.post(f"{BASE_URL}/auth/login", json={"email": PASS_EMAIL, "password": "password1234"})
        assert r.status_code == 200
        tok2 = r.json()["access_token"]
        # revert
        r = s2.post(f"{BASE_URL}/auth/password", json={
            "current_password": "password1234", "new_password": "password123"
        }, headers=_auth(tok2))
        assert r.status_code == 200


class TestRegister:
    def test_short_password_422(self, s):
        r = s.post(f"{BASE_URL}/auth/register", json={
            "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com",
            "password": "abc", "full_name": "X", "role": "passenger"
        })
        assert r.status_code == 422

    def test_register_with_referral(self, s, passenger_token):
        # Get referral code of sponsor
        w = s.get(f"{BASE_URL}/wallet", headers=_auth(passenger_token))
        assert w.status_code == 200
        code = w.json()["referral_code"]
        before = w.json()["referrals_count"]
        # Register a new passenger with that referral code
        r = s.post(f"{BASE_URL}/auth/register", json={
            "email": f"TEST_{uuid.uuid4().hex[:8]}@example.com",
            "password": "password123", "full_name": "Filleul", "role": "passenger",
            "phone": "+33611112222", "referral_code": code,
        })
        assert r.status_code == 200, r.text
        # Check referrals_count incremented
        w2 = s.get(f"{BASE_URL}/wallet", headers=_auth(passenger_token))
        assert w2.json()["referrals_count"] == before + 1


class TestLoginBruteForce:
    def test_9_failed_logins_last_429(self, s):
        # Use unique non-existent email to isolate limiter
        bogus = f"noone_{uuid.uuid4().hex[:8]}@example.com"
        codes = []
        for _ in range(9):
            r = s.post(f"{BASE_URL}/auth/login", json={"email": bogus, "password": "wrong"})
            codes.append(r.status_code)
        assert codes[-1] == 429, codes


class TestWalletPayment:
    def test_wallet_ride_flow(self, s, mongo, passenger_token):
        # Credit passenger wallet to 5.0€
        mongo.users.update_one({"email": PASS_EMAIL}, {"$set": {"wallet_balance": 5.0}})
        tok = passenger_token
        payload = {
            "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris"},
            "dropoff": {"lat": 48.87, "lng": 2.36, "address": "Gare du Nord"},
            "vehicle_type": "standard",
            "use_wallet": True,
        }
        r = s.post(f"{BASE_URL}/rides", json=payload, headers=_auth(tok))
        assert r.status_code == 200, r.text
        ride = r.json()
        price = ride["price"]
        expected_wallet = round(min(5.0, price), 2)
        assert ride["wallet_amount"] == expected_wallet
        assert ride["due_amount"] == round(price - expected_wallet, 2)
        # wallet decreased
        w = s.get(f"{BASE_URL}/wallet", headers=_auth(tok)).json()
        assert w["balance"] == round(5.0 - expected_wallet, 2)
        assert any(t["type"] == "ride_payment" for t in w["transactions"])
        # cancel to refund
        rc = s.post(f"{BASE_URL}/rides/{ride['id']}/cancel", headers=_auth(tok))
        assert rc.status_code == 200
        w2 = s.get(f"{BASE_URL}/wallet", headers=_auth(tok)).json()
        assert any(t["type"] == "refund" for t in w2["transactions"])
        # cleanup: force balance to 0
        mongo.users.update_one({"email": PASS_EMAIL}, {"$set": {"wallet_balance": 0.0}})


class TestSMSDoesNotBreakDriverFlow:
    def test_driver_accept_start_complete_with_verified_phone(self, s, mongo, passenger_token):
        # ensure passenger phone verified
        mongo.users.update_one({"email": PASS_EMAIL}, {"$set": {"phone_verified": True, "phone": "+33612345678"}})
        p_tok = passenger_token
        d_tok = _login(s, DRIVER_EMAIL)["access_token"]
        # Passenger creates a ride
        r = s.post(f"{BASE_URL}/rides", json={
            "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris"},
            "dropoff": {"lat": 48.87, "lng": 2.36, "address": "Gare du Nord"},
            "vehicle_type": "standard",
        }, headers=_auth(p_tok))
        assert r.status_code == 200, r.text
        ride_id = r.json()["id"]
        # Driver online
        s.post(f"{BASE_URL}/driver/status", json={"is_online": True, "lat": 48.85, "lng": 2.35}, headers=_auth(d_tok))
        # Accept
        r = s.post(f"{BASE_URL}/rides/{ride_id}/accept", headers=_auth(d_tok))
        assert r.status_code == 200, r.text
        # Start
        r = s.post(f"{BASE_URL}/rides/{ride_id}/start", headers=_auth(d_tok))
        assert r.status_code == 200
        # Complete
        r = s.post(f"{BASE_URL}/rides/{ride_id}/complete", headers=_auth(d_tok))
        assert r.status_code == 200
        assert r.json()["status"] == "completed"
