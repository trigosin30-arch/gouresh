import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { Breadcrumbs, EmptyState, ErrorState, Field, SectionHeader, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { money } from '../format'
import type { Cart as CartType, Order } from '../types'

type SavedAddress = {
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

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

const PAYMENT_LABELS: Record<string, string> = {
  cod: 'Cash on delivery / pickup',
  online: 'Pay online (secure gateway)',
  invoice: 'Invoice (bulk)',
}

export default function Checkout() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user, settings, refresh, toast } = useStore()
  const [cart, setCart] = useState<CartType | null>(null)
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pincodeMessage, setPincodeMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const coupon = params.get('coupon') || ''

  const [form, setForm] = useState({
    fulfillment_type: 'pickup',
    payment_method: 'cod',
    customer_name: user?.full_name || '',
    customer_phone: user?.phone || '',
    customer_email: user?.email || '',
    note: '',
    save_address: false,
    address_id: '',
    label: 'Home',
    line1: '',
    line2: '',
    locality: '',
    city: 'Jalandhar',
    state: 'Punjab',
    pincode: '',
  })

  const loadCart = useCallback(
    async (fulfillment = form.fulfillment_type) => {
      try {
        const data = await api<CartType>(`/api/cart?fulfillment_type=${fulfillment}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ''}`)
        setCart(data)
        if (data.payment_methods.length && !data.payment_methods.includes(form.payment_method)) {
          setForm((current) => ({ ...current, payment_method: data.payment_methods[0] }))
        }
        if (!data.pickup_enabled && data.delivery_enabled) {
          setForm((current) => ({ ...current, fulfillment_type: 'delivery' }))
        }
        return data
      } catch (err) {
        setError((err as Error).message)
        return null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coupon],
  )

  useEffect(() => {
    setLoading(true)
    Promise.all([loadCart(), user ? api<{ addresses: SavedAddress[] }>('/api/auth/addresses') : Promise.resolve({ addresses: [] })])
      .then(([, addressData]) => {
        setAddresses(addressData.addresses)
        const preferred = addressData.addresses.find((address) => address.is_default) || addressData.addresses[0]
        if (preferred) {
          setForm((current) => ({
            ...current,
            address_id: preferred.id,
            customer_name: current.customer_name || preferred.full_name,
            customer_phone: current.customer_phone || preferred.phone,
            line1: preferred.line1,
            line2: preferred.line2 || '',
            locality: preferred.locality,
            city: preferred.city,
            state: preferred.state,
            pincode: preferred.pincode,
          }))
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    if (!loading) void loadCart(form.fulfillment_type)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.fulfillment_type])

  const checkPincode = async (pin: string) => {
    if (pin.length !== 6) {
      setPincodeMessage(null)
      return
    }
    try {
      const result = await api<{ serviceable: boolean; message: string; fee_paise: number }>(`/api/store/delivery-check?pincode=${pin}`)
      setPincodeMessage({ ok: result.serviceable, text: result.serviceable ? 'Delivery available for this PIN code.' : result.message })
    } catch (err) {
      setPincodeMessage({ ok: false, text: (err as Error).message })
    }
  }

  const selectAddress = (address: SavedAddress) => {
    setForm((current) => ({
      ...current,
      address_id: address.id,
      customer_name: address.full_name,
      customer_phone: address.phone,
      line1: address.line1,
      line2: address.line2 || '',
      locality: address.locality,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
    }))
    void checkPincode(address.pincode)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    if (!cart || cart.items.length === 0) return
    if (form.fulfillment_type === 'delivery' && !form.line1) {
      setFormError('A delivery address is required.')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        fulfillment_type: form.fulfillment_type,
        payment_method: form.payment_method,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        customer_note: form.note || null,
        coupon_code: coupon || null,
        save_address: form.save_address,
      }
      if (form.fulfillment_type === 'delivery') {
        body.address = {
          label: form.label,
          full_name: form.customer_name,
          phone: form.customer_phone,
          line1: form.line1,
          line2: form.line2 || null,
          locality: form.locality,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          is_default: false,
        }
      }
      const result = await api<{ order: Order; requires_payment: boolean }>('/api/checkout', { method: 'POST', body })
      await refresh()

      if (result.requires_payment) {
        await startOnlinePayment(result.order)
        return
      }
      toast(`Order ${result.order.order_number} placed.`)
      navigate('/order-confirmation', {
        state: { order: result.order, contactEmail: form.customer_email },
        replace: true,
      })
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const startOnlinePayment = async (created: Order) => {
    try {
      const gateway = await api<{ gateway_order_id: string; amount_paise: number; key_id: string }>('/api/payments/create-order?order_id=' + created.id, {
        method: 'POST',
      })
      await loadRazorpayScript()
      if (!window.Razorpay) throw new Error('Payment window could not be loaded')
      const rzp = new window.Razorpay({
        key: gateway.key_id,
        amount: gateway.amount_paise,
        currency: 'INR',
        name: settings?.store_name || 'Ankit Stationery Mart',
        description: `Order ${created.order_number}`,
        order_id: gateway.gateway_order_id,
        prefill: { name: form.customer_name, email: form.customer_email, contact: form.customer_phone },
        theme: { color: '#0f2d52' },
        handler: async (response: Record<string, string>) => {
          try {
            await api('/api/payments/confirm', {
              method: 'POST',
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
            })
            toast('Payment confirmed.')
            navigate('/order-confirmation', { state: { order: created }, replace: true })
          } catch (err) {
            toast((err as Error).message, 'error')
            navigate('/order-confirmation', { state: { order: created, paymentPending: true }, replace: true })
          }
        },
        modal: {
          ondismiss: () => {
            toast('Payment was not completed. Your order is held while stock is reserved.', 'info')
            navigate('/order-confirmation', { state: { order: created, paymentPending: true }, replace: true })
          },
        },
      })
      rzp.open()
    } catch (err) {
      toast((err as Error).message, 'error')
      navigate('/order-confirmation', { state: { order: created, paymentPending: true }, replace: true })
    }
  }

  const loadRazorpayScript = () =>
    new Promise<void>((resolve, reject) => {
      if (window.Razorpay) return resolve()
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load the payment gateway'))
      document.body.appendChild(script)
    })

  if (loading) {
    return (
      <div className="shell py-8">
        <Spinner label="Preparing checkout" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="shell py-8">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="shell py-8">
        <EmptyState
          title="Nothing to check out"
          message="Your cart is empty or all items became unavailable."
          action={<Link to="/products" className="btn-primary">Browse products</Link>}
          icon="🧾"
        />
      </div>
    )
  }

  const paymentMethods = cart.payment_methods

  return (
    <>
      <Seo title="Checkout" noindex canonicalPath="/checkout" />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Cart', to: '/cart' }, { label: 'Checkout' }]} />
        <SectionHeader title="Secure checkout" subtitle="Totals are recalculated on the server. Stock is validated again when the order is created." />

        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
          <div className="space-y-4">
            <section className="card p-5">
              <h2 className="text-base font-semibold text-navy-900">1. Contact details</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Full name" required>
                  <input className="input" required value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} autoComplete="name" />
                </Field>
                <Field label="Mobile number" required>
                  <input className="input" required inputMode="tel" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} autoComplete="tel" />
                </Field>
                <Field label="Email" required hint="Used for the order confirmation and tracking link.">
                  <input className="input" type="email" required value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} autoComplete="email" />
                </Field>
                <Field label="Order note (optional)">
                  <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                </Field>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="text-base font-semibold text-navy-900">2. How would you like to receive the order?</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className={`rounded-lg border p-3 text-sm ${form.fulfillment_type === 'pickup' ? 'border-navy-700 bg-navy-50' : 'border-slate-200'} ${cart.pickup_enabled ? '' : 'opacity-50'}`}>
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={form.fulfillment_type === 'pickup'}
                      onChange={() => setForm({ ...form, fulfillment_type: 'pickup' })}
                      disabled={!cart.pickup_enabled}
                    />
                    Store pickup
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {settings?.pickup_instructions || 'Collect from 147 Moolraj Road, Jalandhar Cantt.'}
                  </span>
                </label>
                <label className={`rounded-lg border p-3 text-sm ${form.fulfillment_type === 'delivery' ? 'border-navy-700 bg-navy-50' : 'border-slate-200'} ${cart.delivery_enabled ? '' : 'opacity-50'}`}>
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={form.fulfillment_type === 'delivery'}
                      onChange={() => setForm({ ...form, fulfillment_type: 'delivery' })}
                      disabled={!cart.delivery_enabled}
                    />
                    Home delivery
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {cart.delivery_enabled
                      ? `${money(settings?.delivery_fee_paise || 0)} fee${settings?.free_delivery_threshold_paise ? `, free above ${money(settings.free_delivery_threshold_paise)}` : ''}. Serviceable PIN codes only.`
                      : 'Home delivery is not configured for this store.'}
                  </span>
                </label>
              </div>

              {form.fulfillment_type === 'delivery' && (
                <div className="mt-4 space-y-3">
                  {addresses.length > 0 && (
                    <div>
                      <p className="label">Saved addresses</p>
                      <div className="flex flex-wrap gap-2">
                        {addresses.map((address) => (
                          <button
                            key={address.id}
                            type="button"
                            onClick={() => selectAddress(address)}
                            className={`rounded-lg border px-3 py-2 text-left text-xs ${
                              form.address_id === address.id ? 'border-navy-700 bg-navy-50' : 'border-slate-200'
                            }`}
                          >
                            <span className="block font-semibold">{address.label}</span>
                            <span className="block text-slate-500">
                              {address.line1}, {address.locality} {address.pincode}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Address line 1" required>
                      <input className="input" required value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} autoComplete="address-line1" />
                    </Field>
                    <Field label="Address line 2">
                      <input className="input" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} autoComplete="address-line2" />
                    </Field>
                    <Field label="Locality / area" required>
                      <input className="input" required value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} />
                    </Field>
                    <Field
                      label="PIN code"
                      required
                      error={pincodeMessage && !pincodeMessage.ok ? pincodeMessage.text : null}
                      hint={pincodeMessage?.ok ? pincodeMessage.text : undefined}
                    >
                      <input
                        className="input"
                        required
                        inputMode="numeric"
                        maxLength={6}
                        value={form.pincode}
                        onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '') })}
                        onBlur={(e) => void checkPincode(e.target.value)}
                        autoComplete="postal-code"
                      />
                    </Field>
                    <Field label="City" required>
                      <input className="input" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                    </Field>
                    <Field label="State" required>
                      <input className="input" required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                    </Field>
                  </div>
                  {user && (
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" checked={form.save_address} onChange={(e) => setForm({ ...form, save_address: e.target.checked })} />
                      Save this address to my account
                    </label>
                  )}
                </div>
              )}
            </section>

            <section className="card p-5">
              <h2 className="text-base font-semibold text-navy-900">3. Payment method</h2>
              {paymentMethods.length === 0 ? (
                <div className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                  No payment method is configured for this store yet, so orders cannot be completed online. Please{' '}
                  <Link to="/contact" className="underline">contact the store</Link> to order.
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {paymentMethods.map((method) => (
                    <label key={method} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                      <input
                        type="radio"
                        name="payment_method"
                        checked={form.payment_method === method}
                        onChange={() => setForm({ ...form, payment_method: method })}
                      />
                      <span>
                        <span className="block font-medium text-navy-900">{PAYMENT_LABELS[method] || method}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {method === 'cod'
                            ? 'Pay in cash when you collect the order or when it is delivered.'
                            : 'Payment is verified on the server before the order is marked paid.'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                We never store card details. Online payments are processed by the configured payment gateway.
              </p>
            </section>

            {formError && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                {formError}
              </p>
            )}
          </div>

          <aside className="card h-fit p-5">
            <h2 className="text-base font-semibold text-navy-900">Order summary</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {cart.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-slate-700">{item.title}</span>
                    <span className="text-xs text-slate-500">Qty {item.quantity}</span>
                  </span>
                  <span className="font-medium">{money(item.line_total_paise)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Subtotal</dt>
                <dd>{money(cart.subtotal_paise)}</dd>
              </div>
              {cart.discount_paise > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Discount {cart.coupon?.code ? `(${cart.coupon.code})` : ''}</dt>
                  <dd>− {money(cart.discount_paise)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-600">Delivery</dt>
                <dd>{form.fulfillment_type === 'delivery' ? money(cart.delivery_fee_paise) : 'Pickup — free'}</dd>
              </div>
              {cart.tax_paise > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-600">Tax</dt>
                  <dd>{money(cart.tax_paise)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-navy-900">
                <dt>Total payable</dt>
                <dd>{money(cart.total_paise)}</dd>
              </div>
            </dl>
            <button type="submit" className="btn-accent mt-4 w-full" disabled={submitting || !cart.can_checkout || paymentMethods.length === 0}>
              {submitting ? 'Placing order…' : `Place order · ${money(cart.total_paise)}`}
            </button>
            <p className="mt-2 text-xs text-slate-500">
              By placing the order you accept the store&rsquo;s <Link to="/terms" className="link">terms</Link> and{' '}
              <Link to="/returns-refunds" className="link">returns policy</Link>.
            </p>
          </aside>
        </form>
      </div>
    </>
  )
}
