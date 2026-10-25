import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Loading } from '../components/ui'

/** Landing point for the Supabase OAuth redirect (PKCE code exchange happens in supabase-js). */
export default function AuthCallback() {
  const { profile, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(() => navigate(profile ? '/orders' : '/login', { replace: true }), 600)
    return () => window.clearTimeout(timer)
  }, [loading, profile, navigate])

  return (
    <div className="auth-wrap">
      <Loading label="Finishing sign-in" />
    </div>
  )
}
