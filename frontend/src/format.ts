export const money = (paise: number | null | undefined): string => {
  if (paise === null || paise === undefined) return '—'
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** For compact cards where whole rupees are enough. */
export const rupees = (paise: number | null | undefined): string => {
  if (paise === null || paise === undefined) return '—'
  const value = paise / 100
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: value % 1 === 0 ? 0 : 2 })}`
}

export const dateTime = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const dateOnly = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const titleCase = (value: string): string =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const orderStatusTone = (status: string): string => {
  switch (status) {
    case 'delivered':
      return 'badge-ok'
    case 'cancelled':
    case 'returned':
      return 'badge-danger'
    case 'pending_payment':
      return 'badge-warn'
    case 'placed':
    case 'processing':
    case 'packed':
    case 'dispatched':
      return 'badge-new'
    default:
      return 'badge-muted'
  }
}

export const paymentTone = (status: string): string => {
  switch (status) {
    case 'paid':
      return 'badge-ok'
    case 'failed':
      return 'badge-danger'
    case 'partially_refunded':
    case 'refunded':
      return 'badge-warn'
    default:
      return 'badge-muted'
  }
}

export const apiDate = (value: string): string => (value ? value.slice(0, 10) : '')
