import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { api, getToken, setToken } from './api'
import type { AppConfig, Profile } from './types'

interface AuthContextValue {
  config: AppConfig | null
  configError: string | null
  profile: Profile | null
  loading: boolean
  isStaff: boolean
  signInDemo: (email: string, name?: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  patchProfile: (changes: Partial<Pick<Profile, 'full_name' | 'phone'>>) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = useRef<SupabaseClient | null>(null)

  const loadProfile = useCallback(async () => {
    if (!getToken()) {
      setProfile(null)
      return
    }
    try {
      const data = await api.get<{ profile: Profile }>('/me')
      setProfile(data.profile)
    } catch {
      setProfile(null)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    let cfg: AppConfig | null = null
    try {
      cfg = await api.get<AppConfig>('/config')
      setConfig(cfg)
    } catch {
      setConfigError('The store server is not reachable. Start the API and reload this page.')
    }

    if (cfg?.auth.provider === 'supabase') {
      try {
        const { createClient } = await import('@supabase/supabase-js')
        const client = createClient(cfg.auth.supabase_url, cfg.auth.supabase_anon_key, {
          auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
        })
        supabase.current = client
        const { data } = await client.auth.getSession()
        if (data.session?.access_token) setToken(data.session.access_token)
        client.auth.onAuthStateChange((_event, session) => {
          setToken(session?.access_token ?? null)
          void loadProfile()
        })
      } catch {
        setConfigError('Could not initialise Google sign-in. Check the Supabase configuration.')
      }
    }

    await loadProfile()
    setLoading(false)
  }, [loadProfile])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const handler = () => setProfile(null)
    window.addEventListener('asm:signed-out', handler)
    return () => window.removeEventListener('asm:signed-out', handler)
  }, [])

  const signInDemo = useCallback(async (email: string, name?: string) => {
    const data = await api.post<{ access_token: string; profile: Profile }>('/auth/demo-login', {
      email,
      full_name: name,
    })
    setToken(data.access_token)
    setProfile(data.profile)
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (supabase.current) {
      const { error } = await supabase.current.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
      return
    }
    throw new Error('Google sign-in is not configured for this deployment yet.')
  }, [])

  const signOut = useCallback(async () => {
    if (supabase.current) await supabase.current.auth.signOut()
    setToken(null)
    setProfile(null)
  }, [])

  const patchProfile = useCallback(async (changes: Partial<Pick<Profile, 'full_name' | 'phone'>>) => {
    const data = await api.patch<{ profile: Profile }>('/me', changes)
    setProfile(data.profile)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      config,
      configError,
      profile,
      loading,
      isStaff: profile?.role === 'admin' || profile?.role === 'staff',
      signInDemo,
      signInWithGoogle,
      signOut,
      refresh: loadProfile,
      patchProfile,
    }),
    [config, configError, profile, loading, loadProfile, signInDemo, signInWithGoogle, signOut, patchProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
