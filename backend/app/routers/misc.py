"""Health, contact, uploads, SEO files."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..db import get_db, ping
from ..models import ContactMessage, Listing, Product, User
from ..schemas import ContactIn
from ..security import get_current_user, require_staff, require_user
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.notifications import notify_staff
from ..services.rate_limit import client_ip, enforce
from ..services.uploads import save_image

router = APIRouter(tags=["platform"])


@router.get("/api/health")
def health():
    ok = ping()
    return {
        "status": "ok" if ok else "degraded",
        "database": "ok" if ok else "unreachable",
        "environment": settings.env,
        "online_payments_configured": settings.online_payments_available,
        "email_configured": bool(settings.smtp_host and settings.smtp_from),
    }


@router.post("/api/contact", status_code=201)
def contact(payload: ContactIn, request: Request, db: OrmSession = Depends(get_db)):
    enforce(request, "contact", *settings.rate_limit_public_write)
    row = ContactMessage(
        name=payload.name,
        email=str(payload.email).lower(),
        phone=payload.phone,
        subject=payload.subject,
        message=payload.message,
    )
    db.add(row)
    db.commit()
    staff = list(db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all())
    notify_staff(db, staff, "contact_message", f"Contact: {payload.subject}", f"{payload.name} ({payload.email})\n{payload.message}")
    return {"ok": True, "message": "Your message has been recorded. The store team will respond during business hours."}


@router.post("/api/uploads/listing-photo")
def upload_listing_photo(request: Request, file: UploadFile = File(...), user: User = Depends(require_user)):
    enforce(request, "upload_listing", 30, 3600)
    url = save_image(file, "listings")
    return {"url": url}


@router.post("/api/uploads/submission-photo")
def upload_submission_photo(
    request: Request,
    file: UploadFile = File(...),
    user: Optional[User] = Depends(get_current_user),
):
    enforce(request, "upload_submission", 15, 3600)
    url = save_image(file, "submissions")
    return {"url": url}


@router.post("/api/uploads/product-photo")
def upload_product_photo(
    request: Request,
    file: UploadFile = File(...),
    staff: User = Depends(require_staff),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "upload_product", 120, 3600)
    url = save_image(file, "products")
    audit(db, "upload.product_photo", actor=staff, entity_type="upload", entity_id=url, ip_address=client_ip(request), commit=True)
    return {"url": url}


def _site_base(request: Request) -> str:
    import os

    configured = os.getenv("PUBLIC_SITE_URL", "").rstrip("/")
    if configured:
        return configured
    return f"{request.url.scheme}://{request.url.netloc}"


STATIC_PATHS = [
    ("/", "1.0", "daily"),
    ("/products", "0.9", "daily"),
    ("/book-lists", "0.8", "weekly"),
    ("/used-books", "0.8", "daily"),
    ("/sell-books", "0.6", "monthly"),
    ("/bulk-orders", "0.6", "monthly"),
    ("/about", "0.5", "monthly"),
    ("/contact", "0.5", "monthly"),
    ("/faq", "0.4", "monthly"),
    ("/privacy-policy", "0.3", "yearly"),
    ("/terms", "0.3", "yearly"),
    ("/shipping-policy", "0.3", "yearly"),
    ("/returns-refunds", "0.3", "yearly"),
]


@router.get("/sitemap.xml")
def sitemap(request: Request, db: OrmSession = Depends(get_db)):
    base = _site_base(request)
    rows = [f"<url><loc>{base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>"]
    for path, priority, freq in STATIC_PATHS[1:]:
        rows.append(f"<url><loc>{base}{path}</loc><changefreq>{freq}</changefreq><priority>{priority}</priority></url>")
    for product in db.scalars(select(Product).where(Product.status == "active").order_by(Product.updated_at.desc()).limit(5000)):
        rows.append(
            f"<url><loc>{base}/product/{product.slug}</loc>"
            f"<lastmod>{product.updated_at.date().isoformat()}</lastmod>"
            f"<changefreq>weekly</changefreq><priority>0.7</priority></url>"
        )
    for listing in db.scalars(select(Listing).where(Listing.status == "active").limit(2000)):
        rows.append(
            f"<url><loc>{base}/used-books/{listing.listing_code}</loc>"
            f"<changefreq>daily</changefreq><priority>0.6</priority></url>"
        )
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>"
    return Response(content=xml, media_type="application/xml")


@router.get("/robots.txt", response_class=PlainTextResponse)
def robots(request: Request):
    base = _site_base(request)
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /admin\n"
        "Disallow: /account\n"
        "Disallow: /cart\n"
        "Disallow: /checkout\n"
        "Disallow: /orders\n"
        "Disallow: /order-details\n"
        "Disallow: /wishlist\n"
        "Disallow: /track-order\n"
        "Disallow: /reset-password\n"
        "Disallow: /api/\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )
    return PlainTextResponse(body)


@router.get("/api/store/policies")
def policies(db: OrmSession = Depends(get_db)):
    """Published policy text for the legal pages (empty when not configured)."""
    public = store_settings.public_settings(db)
    return {
        "store_name": public.get("store_name"),
        "address": public.get("store_address"),
        "phone": public.get("store_phone"),
        "email": public.get("store_email"),
        "opening_hours": public.get("store_opening_hours"),
        "shipping_note": public.get("shipping_note"),
        "returns_note": public.get("returns_note"),
        "return_window_days": public.get("return_window_days"),
        "cancellation_window_hours": public.get("cancellation_window_hours"),
        "delivery_enabled": public.get("delivery_enabled"),
        "delivery_fee_paise": public.get("delivery_fee_paise"),
        "delivery_pincodes": public.get("delivery_pincodes"),
        "cod_enabled": public.get("cod_enabled"),
        "tax_enabled": public.get("tax_enabled"),
        "tax_rate_bp": public.get("tax_rate_bp"),
        "marketplace_note": public.get("marketplace_note"),
        "demo_mode": public.get("demo_mode"),
        "online_payments_available": public.get("online_payments_available"),
    }
