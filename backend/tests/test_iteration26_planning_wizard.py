"""Iteration 26: driver /planning + multi-step reminders + wizard-produced payloads."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback used in prior tests
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "test_database")

PASSENGER = {"email": "passager@test.com", "password": "password123"}
DRIVER = {"email": "chauffeur@test.com", "password": "password123"}


@pytest.fixture(scope="session")
def db():
    # We need MONGO_URL — read from backend/.env if not exposed
    global MONGO_URL, DB_NAME
    if not MONGO_URL:
        with open("/app/backend/.env") as fh:
            for line in fh:
                if line.startswith("MONGO_URL="):
                    MONGO_URL = line.split("=", 1)[1].strip().strip('"')
                elif line.startswith("DB_NAME="):
                    DB_NAME = line.split("=", 1)[1].strip().strip('"')
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def passenger_token():
    return _login(**PASSENGER)


@pytest.fixture(scope="session")
def driver_token(db):
    # Clear docs_blocked if set — otherwise accept endpoint fails.
    db.users.update_one({"email": DRIVER["email"]}, {"$set": {"docs_blocked": False, "is_online": True}})
    return _login(**DRIVER)


def _create_scheduled_ride(passenger_token, minutes_ahead=6, business=False):
    scheduled_at = (datetime.now(timezone.utc) + timedelta(minutes=minutes_ahead)).isoformat()
    payload = {
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris Châtelet"},
        "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "Arc de Triomphe"},
        "vehicle_type": "standard",
        "payment_method": "card",
        "service_type": "private",
        "passengers": 1,
        "children": 0,
        "luggage": 1,
        "child_seats": 0,
        "scheduled_at": scheduled_at,
        "business": business,
    }
    r = requests.post(f"{BASE_URL}/api/rides", json=payload,
                      headers={"Authorization": f"Bearer {passenger_token}"}, timeout=15)
    assert r.status_code == 200, f"create ride: {r.status_code} {r.text}"
    return r.json(), scheduled_at


# =========================
# Wizard-produced payloads
# =========================
class TestWizardPayloads:
    def test_scheduled_business_ride_created(self, passenger_token, db):
        # Ensure this passenger is linked to a company (setup done by seeds).
        user = db.users.find_one({"email": PASSENGER["email"]}, {"_id": 0})
        assert user, "passenger not seeded"
        # If not attached, skip
        if not user.get("company_id"):
            pytest.skip("passager@test.com not linked to a company_id")
        ride, when = _create_scheduled_ride(passenger_token, minutes_ahead=30, business=True)
        assert ride["scheduled_at"] is not None
        assert ride.get("business") is True
        assert ride["status"] == "requested"
        # cleanup
        db.rides.update_one({"id": ride["id"]}, {"$set": {"status": "cancelled"}})

    def test_immediate_private_ride_created(self, passenger_token, db):
        payload = {
            "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris Châtelet"},
            "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "Arc de Triomphe"},
            "vehicle_type": "standard",
            "payment_method": "card",
            "service_type": "private",
            "passengers": 1,
            "children": 0,
            "luggage": 0,
            "child_seats": 0,
            "business": False,
        }
        r = requests.post(f"{BASE_URL}/api/rides", json=payload,
                          headers={"Authorization": f"Bearer {passenger_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        ride = r.json()
        assert ride.get("scheduled_at") in (None, "")
        assert ride.get("business") is False
        db.rides.update_one({"id": ride["id"]}, {"$set": {"status": "cancelled"}})


# =========================
# Driver /planning
# =========================
class TestDriverPlanning:
    def test_planning_lists_accepted_scheduled_ride(self, passenger_token, driver_token, db):
        # Create scheduled ride ~6min ahead
        ride, when = _create_scheduled_ride(passenger_token, minutes_ahead=6)
        rid = ride["id"]
        # Force assignment cleared so driver can accept without collision from dispatch
        db.rides.update_one({"id": rid}, {"$unset": {"assigned_driver_id": "", "offer_expires_at": ""}})
        # Accept as driver
        r = requests.post(f"{BASE_URL}/api/rides/{rid}/accept",
                          headers={"Authorization": f"Bearer {driver_token}"}, timeout=15)
        assert r.status_code == 200, f"accept: {r.status_code} {r.text}"
        # GET /api/driver/planning
        r = requests.get(f"{BASE_URL}/api/driver/planning",
                         headers={"Authorization": f"Bearer {driver_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        rides = r.json()
        assert isinstance(rides, list)
        ours = [x for x in rides if x["id"] == rid]
        assert len(ours) == 1, f"our ride not in planning; got {len(rides)} rides"
        got = ours[0]
        assert got.get("scheduled_at") is not None
        assert got.get("pickup") and got.get("dropoff")
        assert got.get("price") is not None
        assert got.get("status") in ("accepted", "in_progress")
        # sort ascending: assert list is sorted by scheduled_at
        times = [x["scheduled_at"] for x in rides if x.get("scheduled_at")]
        assert times == sorted(times)
        # cleanup
        db.rides.update_one({"id": rid}, {"$set": {"status": "cancelled"}})


# =========================
# Multi-step reminder (server reminder_loop)
# =========================
class TestDriverReminders:
    def test_reminder_fires_once_within_75s(self, passenger_token, driver_token, db):
        # Create ride scheduled ~4.5 min ahead. Steps are [60,30,15,5]; mu ~4.5 → applicable=[5]
        ride, when = _create_scheduled_ride(passenger_token, minutes_ahead=4)
        rid = ride["id"]
        db.rides.update_one({"id": rid}, {"$unset": {"assigned_driver_id": "", "offer_expires_at": ""}})
        r = requests.post(f"{BASE_URL}/api/rides/{rid}/accept",
                          headers={"Authorization": f"Bearer {driver_token}"}, timeout=15)
        assert r.status_code == 200, r.text

        driver = db.users.find_one({"email": DRIVER["email"]}, {"_id": 0, "id": 1})
        driver_id = driver["id"]
        # Snapshot the notif count before
        before = list(db.notifications.find({"user_id": driver_id, "type": "reminder", "ride_id": rid}))

        # Loop sleeps 60s between iterations. Poll for up to 80s.
        found = None
        deadline = time.time() + 80
        while time.time() < deadline:
            r = requests.get(f"{BASE_URL}/api/notifications",
                             headers={"Authorization": f"Bearer {driver_token}"}, timeout=15)
            if r.status_code == 200:
                notifs = r.json()
                for n in notifs:
                    if (n.get("ride_id") == rid and n.get("type") == "reminder"
                            and "Rappel course" in (n.get("title") or "")):
                        found = n
                        break
            if found:
                break
            time.sleep(5)

        assert found is not None, f"driver 'Rappel course' notification not created within 80s (before={len(before)})"
        # driver_reminders_sent must be persisted
        rec = db.rides.find_one({"id": rid}, {"_id": 0, "driver_reminders_sent": 1})
        assert rec and rec.get("driver_reminders_sent"), "driver_reminders_sent not persisted"

        # Wait another 40s and re-poll — no NEW reminder should be created for the same step (5 min)
        time.sleep(40)
        r = requests.get(f"{BASE_URL}/api/notifications",
                         headers={"Authorization": f"Bearer {driver_token}"}, timeout=15)
        assert r.status_code == 200
        matches = [n for n in r.json()
                   if n.get("ride_id") == rid and n.get("type") == "reminder"
                   and "Rappel course" in (n.get("title") or "")
                   and "dans 5 min" in (n.get("title") or "")]
        # Should be exactly 1 for the 5-min step
        assert len(matches) == 1, f"duplicate 5-min reminder created: {len(matches)}"

        # cleanup
        db.rides.update_one({"id": rid}, {"$set": {"status": "cancelled"}})
