"""Cart, pricing, stock and checkout tests (acceptance criteria 5, 6, 7)."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import select

from app.db import SessionLocal, now
from app.models import Coupon, InventoryMovement, InventoryReservation, Order, Product
from app.services.commerce import release_expired_reservations
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
    register,
    set_payment_env,
)


def test_guest_cart_persists_between_requests(client, db):
    product = make_product(db, stock=5)
    assert add_to_cart(client, product.id, 2).status_code == 200
    payload = client.get("/api/cart").json()
    assert payload["item_count"] == 2
    assert payload["subtotal_paise"] == product.price_paise * 2


def test_guest_cart_merges_after_login_without_duplication(client, db, shop):
    product = make_product(db, stock=10)
    make_user(db, email="merge@example.com")
    # Guest cart: 2 units
    assert add_to_cart(client, product.id, 2).status_code == 200
    # Log in, add 1 more via the same (now authenticated) cart
    assert login(client, "merge@example.com").status_code == 200
    assert add_to_cart(client, product.id, 3).status_code == 200
    payload = client.get("/api/cart").json()
    assert len(payload["items"]) == 1
    assert payload["items"][0]["quantity"] == 3
    assert payload["item_count"] == 3


def test_quantity_limits_and_removal(client, db):
    product = make_product(db, stock=3)
    assert add_to_cart(client, product.id, 4).status_code == 409
    assert add_to_cart(client, product.id, 51).status_code == 422
    assert add_to_cart(client, product.id, 2).status_code == 200
    assert client.delete(f"/api/cart/items/{product.id}", headers=csrf(client)).json()["item_count"] == 0


def test_server_ignores_browser_prices(client, db, shop):
    product = make_product(db, price_paise=25000, stock=5)
    add_to_cart(client, product.id, 2)
    # extra="forbid" means a browser cannot smuggle a price field at all
    manipulated = checkout_payload(price_paise=1, total_paise=1)
    response = client.post("/api/checkout", json=manipulated, headers=csrf(client))
    assert response.status_code == 422

    response = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client))
    assert response.status_code == 201, response.text
    order = response.json()["order"]
    assert order["total_paise"] == 50000


def test_stock_is_rechecked_at_checkout(client, db, shop):
    product = make_product(db, stock=2)
    add_to_cart(client, product.id, 2)
    # Simulate another customer buying the stock before checkout completes
    db_product = db.get(Product, product.id)
    db_product.stock_qty = 0
    db.commit()
    response = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client))
    assert response.status_code == 409


def test_minimum_order_requirement(client, db):
    configure_shop(db, min_order_paise=50000)
    product = make_product(db, price_paise=10000, stock=5)
    add_to_cart(client, product.id, 1)
    assert client.get("/api/cart").json()["can_checkout"] is False
    assert client.post("/api/checkout", json=checkout_payload(), headers=csrf(client)).status_code == 400


def test_delivery_requires_serviceable_pincode_and_charges_fee(client, db, shop):
    product = make_product(db, price_paise=20000, stock=5)
    add_to_cart(client, product.id, 1)
    rejected = checkout_payload(
        fulfillment_type="delivery",
        address=address_payload(pincode="999999"),
    )
    assert client.post("/api/checkout", json=rejected, headers=csrf(client)).status_code == 400

    accepted = checkout_payload(fulfillment_type="delivery", address=address_payload(pincode="144005"))
    response = client.post("/api/checkout", json=accepted, headers=csrf(client))
    assert response.status_code == 201, response.text
    order = response.json()["order"]
    assert order["delivery_fee_paise"] == 4900
    assert order["total_paise"] == 24900


def test_delivery_disabled_blocks_delivery_checkout(client, db):
    configure_shop(db, delivery_enabled=False)
    product = make_product(db, stock=3)
    add_to_cart(client, product.id, 1)
    response = client.post(
        "/api/checkout",
        json=checkout_payload(fulfillment_type="delivery", address=address_payload()),
        headers=csrf(client),
    )
    assert response.status_code == 400


def test_no_payment_method_configured_blocks_checkout(client, db):
    configure_shop(db, cod_enabled=False)
    product = make_product(db, stock=3)
    add_to_cart(client, product.id, 1)
    response = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client))
    assert response.status_code == 400
    assert "payment method" in response.json()["detail"].lower()


def test_coupon_discount_and_per_user_limit(client, db, shop):
    make_user(db, email="coupon@example.com")
    product = make_product(db, price_paise=100000, stock=5)
    db.add(
        Coupon(
            code="SAVE10",
            discount_type="percent",
            value=10,
            min_order_paise=0,
            max_discount_paise=50000,
            per_user_limit=1,
            is_active=True,
        )
    )
    db.commit()
    login(client, "coupon@example.com")

    add_to_cart(client, product.id, 1)
    cart = client.get("/api/cart?coupon=SAVE10").json()
    assert cart["discount_paise"] == 10000
    assert cart["total_paise"] == 90000

    response = client.post("/api/checkout", json=checkout_payload(coupon_code="SAVE10"), headers=csrf(client))
    assert response.status_code == 201
    assert response.json()["order"]["discount_paise"] == 10000

    add_to_cart(client, product.id, 1)
    second = client.post("/api/checkout", json=checkout_payload(coupon_code="SAVE10"), headers=csrf(client))
    assert second.status_code == 400


def test_cod_checkout_decrements_stock_and_logs_movement(client, db, shop):
    product = make_product(db, stock=10)
    add_to_cart(client, product.id, 3)
    response = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client))
    assert response.status_code == 201
    order_id = response.json()["order"]["id"]

    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 7
    movements = db.scalars(select(InventoryMovement).where(InventoryMovement.reference_id == order_id)).all()
    assert movements and movements[0].delta == -3
    assert client.get("/api/cart").json()["item_count"] == 0


def test_concurrent_checkouts_cannot_oversell(client, db, shop):
    product = make_product(db, stock=1)
    make_user(db, email="race1@example.com")
    make_user(db, email="race2@example.com")

    import threading

    from fastapi.testclient import TestClient

    from app.main import app

    clients = {}
    for email in ("race1@example.com", "race2@example.com"):
        c = TestClient(app)
        c.get("/api/store/bootstrap")
        login(c, email)
        # Both shoppers add the last unit to their cart before either checks out.
        assert add_to_cart(c, product.id, 1).status_code == 200
        clients[email] = c

    barrier = threading.Barrier(2)

    def attempt(email):
        c = clients[email]
        barrier.wait(timeout=10)
        return c.post("/api/checkout", json=checkout_payload(), headers=csrf(c))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, ["race1@example.com", "race2@example.com"]))
    for c in clients.values():
        c.close()

    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], [r.text for r in results]
    with SessionLocal() as fresh:
        assert fresh.get(Product, product.id).stock_qty == 0
        assert len(fresh.scalars(select(Order)).all()) == 1


def test_online_payment_reserves_stock_then_expires(client, db, shop, monkeypatch):
    configure_shop(db, online_payments_enabled=True)
    set_payment_env(monkeypatch)
    product = make_product(db, stock=4)
    add_to_cart(client, product.id, 2)
    response = client.post(
        "/api/checkout",
        json=checkout_payload(payment_method="online"),
        headers=csrf(client),
    )
    assert response.status_code == 201, response.text
    order = response.json()["order"]
    assert order["status"] == "pending_payment"
    assert response.json()["requires_payment"] is True

    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 4  # not committed yet
    reservations = db.scalars(select(InventoryReservation).where(InventoryReservation.order_id == order["id"])).all()
    assert reservations and reservations[0].status == "active"
    # Reserved stock is not offered to other shoppers
    assert client.get("/api/cart").json()["items"] == []
    assert add_to_cart(client, product.id, 3).status_code == 409

    # Expire the hold and sweep
    reservation = db.scalars(select(InventoryReservation)).first()
    reservation.expires_at = now() - timedelta(minutes=5)
    db.commit()
    released = release_expired_reservations(db)
    assert released == 1
    db.expire_all()
    assert db.get(Product, product.id).stock_qty == 4
    assert db.get(Order, order["id"]).status == "cancelled"


def test_guest_order_tracking_is_limited(client, db, shop):
    product = make_product(db, stock=4)
    add_to_cart(client, product.id, 1)
    order = client.post("/api/checkout", json=checkout_payload(), headers=csrf(client)).json()["order"]

    limited = client.get(f"/api/track?order_number={order['order_number']}&email=buyer@example.com")
    assert limited.status_code == 200
    body = limited.json()
    assert body["limited"] is True
    assert body["items"] is None
    assert "***" in body["customer_email"]

    full = client.get(f"/api/track?token={order['tracking_token']}")
    assert full.status_code == 200
    assert full.json()["limited"] is False
    assert full.json()["items"][0]["quantity"] == 1

    assert client.get("/api/track").status_code == 400
    assert client.get(f"/api/track?order_number={order['order_number']}&email=other@example.com").status_code == 404


def test_checkout_validation_rejects_bad_phone_and_pincode(client, db, shop):
    product = make_product(db, stock=4)
    add_to_cart(client, product.id, 1)
    bad_phone = checkout_payload(customer_phone="12345")
    assert client.post("/api/checkout", json=bad_phone, headers=csrf(client)).status_code == 422
    bad_pin = checkout_payload(fulfillment_type="delivery", address=address_payload(pincode="12"))
    assert client.post("/api/checkout", json=bad_pin, headers=csrf(client)).status_code == 422
