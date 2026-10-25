import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, uploadImage } from '../api'
import Seo from '../components/Seo'
import { Breadcrumbs, Field, SectionHeader } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { Submission } from '../types'

const CONDITIONS = [
  { value: 'like_new', label: 'Like New', hint: 'Read once, no writing or damage.' },
  { value: 'good', label: 'Good', hint: 'Some wear, all pages intact, minor marks.' },
  { value: 'acceptable', label: 'Acceptable', hint: 'Clearly used, heavy wear but complete and readable.' },
]

const METHODS = [
  {
    value: 'marketplace_listing',
    label: 'List on the marketplace',
    hint: 'The store reviews your submission and, if approved, publishes a listing other customers can buy.',
  },
  {
    value: 'store_evaluation',
    label: 'Ask the store to evaluate it',
    hint: 'A request for the store to look at the book and tell you what they can offer. Not a purchase or a guaranteed price.',
  },
  {
    value: 'enquiry',
    label: 'General enquiry',
    hint: 'Tell us what you have and ask how resale could work.',
  },
]

export default function SellBooks() {
  const { user, toast } = useStore()
  const [form, setForm] = useState({
    book_title: '',
    isbn: '',
    author: '',
    publisher: '',
    board: '',
    class_level: '',
    subject: '',
    condition: 'good',
    expected_price: '',
    selling_method: 'marketplace_listing',
    contact_name: user?.full_name || '',
    contact_phone: user?.phone || '',
    contact_email: user?.email || '',
    pickup_address: '',
    notes: '',
  })
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reference, setReference] = useState<string | null>(null)
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (photos.length + files.length > 5) {
      toast('You can attach up to 5 photographs.', 'error')
      return
    }
    setUploading(true)
    try {
      const uploaded: string[] = []
      for (const file of Array.from(files)) {
        const result = await uploadImage(file, '/api/uploads/submission-photo')
        uploaded.push(result.url)
      }
      setPhotos((current) => [...current, ...uploaded])
      toast(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} uploaded.`)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (photos.length === 0) {
      setError('Add at least one photograph of the book so the store can review it.')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        book_title: form.book_title,
        isbn: form.isbn || null,
        author: form.author || null,
        publisher: form.publisher || null,
        board: form.board || null,
        class_level: form.class_level || null,
        subject: form.subject || null,
        condition: form.condition,
        expected_price_paise: form.expected_price ? Math.round(Number(form.expected_price) * 100) : null,
        selling_method: form.selling_method,
        contact_name: form.contact_name,
        contact_phone: form.contact_phone,
        contact_email: form.contact_email,
        pickup_address: form.pickup_address || null,
        notes: form.notes || null,
        photo_urls: photos,
      }
      const result = await api<{ submission: Submission; message: string }>('/api/submissions', { method: 'POST', body: payload })
      setReference(result.submission.reference)
      setMessage(result.message)
      toast(`Submission ${result.submission.reference} recorded.`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (reference) {
    return (
      <>
        <Seo title="Submission received" noindex canonicalPath="/sell-books" />
        <div className="shell py-12">
          <div className="card mx-auto max-w-2xl p-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Submission recorded</p>
            <h1 className="mt-2 text-2xl font-bold text-navy-900">Reference {reference}</h1>
            <p className="mt-3 text-sm text-slate-700">{message}</p>
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-medium text-navy-900">What happens next</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>The store reviews the photographs and condition details.</li>
                <li>You may be asked for more information or to bring the book to the counter.</li>
                <li>Nothing is listed for sale and no payment is promised until the store approves it.</li>
              </ul>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {user ? (
                <Link to="/account" className="btn-primary">Track this in your account</Link>
              ) : (
                <Link to="/register" className="btn-primary">Create an account to track it</Link>
              )}
              <Link to="/used-books" className="btn-secondary">Browse second-hand books</Link>
            </div>
            {!user && (
              <p className="mt-3 text-xs text-slate-500">
                Keep the reference {reference} safe — the store may ask for it when contacting you.
              </p>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Seo
        title="Sell your books"
        description="Submit used school books and guides to Ankit Stationery Mart for review. Every submission is moderated before it can be listed."
        canonicalPath="/sell-books"
      />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Sell your books' }]} />
        <SectionHeader
          title="Sell your used books"
          subtitle="Tell us what you have. The store reviews every submission before anything is listed — this form is a request, not an instant sale."
        />

        <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
          <form onSubmit={submit} className="card space-y-5 p-5">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-navy-900">Book details</legend>
              <Field label="Book title" htmlFor="book_title" required>
                <input id="book_title" className="input" required value={form.book_title} onChange={(e) => update('book_title', e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Author" htmlFor="author">
                  <input id="author" className="input" value={form.author} onChange={(e) => update('author', e.target.value)} />
                </Field>
                <Field label="Publisher" htmlFor="publisher">
                  <input id="publisher" className="input" value={form.publisher} onChange={(e) => update('publisher', e.target.value)} />
                </Field>
                <Field label="ISBN" htmlFor="isbn" hint="Printed on the back cover, if present.">
                  <input id="isbn" className="input" value={form.isbn} onChange={(e) => update('isbn', e.target.value)} />
                </Field>
                <Field label="Board" htmlFor="board">
                  <select id="board" className="input" value={form.board} onChange={(e) => update('board', e.target.value)}>
                    <option value="">Not applicable</option>
                    {['CBSE', 'ICSE/ISC', 'PSEB', 'Other State Board', 'University', 'Other'].map((board) => (
                      <option key={board} value={board}>{board}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Class / grade" htmlFor="class_level">
                  <input id="class_level" className="input" value={form.class_level} onChange={(e) => update('class_level', e.target.value)} />
                </Field>
                <Field label="Subject" htmlFor="subject">
                  <input id="subject" className="input" value={form.subject} onChange={(e) => update('subject', e.target.value)} />
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-navy-900">Condition</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {CONDITIONS.map((condition) => (
                  <label
                    key={condition.value}
                    className={`cursor-pointer rounded-lg border p-3 text-sm ${
                      form.condition === condition.value ? 'border-navy-700 bg-navy-50' : 'border-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input
                        type="radio"
                        name="condition"
                        value={condition.value}
                        checked={form.condition === condition.value}
                        onChange={() => update('condition', condition.value)}
                      />
                      {condition.label}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{condition.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Field label="Expected selling price (₹)" htmlFor="expected_price" hint="Optional. The store may recommend a different price.">
              <input
                id="expected_price"
                className="input"
                inputMode="numeric"
                type="number"
                min="0"
                value={form.expected_price}
                onChange={(e) => update('expected_price', e.target.value)}
              />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-navy-900">Photographs</legend>
              <p className="text-xs text-slate-500">Upload 1–5 clear photos of the actual copy (cover, spine, any damage). JPEG, PNG or WebP, max 4 MB each.</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="input file:mr-3 file:rounded file:border-0 file:bg-navy-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-navy-800"
                onChange={(event) => void upload(event.target.files)}
                aria-label="Upload book photographs"
              />
              {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photos.map((url) => (
                    <div key={url} className="relative">
                      <img src={url} alt="Uploaded book" className="h-20 w-20 rounded object-cover" />
                      <button
                        type="button"
                        className="absolute -right-2 -top-2 rounded-full bg-white px-1.5 text-xs shadow"
                        onClick={() => setPhotos((current) => current.filter((item) => item !== url))}
                        aria-label="Remove photograph"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-navy-900">How would you like to sell?</legend>
              {METHODS.map((method) => (
                <label key={method.value} className="flex gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                  <input
                    type="radio"
                    name="selling_method"
                    value={method.value}
                    checked={form.selling_method === method.value}
                    onChange={() => update('selling_method', method.value)}
                  />
                  <span>
                    <span className="block font-medium text-navy-900">{method.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{method.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-navy-900">Your contact &amp; pickup details (private)</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Your name" required>
                  <input className="input" required value={form.contact_name} onChange={(e) => update('contact_name', e.target.value)} />
                </Field>
                <Field label="Phone" required hint="Used only by the store; never shown publicly.">
                  <input className="input" required inputMode="tel" value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
                </Field>
                <Field label="Email" required>
                  <input className="input" type="email" required value={form.contact_email} onChange={(e) => update('contact_email', e.target.value)} />
                </Field>
                <Field label="Pickup / drop-off address">
                  <input className="input" value={form.pickup_address} onChange={(e) => update('pickup_address', e.target.value)} />
                </Field>
              </div>
              <Field label="Anything else the store should know">
                <textarea className="input" rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
              </Field>
            </fieldset>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-accent w-full" disabled={submitting || uploading}>
              {submitting ? 'Submitting…' : 'Submit for store review'}
            </button>
            <p className="text-xs text-slate-500">
              Submitting does not sell the book and does not guarantee a payout. The store will contact you before anything is listed or paid.
            </p>
          </form>

          <aside className="space-y-4">
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">How resale works here</h2>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>You submit the book with real photos and condition details.</li>
                <li>The store checks the copy — moderators may reject inaccurate listings.</li>
                <li>Approved books either become a marketplace listing or a store evaluation, depending on your choice.</li>
                <li>If a marketplace copy sells, the store records the sale value, the platform commission and your proceeds.</li>
              </ol>
              <p className="mt-3 text-xs text-slate-500">
                {user
                  ? 'Your submissions are visible in your account with their review status.'
                  : 'Create an account to track submission status and marketplace sales in one place.'}
              </p>
              {!user && <Link to="/register" className="btn-secondary btn-sm mt-3">Create an account</Link>}
            </div>
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Condition guide</h2>
              <dl className="mt-2 space-y-2">
                {CONDITIONS.map((condition) => (
                  <div key={condition.value}>
                    <dt className="font-medium text-navy-900">{condition.label}</dt>
                    <dd className="text-xs text-slate-500">{condition.hint}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Prefer to visit?</h2>
              <p className="mt-1">Bring the books to 147 Moolraj Road, Jalandhar Cantt during store hours and ask at the counter.</p>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
