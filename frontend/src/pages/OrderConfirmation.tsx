import { Link, useLocation } from 'react-router-dom'
import Seo from '../components/Seo'
import { EmptyState } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { money, orderStatusTone, titleCase } from '../format'
import type { Order } from '../types'

type State = { order?: Order; contactEmail?: string; paymentPending?: boolean }

export default function OrderConfirmation() {
  const location = useLocation()
  const state = (location.state || {}) as State
  const { user } = useStore()
  const order = state.order

  if (!order) {
    return (
      <div className="shell py-12">
        <EmptyState
          title="No recent order to show"
          message="If you just placed an order, open it from your order history or use the tracking page."
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

  const trackPath = `/track-order?token=${order.tracking_token}`

  return (
    <>
      <Seo title={`Order ${order.order_number} confirmed`} noindex canonicalPath="/order-confirmation" />
      <div className="shell py-10">
        <div className="card mx-auto max-w-3xl overflow-hidden">
          <div className="bg-emerald-50 px-6 py-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              {state.paymentPending ? 'Order recorded — payment pending' : 'Thank you — your order is recorded'}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-navy-900">Order {order.order_number}</h1>
            <p className="mt-1 text-sm text-slate-700">
              {state.paymentPending
                ? 'We have saved your order and reserved stock briefly. Complete the online payment to confirm it; if payment is not completed the reservation is released automatically.'
                : order.fulfillment_type === 'delivery'
                  ? 'The store will contact you using the details you provided about delivery.'
                  : 'Collect your order from 147 Moolraj Road, Jalandhar Cantt during store hours.'}
            </p>
          </div>
          <div className="grid gap-6 px-6 py-6 sm:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold text-navy-900">Order status</h2>
              <p className="mt-2">
                <span className={orderStatusTone(order.status)}>{titleCase(order.status)}</span>
              </p>
              <p className="mt-2 text-sm text-slate-600">Payment: {titleCase(order.payment_status)} · {titleCase(order.payment_method)}</p>
              <p className="mt-1 text-sm text-slate-600">Total: <strong>{money(order.total_paise)}</strong></p>
              {order.delivery_fee_paise > 0 && <p className="text-xs text-slate-500">Includes {money(order.delivery_fee_paise)} delivery fee.</p>}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-navy-900">Items</h2>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span className="min-w-0">
                      <span className="line-clamp-2">{item.title}</span>
                      <span className="text-xs text-slate-500">Qty {item.quantity}</span>
                    </span>
                    <span>{money(item.line_total_paise)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-200 px-6 py-4">
            <p className="text-sm text-slate-600">
              Keep this link to check the status at any time — it works without signing in:
            </p>
            <Link to={trackPath} className="link mt-1 block break-all text-sm">
              {typeof window !== 'undefined' ? `${window.location.origin}${trackPath}` : trackPath}
            </Link>
            <div className="mt-4 flex flex-wrap gap-2">
              {user ? (
                <Link to={`/orders/${order.id}`} className="btn-primary">Open order details</Link>
              ) : (
                <Link to="/register" className="btn-primary">Create an account to track orders</Link>
              )}
              <Link to="/products" className="btn-secondary">Continue shopping</Link>
              <Link to={`/api/orders/${order.id}/document?kind=invoice&token=${order.tracking_token}`} className="btn-ghost" target="_blank" rel="noreferrer">
                View invoice
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
