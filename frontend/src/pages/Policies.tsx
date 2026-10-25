import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Breadcrumbs, ErrorState, SectionHeader } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { money } from '../format'

export type PolicyKind = 'privacy' | 'terms' | 'shipping' | 'returns'

type PoliciesData = {
  store_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  opening_hours: string | null
  shipping_note: string | null
  returns_note: string | null
  return_window_days: number | null
  cancellation_window_hours: number | null
  delivery_enabled: boolean
  delivery_fee_paise: number
  delivery_pincodes: string[]
  cod_enabled: boolean
  tax_enabled: boolean
  tax_rate_bp: number
  marketplace_note: string | null
  demo_mode: boolean
  online_payments_available: boolean
}

const META: Record<PolicyKind, { title: string; path: string; summary: string }> = {
  privacy: {
    title: 'Privacy policy',
    path: '/privacy-policy',
    summary: 'What this website collects, why, how long it is kept, and the controls you have.',
  },
  terms: {
    title: 'Terms of use',
    path: '/terms',
    summary: 'The rules for using this website, ordering and the second-hand marketplace.',
  },
  shipping: {
    title: 'Delivery & pickup',
    path: '/shipping-policy',
    summary: 'How orders reach you, what the store charges, and where delivery is offered.',
  },
  returns: {
    title: 'Returns & refunds',
    path: '/returns-refunds',
    summary: 'How to request a return or cancellation, and how refunds are recorded.',
  },
}

export default function Policies({ kind }: { kind: PolicyKind }) {
  const { settings } = useStore()
  const [data, setData] = useState<PoliciesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const meta = META[kind]

  useEffect(() => {
    api<PoliciesData>('/api/store/policies')
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <>
      <Seo title={meta.title} description={meta.summary} canonicalPath={meta.path} />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: meta.title }]} />
        <SectionHeader title={meta.title} subtitle={meta.summary} />

        {error && <ErrorState message={error} />}

        <div className="grid gap-6 lg:grid-cols-[1fr,260px]">
          <article className="card space-y-5 p-6 text-sm leading-relaxed text-slate-700">
            {kind === 'privacy' && <Privacy data={data} />}
            {kind === 'terms' && <Terms data={data} />}
            {kind === 'shipping' && <Shipping data={data} settings={settings} />}
            {kind === 'returns' && <Returns data={data} settings={settings} />}
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              This page describes what the website actually does. Business-specific commitments (delivery areas, fees, opening hours, return
              windows) are only stated when the store has configured them; everything else is shown as not published.
            </p>
          </article>

          <aside className="space-y-4">
            <div className="card p-4 text-sm">
              <h2 className="text-sm font-semibold text-navy-900">All policies</h2>
              <ul className="mt-2 space-y-1.5">
                {(Object.keys(META) as PolicyKind[]).map((key) => (
                  <li key={key}>
                    {key === kind ? (
                      <span className="font-medium text-navy-900">{META[key].title}</span>
                    ) : (
                      <Link to={META[key].path} className="link">{META[key].title}</Link>
                    )}
                  </li>
                ))}
                <li><Link to="/faq" className="link">FAQs</Link></li>
              </ul>
            </div>
            <div className="card p-4 text-sm text-slate-600">
              <h2 className="text-sm font-semibold text-navy-900">Store contact</h2>
              <p className="mt-1">{data?.address || '147 Moolraj Road, Jalandhar Cantt, Punjab 144005'}</p>
              {data?.phone && <p className="mt-1">Phone: {data.phone}</p>}
              {data?.email && <p>Email: {data.email}</p>}
              <Link to="/contact" className="btn-secondary btn-sm mt-3">Contact the store</Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

