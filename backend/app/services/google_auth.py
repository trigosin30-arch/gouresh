"""Google Sign-In identity verification.

The browser receives a Google ID token (a signed JWT) from Google Identity
Services. That token is **never** trusted on its own: the backend verifies the
signature against Google's published certificates, plus the issuer, audience and
expiry, before a session is created. See
https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

Nothing here is enabled unless ``GOOGLE_CLIENT_ID`` is configured; the API then
reports Google sign-in as unavailable instead of offering a button that fails.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from ..config import settings

logger = logging.getLogger("ankit-stationery-mart.google")

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleAuthError(Exception):
    """Verification failed. ``code`` is a stable, non-sensitive reason."""

    def __init__(self, message: str, code: str = "invalid_token") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: Optional[str] = None
    picture: Optional[str] = None
    hosted_domain: Optional[str] = None


def is_configured() -> bool:
    return bool(settings.google_client_id)


def _verify_token_with_google(credential: str, client_id: str) -> dict:
    """Verify with Google's libraries. Separated so tests can substitute it."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    return google_id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        audience=client_id,
        clock_skew_in_seconds=10,
    )


def verify_credential(credential: str) -> GoogleIdentity:
    """Verify a Google ID token and return the identity it asserts."""
    if not is_configured():
        raise GoogleAuthError(
            "Google sign-in is not configured for this deployment.", code="not_configured"
        )
    token = (credential or "").strip()
    if not token:
        raise GoogleAuthError("A Google credential is required.", code="missing_credential")
    if len(token) > 8192:
        raise GoogleAuthError("Google credential is too large.", code="invalid_token")

    try:
        claims = _verify_token_with_google(token, settings.google_client_id)
    except GoogleAuthError:
        raise
    except Exception as exc:  # noqa: BLE001 - library raises several types
        # Never leak token contents or library internals to the client.
        logger.warning("Google ID token rejected: %s", type(exc).__name__)
        raise GoogleAuthError("Google sign-in could not be verified. Please try again.", "invalid_token")

    if not isinstance(claims, dict):
        raise GoogleAuthError("Google returned an unexpected response.", "invalid_token")

    issuer = str(claims.get("iss", ""))
    if issuer not in GOOGLE_ISSUERS:
        raise GoogleAuthError("Google token issuer is not recognised.", "invalid_token")

    # verify_oauth2_token already checks audience, expiry and signature; these
    # assertions are defence in depth against a mocked or misconfigured verifier.
    if claims.get("aud") not in (settings.google_client_id, None):
        raise GoogleAuthError("Google token was issued for a different application.", "invalid_token")
    if claims.get("exp") is not None and not isinstance(claims.get("exp"), (int, float)):
        raise GoogleAuthError("Google token expiry is malformed.", "invalid_token")

    sub = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip().lower()
    if not sub or not email or "@" not in email:
        raise GoogleAuthError("Google did not return an email address.", "missing_email")

    email_verified = bool(claims.get("email_verified"))
    if not email_verified:
        raise GoogleAuthError(
            "That Google account's email address is not verified by Google.", "email_unverified"
        )

    hosted_domain = claims.get("hd")
    if settings.google_hosted_domain and hosted_domain != settings.google_hosted_domain:
        raise GoogleAuthError(
            "Only accounts from the store's Google Workspace domain may sign in.", "domain_not_allowed"
        )

    return GoogleIdentity(
        sub=sub,
        email=email,
        email_verified=email_verified,
        name=(claims.get("name") or None),
        picture=(claims.get("picture") or None),
        hosted_domain=hosted_domain,
    )
