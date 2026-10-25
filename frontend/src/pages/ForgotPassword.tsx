import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Field } from '../components/ui'

type Response = {
  ok: boolean
  message: string
  dev_reset_link?: string
  delivery?: { channel: string; status: string; provider: string | null }
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [result, setResult] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const data = await api<Response>('/api/auth/forgot-password', { method: 'POST', body: { email } })
      setResult(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Seo title="Reset your password" noindex canonicalPath="/forgot-password" />
      <div className="shell flex justify-center py-12">
        <div className="w-full max-w-md card p-6">
          <h1 className="text-xl font-bold text-navy-900">Reset your password</h1>
          {result ? (
            <div className="mt-3 space-y-3 text-sm text-slate-700">
              <p>{result.message}</p>
              {result.delivery && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Email delivery: <strong>{result.delivery.status}</strong>
                  {result.delivery.status !== 'sent'
                    ? ' — the store has not configured an email provider, so the message could not be emailed. Contact the store for help.'
                    : ` (${result.delivery.provider}).`}
                </p>
              )}
              {result.dev_reset_link && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="font-semibold">Development mode link</p>
                  <p className="mt-1">
                    This link is only returned when the app is not running in production. It is shown here because no mailbox is configured.
                  </p>
                  <Link to={result.dev_reset_link} className="link mt-1 block break-all">
                    {result.dev_reset_link}
                  </Link>
                </div>
              )}
              <Link to="/login" className="btn-secondary">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <p className="text-sm text-slate-600">Enter the email on your account and we will create a reset link.</p>
              <Field label="Email" required>
                <input type="email" className="input" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </Field>
              {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              <Link to="/login" className="block text-center text-sm link">Back to sign in</Link>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
