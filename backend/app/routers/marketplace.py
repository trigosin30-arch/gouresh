"""Second-hand book marketplace and resale submissions."""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as OrmSession, selectinload

from ..config import settings
from ..constants import CONDITIONS
from ..db import get_db, now
from ..models import (
    BookSubmission,
    CommissionRecord,
    Listing,
    ListingImage,
    ListingReport,
    Order,
    Product,
    StoreSetting,
    User,
)
from ..schemas import (
    BookSubmissionIn,
    ListingIn,
    ListingReportIn,
    MarketplacePurchaseIn,
)
from ..security import get_current_user, require_user
from ..serializers import listing_card
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.commerce import order_public, purchase_listing
from ..services.notifications import notify_staff, notify_user
from ..services.rate_limit import client_ip, enforce

router = APIRouter(prefix="/api", tags=["marketplace"])


def _require_marketplace(db: OrmSession) -> None:
    if not store_settings.get(db, "marketplace_enabled"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The second-hand marketplace is not open")


def _listing_query():
    return select(Listing).options(selectinload(Listing.images), selectinload(Listing.seller))


@router.get("/listings")
def browse_listings(
    db: OrmSession = Depends(get_db),
    q: Optional[str] = Query(default=None, max_length=120),
    class_level: Optional[str] = None,
    subject: Optional[str] = None,
    board: Optional[str] = None,
    condition: Optional[str] = None,
    min_price: Optional[int] = Query(default=None, ge=0),
    max_price: Optional[int] = Query(default=None, ge=0),
    sort: str = "newest",
    page: int = Query(default=1, ge=1, le=200),
    per_page: int = Query(default=20, ge=1, le=60),
):
    _require_marketplace(db)
    query = _listing_query().where(Listing.status == "active")
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                Listing.title.ilike(like),
                Listing.author.ilike(like),
                Listing.isbn.ilike(like),
                Listing.publisher.ilike(like),
                Listing.subject.ilike(like),
            )
        )
    if class_level:
        query = query.where(Listing.class_level == class_level)
    if subject:
        query = query.where(Listing.subject == subject)
    if board:
        query = query.where(Listing.board == board)
    if condition and condition in CONDITIONS:
        query = query.where(Listing.condition == condition)
    if min_price is not None:
        query = query.where(Listing.asking_price_paise >= min_price)
    if max_price is not None:
        query = query.where(Listing.asking_price_paise <= max_price)

    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0
    order_by = {
        "price_asc": Listing.asking_price_paise.asc(),
        "price_desc": Listing.asking_price_paise.desc(),
        "oldest": Listing.published_at.asc(),
    }.get(sort, Listing.published_at.desc().nullslast())
    rows = db.scalars(query.order_by(order_by).offset((page - 1) * per_page).limit(per_page)).all()

    filter_rows = db.execute(
        select(Listing.class_level, Listing.subject, Listing.condition, func.count(Listing.id))
        .where(Listing.status == "active")
        .group_by(Listing.class_level, Listing.subject, Listing.condition)
    ).all()
    classes = sorted({r[0] for r in filter_rows if r[0]}, key=lambda v: (not str(v).isdigit(), str(v)))
    subjects = sorted({r[1] for r in filter_rows if r[1]})
    commission_bp = store_settings.get_int(db, "marketplace_commission_bp")
    return {
        "items": [listing_card(db, l) for l in rows],
        "total": int(total),
        "page": page,
        "pages": max(1, (int(total) + per_page - 1) // per_page),
        "per_page": per_page,
        "filters": {"classes": classes, "subjects": subjects, "conditions": list(CONDITIONS)},
        "commission_bp": commission_bp,
        "marketplace_note": store_settings.get(db, "marketplace_note"),
    }


@router.get("/listings/{listing_id}")
def listing_detail(
    listing_id: str,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    listing = db.scalar(_listing_query().where(or_(Listing.id == listing_id, Listing.listing_code == listing_id)))
    if not listing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    is_owner = user and listing.seller_id == user.id
    is_staff = user and user.role in ("staff", "admin")
    if listing.status != "active" and not (is_owner or is_staff):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    data = listing_card(db, listing, include_seller=bool(is_owner or is_staff))
    data["can_buy"] = listing.status == "active" and not is_owner
    data["is_owner"] = bool(is_owner)
    data["commission_bp"] = store_settings.get_int(db, "marketplace_commission_bp")
    data["marketplace_note"] = store_settings.get(db, "marketplace_note")
    data["delivery"] = {
        "delivery_enabled": bool(store_settings.get(db, "delivery_enabled") and store_settings.get(db, "delivery_pincodes")),
        "pickup_enabled": bool(store_settings.get(db, "pickup_enabled")),
        "delivery_fee_paise": store_settings.get_int(db, "delivery_fee_paise"),
    }
    return data


@router.post("/listings/{listing_id}/report", status_code=201)
def report_listing(
    listing_id: str,
    payload: ListingReportIn,
    request: Request,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "listing_report", 5, 3600)
    listing = db.scalar(select(Listing).where(or_(Listing.id == listing_id, Listing.listing_code == listing_id)))
    if not listing or listing.status not in ("active", "suspended", "pending_review"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    db.add(
        ListingReport(
            listing_id=listing.id,
            reporter_user_id=user.id if user else None,
            reason=payload.reason,
            details=payload.details,
        )
    )
    db.commit()
    staff = list(db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all())
    notify_staff(
        db,
        staff,
        "listing_reported",
        f"Listing reported: {listing.listing_code}",
        f"Reason: {payload.reason}\n{payload.details or ''}",
    )
    audit(db, "listing.reported", actor=user, entity_type="listing", entity_id=listing.id, after={"reason": payload.reason}, ip_address=client_ip(request), commit=True)
    return {"ok": True, "message": "Thank you. The store team will review this listing."}


@router.post("/listings/{listing_id}/purchase", status_code=201)
def buy_listing(
    listing_id: str,
    payload: MarketplacePurchaseIn,
    request: Request,
    user: User = Depends(require_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "marketplace_purchase", 10, 600)
    _require_marketplace(db)
    if user.status == "restricted":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is restricted. Please contact the store.")
    listing = db.scalar(_listing_query().where(or_(Listing.id == listing_id, Listing.listing_code == listing_id)))
    if not listing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if listing.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This listing is no longer available")
    if listing.seller_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot buy your own listing")
    order = purchase_listing(db, listing, payload, user)
    audit(db, "listing.purchased", actor=user, entity_type="listing", entity_id=listing.id, after={"order": order.order_number}, ip_address=client_ip(request), commit=True)
    return {"order": order_public(order), "requires_payment": order.status == "pending_payment"}


# --------------------------- seller: own listings ---------------------------
@router.get("/me/listings")
def my_listings(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(_listing_query().where(Listing.seller_id == user.id).order_by(Listing.created_at.desc())).all()
    return {"items": [listing_card(db, l, include_seller=True) for l in rows]}


def _apply_images(db: OrmSession, listing: Listing, urls: list[str]) -> None:
    if not urls:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "At least one photograph of the book is required")
    for image in list(listing.images):
        db.delete(image)
    db.flush()
    for index, url in enumerate(urls):
        if not url.startswith("/uploads/"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Images must be uploaded through the store uploader")
        db.add(ListingImage(listing_id=listing.id, url=url, alt_text=listing.title, sort_order=index))


@router.post("/me/listings", status_code=201)
def create_listing(payload: ListingIn, request: Request, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    enforce(request, "listing_create", 10, 3600)
    _require_marketplace(db)
    if user.status == "restricted":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is restricted. Please contact the store.")
    listing = Listing(
        listing_code=f"UB-{secrets.token_hex(4).upper()}",
        seller_id=user.id,
        title=payload.title,
        isbn=payload.isbn,
        author=payload.author,
        publisher=payload.publisher,
        board=payload.board,
        class_level=payload.class_level,
        subject=payload.subject,
        book_type=payload.book_type,
        condition=payload.condition,
        condition_notes=payload.condition_notes,
        asking_price_paise=payload.asking_price_paise,
        status="pending_review",
    )
    db.add(listing)
    db.flush()
    _apply_images(db, listing, payload.image_urls)
    db.commit()
    audit(db, "listing.created", actor=user, entity_type="listing", entity_id=listing.id, ip_address=client_ip(request), commit=True)
    staff = list(db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all())
    notify_staff(db, staff, "listing_pending", f"Listing {listing.listing_code} needs review", f"{user.full_name} submitted '{listing.title}' for review.")
    notify_user(
        db,
        user,
        "listing_submitted",
        f"Listing {listing.listing_code} submitted",
        "Your listing is under review. It becomes visible to buyers only after the store approves it.",
        related_type="listing",
        related_id=listing.id,
    )
    return {"listing": listing_card(db, listing, include_seller=True)}


@router.put("/me/listings/{listing_id}")
def update_listing(listing_id: str, payload: ListingIn, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    listing = db.scalar(_listing_query().where(Listing.id == listing_id, Listing.seller_id == user.id))
    if not listing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if listing.status in ("sold", "suspended", "archived"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This listing can no longer be edited")
    for field in ("title", "isbn", "author", "publisher", "board", "class_level", "subject", "book_type", "condition", "condition_notes", "asking_price_paise"):
        setattr(listing, field, getattr(payload, field))
    _apply_images(db, listing, payload.image_urls)
    # Edits require re-moderation.
    listing.status = "pending_review"
    listing.reviewed_by = None
    listing.reviewed_at = None
    db.commit()
    return {"listing": listing_card(db, listing, include_seller=True)}


@router.post("/me/listings/{listing_id}/withdraw")
def withdraw_listing(listing_id: str, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    listing = db.scalar(select(Listing).where(Listing.id == listing_id, Listing.seller_id == user.id))
    if not listing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if listing.status in ("sold", "archived"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This listing can no longer be withdrawn")
    listing.status = "withdrawn"
    db.commit()
    return {"listing": listing_card(db, listing, include_seller=True)}


@router.get("/me/marketplace-sales")
def my_sales(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(
        select(CommissionRecord).where(CommissionRecord.seller_id == user.id).order_by(CommissionRecord.created_at.desc())
    ).all()
    total_commission = sum(r.commission_paise for r in rows if r.status != "void")
    total_proceeds = sum(r.seller_proceeds_paise for r in rows if r.status != "void")
    paid = sum(r.seller_proceeds_paise for r in rows if r.status == "paid")
    items = []
    for record in rows:
        order = db.get(Order, record.order_id)
        listing = db.get(Listing, record.listing_id) if record.listing_id else None
        items.append(
            {
                "id": record.id,
                "order_number": order.order_number if order else None,
                "order_status": order.status if order else None,
                "listing_title": listing.title if listing else None,
                "gross_paise": record.gross_paise,
                "commission_rate_bp": record.commission_rate_bp,
                "commission_paise": record.commission_paise,
                "seller_proceeds_paise": record.seller_proceeds_paise,
                "status": record.status,
                "created_at": record.created_at,
                "paid_at": record.paid_at,
            }
        )
    return {
        "sales": items,
        "totals": {
            "gross_paise": sum(r.gross_paise for r in rows if r.status != "void"),
            "commission_paise": total_commission,
            "proceeds_paise": total_proceeds,
            "paid_paise": paid,
            "outstanding_paise": max(0, total_proceeds - paid),
        },
        "note": "These are recorded accounting figures. Seller payouts are processed by the store after handover and are not automatic.",
    }


# --------------------------- resale submissions ---------------------------
@router.post("/submissions", status_code=201)
def create_submission(
    payload: BookSubmissionIn,
    request: Request,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "submission", *settings.rate_limit_public_write)
    for url in payload.photo_urls:
        if not url.startswith("/uploads/"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Photos must be uploaded through the store uploader")
    reference = f"BK-{secrets.token_hex(4).upper()}"
    submission = BookSubmission(
        reference=reference,
        user_id=user.id if user else None,
        book_title=payload.book_title,
        isbn=payload.isbn,
        author=payload.author,
        publisher=payload.publisher,
        board=payload.board,
        class_level=payload.class_level,
        subject=payload.subject,
        condition=payload.condition,
        expected_price_paise=payload.expected_price_paise,
        selling_method=payload.selling_method,
        contact_name=payload.contact_name,
        contact_phone=payload.contact_phone,
        contact_email=str(payload.contact_email).lower(),
        pickup_address=payload.pickup_address,
        notes=payload.notes,
        photos=payload.photo_urls,
        status="submitted",
    )
    db.add(submission)
    db.commit()
    staff = list(db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all())
    notify_staff(
        db,
        staff,
        "submission_received",
        f"New resale submission {reference}",
        f"{payload.book_title} ({payload.condition}) from {payload.contact_name} · {payload.contact_phone}",
    )
    notify_user(
        db,
        user,
        "submission_received",
        f"Submission {reference} received",
        (
            f"Thank you. We have recorded your submission {reference} for '{payload.book_title}'. "
            "This is a request for evaluation, not a purchase or a guaranteed payout. "
            "The store will review it and contact you with next steps."
            if payload.selling_method != "marketplace_listing"
            else f"Thank you. Submission {reference} is queued for moderation. Your book is not listed for sale until the store approves it."
        ),
        related_type="submission",
        related_id=submission.id,
        email=submission.contact_email,
    )
    audit(db, "submission.created", actor=user, entity_type="submission", entity_id=submission.id, ip_address=client_ip(request), commit=True)
    return {
        "submission": _submission_payload(submission, public=True),
        "message": (
            "Submission recorded. This is a request for review, not a purchase and not a guaranteed payout. "
            "A marketplace listing only becomes visible after the store approves it. Keep the reference for follow-up."
            if payload.selling_method == "marketplace_listing"
            else "Submission recorded. This is a request for the store to evaluate the book — not a purchase. Keep the reference for follow-up."
        ),
    }


def _submission_payload(row: BookSubmission, *, public: bool = False) -> dict:
    return {
        "id": row.id,
        "reference": row.reference,
        "book_title": row.book_title,
        "isbn": row.isbn,
        "author": row.author,
        "publisher": row.publisher,
        "board": row.board,
        "class_level": row.class_level,
        "subject": row.subject,
        "condition": row.condition,
        "expected_price_paise": row.expected_price_paise,
        "selling_method": row.selling_method,
        "status": row.status,
        "photos": row.photos or [],
        "created_at": row.created_at,
        "admin_note": None if public else row.admin_note,
        "listing_id": row.listing_id,
        "contact_name": None if public else row.contact_name,
        "contact_phone": None if public else row.contact_phone,
        "contact_email": None if public else row.contact_email,
        "pickup_address": None if public else row.pickup_address,
        "notes": None if public else row.notes,
    }


@router.get("/me/submissions")
def my_submissions(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(select(BookSubmission).where(BookSubmission.user_id == user.id).order_by(BookSubmission.created_at.desc())).all()
    return {"submissions": [_submission_payload(r) for r in rows]}


@router.get("/submissions/{reference}")
def submission_status(reference: str, user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    row = db.scalar(select(BookSubmission).where(BookSubmission.reference == reference, BookSubmission.user_id == user.id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    return {"submission": _submission_payload(row)}
