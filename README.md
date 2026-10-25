# Ankit Stationery Mart (ASM)

An online storefront and shop-counter admin for **Ankit Stationery Mart, Shimla** — built around one
promise: *a customer can find a product, pay for it, and the shop can fulfil it without losing track of
stock or money.*

The core purchase flow works end to end today, on SQLite locally and on Supabase/Postgres in the cloud,
with Razorpay verification that can be demonstrated without live keys.

```
React + TypeScript + Vite  ──►  FastAPI  ──►  SQLite (local) / Supabase Postgres (cloud)
                                   │
                                   ├── Razorpay orders + signature verification (browser AND webhook)
                                   └── Supabase Auth (Google OAuth) or demo passwordless sign-in
```

---

## 1. Repository audit (done before writing code)

The plan assumed an existing React + FastAPI codebase to extend. **The repository contained only a
10-byte placeholder README** — no frontend, backend, database or history to preserve. The migration
decision therefore collapsed to the simple case:

* one database (Postgres in the cloud, SQLite locally) — no second source of truth;
* one backend that owns all money/stock/payment logic;
* the frontend never sends prices, totals, roles or payment statuses that the backend trusts.

Everything below is new code, arranged so the Supabase/Razorpay stages in the plan slot in without a
rewrite.

---

## 2. What works right now

| Area | State |
| --- | --- |
| Storefront (home, shop, product detail, cart) | ✅ responsive, search/filter/sort, generated product art (no image CDN required) |
| Server-authoritative pricing, coupons, shipping | ✅ totals recomputed on every quote and order |
| Stock reservation, release on cancel/failure, audit trail | ✅ conditional `UPDATE` so the last unit cannot be double-sold |
| Checkout: online (Razorpay), COD, store pickup | ✅ all three methods |
| Razorpay signature verification + webhooks (idempotent) | ✅ testable in mock mode; live keys just work |
| Accounts, saved addresses, order history, tracking timeline | ✅ protected server-side |
| Admin: products, stock, orders/fulfilment, customers/roles, audit log | ✅ |
| Google sign-in via Supabase | ⚙️ code path ready; needs a Supabase project + Google OAuth credentials |
| Subscriptions / membership | ⛔ deliberately deferred (no product defined — see plan §7) |
| Email/SMS notifications, courier API integration | ⛔ not built (tracking numbers are entered by staff) |

Demo sign-in is enabled because no Supabase project is connected yet: any email signs in without a
password, and `owner@ankitstationery.in` is seeded as the shop admin. **Set `DEV_AUTH=false` in
production** or the whole storefront is password-less.

---

## 3. Quick start

Requires Python 3.11+ and Node 20+.

```bash
# both servers, one command (creates .venv and node_modules on first run)
./scripts/dev.sh
# storefront  http://localhost:5173
# API docs    http://localhost:8000/docs
```

Or run them separately:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd backend && ../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

The database file `backend/asm_dev.db` is created and seeded automatically on first boot with
6 categories, 24 products, 3 coupons and the owner account. Delete the file to reseed.

### Demo walkthrough (5 minutes)

1. **Browse** — search “class 10”, filter by class/board/price on `/shop`.
2. **Cart** — apply `ASM10` (10% off above ₹499) or `SHIMLA50` (₹50 off above ₹999); totals come from the API.
3. **Checkout** — sign in as `owner@ankitstationery.in` (admin) or any other email (customer); add an address.
4. **Pay** — choose *Pay online*. With no Razorpay keys the demo panel appears: **Pay successfully** runs the
   real signature check and confirms the order; **Simulate a failed payment** releases the reserved stock.
5. **Track** — the order page shows the timeline. As an admin, open `/admin/orders/<number>` and move it
   through processing → packed → shipped → out for delivery → delivered, adding a courier and tracking number.
   Try an illegal jump (confirmed → delivered): the API refuses it.
6. **Prove idempotency** — on a paid order, press *Replay a signed webhook twice*: first delivery confirms,
   second is reported as `duplicate` and changes nothing. `/admin/activity` shows the recorded events.
7. **Admin stock** — `/admin/products` quick-adjust stock; every movement lands in `inventory_movements`
   and every product/order/role change lands in `admin_audit_logs`.

---

## 4. Project layout

