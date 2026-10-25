import { Link } from 'react-router-dom'
import Seo from '../components/Seo'
import { SectionHeader } from '../components/ui'
import { useStore } from '../context/StoreContext'

export default function About() {
  const { settings } = useStore()

  return (
    <>
      <Seo
        title="About the store"
        description="Ankit Stationery Mart is a stationery and book shop at 147 Moolraj Road, Jalandhar Cantt, Punjab 144005, serving students, teachers and offices."
        canonicalPath="/about"
      />
      <div className="shell py-8">
        <SectionHeader title="About Ankit Stationery Mart" subtitle="A local stationery and book store, with the shop counter at the centre of everything." />

        <div className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
          <div className="card space-y-4 p-6 text-sm leading-relaxed text-slate-700">
            <p>
              Ankit Stationery Mart is a physical stationery and book store located at <strong>147 Moolraj Road, Jalandhar Cantt, Punjab
              144005, India</strong>. Students, teachers, schools and offices come to the counter for notebooks, writing instruments, art
              supplies, school supplies and textbooks.
            </p>
            <p>
              This website extends the same shop: you can check what is actually on the shelf, order for store pickup or local delivery where
              configured, ask for a bulk quotation, and offer your used books back to the community through a moderated marketplace.
            </p>
            <h2 className="text-base font-semibold text-navy-900">What we intentionally do not claim</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>No ratings or customer testimonials are shown, because none have been verified.</li>
              <li>No &ldquo;bestseller&rdquo; labels appear unless real sales data supports them.</li>
              <li>Delivery areas, charges, opening hours and policies are only shown when the store has configured them.</li>
              <li>Second-hand listings are published only after store moderation; contact details of sellers are never public.</li>
            </ul>
            <h2 className="text-base font-semibold text-navy-900">Verified store details</h2>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Address</dt>
                <dd>{settings?.store_address || '147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Phone</dt>
                <dd>{settings?.store_phone || <span className="text-slate-500">Not published yet</span>}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
                <dd>{settings?.store_email || <span className="text-slate-500">Not published yet</span>}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Opening hours</dt>
                <dd>{settings?.store_opening_hours || <span className="text-slate-500">Not published yet</span>}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              If a detail above is missing, the owner has not configured it — the website does not guess business information.
            </p>
          </div>

          <aside className="space-y-4">
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Shop with confidence</h2>
              <ul className="mt-2 space-y-2">
                <li>Stock and prices are checked on the server when you order.</li>
                <li>Order status is updated only by authorised store staff.</li>
                <li>Second-hand listings require moderation before publication.</li>
                <li>You can report a suspicious listing from its page.</li>
              </ul>
            </div>
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Policies</h2>
              <ul className="mt-2 space-y-1.5">
                <li><Link to="/shipping-policy" className="link">Delivery &amp; pickup</Link></li>
                <li><Link to="/returns-refunds" className="link">Returns &amp; refunds</Link></li>
                <li><Link to="/privacy-policy" className="link">Privacy</Link></li>
                <li><Link to="/terms" className="link">Terms of use</Link></li>
              </ul>
            </div>
            <div className="card p-5 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Visit or write</h2>
              <p className="mt-1">Questions are welcome — the store answers during business hours.</p>
              <Link to="/contact" className="btn-primary btn-sm mt-3">Contact the store</Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
