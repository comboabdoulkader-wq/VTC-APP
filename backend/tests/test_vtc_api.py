"""Backend tests for VTC ride-hailing API."""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUFFIX = uuid.uuid4().hex[:8]
PASSENGER_EMAIL = f"test_pax_{SUFFIX}@example.com"
DRIVER_EMAIL = f"test_drv_{SUFFIX}@example.com"
PASSWORD = "Passw0rd!"

state = {}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---- Health ----
def test_health(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---- Auth ----
def test_register_passenger(s):
    r = s.post(f"{API}/auth/register", json={
        "email": PASSENGER_EMAIL, "password": PASSWORD,
        "full_name": "Test Passenger", "role": "passenger", "phone": "+33600000001"
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "passenger"
    assert d["user"]["email"] == PASSENGER_EMAIL
    state["pax_token"] = d["access_token"]
    state["pax_id"] = d["user"]["id"]


def test_register_driver(s):
    r = s.post(f"{API}/auth/register", json={
        "email": DRIVER_EMAIL, "password": PASSWORD,
        "full_name": "Test Driver", "role": "driver",
        "phone": "+33600000002", "vehicle_model": "Tesla Model 3", "license_plate": "AB-123-CD"
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "driver"
    assert d["user"]["vehicle_model"] == "Tesla Model 3"
    state["drv_token"] = d["access_token"]
    state["drv_id"] = d["user"]["id"]


def test_register_duplicate(s):
    r = s.post(f"{API}/auth/register", json={
        "email": PASSENGER_EMAIL, "password": PASSWORD,
        "full_name": "Dup", "role": "passenger"
    })
    assert r.status_code == 409


def test_login_success(s):
    r = s.post(f"{API}/auth/login", json={"email": PASSENGER_EMAIL, "password": PASSWORD})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_login_wrong_password(s):
    r = s.post(f"{API}/auth/login", json={"email": PASSENGER_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_me_passenger(s):
    r = s.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {state['pax_token']}"})
    assert r.status_code == 200
    assert r.json()["role"] == "passenger"


def test_me_unauthenticated(s):
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 401


# ---- Estimate ----
def test_estimate(s):
    r = s.post(f"{API}/rides/estimate", json={
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris"},
        "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "La Défense"},
    })
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 3
    types = {d["vehicle_type"] for d in data}
    assert types == {"standard", "premium", "van"}
    for d in data:
        assert d["price"] > 0
        assert d["distance_km"] > 0
        assert d["duration_min"] >= 3


# ---- Role authorization ----
def test_passenger_cannot_access_driver_endpoint(s):
    r = s.get(f"{API}/rides/available", headers={"Authorization": f"Bearer {state['pax_token']}"})
    assert r.status_code == 403


def test_driver_cannot_create_ride(s):
    r = s.post(f"{API}/rides", headers={"Authorization": f"Bearer {state['drv_token']}"}, json={
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "A"},
        "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "B"},
        "vehicle_type": "standard", "price": 15.0, "distance_km": 5.0, "duration_min": 12,
    })
    assert r.status_code == 403


# ---- Full ride lifecycle ----
def test_create_ride(s):
    r = s.post(f"{API}/rides", headers={"Authorization": f"Bearer {state['pax_token']}"}, json={
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris"},
        "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "La Défense"},
        "vehicle_type": "standard", "price": 15.50, "distance_km": 5.2, "duration_min": 13,
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "requested"
    assert d["passenger_id"] == state["pax_id"]
    state["ride_id"] = d["id"]


def test_ride_visible_in_available(s):
    r = s.get(f"{API}/rides/available", headers={"Authorization": f"Bearer {state['drv_token']}"})
    assert r.status_code == 200
    ids = [ride["id"] for ride in r.json()]
    assert state["ride_id"] in ids


def test_driver_status_online(s):
    r = s.post(f"{API}/driver/status",
               headers={"Authorization": f"Bearer {state['drv_token']}"},
               json={"is_online": True, "lat": 48.85, "lng": 2.35})
    assert r.status_code == 200
    assert r.json()["is_online"] is True


def test_accept_ride(s):
    r = s.post(f"{API}/rides/{state['ride_id']}/accept",
               headers={"Authorization": f"Bearer {state['drv_token']}"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "accepted"
    assert d["driver_id"] == state["drv_id"]
    assert d["driver_vehicle"] == "Tesla Model 3"


def test_double_accept_fails(s):
    r = s.post(f"{API}/rides/{state['ride_id']}/accept",
               headers={"Authorization": f"Bearer {state['drv_token']}"})
    assert r.status_code == 409


def test_start_ride(s):
    r = s.post(f"{API}/rides/{state['ride_id']}/start",
               headers={"Authorization": f"Bearer {state['drv_token']}"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_progress"


def test_complete_ride(s):
    r = s.post(f"{API}/rides/{state['ride_id']}/complete",
               headers={"Authorization": f"Bearer {state['drv_token']}"})
    assert r.status_code == 200
    assert r.json()["status"] == "completed"


def test_rate_ride(s):
    r = s.post(f"{API}/rides/{state['ride_id']}/rate",
               headers={"Authorization": f"Bearer {state['pax_token']}"},
               json={"rating": 5, "tip": 2.0})
    assert r.status_code == 200
    d = r.json()
    assert d["rating"] == 5
    assert d["tip"] == 2.0


def test_rate_twice_fails(s):
    r = s.post(f"{API}/rides/{state['ride_id']}/rate",
               headers={"Authorization": f"Bearer {state['pax_token']}"},
               json={"rating": 4, "tip": 0})
    assert r.status_code == 409


def test_get_ride_persistence(s):
    r = s.get(f"{API}/rides/{state['ride_id']}",
              headers={"Authorization": f"Bearer {state['pax_token']}"})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "completed"
    assert d["rating"] == 5


def test_my_rides_passenger(s):
    r = s.get(f"{API}/rides/mine", headers={"Authorization": f"Bearer {state['pax_token']}"})
    assert r.status_code == 200
    assert any(ride["id"] == state["ride_id"] for ride in r.json())


def test_driver_earnings(s):
    r = s.get(f"{API}/driver/earnings", headers={"Authorization": f"Bearer {state['drv_token']}"})
    assert r.status_code == 200
    d = r.json()
    assert d["rides_count"] >= 1
    assert d["total"] >= 15.50


def test_cancel_flow(s):
    # Create another ride and cancel
    r = s.post(f"{API}/rides", headers={"Authorization": f"Bearer {state['pax_token']}"}, json={
        "pickup": {"lat": 48.85, "lng": 2.35, "address": "A"},
        "dropoff": {"lat": 48.87, "lng": 2.29, "address": "B"},
        "vehicle_type": "premium", "price": 20.0, "distance_km": 5.0, "duration_min": 12,
    })
    assert r.status_code == 200
    rid = r.json()["id"]
    r2 = s.post(f"{API}/rides/{rid}/cancel", headers={"Authorization": f"Bearer {state['pax_token']}"})
    assert r2.status_code == 200
    assert r2.json()["status"] == "cancelled"
