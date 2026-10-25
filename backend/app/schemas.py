"""Pydantic request models.

Validation lives here so every endpoint rejects malformed or hostile input
before it reaches the database. Unknown fields are rejected (``extra=forbid``)
to prevent mass-assignment.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .constants import (
    BOARDS,
    BOOK_TYPES,
    CONDITIONS,
    FULFILLMENT_TYPES,
    PAYMENT_METHODS,
    SELLING_METHODS,
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


PHONE_RE = re.compile(r"^(?:\+91|0)?[6-9]\d{9}$")
PIN_RE = re.compile(r"^\d{6}$")


def normalise_phone(value: str) -> str:
    cleaned = re.sub(r"[\s\-()]", "", value)
    if not PHONE_RE.match(cleaned):
        raise ValueError("Enter a valid 10-digit Indian mobile number")
    digits = re.sub(r"^(?:\+91|0)", "", cleaned)
    return digits


def strong_password(value: str) -> str:
    if len(value) < 10:
        raise ValueError("Password must be at least 10 characters")
    if len(value) > 128:
        raise ValueError("Password must be at most 128 characters")
    if value.isdigit() or value.lower() in {"password12", "1234567890"}:
        raise ValueError("Choose a stronger password")
    return value


class RegisterIn(StrictModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: Optional[str] = None
    password: str

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return strong_password(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        return normalise_phone(v) if v else None


class LoginIn(StrictModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordIn(StrictModel):
    email: EmailStr


class ResetPasswordIn(StrictModel):
    token: str = Field(min_length=10, max_length=200)
    password: str

    @field_validator("password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return strong_password(v)


class ChangePasswordIn(StrictModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _pw(cls, v: str) -> str:
        return strong_password(v)


class ProfileIn(StrictModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        return normalise_phone(v) if v else None


class AddressIn(StrictModel):
    label: str = Field(default="Home", max_length=40)
    full_name: str = Field(min_length=2, max_length=120)
    phone: str
    line1: str = Field(min_length=3, max_length=255)
    line2: Optional[str] = Field(default=None, max_length=255)
    locality: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=120)
    pincode: str
    is_default: bool = False

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalise_phone(v)

    @field_validator("pincode")
    @classmethod
    def _pin(cls, v: str) -> str:
        if not PIN_RE.match(v):
            raise ValueError("PIN code must be 6 digits")
        return v


class CartItemIn(StrictModel):
    product_id: str = Field(min_length=8, max_length=32)
    quantity: int = Field(ge=0, le=50)


class CartMergeIn(StrictModel):
    items: list[CartItemIn] = Field(default_factory=list, max_length=100)


class CheckoutIn(StrictModel):
    fulfillment_type: str = "pickup"
    payment_method: str = "cod"
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str
    customer_email: EmailStr
    address: Optional[AddressIn] = None
    save_address: bool = False
    coupon_code: Optional[str] = Field(default=None, max_length=40)
    customer_note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("fulfillment_type")
    @classmethod
    def _fulfil(cls, v: str) -> str:
        if v not in FULFILLMENT_TYPES:
            raise ValueError("Choose delivery or store pickup")
        return v

    @field_validator("payment_method")
    @classmethod
    def _pay(cls, v: str) -> str:
        if v not in PAYMENT_METHODS:
            raise ValueError("Unsupported payment method")
        return v

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalise_phone(v)


class MarketplacePurchaseIn(StrictModel):
    fulfillment_type: str = "pickup"
    payment_method: str = "cod"
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str
    customer_email: EmailStr
    address: Optional[AddressIn] = None
    customer_note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("fulfillment_type")
    @classmethod
    def _fulfil(cls, v: str) -> str:
        if v not in FULFILLMENT_TYPES:
            raise ValueError("Choose delivery or store pickup")
        return v

    @field_validator("payment_method")
    @classmethod
    def _pay(cls, v: str) -> str:
        if v not in ("cod", "online"):
            raise ValueError("Unsupported payment method for marketplace orders")
        return v

    @field_validator("customer_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalise_phone(v)


# --------------------------- admin: catalogue ---------------------------
class ProductIn(StrictModel):
    title: str = Field(min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=8000)
    category_id: str
    sku: Optional[str] = Field(default=None, max_length=64)
    isbn: Optional[str] = Field(default=None, max_length=20)
    product_type: str = "new"
    condition: str = "new"
    author: Optional[str] = Field(default=None, max_length=180)
    publisher: Optional[str] = Field(default=None, max_length=180)
    subject: Optional[str] = Field(default=None, max_length=120)
    board: Optional[str] = Field(default=None, max_length=40)
    class_level: Optional[str] = Field(default=None, max_length=20)
    book_type: Optional[str] = Field(default=None, max_length=30)
    edition: Optional[str] = Field(default=None, max_length=60)
    language: Optional[str] = Field(default=None, max_length=60)
    publication_year: Optional[int] = Field(default=None, ge=1900, le=2100)
    academic_year: Optional[str] = Field(default=None, max_length=20)
    price_paise: int = Field(ge=0, le=10_000_000)
    compare_at_price_paise: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    cost_paise: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    tax_rate_bp: int = Field(default=0, ge=0, le=10000)
    stock_qty: int = Field(default=0, ge=0, le=1_000_000)
    low_stock_threshold: int = Field(default=5, ge=0, le=10000)
    status: str = "draft"
    is_featured: bool = False
    is_enquiry_only: bool = False
    image_urls: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("product_type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in ("new", "used"):
            raise ValueError("product_type must be new or used")
        return v

    @field_validator("condition")
    @classmethod
    def _cond(cls, v: str) -> str:
        if v not in CONDITIONS:
            raise ValueError("Invalid condition")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        if v not in ("draft", "active", "archived"):
            raise ValueError("Invalid status")
        return v

    @field_validator("board")
    @classmethod
    def _board(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in BOARDS:
            raise ValueError("Unknown education board")
        return v

    @field_validator("book_type")
    @classmethod
    def _bt(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in BOOK_TYPES:
            raise ValueError("Unknown book type")
        return v


class StockAdjustIn(StrictModel):
    delta: int = Field(ge=-100000, le=100000)
    note: str = Field(default="", max_length=255)


class CategoryIn(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    slug: Optional[str] = Field(default=None, max_length=80)
    description: Optional[str] = Field(default=None, max_length=1000)
    image_url: Optional[str] = Field(default=None, max_length=500)
    sort_order: int = Field(default=0, ge=0, le=1000)
    is_active: bool = True


class BannerIn(StrictModel):
    title: str = Field(min_length=2, max_length=160)
    subtitle: Optional[str] = Field(default=None, max_length=255)
    image_url: Optional[str] = Field(default=None, max_length=500)
    cta_label: Optional[str] = Field(default=None, max_length=60)
    cta_url: Optional[str] = Field(default=None, max_length=255)
    theme: str = Field(default="navy", max_length=20)
    sort_order: int = Field(default=0, ge=0, le=1000)
    is_active: bool = True


class FaqIn(StrictModel):
    question: str = Field(min_length=5, max_length=255)
    answer: str = Field(min_length=5, max_length=4000)
    category: str = Field(default="General", max_length=60)
    sort_order: int = Field(default=0, ge=0, le=1000)
    is_active: bool = True


class SettingsIn(StrictModel):
    values: dict


class OrderStatusIn(StrictModel):
    status: str
    note: Optional[str] = Field(default=None, max_length=1000)


class OrderNoteIn(StrictModel):
    note: str = Field(min_length=1, max_length=2000)


class RefundIn(StrictModel):
    amount_paise: int = Field(ge=1, le=10_000_000)
    note: str = Field(min_length=3, max_length=1000)


class CouponIn(StrictModel):
    code: str = Field(min_length=3, max_length=40)
    description: Optional[str] = Field(default=None, max_length=255)
    discount_type: str = "percent"
    value: int = Field(ge=1)
    min_order_paise: int = Field(default=0, ge=0)
    max_discount_paise: Optional[int] = Field(default=None, ge=0)
    starts_at: Optional[str] = None
    expires_at: Optional[str] = None
    usage_limit: Optional[int] = Field(default=None, ge=1)
    per_user_limit: int = Field(default=1, ge=1, le=100)
    is_active: bool = True

    @field_validator("discount_type")
    @classmethod
    def _dt(cls, v: str) -> str:
        if v not in ("percent", "flat"):
            raise ValueError("discount_type must be percent or flat")
        return v

    @field_validator("value")
    @classmethod
    def _value(cls, v: int, info):
        if info.data.get("discount_type") == "percent" and v > 90:
            raise ValueError("Percentage discount cannot exceed 90")
        return v


# --------------------------- marketplace ---------------------------
class ListingIn(StrictModel):
    title: str = Field(min_length=2, max_length=255)
    isbn: Optional[str] = Field(default=None, max_length=20)
    author: Optional[str] = Field(default=None, max_length=180)
    publisher: Optional[str] = Field(default=None, max_length=180)
    board: Optional[str] = Field(default=None, max_length=40)
    class_level: Optional[str] = Field(default=None, max_length=20)
    subject: Optional[str] = Field(default=None, max_length=120)
    book_type: Optional[str] = Field(default=None, max_length=30)
    condition: str = "good"
    condition_notes: Optional[str] = Field(default=None, max_length=2000)
    asking_price_paise: int = Field(ge=100, le=10_000_000)
    image_urls: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("condition")
    @classmethod
    def _cond(cls, v: str) -> str:
        if v not in CONDITIONS:
            raise ValueError("Invalid condition")
        return v


class ListingModerationIn(StrictModel):
    status: str
    note: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def _s(cls, v: str) -> str:
        if v not in ("active", "rejected", "suspended", "archived"):
            raise ValueError("Invalid moderation status")
        return v


class ListingReportIn(StrictModel):
    reason: str = Field(min_length=3, max_length=80)
    details: Optional[str] = Field(default=None, max_length=2000)


# --------------------------- submissions / quotes ---------------------------
class BookSubmissionIn(StrictModel):
    book_title: str = Field(min_length=2, max_length=255)
    isbn: Optional[str] = Field(default=None, max_length=20)
    author: Optional[str] = Field(default=None, max_length=180)
    publisher: Optional[str] = Field(default=None, max_length=180)
    board: Optional[str] = Field(default=None, max_length=40)
    class_level: Optional[str] = Field(default=None, max_length=20)
    subject: Optional[str] = Field(default=None, max_length=120)
    condition: str
    expected_price_paise: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    selling_method: str = "marketplace_listing"
    contact_name: str = Field(min_length=2, max_length=120)
    contact_phone: str
    contact_email: EmailStr
    pickup_address: Optional[str] = Field(default=None, max_length=1000)
    notes: Optional[str] = Field(default=None, max_length=2000)
    photo_urls: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("condition")
    @classmethod
    def _cond(cls, v: str) -> str:
        if v not in CONDITIONS:
            raise ValueError("Invalid condition")
        return v

    @field_validator("selling_method")
    @classmethod
    def _method(cls, v: str) -> str:
        if v not in SELLING_METHODS:
            raise ValueError("Invalid selling method")
        return v

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalise_phone(v)


class SubmissionReviewIn(StrictModel):
    status: str
    admin_note: Optional[str] = Field(default=None, max_length=2000)
    recommended_price_paise: Optional[int] = Field(default=None, ge=0, le=10_000_000)

    @field_validator("status")
    @classmethod
    def _s(cls, v: str) -> str:
        if v not in (
            "under_review",
            "details_requested",
            "approved",
            "rejected",
            "completed",
            "cancelled",
        ):
            raise ValueError("Invalid status")
        return v


class QuotationItemIn(StrictModel):
    product_id: Optional[str] = None
    description: str = Field(min_length=2, max_length=255)
    quantity: int = Field(ge=1, le=100000)


class QuotationIn(StrictModel):
    organization_name: str = Field(min_length=2, max_length=180)
    organization_type: str = Field(min_length=2, max_length=60)
    contact_name: str = Field(min_length=2, max_length=120)
    contact_email: EmailStr
    contact_phone: str
    delivery_location: str = Field(min_length=5, max_length=1000)
    target_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=3000)
    items: list[QuotationItemIn] = Field(min_length=1, max_length=100)

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalise_phone(v)


class QuotationPriceItemIn(StrictModel):
    item_id: str
    unit_price_paise: int = Field(ge=0, le=10_000_000)


class QuotationQuoteIn(StrictModel):
    items: list[QuotationPriceItemIn] = Field(min_length=1, max_length=100)
    quote_notes: Optional[str] = Field(default=None, max_length=3000)
    quote_valid_until: Optional[date] = None


# --------------------------- service requests ---------------------------
class ReturnRequestIn(StrictModel):
    request_type: str
    reason: str = Field(min_length=10, max_length=2000)

    @field_validator("request_type")
    @classmethod
    def _t(cls, v: str) -> str:
        if v not in ("cancellation", "return", "refund"):
            raise ValueError("Invalid request type")
        return v


class ReturnDecisionIn(StrictModel):
    status: str
    admin_note: Optional[str] = Field(default=None, max_length=2000)
    refund_amount_paise: Optional[int] = Field(default=None, ge=0, le=10_000_000)

    @field_validator("status")
    @classmethod
    def _s(cls, v: str) -> str:
        if v not in ("approved", "rejected", "completed"):
            raise ValueError("Invalid status")
        return v


class ContactIn(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: Optional[str] = None
    subject: str = Field(min_length=3, max_length=180)
    message: str = Field(min_length=10, max_length=4000)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        return normalise_phone(v) if v else None


class PaymentConfirmIn(StrictModel):
    razorpay_order_id: str = Field(min_length=4, max_length=120)
    razorpay_payment_id: str = Field(min_length=4, max_length=120)
    razorpay_signature: str = Field(min_length=16, max_length=256)


class PayoutIn(StrictModel):
    seller_id: str
    amount_paise: int = Field(ge=1, le=10_000_000)
    reference: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=1000)
    commission_ids: list[str] = Field(default_factory=list, max_length=200)
