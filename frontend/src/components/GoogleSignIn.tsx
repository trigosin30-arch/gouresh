import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

/**
 * Google Sign-In button, rendered by Google Identity Services.
 *
 * The server decides whether Google sign-in is available at all
 * (`/api/auth/providers`). If it is not configured, or if the Google script
 * cannot load on this network, nothing is rendered that pretends to work — the
 * password form stays as the only option.
 */

type Providers = { google: { enabled: boolean; client_id: string | null } }

type GoogleAccounts = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }) => void
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleAccounts
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

export default function GoogleSignIn({
  onCredential,
  onError,
  text = 'continue_with',
}: {
  onCredential: (credential: string) => void | Promise<void>
  onError?: (message: string) => void
  text?: 'signin_with' | 'signup_with' | 'continue_with'
}) {
  const holder = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const callbackRef = useRef(onCredential)
  callbackRef.current = onCredential

  useEffect(() => {
    let cancelled = false
    api<Providers>('/api/auth/providers')
      .then((data) => {
        if (cancelled) return
        setEnabled(data.google.enabled)
        setClientId(data.google.client_id)
      })
      .catch(() => setEnabled(false))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!enabled || !clientId) return
    let cancelled = false
    setState('loading')

    const render = () => {
      if (cancelled || !holder.current || !window.google || !clientId) return
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) void callbackRef.current(response.credential)
        },
        cancel_on_tap_outside: true,
      })
      window.google.accounts.id.renderButton(holder.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text,
        shape: 'rectangular',
        logo_alignment: 'left',
        width: holder.current.clientWidth || 320,
      })
      setState('ready')
    }

    if (window.google) {
      render()
      return () => {
        cancelled = true
      }
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', render)
      return () => {
        cancelled = true
        existing.removeEventListener('load', render)
      }
    }

    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = render
    script.onerror = () => {
      if (cancelled) return
      setState('unavailable')
      onError?.('Google sign-in could not load (the Google script was blocked on this network). Use email and password instead.')
    }
    document.head.appendChild(script)

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, clientId, text])

  if (!enabled || !clientId) return null

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs uppercase tracking-wide text-slate-500">or</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <div ref={holder} className="mt-4 flex min-h-[44px] justify-center" data-testid="google-signin" />
      {state === 'loading' && <p className="mt-2 text-center text-xs text-slate-500">Loading Google sign-in…</p>}
      {state === 'unavailable' && (
        <p className="mt-2 text-center text-xs text-amber-700">
          Google sign-in is unavailable on this connection. Use email and password.
        </p>
      )}
    </div>
  )
}
