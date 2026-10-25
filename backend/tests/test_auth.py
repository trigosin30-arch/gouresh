"""Authentication, session and privacy tests (acceptance criteria 1-3)."""
from __future__ import annotations

from sqlalchemy import select

from app.models import Order, User
from tests.conftest import (
    add_to_cart,
    checkout_payload,
    csrf,
    login,
    make_category,
    make_product,
    make_user,
    register,
)


def test_register_login_logout(client, db):
    response = register(client, "new.customer@example.com", phone="9876543210")
    assert response.status_code == 201, response.text
    assert response.json()["user"]["email"] == "new.customer@example.com"
    assert response.json()["user"]["role"] == "customer"
    # The response exposes a boolean flag, never a hash or the chosen password.
    assert "password_hash" not in response.text.lower()
    assert "$argon2" not in response.text
    assert "correct-horse-battery" not in response.text

    assert client.get("/api/auth/me").json()["user"]["email"] == "new.customer@example.com"
    assert client.post("/api/auth/logout", headers=csrf(client)).status_code == 200
    assert client.get("/api/auth/me").json()["user"] is None

    assert login(client, "new.customer@example.com").status_code == 200
    assert client.get("/api/auth/me").json()["user"]["email"] == "new.customer@example.com"


def test_weak_password_and_duplicate_email_rejected(client, db):
    weak = register(client, "weak@example.com", password="1234567890")
    assert weak.status_code == 422
    assert register(client, "dup@example.com").status_code == 201
    duplicate = register(client, "dup@example.com")
    assert duplicate.status_code == 409


def test_wrong_password_does_not_reveal_account_existence(client, db):
    make_user(db, email="known@example.com")
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever-long"}, headers=csrf(client))
    wrong = client.post("/api/auth/login", json={"email": "known@example.com", "password": "whatever-long"}, headers=csrf(client))
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_password_reset_flow_is_single_use(client, db):
    make_user(db, email="reset@example.com")
    response = client.post("/api/auth/forgot-password", json={"email": "reset@example.com"}, headers=csrf(client))
    assert response.status_code == 200
    link = response.json()["dev_reset_link"]
    token = link.split("token=")[1]

    reset = client.post("/api/auth/reset-password", json={"token": token, "password": "brand-new-password"}, headers=csrf(client))
    assert reset.status_code == 200, reset.text
    assert login(client, "reset@example.com", "brand-new-password").status_code == 200

    replay = client.post("/api/auth/reset-password", json={"token": token, "password": "another-password"}, headers=csrf(client))
    assert replay.status_code == 400


def test_unknown_email_returns_generic_reset_response(client, db):
    response = client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"}, headers=csrf(client))
    assert response.status_code == 200
    assert "dev_reset_link" not in response.json()


def test_customer_cannot_read_another_customers_order(client, db, shop):
    category = make_category(db)
    product = make_product(db, category=category, stock=5)
    make_user(db, email="owner@example.com")
    login(client, "owner@example.com")
    assert add_to_cart(client, product.id, 1).status_code == 200
    order = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client)).json()["order"]
    client.post("/api/auth/logout", headers=csrf(client))

    make_user(db, email="intruder@example.com")
    login(client, "intruder@example.com")
    assert client.get(f"/api/orders/{order['id']}").status_code == 404
    assert client.get("/api/orders").json()["total"] == 0
    assert client.get(f"/api/orders/{order['id']}/document").status_code == 404
    assert client.get(f"/api/orders/{order['id']}/document?token={order['tracking_token']}").status_code == 200


def test_customer_cannot_touch_another_customers_address(client, db):
    make_user(db, email="a@example.com")
    login(client, "a@example.com")
    created = client.post(
        "/api/auth/addresses",
        json={
            "label": "Home",
            "full_name": "A Customer",
            "phone": "9876543210",
            "line1": "1 Street",
            "locality": "Cantt",
            "city": "Jalandhar",
            "state": "Punjab",
            "pincode": "144005",
            "is_default": True,
        },
        headers=csrf(client),
    )
    assert created.status_code == 201, created.text
    address_id = created.json()["address"]["id"]
    client.post("/api/auth/logout", headers=csrf(client))

    make_user(db, email="b@example.com")
    login(client, "b@example.com")
    assert client.get("/api/auth/addresses").json()["addresses"] == []
    assert client.delete(f"/api/auth/addresses/{address_id}", headers=csrf(client)).status_code == 404


def test_pending_account_cannot_login(client, db):
    make_user(db, email="pending@example.com", status="pending")
    response = login(client, "pending@example.com")
    assert response.status_code == 403


def test_account_deletion_request_requires_staff_follow_up(client, db):
    make_user(db, email="delete-me@example.com")
    login(client, "delete-me@example.com")
    response = client.post("/api/auth/delete-request", headers=csrf(client))
    assert response.status_code == 200
    user = db.scalar(select(User).where(User.email == "delete-me@example.com"))
    assert user.status == "pending"
