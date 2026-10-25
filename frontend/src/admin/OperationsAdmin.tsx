import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal } from '../components/ui'
import { dateOnly, dateTime, money, titleCase } from '../format'
import { AdminHeader, Empty, MoneyCell, Panel, Stat, StatusPill, Tabs, toPaise } from './ui'
import type { AdminMessage, AdminProduct, AdminReturn, AdminShipment } from './types'

export default function OperationsAdmin() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'returns'
  return (
    <div>
      <AdminHeader title="Operations" description="Returns, shipments, customer messages and stock health — the day-to-day queue." />
      <Tabs
        tabs={[
          { id: 'returns', label: 'Returns & cancellations' },
          { id: 'shipments', label: 'Shipments' },
          { id: 'messages', label: 'Messages' },
          { id: 'inventory', label: 'Stock' },
        ]}
        active={tab}
        onChange={(next) => setParams({ tab: next })}
      />
      {tab === 'returns' && <Returns />}
      {tab === 'shipments' && <Shipments />}
      {tab === 'messages' && <Messages />}
      {tab === 'inventory' && <Inventory />}
    </div>
  )
}

function Returns() {
  const { user, toast } = useStore()
  const isAdmin = user?.role === 'admin'
  const [status, setStatus] = useState('requested')
  const [items, setItems] = useState<AdminReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminReturn | null>(null)
  const [form, setForm] = useState({ status: 'approved', note: '', refund: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = status ? `?status_filter=${status}` : ''
      const data = await api<{ returns: AdminReturn[] }>(`/api/admin/returns${query}`)
      setItems(data.returns)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      await api(`/api/admin/returns/${target.id}`, {
        method: 'POST',
        body: {
          status: form.status,
          admin_note: form.note || null,
          refund_amount_paise: form.refund ? toPaise(form.refund) : null,
        },
      })
      toast('Request updated and the customer notified.')
      setTarget(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Queue</span>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="requested">Requested</option>
            <option value="approved">Approved</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
            <option value="">All requests</option>
          </select>
        </label>
      </div>

      {!isAdmin && <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-900">Approving or completing a return changes money and stock, so it requires an administrator account.</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading requests…</p>}
      {!loading && items.length === 0 && <Empty title="Nothing in this queue" hint="Customers raise returns and cancellations from their order page." />}

      {items.map((request) => (
        <Panel
          key={request.id}
          title={`${request.reference} · ${titleCase(request.request_type)}`}
          description={`Order ${request.order_number || '—'} · raised ${dateTime(request.created_at)}`}
          actions={<StatusPill status={request.status} />}
        >
          <p className="text-sm text-slate-700">{request.reason}</p>
          {request.admin_note && <p className="mt-1 text-xs text-amber-800">Decision note: {request.admin_note}</p>}
          {request.refund_amount_paise ? <p className="mt-1 text-xs text-emerald-700">Refund recorded: {money(request.refund_amount_paise)}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {request.order_id && <Link to={`/admin/orders/${request.order_id}`} className="link text-xs">Open order</Link>}
            {isAdmin && !['completed', 'cancelled', 'rejected'].includes(request.status) && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setTarget(request)
                  setForm({ status: 'approved', note: request.admin_note || '', refund: '' })
                }}
              >
                Decide
              </button>
            )}
          </div>
        </Panel>
      ))}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Decide ${target.reference}` : 'Decide request'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" form="return-form" className="btn-primary" disabled={busy}>Save decision</button>
          </>
        }
      >
        <form id="return-form" onSubmit={decide} className="space-y-3">
          <Field label="Decision" required>
            <select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="approved">Approve (return expected)</option>
              <option value="rejected">Reject</option>
              <option value="completed">Complete and record refund</option>
            </select>
          </Field>
          <Field label="Note to the customer">
            <textarea className="input" rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </Field>
          {form.status === 'completed' && (
            <Field label="Refund amount (₹)" hint="Only for orders whose payment is recorded as paid. This records the refund in the order; it does not move money.">
              <input className="input" inputMode="decimal" value={form.refund} onChange={(event) => setForm({ ...form, refund: event.target.value })} />
            </Field>
          )}
          <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">
            Completing a return does not restock automatically. If the book comes back in sellable condition, adjust stock from the product page so
            availability stays accurate.
          </p>
        </form>
      </Modal>
    </div>
  )
}

function Shipments() {
  const { toast } = useStore()
  const [items, setItems] = useState<AdminShipment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminShipment | null>(null)
  const [form, setForm] = useState({ carrier: '', tracking_number: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ shipments: AdminShipment[] }>('/api/admin/shipments')
      setItems(data.shipments)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      await api(`/api/admin/shipments/${target.id}`, { method: 'POST', body: form })
      toast('Tracking details saved.')
      setTarget(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading shipments…</p>}
      {!loading && items.length === 0 && <Empty title="No open deliveries" hint="Delivery orders create a shipment record automatically." />}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Order</th><th>Status</th><th>Carrier</th><th>Tracking</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {items.map((shipment) => (
                <tr key={shipment.id}>
                  <td><Link to={`/admin/orders/${shipment.order_id}`} className="link">{shipment.order_number || shipment.order_id}</Link></td>
                  <td><StatusPill status={shipment.status} /></td>
                  <td>{shipment.carrier || '—'}</td>
                  <td className="text-xs">{shipment.tracking_number || '—'}</td>
                  <td className="text-xs">{dateOnly(shipment.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="link text-xs"
                      onClick={() => {
                        setTarget(shipment)
                        setForm({ carrier: shipment.carrier || '', tracking_number: shipment.tracking_number || '' })
                      }}
                    >
                      Edit tracking
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Tracking details"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" form="shipment-form" className="btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        <form id="shipment-form" onSubmit={save} className="space-y-3">
          <Field label="Carrier / courier">
            <input className="input" value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} />
          </Field>
          <Field label="Tracking number">
            <input className="input" value={form.tracking_number} onChange={(event) => setForm({ ...form, tracking_number: event.target.value })} />
          </Field>
          <p className="text-xs text-slate-500">Tracking details are shown to the customer on their order and tracking pages.</p>
        </form>
      </Modal>
    </div>
  )
}

function Messages() {
  const [items, setItems] = useState<AdminMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ messages: AdminMessage[] }>('/api/admin/messages')
      .then((data) => setItems(data.messages))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading messages…</p>}
      {!loading && items.length === 0 && <Empty title="No messages" hint="Messages sent from the contact page arrive here." />}
      {items.map((message) => (
        <Panel key={message.id} title={`${message.subject} · ${message.name}`} description={`${message.email}${message.phone ? ` · ${message.phone}` : ''} · ${dateTime(message.created_at)}`}>
          <p className="whitespace-pre-line text-sm text-slate-700">{message.message}</p>
          <a href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`} className="btn-secondary btn-sm mt-2">Reply by email</a>
        </Panel>
      ))}
    </div>
  )
}

