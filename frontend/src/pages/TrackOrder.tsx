import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { ErrorState, Field, SectionHeader } from '../components/ui'
import { dateTime, money, orderStatusTone, titleCase } from '../format'

type TrackResult = {
  order_number: string
  status: string
  payment_status: string
  fulfillment_type: string
  placed_at: string
  total_paise: number
  item_count: number
  items: { title: string; quantity: number }[] | null
  events: { to_status: string | null; type: string; note: string | null; created_at: string }[]
  carrier: string | null
  tracking_number: string | null
  customer_email: string
  limited: boolean
  tracking_token: string | null
}

export default function TrackOrder() {
  const [params, setParams] = useSearchParams()
  const token = params.get('token') || ''
  const [form, setForm] = useState({ order_number: params.get('order_number') || '', email: params.get('email') || '' })
  const [result, setResult] = useState<TrackResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const lookup = useCallback(async (query: string) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await api<TrackResult>(`/api/track${query}`)
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token) void lookup(`?token=${encodeURIComponent(token)}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const next = new URLSearchParams()
    if (form.order_number) next.set('order_number', form.order_number)
    if (form.email) next.set('email', form.email)
    setParams(next)
    void lookup(`?${next.toString()}`)
  }

  return (
    <>
      <Seo title="Track your order" noindex canonicalPath="/track-order" />
      <div className="shell py-8">
        <SectionHeader
          title="Track an order"
          subtitle="Use the tracking link from your confirmation, or your order number and email. Addresses are only shown in your signed-in account."
        />

        <div className="grid gap-6 lg:grid-cols-[1fr,1.4fr]">
          <form onSubmit={submit} className="card h-fit space-y-3 p-5">
            <Field label="Order number" hint="For example ASM-250601-AB12CD" required>
              <input
                className="input"
                required
                value={form.order_number}
                onChange={(event) => setForm({ ...form, order_number: event.target.value.toUpperCase() })}
                placeholder="ASM-…"
              />
            </Field>
            <Field label="Email used on the order" required>
              <input
                className="input"
                type="email"
                required
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </Field>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Looking up…' : 'Track order'}
            </button>
            <p className="text-xs text-slate-500">
              Prefer a secure link? Open the tracking link in your confirmation email or{' '}
              <Link to="/orders" className="link">your orders</Link>.
            </p>
          </form>

          <div className="space-y-4">
            {error && <ErrorState message={error} onRetry={() => (token ? void lookup(`?token=${token}`) : undefined)} />}
            {!result && !error && !loading && (
              <div className="card p-6 text-sm text-slate-600">
                <h2 className="text-base font-semibold text-navy-900">What you can see here</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Current status and the recorded history of the order.</li>
                  <li>Payment status and fulfilment method.</li>
                  <li>Tracking details once the store dispatches a delivery order.</li>
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Order numbers alone never reveal a customer&rsquo;s address or contact details. Sign in to see the full order.
                </p>
              </div>
            )}
            {result && (
              <div className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-navy-900">Order {result.order_number}</h2>
                    <p className="text-xs text-slate-500">
                      Placed {dateTime(result.placed_at)} · {result.item_count} item{result.item_count === 1 ? '' : 's'} ·{' '}
                      {result.fulfillment_type === 'pickup' ? 'Store pickup' : 'Home delivery'}
                    </p>
                  </div>
                  <span className={orderStatusTone(result.status)}>{titleCase(result.status)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Payment: {titleCase(result.payment_status)} · Total {money(result.total_paise)} · Updates sent to {result.customer_email}
                </p>
                {result.carrier || result.tracking_number ? (
                  <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {result.carrier ? `${result.carrier} · ` : ''}
                    {result.tracking_number || 'Tracking number pending'}
                  </p>
                ) : null}

                {result.items && (
                  <ul className="mt-3 space-y-1 text-sm text-slate-600">
                    {result.items.map((item, index) => (
                      <li key={index}>{item.quantity} × {item.title}</li>
                    ))}
                  </ul>
                )}

                <h3 className="mt-4 text-sm font-semibold text-navy-900">History</h3>
                <ol className="mt-2 space-y-2">
                  {result.events.map((event, index) => (
                    <li key={index} className="flex gap-2 text-sm">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-navy-700" aria-hidden="true" />
                      <span>
                        <span className="font-medium text-navy-900">{titleCase(event.to_status || event.type)}</span>
                        <span className="block text-xs text-slate-500">{dateTime(event.created_at)}</span>
                        {event.note && <span className="block text-slate-600">{event.note}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                {result.limited && (
                  <p className="mt-3 text-xs text-slate-500">
                    Signed-out lookups show limited details. <Link to="/login" className="link">Sign in</Link> to see the full order.
                  </p>
                )}
                {result.tracking_token && (
                  <Link to={`/track-order?token=${result.tracking_token}`} className="link mt-2 inline-block text-xs">
                    Bookmark this secure tracking link
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
