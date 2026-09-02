"""Iteration 6 – Driver documents management, blocking, admin review, selfie, geo route."""
import io
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"


def _png_bytes() -> bytes:
    # 1x1 transparent PNG
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
        b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01"
        b"\x01\x00\x00_\x00\xa4\x94\x92s\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def _register_fresh_driver(suffix: str = "") -> dict:
    ts = int(time.time() * 1000)
    email = f"TEST_drv_{ts}{suffix}@test.com"
    payload = {
        "email": email,
        "password": "password123",
        "full_name": f"TEST Driver {ts}{suffix}",
        "role": "driver",
        "phone": "+33600000000",
        "vehicle_model": "TEST Car",
        "license_plate": f"TE-{ts % 1000:03d}-AA",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return {"token": d.get("token") or d["access_token"], "user": d["user"], "email": email}


def _login(email: str, password: str = "password123") -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return d.get("token") or d["access_token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


# ---------------- doc types ----------------

class TestDocTypes:
    def test_types_returns_eight(self):
        r = requests.get(f"{API}/documents/types", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) == 8
        keys = {d["key"] for d in data}
        assert keys == {"id_card", "driving_license", "vtc_card", "rc_pro", "registration",
                        "vehicle_insurance", "rc_circulation", "technical_inspection"}


# ---------------- Fresh driver blocking ----------------

@pytest.fixture(scope="module")
def fresh_driver():
    return _register_fresh_driver()


class TestFreshDriverBlocked:
    def test_mine_shows_blocked_with_rc_pro(self, fresh_driver):
        r = requests.get(f"{API}/documents/mine", headers=_h(fresh_driver["token"]), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["blocked"] is True
        assert "RC Pro" in " ".join(d["blocking"]) or any("RC Pro" in b for b in d["blocking"])
        # mandatory labels present
        for lbl in ("Pièce d'identité", "Permis de conduire", "Carte grise",
                    "Assurance du véhicule", "RC Circulation"):
            assert lbl in d["blocking"], f"expected '{lbl}' in blocking, got {d['blocking']}"

    def test_status_online_blocked_423(self, fresh_driver):
        r = requests.post(f"{API}/driver/status", json={"is_online": True},
                          headers=_h(fresh_driver["token"]), timeout=20)
        assert r.status_code == 423
        assert "bloqué" in r.text.lower()

    def test_rides_available_blocked_423(self, fresh_driver):
        r = requests.get(f"{API}/rides/available", headers=_h(fresh_driver["token"]), timeout=20)
        assert r.status_code == 423


# ---------------- Upload validations ----------------

class TestUploadValidation:
    def test_upload_driving_license_expiring(self, fresh_driver):
        vu = _iso(datetime.now(timezone.utc) + timedelta(days=20))
        r = requests.post(
            f"{API}/documents/upload",
            headers=_h(fresh_driver["token"]),
            files={"file": ("dl.png", _png_bytes(), "image/png")},
            data={"type": "driving_license", "valid_until": vu},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # find driving_license item
        item = next(i for i in d["items"] if i["key"] == "driving_license")
        assert item["state"] == "expiring", item
        assert len(d["expiring"]) >= 1

    def test_upload_without_valid_until_422(self, fresh_driver):
        r = requests.post(
            f"{API}/documents/upload",
            headers=_h(fresh_driver["token"]),
            files={"file": ("id.png", _png_bytes(), "image/png")},
            data={"type": "id_card"},
            timeout=60,
        )
        assert r.status_code == 422

    def test_upload_wrong_content_type_415(self, fresh_driver):
        r = requests.post(
            f"{API}/documents/upload",
            headers=_h(fresh_driver["token"]),
            files={"file": ("id.txt", b"hello", "text/plain")},
            data={"type": "id_card", "valid_until": _iso(datetime.now(timezone.utc) + timedelta(days=365))},
            timeout=60,
        )
        assert r.status_code == 415

    def test_upload_registration_without_dates_valid(self, fresh_driver):
        r = requests.post(
            f"{API}/documents/upload",
            headers=_h(fresh_driver["token"]),
            files={"file": ("cg.png", _png_bytes(), "image/png")},
            data={"type": "registration"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        item = next(i for i in d["items"] if i["key"] == "registration")
        assert item["state"] == "valid"


# ---------------- Not applicable ----------------

class TestNotApplicable:
    def test_vtc_card_not_applicable_ok(self, fresh_driver):
        r = requests.post(f"{API}/documents/vtc_card/not-applicable",
                          headers=_h(fresh_driver["token"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        item = next(i for i in d["items"] if i["key"] == "vtc_card")
        assert item["state"] == "not_applicable"

    def test_id_card_not_applicable_conflict(self, fresh_driver):
        r = requests.post(f"{API}/documents/id_card/not-applicable",
                          headers=_h(fresh_driver["token"]), timeout=30)
        assert r.status_code == 409


# ---------------- Full compliance flow ----------------

@pytest.fixture(scope="module")
def compliant_driver():
    """Fresh driver made fully compliant by uploading all mandatory docs."""
    drv = _register_fresh_driver("_compl")
    token = drv["token"]
    far = _iso(datetime.now(timezone.utc) + timedelta(days=180))
    uploads = [
        ("id_card", far),
        ("driving_license", far),
        ("rc_pro", far),
        ("registration", None),
        ("vehicle_insurance", far),
        ("rc_circulation", far),
    ]
    for t, vu in uploads:
        data = {"type": t}
        if vu:
            data["valid_until"] = vu
        r = requests.post(
            f"{API}/documents/upload",
            headers=_h(token),
            files={"file": (f"{t}.png", _png_bytes(), "image/png")},
            data=data,
            timeout=60,
        )
        assert r.status_code == 200, f"upload {t}: {r.status_code} {r.text}"
    for t in ("vtc_card", "technical_inspection"):
        r = requests.post(f"{API}/documents/{t}/not-applicable", headers=_h(token), timeout=30)
        assert r.status_code == 200
    return drv


class TestCompliance:
    def test_unblocked_after_all_docs(self, compliant_driver):
        r = requests.get(f"{API}/documents/mine", headers=_h(compliant_driver["token"]), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["blocked"] is False, f"still blocking: {d.get('blocking')}"

    def test_status_online_200(self, compliant_driver):
        r = requests.post(f"{API}/driver/status", json={"is_online": True},
                          headers=_h(compliant_driver["token"]), timeout=20)
        assert r.status_code == 200


# ---------------- Admin review ----------------

class TestAdmin:
    def test_admin_drivers_list(self, compliant_driver):
        admin_tok = _login("chauffeur@test.com")
        r = requests.get(f"{API}/admin/drivers", headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200
        drivers = r.json()
        assert any(d["email"].lower() == compliant_driver["email"].lower() for d in drivers)
        assert all("blocked" in d for d in drivers)

    def test_admin_docs_include_file_path(self, compliant_driver):
        admin_tok = _login("chauffeur@test.com")
        did = compliant_driver["user"]["id"]
        r = requests.get(f"{API}/admin/drivers/{did}/documents", headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200
        data = r.json()
        # find at least one doc with file_path
        docs_with_path = [i for i in data["items"] if i.get("doc") and i["doc"].get("file_path")]
        assert len(docs_with_path) >= 1
        # test file access with token query param
        path = docs_with_path[0]["doc"]["file_path"]
        r = requests.get(f"{API}/files/{path}?token={admin_tok}", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("image/png")

    def test_reject_reupload_flow(self, compliant_driver):
        admin_tok = _login("chauffeur@test.com")
        did = compliant_driver["user"]["id"]
        docs = requests.get(f"{API}/admin/drivers/{did}/documents", headers=_h(admin_tok), timeout=30).json()
        dl = next(i for i in docs["items"] if i["key"] == "driving_license")
        doc_id = dl["doc"]["id"]
        r = requests.patch(f"{API}/admin/documents/{doc_id}",
                           json={"status": "rejected", "note": "illisible"},
                           headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["blocked"] is True
        # notification
        notifs = requests.get(f"{API}/notifications", headers=_h(compliant_driver["token"]), timeout=20).json()
        assert any(n["type"] == "document" for n in notifs)
        # re-upload → unblock
        far = _iso(datetime.now(timezone.utc) + timedelta(days=180))
        up = requests.post(
            f"{API}/documents/upload",
            headers=_h(compliant_driver["token"]),
            files={"file": ("dl2.png", _png_bytes(), "image/png")},
            data={"type": "driving_license", "valid_until": far},
            timeout=60,
        )
        assert up.status_code == 200
        assert up.json()["blocked"] is False

    def test_non_moderator_patch_403(self, fresh_driver, compliant_driver):
        admin_tok = _login("chauffeur@test.com")
        did = compliant_driver["user"]["id"]
        docs = requests.get(f"{API}/admin/drivers/{did}/documents", headers=_h(admin_tok), timeout=30).json()
        dl = next(i for i in docs["items"] if i["key"] == "driving_license")
        doc_id = dl["doc"]["id"]
        r = requests.patch(f"{API}/admin/documents/{doc_id}",
                           json={"status": "valid"},
                           headers=_h(fresh_driver["token"]), timeout=30)
        assert r.status_code == 403


# ---------------- Selfie flow ----------------

class TestSelfie:
    def test_request_selfie_and_upload(self, compliant_driver):
        admin_tok = _login("chauffeur@test.com")
        did = compliant_driver["user"]["id"]
        r = requests.post(f"{API}/admin/drivers/{did}/request-selfie",
                          headers=_h(admin_tok), timeout=20)
        assert r.status_code == 200
        # driver sees selfie_requested
        mine = requests.get(f"{API}/documents/mine", headers=_h(compliant_driver["token"]), timeout=20).json()
        assert mine["selfie_requested"] is True
        notifs = requests.get(f"{API}/notifications", headers=_h(compliant_driver["token"]), timeout=20).json()
        assert any(n["type"] == "selfie" for n in notifs)
        # upload selfie
        up = requests.post(
            f"{API}/documents/upload",
            headers=_h(compliant_driver["token"]),
            files={"file": ("s.png", _png_bytes(), "image/png")},
            data={"type": "selfie"},
            timeout=60,
        )
        assert up.status_code == 200
        d = up.json()
        assert d["selfie_requested"] is False
        assert d["selfie"] and d["selfie"]["status"] == "pending"
        # admin validates
        docs = requests.get(f"{API}/admin/drivers/{did}/documents", headers=_h(admin_tok), timeout=30).json()
        selfie_id = docs["selfie"]["id"]
        r = requests.patch(f"{API}/admin/documents/{selfie_id}",
                           json={"status": "valid"},
                           headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()["selfie"]["status"] == "valid"


# ---------------- Expired doc ----------------

class TestExpired:
    def test_expired_valid_until_blocks(self):
        drv = _register_fresh_driver("_exp")
        past = _iso(datetime.now(timezone.utc) - timedelta(days=1))
        r = requests.post(
            f"{API}/documents/upload",
            headers=_h(drv["token"]),
            files={"file": ("dl.png", _png_bytes(), "image/png")},
            data={"type": "driving_license", "valid_until": past},
            timeout=60,
        )
        assert r.status_code == 200
        d = r.json()
        item = next(i for i in d["items"] if i["key"] == "driving_license")
        assert item["state"] == "expired"
        assert d["blocked"] is True


# ---------------- Geo route ----------------

class TestGeoRoute:
    def test_geo_route_paris(self):
        r = requests.get(
            f"{API}/geo/route",
            params={"from_lat": 48.8443, "from_lng": 2.3743,
                    "to_lat": 48.8584, "to_lng": 2.2945},
            timeout=20,
        )
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["coords"], list) and len(d["coords"]) > 2
        # not fallback (OSRM should respond)
        if not d.get("fallback"):
            assert d["distance_km"] and d["distance_km"] > 0
            assert d["duration_min"] and d["duration_min"] > 0
