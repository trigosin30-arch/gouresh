"""Identity verification.

Two modes:

* Supabase (production / staging) — the browser obtains a Supabase access token
  via Google OAuth. This module verifies the token signature (HS256 project
  secret, or the project's public JWKS for asymmetric keys) and provisions a
  local `profiles` row keyed on the Supabase `sub`.
* Demo (no Supabase project) — `/api/auth/demo-login` mints a short-lived HS256
  token signed with a local dev secret. Disabled when `DEV_AUTH=false`.

Authorisation always comes from the database profile (`role` column), never
from client-supplied data or token metadata the user could influence.
"""
from __future__ import annotations

from datetime import timedelta
from functools import lru_cache
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db, utcnow
from .models import Profile

bearer = HTTPBearer(auto_error=False)
DEV_ISSUER = "asm-dev"
DEV_AUDIENCE = "asm-app"


def _unauthorized(detail: str = "Sign in to continue") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def create_dev_token(profile: Profile) -> tuple[str, int]:
    expires_in = settings.dev_jwt_ttl_hours * 3600
    now = utcnow()
    payload = {
        "iss": DEV_ISSUER,
        "aud": DEV_AUDIENCE,
        "sub": profile.id,
        "email": profile.email,
        "name": profile.full_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.dev_jwt_ttl_hours)).timestamp()),
    }
    token = jwt.encode(payload, settings.dev_jwt_secret, algorithm="HS256")
    return token, expires_in


@lru_cache(maxsize=4)
def _fetch_jwks(url: str) -> dict[str, Any]:
    response = httpx.get(url, timeout=8)
    response.raise_for_status()
    return response.json()


def _supabase_key(token: str) -> Any:
    if settings.supabase_jwt_secret:
        return settings.supabase_jwt_secret
    if not settings.supabase_url:
        raise _unauthorized("Authentication is not configured")
    url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
    try:
        jwks = _fetch_jwks(url)
    except Exception:  # noqa: BLE001 - network issues should not 500 the app
        _fetch_jwks.cache_clear()
        raise _unauthorized("Could not verify sign-in, please retry") from None
    kid = jwt.get_unverified_header(token).get("kid")
    for key in jwks.get("keys", []):
        if not kid or key.get("kid") == kid:
            return jwt.PyJWK(key).key
    raise _unauthorized("Unknown signing key")


def decode_token(token: str) -> dict[str, Any]:
    try:
        unverified = jwt.decode(token, options={"verify_signature": False, "verify_aud": False})
        if unverified.get("iss") == DEV_ISSUER:
            if not settings.dev_auth:
                raise _unauthorized()
            return jwt.decode(
                token,
                settings.dev_jwt_secret,
                algorithms=["HS256"],
                audience=DEV_AUDIENCE,
                issuer=DEV_ISSUER,
            )
        return jwt.decode(
            token,
            _supabase_key(token),
            algorithms=["HS256", "RS256", "ES256", "EdDSA"],
            audience=settings.supabase_jwt_audience,
            options={"verify_iss": False},
        )
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session expired, please sign in again") from None
    except Exception:  # noqa: BLE001
        raise _unauthorized("Invalid session") from None


def _claims_to_profile(db: Session, claims: dict[str, Any]) -> Profile:
    user_id = str(claims.get("sub") or "")
    email = (claims.get("email") or "").strip().lower()
    if not user_id or not email:
        raise _unauthorized("Sign-in token is missing an email")

    profile = db.get(Profile, user_id) or db.query(Profile).filter(Profile.email == email).first()
    meta = claims.get("user_metadata") or {}
    display_name = (meta.get("full_name") or meta.get("name") or claims.get("name") or "").strip()
    avatar = meta.get("avatar_url") or meta.get("picture")

    if profile is None:
        profile = Profile(
            id=user_id,
            email=email,
            full_name=display_name or email.split("@")[0].replace(".", " ").title(),
            role="customer",  # never derive privilege from a client-controlled token
            avatar_url=avatar,
            last_login_at=utcnow(),
        )
        db.add(profile)
    else:
        if display_name and not profile.full_name:
            profile.full_name = display_name
        if avatar and not profile.avatar_url:
            profile.avatar_url = avatar
        profile.last_login_at = utcnow()
    db.commit()
    db.refresh(profile)
    return profile


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Profile:
    if credentials is None or not credentials.credentials:
        raise _unauthorized()
    claims = decode_token(credentials.credentials)
    return _claims_to_profile(db, claims)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Profile | None:
    if credentials is None or not credentials.credentials:
        return None
    try:
        claims = decode_token(credentials.credentials)
        return _claims_to_profile(db, claims)
    except HTTPException:
        return None


def require_admin(user: Profile = Depends(get_current_user)) -> Profile:
    if user.role not in ("admin", "staff"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


def require_owner_or_admin(user: Profile = Depends(get_current_user)) -> Profile:
    return user
