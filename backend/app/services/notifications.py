"""Notification service.

Every notification is persisted first (so the admin panel can inspect what was
requested and what happened) and then a delivery attempt is recorded with an
honest status:

* ``sent``    – an SMTP server accepted the message (or the dev outbox file did).
* ``failed``  – the configured provider rejected the message.
* ``skipped`` – no provider is configured for this channel.

SMS and WhatsApp have no provider integration in this build; they are always
recorded as ``skipped`` with ``provider_not_configured``. The API never reports
those as delivered.
"""
from __future__ import annotations

import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Optional

from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..db import now
from ..models import Notification, User


def _send_email(recipient: str, subject: str, body: str) -> tuple[str, str, Optional[str]]:
    """Return (status, provider, error)."""
    if not (settings.smtp_host and settings.smtp_from):
        if settings.notification_console_provider:
            settings.notification_outbox.parent.mkdir(parents=True, exist_ok=True)
            with settings.notification_outbox.open("a", encoding="utf-8") as fh:
                fh.write(
                    f"--- {datetime.now(timezone.utc).isoformat()} to={recipient} subject={subject!r}\n{body}\n\n"
                )
            return "sent", "development-outbox", None
        return "skipped", "not_configured", "provider_not_configured"

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return "sent", "smtp", None
    except Exception as exc:  # noqa: BLE001 - provider errors must not break flows
        return "failed", "smtp", type(exc).__name__


def notify(
    db: OrmSession,
    *,
    channel: str,
    template: str,
    subject: str,
    body: str,
    user: Optional[User] = None,
    recipient: Optional[str] = None,
    related_type: str | None = None,
    related_id: str | None = None,
    commit: bool = True,
) -> Notification:
    target = recipient or (user.email if user else None)
    if not target and channel == "in_app" and user:
        target = user.email
    if not target:
        raise ValueError("Notification requires a recipient")

    record = Notification(
        user_id=user.id if user else None,
        channel=channel,
        template=template,
        recipient=target[:255],
        subject=subject[:255],
        body=body,
        status="queued",
        related_type=related_type,
        related_id=str(related_id)[:64] if related_id else None,
    )
    db.add(record)
    db.flush()

    if channel == "in_app":
        record.status = "sent"
        record.provider = "in_app"
        record.sent_at = now()
    elif channel == "email":
        status, provider, error = _send_email(target, subject, body)
        record.status = status
        record.provider = provider
        record.error = error
        if status == "sent":
            record.sent_at = now()
    else:  # sms / whatsapp: no provider configured in this build
        record.status = "skipped"
        record.provider = "not_configured"
        record.error = "provider_not_configured"

    if commit:
        db.commit()
    return record


def notify_user(
    db: OrmSession,
    user: Optional[User],
    template: str,
    subject: str,
    body: str,
    *,
    related_type: str | None = None,
    related_id: str | None = None,
    email: Optional[str] = None,
    commit: bool = True,
) -> list[Notification]:
    """Always create an in-app record; additionally attempt email."""
    created: list[Notification] = []
    if user:
        created.append(
            notify(
                db,
                channel="in_app",
                template=template,
                subject=subject,
                body=body,
                user=user,
                related_type=related_type,
                related_id=related_id,
                commit=False,
            )
        )
    recipient = email or (user.email if user else None)
    if recipient:
        created.append(
            notify(
                db,
                channel="email",
                template=template,
                subject=subject,
                body=body,
                user=user,
                recipient=recipient,
                related_type=related_type,
                related_id=related_id,
                commit=False,
            )
        )
    if commit:
        db.commit()
    return created


def notify_staff(db: OrmSession, staff: list[User], template: str, subject: str, body: str) -> None:
    for member in staff:
        notify(
            db,
            channel="in_app",
            template=template,
            subject=subject,
            body=body,
            user=member,
            commit=False,
        )
    db.commit()
