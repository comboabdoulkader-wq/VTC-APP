"""Iteration 24 - Intelligent CASCADE dispatch tests (RideGo).

Covers:
 - Instant ride offer to best candidate (assigned_driver_id + offer_expires_at set)
 - Decline cascade -> next candidate or null broadcast
 - Timeout cascade via background dispatch_loop
 - Admin dispatch settings persistence + priority reorder
 - Accept regression: driver can still accept an offered ride

Note: Push (Expo Go), Twilio SMS, Email are logged only (mocked). Not failures.
"""
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PASSENGER = {"email": "passager@test.com", "password": "password123"}
DRIVER = {"email": "chauffeur@test.com", "password": "password123"}

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------------- helpers ----------------
def _login(cred):
    r = requests.post(f"{API}/auth/login", json=cred, timeout=15)
    assert r.status_code == 200, f"login {cred['email']} failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _set_driver_online(tok):
    r = requests.post(f"{API}/driver/status", headers=_auth(tok),
                      json={"is_online": True, "lat": 48.8566, "lng": 2.3522}, timeout=15)
    assert r.status_code == 200, f"driver online failed: {r.status_code} {r.text}"


def _create_immediate_ride(tok):
    payload = {
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris Centre (TEST)"},
        "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "Arc de Triomphe (TEST)"},
        "vehicle_type": "standard",
        "service_type": "private",
        "passengers": 1,
        "payment_method": "cash",
    }
    r = requests.post(f"{API}/rides", headers=_auth(tok), json=payload, timeout=20)
    assert r.status_code == 200, f"create ride failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def tokens(db):
    """Login passenger & driver; ensure driver online with a good driver_location."""
    p_tok, p_user = _login(PASSENGER)
    d_tok, d_user = _login(DRIVER)
    _set_driver_online(d_tok)
    # compute_candidates reads user.driver_location (not last_location). Seed it.
    db.users.update_one(
        {"id": d_user["id"]},
        {"$set": {"driver_location": {"lat": 48.8566, "lng": 2.3522, "updated_at": None},
                  "is_online": True, "is_active": True, "docs_blocked": False}},
    )
    return {"p_tok": p_tok, "p_user": p_user, "d_tok": d_tok, "d_user": d_user}


@pytest.fixture(scope="module")
def created_ride_ids():
    """Track ride ids to cleanup at teardown."""
    ids = []
    yield ids
    # cleanup handled in a session-scoped teardown via db fixture in individual test if needed


