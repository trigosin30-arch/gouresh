# Security model

This document states what the platform does, what it does **not** do, and what remains risky. It is not a claim that the site is “completely secure”.

## Assets

1. Customer accounts (password hashes, names, emails, phones, addresses).
2. Orders and payment records (financial data, refunds, COD collection).
3. Second-hand seller submissions (photos, contact details, pickup addresses).
4. Bulk quotation contacts and pricing.
5. Store administration (products, prices, settings, roles, payouts ledger).

## Trust boundaries

```
browser ── HTTPS ── nginx ── FastAPI process ── database
                                    │
                                    └── uploads directory
                                    └── Razorpay (only when configured)
                                    └── SMTP (only when configured)
```

The FastAPI process is the only component that touches the database. The browser is untrusted: every price, discount, stock level, total, role and status is decided server-side.

## Authentication and sessions

* Passwords: **Argon2id** (`argon2-cffi`, memory 64 MB, time cost 2, parallelism 2). Only hashes are stored; there is no recovery of the original password.
* Password policy: at least 10 characters, plus a blocklist of common patterns (`schemas.strong_password`). Passwords are never logged.
* Login: identical response for unknown email and wrong password (no account enumeration); failed attempts are audit-logged and rate-limited (`8 / 5 min` per IP).
* Sessions: random 32-byte token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `SECURE_COOKIES=1`). Only the SHA-256 of the token is stored in `sessions`. Default lifetime 14 days (`SESSION_TTL_HOURS`).
* Logout revokes the session row and clears the session cookie.
* Restricting an account (`status=restricted`) deletes its sessions, discards its carts, refuses new sign-ins with an explicit “account is restricted” message, and blocks every authenticated endpoint (`require_user` re-checks the status on each request). Guest checkout cannot be used to continue the same order because the cart row is gone.
* Password reset: single-use token, hashed at rest, 30-minute expiry. In non-production the API also returns the link because no mailbox is reachable.

## CSRF

Double-submit token:

* `asm_csrf` is a random, readable cookie issued on the first GET.
* Every mutating `/api/**` request must send `X-CSRF-Token` equal to that cookie (constant-time comparison).
* `SameSite=Lax` stops cross-site POSTs from carrying the session cookie in the first place.
* The Razorpay webhook (`POST /api/payments/webhook`) is the only exemption, and it is authenticated by an HMAC-SHA256 signature over the raw body using `RAZORPAY_WEBHOOK_SECRET`, compared in constant time.

## Authorization matrix

| Capability | Guest | Customer | Staff | Admin |
| --- | --- | --- | --- | --- |
| Browse catalogue, listings, policies | ✓ | ✓ | ✓ | ✓ |
| Cart, checkout, COD/pickup order | ✓ | ✓ | ✓ | ✓ |
| Own orders/returns/notifications | – | ✓ | ✓ | ✓ |
| Submit used book / create listing | – | ✓ | ✓ | ✓ |
| Read admin dashboard, orders, products, customers | – | – | ✓ | ✓ |
| Adjust stock, fulfil orders, moderate listings, price quotations, review submissions | – | – | ✓ | ✓ |
| Create/edit/delete products, categories, banners, FAQs, coupons | – | – | – | ✓ |
| Change store settings | – | – | – | ✓ |
| Refund, cancel on behalf of customer, complete returns | – | – | – | ✓ |
| Convert accepted quotation into an order | – | – | – | ✓ |
| Change roles / restrict accounts / record payouts | – | – | – | ✓ |

Enforcement lives in `app/security.py` (`require_user`, `require_staff`, `require_admin`) and is applied per route; hiding UI is never the control. Restricted accounts are rejected even if they hold a staff role.

Guards against lockout: you cannot change your own role or restrict your own account, and the last active administrator cannot be demoted or restricted.

## Commerce integrity

* Prices, compare-at discounts, delivery fees, tax and totals are computed from database rows in `services/commerce.py`; submitted amounts are ignored.
* Stock is committed with a conditional `UPDATE … WHERE stock_qty >= quantity`, so two simultaneous checkouts cannot oversell the last unit (covered by a concurrent test).
* Checkout creates short-lived reservations (default 30 minutes); a sweeper releases expired holds every 60 seconds.
* Cancelling an order releases committed stock back to the catalogue.
* A product that appears in past orders is archived rather than deleted, so order history and invoices never break.
* Coupons are validated server-side (active flag, window, minimum order, total and per-user limits) and can never be applied by sending a discount amount.
* Marketplace commission is calculated once at purchase time and stored with the rate applied. Later rate changes do not rewrite history.
* Payout recording is bounded by outstanding proceeds. **Nothing in the platform transfers money.**

