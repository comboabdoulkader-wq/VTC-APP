"""Iteration 8 tests: chat, promos, pricing zones, tips."""
import os
import time
import uuid

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

PARIS_PU = {"address": "1 Rue de Rivoli, Paris", "lat": 48.8566, "lng": 2.3522}
PARIS_DO = {"address": "10 Avenue de l'Opéra, Paris", "lat": 48.8700, "lng": 2.3320}


def _token(email: str, password: str = "password123") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login {email}: {r.status_code} {r.text}"
    data = r.json()
    return data.get("access_token") or data.get("token")


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _register(role: str, email: str = None, full_name: str = None):
    email = email or f"TEST_{role}_{uuid.uuid4().hex[:8]}@test.com"
    payload = {
        "email": email, "password": "password123", "full_name": full_name or f"Test {role}",
        "phone": "+33600000000", "role": role,
    }
    if role == "driver":
        payload.update({"vehicle_model": "Peugeot 508", "license_plate": f"AB-{uuid.uuid4().hex[:3].upper()}-CD", "vehicle_type": "standard"})
    if role == "company":
        payload.update({"company_name": f"TEST Co {uuid.uuid4().hex[:5]}"})
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, f"Register {role}: {r.status_code} {r.text}"
    d = r.json()
    return email, d.get("access_token") or d.get("token"), d.get("user", {}).get("id")


def _cleanup_active(tok, role):
    """Complete or cancel any active ride so tests can proceed."""
    if role == "driver":
        r = requests.get(f"{API}/rides/active", headers=_hdr(tok), timeout=15)
        if r.status_code == 200 and r.json():
            rid = r.json()["id"]
            if r.json()["status"] == "in_progress":
                requests.post(f"{API}/rides/{rid}/complete", headers=_hdr(tok), timeout=15)
            else:
                requests.post(f"{API}/rides/{rid}/cancel", headers=_hdr(tok), timeout=15)


@pytest.fixture(scope="module")
def passenger_mod_tok():
    return _token("passager@test.com")


@pytest.fixture(scope="module")
def driver_mod_tok():
    tok = _token("chauffeur@test.com")
    _cleanup_active(tok, "driver")
    # go online
    requests.post(f"{API}/driver/status", json={"is_online": True}, headers=_hdr(tok), timeout=15)
    return tok


@pytest.fixture(scope="module")
def company_tok():
    return _token("entreprise@test.com")


