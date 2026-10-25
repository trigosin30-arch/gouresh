import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal, Pagination } from '../components/ui'
import { dateOnly, dateTime, money, titleCase } from '../format'
import { AdminHeader, Empty, Panel, StatusPill } from './ui'
import type { AdminCustomer } from './types'
import type { Order } from '../types'

type Detail = {
  customer: AdminCustomer
  orders: (Order & { customer_name?: string })[]
  addresses: { id: string; label: string; city: string; state: string; pincode: string; is_default: boolean }[]
  listings: { id: string; listing_code: string; title: string; status: string }[]
  note: string
}

export default function CustomersAdmin() {
  const { user, toast } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminCustomer[]>([])
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [statusModal, setStatusModal] = useState<AdminCustomer | null>(null)
  const [restrictForm, setRestrictForm] = useState({ status: 'restricted', reason: '' })
  const [roleModal, setRoleModal] = useState<AdminCustomer | null>(null)
  const [newRole, setNewRole] = useState('staff')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '25' })
      if (q.trim()) params.set('q', q.trim())
      if (role) params.set('role', role)
      const data = await api<{ customers: AdminCustomer[]; pages: number }>(`/api/admin/customers?${params}`)
      setItems(data.customers)
      setPages(data.pages)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, q, role])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (customer: AdminCustomer) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      const data = await api<Detail>(`/api/admin/customers/${customer.id}`)
      setDetail(data)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  const saveStatus = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!statusModal) return
    setBusy(true)
    try {
      await api(`/api/admin/customers/${statusModal.id}/status`, { method: 'POST', body: restrictForm })
      toast(restrictForm.status === 'restricted' ? 'Account restricted.' : 'Account reactivated.')
      setStatusModal(null)
      await load()
      if (detail?.customer.id === statusModal.id) await openDetail(statusModal)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveRole = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!roleModal) return
    setBusy(true)
    try {
      await api(`/api/admin/customers/${roleModal.id}/role`, { method: 'POST', body: { role: newRole } })
      toast(`Role changed to ${newRole}.`)
      setRoleModal(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <AdminHeader
        title="Customers & staff"
        description="Accounts registered on this store. Passwords and payment credentials are never exposed here."
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="label">Search</span>
          <input
            className="input"
            placeholder="Name, email or phone"
            value={q}
            onChange={(event) => {
              setPage(1)
              setQ(event.target.value)
            }}
          />
        </label>
        <label>
          <span className="label">Role</span>
          <select
            className="input"
            value={role}
            onChange={(event) => {
              setPage(1)
              setRole(event.target.value)
            }}
          >
            <option value="">All roles</option>
            <option value="customer">Customers</option>
            <option value="staff">Staff</option>
            <option value="admin">Administrators</option>
          </select>
        </label>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Contact</th><th>Role</th><th>Status</th><th>Joined</th><th /></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="py-6 text-center text-sm text-slate-500">Loading customers…</td></tr>}
              {!loading && items.length === 0 && <tr><td colSpan={6} className="py-6"><Empty title="No accounts match" /></td></tr>}
              {items.map((customer) => (
                <tr key={customer.id}>
                  <td className="font-medium text-navy-900">{customer.full_name}</td>
                  <td>
                    <p className="text-xs">{customer.email}</p>
                    {customer.phone && <p className="text-xs text-slate-500">{customer.phone}</p>}
                  </td>
                  <td><span className="badge-muted">{customer.role}</span></td>
                  <td><StatusPill status={customer.status} /></td>
                  <td className="text-xs">{dateOnly(customer.created_at)}</td>
                  <td>
                    <button type="button" className="link text-xs" onClick={() => void openDetail(customer)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {detailLoading && <p className="text-sm text-slate-500">Loading customer…</p>}
          {!detail && !detailLoading && (
            <Panel title="Select an account" description="Choose a row to see their orders, saved addresses and listings.">
              <p className="text-sm text-slate-500">No account selected.</p>
            </Panel>
          )}
          {detail && (
            <>
              <Panel
                title={detail.customer.full_name}
                description={`${detail.customer.email}${detail.customer.phone ? ` · ${detail.customer.phone}` : ''}`}
                actions={<StatusPill status={detail.customer.status} />}
              >
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Role</dt><dd>{detail.customer.role}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Joined</dt><dd>{dateTime(detail.customer.created_at)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Email verified</dt><dd>{detail.customer.email_verified ? 'yes' : 'no'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Orders</dt><dd>{detail.orders.length}</dd></div>
                </dl>
                {isAdmin ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setStatusModal(detail.customer)
                        setRestrictForm({ status: detail.customer.status === 'restricted' ? 'active' : 'restricted', reason: '' })
                      }}
                    >
                      {detail.customer.status === 'restricted' ? 'Reactivate account' : 'Restrict account'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setRoleModal(detail.customer)
                        setNewRole(detail.customer.role === 'customer' ? 'staff' : 'customer')
                      }}
                    >
                      Change role
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-amber-800">Changing account status or roles requires an administrator.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">{detail.note}</p>
              </Panel>

              <Panel title="Recent orders">
                {detail.orders.length === 0 ? (
                  <p className="text-sm text-slate-500">No orders for this account.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {detail.orders.map((order) => (
                      <li key={order.id} className="flex items-center justify-between gap-2 py-2">
                        <span>
                          <Link to={`/admin/orders/${order.id}`} className="link">{order.order_number}</Link>
                          <span className="block text-xs text-slate-500">{dateOnly(order.placed_at)}</span>
                        </span>
                        <span className="text-right">
                          {money(order.total_paise)}
                          <StatusPill status={order.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {detail.addresses.length > 0 && (
                <Panel title="Saved addresses" description="City and PIN only in this view.">
                  <ul className="space-y-1 text-sm">
                    {detail.addresses.map((address) => (
                      <li key={address.id}>
                        {address.label}: {address.city}, {address.state} {address.pincode}
                        {address.is_default && <span className="badge-ok ml-1">default</span>}
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              {detail.listings.length > 0 && (
                <Panel title="Marketplace listings">
                  <ul className="space-y-1 text-sm">
                    {detail.listings.map((listing) => (
                      <li key={listing.id} className="flex items-center justify-between gap-2">
                        <span>{listing.title} <span className="text-xs text-slate-500">({listing.listing_code})</span></span>
                        <StatusPill status={listing.status} />
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        <Pagination page={page} pages={pages} onChange={setPage} />
      </div>

      <Modal
        open={statusModal !== null}
        onClose={() => setStatusModal(null)}
        title={restrictForm.status === 'restricted' ? 'Restrict account' : 'Reactivate account'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setStatusModal(null)}>Cancel</button>
            <button type="submit" form="status-form" className={restrictForm.status === 'restricted' ? 'btn-danger' : 'btn-primary'} disabled={busy}>
              {restrictForm.status === 'restricted' ? 'Restrict' : 'Reactivate'}
            </button>
          </>
        }
      >
        <form id="status-form" onSubmit={saveStatus} className="space-y-3">
          <p className="text-sm text-slate-600">
            {restrictForm.status === 'restricted'
              ? 'A restricted account can sign in and view its history, but cannot place orders, submit books or create listings.'
              : 'The account will be able to place orders and use the marketplace again.'}
          </p>
          <Field label="Reason" hint="Recorded in the audit log.">
            <input className="input" value={restrictForm.reason} onChange={(event) => setRestrictForm({ ...restrictForm, reason: event.target.value })} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={roleModal !== null}
        onClose={() => setRoleModal(null)}
        title="Change account role"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRoleModal(null)}>Cancel</button>
            <button type="submit" form="role-form" className="btn-danger" disabled={busy}>Change role</button>
          </>
        }
      >
        <form id="role-form" onSubmit={saveRole} className="space-y-3">
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Staff can view customer data and fulfil orders. Administrators can also change settings, prices and refunds. Grant the minimum role
            needed, and remove access when someone leaves.
          </p>
          <Field label="Role" required>
            <select className="input" value={newRole} onChange={(event) => setNewRole(event.target.value)}>
              <option value="customer">Customer</option>
              <option value="staff">Staff</option>
              <option value="admin">Administrator</option>
            </select>
          </Field>
          <p className="text-xs text-slate-500">You cannot change your own role, and the API refuses to remove the last active administrator.</p>
        </form>
      </Modal>
    </div>
  )
}
