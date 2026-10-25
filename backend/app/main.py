from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import account, admin, catalog, orders

log = logging.getLogger("asm")

# Preview hosts look like https://5173-<sandbox-id>.e2b.app and change per
# session, so they are matched by pattern rather than enumerated.
PREVIEW_ORIGIN = (
    r"^(https?://[a-z0-9-]+\.(e2b\.app|arena\.app|vercel\.app)"
    r"|https?://(localhost|127\.0\.0\.1)(:\d+)?)$"
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    if settings.seed_on_startup:
        db = SessionLocal()
        try:
            from .seed import seed

            seed(db)
        except Exception:  # noqa: BLE001 - seeding must never block boot
            log.exception("Seeding failed")
        finally:
            db.close()
    if settings.payments_mode == "mock":
        log.warning("Razorpay is in MOCK mode — no real charges will be made.")
    if settings.environment != "production" and settings.dev_auth and not settings.is_supabase_configured:
        log.warning("DEMO AUTH enabled — emails sign in without a password. Do not use in production.")
    yield


app = FastAPI(
    title=f"{settings.app_name} API",
    version="1.0.0",
    description="Storefront, orders, Razorpay verification and admin APIs for Ankit Stationery Mart.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=PREVIEW_ORIGIN if settings.allow_preview_origins else None,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # No X-Frame-Options: the live preview and shop embeds render the UI inside
    # an iframe. Add a CSP `frame-ancestors` allow-list in production instead.
    if request.url.path.startswith(settings.api_prefix + "/admin") or "/me" in request.url.path:
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


api = settings.api_prefix
app.include_router(catalog.router, prefix=api)
app.include_router(account.router, prefix=api)
app.include_router(account.account_router, prefix=api)
app.include_router(orders.router, prefix=api)
app.include_router(admin.router, prefix=api)


@app.get("/api/health", tags=["ops"])
def health() -> dict:
    db_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "up" if db_ok else "down",
        "environment": settings.environment,
        "auth_mode": "supabase" if settings.is_supabase_configured else "demo",
        "payments_mode": settings.payments_mode,
        "version": app.version,
    }
