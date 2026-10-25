"""Authentication, session and profile endpoints."""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..db import get_db, now
from ..models import Address, Cart, PasswordResetToken, User
from ..schemas import (
    AddressIn,
    ChangePasswordIn,
    ForgotPasswordIn,
    LoginIn,
    ProfileIn,
    RegisterIn,
    ResetPasswordIn,
)
from ..security import (
    SESSION_COOKIE,
    clear_session_cookies,
    get_current_user,
    hash_password,
    issue_session,
    require_user,
    revoke_session,
    set_session_cookies,
    token_digest,
    verify_password,
)
from ..serializers import user_public
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.commerce import merge_carts
from ..services.notifications import notify_user
from ..services.rate_limit import client_ip, enforce

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cart_count(db: OrmSession, user: User) -> int:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
    return sum(item.quantity for item in cart.items) if cart else 0


@router.post("/register", status_code=201)
def register(payload: RegisterIn, request: Request, response: Response, db: OrmSession = Depends(get_db)):
    enforce(request, "register", 5, 3600)
    email = str(payload.email).lower()
    existing = db.scalar(select(User).where(func.lower(User.email) == email))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    if payload.phone:
        if db.scalar(select(User).where(User.phone == payload.phone)):
            raise HTTPException(status.HTTP_409_CONFLICT, "This phone number is already registered")
    if settings.admin_bootstrap_email and email == settings.admin_bootstrap_email.lower():
        raise HTTPException(status.HTTP_409_CONFLICT, "This email is reserved for the administrator account")

    user = User(
        email=email,
        phone=payload.phone,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role="customer",
        status="active",
    )
    db.add(user)
    db.commit()
    audit(db, "auth.register", actor=user, entity_type="user", entity_id=user.id, ip_address=client_ip(request), commit=True)

    # Merge an existing guest cart.
    guest_token = request.cookies.get("asm_guest_cart")
    if guest_token:
        guest_cart = db.scalar(select(Cart).where(Cart.guest_token == guest_token))
        if guest_cart:
            user_cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
            if not user_cart:
                user_cart = Cart(user_id=user.id)
                db.add(user_cart)
                db.commit()
            merge_carts(db, guest_cart, user_cart)

    raw_token, csrf = issue_session(db, user, request)
    set_session_cookies(response, raw_token)
    response.set_cookie("asm_csrf", csrf, samesite="lax", secure=settings.secure_cookies, path="/")
    response.delete_cookie("asm_guest_cart", path="/")
    notify_user(
        db,
        user,
        "account_created",
        "Welcome to Ankit Stationery Mart",
        f"Hello {user.full_name}, your account is ready. You can now track orders and submit used books for sale.",
        related_type="user",
        related_id=user.id,
    )
    return {"user": user_public(user)}


@router.post("/login")
def login(payload: LoginIn, request: Request, response: Response, db: OrmSession = Depends(get_db)):
    enforce(request, "login", *settings.rate_limit_login)
    email = str(payload.email).lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user or not verify_password(payload.password, user.password_hash):
        # Same message for unknown user and wrong password (no account enumeration).
        audit(db, "auth.login_failed", entity_type="email", entity_id=email, ip_address=client_ip(request), commit=True)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if user.status != "active":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account is restricted. Contact the store to resolve it."
            if user.status == "restricted"
            else "This account is not active. Contact the store.",
        )
    user.last_login_at = now()
    db.commit()

    guest_token = request.cookies.get("asm_guest_cart")
    if guest_token:
        guest_cart = db.scalar(select(Cart).where(Cart.guest_token == guest_token))
        if guest_cart:
            user_cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
            if not user_cart:
                user_cart = Cart(user_id=user.id)
                db.add(user_cart)
                db.commit()
            merge_carts(db, guest_cart, user_cart)

    raw_token, csrf = issue_session(db, user, request)
    set_session_cookies(response, raw_token)
    response.set_cookie("asm_csrf", csrf, samesite="lax", secure=settings.secure_cookies, path="/")
    response.delete_cookie("asm_guest_cart", path="/")
    audit(db, "auth.login", actor=user, entity_type="user", entity_id=user.id, ip_address=client_ip(request), commit=True)
    return {"user": user_public(user)}


@router.post("/logout")
def logout(request: Request, response: Response, db: OrmSession = Depends(get_db)):
    raw = request.cookies.get(SESSION_COOKIE)
    if raw:
        revoke_session(db, raw)
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
def me(user: Optional[User] = Depends(get_current_user), db: OrmSession = Depends(get_db)):
    if not user:
        return {"user": None}
    return {"user": user_public(user), "cart_count": _cart_count(db, user)}


