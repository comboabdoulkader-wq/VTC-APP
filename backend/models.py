"""Pydantic models."""
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

Role = Literal["passenger", "driver", "company"]
BudgetPeriod = Literal["day", "week", "month"]
RideStatus = Literal["requested", "accepted", "in_progress", "completed", "cancelled"]
VehicleType = Literal["standard", "premium", "van"]
PaymentMethod = Literal["cash", "card"]
PaymentStatus = Literal["unpaid", "pending", "paid"]
RideSource = Literal["platform", "private"]


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str = Field(min_length=1, max_length=80)
    role: Role
    phone: Optional[str] = Field(default=None, max_length=30)
    vehicle_model: Optional[str] = Field(default=None, max_length=60)
    license_plate: Optional[str] = Field(default=None, max_length=20)
    company_name: Optional[str] = Field(default=None, max_length=80)
    referral_code: Optional[str] = Field(default=None, max_length=12)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=72)


class ProfileUpdateIn(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=30)
    sms_enabled: Optional[bool] = None
    vehicle_model: Optional[str] = Field(default=None, max_length=60)
    license_plate: Optional[str] = Field(default=None, max_length=20)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class PhoneSendIn(BaseModel):
    phone: str = Field(min_length=6, max_length=30)


class PhoneVerifyIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: Role
    phone: Optional[str] = None
    phone_verified: bool = False
    sms_enabled: bool = True
    vehicle_model: Optional[str] = None
    license_plate: Optional[str] = None
    rating: float = 5.0
    total_rides: int = 0
    manager_id: Optional[str] = None
    manager_name: Optional[str] = None
    is_active: bool = True
    is_online: bool = False
    is_moderator: bool = False
    docs_blocked: bool = False
    selfie_requested: bool = False
    has_photo: bool = False
    wallet_balance: float = 0
    referral_code: Optional[str] = None
    company_name: Optional[str] = None
    invite_code: Optional[str] = None
    company_id: Optional[str] = None
    budget_amount: Optional[float] = None
    budget_period: Optional[BudgetPeriod] = None
    company_active: Optional[bool] = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class LocationIn(BaseModel):
    lat: float
    lng: float
    address: str


class EstimateIn(BaseModel):
    pickup: LocationIn
    dropoff: LocationIn


class VehicleEstimate(BaseModel):
    vehicle_type: VehicleType
    label: str
    price: float
    distance_km: float
    duration_min: int
    eta_min: int


class SurchargeOut(BaseModel):
    distance_to_center_km: float
    per_km: float
    amount: float
    center_name: str
    city_id: Optional[str] = None
    city_name: Optional[str] = None
    price_multiplier: float = 1.0


class EstimateOut(BaseModel):
    options: List[VehicleEstimate]
    surcharge: SurchargeOut


class RideCreateIn(BaseModel):
    pickup: LocationIn
    dropoff: LocationIn
    vehicle_type: VehicleType
    surcharge_enabled: bool = False
    scheduled_at: Optional[datetime] = None
    passenger_label: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=300)
    payment_method: PaymentMethod = "cash"
    business: bool = False
    promo_code: Optional[str] = Field(default=None, max_length=20)
    use_wallet: bool = False


class RideBatchIn(BaseModel):
    rides: List[RideCreateIn] = Field(min_length=1, max_length=10)


class DriverLocation(BaseModel):
    lat: float
    lng: float
    updated_at: Optional[datetime] = None


