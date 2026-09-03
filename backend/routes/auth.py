import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core import (JWT_SECRET, MODERATOR_EMAILS, client_ip, current_user, db, hash_password, make_token, new_id, normalize_phone, now_utc,
                  rate_limit, send_sms, sms_configured, verify_password)
from models import (ForgotPasswordIn, LoginIn, PasswordChangeIn, PhoneSendIn, PhoneVerifyIn, ProfileUpdateIn, RegisterIn, ResetPasswordIn, TokenOut,
                    UserOut)
from serializers import user_to_out

router = APIRouter(prefix="/auth", tags=["auth"])

OTP_TTL_MIN = 10
OTP_MAX_ATTEMPTS = 5


def _otp_hash(code: str, user_id: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


@router.post("/register", response_model=TokenOut)
async def register(data: RegisterIn, request: Request):
    rate_limit(f"register:{client_ip(request)}", 10, 3600, "Trop d'inscriptions depuis cet appareil, réessayez plus tard")
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email déjà enregistré")
    phone = None
    if data.phone and data.phone.strip():
        phone = normalize_phone(data.phone)
        if not phone:
            raise HTTPException(422, "Numéro de téléphone invalide (format attendu : +33 6 12 34 56 78)")
    user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(data.password),
        "full_name": data.full_name.strip(),
        "role": data.role,
        "phone": phone,
        "phone_verified": False,
        "sms_enabled": True,
        "vehicle_model": data.vehicle_model,
        "license_plate": data.license_plate,
        "rating": 5.0,
        "total_rides": 0,
        "is_online": False,
        "is_active": True,
        "manager_id": None,
        "created_at": now_utc(),
    }
    user["referral_code"] = secrets.token_hex(3).upper()
    user["wallet_balance"] = 0.0
    if data.referral_code:
        sponsor = await db.users.find_one({"referral_code": data.referral_code.strip().upper()}, {"_id": 0, "id": 1})
        if not sponsor:
            raise HTTPException(404, "Code de parrainage invalide")
        user["sponsor_id"] = sponsor["id"]
    if data.role == "driver":
        user["docs_blocked"] = True  # no documents yet → cannot work until mandatory documents are uploaded
    if data.role == "company":
        if not data.company_name:
            raise HTTPException(422, "Nom de l'entreprise requis")
        user["company_name"] = data.company_name
        user["invite_code"] = secrets.token_hex(3).upper()
    await db.users.insert_one(user.copy())
    user["is_moderator"] = email in MODERATOR_EMAILS
    return TokenOut(access_token=make_token(user), user=user_to_out(user))


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, request: Request):
    email = data.email.lower()
    ip = client_ip(request)
    # Brute-force protection: per account and per IP
    rate_limit(f"login:{email}", 8, 900, "Trop de tentatives pour ce compte, réessayez dans 15 minutes")
    rate_limit(f"login-ip:{ip}", 30, 900)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Email ou mot de passe incorrect")
    if user.get("is_active") is False:
        raise HTTPException(403, "Compte désactivé par votre gestionnaire")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_utc()}})
    user["is_moderator"] = user["email"] in MODERATOR_EMAILS
    return TokenOut(access_token=make_token(user), user=user_to_out(user))


@router.get("/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return user_to_out(user)


@router.patch("/me", response_model=UserOut)
async def update_me(data: ProfileUpdateIn, user=Depends(current_user)):
    update = {}
    if data.full_name is not None:
        update["full_name"] = data.full_name.strip()
    if data.sms_enabled is not None:
        update["sms_enabled"] = data.sms_enabled
    if data.language is not None:
        update["language"] = data.language
    if user["role"] == "driver":
        if data.vehicle_model is not None:
            update["vehicle_model"] = data.vehicle_model.strip()
        if data.license_plate is not None:
            update["license_plate"] = data.license_plate.strip().upper()
    if data.phone is not None:
        if data.phone.strip() == "":
            update.update({"phone": None, "phone_verified": False})
        else:
            phone = normalize_phone(data.phone)
            if not phone:
                raise HTTPException(422, "Numéro de téléphone invalide (format attendu : +33 6 12 34 56 78)")
            if phone != user.get("phone"):
                update.update({"phone": phone, "phone_verified": False})  # a new number must be verified again
    if update:
        await db.users.update_one({"id": user["id"]}, {"$set": update})
        user.update(update)
    return user_to_out(user)


@router.post("/password")
async def change_password(data: PasswordChangeIn, user=Depends(current_user)):
    rate_limit(f"pwd:{user['id']}", 5, 900)
    if not verify_password(data.current_password, user["password_hash"]):
        raise HTTPException(401, "Mot de passe actuel incorrect")
    if data.new_password == data.current_password:
        raise HTTPException(422, "Le nouveau mot de passe doit être différent")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(data.new_password), "password_changed_at": now_utc()}})
    return {"ok": True}


# ---------- Phone verification (SMS OTP via Twilio) ----------
@router.get("/phone/status")
async def phone_status(user=Depends(current_user)):
    return {"phone": user.get("phone"), "verified": bool(user.get("phone_verified")), "sms_enabled": user.get("sms_enabled", True), "sms_configured": sms_configured()}


