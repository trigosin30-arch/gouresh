"""Admin authorization, catalogue management, orders and metrics (criteria 3, 9, 12, 15)."""
from __future__ import annotations

from sqlalchemy import select

from app.models import AuditLog, Order, Product, User
from tests.conftest import (
    add_to_cart,
    address_payload,
    checkout_payload,
    configure_shop,
    csrf,
    login,
    make_category,
    make_product,
    make_user,
)


def admin_login(client, db):
    make_user(db, email="admin@example.com", role="admin", name="Admin")
    assert login(client, "admin@example.com").status_code == 200


def delivery_checkout(client):
    return checkout_payload(fulfillment_type="delivery", address=address_payload(pincode="144005"))


def staff_login(client, db):
    make_user(db, email="staff@example.com", role="staff", name="Staff")
    assert login(client, "staff@example.com").status_code == 200


def test_admin_endpoints_require_authentication_and_role(client, db):
    make_product(db)
    assert client.get("/api/admin/dashboard").status_code == 401
    make_user(db, email="customer@example.com")
    login(client, "customer@example.com")
    for path in ("/api/admin/dashboard", "/api/admin/orders", "/api/admin/products", "/api/admin/customers", "/api/admin/settings"):
        assert client.get(path).status_code == 403, path
    # Mutating admin endpoints are independently protected
    assert client.post("/api/admin/products", json={}, headers=csrf(client)).status_code == 403


def test_dashboard_shows_real_zeros_on_empty_database(client, db):
    admin_login(client, db)
    payload = client.get("/api/admin/dashboard").json()
    assert payload["metrics"]["orders_count"] == 0
    assert payload["metrics"]["net_revenue_paise"] == 0
    assert payload["metrics"]["gross_paid_paise"] == 0
    assert payload["orders"]["total"] == 0
    assert payload["catalogue"]["active_products"] == 0
    assert payload["recent_orders"] == []
    assert payload["setup"]["online_payments_configured"] is False


def test_product_crud_and_duplicate_sku(client, db):
    admin_login(client, db)
    category = make_category(db)
    payload = {
        "title": "Geometry Box Deluxe",
        "description": "Test item",
        "category_id": category.id,
        "sku": "GEO-1",
        "price_paise": 24500,
        "stock_qty": 7,
        "status": "active",
        "image_urls": [],
    }
    created = client.post("/api/admin/products", json=payload, headers=csrf(client))
    assert created.status_code == 201, created.text
    product_id = created.json()["product"]["id"]

    duplicate = client.post("/api/admin/products", json=payload, headers=csrf(client))
    assert duplicate.status_code == 409

    updated = client.put(
        f"/api/admin/products/{product_id}",
        json={**payload, "price_paise": 26500, "compare_at_price_paise": 30000},
        headers=csrf(client),
    )
    assert updated.status_code == 200
    assert updated.json()["product"]["price_paise"] == 26500
    assert updated.json()["product"]["discount_percent"] == 12

    invalid = client.put(
        f"/api/admin/products/{product_id}",
        json={**payload, "compare_at_price_paise": 100},
        headers=csrf(client),
    )
    assert invalid.status_code == 400


def test_stock_adjustments_cannot_go_negative(client, db):
    admin_login(client, db)
    product = make_product(db, stock=2)
    negative = client.post(f"/api/admin/products/{product.id}/stock", json={"delta": -5}, headers=csrf(client))
    assert negative.status_code == 409
    positive = client.post(f"/api/admin/products/{product.id}/stock", json={"delta": 5, "note": "Delivery"}, headers=csrf(client))
    assert positive.status_code == 200
    assert positive.json()["product"]["stock_qty"] == 7
    detail = client.get(f"/api/admin/products/{product.id}").json()["product"]
    assert len(detail["inventory_movements"]) >= 1


def test_product_with_orders_is_archived_not_deleted(client, db, shop):
    admin_login(client, db)
    product = make_product(db, stock=5)
    add_to_cart(client, product.id, 1)
    assert client.post("/api/checkout", json=checkout_payload(), headers=csrf(client)).status_code == 201
    response = client.delete(f"/api/admin/products/{product.id}", headers=csrf(client))
    assert response.status_code == 200
    assert response.json()["archived"] is True
    db.expire_all()
    assert db.get(Product, product.id).status == "archived"


def test_order_state_machine_and_cod_collection(client, db, shop):
    admin_login(client, db)
    product = make_product(db, stock=5)
    add_to_cart(client, product.id, 1)
    order = client.post("/api/checkout", json=delivery_checkout(client), headers=csrf(client)).json()["order"]

    illegal = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "delivered"}, headers=csrf(client))
    assert illegal.status_code == 409

    for status in ("processing", "packed"):
        step = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": status}, headers=csrf(client))
        assert step.status_code == 200, step.text

    dispatch = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "dispatched"}, headers=csrf(client))
    assert dispatch.status_code == 200
    delivered = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "delivered"}, headers=csrf(client))
    assert delivered.status_code == 200
    payload = delivered.json()["order"]
    assert payload["payment_status"] == "paid"  # COD collected on delivery
    assert payload["status"] == "delivered"
    assert payload["delivered_at"]

    back = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "processing"}, headers=csrf(client))
    assert back.status_code == 409


def test_pickup_orders_cannot_be_dispatched(client, db, shop):
    admin_login(client, db)
    product = make_product(db, stock=5)
    add_to_cart(client, product.id, 1)
    order = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client)).json()["order"]
    client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "processing"}, headers=csrf(client))
    client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "packed"}, headers=csrf(client))
    response = client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "dispatched"}, headers=csrf(client))
    assert response.status_code == 400


