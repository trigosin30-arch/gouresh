# Architecture & Security Notes

## Decisions
- **Empty repo → new stack.** Node 22 + Express + built-in `node:sqlite`: relational transactions, zero native dependencies (no build failures), file persistence. Vanilla SPA frontend: no bundler to break; all security/business logic is server-side.
- **Two commerce systems, one data model, clear separation:** `products`+`stock_movements` = store-owned inventory; `listings`+`settlements` = customer-owned marketplace. `order_items.kind` distinguishes them in every order/report; used books are never counted as store stock. Order items snapshot title, price, `commission_rule`, commission and seller proceeds at purchase time.
- **Concurrency:** SQLite WAL + `busy_timeout`; checkout runs in `BEGIN IMMEDIATE`; store stock uses `UPDATE … WHERE stock>=qty`; listings use `UPDATE … WHERE status='active'` — both checked via `changes`, so concurrent buyers cannot oversell or double-buy a single copy. Idempotency key on orders prevents duplicate creation.
- **Lifecycle enforcement:** order transitions and listing states validated server-side (`util.ORDER_TRANSITIONS`); delivery creates settlements & marks listings sold; cancel/refund restores stock and releases listings.
- **RBAC:** permission matrix in `auth.js`, checked per-route with `requirePerm`. Owner-only: staff management. Finance-only: commissions, settlements, payment status. Frontend hides links as UX only.

## Threat model (controls in place)
Password guessing (scrypt + rate limits), session theft (httpOnly, hashed tokens, 7-day expiry), CSRF (per-session token; guest token via hashed cookie), IDOR (ownership predicates on every customer query; guest tracking needs phone match), price/stock tampering (server recalculation; negative/oversell blocked by CHECK constraints + atomic updates), promo abuse (server validation of dates/limits/minimums), XSS (output escaping everywhere user data renders; no raw HTML injection of user content), upload abuse (type allowlist + magic bytes + 2 MB + random filenames), spam (honeypot + rate limits), audit (inventory/orders/refunds/commission/roles/settings; secrets never logged).

## Remaining risks & production hardening
Run behind HTTPS (set secure cookies at the reverse proxy), schedule DB backups, rotate the demo accounts out, add a WAF/rate-limit at the edge, externalise uploads to object storage, move sessions to the DB already done (multi-instance = move SQLite→Postgres keeping same SQL shapes), add monitoring/alerts, and integrate payments/email with server-side webhook/signature verification before enabling their settings flags. No honest system claims to be unhackable or uncopyable; the defence is server-side logic, least privilege, and these controls.
