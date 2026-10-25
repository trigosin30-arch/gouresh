# API reference

Base URL: the same origin as the storefront (e.g. `https://shop.example.com`).
Interactive docs: `/api/docs` (Swagger UI), `/api/redoc`, schema at `/api/openapi.json`.

All amounts are **integer paise** (`₹1.00 = 100`). All timestamps are ISO-8601 UTC.
Responses are JSON unless noted; `204` is never used, so a body is always present.

## Conventions

### Authentication

Two cookies are used:

| Cookie | Flags | Purpose |
| --- | --- | --- |
| `asm_session` | `HttpOnly`, `SameSite=Lax`, `Secure` when configured | Session identifier (random token; only its SHA-256 is stored server-side) |
| `asm_csrf` | readable by JS, `SameSite=Lax`, `Secure` when configured | CSRF token for the double-submit check |

**Google sign-in** accepts the ID token (JWT) issued by Google Identity Services in the browser and verifies it on the server: signature against Google's certificates, `iss`, `aud` (= `GOOGLE_CLIENT_ID`), expiry (10 s skew), `email_verified`, and optionally `hd` when `GOOGLE_HOSTED_DOMAIN` is set. The verified `sub` is stored on the user, never in the cookie, and `role` is never taken from the token. Accounts created this way have no password (`has_password: false`) and can set one from the account page without supplying a current password.

Restricted accounts are refused at sign-in (`403`) and every authenticated route re-checks the account status, so an old cookie cannot outlive a restriction.

