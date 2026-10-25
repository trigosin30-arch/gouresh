import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useStore } from '../context/StoreContext'
import { PageLoading } from './ui'

export default function RequireAuth({ children, staffOnly }: { children: ReactNode; staffOnly?: boolean }) {
  const { user, loading } = useStore()
  const location = useLocation()

  if (loading) return <PageLoading label="Checking your session" />
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }
  if (staffOnly && user.role !== 'admin' && user.role !== 'staff') {
    return (
      <div className="shell py-16">
        <div className="card mx-auto max-w-lg p-8 text-center">
          <h1 className="text-lg font-semibold text-navy-900">Staff access required</h1>
          <p className="mt-2 text-sm text-slate-600">
            This area is limited to store staff. Your account does not have permission to view it.
          </p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
