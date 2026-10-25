import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useApi } from '../lib/useApi'
import { dateLabel, PAYMENT_LABELS, rupees } from '../lib/format'
import type { Order } from '../lib/types'
import { EmptyState, Loading, StatusBadge } from '../components/ui'
import { IconArrow } from '../components/Icons'
import { useEffect } from 'react'

export default function Orders() {
  const { profile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error } = useApi<{ items: Order[] }>(profile ? '/orders' : null)

  useEffect(() => {
    if (!authLoading && !profile) navigate('/login?next=/orders', { replace: true })
  }, [authLoading, profile, navigate])

  if (authLoading || loading) return <Loading label="Loading your orders" />
  if (error) return <EmptyState title="Could not load orders">{error}</EmptyState>

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Your orders</h1>
          <p>Every order placed online, with the same status the shop counter sees.</p>
        </div>
        <Link to="/shop" className="btn btn-ghost btn-sm">
          Shop again
        </Link>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          title="No orders yet"
          action={
            <Link to="/shop" className="btn btn-primary">
              Start shopping
            </Link>
          }
        >
          Once you place an order it will appear here, and you can follow it through packing and delivery.
        </EmptyState>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {data.items.map((order) => (
            <article key={order.id} className="order-card">
              <div className="order-card-head">
                <div>
                  <strong>{order.order_number}</strong>
                  <div className="small muted">
                    {dateLabel(order.created_at)} · {order.items.length} item
                    {order.items.length === 1 ? '' : 's'} · {rupees(order.total_paise)}
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <StatusBadge status={order.status} />
                  <StatusBadge status={order.payment_status} />
                  <Link to={`/orders/${order.order_number}`} className="btn btn-soft btn-sm">
                    Details <IconArrow size={14} />
                  </Link>
                </div>
              </div>
              <div className="order-card-body">
                <div className="order-thumbs">
                  {order.items.slice(0, 4).map((item) => (
                    <div key={item.id} className="thumb-fallback tiny" style={{ background: 'var(--paper-2)' }}>
                      <span style={{ fontSize: '0.66rem' }}>{item.name.slice(0, 2).toUpperCase()}</span>
                    </div>
                  ))}
                </div>
                <div className="grow">
                  <div className="small">
                    {order.items
                      .slice(0, 2)
                      .map((item) => item.name)
                      .join(' · ')}
                    {order.items.length > 2 ? ` +${order.items.length - 2} more` : ''}
                  </div>
                  <div className="tiny muted">
                    {order.payment_method === 'razorpay'
                      ? 'Paid online'
                      : order.payment_method === 'cod'
                        ? 'Cash on delivery'
                        : 'Store pickup'}{' '}
                    · {PAYMENT_LABELS[order.payment_status]}
                    {order.tracking_number ? ` · ${order.courier}: ${order.tracking_number}` : ''}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
