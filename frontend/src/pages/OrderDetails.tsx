import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Breadcrumbs, EmptyState, ErrorState, InfoRow, Modal, SectionHeader, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { dateTime, money, orderStatusTone, paymentTone, titleCase } from '../format'
import type { Order } from '../types'

export default function OrderDetails() {
  const { id } = useParams()
  const { toast, confirm } = useStore()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestModal, setRequestModal] = useState<'cancellation' | 'return' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<Order>(`/api/orders/${id}`)
      setOrder(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const cancelOrder = async () => {
    if (!order) return
    const ok = await confirm({
      title: 'Cancel this order?',
      message: 'Stock will be returned to the store. If you already paid, a refund will be arranged by the store.',
      confirmLabel: 'Cancel order',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const data = await api<{ order: Order }>(`/api/orders/${order.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by customer' } })
      setOrder(data.order)
      toast('Order cancelled.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!order || !requestModal) return
    setBusy(true)
    try {
      await api(`/api/orders/${order.id}/return-request`, {
        method: 'POST',
        body: { request_type: requestModal, reason },
      })
      setRequestModal(null)
      setReason('')
      await load()
      toast('Request submitted. The store will review it.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="shell py-10">
        <Spinner label="Loading order" />
      </div>
    )
  }
  if (error || !order) {
    return (
      <div className="shell py-10">
        <EmptyState
          title="Order not available"
          message={error || 'We could not find this order for your account.'}
          action={
            <div className="flex gap-2">
              <Link to="/orders" className="btn-primary">Your orders</Link>
              <Link to="/track-order" className="btn-secondary">Track an order</Link>
            </div>
          }
          icon="🧾"
        />
      </div>
    )
  }

  return (
    <>
      <Seo title={`Order ${order.order_number}`} noindex canonicalPath={`/orders/${order.id}`} />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Orders', to: '/orders' }, { label: order.order_number }]} />
        <SectionHeader
          title={`Order ${order.order_number}`}
          subtitle={`Placed ${dateTime(order.placed_at)} · ${order.fulfillment_type === 'pickup' ? 'Store pickup' : 'Home delivery'}`}
          action={
            <div className="flex flex-wrap gap-2">
              <a
                className="btn-secondary btn-sm"
                href={`/api/orders/${order.id}/document?kind=invoice`}
                target="_blank"
                rel="noreferrer"
              >
                Invoice
              </a>
              {order.can_cancel && (
                <button type="button" className="btn-danger btn-sm" onClick={() => void cancelOrder()} disabled={busy}>
                  Cancel order
                </button>
              )}
              {order.can_request_return && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setRequestModal('return')}>
                  Request return
                </button>
              )}
            </div>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
          <div className="space-y-4">
            <section className="card p-5">
              <h2 className="text-base font-semibold text-navy-900">Items</h2>
              <ul className="mt-3 divide-y divide-slate-100">
                {order.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="font-medium text-navy-900">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        Qty {item.quantity}
                        {item.condition && item.condition !== 'new' ? ` · ${titleCase(item.condition)}` : ''}
                      </p>
                    </div>
                    <p className="font-medium">{money(item.line_total_paise)}</p>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(order.subtotal_paise)}</dd></div>
                {order.discount_paise > 0 && (
                  <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd>− {money(order.discount_paise)}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-slate-600">Delivery</dt><dd>{money(order.delivery_fee_paise)}</dd></div>
                {order.tax_paise > 0 && <div className="flex justify-between"><dt className="text-slate-600">Tax</dt><dd>{money(order.tax_paise)}</dd></div>}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><dt>Total</dt><dd>{money(order.total_paise)}</dd></div>
                {order.refunded_paise > 0 && (
                  <div className="flex justify-between text-amber-800"><dt>Refunded</dt><dd>{money(order.refunded_paise)}</dd></div>
                )}
              </dl>
            </section>

            <section className="card p-5">
              <h2 className="text-base font-semibold text-navy-900">Progress</h2>
              {order.events && order.events.length > 0 ? (
                <ol className="mt-3 space-y-3">
                  {order.events.map((event, index) => (
                    <li key={`${event.type}-${index}`} className="flex gap-3">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-navy-700" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-navy-900">{titleCase(event.to_status || event.type)}</p>
                        <p className="text-xs text-slate-500">{dateTime(event.created_at)} · {event.actor}</p>
                        {event.note && <p className="mt-0.5 text-sm text-slate-600">{event.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No status updates recorded yet.</p>
              )}
              {order.shipment?.tracking_number && (
                <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Tracking: {order.shipment.carrier ? `${order.shipment.carrier} · ` : ''}{order.shipment.tracking_number}
                </p>
              )}
            </section>

            {order.returns && order.returns.length > 0 && (
              <section className="card p-5">
                <h2 className="text-base font-semibold text-navy-900">Requests</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {order.returns.map((request) => (
                    <li key={request.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="font-medium text-navy-900">
                        {titleCase(request.request_type)} · {request.reference}{' '}
                        <span className="badge-muted ml-1">{titleCase(request.status)}</span>
                      </p>
                      <p className="text-xs text-slate-500">{dateTime(request.created_at)}</p>
                      <p className="mt-1 text-slate-600">{request.reason}</p>
                      {request.admin_note && <p className="mt-1 text-xs text-slate-600">Store: {request.admin_note}</p>}
                      {request.refund_amount_paise ? <p className="mt-1 text-xs text-emerald-700">Refund recorded: {money(request.refund_amount_paise)}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-4">
            <div className="card p-5">
              <h2 className="text-base font-semibold text-navy-900">Status</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={orderStatusTone(order.status)}>{titleCase(order.status)}</span>
                <span className={paymentTone(order.payment_status)}>{titleCase(order.payment_status)}</span>
              </div>
              <dl className="mt-3 divide-y divide-slate-100">
                <InfoRow label="Payment method" value={titleCase(order.payment_method)} />
                <InfoRow label="Fulfilment" value={order.fulfillment_type === 'pickup' ? 'Store pickup' : 'Home delivery'} />
                {order.delivered_at && <InfoRow label="Delivered" value={dateTime(order.delivered_at)} />}
                {order.cancelled_at && <InfoRow label="Cancelled" value={dateTime(order.cancelled_at)} />}
              </dl>
            </div>
            {order.shipping_address && (
              <div className="card p-5 text-sm">
                <h2 className="text-base font-semibold text-navy-900">Delivery address</h2>
                <p className="mt-2 text-slate-600">
                  {order.shipping_address.line1}
                  {order.shipping_address.line2 ? <>, {order.shipping_address.line2}</> : null}
                  <br />
                  {order.shipping_address.locality}, {order.shipping_address.city}, {order.shipping_address.state}{' '}
                  {order.shipping_address.pincode}
                </p>
              </div>
            )}
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-base font-semibold text-navy-900">Need help?</h2>
              <p className="mt-1">
                Quote order {order.order_number} when contacting the store. See the{' '}
                <Link to="/returns-refunds" className="link">returns policy</Link> for eligibility.
              </p>
              <Link to="/contact" className="btn-secondary btn-sm mt-2">Contact the store</Link>
            </div>
          </aside>
        </div>

        <Modal
          open={requestModal !== null}
          onClose={() => setRequestModal(null)}
          title={requestModal === 'return' ? 'Request a return' : 'Request cancellation'}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setRequestModal(null)}>Close</button>
              <button type="submit" form="request-form" className="btn-primary" disabled={busy}>Submit request</button>
            </>
          }
        >
          <form id="request-form" onSubmit={submitRequest} className="space-y-3">
            <p className="text-sm text-slate-600">
              The store reviews every request. Refunds are recorded only after the store approves and processes the return.
            </p>
            <label>
              <span className="label">Reason</span>
              <textarea
                className="input"
                rows={4}
                required
                minLength={10}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Describe the problem (at least 10 characters)."
              />
            </label>
          </form>
        </Modal>
      </div>
    </>
  )
}
