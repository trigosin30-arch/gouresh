"""Google Sign-In: server-side token verification and account linking.

The network call to Google is replaced with a stub so the suite stays offline,
but everything else — claim checks, account resolution, sessions, role handling,
restriction enforcement — is the real code path.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import settings
from app.main import app
from app.models import User
from app.security import UNUSABLE_PASSWORD
from app.services import google_auth
from tests.conftest import csrf, login, make_user

CLIENT_ID = "test-client-id.apps.googleusercontent.com"


def google_claims(**overrides) -> dict:
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-sub-1234567890",
        "email": "gmail.user@example.com",
        "email_verified": True,
        "name": "Gmail User",
        "picture": "https://example.com/avatar.png",
        "exp": 9999999999,
        "iat": 1700000000,
    }
    claims.update(overrides)
    return claims


@pytest.fixture()
def google(monkeypatch):
    """Configure a client id and stub out Google's verifier."""
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "google_hosted_domain", None)
    state = {"claims": google_claims(), "raise": None}

    def fake_verify(credential: str, client_id: str) -> dict:
        assert client_id == CLIENT_ID
        if state["raise"]:
            raise state["raise"]
        return state["claims"]

    monkeypatch.setattr(google_auth, "_verify_token_with_google", fake_verify)
    return state


def post_google(client: TestClient, credential: str = "x" * 40):
    return client.post("/api/auth/google", json={"credential": credential}, headers=csrf(client))


