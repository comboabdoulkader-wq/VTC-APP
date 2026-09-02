"""Iteration 4 backend tests: geo/autocomplete, worldwide city surcharge + moderation,
scheduled ride reminder (45 min), accounting exports (?token=), business/company accounts."""
import datetime
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PASSENGER = {"email": "passager@test.com", "password": "password123"}
DRIVER = {"email": "chauffeur@test.com", "password": "password123"}
COMPANY = {"email": "entreprise@test.com", "password": "password123"}


# --------------- helpers ---------------
def login(email, password, role=None, extra=None):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    if r.status_code != 200:
        payload = {"email": email, "password": password, "full_name": email.split("@")[0].title(), "role": role}
        if extra:
            payload.update(extra)
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
    assert r.status_code == 200, f"login/register failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def passenger():
    return login(PASSENGER["email"], PASSENGER["password"], "passenger")


@pytest.fixture(scope="session")
def driver():
    return login(DRIVER["email"], DRIVER["password"], "driver")


@pytest.fixture(scope="session")
def company():
    return login(COMPANY["email"], COMPANY["password"], "company", {"company_name": "Acme Conseil"})


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# --------------- geo/autocomplete ---------------
class TestGeo:
    def test_geo_search_returns_results(self):
        r = requests.get(f"{API}/geo/search", params={"q": "gare de lyon", "lat": 48.85, "lng": 2.35}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Photon is external, we can be lenient (may occasionally return few results)
        if not data:
            pytest.skip("Photon returned no results (external service slowness)")
        first = data[0]
        assert set(["name", "address", "lat", "lng"]).issubset(first.keys())
        assert isinstance(first["lat"], (int, float))

    def test_geo_reverse_lyon(self):
        r = requests.get(f"{API}/geo/reverse", params={"lat": 45.764, "lng": 4.8357}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "address" in data and "lat" in data
        addr = (data.get("address") or "").lower()
        if "lyon" not in addr and "lyon" not in (data.get("name") or "").lower():
            pytest.skip(f"Photon reverse did not include Lyon (got {addr!r})")


# --------------- surcharge city selection ---------------
class TestSurchargeCities:
    def test_estimate_surcharge_lyon(self):
        r = requests.post(f"{API}/rides/estimate", json={
            "pickup": {"lat": 45.78, "lng": 4.80, "address": "Lyon Nord"},
            "dropoff": {"lat": 45.764, "lng": 4.8357, "address": "Lyon centre"},
        }, timeout=15)
        assert r.status_code == 200, r.text
        s = r.json()["surcharge"]
        assert "Lyon" in s["center_name"], f"expected Lyon in center_name, got {s['center_name']}"

    def test_estimate_surcharge_paris(self):
        r = requests.post(f"{API}/rides/estimate", json={
            "pickup": {"lat": 48.8583, "lng": 2.3477, "address": "Paris"},
            "dropoff": {"lat": 48.86, "lng": 2.35, "address": "Paris Nord"},
        }, timeout=15)
        assert r.status_code == 200
        s = r.json()["surcharge"]
        assert "Paris" in s["center_name"]


# --------------- admin cities ---------------
class TestAdminCities:
    def test_list_cities_seeded(self, passenger):
        r = requests.get(f"{API}/admin/cities", headers=auth(passenger["access_token"]), timeout=15)
        assert r.status_code == 200
        cities = r.json()
        assert len(cities) >= 30, f"expected >=30 cities, got {len(cities)}"

    def test_patch_city_as_moderator(self, passenger):
        r = requests.get(f"{API}/admin/cities", headers=auth(passenger["access_token"]), timeout=15)
        paris = next(c for c in r.json() if c["name"] == "Paris")
        r2 = requests.patch(
            f"{API}/admin/cities/{paris['id']}",
            headers=auth(passenger["access_token"]),
            json={"lat": 48.8583, "lng": 2.3477},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["source"] == "moderator"

    def test_patch_city_forbidden_for_non_moderator(self, passenger):
        # register a fresh, non-moderator passenger
        email = f"nonmod_{int(time.time()*1000)}@test.com"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "password123", "full_name": "Non Mod", "role": "passenger",
        }, timeout=15)
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]

        cities = requests.get(f"{API}/admin/cities", headers=auth(token), timeout=15).json()
        paris = next(c for c in cities if c["name"] == "Paris")
        r2 = requests.patch(f"{API}/admin/cities/{paris['id']}", headers=auth(token), json={"lat": 48.86}, timeout=15)
        assert r2.status_code == 403, f"expected 403, got {r2.status_code}: {r2.text}"

    def test_create_and_delete_city_as_moderator(self, passenger):
        payload = {"name": f"TESTVILLE_{int(time.time())}", "country": "France", "lat": 44.0, "lng": 2.0}
        r = requests.post(f"{API}/admin/cities", headers=auth(passenger["access_token"]), json=payload, timeout=15)
        assert r.status_code == 200, r.text
        city_id = r.json()["id"]
        assert r.json()["source"] == "moderator"
        r_del = requests.delete(f"{API}/admin/cities/{city_id}", headers=auth(passenger["access_token"]), timeout=15)
        assert r_del.status_code == 200


