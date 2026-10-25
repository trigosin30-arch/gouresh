"""Application configuration.

All secrets and deployment-specific values are read from environment
variables (or an ``.env`` file that is never committed). Nothing in this
module contains production credentials.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


def _normalise_database_url(url: str) -> str:
    """Make managed-database URLs work out of the box.

    Hosting providers hand out ``postgres://`` or ``postgresql://`` DSNs, which
    SQLAlchemy maps to the psycopg2 driver. This project ships psycopg 3, so the
    driver is pinned explicitly. SQLite URLs are returned untouched.
    """
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Settings:
    """Runtime settings loaded from the environment."""

    def __init__(self) -> None:
        self.env = os.getenv("APP_ENV", "development").lower()
        self.database_url = _normalise_database_url(
            os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'app.db'}")
        )
        self.secret_key = os.getenv("SECRET_KEY", "")
        self.session_cookie_name = os.getenv("SESSION_COOKIE_NAME", "asm_session")
        self.csrf_cookie_name = os.getenv("CSRF_COOKIE_NAME", "asm_csrf")
        self.session_ttl_hours = int(os.getenv("SESSION_TTL_HOURS", "336"))
        self.secure_cookies = os.getenv(
            "SECURE_COOKIES", "1" if self.env == "production" else "0"
        ) == "1"
        self.upload_dir = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "data" / "uploads")))
        self.max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", str(4 * 1024 * 1024)))
        self.frontend_dist = Path(
            os.getenv("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist"))
        )
        self.trusted_origins = [
            o.strip()
            for o in os.getenv("TRUSTED_ORIGINS", "").split(",")
            if o.strip()
        ]
        # Payment gateway (Razorpay). Online payments stay disabled until both
        # the merchant keys and the webhook secret are configured.
        self.razorpay_key_id = os.getenv("RAZORPAY_KEY_ID", "")
        self.razorpay_key_secret = os.getenv("RAZORPAY_KEY_SECRET", "")
        self.razorpay_webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
        # Notification providers (optional). Without them notifications are
        # recorded with status ``skipped`` and a provider_not_configured error.
        self.smtp_host = os.getenv("SMTP_HOST", "")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = os.getenv("SMTP_USER", "")
        self.smtp_password = os.getenv("SMTP_PASSWORD", "")
        self.smtp_from = os.getenv("SMTP_FROM", "")
        self.smtp_use_tls = os.getenv("SMTP_USE_TLS", "1") == "1"
        self.notification_outbox = Path(
            os.getenv("NOTIFICATION_OUTBOX", str(BASE_DIR / "data" / "notifications.log"))
        )
        self.notification_console_provider = os.getenv(
            "NOTIFICATION_CONSOLE_PROVIDER", "1" if self.env != "production" else "0"
        ) == "1"
        self.demo_seed_enabled = os.getenv("SEED_DEMO", "0") == "1"
        # Rate limits (requests / window seconds)
        self.rate_limit_login = (int(os.getenv("RATE_LIMIT_LOGIN", "8")), 300)
        self.rate_limit_public_write = (int(os.getenv("RATE_LIMIT_PUBLIC_WRITE", "20")), 600)
        self.rate_limit_checkout = (int(os.getenv("RATE_LIMIT_CHECKOUT", "12")), 600)
        self.stock_reservation_minutes = int(os.getenv("STOCK_RESERVATION_MINUTES", "30"))
        # Serve the compiled SPA when present (single-origin deployment).
        self.admin_bootstrap_email = os.getenv("ADMIN_BOOTSTRAP_EMAIL", "")

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def online_payments_available(self) -> bool:
        return bool(
            self.razorpay_key_id
            and self.razorpay_key_secret
            and self.razorpay_webhook_secret
        )

    def require_secret_key(self) -> str:
        if not self.secret_key:
            if self.is_production:
                raise RuntimeError("SECRET_KEY must be set in production")
            # Ephemeral development key: sessions reset when the process restarts.
            self.secret_key = os.urandom(32).hex()
        return self.secret_key


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
