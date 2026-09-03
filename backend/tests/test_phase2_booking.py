"""Phase 2 – Réservation premium: catalog, fixed routes, estimate, ride creation, flight lookup,
moderator CRUD, and detailed review."""
import os
import re
import time
import uuid

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
PASSENGER = ("passager@test.com", "password123")
DRIVER = ("chauffeur@test.com", "password123")
PASSWORD = "password123"

CDG = {"lat": 49.0097, "lng": 2.5479, "address": "Aéroport CDG T2"}
PARIS = {"lat": 48.8566, "lng": 2.3522, "address": "Paris Centre"}
EIFFEL = {"lat": 48.8584, "lng": 2.2945, "address": "Tour Eiffel"}
LOUVRE = {"lat": 48.8606, "lng": 2.3376, "address": "Louvre"}


def _login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def pass_token():
    return _login(*PASSENGER)


@pytest.fixture(scope="session")
def driver_token():
    return _login(*DRIVER)


# -------- Catalog ----------
class TestCatalog:
    def test_catalog(self):
        r = requests.get(f"{BASE}/catalog", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["services"]) == 8
        assert len(d["vehicles"]) == 5
        assert d["flight_tracking"] is False
        assert d["cancellation_policy"]["text"]
        keys = {s["key"] for s in d["services"]}
        assert keys == {"private", "airport", "hourly", "business", "city_tour", "events", "long_distance", "special"}
        vkeys = {v["key"] for v in d["vehicles"]}
        assert vkeys == {"standard", "premium", "van", "van_premium", "group"}


# -------- Fixed routes ----------
class TestFixedRoutes:
    def test_list(self, pass_token):
        r = requests.get(f"{BASE}/fixed-routes", headers=_auth(pass_token), timeout=15)
        assert r.status_code == 200
        routes = r.json()
        assert len(routes) >= 12
        for rt in routes:
            assert rt["active"] is True
            assert "from_zone" in rt and "to_zone" in rt and "prices" in rt


