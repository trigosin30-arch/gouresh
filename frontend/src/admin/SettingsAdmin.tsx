import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { money } from '../format'
import { AdminHeader, Panel, Toggle } from './ui'
import type { AdminSettingsPayload } from './types'

const GROUP_LABELS: Record<string, string> = {
  business: 'Business identity',
  fulfilment: 'Delivery & pickup',
  payments: 'Payments & tax',
  policies: 'Policies & cancellation',
  marketplace: 'Second-hand marketplace',
  seo: 'Search engine defaults',
  content: 'Storefront content',
}

const GROUP_ORDER = ['business', 'fulfilment', 'payments', 'policies', 'marketplace', 'seo', 'content']

type Value = string | number | boolean | string[] | null

export default function SettingsAdmin() {
  const { user, toast, refresh } = useStore()
  const isAdmin = user?.role === 'admin'
  const [payload, setPayload] = useState<AdminSettingsPayload | null>(null)
  const [values, setValues] = useState<Record<string, Value>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [changed, setChanged] = useState<Set<string>>(new Set())

  useEffect(() => {
    api<AdminSettingsPayload>('/api/admin/settings')
      .then((data) => {
        setPayload(data)
        setValues(data.settings)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const update = (key: string, value: Value) => {
    setValues((current) => ({ ...current, [key]: value }))
    setChanged((current) => new Set(current).add(key))
  }

  const groups = useMemo(() => {
    if (!payload) return []
    const grouped: Record<string, { key: string; label: string; type: string; isPublic: boolean }[]> = {}
    Object.entries(payload.schema).forEach(([key, meta]) => {
      grouped[meta.group] = grouped[meta.group] || []
      grouped[meta.group].push({ key, label: meta.label, type: meta.type, isPublic: meta.public })
    })
    return GROUP_ORDER.filter((group) => grouped[group]).map((group) => ({ group, label: GROUP_LABELS[group] || group, fields: grouped[group] }))
  }, [payload])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!payload) return
    setSaving(true)
    const body: Record<string, Value> = {}
    Object.keys(payload.schema).forEach((key) => {
      body[key] = values[key]
    })
    try {
      const result = await api<{ settings: Record<string, Value>; warning?: string }>('/api/admin/settings', { method: 'PUT', body: { values: body } })
      setValues(result.settings)
      setChanged(new Set())
      await refresh()
      toast(result.warning || 'Store settings saved.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading settings…</p>
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
  if (!payload) return null

  return (
    <div>
      <AdminHeader
        title="Store settings"
        description="Only the owner can publish business details. Anything left blank is shown to customers as “not configured” rather than invented."
        actions={
          isAdmin ? (
            <button type="submit" form="settings-form" className="btn-primary btn-sm" disabled={saving || changed.size === 0}>
              {saving ? 'Saving…' : `Save changes${changed.size ? ` (${changed.size})` : ''}`}
            </button>
          ) : undefined
        }
      />

      {!isAdmin && (
        <p className="mb-4 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-900">
          Settings are read-only for staff accounts. Ask an administrator to change store details.
        </p>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Capability label="Environment" value={payload.capabilities.environment} ok={payload.capabilities.environment === 'production'} hint={payload.capabilities.environment === 'production' ? 'Production mode' : 'Development defaults are active'} />
        <Capability label="Payment gateway" value={payload.capabilities.online_payments_configured ? 'configured' : 'not configured'} ok={payload.capabilities.online_payments_configured} hint="Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable online payments" />
        <Capability label="Email provider" value={payload.capabilities.email_configured ? 'configured' : 'not configured'} ok={payload.capabilities.email_configured} hint="Without SMTP, notifications are stored in-app and marked as not sent" />
      </div>

      <form id="settings-form" onSubmit={save} className="space-y-4">
        {groups.map((group) => (
          <Panel key={group.group} title={group.label} description={`${group.fields.length} settings · changes are audit-logged`}>
            <div className="grid gap-3 lg:grid-cols-2">
              {group.fields.map((field) => (
                <SettingField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  disabled={!isAdmin}
                  onChange={(value) => update(field.key, value)}
                />
              ))}
            </div>
          </Panel>
        ))}
      </form>

      <div className="mt-4 space-y-2 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900">
        <p className="text-sm font-semibold">Things this screen cannot do</p>
        <p>Payment gateway keys, SMTP credentials and the secret key are environment variables, never database settings. Put them in the server environment and restart.</p>
        <p>Turning off demo mode hides the “sample data” banner but does not delete demo products, listings or accounts. Remove or replace them individually.</p>
        <p>Changing the commission rate affects future sales only; recorded commissions keep the rate that applied when they were created.</p>
      </div>
    </div>
  )
}

function Capability({ label, value, ok, hint }: { label: string; value: string; ok: boolean; hint: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <p className="font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm">{value}</p>
      <p className="mt-0.5 opacity-80">{hint}</p>
    </div>
  )
}

function SettingField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: { key: string; label: string; type: string; isPublic: boolean }
  value: Value
  onChange: (value: Value) => void
  disabled: boolean
}) {
  const isMoney = field.key.endsWith('_paise')
  const isBasisPoints = field.key.endsWith('_bp')
  const isList = field.type.includes('list')

  const hint = [
    field.isPublic ? 'Shown on the storefront' : 'Internal only',
    isMoney ? 'Amount in ₹ (stored as paise)' : '',
    isBasisPoints ? '100 basis points = 1%' : '',
  ]
    .filter(Boolean)
    .join(' · ')

  if (field.type.includes('bool')) {
    return (
      <div className="rounded-lg border border-slate-200 px-3 py-2">
        <Toggle
          checked={Boolean(value)}
          onChange={(next) => !disabled && onChange(next)}
          label={field.label}
          hint={hint}
        />
      </div>
    )
  }

  if (isList) {
    return (
      <label>
        <span className="label">{field.label}</span>
        <textarea
          className="input"
          rows={2}
          disabled={disabled}
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={(event) => onChange(event.target.value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))}
          placeholder="144001, 144002, 144005"
        />
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      </label>
    )
  }

  if (field.type.includes('int')) {
    const display = isMoney ? (typeof value === 'number' ? value / 100 : '') : value
    return (
      <label>
        <span className="label">{field.label}</span>
        <div className="flex items-center gap-2">
          {isMoney && <span className="text-sm text-slate-500" aria-hidden="true">₹</span>}
          <input
            className="input"
            type="number"
            min={0}
            step={isMoney ? '0.01' : '1'}
            disabled={disabled}
            value={display === null || display === undefined ? '' : String(display)}
            onChange={(event) => {
              const raw = event.target.value
              if (raw === '') {
                onChange(0)
                return
              }
              onChange(isMoney ? Math.round(Number(raw) * 100) : Math.round(Number(raw)))
            }}
          />
          {isBasisPoints && typeof value === 'number' && <span className="whitespace-nowrap text-xs text-slate-500">= {(value / 100).toFixed(2)}%</span>}
        </div>
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
        {isMoney && <span className="mt-0.5 block text-[11px] text-slate-400">Preview: {money(Number(value) || 0)}</span>}
      </label>
    )
  }

  const long = ['returns_note', 'shipping_note', 'marketplace_note', 'support_note', 'pickup_instructions', 'seo_description', 'announcement'].includes(field.key)
  return (
    <label className={long ? 'lg:col-span-2' : undefined}>
      <span className="label">{field.label}</span>
      {long ? (
        <textarea className="input" rows={2} disabled={disabled} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className="input" disabled={disabled} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} />
      )}
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  )
}
