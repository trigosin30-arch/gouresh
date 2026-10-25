import { Link } from 'react-router-dom'
import { useApi } from '../../lib/useApi'
import { dateLabel, rupees, STATUS_LABELS } from '../../lib/format'
import type { AdminStats } from '../../lib/types'
import { EmptyState, Loading, StatusBadge } from '../../components/ui'
import { IconArrow } from '../../components/Icons'

export default function Dashboard() {
  const { data, loading, error } = useApi<AdminStats>('/admin/stats')

  if (loading) return <Loading label="Loading dashboard" />
  if (error || !data) return <EmptyState title="Dashboard unavailable">{error}</EmptyState>

  const { totals, orders_by_status, low_stock, recent_orders, top_products } = data
  const statuses = Object.entries(orders_by_status).sort((a, b) => b[1] - a[1])

  return (
    <>
      <div className="stat-grid">
        <div className="stat">
          <span>Paid revenue</span>
          <strong>{rupees(totals.revenue_paise)}</strong>
          <small>{totals.orders} orders placed</small>
        </div>
        <div className="stat">
          <span>Open orders</span>
          <strong>{totals.open_orders}</strong>
          <small>{totals.pending_payments} awaiting payment</small>
        </div>
        <div className="stat">
          <span>Products</span>
          <strong>{totals.products}</strong>
          <small>{rupees(totals.inventory_value_paise)} stock value</small>
        </div>
        <div className="stat">
          <span>Customers</span>
          <strong>{totals.customers}</strong>
          <small>accounts created</small>
        </div>
      </div>

      <div className="stack" style={{ gap: 18 }}>
        <section className="card">
          <div className="card-head">
            <h3>Orders needing attention</h3>
            <Link to="/admin/orders" className="btn-link small">
              All orders <IconArrow size={13} />
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {recent_orders.map((order) => (
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
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td>
                      <StatusBadge status={order.payment_status} />
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(order.total_paise)}</td>
                  </tr>
                ))}
                {recent_orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No orders yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="stat-grid" style={{ marginBottom: 0 }}>
          <div className="card card-pad">
            <h3 style={{ fontSize: '1rem' }}>Orders by status</h3>
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {statuses.length === 0 ? <span className="muted small">No orders yet.</span> : null}
              {statuses.map(([status, count]) => (
                <div key={status} className="row-between small">
                  <span>{STATUS_LABELS[status] ?? status.replace(/_/g, ' ')}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <h3 style={{ fontSize: '1rem' }}>Low stock</h3>
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {low_stock.length === 0 ? <span className="muted small">Everything is well stocked.</span> : null}
              {low_stock.map((product) => (
                <div key={product.id} className="row-between small">
                  <Link to={`/admin/products/${product.id}`}>{product.name}</Link>
                  <span className={product.stock === 0 ? 'stock-out' : 'stock-low'}>{product.stock} left</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <h3 style={{ fontSize: '1rem' }}>Best sellers</h3>
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {top_products.map((product) => (
                <div key={product.id} className="row-between small">
                  <Link to={`/admin/products/${product.id}`}>
                    {product.name.length > 30 ? `${product.name.slice(0, 30)}…` : product.name}
                  </Link>
                  <span className="muted">{product.sold_count} sold</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