@router.post("/phone/send-code")
async def send_phone_code(data: PhoneSendIn, user=Depends(current_user)):
    phone = normalize_phone(data.phone)
    if not phone:
        raise HTTPException(422, "Numéro de téléphone invalide (format attendu : +33 6 12 34 56 78)")
    rate_limit(f"otp:{user['id']}", 3, 600, "Trop de codes demandés, réessayez dans 10 minutes")
    rate_limit(f"otp-phone:{phone}", 5, 3600, "Trop de codes envoyés à ce numéro")
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "phone": phone, "phone_verified": False,
        "phone_otp": {"hash": _otp_hash(code, user["id"]), "expires_at": now_utc() + timedelta(minutes=OTP_TTL_MIN), "attempts": 0},
    }})
    delivered = await send_sms(phone, f"RideGo · Votre code de vérification : {code} (valable {OTP_TTL_MIN} min)")
    out = {"ok": True, "phone": phone, "delivered": delivered, "expires_in_min": OTP_TTL_MIN}
    if not sms_configured():
        # Twilio not configured yet: expose the code so the flow can be exercised in test mode.
        out["dev_code"] = code
    return out


@router.post("/phone/verify", response_model=UserOut)
async def verify_phone_code(data: PhoneVerifyIn, user=Depends(current_user)):
    otp = user.get("phone_otp")
    if not otp:
        raise HTTPException(400, "Aucun code en attente, demandez un nouveau code")
    if otp.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.users.update_one({"id": user["id"]}, {"$unset": {"phone_otp": ""}})
        raise HTTPException(429, "Trop d'essais, demandez un nouveau code")
    expires = otp["expires_at"]
    if expires.tzinfo is None:
        from datetime import timezone
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now_utc():
        await db.users.update_one({"id": user["id"]}, {"$unset": {"phone_otp": ""}})
        raise HTTPException(410, "Code expiré, demandez un nouveau code")
    if not hmac.compare_digest(otp["hash"], _otp_hash(data.code.strip(), user["id"])):
        await db.users.update_one({"id": user["id"]}, {"$inc": {"phone_otp.attempts": 1}})
        raise HTTPException(400, "Code incorrect")
    update = {"phone_verified": True, "phone_verified_at": now_utc(), "sms_enabled": True}
    await db.users.update_one({"id": user["id"]}, {"$set": update, "$unset": {"phone_otp": ""}})
    user.update(update)
    return user_to_out(user)


# ---------- Forgot password (SMS OTP to the verified phone) ----------
def _mask_phone(p: str) -> str:
    return p[:4] + " " + "•• •• ••" + " " + p[-2:]


async def _find_for_reset(identifier: str) -> Optional[dict]:
    ident = identifier.strip()
    if "@" in ident:
        return await db.users.find_one({"email": ident.lower()}, {"_id": 0})
    phone = normalize_phone(ident)
    return await db.users.find_one({"phone": phone}, {"_id": 0}) if phone else None


@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordIn, request: Request):
    rate_limit(f"forgot-ip:{client_ip(request)}", 10, 900)
    rate_limit(f"forgot:{data.identifier.strip().lower()}", 3, 600, "Trop de codes demandés, réessayez dans 10 minutes")
    user = await _find_for_reset(data.identifier)
    if not user or not (user.get("phone_verified") and user.get("phone")):
        raise HTTPException(404, "Aucun compte avec un numéro vérifié pour cet identifiant. Contactez le support.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "reset_otp": {"hash": _otp_hash(code, user["id"]), "expires_at": now_utc() + timedelta(minutes=OTP_TTL_MIN), "attempts": 0},
    }})
    delivered = await send_sms(user["phone"], f"RideGo · Code de réinitialisation du mot de passe : {code} (valable {OTP_TTL_MIN} min). Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.")
    out = {"ok": True, "masked_phone": _mask_phone(user["phone"]), "delivered": delivered, "expires_in_min": OTP_TTL_MIN}
    if not sms_configured():
        out["dev_code"] = code
    return out


@router.post("/reset-password", response_model=TokenOut)
async def reset_password(data: ResetPasswordIn, request: Request):
    rate_limit(f"reset-ip:{client_ip(request)}", 20, 900)
    user = await _find_for_reset(data.identifier)
    otp = (user or {}).get("reset_otp")
    if not user or not otp:
        raise HTTPException(400, "Aucun code en attente, demandez un nouveau code")
    if otp.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.users.update_one({"id": user["id"]}, {"$unset": {"reset_otp": ""}})
        raise HTTPException(429, "Trop d'essais, demandez un nouveau code")
    expires = otp["expires_at"]
    if expires.tzinfo is None:
        from datetime import timezone
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now_utc():
        await db.users.update_one({"id": user["id"]}, {"$unset": {"reset_otp": ""}})
        raise HTTPException(410, "Code expiré, demandez un nouveau code")
    if not hmac.compare_digest(otp["hash"], _otp_hash(data.code.strip(), user["id"])):
        await db.users.update_one({"id": user["id"]}, {"$inc": {"reset_otp.attempts": 1}})
        raise HTTPException(400, "Code incorrect")
    await db.users.update_one({"id": user["id"]}, {
        "$set": {"password_hash": hash_password(data.new_password), "password_changed_at": now_utc()},
        "$unset": {"reset_otp": ""},
    })
    if user.get("is_active") is False:
        raise HTTPException(403, "Compte désactivé par votre gestionnaire")
    user["is_moderator"] = user["email"] in MODERATOR_EMAILS
    return TokenOut(access_token=make_token(user), user=user_to_out(user))
