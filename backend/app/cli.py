"""Operational CLI.

Usage (from the ``backend`` directory, with the virtualenv active):

    python -m app.cli create-admin --email owner@example.com
    python -m app.cli reset-password --email owner@example.com
    python -m app.cli seed-demo
    python -m app.cli sweep-reservations
    python -m app.cli backup --out backups/app.db
"""
from __future__ import annotations

import argparse
import getpass
import os
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import func, select

from .db import SessionLocal, create_all, now
from .models import Order, User
from .security import hash_password


def _read_password(confirm: bool = True) -> str:
    password = getpass.getpass("Password (min 10 chars): ")
    if len(password) < 10:
        raise SystemExit("Password must be at least 10 characters.")
    if confirm and getpass.getpass("Confirm password: ") != password:
        raise SystemExit("Passwords do not match.")
    return password


def create_admin(args) -> int:
    create_all()
    email = (args.email or input("Admin email: ")).strip().lower()
    if "@" not in email:
        raise SystemExit("A valid email is required.")
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(func.lower(User.email) == email))
        if existing:
            print(f"User {email} already exists with role '{existing.role}'. Nothing changed.")
            return 1
        password = os.getenv("ADMIN_PASSWORD") if args.password_from_env else None
        password = password or _read_password()
        user = User(
            email=email,
            full_name=args.name or "Store Administrator",
            password_hash=hash_password(password),
            role="admin",
            status="active",
        )
        db.add(user)
        db.commit()
        print(f"Administrator created: {email}")
        print("Store the password in a password manager; it is not recoverable from the database.")
    return 0


def reset_password(args) -> int:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(func.lower(User.email) == (args.email or "").strip().lower()))
        if not user:
            raise SystemExit("No user with that email.")
        password = _read_password()
        user.password_hash = hash_password(password)
        db.commit()
        print(f"Password updated for {user.email}. Existing sessions remain valid until they expire; ")
        print("revoke them by clearing the sessions table if required.")
    return 0


def seed_demo_cmd(_args) -> int:
    create_all()
    from .seed import seed_demo

    with SessionLocal() as db:
        summary = seed_demo(db)
        if summary.get("skipped"):
            print(f"Seed skipped: {summary['reason']}")
            return 0
        print("Demo data created (SAMPLE DATA — demo mode).")
        print(f"  products      : {summary['products']}")
        print(f"  admin email   : {summary['admin_email']}")
        print(f"  admin password: {summary['admin_password']}")
        print(f"  customer      : {summary['demo_customer_email']} / {summary['demo_customer_password']}")
        print("Change these credentials before exposing the deployment.")
    return 0


def sweep_reservations(_args) -> int:
    from .services.commerce import release_expired_reservations

    with SessionLocal() as db:
        released = release_expired_reservations(db)
        print(f"Released {released} expired reservation(s).")
    return 0


def backup(args) -> int:
    """Copy a SQLite database safely (online backup API, WAL-safe)."""
    from .config import settings

    if not settings.database_url.startswith("sqlite:///"):
        raise SystemExit("Use pg_dump for PostgreSQL (see docs/BACKUP_RESTORE.md).")
    source = Path(settings.database_url.replace("sqlite:///", ""))
    if not source.exists():
        raise SystemExit(f"Database not found: {source}")
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(str(source))
    dst = sqlite3.connect(str(target))
    try:
        with dst:
            src.backup(dst)
        check = dst.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        dst.close()
        src.close()
    if check != "ok":
        target.unlink(missing_ok=True)
        raise SystemExit(f"Backup failed integrity check: {check}")
    print(f"Backed up {source} -> {target} (integrity ok)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Ankit Stationery Mart operations CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_admin = sub.add_parser("create-admin", help="Create the first administrator securely")
    p_admin.add_argument("--email")
    p_admin.add_argument("--name")
    p_admin.add_argument("--password-from-env", action="store_true", help="Read ADMIN_PASSWORD instead of prompting")
    p_admin.set_defaults(func=create_admin)

    p_reset = sub.add_parser("reset-password", help="Reset a user's password")
    p_reset.add_argument("--email", required=True)
    p_reset.set_defaults(func=reset_password)

    p_seed = sub.add_parser("seed-demo", help="Load clearly-labelled sample data")
    p_seed.set_defaults(func=seed_demo_cmd)

    p_sweep = sub.add_parser("sweep-reservations", help="Release expired stock reservations")
    p_sweep.set_defaults(func=sweep_reservations)

    p_backup = sub.add_parser("backup", help="Copy the SQLite database file")
    p_backup.add_argument("--out", default="backups/app.db")
    p_backup.set_defaults(func=backup)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
