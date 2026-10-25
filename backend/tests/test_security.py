"""Security controls: headers, CSRF, rate limiting, data exposure (criterion 19)."""
from __future__ import annotations

import io

from PIL import Image

from app.config import settings
from tests.conftest import (
    csrf,
    login,
    make_product,
    make_user,
    png_bytes,
    register,
)


def test_security_headers_present(client):
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert "content-security-policy" in response.headers
    assert "strict-transport-security" not in response.headers  # only when secure cookies enabled


def test_api_responses_are_not_cached(client):
    response = client.get("/api/store/bootstrap")
    assert response.headers["cache-control"] == "no-store"


def test_csrf_cookie_is_readable_but_session_cookie_is_httponly(db):
    from fastapi.testclient import TestClient

    from app.main import app

    make_user(db, email="cookies@example.com")
    with TestClient(app) as fresh:
        bootstrap = fresh.get("/api/store/bootstrap")
        csrf_cookie = next((c for c in bootstrap.headers.get_list("set-cookie") if c.startswith("asm_csrf")), None)
        assert csrf_cookie is not None and "httponly" not in csrf_cookie.lower()

        login_response = login(fresh, "cookies@example.com")
        cookies = login_response.headers.get_list("set-cookie")
        session_cookie = next((c for c in cookies if c.startswith("asm_session")), None)
        assert session_cookie is not None
        assert "httponly" in session_cookie.lower()
        assert "samesite=lax" in session_cookie.lower()


def test_login_rate_limit(client, db):
    make_user(db, email="target@example.com")
    limit, _window = settings.rate_limit_login
    for _ in range(limit):
        response = client.post(
            "/api/auth/login",
            json={"email": "target@example.com", "password": "wrong-password"},
            headers=csrf(client),
        )
        assert response.status_code == 401
    blocked = client.post(
        "/api/auth/login",
        json={"email": "target@example.com", "password": "correct-horse-battery"},
        headers=csrf(client),
    )
    assert blocked.status_code == 429
    assert "retry-after" in {k.lower() for k in blocked.headers}


def test_password_hash_never_leaks(client, db):
    make_user(db, email="leak@example.com")
    login(client, "leak@example.com")
    for path in ("/api/auth/me", "/api/admin/customers"):
        response = client.get(path)
        assert "argon2" not in response.text.lower()
        assert "password_hash" not in response.text.lower()


def test_unauthenticated_admin_access_is_rejected(client):
    for path in ("/api/admin/dashboard", "/api/admin/orders", "/api/admin/audit"):
        assert client.get(path).status_code == 401


def test_unknown_api_route_returns_json_404(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_upload_rejects_non_images_and_oversized_files(client, db):
    make_user(db, email="seller@example.com")
    login(client, "seller@example.com")
    text_file = client.post(
        "/api/uploads/listing-photo",
        files={"file": ("evil.html", b"<script>alert(1)</script>", "text/html")},
        headers=csrf(client),
    )
    assert text_file.status_code == 400

    fake_png = client.post(
        "/api/uploads/listing-photo",
        files={"file": ("fake.png", b"not really a png", "image/png")},
        headers=csrf(client),
    )
    assert fake_png.status_code == 400

    oversized = client.post(
        "/api/uploads/listing-photo",
        files={"file": ("big.png", png_bytes(16, 16) + b"0" * (settings.max_upload_bytes + 10), "image/png")},
        headers=csrf(client),
    )
    assert oversized.status_code == 413


def test_upload_accepts_valid_image_and_reencodes(client, db):
    make_user(db, email="seller@example.com")
    login(client, "seller@example.com")
    response = client.post(
        "/api/uploads/listing-photo",
        files={"file": ("book.jpg", png_bytes(120, 160), "image/png")},
        headers=csrf(client),
    )
    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.startswith("/uploads/listings/") and url.endswith(".jpg")
    stored = settings.upload_dir / url.replace("/uploads/", "")
    assert stored.exists()
    with Image.open(stored) as image:
        assert image.format == "JPEG"
        assert image.size == (120, 160)


def test_xss_payloads_are_stored_escaped_not_rendered(client, db, shop):
    payload = '<script>alert("xss")</script>'
    created = client.post(
        "/api/contact",
        json={"name": "Tester", "email": "x@example.com", "subject": "Hello", "message": payload},
        headers=csrf(client),
    )
    assert created.status_code == 201
    # API returns JSON (never HTML); the SPA renders text nodes, so no script executes.
    assert created.headers["content-type"].startswith("application/json")

    make_user(db, email="admin@example.com", role="admin")
    login(client, "admin@example.com")
    listed = client.get("/api/admin/messages")
    assert "script" in listed.text  # stored as inert data
    assert listed.headers["content-type"].startswith("application/json")


def test_production_mode_requires_secret_key(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    production = Settings()
    try:
        production.require_secret_key()
    except RuntimeError as exc:
        assert "SECRET_KEY" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("production must refuse to start without SECRET_KEY")


def test_duplicate_registration_does_not_reveal_password(client, db):
    assert register(client, "one@example.com", password="first-password-1").status_code == 201
    response = register(client, "one@example.com", password="second-password-2")
    assert response.status_code == 409
    assert "password" not in response.json()["detail"].lower()