# ---------------- Chat ----------------
class TestChat:
    def test_full_chat_flow(self, passenger_mod_tok, driver_mod_tok):
        # passenger creates ride
        body = {"pickup": PARIS_PU, "dropoff": PARIS_DO, "vehicle_type": "standard", "payment_method": "cash", "surcharge_enabled": True}
        r = requests.post(f"{API}/rides", json=body, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200, r.text
        ride_id = r.json()["id"]

        # driver accepts
        r = requests.post(f"{API}/rides/{ride_id}/accept", headers=_hdr(driver_mod_tok), timeout=15)
        assert r.status_code == 200, r.text

        # passenger sends
        r = requests.post(f"{API}/rides/{ride_id}/messages", json={"text": "Bonjour, j'arrive"}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        assert r.json()["text"] == "Bonjour, j'arrive"

        # driver sends
        r = requests.post(f"{API}/rides/{ride_id}/messages", json={"text": "Ok, j'attends"}, headers=_hdr(driver_mod_tok), timeout=15)
        assert r.status_code == 200

        # unread for driver = 1 (passenger's msg)
        r = requests.get(f"{API}/rides/{ride_id}/messages/unread", headers=_hdr(driver_mod_tok), timeout=15)
        assert r.status_code == 200 and r.json()["unread"] == 1

        # GET messages as driver → resets driver's unread
        r = requests.get(f"{API}/rides/{ride_id}/messages", headers=_hdr(driver_mod_tok), timeout=15)
        assert r.status_code == 200 and len(r.json()) >= 2

        r = requests.get(f"{API}/rides/{ride_id}/messages/unread", headers=_hdr(driver_mod_tok), timeout=15)
        assert r.json()["unread"] == 0

        # third user 404
        _, other_tok, _ = _register("passenger")
        r = requests.get(f"{API}/rides/{ride_id}/messages", headers=_hdr(other_tok), timeout=15)
        assert r.status_code == 404

        # complete ride → posting message → 409
        requests.post(f"{API}/rides/{ride_id}/start", headers=_hdr(driver_mod_tok), timeout=15)
        r = requests.post(f"{API}/rides/{ride_id}/complete", headers=_hdr(driver_mod_tok), timeout=15)
        assert r.status_code == 200
        r = requests.post(f"{API}/rides/{ride_id}/messages", json={"text": "trop tard"}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 409


# ---------------- Promos ----------------
class TestPromos:
    def test_promos_full_flow(self, passenger_mod_tok, company_tok):
        suffix = uuid.uuid4().hex[:5].upper()
        platform_code = f"PLAT{suffix}"
        company_code = f"COMP{suffix}"

        # moderator creates percent platform code (max_uses=1 for later test)
        r = requests.post(f"{API}/promos", json={"code": platform_code, "kind": "percent", "value": 20, "max_uses": 1}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200, r.text
        p_platform = r.json()

        # company creates amount code
        r = requests.post(f"{API}/promos", json={"code": company_code, "kind": "amount", "value": 5}, headers=_hdr(company_tok), timeout=15)
        assert r.status_code == 200, r.text
        p_company = r.json()

        # fresh passenger validates platform OK
        _, fresh_pass_tok, _ = _register("passenger")
        r = requests.post(f"{API}/promos/validate", json={"code": platform_code, "price": 20.0}, headers=_hdr(fresh_pass_tok), timeout=15)
        assert r.status_code == 200 and r.json()["discount"] == 4.0

        # fresh passenger validates company code → 409
        r = requests.post(f"{API}/promos/validate", json={"code": company_code, "price": 20.0}, headers=_hdr(fresh_pass_tok), timeout=15)
        assert r.status_code == 409, r.text

        # passager@test.com (in Acme Conseil) validates company ACME5 (existing)
        r = requests.post(f"{API}/promos/validate", json={"code": "ACME5", "price": 20.0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200, r.text

        # ride with promo_code (platform) → discount & price reduced
        body = {"pickup": PARIS_PU, "dropoff": PARIS_DO, "vehicle_type": "standard", "payment_method": "cash", "surcharge_enabled": True, "promo_code": platform_code}
        r = requests.post(f"{API}/rides", json=body, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200, r.text
        ride = r.json()
        assert ride["promo_code"] == platform_code
        assert ride["discount_amount"] > 0
        expected = round(max(ride["base_price"] + ride["surcharge_amount"] - ride["discount_amount"], 0), 2)
        assert abs(ride["price"] - expected) < 0.02

        # max_uses=1, second use → 409
        r = requests.post(f"{API}/promos/validate", json={"code": platform_code, "price": 20.0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 409, r.text

        # duplicate code create → 409
        r = requests.post(f"{API}/promos", json={"code": platform_code, "kind": "percent", "value": 5}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 409

        # PATCH active false → validate 404
        # first create a new active code for this
        code2 = f"TOGL{suffix}"
        r = requests.post(f"{API}/promos", json={"code": code2, "kind": "percent", "value": 10}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        pid2 = r.json()["id"]
        r = requests.patch(f"{API}/promos/{pid2}", json={"active": False}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200 and r.json()["active"] is False
        r = requests.post(f"{API}/promos/validate", json={"code": code2, "price": 20.0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 404

        # non-privileged driver → 403
        _, fresh_drv_tok, _ = _register("driver")
        r = requests.post(f"{API}/promos", json={"code": f"DRV{suffix}", "kind": "amount", "value": 3}, headers=_hdr(fresh_drv_tok), timeout=15)
        assert r.status_code == 403

        # DELETE
        r = requests.delete(f"{API}/promos/{pid2}", headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        r = requests.delete(f"{API}/promos/{p_platform['id']}", headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        r = requests.delete(f"{API}/promos/{p_company['id']}", headers=_hdr(company_tok), timeout=15)
        assert r.status_code == 200


# ---------------- Pricing zones ----------------
class TestPricingZones:
    def test_paris_multiplier(self, passenger_mod_tok):
        # find Paris
        r = requests.get(f"{API}/admin/cities", headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        paris = next((c for c in r.json() if c["name"] == "Paris"), None)
        assert paris, "Paris city not found"
        paris_id = paris["id"]

        # baseline @1.0
        r = requests.patch(f"{API}/admin/cities/{paris_id}", json={"price_multiplier": 1.0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200 and r.json()["price_multiplier"] == 1.0

        est_body = {"pickup": PARIS_PU, "dropoff": PARIS_DO, "vehicle_type": "standard"}
        r = requests.post(f"{API}/rides/estimate", json=est_body, timeout=15)
        assert r.status_code == 200, r.text
        est1 = r.json()
        price1 = next(o["price"] for o in est1["options"] if o["vehicle_type"] == "standard")
        assert est1["surcharge"]["price_multiplier"] == 1.0

        # set 1.5
        r = requests.patch(f"{API}/admin/cities/{paris_id}", json={"price_multiplier": 1.5}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200 and r.json()["price_multiplier"] == 1.5

        r = requests.post(f"{API}/rides/estimate", json=est_body, timeout=15)
        est2 = r.json()
        price2 = next(o["price"] for o in est2["options"] if o["vehicle_type"] == "standard")
        assert est2["surcharge"]["price_multiplier"] == 1.5
        assert abs(price2 - price1 * 1.5) < 0.05, f"{price2} vs {price1}*1.5"

        # 4.0 invalid → 422
        r = requests.patch(f"{API}/admin/cities/{paris_id}", json={"price_multiplier": 4.0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 422

        # reset to 1.0
        r = requests.patch(f"{API}/admin/cities/{paris_id}", json={"price_multiplier": 1.0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200


# ---------------- Tips ----------------
class TestTips:
    def test_tip_flow(self, passenger_mod_tok, driver_mod_tok):
        _cleanup_active(driver_mod_tok, "driver")
        # create a card ride
        body = {"pickup": PARIS_PU, "dropoff": PARIS_DO, "vehicle_type": "standard", "payment_method": "card", "surcharge_enabled": True}
        r = requests.post(f"{API}/rides", json=body, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]

        assert requests.post(f"{API}/rides/{rid}/accept", headers=_hdr(driver_mod_tok), timeout=15).status_code == 200
        assert requests.post(f"{API}/rides/{rid}/start", headers=_hdr(driver_mod_tok), timeout=15).status_code == 200
        assert requests.post(f"{API}/rides/{rid}/complete", headers=_hdr(driver_mod_tok), timeout=15).status_code == 200

        # rate with tip
        r = requests.post(f"{API}/rides/{rid}/rate", json={"rating": 5, "tip": 3}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        assert r.json()["tip"] == 3

        # tip checkout
        r = requests.post(f"{API}/payments/checkout/{rid}",
                          json={"kind": "tip", "return_url": "https://vtc-platform-18.preview.emergentagent.com/payment-result"},
                          headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200, r.text
        url = r.json().get("checkout_url", "")
        assert url.startswith("https://checkout.stripe.com"), url

        # status
        r = requests.get(f"{API}/payments/status/{rid}?kind=tip", headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "pending"

        # ride with tip=0 → tip checkout 409
        body2 = {"pickup": PARIS_PU, "dropoff": PARIS_DO, "vehicle_type": "standard", "payment_method": "card", "surcharge_enabled": True}
        r = requests.post(f"{API}/rides", json=body2, headers=_hdr(passenger_mod_tok), timeout=15)
        rid2 = r.json()["id"]
        assert requests.post(f"{API}/rides/{rid2}/accept", headers=_hdr(driver_mod_tok), timeout=15).status_code == 200
        assert requests.post(f"{API}/rides/{rid2}/start", headers=_hdr(driver_mod_tok), timeout=15).status_code == 200
        assert requests.post(f"{API}/rides/{rid2}/complete", headers=_hdr(driver_mod_tok), timeout=15).status_code == 200
        r = requests.post(f"{API}/rides/{rid2}/rate", json={"rating": 5, "tip": 0}, headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 200
        r = requests.post(f"{API}/payments/checkout/{rid2}",
                          json={"kind": "tip", "return_url": "https://vtc-platform-18.preview.emergentagent.com/payment-result"},
                          headers=_hdr(passenger_mod_tok), timeout=15)
        assert r.status_code == 409
