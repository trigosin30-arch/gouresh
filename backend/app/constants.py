"""Validated domain values shared across the API.

Stored as strings (not native DB enums) so migrations stay portable between
SQLite and PostgreSQL; every write path validates against these lists.
"""
from __future__ import annotations

ROLES = ("customer", "staff", "admin")
USER_STATUSES = ("active", "restricted", "pending")

PRODUCT_TYPES = ("new", "used")
# Used books sold directly by the store may carry a condition; new items are "new".
CONDITIONS = ("new", "like_new", "good", "acceptable")
CONDITION_LABELS = {
    "new": "New",
    "like_new": "Like New",
    "good": "Good",
    "acceptable": "Acceptable",
}
PRODUCT_STATUSES = ("draft", "active", "archived")
BOOK_TYPES = ("textbook", "reference", "guide", "workbook", "question_bank", "other")
BOOK_TYPE_LABELS = {
    "textbook": "Textbook",
    "reference": "Reference Book",
    "guide": "Guide",
    "workbook": "Workbook",
    "question_bank": "Question Bank",
    "other": "Other",
}
BOARDS = ("CBSE", "ICSE/ISC", "PSEB", "Other State Board", "University", "Other")
FULFILLMENT_TYPES = ("delivery", "pickup")

ORDER_TYPES = ("store", "marketplace", "bulk")
ORDER_STATUSES = (
    "pending_payment",  # awaiting verified online payment
    "placed",
    "processing",
    "packed",
    "dispatched",
    "delivered",
    "cancelled",
    "returned",
)
# Explicit state machine: the only legal forward transitions.
ORDER_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "pending_payment": ("placed", "cancelled"),
    "placed": ("processing", "cancelled"),
    "processing": ("packed", "cancelled"),
    # Pickup orders are never dispatched: staff hand the parcel over, so
    # "packed" -> "delivered" is legal. Delivery orders normally go through
    # "dispatched" but a local hand-delivery may also be marked delivered.
    "packed": ("dispatched", "delivered", "cancelled"),
    "dispatched": ("delivered",),
    "delivered": ("returned",),
    "cancelled": (),
    "returned": (),
}
ORDER_STATUS_LABELS = {
    "pending_payment": "Payment pending",
    "placed": "Order placed",
    "processing": "Processing",
    "packed": "Packed",
    "dispatched": "Dispatched",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
    "returned": "Returned",
}
PAYMENT_STATUSES = ("pending", "paid", "failed", "refunded", "partially_refunded")
PAYMENT_METHODS = ("cod", "online", "invoice")

LISTING_STATUSES = (
    "pending_review",
    "active",
    "rejected",
    "suspended",
    "sold",
    "withdrawn",
    "archived",
)
LISTING_STATUS_LABELS = {
    "pending_review": "Pending review",
    "active": "Active",
    "rejected": "Rejected",
    "suspended": "Suspended",
    "sold": "Sold",
    "withdrawn": "Withdrawn",
    "archived": "Archived",
}

SUBMISSION_STATUSES = (
    "submitted",
    "under_review",
    "details_requested",
    "approved",
    "rejected",
    "converted_to_listing",
    "completed",
    "cancelled",
)
SELLING_METHODS = ("marketplace_listing", "store_evaluation", "enquiry")

QUOTATION_STATUSES = (
    "submitted",
    "under_review",
    "quoted",
    "accepted",
    "rejected",
    "expired",
    "converted",
    "cancelled",
)

RETURN_TYPES = ("cancellation", "return", "refund")
RETURN_STATUSES = ("requested", "approved", "rejected", "completed", "cancelled")
RETURN_TYPE_LABELS = {"cancellation": "Cancellation", "return": "Return", "refund": "Refund"}

COMMISSION_STATUSES = ("accrued", "payable", "paid", "void")
PAYOUT_STATUSES = ("recorded", "paid")
NOTIFICATION_CHANNELS = ("email", "sms", "whatsapp", "in_app")
NOTIFICATION_STATUSES = ("queued", "sent", "delivered", "failed", "skipped")

SORT_OPTIONS = ("relevance", "newest", "price_asc", "price_desc", "popularity")


def is_valid(value: str, allowed: tuple[str, ...]) -> bool:
    return value in allowed