def test_cancelled_and_unpaid_orders_are_excluded_from_revenue(client, db, shop):
    admin_login(client, db)
    product = make_product(db, price_paise=50000, stock=10)
    add_to_cart(client, product.id, 1)
    first = client.post("/api/checkout", json=delivery_checkout(client), headers=csrf(client)).json()["order"]
    add_to_cart(client, product.id, 1)
    second = client.post("/api/checkout", json=delivery_checkout(client), headers=csrf(client)).json()["order"]

    # Deliver one order so COD is collected
    for status in ("processing", "packed", "dispatched", "delivered"):
        client.post(f"/api/admin/orders/{first['id']}/status", json={"status": status}, headers=csrf(client))
    # Cancel the other
    cancel = client.post(f"/api/admin/orders/{second['id']}/cancel", json={"note": "Customer changed mind"}, headers=csrf(client))
    assert cancel.status_code == 200

    metrics = client.get("/api/admin/dashboard?range=all").json()["metrics"]
    expected = 50000 + 4900  # item price plus configured delivery fee
    assert metrics["gross_paid_paise"] == expected
    assert metrics["orders_count"] == 1  # cancelled order excluded
    assert metrics["net_revenue_paise"] == expected


def test_refund_updates_metrics_and_cannot_exceed_total(client, db, shop):
    admin_login(client, db)
    product = make_product(db, price_paise=40000, stock=5)
    add_to_cart(client, product.id, 1)
    order = client.post("/api/checkout", json=delivery_checkout(client), headers=csrf(client)).json()["order"]
    for status in ("processing", "packed", "dispatched", "delivered"):
        client.post(f"/api/admin/orders/{order['id']}/status", json={"status": status}, headers=csrf(client))

    too_much = client.post(f"/api/admin/orders/{order['id']}/refund", json={"amount_paise": 9999999, "note": "Too much"}, headers=csrf(client))
    assert too_much.status_code == 400

    refund = client.post(f"/api/admin/orders/{order['id']}/refund", json={"amount_paise": 15000, "note": "Damaged copy"}, headers=csrf(client))
    assert refund.status_code == 200
    assert refund.json()["order"]["payment_status"] == "partially_refunded"

    metrics = client.get("/api/admin/dashboard?range=all").json()["metrics"]
    total = 40000 + 4900
    assert metrics["gross_paid_paise"] == total
    assert metrics["refunds_paise"] == 15000
    assert metrics["net_revenue_paise"] == total - 15000


def test_settings_validation_and_audit_trail(client, db):
    admin_login(client, db)
    good = client.put("/api/admin/settings", json={"values": {"store_phone": "0181-0000000", "cod_enabled": True}}, headers=csrf(client))
    assert good.status_code == 200
    assert good.json()["settings"]["cod_enabled"] is True

    unknown = client.put("/api/admin/settings", json={"values": {"evil_setting": "x"}}, headers=csrf(client))
    assert unknown.status_code == 400
    wrong_type = client.put("/api/admin/settings", json={"values": {"cod_enabled": "yes"}}, headers=csrf(client))
    assert wrong_type.status_code == 400

    entries = client.get("/api/admin/audit").json()["entries"]
    assert any(e["action"] == "settings.updated" for e in entries)


def test_admin_product_import_dry_run_then_commit(client, db):
    admin_login(client, db)
    category = make_category(db, slug="textbooks", name="Textbooks")
    csv_body = (
        "title,category,price_rupees,stock,status,board,class_level,subject\n"
        "Imported Maths Book,textbooks,399,12,active,CBSE,7,Mathematics\n"
        "Bad Row,missing-category,100,1,active,CBSE,7,Science\n"
    )
    dry = client.post(
        "/api/admin/products/import?dry_run=true",
        files={"file": ("products.csv", csv_body.encode(), "text/csv")},
        headers=csrf(client),
    )
    assert dry.status_code == 200, dry.text
    assert dry.json()["created"] == 1 and dry.json()["updated"] == 0
    assert len(dry.json()["errors"]) == 1
    assert client.get("/api/admin/products").json()["total"] == 0

    commit = client.post(
        "/api/admin/products/import?dry_run=false",
        files={"file": ("products.csv", csv_body.encode(), "text/csv")},
        headers=csrf(client),
    )
    assert commit.status_code == 200
    assert commit.json()["committed"] is True
    listing = client.get("/api/admin/products").json()["items"]
    assert listing[0]["title"] == "Imported Maths Book"

    export = client.get("/api/admin/products/export")
    assert export.status_code == 200
    assert "Imported Maths Book" in export.text
    assert export.headers["content-type"].startswith("text/csv")


def test_customer_restriction_blocks_login_and_checkout(client, db, shop):
    admin_login(client, db)
    product = make_product(db, stock=5)
    customer = make_user(db, email="restricted@example.com")
    response = client.post(f"/api/admin/customers/{customer.id}/status", json={"status": "restricted", "reason": "Chargeback risk"}, headers=csrf(client))
    assert response.status_code == 200
    client.post("/api/auth/logout", headers=csrf(client))

    # A restricted account cannot sign in, so it cannot reach checkout either.
    blocked_login = login(client, "restricted@example.com")
    assert blocked_login.status_code == 403
    assert "restricted" in blocked_login.json()["detail"].lower()
    assert client.post("/api/checkout", json=checkout_payload(), headers=csrf(client)).status_code == 400


def test_only_admin_can_change_roles(client, db):
    admin_login(client, db)
    target = make_user(db, email="staffer@example.com", role="staff")
    # staff cannot promote themselves
    client.post("/api/auth/logout", headers=csrf(client))
    login(client, "staffer@example.com")
    assert client.post(f"/api/admin/customers/{target.id}/role", json={"role": "admin"}, headers=csrf(client)).status_code == 403
