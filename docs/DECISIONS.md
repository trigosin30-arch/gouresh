# Decision record

Short, dated notes on choices that cost money or constrain the product. Written so
the next person (or the next session) does not have to rediscover the reasoning.

---

## ADR-001 — Recurring subscriptions are deferred (2026-10-25)

**Status:** accepted · **Decision owner:** store owner

**Context.** A production plan proposed both one-time Razorpay checkout and
recurring subscriptions. One-time purchases are the actual business: stationery and
books are bought when needed, in small quantities, often in cash at the counter.

**Decision.** Implement one-time purchases first and **do not build subscriptions
now**. No subscription tables, endpoints, webhook handlers or entitlement checks
are added.

**Why.**

1. *Nothing to sell on a recurring basis yet.* A subscription needs a defined
   benefit delivered repeatedly: a delivery membership, a seller plan, or a
   school/office supply contract. None of these has been defined or priced. Code
   written against an undefined product becomes rework.
2. *Access control follows the product, not the other way round.* Subscriptions
   only matter if they unlock something (free delivery, priority quotes, seller
   listing rights). Inventing entitlements before the benefit exists creates
   permission logic the shop cannot explain to a customer.
3. *Operational cost is real.* Recurring billing means retries, dunning, proration,
   mandate/card-update handling, GST invoicing per cycle, cancellations and refunds
   per cycle. For a single-counter shop on free hosting, that is a large surface
   area with no revenue behind it.
4. *The shop already has a recurring-revenue-shaped product without the machinery:*
   bulk quotations for schools and offices. Those are quoted, negotiated and
   invoiced per term — the existing quotation flow covers it today.

**Consequences.**

* Payments stay a single, well-tested one-time flow (`docs/PAYMENTS.md`).
* There is no `subscription` table, so no half-migrated data if the decision changes.
* If a subscription is later approved, the minimum viable definition is needed
  first: **what is delivered each period, at what price, to whom, and what stops if
  payment fails.** With that written down, the implementation is a bounded piece of
  work: a plan catalogue, a provider subscription id per customer, an entitlement
  flag read by the relevant route, and webhook handlers for
  `subscription.charged` / `subscription.halted` / `subscription.cancelled`.
* Non-payment must degrade access, never delete order history.

**Revisit when** the owner can state the recurring benefit, its price, and the
consequence of non-payment in one sentence each.

---

## ADR-002 — Google Sign-In verified server-side, password login kept (2026-10-25)

**Status:** accepted

**Context.** Customers mostly have Google accounts; asking for another password is
friction, and password resets need working email that the shop has not configured.

**Decision.** Add Google Sign-In alongside email/password, never instead of it.

* The browser's Google ID token is verified on the server (signature against
  Google's certificates, `iss`, `aud`, expiry, `email_verified`) before a session
  exists. The verified `sub` is stored on the user.
* Roles are never taken from the token; new accounts are always `customer`.
* Accounts created this way have no password. They can set one later, without
  supplying a current password (there isn't one).
* Password login remains for staff, for customers without a Google account, and as
  the fallback when the Google script cannot load on a restricted network.
* Google sign-in is off unless `GOOGLE_CLIENT_ID` is set; the storefront then shows
  password login only and the API reports it as unavailable.

**Why not OAuth redirect flow?** Google Identity Services returns a signed ID token
directly to the page, so there is no redirect URI, no authorization-code storage and
no callback route to secure. The trade-off is that the verification step is
mandatory — which is exactly what is implemented and tested.

**Consequences.** Two sign-in paths to keep working; both are covered by tests. Demo
accounts still use passwords so the seeded site works with no Google setup.

---

## ADR-003 — Free hosting for the demo; not for real orders (2026-10-25)

**Status:** accepted

**Decision.** Render's free tier hosts the public demo and integration testing only.

**Why.** Free web services sleep after inactivity; the free PostgreSQL instance
expires on a fixed schedule; the filesystem is ephemeral so uploads vanish on
redeploy. Storing real customer orders and payment records in a database with a
known expiry date is a data-loss plan, not a deployment.

**Consequences.** Before accepting a real order: move to a paid instance or an
external Postgres, attach durable storage for uploads, set `SEED_DEMO=0`, create a
real administrator, complete a backup/restore drill
(`docs/BACKUP_RESTORE.md`), and run a test-mode payment end to end
(`docs/PAYMENTS.md`). Until then the site is a demo and is described as one.
