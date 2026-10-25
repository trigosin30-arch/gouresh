"""Store settings with typed defaults and validation.

Values live in the database so the owner can change them from the admin panel.
Nothing here invents business policies: empty/`None` means "not configured" and
the storefront renders an honest "not configured yet" state instead of a claim.
"""
from __future__ import annotations

from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..models import StoreSetting


class SettingError(ValueError):
    pass


def _str(v: Any) -> str:
    if not isinstance(v, str):
        raise SettingError("must be a string")
    return v[:2000]


def _int(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise SettingError("must be an integer")
    return v


def _bool(v: Any) -> bool:
    if not isinstance(v, bool):
        raise SettingError("must be true or false")
    return v


def _str_list(v: Any) -> list[str]:
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise SettingError("must be a list of strings")
    return [x.strip()[:20] for x in v if x.strip()]


# key -> (validator, default, group, public, label)
SETTING_SCHEMA: Dict[str, tuple] = {
    # Business identity (all factually unverified until the owner fills them in)
    "store_name": (_str, "Ankit Stationery Mart", "business", True, "Store name"),
    "store_tagline": (_str, "", "business", True, "Tagline"),
    "store_address": (_str, "147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India", "business", True, "Address"),
    "store_phone": (_str, "", "business", True, "Contact phone"),
    "store_whatsapp": (_str, "", "business", True, "WhatsApp number"),
    "store_email": (_str, "", "business", True, "Contact email"),
    "store_opening_hours": (_str, "", "business", True, "Opening hours"),
    "store_map_url": (_str, "", "business", True, "Map link"),
    "store_gstin": (_str, "", "business", False, "GSTIN / tax id"),
    # Fulfilment
    "delivery_enabled": (_bool, False, "fulfilment", True, "Home delivery enabled"),
    "delivery_fee_paise": (_int, 0, "fulfilment", True, "Delivery fee (paise)"),
    "free_delivery_threshold_paise": (_int, 0, "fulfilment", True, "Free delivery above (paise, 0 = never)"),
    "delivery_pincodes": (_str_list, [], "fulfilment", True, "Serviceable PIN codes"),
    "pickup_enabled": (_bool, True, "fulfilment", True, "Store pickup enabled"),
    "pickup_instructions": (_str, "", "fulfilment", True, "Pickup instructions"),
    "min_order_paise": (_int, 0, "fulfilment", True, "Minimum order (paise)"),
    "cod_enabled": (_bool, False, "fulfilment", True, "Cash on delivery enabled"),
    # Payments / tax
    "online_payments_enabled": (_bool, False, "payments", True, "Online payments enabled"),
    "tax_enabled": (_bool, False, "payments", True, "Tax collection enabled"),
    "tax_rate_bp": (_int, 0, "payments", True, "Tax rate (basis points)"),
    "prices_include_tax": (_bool, False, "payments", True, "Prices include tax"),
    # Policies (empty = not published)
    "cancellation_window_hours": (_int, 0, "policies", True, "Cancellation window (hours)"),
    "return_window_days": (_int, 0, "policies", True, "Return window (days)"),
    "returns_note": (_str, "", "policies", True, "Returns policy note"),
    "shipping_note": (_str, "", "policies", True, "Delivery policy note"),
    # Marketplace
    "marketplace_enabled": (_bool, True, "marketplace", True, "Second-hand marketplace enabled"),
    "marketplace_commission_bp": (_int, 0, "marketplace", True, "Marketplace commission (basis points)"),
    "marketplace_note": (_str, "", "marketplace", True, "Marketplace terms note"),
    # Content / SEO
    "seo_title": (_str, "Ankit Stationery Mart", "seo", True, "Default page title"),
    "seo_description": (_str, "", "seo", True, "Default meta description"),
    "announcement": (_str, "", "content", True, "Announcement bar text"),
    "support_note": (_str, "", "content", True, "Support note"),
    "demo_mode": (_bool, False, "content", True, "Demo/sample data mode"),
}

PUBLIC_KEYS = [k for k, v in SETTING_SCHEMA.items() if v[3]]
WRITABLE_KEYS = list(SETTING_SCHEMA.keys())


def get_all(db: OrmSession) -> Dict[str, Any]:
    values = {k: v[1] for k, v in SETTING_SCHEMA.items()}
    for row in db.scalars(select(StoreSetting)):
        if row.key in SETTING_SCHEMA:
            values[row.key] = row.value
    return values


def get(db: OrmSession, key: str) -> Any:
    if key not in SETTING_SCHEMA:
        raise SettingError(f"Unknown setting: {key}")
    row = db.get(StoreSetting, key)
    return row.value if row else SETTING_SCHEMA[key][1]


def get_int(db: OrmSession, key: str) -> int:
    value = get(db, key)
    return int(value) if isinstance(value, (int, bool)) else 0


def set_many(db: OrmSession, values: Dict[str, Any], actor_id: str | None = None) -> Dict[str, Any]:
    from ..db import now

    for key, raw in values.items():
        if key not in SETTING_SCHEMA:
            raise SettingError(f"Unknown setting: {key}")
        validator = SETTING_SCHEMA[key][0]
        value = validator(raw)
        if key.endswith("_paise") and value < 0:
            raise SettingError(f"{key} cannot be negative")
        if key.endswith("_bp") and not 0 <= value <= 10000:
            raise SettingError(f"{key} must be between 0 and 10000 basis points")
        row = db.get(StoreSetting, key)
        if row:
            row.value = value
            row.updated_by = actor_id
            row.updated_at = now()
        else:
            db.add(StoreSetting(key=key, value=value, updated_by=actor_id))
    db.commit()
    return get_all(db)


def public_settings(db: OrmSession) -> Dict[str, Any]:
    all_values = get_all(db)
    public = {k: all_values[k] for k in PUBLIC_KEYS}
    # Effective capability flags for the storefront.
    public["online_payments_available"] = bool(
        settings.online_payments_available and all_values.get("online_payments_enabled")
    )
    public["payment_methods"] = _available_payment_methods(db)
    return public


def _available_payment_methods(db: OrmSession) -> list[str]:
    methods: list[str] = []
    if get(db, "cod_enabled"):
        methods.append("cod")
    if get(db, "online_payments_enabled") and settings.online_payments_available:
        methods.append("online")
    return methods


def available_payment_methods(db: OrmSession) -> list[str]:
    return _available_payment_methods(db)
