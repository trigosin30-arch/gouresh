import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/useApi'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { openRazorpayCheckout } from '../lib/razorpay'
import { dateLabel, PAYMENT_LABELS, rupees, STATUS_LABELS } from '../lib/format'
import type { Order, PaymentSession } from '../lib/types'
import { MockPaymentModal } from '../components/PaymentModal'
import { EmptyState, Loading, StatusBadge } from '../components/ui'
import { IconArrow, IconCheck, IconPin, IconTruck } from '../components/Icons'

const STAGE_LABELS = ['Placed', 'Confirmed', 'Processing', 'Packed', 'Shipped', 'Out for delivery', 'Delivered']

export default function OrderDetail() {
  const { ref = '' } = useParams()
  const [params] = useSearchParams()
  const toast = useToast()
  const { profile } = useAuth()
  const { data, loading, error, reload, setData } = useApi<{ order: Order }>(`/orders/${ref}`)
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [showMock, setShowMock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [webhookResult, setWebhookResult] = useState<string | null>(null)

  if (loading) return <Loading label="Loading order" />
  if (error || !data) return <EmptyState title="Order not found">{error ?? 'Check the order link.'}</EmptyState>

  const order = data.order
  const timeline = order.timeline
  const stageIndex = timeline?.index ?? 0
  const terminalFail = ['cancelled', 'payment_failed', 'refunded'].includes(order.status)
  const canPay =
    order.payment_method === 'razorpay' && ['pending', 'failed', 'unpaid'].includes(order.payment_status) &&
    !['cancelled', 'refunded', 'delivered'].includes(order.status)
  const canCancel = ['payment_pending', 'payment_failed', 'confirmed', 'processing'].includes(order.status)

  const retryPayment = async () => {
    setBusy(true)
    setInlineError(null)
    try {
      const response = await api.post<{ payment_session: PaymentSession }>(`/orders/${order.order_number}/retry-payment`)
      setSession(response.payment_session)
      if (response.payment_session.mock) {
        setShowMock(true)
      } else {
        await openRazorpayCheckout(response.payment_session, {
          onSuccess: async (payload) => {
            try {
              const verified = await api.post<{ order: Order }>('/payments/verify', payload)
              setData({ order: verified.order })
              toast.push('Payment verified', 'success')
            } catch (err) {
              setInlineError(err instanceof ApiError ? err.message : 'Verification failed')
            }
          },
          onDismiss: () => undefined,
          onFailure: (message) => setInlineError(message),
        })
      }
    } catch (err) {
      setInlineError(err instanceof ApiError ? err.message : 'Could not start payment')
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async () => {
    if (!window.confirm('Cancel this order? Reserved stock will be released.')) return
    setBusy(true)
    try {
      const response = await api.post<{ order: Order }>(`/orders/${order.order_number}/cancel`, {
        reason: 'Cancelled from the order page',
      })
      setData({ order: response.order })
      toast.push('Order cancelled', 'success')
    } catch (err) {
      setInlineError(err instanceof ApiError ? err.message : 'Could not cancel')
    } finally {
      setBusy(false)
    }
  }

  const runDemoWebhook = async () => {
    setBusy(true)
    setWebhookResult(null)
    try {
      const response = await api.post<{
        first_delivery: { status: string }
        second_delivery: { status: string }
        order: Order
      }>(`/payments/demo-webhook/${order.order_number}`)
      setData({ order: response.order })
      setWebhookResult(
        `First delivery: ${response.first_delivery.status} · second delivery: ${response.second_delivery.status} (duplicate events are ignored)`,
      )
    } catch (err) {
      setInlineError(err instanceof ApiError ? err.message : 'Webhook demo failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <Link to="/orders">Orders</Link>
        <span>/</span>
        <span>{order.order_number}</span>
      </div>

      {params.get('paid') || params.get('placed') ? (
        <div className="notice notice-success row" style={{ marginBottom: 18, gap: 10 }}>
          <IconCheck size={18} />
          <span>
            {params.get('paid')
              ? 'Payment verified and the order is confirmed. We will pack it at the shop.'
              : 'Order placed. The counter has been notified.'}
          </span>
        </div>
      ) : null}

      <div className="section-head">
        <div>
          <div className="kicker">Order {order.order_number}</div>
          <h1 style={{ marginBottom: 6 }}>
            {terminalFail ? STATUS_LABELS[order.status] : 'Track your order'}
          </h1>
          <p>Placed {dateLabel(order.created_at)} · {order.items.length} item{order.items.length === 1 ? '' : 's'}</p>
        </div>
        <div className="row wrap">
          <StatusBadge status={order.status} />
          <StatusBadge status={order.payment_status} />
        </div>
      </div>

      <div className="cart-layout">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Delivery progress</h3>
              {order.tracking_number ? (
                <span className="small muted">
                  {order.courier ?? 'Courier'} · {order.tracking_number}
                </span>
              ) : null}
            </div>
            <div className="card-body">
              {terminalFail ? (
                <div className={`notice ${order.status === 'cancelled' ? 'notice-danger' : 'notice-warn'}`}>
                  <strong>{STATUS_LABELS[order.status]}.</strong>{' '}
                  {order.cancel_reason ?? 'This order is no longer in the delivery pipeline.'}
                  {order.payment_status === 'refund_due'
                    ? ' A refund is queued back to your original payment method.'
                    : ''}
                </div>
              ) : (
                <>
                  <div className="tracker">
                    {STAGE_LABELS.map((label, index) => (
                      <div
                        key={label}
                        className={`tracker-step ${index < stageIndex ? 'done' : ''} ${
                          index === stageIndex ? 'current' : ''
                        }`}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <p className="small muted">
                    {order.status === 'delivered'
                      ? `Delivered ${dateLabel(order.delivered_at)}`
                      : 'Status updates are posted by the shop as your parcel moves.'}
                  </p>
                </>
              )}

              <ol className="timeline" style={{ marginTop: 22 }}>
                {order.events.map((event) => (
                  <li
                    key={event.id}
                    className={
                      event.status === order.status ? 'current' : terminalFail ? '' : 'done'
                    }
                  >
                    <strong>{STATUS_LABELS[event.status] ?? event.status}</strong>
                    <span>{dateLabel(event.created_at)}</span>
                    {event.note ? <div className="small muted">{event.note}</div> : null}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Items</h3>
              <span className="small muted">{order.items.length} lines</span>
            </div>
            <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="row-between"
                  style={{ padding: '12px 0', borderBottom: '1px solid var(--line)', gap: 14 }}
                >
                  <div>
                    <strong style={{ fontSize: '0.94rem' }}>{item.name}</strong>
                    <div className="small muted">
                      {item.quantity} × {rupees(item.unit_price_paise)} · SKU {item.sku}
                    </div>
                  </div>
                  <strong>{rupees(item.line_total_paise)}</strong>
                </div>
              ))}
            </div>
            <div className="card-foot">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>{rupees(order.subtotal_paise)}</span>
              </div>
              {order.discount_paise > 0 ? (
                <div className="summary-row discount">
                  <span>Coupon {order.coupon_code}</span>
                  <span>−{rupees(order.discount_paise)}</span>
                </div>
              ) : null}
              <div className="summary-row">
                <span>{order.payment_method === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                <span>{order.shipping_paise === 0 ? 'Free' : rupees(order.shipping_paise)}</span>
              </div>
              <div className="summary-row total">
                <span>Total</span>
                <span>{rupees(order.total_paise)}</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <h3>Payment</h3>
              <StatusBadge status={order.payment_status} />
            </div>
            <div className="card-body">
              <p className="small">
                <strong>
                  {order.payment_method === 'razorpay'
                    ? 'Online payment'
                    : order.payment_method === 'cod'
                      ? 'Cash on delivery'
                      : 'Pay at store pickup'}
                </strong>
                <br />
                <span className="muted">{PAYMENT_LABELS[order.payment_status]}</span>
              </p>
              {order.payments && order.payments.length > 0 ? (
                <div className="stack" style={{ gap: 8 }}>
                  {order.payments.slice(-2).map((payment) => (
                    <div key={payment.id} className="tiny mono muted" style={{ wordBreak: 'break-all' }}>
                      {payment.provider_payment_id ?? payment.provider_order_id} · {payment.status}
                      {payment.signature_verified ? ' · signature verified' : ''}
                    </div>
                  ))}
                </div>
              ) : null}

              {inlineError ? <div className="notice notice-danger small">{inlineError}</div> : null}

              {canPay ? (
                <button type="button" className="btn btn-primary btn-block" onClick={retryPayment} disabled={busy}>
                  {order.payment_status === 'failed' ? 'Retry payment' : 'Complete payment'} <IconArrow size={15} />
                </button>
              ) : null}
              {canCancel ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  style={{ marginTop: 8 }}
                  onClick={cancelOrder}
                  disabled={busy}
                >
                  Cancel order
                </button>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>
                <IconPin size={15} />{' '}
                {order.payment_method === 'pickup' ? 'Pickup from' : 'Deliver to'}
              </h3>
            </div>
            <div className="card-body small">
              <strong>{order.contact_name}</strong>
              <br />
              {order.shipping_address.line1}
              {order.shipping_address.line2 ? `, ${order.shipping_address.line2}` : ''}
              {order.shipping_address.locality ? `, ${order.shipping_address.locality}` : ''}
              <br />
              {order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.pincode}
              <br />
              <span className="muted">{order.phone}</span>
              {order.notes ? <p className="muted" style={{ marginTop: 10 }}>“{order.notes}”</p> : null}
            </div>
          </section>

          {profile?.role === 'admin' || profile?.role === 'staff' ? (
            <section className="card">
              <div className="card-head">
                <h3>Admin tools</h3>
              </div>
              <div className="card-body stack" style={{ gap: 8 }}>
                <Link to={`/admin/orders/${order.order_number}`} className="btn btn-soft btn-sm">
                  Open in admin
                </Link>
                {order.payment_method === 'razorpay' ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={runDemoWebhook} disabled={busy}>
                    Replay a signed webhook twice
                  </button>
                ) : null}
                {webhookResult ? <div className="notice notice-info tiny">{webhookResult}</div> : null}
              </div>
            </section>
          ) : null}

          <Link to="/orders" className="btn btn-ghost btn-block">
            All your orders
          </Link>
          <p className="tiny muted center">
            <IconTruck size={13} /> Questions about this order? Call the shop on{' '}
            <Link to="/about">the store number</Link>.
          </p>
        </aside>
      </div>

      {showMock && session ? (
        <MockPaymentModal
          session={session}
          onVerified={(updated) => {
            setShowMock(false)
            setData({ order: updated })
            toast.push('Payment verified', 'success')
            void reload()
          }}
          onClose={() => setShowMock(false)}
        />
      ) : null}
    </>
  )
}
