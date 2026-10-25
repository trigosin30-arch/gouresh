from __future__ import annotations

from .db import iso
from .models import (
    Address,
    AdminAuditLog,
    Category,
    Order,
    OrderItem,
    OrderStatusEvent,
    Payment,
    Product,
    Profile,
)


def product_out(p: Product, *, include_admin: bool = False) -> dict:
    data = {
        "id": p.id,
        "sku": p.sku,
        "slug": p.slug,
        "name": p.name,
        "description": p.description,
        "category_id": p.category_id,
        "category": (
            {"id": p.category.id, "name": p.category.name, "slug": p.category.slug} if p.category else None
        ),
        "price_paise": p.price_paise,
        "mrp_paise": p.mrp_paise,
        "stock": p.stock,
        "in_stock": p.stock > 0,
        "unit": p.unit,
        "brand": p.brand,
        "isbn": p.isbn,
        "author": p.author,
        "class_level": p.class_level,
        "board": p.board,
        "condition": p.condition,
        "tags": [t.strip() for t in (p.tags or "").split(",") if t.strip()],
        "image_url": p.image_url,
        "is_featured": p.is_featured,
        "sold_count": p.sold_count,
        "created_at": iso(p.created_at),
    }
    if include_admin:
        data.update(
            {
                "is_archived": p.is_archived,
                "updated_at": iso(p.updated_at),
                "stock_value_paise": p.stock * p.price_paise,
            }
        )
    return data


def category_out(c: Category, product_count: int | None = None) -> dict:
    data = {
        "id": c.id,
        "name": c.name,
        "slug": c.slug,
        "description": c.description,
        "image_url": c.image_url,
        "sort_order": c.sort_order,
    }
    if product_count is not None:
        data["product_count"] = product_count
    return data


def profile_out(p: Profile) -> dict:
    return {
        "id": p.id,
        "email": p.email,
        "full_name": p.full_name,
        "phone": p.phone,
        "role": p.role,
        "avatar_url": p.avatar_url,
        "created_at": iso(p.created_at),
        "last_login_at": iso(p.last_login_at),
    }


def address_out(a: Address) -> dict:
    return {
        "id": a.id,
        "label": a.label,
        "contact_name": a.contact_name,
        "phone": a.phone,
        "line1": a.line1,
        "line2": a.line2,
        "locality": a.locality,
        "city": a.city,
        "state": a.state,
        "pincode": a.pincode,
        "is_default": a.is_default,
    }


def order_item_out(i: OrderItem) -> dict:
    return {
        "id": i.id,
        "product_id": i.product_id,
        "sku": i.sku,
        "name": i.name,
        "image_url": i.image_url,
        "unit_price_paise": i.unit_price_paise,
        "quantity": i.quantity,
        "line_total_paise": i.line_total_paise,
    }


def payment_out(p: Payment) -> dict:
    return {
        "id": p.id,
        "provider": p.provider,
        "provider_order_id": p.provider_order_id,
        "provider_payment_id": p.provider_payment_id,
        "amount_paise": p.amount_paise,
        "status": p.status,
        "method": p.method,
        "signature_verified": p.signature_verified,
        "failure_reason": p.failure_reason,
        "created_at": iso(p.created_at),
    }


def status_event_out(e: OrderStatusEvent) -> dict:
    return {
        "id": e.id,
        "status": e.status,
        "note": e.note,
        "created_at": iso(e.created_at),
    }


def order_out(o: Order, *, include_payments: bool = True, customer: Profile | None = None) -> dict:
    data = {
        "id": o.id,
        "order_number": o.order_number,
        "user_id": o.user_id,
        "status": o.status,
        "payment_method": o.payment_method,
        "payment_status": o.payment_status,
        "contact_name": o.contact_name,
        "phone": o.phone,
        "email": o.email,
        "shipping_address": {
            "line1": o.line1,
            "line2": o.line2,
            "locality": o.locality,
            "city": o.city,
            "state": o.state,
            "pincode": o.pincode,
        },
        "notes": o.notes,
        "subtotal_paise": o.subtotal_paise,
        "shipping_paise": o.shipping_paise,
        "discount_paise": o.discount_paise,
        "total_paise": o.total_paise,
        "coupon_code": o.coupon_code,
        "courier": o.courier,
        "tracking_number": o.tracking_number,
        "cancel_reason": o.cancel_reason,
        "items": [order_item_out(i) for i in o.items],
        "events": [status_event_out(e) for e in o.events],
        "created_at": iso(o.created_at),
        "paid_at": iso(o.paid_at),
        "delivered_at": iso(o.delivered_at),
        "updated_at": iso(o.updated_at),
    }
    if include_payments:
        data["payments"] = [payment_out(p) for p in o.payments]
    if customer is not None:
        data["customer"] = profile_out(customer)
    return data


def audit_out(log: AdminAuditLog) -> dict:
    return {
        "id": log.id,
        "actor_id": log.actor_id,
        "actor_email": log.actor_email,
        "action": log.action,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "meta": log.meta,
        "created_at": iso(log.created_at),
    }
