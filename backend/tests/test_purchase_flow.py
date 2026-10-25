"""End-to-end tests for the core promise: correct orders, correct money,
correct stock, and no double-processing of payments."""
from __future__ import annotations

import hmac
import hashlib
import json


ADDRESS = {
    "contact_name": "Ritika Customer",
    "phone": "98765 43210",
    "line1": "Flat 3B, Lakkar Bazaar",
    "locality": "Lakkar Bazaar",
    "city": "Shimla",
    "state": "Himachal Pradesh",
    "pincode": "171001",
}


def place_order(client, headers, product, quantity=2, method="razorpay", coupon=None):
    payload = {
        "items": [{"product_id": product["id"], "quantity": quantity}],
        "payment_method": method,
        "address": ADDRESS,
    }
    if coupon:
        payload["coupon_code"] = coupon
    return client.post("/api/orders", json=payload, headers=headers)


# ---------------------------------------------------------------------------
# catalogue
# ---------------------------------------------------------------------------
def test_catalog_search_and_filters(client):
    assert client.get("/api/products").json()["total"] >= 20
    by_isbn = client.get("/api/products", params={"q": "9788195001011"}).json()
    assert by_isbn["total"] == 1
    cheap = client.get("/api/products", params={"max_price": 100, "sort": "price_asc"}).json()
    assert all(p["price_paise"] <= 10000 for p in cheap["items"])
    assert client.get("/api/products", params={"condition": "used"}).json()["total"] == 0


def test_cart_quote_is_server_priced(client, product):
    quote = client.post("/api/cart/quote", json=[{"product_id": product["id"], "quantity": 3}]).json()
    assert quote["subtotal_paise"] == product["price_paise"] * 3
    assert quote["total_paise"] == quote["subtotal_paise"] + quote["shipping_paise"] - quote["discount_paise"]


def test_health_and_config_expose_no_secrets(client):
    config = client.get("/api/config").json()
    assert config["payments"]["mode"] == "mock"
    assert config["payments"]["razorpay_key_id"] == ""
    assert "razorpay_key_secret" not in json.dumps(config)


# ---------------------------------------------------------------------------
# auth & authorisation
# ---------------------------------------------------------------------------
def test_customer_cannot_touch_admin_endpoints(client, customer):
    for path in ("/api/admin/stats", "/api/admin/orders", "/api/admin/products", "/api/admin/audit-logs"):
        assert client.get(path, headers=customer).status_code == 403


def test_anonymous_cannot_read_orders(client):
    assert client.get("/api/orders").status_code == 401
    assert client.get("/api/me").status_code == 401


def test_cannot_read_another_customers_order(client, customer, other_customer, product):
    order = place_order(client, customer, product, 1, "cod").json()["order"]
    assert client.get(f"/api/orders/{order['id']}", headers=other_customer).status_code == 404
    assert client.get(f"/api/orders/{order['id']}", headers=customer).status_code == 200


def test_invalid_token_rejected(client):
    assert client.get("/api/me", headers={"Authorization": "Bearer not-a-token"}).status_code == 401


# ---------------------------------------------------------------------------
# ordering and stock
# ---------------------------------------------------------------------------
def test_cod_order_confirms_and_decrements_stock(client, customer, product):
    before = client.get(f"/api/products/{product['slug']}").json()["product"]["stock"]
    response = place_order(client, customer, product, 2, "cod")
    assert response.status_code == 201, response.text
    order = response.json()["order"]
    assert order["status"] == "confirmed"
    assert order["payment_status"] == "unpaid"
    assert order["items"][0]["quantity"] == 2
    assert order["subtotal_paise"] == product["price_paise"] * 2

    after = client.get(f"/api/products/{product['slug']}").json()["product"]["stock"]
    assert after == before - 2


def test_price_tampering_is_ignored(client, customer, product):
    """The client cannot send a price; totals always come from the database."""
    response = client.post(
        "/api/orders",
        headers=customer,
        json={
            "items": [{"product_id": product["id"], "quantity": 1, "unit_price_paise": 1}],
            "payment_method": "cod",
            "address": ADDRESS,
        },
    )
    assert response.status_code == 201
    assert response.json()["order"]["subtotal_paise"] == product["price_paise"]


def test_out_of_stock_cannot_be_ordered(client, customer):
    items = client.get("/api/products?page_size=60").json()["items"]
    sold_out = next(p for p in items if p["stock"] == 0)
    response = place_order(client, customer, sold_out, 1, "cod")
    assert response.status_code == 409


def test_quantity_limit_enforced(client, customer, product):
    response = place_order(client, customer, product, 45, "cod")
    assert response.status_code in (409, 422)


def test_coupon_applies_discount_and_rejects_small_carts(client, customer, product):
    too_small = place_order(client, customer, product, 1, "cod", coupon="SHIMLA50")
    assert too_small.status_code == 400

    order = place_order(client, customer, product, 4, "cod", coupon="ASM10").json()["order"]
    assert order["discount_paise"] == order["subtotal_paise"] * 10 // 100
    assert order["coupon_code"] == "ASM10"


