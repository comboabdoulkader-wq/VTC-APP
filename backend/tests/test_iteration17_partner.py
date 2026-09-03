"""Iteration 17 - Partner space (hotels/concierges/agencies) backend tests."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
TS = int(time.time())


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _register(s, email, role="company", partner_type="company", company_name="Test Co"):
    payload = {"email": email, "password": "password123", "full_name": company_name, "role": role,
               "company_name": company_name, "partner_type": partner_type}
    return s.post(f"{API}/auth/register", json=payload, timeout=15)


def _login(s, email, password="password123"):
    return s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


# ---------- Registration + partner info ----------
class TestPartnerRegistration:
    def test_register_hotel_partner(self, s):
        email = f"hotel.test.{TS}@test.com"
        r = _register(s, email, partner_type="hotel", company_name="Hotel Test")
        assert r.status_code in (200, 201), r.text
        data = r.json()
        token = data["access_token"]
        info = requests.get(f"{API}/company/partner", headers={"Authorization": f"Bearer {token}"}, timeout=10).json()
        assert info["partner_type"] == "hotel"
        assert info["partner_discount"] == 0.1
        assert info["tracking_base"] and info["tracking_base"].endswith("/track")

    def test_register_regular_company_no_discount(self, s):
        email = f"comp.test.{TS}@test.com"
        r = _register(s, email, partner_type="company", company_name="Regular Co")
        assert r.status_code in (200, 201)
        token = r.json()["access_token"]
        info = requests.get(f"{API}/company/partner", headers={"Authorization": f"Bearer {token}"}, timeout=10).json()
        assert info["partner_type"] == "company"
        assert info["partner_discount"] == 0


# ---------- Partner bookings ----------
@pytest.fixture(scope="module")
def hotel_token(s):
    r = _login(s, "hotel.ritz@test.com")
    if r.status_code != 200:
        pytest.skip(f"hotel.ritz login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def driver_token(s):
    r = _login(s, "chauffeur@test.com")
    if r.status_code != 200:
        pytest.skip(f"chauffeur login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def passenger_token(s):
    r = _login(s, "passager@test.com")
    if r.status_code != 200:
        pytest.skip(f"passenger login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


def _headers(t):
    return {"Authorization": f"Bearer {t}"}


BOOKING_BODY = {
    "pickup": {"lat": 48.8681, "lng": 2.3292, "address": "Hôtel Ritz Paris"},
    "dropoff": {"lat": 49.0097, "lng": 2.5479, "address": "Aéroport CDG T2"},
    "vehicle_type": "premium",
    "service_type": "airport",
    "passengers": 2,
    "luggage": 3,
    "guest_name": "Mr Smith",
    "guest_phone": "06 11 22 33 44",
    "room": "412",
    "flight_number": "BA309",
}


class TestPartnerBooking:
    booking_id = None

    def test_create_partner_booking(self, hotel_token):
        r = requests.post(f"{API}/company/bookings", json=BOOKING_BODY, headers=_headers(hotel_token), timeout=20)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["price"] == 85.5, f"expected 85.5, got {data['price']}"
        assert data["partner_discount_amount"] == 9.5, data
        assert data["partner_booking"] is True
        assert data["passenger_label"] == "Mr Smith · ch. 412"
        assert data["payment_status"] == "invoiced"
        assert data["booking_ref"]
        assert data["share_token"]
        TestPartnerBooking.booking_id = data["id"]

    def test_invalid_phone_422(self, hotel_token):
        body = {**BOOKING_BODY, "guest_phone": "12"}
        r = requests.post(f"{API}/company/bookings", json=body, headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 422, r.text

    def test_missing_guest_name_422(self, hotel_token):
        body = {k: v for k, v in BOOKING_BODY.items() if k != "guest_name"}
        r = requests.post(f"{API}/company/bookings", json=body, headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 422, r.text

    def test_passenger_role_forbidden(self, passenger_token):
        r = requests.post(f"{API}/company/bookings", json=BOOKING_BODY, headers=_headers(passenger_token), timeout=15)
        assert r.status_code == 403, r.text


class TestListingsAndDriverFlow:
    def test_bookings_active(self, hotel_token):
        r = requests.get(f"{API}/company/bookings?status=active", headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200
        bookings = r.json()
        assert any(b["id"] == TestPartnerBooking.booking_id for b in bookings), "created booking not in active list"

    def test_overview_active_rides(self, hotel_token):
        r = requests.get(f"{API}/company/overview", headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["active_rides"] >= 1

    def test_rides_lists_partner_booking(self, hotel_token):
        r = requests.get(f"{API}/company/rides", headers=_headers(hotel_token), timeout=15)
        assert r.status_code == 200
        rides = r.json()
        assert any(rd["id"] == TestPartnerBooking.booking_id for rd in rides)

    def test_driver_can_see_and_accept(self, driver_token):
        # Set online first
        requests.post(f"{API}/driver/status", json={"is_online": True, "lat": 48.8583, "lng": 2.3477},
                      headers=_headers(driver_token), timeout=15)
        r = requests.get(f"{API}/rides/available", headers=_headers(driver_token), timeout=15)
        assert r.status_code == 200, r.text
        rides = r.json()
        target = next((rd for rd in rides if rd["id"] == TestPartnerBooking.booking_id), None)
        assert target is not None, f"partner booking not visible to driver. Available: {[r.get('id') for r in rides]}"
        assert target["passenger_label"] == "Mr Smith · ch. 412"
        # Accept
        acc = requests.post(f"{API}/rides/{TestPartnerBooking.booking_id}/accept",
                            headers=_headers(driver_token), timeout=15)
        assert acc.status_code == 200, acc.text

    def test_cancel_by_hotel(self, hotel_token):
        r = requests.post(f"{API}/rides/{TestPartnerBooking.booking_id}/cancel",
                          headers=_headers(hotel_token), timeout=15)
        assert r.status_code in (200, 201), r.text
