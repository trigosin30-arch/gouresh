"""Order lifecycle: pricing, stock reservation, payment confirmation, tracking.

Invariants enforced here (never in the browser):

* line prices and totals are recomputed from the database;
* stock is decremented with a conditional UPDATE so two shoppers cannot buy the
  same last unit, and every change is written to `inventory_movements`;
* an order becomes `paid` only after an HMAC signature check (browser callback)
  or a verified webhook — and each provider event is processed at most once;
* cancellations restock exactly once (`stock_released`).
"""
from __future__ import annotations

import random
import string
from datetime import datetime
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import payments as razorpay
from ..config import settings
from ..db import utcnow
from ..models import (
    Coupon,
    InventoryMovement,
    Order,
    OrderItem,
    OrderStatusEvent,
    Payment,
    PaymentEvent,
    Product,
    Profile,
)
from ..schemas import AddressInput, CartLineInput

STATUS_FLOW = [
    "payment_pending",
    "confirmed",
    "processing",
    "packed",
    "shipped",
    "out_for_delivery",
    "delivered",
]

# statuses an admin may move an order to, from a given status
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "payment_pending": {"cancelled", "payment_failed"},
    "payment_failed": {"cancelled", "payment_pending"},
    "confirmed": {"processing", "packed", "cancelled"},
    "processing": {"packed", "cancelled"},
    "packed": {"shipped", "out_for_delivery", "cancelled"},
    "shipped": {"out_for_delivery", "delivered"},
    "out_for_delivery": {"delivered"},
    "delivered": {"refunded"},
    "cancelled": {"refunded"},  # only reaches refunded when a refund is actually due
    "refunded": set(),
}

TIMELINE_LABELS = {
    "payment_pending": "Order placed",
    "payment_failed": "Payment failed",
    "confirmed": "Order confirmed",
    "processing": "Processing",
    "packed": "Packed",
    "shipped": "Shipped",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
    "refunded": "Refunded",
}


def _new_order_number() -> str:
    stamp = utcnow().strftime("%y%m%d")
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
    return f"ASM-{stamp}-{suffix}"


def _unique_order_number(db: Session) -> str:
    for _ in range(8):
        candidate = _new_order_number()
        if not db.scalar(select(func.count()).select_from(Order).where(Order.order_number == candidate)):
            return candidate
    raise HTTPException(status_code=500, detail="Could not allocate an order number")


def _slugify(value: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in value.lower()).strip("-")


def unique_slug(db: Session, name: str, *, exclude_id: str | None = None) -> str:
    base = _slugify(name) or "item"
    slug, n = base, 2
    while True:
        stmt = select(Product.id).where(Product.slug == slug)
        if exclude_id:
            stmt = stmt.where(Product.id != exclude_id)
        if not db.scalar(stmt):
            return slug
        slug = f"{base}-{n}"
        n += 1


# ---------------------------------------------------------------------------
# pricing
# ---------------------------------------------------------------------------
def price_order(
    db: Session,
    lines: Iterable[CartLineInput],
    *,
    coupon_code: str | None,
    delivery: bool,
) -> dict:
    """Recompute the cart from database prices. Raises 409 on stock problems."""
    merged: dict[str, int] = {}
    for line in lines:
        merged[line.product_id] = merged.get(line.product_id, 0) + line.quantity

    priced_items: list[dict] = []
    subtotal = 0
    for product_id, quantity in merged.items():
        product = db.get(Product, product_id)
        if product is None or product.is_archived:
            raise HTTPException(status_code=409, detail="An item in your cart is no longer available")
        if quantity > settings.max_quantity_per_line:
            raise HTTPException(
                status_code=409,
                detail=f"Only {settings.max_quantity_per_line} units of {product.name} allowed per order",
            )
        if product.stock < quantity:
            raise HTTPException(
                status_code=409,
                detail=f"Only {product.stock} left of {product.name}. Please update your cart.",
            )
        line_total = product.price_paise * quantity
        subtotal += line_total
        priced_items.append(
            {
                "product": product,
                "quantity": quantity,
                "unit_price_paise": product.price_paise,
                "line_total_paise": line_total,
            }
        )

    discount = 0
    applied_coupon: Coupon | None = None
    if coupon_code:
        applied_coupon = db.scalar(select(Coupon).where(Coupon.code == coupon_code.strip().upper()))
        if not applied_coupon or not applied_coupon.active:
            raise HTTPException(status_code=400, detail="That coupon code is not valid")
        if subtotal < applied_coupon.min_subtotal_paise:
            raise HTTPException(
                status_code=400,
                detail=f"Coupon needs a minimum order of ₹{applied_coupon.min_subtotal_paise // 100}",
            )
        if applied_coupon.kind == "percent":
            discount = subtotal * applied_coupon.value // 100
            if applied_coupon.max_discount_paise:
                discount = min(discount, applied_coupon.max_discount_paise)
        else:
            discount = min(applied_coupon.value, subtotal)

    shipping = 0
    if delivery and subtotal - discount < settings.free_shipping_threshold_paise:
        shipping = settings.shipping_fee_paise

    total = max(subtotal - discount + shipping, 0)
    return {
        "items": priced_items,
        "subtotal_paise": subtotal,
        "discount_paise": discount,
        "shipping_paise": shipping,
        "total_paise": total,
        "coupon": applied_coupon,
        "free_shipping_threshold_paise": settings.free_shipping_threshold_paise,
    }


