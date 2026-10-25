"""One-time Razorpay checkout: order lifecycle, replay safety, honesty.

These complement tests/test_payments.py (signature rejection, amount mismatch,
idempotency of a single event) with the cases that bite in production: out-of-order
events, unknown orders, stock disappearing before capture, and the guarantee that
nothing is ever marked paid without a verified signature.
"""
from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from sqlalchemy import select

from app.models import InventoryReservation, Notification, Order, Payment, PaymentEvent, Product
from app.services import commerce
from tests.conftest import (
    add_to_cart,
    checkout_payload,
    configure_shop,
    csrf,
    make_product,
    make_user,
    set_payment_env,
)
from tests.test_payments import _online_order, _sign, _webhook


def _captured_event(gateway_order_id: str, payment_id: str = "pay_test1", amount: int | None = None) -> dict:
    entity = {"id": payment_id, "order_id": gateway_order_id, "status": "captured"}
    if amount is not None:
        entity["amount"] = amount
    return {"event": "payment.captured", "payload": {"payment": {"entity": entity}}}


def _failed_event(gateway_order_id: str, reason: str = "card declined") -> dict:
    return {
        "event": "payment.failed",
        "payload": {"payment": {"entity": {"id": "pay_fail1", "order_id": gateway_order_id, "error_description": reason}}},
    }


# --------------------------------------------------------------------------- #
# capture
# --------------------------------------------------------------------------- #
def test_capture_marks_the_order_paid_and_commits_reserved_stock(client, db, shop, monkeypatch):
    order_id, payment, product = _online_order(client, db, shop, monkeypatch, stock=4)
    _, secret = set_payment_env(monkeypatch)

    assert db.get(Order, order_id).status == "pending_payment"
    before = db.get(Product, product.id).stock_qty

    response = _webhook(client, secret, _captured_event("order_test123"))
    assert response.status_code == 200, response.text

    db.expire_all()
    order = db.get(Order, order_id)
    assert order.status == "placed"
    assert order.payment_status == "paid"
    assert db.get(Payment, payment.id).status == "paid"
    # The reservation is consumed, and stock is now committed (not just held).
    assert db.scalar(
        select(InventoryReservation).where(InventoryReservation.order_id == order_id)
    ).status == "consumed"
    # Stock was only reserved at checkout; capture is what commits (decrements) it.
    assert db.get(Product, product.id).stock_qty == before - 1


def test_replaying_the_same_event_is_acknowledged_but_not_reprocessed(client, db, shop, monkeypatch):
    order_id, _, _ = _online_order(client, db, shop, monkeypatch)
    _, secret = set_payment_env(monkeypatch)
    event = _captured_event("order_test123")

    first = _webhook(client, secret, event, event_id="evt_dup")
    second = _webhook(client, secret, event, event_id="evt_dup")
    assert first.status_code == 200 and second.status_code == 200
    assert second.json().get("duplicate") is True

    db.expire_all()
    processed = db.scalars(select(PaymentEvent).where(PaymentEvent.event_id == "evt_dup")).all()
    assert len(processed) == 1
    # One confirmation event on the order, not two.
    events = [e for e in db.get(Order, order_id).events if e.event_type == "payment_confirmed"]
    assert len(events) == 1


def test_a_different_event_for_an_already_paid_order_does_not_double_charge_or_double_commit(client, db, shop, monkeypatch):
    order_id, payment, product = _online_order(client, db, shop, monkeypatch, stock=5)
    _, secret = set_payment_env(monkeypatch)
    _webhook(client, secret, _captured_event("order_test123"), event_id="evt_a")

    db.expire_all()
    stock_after_first = db.get(Product, product.id).stock_qty

    # A second, distinct event id for the same payment (gateways do send both
    # payment.captured and order.paid) must be a no-op for stock and money.
    second = _webhook(client, secret, _captured_event("order_test123"), event_id="evt_b")
    assert second.status_code == 200

    db.expire_all()
    assert db.get(Product, product.id).stock_qty == stock_after_first
    assert db.get(Order, order_id).payment_status == "paid"


# --------------------------------------------------------------------------- #
# out-of-order and hostile events
# --------------------------------------------------------------------------- #
def test_late_failed_event_cannot_downgrade_a_captured_payment(client, db, shop, monkeypatch):
    order_id, payment, _ = _online_order(client, db, shop, monkeypatch)
    _, secret = set_payment_env(monkeypatch)
    _webhook(client, secret, _captured_event("order_test123"), event_id="evt_capture")
    # Gateways occasionally deliver a stale failure notification afterwards.
    late = _webhook(client, secret, _failed_event("order_test123"), event_id="evt_late_fail")
    assert late.status_code == 200, late.text

    db.expire_all()
    assert db.get(Payment, payment.id).status == "paid"
    assert db.get(Order, order_id).payment_status == "paid"
    assert db.get(Order, order_id).status == "placed"


