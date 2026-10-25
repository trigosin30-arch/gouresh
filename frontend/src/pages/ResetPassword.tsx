import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Field } from '../components/ui'
import { useStore } from '../context/StoreContext'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useStore()
  const token = params.get('token') || ''
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { token, password: form.password } })
      toast('Password updated. You can sign in now.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Seo title="Choose a new password" noindex canonicalPath="/reset-password" />
      <div className="shell flex justify-center py-12">
        <div className="w-full max-w-md card p-6">
          <h1 className="text-xl font-bold text-navy-900">Choose a new password</h1>
          {!token ? (
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p>This page needs a valid reset link. Request a new link from the sign-in page.</p>
              <Link to="/forgot-password" className="btn-secondary">Request a reset link</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <Field label="New password" required hint="At least 10 characters.">
                <input
                  type="password"
                  className="input"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </Field>
              <Field label="Confirm new password" required>
                <input
                  type="password"
                  className="input"
                  required
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                />
              </Field>
              {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
