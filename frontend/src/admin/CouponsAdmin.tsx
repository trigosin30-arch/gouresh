import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal } from '../components/ui'
import { dateOnly, money } from '../format'
import { AdminHeader, Empty, StatusPill, Toggle } from './ui'
import type { AdminCoupon } from './types'

const blank = {
  code: '',
  description: '',
  discount_type: 'percent' as 'percent' | 'flat',
  value: '',
  min_order_paise: '',
  max_discount_paise: '',
  starts_at: '',
  expires_at: '',
  usage_limit: '',
  per_user_limit: '1',
  is_active: true,
}

export default function CouponsAdmin() {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminCoupon[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCoupon | null>(null)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ coupons: AdminCoupon[] }>('/api/admin/coupons')
      setItems(data.coupons)
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

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const body = {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      value: form.discount_type === 'percent' ? Number(form.value) : Math.round(Number(form.value || 0) * 100),
      min_order_paise: Math.round(Number(form.min_order_paise || 0) * 100),
      max_discount_paise: form.max_discount_paise ? Math.round(Number(form.max_discount_paise) * 100) : null,
      starts_at: form.starts_at ? `${form.starts_at}T00:00:00+00:00` : null,
      expires_at: form.expires_at ? `${form.expires_at}T23:59:59+00:00` : null,
      usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
      per_user_limit: Number(form.per_user_limit || 1),
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api(`/api/admin/coupons/${editing.id}`, { method: 'PUT', body })
        toast('Coupon updated.')
      } else {
        await api('/api/admin/coupons', { method: 'POST', body })
        toast('Coupon created.')
      }
      setOpen(false)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (coupon: AdminCoupon) => {
    const ok = await confirm({
      title: 'Delete coupon?',
      message: `Coupon ${coupon.code} will be removed. If it has already been redeemed it is deactivated instead of deleted so past orders stay correct.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      const result = await api<{ deactivated?: boolean; message?: string }>(`/api/admin/coupons/${coupon.id}`, { method: 'DELETE' })
      toast(result.message || 'Coupon deleted.')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div>
      <AdminHeader
        title="Coupons"
        description="Discount codes are validated on the server when the cart is priced. Customers can never submit their own discount amounts."
        actions={isAdmin && <button type="button" className="btn-primary btn-sm" onClick={() => { setEditing(null); setForm(blank); setOpen(true) }}>New coupon</button>}
      />

      {!isAdmin && <p className="mb-3 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-900">Coupon management requires an administrator account.</p>}
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading coupons…</p>}
      {!loading && items.length === 0 && <Empty title="No coupons" hint="Any coupon codes customers share will be rejected until one is created here." />}

      {items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Uses</th><th>Expires</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {items.map((coupon) => (
                <tr key={coupon.id}>
                  <td>
                    <p className="font-mono font-semibold text-navy-900">{coupon.code}</p>
                    {coupon.description && <p className="text-xs text-slate-500">{coupon.description}</p>}
                  </td>
                  <td>
                    {coupon.discount_type === 'percent' ? `${coupon.value}%` : money(coupon.value)}
                    {coupon.max_discount_paise ? <span className="block text-xs text-slate-500">max {money(coupon.max_discount_paise)}</span> : null}
                  </td>
                  <td>{coupon.min_order_paise ? money(coupon.min_order_paise) : '—'}</td>
                  <td>
                    {coupon.used_count}
                    {coupon.usage_limit ? ` / ${coupon.usage_limit}` : ''}
                    <span className="block text-xs text-slate-500">{coupon.per_user_limit} per customer</span>
                  </td>
                  <td className="text-xs">{coupon.expires_at ? dateOnly(coupon.expires_at) : 'No expiry'}</td>
                  <td><StatusPill status={coupon.is_active ? 'active' : 'draft'} /></td>
                  <td>
                    {isAdmin && (
                      <div className="flex gap-2 text-xs">
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setEditing(coupon)
                            setForm({
                              code: coupon.code,
                              description: coupon.description || '',
                              discount_type: coupon.discount_type,
                              value: coupon.discount_type === 'percent' ? String(coupon.value) : (coupon.value / 100).toString(),
                              min_order_paise: (coupon.min_order_paise / 100).toString(),
                              max_discount_paise: coupon.max_discount_paise ? (coupon.max_discount_paise / 100).toString() : '',
                              starts_at: '',
                              expires_at: coupon.expires_at ? coupon.expires_at.slice(0, 10) : '',
                              usage_limit: coupon.usage_limit ? String(coupon.usage_limit) : '',
                              per_user_limit: String(coupon.per_user_limit),
                              is_active: coupon.is_active,
                            })
                            setOpen(true)
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="text-red-700 hover:underline" onClick={() => void remove(coupon)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.code}` : 'New coupon'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="coupon-form" className="btn-primary" disabled={busy}>Save coupon</button>
          </>
        }
      >
        <form id="coupon-form" onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" required hint="Letters and numbers; uppercase is enforced.">
              <input
                className="input font-mono uppercase"
                required
                minLength={3}
                value={form.code}
                disabled={Boolean(editing)}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Discount type" required>
              <select className="input" value={form.discount_type} onChange={(event) => setForm({ ...form, discount_type: event.target.value as 'percent' | 'flat' })}>
                <option value="percent">Percentage</option>
                <option value="flat">Flat amount</option>
              </select>
            </Field>
          </div>
          <Field label="Description" hint="Shown to the customer in the cart when the code applies.">
            <input className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={form.discount_type === 'percent' ? 'Percentage off' : 'Amount off (₹)'} required hint={form.discount_type === 'percent' ? '1–90' : 'Whole rupees'}>
              <input className="input" inputMode="decimal" required value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
            </Field>
            <Field label="Maximum discount (₹)" hint="Optional cap for percentage coupons.">
              <input className="input" inputMode="decimal" value={form.max_discount_paise} onChange={(event) => setForm({ ...form, max_discount_paise: event.target.value })} />
            </Field>
            <Field label="Minimum order (₹)">
              <input className="input" inputMode="decimal" value={form.min_order_paise} onChange={(event) => setForm({ ...form, min_order_paise: event.target.value })} />
            </Field>
            <Field label="Total uses allowed" hint="Leave blank for unlimited.">
              <input className="input" type="number" min={1} value={form.usage_limit} onChange={(event) => setForm({ ...form, usage_limit: event.target.value })} />
            </Field>
            <Field label="Starts on">
              <input className="input" type="date" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} />
            </Field>
            <Field label="Expires on">
              <input className="input" type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
            </Field>
            <Field label="Uses per customer">
              <input className="input" type="number" min={1} value={form.per_user_limit} onChange={(event) => setForm({ ...form, per_user_limit: event.target.value })} />
            </Field>
          </div>
          <Toggle checked={form.is_active} onChange={(value) => setForm({ ...form, is_active: value })} label="Active" />
          <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">
            A coupon only discounts the cart subtotal. Delivery fees and tax are calculated separately, and the total is always recalculated on the
            server before an order is created.
          </p>
        </form>
      </Modal>
    </div>
  )
}
