"""Iteration 13 - i18n / support/config / vehicle photo moderator / PATCH /auth/me language."""
import io
import os
import time
import struct
import zlib

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MOD_EMAIL = "chauffeur@test.com"
MOD_PW = "password123"


def _tiny_png_bytes() -> bytes:
    # 1x1 transparent PNG
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    raw = b"\x00\x00\x00\x00\x00"
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="session")
def s():
    ses = requests.Session()
    return ses


@pytest.fixture(scope="session")
def moderator_token(s):
    r = s.post(f"{API}/auth/login", json={"email": MOD_EMAIL, "password": MOD_PW})
    if r.status_code == 429:
        pytest.skip(f"Moderator login rate-limited: {r.text}")
    assert r.status_code == 200, f"moderator login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("user", {}).get("is_moderator") is True, f"expected is_moderator=True, got {body.get('user')}"
    return body["access_token"]


@pytest.fixture(scope="session")
def fresh_passenger(s):
    email = f"pass_i13_{int(time.time())}@test.com"
    r = s.post(f"{API}/auth/register", json={
        "email": email, "password": "password123", "full_name": "I13 Pax", "role": "passenger",
    })
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    body = r.json()
    return {"email": email, "token": body["access_token"], "user": body["user"]}


# ---------------- Catalog i18n ----------------
class TestCatalogI18n:
    def test_default_fr(self, s):
        r = s.get(f"{API}/catalog")
        assert r.status_code == 200
        data = r.json()
        svc = {x["key"]: x for x in data["services"]}
        assert svc["airport"]["label"] == "Transfert aéroport"
        assert set(svc["airport"]["labels"].keys()) >= {"fr", "en", "es", "ar", "zh", "pt"}
        assert svc["airport"]["labels"]["en"] == "Airport Transfer"

    def test_lang_en(self, s):
        r = s.get(f"{API}/catalog", params={"lang": "en"})
        assert r.status_code == 200
        svc = {x["key"]: x for x in r.json()["services"]}
        assert svc["airport"]["label"] == "Airport Transfer"
        assert svc["private"]["label"] == "Private Driver"

    def test_lang_zh(self, s):
        r = s.get(f"{API}/catalog", params={"lang": "zh"})
        assert r.status_code == 200
        svc = {x["key"]: x for x in r.json()["services"]}
        assert svc["airport"]["label"] == "机场接送"

    def test_vehicles_have_custom_photo_bool(self, s):
        r = s.get(f"{API}/catalog")
        assert r.status_code == 200
        vehicles = r.json()["vehicles"]
        assert len(vehicles) >= 5
        for v in vehicles:
            assert "custom_photo" in v and isinstance(v["custom_photo"], bool)


# ---------------- Support config ----------------
class TestSupportConfig:
    def test_fr(self, s):
        r = s.get(f"{API}/support/config", params={"lang": "fr"})
        assert r.status_code == 200
        d = r.json()
        assert d["company_name"] == "RideGo"
        assert d["whatsapp"] == ""
        assert d["email"] == ""
        assert d["phone"] == ""
        assert len(d["faq"]) == 6
        # French heuristic
        assert any("chauffeur" in item["a"].lower() or "annul" in item["a"].lower() for item in d["faq"])

    def test_es_falls_back_to_en(self, s):
        r = s.get(f"{API}/support/config", params={"lang": "es"})
        assert r.status_code == 200
        d = r.json()
        assert len(d["faq"]) == 6
        # English fallback heuristic
        assert any("driver" in item["a"].lower() or "cancel" in item["a"].lower() for item in d["faq"])


# ---------------- PATCH /auth/me language ----------------
class TestPatchLanguage:
    def test_patch_language_es(self, s, fresh_passenger):
        h = {"Authorization": f"Bearer {fresh_passenger['token']}"}
        r = s.patch(f"{API}/auth/me", json={"language": "es"}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["language"] == "es"
        # confirm via GET
        r2 = s.get(f"{API}/auth/me", headers=h)
        assert r2.status_code == 200 and r2.json()["language"] == "es"

    def test_patch_language_invalid_422(self, s, fresh_passenger):
        h = {"Authorization": f"Bearer {fresh_passenger['token']}"}
        r = s.patch(f"{API}/auth/me", json={"language": "xx"}, headers=h)
        assert r.status_code == 422, r.text

    def test_login_response_contains_language(self, s, fresh_passenger):
        r = s.post(f"{API}/auth/login", json={"email": fresh_passenger["email"], "password": "password123"})
        # Might be rate-limited if re-run; skip if so
        if r.status_code == 429:
            pytest.skip("rate limited")
        assert r.status_code == 200
        assert "language" in r.json()["user"]


# ---------------- Vehicle photos (moderator) ----------------
class TestVehiclePhotos:
    def test_full_flow_van(self, s, moderator_token):
        h = {"Authorization": f"Bearer {moderator_token}"}
        png = _tiny_png_bytes()
        # 1) upload OK
        r = s.post(
            f"{API}/admin/vehicles/van/photo",
            files={"file": ("van.png", png, "image/png")},
            headers=h,
        )
        assert r.status_code == 200, r.text
        image_url = r.json()["image_url"]
        assert "/api/vehicle-photos/" in image_url

        # 2) catalog reflects override
        cat = s.get(f"{API}/catalog").json()
        van = next(v for v in cat["vehicles"] if v["key"] == "van")
        assert van["custom_photo"] is True
        assert "/api/vehicle-photos/" in van["image_url"]

        # 3) public GET image (no auth) returns image/png
        r2 = requests.get(image_url)
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/png")

        # 4) unknown vehicle_type -> 404
        r404 = s.post(
            f"{API}/admin/vehicles/truck/photo",
            files={"file": ("t.png", png, "image/png")},
            headers=h,
        )
        assert r404.status_code == 404, r404.text

        # 5) wrong content-type -> 415
        r415 = s.post(
            f"{API}/admin/vehicles/van/photo",
            files={"file": ("foo.txt", b"hello", "text/plain")},
            headers=h,
        )
        assert r415.status_code == 415, r415.text

        # 6) DELETE -> ok, custom_photo back to false
        rd = s.delete(f"{API}/admin/vehicles/van/photo", headers=h)
        assert rd.status_code == 200
        cat2 = s.get(f"{API}/catalog").json()
        van2 = next(v for v in cat2["vehicles"] if v["key"] == "van")
        assert van2["custom_photo"] is False

    def test_non_moderator_forbidden(self, s, fresh_passenger):
        h = {"Authorization": f"Bearer {fresh_passenger['token']}"}
        r = s.post(
            f"{API}/admin/vehicles/van/photo",
            files={"file": ("x.png", _tiny_png_bytes(), "image/png")},
            headers=h,
        )
        assert r.status_code == 403, r.text
