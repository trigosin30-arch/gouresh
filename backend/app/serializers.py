"""Response serialisers.

Only fields explicitly listed here ever leave the API, which keeps private
customer data (phone numbers of sellers, internal notes, password hashes) out
of public payloads.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session as OrmSession

from .constants import CONDITION_LABELS, LISTING_STATUS_LABELS
from .models import Listing, Product, ProductImage, User
from .services.commerce import available_stock


def product_availability(db: OrmSession, product: Product) -> dict[str, Any]:
    if product.status != "active":
        return {"state": "unavailable", "label": "Not for sale", "can_buy": False}
    if product.is_enquiry_only:
        return {"state": "enquiry_only", "label": "Enquire at store", "can_buy": False}
    stock = available_stock(db, product)
    if stock <= 0:
        return {"state": "out_of_stock", "label": "Out of stock", "can_buy": False}
    if product.stock_qty <= product.low_stock_threshold:
        return {"state": "low_stock", "label": f"Only {product.stock_qty} left", "can_buy": True, "stock": product.stock_qty}
    return {"state": "in_stock", "label": "In stock", "can_buy": True, "stock": product.stock_qty}


def discount_pct(product: Product) -> Optional[int]:
    compare = product.compare_at_price_paise or 0
    if compare > product.price_paise > 0:
        return round((compare - product.price_paise) * 100 / compare)
    return None


def product_card(db: OrmSession, product: Product, *, popularity: int = 0) -> dict[str, Any]:
    image = product.images[0] if product.images else None
    return {
        "id": product.id,
        "slug": product.slug,
        "title": product.title,
        "price_paise": product.price_paise,
        "compare_at_price_paise": product.compare_at_price_paise if discount_pct(product) else None,
        "discount_percent": discount_pct(product),
        "image_url": image.url if image else None,
        "image_alt": (image.alt_text if image else None) or product.title,
        "condition": product.condition,
        "condition_label": CONDITION_LABELS.get(product.condition, product.condition),
        "product_type": product.product_type,
        "category": {"id": product.category.id, "name": product.category.name, "slug": product.category.slug} if product.category else None,
        "author": product.author,
        "publisher": product.publisher,
        "isbn": product.isbn,
        "board": product.board,
        "class_level": product.class_level,
        "subject": product.subject,
        "book_type": product.book_type,
        "is_featured": product.is_featured,
        "availability": product_availability(db, product),
        "popularity": popularity,
        "created_at": product.created_at,
    }


def product_detail(db: OrmSession, product: Product, *, related: Optional[list[Product]] = None) -> dict[str, Any]:
    data = product_card(db, product)
    data.update(
        {
            "description": product.description,
            "sku": product.sku,
            "edition": product.edition,
            "language": product.language,
            "publication_year": product.publication_year,
            "academic_year": product.academic_year,
            "low_stock_threshold": product.low_stock_threshold,
            "images": [
                {"id": img.id, "url": img.url, "alt_text": img.alt_text or product.title} for img in product.images
            ],
            "related": [product_card(db, p) for p in (related or [])],
        }
    )
    return data


def product_admin(db: OrmSession, product: Product) -> dict[str, Any]:
    data = product_detail(db, product)
    data.update(
        {
            "status": product.status,
            "stock_qty": product.stock_qty,
            "cost_paise": product.cost_paise,
            "tax_rate_bp": product.tax_rate_bp,
            "is_enquiry_only": product.is_enquiry_only,
            "category_id": product.category_id,
            "updated_at": product.updated_at,
        }
    )
    return data


def listing_card(db: OrmSession, listing: Listing, *, include_seller: bool = False) -> dict[str, Any]:
    image = listing.images[0] if listing.images else None
    data = {
        "id": listing.id,
        "listing_code": listing.listing_code,
        "title": listing.title,
        "slug": listing.listing_code.lower(),
        "isbn": listing.isbn,
        "author": listing.author,
        "publisher": listing.publisher,
        "board": listing.board,
        "class_level": listing.class_level,
        "subject": listing.subject,
        "book_type": listing.book_type,
        "condition": listing.condition,
        "condition_label": CONDITION_LABELS.get(listing.condition, listing.condition),
        "condition_notes": listing.condition_notes,
        "asking_price_paise": listing.asking_price_paise,
        "status": listing.status,
        "status_label": LISTING_STATUS_LABELS.get(listing.status, listing.status),
        "image_url": image.url if image else None,
        "image_alt": (image.alt_text if image else None) or listing.title,
        "images": [{"id": i.id, "url": i.url, "alt_text": i.alt_text or listing.title} for i in listing.images],
        "published_at": listing.published_at,
        "created_at": listing.created_at,
        "seller_label": _seller_label(listing),
    }
    if include_seller:
        data["moderation_note"] = listing.moderation_note
        data["reviewed_at"] = listing.reviewed_at
    return data


def _seller_label(listing: Listing) -> str:
    seller = listing.seller
    if not seller:
        return "Store-verified seller"
    first = (seller.full_name or "Customer").split()[0]
    return f"{first} (verified account)"


def user_public(user: Optional[User]) -> Optional[dict[str, Any]]:
    if not user:
        return None
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role,
        "status": user.status,
        "email_verified": user.email_verified_at is not None,
        "created_at": user.created_at,
    }


def sales_counts(db: OrmSession) -> dict[str, int]:
    """Units sold per product from real, non-cancelled orders."""
    from .models import Order, OrderItem

    rows = db.execute(
        select(OrderItem.product_id, func.sum(OrderItem.quantity))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status.notin_(("cancelled",)), OrderItem.product_id.isnot(None))
        .group_by(OrderItem.product_id)
    ).all()
    return {row[0]: int(row[1] or 0) for row in rows}