def quote_out(quote: dict) -> dict:
    return {
        "items": [
            {
                "product_id": i["product"].id,
                "name": i["product"].name,
                "image_url": i["product"].image_url,
                "unit_price_paise": i["unit_price_paise"],
                "quantity": i["quantity"],
                "line_total_paise": i["line_total_paise"],
                "stock": i["product"].stock,
            }
            for i in quote["items"]
        ],
        "subtotal_paise": quote["subtotal_paise"],
        "discount_paise": quote["discount_paise"],
        "shipping_paise": quote["shipping_paise"],
        "total_paise": quote["total_paise"],
        "coupon_code": quote["coupon"].code if quote["coupon"] else None,
        "free_shipping_threshold_paise": quote["free_shipping_threshold_paise"],
    }


# ---------------------------------------------------------------------------
# stock
# ---------------------------------------------------------------------------
def reserve_stock(db: Session, order: Order, items: list[dict], actor_id: str | None) -> None:
    for item in items:
        product: Product = item["product"]
        result = db.execute(
            update(Product)
            .where(Product.id == product.id, Product.stock >= item["quantity"])
            .values(stock=Product.stock - item["quantity"])
        )
        if result.rowcount != 1:
            raise HTTPException(
                status_code=409,
                detail=f"{product.name} sold out while you were checking out. Please review your cart.",
            )
        db.add(
            InventoryMovement(
                product_id=product.id,
                delta=-item["quantity"],
                reason="order_reserved",
                order_id=order.id,
                actor_id=actor_id,
                note=f"Reserved for {order.order_number}",
            )
        )


def release_stock(db: Session, order: Order, actor_id: str | None, *, reason: str) -> None:
    if order.stock_released:
        return
    for item in order.items:
        if not item.product_id:
            continue
        db.execute(
            update(Product)
            .where(Product.id == item.product_id)
            .values(stock=Product.stock + item.quantity)
        )
        db.add(
            InventoryMovement(
                product_id=item.product_id,
                delta=item.quantity,
                reason=reason,
                order_id=order.id,
                actor_id=actor_id,
                note=f"Released from {order.order_number}",
            )
        )
    order.stock_released = True


def re_reserve_if_released(db: Session, order: Order, *, actor_id: str | None) -> None:
    """Re-take stock for a failed payment retry, checking availability first."""
    if not order.stock_released:
        return
    items = []
    for item in order.items:
        product = db.get(Product, item.product_id) if item.product_id else None
        if product is None:
            raise HTTPException(status_code=409, detail=f"{item.name} is no longer available")
        if product.stock < item.quantity:
            raise HTTPException(status_code=409, detail=f"{item.name} is out of stock")
        items.append({"product": product, "quantity": item.quantity})
    reserve_stock(db, order, items, actor_id=actor_id)
    order.stock_released = False
    order.status = "payment_pending"
    order.payment_status = "pending"
    db.commit()


def commit_sale_counts(db: Session, order: Order) -> None:
    for item in order.items:
        if item.product_id:
            db.execute(
                update(Product)
                .where(Product.id == item.product_id)
                .values(sold_count=Product.sold_count + item.quantity)
            )


