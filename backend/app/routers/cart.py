"""Cart and wishlist endpoints."""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..db import get_db
from ..models import Cart, Product, User, WishlistItem
from ..schemas import CartItemIn
from ..security import get_current_user, require_user
from ..serializers import product_card
from ..services.commerce import (
    cart_payload,
    get_guest_cart,
    get_or_create_user_cart,
    merge_carts,
    set_cart_item,
)
from ..services.rate_limit import enforce

router = APIRouter(prefix="/api", tags=["cart"])
GUEST_COOKIE = "asm_guest_cart"


def resolve_cart(request: Request, response: Optional[Response], db: OrmSession, user: Optional[User], *, create: bool = False) -> Optional[Cart]:
    if user:
        return get_or_create_user_cart(db, user) if create else db.scalar(select(Cart).where(Cart.user_id == user.id))
    token = request.cookies.get(GUEST_COOKIE)
    cart = get_guest_cart(db, token)
    if not cart and create:
        token = secrets.token_urlsafe(24)
        cart = Cart(guest_token=token)
        db.add(cart)
        db.commit()
        if response is not None:
            response.set_cookie(
                GUEST_COOKIE,
                token,
                httponly=True,
                samesite="lax",
                secure=settings.secure_cookies,
                max_age=60 * 60 * 24 * 30,
                path="/",
            )
    return cart


@router.get("/cart")
def get_cart(
    request: Request,
    fulfillment_type: str = Query(default="pickup"),
    coupon: Optional[str] = None,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    cart = resolve_cart(request, None, db, user)
    return cart_payload(db, cart, fulfillment_type=fulfillment_type, coupon_code=coupon)


@router.post("/cart/items")
def add_item(
    payload: CartItemIn,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "cart_write", 120, 600)
    cart = resolve_cart(request, response, db, user, create=True)
    set_cart_item(db, cart, payload.product_id, payload.quantity)
    return cart_payload(db, cart)


@router.delete("/cart/items/{product_id}")
def remove_item(
    product_id: str,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    cart = resolve_cart(request, response, db, user)
    if not cart:
        return cart_payload(db, None)
    _drop(db, cart, product_id)
    return cart_payload(db, cart)


def _drop(db: OrmSession, cart: Cart, product_id: str) -> None:
    from ..models import CartItem

    item = db.scalar(select(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_id == product_id))
    if item:
        db.delete(item)
        db.commit()


@router.delete("/cart")
def clear_cart(
    request: Request,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    cart = resolve_cart(request, None, db, user)
    if cart:
        for item in list(cart.items):
            db.delete(item)
        db.commit()
    return cart_payload(db, cart)


@router.post("/cart/merge")
def merge_guest_cart(
    request: Request,
    response: Response,
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
):
    token = request.cookies.get(GUEST_COOKIE)
    guest_cart = get_guest_cart(db, token)
    user_cart = get_or_create_user_cart(db, user)
    merge_carts(db, guest_cart, user_cart)
    response.delete_cookie(GUEST_COOKIE, path="/")
    return cart_payload(db, user_cart)


# --------------------------- wishlist ---------------------------
@router.get("/wishlist")
def get_wishlist(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(WishlistItem).where(WishlistItem.user_id == user.id).order_by(WishlistItem.created_at.desc())).all()
    items = []
    for row in rows:
        product = row.product
        if product and product.status == "active":
            items.append(product_card(db, product))
    return {"items": items}


@router.post("/wishlist/{product_id}")
def add_wishlist(product_id: str, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product or product.status != "active":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product not found")
    existing = db.scalar(select(WishlistItem).where(WishlistItem.user_id == user.id, WishlistItem.product_id == product_id))
    if not existing:
        db.add(WishlistItem(user_id=user.id, product_id=product_id))
        db.commit()
    return {"ok": True, "in_wishlist": True}


@router.delete("/wishlist/{product_id}")
def remove_wishlist(product_id: str, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    existing = db.scalar(select(WishlistItem).where(WishlistItem.user_id == user.id, WishlistItem.product_id == product_id))
    if existing:
        db.delete(existing)
        db.commit()
    return {"ok": True, "in_wishlist": False}
