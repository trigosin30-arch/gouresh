from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Category, Coupon, Product
from ..schemas import CartLineInput, CouponValidateInput
from ..serializers import category_out, product_out
from ..services import orders as order_service

router = APIRouter(tags=["catalog"])

SORT_OPTIONS = {
    "relevance": (Product.is_featured.desc(), Product.sold_count.desc(), Product.name.asc()),
    "price_asc": (Product.price_paise.asc(),),
    "price_desc": (Product.price_paise.desc(),),
    "newest": (Product.created_at.desc(),),
    "popular": (Product.sold_count.desc(),),
    "name": (Product.name.asc(),),
}


@router.get("/config")
def public_config() -> dict:
    return settings.public_config()


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(Category, func.count(Product.id))
        .outerjoin(Product, (Product.category_id == Category.id) & (Product.is_archived.is_(False)))
        .group_by(Category.id)
        .order_by(Category.sort_order, Category.name)
    ).all()
    return {"items": [category_out(c, count) for c, count in rows]}


@router.get("/products")
def list_products(
    q: str | None = Query(default=None, max_length=120),
    category: str | None = Query(default=None, max_length=80),
    min_price: int | None = Query(default=None, ge=0),
    max_price: int | None = Query(default=None, ge=0),
    in_stock: bool | None = None,
    condition: Literal["new", "refurbished", "used"] | None = None,
    board: str | None = Query(default=None, max_length=40),
    class_level: str | None = Query(default=None, max_length=40),
    featured: bool | None = None,
    sort: str = Query(default="relevance"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=60),
    db: Session = Depends(get_db),
) -> dict:
    stmt = select(Product).where(Product.is_archived.is_(False))
    count_stmt = select(func.count()).select_from(Product).where(Product.is_archived.is_(False))

    def narrow(*conditions):
        nonlocal stmt, count_stmt
        stmt = stmt.where(*conditions)
        count_stmt = count_stmt.where(*conditions)

    if q:
        term = f"%{q.strip().lower()}%"
        search = or_(
            func.lower(Product.name).like(term),
            func.lower(Product.sku).like(term),
            func.lower(Product.description).like(term),
            func.lower(func.coalesce(Product.isbn, "")).like(term),
            func.lower(func.coalesce(Product.author, "")).like(term),
            func.lower(func.coalesce(Product.brand, "")).like(term),
            func.lower(func.coalesce(Product.class_level, "")).like(term),
            func.lower(func.coalesce(Product.board, "")).like(term),
            func.lower(func.coalesce(Product.tags, "")).like(term),
        )
        narrow(search)
    if category:
        category_row = db.scalar(select(Category).where(Category.slug == category))
        narrow(Product.category_id == (category_row.id if category_row else "__none__"))
    if min_price is not None:
        narrow(Product.price_paise >= min_price * 100)
    if max_price is not None:
        narrow(Product.price_paise <= max_price * 100)
    if in_stock:
        narrow(Product.stock > 0)
    if condition:
        narrow(Product.condition == condition)
    if board:
        narrow(func.lower(func.coalesce(Product.board, "")) == board.strip().lower())
    if class_level:
        narrow(func.lower(func.coalesce(Product.class_level, "")) == class_level.strip().lower())
    if featured:
        narrow(Product.is_featured.is_(True))

    total = db.scalar(count_stmt) or 0
    order_by = SORT_OPTIONS.get(sort, SORT_OPTIONS["relevance"])
    rows = db.scalars(
        stmt.order_by(*order_by).offset((page - 1) * page_size).limit(page_size)
    ).unique().all()

    facets = db.execute(
        select(Product.board, Product.class_level).where(Product.is_archived.is_(False))
    ).all()

    return {
        "items": [product_out(p) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max((total + page_size - 1) // page_size, 1),
        "boards": sorted({b for b, _ in facets if b}),
        "class_levels": sorted({c for _, c in facets if c}, key=lambda v: (len(v), v)),
    }


@router.get("/products/{slug_or_id}")
def get_product(slug_or_id: str, db: Session = Depends(get_db)) -> dict:
    product = db.scalar(
        select(Product).where(
            or_(Product.slug == slug_or_id, Product.id == slug_or_id), Product.is_archived.is_(False)
        )
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")

    related_stmt = select(Product).where(Product.id != product.id, Product.is_archived.is_(False))
    if product.category_id:
        related_stmt = related_stmt.where(Product.category_id == product.category_id)
    related = db.scalars(related_stmt.order_by(Product.sold_count.desc()).limit(4)).unique().all()

    return {"product": product_out(product), "related": [product_out(p) for p in related]}


@router.post("/cart/quote")
def quote_cart(payload: list[CartLineInput], response: Response, db: Session = Depends(get_db)) -> dict:
    """Server-authoritative pricing for the cart and checkout summary."""
    if not payload:
        return order_service.quote_out(
            {
                "items": [],
                "subtotal_paise": 0,
                "discount_paise": 0,
                "shipping_paise": 0,
                "total_paise": 0,
                "coupon": None,
                "free_shipping_threshold_paise": settings.free_shipping_threshold_paise,
            }
        )
    response.headers["Cache-Control"] = "no-store"
    quote = order_service.price_order(db, payload, coupon_code=None, delivery=True)
    return order_service.quote_out(quote)


@router.post("/coupons/validate")
def validate_coupon(payload: CouponValidateInput, db: Session = Depends(get_db)) -> dict:
    coupon = db.scalar(select(Coupon).where(Coupon.code == payload.code.strip().upper()))
    if not coupon or not coupon.active:
        raise HTTPException(status_code=404, detail="Coupon not found")
    if payload.subtotal_paise < coupon.min_subtotal_paise:
        raise HTTPException(
            status_code=400,
            detail=f"Add ₹{((coupon.min_subtotal_paise - payload.subtotal_paise) / 100):.0f} more to use this coupon",
        )
    if coupon.kind == "percent":
        discount = payload.subtotal_paise * coupon.value // 100
        if coupon.max_discount_paise:
            discount = min(discount, coupon.max_discount_paise)
    else:
        discount = min(coupon.value, payload.subtotal_paise)
    return {
        "code": coupon.code,
        "kind": coupon.kind,
        "value": coupon.value,
        "discount_paise": discount,
        "description": (
            f"{coupon.value}% off" if coupon.kind == "percent" else f"₹{coupon.value // 100} off"
        ),
    }
