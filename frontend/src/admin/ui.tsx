import type { ReactNode } from 'react'
import { money } from '../format'

export function AdminHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-navy-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  const tones = {
    neutral: 'text-navy-900',
    good: 'text-emerald-700',
    warn: 'text-amber-800',
    bad: 'text-red-700',
  }
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Panel({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            active === tab.id ? 'bg-navy-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {tab.label}
          {typeof tab.count === 'number' && <span className="ml-1.5 text-xs opacity-80">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const good = ['active', 'paid', 'delivered', 'approved', 'quoted', 'accepted', 'converted', 'completed', 'recorded', 'sent']
  const bad = ['cancelled', 'rejected', 'failed', 'restricted', 'suspended', 'expired', 'refunded']
  const warn = ['pending_payment', 'pending_review', 'submitted', 'under_review', 'requested', 'packed', 'dispatched', 'processing', 'partially_refunded', 'accrued', 'payable', 'details_requested']
  const cls = good.includes(status) ? 'badge-ok' : bad.includes(status) ? 'badge-danger' : warn.includes(status) ? 'badge-warn' : 'badge-muted'
  return <span className={cls}>{status.replace(/_/g, ' ')}</span>
}

export const toPaise = (rupees: string): number => {
  const value = Number(rupees.replace(/[^\d.]/g, ''))
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

export const toRupees = (paise: number | null | undefined): string => (paise === null || paise === undefined ? '' : (paise / 100).toString())

export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  required?: boolean
}) {
  return (
    <label>
      <span className="label">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500" aria-hidden="true">₹</span>
        <input
          className="input"
          inputMode="decimal"
          value={value}
          required={required}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
        />
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function MoneyCell({ paise }: { paise: number | null | undefined }) {
  if (paise === null || paise === undefined) return <span className="text-slate-400">—</span>
  return <span>{money(paise)}</span>
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  )
}