# --------------------------------------------------------------------------- #
# configuration
# --------------------------------------------------------------------------- #
def test_providers_reports_google_as_disabled_when_unconfigured(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    body = client.get("/api/auth/providers").json()
    assert body["google"]["enabled"] is False
    assert body["google"]["client_id"] is None
    assert body["password"]["enabled"] is True


def test_google_login_returns_503_when_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    response = post_google(client)
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()


def test_providers_exposes_the_public_client_id(client, google):
    body = client.get("/api/auth/providers").json()
    assert body["google"] == {"enabled": True, "client_id": CLIENT_ID}


# --------------------------------------------------------------------------- #
# happy paths
# --------------------------------------------------------------------------- #
def test_verified_google_identity_creates_a_customer_account(client, db, google):
    response = post_google(client)
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["created"] is True
    assert payload["user"]["email"] == "gmail.user@example.com"
    assert payload["user"]["role"] == "customer"
    assert payload["user"]["email_verified"] is True
    assert payload["user"]["has_password"] is False
    assert payload["user"]["google_linked"] is True

    # A real session was created and the cookie works.
    assert client.get("/api/auth/me").json()["user"]["email"] == "gmail.user@example.com"

    stored = db.scalar(select(User).where(User.email == "gmail.user@example.com"))
    assert stored.google_sub == "google-sub-1234567890"
    assert stored.password_hash == UNUSABLE_PASSWORD


def test_repeat_google_login_reuses_the_account(client, db, google):
    first = post_google(client).json()
    second = post_google(client).json()
    assert second["created"] is False
    assert second["user"]["id"] == first["user"]["id"]
    assert len(db.scalars(select(User).where(User.email == "gmail.user@example.com")).all()) == 1


def test_existing_password_account_is_linked_without_changing_its_role(client, db, google):
    existing = make_user(db, email="gmail.user@example.com", role="staff", name="Shop Staff")

    response = post_google(client)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["linked"] is True
    assert payload["created"] is False
    assert payload["user"]["id"] == existing.id
    # Linking must never grant or remove privileges.
    assert payload["user"]["role"] == "staff"
    assert payload["user"]["has_password"] is True


def test_google_login_merges_a_guest_cart(client, db, google, shop):
    from tests.conftest import make_product

    product = make_product(db, stock=5)
    assert client.post("/api/cart/items", json={"product_id": product.id, "quantity": 2}, headers=csrf(client)).status_code == 200

    assert post_google(client).status_code == 200
    cart = client.get("/api/cart").json()
    assert sum(item["quantity"] for item in cart["items"]) == 2


# --------------------------------------------------------------------------- #
# rejections
# --------------------------------------------------------------------------- #
def test_unverified_email_is_rejected(client, db, google):
    google["claims"] = google_claims(email_verified=False)
    response = post_google(client)
    assert response.status_code == 401
    assert "not verified" in response.json()["detail"].lower()
    assert db.scalar(select(User).where(User.email == "gmail.user@example.com")) is None


@pytest.mark.parametrize(
    "override",
    [
        {"iss": "https://evil.example.com"},
        {"aud": "someone-elses-client-id"},
        {"sub": ""},
        {"email": ""},
        {"email": "not-an-email"},
        {"exp": "not-a-number"},
    ],
)
def test_malformed_claims_are_rejected(client, db, google, override):
    google["claims"] = google_claims(**override)
    response = post_google(client)
    assert response.status_code == 401, response.text
    assert db.scalar(select(User).where(User.google_sub == "google-sub-1234567890")) is None


def test_signature_failure_from_the_library_is_rejected(client, db, google):
    google["raise"] = ValueError("Token signature verification failed")
    response = post_google(client)
    assert response.status_code == 401
    # The library's message must not leak to the client.
    assert "signature verification failed" not in response.json()["detail"].lower()
    assert db.scalar(select(User).where(User.email == "gmail.user@example.com")) is None


def test_hosted_domain_restriction_is_enforced(client, db, google, monkeypatch):
    monkeypatch.setattr(settings, "google_hosted_domain", "ankitstationery.example")
    google["claims"] = google_claims(email="someone@gmail.com", hd=None)
    assert post_google(client).status_code == 401


def test_restricted_account_cannot_sign_in_with_google(client, db, google):
    make_user(db, email="gmail.user@example.com", status="restricted")
    response = post_google(client)
    assert response.status_code == 403
    assert "restricted" in response.json()["detail"].lower()
    assert client.get("/api/auth/me").json()["user"] is None


def test_email_already_linked_to_another_google_account_is_refused(client, db, google):
    make_user(db, email="gmail.user@example.com").google_sub = "some-other-sub"
    db.commit()
    response = post_google(client)
    assert response.status_code == 409
    assert "different google account" in response.json()["detail"].lower()


def test_google_login_requires_the_csrf_header(client, google):
    response = client.post("/api/auth/google", json={"credential": "x" * 40})
    assert response.status_code == 403
    assert "csrf" in response.json()["detail"].lower()


def test_credential_length_is_validated(client, google):
    assert client.post("/api/auth/google", json={"credential": "short"}, headers=csrf(client)).status_code == 422


# --------------------------------------------------------------------------- #
# linking from account settings + password lifecycle
# --------------------------------------------------------------------------- #
def test_link_endpoint_requires_a_session(client, google):
    assert client.post("/api/auth/google/link", json={"credential": "x" * 40}, headers=csrf(client)).status_code == 401


def test_link_endpoint_attaches_google_to_the_signed_in_account(client, db, google):
    make_user(db, email="gmail.user@example.com", name="Linked Person")
    assert login(client, "gmail.user@example.com").status_code == 200

    response = client.post("/api/auth/google/link", json={"credential": "x" * 40}, headers=csrf(client))
    assert response.status_code == 200, response.text
    assert response.json()["user"]["google_linked"] is True
    assert db.scalar(select(User).where(User.email == "gmail.user@example.com")).google_sub == "google-sub-1234567890"


def test_link_endpoint_refuses_a_different_email(client, db, google):
    make_user(db, email="someone.else@example.com", name="Someone Else")
    assert login(client, "someone.else@example.com").status_code == 200
    response = client.post("/api/auth/google/link", json={"credential": "x" * 40}, headers=csrf(client))
    assert response.status_code == 409
    assert "different email" in response.json()["detail"].lower()


def test_google_only_account_has_no_password_login_until_one_is_set(client, db, google):
    post_google(client)
    client.post("/api/auth/logout", headers=csrf(client))

    assert login(client, "gmail.user@example.com").status_code == 401

    # Signed in again with Google, the user can set a password without a current one.
    assert post_google(client).status_code == 200
    set_password = client.post(
        "/api/auth/change-password",
        json={"new_password": "a-strong-new-password-1"},
        headers=csrf(client),
    )
    assert set_password.status_code == 200, set_password.text
    client.post("/api/auth/logout", headers=csrf(client))
    assert login(client, "gmail.user@example.com", "a-strong-new-password-1").status_code == 200


def test_password_accounts_still_need_the_current_password(client, db):
    make_user(db, email="normal@example.com")
    assert login(client, "normal@example.com").status_code == 200
    response = client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong-one", "new_password": "another-strong-pass-2"},
        headers=csrf(client),
    )
    assert response.status_code == 400
