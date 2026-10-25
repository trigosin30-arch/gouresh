import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { rupees } from '../lib/format'
import type { Order, PaymentSession } from '../lib/types'

interface Props {
  session: PaymentSession
  onVerified: (order: Order) => void
  onClose: () => void
}

/**
 * Demo-mode stand-in for Razorpay's hosted checkout.
 *
 * "Pay" calls the backend, which creates provider-shaped ids and a *real* HMAC
 * signature before running the same verification path used in production. The
 * browser never gets to declare an order paid.
 */
export function MockPaymentModal({ session, onVerified, onClose }: Props) {
  const [busy, setBusy] = useState<'success' | 'failure' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const simulate = async (outcome: 'success' | 'failure') => {
    setBusy(outcome)
    setError(null)
    try {
      const data = await api.post<{ order: Order }>(`/payments/simulate/${session.order_number}`, { outcome })
      onVerified(data.order)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment simulation failed')
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="mock-pay-title">
      <div className="modal">
        <div className="mock-pay-head">
          <h3 id="mock-pay-title" style={{ margin: 0 }}>
            Pay {rupees(session.amount_paise)}
          </h3>
          <span className="mock-tag">Demo mode</span>
        </div>
        <p className="small muted">
          Razorpay keys are not configured on this deployment, so this panel stands in for the hosted
          checkout. The server still generates a payment reference and verifies an HMAC signature before
          marking the order paid.
        </p>

        <div className="notice notice-info mono" style={{ marginBottom: 18 }}>
          <div>order: {session.provider_order_id}</div>
          <div>amount: {session.amount_paise} paise</div>
          <div>receipt: {session.order_number}</div>
        </div>

        {error ? <div className="notice notice-danger">{error}</div> : null}

        <div className="stack" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => simulate('success')}
            disabled={busy !== null}
          >
            {busy === 'success' ? 'Confirming payment…' : 'Pay successfully'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => simulate('failure')}
            disabled={busy !== null}
          >
            {busy === 'failure' ? 'Recording failure…' : 'Simulate a failed payment'}
          </button>
          <button type="button" className="btn-link small" onClick={onClose} disabled={busy !== null}>
            Cancel and pay later
          </button>
        </div>
      </div>
    </div>
  )
}
