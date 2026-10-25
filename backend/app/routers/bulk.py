"""Bulk order quotation requests."""
from __future__ import annotations

import secrets
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as OrmSession, selectinload

from ..config import settings
from ..db import get_db, now
from ..models import BulkQuotation, Product, QuotationItem, User
from ..schemas import QuotationIn
from ..security import get_current_user, require_user
from ..services import settings as store_settings
from ..services.audit import audit
from ..services.notifications import notify_staff, notify_user
from ..services.rate_limit import client_ip, enforce

router = APIRouter(prefix="/api", tags=["bulk-orders"])


def _quotation_payload(row: BulkQuotation) -> dict:
    return {
        "id": row.id,
        "reference": row.reference,
        "organization_name": row.organization_name,
        "organization_type": row.organization_type,
        "contact_name": row.contact_name,
        "contact_email": row.contact_email,
        "contact_phone": row.contact_phone,
        "delivery_location": row.delivery_location,
        "target_date": row.target_date.isoformat() if row.target_date else None,
        "notes": row.notes,
        "status": row.status,
        "quote_notes": row.quote_notes,
        "quote_total_paise": row.quote_total_paise,
        "quote_valid_until": row.quote_valid_until.isoformat() if row.quote_valid_until else None,
        "quoted_at": row.quoted_at,
        "accepted_at": row.accepted_at,
        "order_id": row.order_id,
        "created_at": row.created_at,
        "items": [
            {
                "id": i.id,
                "description": i.description,
                "quantity": i.quantity,
                "product_id": i.product_id,
                "unit_price_paise": i.unit_price_paise,
                "line_total_paise": i.line_total_paise,
            }
            for i in row.items
        ],
    }


def _authorised(row: BulkQuotation, user: Optional[User], token: Optional[str]) -> bool:
    if user and (row.user_id == user.id or user.role in ("staff", "admin")):
        return True
    return bool(token and secrets.compare_digest(token, row.access_token))


@router.post("/quotations", status_code=201)
def create_quotation(
    payload: QuotationIn,
    request: Request,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    enforce(request, "quotation", *settings.rate_limit_public_write)
    if payload.target_date and payload.target_date < date.today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Target date cannot be in the past")
    reference = f"BQ-{secrets.token_hex(4).upper()}"
    token = secrets.token_urlsafe(24)
    row = BulkQuotation(
        reference=reference,
        access_token=token,
        user_id=user.id if user else None,
        organization_name=payload.organization_name,
        organization_type=payload.organization_type,
        contact_name=payload.contact_name,
        contact_email=str(payload.contact_email).lower(),
        contact_phone=payload.contact_phone,
        delivery_location=payload.delivery_location,
        target_date=payload.target_date,
        notes=payload.notes,
        status="submitted",
    )
    db.add(row)
    db.flush()
    for item in payload.items:
        product = db.get(Product, item.product_id) if item.product_id else None
        if item.product_id and not product:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "One of the selected products no longer exists")
        db.add(
            QuotationItem(
                quotation_id=row.id,
                product_id=product.id if product else None,
                description=item.description,
                quantity=item.quantity,
            )
        )
    db.commit()
    staff = list(db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all())
    notify_staff(
        db,
        staff,
        "quotation_received",
        f"Bulk request {reference}",
        f"{payload.organization_name} requested a quotation for {len(payload.items)} line items.",
    )
    notify_user(
        db,
        user,
        "quotation_received",
        f"Bulk request {reference} received",
        "Your request has been recorded. A quotation is not yet issued; the store will review the request and send a quote.",
        related_type="quotation",
        related_id=row.id,
        email=str(payload.contact_email),
    )
    audit(db, "quotation.created", actor=user, entity_type="quotation", entity_id=row.id, ip_address=client_ip(request), commit=True)
    return {
        "quotation": _quotation_payload(row),
        "access_token": token,
        "status_url": f"/quotations/{reference}?token={token}",
        "message": "Request recorded. This is a quotation request, not a confirmed order.",
    }


