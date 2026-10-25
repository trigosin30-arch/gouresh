"""End-to-end workflow guards: pickup completion, store-used stock, coupons,
and the last-administrator protection."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.models import Order, Product, User
from tests.conftest import (
    add_to_cart,
    checkout_payload,
    configure_shop,
    csrf,
    login,
    make_product,
    make_user,
)


def _admin(client, db, email: str = "admin@example.com"):
    user = make_user(db, email=email, role="admin", name="Admin")
    assert login(client, email).status_code == 200
    return user


def _place_pickup_order(client, db, **product_kwargs):
    product = make_product(db, stock=5, **product_kwargs)
    add_to_cart(client, product.id, 1)
    response = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client))
    assert response.status_code == 201, response.text
    return product, response.json()["order"]


def test_pickup_order_can_be_completed_without_dispatch(client, db, shop):
    _admin(client, db)
    _, order = _place_pickup_order(client, db)
    for status in ("processing", "packed"):
        step = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": status}, headers=csrf(client))
        assert step.status_code == 200, step.text
    response = client.post(
        f"/api/admin/orders/{order['id']}/status",
        json={"status": "delivered", "note": "Collected at the counter"},
        headers=csrf(client),
    )
    assert response.status_code == 200, response.text
    payload = response.json()["order"]
    assert payload["status"] == "delivered"
    assert payload["payment_status"] == "paid"  # cash collected on handover
    assert payload["delivered_at"]


def test_used_store_stock_can_be_added_to_cart_and_ordered(client, db, shop):
    product = make_product(db, title="Second-hand Atlas", product_type="used", condition="good", stock=3)
    response = add_to_cart(client, product.id, 1)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["product_id"] == product.id
    order = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client))
    assert order.status_code == 201, order.text
    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 2
    assert db.get(Order, order.json()["order"]["id"]).order_type == "store"


def test_invalid_coupon_blocks_checkout_and_valid_coupon_discounts(client, db, shop):
    make_user(db, email="admin@example.com", role="admin")
    assert login(client, "admin@example.com").status_code == 200
    created = client.post(
        "/api/admin/coupons",
        json={
            "code": "SAVE10",
            "description": "Ten percent",
            "discount_type": "percent",
            "value": 10,
            "max_discount_paise": 500,
            "min_order_paise": 0,
            "per_user_limit": 1,
            "is_active": True,
        },
        headers=csrf(client),
    )
    assert created.status_code == 201, created.text
    assert client.post("/api/auth/logout", headers=csrf(client)).status_code == 200

    product = make_product(db, price_paise=10000, stock=5)
    add_to_cart(client, product.id, 1)
    rejected = client.post("/api/checkout", json=checkout_payload(coupon_code="NOT-REAL"), headers=csrf(client))
    assert rejected.status_code == 400
    assert "Coupon" in rejected.json()["detail"]

    priced = client.get("/api/cart?coupon=SAVE10").json()
    assert priced["coupon"]["code"] == "SAVE10"
    assert priced["discount_paise"] == 500  # capped by max_discount_paise

    accepted = client.post("/api/checkout", json=checkout_payload(coupon_code="SAVE10"), headers=csrf(client))
    assert accepted.status_code == 201, accepted.text
    order = accepted.json()["order"]
    assert order["discount_paise"] == 500
    assert order["total_paise"] == order["subtotal_paise"] - 500


def test_restricting_a_staff_account_revokes_access_immediately(client, db, shop):
    _admin(client, db)
    staff = make_user(db, email="staff@example.com", role="staff", name="Staff")
    with TestClient(app) as staff_client:
        staff_client.get("/api/store/bootstrap")
        assert login(staff_client, "staff@example.com").status_code == 200
        assert staff_client.get("/api/admin/dashboard").status_code == 200

        restricted = client.post(
            f"/api/admin/customers/{staff.id}/status",
            json={"status": "restricted", "reason": "Left the job"},
            headers=csrf(client),
        )
        assert restricted.status_code == 200, restricted.text
        # The staff member's existing session is revoked, so the next request fails.
        assert staff_client.get("/api/admin/dashboard").status_code == 401
        # A restricted account cannot sign in again at all, staff or not.
        relogin = login(staff_client, "staff@example.com")
        assert relogin.status_code == 403
        assert "restricted" in relogin.json()["detail"].lower()
        assert staff_client.get("/api/admin/dashboard").status_code == 401


def test_restricting_a_customer_stops_orders_and_discards_their_cart(client, db, shop):
    """A restricted customer must not be able to finish a checkout, even as a guest."""
    _admin(client, db)
    customer = make_user(db, email="buyer@example.com", name="Buyer")
    product = make_product(db, stock=5)

    with TestClient(app) as buyer:
        buyer.get("/api/store/bootstrap")
        assert login(buyer, "buyer@example.com").status_code == 200
        added = buyer.post("/api/cart/items", json={"product_id": product.id, "quantity": 1}, headers=csrf(buyer))
        assert added.status_code == 200, added.text

        restricted = client.post(
            f"/api/admin/customers/{customer.id}/status",
            json={"status": "restricted", "reason": "Chargebacks"},
            headers=csrf(client),
        )
        assert restricted.status_code == 200, restricted.text
        assert restricted.json()["customer"]["status"] == "restricted"

        # The session is revoked, and the abandoned cart is gone with it, so the
        # checkout cannot be replayed as a guest order.
        assert buyer.get("/api/cart").json()["items"] == []
        attempt = buyer.post(
            "/api/checkout",
            json={
                "fulfillment_type": "pickup",
                "payment_method": "cod",
                "customer_name": "Buyer",
                "customer_phone": "9876500100",
                "customer_email": "buyer@example.com",
            },
            headers=csrf(buyer),
        )
        assert attempt.status_code == 400, attempt.text
        assert "empty" in attempt.text.lower()

        # Signing in again is refused while restricted.
        blocked = login(buyer, "buyer@example.com")
        assert blocked.status_code == 403
        assert "restricted" in blocked.json()["detail"].lower()

    # Reactivating the account restores normal access.
    assert client.post(
        f"/api/admin/customers/{customer.id}/status",
        json={"status": "active"},
        headers=csrf(client),
    ).status_code == 200
    assert login(client, "buyer@example.com").status_code == 200


def test_administrators_cannot_restrict_or_demote_themselves(client, db, shop):
    admin = _admin(client, db)
    assert client.post(f"/api/admin/customers/{admin.id}/role", json={"role": "customer"}, headers=csrf(client)).status_code == 400
    assert client.post(f"/api/admin/customers/{admin.id}/status", json={"status": "restricted"}, headers=csrf(client)).status_code == 400

    other = make_user(db, email="second@example.com", role="admin", name="Second Admin")
    assert client.post(f"/api/admin/customers/{other.id}/role", json={"role": "customer"}, headers=csrf(client)).status_code == 200


def test_only_staff_can_adjust_stock_but_admin_required_to_edit_product(client, db, shop):
    product = make_product(db, stock=2)
    make_user(db, email="staff@example.com", role="staff", name="Staff")
    login(client, "staff@example.com")
    adjust = client.post(f"/api/admin/products/{product.id}/stock", json={"delta": 4, "note": "delivery"}, headers=csrf(client))
    assert adjust.status_code == 200, adjust.text
    assert adjust.json()["product"]["stock_qty"] == 6

    edit = client.put(
        f"/api/admin/products/{product.id}",
        json={
            "title": "Renamed",
            "category_id": product.category_id,
            "price_paise": 12000,
            "stock_qty": 6,
            "status": "active",
            "product_type": "new",
            "condition": "new",
            "tax_rate_bp": 0,
            "low_stock_threshold": 2,
            "is_featured": False,
            "is_enquiry_only": False,
            "image_urls": [],
        },
        headers=csrf(client),
    )
    assert edit.status_code == 403  # product edits require an administrator
