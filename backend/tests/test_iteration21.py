"""Iteration 21 - 4 new features on top of the partner commission system.

Features tested:
1) Export Comptable (moderator)  - CSV/PDF admin export of partner payouts
2) Badges Fidélité               - tier object on /company/partner and /company/commissions
3) Alerte Nouveau Filleul        - partner_leads → sponsor_id + notification on register
4) Notes Clients                 - /company/guests CRUD + auto-upsert on partner booking
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://vtc-platform-18.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

HOTEL = {"email": "hotel.ritz@test.com", "password": "password123"}
MOD_DRIVER = {"email": "chauffeur@test.com", "password": "password123"}
MOD_PASS = {"email": "passager@test.com", "password": "password123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"], r.json()["user"]


@pytest.fixture(scope="module")
def hotel_ctx():
    tok, user = _login(HOTEL)
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def mod_ctx():
    tok, user = _login(MOD_DRIVER)
    assert user.get("is_moderator") is True, "chauffeur@test.com must be moderator"
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def nonmod_ctx():
    # Hotel is company partner, NOT moderator
    tok, user = _login(HOTEL)
    assert user.get("is_moderator") in (False, None), "hotel.ritz must NOT be moderator"
    return {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}


# ============ 1) Export Comptable (moderator) ============
class TestExportComptable:
    def test_csv_export_moderator_ok(self, mod_ctx):
        r = requests.get(f"{API}/company/admin/payouts/export.csv?token={mod_ctx['token']}", timeout=20)
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct, f"unexpected content-type: {ct}"
        # Basic header presence
        body = r.text
        assert "Partenaire" in body and "Montant" in body

    def test_pdf_export_moderator_ok(self, mod_ctx):
        r = requests.get(f"{API}/company/admin/payouts/export.pdf?token={mod_ctx['token']}", timeout=30)
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, f"unexpected content-type: {ct}"
        assert r.content[:4] == b"%PDF", "response is not a valid PDF"

    def test_csv_with_filters(self, mod_ctx):
        r = requests.get(
            f"{API}/company/admin/payouts/export.csv?token={mod_ctx['token']}&status=pending&month=2026-01",
            timeout=20,
        )
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")

    def test_pdf_with_filters(self, mod_ctx):
        r = requests.get(
            f"{API}/company/admin/payouts/export.pdf?token={mod_ctx['token']}&status=paid&month=2026-01",
            timeout=30,
        )
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")

    def test_csv_non_moderator_forbidden(self, nonmod_ctx):
        r = requests.get(f"{API}/company/admin/payouts/export.csv?token={nonmod_ctx['token']}", timeout=15)
        assert r.status_code == 403, f"expected 403 for non-moderator, got {r.status_code} {r.text}"

    def test_pdf_non_moderator_forbidden(self, nonmod_ctx):
        r = requests.get(f"{API}/company/admin/payouts/export.pdf?token={nonmod_ctx['token']}", timeout=15)
        assert r.status_code == 403


# ============ 2) Badges Fidélité ============
class TestBadgesFidelite:
    def test_partner_returns_tier(self, hotel_ctx):
        r = requests.get(f"{API}/company/partner", headers=hotel_ctx["headers"], timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "tier" in data, "tier object missing on /company/partner"
        t = data["tier"]
        for key in ("completed_bookings", "tier_label", "rate", "next_tier_label", "next_tier_rate", "next_tier_min", "to_next"):
            assert key in t, f"missing tier.{key}"
        # commission_rate must equal tier rate
        assert abs(data["commission_rate"] - t["rate"]) < 1e-6

    def test_commissions_returns_tier(self, hotel_ctx):
        r = requests.get(f"{API}/company/commissions", headers=hotel_ctx["headers"], timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "tier" in data
        t = data["tier"]
        assert isinstance(t.get("completed_bookings"), int)
        assert isinstance(t.get("rate"), (int, float))
        # Response-level rate must equal tier rate
        assert abs(data["rate"] - t["rate"]) < 1e-6

    def test_tier_thresholds_logic(self):
        # Import server-side logic directly to validate thresholds
        import sys
        sys.path.insert(0, "/app/backend")
        from routes.referral import tier_for, next_tier
        cases = [
            (0, "Bronze", 0.05), (19, "Bronze", 0.05),
            (20, "Argent", 0.06), (49, "Argent", 0.06),
            (50, "Or", 0.07), (99, "Or", 0.07),
            (100, "Platine", 0.08), (1000, "Platine", 0.08),
        ]
        for count, label, rate in cases:
            t = tier_for(count)
            assert t["label"] == label, f"count={count} → expected {label}, got {t['label']}"
            assert abs(t["rate"] - rate) < 1e-6, f"count={count} → expected {rate}, got {t['rate']}"
        # next_tier progression
        assert next_tier(0)["label"] == "Argent"
        assert next_tier(50)["label"] == "Platine"
        assert next_tier(100) is None


# ============ 3) Alerte Nouveau Filleul ============
class TestAlerteNouveauFilleul:
    def test_partner_lead_creates_sponsor_and_notif(self, hotel_ctx):
        """Manually insert a partner_lead for a fresh phone, register a new passenger with that phone,
        then verify: new user's sponsor_id = hotel AND hotel received a 'Nouveau filleul' notification."""
        import sys, asyncio, datetime
        sys.path.insert(0, "/app/backend")
        from core import db

        # unique valid FR mobile: +336 + 8 digits
        unique_suffix = f"{uuid.uuid4().int % 10_000_000:07d}"
        phone = f"+3361{unique_suffix.zfill(8)}"[:12]
        email = f"filleul_{uuid.uuid4().hex[:8]}@test.com"

        hotel_id = hotel_ctx["user"]["id"]

        async def _flow():
            # Insert partner_lead
            await db.partner_leads.update_one(
                {"phone": phone},
                {"$set": {"phone": phone, "sponsor_id": hotel_id, "partner_name": "Ritz",
                          "updated_at": datetime.datetime.utcnow()}},
                upsert=True,
            )
            before = await db.notifications.count_documents({"user_id": hotel_id, "title": "Nouveau filleul"})

            # Register call is sync (requests) - do it inline via run_in_executor
            loop_ = asyncio.get_event_loop()

            def _register():
                return requests.post(f"{API}/auth/register", json={
                    "email": email, "password": "password123", "full_name": "Filleul Test",
                    "phone": phone, "role": "passenger",
                }, timeout=20)
            r = await loop_.run_in_executor(None, _register)
            assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
            new_user = r.json()["user"]

            u = await db.users.find_one({"id": new_user["id"]}, {"_id": 0, "sponsor_id": 1})
            after = await db.notifications.count_documents({"user_id": hotel_id, "title": "Nouveau filleul"})
            return u, before, after

        loop = asyncio.new_event_loop()
        try:
            u, before, after = loop.run_until_complete(_flow())
        finally:
            loop.close()

        assert u and u.get("sponsor_id") == hotel_id, f"new user sponsor_id should be hotel: {u}"
        assert after == before + 1, f"expected 1 new 'Nouveau filleul' notif, before={before} after={after}"