function NotPublished({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900">{children}</span>
}

function Privacy({ data }: { data: PoliciesData | null }) {
  return (
    <>
      <h2 className="text-base font-semibold text-navy-900">Who runs this website</h2>
      <p>
        {data?.store_name || 'Ankit Stationery Mart'}
        {data?.address ? `, ${data.address}` : ', 147 Moolraj Road, Jalandhar Cantt, Punjab 144005'}.
        {data?.email ? ` Privacy contact: ${data.email}.` : ' A dedicated privacy contact has not been published yet.'}
      </p>

      <h2 className="text-base font-semibold text-navy-900">What is collected and why</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Account data:</strong> name, email, optional phone number and a password stored only as an Argon2 hash.</li>
        <li><strong>Order data:</strong> items, prices, payment method, fulfilment choice, and the address/phone needed to deliver or prepare a pickup.</li>
        <li><strong>Messages:</strong> contact form contents, return/refund reasons, and bulk quotation requirements.</li>
        <li><strong>Second-hand submissions:</strong> book details, photos and any pickup address you provide. Seller contact details are not shown publicly.</li>
        <li><strong>Technical data:</strong> a session cookie, a CSRF token cookie, and server logs needed for security and rate limiting.</li>
      </ul>

      <h2 className="text-base font-semibold text-navy-900">Cookies used</h2>
      <p>
        Two strictly necessary cookies: <code>asm_session</code> (HttpOnly session identifier) and <code>asm_csrf</code> (cross-site request
        forgery token). A guest cart cookie is used only when you add items without signing in. No advertising or analytics cookies are set by
        this website.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Who can see your data</h2>
      <p>
        Store staff and administrators can see the information needed to run the shop. Payment details for online payments are handled by the
        configured payment gateway; card and UPI credentials never reach this server. Email addresses are shared with the configured email
        provider only to deliver transactional messages.
      </p>

      <h2 className="text-base font-semibold text-navy-900">How long it is kept</h2>
      <p>
        Order and tax records are retained for the period required by applicable accounting law. Account and marketing data are deleted or
        anonymised after a deletion request is confirmed, except records the store is legally required to keep.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Your controls</h2>
      <p>
        You can update your profile, change your password, delete saved addresses, and request account deletion from{' '}
        <Link to="/account" className="link">your account page</Link>. A deletion request restricts the account immediately and is reviewed by
        staff; you can ask for an export of your data by contacting the store.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Security</h2>
      <p>
        Passwords are hashed with Argon2, sessions use HttpOnly cookies with a CSRF token, and mutating requests are checked server-side. No
        website can promise perfect security; if you believe your account is compromised, change your password and contact the store
        immediately.
      </p>

      {data?.demo_mode && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          This deployment is running with sample/demo data. Demo accounts exist for evaluation and must be removed before real customer data is
          stored.
        </p>
      )}
    </>
  )
}

function Terms({ data }: { data: PoliciesData | null }) {
  return (
    <>
      <h2 className="text-base font-semibold text-navy-900">Using this website</h2>
      <p>
        The store is {data?.store_name || 'Ankit Stationery Mart'}
        {data?.address ? ` at ${data.address}` : ' at 147 Moolraj Road, Jalandhar Cantt, Punjab 144005'}. By creating an account or placing an
        order you agree to these terms. You must give accurate contact and delivery information and keep your password private.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Products, prices and availability</h2>
      <p>
        Prices and stock are shown from the store&rsquo;s own records and are re-checked on the server when you order. If an item becomes
        unavailable between adding it to the cart and placing the order, the order is refused and you are told which item changed. Product
        photographs and descriptions are for identification; editions and covers can differ between printings.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Orders and payment</h2>
      <p>
        An order is placed only when the website confirms an order number. Paying cash on pickup or delivery means payment is collected at
        handover. Online payment is offered only when a payment gateway is configured; if it is not, the website says so instead of pretending a
        payment succeeded. Quotation requests are not orders — they become orders only after the store prices them, you accept, and the store
        records the conversion.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Second-hand marketplace</h2>
      <p>
        Sellers must own the books they list and describe their condition honestly. Listings are published only after moderation, and contact
        details are never shown publicly. The store may reject, suspend or withdraw a listing that is inaccurate, prohibited or reported.
        Commission is an accounting charge on the book price and is shown to sellers; payouts are made by the store after handover and are never
        automatic. Proceeds cannot be withdrawn before the sale is recorded and reviewed.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Acceptable use</h2>
      <p>
        Do not attempt to break authentication, scrape personal data, submit fraudulent orders, upload illegal or infringing images, or use the
        marketplace to sell stolen or prohibited material. Accounts may be restricted for abuse; orders already placed remain subject to these
        terms.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Liability and law</h2>
      <p>
        These terms are governed by Indian law. Nothing here removes rights you have as a consumer under applicable consumer protection law.
        Where a statutory right conflicts with a statement on this page, the statutory right applies.
      </p>
    </>
  )
}

