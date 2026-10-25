import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { money } from '../format'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-navy-200 border-t-navy-700" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  )
}

export function PageLoading({ label }: { label?: string }) {
  return (
    <div className="shell py-16">
      <Spinner label={label} />
    </div>
  )
}

export function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="card overflow-hidden">
          <div className="skeleton aspect-[4/5] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <div className="skeleton h-4 w-4/5" />
            <div className="skeleton h-4 w-2/5" />
            <div className="skeleton h-8 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string
  message?: string
  action?: ReactNode
  icon?: string
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="text-3xl" aria-hidden="true">
        {icon || '📦'}
      </div>
      <h3 className="text-base font-semibold text-navy-900">{title}</h3>
      {message && <p className="max-w-md text-sm text-slate-600">{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card border-red-200 bg-red-50 px-6 py-8 text-center" role="alert">
      <h3 className="text-base font-semibold text-red-900">Something went wrong</h3>
      <p className="mt-1 text-sm text-red-800">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Price({ paise, compareAt, size = 'md' }: { paise: number; compareAt?: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const sizing = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg'
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className={`${sizing} font-semibold text-navy-900`}>{money(paise)}</span>
      {compareAt && compareAt > paise && (
        <span className="text-xs text-slate-500 line-through" aria-label={`Original price ${money(compareAt)}`}>
          {money(compareAt)}
        </span>
      )}
    </div>
  )
}

export function AvailabilityBadge({ availability }: { availability: { state: string; label: string } }) {
  const tone =
    availability.state === 'in_stock'
      ? 'badge-ok'
      : availability.state === 'low_stock'
        ? 'badge-warn'
        : availability.state === 'enquiry_only'
          ? 'badge-muted'
          : 'badge-danger'
  return <span className={tone}>{availability.label}</span>
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string | null
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number
  pages: number
  onChange: (page: number) => void
}) {
  if (pages <= 1) return null
  const numbers: number[] = []
  const start = Math.max(1, Math.min(page - 2, pages - 4))
  for (let i = start; i < start + 5 && i <= pages; i += 1) numbers.push(i)
  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
      <button type="button" className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      {numbers.map((n) => (
        <button
          key={n}
          type="button"
          aria-current={n === page ? 'page' : undefined}
          className={n === page ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      <button type="button" className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </button>
      <span className="ml-2 text-xs text-slate-500">
        Page {page} of {pages}
      </span>
    </nav>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-navy-950/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <h2 id="modal-title" className="text-base font-semibold text-navy-900">
            {title}
          </h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-xs text-slate-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {item.to ? (
              <Link to={item.to} className="hover:text-navy-700 hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className="font-medium text-slate-700">{item.label}</span>
            )}
            {index < items.length - 1 && <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-navy-900 sm:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  )
}