# ---------------- 1. Admin settings ----------------
class TestAdminSettings:
    """GET/PUT /api/admin/settings dispatch block (moderator = chauffeur@)."""

    def test_get_settings_has_dispatch(self, tokens):
        r = requests.get(f"{API}/admin/settings", headers=_auth(tokens["d_tok"]), timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()
        assert "dispatch" in s, "dispatch block missing"
        d = s["dispatch"]
        for k in ("enabled", "radius_km", "max_drivers", "response_seconds", "priority", "alarm", "planning"):
            assert k in d, f"dispatch.{k} missing"
        assert d["priority"] in ("distance", "eta", "rating", "fairness")

    def test_put_settings_persists_and_reorders(self, tokens):
        # write a short response_seconds so the timeout test doesn't wait forever
        body = {"dispatch": {"enabled": True, "radius_km": 25.0, "max_drivers": 5,
                              "response_seconds": 4, "priority": "distance"}}
        r = requests.put(f"{API}/admin/settings", headers=_auth(tokens["d_tok"]), json=body, timeout=15)
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["dispatch"]["radius_km"] == 25.0
        assert after["dispatch"]["response_seconds"] == 4
        assert after["dispatch"]["priority"] == "distance"
        # Verify via GET
        r2 = requests.get(f"{API}/admin/settings", headers=_auth(tokens["d_tok"]), timeout=15)
        assert r2.json()["dispatch"]["priority"] == "distance"


# ---------------- 2. Instant ride offer ----------------
class TestInstantRideOffer:
    def test_create_ride_assigns_best_driver_and_deadline(self, tokens, db):
        ride = _create_immediate_ride(tokens["p_tok"])
        rid = ride["id"]
        # Fetch stored ride (RideOut may not include dispatch fields).
        stored = db.rides.find_one({"id": rid}, {"_id": 0})
        assert stored is not None
        assert stored.get("assigned_driver_id") == tokens["d_user"]["id"], \
            f"expected best driver assigned, got {stored.get('assigned_driver_id')}"
        assert stored.get("offer_expires_at") is not None, "offer_expires_at not set"
        assert stored.get("best_driver_id") == tokens["d_user"]["id"]
        # Candidates endpoint (moderator)
        r = requests.get(f"{API}/admin/rides/{rid}/candidates", headers=_auth(tokens["d_tok"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["best_driver_id"] == tokens["d_user"]["id"]
        assert len(data["candidates"]) >= 1
        # Candidates ordered by score desc
        scores = [c["score"] for c in data["candidates"]]
        assert scores == sorted(scores, reverse=True), f"candidates not ordered by score: {scores}"
        # cleanup
        db.rides.delete_one({"id": rid})


# ---------------- 3. Decline cascade ----------------
class TestDeclineCascade:
    def test_decline_single_driver_falls_to_broadcast(self, tokens, db):
        """With only 1 online driver, decline -> assigned_driver_id=null, status stays 'requested'."""
        ride = _create_immediate_ride(tokens["p_tok"])
        rid = ride["id"]
        # Sanity: this driver was the assigned one
        stored = db.rides.find_one({"id": rid}, {"_id": 0})
        assert stored.get("assigned_driver_id") == tokens["d_user"]["id"]

        # Decline as chauffeur
        r = requests.post(f"{API}/rides/{rid}/decline", headers=_auth(tokens["d_tok"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        after = db.rides.find_one({"id": rid}, {"_id": 0})
        assert after["status"] == "requested", f"status changed unexpectedly: {after['status']}"
        assert after.get("assigned_driver_id") is None, \
            f"expected broadcast (null), got {after.get('assigned_driver_id')}"
        # decline record persisted
        decline = db.ride_declines.find_one({"ride_id": rid, "driver_id": tokens["d_user"]["id"]})
        assert decline is not None, "decline record missing"

        # cleanup
        db.rides.delete_one({"id": rid})
        db.ride_declines.delete_many({"ride_id": rid})

    def test_decline_multi_driver_advances_to_next(self, tokens, db):
        """Seed a 2nd fake online driver so decline cascades to next best."""
        p_tok = tokens["p_tok"]
        chauffeur_id = tokens["d_user"]["id"]
        fake_id = f"TEST-driver-{uuid.uuid4().hex[:8]}"
        db.users.insert_one({
            "id": fake_id,
            "email": f"TEST_fake_{fake_id}@example.com",
            "full_name": "TEST Fake Driver",
            "role": "driver",
            "is_online": True,
            "is_active": True,
            "docs_blocked": False,
            "rating": 4.5,
            "driver_location": {"lat": 48.8600, "lng": 2.3600},
            "vehicle_type": None,
        })
        try:
            ride = _create_immediate_ride(p_tok)
            rid = ride["id"]
            stored = db.rides.find_one({"id": rid}, {"_id": 0})
            cands = stored.get("candidates") or []
            cand_ids = [c["driver_id"] for c in cands]
            assert chauffeur_id in cand_ids and fake_id in cand_ids, \
                f"expected both drivers as candidates, got {cand_ids}"
            first = stored.get("assigned_driver_id")
            assert first in (chauffeur_id, fake_id)

            # If chauffeur is offered first, decline as chauffeur; else the fake driver
            # can't decline via API — so if fake is first, we skip that scenario.
            if first == chauffeur_id:
                r = requests.post(f"{API}/rides/{rid}/decline",
                                  headers=_auth(tokens["d_tok"]), timeout=15)
                assert r.status_code == 200, r.text
                after = db.rides.find_one({"id": rid}, {"_id": 0})
                assert after["status"] == "requested"
                assert after.get("assigned_driver_id") == fake_id, \
                    f"expected cascade to fake driver, got {after.get('assigned_driver_id')}"
            else:
                # fake driver assigned first; simulate its decline via direct write + advance_offer
                # We cannot call advance_offer directly across process. Instead, manually
                # insert a decline record & wait for expiry sweep (short offer_seconds=4).
                db.ride_declines.update_one(
                    {"ride_id": rid, "driver_id": fake_id},
                    {"$set": {"declined_at": None, "reason": "test"}}, upsert=True)
                # Also expire the offer so sweep advances
                from datetime import datetime, timezone, timedelta
                db.rides.update_one({"id": rid},
                                    {"$set": {"offer_expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}})
                time.sleep(7)  # dispatch_loop runs every 5s
                after = db.rides.find_one({"id": rid}, {"_id": 0})
                assert after.get("assigned_driver_id") == chauffeur_id, \
                    f"expected cascade to chauffeur, got {after.get('assigned_driver_id')}"

            # cleanup
            db.rides.delete_one({"id": rid})
            db.ride_declines.delete_many({"ride_id": rid})
        finally:
            db.users.delete_one({"id": fake_id})


# ---------------- 4. Timeout cascade ----------------
class TestTimeoutCascade:
    def test_timeout_sweep_advances_offer(self, tokens, db):
        """After offer_expires_at passes, dispatch_loop auto-declines and advances."""
        # Force short response_seconds so this test doesn't run for 15s+
        requests.put(f"{API}/admin/settings", headers=_auth(tokens["d_tok"]),
                     json={"dispatch": {"enabled": True, "radius_km": 25.0,
                                        "max_drivers": 5, "response_seconds": 4,
                                        "priority": "distance"}}, timeout=15)
        ride = _create_immediate_ride(tokens["p_tok"])
        rid = ride["id"]
        stored = db.rides.find_one({"id": rid}, {"_id": 0})
        first_assigned = stored.get("assigned_driver_id")
        assert first_assigned == tokens["d_user"]["id"]
        assert stored.get("offer_expires_at") is not None
        # Sanity: offer_seconds actually stored as 4
        assert stored.get("offer_seconds") == 4, \
            f"offer_seconds not 4: {stored.get('offer_seconds')}"

        # Wait for expiry + sweep tick (dispatch_loop every 5s). offer expires at t+4.
        # Poll for up to 25s in case the sweep just missed a tick or backend recently reloaded.
        first_assigned_uid = first_assigned
        after = None
        for _ in range(25):
            time.sleep(1)
            after = db.rides.find_one({"id": rid}, {"_id": 0})
            if after.get("assigned_driver_id") != first_assigned_uid:
                break
        assert after["status"] == "requested", f"status changed: {after['status']}"
        # With only 1 online driver: assigned_driver_id should be null after cascade
        assert after.get("assigned_driver_id") != first_assigned, \
            "assigned_driver_id did NOT advance after timeout"
        # Timeout decline record with reason=timeout
        decline = db.ride_declines.find_one({"ride_id": rid, "driver_id": first_assigned})
        assert decline is not None, "timeout decline record missing"
        assert decline.get("reason") == "timeout", f"unexpected reason: {decline.get('reason')}"

        # cleanup
        db.rides.delete_one({"id": rid})
        db.ride_declines.delete_many({"ride_id": rid})


# ---------------- 5. Accept regression ----------------
class TestAcceptRegression:
    def test_driver_can_still_accept_offered_ride(self, tokens, db):
        ride = _create_immediate_ride(tokens["p_tok"])
        rid = ride["id"]
        # Driver accepts the ride offered to them
        r = requests.post(f"{API}/rides/{rid}/accept", headers=_auth(tokens["d_tok"]), timeout=15)
        assert r.status_code == 200, f"accept failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["status"] == "accepted"
        assert body.get("driver_id") == tokens["d_user"]["id"]

        # start -> in_progress
        r2 = requests.post(f"{API}/rides/{rid}/start", headers=_auth(tokens["d_tok"]), timeout=15)
        assert r2.status_code == 200, f"start failed: {r2.status_code} {r2.text}"
        assert r2.json()["status"] == "in_progress"

        # complete -> completed
        r3 = requests.post(f"{API}/rides/{rid}/complete", headers=_auth(tokens["d_tok"]), timeout=20)
        assert r3.status_code == 200, f"complete failed: {r3.status_code} {r3.text}"
        assert r3.json()["status"] == "completed"

        # cleanup
        db.rides.delete_one({"id": rid})
