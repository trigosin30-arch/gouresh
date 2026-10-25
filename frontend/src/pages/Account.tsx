import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useApi } from '../lib/useApi'
import { useToast } from '../lib/toast'
import { shortDate } from '../lib/format'
import type { Address, AddressDraft, Profile } from '../lib/types'
import { EmptyState, Field, Loading, StatusBadge } from '../components/ui'
import { IconArrow, IconPin, IconPlus, IconTrash } from '../components/Icons'

const EMPTY: AddressDraft = {
  label: 'Home',
  contact_name: '',
  phone: '',
  line1: '',
  line2: '',
  locality: '',
  city: 'Shimla',
  state: 'Himachal Pradesh',
  pincode: '171001',
}

export default function Account() {
  const { profile, loading: authLoading, patchProfile, signOut, config } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { data, loading, reload } = useApi<{ profile: Profile; addresses: Address[] }>('/me')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<AddressDraft>(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!authLoading && !profile) navigate('/login?next=/account', { replace: true })
  }, [authLoading, profile, navigate])

  useEffect(() => {
    if (data?.profile) {
      setFullName(data.profile.full_name)
      setPhone(data.profile.phone ?? '')
    }
  }, [data?.profile])

  if (authLoading) return <Loading label="Loading your account" />

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setSavingProfile(true)
    try {
      await patchProfile({ full_name: fullName.trim(), phone: phone.trim() || undefined })
      toast.push('Profile updated', 'success')
      void reload()
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Could not save profile', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  const saveAddress = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setBusy(true)
    try {
      await api.post('/me/addresses', draft)
      toast.push('Address saved', 'success')
      setShowForm(false)
      setDraft(EMPTY)
      void reload()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save address')
    } finally {
      setBusy(false)
    }
  }

  const removeAddress = async (id: string) => {
    if (!window.confirm('Remove this address?')) return
    try {
      await api.del(`/me/addresses/${id}`)
      toast.push('Address removed')
      void reload()
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Could not remove address', 'error')
    }
  }

  const makeDefault = async (id: string) => {
    try {
      await api.post(`/me/addresses/${id}/default`)
      void reload()
    } catch {
      toast.push('Could not update the default address', 'error')
    }
  }

  const addresses = data?.addresses ?? []

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Your account</h1>
          <p>
            {data?.profile?.email ?? profile?.email} · member since{' '}
            {shortDate(data?.profile?.created_at ?? profile?.created_at)}
            {profile?.role !== 'customer' ? ` · ${profile?.role}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await signOut()
            navigate('/')
          }}
        >
          Sign out
        </button>
      </div>

      <div className="account-layout">
        <nav className="account-nav" aria-label="Account">
          <a href="#profile" className="active">
            Profile
          </a>
          <a href="#addresses">Saved addresses</a>
          <Link to="/orders">Orders</Link>
          {profile?.role === 'admin' || profile?.role === 'staff' ? <Link to="/admin">Admin</Link> : null}
        </nav>

        <div className="stack" style={{ gap: 22 }}>
          <section className="card" id="profile">
            <div className="card-head">
              <h3>Profile details</h3>
              <span className="badge badge-muted">{profile?.role}</span>
            </div>
            <form className="card-body form-grid" onSubmit={saveProfile}>
              <Field label="Full name" htmlFor="full_name">
                <input
                  id="full_name"
                  className="input"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  minLength={2}
                  required
                />
              </Field>
              <Field label="Mobile number" htmlFor="profile-phone" hint="Used for delivery calls">
                <input
                  id="profile-phone"
                  className="input"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  placeholder="98765 43210"
                />
              </Field>
              <Field label="Email" htmlFor="profile-email" className="span-2" hint="Email is managed by your sign-in provider">
                <input id="profile-email" className="input" value={data?.profile?.email ?? ''} disabled />
              </Field>
              <div className="span-2">
                <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>

          <section className="card" id="addresses">
            <div className="card-head">
              <h3>Saved addresses</h3>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setShowForm((value) => !value)}>
                <IconPlus size={14} /> {showForm ? 'Close' : 'Add address'}
              </button>
            </div>
            <div className="card-body stack" style={{ gap: 12 }}>
              {loading ? <Loading label="Loading addresses" /> : null}
              {!loading && addresses.length === 0 ? (
                <EmptyState title="No saved addresses">Add one to check out in two taps next time.</EmptyState>
              ) : null}
              {addresses.map((address) => (
                <div
                  key={address.id}
                  className="card"
                  style={{ padding: 16, boxShadow: 'none', background: '#fdfaf4' }}
                >
                  <div className="row-between wrap" style={{ alignItems: 'flex-start' }}>
                    <div className="small">
                      <strong>
                        {address.contact_name} · {address.phone}
                      </strong>
                      {address.is_default ? <span className="badge badge-good" style={{ marginLeft: 8 }}>Default</span> : null}
                      <div className="muted" style={{ marginTop: 4 }}>
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ''}
                        {address.locality ? `, ${address.locality}` : ''}
                        <br />
                        {address.city}, {address.state} {address.pincode}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {!address.is_default ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => makeDefault(address.id)}>
                          Make default
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeAddress(address.id)}
                        aria-label="Remove address"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {showForm ? (
                <form className="form-grid" onSubmit={saveAddress} style={{ marginTop: 8 }}>
                  <Field label="Contact name" htmlFor="a-name">
                    <input
                      id="a-name"
                      className="input"
                      value={draft.contact_name}
                      onChange={(event) => setDraft({ ...draft, contact_name: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Mobile number" htmlFor="a-phone">
                    <input
                      id="a-phone"
                      className="input"
                      value={draft.phone}
                      onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                      inputMode="tel"
                      required
                    />
                  </Field>
                  <Field label="Address line" htmlFor="a-line1" className="span-2">
                    <input
                      id="a-line1"
                      className="input"
                      value={draft.line1}
                      onChange={(event) => setDraft({ ...draft, line1: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Landmark / area" htmlFor="a-line2">
                    <input
                      id="a-line2"
                      className="input"
                      value={draft.line2 ?? ''}
                      onChange={(event) => setDraft({ ...draft, line2: event.target.value })}
                    />
                  </Field>
                  <Field label="Locality" htmlFor="a-locality">
                    <input
                      id="a-locality"
                      className="input"
                      value={draft.locality ?? ''}
                      onChange={(event) => setDraft({ ...draft, locality: event.target.value })}
                    />
                  </Field>
                  <Field label="City" htmlFor="a-city">
                    <input
                      id="a-city"
                      className="input"
                      value={draft.city}
                      onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label="State" htmlFor="a-state">
                    <input
                      id="a-state"
                      className="input"
                      value={draft.state}
                      onChange={(event) => setDraft({ ...draft, state: event.target.value })}
                      required
                    />
                  </Field>
                  <Field label="PIN code" htmlFor="a-pin">
                    <input
                      id="a-pin"
                      className="input"
                      value={draft.pincode}
                      onChange={(event) => setDraft({ ...draft, pincode: event.target.value })}
                      inputMode="numeric"
                      required
                    />
                  </Field>
                  <Field label="Label" htmlFor="a-label">
                    <input
                      id="a-label"
                      className="input"
                      value={draft.label}
                      onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                    />
                  </Field>
                  {formError ? <div className="notice notice-danger span-2">{formError}</div> : null}
                  <div className="span-2 row" style={{ gap: 8 }}>
                    <button type="submit" className="btn btn-primary" disabled={busy}>
                      {busy ? 'Saving…' : 'Save address'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Recent order status</h3>
              <Link to="/orders" className="btn-link small">
                All orders <IconArrow size={13} />
              </Link>
            </div>
            <div className="card-body small">
              {data?.profile ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  <IconPin size={14} /> Deliveries go to your default address. You can track every order from
                  the <Link to="/orders">orders page</Link>.
                </p>
              ) : null}
              <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                <StatusBadge status="confirmed" />
                <span className="muted">Orders are confirmed once payment is verified on the server.</span>
              </div>
            </div>
          </section>

          {config?.environment !== 'production' ? (
            <p className="tiny muted">
              This is a demonstration deployment. Payments run in {config?.payments.mode} mode and no money is
              collected.
            </p>
          ) : null}
        </div>
      </div>
    </>
  )
}
