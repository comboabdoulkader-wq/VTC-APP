"""Backend tests for VTC iteration 2 – new features.

Covers:
- Estimate with distance surcharge (rallonge)
- Ride create with surcharge/scheduled_at/passenger_label/notes/payment_method
- Batch ride creation
- Driver available filtering + accept/start/complete lifecycle including cash payment
- Driver /location -> arrival alert + notifications for passenger
- Stripe hosted checkout session + status + config
- Private rides CRUD + 15% commission + earnings split
- Team members CRUD, assign, overview, deactivated login 403
- Notifications endpoints
"""
import os
import uuid
import time
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUFFIX = uuid.uuid4().hex[:8]
PAX_EMAIL = f"test_pax_{SUFFIX}@example.com"
DRV_EMAIL = f"test_drv_{SUFFIX}@example.com"
MEM_EMAIL = f"test_mem_{SUFFIX}@example.com"
PASSWORD = "Passw0rd!"

state: dict = {}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _login_or_register(s, email, role, extra=None):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    if r.status_code == 200:
        return r.json()
    body = {"email": email, "password": PASSWORD, "full_name": email.split("@")[0].title(), "role": role, "phone": "+33600000000"}
    if extra:
        body.update(extra)
    r = s.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---- Setup ----
def test_setup_users(s):
    d = _login_or_register(s, PAX_EMAIL, "passenger")
    state["pax_token"] = d["access_token"]
    state["pax_id"] = d["user"]["id"]
    d = _login_or_register(s, DRV_EMAIL, "driver", {"vehicle_model": "Peugeot 508", "license_plate": "AB-123-CD"})
    state["drv_token"] = d["access_token"]
    state["drv_id"] = d["user"]["id"]


