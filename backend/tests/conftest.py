"""Test fixtures.

A throwaway SQLite database, upload directory and notification outbox are
created per test session; every test starts from an empty database so metrics
cannot leak between tests. Environment variables must be set before the app
modules are imported.
"""
from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="asm-tests-"))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{TMP / 'test.db'}")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-do-not-use-in-production")
os.environ.setdefault("NOTIFICATION_CONSOLE_PROVIDER", "1")
os.environ.setdefault("NOTIFICATION_OUTBOX", str(TMP / "notifications.log"))
os.environ.setdefault("UPLOAD_DIR", str(TMP / "uploads"))
os.environ.setdefault("FRONTEND_DIST", str(TMP / "no-dist"))
os.environ.setdefault("SECURE_COOKIES", "0")
os.environ.setdefault("RAZORPAY_KEY_ID", "")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from PIL import Image  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Category, Product, ProductImage, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services import settings as store_settings  # noqa: E402
from app.services.rate_limit import reset as reset_rate_limits  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(autouse=True)
def clean_db():
    """Wipe all rows before every test and reset in-process rate limits."""
    with SessionLocal() as db:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
    reset_rate_limits()
    yield


@pytest.fixture()
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def client():
    with TestClient(app) as c:
        # Bootstrap sets the CSRF cookie that every mutation must echo.
        c.get("/api/store/bootstrap")
        yield c


def csrf(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get("asm_csrf", "")}


def make_user(db, *, email: str, password: str = "correct-horse-battery", role: str = "customer", name: str = "Test User", status: str = "active", phone: str | None = None) -> User:
    user = User(
        email=email,
        full_name=name,
        phone=phone,
        password_hash=hash_password(password),
        role=role,
        status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def login(client: TestClient, email: str, password: str = "correct-horse-battery"):
    return client.post("/api/auth/login", json={"email": email, "password": password}, headers=csrf(client))


def register(client: TestClient, email: str, password: str = "correct-horse-battery", name: str = "Test User", phone: str | None = None):
    return client.post(
        "/api/auth/register",
        json={"full_name": name, "email": email, "password": password, "phone": phone},
        headers=csrf(client),
    )


def configure_shop(db, **overrides):
    values = {
        "cod_enabled": True,
        "pickup_enabled": True,
        "delivery_enabled": True,
        "delivery_fee_paise": 4900,
        "free_delivery_threshold_paise": 0,
        "delivery_pincodes": ["144001", "144005"],
        "min_order_paise": 0,
        "cancellation_window_hours": 24,
        "return_window_days": 7,
        "marketplace_enabled": True,
        "marketplace_commission_bp": 1000,
        "returns_note": "Test policy note",
        "store_phone": "0000000000",
        "store_email": "store@example.com",
        "store_opening_hours": "10:00-18:00",
        "online_payments_enabled": False,
        "tax_enabled": False,
        "demo_mode": False,
    }
    values.update(overrides)
    store_settings.set_many(db, values)
    return values


@pytest.fixture()
def shop(db):
    return configure_shop(db)


def make_category(db, slug: str = "notebooks", name: str = "Notebooks") -> Category:
    existing = db.scalar(select(Category).where(Category.slug == slug))
    if existing:
        return existing
    category = Category(slug=slug, name=name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


def make_product(db, *, title: str = "Test Notebook", price_paise: int = 10000, stock: int = 10, category: Category | None = None, **kwargs) -> Product:
    category = category or make_category(db, slug="general", name="General")
    slug = kwargs.pop("slug", title.lower().replace(" ", "-"))
    product = Product(
        title=title,
        slug=slug,
        description=kwargs.pop("description", "A test product"),
        category_id=category.id,
        price_paise=price_paise,
        stock_qty=stock,
        status=kwargs.pop("status", "active"),
        product_type=kwargs.pop("product_type", "new"),
        condition=kwargs.pop("condition", "new"),
        sku=kwargs.pop("sku", f"SKU-{slug}"),
        **kwargs,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    db.add(ProductImage(product_id=product.id, url="/uploads/demo/test.jpg", alt_text=title, sort_order=0))
    db.commit()
    db.refresh(product)
    return product


def add_to_cart(client: TestClient, product_id: str, quantity: int = 1):
    return client.post("/api/cart/items", json={"product_id": product_id, "quantity": quantity}, headers=csrf(client))


def checkout_payload(**overrides):
    payload = {
        "fulfillment_type": "pickup",
        "payment_method": "cod",
        "customer_name": "Test Buyer",
        "customer_phone": "9876543210",
        "customer_email": "buyer@example.com",
        "customer_note": None,
    }
    payload.update(overrides)
    return payload


def address_payload(**overrides):
    payload = {
        "label": "Home",
        "full_name": "Test Buyer",
        "phone": "9876543210",
        "line1": "1 Test Street",
        "line2": None,
        "locality": "Cantt",
        "city": "Jalandhar",
        "state": "Punjab",
        "pincode": "144005",
        "is_default": True,
    }
    payload.update(overrides)
    return payload


def png_bytes(width: int = 64, height: int = 64, colour: tuple[int, int, int] = (20, 60, 110)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def set_payment_env(monkeypatch, *, key_id="rzp_test_key", key_secret="rzp_test_secret", webhook_secret="whsec_test"):
    monkeypatch.setattr(settings, "razorpay_key_id", key_id)
    monkeypatch.setattr(settings, "razorpay_key_secret", key_secret)
    monkeypatch.setattr(settings, "razorpay_webhook_secret", webhook_secret)
    return key_secret, webhook_secret
