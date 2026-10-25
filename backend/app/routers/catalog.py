"""Public storefront: catalogue, discovery, content."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session as OrmSession, selectinload

from ..constants import BOARDS, BOOK_TYPE_LABELS, BOOK_TYPES, CONDITIONS, CONDITION_LABELS
from ..db import get_db, now
from ..models import (
    Banner,
    Cart,
    Category,
    Faq,
    Listing,
    Notification,
    Order,
    OrderItem,
    Product,
    User,
    WishlistItem,
)
from ..security import get_current_user
from ..serializers import product_card, product_detail, sales_counts, user_public
from ..services import settings as store_settings
from ..services.commerce import available_stock, delivery_serviceable

router = APIRouter(prefix="/api", tags=["catalog"])

ACTIVE = Product.status == "active"


def _base_product_query():
    return (
        select(Product)
        .options(selectinload(Product.images), selectinload(Product.category))
        .where(ACTIVE)
    )


@router.get("/store/bootstrap")
def bootstrap(
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    categories = db.scalars(
        select(Category).where(Category.is_active.is_(True)).order_by(Category.sort_order, Category.name)
    ).all()
    cart_count = 0
    wishlist_count = 0
    unread = 0
    if user:
        cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
        cart_count = sum(item.quantity for item in cart.items) if cart else 0
        wishlist_count = db.scalar(select(func.count(WishlistItem.id)).where(WishlistItem.user_id == user.id)) or 0
        unread = db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id, Notification.channel == "in_app", Notification.is_read.is_(False)
            )
        ) or 0
    public = store_settings.public_settings(db)
    return {
        "settings": public,
        "categories": [
            {"id": c.id, "slug": c.slug, "name": c.name, "image_url": c.image_url, "description": c.description}
            for c in categories
            if not c.is_system
        ],
        "user": user_public(user),
        "cart_count": cart_count,
        "wishlist_count": wishlist_count,
        "unread_notifications": unread,
        "env": "development" if not store_settings.settings.is_production else "production",
        "demo_mode": bool(public.get("demo_mode")),
    }


@router.get("/store/categories")
def categories(db: OrmSession = Depends(get_db)):
    rows = db.execute(
        select(Category, func.count(Product.id))
        .outerjoin(Product, and_(Product.category_id == Category.id, Product.status == "active"))
        .where(Category.is_active.is_(True), Category.is_system.is_(False))
        .group_by(Category.id)
        .order_by(Category.sort_order, Category.name)
    ).all()
    return {
        "categories": [
            {
                "id": c.id,
                "slug": c.slug,
                "name": c.name,
                "description": c.description,
                "image_url": c.image_url,
                "product_count": int(count or 0),
            }
            for c, count in rows
        ]
    }


@router.get("/store/banners")
def banners(db: OrmSession = Depends(get_db)):
    current = now()
    rows = db.scalars(
        select(Banner)
        .where(Banner.is_active.is_(True))
        .order_by(Banner.sort_order, Banner.created_at.desc())
    ).all()
    active = [
        b
        for b in rows
        if (not b.starts_at or _aware(b.starts_at) <= current) and (not b.ends_at or _aware(b.ends_at) >= current)
    ]
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
            }
            for b in active
        ]
    }


def _aware(value):
    from datetime import timezone

    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@router.get("/store/faqs")
def faqs(db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(Faq).where(Faq.is_active.is_(True)).order_by(Faq.sort_order, Faq.created_at)).all()
    return {"faqs": [{"id": f.id, "question": f.question, "answer": f.answer, "category": f.category} for f in rows]}


@router.get("/store/delivery-check")
def delivery_check(pincode: str = Query(min_length=4, max_length=10), db: OrmSession = Depends(get_db)):
    ok, message = delivery_serviceable(db, pincode.strip())
    fee = store_settings.get_int(db, "delivery_fee_paise") if ok else 0
    threshold = store_settings.get_int(db, "free_delivery_threshold_paise")
    return {"serviceable": ok, "message": message, "fee_paise": fee, "free_above_paise": threshold}


@router.get("/store/home")
def home(db: OrmSession = Depends(get_db)):
    """Homepage payload. Every block is data-driven and may legitimately be empty."""
    public = store_settings.public_settings(db)
    counts = sales_counts(db)

    featured = db.scalars(
        _base_product_query().where(Product.is_featured.is_(True)).order_by(Product.created_at.desc()).limit(8)
    ).all()
    new_arrivals = db.scalars(_base_product_query().order_by(Product.created_at.desc()).limit(8)).all()
    used_store_items = db.scalars(
        _base_product_query().where(Product.product_type == "used").order_by(Product.created_at.desc()).limit(4)
    ).all()

    listings: list[dict] = []
    if store_settings.get(db, "marketplace_enabled"):
        from ..serializers import listing_card

        rows = db.scalars(
            select(Listing)
            .options(selectinload(Listing.images), selectinload(Listing.seller))
            .where(Listing.status == "active")
            .order_by(Listing.published_at.desc().nullslast(), Listing.created_at.desc())
            .limit(4)
        ).all()
        listings = [listing_card(db, l) for l in rows]

    bestseller_ids = [pid for pid, qty in sorted(counts.items(), key=lambda kv: -kv[1]) if qty > 0][:6]
    bestsellers: list[dict] = []
    if bestseller_ids:
        rows = db.scalars(_base_product_query().where(Product.id.in_(bestseller_ids))).all()
        by_id = {p.id: p for p in rows}
        bestsellers = [product_card(db, by_id[pid], popularity=counts[pid]) for pid in bestseller_ids if pid in by_id]

    cat_rows = db.execute(
        select(Category, func.count(Product.id))
        .outerjoin(Product, and_(Product.category_id == Category.id, Product.status == "active"))
        .where(Category.is_active.is_(True), Category.is_system.is_(False))
        .group_by(Category.id)
        .order_by(Category.sort_order, Category.name)
        .limit(8)
    ).all()

    board_rows = db.execute(
        select(Product.board, Product.class_level, func.count(Product.id))
        .where(ACTIVE, Product.board.isnot(None), Product.class_level.isnot(None))
        .group_by(Product.board, Product.class_level)
    ).all()
    board_index: dict[str, dict[str, int]] = {}
    for board, class_level, count in board_rows:
        board_index.setdefault(board, {})[class_level] = int(count)

    current = now()
    banner_rows = db.scalars(select(Banner).where(Banner.is_active.is_(True)).order_by(Banner.sort_order)).all()
    active_banners = [
        {
            "id": b.id,
            "title": b.title,
            "subtitle": b.subtitle,
            "image_url": b.image_url,
            "cta_label": b.cta_label,
            "cta_url": b.cta_url,
            "theme": b.theme,
        }
        for b in banner_rows
        if (not b.starts_at or _aware(b.starts_at) <= current) and (not b.ends_at or _aware(b.ends_at) >= current)
    ]

    return {
        "settings": public,
        "banners": active_banners,
        "categories": [
            {
                "id": c.id,
                "slug": c.slug,
                "name": c.name,
                "description": c.description,
                "image_url": c.image_url,
                "product_count": int(count or 0),
            }
            for c, count in cat_rows
        ],
        "featured": [product_card(db, p) for p in featured],
        "new_arrivals": [product_card(db, p) for p in new_arrivals],
        "bestsellers": bestsellers,
        "used_store_items": [product_card(db, p) for p in used_store_items],
        "listings": listings,
        "board_index": board_index,
        "has_sales_data": bool(bestseller_ids),
    }


@router.get("/products/filters")
def product_filters(db: OrmSession = Depends(get_db)):
    def distinct(column):
        rows = db.execute(select(column).where(ACTIVE, column.isnot(None)).distinct().order_by(column)).all()
        return [r[0] for r in rows if r[0]]

    prices = db.execute(select(func.min(Product.price_paise), func.max(Product.price_paise)).where(ACTIVE)).first()
    classes = distinct(Product.class_level)
    classes.sort(key=lambda v: (not str(v).isdigit(), int(v) if str(v).isdigit() else 0, str(v)))
    return {
        "categories": [
            {"slug": slug, "name": name}
            for slug, name in db.execute(
                select(Category.slug, Category.name).where(Category.is_active.is_(True), Category.is_system.is_(False)).order_by(Category.sort_order)
            ).all()
        ],
        "boards": distinct(Product.board),
        "classes": classes,
        "subjects": distinct(Product.subject),
        "authors": distinct(Product.author)[:100],
        "publishers": distinct(Product.publisher)[:100],
        "book_types": [{"value": bt, "label": BOOK_TYPE_LABELS[bt]} for bt in BOOK_TYPES],
        "conditions": [{"value": c, "label": CONDITION_LABELS[c]} for c in CONDITIONS],
        "price_min_paise": prices[0] or 0,
        "price_max_paise": prices[1] or 0,
        "boards_reference": list(BOARDS),
    }


def _sort_clause(sort: str, counts: dict[str, int], q: str | None):
    if sort == "price_asc":
        return [Product.price_paise.asc()]
    if sort == "price_desc":
        return [Product.price_paise.desc()]
    if sort == "newest":
        return [Product.created_at.desc()]
    if sort == "popularity":
        if counts:
            ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:200]
            rank_map = {pid: rank for rank, (pid, _qty) in enumerate(ranked)}
            return [case(rank_map, value=Product.id, else_=10_000).asc(), Product.created_at.desc()]
        return [Product.created_at.desc()]
    if q:
        # Relevance: exact title prefix first, then title match, then recency.
        lowered = q.lower()
        return [
            func.lower(Product.title).startswith(lowered).desc(),
            Product.title.asc(),
            Product.created_at.desc(),
        ]
    return [Product.created_at.desc()]


@router.get("/products")
def list_products(
    db: OrmSession = Depends(get_db),
    q: Optional[str] = Query(default=None, max_length=120),
    category: Optional[str] = None,
    min_price: Optional[int] = Query(default=None, ge=0),
    max_price: Optional[int] = Query(default=None, ge=0),
    class_level: Optional[str] = None,
    board: Optional[str] = None,
    subject: Optional[str] = None,
    author: Optional[str] = None,
    publisher: Optional[str] = None,
    condition: Optional[str] = None,
    product_type: Optional[str] = None,
    book_type: Optional[str] = None,
    availability: Optional[str] = None,
    featured: Optional[bool] = None,
    sort: str = "newest",
    page: int = Query(default=1, ge=1, le=500),
    per_page: int = Query(default=20, ge=1, le=60),
):
    query = _base_product_query()
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                Product.title.ilike(like),
                Product.author.ilike(like),
                Product.publisher.ilike(like),
                Product.isbn.ilike(like),
                Product.sku.ilike(like),
                Product.subject.ilike(like),
            )
        )
    if category:
        query = query.join(Category, Category.id == Product.category_id).where(Category.slug == category)
    if min_price is not None:
        query = query.where(Product.price_paise >= min_price)
    if max_price is not None:
        query = query.where(Product.price_paise <= max_price)
    if class_level:
        query = query.where(Product.class_level == class_level)
    if board:
        query = query.where(Product.board == board)
    if subject:
        query = query.where(Product.subject == subject)
    if author:
        query = query.where(Product.author == author)
    if publisher:
        query = query.where(Product.publisher == publisher)
    if condition and condition in CONDITIONS:
        query = query.where(Product.condition == condition)
    if product_type in ("new", "used"):
        query = query.where(Product.product_type == product_type)
    if book_type:
        query = query.where(Product.book_type == book_type)
    if availability == "in_stock":
        query = query.where(Product.stock_qty > 0, Product.is_enquiry_only.is_(False))
    elif availability == "out_of_stock":
        query = query.where(or_(Product.stock_qty <= 0, Product.is_enquiry_only.is_(True)))
    if featured is not None:
        query = query.where(Product.is_featured.is_(featured))

    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    counts = sales_counts(db)
    query = query.order_by(*_sort_clause(sort, counts, q)).offset((page - 1) * per_page).limit(per_page)
    products = db.scalars(query).all()

    return {
        "items": [product_card(db, p, popularity=counts.get(p.id, 0)) for p in products],
        "total": int(total),
        "page": page,
        "per_page": per_page,
        "pages": max(1, (int(total) + per_page - 1) // per_page),
        "sort": sort,
        "has_sales_data": bool(counts),
    }


@router.get("/products/suggest")
def suggest(q: str = Query(min_length=1, max_length=60), db: OrmSession = Depends(get_db)):
    like = f"%{q.strip()}%"
    rows = db.scalars(
        _base_product_query()
        .where(or_(Product.title.ilike(like), Product.author.ilike(like), Product.isbn.ilike(like)))
        .order_by(Product.created_at.desc())
        .limit(8)
    ).all()
    listing_rows = db.scalars(
        select(Listing)
        .options(selectinload(Listing.images), selectinload(Listing.seller))
        .where(Listing.status == "active", or_(Listing.title.ilike(like), Listing.author.ilike(like), Listing.isbn.ilike(like)))
        .limit(4)
    ).all()
    return {
        "products": [
            {
                "id": p.id,
                "slug": p.slug,
                "title": p.title,
                "price_paise": p.price_paise,
                "image_url": p.images[0].url if p.images else None,
                "product_type": p.product_type,
            }
            for p in rows
        ],
        "listings": [
            {"id": l.id, "listing_code": l.listing_code, "title": l.title, "asking_price_paise": l.asking_price_paise, "product_type": "used"}
            for l in listing_rows
        ],
        "query": q,
    }


@router.get("/products/{slug}")
def get_product(slug: str, db: OrmSession = Depends(get_db)):
    product = db.scalar(
        select(Product)
        .options(selectinload(Product.images), selectinload(Product.category))
        .where(Product.slug == slug)
    )
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    if product.status == "archived":
        raise HTTPException(status.HTTP_410_GONE, "This product has been archived and is no longer sold")
    if product.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")

    related_query = _base_product_query().where(Product.id != product.id)
    if product.board and product.class_level:
        related_query = related_query.where(Product.board == product.board, Product.class_level == product.class_level)
    else:
        related_query = related_query.where(Product.category_id == product.category_id)
    related = db.scalars(related_query.order_by(Product.created_at.desc()).limit(6)).all()

    data = product_detail(db, product, related=list(related))
    data["delivery"] = {
        "delivery_enabled": bool(store_settings.get(db, "delivery_enabled") and store_settings.get(db, "delivery_pincodes")),
        "pickup_enabled": bool(store_settings.get(db, "pickup_enabled")),
        "pickup_instructions": store_settings.get(db, "pickup_instructions"),
        "delivery_fee_paise": store_settings.get_int(db, "delivery_fee_paise"),
        "free_above_paise": store_settings.get_int(db, "free_delivery_threshold_paise"),
    }
    data["policies"] = {
        "returns_note": store_settings.get(db, "returns_note"),
        "return_window_days": store_settings.get_int(db, "return_window_days"),
        "cancellation_window_hours": store_settings.get_int(db, "cancellation_window_hours"),
    }
    return data


@router.get("/book-lists")
def book_lists(db: OrmSession = Depends(get_db)):
    """Board-wise / class-wise discovery built from live product data."""
    rows = db.execute(
        select(
            Product.board,
            Product.class_level,
            Product.subject,
            Product.book_type,
            Product.publisher,
            Product.academic_year,
            func.count(Product.id),
            func.sum(case((Product.stock_qty > 0, 1), else_=0)),
        )
        .where(ACTIVE, Product.board.isnot(None))
        .group_by(Product.board, Product.class_level, Product.subject, Product.book_type, Product.publisher, Product.academic_year)
    ).all()

    tree: dict[str, dict] = {}
    for board, class_level, subject, book_type, publisher, academic_year, total, in_stock in rows:
        board_node = tree.setdefault(
            board,
            {"board": board, "classes": {}, "total": 0, "in_stock": 0},
        )
        class_key = class_level or "Unspecified"
        class_node = board_node["classes"].setdefault(class_key, {"class_level": class_key, "subjects": {}, "total": 0, "in_stock": 0})
        subject_node = class_node["subjects"].setdefault(subject or "General", {"subject": subject or "General", "items": [], "total": 0, "in_stock": 0})
        subject_node["items"].append(
            {
                "book_type": book_type,
                "publisher": publisher,
                "academic_year": academic_year,
                "product_count": int(total or 0),
                "in_stock": int(in_stock or 0),
            }
        )
        for node in (board_node, class_node, subject_node):
            node["total"] += int(total or 0)
            node["in_stock"] += int(in_stock or 0)

    def sort_classes(classes: list[dict]) -> list[dict]:
        return sorted(classes, key=lambda c: (not str(c["class_level"]).isdigit(), int(c["class_level"]) if str(c["class_level"]).isdigit() else 0, str(c["class_level"])))

    boards_out = []
    for board_node in tree.values():
        classes = sort_classes(list(board_node["classes"].values()))
        for c in classes:
            c["subjects"] = sorted(c["subjects"].values(), key=lambda s: s["subject"])
        boards_out.append({**board_node, "classes": classes})
    boards_out.sort(key=lambda b: (BOARDS.index(b["board"]) if b["board"] in BOARDS else 99, b["board"]))
    return {
        "boards": boards_out,
        "board_reference": list(BOARDS),
        "book_types": [{"value": k, "label": v} for k, v in BOOK_TYPE_LABELS.items()],
        "has_data": bool(boards_out),
        "academic_year": None,
    }
