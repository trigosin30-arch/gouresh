import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import GoogleSignIn from '../components/GoogleSignIn'
import { Field } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { User } from '../types'

export default function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh, setUser, toast } = useStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const next = params.get('next') || ''

  const finishLogin = (result: { user: User }, welcome: string) => {
    setUser(result.user)
    void refresh()
    toast(welcome)
    const target = next.startsWith('/') ? next : result.user.role === 'customer' ? '/account' : '/admin'
    navigate(target, { replace: true })
  }

  const googleSignIn = async (credential: string) => {
    setError(null)
    setLoading(true)
    try {
      const result = await api<{ user: User; created: boolean }>('/api/auth/google', {
        method: 'POST',
        body: { credential },
      })
      finishLogin(result, result.created ? `Welcome, ${result.user.full_name.split(' ')[0]}.` : `Welcome back, ${result.user.full_name.split(' ')[0]}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: form })
      finishLogin(result, `Welcome back, ${result.user.full_name.split(' ')[0]}.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Seo title="Sign in" noindex canonicalPath="/login" />
      <div className="shell flex justify-center py-12">
        <div className="w-full max-w-md">
          <div className="card p-6">
            <h1 className="text-xl font-bold text-navy-900">Sign in</h1>
            <p className="mt-1 text-sm text-slate-600">Track orders, save your wishlist and manage used-book listings.</p>
            <form onSubmit={submit} className="mt-5 space-y-4">
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
              <Field label="Password" htmlFor="password" required>
                <input
                  id="password"
                  type="password"
                  className="input"
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </Field>
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <GoogleSignIn onCredential={googleSignIn} onError={setError} text="signin_with" />
            <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
              <Link to="/forgot-password" className="link">Forgot your password?</Link>
              <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="link">Create an account</Link>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            Store staff and administrators sign in here too, then open the admin dashboard.
          </p>
        </div>
      </div>
    </>
  )
}
