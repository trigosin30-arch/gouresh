#!/usr/bin/env bash
# Start the whole app (API + built SPA) on one port with clearly-labelled demo data.
#
#   ./scripts/serve-demo.sh            # http://127.0.0.1:8000
#   PORT=3000 ./scripts/serve-demo.sh
#
# Demo sign-ins:
#   admin     demo.admin@example.com     ($DEMO_ADMIN_PASSWORD, default below)
#   customer  demo.customer@example.com  ($DEMO_CUSTOMER_PASSWORD, default below)
#   seller    demo.seller@example.com    (same as the customer password)
#
# This is for previewing/demoing only. For a real deployment see docs/DEPLOYMENT.md.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PORT="${PORT:-8000}"
DATA_DIR="${DATA_DIR:-$ROOT/.demo}"
PY="${PYTHON:-$ROOT/.venv/bin/python}"

if [[ ! -x "$PY" ]]; then
  echo "Python venv not found at $PY" >&2
  echo "Create it first: python -m venv .venv && .venv/bin/pip install -r backend/requirements.txt" >&2
  exit 1
fi

if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
  echo "Building the frontend (one-off)…"
  (cd frontend && npm ci --silent && npm run build)
fi

mkdir -p "$DATA_DIR/uploads"

export DATABASE_URL="${DATABASE_URL:-sqlite:///$DATA_DIR/asm.db}"
export UPLOAD_DIR="${UPLOAD_DIR:-$DATA_DIR/uploads}"
export FRONTEND_DIST="${FRONTEND_DIST:-$ROOT/frontend/dist}"
export SEED_DEMO="${SEED_DEMO:-1}"
export SECRET_KEY="${SECRET_KEY:-local-preview-secret-key-change-me-1234567890}"
export DEMO_ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:-AdminPass12345}"
export DEMO_CUSTOMER_PASSWORD="${DEMO_CUSTOMER_PASSWORD:-CustomerPass12345}"

echo "Ankit Stationery Mart → http://127.0.0.1:$PORT  (demo data: ${SEED_DEMO})"
exec "$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --app-dir "$ROOT/backend"
