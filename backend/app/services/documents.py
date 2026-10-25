"""Printable documents (invoice / packing slip).

Rendered as standalone HTML so the browser's print dialog produces the PDF.
These are not statutory tax invoices unless the owner has configured a GSTIN.
"""
from __future__ import annotations

import html
from typing import Any

from ..constants import ORDER_STATUS_LABELS
from ..models import Order


def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def _money(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def render_order_document(order: Order, store: dict[str, Any], *, kind: str = "invoice") -> str:
    is_invoice = kind == "invoice"
    gstin = store.get("store_gstin") or ""
    tax_enabled = bool(store.get("tax_enabled")) and int(store.get("tax_rate_bp") or 0) > 0
    rows = "".join(
        f"<tr><td>{_e(item.title_snapshot)}<div class='muted'>{_e(item.condition_snapshot or '')}</div></td>"
        f"<td class='num'>{item.quantity}</td><td class='num'>{_money(item.unit_price_paise)}</td>"
        f"<td class='num'>{_money(item.line_total_paise)}</td></tr>"
        for item in order.items
    )
    address = ""
    if order.fulfillment_type == "delivery":
        parts = [order.ship_line1, order.ship_line2, order.ship_locality, order.ship_city, order.ship_state, order.ship_pincode]
        address = "<br>".join(_e(p) for p in parts if p)
    else:
        address = "Store pickup"

    totals = f"""
      <tr><td colspan="3" class="right">Subtotal</td><td class="num">{_money(order.subtotal_paise)}</td></tr>
      {f'<tr><td colspan="3" class="right">Discount</td><td class="num">-{_money(order.discount_paise)}</td></tr>' if order.discount_paise else ''}
      <tr><td colspan="3" class="right">Delivery</td><td class="num">{_money(order.delivery_fee_paise)}</td></tr>
      <tr><td colspan="3" class="right">Tax</td><td class="num">{_money(order.tax_paise) if tax_enabled else 'Not configured'}</td></tr>
      <tr class="total"><td colspan="3" class="right">Total</td><td class="num">{_money(order.total_paise)}</td></tr>
      {f'<tr><td colspan="3" class="right">Refunded</td><td class="num">{_money(order.refunded_paise)}</td></tr>' if order.refunded_paise else ''}
    """

    title = "Tax invoice" if (is_invoice and gstin and tax_enabled) else ("Invoice" if is_invoice else "Packing slip")
    status = ORDER_STATUS_LABELS.get(order.status, order.status)
    notice = ""
    if is_invoice and not (gstin and tax_enabled):
        notice = "<p class='notice'>Tax/GST details are not configured for this store, so this is a sales document rather than a statutory tax invoice.</p>"

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_e(title)} · {_e(order.order_number)}</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color:#0f172a; margin: 0; padding: 32px; }}
  .wrap {{ max-width: 820px; margin: 0 auto; }}
  header {{ display:flex; justify-content:space-between; gap:24px; border-bottom:2px solid #0f2d52; padding-bottom:16px; margin-bottom:24px; }}
  h1 {{ font-size: 22px; margin:0 0 4px; color:#0f2d52; }}
  h2 {{ font-size: 15px; text-transform:uppercase; letter-spacing:.08em; color:#64748b; margin:24px 0 8px; }}
  .muted {{ color:#64748b; font-size:12px; }}
  .notice {{ background:#fff7ed; border:1px solid #fed7aa; padding:10px 12px; border-radius:8px; font-size:13px; color:#9a3412; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th, td {{ text-align:left; padding:8px 6px; border-bottom:1px solid #e2e8f0; vertical-align:top; }}
  th {{ font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; }}
  .num {{ text-align:right; white-space:nowrap; }}
  .right {{ text-align:right; }}
  tr.total td {{ font-weight:700; border-top:2px solid #0f2d52; border-bottom:none; }}
  .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }}
  .badge {{ display:inline-block; background:#0f2d52; color:#fff; border-radius:999px; padding:2px 10px; font-size:12px; }}
  @media print {{ body {{ padding:0; }} .noprint {{ display:none; }} }}
</style></head>
<body><div class="wrap">
<header>
  <div>
    <h1>{_e(store.get('store_name') or 'Ankit Stationery Mart')}</h1>
    <div class="muted">{_e(store.get('store_address') or '')}</div>
    {f"<div class='muted'>Phone: {_e(store.get('store_phone'))}</div>" if store.get('store_phone') else ""}
    {f"<div class='muted'>GSTIN: {_e(gstin)}</div>" if gstin else ""}
  </div>
  <div style="text-align:right">
    <div><strong>{_e(title)}</strong></div>
    <div class="muted">Order {_e(order.order_number)}</div>
    <div class="muted">{_e(order.placed_at.strftime('%d %b %Y, %H:%M'))}</div>
    <div class="badge" style="margin-top:6px">{_e(status)}</div>
  </div>
</header>
{notice}
<div class="grid">
  <div>
    <h2>Customer</h2>
    <div>{_e(order.customer_name)}</div>
    <div class="muted">{_e(order.customer_phone)}{' · ' + _e(order.customer_email) if is_invoice else ''}</div>
  </div>
  <div>
    <h2>{'Delivery address' if order.fulfillment_type == 'delivery' else 'Fulfilment'}</h2>
    <div>{address}</div>
  </div>
</div>
<h2>Items</h2>
<table>
  <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
  <tbody>{rows}</tbody>
  <tbody>{totals}</tbody>
</table>
<h2>Payment</h2>
<div class="muted">Method: {_e(order.payment_method.upper())} · Payment status: {_e(order.payment_status)}</div>
{'' if not is_invoice else f"<h2>Notes</h2><div class='muted'>{_e(store.get('returns_note') or 'Return policy is not published. Contact the store for assistance.')}</div>"}
<p class="muted" style="margin-top:32px">Computer-generated document · {_e(store.get('store_name') or 'Ankit Stationery Mart')}</p>
<button class="noprint" onclick="window.print()" style="margin-top:16px;background:#0f2d52;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer">Print / Save as PDF</button>
</div></body></html>"""
