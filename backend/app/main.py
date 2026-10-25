"""FastAPI application entry point.

One authoritative API. In production the compiled React SPA is served from the
same origin, which keeps cookies (SameSite), CSRF and SEO simple.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import SessionLocal, create_all, ping
from .routers import admin, auth, bulk, cart, catalog, marketplace, misc, orders, payments
from .security import CSRF_COOKIE, CSRF_HEADER, check_csrf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ankit-stationery-mart")

CSRF_EXEMPT = {"/api/payments/webhook"}


async def _reservation_sweeper() -> None:
    """Release expired stock holds every minute (single process)."""
    while True:
        try:
            await asyncio.sleep(60)
            from .services.commerce import release_expired_reservations

            with SessionLocal() as db:
                released = release_expired_reservations(db)
                if released:
                    logger.info("Released %s expired stock reservations", released)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Reservation sweeper error: %s", type(exc).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.require_secret_key()
    create_all()
    if not settings.is_production:
        logger.warning(
            "APP_ENV=%s — development defaults are active (console notifications, permissive cookies). Set APP_ENV=production for deployment.",
            settings.env,
        )
    if settings.demo_seed_enabled:
        from .seed import seed_demo

        with SessionLocal() as db:
            seed_demo(db)
    task = asyncio.create_task(_reservation_sweeper())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Ankit Stationery Mart API",
    version="1.0.0",
    description=(
        "E-commerce, admin and moderated second-hand book marketplace API for "
        "Ankit Stationery Mart, 147 Moolraj Road, Jalandhar Cantt, Punjab 144005.\n\n"
        "Authentication uses an HttpOnly session cookie plus a double-submit CSRF "
        "token (`X-CSRF-Token` header must match the `asm_csrf` cookie)."
    ),
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path
    # 1. CSRF for cookie-authenticated mutations
    if path.startswith("/api") and path not in CSRF_EXEMPT and request.method not in ("GET", "HEAD", "OPTIONS"):
        try:
            check_csrf(request)
        except Exception as exc:  # HTTPException
            detail = getattr(exc, "detail", "CSRF validation failed")
            status_code = getattr(exc, "status_code", 403)
            return JSONResponse({"detail": detail}, status_code=status_code)

    response = await call_next(request)

    # 2. Issue the CSRF cookie so the SPA can echo it in a header
    if CSRF_COOKIE not in request.cookies:
        token = request.headers.get("x-csrf-seed") or secrets.token_urlsafe(24)
        response.set_cookie(
            CSRF_COOKIE,
            token,
            httponly=False,
            samesite="lax",
            secure=settings.secure_cookies,
            path="/",
        )

    # 3. Security headers
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; "
        "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; "
        "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com; "
        "font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'",
    )
    if settings.secure_cookies:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if path.startswith("/api"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.add_middleware(GZipMiddleware, minimum_size=1024)

for module in (auth, catalog, cart, orders, marketplace, bulk, payments, admin, misc):
    app.include_router(module.router)

uploads_dir = Path(settings.upload_dir)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)


@app.get("/api/store/version")
def version():
    return {"version": app.version, "environment": settings.env}


# ---------------------------------------------------------------------------
# SPA hosting (single origin in production; Vite handles it in development)
# ---------------------------------------------------------------------------
# Client-side routes that the SPA owns. Unknown paths get the SPA shell with a
# real 404 status so search engines and clients are not told a dead URL is live.
SPA_EXACT_ROUTES = {
    "/",
    "/products",
    "/book-lists",
    "/used-books",
    "/sell-books",
    "/cart",
    "/checkout",
    "/order-confirmation",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/account",
    "/wishlist",
    "/orders",
    "/track-order",
    "/bulk-orders",
    "/contact",
    "/faq",
    "/about",
    "/privacy-policy",
    "/terms",
    "/shipping-policy",
    "/returns-refunds",
    "/404",
}
SPA_PREFIXES = ("/admin", "/product/", "/used-books/", "/orders/", "/quotations/")


def _is_spa_route(path: str) -> bool:
    if path in SPA_EXACT_ROUTES:
        return True
    return any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in SPA_PREFIXES)


LEGACY_PAGES = {
    "index.html": "/",
    "products.html": "/products",
    "product.html": "/products",
    "cart.html": "/cart",
    "checkout.html": "/checkout",
    "account.html": "/account",
    "login.html": "/login",
    "register.html": "/register",
    "wishlist.html": "/wishlist",
    "orders.html": "/orders",
    "order-details.html": "/orders",
    "track-order.html": "/track-order",
    "book-lists.html": "/book-lists",
    "used-books.html": "/used-books",
    "sell-books.html": "/sell-books",
    "bulk-orders.html": "/bulk-orders",
    "about.html": "/about",
    "contact.html": "/contact",
    "faq.html": "/faq",
    "privacy-policy.html": "/privacy-policy",
    "terms.html": "/terms",
    "shipping-policy.html": "/shipping-policy",
    "returns-refunds.html": "/returns-refunds",
    "admin.html": "/admin",
}


@app.api_route("/healthz", methods=["GET", "HEAD"], include_in_schema=False)
def healthz():
    return Response(status_code=200 if ping() else 503)


@app.api_route("/{legacy_page}.html", methods=["GET", "HEAD"], include_in_schema=False)
def legacy_page(legacy_page: str):
    target = LEGACY_PAGES.get(f"{legacy_page}.html")
    if target:
        return RedirectResponse(target, status_code=301)
    return RedirectResponse("/404", status_code=302)


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith(("api/", "uploads/", "docs", "redoc", "openapi")):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    dist = Path(settings.frontend_dist)
    if not dist.exists():
        return JSONResponse(
            {
                "detail": "Frontend build not found.",
                "hint": "Run `npm install && npm run build` in frontend/, or use the Vite dev server (npm run dev).",
            },
            status_code=200 if full_path == "" else 404,
        )
    candidate = (dist / full_path).resolve()
    if full_path and dist.resolve() in candidate.parents and candidate.is_file():
        return FileResponse(candidate)
    index = dist / "index.html"
    if index.exists() and _is_spa_route("/" + full_path):
        return FileResponse(index)
    if index.exists():
        # Render the client shell so visitors get the friendly NotFound page,
        # but keep the HTTP status honest.
        return FileResponse(index, status_code=404)
    return JSONResponse({"detail": "Not found"}, status_code=404)

