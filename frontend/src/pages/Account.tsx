import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { EmptyState, ErrorState, Field, Modal, SectionHeader, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { dateOnly, dateTime, money, titleCase } from '../format'
import type { Listing, Notification, Submission, User } from '../types'

type Address = {
  id: string
  label: string
  full_name: string
  phone: string
  line1: string
  line2: string | null
  locality: string
  city: string
  state: string
  pincode: string
  is_default: boolean
}

type Sales = {
  sales: { id: string; order_number: string | null; listing_title: string | null; gross_paise: number; commission_paise: number; seller_proceeds_paise: number; status: string; created_at: string }[]
  totals: { gross_paise: number; commission_paise: number; proceeds_paise: number; paid_paise: number; outstanding_paise: number }
  note: string
}

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'addresses', label: 'Addresses' },
  { id: 'submissions', label: 'Book submissions' },
  { id: 'listings', label: 'Marketplace listings' },
  { id: 'sales', label: 'Marketplace sales' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy & security' },
]

const emptyAddress = {
  label: 'Home',
  full_name: '',
  phone: '',
  line1: '',
  line2: '',
  locality: '',
  city: 'Jalandhar',
  state: 'Punjab',
  pincode: '',
  is_default: false,
}

export default function Account() {
  const { user, setUser, refresh, toast, confirm } = useStore()
  const [tab, setTab] = useState('profile')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [listings, setListings] = useState<Listing[]>([])
  const [sales, setSales] = useState<Sales | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [profile, setProfile] = useState({ full_name: user?.full_name || '', phone: user?.phone || '' })
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' })
  const [addressModal, setAddressModal] = useState(false)
  const [addressForm, setAddressForm] = useState({ ...emptyAddress, full_name: user?.full_name || '', phone: user?.phone || '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [addressData, submissionData, listingData, salesData, notificationData] = await Promise.all([
        api<{ addresses: Address[] }>('/api/auth/addresses'),
        api<{ submissions: Submission[] }>('/api/me/submissions'),
        api<{ items: Listing[] }>('/api/me/listings'),
        api<Sales>('/api/me/marketplace-sales'),
        api<{ notifications: Notification[] }>('/api/me/notifications'),
      ])
      setAddresses(addressData.addresses)
      setSubmissions(submissionData.submissions)
      setListings(listingData.items)
      setSales(salesData)
      setNotifications(notificationData.notifications)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api<{ user: User }>('/api/auth/profile', { method: 'POST', body: { full_name: profile.full_name, phone: profile.phone || null } })
      setUser(result.user)
      toast('Profile updated.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/auth/change-password', { method: 'POST', body: passwords })
      setPasswords({ current_password: '', new_password: '' })
      toast('Password changed.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const addAddress = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/auth/addresses', {
        method: 'POST',
        body: { ...addressForm, line2: addressForm.line2 || null },
      })
      setAddressModal(false)
      setAddressForm({ ...emptyAddress })
      await load()
      toast('Address saved.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const deleteAddress = async (address: Address) => {
    const ok = await confirm({ title: 'Delete address?', message: `${address.label}: ${address.line1}`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await api(`/api/auth/addresses/${address.id}`, { method: 'DELETE' })
      await load()
      toast('Address deleted.')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const withdrawListing = async (listing: Listing) => {
    const ok = await confirm({
      title: 'Withdraw listing?',
      message: `“${listing.title}” will be removed from the marketplace. You can submit it again later.`,
      confirmLabel: 'Withdraw',
      danger: true,
    })
    if (!ok) return
    try {
      await api(`/api/me/listings/${listing.id}/withdraw`, { method: 'POST' })
      await load()
      toast('Listing withdrawn.')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const markRead = async () => {
    try {
      await api('/api/me/notifications/read', { method: 'POST' })
      await refresh()
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const requestDeletion = async () => {
    const ok = await confirm({
      title: 'Request account deletion?',
      message:
        'Your account will be restricted immediately and the store will contact you to confirm. Order and tax records are retained as required for accounting.',
      confirmLabel: 'Request deletion',
      danger: true,
    })
    if (!ok) return
    try {
      const result = await api<{ message: string }>('/api/auth/delete-request', { method: 'POST' })
      toast(result.message, 'info')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (loading) {
    return (
      <div className="shell py-10">
        <Spinner label="Loading your account" />
      </div>
    )
  }

  return (
    <>
      <Seo title="Your account" noindex canonicalPath="/account" />
      <div className="shell py-8">
        <SectionHeader
          title={`Hello, ${user?.full_name?.split(' ')[0] || 'there'}`}
          subtitle={`${user?.email}${user?.phone ? ` · ${user.phone}` : ''}`}
          action={
            <div className="flex gap-2">
              <Link to="/orders" className="btn-secondary btn-sm">Your orders</Link>
              <Link to="/wishlist" className="btn-secondary btn-sm">Wishlist</Link>
            </div>
          }
        />

        {error && <ErrorState message={error} onRetry={() => void load()} />}

        <div className="grid gap-6 lg:grid-cols-[220px,1fr]">
          <nav className="card h-fit p-2" aria-label="Account sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                  tab === item.id ? 'bg-navy-50 font-semibold text-navy-900' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {item.label}
                {item.id === 'notifications' && notifications.some((n) => !n.is_read) && (
                  <span className="ml-2 rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">
                    {notifications.filter((n) => !n.is_read).length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="space-y-4">
            {tab === 'profile' && (
              <>
                <form onSubmit={saveProfile} className="card space-y-3 p-5">
                  <h2 className="text-base font-semibold text-navy-900">Profile</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Full name" required>
                      <input className="input" required value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
                    </Field>
                    <Field label="Phone" hint="Used for order updates only.">
                      <input className="input" inputMode="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">Email: {user?.email} — contact the store to change the email on your account.</p>
                  <button type="submit" className="btn-primary" disabled={busy}>Save profile</button>
                </form>
                <form onSubmit={changePassword} className="card space-y-3 p-5">
                  <h2 className="text-base font-semibold text-navy-900">Change password</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {user?.has_password === false ? (
                      <p className="rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-900">
                        You sign in with Google and have no password yet. Set one below to also be able to sign in with
                        your email address.
                      </p>
                    ) : (
                      <Field label="Current password" required>
                        <input
                          type="password"
                          className="input"
                          required
                          autoComplete="current-password"
                          value={passwords.current_password}
                          onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })}
                        />
                      </Field>
                    )}
                    <Field label="New password" required hint="At least 10 characters.">
                      <input
                        type="password"
                        className="input"
                        required
                        minLength={10}
                        autoComplete="new-password"
                        value={passwords.new_password}
                        onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
                      />
                    </Field>
                  </div>
                  <button type="submit" className="btn-secondary" disabled={busy}>Update password</button>
                </form>
              </>
            )}

            {tab === 'addresses' && (
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy-900">Saved addresses</h2>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setAddressModal(true)}>Add address</button>
                </div>
                {addresses.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No addresses saved yet. You can also enter one at checkout.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {addresses.map((address) => (
                      <li key={address.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div className="text-sm">
                          <p className="font-medium text-navy-900">
                            {address.label} {address.is_default && <span className="badge-ok ml-1">Default</span>}
                          </p>
                          <p className="text-slate-600">
                            {address.full_name} · {address.phone}
                          </p>
                          <p className="text-slate-600">
                            {address.line1}
                            {address.line2 ? `, ${address.line2}` : ''}, {address.locality}, {address.city}, {address.state} {address.pincode}
                          </p>
                        </div>
                        <button type="button" className="text-xs font-medium text-red-700 hover:underline" onClick={() => void deleteAddress(address)}>
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'submissions' && (
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy-900">Used-book submissions</h2>
                  <Link to="/sell-books" className="btn-secondary btn-sm">New submission</Link>
                </div>
                {submissions.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">You have not submitted any books yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {submissions.map((submission) => (
                      <li key={submission.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-navy-900">{submission.book_title}</p>
                            <p className="text-xs text-slate-500">
                              {submission.reference} · submitted {dateOnly(submission.created_at)} ·{' '}
                              {titleCase(submission.selling_method)}
                            </p>
                          </div>
                          <span className={submission.status === 'approved' || submission.status === 'converted_to_listing' ? 'badge-ok' : submission.status === 'rejected' ? 'badge-danger' : 'badge-warn'}>
                            {titleCase(submission.status)}
                          </span>
                        </div>
                        {submission.admin_note && <p className="mt-1 text-xs text-slate-600">Store note: {submission.admin_note}</p>}
                        {submission.listing_id && (
                          <Link to={`/used-books/${submission.listing_id}`} className="mt-1 inline-block text-xs link">View listing</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'listings' && (
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy-900">Marketplace listings</h2>
                  <Link to="/sell-books" className="btn-secondary btn-sm">List another book</Link>
                </div>
                {listings.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No marketplace listings yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {listings.map((listing) => (
                      <li key={listing.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div className="flex gap-3">
                          {listing.image_url && <img src={listing.image_url} alt="" className="h-16 w-14 rounded object-cover" />}
                          <div>
                            <p className="text-sm font-medium text-navy-900">{listing.title}</p>
                            <p className="text-xs text-slate-500">
                              {listing.listing_code} · {money(listing.asking_price_paise)} · {titleCase(listing.condition)}
                            </p>
                            {listing.moderation_note && <p className="text-xs text-slate-600">Moderator: {listing.moderation_note}</p>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className={listing.status === 'active' ? 'badge-ok' : listing.status === 'rejected' ? 'badge-danger' : 'badge-muted'}>
                            {listing.status_label}
                          </span>
                          {['active', 'pending_review', 'withdrawn'].includes(listing.status) && (
                            <button type="button" className="text-xs font-medium text-red-700 hover:underline" onClick={() => void withdrawListing(listing)}>
                              Withdraw
                            </button>
                          )}
                          <Link to={`/used-books/${listing.listing_code}`} className="text-xs link">View</Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'sales' && sales && (
              <div className="space-y-4">
                <div className="card p-5">
                  <h2 className="text-base font-semibold text-navy-900">Marketplace sales &amp; commission</h2>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">Gross sales</dt>
                      <dd className="text-lg font-semibold">{money(sales.totals.gross_paise)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Commission</dt>
                      <dd className="text-lg font-semibold">{money(sales.totals.commission_paise)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Your proceeds</dt>
                      <dd className="text-lg font-semibold">{money(sales.totals.proceeds_paise)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Outstanding</dt>
                      <dd className="text-lg font-semibold">{money(sales.totals.outstanding_paise)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-slate-500">{sales.note}</p>
                  {sales.sales.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">No marketplace sales recorded yet.</p>
                  ) : (
                    <div className="table-wrap mt-3">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Order</th>
                            <th>Book</th>
                            <th>Gross</th>
                            <th>Commission</th>
                            <th>Proceeds</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sales.sales.map((sale) => (
                            <tr key={sale.id}>
                              <td>{sale.order_number || '—'}</td>
                              <td>{sale.listing_title || '—'}</td>
                              <td>{money(sale.gross_paise)}</td>
                              <td>{money(sale.commission_paise)}</td>
                              <td>{money(sale.seller_proceeds_paise)}</td>
                              <td><span className="badge-muted">{titleCase(sale.status)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'notifications' && (
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy-900">Notifications</h2>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void markRead()}>Mark all read</button>
                </div>
                {notifications.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No notifications yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {notifications.map((notification) => (
                      <li key={notification.id} className="py-3">
                        <p className="text-sm font-medium text-navy-900">{notification.subject}</p>
                        <p className="text-xs text-slate-500">{dateTime(notification.created_at)}</p>
                        <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{notification.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-xs text-slate-500">
                  Email notifications are sent only when the store has configured an email provider. In-app notifications always appear here.
                </p>
              </div>
            )}

            {tab === 'privacy' && (
              <div className="card space-y-4 p-5 text-sm text-slate-600">
                <h2 className="text-base font-semibold text-navy-900">Privacy &amp; account controls</h2>
                <p>
                  Your phone number, address and submissions are private. They are shared with store staff only to fulfil orders, moderate
                  listings and process requests. Seller contact details are never shown publicly.
                </p>
                <div>
                  <h3 className="text-sm font-semibold text-navy-900">Download your data</h3>
                  <p className="mt-1">
                    Contact the store to request an export of your account data. Because orders are financial records, they may be retained after
                    deletion in line with the store&rsquo;s legal obligations.
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-navy-900">Delete your account</h3>
                  <p className="mt-1">
                    This records a deletion request and restricts the account. The store will confirm within 7 working days.
                  </p>
                  <button type="button" className="btn-danger btn-sm mt-2" onClick={() => void requestDeletion()}>
                    Request account deletion
                  </button>
                </div>
                <Link to="/privacy-policy" className="link">Read the privacy policy →</Link>
              </div>
            )}
          </div>
        </div>

        <Modal
          open={addressModal}
          onClose={() => setAddressModal(false)}
          title="Add a delivery address"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setAddressModal(false)}>Cancel</button>
              <button type="submit" form="address-form" className="btn-primary" disabled={busy}>Save address</button>
            </>
          }
        >
          <form id="address-form" onSubmit={addAddress} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Label" required>
                <input className="input" required value={addressForm.label} onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })} />
              </Field>
              <Field label="Full name" required>
                <input className="input" required value={addressForm.full_name} onChange={(e) => setAddressForm({ ...addressForm, full_name: e.target.value })} />
              </Field>
              <Field label="Phone" required>
                <input className="input" required inputMode="tel" value={addressForm.phone} onChange={(e) => setAddressForm({ ...addressForm, phone: e.target.value })} />
              </Field>
              <Field label="PIN code" required>
                <input
                  className="input"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={addressForm.pincode}
                  onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
            </div>
            <Field label="Address line 1" required>
              <input className="input" required value={addressForm.line1} onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })} />
            </Field>
            <Field label="Address line 2">
              <input className="input" value={addressForm.line2} onChange={(e) => setAddressForm({ ...addressForm, line2: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Locality" required>
                <input className="input" required value={addressForm.locality} onChange={(e) => setAddressForm({ ...addressForm, locality: e.target.value })} />
              </Field>
              <Field label="City" required>
                <input className="input" required value={addressForm.city} onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} />
              </Field>
              <Field label="State" required>
                <input className="input" required value={addressForm.state} onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={addressForm.is_default} onChange={(e) => setAddressForm({ ...addressForm, is_default: e.target.checked })} />
              Make this my default address
            </label>
          </form>
        </Modal>
      </div>
    </>
  )
}
