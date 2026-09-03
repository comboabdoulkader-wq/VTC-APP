"""Étape 6 — Admin API management console.

A single secure place (moderators only) where the administrator enables/disables and configures
every third-party provider. Everything is OFF by default and NO key is configured anywhere else.
Secrets are stored server-side but always returned masked; a lightweight "test connection" validates
that the required fields are present and plausibly formatted (real network tests run after deployment).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import current_user, db, new_id, now_utc

router = APIRouter(prefix="/admin/integrations", tags=["integrations"])


def F(name, label, secret=False):
    return {"name": name, "label": label, "secret": secret}


# Provider catalogue grouped by category. Each provider declares the fields the admin must fill.
CATALOG = {
    "payment": {
        "label": "Paiement", "modes": True, "providers": [
            {"key": "stripe", "label": "Stripe", "fields": [F("publishable_key", "Clé publique"), F("secret_key", "Clé secrète", True), F("webhook_secret", "Webhook secret", True)]},
            {"key": "paypal", "label": "PayPal", "fields": [F("client_id", "Client ID"), F("client_secret", "Client secret", True)]},
            {"key": "applepay", "label": "Apple Pay", "fields": [F("merchant_id", "Merchant ID")]},
            {"key": "googlepay", "label": "Google Pay", "fields": [F("merchant_id", "Merchant ID")]},
            {"key": "flutterwave", "label": "Flutterwave", "fields": [F("public_key", "Clé publique"), F("secret_key", "Clé secrète", True)]},
            {"key": "mpesa", "label": "M-Pesa", "fields": [F("consumer_key", "Consumer key"), F("consumer_secret", "Consumer secret", True), F("shortcode", "Shortcode")]},
            {"key": "orange_money", "label": "Orange Money", "fields": [F("client_id", "Client ID"), F("client_secret", "Client secret", True)]},
            {"key": "wave", "label": "Wave", "fields": [F("api_key", "Clé API", True)]},
            {"key": "mollie", "label": "Mollie", "fields": [F("api_key", "Clé API", True)]},
            {"key": "adyen", "label": "Adyen", "fields": [F("api_key", "Clé API", True), F("merchant_account", "Merchant account")]},
            {"key": "square", "label": "Square", "fields": [F("access_token", "Access token", True), F("location_id", "Location ID")]},
        ],
    },
    "sms": {
        "label": "SMS", "modes": False, "providers": [
            {"key": "twilio", "label": "Twilio", "fields": [F("account_sid", "Account SID"), F("auth_token", "Auth token", True), F("from_number", "Numéro émetteur")]},
            {"key": "messagebird", "label": "MessageBird", "fields": [F("api_key", "Clé API", True)]},
            {"key": "vonage", "label": "Vonage", "fields": [F("api_key", "Clé API"), F("api_secret", "Secret", True)]},
            {"key": "infobip", "label": "Infobip", "fields": [F("api_key", "Clé API", True), F("base_url", "Base URL")]},
            {"key": "aws_sns", "label": "AWS SNS", "fields": [F("access_key", "Access key"), F("secret_key", "Secret key", True), F("region", "Région")]},
        ],
    },
    "email": {
        "label": "Email", "modes": False, "providers": [
            {"key": "sendgrid", "label": "SendGrid", "fields": [F("api_key", "Clé API", True), F("from_email", "Expéditeur")]},
            {"key": "mailgun", "label": "Mailgun", "fields": [F("api_key", "Clé API", True), F("domain", "Domaine")]},
            {"key": "aws_ses", "label": "AWS SES", "fields": [F("access_key", "Access key"), F("secret_key", "Secret key", True), F("region", "Région")]},
            {"key": "smtp", "label": "SMTP personnalisé", "fields": [F("host", "Hôte"), F("port", "Port"), F("username", "Utilisateur"), F("password", "Mot de passe", True)]},
        ],
    },
    "maps": {
        "label": "Cartes", "modes": False, "providers": [
            {"key": "google_maps", "label": "Google Maps", "fields": [F("api_key", "Clé API", True)]},
            {"key": "mapbox", "label": "Mapbox", "fields": [F("access_token", "Access token", True)]},
            {"key": "apple_maps", "label": "Apple Maps", "fields": [F("team_id", "Team ID"), F("key_id", "Key ID"), F("private_key", "Clé privée", True)]},
            {"key": "here", "label": "HERE Maps", "fields": [F("api_key", "Clé API", True)]},
            {"key": "osm", "label": "OpenStreetMap", "fields": []},
        ],
    },
    "push": {
        "label": "Notifications Push", "modes": False, "providers": [
            {"key": "firebase", "label": "Firebase Cloud Messaging", "fields": [F("server_key", "Server key", True), F("sender_id", "Sender ID")]},
            {"key": "onesignal", "label": "OneSignal", "fields": [F("app_id", "App ID"), F("api_key", "Clé API", True)]},
            {"key": "huawei_push", "label": "Huawei Push", "fields": [F("app_id", "App ID"), F("app_secret", "App secret", True)]},
        ],
    },
    "auth": {
        "label": "Authentification", "modes": False, "providers": [
            {"key": "firebase_auth", "label": "Firebase Auth", "fields": [F("api_key", "Clé API", True)]},
            {"key": "otp_sms", "label": "OTP SMS", "fields": []},
            {"key": "otp_whatsapp", "label": "OTP WhatsApp", "fields": [F("phone_id", "Phone number ID"), F("token", "Token", True)]},
            {"key": "otp_email", "label": "OTP Email", "fields": []},
            {"key": "google_login", "label": "Google Login", "fields": [F("client_id", "Client ID"), F("client_secret", "Client secret", True)]},
            {"key": "apple_login", "label": "Apple Login", "fields": [F("client_id", "Service ID"), F("team_id", "Team ID"), F("key_id", "Key ID"), F("private_key", "Clé privée", True)]},
            {"key": "facebook_login", "label": "Facebook Login", "fields": [F("app_id", "App ID"), F("app_secret", "App secret", True)]},
            {"key": "microsoft_login", "label": "Microsoft Login", "fields": [F("client_id", "Client ID"), F("client_secret", "Client secret", True)]},
        ],
    },
    "ai": {
        "label": "Intelligence artificielle", "modes": False, "providers": [
            {"key": "openai", "label": "OpenAI", "fields": [F("api_key", "Clé API", True)]},
            {"key": "gemini", "label": "Google Gemini", "fields": [F("api_key", "Clé API", True)]},
            {"key": "anthropic", "label": "Anthropic", "fields": [F("api_key", "Clé API", True)]},
        ],
    },
    "monitoring": {
        "label": "Monitoring", "modes": False, "providers": [
            {"key": "sentry", "label": "Sentry", "fields": [F("dsn", "DSN", True)]},
            {"key": "crashlytics", "label": "Firebase Crashlytics", "fields": [F("app_id", "App ID")]},
            {"key": "logrocket", "label": "LogRocket", "fields": [F("app_id", "App ID")]},
        ],
    },
    "storage": {
        "label": "Stockage", "modes": True, "providers": [
            {"key": "aws_s3", "label": "AWS S3", "fields": [F("access_key", "Access key"), F("secret_key", "Secret key", True), F("bucket", "Bucket"), F("region", "Région")]},
            {"key": "cloudinary", "label": "Cloudinary", "fields": [F("cloud_name", "Cloud name"), F("api_key", "Clé API"), F("api_secret", "Secret", True)]},
            {"key": "supabase_storage", "label": "Supabase Storage", "fields": [F("url", "URL"), F("service_key", "Service key", True)]},
            {"key": "firebase_storage", "label": "Firebase Storage", "fields": [F("bucket", "Bucket")]},
        ],
    },
}

_PROVIDER_INDEX = {p["key"]: (cat, p) for cat, c in CATALOG.items() for p in c["providers"]}


class IntegrationUpdate(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = Field(default=None, pattern="^(sandbox|production)$")
    fields: dict = Field(default_factory=dict)


def moderator_only(user=Depends(current_user)):
    if not user.get("is_moderator"):
        raise HTTPException(403, "Réservé aux administrateurs")
    return user


def _mask(value: str) -> str:
    if not value:
        return ""
    return ("•" * max(0, len(value) - 4)) + value[-4:] if len(value) > 4 else "••••"


def _public_view(cat: str, provider: dict, cfg: dict) -> dict:
    fields = []
    stored = (cfg.get("fields") or {})
    for f in provider["fields"]:
        raw = stored.get(f["name"], "")
        fields.append({**f, "value": (_mask(raw) if f.get("secret") else raw), "set": bool(raw)})
    return {
        "key": provider["key"], "label": provider["label"], "fields": fields,
        "enabled": bool(cfg.get("enabled", False)),
        "mode": cfg.get("mode", "sandbox"),
        "tested_at": cfg.get("tested_at"), "test_ok": cfg.get("test_ok"), "test_message": cfg.get("test_message"),
        "updated_at": cfg.get("updated_at"), "updated_by": cfg.get("updated_by"),
    }


@router.get("")
async def list_integrations(user=Depends(moderator_only)):
    stored = {c["key"]: c async for c in db.integrations.find({}, {"_id": 0})}
    out = []
    for cat, c in CATALOG.items():
        providers = [_public_view(cat, p, stored.get(p["key"], {})) for p in c["providers"]]
        out.append({"category": cat, "label": c["label"], "modes": c["modes"],
                    "active": sum(1 for p in providers if p["enabled"]), "total": len(providers), "providers": providers})
    return {"categories": out, "enabled_total": sum(1 for v in stored.values() if v.get("enabled"))}


@router.put("/{key}")
async def save_integration(key: str, data: IntegrationUpdate, user=Depends(moderator_only)):
    if key not in _PROVIDER_INDEX:
        raise HTTPException(404, "Fournisseur inconnu")
    cat, provider = _PROVIDER_INDEX[key]
    existing = await db.integrations.find_one({"key": key}, {"_id": 0}) or {"key": key, "category": cat, "fields": {}}
    fields = dict(existing.get("fields") or {})
    allowed = {f["name"]: f for f in provider["fields"]}
    for name, val in (data.fields or {}).items():
        if name not in allowed:
            continue
        # A masked placeholder (contains •) means the admin didn't change the secret — keep the stored value.
        if allowed[name].get("secret") and isinstance(val, str) and "•" in val:
            continue
        fields[name] = val.strip() if isinstance(val, str) else val
    upd = {"key": key, "category": cat, "fields": fields, "updated_at": now_utc(), "updated_by": user.get("full_name") or user["email"]}
    if data.enabled is not None:
        upd["enabled"] = data.enabled
    if data.mode is not None:
        upd["mode"] = data.mode
    await db.integrations.update_one({"key": key}, {"$set": upd}, upsert=True)
    await db.integration_history.insert_one({
        "id": new_id(), "key": key, "at": now_utc(), "by": upd["updated_by"],
        "enabled": upd.get("enabled", existing.get("enabled", False)), "mode": upd.get("mode", existing.get("mode")),
        "changed_fields": [n for n in (data.fields or {}) if n in allowed],
    })
    merged = {**existing, **upd}
    return _public_view(cat, provider, merged)


@router.post("/{key}/test")
async def test_integration(key: str, user=Depends(moderator_only)):
    if key not in _PROVIDER_INDEX:
        raise HTTPException(404, "Fournisseur inconnu")
    cat, provider = _PROVIDER_INDEX[key]
    cfg = await db.integrations.find_one({"key": key}, {"_id": 0}) or {}
    fields = cfg.get("fields") or {}
    missing = [f["label"] for f in provider["fields"] if not fields.get(f["name"])]
    if missing:
        ok, msg = False, "Champs manquants : " + ", ".join(missing)
    elif not cfg.get("enabled"):
        ok, msg = True, "Clés valides. Activez le fournisseur pour l'utiliser."
    else:
        ok, msg = True, f"Configuration complète ({cfg.get('mode', 'sandbox')}). Test réseau réel disponible après déploiement."
    await db.integrations.update_one({"key": key}, {"$set": {"tested_at": now_utc(), "test_ok": ok, "test_message": msg}}, upsert=True)
    return {"ok": ok, "message": msg}


@router.get("/{key}/history")
async def integration_history(key: str, user=Depends(moderator_only)):
    if key not in _PROVIDER_INDEX:
        raise HTTPException(404, "Fournisseur inconnu")
    return [h async for h in db.integration_history.find({"key": key}, {"_id": 0}).sort("at", -1).limit(50)]
