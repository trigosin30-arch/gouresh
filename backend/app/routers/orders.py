"""Customer orders, tracking, cancellation and returns."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session as OrmSession, selectinload

from ..config import settings
from ..db import get_db, now
from ..models import Notification, Order, OrderEvent, ReturnRequest, User
from ..schemas import CheckoutIn, ReturnRequestIn
from ..security import get_current_user, require_user
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.commerce import (
    _cancel_order,
    checkout,
    order_public,
    release_expired_reservations,
)
from ..services.documents import render_order_document
from ..services.notifications import notify_user
from ..services.rate_limit import client_ip, enforce
from .cart import resolve_cart

router = APIRouter(prefix="/api", tags=["orders"])


def _owned_order(db: OrmSession, order_id: str, user: User) -> Order:
    order = db.scalar(
        select(Order).options(selectinload(Order.items), selectinload(Order.events), selectinload(Order.shipment)).where(Order.id == order_id)
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if order.user_id != user.id:
        # Staff access goes through /api/admin/orders.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


def _customer_order_payload(db: OrmSession, order: Order) -> dict:
    data = order_public(order)
    data["events"] = [
        {
            "type": e.event_type,
            "from_status": e.from_status,
            "to_status": e.to_status,
            "note": e.note,
            "created_at": e.created_at,
            "actor": e.actor_label,
        }
        for e in order.events
        if e.is_customer_visible
    ]
    returns = db.scalars(select(ReturnRequest).where(ReturnRequest.order_id == order.id).order_by(ReturnRequest.created_at.desc())).all()
    data["returns"] = [_return_payload(r) for r in returns]
    ship_rows = [
        {"carrier": order.shipment.carrier, "tracking_number": order.shipment.tracking_number} if order.shipment else {}
    ]
    data["tracking"] = ship_rows[0] if ship_rows else {}
    data["can_cancel"] = _can_cancel(db, order)
    data["can_request_return"] = _can_request_return(db, order)
    return data


def _return_payload(row: ReturnRequest) -> dict:
    return {
        "id": row.id,
        "reference": row.reference,
        "request_type": row.request_type,
        "reason": row.reason,
        "status": row.status,
        "admin_note": row.admin_note,
        "refund_amount_paise": row.refund_amount_paise,
        "created_at": row.created_at,
        "resolved_at": row.resolved_at,
    }


def _can_cancel(db: OrmSession, order: Order) -> bool:
    window = store_settings.get_int(db, "cancellation_window_hours")
    if window <= 0:
        return False
    if order.status not in ("pending_payment", "placed", "processing"):
        return False
    placed = order.placed_at if order.placed_at.tzinfo else order.placed_at.replace(tzinfo=timezone.utc)
    return placed + timedelta(hours=window) >= now()


def _can_request_return(db: OrmSession, order: Order) -> bool:
    window = store_settings.get_int(db, "return_window_days")
    if window <= 0 or order.status != "delivered":
        return False
    delivered = order.delivered_at or order.updated_at
    if delivered.tzinfo is None:
        delivered = delivered.replace(tzinfo=timezone.utc)
    return delivered + timedelta(days=window) >= now()


@router.post("/checkout", status_code=201)
def do_checkout(
    payload: CheckoutIn,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "checkout", *settings.rate_limit_checkout)
    release_expired_reservations(db)
    cart = resolve_cart(request, response, db, user)
    order = checkout(db, cart=cart, payload=payload, user=user)
    if not user:
        response.delete_cookie("asm_guest_cart", path="/")
    audit(db, "order.created", actor=user, entity_type="order", entity_id=order.id, after={"total": order.total_paise, "status": order.status}, ip_address=client_ip(request), commit=True)
    staff = [u for u in db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all()]
    from ..services.notifications import notify_staff

    notify_staff(
        db,
        staff,
        "new_order",
        f"New order {order.order_number}",
        f"{order.customer_name} placed order {order.order_number} for ₹{order.total_paise/100:.2f} ({order.payment_method}, {order.fulfillment_type}).",
    )
    return {"order": order_public(order), "requires_payment": order.status == "pending_payment"}


@router.get("/orders")
def my_orders(
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
    page: int = Query(default=1, ge=1, le=200),
    per_page: int = Query(default=10, ge=1, le=50),
):
    base = select(Order).where(Order.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.options(selectinload(Order.items), selectinload(Order.shipment))
        .order_by(Order.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    ).all()
    return {
        "orders": [order_public(o) for o in rows],
        "total": int(total),
        "page": page,
        "pages": max(1, (int(total) + per_page - 1) // per_page),
    }


@router.get("/orders/{order_id}")
def order_detail(
    order_id: str,
    user: Optional[User] = Depends(get_current_user),
    token: Optional[str] = None,
    db: OrmSession = Depends(get_db),
):
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.events), selectinload(Order.shipment))
        .where(Order.id == order_id)
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    if user and order.user_id == user.id:
        return _customer_order_payload(db, order)
    if token and secrets.compare_digest(token, order.tracking_token):
        return _customer_order_payload(db, order)
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")


def _mask_email(value: str) -> str:
    local, _, domain = value.partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


@router.get("/track")
def track_order(
    request: Request,
    order_number: Optional[str] = Query(default=None, max_length=32),
    email: Optional[str] = Query(default=None, max_length=255),
    token: Optional[str] = Query(default=None, max_length=120),
    db: OrmSession = Depends(get_db),
):
    """Secure lookup. A random tracking token reveals status; an
    order-number+email pair reveals only limited status information."""
    enforce(request, "track", 20, 600)
    if token:
        order = db.scalar(
            select(Order).options(selectinload(Order.items)).where(Order.tracking_token == token)
        )
        if not order:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Tracking link is invalid")
    elif order_number and email:
        order = db.scalar(
            select(Order).options(selectinload(Order.items)).where(
                func.lower(Order.order_number) == order_number.strip().lower(),
                func.lower(Order.customer_email) == email.strip().lower(),
            )
        )
        if not order:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No order matches those details")
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provide a tracking link token, or the order number and email")

    events = db.scalars(
        select(OrderEvent).where(OrderEvent.order_id == order.id).order_by(OrderEvent.created_at)
    ).all()
    limited = not token
    payload = {
        "order_number": order.order_number,
        "status": order.status,
        "payment_status": order.payment_status,
        "fulfillment_type": order.fulfillment_type,
        "placed_at": order.placed_at,
        "total_paise": order.total_paise,
        "item_count": sum(i.quantity for i in order.items),
        "items": [{"title": item.title_snapshot, "quantity": item.quantity} for item in order.items] if not limited else None,
        "events": [
            {"to_status": e.to_status, "type": e.event_type, "note": e.note, "created_at": e.created_at}
            for e in events
            if e.is_customer_visible
        ],
        "carrier": order.shipment.carrier if order.shipment else None,
        "tracking_number": order.shipment.tracking_number if order.shipment else None,
        "customer_email": _mask_email(order.customer_email) if limited else order.customer_email,
        "limited": limited,
        "tracking_token": order.tracking_token if not limited else None,
    }
    return payload


@router.post("/orders/{order_id}/cancel")
def cancel_order(
    order_id: str,
    request: Request,
    payload: dict | None = None,
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
):
    order = _owned_order(db, order_id, user)
    if not _can_cancel(db, order):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This order can no longer be cancelled online. Please contact the store.",
        )
    note = (payload or {}).get("reason") or "Cancelled by customer"
    previous = order.status
    _cancel_order(db, order, reason=str(note)[:1000], actor=user, event_type="cancelled_by_customer")
    db.commit()
    audit(db, "order.cancelled_by_customer", actor=user, entity_type="order", entity_id=order.id, before={"status": previous}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        user,
        "order_cancelled",
        f"Order {order.order_number} cancelled",
        f"Your order {order.order_number} has been cancelled. If you already paid online, the store will process the refund.",
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    return {"order": _customer_order_payload(db, order)}


@router.post("/orders/{order_id}/return-request", status_code=201)
def request_return(
    order_id: str,
    payload: ReturnRequestIn,
    request: Request,
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "return_request", 10, 3600)
    order = _owned_order(db, order_id, user)
    if payload.request_type == "cancellation":
        if not _can_cancel(db, order):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cancellation is not available for this order")
    elif not _can_request_return(db, order):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Return requests are not available for this order")
    existing = db.scalar(
        select(ReturnRequest).where(
            ReturnRequest.order_id == order.id,
            ReturnRequest.status.in_(("requested", "approved")),
        )
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "A request is already open for this order")
    row = ReturnRequest(
        reference=f"RET-{secrets.token_hex(4).upper()}",
        order_id=order.id,
        user_id=user.id,
        request_type=payload.request_type,
        reason=payload.reason,
        status="requested",
    )
    db.add(row)
    db.commit()
    staff = [u for u in db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all()]
    from ..services.notifications import notify_staff

    notify_staff(
        db,
        staff,
        "return_requested",
        f"{payload.request_type.title()} request for {order.order_number}",
        f"{user.full_name} requested a {payload.request_type} for order {order.order_number}: {payload.reason}",
    )
    return {"request": _return_payload(row)}


@router.get("/me/returns")
def my_returns(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(ReturnRequest).where(ReturnRequest.user_id == user.id).order_by(ReturnRequest.created_at.desc())).all()
    return {"returns": [{**_return_payload(r), "order_number": db.get(Order, r.order_id).order_number if db.get(Order, r.order_id) else None} for r in rows]}


@router.get("/orders/{order_id}/document", response_class=HTMLResponse)
def order_document(
    order_id: str,
    kind: str = Query(default="invoice"),
    user: Optional[User] = Depends(get_current_user),
    token: Optional[str] = None,
    db: OrmSession = Depends(get_db),
):
    order = db.scalar(
        select(Order).options(selectinload(Order.items), selectinload(Order.shipment)).where(Order.id == order_id)
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    allowed = (user and (order.user_id == user.id or user.role in ("staff", "admin"))) or (
        token and secrets.compare_digest(token, order.tracking_token)
    )
    if not allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if kind not in ("invoice", "packing-slip"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown document type")
    store = store_settings.get_all(db)
    return HTMLResponse(render_order_document(order, store, kind="invoice" if kind == "invoice" else "packing"))


@router.get("/me/notifications")
def notifications(
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
    limit: int = Query(default=30, ge=1, le=100),
):
    rows = db.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.channel == "in_app").order_by(Notification.created_at.desc()).limit(limit)
    ).all()
    return {
        "notifications": [
            {
                "id": n.id,
                "subject": n.subject,
                "body": n.body,
                "created_at": n.created_at,
                "is_read": n.is_read,
                "related_type": n.related_type,
                "related_id": n.related_id,
            }
            for n in rows
        ]
    }


@router.post("/me/notifications/read")
def mark_notifications_read(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    for row in db.scalars(
        select(Notification).where(Notification.user_id == user.id, Notification.channel == "in_app", Notification.is_read.is_(False))
    ):
        row.is_read = True
    db.commit()
    return {"ok": True}
