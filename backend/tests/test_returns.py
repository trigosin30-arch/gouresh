"""Cancellation, returns and refunds."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.db import now
from app.models import Order, Product, ReturnRequest
from tests.conftest import (
    add_to_cart,
    address_payload,
    checkout_payload,
    configure_shop,
    csrf,
    login,
    make_product,
    make_user,
)


def place_order(client, db, *, stock=5, price=30000, email="buyer@example.com", fulfillment="delivery"):
    make_user(db, email=email)
    login(client, email)
    product = make_product(db, price_paise=price, stock=stock)
    add_to_cart(client, product.id, 1)
    if fulfillment == "delivery":
        payload = checkout_payload(fulfillment_type="delivery", address=address_payload(pincode="144005"))
    else:
        payload = checkout_payload()
    order = client.post("/api/checkout", json=payload, headers=csrf(client)).json()["order"]
    detail = client.get(f"/api/orders/{order['id']}").json()
    return product, detail


def test_customer_can_cancel_within_configured_window(client, db, shop):
    product, order = place_order(client, db)
    assert order["can_cancel"] is True
    response = client.post(f"/api/orders/{order['id']}/cancel", json={"reason": "Ordered by mistake"}, headers=csrf(client))
    assert response.status_code == 200, response.text
    assert response.json()["order"]["status"] == "cancelled"
    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 5  # restocked
    assert db.get(Order, order["id"]).cancelled_at is not None


def test_cancellation_is_unavailable_when_no_window_configured(client, db):
    configure_shop(db, cancellation_window_hours=0)
    _product, order = place_order(client, db)
    assert order["can_cancel"] is False
    response = client.post(f"/api/orders/{order['id']}/cancel", json={"reason": "Try anyway"}, headers=csrf(client))
    assert response.status_code == 400


def test_cancellation_window_expires(client, db, shop):
    _product, order = place_order(client, db)
    row = db.get(Order, order["id"])
    row.placed_at = now() - timedelta(hours=48)
    db.commit()
    response = client.post(f"/api/orders/{order['id']}/cancel", json={"reason": "Late"}, headers=csrf(client))
    assert response.status_code == 400


def test_return_request_requires_delivery_and_admin_decision(client, db, shop):
    _product, order = place_order(client, db)
    early = client.post(
        f"/api/orders/{order['id']}/return-request",
        json={"request_type": "return", "reason": "The book arrived damaged on the cover."},
        headers=csrf(client),
    )
    assert early.status_code == 400

    make_user(db, email="admin@example.com", role="admin")
    client.post("/api/auth/logout", headers=csrf(client))
    login(client, "admin@example.com")
    for status in ("processing", "packed", "dispatched", "delivered"):
        client.post(f"/api/admin/orders/{order['id']}/status", json={"status": status}, headers=csrf(client))
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "buyer@example.com")
    created = client.post(
        f"/api/orders/{order['id']}/return-request",
        json={"request_type": "return", "reason": "The book arrived damaged on the cover."},
        headers=csrf(client),
    )
    assert created.status_code == 201, created.text
    reference = created.json()["request"]["reference"]
    assert created.json()["request"]["status"] == "requested"

    duplicate = client.post(
        f"/api/orders/{order['id']}/return-request",
        json={"request_type": "return", "reason": "Second request should be rejected."},
        headers=csrf(client),
    )
    assert duplicate.status_code == 409
    client.post("/api/auth/logout", headers=csrf(client))

    login(client, "admin@example.com")
    pending = client.get("/api/admin/returns").json()["returns"]
    return_id = pending[0]["id"]
    completed = client.post(
        f"/api/admin/returns/{return_id}",
        json={"status": "completed", "admin_note": "Refund approved", "refund_amount_paise": order["total_paise"]},
        headers=csrf(client),
    )
    assert completed.status_code == 200, completed.text

    db.expire_all()
    row = db.get(ReturnRequest, return_id)
    assert row.status == "completed"
    assert row.refund_amount_paise == order["total_paise"]
    order_row = db.get(Order, order["id"])
    assert order_row.refunded_paise == order["total_paise"]
    assert order_row.payment_status == "refunded"


def test_only_admin_can_refund(client, db, shop):
    product, order = place_order(client, db)
    make_user(db, email="staff@example.com", role="staff")
    client.post("/api/auth/logout", headers=csrf(client))
    login(client, "staff@example.com")
    response = client.post(f"/api/admin/orders/{order['id']}/refund", json={"amount_paise": 100, "note": "Nope"}, headers=csrf(client))
    assert response.status_code == 403


def test_return_window_must_be_configured(client, db):
    configure_shop(db, return_window_days=0)
    _product, order = place_order(client, db)
    assert order["can_request_return"] is False