# ---------------------------------------------------------------------------
# order creation
# ---------------------------------------------------------------------------
def _address_snapshot(address: AddressInput | None, profile: Profile) -> dict:
    if address is None:
        return {
            "contact_name": profile.full_name or "Store pickup",
            "phone": profile.phone or "",
            "line1": settings.store_address,
            "line2": None,
            "locality": "Lower Bazaar",
            "city": "Shimla",
            "state": "Himachal Pradesh",
            "pincode": "171001",
        }
    return {
        "contact_name": address.contact_name,
        "phone": address.phone,
        "line1": address.line1,
        "line2": address.line2,
        "locality": address.locality,
        "city": address.city,
        "state": address.state,
        "pincode": address.pincode,
    }


def create_order(
    db: Session,
    profile: Profile,
    *,
    lines: list[CartLineInput],
    payment_method: str,
    address: AddressInput | None,
    notes: str | None,
    coupon_code: str | None,
) -> Order:
    delivery = payment_method != "pickup"
    quote = price_order(db, lines, coupon_code=coupon_code, delivery=delivery)

    order = Order(
        order_number=_unique_order_number(db),
        user_id=profile.id,
        payment_method=payment_method,
        status="payment_pending" if payment_method == "razorpay" else "confirmed",
        payment_status="unpaid",
        email=profile.email,
        notes=notes,
        subtotal_paise=quote["subtotal_paise"],
        shipping_paise=quote["shipping_paise"],
        discount_paise=quote["discount_paise"],
        total_paise=quote["total_paise"],
        coupon_code=quote["coupon"].code if quote["coupon"] else None,
        **_address_snapshot(address, profile),
    )
    db.add(order)
    db.flush()

    for item in quote["items"]:
        product: Product = item["product"]
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                sku=product.sku,
                name=product.name,
                image_url=product.image_url,
                unit_price_paise=item["unit_price_paise"],
                quantity=item["quantity"],
                line_total_paise=item["line_total_paise"],
            )
        )

    reserve_stock(db, order, quote["items"], actor_id=profile.id)

    if quote["coupon"]:
        db.execute(
            update(Coupon).where(Coupon.id == quote["coupon"].id).values(used_count=Coupon.used_count + 1)
        )

    db.add(
        OrderStatusEvent(
            order_id=order.id,
            status=order.status,
            note="Order placed" if order.status == "confirmed" else "Awaiting payment confirmation",
            actor_id=profile.id,
        )
    )
    db.commit()
    db.refresh(order)
    return order


def start_razorpay_payment(db: Session, order: Order, profile: Profile) -> dict:
    if order.payment_method != "razorpay":
        raise HTTPException(status_code=400, detail="This order does not use online payment")
    if order.payment_status == "paid":
        raise HTTPException(status_code=409, detail="This order is already paid")

    provider_order = razorpay.create_provider_order(
        order.order_number, order.total_paise, {"order_number": order.order_number, "user_id": profile.id}
    )
    payment = Payment(
        order_id=order.id,
        provider="razorpay",
        provider_order_id=provider_order["id"],
        amount_paise=order.total_paise,
        status="created",
    )
    db.add(payment)
    order.payment_status = "pending"
    db.commit()

    return {
        "provider": "razorpay",
        "mode": settings.payments_mode,
        "provider_order_id": provider_order["id"],
        "amount_paise": order.total_paise,
        "currency": settings.currency,
        "key_id": settings.razorpay_key_id if settings.payments_mode != "mock" else "",
        "order_number": order.order_number,
        "prefill": {
            "name": order.contact_name,
            "email": order.email,
            "contact": order.phone,
        },
        "mock": settings.payments_mode == "mock",
    }


# ---------------------------------------------------------------------------
# payment confirmation (shared by browser callback and webhook)
# ---------------------------------------------------------------------------
def _find_order_by_provider_order(db: Session, provider_order_id: str) -> Order | None:
    payment = db.scalar(select(Payment).where(Payment.provider_order_id == provider_order_id))
    return payment.order if payment else None


