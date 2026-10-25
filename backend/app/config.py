"""Runtime configuration.

Everything that differs between a local demo, a Supabase-backed staging
deployment and production is read from environment variables here. No secret
values ever reach the browser: the frontend only learns whether mock payments
are on and (optionally) the *public* Razorpay key id.
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Ankit Stationery Mart"
    environment: str = "development"
    api_prefix: str = "/api"

    # --- database ---------------------------------------------------------
    # Local demo default: a single SQLite file (zero setup, survives restarts).
    # Supabase/production: postgresql+psycopg2://postgres:...@db.<ref>.supabase.co:5432/postgres
    database_url: str = "sqlite:///./asm_dev.db"

    # --- identity ---------------------------------------------------------
    # Supabase project (leave blank for local demo mode).
    supabase_url: str = ""
    supabase_anon_key: str = ""
    # JWT secret from Supabase Dashboard -> Settings -> API -> JWT Settings.
    # If blank, the backend falls back to the project's public JWKS endpoint.
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"

    # Dev-only passwordless sign-in used when Supabase is not configured.
    # MUST stay false in production.
    dev_auth: bool = True
    dev_jwt_secret: str = "asm-local-dev-secret-change-me"
    dev_jwt_ttl_hours: int = 168

    # --- payments ---------------------------------------------------------
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    # When True the backend issues mock Razorpay orders + signatures so the
    # full verify/webhook path can be demonstrated without live credentials.
    payments_mock: bool = True

    # --- storefront rules (all money in integer paise) --------------------
    currency: str = "INR"
    free_shipping_threshold_paise: int = 49900
    shipping_fee_paise: int = 4900
    cod_enabled: bool = True
    pickup_enabled: bool = True
    max_quantity_per_line: int = 10

    store_phone: str = "+91 98160 00000"
    store_email: str = "hello@ankitstationery.in"
    store_address: str = "Shop 12, Lower Bazaar, The Mall Road, Shimla, Himachal Pradesh 171001"
    store_hours: str = "Mon–Sat, 9:30 am – 8:00 pm · Sunday 11:00 am – 5:00 pm"

    # --- plumbing ---------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    allow_preview_origins: bool = True
    seed_on_startup: bool = True

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)

    @property
    def payments_mode(self) -> str:
        """`mock`, `test` or `live` — surfaced to the UI for clear labelling."""
        if not self.razorpay_key_id or not self.razorpay_key_secret:
            return "mock"
        if self.razorpay_key_id.startswith("rzp_live"):
            return "live"
        return "test"

    def public_config(self) -> dict:
        return {
            "store": {
                "name": self.app_name,
                "phone": self.store_phone,
                "email": self.store_email,
                "address": self.store_address,
                "hours": self.store_hours,
                "currency": self.currency,
                "free_shipping_threshold_paise": self.free_shipping_threshold_paise,
                "shipping_fee_paise": self.shipping_fee_paise,
                "cod_enabled": self.cod_enabled,
                "pickup_enabled": self.pickup_enabled,
                "max_quantity_per_line": self.max_quantity_per_line,
            },
            "auth": {
                "provider": "supabase" if self.is_supabase_configured else "demo",
                "supabase_url": self.supabase_url,
                "supabase_anon_key": self.supabase_anon_key,
                "dev_auth": self.dev_auth and not self.is_supabase_configured,
            },
            "payments": {
                "mode": self.payments_mode,
                "razorpay_key_id": self.razorpay_key_id if self.payments_mode != "mock" else "",
            },
            "environment": self.environment,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
