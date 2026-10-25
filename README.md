# Ankit Stationery Mart — Store, Bookstore & Second-Hand Book Marketplace

A complete, working e-commerce web application for **Ankit Stationery Mart, 147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India** — direct retail of stationery/books **plus** a moderated customer-to-customer used-book marketplace with a transparent, configurable commission. Real SQLite persistence, real cart/orders/inventory, role-based admin. No fake buttons, no mock data pretending to be real.

## Stack (and why)
| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node 22 + Express 4 | Small, proven, server-side business logic |
| Database | **Built-in `node:sqlite`** (file `data/ankit.db`, WAL, FK on) | Real relational transactions with zero native-build risk; survives restarts |
| Auth | scrypt password hashing, server-side sessions (SHA-256 token hashes), httpOnly cookies, per-session CSRF, rate limiting | No plaintext anything; no secrets in the frontend |
| Frontend | Vanilla-JS SPA (`public/`) — no build step | Nothing to break in CI; fast, accessible, mobile-first |
| Money | Integer **paise** everywhere; totals **recalculated server-side** | No float errors; browser-sent totals are ignored |

## Run it
```bash
npm install
npm run seed:demo     # ⚠️ optional, clearly-labelled DEMO data for evaluation only
npm start             # http://localhost:3000
npm test              # 9 end-to-end acceptance tests (throwaway DB)
```
**Production first run (no demo data):**
```bash
OWNER_EMAIL=you@shop.in OWNER_NAME="Store Owner" OWNER_PASSWORD='a-strong-passphrase' npm run init:owner
```
**Demo logins** (delete/disable before launch): `demo@example.com` (owner), `Aarav@example.com` (customer), `Meera@example.com` (seller) — password `Demo@1234`. Promo code: `SCHOOL10`.

## What works (verified by tests)
- **Storefront:** faceted search (title/author/ISBN/board/class/subject/language/brand/price, spelling-tolerant fallback, suggestions, recent searches), categories, product pages (specs, stock, reviews, related items, cheaper used copies), honest out-of-stock + restock requests.
- **Cart/checkout:** persistent guest + account carts (merged on login), server quote, promo validation (expiry/limits/minimums enforced server-side), delivery-PIN validation, configurable fees, COD / Pay-at-Store, idempotent order placement, **`BEGIN IMMEDIATE` transactions + atomic stock guard — overselling is impossible**.
- **Orders:** enforced lifecycle `pending → confirmed → processing → ready_for_pickup/shipped → delivered` (+ cancel/return/refund), stock restoration, status history, printable invoice, reorder, guest tracking (requires matching phone — no IDOR).
- **Marketplace:** seller listings with condition/defect disclosure & photo upload (magic-byte validated) → moderation queue → single-copy reservation (exactly one buyer wins) → **commission rule snapshotted into every sale** (default 10%, % or fixed, admin-configurable, finance-role only, audit-logged) → settlement tracking (pending → paid/disputed) → reports & moderation. Seller contact details are never published.
- **Admin:** live-DB overview (honest zeros on a fresh install; gross vs store sales vs marketplace gross vs commission clearly separated), products + bulk import/export, inventory ledger, suppliers & purchase orders (receiving adds stock), orders, customers (no password viewing; staff-assisted reset links), promotions, support/reviews, reports CSV, staff roles (**owner/admin/inventory/fulfilment/support/moderator/readonly**, least-privilege, enforced server-side on every route), store settings (address, hours, PINs, fees, payments, policies, FAQ, hero — nothing hard-coded), audit log.
- **Security:** scrypt, hashed session tokens, CSRF on all mutations, IDOR-safe ownership checks, input cleaning + output escaping, upload validation, auth rate limits, security headers, privacy-conscious audit logs (never passwords/tokens), production-safe error messages. No system is "impossible to compromise" — see `docs/ARCHITECTURE.md` for risks & hardening.

## Deliberately NOT faked (need credentials / decisions)
- **Online payments:** disabled until a gateway (merchant ID + webhook secret) is configured server-side; the UI says so. COD/Pay-at-Store are fully real.
- **Email/SMS/WhatsApp:** customers get **in-app notifications**; external sending needs provider credentials. Password recovery is staff-assisted (one-time reset link from Admin → Customers) until email is configured.
- **Seller payouts:** settlements are recorded and marked paid by staff — no pretend escrow/auto-payout.
- **Courier tracking:** shown only when staff enter a genuine reference.
- Optional later: product variants, meilisearch-grade fuzzy search, image resizing/CDN, async job queue, GST invoice numbering — designed for, not required by the core release.

## Project layout
```
src/db.js       schema + migrations + defaults (settings, boards/classes, commission)
src/auth.js     hashing, sessions, CSRF, permission matrix, rate limiter
src/server.js   all API routes (public, customer, marketplace, admin), SEO, invoice
src/util.js     money/audit/notifications/lifecycle maps
public/         index.html, css/app.css, js/app.js (storefront), js/admin.js (admin)
scripts/        seed-demo.js (labelled demo data), init-owner.js (production owner)
test/api.test.js  acceptance tests ·  docs/ARCHITECTURE.md  design & security notes
```

## Backup
Copy `data/ankit.db` (plus `-wal`, or run `sqlite3 … .backup`) on a schedule; restore = put the file back and restart. Environment: `PORT`, `DB_PATH`, `OWNER_*` (see `.env.example`).
