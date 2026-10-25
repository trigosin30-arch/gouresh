import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { dateTime, money } from '../format'
import { Empty, MoneyCell, Panel, Stat, StatusPill, AdminHeader } from './ui'
import type { DashboardPayload } from './types'

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
]

export default function Dashboard() {
  const [range, setRange] = useState('30d')
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api<DashboardPayload>(`/api/admin/dashboard?range=${range}`))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const setupItems = data
    ? [
        { key: 'store_phone_set', label: 'Store phone number published', done: data.setup.store_phone_set },
        { key: 'contact_email_set', label: 'Contact email published', done: data.setup.contact_email_set },
        { key: 'opening_hours_set', label: 'Opening hours published', done: data.setup.opening_hours_set },
        { key: 'delivery_configured', label: 'Delivery areas and fee configured', done: data.setup.delivery_configured },
        { key: 'cod_enabled', label: 'Cash on delivery enabled', done: data.setup.cod_enabled },
        { key: 'online_payments_configured', label: 'Online payment gateway credentials configured', done: data.setup.online_payments_configured },
        { key: 'email_provider_configured', label: 'Email provider configured (otherwise notifications are stored, not sent)', done: data.setup.email_provider_configured },
      ]
    : []

  return (
    <div>
      <AdminHeader
        title="Dashboard"
        description="Live figures from this store's database. Nothing here is estimated or forecast."
        actions={
          <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {RANGES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setRange(option.id)}
                aria-pressed={range === option.id}
                className={`rounded-md px-2.5 py-1 text-xs ${range === option.id ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && !data && <p className="text-sm text-slate-500">Loading dashboard…</p>}

      {data && (
        <div className="space-y-5">
          {data.setup.demo_mode && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Demo mode.</strong> The catalogue, listings, FAQs and policies in this database are clearly labelled sample data. Replace them
              with verified business information and remove the demo accounts before launch.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Net revenue"
              value={money(data.metrics.net_revenue_paise)}
              hint={`Paid orders in range, minus ${money(data.metrics.refunds_paise)} refunds`}
            />
            <Stat label="Orders in range" value={data.metrics.orders_count} hint={`${data.orders.needs_action} of ${data.orders.total} orders need action`} tone={data.orders.needs_action ? 'warn' : 'neutral'} />
            <Stat label="Awaiting payment" value={money(data.metrics.pending_payment_paise)} hint="Recorded as unpaid; not counted as revenue" />
            <Stat
              label="Low stock items"
              value={data.catalogue.low_stock}
              tone={data.catalogue.low_stock ? 'warn' : 'good'}
              hint={`${data.catalogue.out_of_stock} out of stock or enquiry-only`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.6fr,1fr]">
            <Panel
              title="Needs attention"
              description="Queue counts read live from the database."
              actions={<Link to="/admin/orders" className="btn-secondary btn-sm">Open orders</Link>}
            >
              <ul className="divide-y divide-slate-100 text-sm">
                <QueueRow to="/admin/orders?status=placed" label="New orders awaiting processing" count={data.orders.by_status.placed || 0} />
                <QueueRow to="/admin/orders?status=processing" label="Orders in processing" count={data.orders.by_status.processing || 0} />
                <QueueRow to="/admin/orders?status=packed" label="Orders packed" count={data.orders.by_status.packed || 0} />
                <QueueRow to="/admin/marketplace" label="Used-book submissions to review" count={data.marketplace.pending_submissions} />
                <QueueRow to="/admin/marketplace?tab=listings" label="Listings pending moderation" count={data.marketplace.pending_listings} />
                <QueueRow to="/admin/quotations" label="Bulk requests awaiting a quote" count={data.quotations.awaiting_quote} />
                <QueueRow to="/admin/operations?tab=returns" label="Open return / cancellation requests" count={data.returns.open} />
                <QueueRow to="/admin/marketplace?tab=reports" label="Open listing reports" count={data.marketplace.open_reports} />
              </ul>
            </Panel>

            <Panel title="Setup checklist" description="These are the store details customers rely on.">
              <ul className="space-y-2 text-sm">
                {setupItems.map((item) => (
                  <li key={item.key} className="flex items-start gap-2">
                    <span className={item.done ? 'text-emerald-600' : 'text-amber-500'} aria-hidden="true">
                      {item.done ? '✓' : '○'}
                    </span>
                    <span className={item.done ? 'text-slate-600' : 'text-slate-800'}>{item.label}</span>
                    <span className="sr-only">{item.done ? 'complete' : 'incomplete'}</span>
                  </li>
                ))}
              </ul>
              <Link to="/admin/settings" className="btn-secondary btn-sm mt-3">Open store settings</Link>
            </Panel>
          </div>

          <Panel title="Recent orders" description={`Latest ${data.recent_orders.length} orders in the database.`}>
            {data.recent_orders.length === 0 ? (
              <Empty title="No orders yet" hint="Orders placed on the storefront will appear here immediately." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Placed</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_orders.map((order) => (
                      <tr key={order.id}>
                        <td className="font-medium text-navy-900">{order.order_number}</td>
                        <td>{order.customer_name || 'Guest'}</td>
                        <td><MoneyCell paise={order.total_paise} /></td>
                        <td>
                          <StatusPill status={order.payment_status} />
                        </td>
                        <td><StatusPill status={order.status} /></td>
                        <td className="whitespace-nowrap text-xs text-slate-500">{dateTime(order.placed_at)}</td>
                        <td>
                          <Link to={`/admin/orders/${order.id}`} className="link text-xs">Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Catalogue" description="Active products only.">
              <dl className="space-y-1.5 text-sm">
                <Row label="Active products" value={String(data.catalogue.active_products)} />
                <Row label="Draft products" value={String(data.catalogue.draft_products)} />
                <Row label="Low stock" value={String(data.catalogue.low_stock)} />
                <Row label="Out of stock / enquiry" value={String(data.catalogue.out_of_stock)} />
              </dl>
              <Link to="/admin/products" className="btn-secondary btn-sm mt-3">Manage products</Link>
            </Panel>
            <Panel title="Marketplace" description="Second-hand books.">
              <dl className="space-y-1.5 text-sm">
                <Row label="Active listings" value={String(data.marketplace.active_listings)} />
                <Row label="Pending listings" value={String(data.marketplace.pending_listings)} />
                <Row label="Pending submissions" value={String(data.marketplace.pending_submissions)} />
                <Row label="Open reports" value={String(data.marketplace.open_reports)} />
              </dl>
              <Link to="/admin/marketplace" className="btn-secondary btn-sm mt-3">Moderate listings</Link>
            </Panel>
            <Panel title="Payments recorded" description="Grouped by recorded payment status.">
              {Object.keys(data.payments).length === 0 ? (
                <p className="text-sm text-slate-500">No payment records yet.</p>
              ) : (
                <dl className="space-y-1.5 text-sm">
                  {Object.entries(data.payments).map(([status, info]) => (
                    <Row key={status} label={`${status.replace(/_/g, ' ')} (${info.count})`} value={money(info.amount_paise)} />
                  ))}
                </dl>
              )}
              <p className="mt-3 text-xs text-slate-500">Customers: {data.customers} accounts with the customer role.</p>
            </Panel>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            <p><strong className="text-slate-700">How net revenue is calculated:</strong> {data.definitions.net_revenue}</p>
            <p className="mt-1"><strong className="text-slate-700">Needs action:</strong> {data.definitions.needs_action}</p>
            <p className="mt-1">Cash-on-delivery money is counted only after staff mark the order delivered and the payment is recorded as collected.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function QueueRow({ label, count, to }: { label: string; count: number; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-3 py-2 hover:text-navy-900">
        <span>{label}</span>
        <span className={count > 0 ? 'badge-warn' : 'badge-muted'}>{count}</span>
      </Link>
    </li>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="capitalize text-slate-600">{label}</dt>
      <dd className="font-medium text-navy-900">{value}</dd>
    </div>
  )
}
