import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Pagination } from '../components/ui'
import { dateTime } from '../format'
import { AdminHeader, Empty, StatusPill, Tabs } from './ui'
import type { AdminAuditEntry, AdminNotification } from './types'

export default function AuditAdmin() {
  const [tab, setTab] = useState('audit')
  return (
    <div>
      <AdminHeader
        title="Audit & notifications"
        description="Every privileged action is recorded with the actor and the before/after values. Notification delivery is shown exactly as it happened."
      />
      <Tabs
        tabs={[
          { id: 'audit', label: 'Audit log' },
          { id: 'notifications', label: 'Notification log' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'audit' ? <Audit /> : <Notifications />}
    </div>
  )
}

function Audit() {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '50' })
      if (q.trim()) params.set('q', q.trim())
      const data = await api<{ entries: AdminAuditEntry[]; pages: number }>(`/api/admin/audit?${params}`)
      setEntries(data.entries)
      setPages(data.pages)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, q])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3">
      <label className="block max-w-md">
        <span className="label">Search audit entries</span>
        <input
          className="input"
          placeholder="Action, actor email or entity type"
          value={q}
          onChange={(event) => {
            setPage(1)
            setQ(event.target.value)
          }}
        />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading audit log…</p>}
      {!loading && entries.length === 0 && <Empty title="No audit entries match" hint="Actions appear here as soon as staff or administrators make changes." />}

      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs">{dateTime(entry.created_at)}</td>
                  <td className="text-xs">{entry.actor_email || 'system'}</td>
                  <td className="font-mono text-xs">{entry.action}</td>
                  <td className="text-xs">
                    {entry.entity_type || '—'}
                    {entry.entity_id ? <span className="block text-[11px] text-slate-400">{entry.entity_id.slice(0, 12)}…</span> : null}
                  </td>
                  <td>
                    {entry.before || entry.after ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-navy-700">View changes</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                          {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pages={pages} onChange={setPage} />
    </div>
  )
}

function Notifications() {
  const [items, setItems] = useState<AdminNotification[]>([])
  const [providers, setProviders] = useState<{ email_configured: boolean; sms_configured: boolean; whatsapp_configured: boolean; note: string } | null>(null)
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const query = channel ? `?channel=${channel}` : ''
      const data = await api<{ notifications: AdminNotification[]; providers: typeof providers }>(`/api/admin/notifications${query}`)
      setItems(data.notifications)
      setProviders(data.providers)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [channel])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Channel</span>
          <select className="input" value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="">All channels</option>
            <option value="in_app">In-app</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>
      </div>

      {providers && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <p className="font-semibold text-navy-900">Provider status</p>
          <p className="mt-1">Email: {providers.email_configured ? 'configured — messages are sent through SMTP' : 'not configured — email records are stored with status “skipped”'}</p>
          <p>SMS: {providers.sms_configured ? 'configured' : 'not implemented in this build'}</p>
          <p>WhatsApp: {providers.whatsapp_configured ? 'configured' : 'not implemented in this build'}</p>
          <p className="mt-1 text-slate-500">{providers.note}</p>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading notification log…</p>}
      {!loading && items.length === 0 && <Empty title="No notifications logged" hint="Customer and staff notifications are logged here with their actual delivery status." />}

      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>When</th><th>Channel</th><th>Template</th><th>Recipient</th><th>Status</th><th>Provider</th><th>Error</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap text-xs">{dateTime(item.created_at)}</td>
                  <td className="text-xs">{item.channel}</td>
                  <td className="text-xs">{item.template}</td>
                  <td className="text-xs">{item.recipient || '—'}</td>
                  <td><StatusPill status={item.status} /></td>
                  <td className="text-xs">{item.provider || '—'}</td>
                  <td className="max-w-[220px] text-xs text-red-700">{item.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        “Sent” means the configured provider accepted the message. “Skipped” means no provider was configured, so nothing left the server.
      </p>
    </div>
  )
}
