from __future__ import annotations

import os
import pathlib
import sys
import tempfile

TMP_DB = pathlib.Path(tempfile.mkdtemp(prefix="asm-test-")) / "test.db"
os.environ.update(
    {
        "DATABASE_URL": f"sqlite:///{TMP_DB}",
        "DEV_AUTH": "true",
        "PAYMENTS_MOCK": "true",
        "SEED_ON_STARTUP": "true",
        "ENVIRONMENT": "test",
        "RAZORPAY_KEY_ID": "",
        "RAZORPAY_KEY_SECRET": "",
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
    }
)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def sign_in(client: TestClient, email: str, name: str = "Test Shopper") -> dict:
    response = client.post("/api/auth/demo-login", json={"email": email, "full_name": name})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def customer(client):
    return sign_in(client, "customer@example.com", "Ritika Customer")


@pytest.fixture
def other_customer(client):
    return sign_in(client, "other@example.com", "Someone Else")


@pytest.fixture
def admin(client):
    headers = sign_in(client, "owner@ankitstationery.in", "Ankit Sharma")
    me = client.get("/api/me", headers=headers).json()["profile"]
    assert me["role"] == "admin"
    return headers


@pytest.fixture
def product(client):
    items = client.get("/api/products?page_size=50").json()["items"]
    return next(p for p in items if p["stock"] > 3)
