import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal } from '../components/ui'
import { dateOnly, money } from '../format'
import { AdminHeader, Empty, MoneyCell, Stat, StatusPill, Tabs, toPaise } from './ui'
import type { AdminCommission, AdminPayout } from './types'

export default function MoneyAdmin() {
  const [tab, setTab] = useState('commissions')
  return (
    <div>
      <AdminHeader
        title="Commissions & payouts"
        description="Accounting records for second-hand sales. This software never moves money: payouts are completed by the store and then recorded here."
      />
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        Commission is calculated on the book price only (delivery fees excluded) using the rate stored on each sale. When a payout is recorded, the
        store must have already transferred the money through its own banking or UPI process.
      </div>
      <Tabs
        tabs={[
          { id: 'commissions', label: 'Commission ledger' },
          { id: 'payouts', label: 'Payouts' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'commissions' ? <Commissions /> : <Payouts />}
    </div>
  )
}

function Commissions() {
  const [items, setItems] = useState<AdminCommission[]>([])
  const [totals, setTotals] = useState<{ gross_paise: number; commission_paise: number; proceeds_paise: number; paid_paise: number } | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ commissions: AdminCommission[]; totals: typeof totals; note: string }>('/api/admin/commissions')
      .then((data) => {
        setItems(data.commissions)
        setTotals(data.totals)
        setNote(data.note)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {totals && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Gross marketplace sales" value={money(totals.gross_paise)} />
          <Stat label="Commission earned" value={money(totals.commission_paise)} tone="good" />
          <Stat label="Seller proceeds" value={money(totals.proceeds_paise)} />
          <Stat label="Paid out" value={money(totals.paid_paise)} hint={`${money(Math.max(0, totals.proceeds_paise - totals.paid_paise))} still outstanding`} />
        </div>
      )}
      {note && <p className="text-xs text-slate-500">{note}</p>}
      {loading && <p className="text-sm text-slate-500">Loading commission records…</p>}
      {!loading && items.length === 0 && <Empty title="No marketplace sales yet" hint="Commission records are created when a second-hand listing is purchased." />}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Order</th><th>Seller</th><th>Gross</th><th>Rate</th><th>Commission</th><th>Proceeds</th><th>Status</th><th>Recorded</th></tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr key={record.id}>
                  <td>{record.order_id ? <Link to={`/admin/orders/${record.order_id}`} className="link">{record.order_number || 'order'}</Link> : '—'}</td>
                  <td className="text-xs">{record.seller_email || '—'}</td>
                  <td><MoneyCell paise={record.gross_paise} /></td>
                  <td>{(record.commission_rate_bp / 100).toFixed(2)}%</td>
                  <td><MoneyCell paise={record.commission_paise} /></td>
                  <td><MoneyCell paise={record.seller_proceeds_paise} /></td>
                  <td><StatusPill status={record.status} /></td>
                  <td className="text-xs">{dateOnly(record.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Payouts() {
  const { user, toast } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminPayout[]>([])
  const [commissions, setCommissions] = useState<AdminCommission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ seller_id: '', amount: '', reference: '', note: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [payoutData, commissionData] = await Promise.all([
        api<{ payouts: AdminPayout[] }>('/api/admin/payouts'),
        api<{ commissions: AdminCommission[] }>('/api/admin/commissions'),
      ])
      setItems(payoutData.payouts)
      setCommissions(commissionData.commissions)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sellers = useMemo(() => {
    const map = new Map<string, { id: string; email: string; outstanding: number }>()
    commissions
      .filter((record) => ['accrued', 'payable'].includes(record.status))
      .forEach((record) => {
        const current = map.get(record.seller_id) || { id: record.seller_id, email: record.seller_email || record.seller_id, outstanding: 0 }
        current.outstanding += record.seller_proceeds_paise
        map.set(record.seller_id, current)
      })
    return Array.from(map.values()).sort((a, b) => b.outstanding - a.outstanding)
  }, [commissions])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api<{ recorded_paise: number; remaining_outstanding_paise: number }>('/api/admin/payouts', {
        method: 'POST',
        body: {
          seller_id: form.seller_id,
          amount_paise: toPaise(form.amount),
          reference: form.reference || null,
          note: form.note || null,
          commission_ids: [],
        },
      })
      toast(`Payout of ${money(result.recorded_paise)} recorded. Outstanding now ${money(result.remaining_outstanding_paise)}.`)
      setOpen(false)
      setForm({ seller_id: '', amount: '', reference: '', note: '' })
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {sellers.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-navy-900">Sellers with outstanding proceeds</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {sellers.map((seller) => (
              <li key={seller.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{seller.email}</span>
                <span className="font-medium">{money(seller.outstanding)}</span>
              </li>
            ))}
          </ul>
          {isAdmin && (
            <button type="button" className="btn-primary btn-sm mt-3" onClick={() => setOpen(true)}>Record a payout</button>
          )}
        </div>
      )}

      {!isAdmin && <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-900">Recording a payout requires an administrator account.</p>}
      {loading && <p className="text-sm text-slate-500">Loading payouts…</p>}
      {!loading && items.length === 0 && <Empty title="No payouts recorded" hint="Payouts you record after paying a seller appear here." />}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Seller</th><th>Amount</th><th>Reference</th><th>Status</th><th>Recorded</th><th>Note</th></tr>
            </thead>
            <tbody>
              {items.map((payout) => (
                <tr key={payout.id}>
                  <td className="text-xs">{payout.seller_email || '—'}</td>
                  <td><MoneyCell paise={payout.amount_paise} /></td>
                  <td className="text-xs">{payout.reference || '—'}</td>
                  <td><StatusPill status={payout.status} /></td>
                  <td className="text-xs">{dateOnly(payout.created_at)}</td>
                  <td className="text-xs text-slate-500">{payout.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a seller payout"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="payout-form" className="btn-primary" disabled={busy}>Record payout</button>
          </>
        }
      >
        <form id="payout-form" onSubmit={submit} className="space-y-3">
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Only record a payout after the money has actually left the store&rsquo;s account. This creates an accounting record; it does not send money.
          </p>
          <Field label="Seller" required>
            <select className="input" required value={form.seller_id} onChange={(event) => setForm({ ...form, seller_id: event.target.value })}>
              <option value="">Choose a seller</option>
              {sellers.map((seller) => (
                <option key={seller.id} value={seller.id}>{seller.email} · {money(seller.outstanding)} outstanding</option>
              ))}
            </select>
          </Field>
          <Field label="Amount (₹)" required>
            <input className="input" inputMode="decimal" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </Field>
          <Field label="Payment reference" hint="Bank/UPI reference so the transfer can be reconciled.">
            <input className="input" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
          </Field>
          <Field label="Note">
            <input className="input" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </Field>
          {sellers.length === 0 && <p className="text-xs text-slate-500">No seller has outstanding proceeds to pay right now.</p>}
        </form>
      </Modal>
    </div>
  )
}
