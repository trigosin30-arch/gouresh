"""Commerce core: server-authoritative pricing, stock safety, orders."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..constants import ORDER_TRANSITIONS
from ..db import now
from ..models import (
    Cart,
    CartItem,
    Coupon,
    CouponRedemption,
    InventoryReservation,
    Order,
    OrderEvent,
    OrderItem,
    Payment,
    Product,
    Shipment,
    User,
)
from . import settings as store_settings
from .notifications import notify_staff, notify_user

MAX_QTY_PER_LINE = 20


# ---------------------------------------------------------------------------
# Money helpers
# ---------------------------------------------------------------------------
def rupees(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def bp_of(amount: int, basis_points: int) -> int:
    """Apply a basis-point rate with half-up integer rounding."""
    return (amount * basis_points + 5000) // 10000


# ---------------------------------------------------------------------------
# Stock
# ---------------------------------------------------------------------------
def reserve_window() -> timedelta:
    return timedelta(minutes=settings.stock_reservation_minutes)


def active_reserved(db: OrmSession, product_id: str) -> int:
    value = db.scalar(
        select(func.coalesce(func.sum(InventoryReservation.quantity), 0)).where(
            InventoryReservation.product_id == product_id,
            InventoryReservation.status == "active",
            InventoryReservation.expires_at > now(),
        )
    )
    return int(value or 0)


def available_stock(db: OrmSession, product: Product) -> int:
    return max(0, (product.stock_qty or 0) - active_reserved(db, product.id))


def commit_stock(db: OrmSession, product_id: str, quantity: int, *, reference_type: str, reference_id: str, actor_id: str | None = None, reason: str = "order_commit") -> None:
    """Atomically decrement stock. Raises 409 when stock is insufficient."""
    result = db.execute(
        update(Product)
        .where(Product.id == product_id, Product.stock_qty >= quantity)
        .values(stock_qty=Product.stock_qty - quantity)
    )
    if result.rowcount != 1:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            "One or more items just went out of stock. Please review your cart.",
        )
    balance = db.scalar(select(Product.stock_qty).where(Product.id == product_id)) or 0
    _movement(db, product_id, -quantity, balance, reason, reference_type, reference_id, actor_id)


def release_stock(db: OrmSession, product_id: str, quantity: int, *, reference_type: str, reference_id: str, actor_id: str | None = None, reason: str = "order_release") -> None:
    db.execute(update(Product).where(Product.id == product_id).values(stock_qty=Product.stock_qty + quantity))
    balance = db.scalar(select(Product.stock_qty).where(Product.id == product_id)) or 0
    _movement(db, product_id, quantity, balance, reason, reference_type, reference_id, actor_id)


def _movement(db, product_id, delta, balance, reason, reference_type, reference_id, actor_id) -> None:
    from ..models import InventoryMovement

    db.add(
        InventoryMovement(
            product_id=product_id,
            delta=delta,
            balance_after=balance,
            reason=reason,
            reference_type=reference_type,
            reference_id=reference_id,
            actor_user_id=actor_id,
        )
    )


def release_expired_reservations(db: OrmSession) -> int:
    """Release holds for unpaid online orders past their window."""
    expired = list(
        db.scalars(
            select(InventoryReservation).where(
                InventoryReservation.status == "active",
                InventoryReservation.expires_at <= now(),
            )
        )
    )
    for reservation in expired:
        reservation.status = "released"
        reservation.released_at = now()
        order = db.get(Order, reservation.order_id)
        if order and order.status == "pending_payment" and not order.stock_committed:
            _cancel_order(
                db,
                order,
                reason="Payment was not completed before the stock reservation expired.",
                actor=None,
                event_type="reservation_expired",
                restock=False,
            )
    if expired:
        db.commit()
    return len(expired)


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------
def validate_coupon(db: OrmSession, code: str, subtotal: int, user: Optional[User]) -> tuple[Coupon, int]:
    coupon = db.scalar(select(Coupon).where(func.lower(Coupon.code) == code.strip().lower()))
    if not coupon or not coupon.is_active:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Coupon code is not valid")
    current = now()
    if coupon.starts_at and _aware(coupon.starts_at) > current:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "This coupon is not active yet")
    if coupon.expires_at and _aware(coupon.expires_at) < current:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "This coupon has expired")
    if subtotal < coupon.min_order_paise:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            f"This coupon needs a minimum order of {rupees(coupon.min_order_paise)}",
        )
    if coupon.usage_limit is not None and coupon.used_count >= coupon.usage_limit:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "This coupon has reached its usage limit")
    if user:
        used = db.scalar(
            select(func.count(CouponRedemption.id)).where(
                CouponRedemption.coupon_id == coupon.id, CouponRedemption.user_id == user.id
            )
        )
        if used and used >= coupon.per_user_limit:
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "You have already used this coupon")
    discount = bp_of(subtotal, coupon.value * 100) if coupon.discount_type == "percent" else coupon.value
    if coupon.max_discount_paise:
        discount = min(discount, coupon.max_discount_paise)
    discount = min(discount, subtotal)
    return coupon, discount


def _aware(value: datetime) -> datetime:
    from datetime import timezone

    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Delivery / totals
# ---------------------------------------------------------------------------
def delivery_fee(db: OrmSession, subtotal_after_discount: int) -> int:
    if not store_settings.get(db, "delivery_enabled"):
        return 0
    fee = store_settings.get_int(db, "delivery_fee_paise")
    threshold = store_settings.get_int(db, "free_delivery_threshold_paise")
    if threshold and subtotal_after_discount >= threshold:
        return 0
    return max(0, fee)


def delivery_serviceable(db: OrmSession, pincode: Optional[str]) -> tuple[bool, str]:
    if not store_settings.get(db, "delivery_enabled"):
        return False, "Home delivery is not configured for this store."
    pincodes = store_settings.get(db, "delivery_pincodes") or []
    if not pincodes:
        return False, "Delivery areas have not been configured yet."
    if not pincode:
        return False, "Enter a PIN code to check delivery."
    if pincode not in pincodes:
        return False, "Home delivery is not available for this PIN code. Store pickup may be available."
    return True, ""


def compute_totals(
    db: OrmSession,
    subtotal: int,
    *,
    fulfillment_type: str,
    discount: int = 0,
) -> dict[str, int]:
    net = max(0, subtotal - discount)
    fee = delivery_fee(db, net) if fulfillment_type == "delivery" else 0
    tax = 0
    includes_tax = bool(store_settings.get(db, "prices_include_tax"))
    if store_settings.get(db, "tax_enabled"):
        rate = store_settings.get_int(db, "tax_rate_bp")
        if rate > 0:
            if includes_tax:
                # The tax portion already inside the displayed price.
                tax = (net * rate) // (10000 + rate)
            else:
                tax = bp_of(net, rate)
    total = net + fee + (0 if includes_tax else tax)
    return {
        "subtotal_paise": subtotal,
        "discount_paise": discount,
        "delivery_fee_paise": fee,
        "tax_paise": tax,
        "total_paise": max(0, total),
    }


# ---------------------------------------------------------------------------
# Cart
# ---------------------------------------------------------------------------
def get_or_create_user_cart(db: OrmSession, user: User) -> Cart:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
    if not cart:
        cart = Cart(user_id=user.id)
        db.add(cart)
        db.flush()
    return cart


def get_guest_cart(db: OrmSession, token: Optional[str]) -> Optional[Cart]:
    if not token:
        return None
    return db.scalar(select(Cart).where(Cart.guest_token == token))


def set_cart_item(db: OrmSession, cart: Cart, product_id: str, quantity: int) -> None:
    product = db.get(Product, product_id)
    if not product or product.status != "active" or product.product_type not in ("new", "used"):
        # Second-hand books sold from the store's own shelf are ordinary stock;
        # customer listings go through the marketplace purchase flow instead.
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "Product is not available")
    if product.is_enquiry_only:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            "This title is enquiry-only. Please contact the store to check availability.",
        )
    if quantity == 0:
        existing = db.scalar(
            select(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_id == product_id)
        )
        if existing:
            db.delete(existing)
        db.commit()
        return
    if quantity > MAX_QTY_PER_LINE:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, f"Maximum {MAX_QTY_PER_LINE} units per item")
    if available_stock(db, product) < quantity:
        raise HTTPException(http_status.HTTP_409_CONFLICT, "Not enough stock available for this item")
    existing = db.scalar(select(CartItem).where(CartItem.cart_id == cart.id, CartItem.product_id == product_id))
    if existing:
        existing.quantity = quantity
    else:
        db.add(CartItem(cart_id=cart.id, product_id=product_id, quantity=quantity))
    db.commit()


def merge_carts(db: OrmSession, guest_cart: Optional[Cart], user_cart: Cart) -> None:
    if not guest_cart or guest_cart.id == user_cart.id:
        return
    existing = {item.product_id: item for item in user_cart.items}
    for item in list(guest_cart.items):
        product = db.get(Product, item.product_id)
        if not product:
            continue
        target = existing.get(item.product_id)
        desired = item.quantity if target is None else target.quantity + item.quantity
        cap = min(MAX_QTY_PER_LINE, max(0, available_stock(db, product)))
        if cap == 0:
            continue
        if target:
            target.quantity = min(desired, cap)
        else:
            db.add(CartItem(cart_id=user_cart.id, product_id=item.product_id, quantity=min(desired, cap)))
    db.delete(guest_cart)
    db.commit()


def cart_payload(db: OrmSession, cart: Optional[Cart], *, fulfillment_type: str = "pickup", coupon_code: Optional[str] = None) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    subtotal = 0
    has_issue = False
    if cart:
        for item in cart.items:
            product = item.product
            available = available_stock(db, product) if product else 0
            issue = None
            if not product:
                issue = "This product is no longer available"
            elif product.status != "active":
                issue = "This product has been removed from sale"
            elif available <= 0:
                issue = "Out of stock"
            elif available < item.quantity:
                issue = f"Only {available} left in stock"
            if issue:
                has_issue = True
            unit = product.price_paise if product else 0
            line_total = unit * item.quantity if not issue else 0
            if not issue:
                subtotal += line_total
            items.append(
                {
                    "id": item.id,
                    "product_id": item.product_id,
                    "slug": product.slug if product else None,
                    "title": product.title if product else "Unavailable product",
                    "image_url": product.images[0].url if product and product.images else None,
                    "condition": product.condition if product else None,
                    "unit_price_paise": unit,
                    "quantity": item.quantity,
                    "line_total_paise": line_total,
                    "available_stock": available,
                    "issue": issue,
                }
            )
    discount = 0
    coupon_info = None
    coupon = None
    if coupon_code and subtotal > 0:
        try:
            coupon, discount = validate_coupon(db, coupon_code, subtotal, cart.user_id and db.get(User, cart.user_id))
            coupon_info = {"code": coupon.code, "description": coupon.description, "discount_paise": discount}
        except HTTPException as exc:
            coupon_info = {"code": coupon_code, "error": exc.detail, "discount_paise": 0}
            discount = 0
    totals = compute_totals(db, subtotal, fulfillment_type=fulfillment_type, discount=discount)
    min_order = store_settings.get_int(db, "min_order_paise")
    return {
        "cart_id": cart.id if cart else None,
        "items": items,
        "item_count": sum(i["quantity"] for i in items),
        "coupon": coupon_info,
        **totals,
        "min_order_paise": min_order,
        "below_minimum": subtotal > 0 and subtotal < min_order,
        "has_issue": has_issue,
        "payment_methods": store_settings.available_payment_methods(db),
        "delivery_enabled": bool(store_settings.get(db, "delivery_enabled") and (store_settings.get(db, "delivery_pincodes") or [])),
        "pickup_enabled": bool(store_settings.get(db, "pickup_enabled")),
        "can_checkout": bool(items) and not has_issue and subtotal > 0 and subtotal >= min_order,
    }


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------
def generate_order_number(db: OrmSession) -> str:
    stamp = datetime.utcnow().strftime("%y%m%d")
    for _ in range(12):
        candidate = f"ASM-{stamp}-{secrets.token_hex(3).upper()}"
        if not db.scalar(select(Order.id).where(Order.order_number == candidate)):
            return candidate
    return f"ASM-{stamp}-{secrets.token_hex(6).upper()}"


def add_event(db, order: Order, event_type: str, *, actor: Optional[User] = None, actor_label: str | None = None, from_status: str | None = None, to_status: str | None = None, note: str | None = None, visible: bool = True) -> None:
    db.add(
        OrderEvent(
            order_id=order.id,
            actor_user_id=actor.id if actor else None,
            actor_label=actor_label or (actor.full_name if actor else "system"),
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            note=note,
            is_customer_visible=visible,
        )
    )


def assert_transition(current: str, target: str) -> None:
    if target == current:
        return
    allowed = ORDER_TRANSITIONS.get(current, ())
    if target not in allowed:
        raise HTTPException(
            http_status.HTTP_409_CONFLICT,
            f"Cannot move an order from '{current}' to '{target}'",
        )


def _cancel_order(db, order: Order, *, reason: str, actor: Optional[User], event_type: str = "cancelled", restock: bool = True) -> None:
    previous = order.status
    order.status = "cancelled"
    order.cancelled_at = now()
    if restock and order.stock_committed:
        for item in order.items:
            if item.product_id:
                release_stock(
                    db,
                    item.product_id,
                    item.quantity,
                    reference_type="order",
                    reference_id=order.id,
                    actor_id=actor.id if actor else None,
                    reason="order_cancelled",
                )
        order.stock_committed = False
    for reservation in db.scalars(select(InventoryReservation).where(InventoryReservation.order_id == order.id, InventoryReservation.status == "active")):
        reservation.status = "released"
        reservation.released_at = now()
    add_event(db, order, event_type, actor=actor, actor_label="system" if not actor else None, from_status=previous, to_status="cancelled", note=reason)


def checkout(
    db: OrmSession,
    *,
    cart: Optional[Cart],
    payload,
    user: Optional[User],
) -> Order:
    """Create an order from a cart. All money is recomputed here."""
    if user is not None and user.status == "restricted":
        raise HTTPException(
            http_status.HTTP_403_FORBIDDEN,
            "Your account is restricted. Please contact the store to resolve this before ordering.",
        )
    if not cart or not cart.items:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Your cart is empty")

    # Re-price from the database (never trust client prices).
    priced = cart_payload(
        db,
        cart,
        fulfillment_type=payload.fulfillment_type,
        coupon_code=payload.coupon_code,
    )
    if priced["has_issue"]:
        raise HTTPException(http_status.HTTP_409_CONFLICT, "Some items in your cart are unavailable. Update the cart and retry.")
    if priced["subtotal_paise"] <= 0:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Your cart is empty")

    min_order = priced["min_order_paise"]
    if min_order and priced["subtotal_paise"] < min_order:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, f"Minimum order value is {rupees(min_order)}")

    # Fulfilment rules
    ship = None
    if payload.fulfillment_type == "delivery":
        if not store_settings.get(db, "delivery_enabled"):
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Home delivery is not currently available")
        if not payload.address:
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "A delivery address is required")
        ok, message = delivery_serviceable(db, payload.address.pincode)
        if not ok:
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, message)
        ship = payload.address
        if payload.save_address and user:
            from ..models import Address

            db.add(
                Address(
                    user_id=user.id,
                    label=ship.label or "Home",
                    full_name=ship.full_name,
                    phone=ship.phone,
                    line1=ship.line1,
                    line2=ship.line2,
                    locality=ship.locality,
                    city=ship.city,
                    state=ship.state,
                    pincode=ship.pincode,
                    is_default=not db.scalar(select(func.count(Address.id)).where(Address.user_id == user.id)),
                )
            )
    else:
        if not store_settings.get(db, "pickup_enabled"):
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Store pickup is not currently available")

    methods = store_settings.available_payment_methods(db)
    if payload.payment_method not in methods:
        raise HTTPException(
            http_status.HTTP_400_BAD_REQUEST,
            "That payment method is not configured for this store yet.",
        )

    coupon = None
    if payload.coupon_code:
        coupon, _ = validate_coupon(db, payload.coupon_code, priced["subtotal_paise"], user)

    online = payload.payment_method == "online"
    order = Order(
        order_number=generate_order_number(db),
        user_id=user.id if user else None,
        order_type="store",
        status="pending_payment" if online else "placed",
        payment_method=payload.payment_method,
        payment_status="pending",
        subtotal_paise=priced["subtotal_paise"],
        discount_paise=priced["discount_paise"],
        delivery_fee_paise=priced["delivery_fee_paise"],
        tax_paise=priced["tax_paise"],
        total_paise=priced["total_paise"],
        coupon_code=coupon.code if coupon else None,
        customer_name=payload.customer_name,
        customer_email=str(payload.customer_email),
        customer_phone=payload.customer_phone,
        fulfillment_type=payload.fulfillment_type,
        ship_line1=ship.line1 if ship else None,
        ship_line2=ship.line2 if ship else None,
        ship_locality=ship.locality if ship else None,
        ship_city=ship.city if ship else None,
        ship_state=ship.state if ship else None,
        ship_pincode=ship.pincode if ship else None,
        customer_note=payload.customer_note,
        tracking_token=secrets.token_urlsafe(24),
        stock_committed=not online,
    )
    db.add(order)
    db.flush()

    for item in cart.items:
        product = item.product
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=product.id,
                title_snapshot=product.title,
                sku_snapshot=product.sku,
                condition_snapshot=product.condition,
                unit_price_paise=product.price_paise,
                quantity=item.quantity,
                line_total_paise=product.price_paise * item.quantity,
                tax_rate_bp=product.tax_rate_bp,
            )
        )
        if online:
            db.add(
                InventoryReservation(
                    product_id=product.id,
                    order_id=order.id,
                    quantity=item.quantity,
                    expires_at=now() + reserve_window(),
                )
            )
        else:
            commit_stock(
                db,
                product.id,
                item.quantity,
                reference_type="order",
                reference_id=order.id,
                actor_id=user.id if user else None,
            )

    db.add(Shipment(order_id=order.id, mode=payload.fulfillment_type, status="pending"))
    add_event(db, order, "order_created", actor=user, actor_label=user.full_name if user else "guest", to_status=order.status, note="Order placed")
    if coupon:
        coupon.used_count += 1
        db.add(
            CouponRedemption(
                coupon_id=coupon.id,
                user_id=user.id if user else None,
                order_id=order.id,
                amount_paise=priced["discount_paise"],
            )
        )
    db.add(
        Payment(
            order_id=order.id,
            method=payload.payment_method,
            gateway="razorpay" if online else None,
            amount_paise=order.total_paise,
            status="pending",
            idempotency_key=f"order:{order.id}:initial",
        )
    )

    # Clear the cart only after the order rows are safely staged.
    for item in list(cart.items):
        db.delete(item)
    db.commit()

    notify_user(
        db,
        user,
        "order_confirmation",
        f"Order {order.order_number} received",
        (
            f"Thank you {order.customer_name}. We have recorded order {order.order_number} "
            f"for {rupees(order.total_paise)}. Track it with reference {order.order_number}. "
            + ("Payment is pending until the online payment is confirmed." if online else "Pay on delivery/pickup as selected.")
        ),
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    return order


def purchase_listing(db: OrmSession, listing, payload, buyer: Optional[User]) -> Order:
    """Buy a second-hand listing with a conditional status swap (no double-sell)."""
    from ..models import CommissionRecord, Listing

    result = db.execute(
        update(Listing)
        .where(Listing.id == listing.id, Listing.status == "active")
        .values(status="sold", sold_at=now())
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(http_status.HTTP_409_CONFLICT, "This listing has already been sold or withdrawn")

    if payload.fulfillment_type == "delivery":
        if not store_settings.get(db, "delivery_enabled"):
            db.rollback()
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Home delivery is not currently available")
        if not payload.address:
            db.rollback()
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "A delivery address is required")
        ok, message = delivery_serviceable(db, payload.address.pincode)
        if not ok:
            db.rollback()
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, message)
        ship = payload.address
    else:
        if not store_settings.get(db, "pickup_enabled"):
            db.rollback()
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Store pickup is not currently available")
        ship = None

    methods = store_settings.available_payment_methods(db)
    if payload.payment_method not in methods:
        db.rollback()
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "That payment method is not configured for this store yet.")

    price = listing.asking_price_paise
    totals = compute_totals(db, price, fulfillment_type=payload.fulfillment_type, discount=0)
    rate_bp = store_settings.get_int(db, "marketplace_commission_bp")
    commission = bp_of(price, rate_bp)
    proceeds = price - commission
    online = payload.payment_method == "online"

    order = Order(
        order_number=generate_order_number(db),
        user_id=buyer.id if buyer else None,
        order_type="marketplace",
        status="pending_payment" if online else "placed",
        payment_method=payload.payment_method,
        payment_status="pending",
        subtotal_paise=totals["subtotal_paise"],
        discount_paise=0,
        delivery_fee_paise=totals["delivery_fee_paise"],
        tax_paise=totals["tax_paise"],
        total_paise=totals["total_paise"],
        customer_name=payload.customer_name,
        customer_email=str(payload.customer_email),
        customer_phone=payload.customer_phone,
        fulfillment_type=payload.fulfillment_type,
        ship_line1=ship.line1 if ship else None,
        ship_line2=ship.line2 if ship else None,
        ship_locality=ship.locality if ship else None,
        ship_city=ship.city if ship else None,
        ship_state=ship.state if ship else None,
        ship_pincode=ship.pincode if ship else None,
        customer_note=payload.customer_note,
        tracking_token=secrets.token_urlsafe(24),
        stock_committed=True,
    )
    db.add(order)
    db.flush()
    db.add(
        OrderItem(
            order_id=order.id,
            product_id=None,
            listing_id=listing.id,
            title_snapshot=listing.title,
            condition_snapshot=listing.condition,
            unit_price_paise=price,
            quantity=1,
            line_total_paise=price,
            commission_rate_bp=rate_bp,
            commission_paise=commission,
            seller_proceeds_paise=proceeds,
            seller_id=listing.seller_id,
        )
    )
    db.add(CommissionRecord(
        order_id=order.id,
        listing_id=listing.id,
        seller_id=listing.seller_id,
        gross_paise=price,
        commission_rate_bp=rate_bp,
        commission_paise=commission,
        seller_proceeds_paise=proceeds,
        status="accrued",
    ))
    db.add(Shipment(order_id=order.id, mode=payload.fulfillment_type, status="pending"))
    add_event(db, order, "order_created", actor=buyer, actor_label=buyer.full_name if buyer else "guest", to_status=order.status, note="Second-hand purchase placed")
    db.add(
        Payment(
            order_id=order.id,
            method=payload.payment_method,
            gateway="razorpay" if online else None,
            amount_paise=order.total_paise,
            status="pending",
            idempotency_key=f"order:{order.id}:initial",
        )
    )
    db.commit()

    notify_user(
        db,
        buyer,
        "marketplace_order",
        f"Order {order.order_number} received",
        f"Your purchase of '{listing.title}' is recorded as order {order.order_number}. The store will verify the copy before handover.",
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
    notify_user(
        db,
        db.get(User, listing.seller_id),
        "marketplace_sale",
        f"Your listing {listing.listing_code} has a buyer",
        f"'{listing.title}' was purchased. Recorded sale value {rupees(price)}, commission {rupees(commission)}, your proceeds {rupees(proceeds)}. The store will contact you about handover.",
        related_type="listing",
        related_id=listing.id,
    )
    return order


def order_public(order: Order) -> dict[str, Any]:
    return {
        "id": order.id,
        "order_number": order.order_number,
        "status": order.status,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "order_type": order.order_type,
        "total_paise": order.total_paise,
        "subtotal_paise": order.subtotal_paise,
        "discount_paise": order.discount_paise,
        "delivery_fee_paise": order.delivery_fee_paise,
        "tax_paise": order.tax_paise,
        "refunded_paise": order.refunded_paise,
        "fulfillment_type": order.fulfillment_type,
        "created_at": order.created_at,
        "placed_at": order.placed_at,
        "delivered_at": order.delivered_at,
        "cancelled_at": order.cancelled_at,
        "customer_note": order.customer_note,
        "tracking_token": order.tracking_token,
        "items": [
            {
                "id": item.id,
                "title": item.title_snapshot,
                "quantity": item.quantity,
                "unit_price_paise": item.unit_price_paise,
                "line_total_paise": item.line_total_paise,
                "condition": item.condition_snapshot,
                "listing_id": item.listing_id,
                "product_id": item.product_id,
            }
            for item in order.items
        ],
        "shipment": {
            "mode": order.shipment.mode if order.shipment else None,
            "status": order.shipment.status if order.shipment else None,
            "carrier": order.shipment.carrier if order.shipment else None,
            "tracking_number": order.shipment.tracking_number if order.shipment else None,
        } if order.shipment else None,
        "shipping_address": {
            "line1": order.ship_line1,
            "line2": order.ship_line2,
            "locality": order.ship_locality,
            "city": order.ship_city,
            "state": order.ship_state,
            "pincode": order.ship_pincode,
        } if order.fulfillment_type == "delivery" else None,
    }


def next_statuses(current: str) -> list[str]:
    return list(ORDER_TRANSITIONS.get(current, ()))


def sales_metrics(db: OrmSession, start: Optional[datetime] = None, end: Optional[datetime] = None) -> dict[str, Any]:
    """Revenue definition: paid money on orders that are not cancelled.

    * cancelled orders are excluded entirely (they never recognise revenue);
    * pending/failed payments contribute 0 revenue but are counted separately;
    * refunds are subtracted from gross revenue.
    """
    from sqlalchemy import and_

    conditions = [Order.status.notin_(("cancelled",))]
    if start:
        conditions.append(Order.placed_at >= start)
    if end:
        conditions.append(Order.placed_at <= end)

    paid_orders = list(db.scalars(select(Order).where(and_(*conditions))))
    gross = sum(o.total_paise for o in paid_orders if o.payment_status in ("paid", "partially_refunded", "refunded"))
    refunded = sum(o.refunded_paise for o in paid_orders)
    pending_payment = sum(o.total_paise for o in paid_orders if o.payment_status == "pending")
    order_count = db.scalar(select(func.count(Order.id)).where(and_(*conditions))) or 0
    return {
        "orders_count": int(order_count),
        "gross_paid_paise": int(gross),
        "refunds_paise": int(refunded),
        "net_revenue_paise": int(max(0, gross - refunded)),
        "pending_payment_paise": int(pending_payment),
    }


def confirm_online_payment(db: OrmSession, order: Order, payment: Payment, provider_payment_id: str, amount_paise: int | None = None) -> None:
    """Idempotently mark a payment paid and commit reserved stock."""
    if payment.status == "paid":
        return
    if amount_paise is not None and amount_paise != payment.amount_paise:
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Payment amount does not match the order total")
    payment.status = "paid"
    payment.provider_reference = provider_payment_id
    payment.captured_at = now()
    order.payment_status = "paid"
    previous = order.status
    conflicted: list[int] = []
    if order.status == "pending_payment":
        order.status = "placed"
        for reservation in db.scalars(
            select(InventoryReservation).where(
                InventoryReservation.order_id == order.id, InventoryReservation.status == "active"
            )
        ):
            product_id = reservation.product_id
            try:
                commit_stock(
                    db,
                    product_id,
                    reservation.quantity,
                    reference_type="order",
                    reference_id=order.id,
                    reason="payment_commit",
                )
            except HTTPException:
                add_event(
                    db,
                    order,
                    "stock_conflict",
                    actor_label="system",
                    note="Payment captured after stock ran out. Refund or substitute required.",
                    visible=False,
                )
                conflicted.append(reservation.quantity)
            reservation.status = "consumed"
        order.stock_committed = True
        add_event(db, order, "payment_confirmed", actor_label="system", from_status=previous, to_status=order.status, note="Online payment verified")
    else:
        add_event(db, order, "payment_confirmed", actor_label="system", note="Online payment verified")
    db.commit()
    if conflicted:
        # Money was captured but the stock was taken first: tell staff, loudly.
        staff = list(db.scalars(select(User).where(User.role.in_(("staff", "admin")), User.status == "active")))
        notify_staff(
            db,
            staff,
            "stock_conflict",
            f"Stock conflict on paid order {order.order_number}",
            f"Payment was captured for order {order.order_number}, but stock was no longer available. "
            "Refund the customer or arrange a substitute before fulfilling.",
        )
    notify_user(
        db,
        db.get(User, order.user_id) if order.user_id else None,
        "payment_confirmed",
        f"Payment confirmed for {order.order_number}",
        f"We received {rupees(payment.amount_paise)} for order {order.order_number}.",
        related_type="order",
        related_id=order.id,
        email=order.customer_email,
    )
