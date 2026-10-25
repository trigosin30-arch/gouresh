"""Razorpay integration.

The browser redirect/checkout callback is never trusted on its own: the backend
recomputes the HMAC signature for every payment before confirming an order, and
verified webhooks are processed idempotently in the orders service.

With `PAYMENTS_MOCK=true` (the default for local demos) the same code paths are
exercised against a deterministic mock provider, so signature verification,
failure handling and idempotency can be demonstrated without live keys.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

import httpx
from fastapi import HTTPException

from .config import settings

MOCK_SECRET = "asm_mock_razorpay_secret"


def _secret() -> str:
    return settings.razorpay_key_secret or MOCK_SECRET


def sign_payment(order_id: str, payment_id: str) -> str:
    return hmac.new(_secret().encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    if not (order_id and payment_id and signature):
        return False
    return hmac.compare_digest(sign_payment(order_id, payment_id), signature)


def webhook_secret() -> str:
    return settings.razorpay_webhook_secret or MOCK_SECRET


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not signature:
        return False
    expected = hmac.new(webhook_secret().encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def create_provider_order(order_number: str, amount_paise: int, notes: dict[str, str] | None = None) -> dict[str, Any]:
    """Create a Razorpay order (or a mock one when credentials are absent)."""
    if settings.payments_mode == "mock":
        return {
            "id": f"order_mock_{secrets.token_hex(8)}",
            "amount": amount_paise,
            "currency": settings.currency,
            "receipt": order_number,
            "status": "created",
            "mock": True,
        }

    payload = {
        "amount": amount_paise,
        "currency": settings.currency,
        "receipt": order_number,
        "notes": notes or {},
    }
    try:
        response = httpx.post(
            "https://api.razorpay.com/v1/orders",
            json=payload,
            auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Razorpay: {exc}") from None
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Razorpay rejected the order request")
    return response.json()


def mock_payment_id() -> str:
    return f"pay_mock_{secrets.token_hex(8)}"


def mock_order_id() -> str:
    return f"order_mock_{secrets.token_hex(8)}"
