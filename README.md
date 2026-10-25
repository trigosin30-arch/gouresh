# Ankit Stationery Mart

A working e-commerce platform for **Ankit Stationery Mart, 147 Moolraj Road, Jalandhar Cantt, Punjab 144005** — a customer storefront plus an access-controlled shop administration panel, on one origin and one database.

It covers four transaction types:

1. **New stationery** — catalogue stock with server-side pricing and stock control.
2. **New books** — the same catalogue, filterable by board, class, subject and book type.
3. **Second-hand books** — customers submit books, staff moderate them, approved books are listed on a moderated marketplace with recorded commission.
4. **Bulk quotations** — schools and offices request a quote, staff price it, the customer accepts, and an administrator converts the accepted quote into an order.

> The storefront never invents business information. Store hours, phone numbers, delivery areas, fees and return windows are shown **only** when the owner has configured them in Admin → Store settings. Anything unset renders as “not configured”, not as a plausible guess.

---

## Stack

| Layer | Choice |
| --- | --- |
| API | FastAPI 0.115, SQLAlchemy 2.0, Pydantic 2, Alembic |
| Database | SQLite for development and tests; PostgreSQL in production (`DATABASE_URL`) |
| Auth | Argon2 password hashing, HttpOnly cookie sessions, CSRF double-submit token |
| Frontend | React 18 + TypeScript + Vite 6 + Tailwind CSS 3, single-page app built to `frontend/dist` |
| Money | Stored as integer paise everywhere; formatted as ₹ in the UI |
| Files | Re-encoded image uploads under `UPLOAD_DIR`, served from `/uploads` |

Everything is served from one FastAPI process in production, so cookies (`SameSite=Lax`), CSRF and SEO stay simple.

```
backend/
  app/            config, models, security, services, routers, seed data, CLI
  alembic/        migration environment + initial revision
  tests/          124 pytest tests (API behaviour, authorization, money, uploads, migrations)
frontend/
  src/            storefront pages, admin pages, shared API client and components
docs/             API, deployment, security, backup & restore
```

---

## What actually works