class RideOut(BaseModel):
    id: str
    source: RideSource = "platform"
    batch_id: Optional[str] = None
    passenger_id: Optional[str] = None
    passenger_name: str
    passenger_label: Optional[str] = None
    passenger_phone: Optional[str] = None
    notes: Optional[str] = None
    driver_id: Optional[str] = None
    driver_name: Optional[str] = None
    driver_vehicle: Optional[str] = None
    driver_plate: Optional[str] = None
    driver_rating: Optional[float] = None
    driver_has_photo: bool = False
    driver_location: Optional[DriverLocation] = None
    driver_eta_min: Optional[int] = None
    pickup: LocationIn
    dropoff: LocationIn
    vehicle_type: VehicleType
    base_price: float
    surcharge_enabled: bool = False
    surcharge_km: float = 0
    surcharge_amount: float = 0
    price: float
    distance_km: float
    duration_min: int
    status: RideStatus
    scheduled_at: Optional[datetime] = None
    payment_method: PaymentMethod = "cash"
    payment_status: PaymentStatus = "unpaid"
    commission_rate: float = 0
    commission_amount: float = 0
    business: bool = False
    promo_code: Optional[str] = None
    discount_amount: float = 0
    price_multiplier: float = 1.0
    city_name: Optional[str] = None
    tip_paid: bool = False
    share_token: Optional[str] = None
    cancellation_fee: float = 0
    wallet_amount: float = 0
    due_amount: float = 0
    assigned_by_name: Optional[str] = None
    created_at: datetime
    accepted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    rating: Optional[int] = None
    tip: Optional[float] = None


class RateIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    tip: float = Field(default=0, ge=0)


class DriverStatusIn(BaseModel):
    is_online: bool
    lat: Optional[float] = None
    lng: Optional[float] = None


class LocationUpdateIn(BaseModel):
    lat: float
    lng: float


# ---- Private rides ----
class PrivateRideIn(BaseModel):
    client_name: str = Field(min_length=1, max_length=80)
    client_phone: Optional[str] = Field(default=None, max_length=30)
    pickup_address: str = Field(min_length=1, max_length=200)
    dropoff_address: str = Field(min_length=1, max_length=200)
    scheduled_at: datetime
    price: float = Field(gt=0)
    payment_method: PaymentMethod = "cash"
    notes: Optional[str] = Field(default=None, max_length=300)
    vehicle_type: VehicleType = "standard"


class PrivateRideUpdateIn(BaseModel):
    status: Optional[Literal["accepted", "in_progress", "completed", "cancelled"]] = None
    price: Optional[float] = Field(default=None, gt=0)
    notes: Optional[str] = None
    scheduled_at: Optional[datetime] = None


# ---- Team ----
class TeamMemberIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str = Field(min_length=1, max_length=80)
    phone: Optional[str] = None
    vehicle_model: Optional[str] = None
    license_plate: Optional[str] = None


class TeamMemberUpdateIn(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    vehicle_model: Optional[str] = None
    license_plate: Optional[str] = None
    is_active: Optional[bool] = None


class AssignIn(BaseModel):
    ride_id: str
    driver_id: str


class TeamMemberOut(UserOut):
    completed_rides: int = 0
    gross: float = 0
    commission: float = 0
    net: float = 0
    active_ride_id: Optional[str] = None
    active_ride_status: Optional[str] = None


# ---- Payments ----
class CheckoutIn(BaseModel):
    return_url: Optional[str] = None
    kind: Literal["ride", "tip"] = "ride"


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    ride_id: Optional[str] = None
    read: bool
    created_at: datetime


# ---- Company / business accounts ----
class JoinCompanyIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class EmployeeUpdateIn(BaseModel):
    budget_amount: Optional[float] = Field(default=None, ge=0)
    budget_period: Optional[BudgetPeriod] = None
    company_active: Optional[bool] = None


class EmployeeOut(UserOut):
    spent: float = 0
    remaining: Optional[float] = None
    rides_count: int = 0


# ---- Cities (moderation) ----
class CityIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    country: Optional[str] = None
    lat: float
    lng: float
    price_multiplier: float = Field(default=1.0, ge=0.5, le=3.0)


class CityUpdateIn(BaseModel):
    name: Optional[str] = None
    country: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    price_multiplier: Optional[float] = Field(default=None, ge=0.5, le=3.0)


class CityOut(BaseModel):
    id: str
    name: str
    country: Optional[str] = None
    lat: float
    lng: float
    source: str = "default"
    price_multiplier: float = 1.0
