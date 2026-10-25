import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useCart } from '../lib/cart'
import { rupees } from '../lib/format'
import { IconCart, IconMenu, IconClose, IconPhone, IconPin, IconUser } from './Icons'

const NAV = [
  { to: '/shop', label: 'Shop' },
  { to: '/shop?category=school-textbooks', label: 'Textbooks' },
  { to: '/shop?category=art-craft', label: 'Art & craft' },
  { to: '/shop?category=exam-competition', label: 'Exams' },
]

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Ankit Stationery Mart home">
      <span className="brand-mark">ASM</span>
      <span>
        Ankit Stationery Mart
        <small>Shimla · since 1994</small>
      </span>
    </Link>
  )
}

export function Header() {
  const { profile, config } = useAuth()
  const cart = useCart()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname, location.search])

  const threshold = config?.store.free_shipping_threshold_paise ?? 49900
  const mockNote = config?.payments.mode === 'mock'

  return (
    <>
      <div className="announce">
        <div className="container">
          <span>
            <strong>Free delivery in Shimla</strong> on orders over {rupees(threshold)} · Same-day dispatch
            before 4 pm
          </span>
          <span>
            {mockNote ? (
              <>Demo store — payments run in <strong>test mode</strong>, no money is charged.</>
            ) : (
              <>
                Order online or call <strong>{config?.store.phone}</strong>
              </>
            )}
          </span>
        </div>
      </div>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="main-nav" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive && location.search === (item.to.split('?')[1] ? `?${item.to.split('?')[1]}` : '')
                    ? 'active'
                    : ''
                }
              >
                {item.label}
              </NavLink>
            ))}
            {profile?.role === 'admin' || profile?.role === 'staff' ? (
              <NavLink to="/admin">Admin</NavLink>
            ) : null}
          </nav>
          <div className="header-actions">
            <Link to="/orders" className="icon-btn" aria-label="Your orders">
              <IconUser size={17} />
              <span className="hide-sm">{profile ? profile.full_name.split(' ')[0] : 'Account'}</span>
            </Link>
            <Link to="/cart" className="icon-btn" aria-label={`Cart, ${cart.count} items`}>
              <IconCart size={18} />
              {cart.count > 0 ? <span className="cart-count">{cart.count}</span> : <span>Cart</span>}
            </Link>
            <button
              type="button"
              className="icon-btn menu-toggle"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label="Toggle menu"
            >
              {open ? <IconClose size={18} /> : <IconMenu size={18} />}
            </button>
          </div>
        </div>
        <nav className={`mobile-nav ${open ? 'open' : ''}`} aria-label="Mobile">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/orders">Your orders</NavLink>
          <NavLink to="/account">Account & addresses</NavLink>
          {profile?.role === 'admin' || profile?.role === 'staff' ? (
            <NavLink to="/admin">Admin dashboard</NavLink>
          ) : null}
          <NavLink to="/login">{profile ? 'Switch account' : 'Sign in'}</NavLink>
        </nav>
      </header>
    </>
  )
}

export function Footer() {
  const { config } = useAuth()
  const store = config?.store
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">
              <span className="brand-mark">ASM</span>
              <strong>Ankit Stationery Mart</strong>
            </div>
            <p style={{ maxWidth: '32ch' }}>
              School textbooks, notebooks and art supplies for every class in Shimla — with the same
              counter service the shop has offered since 1994.
            </p>
            <p className="tiny" style={{ opacity: 0.7 }}>
              GSTIN 02ABCDE1234F1Z5 · Himachal Pradesh
            </p>
          </div>
          <div>
            <h4>Shop</h4>
            <div className="footer-links">
              <Link to="/shop">All products</Link>
              <Link to="/shop?category=school-textbooks">School textbooks</Link>
              <Link to="/shop?category=notebooks-registers">Notebooks</Link>
              <Link to="/shop?category=exam-competition">Exam guides</Link>
              <Link to="/cart">Your cart</Link>
            </div>
          </div>
          <div>
            <h4>Account</h4>
            <div className="footer-links">
              <Link to="/login">Sign in</Link>
              <Link to="/orders">Track an order</Link>
              <Link to="/account">Profile & addresses</Link>
              <Link to="/about">Delivery & returns</Link>
            </div>
          </div>
          <div>
            <h4>Visit the shop</h4>
            <div className="footer-links">
              <span style={{ display: 'flex', gap: 8 }}>
                <IconPin size={16} />
                <span>{store?.address ?? 'Lower Bazaar, Shimla'}</span>
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <IconPhone size={16} />
                <span>{store?.phone ?? '+91 98160 00000'}</span>
              </span>
              <span>{store?.hours ?? 'Mon–Sat 9:30 am – 8:00 pm'}</span>
              <span>{store?.email ?? 'hello@ankitstationery.in'}</span>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Ankit Stationery Mart, Shimla. All prices include GST.</span>
          <span>
            Razorpay · UPI · Cards {config?.payments.mode === 'mock' ? '· demo payments' : ''}
          </span>
        </div>
      </div>
    </footer>
  )
}

export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

export function PublicLayout() {
  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          <Outlet />
        </div>
      </main>
      <Footer />
    </>
  )
}
