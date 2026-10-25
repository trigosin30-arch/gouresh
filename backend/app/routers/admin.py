"""Access-controlled administration API.

Every route here depends on :func:`require_staff` or :func:`require_admin`;
hiding the admin UI is never the control. Mutating actions are written to the
audit log with actor, entity and before/after snapshots.
"""
from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as OrmSession, selectinload

from ..config import settings
from ..constants import (
    BOARDS,
    BOOK_TYPES,
    CONDITIONS,
    LISTING_STATUSES,
    ORDER_STATUS_LABELS,
    ORDER_STATUSES,
    ORDER_TRANSITIONS,
    QUOTATION_STATUSES,
    RETURN_TYPE_LABELS,
)
from ..db import get_db, now
from ..models import (
    Address,
    AuditLog,
    Banner,
    BookSubmission,
    BulkQuotation,
    Cart,
    Category,
    CommissionRecord,
    ContactMessage,
    Coupon,
    CouponRedemption,
    Faq,
    InventoryMovement,
    InventoryReservation,
    Listing,
    ListingImage,
    ListingReport,
    Notification,
    Order,
    OrderEvent,
    OrderItem,
    Payment,
    Payout,
    Product,
    ProductImage,
    QuotationItem,
    ReturnRequest,
    Session,
    Shipment,
    User,
)
from ..schemas import (
    BannerIn,
    CategoryIn,
    CouponIn,
    FaqIn,
    ListingModerationIn,
    OrderNoteIn,
    OrderStatusIn,
    PayoutIn,
    ProductIn,
    QuotationQuoteIn,
    RefundIn,
    ReturnDecisionIn,
    SettingsIn,
    StockAdjustIn,
    SubmissionReviewIn,
)
from ..security import require_admin, require_staff
from ..serializers import product_admin, user_public
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.commerce import (
    add_event,
    assert_transition,
    bp_of,
    commit_stock,
    confirm_online_payment,
    generate_order_number,
    order_public,
    release_stock,
    sales_metrics,
)
from ..services.documents import render_order_document
from ..services.notifications import notify_staff, notify_user
from ..services.rate_limit import client_ip

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:150] or "item"


def _unique_slug(db: OrmSession, base: str, model) -> str:
    candidate = base
    while db.scalar(select(model.id).where(model.slug == candidate)):
        candidate = f"{base[:140]}-{secrets.token_hex(2)}"
    return candidate


