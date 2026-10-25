import type { ReactNode } from 'react'
import { statusTone } from '../lib/format'

export function Badge({ children, tone, className }: { children: ReactNode; tone?: string; className?: string }) {
  return <span className={`badge badge-${tone ?? 'muted'} ${className ?? ''}`}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div className="loading-bar" />
      <p className="muted small">{label}…</p>
    </div>
  )
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: 300 }} />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p className="muted small">{children}</p> : null}
      {action}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error-text">{error}</span> : null}
    </div>
  )
}

export function PageHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="section-head">
      <div>
        {kicker ? <div className="kicker">{kicker}</div> : null}
        <h1 style={{ marginBottom: description ? 6 : 0 }}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
