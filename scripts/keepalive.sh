#!/usr/bin/env bash
# Keep an idle-hosted instance awake by touching /healthz on a schedule.
#
#   ./scripts/keepalive.sh                        # every 5 min against $SITE_URL
#   SITE_URL=https://x.onrender.com ./scripts/keepalive.sh
#   INTERVAL=240 ./scripts/keepalive.sh           # every 4 min
#   ./scripts/keepalive.sh --once                 # single probe (for cron/Task Scheduler)
#
# Why: Render's free web services (and equivalent tiers elsewhere) spin the
# container down after ~15 minutes without traffic, and the next visitor waits
# 30-60s. A request every few minutes keeps it warm.
#
# Caveats, stated plainly:
#  * This keeps the WEB SERVICE awake. It does not extend a free database's
#    expiry date, and it does not make the free tier production-grade.
#  * Hosts may rate-limit or discourage artificial traffic; check your
#    provider's terms. A paid instance is the supported way to stay online.
#  * It cannot keep a coding sandbox (e2b.dev preview URLs) alive — those are
#    bound to the sandbox's lifetime, not to traffic.
set -euo pipefail

SITE_URL="${SITE_URL:-${1:-}}"
INTERVAL="${INTERVAL:-300}"
ONCE=0
for arg in "$@"; do
  case "$arg" in
    --once) ONCE=1 ;;
    http*) SITE_URL="$arg" ;;
  esac
done

if [[ -z "${SITE_URL}" ]]; then
  echo "SITE_URL is not set." >&2
  echo "Usage: SITE_URL=https://your-site.example.com $0 [--once]" >&2
  exit 2
fi
SITE_URL="${SITE_URL%/}"

probe() {
  # --max-time 90 covers a cold start (container boot + migrations).
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 90 "${SITE_URL}/healthz" || true)"
  printf '%s  %s  /healthz -> %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SITE_URL" "$code"
  [[ "$code" == "200" ]]
}

if [[ "$ONCE" == "1" ]]; then
  probe
  exit $?
fi

echo "Keeping ${SITE_URL} warm every ${INTERVAL}s. Ctrl+C to stop."
while true; do
  probe || echo "  (probe failed — the instance may be asleep, retrying next cycle)"
  sleep "$INTERVAL"
done
