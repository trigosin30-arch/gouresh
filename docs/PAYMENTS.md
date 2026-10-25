# Payments: one-time Razorpay checkout

This page covers the **one-time** payment flow that ships today. Recurring
subscriptions are deliberately **not implemented** — see
[`DECISIONS.md`](DECISIONS.md) ADR-001 for why and what would have to be true
before they are added.

## How the flow works

```
browser                     API                          Razorpay
  │  POST /api/checkout       │                              │
  ├──payment_method=online───►│  creates order (pending_payment)
  │                           │  reserves stock for 30 min     │
  │  POST /api/payments/create-order?order_id=…              │
  ├──────────────────────────►├── POST /v1/orders ───────────►│
  │◄── gateway_order_id ──────┤◄── order id ─────────────────┤
  │  checkout.js opens        │                              │
  ├── user pays ─────────────────────────────────────────────►│
  │◄── signature (order|payment, HMAC-SHA256) ────────────────┤
  │  POST /api/payments/confirm {…signature}                  │
  ├──────────────────────────►│ verifies HMAC server-side     │
  │                           │ marks paid, commits stock     │
  │                           │◄── webhook payment.captured ──┤
  │                           │ (also verifies HMAC, idempotent)
```

Two independent confirmations exist on purpose:

* **`/api/payments/confirm`** — the browser returns a signature; the server
  recomputes the HMAC with the key secret and only then marks the payment paid.
* **`/api/payments/webhook`** — the gateway notifies the server directly. This is
  what makes payment survive a closed tab or a crashed browser.

Both funnel into `services.commerce.confirm_online_payment`, which is
**idempotent**: a second call for an already-paid payment returns immediately, so
confirm + webhook arriving in either order cannot double-charge or double-decrement
stock.

## Enabling it

Online payment stays off unless **all three** secrets exist **and** the owner
enables it in Admin → Store settings:

```
RAZORPAY_KEY_ID=rzp_test_…        # publishable, sent to the browser
RAZORPAY_KEY_SECRET=…             # server only, signs/verifies
RAZORPAY_WEBHOOK_SECRET=…         # server only, verifies webhooks
```

When any is missing:

* `GET /api/payments/status` → `online_payments_available: false`
* checkout offers COD / pickup only (`methods_available` excludes `online`)
* `POST /api/payments/create-order` → `503` "not configured"
* `POST /api/payments/webhook` → `503` (no secret to verify against)

Nothing is silently half-enabled, and no screen claims online payment works.

## Test mode first (required)

1. Razorpay Dashboard → **Test Mode** → Settings → API Keys → generate a **test**
   key pair. Put them in `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. Settings → **Webhooks** → Add:
   * URL: `https://YOUR-DOMAIN/api/payments/webhook`
   * Secret: a long random string → `RAZORPAY_WEBHOOK_SECRET`
   * Active events: `payment.captured`, `payment.failed`, `order.paid`
3. Admin → Store settings → enable online payments.
4. Place a test order and pay with Razorpay's test card `4111 1111 1111 1111`
   (any future expiry, any CVV) or a UPI test handle from their docs.
5. Confirm in **Admin → Orders** that the order moved `pending_payment → placed`,
   `payment_status = paid`, and that **Audit & notifications** shows
   `payment.confirmed`.

Only after these pass should live keys be added.

## Event handling

| Event | Effect |
| --- | --- |
| `payment.captured` / `order.paid` | Confirms the payment; order → `placed`; reserved stock committed. Amount is compared against the stored order amount — a mismatch marks the event `failed`, notifies admins and leaves the order unpaid. |
| `payment.failed` | Marks the payment `failed` **only if it is not already paid** (a stale failure can arrive after a capture); notifies the customer that the hold will lapse. |
| anything else | Stored with status `ignored` so it is visible in the audit trail without side effects. |

Replay safety:

* The signature is computed over the **raw request body** — no re-encoding — and
  compared in constant time. A tampered body fails even with a valid signature.
* Each event id is stored once. A replay is acknowledged (`{"ok": true,
  "duplicate": true}`) and skipped. A previously **failed** event may be retried
  (the row is removed and reprocessed) so a transient bug does not become
  permanent data loss.
* An event for an unknown order is acknowledged and recorded; it never creates an
  order or a payment.

## Failure cases and what happens

| Situation | Behaviour |
| --- | --- |
| Customer closes the tab after paying | The webhook still confirms the order. |
| Webhook delayed past the 30-minute stock hold | The hold expires and stock returns to the shelf; the sweeper releases it. Capture then logs a `stock_conflict` event and notifies staff — the customer is never silently left with a paid, unfulfillable order. |
| Payment captured after stock ran out | Same as above: payment recorded as paid, hidden `stock_conflict` event on the order, staff notification "refund the customer or arrange a substitute". |
| Signature mismatch from the browser | `400`, nothing changes. |
| Amount mismatch in a webhook | Event marked `failed`, admins notified, order stays unpaid for investigation. |
| Keys removed after an order exists | `create-order` returns `503`; the order stays `pending_payment` and staff can cancel it (which releases stock). |

## Refunds

Refunds are recorded, not executed by this software: `POST /api/admin/orders/{id}/refund`
(admin only) writes the amount against the order and updates `payment_status` to
`partially_refunded` / `refunded`. You must issue the actual refund in the Razorpay
dashboard. The API refuses an amount above the remaining refundable total.

> The UI says this explicitly. Do not tell a customer "refunded" until the money
> has been returned in Razorpay.

## What is tested, and what is not

Tested (`tests/test_payments.py`, `tests/test_checkout_payments.py`):

* signature rejection: missing, wrong secret, tampered body
* idempotent capture (same event twice, two different events for one payment)
* late `payment.failed` cannot downgrade a paid order
* amount mismatch is refused and surfaced to staff
* capture commits reserved stock; stock conflict alerts staff
* `create-order` refuses when keys are missing; nothing marked paid
* `/api/payments/status` only advertises online payment when it can actually work

**Not tested here:** an end-to-end payment against Razorpay's servers. This build
environment has no outbound access to `api.razorpay.com`, so `create-order` has
never been exercised against the live API, and no real card or UPI payment has been
run. Test mode on a deployed instance is the first thing to verify before switching
to live keys — treat that as a release gate.

## Reconciliation habit

Monthly, compare the Razorpay dashboard's captured payments against
**Admin → Orders** filtered to `payment_status = paid` plus recorded refunds. Any
order that is `pending_payment` for more than a day is either an abandoned checkout
or a webhook that never arrived — check the Razorpay webhook delivery log, then
reconcile by hand and cancel the order (which releases stock).
