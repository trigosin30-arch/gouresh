export function rupees(paise: number): string {
  const value = paise / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(value)
}

export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const STATUS_LABELS: Record<string, string> = {
  payment_pending: 'Awaiting payment',
  payment_failed: 'Payment failed',
  confirmed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
}

export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Pay on delivery',
  pending: 'Payment pending',
  paid: 'Paid',
  failed: 'Payment failed',
  refund_due: 'Refund due',
  refunded: 'Refunded',
}

export function statusTone(status: string): string {
  if (['delivered', 'paid'].includes(status)) return 'good'
  if (['cancelled', 'payment_failed', 'failed'].includes(status)) return 'bad'
  if (['shipped', 'out_for_delivery', 'refund_due'].includes(status)) return 'warn'
  if (['confirmed', 'processing', 'packed', 'pending'].includes(status)) return 'info'
  return 'muted'
}

export function discountPercent(price: number, mrp: number | null): number | null {
  if (!mrp || mrp <= price) return null
  return Math.round(((mrp - price) / mrp) * 100)
}
