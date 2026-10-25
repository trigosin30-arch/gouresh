# Shop operations guide (admin)

For the shop owner and staff. Nothing here requires a developer.

Sign in at `/login` with your staff or administrator account, then open `/admin`. Staff see the shop-floor areas; administrator-only actions are marked **[admin]** and are hidden or disabled for staff.

---

## First run: configure the store

Open **Admin → Store settings**. The storefront only publishes facts that exist here; anything empty displays “not configured” rather than a guess.

Fill in, at minimum:

| Setting group | What to enter |
| --- | --- |
| Contact | Shop phone, WhatsApp number (only if used), email, full address, map link |
| Hours | Opening hours per day, and a note for holidays |
| Delivery | Whether delivery is offered; which PIN codes are served; fee; free-delivery threshold; minimum order |
| Pickup | Pickup instructions and window |
| Policies | Cancellation window, return window, shipping note, returns note, marketplace commission note |
| Marketplace | Commission rate in basis points (500 = 5%) |

The dashboard **setup checklist** lists what is still missing. Policy pages and product pages update immediately after saving; the change is recorded in the audit log.

> Publish only what is true. If the shop does not deliver, turn delivery off — the storefront then offers pickup only, and shipping/return statements adapt accordingly.

---

## Daily routine

### 1. Check new orders

**Admin → Orders**. Default filter shows orders that need action (payment pending, placed, processing, packed).

For each order:

* **Pickup**: prepare the items, then set `processing → packed`, and when the customer collects and pays (if COD) set `packed → delivered`. Marking delivered records the COD amount as collected.
* **Delivery**: `processing → packed → dispatched` (carrier + tracking number on the order), then `delivered` once handed over.
* **Online payment**: the order appears as `pending_payment` until the gateway confirms. Do not fulfil an unpaid order; if the customer says they paid, check the payment row on the order before changing anything.

Status changes are enforced by an allow-list. Wrong steps are refused, so the audit trail always shows a real sequence.

### 2. Print paperwork

On any order: **Invoice** or **Packing slip** — both open a printable HTML document. The customer receives the same invoice through their tracking link.

### 3. Handle cancellations and refunds

* A customer can cancel from their account only inside the cancellation window and before dispatch. The stock returns to the catalogue automatically.
* **[admin]** Use **Cancel order** for anything else; it also releases stock.
* **[admin]** **Record refund** stores the amount refunded against the order. The money itself is returned through the payment provider or at the counter — the platform does not move money and says so in the UI.

### 4. Returns

Customer requests appear under **Admin → Returns**. Approve or reject with a note. Completing a return requires an administrator and a paid order.

---

## Catalogue

**Products**

* Create a product with title, category, price (₹, stored as paise), optional compare-at price, stock, low-stock threshold, description, board/class/subject for books, and photos.
* **Compare-at price** is a real former/retail price; leave it blank rather than inflating it. The UI shows the discount only because the numbers justify it.
* **Stock**: the storefront never shows an out-of-stock item as purchasable. Low stock is flagged on the dashboard using each product's threshold.
* **Stock adjustments** are recorded with the reason, so the inventory history explains every change.
* **CSV import**: download the template/export first. Import runs as a **dry run** by default and reports row-level errors; run again with `dry_run=false` (or the confirm switch) to commit.
* **Archive** instead of deleting when a product has order history.

**Categories, banners, FAQs, coupons**

* Categories: slug, name, description, sort order, active flag.
* Banners: image, title, subtitle, CTA, theme, active.
* FAQs: question/answer pairs shown on the storefront and in structured data.
* Coupons **[admin]**: percentage or fixed amount, minimum order, maximum discount, usage limits, start/end dates. Coupons are validated server-side at checkout.

---

## Second-hand marketplace

1. **Submissions** — customers submit books with photos. Open the submission, inspect the photos and condition, then approve/reject with a note. Converting an approved submission creates a listing.
2. **Listings** — moderated queue. Approve, reject or request changes. Only approved listings appear on the storefront.
3. **Reports** — customers can report a listing; resolve reports with a note. Rejecting a listing hides it immediately.
4. **Commission** — when a listing sells, a commission record is created from the rate in settings (on the book price only, not delivery).
5. **Payouts [admin]** — after you have actually transferred the seller's proceeds, record the payout. The system refuses amounts above outstanding proceeds and marks the oldest ledger entries paid. It never initiates a transfer.

Seller contact details are visible on the admin listing/submission page, never on the public site.

---

## Bulk quotations

1. A request arrives from the quote form (`/bulk-orders`), or staff enter one by phone.
2. Open **Admin → Quotations**, price each line (quantity is fixed by the request), add notes and a validity date, then send the quote.
3. The customer opens their secure quote link, accepts or declines. Accepting does **not** create an order.
4. **[admin]** **Convert to order** creates the order from the accepted quote. Nothing is marked sold before that.

Quotes past their validity date cannot be accepted and must be re-priced.

---

## Customers

* Search by name, email or phone; open a customer to see orders, addresses, listings and internal notes.
* **Restrict [admin]**: ends shop-floor access and customer ordering immediately — existing sessions are revoked, open carts are discarded, and the account cannot sign in until reactivated. Use it for fraud or abusive behaviour, with a reason — the reason is stored.
* **Change role [admin]**: customer ↔ staff ↔ admin. You cannot change your own role, and the last active administrator cannot be demoted.
* Deletion requests appear as restricted accounts; handle the data question outside the order records that must be kept for accounting.

---

## Notifications

**Admin → Audit & notifications** shows exactly what happened.

* Every notification is always stored in-app for the customer.
* Email is only sent when SMTP is configured. Without it, records show `skipped` and the reason — nothing is shown to anyone as “sent”.
* SMS and WhatsApp are **not implemented**; those records also show `skipped`. Do not tell a customer a text was sent.

If customers report missing emails, check this log first, then the SMTP credentials.

---

## Month-end

* **Dashboard**: net revenue = paid money on non-cancelled orders minus recorded refunds. The definition is printed on the page; use it consistently.
* **Money → Commissions** for marketplace totals, **Payouts** for what has been paid out.
* **Money** and **Orders** can be exported for accounting (products CSV export exists; use the invoice documents for order-level records).
* **Audit log** for who changed prices, statuses, refunds, roles or settings.

Take a database + uploads backup before any bulk import or pricing change: `docs/BACKUP_RESTORE.md`.

---

## When something looks wrong

| Symptom | First check |
| --- | --- |
| “Not enough stock” at checkout | Product stock and quantity; expired reservations release automatically within 30 minutes |
| Customer cannot see an order | They are signed in with a different email; use order tracking by number + email |
| Quote link “invalid or expired” | Validity date; re-price and resend |
| Upload rejected | JPEG/PNG/WebP only, under 4 MB |
| Email not received | Notification log shows `skipped` when SMTP is unconfigured |
| Admin page shows 403 | Your role, or the account was restricted |
| Site shows “not configured” | Publish the missing fact in Store settings — do not work around it |
