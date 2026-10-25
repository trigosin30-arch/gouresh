from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import create_dev_token, get_current_user
from ..config import settings
from ..db import get_db, utcnow
from ..models import Address, Profile
from ..schemas import AddressInput, DemoLoginInput, ProfileUpdate
from ..serializers import address_out, profile_out

router = APIRouter(prefix="/auth", tags=["account"])
account_router = APIRouter(prefix="/me", tags=["account"])


@router.post("/demo-login")
def demo_login(payload: DemoLoginInput, db: Session = Depends(get_db)) -> dict:
    """Passwordless local sign-in used only when Supabase is not configured."""
    if settings.is_supabase_configured or not settings.dev_auth:
        raise HTTPException(status_code=404, detail="Not available")
    email = payload.email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(status_code=422, detail="Enter a valid email address")

    profile = db.scalar(select(Profile).where(Profile.email == email))
    if profile is None:
        bootstrap_admin = db.query(Profile).filter(Profile.role == "admin").count() == 0
        profile = Profile(
            id=secrets.token_hex(16),
            email=email,
            full_name=(payload.full_name or email.split("@")[0].replace(".", " ").title()).strip(),
            # The very first account created in a fresh demo database owns the
            # admin dashboard; every later sign-up is a plain customer.
            role="admin" if bootstrap_admin else "customer",
        )
        db.add(profile)
    elif payload.full_name and payload.full_name.strip():
        profile.full_name = payload.full_name.strip()
    profile.last_login_at = utcnow()
    db.commit()
    db.refresh(profile)

    token, expires_in = create_dev_token(profile)
    return {"access_token": token, "token_type": "bearer", "expires_in": expires_in, "profile": profile_out(profile)}


@account_router.get("")
def me(user: Profile = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    addresses = db.scalars(select(Address).where(Address.user_id == user.id).order_by(Address.created_at)).all()
    return {"profile": profile_out(user), "addresses": [address_out(a) for a in addresses]}


@account_router.patch("")
def update_me(
    payload: ProfileUpdate, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.phone is not None:
        user.phone = payload.phone
    db.commit()
    db.refresh(user)
    return {"profile": profile_out(user)}


@account_router.post("/addresses", status_code=201)
def create_address(
    payload: AddressInput, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    count = db.query(Address).filter(Address.user_id == user.id).count()
    address = Address(user_id=user.id, is_default=count == 0, **payload.model_dump())
    if address.is_default:
        db.query(Address).filter(Address.user_id == user.id).update({"is_default": False})
    db.add(address)
    if not user.phone:
        user.phone = payload.phone
    db.commit()
    db.refresh(address)
    return {"address": address_out(address)}


@account_router.put("/addresses/{address_id}")
def update_address(
    address_id: str,
    payload: AddressInput,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    address = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == user.id))
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found")
    for field, value in payload.model_dump().items():
        setattr(address, field, value)
    db.commit()
    db.refresh(address)
    return {"address": address_out(address)}


@account_router.delete("/addresses/{address_id}", status_code=204)
def delete_address(
    address_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    address = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == user.id))
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found")
    was_default = address.is_default
    db.delete(address)
    db.commit()
    if was_default:
        replacement = db.scalar(
            select(Address).where(Address.user_id == user.id).order_by(Address.created_at)
        )
        if replacement:
            replacement.is_default = True
            db.commit()
    return Response(status_code=204)


@account_router.post("/addresses/{address_id}/default")
def set_default_address(
    address_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    address = db.scalar(select(Address).where(Address.id == address_id, Address.user_id == user.id))
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found")
    db.query(Address).filter(Address.user_id == user.id).update({"is_default": False})
    address.is_default = True
    db.commit()
    return {"ok": True}
