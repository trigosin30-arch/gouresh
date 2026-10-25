"""Online payment endpoints (Razorpay-compatible, server verified).

Online payments are disabled unless ``RAZORPAY_KEY_ID``, ``RAZORPAY_KEY_SECRET``
and ``RAZORPAY_WEBHOOK_SECRET`` are configured AND the owner enables online
payments in store settings. No raw card data ever reaches this server.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..db import get_db, now
from ..models import Order, Payment, PaymentEvent, User
from ..schemas import PaymentConfirmIn
from ..security import get_current_user, require_user
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.commerce import confirm_online_payment
from ..services.notifications import notify_staff, notify_user
from ..services.rate_limit import client_ip, enforce

router = APIRouter(prefix="/api/payments", tags=["payments"])


def _gateway_status() -> dict:
    return {
        "configured": settings.online_payments_available,
        "provider": "razorpay",
        "key_id": settings.razorpay_key_id if settings.online_payments_available else None,
        "enabled_in_settings": None,  # filled by callers with a db session
    }


@router.get("/status")
def payment_status(db: OrmSession = Depends(get_db)):
    enabled = bool(store_settings.get(db, "online_payments_enabled"))
    return {
        "online_payments_available": bool(settings.online_payments_available and enabled),
        "provider": "razorpay",
        "key_id": settings.razorpay_key_id if settings.online_payments_available else None,
        "gateway_configured": settings.online_payments_available,
        "enabled_in_settings": enabled,
        "methods_available": store_settings.available_payment_methods(db),
        "message": (
            "Online payments are live."
            if settings.online_payments_available and enabled
            else "Online payments are not configured. Only payment methods shown at checkout are available."
        ),
    }


@router.post("/create-order")
def create_gateway_order(
    order_id: str,
    request: Request,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "payment_create", 20, 900)
    if not (settings.online_payments_available and store_settings.get(db, "online_payments_enabled")):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Online payments are not configured for this deployment. Choose another payment method.",
        )
    order = db.scalar(select(Order).where(Order.id == order_id))
    if not order or (user and order.user_id and order.user_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if order.payment_status == "paid":
        raise HTTPException(status.HTTP_409_CONFLICT, "This order is already paid")
    payment = db.scalar(
        select(Payment).where(Payment.order_id == order.id, Payment.method == "online", Payment.status == "pending")
    )
    if not payment:
        raise HTTPException(status.HTTP_409_CONFLICT, "This order has no pending online payment")

    import urllib.error
    import urllib.request

    payload = json.dumps(
        {
            "amount": payment.amount_paise,
            "currency": "INR",
            "receipt": order.order_number,
            "notes": {"order_number": order.order_number},
        }
    ).encode()
    auth = f"{settings.razorpay_key_id}:{settings.razorpay_key_secret}".encode()
    import base64

    req = urllib.request.Request(
        "https://api.razorpay.com/v1/orders",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Basic " + base64.b64encode(auth).decode(),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 - fixed https URL
            gateway_order = json.loads(resp.read().decode())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Payment gateway request failed ({type(exc).__name__})")
    payment.provider_reference = gateway_order.get("id")
    db.commit()
    return {
        "gateway_order_id": gateway_order.get("id"),
        "amount_paise": payment.amount_paise,
        "currency": "INR",
        "key_id": settings.razorpay_key_id,
        "order_number": order.order_number,
    }


@router.post("/confirm")
def confirm_payment(
    payload: PaymentConfirmIn,
    request: Request,
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
):
    """Verify the checkout signature server-side before marking an order paid."""
    enforce(request, "payment_confirm", 20, 900)
    if not settings.online_payments_available:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Online payments are not configured")
    expected = hmac.new(
        settings.razorpay_key_secret.encode(),
        f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment signature verification failed")

    payment = db.scalar(select(Payment).where(Payment.provider_reference == payload.razorpay_order_id))
    if not payment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    order = db.get(Order, payment.order_id)
    if not order or order.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    confirm_online_payment(db, order, payment, payload.razorpay_payment_id)
    audit(db, "payment.confirmed", actor=user, entity_type="order", entity_id=order.id, after={"provider_payment_id": payload.razorpay_payment_id}, ip_address=client_ip(request), commit=True)
    return {"ok": True, "order_number": order.order_number, "payment_status": order.payment_status}


def _verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(settings.razorpay_webhook_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/webhook")
async def payment_webhook(request: Request, db: OrmSession = Depends(get_db)):
    """Signed, idempotent webhook handler.

    * signature checked against the raw request body (no JSON re-encoding);
    * each provider event id is stored once — replays are acknowledged but ignored;
    * the gateway response is never trusted over the stored order amount.
    """
    if not settings.online_payments_available:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Online payments are not configured")
    signature = request.headers.get("x-razorpay-signature", "")
    raw = await request.body()
    if not signature or not _verify_webhook_signature(raw, signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook signature")
    try:
        event = json.loads(raw.decode())
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook payload")

    event_id = str(
        event.get("id")
        or (event.get("payload", {}).get("payment", {}).get("entity", {}).get("id"))
        or hashlib.sha256(raw).hexdigest()
    )[:120]
    event_type = str(event.get("event", "unknown"))[:60]

    existing = db.scalar(select(PaymentEvent).where(PaymentEvent.event_id == event_id))
    if existing:
        if existing.status != "failed":
            return {"ok": True, "duplicate": True}
        # A previous attempt failed to process; allow a retry of the same event.
        db.delete(existing)
        db.commit()

    record = PaymentEvent(
        provider="razorpay",
        event_id=event_id,
        event_type=event_type,
        payload=event,
        status="received",
    )
    db.add(record)
    db.flush()

    payment_entity = event.get("payload", {}).get("payment", {}).get("entity", {})
    gateway_order_id = payment_entity.get("order_id")
    payment = (
        db.scalar(select(Payment).where(Payment.provider_reference == gateway_order_id))
        if gateway_order_id
        else None
    )
    if payment:
        record.payment_id = payment.id
        record.order_id = payment.order_id
    order = db.get(Order, payment.order_id) if payment else None

    try:
        if event_type in ("payment.captured", "order.paid") and payment and order:
            amount = payment_entity.get("amount")
            if amount is not None and int(amount) != payment.amount_paise:
                record.status = "failed"
                record.error = "amount_mismatch"
                notify_staff(
                    db,
                    list(db.scalars(select(User).where(User.role == "admin")).all()),
                    "payment_mismatch",
                    f"Payment amount mismatch on {order.order_number}",
                    f"Gateway reported {amount} paise, order expects {payment.amount_paise} paise.",
                )
            else:
                confirm_online_payment(db, order, payment, str(payment_entity.get("id") or event_id), amount_paise=int(amount) if amount is not None else None)
                record.status = "processed"
                record.processed_at = now()
        elif event_type in ("payment.failed",):
            if payment and payment.status != "paid":
                payment.status = "failed"
                payment.failure_reason = str(payment_entity.get("error_description") or "failed")[:250]
                db.commit()
                if order:
                    notify_user(
                        db,
                        db.get(User, order.user_id) if order.user_id else None,
                        "payment_failed",
                        f"Payment failed for {order.order_number}",
                        "The online payment was not successful. Your order is held while the stock reservation is active. You can retry payment or contact the store.",
                        related_type="order",
                        related_id=order.id,
                        email=order.customer_email,
                    )
            record.status = "processed"
            record.processed_at = now()
        else:
            record.status = "ignored"
            record.processed_at = now()
    except HTTPException as exc:
        db.rollback()
        raise exc
    except Exception as exc:  # noqa: BLE001
        record.status = "failed"
        record.error = type(exc).__name__
        record.processed_at = now()
    db.commit()
    return {"ok": True}