function Shipping({ data, settings }: { data: PoliciesData | null; settings: any }) {
  const pincodes = data?.delivery_pincodes || []
  return (
    <>
      <h2 className="text-base font-semibold text-navy-900">Store pickup</h2>
      <p>
        Collect from {data?.address || '147 Moolraj Road, Jalandhar Cantt, Punjab 144005'} during store hours.
        {data?.opening_hours ? ` Opening hours: ${data.opening_hours}.` : ' Opening hours have not been published on this site yet.'} Please wait
        for the order status to show that the order is ready before travelling.
      </p>
      {settings?.pickup_instructions && <p className="rounded bg-slate-50 p-2 text-xs">{settings.pickup_instructions}</p>}

      <h2 className="text-base font-semibold text-navy-900">Home delivery</h2>
      {data?.delivery_enabled ? (
        <>
          <p>
            Delivery is offered to the PIN codes listed below. The delivery fee is {money(data.delivery_fee_paise)} per order
            {settings?.free_delivery_threshold_paise
              ? `, and is free for orders above ${money(settings.free_delivery_threshold_paise)}`
              : ''}
            . The exact fee is always shown in the cart and at checkout before you place the order.
          </p>
          <p>
            Serviceable PIN codes:{' '}
            {pincodes.length > 0 ? pincodes.join(', ') : <NotPublished>Not configured</NotPublished>}
          </p>
        </>
      ) : (
        <p>
          <NotPublished>Home delivery is not enabled</NotPublished> — the store has not configured delivery areas or fees. Only store pickup
          is offered for now. Do not assume a delivery option exists until the checkout shows it.
        </p>
      )}
      {data?.shipping_note && <p className="rounded-lg bg-navy-50 p-3 text-sm text-navy-900">{data.shipping_note}</p>}

      <h2 className="text-base font-semibold text-navy-900">Dispatch and delays</h2>
      <p>
        Delivery times depend on staff availability and local conditions. The order status history on your order page records what actually
        happened. If the store cannot deliver to your address after an order is placed, staff will contact you to arrange pickup or cancel the
        order.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Bulk orders</h2>
      <p>
        Bulk and institutional orders are quoted individually. Delivery terms for those orders are written on the quotation itself, not on this
        page.
      </p>
    </>
  )
}

function Returns({ data, settings }: { data: PoliciesData | null; settings: any }) {
  const window = data?.return_window_days ?? 0
  const cancelWindow = data?.cancellation_window_hours ?? 0
  return (
    <>
      <h2 className="text-base font-semibold text-navy-900">Cancelling an order</h2>
      {cancelWindow > 0 ? (
        <p>
          You can cancel an order from your account within {cancelWindow} hour{cancelWindow === 1 ? '' : 's'} of placing it, while it has not
          been dispatched. Cancelling returns reserved stock to the store. If you paid online, the store processes the refund; the website
          records the refund only after staff confirm it.
        </p>
      ) : (
        <p>
          <NotPublished>Online cancellation window is not configured</NotPublished> — contact the store to cancel an order. The order page
          shows a cancel button only when the store has configured a window.
        </p>
      )}

      <h2 className="text-base font-semibold text-navy-900">Returns</h2>
      {window > 0 ? (
        <p>
          Return requests are accepted for delivered orders for {window} day{window === 1 ? '' : 's'} after delivery. Submit the request from
          your order page with a description of the problem. The store reviews each request and may ask for photographs. Refunds are recorded
          only after staff approve and process the return.
        </p>
      ) : (
        <p>
          <NotPublished>Return window is not configured</NotPublished> — the website does not promise a return period that the store has not
          published. Contact the store about a defective or incorrect item; your statutory consumer rights still apply.
        </p>
      )}
      {data?.returns_note && <p className="rounded-lg bg-navy-50 p-3 text-sm text-navy-900">{data.returns_note}</p>}

      <h2 className="text-base font-semibold text-navy-900">Second-hand books</h2>
      <p>
        Marketplace purchases are final once the book is handed over unless it materially differs from the moderated description. Because
        condition is inspected in person, buyers should check the book at handover; report a serious mismatch from the listing page or order
        page.
      </p>

      <h2 className="text-base font-semibold text-navy-900">How refunds are returned</h2>
      <p>
        Refunds for online payments are returned to the original payment method through the configured gateway. Cash payments are refunded in
        person at the store. In both cases the refund appears on your order only after the store records it — a request or approval is not the
        same as a completed refund.
      </p>

      <h2 className="text-base font-semibold text-navy-900">Damaged or wrong items</h2>
      <p>
        Contact the store with your order number and photographs as soon as you notice a problem. Where the store is at fault, it arranges
        replacement or refund according to the policy above and applicable law.
      </p>
    </>
  )
}