function Inventory() {
  const { toast } = useStore()
  const [summary, setSummary] = useState<{ in_stock: number; low_stock: number; out_of_stock: number; active_reservations: number; reservation_minutes: number } | null>(null)
  const [products, setProducts] = useState<AdminProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminProduct | null>(null)
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryData, productData] = await Promise.all([
        api<typeof summary>('/api/admin/inventory'),
        api<{ items: AdminProduct[] }>('/api/admin/products?low_stock=true&per_page=50'),
      ])
      setSummary(summaryData)
      setProducts(productData.items)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const adjust = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      await api(`/api/admin/products/${target.id}/stock`, { method: 'POST', body: { delta: Number(delta), note: note || 'Stock count' } })
      toast('Stock adjusted.')
      setTarget(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="In stock" value={summary.in_stock} tone="good" />
          <Stat label="Low stock" value={summary.low_stock} tone={summary.low_stock ? 'warn' : 'good'} />
          <Stat label="Out of stock / enquiry" value={summary.out_of_stock} tone={summary.out_of_stock ? 'bad' : 'good'} />
          <Stat label="Active reservations" value={summary.active_reservations} hint={`Held for ${summary.reservation_minutes} minutes at checkout`} />
        </div>
      )}
      {loading && <p className="text-sm text-slate-500">Loading stock…</p>}
      <Panel title="Low-stock and out-of-stock products" description="Active products at or below their low-stock threshold.">
        {products.length === 0 ? (
          <Empty title="Nothing low on stock" hint="All active products are above their thresholds." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Product</th><th>Stock</th><th>Threshold</th><th>Price</th><th /></tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.title}</td>
                    <td className={product.stock_qty <= 0 ? 'font-semibold text-red-700' : 'font-semibold text-amber-700'}>{product.stock_qty}</td>
                    <td>{product.low_stock_threshold}</td>
                    <td><MoneyCell paise={product.price_paise} /></td>
                    <td>
                      <button
                        type="button"
                        className="link text-xs"
                        onClick={() => {
                          setTarget(product)
                          setDelta('')
                          setNote('')
                        }}
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Adjust stock · ${target.title}` : 'Adjust stock'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" form="inv-form" className="btn-primary" disabled={busy}>Apply</button>
          </>
        }
      >
        {target && (
          <form id="inv-form" onSubmit={adjust} className="space-y-3">
            <p className="text-sm text-slate-600">Current stock: <strong>{target.stock_qty}</strong>. Positive adds stock, negative removes it.</p>
            <Field label="Adjustment" required>
              <input className="input" type="number" required value={delta} onChange={(event) => setDelta(event.target.value)} />
            </Field>
            <Field label="Reason">
              <input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Delivery received, damaged, stock count…" />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  )
}
