#!/usr/bin/env bash
# Start the API and the storefront together for local development.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$ROOT/.venv" ]; then
  echo "→ creating Python virtualenv"
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/pip" install --quiet --upgrade pip
  "$ROOT/.venv/bin/pip" install --quiet -r "$ROOT/backend/requirements.txt"
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "→ installing frontend dependencies"
  (cd "$ROOT/frontend" && npm install)
fi

cleanup() {
  echo
  echo "→ stopping"
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "→ API      http://localhost:8000/docs"
(cd "$ROOT/backend" && "$ROOT/.venv/bin/python" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000) &
echo "→ storefront http://localhost:5173"
(cd "$ROOT/frontend" && npm run dev) &

wait