```
backend/
  app/
    main.py            app factory, CORS (incl. preview hosts), health, security headers
    config.py          all settings, public-config projection (no secrets leak)
    db.py models.py    SQLAlchemy models (portable SQLite ↔ Postgres)
    auth.py            Supabase JWT verification + demo tokens; role from DB only
    payments.py        Razorpay orders, HMAC signing/verification, mock provider
    services/orders.py pricing, stock reservation/release, payment confirmation,
                       webhook idempotency, status-transition rules
    routers/           catalog.py · account.py · orders.py · admin.py
    seed.py            idempotent demo catalogue
  tests/               38 pytest tests over the whole purchase flow
frontend/
  src/lib/             api client, auth (Supabase/demo), cart, toasts, formatting
  src/components/      layout, product cards, generated artwork, payment modal
  src/pages/           storefront pages + /admin/* dashboard (lazy-loaded)
supabase/migrations/
  0001_schema.sql      Postgres schema = ORM, constraints for totals/payments/stock
  0002_rls.sql         RLS: customers see only their own rows; catalogue read-only
render.yaml            backend + static storefront blueprint
scripts/dev.sh         run both servers
```

---

## 5. The parts that matter

### Prices and stock are decided by the server
`POST /api/orders` accepts **product ids and quantities only**. Every line is repriced from the database,
coupons are re-evaluated, shipping is derived from the configured threshold, and the final
`subtotal − discount + shipping = total` is written to the order. The browser can display an estimate,
but it cannot influence what is charged.

Stock is taken with a conditional statement inside the order transaction:

```sql
UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty;
```

If `rowcount != 1`, the order fails with a 409 and nothing is written. Failures, cancellations and expiry
release stock exactly once (`orders.stock_released`), and every change is logged with a reason.

### A redirect is not a payment
There are two entry points to “paid”, and both verify a signature first:

1. **Browser callback** → `POST /api/payments/verify` recomputes `HMAC_SHA256(order_id|payment_id, key_secret)`
   and compares it in constant time. A forged signature marks the attempt failed and never confirms the order.
2. **Webhook** → `POST /api/webhooks/razorpay` checks `X-Razorpay-Signature` against the raw request body,
   then inserts into `payment_events`, whose unique `event_id` makes repeat deliveries a no-op.

Both paths converge on one idempotent function, so a callback and a webhook arriving together cannot
double-confirm or double-count a sale.

### Authorisation comes from the database
`profiles.role` is the only source of truth. A token's metadata is used for display name/avatar only;
new accounts are always created as `customer`. Admin routes require `staff`/`admin`. Order detail returns
**404 (not 403)** for other people's orders so order numbers cannot be enumerated.

### Status transitions are explicit
`payment_pending → confirmed → processing → packed → shipped → out_for_delivery → delivered`, with
`cancelled`, `payment_failed` and `refunded` handled separately and validated server-side. Customers can
cancel only before dispatch; every change writes an `order_status_events` row that powers the tracking UI.

---

## 6. Configuration

