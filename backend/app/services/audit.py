"""Audit logging for administrative and security-relevant actions."""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session as OrmSession

from ..models import AuditLog, User


def _serialise(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _serialise(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialise(v) for v in value]
    return str(value)


def audit(
    db: OrmSession,
    action: str,
    actor: Optional[User] = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    before: Any = None,
    after: Any = None,
    ip_address: str | None = None,
    commit: bool = False,
) -> AuditLog:
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_email=(actor.email[:255] if actor else None),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id)[:64] if entity_id else None,
        before_json=_serialise(before) if before is not None else None,
        after_json=_serialise(after) if after is not None else None,
        ip_address=ip_address,
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry
