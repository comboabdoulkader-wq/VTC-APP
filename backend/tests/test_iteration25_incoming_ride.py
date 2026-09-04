"""Iteration 25 — Écran Nouvelle Course backend integration.

Focus:
- RideOut now exposes assigned_driver_id and offer_expires_at
- Instant-ride creation assigns the online candidate + sets an offer deadline
- GET /api/rides/available returns the assigned fields for the driver
- POST /api/rides/{id}/accept works on the offered ride
- POST /api/rides/{id}/decline cascades the offer
"""
import os
import time
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else "https://vtc-platform-18.preview.emergentagent.com"
API = f"{BASE_URL}/api"

PASSENGER = {"email": "passager@test.com", "password": "password123"}
DRIVER = {"email": "chauffeur@test.com", "password": "password123"}

# Paris coordinates as per the request
PICKUP = {"lat": 48.8583, "lng": 2.3477, "address": "Tour Eiffel, Paris"}
DROPOFF = {"lat": 48.8606, "lng": 2.3376, "address": "Musée du Louvre, Paris"}


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = client[os.environ.get("DB_NAME", "test_database")]
    yield db
    client.close()


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


@pytest.fixture(scope="module")
def passenger_ctx():
    tok, u = _login(**PASSENGER)
    return {"token": tok, "user": u}


@pytest.fixture(scope="module")
def driver_ctx(mongo):
    tok, u = _login(**DRIVER)
    # Unblock the driver if docs_blocked so they can go online / receive rides
    mongo.users.update_one({"id": u["id"]}, {"$set": {"docs_blocked": False, "is_active": True}})
    return {"token": tok, "user": u}


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def bring_driver_online(driver_ctx, mongo):
    # Put the driver online with a location near the pickup
    r = requests.post(
        f"{API}/driver/status",
        json={"is_online": True, "lat": PICKUP["lat"], "lng": PICKUP["lng"]},
        headers=_auth(driver_ctx["token"]),
        timeout=15,
    )
    assert r.status_code == 200, f"driver/status failed: {r.status_code} {r.text}"
    # Also write the driver_location on the user doc (compute_candidates prefers it)
    mongo.users.update_one(
        {"id": driver_ctx["user"]["id"]},
        {"$set": {"driver_location": {"lat": PICKUP["lat"], "lng": PICKUP["lng"]},
                  "last_location": {"lat": PICKUP["lat"], "lng": PICKUP["lng"]}}},
    )
    yield
    # Teardown: put driver back offline
    try:
        requests.post(f"{API}/driver/status", json={"is_online": False},
                      headers=_auth(driver_ctx["token"]), timeout=10)
    except Exception:
        pass


def _create_ride(passenger_ctx, vehicle="standard"):
    payload = {
        "pickup": PICKUP,
        "dropoff": DROPOFF,
        "stops": [],
        "vehicle_type": vehicle,
        "passengers": 1,
        "children": 0,
        "child_seats": 0,
        "luggage": 0,
        "payment_method": "cash",
        "service_type": "private",
    }
    r = requests.post(f"{API}/rides", json=payload,
                      headers=_auth(passenger_ctx["token"]), timeout=15)
    assert r.status_code == 200, f"create ride failed: {r.status_code} {r.text}"
    return r.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestIncomingRideOffer:
    """Assigned driver + offer deadline surfaced on RideOut."""

    def test_ride_creation_sets_assigned_driver_and_expiry(self, passenger_ctx, driver_ctx):
        ride = _create_ride(passenger_ctx)
        assert "assigned_driver_id" in ride, "assigned_driver_id must be present in RideOut"
        assert "offer_expires_at" in ride, "offer_expires_at must be present in RideOut"
        assert ride["assigned_driver_id"] == driver_ctx["user"]["id"], \
            f"expected {driver_ctx['user']['id']}, got {ride['assigned_driver_id']}"
        # offer_expires_at should be in the future
        expires = datetime.fromisoformat(ride["offer_expires_at"].replace("Z", "+00:00"))
        assert expires > datetime.now(timezone.utc), "offer_expires_at should be in the future"

    def test_get_ride_returns_assigned_fields(self, passenger_ctx, driver_ctx):
        ride = _create_ride(passenger_ctx)
        r = requests.get(f"{API}/rides/{ride['id']}", headers=_auth(driver_ctx["token"]), timeout=10)
        assert r.status_code == 200
        got = r.json()
        assert got["assigned_driver_id"] == driver_ctx["user"]["id"]
        assert got["offer_expires_at"]

    def test_available_rides_includes_assigned_ride(self, passenger_ctx, driver_ctx):
        ride = _create_ride(passenger_ctx)
        r = requests.get(f"{API}/rides/available", headers=_auth(driver_ctx["token"]), timeout=10)
        assert r.status_code == 200, f"available failed: {r.text}"
        rides = r.json()
        match = next((x for x in rides if x["id"] == ride["id"]), None)
        assert match is not None, "assigned ride should appear in /rides/available"
        assert match["assigned_driver_id"] == driver_ctx["user"]["id"]
        assert match["offer_expires_at"], "offer_expires_at should be present"


class TestOfferAccept:
    def test_assigned_driver_can_accept(self, passenger_ctx, driver_ctx, mongo):
        ride = _create_ride(passenger_ctx)
        ride_id = ride["id"]
        r = requests.post(f"{API}/rides/{ride_id}/accept",
                          headers=_auth(driver_ctx["token"]), timeout=10)
        assert r.status_code == 200, f"accept failed: {r.status_code} {r.text}"
        accepted = r.json()
        assert accepted["status"] == "accepted"
        assert accepted["driver_id"] == driver_ctx["user"]["id"]
        # Verify persistence
        got = requests.get(f"{API}/rides/{ride_id}",
                           headers=_auth(driver_ctx["token"]), timeout=10).json()
        assert got["status"] == "accepted"
        # Cleanup: cancel so it doesn't stay active
        requests.post(f"{API}/rides/{ride_id}/cancel",
                      headers=_auth(driver_ctx["token"]), timeout=10)


class TestOfferDeclineCascade:
    def test_decline_removes_or_clears_assignment(self, passenger_ctx, driver_ctx, mongo):
        # Make sure driver is really the only online candidate so cascade -> no next driver
        ride = _create_ride(passenger_ctx)
        ride_id = ride["id"]
        assert ride["assigned_driver_id"] == driver_ctx["user"]["id"]

        r = requests.post(f"{API}/rides/{ride_id}/decline",
                          headers=_auth(driver_ctx["token"]), timeout=10)
        assert r.status_code == 200, f"decline failed: {r.status_code} {r.text}"

        # Give the server a moment to cascade
        time.sleep(1.0)

        doc = mongo.rides.find_one({"id": ride_id}, {"_id": 0})
        assert doc is not None
        # After decline the assignment should have moved (or be cleared) and the driver
        # should not be the assigned_driver_id any more.
        assert doc.get("assigned_driver_id") in (None, "") or doc["assigned_driver_id"] != driver_ctx["user"]["id"], \
            f"assigned_driver_id should have moved off the declining driver, got {doc.get('assigned_driver_id')}"

        # A decline record should exist
        d = mongo.ride_declines.find_one({"ride_id": ride_id, "driver_id": driver_ctx["user"]["id"]})
        assert d is not None, "decline record should be persisted"

        # /rides/available for the declining driver should NOT include this ride any more
        avail = requests.get(f"{API}/rides/available",
                             headers=_auth(driver_ctx["token"]), timeout=10).json()
        assert not any(x["id"] == ride_id for x in avail), \
            "declined ride should not reappear for the declining driver"