Every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/**` must send an `X-CSRF-Token` header whose value equals the `asm_csrf` cookie. A first `GET` (the SPA calls `GET /api/store/bootstrap`) issues the cookie.

`POST /api/payments/webhook` is the only CSRF exemption; it is authenticated by the Razorpay HMAC signature instead.

### Errors

```json
{ "detail": "Human readable message" }
```

Validation errors use FastAPI's standard array form under `detail`, where each entry has `loc` and `msg`; the frontend surfaces the first one with its field name.

| Status | Meaning |
| --- | --- |
| `400` | Invalid input or a business rule failed (e.g. invalid coupon, bad transition) |
| `401` | No valid session |
| `403` | Authenticated but not permitted (role, restricted account, CSRF) |
| `404` | Not found, or deliberately hidden from this viewer |
| `409` | Conflict: illegal order transition, insufficient stock, duplicate SKU/code |
| `413` | Upload too large |
| `429` | Rate limit exceeded |

### Pagination

List endpoints accepting `page` and `per_page` return `page`, `pages` and (where relevant) `total`.

### Rate limits

Per client IP and per route family, in-process: login `8/300s`, public writes `20/600s`, checkout `12/600s`, plus tighter limits on password reset, tracking, purchases, uploads and reviews.

---

## Public storefront

### Store content

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/store/bootstrap` | Settings, categories, session user, cart/wishlist/notification counts, demo flag. Sets the CSRF cookie. |
| `GET` | `/api/store/categories` | Active categories with product counts |
| `GET` | `/api/store/banners` | Active, in-window home banners |
| `GET` | `/api/store/faqs` | Published FAQs grouped by category |
| `GET` | `/api/store/home` | Home payload: settings, banners, categories, featured/new/bestsellers, listings, board index |
| `GET` | `/api/store/delivery-check?pincode=` | Whether delivery is configured for that PIN |
| `GET` | `/api/store/policies` | Only configured policy facts (notes, windows, fees, flags) |

### Catalogue

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/products` | `q`, `category`, `board`, `class_level`, `subject`, `condition`, `product_type`, `book_type`, `min_price`/`max_price` (paise), `in_stock`, `sort`, `page`, `per_page` |
| `GET` | `/api/products/filters` | Facet values and counts for the filter UI |
| `GET` | `/api/products/suggest?q=` | Type-ahead suggestions |
| `GET` | `/api/products/{slug}` | Detail with availability, delivery rules, policies, related items |
| `GET` | `/api/book-lists` | Board → class → subject → items availability map |

### Cart and checkout

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/cart` | Optional `fulfillment_type` and `coupon`; always reprices on the server |
| `POST` | `/api/cart/items` | `{product_id, quantity}`; refuses unavailable stock and enquiry-only items |
| `DELETE` | `/api/cart/items/{product_id}` | Remove a line |
| `DELETE` | `/api/cart` | Empty the cart |
| `POST` | `/api/cart/merge` | Merge a guest cart after sign-in |
| `GET`/`POST`/`DELETE` | `/api/wishlist[/{product_id}]` | Signed-in only |
| `POST` | `/api/checkout` | Creates the order; reserves stock; returns `{order, requires_payment}` |

Checkout body:

```json
{
  "fulfillment_type": "pickup",
  "payment_method": "cod",
  "customer_name": "Asha Kumar",
  "customer_phone": "9876543210",
  "customer_email": "asha@example.com",
  "address": { "label": "Home", "full_name": "Asha Kumar", "phone": "9876543210",
               "line1": "12 Model Town", "line2": null, "locality": "Cantt",
               "city": "Jalandhar", "state": "Punjab", "pincode": "144005", "is_default": true },
  "save_address": false,
  "coupon_code": null,
  "customer_note": null
}
```

`fulfillment_type=delivery` requires an address inside a configured PIN code. `payment_method=online` is only accepted when the gateway is configured; otherwise the API answers with an explicit “not configured” message.

### Orders, tracking, notifications

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/orders` | user | Paginated own orders |
| `GET` | `/api/orders/{id}` | owner or `?token=` | Full detail for the owner; tracking token grants the same payload |
| `POST` | `/api/orders/{id}/cancel` | owner | Only inside the configured cancellation window and allowed statuses |
| `POST` | `/api/orders/{id}/return-request` | owner | `{request_type: cancellation|return|refund, reason}` |
| `GET` | `/api/me/returns` | user | Own requests |
| `GET` | `/api/orders/{id}/document?kind=invoice` | owner/staff/`?token=` | HTML invoice or `packing-slip` |
| `GET` | `/api/track?token=…` | public | Full status view for the token holder |
| `GET` | `/api/track?order_number=…&email=…` | public | Limited view: no items, masked email, no address |
| `GET` | `/api/me/notifications` | user | In-app notifications |
| `POST` | `/api/me/notifications/read` | user | Mark all read |

### Second-hand marketplace

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/listings` | public | Approved listings only; filters and pagination |
| `GET` | `/api/listings/{id-or-code}` | public/owner/staff | Non-active listings are hidden from strangers |
| `POST` | `/api/listings/{id}/report` | public | Creates a moderation report |
| `POST` | `/api/listings/{id}/purchase` | user | Creates a marketplace order and a commission record |
| `GET` | `/api/me/listings` | user | Own listings |
| `POST` | `/api/me/listings` | user | Requires at least one uploaded photo; starts `pending_review` |
| `PUT` | `/api/me/listings/{id}` | owner | Edits return the listing to moderation |
| `POST` | `/api/me/listings/{id}/withdraw` | owner | |
| `GET` | `/api/me/marketplace-sales` | user | Commission ledger totals and note |
| `POST` | `/api/submissions` | optional user | Used-book submission with `photo_urls` |
| `GET` | `/api/me/submissions` | user | Own submissions |
| `GET` | `/api/submissions/{reference}` | public-ish | Lookup by reference |

### Bulk quotations

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/quotations` | Creates a request; returns `access_token` and `status_url`. This is **not** an order. |
| `GET` | `/api/quotations/{reference}?token=` | View request/quotation |
| `POST` | `/api/quotations/{reference}/accept?token=` | Only a priced, unexpired quotation |
| `POST` | `/api/quotations/{reference}/decline?token=` | |
| `GET` | `/api/quotations/{reference}/document?token=` | Printable HTML quotation |
| `GET` | `/api/quotations?reference=&email=` | Find a quotation with reference + email |
| `GET` | `/api/me/quotations` | Signed-in user's requests |

### Accounts

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Creates a customer account and session |
| `POST` | `/api/auth/login` / `POST /api/auth/logout` | Session lifecycle |
| `GET` | `/api/auth/providers` | Whether Google sign-in is configured; returns the public client id |
| `POST` | `/api/auth/google` | Sign in or register with a Google ID token (verified server-side). Returns `created`/`linked` |
| `POST` | `/api/auth/google/link` | Attach a Google account to the signed-in account |
| `GET` | `/api/auth/me` | Session user or `{user: null}` |
| `POST` | `/api/auth/profile` | Name and phone |
| `POST` | `/api/auth/change-password` | Requires the current password |
| `POST` | `/api/auth/forgot-password` | Always the same response; in non-production also returns `dev_reset_link` |
| `POST` | `/api/auth/reset-password` | Single-use, 30-minute token |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/auth/addresses[/{id}]` | Up to 10 addresses |
| `POST` | `/api/auth/delete-request` | Records a deletion request and restricts the account |

### Payments

Online payment is disabled unless all three Razorpay secrets are configured; `GET /api/store/bootstrap` reports the available methods and the checkout button only offers what is actually usable.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/payments/status` | Whether online payment is configured *and* enabled; lists usable methods. No secrets (the publishable key id only). |
| `POST` | `/api/payments/confirm` | Verifies the `razorpay_signature` over `order_id|payment_id`; marks the payment paid only if it matches. |
| `POST` | `/api/payments/create-order?order_id=` | Creates a gateway order for a `pending_payment` order owned by the caller (guest orders use the same flow). |
| `POST` | `/api/payments/webhook` | Gateway callback. HMAC-SHA256 signature over the raw body, constant-time compare; idempotent, with failed-event retry. CSRF-exempt. |

A captured payment commits the reserved stock. If stock disappeared between reservation and capture, the order is **not** silently marked fulfilled: a hidden `stock_conflict` event is recorded and staff are notified in-app to refund or substitute.

### Platform

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness + DB ping |
| `GET` | `/api/health` | Status plus whether payments/email are configured |
| `POST` | `/api/contact` | Stores a message and notifies staff |
| `POST` | `/api/uploads/{submission-photo|listing-photo|product-photo}` | Validated, re-encoded image upload |
| `GET` | `/sitemap.xml`, `/robots.txt` | SEO |
| `GET` | `/api/store/version` | Build/API version information |

---

## Customer account

`/api/me/*` and `/api/auth/*` require a valid session. All responses only ever contain the caller's own data.

---

## Administration

Every route below is under `/api/admin` and requires an **active** `staff` or `admin` session; the note explains where `admin` is required.

| Area | Endpoints | Role |
| --- | --- | --- |
| Dashboard | `GET /dashboard?range=today|7d|30d|90d|all` | staff |
| Products | `GET /products`, `GET /products/{id}`, `GET /products/export` | staff |
| | `POST /products`, `PUT /products/{id}`, `DELETE /products/{id}`, `POST /products/import?dry_run=` | admin |
| | `POST /products/{id}/stock` | staff |
| Categories | `GET /categories` (staff), `POST/PUT/DELETE` (admin) | |
| Banners / FAQs | `GET` (staff), `POST/PUT/DELETE` (admin) | |
| Orders | `GET /orders`, `GET /orders/{id}`, `POST /orders/{id}/status`, `POST /orders/{id}/note`, `GET /orders/{id}/document` | staff |
| | `POST /orders/{id}/cancel`, `POST /orders/{id}/refund` | admin |
| Shipments | `GET /shipments`, `POST /shipments/{id}` | staff |
| Customers | `GET /customers`, `GET /customers/{id}` | staff |
| | `POST /customers/{id}/status`, `POST /customers/{id}/role` | admin |
| Marketplace | `GET /listings`, `POST /listings/{id}/moderate`, `GET /reports`, `POST /reports/{id}`, `GET /submissions`, `POST /submissions/{id}/review`, `POST /submissions/{id}/convert` | staff |
| Quotations | `GET /quotations`, `POST /quotations/{id}/quote` | staff |
| | `POST /quotations/{id}/convert` | admin |
| Returns | `GET /returns` (staff), `POST /returns/{id}` (admin) | |
| Coupons | `GET` (staff), `POST/PUT/DELETE` (admin) | |
| Money | `GET /commissions`, `GET /payouts` (staff); `POST /payouts` (admin) | |
| Ops | `GET /messages`, `GET /inventory` | staff |
| System | `GET /settings` (staff), `PUT /settings` (admin), `GET /audit`, `GET /notifications` | |

### Order state machine

```
pending_payment → placed → processing → packed → dispatched → delivered → returned
        └───────────── cancelled ──────────────┘
```

* `packed → delivered` is allowed for counter pickup (there is nothing to dispatch).
* `dispatched` is rejected for pickup orders.
* Cash-on-delivery payment is recorded as collected when the order is marked delivered.
* Cancelling releases committed stock; refunds are recorded separately and never invented.

### Refunds and payouts

`POST /orders/{id}/refund` and completing a return require the order to be already paid, and refuse amounts above the remaining refundable total. `POST /payouts` records an amount the store has already transferred; it refuses amounts above the seller's outstanding proceeds and marks ledger entries paid oldest-first. **No endpoint moves money.**
