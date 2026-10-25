import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal } from '../components/ui'
import { dateOnly, dateTime, money, titleCase } from '../format'
import { AdminHeader, Empty, Panel, StatusPill, toPaise } from './ui'
import type { AdminQuotation } from './types'

const NEXT_ACTIONS: Record<string, string> = {
  submitted: 'Price this request',
  under_review: 'Price this request',
  quoted: 'Waiting for the customer to accept or decline',
  accepted: 'Convert to an order',
  converted: 'Order created',
  rejected: 'Closed',
  expired: 'Quote expired — ask the customer to request again',
  cancelled: 'Declined or cancelled by the customer',
}

export default function QuotationsAdmin() {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminQuotation[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminQuotation | null>(null)
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [quoteNotes, setQuoteNotes] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = status ? `?status=${status}` : ''
      const data = await api<{ quotations: AdminQuotation[]; statuses: string[] }>(`/api/admin/quotations${query}`)
      setItems(data.quotations)
      setStatuses(data.statuses)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const openQuote = (quotation: AdminQuotation) => {
    setTarget(quotation)
    const next: Record<string, string> = {}
    quotation.items.forEach((item) => {
      next[item.id] = item.unit_price_paise !== null ? (item.unit_price_paise / 100).toString() : ''
    })
    setPrices(next)
    setQuoteNotes(quotation.quote_notes || '')
    setValidUntil(quotation.quote_valid_until || '')
  }

  const total = target
    ? target.items.reduce((sum, item) => sum + toPaise(prices[item.id] || '0') * item.quantity, 0)
    : 0

  const saveQuote = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    const missing = target.items.filter((item) => !prices[item.id] || toPaise(prices[item.id]) <= 0)
    if (missing.length > 0) {
      toast('Enter a unit price for every line before sending the quotation.', 'error')
      return
    }
    setBusy(true)
    try {
      await api(`/api/admin/quotations/${target.id}/quote`, {
        method: 'POST',
        body: {
          items: target.items.map((item) => ({ item_id: item.id, unit_price_paise: toPaise(prices[item.id]) })),
          quote_notes: quoteNotes || null,
          quote_valid_until: validUntil || null,
        },
      })
      toast(`Quotation saved at ${money(total)}. The customer has been notified.`)
      setTarget(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const convert = async (quotation: AdminQuotation) => {
    const ok = await confirm({
      title: 'Convert to an order?',
      message: `Order will be created for ${quotation.organization_name} at ${money(quotation.quote_total_paise || 0)}. Stock for linked catalogue items is committed now; conversion fails if stock is short.`,
      confirmLabel: 'Create order',
    })
    if (!ok) return
    try {
      const result = await api<{ order: { order_number: string } }>(`/api/admin/quotations/${quotation.id}/convert`, { method: 'POST' })
      toast(`Order ${result.order.order_number} created from the quotation.`)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div>
      <AdminHeader
        title="Bulk quotations"
        description="Institutional requests. A quotation request is not an order: price it, let the customer accept, then convert it into an order."
        actions={
          <label className="flex items-end gap-2">
            <span className="sr-only">Filter by status</span>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((value) => (
                <option key={value} value={value}>{titleCase(value)}</option>
              ))}
            </select>
          </label>
        }
      />

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading quotations…</p>}
      {!loading && items.length === 0 && <Empty title="No quotation requests" hint="Requests arrive from the Bulk orders page on the storefront." />}

      <div className="space-y-3">
        {items.map((quotation) => (
          <Panel
            key={quotation.id}
            title={`${quotation.reference} · ${quotation.organization_name}`}
            description={`${quotation.organization_type} · ${quotation.contact_name} · ${quotation.contact_phone} · received ${dateTime(quotation.created_at)}`}
            actions={<StatusPill status={quotation.status} />}
          >
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Delivery location</p>
                <p>{quotation.delivery_location}</p>
                <p className="mt-1 text-xs text-slate-500">Required by: {quotation.target_date ? dateOnly(quotation.target_date) : 'not specified'}</p>
                {quotation.notes && <p className="mt-2 whitespace-pre-line rounded bg-slate-50 p-2 text-xs text-slate-600">{quotation.notes}</p>}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Quotation</p>
                <p>{quotation.quote_total_paise !== null ? money(quotation.quote_total_paise) : 'Not priced yet'}</p>
                {quotation.quote_valid_until && <p className="text-xs text-slate-500">Valid until {dateOnly(quotation.quote_valid_until)}</p>}
                {quotation.quote_notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{quotation.quote_notes}</p>}
                <p className="mt-2 text-xs text-slate-500">{NEXT_ACTIONS[quotation.status] || ''}</p>
              </div>
            </div>

            <div className="table-wrap mt-3">
              <table className="table">
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr>
                </thead>
                <tbody>
                  {quotation.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}{item.product_id ? <span className="badge-new ml-1">catalogue</span> : null}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit_price_paise !== null ? money(item.unit_price_paise) : '—'}</td>
                      <td>{item.line_total_paise !== null ? money(item.line_total_paise) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {['submitted', 'under_review', 'quoted'].includes(quotation.status) && (
                <button type="button" className="btn-primary btn-sm" onClick={() => openQuote(quotation)}>
                  {quotation.status === 'quoted' ? 'Revise quotation' : 'Price quotation'}
                </button>
              )}
              {quotation.status === 'accepted' &&
                (isAdmin ? (
                  <button type="button" className="btn-primary btn-sm" onClick={() => void convert(quotation)}>Convert to order</button>
                ) : (
                  <p className="text-xs text-amber-800">An administrator must convert an accepted quotation into an order.</p>
                ))}
              {quotation.order_id && <span className="text-xs text-emerald-700">Order created: {quotation.order_id.slice(0, 8)}…</span>}
              <a className="btn-secondary btn-sm" href={`/api/quotations/${quotation.reference}/document`} target="_blank" rel="noreferrer">
                Quotation document
              </a>
            </div>
          </Panel>
        ))}
      </div>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Price quotation ${target.reference}` : 'Price quotation'}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" form="quote-form" className="btn-primary" disabled={busy}>Send quotation</button>
          </>
        }
      >
        {target && (
          <form id="quote-form" onSubmit={saveQuote} className="space-y-3">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Unit price (₹)</th><th className="text-right">Line</th></tr>
                </thead>
                <tbody>
                  {target.items.map((item) => {
                    const line = toPaise(prices[item.id] || '0') * item.quantity
                    return (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{item.quantity}</td>
                        <td>
                          <input
                            className="input"
                            inputMode="decimal"
                            aria-label={`Unit price for ${item.description}`}
                            value={prices[item.id] ?? ''}
                            onChange={(event) => setPrices({ ...prices, [item.id]: event.target.value })}
                            required
                          />
                        </td>
                        <td className="text-right">{line > 0 ? money(line) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3} className="text-right">Quoted total</th>
                    <th className="text-right">{money(total)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            <Field label="Validity date" hint="The customer cannot accept the quotation after this date. Leave blank only if you intend it to stay open.">
              <input className="input" type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </Field>
            <Field label="Notes on the quotation" hint="Delivery terms, availability caveats, payment terms. Shown to the customer.">
              <textarea className="input" rows={3} value={quoteNotes} onChange={(event) => setQuoteNotes(event.target.value)} />
            </Field>
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
              Sending this notifies the customer that the quotation is ready. Nothing is ordered until they accept and you convert it.
            </p>
          </form>
        )}
      </Modal>
    </div>
  )
}
