from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..db import get_db, utcnow
from ..models import (
    Address,
    AdminAuditLog,
    Category,
    InventoryMovement,
    Order,
    PaymentEvent,
    Product,
    Profile,
)
from ..schemas import (
    CategoryInput,
    OrderStatusInput,
    ProductInput,
    ProductPatch,
    RoleInput,
    StockAdjustInput,
)
from ..serializers import (
    address_out,
    audit_out,
    category_out,
    order_out,
    product_out,
    profile_out,
)
from ..services import orders as order_service

router = APIRouter(prefix="/admin", tags=["admin"])


def audit(db: Session, actor: Profile, action: str, entity_type: str, entity_id: str | None, meta: dict | None = None):
    db.add(
        AdminAuditLog(
            actor_id=actor.id,
            actor_email=actor.email,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=meta or {},
        )
    )


# ---------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------
@router.get("/stats")
def dashboard(admin: Profile = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    paid_filter = Order.payment_status == "paid"
    revenue = db.scalar(select(func.coalesce(func.sum(Order.total_paise), 0)).where(paid_filter)) or 0
    order_count = db.scalar(select(func.count()).select_from(Order)) or 0
    open_orders = db.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.status.in_(("confirmed", "processing", "packed", "shipped", "out_for_delivery")))
    ) or 0
    low_stock = db.scalars(
        select(Product).where(Product.is_archived.is_(False), Product.stock <= 5).order_by(Product.stock).limit(8)
    ).unique().all()
    recent_orders = db.scalars(select(Order).order_by(Order.created_at.desc()).limit(8)).unique().all()
    status_rows = db.execute(select(Order.status, func.count()).group_by(Order.status)).all()
    top_products = db.scalars(
        select(Product).where(Product.is_archived.is_(False)).order_by(Product.sold_count.desc()).limit(5)
    ).unique().all()
    customers = db.scalar(select(func.count()).select_from(Profile)) or 0

    pending_payments = db.scalar(
        select(func.count()).select_from(Order).where(Order.status == "payment_pending")
    ) or 0

    return {
        "totals": {
            "revenue_paise": int(revenue),
            "orders": order_count,
            "open_orders": open_orders,
            "customers": customers,
            "pending_payments": pending_payments,
            "products": db.scalar(
                select(func.count()).select_from(Product).where(Product.is_archived.is_(False))
            ) or 0,
            "inventory_value_paise": int(
                db.scalar(
                    select(func.coalesce(func.sum(Product.stock * Product.price_paise), 0)).where(
                        Product.is_archived.is_(False)
                    )
                )
                or 0
            ),
        },
        "orders_by_status": {status: count for status, count in status_rows},
        "low_stock": [product_out(p, include_admin=True) for p in low_stock],
        "recent_orders": [order_out(o, include_payments=False) for o in recent_orders],
        "top_products": [product_out(p) for p in top_products],
        "generated_at": utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# products
# ---------------------------------------------------------------------------
@router.get("/products")
def admin_products(
    q: str | None = Query(default=None, max_length=120),
    category_id: str | None = None,
    archived: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Product).where(Product.is_archived.is_(archived))
    count_stmt = select(func.count()).select_from(Product).where(Product.is_archived.is_(archived))
    if q:
        term = f"%{q.lower()}%"
        condition = or_(
            func.lower(Product.name).like(term),
            func.lower(Product.sku).like(term),
            func.lower(func.coalesce(Product.isbn, "")).like(term),
        )
        stmt, count_stmt = stmt.where(condition), count_stmt.where(condition)
    if category_id:
        stmt, count_stmt = stmt.where(Product.category_id == category_id), count_stmt.where(
            Product.category_id == category_id
        )
    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.order_by(Product.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).unique().all()
    return {
        "items": [product_out(p, include_admin=True) for p in rows],
        "total": total,
        "page": page,
        "pages": max((total + page_size - 1) // page_size, 1),
    }


def _validate_category(db: Session, category_id: str | None) -> None:
    if category_id and db.get(Category, category_id) is None:
        raise HTTPException(status_code=422, detail="Unknown category")


@router.post("/products", status_code=201)
def create_product(
    payload: ProductInput,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if db.scalar(select(Product).where(Product.sku == payload.sku)):
        raise HTTPException(status_code=409, detail="A product with this SKU already exists")
    _validate_category(db, payload.category_id)
    data = payload.model_dump()
    slug = data.pop("slug", None) or order_service.unique_slug(db, payload.name)
    if db.scalar(select(Product).where(Product.slug == slug)):
        slug = order_service.unique_slug(db, payload.name)
    product = Product(slug=slug, **data)
    db.add(product)
    db.flush()
    if product.stock:
        db.add(
            InventoryMovement(
                product_id=product.id,
                delta=product.stock,
                reason="initial_stock",
                actor_id=admin.id,
                note="Product created",
            )
        )
    audit(db, admin, "product.create", "product", product.id, {"name": product.name, "sku": product.sku})
    db.commit()
    db.refresh(product)
    return {"product": product_out(product, include_admin=True)}


@router.patch("/products/{product_id}")
def update_product(
    product_id: str,
    payload: ProductPatch,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    changes = payload.model_dump(exclude_unset=True)
    if "category_id" in changes:
        _validate_category(db, changes["category_id"])
    if "sku" in changes and changes["sku"] != product.sku:
        if db.scalar(select(Product).where(Product.sku == changes["sku"], Product.id != product.id)):
            raise HTTPException(status_code=409, detail="A product with this SKU already exists")
    if "slug" in changes and changes["slug"]:
        if db.scalar(select(Product).where(Product.slug == changes["slug"], Product.id != product.id)):
            raise HTTPException(status_code=409, detail="That URL slug is already in use")
    # Slugs are only generated at creation time: renaming a product must not
    # silently break links people already have (send `slug` to change it).
    stock_before = product.stock
    for field, value in changes.items():
        setattr(product, field, value)
    if product.stock != stock_before:
        db.add(
            InventoryMovement(
                product_id=product.id,
                delta=product.stock - stock_before,
                reason="admin_edit",
                actor_id=admin.id,
                note="Stock changed while editing product",
            )
        )
    audit(db, admin, "product.update", "product", product.id, {"fields": sorted(changes)})
    db.commit()
    db.refresh(product)
    return {"product": product_out(product, include_admin=True)}


@router.post("/products/{product_id}/stock")
def adjust_stock(
    product_id: str,
    payload: StockAdjustInput,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.stock + payload.delta < 0:
        raise HTTPException(status_code=409, detail="Stock cannot go below zero")
    product.stock += payload.delta
    db.add(
        InventoryMovement(
            product_id=product.id,
            delta=payload.delta,
            reason="admin_adjustment",
            actor_id=admin.id,
            note=payload.note,
        )
    )
    audit(db, admin, "product.stock", "product", product.id, {"delta": payload.delta})
    db.commit()
    db.refresh(product)
    return {"product": product_out(product, include_admin=True)}


@router.post("/products/{product_id}/archive")
def archive_product(
    product_id: str, admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_archived = True
    audit(db, admin, "product.archive", "product", product.id, {"name": product.name})
    db.commit()
    return {"ok": True}


@router.post("/products/{product_id}/restore")
def restore_product(
    product_id: str, admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_archived = False
    audit(db, admin, "product.restore", "product", product.id, {"name": product.name})
    db.commit()
    return {"ok": True}


@router.get("/products/{product_id}/movements")
def product_movements(
    product_id: str, admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    rows = db.scalars(
        select(InventoryMovement)
        .where(InventoryMovement.product_id == product_id)
        .order_by(InventoryMovement.created_at.desc())
        .limit(50)
    ).all()
    from ..db import iso

    return {
        "items": [
            {
                "id": m.id,
                "delta": m.delta,
                "reason": m.reason,
                "order_id": m.order_id,
                "note": m.note,
                "created_at": iso(m.created_at),
            }
            for m in rows
        ]
    }


# ---------------------------------------------------------------------------
# categories
# ---------------------------------------------------------------------------
@router.post("/categories", status_code=201)
def create_category(
    payload: CategoryInput, admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    slug = payload.slug or "".join(c if c.isalnum() else "-" for c in payload.name.lower()).strip("-")
    if db.scalar(select(Category).where(or_(Category.slug == slug, Category.name == payload.name))):
        raise HTTPException(status_code=409, detail="That category already exists")
    category = Category(
        name=payload.name, slug=slug, description=payload.description,
        image_url=payload.image_url, sort_order=payload.sort_order,
    )
    db.add(category)
    audit(db, admin, "category.create", "category", category.id, {"name": category.name})
    db.commit()
    db.refresh(category)
    return {"category": category_out(category)}


@router.patch("/categories/{category_id}")
def update_category(
    category_id: str,
    payload: CategoryInput,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    category.name = payload.name
    category.description = payload.description
    category.image_url = payload.image_url
    category.sort_order = payload.sort_order
    if payload.slug:
        category.slug = payload.slug
    audit(db, admin, "category.update", "category", category.id, {"name": category.name})
    db.commit()
    return {"category": category_out(category)}


# ---------------------------------------------------------------------------
# orders
# ---------------------------------------------------------------------------
@router.get("/orders")
def admin_orders(
    status: str | None = None,
    q: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Order)
    count_stmt = select(func.count()).select_from(Order)
    if status and status != "all":
        stmt, count_stmt = stmt.where(Order.status == status), count_stmt.where(Order.status == status)
    if q:
        term = f"%{q.lower()}%"
        condition = or_(
            func.lower(Order.order_number).like(term),
            func.lower(Order.contact_name).like(term),
            func.lower(Order.email).like(term),
            Order.phone.like(f"%{q}%"),
        )
        stmt, count_stmt = stmt.where(condition), count_stmt.where(condition)
    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).unique().all()
    return {
        "items": [order_out(o, include_payments=False) for o in rows],
        "total": total,
        "page": page,
        "pages": max((total + page_size - 1) // page_size, 1),
    }


@router.get("/orders/{order_ref}")
def admin_order_detail(
    order_ref: str, admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    order = db.scalar(select(Order).where(or_(Order.id == order_ref, Order.order_number == order_ref)))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    customer = db.get(Profile, order.user_id)
    data = order_out(order, customer=customer)
    data["timeline"] = order_service.progress(order)
    allowed = set(order_service.ALLOWED_TRANSITIONS.get(order.status, set()))
    if order.payment_status == "paid" and order.status == "delivered":
        allowed.add("refunded")
    if order.payment_status not in ("paid", "refund_due"):
        allowed.discard("refunded")
    data["allowed_transitions"] = sorted(allowed)
    return {"order": data}


@router.post("/orders/{order_ref}/status")
def change_order_status(
    order_ref: str,
    payload: OrderStatusInput,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    order = db.scalar(select(Order).where(or_(Order.id == order_ref, Order.order_number == order_ref)))
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    updated = order_service.update_status(
        db,
        order,
        new_status=payload.status,
        note=payload.note,
        courier=payload.courier,
        tracking_number=payload.tracking_number,
        cancel_reason=payload.cancel_reason,
        actor=admin,
    )
    audit(
        db, admin, "order.status", "order", updated.id,
        {"from": payload.status, "note": payload.note, "tracking": payload.tracking_number},
    )
    db.commit()
    db.refresh(updated)
    data = order_out(updated, include_payments=True)
    data["timeline"] = order_service.progress(updated)
    allowed = set(order_service.ALLOWED_TRANSITIONS.get(updated.status, set()))
    if updated.payment_status not in ("paid", "refund_due"):
        allowed.discard("refunded")
    data["allowed_transitions"] = sorted(allowed)
    return {"order": data}


# ---------------------------------------------------------------------------
# customers, payments, audit
# ---------------------------------------------------------------------------
@router.get("/users")
def list_users(
    q: str | None = Query(default=None, max_length=120),
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Profile).order_by(Profile.created_at.desc()).limit(200)
    if q:
        term = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Profile.email).like(term), func.lower(Profile.full_name).like(term)))
    rows = db.scalars(stmt).all()
    counts = dict(
        db.execute(select(Order.user_id, func.count()).group_by(Order.user_id)).all()
    )
    return {
        "items": [{**profile_out(p), "order_count": counts.get(p.id, 0)} for p in rows],
    }


@router.get("/users/{user_id}")
def user_detail(
    user_id: str, admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    profile = db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    addresses = db.scalars(select(Address).where(Address.user_id == user_id)).all()
    orders = db.scalars(
        select(Order).where(Order.user_id == user_id).order_by(Order.created_at.desc()).limit(50)
    ).unique().all()
    return {
        "profile": profile_out(profile),
        "addresses": [address_out(a) for a in addresses],
        "orders": [order_out(o, include_payments=False) for o in orders],
    }


@router.patch("/users/{user_id}/role")
def set_role(
    user_id: str,
    payload: RoleInput,
    admin: Profile = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    if admin.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can change roles")
    profile = db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    if profile.id == admin.id and payload.role != "admin":
        raise HTTPException(status_code=409, detail="You cannot remove your own admin role")
    if profile.role == "admin" and payload.role != "admin":
        remaining = db.scalar(
            select(func.count()).select_from(Profile).where(Profile.role == "admin", Profile.id != profile.id)
        )
        if not remaining:
            raise HTTPException(status_code=409, detail="At least one admin must remain")
    before = profile.role
    profile.role = payload.role
    audit(db, admin, "user.role", "profile", profile.id, {"from": before, "to": payload.role})
    db.commit()
    return {"profile": profile_out(profile)}


@router.get("/payment-events")
def payment_events(
    admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    from ..db import iso

    rows = db.scalars(select(PaymentEvent).order_by(PaymentEvent.created_at.desc()).limit(50)).all()
    return {
        "items": [
            {
                "id": e.id,
                "event_id": e.event_id,
                "event_type": e.event_type,
                "processed": e.processed,
                "note": e.note,
                "created_at": iso(e.created_at),
            }
            for e in rows
        ]
    }


@router.get("/audit-logs")
def audit_logs(
    admin: Profile = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    rows = db.scalars(select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(100)).all()
    return {"items": [audit_out(log) for log in rows]}
