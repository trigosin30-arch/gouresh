import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import GoogleSignIn from '../components/GoogleSignIn'
import { Field } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { User } from '../types'

export default function Register() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh, setUser, toast } = useStore()
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const next = params.get('next') || '/account'

  const googleSignUp = async (credential: string) => {
    setError(null)
    setLoading(true)
    try {
      const result = await api<{ user: User; created: boolean }>('/api/auth/google', {
        method: 'POST',
        body: { credential },
      })
      setUser(result.user)
      await refresh()
      toast(result.created ? 'Account created. Welcome!' : `Welcome back, ${result.user.full_name.split(' ')[0]}.`)
      navigate(next.startsWith('/') ? next : '/account', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const result = await api<{ user: User }>('/api/auth/register', {
        method: 'POST',
        body: {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone || null,
          password: form.password,
        },
      })
      setUser(result.user)
      await refresh()
      toast('Account created. Welcome!')
      navigate(next.startsWith('/') ? next : '/account', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Seo title="Create an account" noindex canonicalPath="/register" />
      <div className="shell flex justify-center py-12">
        <div className="w-full max-w-md">
          <div className="card p-6">
            <h1 className="text-xl font-bold text-navy-900">Create your account</h1>
            <p className="mt-1 text-sm text-slate-600">
              One account for orders, wishlists, used-book submissions and marketplace sales.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="Full name" htmlFor="full_name" required>
                <input
                  id="full_name"
                  className="input"
                  required
                  autoComplete="name"
                  value={form.full_name}
                  onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor="email" required>
                <input
                  id="email"
                  type="email"
                  className="input"
                  required
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </Field>
              <Field label="Mobile number" htmlFor="phone" hint="Optional. Used for order updates if you add it.">
                <input
                  id="phone"
                  className="input"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              </Field>
              <Field label="Password" htmlFor="password" required hint="At least 10 characters. Avoid all digits or obvious passwords.">
                <input
                  id="password"
                  type="password"
                  className="input"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </Field>
              <Field label="Confirm password" htmlFor="confirm" required>
                <input
                  id="confirm"
                  type="password"
                  className="input"
                  required
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(event) => setForm({ ...form, confirm: event.target.value })}
                />
              </Field>
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
            <GoogleSignIn onCredential={googleSignUp} onError={setError} text="signup_with" />
            <p className="mt-4 text-sm text-slate-600">
              Already have an account? <Link to="/login" className="link">Sign in</Link>
            </p>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            By creating an account you agree to the <Link to="/terms" className="link">terms of use</Link> and{' '}
            <Link to="/privacy-policy" className="link">privacy policy</Link>.
          </p>
        </div>
      </div>
    </>
  )
}
