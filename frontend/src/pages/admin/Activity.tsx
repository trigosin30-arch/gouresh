import { useState } from 'react'
import { useApi } from '../../lib/useApi'
import { dateLabel } from '../../lib/format'
import type { AuditLog, PaymentEventRow } from '../../lib/types'
import { Badge, EmptyState, Loading } from '../../components/ui'

export default function Activity() {
  const [tab, setTab] = useState<'audit' | 'payments'>('audit')
  const audit = useApi<{ items: AuditLog[] }>('/admin/audit-logs')
  const events = useApi<{ items: PaymentEventRow[] }>('/admin/payment-events')

  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>Audit & payment events</h2>
          <p className="small muted">
            Every sensitive admin action and every webhook delivery is recorded.
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
          Admin audit log
        </button>
        <button type="button" role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>
          Payment webhooks
        </button>
      </div>

      {tab === 'audit' ? (
        audit.loading ? (
          <Loading label="Loading audit log" />
        ) : audit.error ? (
          <EmptyState title="Could not load the audit log">{audit.error}</EmptyState>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Actor</th>
                    <th>Details</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data?.items.map((log) => (
                    <tr key={log.id}>
                      <td>
                        <Badge tone={log.action.includes('archive') || log.action.includes('role') ? 'warn' : 'info'}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="small">
                        {log.entity_type}
                        <div className="tiny mono muted">{log.entity_id?.slice(0, 8)}</div>
                      </td>
                      <td className="small">{log.actor_email ?? 'system'}</td>
                      <td className="tiny mono muted" style={{ maxWidth: 260, wordBreak: 'break-word' }}>
                        {JSON.stringify(log.meta)}
                      </td>
                      <td className="small muted nowrap">{dateLabel(log.created_at)}</td>
                    </tr>
                  ))}
                  {audit.data?.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No admin actions recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : events.loading ? (
        <Loading label="Loading payment events" />
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Event id</th>
                  <th>Type</th>
                  <th>Processed</th>
                  <th>Note</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {events.data?.items.map((event) => (
                  <tr key={event.id}>
                    <td className="mono tiny">{event.event_id}</td>
                    <td className="small">{event.event_type}</td>
                    <td>
                      <Badge tone={event.processed ? 'good' : 'muted'}>{event.processed ? 'yes' : 'no'}</Badge>
                    </td>
                    <td className="small muted">{event.note ?? '—'}</td>
                    <td className="small muted nowrap">{dateLabel(event.created_at)}</td>
                  </tr>
                ))}
                {events.data?.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No webhook deliveries yet. Replay one from an order page to test idempotency.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
