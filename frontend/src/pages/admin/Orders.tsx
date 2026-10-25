import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi'
import { dateLabel, rupees, STATUS_LABELS } from '../../lib/format'
import type { Order } from '../../lib/types'
import { EmptyState, Loading, StatusBadge } from '../../components/ui'
import { IconSearch } from '../../components/Icons'

interface OrdersResponse {
  items: Order[]
  total: number
  page: number
  pages: number
}

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'payment_pending', label: 'Awaiting payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'packed', label: 'Packed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function AdminOrders() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'all'
  const page = Number(params.get('page') ?? 1)
  const [term, setTerm] = useState(params.get('q') ?? '')
  const query = `/admin/orders?status=${status}&page=${page}&page_size=20${
    params.get('q') ? `&q=${encodeURIComponent(params.get('q') as string)}` : ''
  }`
  const { data, loading, error } = useApi<OrdersResponse>(query)

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    setParams(next, { replace: true })
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>Orders</h2>
          <p className="small muted">Fulfilment queue, payment state and cancellations.</p>
        </div>
        <form
          className="search-inline"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: term.trim() || undefined, page: undefined })
          }}
        >
          <input
            className="input"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Order no., name, phone"
            aria-label="Search orders"
          />
          <button type="submit" className="btn btn-soft" aria-label="Search">
            <IconSearch size={16} />
          </button>
        </form>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={status === tab.value}
            className={status === tab.value ? 'active' : ''}
            onClick={() => update({ status: tab.value === 'all' ? undefined : tab.value, page: undefined })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <EmptyState title="Could not load orders">{error}</EmptyState>
      ) : loading ? (
        <Loading label="Loading orders" />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No orders in this view">Orders will appear here as customers check out.</EmptyState>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to={`/admin/orders/${order.order_number}`} className="mono">
                        {order.order_number}
                      </Link>
                      <div className="tiny muted">{dateLabel(order.created_at)}</div>
                    </td>
                    <td>
                      {order.contact_name}
                      <div className="tiny muted">{order.phone}</div>
                    </td>
                    <td className="small">
                      {order.payment_method === 'razorpay' ? 'Online' : order.payment_method === 'cod' ? 'COD' : 'Pickup'}
                    </td>
                    <td>
                      <StatusBadge status={order.status} />
                      <div className="tiny muted">{STATUS_LABELS[order.status]}</div>
                    </td>
                    <td>
                      <StatusBadge status={order.payment_status} />
                    </td>
                    <td style={{ textAlign: 'right' }} className="nowrap">
                      {rupees(order.total_paise)}
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link to={`/admin/orders/${order.order_number}`} className="btn btn-ghost btn-sm">
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.pages > 1 ? (
            <div className="card-foot row-between">
              <span className="small muted">
                Page {data.page} of {data.pages} · {data.total} orders
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                  Previous
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={page >= data.pages} onClick={() => update({ page: String(page + 1) })}>
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  )
}