def mark_order_paid(
    db: Session,
    order: Order,
    *,
    provider_payment_id: str,
    signature_verified: bool,
    method: str | None = None,
    actor_note: str = "Payment verified",
) -> Order:
    """Idempotently move an order to paid/confirmed."""
    if order.payment_status == "paid":
        return order

    existing = db.scalar(select(Payment).where(Payment.provider_payment_id == provider_payment_id))
    if existing and existing.order_id != order.id:
        raise HTTPException(status_code=409, detail="Payment reference already used by another order")

    payment = existing or db.scalar(
        select(Payment).where(Payment.order_id == order.id, Payment.status.in_(("created", "pending", "failed")))
    )
    if payment is None:
        payment = Payment(order_id=order.id, amount_paise=order.total_paise)
        db.add(payment)
    payment.provider_payment_id = provider_payment_id
    payment.status = "captured"
    payment.method = method or payment.method or "online"
    payment.signature_verified = signature_verified
    payment.failure_reason = None

    order.payment_status = "paid"
    order.paid_at = utcnow()
    if order.status in ("payment_pending", "payment_failed"):
        order.status = "confirmed"
        db.add(OrderStatusEvent(order_id=order.id, status="confirmed", note=actor_note))
    commit_sale_counts(db, order)
    db.commit()
    db.refresh(order)
    return order


def mark_payment_failed(
    db: Session,
    order: Order,
    *,
    reason: str,
    provider_payment_id: str | None = None,
    release: bool = True,
) -> Order:
    if order.payment_status == "paid":
        return order
    payment = db.scalar(select(Payment).where(Payment.order_id == order.id).order_by(Payment.created_at.desc()))
    if payment is None:
        payment = Payment(order_id=order.id, amount_paise=order.total_paise)
        db.add(payment)
    payment.status = "failed"
    payment.failure_reason = reason[:400]
    if provider_payment_id and payment.provider_payment_id != provider_payment_id:
        if db.scalar(select(Payment).where(Payment.provider_payment_id == provider_payment_id)) is None:
            payment.provider_payment_id = provider_payment_id

    order.payment_status = "failed"
    if order.status in ("payment_pending", "payment_failed"):
        order.status = "payment_failed"
        db.add(OrderStatusEvent(order_id=order.id, status="payment_failed", note=reason[:200]))
    if release:
        release_stock(db, order, actor_id=None, reason="payment_failed")
    db.commit()
    db.refresh(order)
    return order


def verify_browser_payment(
    db: Session, profile: Profile, provider_order_id: str, payment_id: str, signature: str
) -> Order:
    order = _find_order_by_provider_order(db, provider_order_id)
    # Ownership is checked before verifying anything, so a customer cannot probe
    # other people's payments.
    if order is None or (order.user_id != profile.id and profile.role not in ("admin", "staff")):
        raise HTTPException(status_code=404, detail="Order not found")

    if not razorpay.verify_payment_signature(provider_order_id, payment_id, signature):
        mark_payment_failed(db, order, reason="Signature verification failed", provider_payment_id=None, release=False)
        raise HTTPException(status_code=400, detail="Payment could not be verified. No money was captured.")

    return mark_order_paid(db, order, provider_payment_id=payment_id, signature_verified=True)


def simulate_mock_payment(db: Session, order: Order, outcome: str) -> Order:
    """Demo helper: produces provider-shaped ids and the real signature path."""
    if settings.payments_mode != "mock":
        raise HTTPException(status_code=404, detail="Not available")
    payment = db.scalar(select(Payment).where(Payment.order_id == order.id).order_by(Payment.created_at.desc()))
    provider_order_id = payment.provider_order_id if payment else razorpay.mock_order_id()
    if payment is None:
        payment = Payment(order_id=order.id, provider_order_id=provider_order_id, amount_paise=order.total_paise)
        db.add(payment)
        db.commit()

    if outcome == "failure":
        return mark_payment_failed(db, order, reason="Mock payment declined by customer's bank")

    payment_id = razorpay.mock_payment_id()
    signature = razorpay.sign_payment(provider_order_id, payment_id)
    # Reuse the production verifier so the mock cannot bypass the signature check.
    return verify_browser_payment(db, _owner_stub(order), provider_order_id, payment_id, signature)


def _owner_stub(order: Order) -> Profile:
    owner = Profile(id=order.user_id, email=order.email, full_name=order.contact_name)
    return owner


