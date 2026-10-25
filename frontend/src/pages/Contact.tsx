import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Field, SectionHeader } from '../components/ui'
import { useStore } from '../context/StoreContext'

export default function Contact() {
  const { settings, toast } = useStore()
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' })
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await api<{ message: string }>('/api/contact', {
        method: 'POST',
        body: { ...form, phone: form.phone || null },
      })
      setStatus(result.message)
      setForm({ name: '', email: '', phone: '', subject: '', message: '' })
      toast('Message recorded.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Seo
        title="Contact the store"
        description="Contact Ankit Stationery Mart at 147 Moolraj Road, Jalandhar Cantt, Punjab 144005. Send a message, ask about stock or request a bulk quotation."
        canonicalPath="/contact"
      />
      <div className="shell py-8">
        <SectionHeader title="Contact &amp; visit" subtitle="Questions about stock, an order or a bulk requirement? Send a message or visit the counter." />

        <div className="grid gap-6 lg:grid-cols-[1fr,1.1fr]">
          <div className="space-y-4">
            <div className="card p-5 text-sm text-slate-700">
              <h2 className="text-base font-semibold text-navy-900">{settings?.store_name || 'Ankit Stationery Mart'}</h2>
              <address className="mt-2 not-italic">
                {settings?.store_address || '147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India'}
              </address>
              <dl className="mt-3 space-y-1.5">
                <div>
                  <dt className="inline text-slate-500">Phone: </dt>
                  <dd className="inline">
                    {settings?.store_phone ? (
                      <a href={`tel:${settings.store_phone.replace(/\s/g, '')}`} className="link">{settings.store_phone}</a>
                    ) : (
                      <span className="text-slate-500">not configured yet</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">Email: </dt>
                  <dd className="inline">
                    {settings?.store_email ? (
                      <a href={`mailto:${settings.store_email}`} className="link">{settings.store_email}</a>
                    ) : (
                      <span className="text-slate-500">not configured yet</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">Opening hours: </dt>
                  <dd className="inline">{settings?.store_opening_hours || <span className="text-slate-500">not published</span>}</dd>
                </div>
              </dl>
              {settings?.store_map_url && (
                <a href={settings.store_map_url} target="_blank" rel="noreferrer noopener" className="btn-secondary btn-sm mt-3">
                  Open directions
                </a>
              )}
            </div>

            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-base font-semibold text-navy-900">Quick links</h2>
              <ul className="mt-2 space-y-1.5">
                <li><Link to="/track-order" className="link">Track an order</Link></li>
                <li><Link to="/returns-refunds" className="link">Returns &amp; refunds</Link></li>
                <li><Link to="/bulk-orders" className="link">Bulk quotation request</Link></li>
                <li><Link to="/sell-books" className="link">Sell your used books</Link></li>
                <li><Link to="/faq" className="link">Frequently asked questions</Link></li>
              </ul>
            </div>
          </div>

          <form onSubmit={submit} className="card space-y-3 p-5">
            <h2 className="text-base font-semibold text-navy-900">Send a message</h2>
            {status && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{status}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your name" required>
                <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
              </Field>
              <Field label="Email" required>
                <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
              </Field>
              <Field label="Phone" hint="Optional">
                <input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Subject" required>
                <input className="input" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </Field>
            </div>
            <Field label="Message" required>
              <textarea className="input" rows={5} required minLength={10} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </Field>
            {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sending…' : 'Send message'}
            </button>
            <p className="text-xs text-slate-500">
              Messages are stored in the store&rsquo;s admin inbox. Email replies depend on the store&rsquo;s configured email provider.
            </p>
          </form>
        </div>
      </div>
    </>
  )
}
