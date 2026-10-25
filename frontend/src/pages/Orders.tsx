import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { EmptyState, ErrorState, Pagination, SectionHeader, Spinner } from '../components/ui'
import { dateTime, money, orderStatusTone, titleCase } from '../format'
import type { Order } from '../types'

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)

  useEffect(() => {
    setLoading(true)
    api<{ orders: Order[]; pages: number; total: number }>(`/api/orders?page=${page}&per_page=10`)
      .then((data) => {
        setOrders(data.orders)
        setPages(data.pages)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [page])

  return (
    <>
      <Seo title="Your orders" noindex canonicalPath="/orders" />
      <div className="shell py-8">
        <SectionHeader title="Your orders" subtitle="Orders placed with this account. Guest orders can be tracked with their tracking link." />
        {loading && <Spinner label="Loading orders" />}
        {error && <ErrorState message={error} onRetry={() => window.location.reload()} />}
        {!loading && !error && orders.length === 0 && (
          <EmptyState
            title="No orders yet"
            message="Orders you place while signed in will appear here."
            action={<Link to="/products" className="btn-primary">Start shopping</Link>}
            icon="🧾"
          />
        )}
        {!loading && !error && orders.length > 0 && (
          <div className="space-y-3">
            {orders.map((order) => (
              <article key={order.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-navy-900">{order.order_number}</p>
                    <p className="text-xs text-slate-500">
                      Placed {dateTime(order.placed_at)} · {titleCase(order.order_type)} · {order.items.length} item
                      {order.items.length === 1 ? '' : 's'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={orderStatusTone(order.status)}>{titleCase(order.status)}</span>
                      <span className="badge-muted">
                        {titleCase(order.payment_method)} · {titleCase(order.payment_status)}
                      </span>
                      <span className="badge-muted">{order.fulfillment_type === 'pickup' ? 'Store pickup' : 'Home delivery'}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-semibold text-navy-900">{money(order.total_paise)}</p>
                    <Link to={`/orders/${order.id}`} className="btn-secondary btn-sm mt-2">View order</Link>
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-600">
                  {order.items.slice(0, 3).map((item) => (
                    <li key={item.id}>
                      {item.quantity} × {item.title}
                    </li>
                  ))}
                  {order.items.length > 3 && <li>+ {order.items.length - 3} more</li>}
                </ul>
              </article>
            ))}
            <Pagination page={page} pages={pages} onChange={setPage} />
          </div>
        )}
        <p className="mt-8 text-sm text-slate-600">
          Placed an order as a guest? Use the <Link to="/track-order" className="link">order tracking page</Link> with your order number and email.
        </p>
      </div>
    </>
  )
}
