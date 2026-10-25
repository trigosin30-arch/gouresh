import type { PaymentSession } from './types'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, handler: (response: unknown) => void) => void
    }
  }
}

const CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js'

let loading: Promise<boolean> | null = null

function loadScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (loading) return loading
  loading = new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_URL
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
  return loading
}

interface Handlers {
  onSuccess: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void
  onDismiss: () => void
  onFailure: (message: string) => void
}

/**
 * Opens Razorpay's hosted checkout. The callback payload is *not* trusted: the
 * caller must forward it to /api/payments/verify for signature verification.
 */
export async function openRazorpayCheckout(session: PaymentSession, handlers: Handlers): Promise<void> {
  const ready = await loadScript()
  if (!ready || !window.Razorpay) {
    handlers.onFailure('Could not load Razorpay checkout. Check your connection and try again.')
    return
  }
  const checkout = new window.Razorpay({
    key: session.key_id,
    amount: session.amount_paise,
    currency: session.currency,
    name: 'Ankit Stationery Mart',
    description: `Order ${session.order_number}`,
    order_id: session.provider_order_id,
    prefill: session.prefill,
    notes: { order_number: session.order_number },
    theme: { color: '#c2542a' },
    handler: handlers.onSuccess,
    modal: { ondismiss: handlers.onDismiss, escape: true },
  })
  checkout.on('payment.failed', (response: unknown) => {
    const error = (response as { error?: { description?: string } })?.error
    handlers.onFailure(error?.description ?? 'Payment failed')
  })
  checkout.open()
}