# ---- Estimate with surcharge ----
def test_estimate_returns_options_and_surcharge(s):
    r = s.post(f"{API}/rides/estimate", json={
        "pickup": {"lat": 48.95, "lng": 2.45, "address": "Loin du centre"},
        "dropoff": {"lat": 48.8584, "lng": 2.2945, "address": "Tour Eiffel"},
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d, dict) and "options" in d and "surcharge" in d
    assert len(d["options"]) == 3
    types = {o["vehicle_type"] for o in d["options"]}
    assert types == {"standard", "premium", "van"}
    sur = d["surcharge"]
    assert sur is not None
    assert sur["per_km"] == 1.2
    # 48.95,2.45 -> Châtelet 48.8584,2.3488 ≈ 12.6km * 1.2 ≈ 15.12
    assert 14.0 <= sur["amount"] <= 16.5, f"Surcharge amount {sur['amount']} out of expected ~15.12 range"
    assert sur["distance_to_center_km"] > 0
    assert "center_name" in sur
    state["est_dist"] = d["options"][0]["distance_km"]


# ---- Create ride with new options ----
def test_create_ride_with_surcharge_and_options(s):
    r = s.post(f"{API}/rides", headers=_auth(state["pax_token"]), json={
        "pickup": {"lat": 48.95, "lng": 2.45, "address": "Loin du centre"},
        "dropoff": {"lat": 48.8584, "lng": 2.2945, "address": "Tour Eiffel"},
        "vehicle_type": "standard",
        "surcharge_enabled": True,
        "scheduled_at": "2026-07-01T10:00:00Z",
        "passenger_label": "Maman",
        "notes": "Sonner deux fois",
        "payment_method": "card",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["surcharge_enabled"] is True
    assert d["surcharge_amount"] > 10
    assert abs(d["price"] - (d["base_price"] + d["surcharge_amount"])) < 0.05
    assert d["scheduled_at"] is not None and d["scheduled_at"].startswith("2026-07-01")
    assert d["passenger_label"] == "Maman"
    assert d["notes"] == "Sonner deux fois"
    assert d["payment_method"] == "card"
    state["ride_card_id"] = d["id"]
    # GET to verify persistence
    g = s.get(f"{API}/rides/{d['id']}", headers=_auth(state["pax_token"]))
    assert g.status_code == 200
    assert g.json()["passenger_label"] == "Maman"


# ---- Batch ----
def test_create_batch(s):
    r = s.post(f"{API}/rides/batch", headers=_auth(state["pax_token"]), json={"rides": [
        {"pickup": {"lat": 48.85, "lng": 2.35, "address": "A"},
         "dropoff": {"lat": 48.87, "lng": 2.29, "address": "B"},
         "vehicle_type": "standard", "payment_method": "cash"},
        {"pickup": {"lat": 48.86, "lng": 2.34, "address": "C"},
         "dropoff": {"lat": 48.88, "lng": 2.30, "address": "D"},
         "vehicle_type": "van", "scheduled_at": "2026-07-02T09:00:00Z"},
    ]})
    assert r.status_code == 200, r.text
    rides = r.json()
    assert len(rides) == 2
    bids = {r["batch_id"] for r in rides}
    assert len(bids) == 1 and None not in bids
    state["batch_ride_ids"] = [x["id"] for x in rides]
    state["cash_ride_id"] = rides[0]["id"]

    # active-list contains them
    r2 = s.get(f"{API}/rides/active-list", headers=_auth(state["pax_token"]))
    assert r2.status_code == 200
    active_ids = [x["id"] for x in r2.json()]
    for rid in state["batch_ride_ids"]:
        assert rid in active_ids


# ---- Driver flow: available + accept + location + complete cash ----
def test_driver_available_and_lifecycle(s):
    # driver goes online
    s.post(f"{API}/driver/status", headers=_auth(state["drv_token"]),
           json={"is_online": True, "lat": 48.86, "lng": 2.35})

    r = s.get(f"{API}/rides/available", headers=_auth(state["drv_token"]))
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert state["cash_ride_id"] in ids
    for x in r.json():
        assert x["source"] == "platform"

    # accept cash ride
    ride_id = state["cash_ride_id"]
    r = s.post(f"{API}/rides/{ride_id}/accept", headers=_auth(state["drv_token"]))
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"

    # location ping near pickup -> arrival alert once
    pickup_ride = r.json()["pickup"]
    r2 = s.post(f"{API}/driver/location", headers=_auth(state["drv_token"]),
                json={"lat": pickup_ride["lat"] + 0.001, "lng": pickup_ride["lng"] + 0.001})
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d.get("arrival_alert") is True
    assert d.get("eta_min") is not None

    # second ping does NOT re-alert
    r3 = s.post(f"{API}/driver/location", headers=_auth(state["drv_token"]),
                json={"lat": pickup_ride["lat"], "lng": pickup_ride["lng"]})
    assert r3.json().get("arrival_alert") is False

    # passenger sees notification 'arriving'
    time.sleep(0.5)
    n = s.get(f"{API}/notifications", headers=_auth(state["pax_token"]))
    assert n.status_code == 200
    types = [x["type"] for x in n.json()]
    assert "arriving" in types
    state["notif_id"] = next(x["id"] for x in n.json() if x["type"] == "arriving")

    # ride details reflect driver_location + eta
    g = s.get(f"{API}/rides/{ride_id}", headers=_auth(state["pax_token"]))
    gd = g.json()
    assert gd.get("driver_location") is not None
    assert gd.get("driver_eta_min") is not None

    # start + complete cash → payment_status paid
    s.post(f"{API}/rides/{ride_id}/start", headers=_auth(state["drv_token"]))
    r = s.post(f"{API}/rides/{ride_id}/complete", headers=_auth(state["drv_token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "completed"
    assert d["payment_status"] == "paid"


# ---- Stripe checkout ----
def test_stripe_config(s):
    r = s.get(f"{API}/payments/config")
    assert r.status_code == 200
    assert r.json()["card_enabled"] is True


def test_stripe_checkout_and_status(s):
    ride_id = state["ride_card_id"]
    r = s.post(f"{API}/payments/checkout/{ride_id}", headers=_auth(state["pax_token"]),
               json={"return_url": "https://vtc-platform-18.preview.emergentagent.com/payment-result"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("checkout_url", "").startswith("https://checkout.stripe.com")
    assert d.get("session_id")

    r2 = s.get(f"{API}/payments/status/{ride_id}", headers=_auth(state["pax_token"]))
    assert r2.status_code == 200
    assert r2.json()["status"] == "pending"


# ---- Private rides + commission ----
def test_private_ride_flow(s):
    r = s.post(f"{API}/driver/private-rides", headers=_auth(state["drv_token"]), json={
        "client_name": "M. Martin", "client_phone": "+33600000009",
        "pickup_address": "Gare du Nord", "dropoff_address": "Orly",
        "scheduled_at": "2026-07-05T08:00:00Z", "price": 60,
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "accepted"
    assert d["source"] == "private"
    pid = d["id"]

    # DELETE on non-completed private ride works — create another to delete
    r2 = s.post(f"{API}/driver/private-rides", headers=_auth(state["drv_token"]), json={
        "client_name": "TEST_delete", "pickup_address": "X", "dropoff_address": "Y",
        "scheduled_at": "2026-07-06T10:00:00Z", "price": 30,
    })
    del_id = r2.json()["id"]
    dr = s.delete(f"{API}/driver/private-rides/{del_id}", headers=_auth(state["drv_token"]))
    assert dr.status_code == 200

    # Complete → commission 9.0 = 60 * 0.15
    r3 = s.patch(f"{API}/driver/private-rides/{pid}", headers=_auth(state["drv_token"]),
                 json={"status": "completed"})
    assert r3.status_code == 200, r3.text
    d = r3.json()
    assert d["status"] == "completed"
    assert abs(d["commission_amount"] - 9.0) < 0.01

    # DELETE on completed forbidden
    dr = s.delete(f"{API}/driver/private-rides/{pid}", headers=_auth(state["drv_token"]))
    assert dr.status_code == 404

    # Earnings split
    e = s.get(f"{API}/driver/earnings", headers=_auth(state["drv_token"]))
    assert e.status_code == 200
    ed = e.json()
    assert ed["commission"] >= 9.0
    assert ed["private"]["count"] >= 1
    assert ed["platform"]["count"] >= 1
    assert ed["net"] == round(ed["total"] - ed["commission"], 2)


# ---- Team ----
def test_team_member_add_assign_deactivate(s):
    # cleanup: if member already exists (previous test run), try login then remove membership
    r = s.post(f"{API}/team/members", headers=_auth(state["drv_token"]), json={
        "email": MEM_EMAIL, "password": PASSWORD, "full_name": "Karim Test",
        "vehicle_model": "Tesla 3", "license_plate": "EQ-001-AA",
    })
    assert r.status_code == 200, r.text
    member = r.json()
    assert member["manager_id"] == state["drv_id"]
    mid = member["id"]
    state["member_id"] = mid

    # A member cannot manage its own team (create a ride first as passenger to test assign)
    ride_r = s.post(f"{API}/rides", headers=_auth(state["pax_token"]), json={
        "pickup": {"lat": 48.85, "lng": 2.35, "address": "A"},
        "dropoff": {"lat": 48.87, "lng": 2.29, "address": "B"},
        "vehicle_type": "standard",
    })
    assigned_ride = ride_r.json()["id"]

    # Assign that ride to member
    a = s.post(f"{API}/team/assign", headers=_auth(state["drv_token"]),
               json={"ride_id": assigned_ride, "driver_id": mid})
    assert a.status_code == 200, a.text
    ad = a.json()
    assert ad["driver_id"] == mid
    assert ad["status"] == "accepted"
    assert ad.get("assigned_by_name"), "Expected assigned_by_name on assigned ride"

    # Overview
    o = s.get(f"{API}/team/overview", headers=_auth(state["drv_token"]))
    assert o.status_code == 200
    od = o.json()
    assert od["members_count"] >= 1
    assert od["active_count"] >= 1

    # Member login → cancel that ride first (member trying to add team member = 403)
    ml = s.post(f"{API}/auth/login", json={"email": MEM_EMAIL, "password": PASSWORD})
    assert ml.status_code == 200
    mtoken = ml.json()["access_token"]
    forbidden = s.post(f"{API}/team/members", headers=_auth(mtoken), json={
        "email": f"sub_{SUFFIX}@example.com", "password": PASSWORD, "full_name": "Sub"
    })
    assert forbidden.status_code == 403

    # Deactivate → member login 403 "Compte désactivé"
    d = s.patch(f"{API}/team/members/{mid}", headers=_auth(state["drv_token"]),
                json={"is_active": False})
    assert d.status_code == 200
    assert d.json()["is_active"] is False
    ml2 = s.post(f"{API}/auth/login", json={"email": MEM_EMAIL, "password": PASSWORD})
    assert ml2.status_code == 403
    assert "désactiv" in ml2.text.lower()

    # Reactivate
    d = s.patch(f"{API}/team/members/{mid}", headers=_auth(state["drv_token"]),
                json={"is_active": True})
    assert d.status_code == 200
    # Cleanup: cancel assigned ride via manager
    s.post(f"{API}/rides/{assigned_ride}/cancel", headers=_auth(state["drv_token"]))


# ---- Notifications ----
def test_notifications_read(s):
    n = s.get(f"{API}/notifications", headers=_auth(state["pax_token"]))
    assert n.status_code == 200
    assert isinstance(n.json(), list)
    if state.get("notif_id"):
        r = s.post(f"{API}/notifications/{state['notif_id']}/read", headers=_auth(state["pax_token"]))
        assert r.status_code == 200
    r = s.post(f"{API}/notifications/read-all", headers=_auth(state["pax_token"]))
    assert r.status_code == 200
    # verify unread=0
    n2 = s.get(f"{API}/notifications?unread_only=true", headers=_auth(state["pax_token"]))
    assert n2.status_code == 200
    assert len(n2.json()) == 0


# ---- Cleanup batch scheduled ride ----
def test_cancel_leftovers(s):
    for rid in state.get("batch_ride_ids", []):
        s.post(f"{API}/rides/{rid}/cancel", headers=_auth(state["pax_token"]))
    if state.get("ride_card_id"):
        s.post(f"{API}/rides/{state['ride_card_id']}/cancel", headers=_auth(state["pax_token"]))
