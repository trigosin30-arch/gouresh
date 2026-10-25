from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..models import Address, Order, Payment
from ..payments import sign_payment, verify_webhook_signature
from ..schemas import AddressInput, DemoSimulateInput, OrderCreate, VerifyPaymentInput
from ..serializers import order_out
from ..services import orders as order_service

router = APIRouter(tags=["orders"])


def get_order_for_user(db: Session, user, order_ref: str) -> Order:
    order = db.scalar(
        select(Order).where(
            or_(Order.id == order_ref, Order.order_number == order_ref),
        )
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.user_id != user.id and user.role not in ("admin", "staff"):
        # Same response as "not found" so order numbers cannot be enumerated.
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/orders", status_code=201)
def create_order(
    payload: OrderCreate,
    response: Response,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    address = payload.address
    if address is None and payload.address_id:
        saved = db.scalar(
            select(Address).where(Address.id == payload.address_id, Address.user_id == user.id)
        )
        if saved is None:
            raise HTTPException(status_code=404, detail="Saved address not found")
        address = AddressInput(
            label=saved.label,
            contact_name=saved.contact_name,
            phone=saved.phone,
            line1=saved.line1,
            line2=saved.line2,
            locality=saved.locality,
            city=saved.city,
            state=saved.state,
            pincode=saved.pincode,
        )

    if payload.payment_method == "cod" and not settings.cod_enabled:
        raise HTTPException(status_code=400, detail="Cash on delivery is not available right now")
    if payload.payment_method == "pickup" and not settings.pickup_enabled:
        raise HTTPException(status_code=400, detail="Store pickup is not available right now")

    order = order_service.create_order(
        db,
        user,
        lines=payload.items,
        payment_method=payload.payment_method,
        address=address,
        notes=payload.notes,
        coupon_code=payload.coupon_code,
    )

    if payload.save_address and payload.address is not None:
        exists = db.scalar(
            select(Address).where(
                Address.user_id == user.id,
                Address.line1 == payload.address.line1,
                Address.pincode == payload.address.pincode,
            )
        )
        if exists is None:
            db.add(Address(user_id=user.id, **payload.address.model_dump()))
            db.commit()

    body = {"order": order_out(order, include_payments=True)}
    if order.payment_method == "razorpay":
        body["payment_session"] = order_service.start_razorpay_payment(db, order, user)
        db.refresh(order)
        body["order"] = order_out(order)
    return body


@router.get("/orders")
def my_orders(user=Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(
        select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())
    ).unique().all()
    return {"items": [order_out(o, include_payments=False) for o in rows]}


@router.get("/orders/{order_ref}")
def order_detail(
    order_ref: str, response: Response, user=Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    order = get_order_for_user(db, user, order_ref)
    data = order_out(order)
    data["timeline"] = order_service.progress(order)
    return {"order": data}


@router.post("/orders/{order_ref}/cancel")
def cancel_order(
    order_ref: str,
    payload: dict | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    order = get_order_for_user(db, user, order_ref)
    reason = (payload or {}).get("reason") or "Cancelled by customer"
    updated = order_service.update_status(
        db,
        order,
        new_status="cancelled",
        note=str(reason)[:200],
        cancel_reason=str(reason)[:300],
        actor=user,
        customer_cancel=user.role not in ("admin", "staff"),
    )
    return {"order": order_out(updated)}


@router.post("/orders/{order_ref}/retry-payment")
def retry_payment(order_ref: str, user=Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    order = get_order_for_user(db, user, order_ref)
    if order.payment_method != "razorpay":
        raise HTTPException(status_code=400, detail="Online payment was not used for this order")
    if order.status in ("cancelled", "delivered", "refunded"):
        raise HTTPException(status_code=409, detail="This order can no longer be paid online")
    if order.status in ("payment_pending", "payment_failed"):
        order_service.re_reserve_if_released(db, order, actor_id=user.id)
    return {"payment_session": order_service.start_razorpay_payment(db, order, user)}


@router.post("/payments/verify")
def verify_payment(
    payload: VerifyPaymentInput,
    response: Response,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    order = order_service.verify_browser_payment(
        db, user, payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
    )
    data = order_out(order)
    data["timeline"] = order_service.progress(order)
    return {"verified": True, "order": data}


@router.post("/payments/simulate/{order_ref}")
def simulate_payment(
    order_ref: str,
    payload: DemoSimulateInput,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Demo-mode only: runs the real signature + confirmation path with mock ids."""
    if settings.payments_mode != "mock":
        raise HTTPException(status_code=404, detail="Not available")
    order = get_order_for_user(db, user, order_ref)
    order = order_service.simulate_mock_payment(db, order, payload.outcome)
    data = {"order": order_out(order)}
    if payload.outcome == "success":
        payment = db.scalar(
            select(Payment).where(Payment.order_id == order.id).order_by(Payment.created_at.desc())
        )
        data["debug"] = {
            "provider_order_id": payment.provider_order_id if payment else None,
            "provider_payment_id": payment.provider_payment_id if payment else None,
            "signature": sign_payment(payment.provider_order_id, payment.provider_payment_id)
            if payment and payment.provider_payment_id
            else None,
        }
    return data


@router.post("/payments/demo-webhook/{order_ref}")
def demo_webhook(
    order_ref: str,
    response: Response,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Demo-mode only: deliver a signed `payment.captured` webhook twice.

    Proves webhook idempotency: the first delivery confirms the order, the
    second is rejected as a duplicate and changes nothing.
    """
    if settings.payments_mode != "mock":
        raise HTTPException(status_code=404, detail="Not available")
    order = get_order_for_user(db, user, order_ref)
    payment = db.scalar(
        select(Payment).where(Payment.order_id == order.id).order_by(Payment.created_at.desc())
    )
    if payment is None:
        raise HTTPException(status_code=409, detail="Start a payment before simulating a webhook")

    result = order_service.simulate_mock_payment(db, order, "success")
    payment = db.scalar(
        select(Payment).where(Payment.order_id == order.id).order_by(Payment.created_at.desc())
    )
    event_id = f"evt_demo_{payment.provider_payment_id}"
    payload = {
        "entity": "event",
        "account_id": "acc_demo",
        "event": "payment.captured",
        "contains": ["payment"],
        "payload": {
            "payment": {
                "entity": {
                    "id": payment.provider_payment_id,
                    "entity": "payment",
                    "amount": payment.amount_paise,
                    "currency": settings.currency,
                    "status": "captured",
                    "order_id": payment.provider_order_id,
                    "method": "upi",
                }
            }
        },
    }
    first = order_service.process_webhook(db, event_id, "payment.captured", payload)
    second = order_service.process_webhook(db, event_id, "payment.captured", payload)
    db.refresh(order)
    response.headers["Cache-Control"] = "no-store"
    return {"first_delivery": first, "second_delivery": second, "order": order_out(order)}


@router.post("/webhooks/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(default=""),
    db: Session = Depends(get_db),
) -> dict:
    raw = await request.body()
    if not verify_webhook_signature(raw, x_razorpay_signature):
        # 400 tells Razorpay the delivery failed, without leaking why.
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from None
    event_id = payload.get("id") or payload.get("event_id")
    event_type = payload.get("event", "unknown")
    if not event_id:
        raise HTTPException(status_code=400, detail="Webhook is missing an event id")
    return order_service.process_webhook(db, str(event_id), event_type, payload)
