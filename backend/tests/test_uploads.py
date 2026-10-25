"""Image upload validation (criteria: real users can add photos, but only images)."""
from __future__ import annotations

import io

from PIL import Image

from tests.conftest import csrf, login, make_user, png_bytes


def _file(data: bytes | None = None, name: str = "photo.png", content_type: str = "image/png"):
    return {"file": (name, io.BytesIO(data if data is not None else png_bytes()), content_type)}


def test_png_upload_is_accepted_and_reencoded(client):
    response = client.post("/api/uploads/submission-photo", files=_file(), headers=csrf(client))
    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.startswith("/uploads/submissions/")
    # The server always stores a normalised JPEG, whatever the input format.
    assert url.endswith(".jpg")


def test_upload_rejects_non_image_content(client):
    response = client.post(
        "/api/uploads/submission-photo",
        files=_file(b"<html><script>alert(1)</script></html>", "evil.png", "image/png"),
        headers=csrf(client),
    )
    assert response.status_code == 400
    assert "valid image" in response.json()["detail"]


def test_upload_rejects_disallowed_extension(client):
    response = client.post("/api/uploads/submission-photo", files=_file(name="payload.svg", content_type="image/png"), headers=csrf(client))
    assert response.status_code == 400


def test_upload_rejects_disallowed_content_type(client):
    response = client.post("/api/uploads/submission-photo", files=_file(name="photo.png", content_type="image/gif"), headers=csrf(client))
    assert response.status_code == 400


def test_upload_rejects_oversized_file(client, monkeypatch):
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "max_upload_bytes", 1024)
    response = client.post("/api/uploads/submission-photo", files=_file(b"x" * 4096), headers=csrf(client))
    assert response.status_code == 413


def test_product_photo_requires_staff(client, db):
    assert client.post("/api/uploads/product-photo", files=_file(), headers=csrf(client)).status_code == 401
    make_user(db, email="customer@example.com")
    login(client, "customer@example.com")
    assert client.post("/api/uploads/product-photo", files=_file(), headers=csrf(client)).status_code == 403

    make_user(db, email="staff@example.com", role="staff")
    login(client, "staff@example.com")
    response = client.post("/api/uploads/product-photo", files=_file(), headers=csrf(client))
    assert response.status_code == 200
    assert response.json()["url"].startswith("/uploads/products/")


def test_listing_photo_requires_login_but_submission_photo_does_not(client):
    assert client.post("/api/uploads/listing-photo", files=_file(), headers=csrf(client)).status_code == 401
    assert client.post("/api/uploads/submission-photo", files=_file(), headers=csrf(client)).status_code == 200


def test_stored_upload_is_served_from_uploads_path(client):
    url = client.post("/api/uploads/submission-photo", files=_file(), headers=csrf(client)).json()["url"]
    served = client.get(url)
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/jpeg"
    # Re-encoding strips EXIF: the stored image is still a decodable JPEG.
    Image.open(io.BytesIO(served.content)).verify()


def test_upload_directory_traversal_is_blocked(client):
    response = client.get("/uploads/%2e%2e/%2e%2e/app/config.py")
    assert response.status_code == 404