def test_shipping_free_above_threshold(client, customer):
    items = client.get("/api/products?page_size=60").json()["items"]
    cheap = next(p for p in items if 0 < p["price_paise"] < 49900 and p["stock"] > 1)
    order = place_order(client, customer, cheap, 1, "cod").json()["order"]
    assert order["shipping_paise"] > 0
    big = next(p for p in items if p["price_paise"] >= 49900 and p["stock"] > 0)
    order2 = place_order(client, customer, big, 1, "cod").json()["order"]
    assert order2["shipping_paise"] == 0


# ---------------------------------------------------------------------------
# payments
# ---------------------------------------------------------------------------
def test_razorpay_success_path_verifies_signature(client, customer, product):
    body = place_order(client, customer, product, 1, "razorpay").json()
    order = body["order"]
    session = body["payment_session"]
    assert order["payment_status"] == "pending"
    assert session["provider_order_id"].startswith("order_")

    simulated = client.post(
        f"/api/payments/simulate/{order['order_number']}", json={"outcome": "success"}, headers=customer
    )
    assert simulated.status_code == 200, simulated.text
    paid = simulated.json()["order"]
    assert paid["payment_status"] == "paid"
    assert paid["status"] == "confirmed"
    assert paid["payments"][0]["signature_verified"] is True


def test_forged_signature_does_not_mark_order_paid(client, customer, product):
    body = place_order(client, customer, product, 1, "razorpay").json()
    order = body["order"]
    provider_order_id = body["payment_session"]["provider_order_id"]

    bad = client.post(
        "/api/payments/verify",
        headers=customer,
        json={
            "razorpay_order_id": provider_order_id,
            "razorpay_payment_id": "pay_forged_123",
            "razorpay_signature": "deadbeef",
        },
    )
    assert bad.status_code == 400
    refreshed = client.get(f"/api/orders/{order['id']}", headers=customer).json()["order"]
    assert refreshed["payment_status"] != "paid"


def test_another_customer_cannot_verify_someone_elses_payment(client, customer, other_customer, product):
    body = place_order(client, customer, product, 1, "razorpay").json()
    provider_order_id = body["payment_session"]["provider_order_id"]
    response = client.post(
        "/api/payments/verify",
        headers=other_customer,
        json={
            "razorpay_order_id": provider_order_id,
            "razorpay_payment_id": "pay_x",
            "razorpay_signature": "whatever",
        },
    )
    assert response.status_code == 404


def test_payment_failure_releases_stock(client, customer, product):
    before = client.get(f"/api/products/{product['slug']}").json()["product"]["stock"]
    order = place_order(client, customer, product, 2, "razorpay").json()["order"]
    assert client.get(f"/api/products/{product['slug']}").json()["product"]["stock"] == before - 2

    failed = client.post(
        f"/api/payments/simulate/{order['order_number']}", json={"outcome": "failure"}, headers=customer
    ).json()["order"]
    assert failed["payment_status"] == "failed"
    assert failed["status"] == "payment_failed"
    assert client.get(f"/api/products/{product['slug']}").json()["product"]["stock"] == before


def test_webhook_is_idempotent_and_confirms_order(client, customer, product):
    order = place_order(client, customer, product, 1, "razorpay").json()["order"]
    result = client.post(f"/api/payments/demo-webhook/{order['order_number']}", headers=customer).json()
    assert result["first_delivery"]["status"] in ("processed", "ignored")
    assert result["second_delivery"]["status"] == "duplicate"
    assert result["order"]["payment_status"] == "paid"

    events = client.get("/api/admin/payment-events", headers=_admin(client)).json()["items"]
    matching = [e for e in events if e["event_id"].startswith("evt_demo_")]
    assert matching and matching[0]["processed"] is True


def test_webhook_signature_is_required(client, product):
    response = client.post(
        "/api/webhooks/razorpay",
        content=b'{"id":"evt_1","event":"payment.captured"}',
        headers={"X-Razorpay-Signature": "nope", "Content-Type": "application/json"},
    )
    assert response.status_code == 400

    body = b'{"id":"evt_unsigned_test","event":"payment.captured","payload":{}}'
    secret = "asm_mock_razorpay_secret"
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    ok = client.post(
        "/api/webhooks/razorpay",
        content=body,
        headers={"X-Razorpay-Signature": signature, "Content-Type": "application/json"},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] in ("ignored", "processed")


def _admin(client):
    from .conftest import sign_in

    return sign_in(client, "owner@ankitstationery.in", "Ankit Sharma")


