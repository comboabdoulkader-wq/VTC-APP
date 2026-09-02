from fastapi import APIRouter, Depends, HTTPException

from core import db, hash_password, make_token, verify_password, current_user, now_utc, new_id
from models import LoginIn, RegisterIn, TokenOut, UserOut
from serializers import user_to_out

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut)
async def register(data: RegisterIn):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email déjà enregistré")
    user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(data.password),
        "full_name": data.full_name,
        "role": data.role,
        "phone": data.phone,
        "vehicle_model": data.vehicle_model,
        "license_plate": data.license_plate,
        "rating": 5.0,
        "total_rides": 0,
        "is_online": False,
        "is_active": True,
        "manager_id": None,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user.copy())
    return TokenOut(access_token=make_token(user), user=user_to_out(user))


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Email ou mot de passe incorrect")
    if user.get("is_active") is False:
        raise HTTPException(403, "Compte désactivé par votre gestionnaire")
    return TokenOut(access_token=make_token(user), user=user_to_out(user))


@router.get("/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return user_to_out(user)
