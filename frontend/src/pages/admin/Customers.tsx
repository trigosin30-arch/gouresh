import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { shortDate } from '../../lib/format'
import type { Profile } from '../../lib/types'
import { EmptyState, Loading } from '../../components/ui'
import { IconSearch } from '../../components/Icons'

export default function AdminCustomers() {
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const query = params.get('q') ? `&q=${encodeURIComponent(params.get('q') as string)}` : ''
  const { data, loading, error, reload } = useApi<{ items: Profile[] }>(`/admin/users?limit=200${query}`)
  const { profile: me } = useAuth()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const changeRole = async (user: Profile, role: string) => {
    setBusyId(user.id)
    try {
      await api.patch(`/admin/users/${user.id}/role`, { role })
      toast.push(`${user.email} is now ${role}`, 'success')
      void reload()
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Could not change role', 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>Customers</h2>
          <p className="small muted">Accounts are created on first sign-in. Roles control admin access.</p>
        </div>
        <form
          className="search-inline"
          onSubmit={(event) => {
            event.preventDefault()
            const next = new URLSearchParams(params)
            if (term.trim()) next.set('q', term.trim())
            else next.delete('q')
            setParams(next, { replace: true })
          }}
        >
          <input
            className="input"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search name or email"
            aria-label="Search customers"
          />
          <button type="submit" className="btn btn-soft" aria-label="Search">
            <IconSearch size={16} />
          </button>
        </form>
      </div>

      {error ? (
        <EmptyState title="Could not load customers">{error}</EmptyState>
      ) : loading ? (
        <Loading label="Loading customers" />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Joined</th>
                  <th>Orders</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.full_name}</strong>
                      <div className="tiny muted">{user.email}</div>
                    </td>
                    <td className="small">{user.phone ?? '—'}</td>
                    <td className="small muted">{shortDate(user.created_at)}</td>
                    <td>{user.order_count ?? 0}</td>
                    <td>
                      <select
                        className="select"
                        style={{ width: 'auto', padding: '6px 10px', fontSize: '0.84rem' }}
                        value={user.role}
                        onChange={(event) => changeRole(user, event.target.value)}
                        disabled={busyId === user.id || user.id === me?.id}
                        aria-label={`Role for ${user.email}`}
                      >
                        <option value="customer">Customer</option>
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Role changes are written to the audit log. You cannot remove your own admin role.
      </p>
    </>
  )
}
