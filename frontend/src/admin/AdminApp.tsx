import { useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { useStore } from '../context/StoreContext'
import AuditAdmin from './AuditAdmin'
import ContentAdmin from './ContentAdmin'
import CouponsAdmin from './CouponsAdmin'
import CustomersAdmin from './CustomersAdmin'
import Dashboard from './Dashboard'
import MarketplaceAdmin from './MarketplaceAdmin'
import MoneyAdmin from './MoneyAdmin'
import OperationsAdmin from './OperationsAdmin'
import OrdersAdmin from './OrdersAdmin'
import ProductsAdmin from './ProductsAdmin'
import QuotationsAdmin from './QuotationsAdmin'
import SettingsAdmin from './SettingsAdmin'

const NAV = [
  { group: 'Overview', items: [{ to: '/admin', label: 'Dashboard', end: true }] },
  {
    group: 'Catalogue',
    items: [
      { to: '/admin/products', label: 'Products' },
      { to: '/admin/content', label: 'Categories, banners & FAQs' },
    ],
  },
  { group: 'Orders', items: [{ to: '/admin/orders', label: 'Orders & shipments' }] },
  {
    group: 'Marketplace',
    items: [
      { to: '/admin/marketplace', label: 'Listings & submissions' },
      { to: '/admin/quotations', label: 'Bulk quotations' },
      { to: '/admin/money', label: 'Commissions & payouts' },
    ],
  },
  {
    group: 'Customers',
    items: [
      { to: '/admin/customers', label: 'Customers' },
      { to: '/admin/operations', label: 'Returns, messages & stock' },
    ],
  },
  {
    group: 'Store setup',
    items: [
      { to: '/admin/settings', label: 'Store settings' },
      { to: '/admin/coupons', label: 'Coupons' },
      { to: '/admin/audit', label: 'Audit & notifications' },
    ],
  },
]

export default function AdminApp() {
  const { user, refresh, setUser, toast } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const isAdmin = user?.role === 'admin'

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setUser(null)
      await refresh()
      navigate('/')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Seo title="Store administration" noindex canonicalPath="/admin" />
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to admin content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-navy-900 text-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded border border-white/30 px-2 py-1 text-xs lg:hidden"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="admin-nav"
            >
              Menu
            </button>
            <Link to="/admin" className="text-sm font-semibold">
              Ankit Stationery Mart · Admin
            </Link>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline text-navy-100">{user?.email}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-medium uppercase tracking-wide">{user?.role}</span>
            <Link to="/" className="rounded border border-white/30 px-2 py-1 hover:bg-white/10">View store</Link>
            <button type="button" onClick={() => void logout()} className="rounded border border-white/30 px-2 py-1 hover:bg-white/10">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-0 lg:gap-6 lg:px-4">
        <nav
          id="admin-nav"
          aria-label="Administration"
          className={`${open ? 'block' : 'hidden'} w-full shrink-0 border-b border-slate-200 bg-white px-4 py-4 lg:block lg:w-64 lg:border-0 lg:bg-transparent lg:py-6`}
        >
          {NAV.map((section) => (
            <div key={section.group} className="mb-4">
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.group}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={(item as { end?: boolean }).end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-md px-2.5 py-2 text-sm ${
                          isActive ? 'bg-navy-900 font-medium text-white' : 'text-slate-700 hover:bg-white hover:text-navy-900'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <p className="font-semibold text-navy-900">{isAdmin ? 'Administrator access' : 'Staff access'}</p>
            <p className="mt-1">
              {isAdmin
                ? 'You can change settings, prices, roles and refunds. Every change is written to the audit log.'
                : 'Staff can fulfil orders and moderate content. Creating products, changing settings, roles and refunds requires an administrator.'}
            </p>
          </div>
        </nav>

        <main id="admin-main" className="min-w-0 flex-1 bg-slate-50 px-4 py-6 lg:px-0">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<ProductsAdmin />} />
            <Route path="content" element={<ContentAdmin />} />
            <Route path="orders" element={<OrdersAdmin />} />
            <Route path="orders/:orderId" element={<OrdersAdmin />} />
            <Route path="marketplace" element={<MarketplaceAdmin />} />
            <Route path="quotations" element={<QuotationsAdmin />} />
            <Route path="money" element={<MoneyAdmin />} />
            <Route path="customers" element={<CustomersAdmin />} />
            <Route path="operations" element={<OperationsAdmin />} />
            <Route path="settings" element={<SettingsAdmin />} />
            <Route path="coupons" element={<CouponsAdmin />} />
            <Route path="audit" element={<AuditAdmin />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