Verified against a live server with seeded demo data (see [Verification](#verification)):

**Storefront**

- Home page with real catalogue rails, categories, board/class finder and published FAQs.
- Product browse with search, category/board/class/subject/condition filters, price range, sorting and pagination.
- Product pages with stock-aware buttons, wishlist, related items and JSON-LD structured data.
- Guest or signed-in cart, server-recalculated totals, coupon validation, delivery vs pickup choice, and checkout.
- Order confirmation with a private tracking link, order history, cancellation inside the configured window, and return/refund requests.
- Order tracking by secure token, or by order number + email (limited view: no address, no item list).
- Account area: profile, password change, saved addresses, submissions, marketplace listings, commission/sales summary, notifications, deletion request.
- Second-hand marketplace: browse approved listings, report a listing, buy a listing (creates a real order + commission record).
- Sell Your Books: photo upload, condition details, submission reference; nothing is public until moderated.
- Bulk quotation request with line items, then review/accept/decline using the tokenised quotation page and printable document.
- Contact page (messages land in the admin inbox), FAQ, About, policy pages that only state configured facts.
- SEO: per-route titles/descriptions/canonical tags, `sitemap.xml`, `robots.txt`, legacy `.html` URLs 301-redirected to the SPA.

**Admin** (`/admin`, staff or admin session required)

- Dashboard with net revenue definition, order pipeline, payments, catalogue health, marketplace queue and a setup checklist.
- Products: search/filter, create, edit, CSV import (dry-run then commit), CSV export, stock adjustments with inventory movement history.
- Orders: filters, full detail, legal status transitions only, COD collection on delivery, internal notes, invoice/packing-slip documents, refunds and cancellation (admin only), shipment tracking.
- Marketplace: listing moderation, submission review, converting submissions into listings, listing reports.
- Bulk quotations: price line items, validity date, convert accepted quotations into orders.
- Categories, banners and FAQs CRUD; coupon CRUD.
- Customers: search, order history, restrictions (which revoke sessions immediately), role changes (never your own).
- Returns queue, shipment tracking, contact messages, stock overview.
- Commissions and payouts: commission ledger and **recording** of payouts — no money movement.
- Store settings (typed, grouped, audit-logged).
- Audit log with before/after snapshots, and a notification log showing what was actually sent.

**Platform**

- 124 automated tests pass; see the exact command and result below.
- Alembic baseline migration reproduces the full schema; `upgrade head` is idempotent.
- Optional Razorpay integration with signed webhook handling, order signature verification and a payment-pending state that never fakes success.
- Notification fallback that tells the truth: in-app always, email only when SMTP is configured, SMS/WhatsApp explicitly not implemented.

---

## What is *not* implemented, or not verified here

These are deliberate, documented boundaries rather than hidden gaps:

- **SMS and WhatsApp notifications** are not implemented. Those records are stored with status `skipped`.
- **Razorpay has not been exercised against the live gateway** in this environment (no merchant keys). The code paths (create-order, signature confirm, signed webhook, idempotent retry) are covered by tests using locally computed signatures, but a real end-to-end payment has not been run by the author.
- **No payouts are automated.** Commission is an accounting record; selling money is transferred by the store outside the system and then recorded.
- **No email verification flow** is enforced. Password reset links are emailed when SMTP is configured; in development the link is returned in the API response instead.
- **Rate limiting is in-process** (per worker). Behind multiple worker processes or a load balancer, move it to Redis.
- **No analytics, advertising pixels, reviews or ratings** are present — so none can be fabricated.
- **Search is SQL `LIKE`-based**, not a search engine. Fine for a single-store catalogue of this size.
- **The sandbox in which this was built had no PostgreSQL server**, so only SQLite was executed. `DATABASE_URL` + the Alembic baseline are the supported Postgres path; run the test suite against Postgres before a production launch.
- **No Dockerfile/compose** is shipped. Deployment instructions use systemd + nginx (see `docs/DEPLOYMENT.md`).

---

## Quick start (development)

Requirements: Python 3.11+, Node 20+.

```bash
# 1. Python environment
python -m venv .venv
PATH="$PWD/.venv/bin:$PATH" pip install -r backend/requirements.txt

# 2. Demo data (sample inventory, clearly labelled) + a local database
cd backend
DATABASE_URL="sqlite:///$(pwd)/data/asm.db" \
SEED_DEMO=1 \
DEMO_ADMIN_PASSWORD="choose-a-long-password" \
DEMO_CUSTOMER_PASSWORD="choose-a-long-password" \
SECRET_KEY="development-only-secret-key-change-me" \
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

Or just use the wrapper script, which builds the SPA on first run, keeps its demo database in `.demo/` and prints the URLs and demo logins:

```bash
./scripts/serve-demo.sh          # http://127.0.0.1:8000
PORT=3000 ./scripts/serve-demo.sh
```

The API is now on `http://127.0.0.1:8000` and serves the SPA if `frontend/dist` exists. For frontend development with hot reload:

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api and /uploads to :8000
```

`SEED_DEMO=1` creates a demo administrator, customer and seller, 26 sample products, sample listings, FAQs and banners. Every seeded record carries “SAMPLE DATA — demo mode” text, and the storefront shows a demo banner. Demo credentials are the emails `demo.admin@example.com`, `demo.customer@example.com` and `demo.seller@example.com`; passwords come from `DEMO_ADMIN_PASSWORD` / `DEMO_CUSTOMER_PASSWORD`, or are randomly generated and printed once to the server log.

> Never enable `SEED_DEMO` on a live store. Remove or replace demo accounts and records before launch.

### Creating the first real administrator

There is **no default password** in the codebase. Bootstrap an administrator from the server shell:

```bash
cd backend
PATH="../.venv/bin:$PATH" DATABASE_URL="sqlite:///$(pwd)/data/asm.db" \
  python -m app.cli create-admin --email owner@example.com
```

You will be prompted for a password of at least 10 characters. Other CLI commands: `reset-password`, `seed-demo`, `sweep-reservations`, `backup`.

---

## Verification

Run the whole backend suite (SQLite, isolated temp database, no network):

```bash
cd backend
PATH="../.venv/bin:$PATH" python -m pytest tests -q
```

Result of the final run in this repository:

```
124 passed, 1 warning in 19.82s
```

(The single warning is a Starlette/anyio deprecation notice, not a failure.)

Frontend type-check and production build:

```bash
cd frontend
npm run build
```

Result: `tsc -b` clean, Vite build succeeds — `dist/assets/index-*.js` 373.15 kB (gzip 101.51 kB), `AdminApp-*.js` 138.96 kB (gzip 31.03 kB, loaded only on `/admin`), CSS 37.90 kB (gzip 6.77 kB).

A scripted end-to-end walkthrough was also run against a live server with demo data — guest checkout, stock decrement, invoice via tracking token, customer submission, admin product/stock management, the full pickup order lifecycle with COD collection, partial refund, marketplace listing + moderation + purchase + commission + payout, submission conversion, bulk quotation price/accept/convert, restriction enforcement, content CRUD, audit entries and logout. **All 89 checks passed** (run against a fresh database; the script consumes login rate-limit budget, so re-runs need a clean database or a few minutes' pause).

---

## Configuration

Copy `.env.example` and set values in the process environment (systemd `EnvironmentFile=` works well). Key variables:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development` / `production` / `test` |
| `SECRET_KEY` | Required in production; signs session tokens |
| `DATABASE_URL` | SQLite or PostgreSQL DSN |
| `UPLOAD_DIR` | Persistent directory for uploaded images |
| `FRONTEND_DIST` | Path to the compiled SPA |
| `PUBLIC_SITE_URL` | Absolute origin for sitemap/robots |
| `SEED_DEMO` | Demo data on first start — development only |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET` | Online payments; all three required to enable |
| `SMTP_*` | Email delivery; absent means notifications are stored, not emailed |
| `RATE_LIMIT_*`, `STOCK_RESERVATION_MINUTES` | Abuse limits and stock hold duration |

---

## Security summary (and its limits)

Implemented and tested:

- Argon2id password hashing; no plaintext or reversible storage.
- HttpOnly session cookie + non-HttpOnly CSRF cookie, with `X-CSRF-Token` required on every mutating API call (the payment webhook is the only exemption, because it is signature-verified).
- Server-side authorization on every admin route; hiding the UI is never the control.
- Restricted accounts lose staff/admin powers immediately: their sessions are deleted, their carts are discarded, sign-in is refused with an explicit message, and guest replay of an abandoned cart is impossible.
- Role changes cannot target your own account, and the last active administrator cannot be removed.
- All prices, discounts, delivery fees, stock and totals are recalculated on the server at checkout; browser-submitted amounts are ignored.
- Checkout holds stock as a reservation with an expiry; cancellation releases it.
- Uploads are content-type checked, magic-byte verified and **re-encoded** (metadata stripped); filenames are server-generated.
- Audit log with actor, entity and before/after snapshots for administrative actions.
- Security headers plus a Content-Security-Policy, HSTS when cookies are secure.

Residual risks, stated plainly:

- The CSP allows `'unsafe-inline'` for scripts (needed by the Razorpay checkout integration), which weakens XSS protection compared with a nonce-based policy.
- Rate limiting is per process; run one worker or move limits to shared storage.
- No site is “completely secure”. Read `docs/SECURITY.md` for the full threat model before launch.

---

## Hosting

A permanent public URL needs a real host — the coding sandbox behind the preview links is disposable. Three ready paths are documented in [`docs/HOSTING.md`](docs/HOSTING.md):

* **Render (one click, free tier):** the repo ships a `Dockerfile` + `render.yaml` blueprint — <https://render.com/deploy?repo=https://github.com/trigosin30-arch/gouresh>
* **Your own VPS:** `docker compose up -d --build` (Postgres + app + persistent uploads), or systemd/nginx per `docs/DEPLOYMENT.md`.
* **Fly.io:** `fly.toml` included, Mumbai region, `/healthz` health check.

All three run migrations on boot (`alembic upgrade head`). The app accepts `postgres://`, `postgresql://` and `postgresql+psycopg://` URLs, so managed database credentials work as-is.

## Documentation

- [`docs/API.md`](docs/API.md) — endpoint map, conventions, error handling.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — production setup, systemd, nginx, TLS, updates.
- [`docs/SECURITY.md`](docs/SECURITY.md) — controls, authorization matrix, residual risk.
- [`docs/BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) — backups, restore drills, retention.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — day-to-day shop workflows (orders, moderation, quotes, refunds).
- [`docs/HOSTING.md`](docs/HOSTING.md) — getting a permanent public URL (Render / VPS / Fly).

## Licence / ownership

Private project for Ankit Stationery Mart. No third-party branding is used; the interface deliberately avoids imitating marketplace brands.