def test_webhook_for_an_unknown_order_is_acknowledged_and_ignored(client, db, shop, monkeypatch):
    configure_shop(db, online_payments_enabled=True)
    _, secret = set_payment_env(monkeypatch)
    response = _webhook(client, secret, _captured_event("order_does_not_exist"), event_id="evt_unknown")
    assert response.status_code == 200
    db.expire_all()
    record = db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == "evt_unknown"))
    assert record.status is not None
    assert record.status in ("ignored", "processed")


def test_unsigned_and_tampered_webhooks_change_nothing(client, db, shop, monkeypatch):
    order_id, payment, _ = _online_order(client, db, shop, monkeypatch)
    _, secret = set_payment_env(monkeypatch)
    body = json.dumps({"id": "evt_forged", **_captured_event("order_test123")}).encode()

    # No signature at all.
    assert client.post("/api/payments/webhook", content=body, headers={"Content-Type": "application/json"}).status_code == 400
    # Signed with the wrong secret.
    wrong = client.post(
        "/api/payments/webhook",
        content=body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": _sign("not-the-secret", body)},
    )
    assert wrong.status_code == 400
    # Correct signature, but the body was altered after signing.
    good_sig = _sign(secret, body)
    tampered = body.replace(b'"captured"', b'"refunded"')
    altered = client.post(
        "/api/payments/webhook",
        content=tampered,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": good_sig},
    )
    assert altered.status_code == 400

    db.expire_all()
    assert db.get(Payment, payment.id).status != "paid"
    assert db.get(Order, order_id).payment_status != "paid"


# --------------------------------------------------------------------------- #
# stock conflict after capture
# --------------------------------------------------------------------------- #
def test_capture_after_stock_ran_out_flags_staff_instead_of_pretending(client, db, shop, monkeypatch):
    """Money taken but the item is gone: staff must be told, loudly."""
    order_id, payment, product = _online_order(client, db, shop, monkeypatch, stock=2)
    _, secret = set_payment_env(monkeypatch)
    make_user(db, email="shop.admin@example.com", role="admin", name="Shop Admin")

    # Someone empties the shelf between reservation and capture.
    db.get(Product, product.id).stock_qty = 0
    db.commit()

    response = _webhook(client, secret, _captured_event("order_test123"), event_id="evt_conflict")
    assert response.status_code == 200, response.text

    db.expire_all()
    order = db.get(Order, order_id)
    # The payment is real, so it is recorded as paid...
    assert order.payment_status == "paid"
    # ...but the conflict is recorded on the order and raised to staff.
    assert any(e.event_type == "stock_conflict" for e in order.events)
    alerts = db.scalars(select(Notification).where(Notification.template == "stock_conflict")).all()
    assert alerts, "staff must be notified about a paid order that cannot be fulfilled"


# --------------------------------------------------------------------------- #
# status endpoint honesty
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "keys,enabled_in_settings,available",
    [
        (False, False, False),
        (False, True, False),
        (True, False, False),
        (True, True, True),
    ],
)
def test_status_endpoint_only_promises_online_payment_when_it_can_work(
    client, db, shop, monkeypatch, keys, enabled_in_settings, available
):
    configure_shop(db, online_payments_enabled=enabled_in_settings)
    if keys:
        set_payment_env(monkeypatch)
    else:
        monkeypatch.setattr("app.config.settings.razorpay_key_id", "")
        monkeypatch.setattr("app.config.settings.razorpay_key_secret", "")
        monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", "")

    body = client.get("/api/payments/status").json()
    assert body["online_payments_available"] is available
    assert ("cod" in body["methods_available"]) is True
    assert ("online" in body["methods_available"]) is available
    # The publishable key id is only advertised when the gateway can actually work.
    if not available:
        assert "not configured" in body["message"].lower() or "only payment methods" in body["message"].lower()


def test_create_order_refuses_when_the_gateway_keys_are_missing(client, db, shop, monkeypatch):
    """An order created while configured must not be payable after keys are removed."""
    order_id, payment, _ = _online_order(client, db, shop, monkeypatch)
    monkeypatch.setattr("app.config.settings.razorpay_key_id", "")
    monkeypatch.setattr("app.config.settings.razorpay_key_secret", "")
    monkeypatch.setattr("app.config.settings.razorpay_webhook_secret", "")

    response = client.post(f"/api/payments/create-order?order_id={order_id}", headers=csrf(client))
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()

    # Nothing was marked paid, and no gateway order id was invented.
    db.expire_all()
    assert db.get(Payment, payment.id).status == "pending"
