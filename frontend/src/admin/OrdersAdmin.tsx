import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal, Pagination } from '../components/ui'
import { dateOnly, dateTime, money, titleCase } from '../format'
import { AdminHeader, Empty, MoneyCell, Panel, StatusPill, toPaise } from './ui'
import type { AdminOrder, AdminShipment } from './types'

const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'partially_refunded', 'refunded', 'cancelled']
const ORDER_TYPES = ['store', 'marketplace', 'bulk']

export default function OrdersAdmin() {
  const { orderId } = useParams()
  return orderId ? <OrderDetail orderId={orderId} /> : <OrderList />
}

function OrderList() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<(AdminOrder & { customer_name?: string })[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({})
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    q: params.get('q') || '',
    status: params.get('status') || '',
    payment_status: params.get('payment_status') || '',
    order_type: params.get('order_type') || '',
    date_from: params.get('date_from') || '',
    date_to: params.get('date_to') || '',
  })
  const page = Number(params.get('page') || '1')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ page: String(page), per_page: '25' })
      Object.entries(filters).forEach(([key, value]) => {
        if (value) query.set(key, value)
      })
      const data = await api<{ orders: AdminOrder[]; total: number; pages: number; statuses: string[]; status_labels: Record<string, string> }>(
        `/api/admin/orders?${query}`,
      )
      setOrders(data.orders)
      setTotal(data.total)
      setPages(data.pages)
      setStatuses(data.statuses)
      setStatusLabels(data.status_labels)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => {
    void load()
  }, [load])

  const apply = (event: React.FormEvent) => {
    event.preventDefault()
    const next = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value) next.set(key, value)
    })
    setParams(next)
  }

  return (
    <div>
      <AdminHeader title="Orders" description="Every order, with its recorded payment and fulfilment state. Status changes are limited to the legal transitions." />

      <form onSubmit={apply} className="card mb-4 grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="label">Search</span>
          <input className="input" placeholder="Order number, name, email or phone" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </label>
        <label>
          <span className="label">Status</span>
          <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            {(statuses.length ? statuses : Object.keys(statusLabels)).map((status) => (
              <option key={status} value={status}>{statusLabels[status] || status}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Payment</span>
          <select className="input" value={filters.payment_status} onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })}>
            <option value="">All</option>
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Type</span>
          <select className="input" value={filters.order_type} onChange={(e) => setFilters({ ...filters, order_type: e.target.value })}>
            <option value="">All types</option>
            {ORDER_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input className="input" type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </label>
        <label>
          <span className="label">To</span>
          <input className="input" type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn-primary btn-sm">Apply filters</button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setFilters({ q: '', status: '', payment_status: '', order_type: '', date_from: '', date_to: '' })
              setParams({})
            }}
          >
            Clear
          </button>
        </div>
        <p className="self-end text-xs text-slate-500">{total} orders</p>
      </form>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Placed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="py-6 text-center text-sm text-slate-500">Loading orders…</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={8} className="py-6"><Empty title="No orders match these filters" /></td></tr>
            )}
            {orders.map((order) => (
              <tr key={order.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/admin/orders/${order.id}`)}>
                <td>
                  <p className="font-medium text-navy-900">{order.order_number}</p>
                  <p className="text-xs text-slate-500">{titleCase(order.order_type)} · {order.fulfillment_type}</p>
                </td>
                <td>
                  <p>{order.customer_name || order.customer_note || 'Guest'}</p>
                  <p className="text-xs text-slate-500">{order.customer_email || ''}</p>
                </td>
                <td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                <td><MoneyCell paise={order.total_paise} /></td>
                <td><StatusPill status={order.payment_status} /></td>
                <td><StatusPill status={order.status} /></td>
                <td className="whitespace-nowrap text-xs text-slate-500">{dateOnly(order.placed_at)}</td>
                <td><Link to={`/admin/orders/${order.id}`} className="link text-xs" onClick={(event) => event.stopPropagation()}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <Pagination
          page={page}
          pages={pages}
          onChange={(next) => {
            const query = new URLSearchParams(params)
            query.set('page', String(next))
            setParams(query)
          }}
        />
      </div>
    </div>
  )
}

function OrderDetail({ orderId }: { orderId: string }) {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const [order, setOrder] = useState<AdminOrder | null>(null)
  const [shipment, setShipment] = useState<AdminShipment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nextStatus, setNextStatus] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [note, setNote] = useState('')
  const [refundOpen, setRefundOpen] = useState(false)
  const [refund, setRefund] = useState({ amount: '', note: '' })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [tracking, setTracking] = useState({ carrier: '', tracking_number: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ order: AdminOrder }>(`/api/admin/orders/${orderId}`)
      setOrder(data.order)
      setNextStatus(data.order.next_statuses[0] || '')
      setTracking({
        carrier: data.order.shipment?.carrier || '',
        tracking_number: data.order.shipment?.tracking_number || '',
      })
      if (data.order.fulfillment_type === 'delivery') {
        const shipments = await api<{ shipments: AdminShipment[] }>('/api/admin/shipments')
        setShipment(shipments.shipments.find((row) => row.order_id === orderId) || null)
      } else {
        setShipment(null)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  const changeStatus = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!order || !nextStatus) return
    if (nextStatus === 'delivered') {
      const ok = await confirm({
        title: 'Mark this order delivered?',
        message: 'Only do this after the customer has actually received the order. For cash-on-delivery orders this also records the cash as collected.',
        confirmLabel: 'Mark delivered',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const data = await api<{ order: AdminOrder }>(`/api/admin/orders/${order.id}/status`, {
        method: 'POST',
        body: { status: nextStatus, note: statusNote || null },
      })
      setOrder(data.order)
      setStatusNote('')
      setNextStatus(data.order.next_statuses[0] || '')
      toast(`Order marked ${nextStatus.replace(/_/g, ' ')}.`)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const addNote = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!order || !note.trim()) return
    setBusy(true)
    try {
      const data = await api<{ order: AdminOrder }>(`/api/admin/orders/${order.id}/note`, { method: 'POST', body: { note: note.trim() } })
      setOrder(data.order)
      setNote('')
      toast('Internal note added.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const recordRefund = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!order) return
    setBusy(true)
    try {
      const data = await api<{ order: AdminOrder }>(`/api/admin/orders/${order.id}/refund`, {
        method: 'POST',
        body: { amount_paise: toPaise(refund.amount), note: refund.note },
      })
      setOrder(data.order)
      setRefundOpen(false)
      setRefund({ amount: '', note: '' })
      toast('Refund recorded.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!order) return
    setBusy(true)
    try {
      const data = await api<{ order: AdminOrder }>(`/api/admin/orders/${order.id}/cancel`, { method: 'POST', body: { note: cancelReason } })
      setOrder(data.order)
      setCancelOpen(false)
      setCancelReason('')
      toast('Order cancelled and stock released.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveTracking = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!shipment) return
    setBusy(true)
    try {
      await api(`/api/admin/shipments/${shipment.id}`, { method: 'POST', body: tracking })
      toast('Tracking details saved.')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading order…</p>
  if (error || !order) {
    return (
      <div>
        <AdminHeader title="Order" actions={<Link to="/admin/orders" className="btn-secondary btn-sm">Back to orders</Link>} />
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error || 'Order not found'}</p>
      </div>
    )
  }

  const codPending = order.payment_method === 'cod' && order.payment_status === 'pending'

  return (
    <div>
      <AdminHeader
        title={`Order ${order.order_number}`}
        description={`${titleCase(order.order_type)} · ${order.fulfillment_type} · placed ${dateTime(order.placed_at)}`}
        actions={
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => navigate('/admin/orders')}>Back</button>
            <a className="btn-secondary btn-sm" href={`/api/admin/orders/${order.id}/document?kind=invoice`} target="_blank" rel="noreferrer">Invoice</a>
            <a className="btn-secondary btn-sm" href={`/api/admin/orders/${order.id}/document?kind=packing-slip`} target="_blank" rel="noreferrer">Packing slip</a>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.6fr,1fr]">
        <div className="space-y-4">
          <Panel title="Items" description="Prices and titles are snapshots taken when the order was placed.">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.title}
                        {item.listing_id && <span className="badge-used ml-1">marketplace</span>}
                      </td>
                      <td>{item.quantity}</td>
                      <td>{money(item.unit_price_paise)}</td>
                      <td>{money(item.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <Line label="Subtotal" value={money(order.subtotal_paise)} />
              {order.discount_paise > 0 && <Line label={`Discount${order.coupon_code ? ` (${order.coupon_code})` : ''}`} value={`− ${money(order.discount_paise)}`} />}
              <Line label="Delivery fee" value={money(order.delivery_fee_paise)} />
              {order.tax_paise > 0 && <Line label="Tax" value={money(order.tax_paise)} />}
              <Line label="Total" value={money(order.total_paise)} strong />
              {order.refunded_paise > 0 && <Line label="Refunded" value={money(order.refunded_paise)} />}
            </dl>
          </Panel>

          <Panel title="Payment records" description="Only recorded payment events are shown.">
            {order.payments.length === 0 ? (
              <Empty title="No payment records" hint="Cash payments are recorded when the order is marked delivered." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Method</th><th>Status</th><th>Amount</th><th>Provider ref</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {order.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.method}</td>
                        <td><StatusPill status={payment.status} /></td>
                        <td>{money(payment.amount_paise)}</td>
                        <td className="text-xs">{payment.provider_reference || payment.failure_reason || '—'}</td>
                        <td className="text-xs">{dateTime(payment.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="History" description="Customer-visible events and internal notes.">
            <ol className="space-y-2 text-sm">
              {order.events.map((event) => (
                <li key={event.id} className="rounded border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy-900">{event.to_status ? titleCase(event.to_status) : event.type.replace(/_/g, ' ')}</span>
                    {event.visible ? <span className="badge-ok">customer visible</span> : <span className="badge-muted">internal</span>}
                    <span className="text-xs text-slate-500">{dateTime(event.created_at)} · {event.actor}</span>
                  </div>
                  {event.note && <p className="mt-1 text-slate-600">{event.note}</p>}
                </li>
              ))}
            </ol>
            <form onSubmit={addNote} className="mt-3 flex flex-wrap gap-2">
              <input className="input flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note (not shown to the customer)" />
              <button type="submit" className="btn-secondary btn-sm" disabled={busy || !note.trim()}>Add note</button>
            </form>
            {order.internal_note && (
              <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">{order.internal_note}</pre>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Status">
            <div className="flex flex-wrap gap-2">
              <StatusPill status={order.status} />
              <StatusPill status={order.payment_status} />
              {order.stock_committed ? <span className="badge-muted">stock committed</span> : <span className="badge-warn">stock not committed</span>}
            </div>
            {order.status === 'cancelled' || order.status === 'returned' ? (
              <p className="mt-3 text-sm text-slate-600">This order is closed. No further status changes are possible.</p>
            ) : (
              <form onSubmit={changeStatus} className="mt-3 space-y-2">
                <Field label="Move to next status">
                  <select className="input" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                    {order.next_statuses.length === 0 && <option value="">No transitions available</option>}
                    {order.next_statuses.map((status) => (
                      <option key={status} value={status}>{titleCase(status)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Note for the customer" hint="Optional. Included in the status notification.">
                  <input className="input" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
                </Field>
                <button type="submit" className="btn-primary btn-sm" disabled={busy || !nextStatus}>
                  Update status
                </button>
                {order.next_statuses.includes('dispatched') && order.fulfillment_type === 'pickup' && (
                  <p className="text-xs text-amber-800">Pickup orders cannot be dispatched.</p>
                )}
                {codPending && (
                  <p className="text-xs text-slate-500">Cash on delivery: marking the order delivered records the cash as collected.</p>
                )}
              </form>
            )}
          </Panel>

          <Panel title="Customer">
            <dl className="space-y-1 text-sm">
              <Line label="Name" value={order.customer_name || 'Guest'} />
              <Line label="Email" value={order.customer_email} />
              <Line label="Phone" value={order.customer_phone || '—'} />
              <Line label="Fulfilment" value={titleCase(order.fulfillment_type)} />
            </dl>
            {order.shipping_address ? (
              <address className="mt-2 rounded bg-slate-50 p-2 text-xs not-italic text-slate-600">
                {order.shipping_address.line1}
                {order.shipping_address.line2 ? <>, {order.shipping_address.line2}</> : null}
                <br />
                {order.shipping_address.locality}, {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.pincode}
              </address>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Store pickup — no delivery address.</p>
            )}
            {order.customer_note && (
              <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Customer note: {order.customer_note}</p>
            )}
          </Panel>

          {order.fulfillment_type === 'delivery' && (
            <Panel title="Shipment">
              {shipment ? (
                <form onSubmit={saveTracking} className="space-y-2">
                  <Field label="Carrier / courier">
                    <input className="input" value={tracking.carrier} onChange={(e) => setTracking({ ...tracking, carrier: e.target.value })} />
                  </Field>
                  <Field label="Tracking number">
                    <input className="input" value={tracking.tracking_number} onChange={(e) => setTracking({ ...tracking, tracking_number: e.target.value })} />
                  </Field>
                  <button type="submit" className="btn-secondary btn-sm" disabled={busy}>Save tracking</button>
                  <p className="text-xs text-slate-500">Shipment status: {shipment.status}</p>
                </form>
              ) : (
                <p className="text-sm text-slate-500">No shipment record for this order.</p>
              )}
            </Panel>
          )}

          {order.return_requests.length > 0 && (
            <Panel title="Return / cancellation requests">
              <ul className="space-y-2 text-sm">
                {order.return_requests.map((request) => (
                  <li key={request.id} className="rounded border border-slate-200 p-2">
                    <p className="font-medium text-navy-900">{request.reference} · {titleCase(request.request_type)}</p>
                    <p className="text-xs text-slate-500">{request.status} · {dateTime(request.created_at)}</p>
                    <p className="mt-1 text-slate-600">{request.reason}</p>
                    <Link to={`/admin/operations?tab=returns`} className="link mt-1 inline-block text-xs">Review in returns queue</Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {isAdmin ? (
            <Panel title="Administrator actions" description="These actions affect money and stock permanently.">
              <div className="space-y-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm w-full"
                  onClick={() => {
                    setRefund({ amount: ((order.total_paise - order.refunded_paise) / 100).toString(), note: '' })
                    setRefundOpen(true)
                  }}
                  disabled={order.payment_status === 'pending' || order.refunded_paise >= order.total_paise}
                >
                  Record a refund
                </button>
                {order.payment_status === 'pending' && <p className="text-xs text-slate-500">Refunds are only possible once a payment has been recorded as paid.</p>}
                <button type="button" className="btn-danger btn-sm w-full" onClick={() => setCancelOpen(true)} disabled={['cancelled', 'returned', 'delivered'].includes(order.status)}>
                  Cancel order
                </button>
                <p className="text-xs text-slate-500">Cancelling releases reserved stock and records the reason in the audit log.</p>
              </div>
            </Panel>
          ) : (
            <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-900">
              Refunds and cancellations require an administrator account. Ask the store owner to complete those steps.
            </p>
          )}
        </aside>
      </div>

      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title="Record a refund"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRefundOpen(false)}>Cancel</button>
            <button type="submit" form="refund-form" className="btn-danger" disabled={busy}>Record refund</button>
          </>
        }
      >
        <form id="refund-form" onSubmit={recordRefund} className="space-y-3">
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Recording a refund does not move money by itself. Complete the refund through your payment provider or at the counter first, then record
            it here — the customer is notified that the refund was recorded.
          </p>
          <Field label="Amount (₹)" required>
            <input className="input" required value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
          </Field>
          <Field label="Note" required hint="What was refunded and how (e.g. UPI reversal reference).">
            <input className="input" required minLength={3} value={refund.note} onChange={(e) => setRefund({ ...refund, note: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500">
            Maximum refundable: {money(order.total_paise - order.refunded_paise)}.
          </p>
        </form>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCancelOpen(false)}>Keep order</button>
            <button type="submit" form="cancel-form" className="btn-danger" disabled={busy}>Cancel order</button>
          </>
        }
      >
        <form id="cancel-form" onSubmit={cancelOrder} className="space-y-3">
          <p className="text-sm text-slate-600">Stock held for this order is released. The customer receives a cancellation notification with your reason.</p>
          <Field label="Reason" required>
            <input className="input" required minLength={1} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Item unavailable from supplier" />
          </Field>
        </form>
      </Modal>
    </div>
  )
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? 'text-base font-semibold text-navy-900' : 'text-slate-600'}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
