"""Phase 1: stops, ride modification, waiting fees, RideOut breakdown."""
import os
import math
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE = os.environ.get("EXPO_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/") + "/api"
PASSENGER = {"email": "passager@test.com", "password": "password123"}
DRIVER = {"email": "chauffeur@test.com", "password": "password123"}

PICKUP = {"lat": 48.8566, "lng": 2.3522, "address": "Paris - Louvre"}
DROPOFF = {"lat": 48.8738, "lng": 2.2950, "address": "Arc de Triomphe"}
STOPS = [
    {"lat": 48.8330, "lng": 2.3260, "address": "Montparnasse (detour south)"},
    {"lat": 48.8930, "lng": 2.3499, "address": "Nord Paris (detour north)"},
]


def _login(creds):
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def pax_token():
    return _login(PASSENGER)


@pytest.fixture(scope="module")
def drv_token():
    r = requests.post(f"{BASE}/auth/login", json=DRIVER, timeout=15)
    return r.json()["access_token"] if r.status_code == 200 else None


@pytest.fixture(scope="module")
def mongo():
    url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    dbname = os.environ.get("DB_NAME", "test_database")
    c = MongoClient(url)
    return c[dbname]


# ---------- Estimate with stops ----------
class TestEstimateStops:
    def test_estimate_without_stops(self, pax_token):
        h = {"Authorization": f"Bearer {pax_token}"}
        r = requests.post(f"{BASE}/rides/estimate", headers=h,
                          json={"pickup": PICKUP, "dropoff": DROPOFF, "passengers": 1, "luggage": 0}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        std = next(o for o in data["options"] if o["vehicle_type"] == "standard")
        pytest.base_dist = std["distance_km"]
        pytest.base_dur = std["duration_min"]
        pytest.base_price = std["price"]
        assert std["distance_km"] > 0

    def test_estimate_with_stops_higher(self, pax_token):
        h = {"Authorization": f"Bearer {pax_token}"}
        r = requests.post(f"{BASE}/rides/estimate", headers=h,
                          json={"pickup": PICKUP, "dropoff": DROPOFF, "stops": STOPS,
                                "passengers": 1, "luggage": 0}, timeout=15)
        assert r.status_code == 200, r.text
        std = next(o for o in r.json()["options"] if o["vehicle_type"] == "standard")
        assert std["distance_km"] > pytest.base_dist, "stops should increase distance"
        assert std["duration_min"] >= pytest.base_dur
        assert std["price"] > pytest.base_price


# ---------- Create + Modify ride ----------
class TestModifyRide:
    def test_create_and_modify(self, pax_token, drv_token):
        h = {"Authorization": f"Bearer {pax_token}"}
        # create
        payload = {"pickup": PICKUP, "dropoff": DROPOFF, "vehicle_type": "standard",
                   "passengers": 1, "luggage": 0, "payment_method": "card"}
        r = requests.post(f"{BASE}/rides", headers=h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        ride = r.json()
        rid = ride["id"]
        old_price = ride["price"]
        old_dist = ride["distance_km"]
        pytest.ride_id = rid
        assert ride["stops"] == []
        assert "breakdown" in ride and "total" in ride["breakdown"]

        # modify: add stops + change vehicle + change dropoff + passengers
        new_dropoff = {"lat": 48.8867, "lng": 2.3431, "address": "Sacré-Cœur"}
        mod = {"stops": STOPS, "vehicle_type": "van", "dropoff": new_dropoff, "passengers": 4}
        r = requests.patch(f"{BASE}/rides/{rid}", headers=h, json=mod, timeout=15)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["vehicle_type"] == "van"
        assert len(u["stops"]) == 2
        assert u["passengers"] == 4
        assert u["distance_km"] > old_dist
        # base_price recomputed for new vehicle_type + stops
        assert u["base_price"] != ride["base_price"]
        assert u["breakdown"]["base"] == round(u["base_price"], 2)

        # GET verify persistence
        g = requests.get(f"{BASE}/rides/{rid}", headers=h, timeout=15).json()
        assert g["vehicle_type"] == "van"
        assert len(g["stops"]) == 2

    def test_patch_by_other_passenger_returns_404(self):
        # create a fresh user
        email = f"TEST_other_{int(time.time())}@t.com"
        r = requests.post(f"{BASE}/auth/register", json={
            "email": email, "password": "password123", "full_name": "Other", "role": "passenger"
        }, timeout=15)
        assert r.status_code == 200, r.text
        tk = r.json()["access_token"]
        r = requests.patch(f"{BASE}/rides/{pytest.ride_id}",
                           headers={"Authorization": f"Bearer {tk}"},
                           json={"passengers": 2}, timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_patch_completed_ride_returns_409(self, pax_token, mongo):
        # Directly mark it completed in DB (test-only shortcut)
        mongo.rides.update_one({"id": pytest.ride_id}, {"$set": {"status": "completed"}})
        h = {"Authorization": f"Bearer {pax_token}"}
        r = requests.patch(f"{BASE}/rides/{pytest.ride_id}", headers=h,
                           json={"passengers": 2}, timeout=15)
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text[:200]}"
        # restore
        mongo.rides.update_one({"id": pytest.ride_id}, {"$set": {"status": "requested"}})


# ---------- RideOut shape (kept in same class scope for xdist loadscope) ----------
class TestRideOutShape:
    def test_rideout_fields(self, pax_token):
        h = {"Authorization": f"Bearer {pax_token}"}
        # Create a fresh ride so this test is independent from TestModifyRide (loadscope: different worker)
        payload = {"pickup": PICKUP, "dropoff": DROPOFF, "vehicle_type": "standard",
                   "passengers": 1, "luggage": 0, "payment_method": "card",
                   "stops": [STOPS[0]]}
        r = requests.post(f"{BASE}/rides", headers=h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        r = requests.get(f"{BASE}/rides/{rid}", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for f in ["stops", "arrived_at", "waiting_active",
                  "waiting_departure_fee", "stop_waits", "waiting_fee",
                  "toll_amount", "breakdown"]:
            assert f in d, f"missing field {f}"
        b = d["breakdown"]
        for k in ["base", "surcharge", "discount", "waiting", "toll", "total"]:
            assert k in b, f"breakdown missing {k}"
        assert isinstance(d["stop_waits"], list)
        assert len(d["stop_waits"]) == len(d["stops"])


# ---------- Waiting fees via wait_fee helper (unit) ----------
class TestWaitFeeLogic:
    def test_departure_free_first_3_min(self):
        from importlib import import_module
        import sys
        sys.path.insert(0, "/app/backend")
        core = import_module("core")
        assert core.wait_fee(3, 2.5) == 0.0
        assert core.wait_fee(3, 3.0) == 0.0
        # ceil(0.1)*1 = 1
        assert core.wait_fee(3, 3.1) == 1.0
        assert core.wait_fee(3, 5.5) == 3.0  # 2.5 over -> ceil = 3
        assert core.wait_fee(2, 4.0) == 2.0


# ---------- Driver waiting flow (E2E if driver not blocked) ----------
class TestDriverWaitingFlow:
    def test_driver_flow_or_skip(self, pax_token, drv_token, mongo):
        if not drv_token:
            pytest.skip("Driver login failed")
        drv_hdr = {"Authorization": f"Bearer {drv_token}"}
        me = requests.get(f"{BASE}/auth/me", headers=drv_hdr, timeout=15)
        if me.status_code == 200 and me.json().get("docs_blocked"):
            # try to unblock in DB
            mongo.users.update_one({"email": DRIVER["email"]}, {"$set": {"docs_blocked": False}})
        # driver online
        requests.post(f"{BASE}/driver/status", headers=drv_hdr,
                      json={"is_online": True, "lat": PICKUP["lat"], "lng": PICKUP["lng"]}, timeout=15)

        # Passenger creates ride with a stop
        pax_hdr = {"Authorization": f"Bearer {pax_token}"}
        payload = {"pickup": PICKUP, "dropoff": DROPOFF, "stops": [STOPS[0]],
                   "vehicle_type": "standard", "passengers": 1, "luggage": 0,
                   "payment_method": "card"}
        r = requests.post(f"{BASE}/rides", headers=pax_hdr, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        ride = r.json()
        rid = ride["id"]
        original_price = ride["price"]

        # Driver accepts
        r = requests.post(f"{BASE}/rides/{rid}/accept", headers=drv_hdr, timeout=15)
        if r.status_code == 423:
            pytest.skip(f"driver blocked: {r.text[:120]}")
        assert r.status_code == 200, r.text

        # Driver arrived
        r = requests.post(f"{BASE}/rides/{rid}/arrived", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, r.text

        # Backdate arrived_at by 8 minutes → 5 billable min → 5€ dep fee (allow +1 for ceil drift)
        past = datetime.now(timezone.utc) - timedelta(minutes=8)
        mongo.rides.update_one({"id": rid}, {"$set": {"arrived_at": past}})

        # Start ride
        r = requests.post(f"{BASE}/rides/{rid}/start", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, r.text
        dep_fee = r.json()["waiting_departure_fee"]
        assert 5.0 <= dep_fee <= 6.0, f"dep_fee expected 5-6€, got {dep_fee}"

        # Arrive at stop 0, backdate 6 min → 4 billable → 4€ (allow +1 for drift)
        r = requests.post(f"{BASE}/rides/{rid}/stops/0/arrive", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, r.text
        past = datetime.now(timezone.utc) - timedelta(minutes=6)
        mongo.rides.update_one({"id": rid}, {"$set": {"stop_waits": [
            {"arrived_at": past, "departed_at": None, "fee": 0.0}
        ]}})
        r = requests.post(f"{BASE}/rides/{rid}/stops/0/depart", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, r.text
        stop_fee = r.json()["stop_waits"][0]["fee"]
        assert 4.0 <= stop_fee <= 5.0, f"stop_fee expected 4-5€, got {stop_fee}"

        # Complete
        r = requests.post(f"{BASE}/rides/{rid}/complete", headers=drv_hdr, timeout=15)
        assert r.status_code == 200, r.text
        final = r.json()
        expected_wait = dep_fee + stop_fee
        assert final["waiting_fee"] == pytest.approx(expected_wait, abs=0.01)
        assert final["price"] == pytest.approx(original_price + expected_wait, abs=0.01)
        assert final["due_amount"] == pytest.approx(final["price"] - final.get("wallet_amount", 0), abs=0.01)