# ---------------------------------------------------------------------------
# webhooks
# ---------------------------------------------------------------------------
def process_webhook(db: Session, event_id: str, event_type: str, payload: dict) -> dict:
    """Idempotently apply a provider webhook.

    The unique index on `payment_events.event_id` makes duplicate delivery a
    no-op: the insert fails, we roll back and return `duplicate: true`.
    """
    try:
        db.add(PaymentEvent(event_id=event_id, event_type=event_type, payload=payload, processed=False))
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"status": "duplicate", "event_id": event_id}

    result = {"status": "ignored", "event_id": event_id, "order_number": None}
    entity = (
        payload.get("payload", {}).get("payment", {}).get("entity", {})
        if isinstance(payload.get("payload"), dict)
        else {}
    )
    provider_order_id = entity.get("order_id")
    payment_id = entity.get("id")
    order = _find_order_by_provider_order(db, provider_order_id) if provider_order_id else None

    try:
        if order and event_type in ("payment.captured", "order.paid"):
            mark_order_paid(
                db,
                order,
                provider_payment_id=payment_id or razorpay.mock_payment_id(),
                signature_verified=True,
                method=entity.get("method"),
                actor_note="Payment confirmed by webhook",
            )
            result = {"status": "processed", "event_id": event_id, "order_number": order.order_number}
        elif order and event_type == "payment.failed":
            mark_payment_failed(
                db,
                order,
                reason=entity.get("error_description") or "Payment failed",
                provider_payment_id=payment_id,
            )
            result = {"status": "processed", "event_id": event_id, "order_number": order.order_number}
        else:
            result["reason"] = "no matching order or unsupported event"
        db.query(PaymentEvent).filter(PaymentEvent.event_id == event_id).update(
            {"processed": True, "note": result.get("status")}
        )
        db.commit()
    except HTTPException as exc:
        db.rollback()
        db.query(PaymentEvent).filter(PaymentEvent.event_id == event_id).update(
            {"note": f"rejected: {exc.detail}"}
        )
        db.commit()
        return {"status": "rejected", "event_id": event_id, "reason": str(exc.detail)}
    return result


# ---------------------------------------------------------------------------
# fulfilment
# ---------------------------------------------------------------------------
def update_status(
    db: Session,
    order: Order,
    *,
    new_status: str,
    note: str | None,
    courier: str | None = None,
    tracking_number: str | None = None,
    cancel_reason: str | None = None,
    actor: Profile | None = None,
    customer_cancel: bool = False,
) -> Order:
    current = order.status
    if new_status == current and new_status != "cancelled":
        return order

    if new_status == "refunded" and order.payment_status not in ("paid", "refund_due"):
        raise HTTPException(status_code=409, detail="Only paid orders can be refunded")
    if customer_cancel:
        allowed = current in ("payment_pending", "payment_failed", "confirmed", "processing")
        if not allowed:
            raise HTTPException(
                status_code=409,
                detail="This order can no longer be cancelled here — please contact the store",
            )
    elif new_status not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"Cannot move an order from {current} to {new_status}")

    order.status = new_status
    if courier:
        order.courier = courier
    if tracking_number:
        order.tracking_number = tracking_number
    if new_status == "cancelled":
        order.cancel_reason = cancel_reason or note
        release_stock(db, order, actor_id=actor.id if actor else None, reason="order_cancelled")
        if order.payment_status == "paid":
            order.payment_status = "refund_due"
    if new_status == "refunded":
        order.payment_status = "refunded"
    if new_status == "delivered":
        order.delivered_at = utcnow()

    db.add(
        OrderStatusEvent(
            order_id=order.id,
            status=new_status,
            note=note or TIMELINE_LABELS.get(new_status),
            actor_id=actor.id if actor else None,
        )
    )
    db.commit()
    db.refresh(order)
    return order


def progress(order: Order) -> dict:
    """Position of the order in the delivery timeline, for the tracking UI."""
    if order.status in ("cancelled", "payment_failed", "refunded"):
        return {"stage": order.status, "index": -1, "stages": STATUS_FLOW, "terminal": True}
    index = STATUS_FLOW.index(order.status) if order.status in STATUS_FLOW else 0
    return {
        "stage": order.status,
        "index": index,
        "stages": STATUS_FLOW,
        "terminal": order.status == "delivered",
    }


def paid_timestamp(order: Order) -> datetime | None:
    return order.paid_at
