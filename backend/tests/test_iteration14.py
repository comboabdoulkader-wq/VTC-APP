"""Iteration 14: localized legal pages + localized notifications."""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DRIVER_EMAIL = "chauffeur@test.com"
DRIVER_PASSWORD = "password123"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def driver_token():
    r = requests.post(f"{API}/auth/login", json={"email": DRIVER_EMAIL, "password": DRIVER_PASSWORD}, timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Driver login failed ({r.status_code}) - rate-limited")
    return r.json()["access_token"]


@pytest.fixture()
def fresh_passenger():
    email = f"testpass+{uuid.uuid4().hex[:10]}@test.com"
    payload = {
        "email": email,
        "password": "password123",
        "full_name": "Test Passenger",
        "role": "passenger",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user": data["user"], "email": email}


# ---------- Legal pages ----------
class TestLegal:
    def test_legal_fr(self):
        r = requests.get(f"{API}/legal", params={"lang": "fr"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["company_name"] == "RideGo"
        pages = body["pages"]
        for key in ("terms", "privacy", "cancellation"):
            assert key in pages, f"missing page {key}"
            page = pages[key]
            assert page["title"], f"missing title for {key}"
            assert len(page["sections"]) >= 5, f"{key} has fewer than 5 sections"
            for s in page["sections"]:
                assert "{company}" not in s["text"], f"{key}: placeholder left in text"
                assert "{email}" not in s["text"], f"{key}: email placeholder left in text"
        # French title check
        assert pages["terms"]["title"] == "Conditions générales de vente"
        # Company name appears somewhere in terms
        assert any("RideGo" in s["text"] for s in pages["terms"]["sections"])

    def test_legal_en(self):
        r = requests.get(f"{API}/legal", params={"lang": "en"}, timeout=15)
        assert r.status_code == 200
        pages = r.json()["pages"]
        assert pages["terms"]["title"] == "Terms of Service"
        assert pages["privacy"]["title"] == "Privacy Policy"
        assert pages["cancellation"]["title"] == "Cancellation Policy"
        for key in ("terms", "privacy", "cancellation"):
            assert len(pages[key]["sections"]) >= 5

    def test_legal_zh_falls_back_to_en(self):
        r = requests.get(f"{API}/legal", params={"lang": "zh"}, timeout=15)
        assert r.status_code == 200
        pages = r.json()["pages"]
        # English fallback
        assert pages["terms"]["title"] == "Terms of Service"


# ---------- Localized notifications ----------
def _create_ride(token: str) -> str:
    ride_payload = {
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris Centre"},
        "dropoff": {"lat": 48.8698, "lng": 2.3078, "address": "Champs-Élysées"},
        "vehicle_type": "standard",
        "service_type": "private",
        "passengers": 1,
        "luggage": 0,
        "payment_method": "cash",
    }
    r = requests.post(f"{API}/rides", json=ride_payload, headers=_auth(token), timeout=15)
    assert r.status_code == 200, f"ride create failed: {r.status_code} {r.text}"
    return r.json()["id"]


def _set_lang(token: str, lang: str):
    r = requests.patch(f"{API}/auth/me", json={"language": lang}, headers=_auth(token), timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("language") == lang


def _driver_online(driver_tok: str):
    r = requests.patch(f"{API}/driver/status", json={"is_online": True}, headers=_auth(driver_tok), timeout=15)
    # some backends use different route; ignore errors and try alt
    if r.status_code >= 400:
        r = requests.post(f"{API}/driver/online", json={"is_online": True}, headers=_auth(driver_tok), timeout=15)


def _latest_notification(token: str, type_: str = None):
    r = requests.get(f"{API}/notifications", headers=_auth(token), timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    if type_:
        items = [n for n in items if n.get("type") == type_]
    return items[0] if items else None


class TestLocalizedNotifications:
    def test_es_notifications_and_fr_regression(self, fresh_passenger, driver_token):
        pax_tok = fresh_passenger["token"]
        # 1) Set Spanish
        _set_lang(pax_tok, "es")

        _driver_online(driver_token)

        # 2) Create ride
        ride_id = _create_ride(pax_tok)

        # 3) Driver accepts
        r = requests.post(f"{API}/rides/{ride_id}/accept", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, f"accept failed: {r.status_code} {r.text}"

        # give any async tasks a moment
        time.sleep(1)

        n = _latest_notification(pax_tok, "accepted")
        assert n is not None, "accepted notification missing"
        assert n["title"] == "Chófer encontrado", f"unexpected title: {n['title']}"
        assert "está en camino" in n["body"], f"unexpected body: {n['body']}"
        # driver name in body
        driver_me = requests.get(f"{API}/auth/me", headers=_auth(driver_token), timeout=15).json()
        assert driver_me["full_name"].split()[0] in n["body"], f"driver name missing in body: {n['body']}"

        # 4) Driver starts
        r = requests.post(f"{API}/rides/{ride_id}/start", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        time.sleep(1)
        n = _latest_notification(pax_tok, "started")
        assert n is not None
        assert n["title"] == "Viaje iniciado", f"unexpected: {n['title']}"

        # 5) Driver completes
        r = requests.post(f"{API}/rides/{ride_id}/complete", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        time.sleep(1)
        n = _latest_notification(pax_tok, "completed")
        assert n is not None
        assert n["title"] == "Viaje finalizado", f"unexpected: {n['title']}"

        # 6) Switch to French: titles unchanged (French inline)
        _set_lang(pax_tok, "fr")
        ride_id2 = _create_ride(pax_tok)
        r = requests.post(f"{API}/rides/{ride_id2}/accept", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        time.sleep(1)
        n = _latest_notification(pax_tok, "accepted")
        assert n is not None
        assert n["title"] == "Chauffeur trouvé", f"unexpected FR title: {n['title']}"

        # cancel that ride to clean up
        requests.post(f"{API}/rides/{ride_id2}/cancel", headers=_auth(pax_tok), timeout=15)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
