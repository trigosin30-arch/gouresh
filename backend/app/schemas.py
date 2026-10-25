from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def _clean_phone(value: str) -> str:
    digits = re.sub(r"[^\d]", "", value or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError("Enter a valid 10-digit Indian mobile number")
    return digits


def _clean_pincode(value: str) -> str:
    digits = re.sub(r"[^\d]", "", value or "")
    if len(digits) != 6 or digits[0] == "0":
        raise ValueError("Enter a valid 6-digit PIN code")
    return digits


class AddressInput(BaseModel):
    label: str = Field(default="Home", max_length=60)
    contact_name: str = Field(min_length=2, max_length=120)
    phone: str
    line1: str = Field(min_length=4, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    locality: str | None = Field(default=None, max_length=120)
    city: str = Field(default="Shimla", min_length=2, max_length=80)
    state: str = Field(default="Himachal Pradesh", min_length=2, max_length=80)
    pincode: str

    _phone = field_validator("phone")(_clean_phone)
    _pin = field_validator("pincode")(_clean_pincode)


class CartLineInput(BaseModel):
    product_id: str
    quantity: int = Field(ge=1, le=50)


class OrderCreate(BaseModel):
    items: list[CartLineInput] = Field(min_length=1, max_length=40)
    payment_method: Literal["razorpay", "cod", "pickup"] = "razorpay"
    address: AddressInput | None = None
    address_id: str | None = None
    save_address: bool = False
    notes: str | None = Field(default=None, max_length=500)
    coupon_code: str | None = Field(default=None, max_length=30)

    @model_validator(mode="after")
    def _address_required_for_delivery(self) -> "OrderCreate":
        if self.payment_method != "pickup" and self.address is None and not self.address_id:
            raise ValueError("A delivery address is required")
        return self


class VerifyPaymentInput(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class DemoLoginInput(BaseModel):
    email: str
    full_name: str | None = None


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    phone: str | None = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return _clean_phone(value) if value else value


class DemoSimulateInput(BaseModel):
    outcome: Literal["success", "failure"] = "success"


class ProductInput(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    sku: str = Field(min_length=2, max_length=40)
    slug: str | None = Field(default=None, max_length=160)
    description: str = Field(default="", max_length=4000)
    category_id: str | None = None
    price_paise: int = Field(gt=0, le=10_000_000)
    mrp_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    stock: int = Field(default=0, ge=0, le=1_000_000)
    unit: str = Field(default="each", max_length=40)
    brand: str | None = Field(default=None, max_length=80)
    isbn: str | None = Field(default=None, max_length=20)
    author: str | None = Field(default=None, max_length=120)
    class_level: str | None = Field(default=None, max_length=40)
    board: str | None = Field(default=None, max_length=40)
    condition: Literal["new", "refurbished", "used"] = "new"
    tags: str = Field(default="", max_length=300)
    image_url: str | None = None
    is_featured: bool = False
    is_archived: bool = False


class ProductPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    sku: str | None = Field(default=None, min_length=2, max_length=40)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    category_id: str | None = None
    price_paise: int | None = Field(default=None, gt=0, le=10_000_000)
    mrp_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    unit: str | None = Field(default=None, max_length=40)
    brand: str | None = Field(default=None, max_length=80)
    isbn: str | None = Field(default=None, max_length=20)
    author: str | None = Field(default=None, max_length=120)
    class_level: str | None = Field(default=None, max_length=40)
    board: str | None = Field(default=None, max_length=40)
    condition: Literal["new", "refurbished", "used"] | None = None
    tags: str | None = Field(default=None, max_length=300)
    image_url: str | None = None
    is_featured: bool | None = None
    is_archived: bool | None = None


class StockAdjustInput(BaseModel):
    delta: int = Field(ge=-100_000, le=100_000)
    note: str | None = Field(default=None, max_length=300)


class OrderStatusInput(BaseModel):
    status: Literal[
        "processing", "packed", "shipped", "out_for_delivery", "delivered", "cancelled", "refunded", "confirmed"
    ]
    note: str | None = Field(default=None, max_length=300)
    courier: str | None = Field(default=None, max_length=80)
    tracking_number: str | None = Field(default=None, max_length=80)
    cancel_reason: str | None = Field(default=None, max_length=300)


class RoleInput(BaseModel):
    role: Literal["customer", "staff", "admin"]


class CategoryInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    slug: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=1000)
    image_url: str | None = None
    sort_order: int = 0


class CouponValidateInput(BaseModel):
    code: str = Field(min_length=2, max_length=30)
    subtotal_paise: int = Field(ge=0)
