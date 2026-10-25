import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal, Pagination } from '../components/ui'
import { dateTime, money, titleCase } from '../format'
import { AdminHeader, Empty, Panel, StatusPill, Tabs, toPaise } from './ui'
import type { AdminListing, AdminReport, AdminSubmission } from './types'

export default function MarketplaceAdmin() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'listings'

  return (
    <div>
      <AdminHeader
        title="Second-hand marketplace"
        description="Customer submissions and listings. Nothing becomes publicly visible until a staff member moderates it."
      />
      <Tabs
        tabs={[
          { id: 'listings', label: 'Listings' },
          { id: 'submissions', label: 'Submissions' },
          { id: 'reports', label: 'Reports' },
        ]}
        active={tab}
        onChange={(next) => setParams({ tab: next })}
      />
      {tab === 'listings' && <Listings />}
      {tab === 'submissions' && <Submissions />}
      {tab === 'reports' && <Reports />}
    </div>
  )
}

function Listings() {
  const { toast } = useStore()
  const [items, setItems] = useState<AdminListing[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const [status, setStatus] = useState('pending_review')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<AdminListing | null>(null)
  const [decision, setDecision] = useState('active')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ page: String(page), per_page: '20' })
      if (status) query.set('status', status)
      if (q.trim()) query.set('q', q.trim())
      const data = await api<{ listings: AdminListing[]; pages: number; statuses: string[] }>(`/api/admin/listings?${query}`)
      setItems(data.listings)
      setPages(data.pages)
      setStatuses(data.statuses)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, status, q])

  useEffect(() => {
    void load()
  }, [load])

  const moderate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      await api(`/api/admin/listings/${target.id}/moderate`, { method: 'POST', body: { status: decision, note: note || null } })
      toast(`Listing ${decision === 'active' ? 'approved and published' : decision}.`)
      setTarget(null)
      setNote('')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="label">Search</span>
          <input
            className="input"
            value={q}
            onChange={(event) => {
              setPage(1)
              setQ(event.target.value)
            }}
            placeholder="Title, listing code or ISBN"
          />
        </label>
        <label>
          <span className="label">Status</span>
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setPage(1)
              setStatus(event.target.value)
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((value) => (
              <option key={value} value={value}>{titleCase(value)}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading listings…</p>}

      {!loading && items.length === 0 && <Empty title="No listings in this view" hint="Try another status filter." />}

      <div className="space-y-3">
        {items.map((listing) => (
          <article key={listing.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex gap-3">
                {listing.images[0] ? (
                  <img src={listing.images[0].url} alt="" className="h-24 w-20 rounded object-cover" />
                ) : (
                  <span className="flex h-24 w-20 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">No photo</span>
                )}
                <div>
                  <p className="font-semibold text-navy-900">{listing.title}</p>
                  <p className="text-xs text-slate-500">
                    {listing.listing_code} · {titleCase(listing.condition)} · {money(listing.asking_price_paise)} · submitted {dateTime(listing.created_at)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Seller: {listing.seller.name || 'unknown'} ({listing.seller.email || 'no email'})
                  </p>
                  {listing.condition_notes && <p className="mt-1 text-xs text-slate-600">Seller notes: {listing.condition_notes}</p>}
                  {listing.moderation_note && <p className="mt-1 text-xs text-amber-800">Moderator: {listing.moderation_note}</p>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusPill status={listing.status} />
                <div className="flex flex-wrap gap-2 text-xs">
                  {listing.status !== 'sold' && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setTarget(listing)
                        setDecision(listing.status === 'pending_review' ? 'active' : 'suspended')
                        setNote(listing.moderation_note || '')
                      }}
                    >
                      Moderate
                    </button>
                  )}
                  <Link to={`/used-books/${listing.listing_code}`} target="_blank" rel="noreferrer" className="link">View public page</Link>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      <Pagination page={page} pages={pages} onChange={setPage} />

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Moderate ${target.listing_code}` : 'Moderate listing'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" form="moderate-form" className="btn-primary" disabled={busy}>Apply decision</button>
          </>
        }
      >
        {target && (
          <form id="moderate-form" onSubmit={moderate} className="space-y-3">
            <p className="text-sm text-slate-600">
              “{target.title}” by {target.seller.name || 'unknown seller'} at {money(target.asking_price_paise)}.
            </p>
            <Field label="Decision" required>
              <select className="input" value={decision} onChange={(event) => setDecision(event.target.value)}>
                <option value="active">Approve and publish</option>
                <option value="rejected">Reject</option>
                <option value="suspended">Suspend (already public)</option>
                <option value="archived">Archive</option>
              </select>
            </Field>
            <Field label="Moderator note" hint="Shared with the seller in their notification and shown to them on the listing.">
              <textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">
              Approving publishes the book to the storefront. Photos and descriptions must match the physical book; ask the seller for another photo
              if anything is unclear.
            </p>
          </form>
        )}
      </Modal>
    </div>
  )
}

function Submissions() {
  const { toast } = useStore()
  const [items, setItems] = useState<AdminSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<AdminSubmission | null>(null)
  const [form, setForm] = useState({ status: 'approved', note: '', price: '' })
  const [convert, setConvert] = useState<AdminSubmission | null>(null)
  const [asking, setAsking] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ submissions: AdminSubmission[] }>('/api/admin/submissions')
      setItems(data.submissions)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submitReview = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!review) return
    setBusy(true)
    try {
      await api(`/api/admin/submissions/${review.id}/review`, {
        method: 'POST',
        body: {
          status: form.status,
          admin_note: form.note || null,
          recommended_price_paise: form.price ? toPaise(form.price) : null,
        },
      })
      toast('Submission reviewed and the seller notified.')
      setReview(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const convertTo = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!convert) return
    setBusy(true)
    try {
      const result = await api<{ listing: { listing_code: string } }>(`/api/admin/submissions/${convert.id}/convert`, {
        method: 'POST',
        body: { asking_price_paise: asking ? toPaise(asking) : null },
      })
      toast(`Listing ${result.listing.listing_code} created — it still needs moderation approval.`)
      setConvert(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading submissions…</p>}
      {!loading && items.length === 0 && <Empty title="No submissions yet" hint="Customer book submissions arrive from the Sell Books page." />}

      {items.map((submission) => (
        <article key={submission.id} className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              {submission.photos[0] ? (
                <a href={submission.photos[0]} target="_blank" rel="noreferrer">
                  <img src={submission.photos[0]} alt="" className="h-24 w-20 rounded object-cover" />
                </a>
              ) : (
                <span className="flex h-24 w-20 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">No photo</span>
              )}
              <div>
                <p className="font-semibold text-navy-900">{submission.book_title}</p>
                <p className="text-xs text-slate-500">
                  {submission.reference} · {titleCase(submission.condition)} · wants {submission.expected_price_paise ? money(submission.expected_price_paise) : 'store offer'} ·{' '}
                  {submission.selling_method === 'sell_to_store' ? 'sell to store' : 'marketplace listing'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {submission.contact_name} · {submission.contact_phone || 'no phone'} · {submission.contact_email}
                </p>
                {submission.notes && <p className="mt-1 text-xs text-slate-600">Notes: {submission.notes}</p>}
                {submission.admin_note && <p className="mt-1 text-xs text-amber-800">Reviewed: {submission.admin_note}</p>}
                <p className="mt-1 text-[11px] text-slate-400">Submitted {dateTime(submission.created_at)} · {submission.user_id ? 'registered user' : 'guest submission'}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusPill status={submission.status} />
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setReview(submission)
                    setForm({
                      status: submission.status === 'submitted' ? 'under_review' : 'approved',
                      note: submission.admin_note || '',
                      price: submission.expected_price_paise ? (submission.expected_price_paise / 100).toString() : '',
                    })
                  }}
                >
                  Review
                </button>
                {!submission.listing_id && submission.user_id && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setConvert(submission)
                      setAsking(submission.expected_price_paise ? (submission.expected_price_paise / 100).toString() : '')
                    }}
                  >
                    Create listing
                  </button>
                )}
              </div>
              {submission.listing_id && <span className="text-[11px] text-slate-500">Listing created</span>}
            </div>
          </div>
        </article>
      ))}

      <Modal
        open={review !== null}
        onClose={() => setReview(null)}
        title={review ? `Review ${review.reference}` : 'Review submission'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReview(null)}>Cancel</button>
            <button type="submit" form="review-form" className="btn-primary" disabled={busy}>Save review</button>
          </>
        }
      >
        {review && (
          <form id="review-form" onSubmit={submitReview} className="space-y-3">
            <p className="text-sm text-slate-600">
              {review.book_title} · condition {titleCase(review.condition)} · {review.selling_method === 'sell_to_store' ? 'customer wants to sell to the store' : 'customer wants a marketplace listing'}
            </p>
            <Field label="New status" required>
              <select className="input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="under_review">Under review</option>
                <option value="details_requested">Need more details</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Note to the customer">
              <textarea className="input" rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
            </Field>
            <Field label="Recommended price (₹)" hint="Optional. Added to the customer-visible note.">
              <input className="input" inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
            </Field>
            <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">
              “Completed” is for a submission the store has finished handling (paid for or collected). It does not trigger any payment by itself.
            </p>
          </form>
        )}
      </Modal>

      <Modal
        open={convert !== null}
        onClose={() => setConvert(null)}
        title="Create a marketplace listing from this submission"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConvert(null)}>Cancel</button>
            <button type="submit" form="convert-form" className="btn-primary" disabled={busy}>Create draft listing</button>
          </>
        }
      >
        {convert && (
          <form id="convert-form" onSubmit={convertTo} className="space-y-3">
            <p className="text-sm text-slate-600">
              A listing is created in <strong>pending review</strong> state. You still need to moderate it before buyers can see it.
            </p>
            <Field label="Asking price (₹)" required hint="The seller's expected price is pre-filled; confirm it before publishing.">
              <input className="input" inputMode="decimal" required value={asking} onChange={(event) => setAsking(event.target.value)} />
            </Field>
            {!convert.user_id && <p className="text-xs text-red-700">This guest submission has no account, so a listing cannot be created.</p>}
          </form>
        )}
      </Modal>
    </div>
  )
}

function Reports() {
  const { toast } = useStore()
  const [status, setStatus] = useState('open')
  const [items, setItems] = useState<AdminReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<AdminReport | null>(null)
  const [note, setNote] = useState('')
  const [decision, setDecision] = useState('resolved')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ reports: AdminReport[] }>(`/api/admin/reports?status_filter=${status}`)
      setItems(data.reports)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const resolve = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      await api(`/api/admin/reports/${target.id}`, { method: 'POST', body: { status: decision, note } })
      toast('Report updated.')
      setTarget(null)
      setNote('')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label>
          <span className="label">Report status</span>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading reports…</p>}
      {!loading && items.length === 0 && <Empty title="No reports in this view" hint="Buyers can report a listing from its public page." />}

      {items.map((report) => (
        <Panel key={report.id} title={`${report.listing_code || 'Listing'} · ${report.reason}`} description={`Reported ${dateTime(report.created_at)}`}>
          <p className="text-sm text-slate-700">{report.details || 'No extra details provided.'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={report.status} />
            <Link to={`/admin/marketplace?tab=listings`} className="link text-xs">Open listings to moderate</Link>
            {report.status === 'open' && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setTarget(report)
                  setDecision('resolved')
                  setNote('')
                }}
              >
                Resolve report
              </button>
            )}
          </div>
        </Panel>
      ))}

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Resolve listing report"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTarget(null)}>Cancel</button>
            <button type="submit" form="report-form" className="btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        <form id="report-form" onSubmit={resolve} className="space-y-3">
          <Field label="Outcome">
            <select className="input" value={decision} onChange={(event) => setDecision(event.target.value)}>
              <option value="resolved">Resolved (action taken or explained)</option>
              <option value="dismissed">Dismissed (no action needed)</option>
            </select>
          </Field>
          <Field label="Internal note">
            <textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
