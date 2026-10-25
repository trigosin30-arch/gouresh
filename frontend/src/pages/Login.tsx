import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import { Field } from '../components/ui'
import { IconCheck, IconGoogle } from '../components/Icons'

export default function Login() {
  const { profile, config, configError, signInDemo, signInWithGoogle, signOut } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const next = params.get('next') || '/orders'
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Sign in · Ankit Stationery Mart'
  }, [])

  const usingSupabase = config?.auth.provider === 'supabase'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInDemo(email.trim(), name.trim() || undefined)
      toast.push('Signed in', 'success')
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message)
      setBusy(false)
    }
  }

  if (profile) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="kicker">Signed in</div>
          <h2>Hello, {profile.full_name.split(' ')[0]}</h2>
          <p className="muted small">{profile.email} · {profile.role}</p>
          <div className="stack">
            <Link to={next} className="btn btn-primary btn-block">
              Continue
            </Link>
            <Link to="/account" className="btn btn-ghost btn-block">
              Manage profile & addresses
            </Link>
            {profile.role === 'admin' || profile.role === 'staff' ? (
              <Link to="/admin" className="btn btn-soft btn-block">
                Open admin dashboard
              </Link>
            ) : null}
            <button
              type="button"
              className="btn-link small"
              onClick={async () => {
                await signOut()
                toast.push('Signed out')
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="kicker">{usingSupabase ? 'Verified sign-in' : 'Demo store'}</div>
        <h1 style={{ fontSize: '2rem' }}>Sign in to order</h1>
        <p className="muted small">
          Save delivery addresses, pay online and follow your parcel from dispatch to doorstep.
        </p>

        {configError ? <div className="notice notice-danger">{configError}</div> : null}
        {error ? <div className="notice notice-danger">{error}</div> : null}

        {usingSupabase ? (
          <button type="button" className="google-btn" onClick={google} disabled={busy}>
            <IconGoogle /> Continue with Google
          </button>
        ) : (
          <>
            <div className="notice notice-info small" style={{ marginBottom: 16 }}>
              <strong>Demo sign-in.</strong> This deployment has no Supabase project connected, so any email
              signs in without a password. Connect Supabase with Google OAuth and this panel disappears.
            </div>
            <form className="stack" onSubmit={submit}>
              <Field label="Email" htmlFor="email">
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </Field>
              <Field label="Your name (optional)" htmlFor="name">
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ritika Sharma"
                  autoComplete="name"
                />
              </Field>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? 'Signing in…' : 'Continue'}
              </button>
            </form>

            <div className="divider">Demo accounts</div>
            <div className="stack" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-soft btn-sm btn-block"
                onClick={() => {
                  setEmail('owner@ankitstationery.in')
                  setName('Ankit Sharma')
                }}
              >
                Shop owner (admin dashboard)
              </button>
              <button
                type="button"
                className="btn btn-soft btn-sm btn-block"
                onClick={() => {
                  setEmail('ritika@example.com')
                  setName('Ritika Sharma')
                }}
              >
                Customer
              </button>
            </div>
            <p className="tiny muted center" style={{ marginTop: 14 }}>
              <IconCheck size={12} /> Sessions are signed server-side and expire after 7 days.
            </p>
          </>
        )}

        {usingSupabase ? (
          <p className="tiny muted center" style={{ marginTop: 16 }}>
            Google identity is verified by Supabase; order APIs check the token on every request.
          </p>
        ) : null}
      </div>
    </div>
  )
}
