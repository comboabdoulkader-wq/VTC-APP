"""
Iteration 23 - Verify SUPPORT_HOURS env quoting fix + regression smoke.

Scope (backend only):
- Backend boots and GET /api/ returns 200
- GET /api/support/config returns hours == "7j/7 · 6h–23h" (accented chars intact)
- Regression: login (passager@test.com), /api/rides/estimate,
  and admin endpoints for moderator (chauffeur@test.com):
  /api/admin/integrations, /api/admin/dashboard
"""
import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://vtc-platform-18.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

EXPECTED_HOURS = "7j/7 · 6h–23h"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(client, email, password):
    r = client.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"no token in login response: {body}"
    return token


# ---------- Boot / basic reachability ----------
def test_root_api_ok(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200, f"root /api/ not 200: {r.status_code} {r.text[:300]}"


# ---------- SUPPORT_HOURS env fix ----------
def test_support_config_hours_intact(client):
    r = client.get(f"{API}/support/config")
    assert r.status_code == 200, f"/api/support/config: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "hours" in data, f"'hours' field missing: {data}"
    hours = data["hours"]
    assert hours == EXPECTED_HOURS, (
        f"hours mismatch. Got repr={hours!r}, expected repr={EXPECTED_HOURS!r}"
    )
    # Explicit char-level checks so truncation / stripped special chars are caught
    assert "·" in hours, "middle dot (U+00B7) missing from hours"
    assert "–" in hours, "en-dash (U+2013) missing from hours"


# ---------- Regression smoke ----------
def test_passenger_login_ok(client):
    token = _login(client, "passager@test.com", "password123")
    assert isinstance(token, str) and len(token) > 10


def test_rides_estimate(client):
    token = _login(client, "passager@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "pickup": {"lat": 48.8566, "lng": 2.3522, "address": "Paris"},
        "dropoff": {"lat": 48.8738, "lng": 2.2950, "address": "Arc de Triomphe"},
    }
    r = client.post(f"{API}/rides/estimate", json=payload, headers=headers)
    if r.status_code == 405 or r.status_code == 404:
        # Try GET variant with query params if POST not accepted
        r = client.get(f"{API}/rides/estimate", params={
            "pickup_lat": 48.8566, "pickup_lng": 2.3522,
            "dropoff_lat": 48.8738, "dropoff_lng": 2.2950,
        }, headers=headers)
    assert r.status_code == 200, f"/api/rides/estimate: {r.status_code} {r.text[:400]}"
    body = r.json()
    # Should contain options / list of ride tiers
    assert isinstance(body, (list, dict)), f"unexpected estimate body: {body}"
    if isinstance(body, dict):
        # look for a common key
        keys = list(body.keys())
        assert any(k in keys for k in ("options", "estimates", "tiers", "rides")), (
            f"no options-like key in response: {keys}"
        )


def test_admin_integrations_moderator(client):
    token = _login(client, "chauffeur@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get(f"{API}/admin/integrations", headers=headers)
    assert r.status_code == 200, f"/api/admin/integrations: {r.status_code} {r.text[:400]}"


def test_admin_dashboard_moderator(client):
    token = _login(client, "chauffeur@test.com", "password123")
    headers = {"Authorization": f"Bearer {token}"}
    r = client.get(f"{API}/admin/dashboard", headers=headers)
    assert r.status_code == 200, f"/api/admin/dashboard: {r.status_code} {r.text[:400]}"