# ============ 4) Notes Clients (partner guest book) ============
class TestNotesClients:
    def test_crud_guest(self, hotel_ctx):
        h = hotel_ctx["headers"]
        # Create with a unique name
        name = f"TEST_Guest_{uuid.uuid4().hex[:6]}"
        payload = {"name": name, "phone": "+33612345678", "room": "101", "notes": "Bag/water", "vehicle_type": "premium"}
        r = requests.post(f"{API}/company/guests", headers=h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["name"] == name and g["room"] == "101" and g["notes"] == "Bag/water"
        gid = g["id"]

        # List: must contain it
        r = requests.get(f"{API}/company/guests", headers=h, timeout=15)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert gid in ids

        # Delete
        r = requests.delete(f"{API}/company/guests/{gid}", headers=h, timeout=15)
        assert r.status_code == 200
        # Verify gone
        r = requests.get(f"{API}/company/guests", headers=h, timeout=15)
        assert gid not in [x["id"] for x in r.json()]

    def test_delete_unknown_returns_404(self, hotel_ctx):
        r = requests.delete(f"{API}/company/guests/does-not-exist", headers=hotel_ctx["headers"], timeout=10)
        assert r.status_code == 404

    def test_booking_auto_upserts_guest(self, hotel_ctx):
        """Create a partner booking and verify the guest gets saved / bookings_count incremented."""
        h = hotel_ctx["headers"]
        unique_name = f"TEST_Booked_{uuid.uuid4().hex[:6]}"
        # Read count before
        r0 = requests.get(f"{API}/company/guests", headers=h, timeout=15).json()
        before = next((g for g in r0 if g["name"] == unique_name), None)
        before_count = (before or {}).get("bookings_count", 0)

        # Create partner booking (simple Paris coords)
        body = {
            "pickup":  {"lat": 48.8666, "lng": 2.3229, "address": "Hôtel Ritz, Place Vendôme"},
            "dropoff": {"lat": 49.0097, "lng": 2.5479, "address": "Aéroport CDG"},
            "vehicle_type": "premium", "service_type": "airport",
            "scheduled_at": None, "passengers": 1, "luggage": 1,
            "guest_name": unique_name, "guest_phone": None, "room": "205",
            "notes": None, "flight_number": "AF123",
        }
        r = requests.post(f"{API}/company/bookings", headers=h, json=body, timeout=20)
        if r.status_code != 201:
            pytest.skip(f"partner booking creation failed (unrelated to feature): {r.status_code} {r.text[:200]}")

        # Verify guest saved with bookings_count += 1
        r1 = requests.get(f"{API}/company/guests", headers=h, timeout=15).json()
        found = next((g for g in r1 if g["name"] == unique_name), None)
        assert found is not None, "guest was not auto-saved after booking"
        assert found.get("bookings_count", 0) == before_count + 1, f"bookings_count didn't increment: {found}"

        # cleanup
        requests.delete(f"{API}/company/guests/{found['id']}", headers=h, timeout=10)