## Order status integrity

Transitions are an explicit allow-list (`constants.ORDER_TRANSITIONS`). Illegal jumps return `409`; cancelled and returned orders are terminal. `delivered` can only be set by authorised staff through the admin API, and it is what marks cash-on-delivery money as collected. Customers can cancel only inside the configured window and only before dispatch.

## Uploads

* Allow-list of MIME types (`image/jpeg|png|webp`) **and** extensions.
* Size is enforced while reading (`MAX_UPLOAD_BYTES`, default 4 MB), not from `Content-Length`.
* Magic bytes are verified with Pillow (`verify()`), then the image is re-encoded to a normalised JPEG — embedded scripts, SVG payloads and EXIF metadata do not survive.
* Stored filenames are server-generated UUIDs inside dedicated subdirectories.
* `/uploads` is a static mount; directory traversal attempts return 404. nginx `alias` configuration in the deployment guide preserves the same restriction.

## Privacy

* Customers can see only their own orders, returns, addresses, submissions and notifications.
* Order lookup by ID alone is refused (`404`); a random tracking token or the order number **and** email are required. The number+email path deliberately omits the item list, address and full email.
* Seller identity on public listings is a display label only; emails and phone numbers are never rendered.
* The admin customer view exposes city/PIN and order history, never passwords or payment credentials.
* Account deletion requests restrict the account and notify staff; order records are retained as required for accounting.
* No advertising/analytics cookies or third-party trackers are present.

## Transport and browser hardening

Set by middleware on every response:

* `X-Content-Type-Options: nosniff`
* `X-Frame-Options: SAMEORIGIN`
* `Referrer-Policy: strict-origin-when-cross-origin`
* `Permissions-Policy: camera=(), microphone=(), geolocation=()`
* `Content-Security-Policy` restricting default/script/connect/frame sources; Razorpay domains are allowed only for the payment flow
* `Strict-Transport-Security` when secure cookies are enabled
* `Cache-Control: no-store` on `/api/**` responses

## Auditing

Administrative actions (product, order, refund, setting, role, moderation, payout, quotation conversion, login) are written to `audit_logs` with actor email, entity, IP and before/after snapshots. Notification delivery records store the provider and the real outcome (`sent`, `skipped`, `failed`).

## Residual risks — read before launch

1. **CSP allows inline scripts.** The Razorpay checkout integration and the Vite development flow require `script-src 'unsafe-inline'`. This weakens defence-in-depth against injected scripts. If online payments are not used, tighten the policy to drop `'unsafe-inline'` and Razorpay domains.
2. **Rate limiting is in-process.** It resets on restart and is per worker/instance. Use one worker or move limits to Redis.
3. **No email verification or 2FA.** Account takeover by email compromise is possible; staff accounts should use long unique passwords, and the owner should consider putting `/admin` behind an IP allow-list or VPN.
4. **Payment flow not exercised against the live gateway.** Signature verification and idempotency are unit-tested with locally computed signatures, but a real Razorpay transaction has not been run here. Test in the gateway's test mode before enabling.
5. **No automated payout transfer.** Refund money movement is performed by staff outside the system. A recorded refund is an accounting entry, which is why the UI says so explicitly.
6. **SQLite in production** would serialize writes and lack network backups. Use PostgreSQL for a busy store.
7. **No antivirus scanning on uploads.** Re-encoding defeats script payloads, but image-parser vulnerabilities remain a general risk; keep Pillow patched.
8. **Backups are only as good as their restore drill.** See `docs/BACKUP_RESTORE.md`.
9. **Staff trust.** Staff can read customer contact data to fulfil orders. Restrict the role, review the audit log, and revoke accounts when people leave.

## Incident response (short version)

1. If credentials may be compromised: rotate `SECRET_KEY` (invalidates all sessions when combined with clearing `sessions`), reset the affected passwords, review `audit_logs`.
2. If the payment webhook secret leaks: rotate it in the gateway and environment, then restart.
3. If malicious uploads are suspected: disable the affected listing/product, inspect `UPLOAD_DIR`, keep backups before deleting evidence.
4. If a data breach occurs, follow applicable Indian notification obligations; retain logs.
