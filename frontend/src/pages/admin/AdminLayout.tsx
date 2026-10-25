import { useEffect } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { EmptyState, Loading } from '../../components/ui'
import { Header, Footer } from '../../components/Layout'

const LINKS = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/customers', label: 'Customers' },
  { to: '/admin/activity', label: 'Audit & payments' },
]

export default function AdminLayout() {
  const { profile, loading, isStaff } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !profile) navigate('/login?next=/admin', { replace: true })
  }, [loading, profile, navigate])

  if (loading) return <Loading label="Checking access" />
  if (!profile) return null
  if (!isStaff) {
    return (
      <>
        <Header />
        <main className="page">
          <div className="container">
            <EmptyState
              title="Administrator access required"
              action={
                <Link to="/" className="btn btn-primary">
                  Back to the shop
                </Link>
              }
            >
              This area manages stock, orders and customers. Sign in with a staff account to continue.
            </EmptyState>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          <div className="section-head">
            <div>
              <div className="kicker">Shop counter</div>
              <h1>Admin dashboard</h1>
              <p>
                Signed in as {profile.full_name} · {profile.email}
              </p>
            </div>
            <Link to="/" className="btn btn-ghost btn-sm">
              View storefront
            </Link>
          </div>

          <div className="admin-layout">
            <nav className="admin-nav" aria-label="Admin sections">
              <span className="label">Manage</span>
              {LINKS.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {link.label}
                  <span aria-hidden>›</span>
                </NavLink>
              ))}
            </nav>
            <div>
              <Outlet />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
