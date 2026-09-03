"""Iteration 9: favorites, cancellation fee, decline+stats, public tracking."""
import os
import time
import uuid

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
PASS_EMAIL = "passager@test.com"
DRV_EMAIL = "chauffeur@test.com"
PWD = "password123"

PICKUP = {"lat": 48.8566, "lng": 2.3522, "address": "Paris"}
DROPOFF = {"lat": 48.8738, "lng": 2.2950, "address": "Arc de Triomphe"}


def _tok(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def pas_tok():
    return _tok(PASS_EMAIL, PWD)


@pytest.fixture(scope="module")
def drv_tok():
    tok = _tok(DRV_EMAIL, PWD)
    # ensure no leftover active ride and be online
    active = requests.get(f"{BASE}/rides/active-list", headers=_h(tok), timeout=30).json()
    for r in active or []:
        rid = r["id"]
        if r["status"] == "accepted":
            requests.post(f"{BASE}/rides/{rid}/cancel", headers=_h(tok), timeout=30)
        elif r["status"] == "in_progress":
            requests.post(f"{BASE}/rides/{rid}/complete", headers=_h(tok), timeout=30)
    requests.post(f"{BASE}/driver/status", headers=_h(tok), json={"is_online": True, "lat": PICKUP["lat"], "lng": PICKUP["lng"]}, timeout=30)
    return tok


# ---------- Favorites ----------
class TestFavorites:
    def test_crud_and_upsert(self, pas_tok):
        h = _h(pas_tok)
        # clear existing favorites first
        existing = requests.get(f"{BASE}/favorites", headers=h, timeout=30).json()
        for f in existing:
            requests.delete(f"{BASE}/favorites/{f['id']}", headers=h, timeout=30)

        payload = {"label": "Maison", "name": "Chez moi", "address": "1 rue de Paris", "lat": 48.85, "lng": 2.35, "icon": "home"}
        r = requests.post(f"{BASE}/favorites", headers=h, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        fav1 = r.json()
        assert fav1["label"] == "Maison"
        assert fav1["address"] == "1 rue de Paris"
        first_id = fav1["id"]

        # Post 2nd Maison → replaces first
        payload2 = {**payload, "address": "2 rue de Lyon"}
        r2 = requests.post(f"{BASE}/favorites", headers=h, json=payload2, timeout=30)
        assert r2.status_code == 200
        lst = requests.get(f"{BASE}/favorites", headers=h, timeout=30).json()
        maison = [f for f in lst if f["label"] == "Maison"]
        assert len(maison) == 1
        assert maison[0]["address"] == "2 rue de Lyon"
        assert maison[0]["id"] != first_id

        # DELETE unknown → 404
        r3 = requests.delete(f"{BASE}/favorites/{uuid.uuid4()}", headers=h, timeout=30)
        assert r3.status_code == 404

        # DELETE real → 200
        r4 = requests.delete(f"{BASE}/favorites/{maison[0]['id']}", headers=h, timeout=30)
        assert r4.status_code == 200
        lst2 = requests.get(f"{BASE}/favorites", headers=h, timeout=30).json()
        assert all(f["label"] != "Maison" for f in lst2)


def _create_ride(pas_tok, method="cash"):
    body = {"pickup": PICKUP, "dropoff": DROPOFF, "vehicle_type": "standard", "surcharge_enabled": False, "payment_method": method}
    r = requests.post(f"{BASE}/rides", headers=_h(pas_tok), json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Cancellation ----------
class TestCancellation:
    def test_requested_cancel_no_fee(self, pas_tok):
        ride = _create_ride(pas_tok)
        r = requests.post(f"{BASE}/rides/{ride['id']}/cancel", headers=_h(pas_tok), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "cancelled"
        assert (data.get("cancellation_fee") or 0) == 0

    def test_accepted_cancel_charges_fee(self, pas_tok, drv_tok):
        ride = _create_ride(pas_tok)
        ra = requests.post(f"{BASE}/rides/{ride['id']}/accept", headers=_h(drv_tok), timeout=30)
        assert ra.status_code == 200, ra.text
        rc = requests.post(f"{BASE}/rides/{ride['id']}/cancel", headers=_h(pas_tok), timeout=30)
        assert rc.status_code == 200
        data = rc.json()
        assert data["status"] == "cancelled"
        assert data["cancellation_fee"] == 3.0

    def test_in_progress_cancel_by_passenger_409(self, pas_tok, drv_tok):
        ride = _create_ride(pas_tok)
        assert requests.post(f"{BASE}/rides/{ride['id']}/accept", headers=_h(drv_tok), timeout=30).status_code == 200
        assert requests.post(f"{BASE}/rides/{ride['id']}/start", headers=_h(drv_tok), timeout=30).status_code == 200
        rc = requests.post(f"{BASE}/rides/{ride['id']}/cancel", headers=_h(pas_tok), timeout=30)
        assert rc.status_code == 409
        # cleanup: driver completes it
        requests.post(f"{BASE}/rides/{ride['id']}/complete", headers=_h(drv_tok), timeout=30)

    def test_earnings_has_cancellation_fees(self, drv_tok):
        r = requests.get(f"{BASE}/driver/earnings", headers=_h(drv_tok), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "cancellation_fees" in data
        assert data["cancellation_fees"] >= 3.0


# ---------- Decline + stats ----------
class TestDeclineAndStats:
    def test_decline_hides_ride(self, pas_tok, drv_tok):
        ride = _create_ride(pas_tok)
        d = requests.post(f"{BASE}/rides/{ride['id']}/decline", headers=_h(drv_tok), timeout=30)
        assert d.status_code == 200
        avail = requests.get(f"{BASE}/rides/available", headers=_h(drv_tok), timeout=30).json()
        assert all(r["id"] != ride["id"] for r in avail)
        # cleanup
        requests.post(f"{BASE}/rides/{ride['id']}/cancel", headers=_h(pas_tok), timeout=30)

    def test_decline_unknown_404(self, drv_tok):
        r = requests.post(f"{BASE}/rides/{uuid.uuid4()}/decline", headers=_h(drv_tok), timeout=30)
        assert r.status_code == 404

    def test_stats_shape(self, drv_tok):
        r = requests.get(f"{BASE}/driver/stats", headers=_h(drv_tok), timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ("online_hours_week", "online_hours_total", "acceptance_rate", "accepted", "declined", "best_slots", "earnings_by_day"):
            assert k in data, f"missing {k}"
        assert isinstance(data["earnings_by_day"], list) and len(data["earnings_by_day"]) == 7
        # acceptance rate can be int or None
        if data["acceptance_rate"] is not None:
            assert isinstance(data["acceptance_rate"], (int, float))
        assert data["declined"] >= 1

    def test_online_hours_increases_after_toggle(self, drv_tok):
        h = _h(drv_tok)
        # ensure online → then offline → online again
        s1 = requests.get(f"{BASE}/driver/stats", headers=h, timeout=30).json()
        prev_total = s1["online_hours_total"]
        # go offline (this closes the session and increments totals)
        requests.post(f"{BASE}/driver/status", headers=h, json={"is_online": False}, timeout=30)
        time.sleep(2)
        s2 = requests.get(f"{BASE}/driver/stats", headers=h, timeout=30).json()
        # go back online for downstream tests
        requests.post(f"{BASE}/driver/status", headers=h, json={"is_online": True, "lat": PICKUP["lat"], "lng": PICKUP["lng"]}, timeout=30)
        assert s2["online_hours_total"] >= prev_total


# ---------- Public tracking ----------
class TestPublicTrack:
    def test_bad_token_404(self):
        r = requests.get(f"{BASE}/public/track/does-not-exist-xyz", timeout=30)
        assert r.status_code == 404

    def test_public_track_no_auth_exposes_only_safe_fields(self, pas_tok):
        ride = _create_ride(pas_tok)
        rid = ride["id"]
        detail = requests.get(f"{BASE}/rides/{rid}", headers=_h(pas_tok), timeout=30).json()
        tok = detail.get("share_token")
        assert tok, "ride must expose share_token"
        # explicitly no Authorization header
        r = requests.get(f"{BASE}/public/track/{tok}", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] in ("requested", "accepted", "in_progress")
        assert data["pickup"]["address"] == PICKUP["address"]
        assert data["dropoff"]["address"] == DROPOFF["address"]
        # sensitive fields must NOT be present
        for forbidden in ("passenger_id", "passenger_phone"):
            assert forbidden not in data, f"{forbidden} leaked in public payload"
        # cleanup
        requests.post(f"{BASE}/rides/{rid}/cancel", headers=_h(pas_tok), timeout=30)