# -------- Estimate ----------
class TestEstimate:
    def test_airport_fixed_and_capacity(self):
        body = {"pickup": CDG, "dropoff": PARIS, "service_type": "airport", "passengers": 5, "luggage": 4}
        r = requests.post(f"{BASE}/rides/estimate", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pricing"] == "fixed"
        prices = {o["vehicle_type"]: o["price"] for o in d["options"]}
        assert prices["standard"] == 75
        assert prices["premium"] == 95
        assert prices["van"] == 110
        assert prices["van_premium"] == 140
        assert prices["group"] == 190
        fits_by = {o["vehicle_type"]: o["fits"] for o in d["options"]}
        assert fits_by["standard"] is False
        assert fits_by["premium"] is False
        assert fits_by["van"] is True
        assert fits_by["van_premium"] is True
        assert fits_by["group"] is True
        # each option has required attrs
        for o in d["options"]:
            assert "image_url" in o and "passengers" in o and "luggage" in o and "category" in o
        assert d["cancellation_policy"]

    def test_hourly_min_and_price(self):
        r = requests.post(f"{BASE}/rides/estimate", json={"pickup": EIFFEL, "dropoff": LOUVRE,
                                                         "service_type": "hourly", "hours": 1}, timeout=15)
        d = r.json()
        assert d["pricing"] == "hourly"
        assert d["hours"] == 2
        std = next(o for o in d["options"] if o["vehicle_type"] == "standard")
        assert std["price"] == 55 * 2

    def test_city_tour_min_3h(self):
        r = requests.post(f"{BASE}/rides/estimate", json={"pickup": EIFFEL, "dropoff": LOUVRE,
                                                         "service_type": "city_tour", "hours": 1}, timeout=15)
        d = r.json()
        assert d["pricing"] == "hourly"
        assert d["hours"] == 3

    def test_private_intra_muros_distance(self):
        r = requests.post(f"{BASE}/rides/estimate", json={"pickup": EIFFEL, "dropoff": LOUVRE,
                                                         "service_type": "private"}, timeout=15)
        d = r.json()
        assert d["pricing"] == "distance"


# -------- Ride creation (capacity & airport transfer) ----------
class TestRideCreation:
    def test_capacity_422(self, pass_token):
        body = {"pickup": CDG, "dropoff": PARIS, "vehicle_type": "standard",
                "service_type": "airport", "passengers": 5, "luggage": 4}
        r = requests.post(f"{BASE}/rides", json=body, headers=_auth(pass_token), timeout=15)
        assert r.status_code == 422
        assert "passagers" in r.text.lower() or "berline" in r.text.lower()

    def test_airport_van_with_flight(self, pass_token):
        body = {"pickup": CDG, "dropoff": PARIS, "vehicle_type": "van", "service_type": "airport",
                "passengers": 5, "luggage": 4, "flight_number": "AF 1234", "airline": "Air France"}
        r = requests.post(f"{BASE}/rides", json=body, headers=_auth(pass_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert re.match(r"^RG-[A-Z0-9]{6}$", d["booking_ref"])
        assert d["fixed_price"] is True
        assert d["fixed_route_name"]
        assert d["flight"]["number"] == "AF1234"
        assert "tracking_error" in d["flight"]  # no AviationStack key
        assert d["service_label"] == "Transfert aéroport"
        assert d["price"] == 110
        # cleanup
        requests.post(f"{BASE}/rides/{d['id']}/cancel", headers=_auth(pass_token), timeout=15)

    def test_hourly_ride(self, pass_token):
        body = {"pickup": EIFFEL, "dropoff": LOUVRE, "vehicle_type": "premium",
                "service_type": "hourly", "hours": 3, "passengers": 2, "luggage": 1}
        r = requests.post(f"{BASE}/rides", json=body, headers=_auth(pass_token), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["price"] == 255
        assert d["hours"] == 3
        requests.post(f"{BASE}/rides/{d['id']}/cancel", headers=_auth(pass_token), timeout=15)


# -------- Flight lookup ----------
class TestFlights:
    def test_valid_number_not_configured(self, pass_token):
        r = requests.get(f"{BASE}/flights/AF1234", headers=_auth(pass_token), timeout=15)
        assert r.status_code == 503

    def test_invalid_number(self, pass_token):
        r = requests.get(f"{BASE}/flights/BAD", headers=_auth(pass_token), timeout=15)
        assert r.status_code == 404


# -------- Moderator fixed routes CRUD ----------
class TestModeratorFixedRoutes:
    def test_crud_and_permissions(self, driver_token, pass_token):
        # chauffeur is a MODERATOR per test_credentials.md
        name = f"TEST_{uuid.uuid4().hex[:6]} A → B"
        body = {
            "name": name,
            "from_zone": {"name": "A", "lat": 48.8, "lng": 2.3, "radius_km": 2},
            "to_zone": {"name": "B", "lat": 48.9, "lng": 2.4, "radius_km": 2},
            "prices": {"standard": 50.0},
        }
        r = requests.post(f"{BASE}/admin/fixed-routes", json=body, headers=_auth(driver_token), timeout=15)
        assert r.status_code == 201, r.text
        rid = r.json()["id"]

        # patch price
        body["prices"] = {"standard": 60.0}
        r = requests.patch(f"{BASE}/admin/fixed-routes/{rid}", json=body, headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["prices"]["standard"] == 60.0

        # invalid vehicle key → 422
        bad = {**body, "prices": {"bogus_vehicle": 42}}
        r = requests.patch(f"{BASE}/admin/fixed-routes/{rid}", json=bad, headers=_auth(driver_token), timeout=15)
        assert r.status_code == 422

        # passenger is also in MODERATOR_EMAILS according to test_credentials.md
        # To test non-moderator forbidden, register a throwaway user
        email = f"TEST_nonmod_{uuid.uuid4().hex[:6]}@example.com"
        reg = requests.post(f"{BASE}/auth/register", json={
            "email": email, "password": PASSWORD, "full_name": "Non Mod", "role": "passenger"
        }, timeout=15)
        assert reg.status_code in (200, 201), reg.text
        tok = reg.json()["access_token"]
        r = requests.post(f"{BASE}/admin/fixed-routes", json=body, headers=_auth(tok), timeout=15)
        assert r.status_code == 403

        # delete
        r = requests.delete(f"{BASE}/admin/fixed-routes/{rid}", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200


# -------- Detailed review ----------
class TestDetailedReview:
    def test_rate_with_criteria(self, pass_token, driver_token):
        # driver online at CDG
        r = requests.post(f"{BASE}/driver/status", json={"is_online": True, "lat": CDG["lat"], "lng": CDG["lng"]},
                          headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200

        # passenger creates a ride
        body = {"pickup": CDG, "dropoff": PARIS, "vehicle_type": "van", "service_type": "airport",
                "passengers": 3, "luggage": 2}
        r = requests.post(f"{BASE}/rides", json=body, headers=_auth(pass_token), timeout=15)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]

        # driver accept → start → complete
        r = requests.post(f"{BASE}/rides/{rid}/accept", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        r = requests.post(f"{BASE}/rides/{rid}/start", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        r = requests.post(f"{BASE}/rides/{rid}/complete", headers=_auth(driver_token), timeout=15)
        assert r.status_code == 200, r.text

        # rate with detailed criteria
        review = {"rating": 5, "tip": 0, "comment": "Parfait",
                  "punctuality": 5, "cleanliness": 4, "driving": 5, "vehicle": 5}
        r = requests.post(f"{BASE}/rides/{rid}/rate", json=review, headers=_auth(pass_token), timeout=15)
        assert r.status_code == 200, r.text
        rv = r.json()["review"]
        assert rv["comment"] == "Parfait"
        assert rv["punctuality"] == 5
        assert rv["cleanliness"] == 4
        assert rv["driving"] == 5
        assert rv["vehicle"] == 5

        # second rate → 409
        r = requests.post(f"{BASE}/rides/{rid}/rate", json=review, headers=_auth(pass_token), timeout=15)
        assert r.status_code == 409

        # take driver offline
        requests.post(f"{BASE}/driver/status", json={"is_online": False}, headers=_auth(driver_token), timeout=15)
