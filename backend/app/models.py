"""Normalised domain model for Ankit Stationery Mart.

Conventions
-----------
* Money is stored as integer paise (never floats).
* Every mutable table carries ``created_at`` / ``updated_at`` UTC timestamps.
* Historical order lines store snapshots (title, SKU, unit price) so later
  product edits can never rewrite past orders.
* Foreign keys and unique constraints are explicit; SQLite enforces them via
  ``PRAGMA foreign_keys=ON`` in :mod:`app.db`.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .db import Base, now


def new_id() -> str:
    return uuid.uuid4().hex


def short_ref(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now, nullable=False)


# ---------------------------------------------------------------------------
# Identity & access
# ---------------------------------------------------------------------------
class User(TimestampMixin, Base):
    __tablename__ = "users"

    id = Column(String(32), primary_key=True, default=new_id)
    email = Column(String(255), unique=True, nullable=False, index=True)
    phone = Column(String(20), unique=True, nullable=True)
    full_name = Column(String(120), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="customer", index=True)
    status = Column(String(20), nullable=False, default="active")
    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    phone_verified_at = Column(DateTime(timezone=True), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    # Free-form seller payout reference is NOT stored here; see Payout.

    addresses = relationship("Address", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(64), primary_key=True)  # random token id (hash stored)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False)
    csrf_token = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(255), nullable=True)

    user = relationship("User", back_populates="sessions")


class Address(TimestampMixin, Base):
    __tablename__ = "addresses"

    id = Column(String(32), primary_key=True, default=new_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(40), nullable=False, default="Home")
    full_name = Column(String(120), nullable=False)
    phone = Column(String(20), nullable=False)
    line1 = Column(String(255), nullable=False)
    line2 = Column(String(255), nullable=True)
    locality = Column(String(120), nullable=False)
    city = Column(String(120), nullable=False)
    state = Column(String(120), nullable=False)
    pincode = Column(String(10), nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="addresses")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(String(32), primary_key=True, default=new_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------
class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id = Column(String(32), primary_key=True, default=new_id)
    slug = Column(String(80), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    sort_order = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_system = Column(Boolean, default=False, nullable=False)  # second-hand marketplace pseudo-category

    products = relationship("Product", back_populates="category")


class Product(TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_products_status_created", "status", "created_at"),
        Index("ix_products_category_status", "category_id", "status"),
        Index("ix_products_board_class", "board", "class_level"),
    )

    id = Column(String(32), primary_key=True, default=new_id)
    slug = Column(String(180), unique=True, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category_id = Column(String(32), ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False)
    sku = Column(String(64), unique=True, nullable=True, index=True)
    isbn = Column(String(20), nullable=True, index=True)
    product_type = Column(String(10), nullable=False, default="new", index=True)
    condition = Column(String(20), nullable=False, default="new")
    # Book metadata (nullable for general stationery)
    author = Column(String(180), nullable=True)
    publisher = Column(String(180), nullable=True)
    subject = Column(String(120), nullable=True)
    board = Column(String(40), nullable=True)
    class_level = Column(String(20), nullable=True)
    book_type = Column(String(30), nullable=True)
    edition = Column(String(60), nullable=True)
    language = Column(String(60), nullable=True)
    publication_year = Column(Integer, nullable=True)
    academic_year = Column(String(20), nullable=True)
    # Pricing (paise)
    price_paise = Column(BigInteger, nullable=False, default=0)
    compare_at_price_paise = Column(BigInteger, nullable=True)
    cost_paise = Column(BigInteger, nullable=True)
    tax_rate_bp = Column(Integer, nullable=False, default=0)  # basis points, 0 = not configured
    # Inventory
    stock_qty = Column(Integer, nullable=False, default=0)
    low_stock_threshold = Column(Integer, nullable=False, default=5)
    status = Column(String(20), nullable=False, default="draft", index=True)
    is_featured = Column(Boolean, default=False, nullable=False)
    is_enquiry_only = Column(Boolean, nullable=False, default=False)
    created_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    category = relationship("Category", back_populates="products")
    images = relationship(
        "ProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order",
    )


class ProductImage(Base):
    __tablename__ = "product_images"

    id = Column(String(32), primary_key=True, default=new_id)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    url = Column(String(500), nullable=False)
    alt_text = Column(String(255), nullable=True)
    sort_order = Column(Integer, default=0, nullable=False)

    product = relationship("Product", back_populates="images")


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (Index("ix_inventory_product_created", "product_id", "created_at"),)

    id = Column(String(32), primary_key=True, default=new_id)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    delta = Column(Integer, nullable=False)
    balance_after = Column(Integer, nullable=False)
    reason = Column(String(40), nullable=False)
    reference_type = Column(String(40), nullable=True)
    reference_id = Column(String(64), nullable=True)
    note = Column(String(255), nullable=True)
    actor_user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)


class InventoryReservation(Base):
    """Short-lived stock hold for unpaid online orders."""

    __tablename__ = "inventory_reservations"

    id = Column(String(32), primary_key=True, default=new_id)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="active")  # active|released|consumed
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    released_at = Column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------------------
# Cart & wishlist
# ---------------------------------------------------------------------------
class Cart(TimestampMixin, Base):
    __tablename__ = "carts"

    id = Column(String(32), primary_key=True, default=new_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, unique=True)
    guest_token = Column(String(64), unique=True, nullable=True, index=True)

    items = relationship("CartItem", back_populates="cart", cascade="all, delete-orphan")


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("cart_id", "product_id", name="uq_cart_product"),)

    id = Column(String(32), primary_key=True, default=new_id)
    cart_id = Column(String(32), ForeignKey("carts.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    added_at = Column(DateTime(timezone=True), default=now, nullable=False)

    cart = relationship("Cart", back_populates="items")
    product = relationship("Product")


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),)

    id = Column(String(32), primary_key=True, default=new_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)

    product = relationship("Product")


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------
class Coupon(TimestampMixin, Base):
    __tablename__ = "coupons"

    id = Column(String(32), primary_key=True, default=new_id)
    code = Column(String(40), unique=True, nullable=False, index=True)
    description = Column(String(255), nullable=True)
    discount_type = Column(String(20), nullable=False, default="percent")  # percent|flat
    value = Column(Integer, nullable=False)  # percent (1-100) or paise
    min_order_paise = Column(BigInteger, nullable=False, default=0)
    max_discount_paise = Column(BigInteger, nullable=True)
    starts_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    usage_limit = Column(Integer, nullable=True)
    used_count = Column(Integer, nullable=False, default=0)
    per_user_limit = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)


class CouponRedemption(Base):
    __tablename__ = "coupon_redemptions"

    id = Column(String(32), primary_key=True, default=new_id)
    coupon_id = Column(String(32), ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    amount_paise = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)


# ---------------------------------------------------------------------------
# Orders & payments
# ---------------------------------------------------------------------------
class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_status_created", "status", "created_at"),
        Index("ix_orders_user_created", "user_id", "created_at"),
    )

    id = Column(String(32), primary_key=True, default=new_id)
    order_number = Column(String(24), unique=True, nullable=False, index=True)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    order_type = Column(String(20), nullable=False, default="store")
    status = Column(String(30), nullable=False, default="placed", index=True)
    payment_status = Column(String(20), nullable=False, default="pending", index=True)
    payment_method = Column(String(20), nullable=False, default="cod")
    # Money snapshot (paise)
    subtotal_paise = Column(BigInteger, nullable=False, default=0)
    discount_paise = Column(BigInteger, nullable=False, default=0)
    delivery_fee_paise = Column(BigInteger, nullable=False, default=0)
    tax_paise = Column(BigInteger, nullable=False, default=0)
    total_paise = Column(BigInteger, nullable=False, default=0)
    refunded_paise = Column(BigInteger, nullable=False, default=0)
    coupon_code = Column(String(40), nullable=True)
    # Customer snapshot
    customer_name = Column(String(120), nullable=False)
    customer_email = Column(String(255), nullable=False)
    customer_phone = Column(String(20), nullable=False)
    fulfillment_type = Column(String(20), nullable=False, default="delivery")
    ship_line1 = Column(String(255), nullable=True)
    ship_line2 = Column(String(255), nullable=True)
    ship_locality = Column(String(120), nullable=True)
    ship_city = Column(String(120), nullable=True)
    ship_state = Column(String(120), nullable=True)
    ship_pincode = Column(String(10), nullable=True)
    customer_note = Column(Text, nullable=True)
    internal_note = Column(Text, nullable=True)
    tracking_token = Column(String(64), unique=True, nullable=False, index=True)
    placed_at = Column(DateTime(timezone=True), default=now, nullable=False)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    stock_committed = Column(Boolean, nullable=False, default=True)

    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="order", cascade="all, delete-orphan")
    events = relationship("OrderEvent", back_populates="order", cascade="all, delete-orphan", order_by="OrderEvent.created_at")
    shipment = relationship("Shipment", back_populates="order", uselist=False, cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(String(32), primary_key=True, default=new_id)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    listing_id = Column(String(32), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True)
    title_snapshot = Column(String(255), nullable=False)
    sku_snapshot = Column(String(64), nullable=True)
    condition_snapshot = Column(String(20), nullable=True)
    unit_price_paise = Column(BigInteger, nullable=False)
    quantity = Column(Integer, nullable=False)
    line_total_paise = Column(BigInteger, nullable=False)
    tax_rate_bp = Column(Integer, nullable=False, default=0)
    commission_rate_bp = Column(Integer, nullable=True)
    commission_paise = Column(BigInteger, nullable=True)
    seller_proceeds_paise = Column(BigInteger, nullable=True)
    seller_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")
    listing = relationship("Listing", foreign_keys=[listing_id])


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id = Column(String(32), primary_key=True, default=new_id)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    method = Column(String(20), nullable=False)  # cod|online|invoice
    gateway = Column(String(30), nullable=True)
    amount_paise = Column(BigInteger, nullable=False)
    status = Column(String(25), nullable=False, default="pending", index=True)
    provider_reference = Column(String(120), nullable=True, index=True)
    idempotency_key = Column(String(120), unique=True, nullable=False)
    failure_reason = Column(String(255), nullable=True)
    captured_at = Column(DateTime(timezone=True), nullable=True)

    order = relationship("Order", back_populates="payments")
    events = relationship("PaymentEvent", back_populates="payment", cascade="all, delete-orphan")


class PaymentEvent(Base):
    __tablename__ = "payment_events"

    id = Column(String(32), primary_key=True, default=new_id)
    payment_id = Column(String(32), ForeignKey("payments.id", ondelete="CASCADE"), nullable=True)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    provider = Column(String(30), nullable=False, default="razorpay")
    event_id = Column(String(120), unique=True, nullable=False, index=True)
    event_type = Column(String(60), nullable=False)
    payload = Column(JSON, nullable=False)
    status = Column(String(20), nullable=False, default="processed")
    error = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)

    payment = relationship("Payment", back_populates="events")


class Shipment(TimestampMixin, Base):
    __tablename__ = "shipments"

    id = Column(String(32), primary_key=True, default=new_id)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, unique=True)
    mode = Column(String(20), nullable=False, default="delivery")  # delivery|pickup
    carrier = Column(String(80), nullable=True)
    tracking_number = Column(String(120), nullable=True)
    status = Column(String(30), nullable=False, default="pending")
    dispatched_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    note = Column(String(255), nullable=True)

    order = relationship("Order", back_populates="shipment")


class OrderEvent(Base):
    __tablename__ = "order_events"

    id = Column(String(32), primary_key=True, default=new_id)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_label = Column(String(120), nullable=True)  # "customer" | admin name
    event_type = Column(String(40), nullable=False)
    from_status = Column(String(30), nullable=True)
    to_status = Column(String(30), nullable=True)
    note = Column(Text, nullable=True)
    is_customer_visible = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)

    order = relationship("Order", back_populates="events")


class ReturnRequest(TimestampMixin, Base):
    __tablename__ = "return_requests"

    id = Column(String(32), primary_key=True, default=new_id)
    reference = Column(String(24), unique=True, nullable=False, index=True)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    request_type = Column(String(20), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="requested", index=True)
    admin_note = Column(Text, nullable=True)
    refund_amount_paise = Column(BigInteger, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


# ---------------------------------------------------------------------------
# Second-hand marketplace
# ---------------------------------------------------------------------------
class Listing(TimestampMixin, Base):
    __tablename__ = "listings"
    __table_args__ = (
        Index("ix_listings_status_created", "status", "created_at"),
        Index("ix_listings_seller_created", "seller_id", "created_at"),
    )

    id = Column(String(32), primary_key=True, default=new_id)
    listing_code = Column(String(24), unique=True, nullable=False, index=True)
    seller_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    isbn = Column(String(20), nullable=True, index=True)
    author = Column(String(180), nullable=True)
    publisher = Column(String(180), nullable=True)
    board = Column(String(40), nullable=True)
    class_level = Column(String(20), nullable=True)
    subject = Column(String(120), nullable=True)
    book_type = Column(String(30), nullable=True)
    condition = Column(String(20), nullable=False, default="good")
    condition_notes = Column(Text, nullable=True)
    asking_price_paise = Column(BigInteger, nullable=False)
    status = Column(String(25), nullable=False, default="pending_review", index=True)
    moderation_note = Column(Text, nullable=True)
    reviewed_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    sold_at = Column(DateTime(timezone=True), nullable=True)

    images = relationship("ListingImage", back_populates="listing", cascade="all, delete-orphan", order_by="ListingImage.sort_order")
    seller = relationship("User", foreign_keys=[seller_id])


class ListingImage(Base):
    __tablename__ = "listing_images"

    id = Column(String(32), primary_key=True, default=new_id)
    listing_id = Column(String(32), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    url = Column(String(500), nullable=False)
    alt_text = Column(String(255), nullable=True)
    sort_order = Column(Integer, default=0, nullable=False)

    listing = relationship("Listing", back_populates="images")


class ListingReport(Base):
    __tablename__ = "listing_reports"

    id = Column(String(32), primary_key=True, default=new_id)
    listing_id = Column(String(32), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    reporter_user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason = Column(String(80), nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="open", index=True)
    admin_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)


class BookSubmission(TimestampMixin, Base):
    __tablename__ = "book_submissions"

    id = Column(String(32), primary_key=True, default=new_id)
    reference = Column(String(24), unique=True, nullable=False, index=True)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    book_title = Column(String(255), nullable=False)
    isbn = Column(String(20), nullable=True)
    author = Column(String(180), nullable=True)
    publisher = Column(String(180), nullable=True)
    board = Column(String(40), nullable=True)
    class_level = Column(String(20), nullable=True)
    subject = Column(String(120), nullable=True)
    condition = Column(String(20), nullable=False)
    expected_price_paise = Column(BigInteger, nullable=True)
    selling_method = Column(String(30), nullable=False, default="marketplace_listing")
    contact_name = Column(String(120), nullable=False)
    contact_phone = Column(String(20), nullable=False)
    contact_email = Column(String(255), nullable=False)
    pickup_address = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="submitted", index=True)
    admin_note = Column(Text, nullable=True)
    reviewed_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    listing_id = Column(String(32), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True)
    photos = Column(JSON, nullable=False, default=list)  # list of uploaded file URLs

    user = relationship("User", foreign_keys=[user_id])


class CommissionRecord(Base):
    __tablename__ = "commission_records"
    __table_args__ = (UniqueConstraint("order_id", name="uq_commission_order"),)

    id = Column(String(32), primary_key=True, default=new_id)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    listing_id = Column(String(32), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True)
    seller_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    gross_paise = Column(BigInteger, nullable=False)
    commission_rate_bp = Column(Integer, nullable=False)
    commission_paise = Column(BigInteger, nullable=False)
    seller_proceeds_paise = Column(BigInteger, nullable=False)
    status = Column(String(20), nullable=False, default="accrued")
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    payout_id = Column(String(32), ForeignKey("payouts.id", ondelete="SET NULL"), nullable=True)


class Payout(TimestampMixin, Base):
    """Accounting record of a seller payout. This platform does not transfer
    money (no payment/payout provider is wired); statuses are recorded by staff."""

    __tablename__ = "payouts"

    id = Column(String(32), primary_key=True, default=new_id)
    seller_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    amount_paise = Column(BigInteger, nullable=False)
    method = Column(String(40), nullable=False, default="bank_transfer_recorded")
    reference = Column(String(120), nullable=True)
    status = Column(String(20), nullable=False, default="recorded")
    note = Column(Text, nullable=True)
    recorded_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


# ---------------------------------------------------------------------------
# Bulk quotations
# ---------------------------------------------------------------------------
class BulkQuotation(TimestampMixin, Base):
    __tablename__ = "bulk_quotations"

    id = Column(String(32), primary_key=True, default=new_id)
    reference = Column(String(24), unique=True, nullable=False, index=True)
    access_token = Column(String(64), unique=True, nullable=False, index=True)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    organization_name = Column(String(180), nullable=False)
    organization_type = Column(String(60), nullable=False)
    contact_name = Column(String(120), nullable=False)
    contact_email = Column(String(255), nullable=False)
    contact_phone = Column(String(20), nullable=False)
    delivery_location = Column(Text, nullable=False)
    target_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(25), nullable=False, default="submitted", index=True)
    quote_notes = Column(Text, nullable=True)
    quote_total_paise = Column(BigInteger, nullable=True)
    quote_valid_until = Column(Date, nullable=True)
    quoted_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    quoted_at = Column(DateTime(timezone=True), nullable=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    order_id = Column(String(32), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)

    items = relationship("QuotationItem", back_populates="quotation", cascade="all, delete-orphan")


class QuotationItem(Base):
    __tablename__ = "quotation_items"

    id = Column(String(32), primary_key=True, default=new_id)
    quotation_id = Column(String(32), ForeignKey("bulk_quotations.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(String(32), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    unit_price_paise = Column(BigInteger, nullable=True)
    line_total_paise = Column(BigInteger, nullable=True)

    quotation = relationship("BulkQuotation", back_populates="items")
    product = relationship("Product")


# ---------------------------------------------------------------------------
# Content, settings, notifications, audit
# ---------------------------------------------------------------------------
class Banner(TimestampMixin, Base):
    __tablename__ = "banners"

    id = Column(String(32), primary_key=True, default=new_id)
    title = Column(String(160), nullable=False)
    subtitle = Column(String(255), nullable=True)
    image_url = Column(String(500), nullable=True)
    cta_label = Column(String(60), nullable=True)
    cta_url = Column(String(255), nullable=True)
    theme = Column(String(20), nullable=False, default="navy")
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)


class Faq(TimestampMixin, Base):
    __tablename__ = "faqs"

    id = Column(String(32), primary_key=True, default=new_id)
    question = Column(String(255), nullable=False)
    answer = Column(Text, nullable=False)
    category = Column(String(60), nullable=False, default="General")
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)


class StoreSetting(Base):
    __tablename__ = "store_settings"

    key = Column(String(80), primary_key=True)
    value = Column(JSON, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=now, onupdate=now, nullable=False)
    updated_by = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String(32), primary_key=True, default=new_id)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    channel = Column(String(20), nullable=False)
    template = Column(String(60), nullable=False)
    recipient = Column(String(255), nullable=False)
    subject = Column(String(255), nullable=True)
    body = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="queued", index=True)
    provider = Column(String(40), nullable=True)
    error = Column(String(255), nullable=True)
    related_type = Column(String(40), nullable=True)
    related_id = Column(String(64), nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_actor_created", "actor_user_id", "created_at"),)

    id = Column(String(32), primary_key=True, default=new_id)
    actor_user_id = Column(String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_email = Column(String(255), nullable=True)
    action = Column(String(80), nullable=False, index=True)
    entity_type = Column(String(60), nullable=True)
    entity_id = Column(String(64), nullable=True)
    before_json = Column(JSON, nullable=True)
    after_json = Column(JSON, nullable=True)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)


class ContactMessage(Base):
    __tablename__ = "contact_messages"

    id = Column(String(32), primary_key=True, default=new_id)
    name = Column(String(120), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=True)
    subject = Column(String(180), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="new")
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
