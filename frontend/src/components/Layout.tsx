import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import type { Product } from '../types'
import { rupees } from '../format'

const NAV = [
  { to: '/products?category=stationery', label: 'Stationery' },
  { to: '/products?product_type=new&book_type=textbook', label: 'New Books' },
  { to: '/used-books', label: 'Second-Hand Books' },
  { to: '/products?category=school-supplies', label: 'School Supplies' },
  { to: '/bulk-orders', label: 'Bulk Orders' },
  { to: '/sell-books', label: 'Sell Your Books' },
]

type Suggestion = {
  products: Pick<Product, 'id' | 'slug' | 'title' | 'price_paise' | 'image_url'>[]
  listings: { id: string; listing_code: string; title: string; asking_price_paise: number }[]
}

function SearchBox({ onNavigate }: { onNavigate?: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Suggestion | null>(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api<Suggestion>(`/api/products/suggest?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((data) => {
          setResults(data)
          setOpen(true)
        })
        .catch(() => undefined)
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const q = query.trim()
    setOpen(false)
    onNavigate?.()
    navigate(q ? `/products?q=${encodeURIComponent(q)}` : '/products')
  }

  const hasResults = Boolean(results && (results.products.length || results.listings.length))

  return (
    <div className="relative w-full" ref={boxRef}>
      <form onSubmit={submit} role="search" className="flex w-full">
        <label htmlFor="site-search" className="sr-only">
          Search products, books, authors or ISBN
        </label>
        <input
          id="site-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search stationery, books, author or ISBN"
          className="w-full rounded-l-lg border border-slate-300 border-r-0 bg-white px-3 py-2.5 text-sm focus:border-navy-500 focus:ring-1 focus:ring-navy-500"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls="search-suggestions"
        />
        <button type="submit" className="btn-accent rounded-l-none px-4" aria-label="Search">
          Search
        </button>
      </form>
      {open && query.trim().length >= 2 && (
        <div
          id="search-suggestions"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          {!hasResults && <p className="px-4 py-3 text-sm text-slate-500">No matches for “{query.trim()}”.</p>}
          {results && results.products.length > 0 && (
            <div className="p-2">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Products</p>
              {results.products.map((product) => (
                <Link
                  key={product.id}
                  to={`/product/${product.slug}`}
                  onClick={() => {
                    setOpen(false)
                    onNavigate?.()
                  }}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-slate-50"
                >
                  {product.image_url ? (
                    <img src={product.image_url} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="h-10 w-10 rounded bg-slate-100" aria-hidden="true" />
                  )}
                  <span className="flex-1 truncate">{product.title}</span>
                  <span className="text-xs font-medium text-navy-800">{rupees(product.price_paise)}</span>
                </Link>
              ))}
            </div>
          )}
          {results && results.listings.length > 0 && (
            <div className="border-t border-slate-100 p-2">
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Second-hand</p>
              {results.listings.map((listing) => (
                <Link
                  key={listing.id}
                  to={`/used-books/${listing.listing_code}`}
                  onClick={() => {
                    setOpen(false)
                    onNavigate?.()
                  }}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="truncate">{listing.title}</span>
                  <span className="text-xs font-medium text-amber-800">{rupees(listing.asking_price_paise)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { bootstrap, settings, user, refresh, setUser, toast } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    setMenuOpen(false)
    setAccountOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [location.pathname, location.search])

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setUser(null)
      await refresh()
      toast('Signed out.')
      navigate('/')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const accountLinks = user
    ? [
        { to: '/account', label: 'Your account' },
        { to: '/orders', label: 'Your orders' },
        { to: '/wishlist', label: 'Wishlist' },
        ...(user.role === 'admin' || user.role === 'staff' ? [{ to: '/admin', label: 'Admin dashboard' }] : []),
      ]
    : [
        { to: '/login', label: 'Sign in' },
        { to: '/register', label: 'Create account' },
        { to: '/track-order', label: 'Track an order' },
      ]

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      {settings?.demo_mode && (
        <div className="bg-accent-100 text-center text-xs font-medium text-accent-900">
          <div className="shell py-1.5">
            Demo mode — catalogue, prices and policies are sample data. Replace them in the admin panel before launch.
          </div>
        </div>
      )}
      {settings?.announcement && (
        <div className="bg-navy-900 text-center text-xs text-navy-50">
          <div className="shell py-1.5">{settings.announcement}</div>
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="shell flex items-center gap-3 py-3">
          <button
            type="button"
            className="btn-ghost -ml-2 px-2 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label="Open menu"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Ankit Stationery Mart home">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-900 text-sm font-bold text-white" aria-hidden="true">
              AS
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-sm font-bold text-navy-900">{settings?.store_name || 'Ankit Stationery Mart'}</span>
              <span className="block text-[11px] text-slate-500">Stationery &amp; Books · Jalandhar Cantt</span>
            </span>
          </Link>

          <div className="hidden flex-1 md:block">
            <SearchBox />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                className="btn-ghost gap-1 px-2 text-xs sm:text-sm"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => setAccountOpen((value) => !value)}
              >
                <span aria-hidden="true">👤</span>
                <span className="hidden sm:inline">{user ? user.full_name.split(' ')[0] : 'Account'}</span>
              </button>
              {accountOpen && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                  {accountLinks.map((item) => (
                    <Link
                      key={item.to}
                      role="menuitem"
                      to={item.to}
                      className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => setAccountOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                  {user && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                        onClick={() => {
                          setAccountOpen(false)
                          void logout()
                        }}
                      >
                        Sign out
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <Link to="/wishlist" className="btn-ghost relative px-2" aria-label={`Wishlist (${bootstrap?.wishlist_count || 0} items)`}>
              <span aria-hidden="true">♡</span>
              {Boolean(bootstrap?.wishlist_count) && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-navy-800 px-1.5 text-[10px] font-bold text-white">
                  {bootstrap?.wishlist_count}
                </span>
              )}
            </Link>

            <Link to="/cart" className="btn-ghost relative px-2" aria-label={`Cart (${bootstrap?.cart_count || 0} items)`}>
              <span aria-hidden="true">🛒</span>
              <span className="hidden text-sm sm:inline">Cart</span>
              {Boolean(bootstrap?.cart_count) && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">
                  {bootstrap?.cart_count}
                </span>
              )}
            </Link>
          </div>
        </div>

        <div className="shell pb-3 md:hidden">
          <SearchBox />
        </div>

        <nav className="hidden border-t border-slate-100 lg:block" aria-label="Main navigation">
          <div className="shell flex gap-1 overflow-x-auto py-1.5">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition hover:bg-navy-50 hover:text-navy-900 ${
                    isActive ? 'font-semibold text-navy-900' : 'text-slate-600'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <NavLink to="/book-lists" className="ml-auto whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-accent-700 hover:bg-accent-50">
              Find books by board &amp; class
            </NavLink>
          </div>
        </nav>

        {menuOpen && (
          <div id="mobile-menu" className="border-t border-slate-200 bg-white lg:hidden">
            <nav className="shell flex flex-col py-2" aria-label="Mobile navigation">
              {NAV.map((item) => (
                <Link key={item.to} to={item.to} className="rounded-md px-2 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  {item.label}
                </Link>
              ))}
              <Link to="/book-lists" className="rounded-md px-2 py-2.5 text-sm font-medium text-accent-700 hover:bg-accent-50">
                Find books by board &amp; class
              </Link>
              <div className="my-1 border-t border-slate-100" />
              {accountLinks.map((item) => (
                <Link key={item.to} to={item.to} className="rounded-md px-2 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  {item.label}
                </Link>
              ))}
              {user && (
                <button type="button" onClick={() => void logout()} className="rounded-md px-2 py-2.5 text-left text-sm text-red-700 hover:bg-red-50">
                  Sign out
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-12 border-t border-slate-200 bg-white">
        <div className="shell grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">{settings?.store_name || 'Ankit Stationery Mart'}</h2>
            <p className="mt-2 text-sm text-slate-600">
              {settings?.store_address || '147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India.'}
            </p>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              {settings?.store_phone ? (
                <p>
                  Phone: <a className="link" href={`tel:${settings.store_phone.replace(/\s/g, '')}`}>{settings.store_phone}</a>
                </p>
              ) : (
                <p className="text-slate-500">Phone not configured yet.</p>
              )}
              {settings?.store_email ? (
                <p>
                  Email: <a className="link" href={`mailto:${settings.store_email}`}>{settings.store_email}</a>
                </p>
              ) : (
                <p className="text-slate-500">Email not configured yet.</p>
              )}
              {settings?.store_opening_hours ? <p>Hours: {settings.store_opening_hours}</p> : <p className="text-slate-500">Opening hours not published.</p>}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Shop</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li><Link className="hover:text-navy-800 hover:underline" to="/products">All products</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/book-lists">Board &amp; class book finder</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/used-books">Second-hand books</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/sell-books">Sell your books</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/bulk-orders">Bulk orders &amp; quotations</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Help</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li><Link className="hover:text-navy-800 hover:underline" to="/faq">FAQs</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/contact">Contact us</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/track-order">Track an order</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/shipping-policy">Delivery</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/returns-refunds">Returns &amp; refunds</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Store information</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
              <li><Link className="hover:text-navy-800 hover:underline" to="/about">About the store</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/privacy-policy">Privacy policy</Link></li>
              <li><Link className="hover:text-navy-800 hover:underline" to="/terms">Terms of use</Link></li>
            </ul>
            <p className="mt-4 text-xs text-slate-500">
              Policies shown on this site are the store&rsquo;s configured terms. Where a policy is not configured, the page says so instead of
              inventing one.
            </p>
          </div>
        </div>
        <div className="border-t border-slate-200 py-4">
          <div className="shell flex flex-col items-center justify-between gap-2 text-xs text-slate-500 sm:flex-row">
            <p>© {new Date().getFullYear()} {settings?.store_name || 'Ankit Stationery Mart'}. All rights reserved.</p>
            <p className="flex items-center gap-3">
              <Link to="/terms" className="hover:underline">Terms</Link>
              <Link to="/privacy-policy" className="hover:underline">Privacy</Link>
              <span>Prices in INR (₹)</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
