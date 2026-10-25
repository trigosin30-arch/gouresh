"""Refunds, last-unit races and other edge cases that protect the shop."""
from __future__ import annotations

from .conftest import sign_in


ADDRESS = {
    "contact_name": "Ritika Customer",
    "phone": "9876543210",
    "line1": "Flat 3B, Lakkar Bazaar",
    "city": "Shimla",
    "state": "Himachal Pradesh",
    "pincode": "171001",
}


def _admin(client):
    return sign_in(client, "owner@ankitstationery.in", "Ankit Sharma")


def _new_product(client, admin, stock: int) -> dict:
    import uuid

    response = client.post(
        "/api/admin/products",
        headers=admin,
        json={
            "name": f"Edge Case Item {uuid.uuid4().hex[:6]}",
            "sku": f"EDGE-{uuid.uuid4().hex[:8].upper()}",
            "price_paise": 15000,
            "stock": stock,
            "tags": "edge",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["product"]


def test_last_unit_cannot_be_sold_twice(client, customer, other_customer):
    admin = _admin(client)
    product = _new_product(client, admin, stock=1)

    first = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod", "address": ADDRESS},
    )
    assert first.status_code == 201

    second = client.post(
        "/api/orders",
        headers=other_customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod", "address": ADDRESS},
    )
    assert second.status_code == 409
    assert "stock" in second.json()["detail"].lower() or "left" in second.json()["detail"].lower()

    stock = client.get(f"/api/products/{product['slug']}").json()["product"]["stock"]
    assert stock == 0


def test_paid_cancel_marks_refund_due_then_refunded(client, customer):
    admin = _admin(client)
    product = _new_product(client, admin, stock=4)

    order = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 2}], "payment_method": "razorpay", "address": ADDRESS},
    ).json()["order"]
    paid = client.post(
        f"/api/payments/simulate/{order['order_number']}", json={"outcome": "success"}, headers=customer
    ).json()["order"]
    assert paid["payment_status"] == "paid"

    cancelled = client.post(f"/api/orders/{order['order_number']}/cancel", headers=customer).json()["order"]
    assert cancelled["status"] == "cancelled"
    assert cancelled["payment_status"] == "refund_due"
    assert client.get(f"/api/products/{product['slug']}").json()["product"]["stock"] == 4

    detail = client.get(f"/api/admin/orders/{order['order_number']}", headers=admin).json()["order"]
    assert detail["allowed_transitions"] == ["refunded"]

    refunded = client.post(
        f"/api/admin/orders/{order['order_number']}/status",
        headers=admin,
        json={"status": "refunded", "note": "Refunded via UPI reversal"},
    )
    assert refunded.status_code == 200
    assert refunded.json()["order"]["payment_status"] == "refunded"


def test_unpaid_order_cannot_be_refunded(client, customer):
    admin = _admin(client)
    product = _new_product(client, admin, stock=2)
    order = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod", "address": ADDRESS},
    ).json()["order"]

    response = client.post(
        f"/api/admin/orders/{order['order_number']}/status", headers=admin, json={"status": "refunded"}
    )
    assert response.status_code in (409, 422)


def test_cannot_skip_straight_to_shipped(client, customer):
    admin = _admin(client)
    product = _new_product(client, admin, stock=2)
    order = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod", "address": ADDRESS},
    ).json()["order"]

    response = client.post(
        f"/api/admin/orders/{order['order_number']}/status", headers=admin, json={"status": "shipped"}
    )
    assert response.status_code == 409


def test_invalid_address_is_rejected(client, customer):
    product = client.get("/api/products?page_size=1").json()["items"][0]
    response = client.post(
        "/api/orders",
        headers=customer,
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payment_method": "cod",
            "address": {**ADDRESS, "phone": "12345", "pincode": "0123"},
        },
    )
    assert response.status_code == 422


def test_delivery_address_is_required_for_shipping(client, customer):
    product = client.get("/api/products?page_size=1").json()["items"][0]
    response = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod"},
    )
    assert response.status_code == 422


def test_pickup_does_not_require_address_and_has_no_shipping(client, customer):
    product = next(
        p
        for p in client.get("/api/products?page_size=60").json()["items"]
        if p["price_paise"] < 49900 and p["stock"] > 0
    )
    response = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "pickup"},
    )
    assert response.status_code == 201, response.text
    order = response.json()["order"]
    assert order["shipping_paise"] == 0
    assert order["payment_method"] == "pickup"


def test_archived_product_cannot_be_ordered(client, customer):
    admin = _admin(client)
    product = _new_product(client, admin, stock=3)
    assert client.post(f"/api/admin/products/{product['id']}/archive", headers=admin).status_code == 200

    response = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod", "address": ADDRESS},
    )
    assert response.status_code == 409


def test_renaming_a_product_keeps_its_public_url(client):
    admin = _admin(client)
    product = _new_product(client, admin, stock=2)
    original_slug = product["slug"]

    updated = client.patch(
        f"/api/admin/products/{product['id']}", headers=admin, json={"name": "Renamed edge case item"}
    )
    assert updated.status_code == 200
    assert updated.json()["product"]["slug"] == original_slug
    assert client.get(f"/api/products/{original_slug}").status_code == 200


def test_admin_status_response_carries_next_transitions(client, customer):
    admin = _admin(client)
    product = _new_product(client, admin, stock=2)
    order = client.post(
        "/api/orders",
        headers=customer,
        json={"items": [{"product_id": product["id"], "quantity": 1}], "payment_method": "cod", "address": ADDRESS},
    ).json()["order"]

    response = client.post(
        f"/api/admin/orders/{order['order_number']}/status",
        headers=admin,
        json={"status": "processing", "note": "Packing"},
    ).json()["order"]
    assert response["status"] == "processing"
    assert "packed" in response["allowed_transitions"]
    assert response["timeline"]["stage"] == "processing"
