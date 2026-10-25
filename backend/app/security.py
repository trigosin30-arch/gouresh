"""Authentication, session, CSRF and authorization primitives."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from .config import settings
from .db import get_db, now
from .models import Session, User

_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)

SESSION_COOKIE = settings.session_cookie_name
CSRF_COOKIE = settings.csrf_cookie_name
CSRF_HEADER = "x-csrf-token"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_session(db: OrmSession, user: User, request: Request) -> tuple[str, str]:
    """Create a session row and return (raw_token, csrf_token)."""
    raw = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    session = Session(
        id=secrets.token_hex(16),
        user_id=user.id,
        token_hash=token_digest(raw),
        csrf_token=csrf,
        expires_at=now() + timedelta(hours=settings.session_ttl_hours),
        ip_address=(request.client.host if request.client else None),
        user_agent=(request.headers.get("user-agent") or "")[:250] or None,
    )
    db.add(session)
    db.commit()
    return raw, csrf


def revoke_session(db: OrmSession, raw_token: str) -> None:
    row = db.scalar(select(Session).where(Session.token_hash == token_digest(raw_token)))
    if row and row.revoked_at is None:
        row.revoked_at = now()
        db.commit()


def set_session_cookies(response, raw_token: str) -> None:
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        max_age=max_age,
        path="/",
    )


def clear_session_cookies(response) -> None:
    # The CSRF cookie is a double-submit token, not a credential: keep it so the
    # next login/registration request can still be validated.
    response.delete_cookie(SESSION_COOKIE, path="/")


def _session_from_request(request: Request, db: OrmSession) -> Optional[Session]:
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        return None
    row = db.scalar(select(Session).where(Session.token_hash == token_digest(raw)))
    if not row or row.revoked_at is not None:
        return None
    expires = row.expires_at
    if expires.tzinfo is None:  # SQLite returns naive datetimes
        from datetime import timezone

        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now():
        return None
    return row


def get_current_user(request: Request, db: OrmSession = Depends(get_db)) -> Optional[User]:
    session = _session_from_request(request, db)
    if not session:
        return None
    user = db.get(User, session.user_id)
    if not user or user.status == "pending":
        return None
    return user


def require_user(user: Optional[User] = Depends(get_current_user)) -> User:
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    if user.status != "active":
        # Defence in depth: sessions are revoked when an account is restricted,
        # so a live session should never belong to a restricted account.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is restricted. Contact the store.")
    return user


def _ensure_active_staff(user: Optional[User], message: str) -> User:
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    if user.status != "active":
        # Restricting an account must revoke shop-floor powers immediately, not
        # just customer ordering. Sessions are also revoked when this changes.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is not active. Contact the store owner.")
    if user.role not in ("staff", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, message)
    return user


def require_staff(user: Optional[User] = Depends(get_current_user)) -> User:
    return _ensure_active_staff(user, "Staff access required")


def require_admin(user: Optional[User] = Depends(get_current_user)) -> User:
    user = _ensure_active_staff(user, "Administrator access required")
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required")
    return user


def check_csrf(request: Request) -> None:
    """Double-submit cookie validation for cookie-authenticated mutations."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    cookie_token = request.cookies.get(CSRF_COOKIE)
    header_token = request.headers.get(CSRF_HEADER)
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF validation failed. Reload the page and retry.")
    origin = request.headers.get("origin")
    if origin:
        allowed = set(settings.trusted_origins) | {f"{request.url.scheme}://{request.url.netloc}"}
        host = request.headers.get("host")
        if origin not in allowed and origin not in {f"https://{host}", f"http://{host}"}:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-origin request rejected")