# ---------------------------------------------------------------------------
# fulfilment & tracking
# ---------------------------------------------------------------------------
def test_tracking_flow_and_cancel_restock(client, customer, product):
    admin = _admin(client)
    before = client.get(f"/api/products/{product['slug']}").json()["product"]["stock"]
    order = place_order(client, customer, product, 2, "cod").json()["order"]

    steps = ["processing", "packed", "shipped", "out_for_delivery", "delivered"]
    for step in steps:
        response = client.post(
            f"/api/admin/orders/{order['id']}/status",
            headers=admin,
            json={"status": step, "note": f"Moved to {step}", "courier": "India Post",
                  "tracking_number": "IP123456789IN"},
        )
        assert response.status_code == 200, response.text

    detail = client.get(f"/api/orders/{order['id']}", headers=customer).json()["order"]
    assert detail["status"] == "delivered"
    assert detail["tracking_number"] == "IP123456789IN"
    statuses = [e["status"] for e in detail["events"]]
    assert statuses[0] == "confirmed" and statuses[-1] == "delivered"

    # A delivered order cannot be cancelled by the customer.
    assert client.post(f"/api/orders/{order['id']}/cancel", headers=customer).status_code == 409


def test_customer_cancel_restocks_once(client, customer, product):
    before = client.get(f"/api/products/{product['slug']}").json()["product"]["stock"]
    order = place_order(client, customer, product, 1, "cod").json()["order"]
    first = client.post(f"/api/orders/{order['id']}/cancel", headers=customer)
    assert first.status_code == 200
    assert client.get(f"/api/products/{product['slug']}").json()["product"]["stock"] == before
    # cancelling twice must not restock twice
    client.post(f"/api/orders/{order['id']}/cancel", headers=customer)
    assert client.get(f"/api/products/{product['slug']}").json()["product"]["stock"] == before


def test_invalid_status_transition_rejected(client, customer, product):
    admin = _admin(client)
    order = place_order(client, customer, product, 1, "cod").json()["order"]
    response = client.post(
        f"/api/admin/orders/{order['id']}/status", headers=admin, json={"status": "delivered"}
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# admin
# ---------------------------------------------------------------------------
def test_admin_can_manage_products_and_stock(client, admin):
    created = client.post(
        "/api/admin/products",
        headers=admin,
        json={
            "name": "Geometry Box Deluxe",
            "sku": "ASM-TEST-9001",
            "price_paise": 21000,
            "mrp_paise": 25000,
            "stock": 5,
            "category_id": None,
            "tags": "geometry,box",
            "condition": "new",
        },
    )
    assert created.status_code == 201, created.text
    product = created.json()["product"]
    assert client.get(f"/api/products/{product['slug']}").status_code == 200

    adjusted = client.post(
        f"/api/admin/products/{product['id']}/stock", headers=admin, json={"delta": -3, "note": "Counter sale"}
    ).json()["product"]
    assert adjusted["stock"] == 2
    assert client.post(
        f"/api/admin/products/{product['id']}/stock", headers=admin, json={"delta": -10}
    ).status_code == 409

    archived = client.post(f"/api/admin/products/{product['id']}/archive", headers=admin)
    assert archived.status_code == 200
    assert client.get(f"/api/products/{product['slug']}").status_code == 404

    movements = client.get(f"/api/admin/products/{product['id']}/movements", headers=admin).json()["items"]
    assert len(movements) >= 2

    logs = client.get("/api/admin/audit-logs", headers=admin).json()["items"]
    assert any(log["action"] == "product.create" for log in logs)


def test_invalid_product_payload_rejected(client, admin):
    response = client.post(
        "/api/admin/products", headers=admin, json={"name": "X", "sku": "A", "price_paise": 0}
    )
    assert response.status_code == 422


def test_admin_dashboard(client, admin):
    stats = client.get("/api/admin/stats", headers=admin).json()
    assert stats["totals"]["orders"] >= 1
    assert stats["totals"]["revenue_paise"] >= 0
    assert isinstance(stats["orders_by_status"], dict)


def test_customer_profile_and_addresses(client, customer):
    updated = client.patch("/api/me", headers=customer, json={"full_name": "Ritika S.", "phone": "9816012345"})
    assert updated.json()["profile"]["phone"] == "9816012345"

    bad_phone = client.patch("/api/me", headers=customer, json={"phone": "12345"})
    assert bad_phone.status_code == 422

    created = client.post("/api/me/addresses", headers=customer, json=ADDRESS)
    assert created.status_code == 201
    address = created.json()["address"]
    assert address["is_default"] is True

    assert client.delete(f"/api/me/addresses/{address['id']}", headers=customer).status_code == 204


def test_role_management_requires_admin(client, customer):
    me = client.get("/api/me", headers=customer).json()["profile"]
    assert client.patch(
        f"/api/admin/users/{me['id']}/role", headers=customer, json={"role": "admin"}
    ).status_code == 403


def test_order_history_survives_new_session(client, customer):
    order = place_order(client, customer, client.get("/api/products?page_size=1").json()["items"][0], 1, "cod")
    assert order.status_code == 201
    number = order.json()["order"]["order_number"]
    fresh = _login_again(client, "customer@example.com")
    history = client.get("/api/orders", headers=fresh).json()["items"]
    assert any(o["order_number"] == number for o in history)


def _login_again(client, email):
    from .conftest import sign_in

    return sign_in(client, email, "Ritika Customer")