def _paginate(db: OrmSession, query, page: int, per_page: int):
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    rows = db.scalars(query.offset((page - 1) * per_page).limit(per_page)).all()
    return rows, int(total), max(1, (int(total) + per_page - 1) // per_page)


def _product_dict(product: Product) -> dict:
    return {
        "id": product.id,
        "title": product.title,
        "slug": product.slug,
        "sku": product.sku,
        "isbn": product.isbn,
        "price_paise": product.price_paise,
        "compare_at_price_paise": product.compare_at_price_paise,
        "cost_paise": product.cost_paise,
        "stock_qty": product.stock_qty,
        "low_stock_threshold": product.low_stock_threshold,
        "status": product.status,
        "product_type": product.product_type,
        "condition": product.condition,
        "is_featured": product.is_featured,
        "category_id": product.category_id,
        "board": product.board,
        "class_level": product.class_level,
        "subject": product.subject,
        "book_type": product.book_type,
        "tax_rate_bp": product.tax_rate_bp,
    }


def _validate_image_urls(urls: list[str]) -> None:
    for url in urls:
        if not (url.startswith("/uploads/") or url.startswith("https://")):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Images must be uploaded files or https URLs")


def _set_product_images(db: OrmSession, product: Product, urls: list[str]) -> None:
    _validate_image_urls(urls)
    existing = {img.url: img for img in product.images}
    for url, img in list(existing.items()):
        if url not in urls:
            db.delete(img)
    for index, url in enumerate(urls):
        if url in existing:
            existing[url].sort_order = index
        else:
            db.add(ProductImage(product_id=product.id, url=url, alt_text=product.title, sort_order=index))


# ---------------------------------------------------------------------------
# dashboard
# ---------------------------------------------------------------------------
@router.get("/dashboard")
def dashboard(
    range: str = Query(default="30d", pattern="^(today|7d|30d|90d|all)$"),
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    from ..services.commerce import release_expired_reservations

    release_expired_reservations(db)

    start = None
    if range != "all":
        days = {"today": 1, "7d": 7, "30d": 30, "90d": 90}[range]
        start = now() - timedelta(days=days)
    metrics = sales_metrics(db, start=start)

    status_rows = db.execute(select(Order.status, func.count(Order.id)).group_by(Order.status)).all()
    by_status = {s: int(c) for s, c in status_rows}
    actionable = sum(by_status.get(s, 0) for s in ("placed", "processing", "packed"))

    payment_rows = db.execute(select(Payment.status, func.count(Payment.id), func.coalesce(func.sum(Payment.amount_paise), 0)).group_by(Payment.status)).all()
    payments = {s: {"count": int(c), "amount_paise": int(a)} for s, c, a in payment_rows}

    product_total = db.scalar(select(func.count(Product.id)).where(Product.status == "active")) or 0
    low_stock = db.scalar(
        select(func.count(Product.id)).where(
            Product.status == "active", Product.stock_qty > 0, Product.stock_qty <= Product.low_stock_threshold
        )
    ) or 0
    out_of_stock = db.scalar(
        select(func.count(Product.id)).where(Product.status == "active", or_(Product.stock_qty <= 0, Product.is_enquiry_only.is_(True)))
    ) or 0
    pending_submissions = db.scalar(
        select(func.count(BookSubmission.id)).where(BookSubmission.status.in_(("submitted", "under_review", "details_requested")))
    ) or 0
    pending_listings = db.scalar(select(func.count(Listing.id)).where(Listing.status == "pending_review")) or 0
    active_listings = db.scalar(select(func.count(Listing.id)).where(Listing.status == "active")) or 0
    open_reports = db.scalar(select(func.count(ListingReport.id)).where(ListingReport.status == "open")) or 0
    new_quotes = db.scalar(select(func.count(BulkQuotation.id)).where(BulkQuotation.status.in_(("submitted", "under_review")))) or 0
    open_returns = db.scalar(select(func.count(ReturnRequest.id)).where(ReturnRequest.status.in_(("requested", "approved")))) or 0
    customers = db.scalar(select(func.count(User.id)).where(User.role == "customer")) or 0
    recent = db.scalars(select(Order).options(selectinload(Order.items)).order_by(Order.created_at.desc()).limit(6)).all()

    public = store_settings.get_all(db)
    setup = {
        "store_phone_set": bool(public.get("store_phone")),
        "opening_hours_set": bool(public.get("store_opening_hours")),
        "contact_email_set": bool(public.get("store_email")),
        "delivery_configured": bool(public.get("delivery_enabled") and public.get("delivery_pincodes")),
        "cod_enabled": bool(public.get("cod_enabled")),
        "online_payments_configured": settings.online_payments_available,
        "email_provider_configured": bool(settings.smtp_host and settings.smtp_from),
        "demo_mode": bool(public.get("demo_mode")),
    }

    return {
        "range": range,
        "metrics": metrics,
        "orders": {
            "by_status": by_status,
            "total": sum(by_status.values()),
            "needs_action": actionable,
        },
        "payments": payments,
        "catalogue": {
            "active_products": int(product_total),
            "low_stock": int(low_stock),
            "out_of_stock": int(out_of_stock),
            "draft_products": int(db.scalar(select(func.count(Product.id)).where(Product.status == "draft")) or 0),
        },
        "marketplace": {
            "pending_submissions": int(pending_submissions),
            "pending_listings": int(pending_listings),
            "active_listings": int(active_listings),
            "open_reports": int(open_reports),
        },
        "quotations": {"awaiting_quote": int(new_quotes)},
        "returns": {"open": int(open_returns)},
        "customers": int(customers),
        "recent_orders": [order_public(o) for o in recent],
        "setup": setup,
        "definitions": {
            "net_revenue": "Paid money on non-cancelled orders, minus recorded refunds. Unpaid and cancelled orders are excluded.",
            "needs_action": "Orders in placed, processing or packed state that staff still have to fulfil.",
        },
    }


# ---------------------------------------------------------------------------
# products
# ---------------------------------------------------------------------------
@router.get("/products")
def list_products(
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
    q: Optional[str] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    category_id: Optional[str] = None,
    low_stock: bool = False,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
):
    query = select(Product).options(selectinload(Product.images), selectinload(Product.category))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(Product.title.ilike(like), Product.sku.ilike(like), Product.isbn.ilike(like), Product.author.ilike(like))
        )
    if status_filter:
        query = query.where(Product.status == status_filter)
    if category_id:
        query = query.where(Product.category_id == category_id)
    if low_stock:
        query = query.where(Product.stock_qty <= Product.low_stock_threshold)
    rows, total, pages = _paginate(db, query.order_by(Product.created_at.desc()), page, per_page)
    return {"items": [product_admin(db, p) for p in rows], "total": total, "page": page, "pages": pages}


def _product_from_payload(payload: ProductIn, db: OrmSession) -> dict:
    category = db.get(Category, payload.category_id)
    if not category:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a valid category")
    if payload.compare_at_price_paise is not None and payload.compare_at_price_paise < payload.price_paise:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Compare-at price must be greater than or equal to the selling price")
    if payload.product_type == "new" and payload.condition != "new":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New products must have condition 'new'")
    data = payload.model_dump(exclude={"image_urls"})
    return data


@router.post("/products", status_code=201)
def create_product(
    payload: ProductIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    data = _product_from_payload(payload, db)
    if data.get("sku") and db.scalar(select(Product.id).where(Product.sku == data["sku"])):
        raise HTTPException(status.HTTP_409_CONFLICT, "That SKU is already in use")
    product = Product(**data, slug=_unique_slug(db, _slugify(payload.title), Product), created_by=admin.id)
    db.add(product)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Duplicate SKU or slug")
    _set_product_images(db, product, payload.image_urls)
    db.add(InventoryMovement(product_id=product.id, delta=product.stock_qty, balance_after=product.stock_qty, reason="initial", actor_user_id=admin.id))
    db.commit()
    audit(db, "product.created", actor=admin, entity_type="product", entity_id=product.id, after=_product_dict(product), ip_address=client_ip(request), commit=True)
    return {"product": product_admin(db, product)}


@router.get("/products/export", response_class=PlainTextResponse)
def export_products(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["title", "slug", "sku", "isbn", "category", "price_rupees", "compare_at_rupees", "cost_rupees", "stock", "status", "product_type", "condition", "author", "publisher", "board", "class_level", "subject", "book_type", "edition", "language", "publication_year", "academic_year", "description"]
    )
    for p in db.scalars(select(Product).options(selectinload(Product.category)).order_by(Product.created_at)).all():
        writer.writerow(
            [
                p.title,
                p.slug,
                p.sku or "",
                p.isbn or "",
                p.category.slug if p.category else "",
                f"{p.price_paise / 100:.2f}",
                f"{(p.compare_at_price_paise or 0) / 100:.2f}" if p.compare_at_price_paise else "",
                f"{(p.cost_paise or 0) / 100:.2f}" if p.cost_paise else "",
                p.stock_qty,
                p.status,
                p.product_type,
                p.condition,
                p.author or "",
                p.publisher or "",
                p.board or "",
                p.class_level or "",
                p.subject or "",
                p.book_type or "",
                p.edition or "",
                p.language or "",
                p.publication_year or "",
                p.academic_year or "",
                (p.description or "").replace("\n", " "),
            ]
        )
    return PlainTextResponse(
        buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=products.csv"},
    )


@router.post("/products/import")
def import_products(
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    raw = file.file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "CSV must be smaller than 2 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV must be UTF-8 encoded")
    reader = csv.DictReader(io.StringIO(text))
    required = {"title", "category", "price_rupees", "stock"}
    if not reader.fieldnames or not required.issubset({f.strip() for f in reader.fieldnames}):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"CSV must include columns: {', '.join(sorted(required))}")

    categories = {c.slug: c for c in db.scalars(select(Category)).all()}
    created = updated = 0
    errors: list[dict] = []
    for index, row in enumerate(reader, start=2):
        try:
            title = (row.get("title") or "").strip()
            if len(title) < 2:
                raise ValueError("title is required")
            category = categories.get((row.get("category") or "").strip())
            if not category:
                raise ValueError("unknown category slug")
            try:
                price = int(round(float(row.get("price_rupees") or 0) * 100))
                stock = int(row.get("stock") or 0)
            except ValueError:
                raise ValueError("price_rupees and stock must be numeric")
            if price < 0 or stock < 0:
                raise ValueError("price and stock cannot be negative")
            sku = (row.get("sku") or "").strip() or None
            existing = None
            if sku:
                existing = db.scalar(select(Product).where(Product.sku == sku))
            if not existing:
                existing = db.scalar(select(Product).where(Product.title == title, Product.category_id == category.id))
            def money(key: str):
                value = (row.get(key) or "").strip()
                return int(round(float(value) * 100)) if value else None

            product_status = (row.get("status") or "draft").strip()
            if product_status not in ("draft", "active", "archived"):
                raise ValueError("status must be draft, active or archived")
            board = (row.get("board") or "").strip() or None
            if board and board not in BOARDS:
                raise ValueError(f"board must be one of {', '.join(BOARDS)}")
            book_type = (row.get("book_type") or "").strip() or None
            if book_type and book_type not in BOOK_TYPES:
                raise ValueError("invalid book_type")

            if existing:
                if not dry_run:
                    existing.price_paise = price
                    existing.stock_qty = stock
                    existing.status = product_status
                    existing.compare_at_price_paise = money("compare_at_rupees")
                    existing.cost_paise = money("cost_rupees")
                    existing.isbn = (row.get("isbn") or "").strip() or existing.isbn
                    existing.author = (row.get("author") or "").strip() or existing.author
                    existing.publisher = (row.get("publisher") or "").strip() or existing.publisher
                    existing.board = board or existing.board
                    existing.class_level = (row.get("class_level") or "").strip() or existing.class_level
                    existing.subject = (row.get("subject") or "").strip() or existing.subject
                    existing.book_type = book_type or existing.book_type
                    existing.description = (row.get("description") or "").strip() or existing.description
                updated += 1
            else:
                if not dry_run:
                    product = Product(
                        title=title,
                        slug=_unique_slug(db, _slugify(title), Product),
                        category_id=category.id,
                        sku=sku,
                        isbn=(row.get("isbn") or "").strip() or None,
                        price_paise=price,
                        compare_at_price_paise=money("compare_at_rupees"),
                        cost_paise=money("cost_rupees"),
                        stock_qty=stock,
                        status=product_status,
                        product_type=(row.get("product_type") or "new").strip() or "new",
                        condition=(row.get("condition") or "new").strip() or "new",
                        author=(row.get("author") or "").strip() or None,
                        publisher=(row.get("publisher") or "").strip() or None,
                        board=board,
                        class_level=(row.get("class_level") or "").strip() or None,
                        subject=(row.get("subject") or "").strip() or None,
                        book_type=book_type,
                        edition=(row.get("edition") or "").strip() or None,
                        language=(row.get("language") or "").strip() or None,
                        description=(row.get("description") or "").strip() or None,
                        created_by=admin.id,
                    )
                    if product.condition not in CONDITIONS or product.product_type not in ("new", "used"):
                        raise ValueError("invalid product_type or condition")
                    db.add(product)
                    db.flush()
                    db.add(InventoryMovement(product_id=product.id, delta=stock, balance_after=stock, reason="import", actor_user_id=admin.id))
                created += 1
        except ValueError as exc:
            errors.append({"row": index, "error": str(exc)})
    if not dry_run:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Import failed: duplicate SKU or slug in the file")
        audit(db, "product.imported", actor=admin, entity_type="product", after={"created": created, "updated": updated, "errors": len(errors)}, ip_address=client_ip(request), commit=True)
    return {"dry_run": dry_run, "created": created, "updated": updated, "errors": errors, "committed": not dry_run}


@router.get("/products/{product_id}")
def get_product(product_id: str, staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    product = db.scalar(
        select(Product).options(selectinload(Product.images), selectinload(Product.category)).where(Product.id == product_id)
    )
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    movements = db.scalars(
        select(InventoryMovement).where(InventoryMovement.product_id == product.id).order_by(InventoryMovement.created_at.desc()).limit(50)
    ).all()
    data = product_admin(db, product)
    data["inventory_movements"] = [
        {"id": m.id, "delta": m.delta, "balance_after": m.balance_after, "reason": m.reason, "note": m.note, "created_at": m.created_at}
        for m in movements
    ]
    return {"product": data}


@router.put("/products/{product_id}")
def update_product(
    product_id: str,
    payload: ProductIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    product = db.scalar(
        select(Product).options(selectinload(Product.images), selectinload(Product.category)).where(Product.id == product_id)
    )
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    before = _product_dict(product)
    data = _product_from_payload(payload, db)
    if data.get("sku") and data["sku"] != product.sku:
        if db.scalar(select(Product.id).where(Product.sku == data["sku"], Product.id != product.id)):
            raise HTTPException(status.HTTP_409_CONFLICT, "That SKU is already in use")
    stock_delta = data["stock_qty"] - product.stock_qty
    for field, value in data.items():
        setattr(product, field, value)
    _set_product_images(db, product, payload.image_urls)
    if stock_delta:
        db.add(
            InventoryMovement(
                product_id=product.id,
                delta=stock_delta,
                balance_after=product.stock_qty,
                reason="admin_adjustment",
                note="Edited on product form",
                actor_user_id=admin.id,
            )
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Duplicate SKU")
    audit(db, "product.updated", actor=admin, entity_type="product", entity_id=product.id, before=before, after=_product_dict(product), ip_address=client_ip(request), commit=True)
    return {"product": product_admin(db, product)}


@router.post("/products/{product_id}/stock")
def adjust_stock(
    product_id: str,
    payload: StockAdjustIn,
    request: Request,
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    if payload.delta == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a non-zero adjustment")
    if payload.delta > 0:
        release_stock(db, product.id, payload.delta, reference_type="manual", reference_id=staff.id, actor_id=staff.id, reason="manual_add")
    else:
        try:
            commit_stock(db, product.id, -payload.delta, reference_type="manual", reference_id=staff.id, actor_id=staff.id, reason="manual_remove")
        except HTTPException:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Adjustment would make stock negative")
    db.commit()
    db.refresh(product)
    audit(db, "product.stock_adjusted", actor=staff, entity_type="product", entity_id=product.id, after={"delta": payload.delta, "balance": product.stock_qty, "note": payload.note}, ip_address=client_ip(request), commit=True)
    return {"product": product_admin(db, product)}


@router.delete("/products/{product_id}")
def delete_product(
    product_id: str,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    referenced = db.scalar(select(func.count(OrderItem.id)).where(OrderItem.product_id == product.id)) or 0
    if referenced:
        before = product.status
        product.status = "archived"
        db.commit()
        audit(db, "product.archived", actor=admin, entity_type="product", entity_id=product.id, before={"status": before}, after={"status": "archived", "reason": "referenced_by_orders"}, ip_address=client_ip(request), commit=True)
        return {"archived": True, "message": "This product appears in past orders, so it was archived instead of deleted."}
    for image in list(product.images):
        db.delete(image)
    db.delete(product)
    db.commit()
    audit(db, "product.deleted", actor=admin, entity_type="product", entity_id=product_id, ip_address=client_ip(request), commit=True)
    return {"archived": False, "deleted": True}


# ---------------------------------------------------------------------------
# categories, banners, faqs
# ---------------------------------------------------------------------------
@router.get("/categories")
def admin_categories(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.execute(
        select(Category, func.count(Product.id)).outerjoin(Product, Product.category_id == Category.id).group_by(Category.id).order_by(Category.sort_order)
    ).all()
    return {
        "categories": [
            {
                "id": c.id,
                "slug": c.slug,
                "name": c.name,
                "description": c.description,
                "image_url": c.image_url,
                "sort_order": c.sort_order,
                "is_active": c.is_active,
                "is_system": c.is_system,
                "product_count": int(count or 0),
            }
            for c, count in rows
        ]
    }


@router.post("/categories", status_code=201)
def create_category(payload: CategoryIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    slug = payload.slug or _slugify(payload.name)
    if db.scalar(select(Category.id).where(Category.slug == slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A category with that slug already exists")
    category = Category(**payload.model_dump(exclude={"slug"}), slug=slug)
    db.add(category)
    db.commit()
    audit(db, "category.created", actor=admin, entity_type="category", entity_id=category.id, after=payload.model_dump(), commit=True)
    return {"category": {"id": category.id, "slug": category.slug, "name": category.name}}


@router.put("/categories/{category_id}")
def update_category(category_id: str, payload: CategoryIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    if category.is_system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "System categories cannot be edited")
    for field, value in payload.model_dump(exclude={"slug"}).items():
        setattr(category, field, value)
    if payload.slug and payload.slug != category.slug:
        if db.scalar(select(Category.id).where(Category.slug == payload.slug, Category.id != category.id)):
            raise HTTPException(status.HTTP_409_CONFLICT, "Slug already in use")
        category.slug = payload.slug
    db.commit()
    audit(db, "category.updated", actor=admin, entity_type="category", entity_id=category.id, after=payload.model_dump(), commit=True)
    return {"ok": True}


@router.delete("/categories/{category_id}")
def delete_category(category_id: str, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    if category.is_system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "System categories cannot be deleted")
    count = db.scalar(select(func.count(Product.id)).where(Product.category_id == category.id)) or 0
    if count:
        raise HTTPException(status.HTTP_409_CONFLICT, "Move or archive the products in this category first")
    db.delete(category)
    db.commit()
    audit(db, "category.deleted", actor=admin, entity_type="category", entity_id=category_id, commit=True)
    return {"ok": True}


@router.get("/banners")
def admin_banners(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(Banner).order_by(Banner.sort_order)).all()
    return {
        "banners": [
            {
                "id": b.id,
                "title": b.title,
                "subtitle": b.subtitle,
                "image_url": b.image_url,
                "cta_label": b.cta_label,
                "cta_url": b.cta_url,
                "theme": b.theme,
                "sort_order": b.sort_order,
                "is_active": b.is_active,
            }
            for b in rows
        ]
    }


@router.post("/banners", status_code=201)
def create_banner(payload: BannerIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    banner = Banner(**payload.model_dump())
    db.add(banner)
    db.commit()
    audit(db, "banner.created", actor=admin, entity_type="banner", entity_id=banner.id, after=payload.model_dump(), commit=True)
    return {"id": banner.id}


@router.put("/banners/{banner_id}")
def update_banner(banner_id: str, payload: BannerIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    banner = db.get(Banner, banner_id)
    if not banner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Banner not found")
    for field, value in payload.model_dump().items():
        setattr(banner, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/banners/{banner_id}")
def delete_banner(banner_id: str, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    banner = db.get(Banner, banner_id)
    if not banner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Banner not found")
    db.delete(banner)
    db.commit()
    audit(db, "banner.deleted", actor=admin, entity_type="banner", entity_id=banner_id, commit=True)
    return {"ok": True}


@router.get("/faqs")
def admin_faqs(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(Faq).order_by(Faq.sort_order)).all()
    return {
        "faqs": [
            {"id": f.id, "question": f.question, "answer": f.answer, "category": f.category, "sort_order": f.sort_order, "is_active": f.is_active}
            for f in rows
        ]
    }


@router.post("/faqs", status_code=201)
def create_faq(payload: FaqIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    faq = Faq(**payload.model_dump())
    db.add(faq)
    db.commit()
    return {"id": faq.id}


@router.put("/faqs/{faq_id}")
def update_faq(faq_id: str, payload: FaqIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    faq = db.get(Faq, faq_id)
    if not faq:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "FAQ not found")
    for field, value in payload.model_dump().items():
        setattr(faq, field, value)
    db.commit()
    return {"ok": True}


@router.delete("/faqs/{faq_id}")
def delete_faq(faq_id: str, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    faq = db.get(Faq, faq_id)
    if not faq:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "FAQ not found")
    db.delete(faq)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------
@router.get("/settings")
def get_settings(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    values = store_settings.get_all(db)
    schema = {
        key: {"group": meta[2], "label": meta[4], "type": meta[0].__name__, "public": meta[3]}
        for key, meta in store_settings.SETTING_SCHEMA.items()
    }
    return {
        "settings": values,
        "schema": schema,
        "capabilities": {
            "online_payments_configured": settings.online_payments_available,
            "email_configured": bool(settings.smtp_host and settings.smtp_from),
            "environment": settings.env,
        },
    }


@router.put("/settings")
def update_settings(payload: SettingsIn, request: Request, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    before = store_settings.get_all(db)
    try:
        after = store_settings.set_many(db, payload.values, actor_id=admin.id)
    except store_settings.SettingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    changed = {k: v for k, v in payload.values.items() if before.get(k) != v}
    audit(db, "settings.updated", actor=admin, entity_type="settings", before={k: before.get(k) for k in changed}, after=changed, ip_address=client_ip(request), commit=True)
    if changed.get("online_payments_enabled") and not settings.online_payments_available:
        return {"settings": after, "warning": "Online payments were requested but gateway credentials are not configured, so they stay disabled."}
    return {"settings": after}


# ---------------------------------------------------------------------------
# orders
# ---------------------------------------------------------------------------
@router.get("/orders")
def admin_orders(
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
    q: Optional[str] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    payment_status: Optional[str] = None,
    order_type: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
):
    query = select(Order).options(selectinload(Order.items))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(Order.order_number.ilike(like), Order.customer_email.ilike(like), Order.customer_phone.ilike(like), Order.customer_name.ilike(like))
        )
    if status_filter:
        query = query.where(Order.status == status_filter)
    if payment_status:
        query = query.where(Order.payment_status == payment_status)
    if order_type:
        query = query.where(Order.order_type == order_type)
    if date_from:
        query = query.where(Order.placed_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc))
    if date_to:
        query = query.where(Order.placed_at <= datetime.combine(date_to, datetime.max.time(), tzinfo=timezone.utc))
    rows, total, pages = _paginate(db, query.order_by(Order.created_at.desc()), page, per_page)

    def _row(order: Order) -> dict:
        data = order_public(order)
        data["customer_name"] = order.customer_name
        data["customer_email"] = order.customer_email
        data["customer_phone"] = order.customer_phone
        return data

    return {
        "orders": [_row(o) for o in rows],
        "total": total,
        "page": page,
        "pages": pages,
        "statuses": list(ORDER_STATUSES),
        "status_labels": ORDER_STATUS_LABELS,
    }


def _admin_order(db: OrmSession, order_id: str) -> Order:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.events), selectinload(Order.payments), selectinload(Order.shipment))
        .where(Order.id == order_id)
    )
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


def _admin_order_payload(db: OrmSession, order: Order) -> dict:
    data = order_public(order)
    data.update(
        {
            "customer_name": order.customer_name,
            "customer_email": order.customer_email,
            "customer_phone": order.customer_phone,
            "internal_note": order.internal_note,
            "refunded_paise": order.refunded_paise,
            "coupon_code": order.coupon_code,
            "stock_committed": order.stock_committed,
            "payments": [
                {
                    "id": p.id,
                    "method": p.method,
                    "status": p.status,
                    "amount_paise": p.amount_paise,
                    "provider": p.gateway,
                    "provider_reference": p.provider_reference,
                    "failure_reason": p.failure_reason,
                    "created_at": p.created_at,
                }
                for p in order.payments
            ],
            "events": [
                {
                    "id": e.id,
                    "type": e.event_type,
                    "from_status": e.from_status,
                    "to_status": e.to_status,
                    "note": e.note,
                    "actor": e.actor_label,
                    "visible": e.is_customer_visible,
                    "created_at": e.created_at,
                }
                for e in order.events
            ],
            "next_statuses": list(ORDER_TRANSITIONS.get(order.status, ())),
            "return_requests": [
                {
                    "id": r.id,
                    "reference": r.reference,
                    "request_type": r.request_type,
                    "reason": r.reason,
                    "status": r.status,
                    "admin_note": r.admin_note,
                    "refund_amount_paise": r.refund_amount_paise,
                    "created_at": r.created_at,
                }
                for r in db.scalars(select(ReturnRequest).where(ReturnRequest.order_id == order.id)).all()
            ],
        }
    )
    return data


@router.get("/orders/{order_id}")
def admin_order_detail(order_id: str, staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    return {"order": _admin_order_payload(db, _admin_order(db, order_id))}


@router.post("/orders/{order_id}/status")
def update_order_status(
    order_id: str,
    payload: OrderStatusIn,
    request: Request,
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    order = _admin_order(db, order_id)
    previous = order.status
    if payload.status not in ORDER_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown order status")
    assert_transition(previous, payload.status)
    if previous == payload.status:
        return {"order": _admin_order_payload(db, order)}

    if payload.status == "cancelled":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Use the cancel action so stock and refunds are handled")

    if payload.status == "dispatched":
        if order.fulfillment_type != "delivery":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pickup orders are not dispatched")
        if order.shipment:
            order.shipment.status = "in_transit"
            order.shipment.dispatched_at = now()
    if payload.status == "delivered":
        order.delivered_at = now()
        if order.shipment:
            order.shipment.status = "delivered"
            order.shipment.delivered_at = now()
        if order.payment_method == "cod" and order.payment_status == "pending":
            payment = db.scalar(select(Payment).where(Payment.order_id == order.id, Payment.method == "cod").limit(1))
            if payment:
                payment.status = "paid"
                payment.captured_at = now()
            order.payment_status = "paid"
            add_event(db, order, "cod_collected", actor=staff, note="Cash collected on delivery", visible=False)
    if payload.status == "packed" and order.shipment:
        order.shipment.status = "packed"
    if payload.status == "returned":
        if order.stock_committed:
            for item in order.items:
                if item.product_id:
                    release_stock(db, item.product_id, item.quantity, reference_type="order", reference_id=order.id, actor_id=staff.id, reason="return_restock")
            order.stock_committed = False
        if order.shipment:
            order.shipment.status = "returned"

    order.status = payload.status
    add_event(db, order, "status_changed", actor=staff, from_status=previous, to_status=payload.status, note=payload.note or None)
    db.commit()
    audit(db, "order.status_changed", actor=staff, entity_type="order", entity_id=order.id, before={"status": previous}, after={"status": payload.status, "note": payload.note}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, order.user_id) if order.user_id else None,
        "order_status",
        f"Order {order.order_number}: {ORDER_STATUS_LABELS.get(payload.status, payload.status)}",
        f"Your order {order.order_number} is now '{ORDER_STATUS_LABELS.get(payload.status, payload.status)}'."
        + (f" Note: {payload.note}" if payload.note else ""),
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    return {"order": _admin_order_payload(db, order)}


@router.post("/orders/{order_id}/cancel")
def admin_cancel_order(
    order_id: str,
    payload: OrderNoteIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    from ..services.commerce import _cancel_order

    order = _admin_order(db, order_id)
    if order.status in ("cancelled", "returned", "delivered"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This order cannot be cancelled")
    previous = order.status
    _cancel_order(db, order, reason=payload.note, actor=admin, event_type="cancelled_by_staff")
    db.commit()
    audit(db, "order.cancelled_by_staff", actor=admin, entity_type="order", entity_id=order.id, before={"status": previous}, after={"note": payload.note}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, order.user_id) if order.user_id else None,
        "order_cancelled",
        f"Order {order.order_number} cancelled",
        f"The store cancelled your order. Reason: {payload.note}. If payment was taken, a refund will be processed.",
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    return {"order": _admin_order_payload(db, order)}


@router.post("/orders/{order_id}/refund")
def refund_order(
    order_id: str,
    payload: RefundIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    order = _admin_order(db, order_id)
    remaining = order.total_paise - order.refunded_paise
    if payload.amount_paise > remaining:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Maximum refundable amount is ₹{remaining / 100:.2f}")
    if order.payment_status not in ("paid", "partially_refunded", "refunded"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only paid orders can be refunded")
    order.refunded_paise += payload.amount_paise
    order.payment_status = "refunded" if order.refunded_paise >= order.total_paise else "partially_refunded"
    for payment in order.payments:
        if payment.status in ("paid", "partially_refunded"):
            payment.status = order.payment_status if order.payment_status == "refunded" else "partially_refunded"
    add_event(db, order, "refund_recorded", actor=admin, note=f"Refund of ₹{payload.amount_paise / 100:.2f} recorded. {payload.note}")
    db.commit()
    audit(db, "order.refund_recorded", actor=admin, entity_type="order", entity_id=order.id, after={"amount_paise": payload.amount_paise, "note": payload.note}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, order.user_id) if order.user_id else None,
        "refund_recorded",
        f"Refund recorded for {order.order_number}",
        f"A refund of ₹{payload.amount_paise / 100:.2f} has been recorded for order {order.order_number}. Refund method: {order.payment_method}. {payload.note}",
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    return {"order": _admin_order_payload(db, order)}


@router.post("/orders/{order_id}/note")
def add_note(order_id: str, payload: OrderNoteIn, staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    order = _admin_order(db, order_id)
    order.internal_note = ((order.internal_note or "") + f"\n[{now().date().isoformat()} {staff.full_name}] {payload.note}").strip()
    add_event(db, order, "internal_note", actor=staff, note=payload.note, visible=False)
    db.commit()
    audit(db, "order.note_added", actor=staff, entity_type="order", entity_id=order.id, after={"note": payload.note}, commit=True)
    return {"order": _admin_order_payload(db, order)}


@router.get("/orders/{order_id}/document", response_class=HTMLResponse)
def admin_order_document(
    order_id: str,
    kind: str = Query(default="invoice"),
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    order = db.scalar(select(Order).options(selectinload(Order.items)).where(Order.id == order_id))
    if not order:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    store = store_settings.get_all(db)
    return HTMLResponse(render_order_document(order, store, kind="invoice" if kind == "invoice" else "packing"))


@router.get("/shipments")
def shipments(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.scalars(
        select(Shipment).where(Shipment.mode == "delivery", Shipment.status.notin_(("delivered", "cancelled"))).order_by(Shipment.created_at.desc()).limit(100)
    ).all()
    return {
        "shipments": [
            {
                "id": s.id,
                "order_id": s.order_id,
                "order_number": db.get(Order, s.order_id).order_number if db.get(Order, s.order_id) else None,
                "status": s.status,
                "carrier": s.carrier,
                "tracking_number": s.tracking_number,
                "created_at": s.created_at,
            }
            for s in rows
        ]
    }


@router.post("/shipments/{shipment_id}")
def update_shipment(shipment_id: str, payload: dict, staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    shipment = db.get(Shipment, shipment_id)
    if not shipment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")
    carrier = (payload or {}).get("carrier")
    tracking_number = (payload or {}).get("tracking_number")
    if carrier is not None:
        shipment.carrier = str(carrier)[:80]
    if tracking_number is not None:
        shipment.tracking_number = str(tracking_number)[:120]
    db.commit()
    audit(db, "shipment.updated", actor=staff, entity_type="shipment", entity_id=shipment.id, after={"carrier": shipment.carrier, "tracking_number": shipment.tracking_number}, commit=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# customers
# ---------------------------------------------------------------------------
@router.get("/customers")
def list_customers(
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
    q: Optional[str] = None,
    role: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
):
    query = select(User)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(User.email.ilike(like), User.full_name.ilike(like), User.phone.ilike(like)))
    if role:
        query = query.where(User.role == role)
    rows, total, pages = _paginate(db, query.order_by(User.created_at.desc()), page, per_page)
    return {"customers": [user_public(u) for u in rows], "total": total, "page": page, "pages": pages}


@router.get("/customers/{user_id}")
def customer_detail(user_id: str, staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    orders = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc()).limit(25)).all()
    addresses = db.scalars(select(Address).where(Address.user_id == user.id)).all()
    return {
        "customer": user_public(user),
        "orders": [order_public(o) for o in orders],
        "addresses": [
            {"id": a.id, "label": a.label, "city": a.city, "state": a.state, "pincode": a.pincode, "is_default": a.is_default}
            for a in addresses
        ],
        "listings": [
            {"id": l.id, "listing_code": l.listing_code, "title": l.title, "status": l.status}
            for l in db.scalars(select(Listing).where(Listing.seller_id == user.id)).all()
        ],
        "note": "Passwords and payment credentials are never exposed through this API.",
    }


@router.post("/customers/{user_id}/status")
def set_customer_status(user_id: str, payload: dict, request: Request, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    new_status = (payload or {}).get("status")
    if new_status not in ("active", "restricted"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "status must be active or restricted")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot restrict your own account")
    if user.role == "admin" and new_status == "restricted":
        remaining = db.scalar(
            select(func.count(User.id)).where(User.role == "admin", User.status == "active", User.id != user.id)
        ) or 0
        if remaining == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Keep at least one active administrator account")
    user.status = new_status
    if new_status == "restricted":
        # A restricted account must lose staff/admin powers immediately, so any
        # existing session is revoked rather than left to expire on its own.
        for session in db.scalars(select(Session).where(Session.user_id == user.id)).all():
            db.delete(session)
        # Drop their carts too: an abandoned cart would otherwise still be
        # checkable as a guest after the session is gone.
        for cart in db.scalars(select(Cart).where(Cart.user_id == user.id)).all():
            db.delete(cart)
    db.commit()
    audit(db, "customer.status_changed", actor=admin, entity_type="user", entity_id=user.id, after={"status": new_status, "reason": (payload or {}).get("reason")}, ip_address=client_ip(request), commit=True)
    return {"customer": user_public(user)}


@router.post("/customers/{user_id}/role")
def set_customer_role(user_id: str, payload: dict, request: Request, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    role = (payload or {}).get("role")
    if role not in ("customer", "staff", "admin"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role must be customer, staff or admin")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your own role")
    if user.role == "admin" and role != "admin":
        remaining = db.scalar(
            select(func.count(User.id)).where(User.role == "admin", User.status == "active", User.id != user.id)
        ) or 0
        if remaining == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Keep at least one administrator account")
    user.role = role
    db.commit()
    audit(db, "user.role_changed", actor=admin, entity_type="user", entity_id=user.id, after={"role": role}, ip_address=client_ip(request), commit=True)
    return {"customer": user_public(user)}


# ---------------------------------------------------------------------------
# marketplace moderation
# ---------------------------------------------------------------------------
@router.get("/listings")
def admin_listings(
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    q: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
):
    query = select(Listing).options(selectinload(Listing.images), selectinload(Listing.seller))
    if status_filter:
        query = query.where(Listing.status == status_filter)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Listing.title.ilike(like), Listing.listing_code.ilike(like), Listing.isbn.ilike(like)))
    rows, total, pages = _paginate(db, query.order_by(Listing.created_at.desc()), page, per_page)
    return {
        "listings": [
            {
                "id": l.id,
                "listing_code": l.listing_code,
                "title": l.title,
                "condition": l.condition,
                "condition_notes": l.condition_notes,
                "asking_price_paise": l.asking_price_paise,
                "status": l.status,
                "seller": {"id": l.seller_id, "name": l.seller.full_name if l.seller else None, "email": l.seller.email if l.seller else None},
                "images": [{"url": i.url} for i in l.images],
                "created_at": l.created_at,
                "reviewed_at": l.reviewed_at,
                "moderation_note": l.moderation_note,
            }
            for l in rows
        ],
        "total": total,
        "page": page,
        "pages": pages,
        "statuses": list(LISTING_STATUSES),
    }


@router.post("/listings/{listing_id}/moderate")
def moderate_listing(
    listing_id: str,
    payload: ListingModerationIn,
    request: Request,
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    listing = db.scalar(select(Listing).options(selectinload(Listing.seller)).where(Listing.id == listing_id))
    if not listing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if listing.status == "sold":
        raise HTTPException(status.HTTP_409_CONFLICT, "Sold listings cannot be moderated")
    previous = listing.status
    listing.status = payload.status
    listing.moderation_note = payload.note
    listing.reviewed_by = staff.id
    listing.reviewed_at = now()
    if payload.status == "active" and not listing.published_at:
        listing.published_at = now()
    db.commit()
    audit(db, "listing.moderated", actor=staff, entity_type="listing", entity_id=listing.id, before={"status": previous}, after={"status": payload.status, "note": payload.note}, ip_address=client_ip(request), commit=True)
    label = {"active": "approved and is now visible", "rejected": "rejected", "suspended": "suspended", "archived": "archived"}[payload.status]
    notify_user(
        db,
        listing.seller,
        "listing_moderated",
        f"Listing {listing.listing_code} {label}",
        f"Your listing '{listing.title}' was {label}."
        + (f" Moderator note: {payload.note}" if payload.note else ""),
        related_type="listing",
        related_id=listing.id,
    )
    return {"ok": True, "status": listing.status}


@router.get("/reports")
def listing_reports(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db), status_filter: str = Query(default="open")):
    rows = db.scalars(select(ListingReport).where(ListingReport.status == status_filter).order_by(ListingReport.created_at.desc())).all()
    return {
        "reports": [
            {
                "id": r.id,
                "listing_id": r.listing_id,
                "listing_code": db.get(Listing, r.listing_id).listing_code if db.get(Listing, r.listing_id) else None,
                "listing_title": db.get(Listing, r.listing_id).title if db.get(Listing, r.listing_id) else None,
                "reason": r.reason,
                "details": r.details,
                "status": r.status,
                "created_at": r.created_at,
            }
            for r in rows
        ]
    }


@router.post("/reports/{report_id}")
def resolve_report(report_id: str, payload: dict, staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    report = db.get(ListingReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    new_status = (payload or {}).get("status", "resolved")
    if new_status not in ("open", "resolved", "dismissed"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid report status")
    report.status = new_status
    report.admin_note = (payload or {}).get("note")
    db.commit()
    audit(db, "listing_report.resolved", actor=staff, entity_type="listing_report", entity_id=report.id, after={"status": new_status}, commit=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# resale submissions
# ---------------------------------------------------------------------------
@router.get("/submissions")
def admin_submissions(
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
    status_filter: Optional[str] = Query(default=None, alias="status"),
):
    query = select(BookSubmission)
    if status_filter:
        query = query.where(BookSubmission.status == status_filter)
    rows = db.scalars(query.order_by(BookSubmission.created_at.desc()).limit(200)).all()
    return {
        "submissions": [
            {
                "id": s.id,
                "reference": s.reference,
                "book_title": s.book_title,
                "isbn": s.isbn,
                "author": s.author,
                "condition": s.condition,
                "expected_price_paise": s.expected_price_paise,
                "selling_method": s.selling_method,
                "status": s.status,
                "photos": s.photos,
                "contact_name": s.contact_name,
                "contact_phone": s.contact_phone,
                "contact_email": s.contact_email,
                "pickup_address": s.pickup_address,
                "notes": s.notes,
                "admin_note": s.admin_note,
                "created_at": s.created_at,
                "listing_id": s.listing_id,
                "user_id": s.user_id,
            }
            for s in rows
        ]
    }


@router.post("/submissions/{submission_id}/review")
def review_submission(
    submission_id: str,
    payload: SubmissionReviewIn,
    request: Request,
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    submission = db.get(BookSubmission, submission_id)
    if not submission:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    submission.status = payload.status
    submission.reviewed_by = staff.id
    note = payload.admin_note or ""
    if payload.recommended_price_paise is not None:
        note = (note + f"\nRecommended price: ₹{payload.recommended_price_paise / 100:.2f}").strip()
    submission.admin_note = note or None
    db.commit()
    audit(db, "submission.reviewed", actor=staff, entity_type="submission", entity_id=submission.id, after={"status": payload.status}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, submission.user_id) if submission.user_id else None,
        "submission_updated",
        f"Submission {submission.reference}: {payload.status.replace('_', ' ')}",
        f"Your submission for '{submission.book_title}' is now '{payload.status.replace('_', ' ')}'. {payload.admin_note or ''}".strip(),
        related_type="submission",
        related_id=submission.id,
        email=submission.contact_email,
    )
    return {"ok": True}


@router.post("/submissions/{submission_id}/convert")
def convert_submission(
    submission_id: str,
    payload: dict,
    request: Request,
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    """Create a marketplace listing from an approved submission.

    The seller must still approve the final price before it is published."""
    submission = db.get(BookSubmission, submission_id)
    if not submission:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if submission.listing_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This submission already has a listing")
    if submission.status not in ("approved", "under_review", "details_requested", "submitted"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only an approved or in-review submission can be converted")
    if not submission.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The submitter has no account; ask them to register before listing")
    price = (payload or {}).get("asking_price_paise") or submission.expected_price_paise
    if not price or int(price) < 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A valid asking price is required")
    listing = Listing(
        listing_code=f"UB-{secrets.token_hex(4).upper()}",
        seller_id=submission.user_id,
        title=submission.book_title,
        isbn=submission.isbn,
        author=submission.author,
        publisher=submission.publisher,
        board=submission.board,
        class_level=submission.class_level,
        subject=submission.subject,
        condition=submission.condition,
        condition_notes=submission.notes,
        asking_price_paise=int(price),
        status="pending_review",
    )
    db.add(listing)
    db.flush()
    for index, url in enumerate(submission.photos or []):
        if isinstance(url, str) and url.startswith("/uploads/"):
            db.add(ListingImage(listing_id=listing.id, url=url, alt_text=listing.title, sort_order=index))
    submission.status = "converted_to_listing"
    submission.listing_id = listing.id
    db.commit()
    audit(db, "submission.converted", actor=staff, entity_type="submission", entity_id=submission.id, after={"listing_id": listing.id}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, submission.user_id),
        "listing_created",
        f"Listing {listing.listing_code} created from your submission",
        "The store created a listing from your submission. It still needs moderation approval before buyers can see it.",
        related_type="listing",
        related_id=listing.id,
    )
    return {"listing": {"id": listing.id, "listing_code": listing.listing_code, "status": listing.status}}


# ---------------------------------------------------------------------------
# bulk quotations
# ---------------------------------------------------------------------------
@router.get("/quotations")
def admin_quotations(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db), status_filter: Optional[str] = Query(default=None, alias="status")):
    query = select(BulkQuotation).options(selectinload(BulkQuotation.items))
    if status_filter:
        query = query.where(BulkQuotation.status == status_filter)
    rows = db.scalars(query.order_by(BulkQuotation.created_at.desc()).limit(200)).all()
    return {
        "quotations": [
            {
                "id": q.id,
                "reference": q.reference,
                "organization_name": q.organization_name,
                "organization_type": q.organization_type,
                "contact_name": q.contact_name,
                "contact_email": q.contact_email,
                "contact_phone": q.contact_phone,
                "delivery_location": q.delivery_location,
                "target_date": q.target_date.isoformat() if q.target_date else None,
                "status": q.status,
                "quote_total_paise": q.quote_total_paise,
                "quote_valid_until": q.quote_valid_until.isoformat() if q.quote_valid_until else None,
                "created_at": q.created_at,
                "accepted_at": q.accepted_at,
                "order_id": q.order_id,
                "notes": q.notes,
                "quote_notes": q.quote_notes,
                "items": [
                    {
                        "id": i.id,
                        "description": i.description,
                        "quantity": i.quantity,
                        "product_id": i.product_id,
                        "unit_price_paise": i.unit_price_paise,
                        "line_total_paise": i.line_total_paise,
                    }
                    for i in q.items
                ],
            }
            for q in rows
        ],
        "statuses": list(QUOTATION_STATUSES),
    }


@router.post("/quotations/{quotation_id}/quote")
def quote_request(
    quotation_id: str,
    payload: QuotationQuoteIn,
    request: Request,
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    quotation = db.scalar(select(BulkQuotation).options(selectinload(BulkQuotation.items)).where(BulkQuotation.id == quotation_id))
    if not quotation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quotation request not found")
    if quotation.status in ("converted", "cancelled", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This request can no longer be quoted")
    if payload.quote_valid_until and payload.quote_valid_until < date.today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Validity date must be in the future")
    by_id = {i.id: i for i in quotation.items}
    for line in payload.items:
        item = by_id.get(line.item_id)
        if not item:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown line item in quotation")
        item.unit_price_paise = line.unit_price_paise
        item.line_total_paise = line.unit_price_paise * item.quantity
    total = sum((i.line_total_paise or 0) for i in quotation.items)
    quotation.quote_total_paise = total
    quotation.quote_notes = payload.quote_notes
    quotation.quote_valid_until = payload.quote_valid_until
    quotation.status = "quoted"
    quotation.quoted_by = staff.id
    quotation.quoted_at = now()
    db.commit()
    audit(db, "quotation.quoted", actor=staff, entity_type="quotation", entity_id=quotation.id, after={"total": total}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, quotation.user_id) if quotation.user_id else None,
        "quotation_ready",
        f"Quotation {quotation.reference} ready",
        f"Your bulk quotation total is ₹{total / 100:,.2f}. Open your quotation link to review and accept it before it expires.",
        related_type="quotation",
        related_id=quotation.id,
        email=quotation.contact_email,
    )
    return {"ok": True, "quote_total_paise": total}


@router.post("/quotations/{quotation_id}/convert")
def convert_quotation(
    quotation_id: str,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    quotation = db.scalar(select(BulkQuotation).options(selectinload(BulkQuotation.items)).where(BulkQuotation.id == quotation_id))
    if not quotation:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quotation request not found")
    if quotation.status != "accepted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only an accepted quotation can be converted into an order")
    if quotation.order_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This quotation already has an order")
    if quotation.quote_valid_until and quotation.quote_valid_until < date.today():
        raise HTTPException(status.HTTP_409_CONFLICT, "This quotation has expired")

    order = Order(
        order_number=generate_order_number(db),
        user_id=quotation.user_id,
        order_type="bulk",
        status="placed",
        payment_method="invoice",
        payment_status="pending",
        subtotal_paise=quotation.quote_total_paise or 0,
        total_paise=quotation.quote_total_paise or 0,
        customer_name=quotation.contact_name,
        customer_email=quotation.contact_email,
        customer_phone=quotation.contact_phone,
        fulfillment_type="delivery",
        ship_line1=quotation.delivery_location,
        customer_note=quotation.quote_notes,
        tracking_token=secrets.token_urlsafe(24),
        stock_committed=False,
    )
    db.add(order)
    db.flush()
    for item in quotation.items:
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=item.product_id,
                title_snapshot=item.description,
                unit_price_paise=item.unit_price_paise or 0,
                quantity=item.quantity,
                line_total_paise=item.line_total_paise or 0,
            )
        )
        if item.product_id:
            try:
                commit_stock(db, item.product_id, item.quantity, reference_type="bulk_order", reference_id=order.id, actor_id=admin.id)
            except HTTPException:
                db.rollback()
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Not enough stock for '{item.description}' to convert this quotation. Adjust stock or the quotation first.",
                )
    order.stock_committed = True
    db.add(Shipment(order_id=order.id, mode="delivery", status="pending"))
    add_event(db, order, "order_created", actor=admin, note=f"Converted from bulk quotation {quotation.reference}")
    db.add(
        Payment(
            order_id=order.id,
            method="invoice",
            amount_paise=order.total_paise,
            status="pending",
            idempotency_key=f"order:{order.id}:bulk-invoice",
        )
    )
    quotation.status = "converted"
    quotation.order_id = order.id
    db.commit()
    audit(db, "quotation.converted", actor=admin, entity_type="quotation", entity_id=quotation.id, after={"order_number": order.order_number}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        db.get(User, quotation.user_id) if quotation.user_id else None,
        "quotation_converted",
        f"Order {order.order_number} created from quotation {quotation.reference}",
        f"Your accepted quotation has been converted into order {order.order_number}. Payment terms: invoice. The store will contact you about delivery.",
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    return {"order": order_public(order)}


# ---------------------------------------------------------------------------
# returns
# ---------------------------------------------------------------------------
@router.get("/returns")
def admin_returns(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db), status_filter: Optional[str] = Query(default=None, alias="status")):
    query = select(ReturnRequest)
    if status_filter:
        query = query.where(ReturnRequest.status == status_filter)
    rows = db.scalars(query.order_by(ReturnRequest.created_at.desc()).limit(200)).all()
    return {
        "returns": [
            {
                "id": r.id,
                "reference": r.reference,
                "order_id": r.order_id,
                "order_number": db.get(Order, r.order_id).order_number if db.get(Order, r.order_id) else None,
                "request_type": r.request_type,
                "reason": r.reason,
                "status": r.status,
                "admin_note": r.admin_note,
                "refund_amount_paise": r.refund_amount_paise,
                "created_at": r.created_at,
                "resolved_at": r.resolved_at,
            }
            for r in rows
        ],
        "types": [{"value": k, "label": v} for k, v in RETURN_TYPE_LABELS.items()],
    }


@router.post("/returns/{return_id}")
def decide_return(
    return_id: str,
    payload: ReturnDecisionIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: OrmSession = Depends(get_db),
):
    row = db.get(ReturnRequest, return_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if row.status in ("completed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This request is already closed")
    order = db.get(Order, row.order_id)
    row.status = payload.status
    row.admin_note = payload.admin_note
    if payload.status in ("approved", "rejected"):
        row.resolved_at = now()
        row.resolved_by = admin.id
    if payload.status == "completed":
        row.resolved_at = now()
        row.resolved_by = admin.id
        if payload.refund_amount_paise:
            if not order or order.payment_status not in ("paid", "partially_refunded", "refunded"):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only paid orders can be refunded")
            remaining = order.total_paise - order.refunded_paise
            if payload.refund_amount_paise > remaining:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Maximum refundable amount is ₹{remaining / 100:.2f}")
            order.refunded_paise += payload.refund_amount_paise
            order.payment_status = "refunded" if order.refunded_paise >= order.total_paise else "partially_refunded"
            row.refund_amount_paise = payload.refund_amount_paise
            add_event(db, order, "refund_recorded", actor=admin, note=f"Refund of ₹{payload.refund_amount_paise / 100:.2f} via {row.reference}")
    db.commit()
    audit(db, "return.decided", actor=admin, entity_type="return", entity_id=row.id, after={"status": payload.status, "refund": payload.refund_amount_paise}, ip_address=client_ip(request), commit=True)
    owner = db.get(User, row.user_id) if row.user_id else None
    notify_user(
        db,
        owner,
        "return_updated",
        f"{RETURN_TYPE_LABELS.get(row.request_type, 'Request')} {row.reference}: {payload.status}",
        f"Your request {row.reference} is now '{payload.status}'." + (f" Note: {payload.admin_note}" if payload.admin_note else ""),
        related_type="return",
        related_id=row.id,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# coupons, commissions, payouts, audit, messages
# ---------------------------------------------------------------------------
@router.get("/coupons")
def admin_coupons(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(Coupon).order_by(Coupon.created_at.desc())).all()
    return {
        "coupons": [
            {
                "id": c.id,
                "code": c.code,
                "description": c.description,
                "discount_type": c.discount_type,
                "value": c.value,
                "min_order_paise": c.min_order_paise,
                "max_discount_paise": c.max_discount_paise,
                "expires_at": c.expires_at,
                "usage_limit": c.usage_limit,
                "used_count": c.used_count,
                "per_user_limit": c.per_user_limit,
                "is_active": c.is_active,
            }
            for c in rows
        ]
    }


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid date format")
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@router.post("/coupons", status_code=201)
def create_coupon(payload: CouponIn, request: Request, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    code = payload.code.strip().upper()
    if db.scalar(select(Coupon.id).where(func.lower(Coupon.code) == code.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "That coupon code already exists")
    coupon = Coupon(
        code=code,
        description=payload.description,
        discount_type=payload.discount_type,
        value=payload.value,
        min_order_paise=payload.min_order_paise,
        max_discount_paise=payload.max_discount_paise,
        starts_at=_parse_dt(payload.starts_at),
        expires_at=_parse_dt(payload.expires_at),
        usage_limit=payload.usage_limit,
        per_user_limit=payload.per_user_limit,
        is_active=payload.is_active,
    )
    db.add(coupon)
    db.commit()
    audit(db, "coupon.created", actor=admin, entity_type="coupon", entity_id=coupon.id, after={"code": code}, ip_address=client_ip(request), commit=True)
    return {"id": coupon.id}


@router.put("/coupons/{coupon_id}")
def update_coupon(coupon_id: str, payload: CouponIn, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Coupon not found")
    coupon.description = payload.description
    coupon.discount_type = payload.discount_type
    coupon.value = payload.value
    coupon.min_order_paise = payload.min_order_paise
    coupon.max_discount_paise = payload.max_discount_paise
    coupon.starts_at = _parse_dt(payload.starts_at)
    coupon.expires_at = _parse_dt(payload.expires_at)
    coupon.usage_limit = payload.usage_limit
    coupon.per_user_limit = payload.per_user_limit
    coupon.is_active = payload.is_active
    db.commit()
    audit(db, "coupon.updated", actor=admin, entity_type="coupon", entity_id=coupon.id, after={"code": coupon.code}, commit=True)
    return {"ok": True}


@router.delete("/coupons/{coupon_id}")
def delete_coupon(coupon_id: str, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Coupon not found")
    used = db.scalar(select(func.count(CouponRedemption.id)).where(CouponRedemption.coupon_id == coupon.id)) or 0
    if used:
        coupon.is_active = False
        db.commit()
        return {"deactivated": True, "message": "This coupon has been used, so it was deactivated instead of deleted."}
    db.delete(coupon)
    db.commit()
    return {"deleted": True}


@router.get("/commissions")
def admin_commissions(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db), seller_id: Optional[str] = None):
    query = select(CommissionRecord)
    if seller_id:
        query = query.where(CommissionRecord.seller_id == seller_id)
    rows = db.scalars(query.order_by(CommissionRecord.created_at.desc()).limit(500)).all()
    return {
        "commissions": [
            {
                "id": r.id,
                "order_id": r.order_id,
                "order_number": db.get(Order, r.order_id).order_number if db.get(Order, r.order_id) else None,
                "seller_id": r.seller_id,
                "seller_email": db.get(User, r.seller_id).email if r.seller_id and db.get(User, r.seller_id) else None,
                "gross_paise": r.gross_paise,
                "commission_rate_bp": r.commission_rate_bp,
                "commission_paise": r.commission_paise,
                "seller_proceeds_paise": r.seller_proceeds_paise,
                "status": r.status,
                "created_at": r.created_at,
                "paid_at": r.paid_at,
                "payout_id": r.payout_id,
            }
            for r in rows
        ],
        "totals": {
            "gross_paise": sum(r.gross_paise for r in rows if r.status != "void"),
            "commission_paise": sum(r.commission_paise for r in rows if r.status != "void"),
            "proceeds_paise": sum(r.seller_proceeds_paise for r in rows if r.status != "void"),
            "paid_paise": sum(r.seller_proceeds_paise for r in rows if r.status == "paid"),
        },
        "note": "Commission figures are recorded accounting data. This platform does not transfer money; payouts must be completed through the store's own banking process and then recorded here.",
    }


@router.post("/payouts", status_code=201)
def record_payout(payload: PayoutIn, request: Request, admin: User = Depends(require_admin), db: OrmSession = Depends(get_db)):
    seller = db.get(User, payload.seller_id)
    if not seller:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Seller not found")
    records = list(
        db.scalars(
            select(CommissionRecord).where(
                CommissionRecord.seller_id == seller.id,
                CommissionRecord.status.in_(("accrued", "payable")),
                *([CommissionRecord.id.in_(payload.commission_ids)] if payload.commission_ids else []),
            )
        )
    )
    outstanding = sum(r.seller_proceeds_paise for r in records)
    if outstanding <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No outstanding seller proceeds to record")
    if payload.amount_paise > outstanding:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Amount exceeds outstanding proceeds of ₹{outstanding / 100:.2f}")
    payout = Payout(
        seller_id=seller.id,
        amount_paise=payload.amount_paise,
        reference=payload.reference,
        note=payload.note,
        recorded_by=admin.id,
        status="recorded",
    )
    db.add(payout)
    db.flush()
    remaining = payload.amount_paise
    for record in sorted(records, key=lambda r: r.created_at):
        if remaining <= 0:
            break
        if record.seller_proceeds_paise <= remaining:
            record.status = "paid"
            record.paid_at = now()
            record.payout_id = payout.id
            remaining -= record.seller_proceeds_paise
        else:
            record.status = "payable"
    db.commit()
    audit(db, "payout.recorded", actor=admin, entity_type="payout", entity_id=payout.id, after={"seller": seller.email, "amount": payload.amount_paise}, ip_address=client_ip(request), commit=True)
    notify_user(
        db,
        seller,
        "payout_recorded",
        "Seller payout recorded",
        f"The store recorded a payout of ₹{payload.amount_paise / 100:.2f} to you. Reference: {payload.reference or 'n/a'}. This record reflects a payment made by the store outside this system.",
        related_type="payout",
        related_id=payout.id,
    )
    return {"payout_id": payout.id, "recorded_paise": payload.amount_paise, "remaining_outstanding_paise": max(0, outstanding - payload.amount_paise)}


@router.get("/payouts")
def list_payouts(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(Payout).order_by(Payout.created_at.desc()).limit(200)).all()
    return {
        "payouts": [
            {
                "id": p.id,
                "seller_email": db.get(User, p.seller_id).email if db.get(User, p.seller_id) else None,
                "amount_paise": p.amount_paise,
                "method": p.method,
                "reference": p.reference,
                "status": p.status,
                "note": p.note,
                "created_at": p.created_at,
            }
            for p in rows
        ]
    }


@router.get("/audit")
def audit_log(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db), q: Optional[str] = None, page: int = Query(default=1, ge=1), per_page: int = Query(default=50, ge=1, le=200)):
    query = select(AuditLog)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(AuditLog.action.ilike(like), AuditLog.actor_email.ilike(like), AuditLog.entity_type.ilike(like)))
    rows, total, pages = _paginate(db, query.order_by(AuditLog.created_at.desc()), page, per_page)
    return {
        "entries": [
            {
                "id": e.id,
                "actor_email": e.actor_email,
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": e.entity_id,
                "before": e.before_json,
                "after": e.after_json,
                "created_at": e.created_at,
            }
            for e in rows
        ],
        "total": total,
        "page": page,
        "pages": pages,
    }


@router.get("/notifications")
def admin_notifications(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db), channel: Optional[str] = None):
    query = select(Notification)
    if channel:
        query = query.where(Notification.channel == channel)
    rows = db.scalars(query.order_by(Notification.created_at.desc()).limit(200)).all()
    return {
        "notifications": [
            {
                "id": n.id,
                "channel": n.channel,
                "template": n.template,
                "recipient": n.recipient,
                "subject": n.subject,
                "status": n.status,
                "provider": n.provider,
                "error": n.error,
                "created_at": n.created_at,
                "sent_at": n.sent_at,
            }
            for n in rows
        ],
        "providers": {
            "email_configured": bool(settings.smtp_host and settings.smtp_from),
            "sms_configured": False,
            "whatsapp_configured": False,
            "note": "SMS and WhatsApp integration is not implemented in this build; those notifications are stored with status 'skipped'.",
        },
    }


@router.get("/messages")
def admin_messages(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(100)).all()
    return {
        "messages": [
            {"id": m.id, "name": m.name, "email": m.email, "phone": m.phone, "subject": m.subject, "message": m.message, "status": m.status, "created_at": m.created_at}
            for m in rows
        ]
    }


@router.get("/inventory")
def inventory_overview(staff: User = Depends(require_staff), db: OrmSession = Depends(get_db)):
    def count(condition):
        return int(db.scalar(select(func.count(Product.id)).where(Product.status == "active", condition)) or 0)

    return {
        "in_stock": count(Product.stock_qty > Product.low_stock_threshold),
        "low_stock": count((Product.stock_qty > 0) & (Product.stock_qty <= Product.low_stock_threshold)),
        "out_of_stock": count(or_(Product.stock_qty <= 0, Product.is_enquiry_only.is_(True))),
        "active_reservations": int(
            db.scalar(select(func.count(InventoryReservation.id)).where(InventoryReservation.status == "active", InventoryReservation.expires_at > now())) or 0
        ),
        "reservation_minutes": settings.stock_reservation_minutes,
    }
