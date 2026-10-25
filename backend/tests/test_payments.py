"""Online payment webhook security and idempotency (criterion 8)."""
from __future__ import annotations

import hashlib
import hmac
import json

from sqlalchemy import select

from app.models import Order, Payment, PaymentEvent, Product
from tests.conftest import (
    add_to_cart,
    checkout_payload,
    configure_shop,
    csrf,
    make_product,
    set_payment_env,
)


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _online_order(client, db, shop, monkeypatch, price_paise=50000, stock=5):
    configure_shop(db, online_payments_enabled=True)
    set_payment_env(monkeypatch)
    product = make_product(db, price_paise=price_paise, stock=stock)
    add_to_cart(client, product.id, 1)
    response = client.post("/api/checkout", json=checkout_payload(payment_method="online"), headers=csrf(client))
    assert response.status_code == 201, response.text
    order_id = response.json()["order"]["id"]
    payment = db.scalar(select(Payment).where(Payment.order_id == order_id))
    payment.provider_reference = "order_test123"
    db.commit()
    return order_id, payment, product


def _webhook(client, secret, event: dict, event_id="evt_1"):
    payload = {"id": event_id, **event}
    body = json.dumps(payload).encode()
    return client.post(
        "/api/payments/webhook",
        content=body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": _sign(secret, body)},
    )


def test_online_payments_disabled_by_default(client, db, shop):
    product = make_product(db, stock=3)
    add_to_cart(client, product.id, 1)
    response = client.post("/api/checkout", json=checkout_payload(payment_method="online"), headers=csrf(client))
    assert response.status_code == 400
    status = client.get("/api/payments/status").json()
    assert status["online_payments_available"] is False


def test_webhook_rejects_invalid_signature(client, db, shop, monkeypatch):
    _online_order(client, db, shop, monkeypatch)
    body = json.dumps({"id": "evt_bad", "event": "payment.captured"}).encode()
    response = client.post(
        "/api/payments/webhook",
        content=body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": "deadbeef"},
    )
    assert response.status_code == 400


def test_webhook_is_503_when_gateway_not_configured(client, db, shop):
    body = b'{"id":"evt_x","event":"payment.captured"}'
    response = client.post("/api/payments/webhook", content=body, headers={"X-Razorpay-Signature": "x"})
    assert response.status_code == 503


def test_captured_payment_is_idempotent(client, db, shop, monkeypatch):
    order_id, payment, product = _online_order(client, db, shop, monkeypatch)
    _secret, webhook_secret = set_payment_env(monkeypatch)

    event = {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_abc", "order_id": "order_test123", "amount": payment.amount_paise}}},
    }
    first = _webhook(client, webhook_secret, event, event_id="evt_capture_1")
    assert first.status_code == 200, first.text

    db.expire_all()
    order = db.get(Order, order_id)
    assert order.payment_status == "paid"
    assert order.status == "placed"
    assert db.get(Product, product.id).stock_qty == 4  # reservation consumed
    assert len(db.scalars(select(PaymentEvent)).all()) == 1

    replay = _webhook(client, webhook_secret, event, event_id="evt_capture_1")
    assert replay.status_code == 200
    assert replay.json().get("duplicate") is True
    db.expire_all()
    assert len(db.scalars(select(PaymentEvent)).all()) == 1
    assert len([p for p in db.scalars(select(Payment)).all() if p.status == "paid"]) == 1
    assert db.get(Product, product.id).stock_qty == 4  # not double-decremented


def test_webhook_amount_mismatch_is_rejected(client, db, shop, monkeypatch):
    order_id, payment, _product = _online_order(client, db, shop, monkeypatch)
    _secret, webhook_secret = set_payment_env(monkeypatch)
    event = {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_x", "order_id": "order_test123", "amount": 1}}},
    }
    response = _webhook(client, webhook_secret, event, event_id="evt_mismatch")
    assert response.status_code == 200
    db.expire_all()
    assert db.get(Order, order_id).payment_status == "pending"
    record = db.scalar(select(PaymentEvent))
    assert record.error == "amount_mismatch"
    assert db.get(Product, _product.id).stock_qty == 5


def test_failed_payment_event_marks_payment_failed(client, db, shop, monkeypatch):
    order_id, payment, _product = _online_order(client, db, shop, monkeypatch)
    _secret, webhook_secret = set_payment_env(monkeypatch)
    event = {
        "event": "payment.failed",
        "payload": {"payment": {"entity": {"id": "pay_fail", "order_id": "order_test123", "error_description": "card declined"}}},
    }
    assert _webhook(client, webhook_secret, event, event_id="evt_failed").status_code == 200
    db.expire_all()
    assert db.get(Payment, payment.id).status == "failed"
    assert db.get(Order, order_id).status == "pending_payment"


def test_checkout_signature_verification(client, db, shop, monkeypatch):
    order_id, payment, _product = _online_order(client, db, shop, monkeypatch)
    key_secret, _webhook_secret = set_payment_env(monkeypatch)
    from tests.conftest import login, make_user

    # The guest order belongs to nobody, so attach it to a customer for this test.
    user = make_user(db, email="payer@example.com")
    order = db.get(Order, order_id)
    order.user_id = user.id
    db.commit()

    login(client, "payer@example.com")
    bad_signature = client.post(
        "/api/payments/confirm",
        json={"razorpay_order_id": "order_test123", "razorpay_payment_id": "pay_1", "razorpay_signature": "not-a-valid-signature"},
        headers=csrf(client),
    )
    assert bad_signature.status_code == 400

    good_signature = hmac.new(key_secret.encode(), b"order_test123|pay_1", hashlib.sha256).hexdigest()
    confirmed = client.post(
        "/api/payments/confirm",
        json={"razorpay_order_id": "order_test123", "razorpay_payment_id": "pay_1", "razorpay_signature": good_signature},
        headers=csrf(client),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["payment_status"] == "paid"
    db.expire_all()
    assert db.get(Order, order_id).status == "placed"