# --------------- Company / business ---------------
class TestCompanyFlow:
    def test_company_and_join_and_budget_and_exceed(self, passenger, driver, company):
        # ensure passenger is joined at end (test_credentials note); use fresh passenger for isolation
        email = f"emp_{int(time.time()*1000)}@test.com"
        reg = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "password123", "full_name": "Emp Test", "role": "passenger",
        }, timeout=15).json()
        emp_token = reg["access_token"]
        emp_id = reg["user"]["id"]

        # Wrong code → 404
        r = requests.post(f"{API}/company/join", headers=auth(emp_token), json={"code": "WRONGCODE"}, timeout=15)
        assert r.status_code == 404

        # Get company invite code
        code = company["user"]["invite_code"]
        assert code
        r = requests.post(f"{API}/company/join", headers=auth(emp_token), json={"code": code}, timeout=15)
        assert r.status_code == 200

        # my-budget
        r = requests.get(f"{API}/company/my-budget", headers=auth(emp_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["company"] == "Acme Conseil"

        # company sets budget 20 month
        r = requests.patch(
            f"{API}/company/employees/{emp_id}",
            headers=auth(company["access_token"]),
            json={"budget_amount": 20, "budget_period": "month"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["budget_amount"] == 20

        # cheap business ride (short trip)
        pickup = {"lat": 48.8566, "lng": 2.3522, "address": "Paris center"}
        dropoff = {"lat": 48.8575, "lng": 2.3530, "address": "Paris nearby"}
        r = requests.post(f"{API}/rides", headers=auth(emp_token),
                          json={"pickup": pickup, "dropoff": dropoff, "vehicle_type": "standard", "business": True}, timeout=15)
        assert r.status_code == 200, f"expected 200 cheap business ride, got {r.status_code} {r.text}"
        assert r.json()["business"] is True
        first_ride_id = r.json()["id"]

        # expensive business ride → 402
        pickup2 = {"lat": 48.85, "lng": 2.35, "address": "Paris"}
        dropoff2 = {"lat": 49.0097, "lng": 2.5479, "address": "CDG"}
        r = requests.post(f"{API}/rides", headers=auth(emp_token),
                          json={"pickup": pickup2, "dropoff": dropoff2, "vehicle_type": "premium", "business": True}, timeout=15)
        assert r.status_code == 402, f"expected 402, got {r.status_code} {r.text}"

        # company_active false → business ride 409 (company_id is stripped by current_user when inactive)
        r = requests.patch(f"{API}/company/employees/{emp_id}", headers=auth(company["access_token"]),
                           json={"company_active": False}, timeout=15)
        assert r.status_code == 200
        r = requests.post(f"{API}/rides", headers=auth(emp_token),
                          json={"pickup": pickup, "dropoff": dropoff, "vehicle_type": "standard", "business": True}, timeout=15)
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"

        # company overview / rides / employees
        r = requests.get(f"{API}/company/overview", headers=auth(company["access_token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["employees_count"] >= 1
        assert r.json()["invite_code"] == code

        r = requests.get(f"{API}/company/rides", headers=auth(company["access_token"]), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

        r = requests.get(f"{API}/company/employees", headers=auth(company["access_token"]), timeout=15)
        assert r.status_code == 200
        me = next(e for e in r.json() if e["id"] == emp_id)
        assert me["spent"] >= 0

        # cleanup: cancel first ride + delete employee
        requests.post(f"{API}/rides/{first_ride_id}/cancel", headers=auth(emp_token), timeout=15)
        r = requests.delete(f"{API}/company/employees/{emp_id}", headers=auth(company["access_token"]), timeout=15)
        assert r.status_code == 200


# --------------- Exports (with ?token= query) ---------------
class TestExports:
    @property
    def month(self):
        return datetime.datetime.now().strftime("%Y-%m")

    def test_team_invoices(self, driver):
        r = requests.get(f"{API}/team/invoices", params={"month": self.month}, headers=auth(driver["access_token"]), timeout=15)
        assert r.status_code == 200, r.text
        for k in ["groups", "gross", "commission", "net", "count"]:
            assert k in r.json()

    def test_team_export_csv_token_query(self, driver):
        r = requests.get(f"{API}/team/export.csv", params={"month": self.month, "token": driver["access_token"]}, timeout=15)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        first_line = r.text.split("\n")[0]
        assert "Date" in first_line and "course" in first_line.lower(), f"unexpected header: {first_line}"

    def test_team_export_pdf_token_query(self, driver):
        r = requests.get(f"{API}/team/export.pdf", params={"month": self.month, "token": driver["access_token"]}, timeout=15)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF"), f"expected PDF, got {r.content[:20]!r}"

    def test_company_report_and_exports(self, company):
        m = self.month
        r = requests.get(f"{API}/company/report", params={"month": m}, headers=auth(company["access_token"]), timeout=15)
        assert r.status_code == 200
        r = requests.get(f"{API}/company/export.csv", params={"month": m, "token": company["access_token"]}, timeout=15)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        r = requests.get(f"{API}/company/export.pdf", params={"month": m, "token": company["access_token"]}, timeout=15)
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")


# --------------- Scheduled ride reminder (45 min) ---------------
class TestScheduledReminder:
    def test_reminder_notification(self, passenger):
        sched = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)).isoformat()
        pickup = {"lat": 48.8443, "lng": 2.3743, "address": "Gare de Lyon"}
        dropoff = {"lat": 48.8584, "lng": 2.2945, "address": "Tour Eiffel"}
        r = requests.post(f"{API}/rides", headers=auth(passenger["access_token"]),
                          json={"pickup": pickup, "dropoff": dropoff, "vehicle_type": "standard", "scheduled_at": sched},
                          timeout=15)
        assert r.status_code == 200, r.text
        ride_id = r.json()["id"]

        # baseline notification count
        # loop runs every 60 s → wait up to ~80 s
        found = False
        deadline = time.time() + 80
        while time.time() < deadline:
            time.sleep(10)
            resp = requests.get(f"{API}/notifications", headers=auth(passenger["access_token"]), timeout=15)
            if resp.status_code != 200:
                continue
            for n in resp.json():
                if n.get("type") == "reminder" and n.get("ride_id") == ride_id:
                    found = True
                    break
            if found:
                break

        # cleanup: cancel ride
        requests.post(f"{API}/rides/{ride_id}/cancel", headers=auth(passenger["access_token"]), timeout=15)
        assert found, "Expected reminder notification within ~80 s of scheduling"
