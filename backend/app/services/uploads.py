"""Validated, re-encoded image uploads.

Defence in depth:
* extension allow-list, declared content-type check, magic-byte verification;
* size limit enforced while reading (never trusts Content-Length alone);
* the image is decoded with Pillow and **re-encoded**, so EXIF payloads and
  embedded scripts are stripped and the stored bytes are guaranteed to be a
  real JPEG/PNG/WebP;
* files are stored under a server-generated UUID name inside a private-ish
  uploads directory and served with an explicit whitelist of extensions.
"""
from __future__ import annotations

import io
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from ..config import settings

ALLOWED = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_DIMENSION = 1600


def save_image(upload: UploadFile, subdir: str) -> str:
    """Persist one validated image and return its public URL path."""
    if upload.content_type not in ALLOWED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only JPEG, PNG or WebP images are allowed")
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported image file extension")

    raw = upload.file.read(settings.max_upload_bytes + 1)
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image exceeds the size limit")
    if len(raw) < 32:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image file is empty")

    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(raw)) as img:
            img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
            img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is not a valid image")

    target_dir = settings.upload_dir / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}.jpg"
    (target_dir / name).write_bytes(buffer.getvalue())
    return f"/uploads/{subdir}/{name}"


def delete_image(url: str) -> None:
    """Remove a previously stored upload (best effort)."""
    if not url.startswith("/uploads/"):
        return
    rel = url[len("/uploads/"):]
    path = (settings.upload_dir / rel).resolve()
    try:
        if settings.upload_dir.resolve() in path.parents:
            path.unlink(missing_ok=True)
    except OSError:
        pass
