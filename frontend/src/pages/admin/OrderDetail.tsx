import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useToast } from '../../lib/toast'
import { dateLabel, PAYMENT_LABELS, rupees, STATUS_LABELS } from '../../lib/format'
import type { Order } from '../../lib/types'
import { EmptyState, Field, Loading, StatusBadge } from '../../components/ui'

const STATUS_OPTIONS = [
  'processing',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
]

export default function AdminOrderDetail() {
  const { ref = '' } = useParams()
  const toast = useToast()
  const { data, loading, error, reload } = useApi<{ order: Order }>(`/admin/orders/${ref}`)
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (data?.order) {
      setStatus(data.order.allowed_transitions?.[0] ?? '')
      setCourier(data.order.courier ?? '')
      setTracking(data.order.tracking_number ?? '')
    }
  }, [data?.order])

  if (loading) return <Loading label="Loading order" />
  if (error || !data) return <EmptyState title="Order not found">{error}</EmptyState>

  const order = data.order
  const transitions = order.allowed_transitions ?? []

  const apply = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!status) return
    setBusy(true)
    setFormError(null)
    try {
      await api.post<{ order: Order }>(`/admin/orders/${order.order_number}/status`, {
        status,
        note: note.trim() || null,
        courier: courier.trim() || null,
        tracking_number: tracking.trim() || null,
        cancel_reason: status === 'cancelled' ? note.trim() || 'Cancelled by the shop' : null,
      })
      setNote('')
      await reload()
      toast.push(`Marked ${status.replace(/_/g, ' ')}`, 'success')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not update the order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="section-head">
        <div>
          <Link to="/admin/orders" className="btn-link small">
            ← All orders
          </Link>
          <h2 style={{ marginTop: 6, marginBottom: 4 }}>{order.order_number}</h2>
          <p className="small muted">
            Placed {dateLabel(order.created_at)} · {order.payment_method === 'razorpay' ? 'Online payment' : order.payment_method === 'cod' ? 'Cash on delivery' : 'Store pickup'}
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <StatusBadge status={order.status} />
          <StatusBadge status={order.payment_status} />
          <Link to={`/orders/${order.order_number}`} className="btn btn-ghost btn-sm">
            Customer view
          </Link>
        </div>
      </div>

      <div className="cart-layout">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Items</h3>
              <span className="small muted">{rupees(order.total_paise)} total</span>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th style={{ textAlign: 'right' }}>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="mono tiny">{item.sku}</td>
                      <td>{item.quantity}</td>
                      <td>{rupees(item.unit_price_paise)}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(item.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>{rupees(order.subtotal_paise)}</span>
              </div>
              {order.discount_paise > 0 ? (
                <div className="summary-row discount">
                  <span>Discount {order.coupon_code}</span>
                  <span>−{rupees(order.discount_paise)}</span>
                </div>
              ) : null}
              <div className="summary-row">
                <span>Shipping</span>
                <span>{order.shipping_paise === 0 ? 'Free' : rupees(order.shipping_paise)}</span>
              </div>
              <div className="summary-row total">
                <span>Total</span>
                <span>{rupees(order.total_paise)}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Update fulfilment</h3>
              <span className="small muted">Allowed: {transitions.join(', ') || 'none'}</span>
            </div>
            <form className="card-body form-grid" onSubmit={apply}>
              <Field label="New status" htmlFor="status">
                <select id="status" className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">Select…</option>
                  {STATUS_OPTIONS.filter((option) => transitions.includes(option) || option === status).map((option) => (
                    <option key={option} value={option}>
                      {STATUS_LABELS[option] ?? option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Courier (optional)" htmlFor="courier">
                <input id="courier" className="input" value={courier} onChange={(event) => setCourier(event.target.value)} placeholder="India Post" />
              </Field>
              <Field label="Tracking number (optional)" htmlFor="tracking">
                <input id="tracking" className="input" value={tracking} onChange={(event) => setTracking(event.target.value)} placeholder="IP123456789IN" />
              </Field>
              <Field label="Note for the customer" htmlFor="note">
                <input id="note" className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Handed to the courier" />
              </Field>
              {formError ? <div className="notice notice-danger span-2">{formError}</div> : null}
              <div className="span-2">
                <button type="submit" className="btn btn-primary" disabled={busy || !status}>
                  {busy ? 'Updating…' : 'Update order'}
                </button>
                {status === 'cancelled' ? (
                  <span className="hint" style={{ marginLeft: 10 }}>
                    Cancelling releases the reserved stock automatically.
                  </span>
                ) : null}
              </div>
            </form>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Status history</h3>
            </div>
            <div className="card-body">
              <ol className="timeline">
                {order.events.map((event) => (
                  <li key={event.id} className={event.status === order.status ? 'current' : 'done'}>
                    <strong>{STATUS_LABELS[event.status] ?? event.status}</strong>
                    <span>{dateLabel(event.created_at)}</span>
                    {event.note ? <div className="small muted">{event.note}</div> : null}
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Customer</h3>
            </div>
            <div className="card-body small stack" style={{ gap: 4 }}>
              <strong>{order.customer?.full_name ?? order.contact_name}</strong>
              <span className="muted">{order.customer?.email ?? order.email}</span>
              <span className="muted">{order.phone}</span>
              {order.customer?.id ? (
                <Link to={`/admin/customers?q=${encodeURIComponent(order.customer.email)}`} className="btn-link small">
                  View customer
                </Link>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>{order.payment_method === 'pickup' ? 'Pickup point' : 'Delivery address'}</h3>
            </div>
            <div className="card-body small">
              <strong>{order.contact_name}</strong>
              <br />
              {order.shipping_address.line1}
              {order.shipping_address.line2 ? `, ${order.shipping_address.line2}` : ''}
              {order.shipping_address.locality ? `, ${order.shipping_address.locality}` : ''}
              <br />
              {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.pincode}
              {order.notes ? <p className="muted" style={{ marginTop: 10 }}>“{order.notes}”</p> : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Payment records</h3>
              <StatusBadge status={order.payment_status} />
            </div>
            <div className="card-body small stack" style={{ gap: 10 }}>
              <div className="muted">{PAYMENT_LABELS[order.payment_status]}</div>
              {(order.payments ?? []).map((payment) => (
                <div key={payment.id} className="notice tiny" style={{ wordBreak: 'break-all' }}>
                  <div className="mono">{payment.provider_payment_id ?? payment.provider_order_id ?? payment.id}</div>
                  <div>
                    {payment.status} · {rupees(payment.amount_paise)} ·{' '}
                    {payment.signature_verified ? 'signature verified' : 'unverified'}
                  </div>
                  {payment.failure_reason ? <div className="error-text">{payment.failure_reason}</div> : null}
                </div>
              ))}
              {order.tracking_number ? (
                <div className="muted">
                  Courier: {order.courier} · {order.tracking_number}
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </>
  )
}
