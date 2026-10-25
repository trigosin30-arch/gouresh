import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { Bootstrap, Settings, User } from '../types'

export type Toast = { id: number; message: string; kind: 'success' | 'error' | 'info' }

type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}

type StoreValue = {
  bootstrap: Bootstrap | null
  settings: Settings | null
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  setUser: (user: User | null) => void
  setCartCount: (count: number) => void
  toast: (message: string, kind?: Toast['kind']) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const StoreContext = createContext<StoreValue | null>(null)

let toastId = 0

export function StoreProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api<Bootstrap>('/api/store/bootstrap')
      setBootstrap(data)
    } catch {
      setBootstrap(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = ++toastId
    setToasts((current) => [...current, { id, message, kind }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5200)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ options, resolve })
    })
  }, [])

  useEffect(() => {
    if (!confirmState) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        confirmState.resolve(false)
        setConfirmState(null)
      }
    }
    document.addEventListener('keydown', onKey)
    confirmRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmState])

  const setUser = useCallback((user: User | null) => {
    setBootstrap((current) => (current ? { ...current, user } : current))
  }, [])

  const setCartCount = useCallback((count: number) => {
    setBootstrap((current) => (current ? { ...current, cart_count: count } : current))
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      bootstrap,
      settings: bootstrap?.settings ?? null,
      user: bootstrap?.user ?? null,
      loading,
      refresh,
      setUser,
      setCartCount,
      toast,
      confirm,
    }),
    [bootstrap, loading, refresh, setUser, setCartCount, toast, confirm],
  )

  return (
    <StoreContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4">
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto w-full max-w-md rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              item.kind === 'error'
                ? 'bg-red-700 text-white'
                : item.kind === 'info'
                  ? 'bg-navy-800 text-white'
                  : 'bg-emerald-700 text-white'
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
      {confirmState && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/50 p-4" role="presentation">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
            ref={confirmRef}
            tabIndex={-1}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
          >
            <h2 id="confirm-title" className="text-lg font-semibold text-navy-900">
              {confirmState.options.title}
            </h2>
            <p id="confirm-message" className="mt-2 text-sm text-slate-600">
              {confirmState.options.message}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  confirmState.resolve(false)
                  setConfirmState(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={confirmState.options.danger ? 'btn-danger' : 'btn-primary'}
                onClick={() => {
                  confirmState.resolve(true)
                  setConfirmState(null)
                }}
              >
                {confirmState.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext)
  if (!context) throw new Error('useStore must be used inside StoreProvider')
  return context
}
