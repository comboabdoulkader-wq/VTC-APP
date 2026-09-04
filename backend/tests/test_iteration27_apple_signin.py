"""Iteration 27: Sign in with Apple (/api/auth/apple).

The full native button flow needs a real Apple ID on an iOS device, so here we
verify the backend contract in-process by monkeypatching Apple's JWKS/token
verification and asserting create / re-login / link-by-email + JWT issuance.
"""
import asyncio
import secrets

import httpx
import pytest


class _FakeSigningKey:
    key = "fake"


class _FakeJwksClient:
    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey()


@pytest.fixture()
def app_client(monkeypatch):
    import server
    from routes import auth as auth_mod

    monkeypatch.setattr(auth_mod, "_get_apple_jwks_client", lambda: _FakeJwksClient())
    if not auth_mod.APPLE_AUDIENCES:
        auth_mod.APPLE_AUDIENCES = ["com.emergent.vtcplatform.q33vdy"]

    transport = httpx.ASGITransport(app=server.app)
    return httpx.AsyncClient(transport=transport, base_url="http://test"), auth_mod


def _patch_claims(monkeypatch, auth_mod, sub, email=None):
    import jwt as pyjwt
    real_decode = pyjwt.decode
    fake_token = "x" * 40
    apple_claims = {"sub": sub, **({"email": email} if email else {})}

    def dispatch(token, *a, **k):
        if token == fake_token:
            return apple_claims
        return real_decode(token, *a, **k)

    monkeypatch.setattr(pyjwt, "decode", dispatch)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_apple_creates_and_relogins(app_client, monkeypatch):
    client, auth_mod = app_client
    sub = "apple_" + secrets.token_hex(6)
    email = f"{secrets.token_hex(5)}@privaterelay.appleid.com"
    _patch_claims(monkeypatch, auth_mod, sub, email)

    async def flow():
        # First sign-in creates the account and returns our JWT.
        r1 = await client.post("/api/auth/apple", json={"identity_token": "x" * 40, "role": "passenger", "full_name": "Jean Test", "email": email})
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["access_token"] and d1["user"]["email"] == email
        assert d1["user"]["full_name"] == "Jean Test"
        uid = d1["user"]["id"]

        # The issued JWT authenticates against /auth/me.
        me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {d1['access_token']}"})
        assert me.status_code == 200 and me.json()["id"] == uid

        # Second sign-in (same apple_sub, no name/email echoed) returns the SAME user.
        r2 = await client.post("/api/auth/apple", json={"identity_token": "x" * 40, "role": "passenger"})
        assert r2.status_code == 200
        assert r2.json()["user"]["id"] == uid
        return uid

    uid = _run(flow())
    _run(client.aclose())
    # cleanup
    import server
    server_db = server  # noqa
    from pymongo import MongoClient
    import os
    mongo = os.environ["MONGO_URL"]; dbn = os.environ["DB_NAME"]
    MongoClient(mongo)[dbn].users.delete_one({"id": uid})


def test_apple_links_existing_email(app_client, monkeypatch):
    client, auth_mod = app_client
    import os
    from pymongo import MongoClient
    mongo = os.environ["MONGO_URL"]; dbn = os.environ["DB_NAME"]
    users = MongoClient(mongo)[dbn].users

    email = f"{secrets.token_hex(5)}@example.com"
    # Seed a plain custom-auth account with this email.
    users.insert_one({
        "id": "seed_" + secrets.token_hex(6), "email": email, "password_hash": "x", "full_name": "Existing",
        "role": "passenger", "is_active": True, "rating": 5.0, "total_rides": 0, "wallet_balance": 0.0,
    })
    sub = "apple_" + secrets.token_hex(6)
    _patch_claims(monkeypatch, auth_mod, sub, email)

    async def flow():
        r = await client.post("/api/auth/apple", json={"identity_token": "x" * 40, "role": "passenger"})
        assert r.status_code == 200, r.text
        return r.json()["user"]["id"]

    uid = _run(flow())
    _run(client.aclose())
    linked = users.find_one({"email": email})
    assert linked and linked.get("apple_sub") == sub and linked.get("apple_linked") is True
    users.delete_one({"email": email})