@router.get("/quotations")
def find_quotation(
    reference: str = Query(min_length=4, max_length=32),
    email: str = Query(min_length=3, max_length=255),
    db: OrmSession = Depends(get_db),
):
    row = db.scalar(
        select(BulkQuotation)
        .options(selectinload(BulkQuotation.items))
        .where(func.lower(BulkQuotation.reference) == reference.lower(), func.lower(BulkQuotation.contact_email) == email.lower())
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No quotation matches those details")
    return {"quotation": _quotation_payload(row), "access_token": row.access_token}


@router.get("/quotations/{reference}")
def quotation_detail(
    reference: str,
    token: Optional[str] = None,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    row = db.scalar(
        select(BulkQuotation).options(selectinload(BulkQuotation.items)).where(BulkQuotation.reference == reference)
    )
    if not row or not _authorised(row, user, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quotation not found")
    return {"quotation": _quotation_payload(row), "access_token": row.access_token if user else token}


@router.post("/quotations/{reference}/accept")
def accept_quotation(
    reference: str,
    request: Request,
    token: Optional[str] = None,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    row = db.scalar(
        select(BulkQuotation).options(selectinload(BulkQuotation.items)).where(BulkQuotation.reference == reference)
    )
    if not row or not _authorised(row, user, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quotation not found")
    if row.status != "quoted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a quoted request can be accepted")
    if row.quote_valid_until and row.quote_valid_until < date.today():
        row.status = "expired"
        db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "This quotation has expired. Please request a new quote.")
    row.status = "accepted"
    row.accepted_at = now()
    db.commit()
    staff = list(db.scalars(select(User).where(User.role.in_(("admin", "staff")))).all())
    notify_staff(db, staff, "quotation_accepted", f"Quotation {row.reference} accepted", "Prepare the order and confirm payment/delivery terms with the customer.")
    notify_user(
        db,
        user,
        "quotation_accepted",
        f"Quotation {row.reference} accepted",
        "Thank you. The store will convert this accepted quotation into an order and contact you to confirm delivery and payment.",
        related_type="quotation",
        related_id=row.id,
        email=row.contact_email,
    )
    audit(db, "quotation.accepted", actor=user, entity_type="quotation", entity_id=row.id, ip_address=client_ip(request), commit=True)
    return {"quotation": _quotation_payload(row)}


@router.post("/quotations/{reference}/decline")
def decline_quotation(
    reference: str,
    token: Optional[str] = None,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    row = db.scalar(select(BulkQuotation).where(BulkQuotation.reference == reference))
    if not row or not _authorised(row, user, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quotation not found")
    if row.status not in ("quoted", "submitted", "under_review"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This request can no longer be declined")
    row.status = "cancelled"
    db.commit()
    return {"quotation": _quotation_payload(row)}


@router.get("/me/quotations")
def my_quotations(user: User = Depends(require_user), db: OrmSession = Depends(get_db)):
    rows = db.scalars(
        select(BulkQuotation).options(selectinload(BulkQuotation.items)).where(BulkQuotation.user_id == user.id).order_by(BulkQuotation.created_at.desc())
    ).all()
    return {"quotations": [_quotation_payload(r) for r in rows]}


@router.get("/quotations/{reference}/document", response_class=HTMLResponse)
def quotation_document(
    reference: str,
    token: Optional[str] = None,
    user: Optional[User] = Depends(get_current_user),
    db: OrmSession = Depends(get_db),
):
    row = db.scalar(
        select(BulkQuotation).options(selectinload(BulkQuotation.items)).where(BulkQuotation.reference == reference)
    )
    if not row or not _authorised(row, user, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quotation not found")
    store = store_settings.get_all(db)
    return HTMLResponse(_render_quotation(row, store))


def _render_quotation(row: BulkQuotation, store: dict) -> str:
    import html

    e = lambda v: html.escape("" if v is None else str(v))  # noqa: E731
    money = lambda p: f"₹{p/100:,.2f}" if p is not None else "—"  # noqa: E731
    item_rows = "".join(
        f"<tr><td>{e(i.description)}</td><td class='num'>{i.quantity}</td>"
        f"<td class='num'>{money(i.unit_price_paise)}</td><td class='num'>{money(i.line_total_paise)}</td></tr>"
        for i in row.items
    )
    total = f"<tr class='total'><td colspan='3' class='right'>Quoted total</td><td class='num'>{money(row.quote_total_paise)}</td></tr>" if row.quote_total_paise is not None else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Quotation {e(row.reference)} · {e(store.get('store_name'))}</title>
<style>body{{font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#0f172a;padding:32px;max-width:820px;margin:0 auto}}
h1{{color:#0f2d52;font-size:22px;margin:0 0 4px}}table{{width:100%;border-collapse:collapse;margin-top:16px}}
th,td{{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left;font-size:14px}}th{{font-size:12px;text-transform:uppercase;color:#64748b}}
.num{{text-align:right}}.right{{text-align:right}}tr.total td{{font-weight:700;border-top:2px solid #0f2d52}}
.status{{display:inline-block;background:#0f2d52;color:#fff;border-radius:999px;padding:2px 10px;font-size:12px}}
@media print{{button{{display:none}}}}</style></head><body>
<h1>{e(store.get('store_name') or 'Ankit Stationery Mart')}</h1>
<div style="color:#64748b;font-size:13px">{e(store.get('store_address') or '')}</div>
<p><strong>Bulk quotation</strong> · {e(row.reference)} · <span class="status">{e(row.status.upper())}</span></p>
<p style="font-size:14px">{e(row.organization_name)} ({e(row.organization_type)})<br>
Contact: {e(row.contact_name)} · {e(row.contact_phone)} · {e(row.contact_email)}<br>
Delivery location: {e(row.delivery_location)}<br>
Requested date: {e(row.target_date or 'Not specified')}</p>
<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
<tbody>{item_rows}</tbody><tbody>{total}</tbody></table>
{'' if not row.quote_notes else f'<p style="font-size:14px"><strong>Notes:</strong> {e(row.quote_notes)}</p>'}
{'' if not row.quote_valid_until else f'<p style="font-size:13px;color:#64748b">This quotation is valid until {e(row.quote_valid_until)}.</p>'}
<p style="font-size:12px;color:#64748b;margin-top:32px">This is a quotation, not a tax invoice or a confirmed order. Prices exclude delivery unless stated.</p>
<button onclick="window.print()" style="background:#0f2d52;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer">Print / Save as PDF</button>
</body></html>"""
