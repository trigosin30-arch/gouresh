import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, qs } from '../api'
import Seo from '../components/Seo'
import { Field, SectionHeader } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { Product } from '../types'

type Line = { key: string; product_id: string | null; description: string; quantity: number }

const newLine = (): Line => ({ key: Math.random().toString(36).slice(2), product_id: null, description: '', quantity: 10 })

export default function BulkOrders() {
  const { user, toast } = useStore()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    organization_name: '',
    organization_type: 'School',
    contact_name: user?.full_name || '',
    contact_email: user?.email || '',
    contact_phone: user?.phone || '',
    delivery_location: '',
    target_date: '',
    notes: '',
  })
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([])
      return
    }
    const timer = window.setTimeout(() => {
      api<{ items: Product[] }>(`/api/products${qs({ q: search.trim(), per_page: 6 })}`)
        .then((data) => setResults(data.items))
        .catch(() => setResults([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const attachProduct = (lineKey: string, product: Product) => {
    updateLine(lineKey, { product_id: product.id, description: product.title })
    setSearch('')
    setResults([])
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const items = lines.filter((line) => line.description.trim().length >= 2 && line.quantity > 0)
    if (items.length === 0) {
      setError('Add at least one product line with a description and quantity.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api<{ quotation: { reference: string }; access_token: string; message: string }>('/api/quotations', {
        method: 'POST',
        body: {
          ...form,
          target_date: form.target_date || null,
          notes: form.notes || null,
          items: items.map((line) => ({
            product_id: line.product_id,
            description: line.description.trim(),
            quantity: line.quantity,
          })),
        },
      })
      toast(`Request ${result.quotation.reference} submitted.`)
      navigate(`/quotations/${result.quotation.reference}?token=${result.access_token}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Seo
        title="Bulk orders & quotations"
        description="Request a bulk quotation for school textbooks, notebooks and stationery from Ankit Stationery Mart. For schools, coaching centres, offices and institutions."
        canonicalPath="/bulk-orders"
      />
      <div className="shell py-8">
        <SectionHeader
          title="Bulk orders &amp; quotations"
          subtitle="For schools, coaching centres, offices and institutions. Submit a request and the store will prepare a priced quotation for you to accept."
        />

        <div className="grid gap-6 lg:grid-cols-[1.7fr,1fr]">
          <form onSubmit={submit} className="space-y-4">
            <section className="card space-y-3 p-5">
              <h2 className="text-base font-semibold text-navy-900">1. Organisation</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Organisation name" required>
                  <input className="input" required value={form.organization_name} onChange={(e) => setForm({ ...form, organization_name: e.target.value })} />
                </Field>
                <Field label="Organisation type" required>
                  <select className="input" value={form.organization_type} onChange={(e) => setForm({ ...form, organization_type: e.target.value })}>
                    {['School', 'Coaching centre', 'College', 'Office', 'NGO / Institution', 'Other'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Contact person" required>
                  <input className="input" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
                </Field>
                <Field label="Phone" required>
                  <input className="input" required inputMode="tel" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
                </Field>
                <Field label="Email" required hint="Quotation updates and the document link are sent here.">
                  <input className="input" type="email" required value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
                </Field>
                <Field label="Required by">
                  <input className="input" type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} />
                </Field>
              </div>
              <Field label="Delivery location" required>
                <textarea className="input" rows={2} required value={form.delivery_location} onChange={(e) => setForm({ ...form, delivery_location: e.target.value })} />
              </Field>
            </section>

            <section className="card space-y-3 p-5">
              <h2 className="text-base font-semibold text-navy-900">2. Products &amp; quantities</h2>
              <p className="text-xs text-slate-500">
                Attach a catalogue product for an exact match, or describe the item if it is not listed. Quantities are required.
              </p>
              <div className="space-y-3">
                {lines.map((line) => (
                  <div key={line.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr,120px,auto]">
                      <label>
                        <span className="label">Item</span>
                        <input
                          className="input"
                          placeholder="e.g. A4 ruled notebooks 200 pages"
                          value={line.description}
                          onChange={(event) => updateLine(line.key, { description: event.target.value, product_id: null })}
                          required
                        />
                      </label>
                      <label>
                        <span className="label">Quantity</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(event) => updateLine(line.key, { quantity: Number(event.target.value) })}
                          required
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-red-700"
                          onClick={() => setLines((current) => (current.length === 1 ? current : current.filter((item) => item.key !== line.key)))}
                          aria-label="Remove line"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {line.product_id && <p className="mt-1 text-xs text-emerald-700">Linked to a catalogue product.</p>}
                  </div>
                ))}
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((current) => [...current, newLine()])}>
                + Add another item
              </button>

              <div>
                <label className="label" htmlFor="bulk-product-search">Attach a catalogue product (optional)</label>
                <input
                  id="bulk-product-search"
                  className="input"
                  placeholder="Search the catalogue"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {results.length > 0 && (
                  <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {results.map((product) => (
                      <li key={product.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">{product.title}</span>
                        <button
                          type="button"
                          className="btn-secondary btn-sm shrink-0"
                          onClick={() => {
                            const target = lines.find((line) => !line.description) || lines[0]
                            attachProduct(target.key, product)
                          }}
                        >
                          Attach
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Field label="Additional requirements">
                <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Board/class details, branding, delivery timing…" />
              </Field>
            </section>

            {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-accent" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Request quotation'}
              </button>
              <p className="text-xs text-slate-500">
                This submits a request. No order or payment is created until you review and accept a priced quotation.
              </p>
            </div>
          </form>

          <aside className="space-y-4">
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">How quotations work</h2>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>You submit the request with quantities and a delivery location.</li>
                <li>The store reviews availability and prepares line-item pricing.</li>
                <li>You receive a quotation document with a validity date.</li>
                <li>If you accept it, the store converts it into an order and confirms delivery/payment terms.</li>
              </ol>
              <p className="mt-3 rounded bg-slate-50 p-2 text-xs">
                Quotations are not automatically confirmed orders. Prices can change if the request is not accepted before it expires.
              </p>
            </div>
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Already requested?</h2>
              <p className="mt-1">Open your quotation with the link from the confirmation, or look it up using the reference and email.</p>
              <Link to="/track-order" className="link mt-2 inline-block text-xs">Track an order instead →</Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
