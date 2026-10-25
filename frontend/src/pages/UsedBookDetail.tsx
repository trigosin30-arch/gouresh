import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { ProductImage } from '../components/ProductCard'
import { Breadcrumbs, EmptyState, ErrorState, InfoRow, Modal, Price, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { dateOnly, money, titleCase } from '../format'
import type { Listing } from '../types'

type PurchaseResponse = { order: { id: string; order_number: string }; requires_payment: boolean }

export default function UsedBookDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user, settings, toast } = useStore()
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeImage, setActiveImage] = useState(0)
  const [buyOpen, setBuyOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('misleading_condition')
  const [reportDetails, setReportDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    fulfillment_type: 'pickup',
    payment_method: 'cod',
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    line1: '',
    locality: '',
    city: 'Jalandhar',
    state: 'Punjab',
    pincode: '',
    customer_note: '',
  })

  useEffect(() => {
    setLoading(true)
    api<Listing>(`/api/listings/${encodeURIComponent(code || '')}`)
      .then((data) => {
        setListing(data)
        setActiveImage(0)
        if (user) {
          setForm((current) => ({
            ...current,
            customer_name: current.customer_name || user.full_name,
            customer_phone: current.customer_phone || user.phone || '',
            customer_email: current.customer_email || user.email,
          }))
        }
      })
      .catch((err) => setError(err.status === 404 ? 'This listing is not available.' : err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user?.id])

  const startPurchase = () => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/used-books/${code}`)}`)
      return
    }
    setBuyOpen(true)
  }

  const purchase = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!listing) return
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        fulfillment_type: form.fulfillment_type,
        payment_method: form.payment_method,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        customer_note: form.customer_note || null,
      }
      if (form.fulfillment_type === 'delivery') {
        body.address = {
          label: 'Home',
          full_name: form.customer_name,
          phone: form.customer_phone,
          line1: form.line1,
          locality: form.locality,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          is_default: false,
        }
      }
      const result = await api<PurchaseResponse>(`/api/listings/${listing.id}/purchase`, { method: 'POST', body })
      toast(`Order ${result.order.order_number} created.`)
      setBuyOpen(false)
      navigate(`/orders/${result.order.id}`)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const submitReport = async () => {
    if (!listing) return
    setSubmitting(true)
    try {
      await api(`/api/listings/${listing.id}/report`, {
        method: 'POST',
        body: { reason: reportReason, details: reportDetails || null },
      })
      toast('Thank you — the store will review this listing.')
      setReportOpen(false)
      setReportDetails('')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="shell py-6">
      {loading && <Spinner label="Loading listing" />}
      {error && (
        <EmptyState
          title={error}
          message="The listing may have been sold, withdrawn or removed by the store."
          action={<Link to="/used-books" className="btn-primary">Back to second-hand books</Link>}
          icon="📕"
        />
      )}
      {listing && !loading && (
        <>
          <Seo
            title={`${listing.title} · second-hand`}
            description={`${listing.condition_label} copy listed by a verified customer. ${listing.condition_notes || ''}`.slice(0, 300)}
            canonicalPath={`/used-books/${listing.listing_code}`}
            image={listing.images[0]?.url}
          />
          <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Second-hand books', to: '/used-books' }, { label: listing.title }]} />

          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <div className="card overflow-hidden">
                <ProductImage
                  src={listing.images[activeImage]?.url || listing.image_url}
                  alt={listing.images[activeImage]?.alt_text || listing.image_alt}
                  className="aspect-square w-full"
                />
              </div>
              {listing.images.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {listing.images.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setActiveImage(index)}
                      className={`h-16 w-16 overflow-hidden rounded border-2 ${index === activeImage ? 'border-navy-700' : 'border-transparent'}`}
                      aria-label={`Photo ${index + 1}`}
                    >
                      <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Photographs are supplied by the seller. The store reviews condition claims before publishing, but always inspect a
                second-hand copy at handover.
              </p>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge-used">Second-hand · {listing.condition_label}</span>
                <span className={listing.status === 'active' ? 'badge-ok' : 'badge-muted'}>{listing.status_label}</span>
              </div>
              <h1 className="mt-3 text-2xl font-bold text-navy-900">{listing.title}</h1>
              <p className="mt-1 text-sm text-slate-600">
                {[listing.author, listing.publisher, listing.board, listing.class_level ? `Class ${listing.class_level}` : null, listing.subject]
                  .filter(Boolean)
                  .join(' · ') || 'Details supplied by the seller'}
              </p>
              <div className="mt-4">
                <Price paise={listing.asking_price_paise} size="lg" />
                <p className="mt-1 text-xs text-slate-500">Asking price set by the seller.</p>
              </div>

              {listing.is_owner ? (
                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                  <p className="font-medium text-navy-900">This is your listing</p>
                  <p className="mt-1 text-slate-600">
                    {listing.status === 'active'
                      ? 'It is live in the marketplace. You can withdraw it from your account.'
                      : 'It is not publicly visible yet. Check the moderation status in your account.'}
                  </p>
                  <Link to="/account" className="btn-secondary btn-sm mt-3">Manage listings</Link>
                </div>
              ) : listing.can_buy ? (
                <div className="mt-5 space-y-3">
                  <button type="button" className="btn-accent w-full" onClick={startPurchase}>
                    {user ? 'Buy this copy' : 'Sign in to buy'}
                  </button>
                  <p className="text-xs text-slate-500">
                    The store coordinates the handover. Seller contact details are never shown publicly.
                    {settings?.marketplace_note ? ` ${settings.marketplace_note}` : ''}
                  </p>
                </div>
              ) : (
                <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
                  This copy is no longer available for purchase.
                </div>
              )}

              <dl className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200 px-4 py-2 text-sm">
                <InfoRow label="Condition" value={listing.condition_label} />
                <InfoRow label="Seller" value={listing.seller_label} />
                <InfoRow label="ISBN" value={listing.isbn || '—'} />
                <InfoRow label="Board" value={listing.board || '—'} />
                <InfoRow label="Class" value={listing.class_level ? `Class ${listing.class_level}` : '—'} />
                <InfoRow label="Subject" value={listing.subject || '—'} />
                <InfoRow label="Listed" value={dateOnly(listing.published_at || listing.created_at)} />
              </dl>

              {listing.condition_notes && (
                <div className="mt-4 rounded-lg border border-slate-200 p-4">
                  <h2 className="text-sm font-semibold text-navy-900">Seller&rsquo;s condition notes</h2>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{listing.condition_notes}</p>
                </div>
              )}

              <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm text-slate-600">
                <h2 className="text-sm font-semibold text-navy-900">Handover &amp; payment</h2>
                <ul className="mt-2 space-y-1">
                  <li>
                    {listing.delivery?.pickup_enabled
                      ? 'Store pickup available once the copy is verified at the counter.'
                      : 'Store pickup is not currently offered.'}
                  </li>
                  <li>
                    {listing.delivery?.delivery_enabled
                      ? `Local delivery available for configured PIN codes (fee ${money(listing.delivery.delivery_fee_paise)}).`
                      : 'Home delivery is not configured.'}
                  </li>
                  <li>Commission at the configured rate: {((listing.commission_bp || 0) / 100).toFixed(2)}% — charged to the seller, not the buyer.</li>
                </ul>
              </div>

              <button type="button" className="btn-ghost btn-sm mt-4 text-red-700 hover:bg-red-50" onClick={() => setReportOpen(true)}>
                Report this listing
              </button>
            </div>
          </div>

          <Modal
            open={buyOpen}
            onClose={() => setBuyOpen(false)}
            title="Confirm second-hand purchase"
            wide
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setBuyOpen(false)}>Cancel</button>
                <button type="submit" form="purchase-form" className="btn-accent" disabled={submitting}>
                  {submitting ? 'Placing order…' : 'Place order'}
                </button>
              </>
            }
          >
            <form id="purchase-form" onSubmit={purchase} className="space-y-4">
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                This is a single-copy listing. Placing the order reserves it for you; the store will verify the copy before handover.
                {settings?.cod_enabled ? ' Cash on delivery/pickup is available.' : ''}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="label">Full name</span>
                  <input
                    className="input"
                    required
                    value={form.customer_name}
                    onChange={(event) => setForm({ ...form, customer_name: event.target.value })}
                  />
                </label>
                <label>
                  <span className="label">Phone</span>
                  <input
                    className="input"
                    required
                    inputMode="tel"
                    value={form.customer_phone}
                    onChange={(event) => setForm({ ...form, customer_phone: event.target.value })}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className="label">Email</span>
                  <input
                    className="input"
                    type="email"
                    required
                    value={form.customer_email}
                    onChange={(event) => setForm({ ...form, customer_email: event.target.value })}
                  />
                </label>
              </div>

              <fieldset>
                <legend className="label">How would you like to receive it?</legend>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="fulfillment"
                      value="pickup"
                      checked={form.fulfillment_type === 'pickup'}
                      onChange={() => setForm({ ...form, fulfillment_type: 'pickup' })}
                      disabled={!listing.delivery?.pickup_enabled}
                    />
                    Store pickup
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="fulfillment"
                      value="delivery"
                      checked={form.fulfillment_type === 'delivery'}
                      onChange={() => setForm({ ...form, fulfillment_type: 'delivery' })}
                      disabled={!listing.delivery?.delivery_enabled}
                    />
                    Home delivery
                  </label>
                </div>
              </fieldset>

              {form.fulfillment_type === 'delivery' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="label">Address</span>
                    <input className="input" required value={form.line1} onChange={(event) => setForm({ ...form, line1: event.target.value })} />
                  </label>
                  <label>
                    <span className="label">Locality</span>
                    <input className="input" required value={form.locality} onChange={(event) => setForm({ ...form, locality: event.target.value })} />
                  </label>
                  <label>
                    <span className="label">PIN code</span>
                    <input
                      className="input"
                      required
                      inputMode="numeric"
                      maxLength={6}
                      value={form.pincode}
                      onChange={(event) => setForm({ ...form, pincode: event.target.value })}
                    />
                  </label>
                  <label>
                    <span className="label">City</span>
                    <input className="input" required value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
                  </label>
                  <label>
                    <span className="label">State</span>
                    <input className="input" required value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} />
                  </label>
                </div>
              )}

              <fieldset>
                <legend className="label">Payment method</legend>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="payment"
                      value="cod"
                      checked={form.payment_method === 'cod'}
                      onChange={() => setForm({ ...form, payment_method: 'cod' })}
                      disabled={!settings?.payment_methods?.includes('cod')}
                    />
                    Cash on {form.fulfillment_type === 'pickup' ? 'pickup' : 'delivery'}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="payment"
                      value="online"
                      checked={form.payment_method === 'online'}
                      onChange={() => setForm({ ...form, payment_method: 'online' })}
                      disabled={!settings?.payment_methods?.includes('online')}
                    />
                    Pay online
                  </label>
                </div>
                {!settings?.payment_methods?.length && (
                  <p className="mt-2 text-xs text-red-700">No payment method is configured. Please contact the store.</p>
                )}
              </fieldset>

              <label>
                <span className="label">Note for the store (optional)</span>
                <textarea
                  className="input"
                  rows={2}
                  value={form.customer_note}
                  onChange={(event) => setForm({ ...form, customer_note: event.target.value })}
                />
              </label>
            </form>
          </Modal>

          <Modal
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            title="Report this listing"
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setReportOpen(false)}>Cancel</button>
                <button type="button" className="btn-danger" onClick={submitReport} disabled={submitting}>
                  Submit report
                </button>
              </>
            }
          >
            <div className="space-y-3">
              <label>
                <span className="label">Reason</span>
                <select className="input" value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                  <option value="misleading_condition">Condition is misrepresented</option>
                  <option value="wrong_book">Not the book described</option>
                  <option value="duplicate">Duplicate or spam listing</option>
                  <option value="fraud">Suspected fraud</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                <span className="label">Details (optional)</span>
                <textarea className="input" rows={3} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} />
              </label>
              <p className="text-xs text-slate-500">Reports are reviewed by the store. Your identity is not shared with the seller.</p>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}
