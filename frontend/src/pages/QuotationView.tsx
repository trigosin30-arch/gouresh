import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { ErrorState, SectionHeader, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { dateOnly, money, titleCase } from '../format'
import type { Quotation } from '../types'

export default function QuotationView() {
  const { reference } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { toast, confirm } = useStore()
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = token ? `?token=${encodeURIComponent(token)}` : ''
      const data = await api<{ quotation: Quotation }>(`/api/quotations/${reference}${query}`)
      setQuotation(data.quotation)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [reference, token])

  useEffect(() => {
    void load()
  }, [load])

  const accept = async () => {
    if (!quotation) return
    const ok = await confirm({
      title: 'Accept this quotation?',
      message: `You are accepting quotation ${quotation.reference} totalling ${money(quotation.quote_total_paise || 0)}. The store will convert it into an order and confirm delivery and payment terms.`,
      confirmLabel: 'Accept quotation',
    })
    if (!ok) return
    setBusy(true)
    try {
      const query = token ? `?token=${encodeURIComponent(token)}` : ''
      await api(`/api/quotations/${quotation.reference}/accept${query}`, { method: 'POST' })
      await load()
      toast('Quotation accepted. The store will confirm your order.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const decline = async () => {
    if (!quotation) return
    const ok = await confirm({
      title: 'Decline this quotation?',
      message: 'The store will not process this request further. You can submit a new request at any time.',
      confirmLabel: 'Decline',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const query = token ? `?token=${encodeURIComponent(token)}` : ''
      await api(`/api/quotations/${quotation.reference}/decline${query}`, { method: 'POST' })
      await load()
      toast('Quotation declined.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Seo title={quotation ? `Quotation ${quotation.reference}` : 'Bulk quotation'} noindex canonicalPath={`/quotations/${reference}`} />
      <div className="shell py-8">
        <SectionHeader
          title="Bulk quotation"
          subtitle="Review the request and the store's pricing. Nothing is ordered until you accept a priced quotation."
          action={
            quotation && (
              <a
                className="btn-secondary btn-sm"
                href={`/api/quotations/${quotation.reference}/document${token ? `?token=${encodeURIComponent(token)}` : ''}`}
                target="_blank"
                rel="noreferrer"
              >
                Print / save PDF
              </a>
            )
          }
        />

        {loading && <Spinner label="Loading quotation" />}
        {error && (
          <ErrorState
            message={error}
            onRetry={() => void load()}
          />
        )}

        {quotation && !loading && !error && (
          <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
            <div className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-navy-900">{quotation.reference}</h2>
                  <p className="text-xs text-slate-500">Submitted {dateOnly(quotation.created_at)}</p>
                </div>
                <span className={quotation.status === 'quoted' ? 'badge-warn' : quotation.status === 'accepted' || quotation.status === 'converted' ? 'badge-ok' : quotation.status === 'cancelled' || quotation.status === 'expired' ? 'badge-danger' : 'badge-muted'}>
                  {titleCase(quotation.status)}
                </span>
              </div>

              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500">Organisation</dt><dd className="font-medium">{quotation.organization_name} ({quotation.organization_type})</dd></div>
                <div><dt className="text-slate-500">Contact</dt><dd className="font-medium">{quotation.contact_name} · {quotation.contact_phone}</dd></div>
                <div><dt className="text-slate-500">Delivery location</dt><dd className="font-medium">{quotation.delivery_location}</dd></div>
                <div><dt className="text-slate-500">Required by</dt><dd className="font-medium">{quotation.target_date ? dateOnly(quotation.target_date) : 'Not specified'}</dd></div>
              </dl>

              <div className="table-wrap mt-4">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit price</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotation.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td className="text-right">{item.quantity}</td>
                        <td className="text-right">{item.unit_price_paise === null ? 'Pending' : money(item.unit_price_paise)}</td>
                        <td className="text-right">{item.line_total_paise === null ? '—' : money(item.line_total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {quotation.quote_total_paise !== null && (
                    <tfoot>
                      <tr>
                        <th colSpan={3} className="text-right">Quoted total</th>
                        <th className="text-right">{money(quotation.quote_total_paise)}</th>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {quotation.notes && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-navy-900">Your requirements</h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{quotation.notes}</p>
                </div>
              )}
              {quotation.quote_notes && (
                <div className="mt-4 rounded-lg bg-navy-50 p-3">
                  <h3 className="text-sm font-semibold text-navy-900">Store notes</h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{quotation.quote_notes}</p>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-navy-900">Actions</h2>
                {quotation.status === 'quoted' && (
                  <div className="mt-3 space-y-2">
                    <button type="button" className="btn-accent w-full" onClick={() => void accept()} disabled={busy}>
                      Accept quotation
                    </button>
                    <button type="button" className="btn-secondary w-full" onClick={() => void decline()} disabled={busy}>
                      Decline
                    </button>
                    {quotation.quote_valid_until && (
                      <p className="text-xs text-slate-500">Valid until {dateOnly(quotation.quote_valid_until)}.</p>
                    )}
                  </div>
                )}
                {quotation.status === 'accepted' && (
                  <p className="mt-2 text-sm text-slate-600">
                    Accepted. The store will convert this into an order and confirm delivery and payment. This page will show the order once it
                    exists.
                  </p>
                )}
                {quotation.status === 'converted' && quotation.order_id && (
                  <Link to={`/orders/${quotation.order_id}`} className="btn-primary mt-2 w-full">View the created order</Link>
                )}
                {['submitted', 'under_review'].includes(quotation.status) && (
                  <p className="mt-2 text-sm text-slate-600">
                    Waiting for the store to price this request. You will be notified when the quotation is ready.
                  </p>
                )}
                {['cancelled', 'expired', 'rejected'].includes(quotation.status) && (
                  <div className="mt-2 text-sm text-slate-600">
                    <p>This request is closed. You can submit a new request at any time.</p>
                    <Link to="/bulk-orders" className="btn-secondary btn-sm mt-2">New request</Link>
                  </div>
                )}
              </div>
              <div className="card p-5 text-xs text-slate-500">
                Keep this page&rsquo;s link — it includes an access token that lets you review the quotation without signing in. Do not share it
                publicly.
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}
