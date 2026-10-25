#!/usr/bin/env bash
# Back up the Ankit Stationery Mart database and uploads.
#
# Usage:
#   BACKUP_ROOT=/srv/asm/data/backups RETENTION_DAYS=30 \
#   DATABASE_URL=... UPLOAD_DIR=... ./scripts/backup.sh
#
# Reads DATABASE_URL and UPLOAD_DIR from the environment (e.g. the systemd
# EnvironmentFile). Supports PostgreSQL (pg_dump) and SQLite (online backup API).
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
UPLOAD_DIR="${UPLOAD_DIR:-./backend/data/uploads}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"

STAMP="$(date +%Y-%m-%d-%H%M%S)"
DEST="${BACKUP_ROOT}/asm-${STAMP}"
mkdir -p "$DEST"

PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ "$DATABASE_URL" == postgresql* ]]; then
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "pg_dump not found; install postgresql-client" >&2
    exit 1
  fi
  # SQLAlchemy URLs carry a driver suffix that pg_dump does not understand.
  PG_URL="${DATABASE_URL/postgresql+psycopg/postgresql}"
  PG_URL="${PG_URL/postgresql+psycopg2/postgresql}"
  pg_dump --format=custom --no-owner --no-acl --file="${DEST}/store.dump" "$PG_URL"
  echo "database: store.dump ($(du -h "${DEST}/store.dump" | cut -f1))"
elif [[ "$DATABASE_URL" == sqlite* ]]; then
  DB_PATH="${DATABASE_URL#sqlite:///}"
  DB_PATH="${DB_PATH#sqlite://}"   # handles sqlite:////absolute/path
  if [[ ! -f "$DB_PATH" ]]; then
    echo "SQLite database not found at: $DB_PATH" >&2
    exit 1
  fi
  "$PYTHON_BIN" - "$DB_PATH" "${DEST}/store.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
try:
    with dst:
        src.backup(dst)
finally:
    dst.close()
    src.close()
PY
  echo "database: store.db ($(du -h "${DEST}/store.db" | cut -f1))"
else
  echo "Unsupported DATABASE_URL scheme: $DATABASE_URL" >&2
  exit 1
fi

if [[ -d "$UPLOAD_DIR" ]]; then
  tar czf "${DEST}/uploads.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "uploads: uploads.tar.gz ($(du -h "${DEST}/uploads.tar.gz" | cut -f1))"
else
  echo "warning: UPLOAD_DIR '$UPLOAD_DIR' does not exist; no images archived" >&2
fi

{
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host=$(hostname)"
  echo "database_url_scheme=${DATABASE_URL%%:*}"
  echo "upload_dir=${UPLOAD_DIR}"
  echo "retention_days=${RETENTION_DAYS}"
} > "${DEST}/manifest.txt"

# Cheap integrity check: a truncated SQLite copy fails here rather than at restore.
if [[ "$DATABASE_URL" == sqlite* ]]; then
  "$PYTHON_BIN" - "${DEST}/store.db" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
result = con.execute("PRAGMA integrity_check").fetchone()[0]
con.close()
if result != "ok":
    raise SystemExit(f"integrity_check failed: {result}")
print("integrity: ok")
PY
fi

# Prune old backup directories.
find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'asm-*' -mtime "+${RETENTION_DAYS}" -print -exec rm -rf {} + 2>/dev/null || true

echo "backup complete: $DEST"