Copy `backend/.env.example` to `backend/.env` (or set the variables in your host's dashboard).
All amounts are integer paise.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `sqlite:///./asm_dev.db` locally; Supabase connection string in the cloud |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | enable Supabase Auth; blank = demo sign-in |
| `SUPABASE_JWT_SECRET` | project JWT secret (blank → verify via project JWKS) |
| `DEV_AUTH`, `DEV_JWT_SECRET` | password-less demo login; **disable in production** |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | live/test payments; blank = mock mode |
| `FREE_SHIPPING_THRESHOLD_PAISE`, `SHIPPING_FEE_PAISE`, `COD_ENABLED`, `PICKUP_ENABLED` | business rules |
| `CORS_ORIGINS` | production frontend origins (preview hosts allowed separately) |

`GET /api/config` exposes only what the UI needs — store details, auth provider, payment *mode* and the
public key id. Secrets never leave the server. `GET /api/health` reports database/auth/payments status
for uptime checks.

---

## 7. Moving to Supabase

1. Create a project and copy the connection string into `DATABASE_URL`
   (`postgresql+psycopg2://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`).
2. Run the migrations in the SQL editor (or `supabase db push`): `0001_schema.sql`, then `0002_rls.sql`.
   They are idempotent; the app can also create tables itself, after which you only need the RLS file.
3. **Authentication → Providers → Google**: add your OAuth client id/secret and set the redirect URL to
   `https://<project>.supabase.co/auth/v1/callback`. Add your deployed storefront origin to
   *Authentication → URL Configuration*.
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` and **`DEV_AUTH=false`**, then restart.
   The sign-in page switches to “Continue with Google” automatically.
5. Optional: point `products.image_url` at Supabase Storage public URLs — the storefront prefers real
   images and falls back to generated artwork.

Notes on the schema: ids are `text` UUIDs so the same ORM code works on SQLite and Postgres; money is
`integer`; constraints enforce `total = subtotal − discount + shipping`, `line_total = unit_price × quantity`,
`stock >= 0`, unique payment references, unique webhook `event_id`, and “paid ⇒ paid_at is set”.

---

## 8. Razorpay

* Test or live keys go in `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`; set `PAYMENTS_MOCK=false`.
* Add a webhook pointing at `https://<api-host>/api/webhooks/razorpay` with the events
  `payment.captured`, `payment.failed` and `order.paid`, using `RAZORPAY_WEBHOOK_SECRET`.
* The storefront loads Razorpay's hosted checkout when `key_id` is present and posts the callback to
  `/api/payments/verify`. With no keys, the in-app demo panel is used instead — same verification code path.
* Refunds are recorded as order status `refunded` / payment status `refund_due`. Triggering the actual
  Razorpay refund API is a deliberate manual step in this MVP so money movement stays a human decision.

---

## 9. Deployment

`render.yaml` describes both services:

* **asm-api** — Python web service, `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check
  `/api/health`. Set the Supabase/Razorpay secrets in the dashboard, `SEED_ON_STARTUP=false`,
  `DEV_AUTH=false`, `ALLOW_PREVIEW_ORIGINS=false`, `CORS_ORIGINS=https://your-storefront`.
* **asm-storefront** — static build of `frontend`, SPA rewrite to `/index.html`, with
  `VITE_API_BASE_URL=https://asm-api.onrender.com`.

Free-tier realities to plan for: Render free web services sleep after inactivity (first request is slow —
mitigate with a paid instance or a scheduled ping), Supabase free projects pause after inactivity and have
quota/backup limits, and the API uses no local filesystem storage (uploads belong in Supabase Storage).

---

## 10. Tests

```bash
cd backend && ../.venv/bin/python -m pytest tests -q     # 38 tests
cd frontend && npm run typecheck && npm run build
```

The suite covers: catalogue search/filters, server pricing with a tampered client price, stock decrement
and release, out-of-stock and quantity limits, coupon thresholds, free-shipping threshold, successful and
forged signatures, cross-customer payment/order access, payment failure, webhook signature + idempotency,
illegal status transitions, cancel-restock-once, admin product/stock/archive/audit, role escalation
attempts, profile/address validation, order history across sessions, last-unit races (a second buyer gets
a 409, never an oversold shelf), refund-due → refunded, pickup without an address, archived-product
rejection, and rejecting a paid-refund attempt on an unpaid COD order.

---

## 11. Security checklist

- [x] Secrets only on the server; `/api/config` is a safe projection
- [x] Prices, discounts, shipping and roles never trusted from the client
- [x] HMAC verification (constant-time) on browser callbacks **and** webhooks
- [x] Unique webhook event ids → duplicate deliveries cannot duplicate orders/stock
- [x] Stock changes are transactional, conditional, and audited
- [x] Customers can read only their own profile, addresses, orders and payments (RLS + API checks)
- [x] Admin actions recorded in `admin_audit_logs`
- [x] Input validation on phone/PIN/quantity/price; SQL injection avoided via the ORM
- [ ] Rate limiting / bot protection on sign-in and order creation (use a reverse proxy or hosted WAF)
- [ ] Automated backups + a restore drill (Supabase paid tier / `pg_dump` schedule)
- [ ] Email/SMS notifications and error monitoring (Sentry) before real customers
- [ ] Real Razorpay account approval, refund automation and reconciliation reports

---

## 12. Roadmap mapping

| Plan stage | Status |
| --- | --- |
| 1 Foundation & UI | ✅ done — storefront, responsive layout, server-authoritative cart |
| 2 Catalogue, search, admin | ✅ done — 24 seeded products, filters, stock + audit |
| 3 Google auth & profiles | ⚙️ profiles/addresses/protection done; Supabase project + OAuth credentials pending |
| 4 Cart, delivery, payments | ✅ done — orders, stock, Razorpay (mock/live), webhooks |
| 5 Order history & tracking | ✅ done — timeline, fulfilment controls, cancellations/restocks |
| 6 Deployment & security testing | ⚙️ blueprint + tests done; needs a hosted environment, secrets, backups |
| Subscriptions | ⛔ intentionally out of scope until a membership product exists |

### Known limitations (deliberate, for the demo)
* Product photography is generated artwork; no real images are bundled.
* No email/SMS/WhatsApp notifications, no courier API, no GST invoice PDF.
* Payment refunds are recorded, not executed against Razorpay.
* SQLite is used locally; concurrency correctness is enforced by conditional updates, and Postgres is the
  intended production database.
* Demo sign-in is password-less by design and must be switched off for production.
* Unpaid Razorpay orders keep their reserved stock until a customer cancels or staff cancel them; add a
  scheduled job calling the cancellation path (or Razorpay order expiry webhooks) if abandonment becomes a
  problem at scale.
* No email/SMS notifications, no automatic courier tracking sync, and no scheduled database backups yet.