@router.post("/profile")
def update_profile(payload: ProfileIn, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    if payload.phone and payload.phone != user.phone:
        if db.scalar(select(User).where(User.phone == payload.phone, User.id != user.id)):
            raise HTTPException(status.HTTP_409_CONFLICT, "This phone number is already in use")
    user.full_name = payload.full_name
    user.phone = payload.phone
    db.commit()
    audit(db, "account.profile_updated", actor=user, entity_type="user", entity_id=user.id, commit=True)
    return {"user": user_public(user)}


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, request: Request, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    enforce(request, "password_change", 5, 900)
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    audit(db, "account.password_changed", actor=user, entity_type="user", entity_id=user.id, ip_address=client_ip(request), commit=True)
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordIn, request: Request, db: OrmSession = Depends(get_db)):
    enforce(request, "forgot_password", 5, 900)
    email = str(payload.email).lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    response: dict = {"ok": True, "message": "If an account exists for that email, a reset link has been created."}
    if user:
        raw = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=token_digest(raw),
                expires_at=now() + timedelta(minutes=30),
            )
        )
        db.commit()
        link = f"/reset-password?token={raw}"
        record = notify_user(
            db,
            user,
            "password_reset",
            "Reset your Ankit Stationery Mart password",
            f"Use this link within 30 minutes to reset your password: {link}",
            related_type="user",
            related_id=user.id,
        )[0]
        if settings.env != "production":
            # Development only: there is no reachable mailbox, so surface the link.
            response["dev_reset_link"] = link
        response["delivery"] = {"channel": "email", "status": record.status, "provider": record.provider}
    return response


@router.post("/reset-password")
def reset_password(payload: ResetPasswordIn, request: Request, db: OrmSession = Depends(get_db)):
    enforce(request, "reset_password", 10, 900)
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_digest(payload.token)))
    if not row or row.used_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has already been used")
    expires = row.expires_at
    if expires.tzinfo is None:
        from datetime import timezone

        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link has expired")
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid")
    user.password_hash = hash_password(payload.password)
    row.used_at = now()
    db.commit()
    audit(db, "account.password_reset", actor=user, entity_type="user", entity_id=user.id, ip_address=client_ip(request), commit=True)
    return {"ok": True}


# --------------------------- addresses ---------------------------
@router.get("/addresses")
def list_addresses(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(Address).where(Address.user_id == user.id).order_by(Address.created_at)).all()
    return {"addresses": [_address(a) for a in rows]}


def _address(address: Address) -> dict:
    return {
        "id": address.id,
        "label": address.label,
        "full_name": address.full_name,
        "phone": address.phone,
        "line1": address.line1,
        "line2": address.line2,
        "locality": address.locality,
        "city": address.city,
        "state": address.state,
        "pincode": address.pincode,
        "is_default": address.is_default,
    }


@router.post("/addresses", status_code=201)
def create_address(payload: AddressIn, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    count = db.scalar(select(func.count(Address.id)).where(Address.user_id == user.id)) or 0
    if count >= 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can save up to 10 addresses")
    is_default = payload.is_default or count == 0
    if is_default:
        for existing in db.scalars(select(Address).where(Address.user_id == user.id, Address.is_default.is_(True))):
            existing.is_default = False
    address = Address(user_id=user.id, **payload.model_dump(exclude={"is_default"}), is_default=is_default)
    db.add(address)
    db.commit()
    return {"address": _address(address)}


@router.put("/addresses/{address_id}")
def update_address(address_id: str, payload: AddressIn, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    address = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == user.id))
    if not address:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Address not found")
    if payload.is_default:
        for existing in db.scalars(select(Address).where(Address.user_id == user.id, Address.is_default.is_(True))):
            existing.is_default = False
    for field, value in payload.model_dump().items():
        setattr(address, field, value)
    db.commit()
    return {"address": _address(address)}


@router.delete("/addresses/{address_id}")
def delete_address(address_id: str, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    address = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == user.id))
    if not address:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Address not found")
    db.delete(address)
    db.commit()
    return {"ok": True}


@router.post("/delete-request")
def request_account_deletion(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    """Records a deletion request for staff; orders are retained for accounting."""
    user.status = "pending"
    db.commit()
    audit(db, "account.deletion_requested", actor=user, entity_type="user", entity_id=user.id, commit=True)
    staff = db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all()
    from ..services.notifications import notify_staff

    notify_staff(
        db,
        list(staff),
        "account_deletion_request",
        "Account deletion requested",
        f"{user.email} requested account deletion. Review retained order records before anonymising.",
    )
    return {"ok": True, "message": "Your deletion request is recorded. The store will confirm within 7 working days."}
