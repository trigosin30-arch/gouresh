import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { cartPayload, useCart } from '../lib/cart'
import { useToast } from '../lib/toast'
import { openRazorpayCheckout } from '../lib/razorpay'
import { rupees } from '../lib/format'
import type { Address, AddressDraft, Order, PaymentSession, Quote } from '../lib/types'
import { MockPaymentModal } from '../components/PaymentModal'
import { Field } from '../components/ui'
import { IconArrow, IconCheck, IconPin, IconStore, IconTruck } from '../components/Icons'

const EMPTY_FORM: AddressDraft = {
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

type Method = 'razorpay' | 'cod' | 'pickup'

export default function Checkout() {
  const { profile, loading: authLoading, config } = useAuth()
  const cart = useCart()
  const navigate = useNavigate()
  const toast = useToast()

  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [useNew, setUseNew] = useState(false)
  const [form, setForm] = useState<AddressDraft>(EMPTY_FORM)
  const [saveAddress, setSaveAddress] = useState(true)
  const [method, setMethod] = useState<Method>('razorpay')
  const [notes, setNotes] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [discount, setDiscount] = useState(0)
  const [coupon] = useState<string | null>(() => sessionStorage.getItem('asm.coupon'))
  const [error, setError] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null)
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [showMock, setShowMock] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!profile) navigate('/login?next=/checkout', { replace: true })
  }, [authLoading, profile, navigate])

  useEffect(() => {
    if (cart.items.length === 0) return
    api
      .post<Quote>('/cart/quote', cartPayload(cart.items))
      .then((data) => setQuote(data))
      .catch(() => setQuote(null))
  }, [cart.items])

  useEffect(() => {
    if (!profile) return
    api
      .get<{ addresses: Address[] }>('/me')
      .then((data) => {
        setAddresses(data.addresses)
        const preferred = data.addresses.find((address) => address.is_default) ?? data.addresses[0]
        if (preferred) setSelectedId(preferred.id)
        else setUseNew(true)
        setForm((current) => ({
          ...current,
          contact_name: current.contact_name || profile.full_name,
          phone: current.phone || profile.phone || '',
        }))
      })
      .catch(() => setUseNew(true))
  }, [profile])

  useEffect(() => {
    if (!coupon || !quote) return
    api
      .post<{ discount_paise: number }>('/coupons/validate', {
        code: coupon,
        subtotal_paise: quote.subtotal_paise,
      })
      .then((data) => setDiscount(data.discount_paise))
      .catch(() => setDiscount(0))
  }, [coupon, quote])

  if (cart.items.length === 0 && !pendingOrder) {
    return (
      <div className="empty">
        <h3>Nothing to check out</h3>
        <p className="muted small">Your cart is empty — add a few items first.</p>
        <Link to="/shop" className="btn btn-primary">
          Browse the shop
        </Link>
      </div>
    )
  }

  const shipping = quote ? (method === 'pickup' ? 0 : quote.shipping_paise) : 0
  const total = quote ? Math.max(quote.subtotal_paise - discount + shipping, 0) : 0
  const mockMode = config?.payments.mode === 'mock'

  const validateForm = (): string | null => {
    if (method === 'pickup') return null
    if (!useNew && selectedId) return null
    if (!form.contact_name.trim() || form.contact_name.trim().length < 2) return 'Enter the recipient name'
    if (!/^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, '').slice(-10))) return 'Enter a valid 10-digit mobile number'
    if (form.line1.trim().length < 4) return 'Enter the street address'
    if (!form.city.trim() || !form.state.trim()) return 'Enter the city and state'
    if (!/^[1-9]\d{5}$/.test(form.pincode.trim())) return 'Enter a valid 6-digit PIN code'
    return null
  }

  const placeOrder = async () => {
    const problem = validateForm()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setPlacing(true)
    try {
      const response = await api.post<{ order: Order; payment_session?: PaymentSession }>('/orders', {
        items: cartPayload(cart.items),
        payment_method: method,
        address: method === 'pickup' ? null : useNew || !selectedId ? form : null,
        address_id: method !== 'pickup' && !useNew ? selectedId : null,
        save_address: method !== 'pickup' && (useNew || !selectedId) && saveAddress,
        notes: notes.trim() || null,
        coupon_code: coupon ?? undefined,
      })

      if (!response.payment_session) {
        cart.clear()
        sessionStorage.removeItem('asm.coupon')
        toast.push('Order placed', 'success')
        navigate(`/orders/${response.order.order_number}?placed=1`)
        return
      }

      setPendingOrder(response.order)
      setSession(response.payment_session)
      if (response.payment_session.mock) {
        setShowMock(true)
      } else {
        void openRazorpayCheckout(response.payment_session, {
          onSuccess: async (payload) => {
            try {
              const verified = await api.post<{ order: Order }>('/payments/verify', payload)
              cart.clear()
              sessionStorage.removeItem('asm.coupon')
              toast.push('Payment verified', 'success')
              navigate(`/orders/${verified.order.order_number}?paid=1`)
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Payment could not be verified')
            }
          },
          onDismiss: () => {
            setError('Payment window closed. Your order is saved and can be paid from the order page.')
          },
          onFailure: (message) => setError(message),
        })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not place the order')
    } finally {
      setPlacing(false)
    }
  }

  const onVerified = (order: Order) => {
    setShowMock(false)
    cart.clear()
    sessionStorage.removeItem('asm.coupon')
    toast.push('Payment verified — order confirmed', 'success')
    navigate(`/orders/${order.order_number}?paid=1`)
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Checkout</h1>
          <p>Deliver across Shimla, or collect from the counter at Lower Bazaar.</p>
        </div>
        <Link to="/cart" className="btn btn-ghost btn-sm">
          Back to cart
        </Link>
      </div>

      <div className="checkout-steps">
        <span className="active">1 · Delivery</span>
        <span className={method ? 'active' : ''}>2 · Payment</span>
        <span>3 · Confirmation</span>
      </div>

      <div className="cart-layout">
        <div className="stack">
          <section className="card">
            <div className="card-head">
              <h3>
                <IconPin size={16} /> Delivery details
              </h3>
              {addresses.length > 0 ? (
                <button type="button" className="btn-link small" onClick={() => setUseNew((value) => !value)}>
                  {useNew ? 'Use a saved address' : 'Use a new address'}
                </button>
              ) : null}
            </div>
            <div className="card-body">
              {!useNew && addresses.length > 0 ? (
                <div className="stack" style={{ gap: 10 }}>
                  {addresses.map((address) => (
                    <label
                      key={address.id}
                      className={`pay-option ${selectedId === address.id ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="address"
                        checked={selectedId === address.id}
                        onChange={() => setSelectedId(address.id)}
                      />
                      <span>
                        <strong>
                          {address.contact_name} · {address.phone}
                        </strong>
                        <span>
                          {address.line1}
                          {address.line2 ? `, ${address.line2}` : ''}
                          {address.locality ? `, ${address.locality}` : ''}, {address.city}, {address.state}{' '}
                          {address.pincode}
                          {address.is_default ? ' · default' : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="form-grid">
                  <Field label="Full name" htmlFor="contact_name">
                    <input
                      id="contact_name"
                      className="input"
                      value={form.contact_name}
                      onChange={(event) => setForm({ ...form, contact_name: event.target.value })}
                      autoComplete="name"
                    />
                  </Field>
                  <Field label="Mobile number" htmlFor="phone" hint="Used for delivery updates">
                    <input
                      id="phone"
                      className="input"
                      inputMode="tel"
                      value={form.phone}
                      onChange={(event) => setForm({ ...form, phone: event.target.value })}
                      autoComplete="tel"
                    />
                  </Field>
                  <Field label="Address line" htmlFor="line1" className="span-2">
                    <input
                      id="line1"
                      className="input"
                      placeholder="House / flat, street"
                      value={form.line1}
                      onChange={(event) => setForm({ ...form, line1: event.target.value })}
                      autoComplete="address-line1"
                    />
                  </Field>
                  <Field label="Landmark / area" htmlFor="line2">
                    <input
                      id="line2"
                      className="input"
                      value={form.line2 ?? ''}
                      onChange={(event) => setForm({ ...form, line2: event.target.value })}
                      autoComplete="address-line2"
                    />
                  </Field>
                  <Field label="Locality" htmlFor="locality">
                    <input
                      id="locality"
                      className="input"
                      placeholder="Lakkar Bazaar"
                      value={form.locality ?? ''}
                      onChange={(event) => setForm({ ...form, locality: event.target.value })}
                    />
                  </Field>
                  <Field label="City" htmlFor="city">
                    <input
                      id="city"
                      className="input"
                      value={form.city}
                      onChange={(event) => setForm({ ...form, city: event.target.value })}
                      autoComplete="address-level2"
                    />
                  </Field>
                  <Field label="State" htmlFor="state">
                    <input
                      id="state"
                      className="input"
                      value={form.state}
                      onChange={(event) => setForm({ ...form, state: event.target.value })}
                      autoComplete="address-level1"
                    />
                  </Field>
                  <Field label="PIN code" htmlFor="pincode">
                    <input
                      id="pincode"
                      className="input"
                      inputMode="numeric"
                      value={form.pincode}
                      onChange={(event) => setForm({ ...form, pincode: event.target.value })}
                      autoComplete="postal-code"
                    />
                  </Field>
                  <label className="checkbox span-2">
                    <input
                      type="checkbox"
                      checked={saveAddress}
                      onChange={(event) => setSaveAddress(event.target.checked)}
                    />
                    Save this address to my account
                  </label>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Payment method</h3>
              {mockMode ? <span className="mock-tag">Demo mode</span> : null}
            </div>
            <div className="card-body stack" style={{ gap: 10 }}>
              <label className={`pay-option ${method === 'razorpay' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="payment"
                  checked={method === 'razorpay'}
                  onChange={() => setMethod('razorpay')}
                />
                <span>
                  <strong>Pay online · UPI, cards, netbanking</strong>
                  <span>Secured by Razorpay. Payment is verified on our server before dispatch.</span>
                </span>
              </label>
              {config?.store.cod_enabled ? (
                <label className={`pay-option ${method === 'cod' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="payment"
                    checked={method === 'cod'}
                    onChange={() => setMethod('cod')}
                  />
                  <span>
                    <strong>Cash on delivery</strong>
                    <span>Pay the delivery partner when your parcel arrives in Shimla.</span>
                  </span>
                </label>
              ) : null}
              {config?.store.pickup_enabled ? (
                <label className={`pay-option ${method === 'pickup' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="payment"
                    checked={method === 'pickup'}
                    onChange={() => setMethod('pickup')}
                  />
                  <span>
                    <strong>Store pickup · pay at the counter</strong>
                    <span>{config?.store.address}</span>
                  </span>
                </label>
              ) : null}

              <Field label="Order notes (optional)" htmlFor="notes">
                <textarea
                  id="notes"
                  className="textarea"
                  placeholder="School name, class, or instructions for the counter"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
          </section>

          {error ? <div className="notice notice-danger">{error}</div> : null}

          {pendingOrder ? (
            <div className="notice notice-warn">
              <strong>Order {pendingOrder.order_number} saved.</strong> Payment is still pending.{' '}
              <Link to={`/orders/${pendingOrder.order_number}`}>Open the order</Link> to retry or cancel.
              {session ? (
                <button
                  type="button"
                  className="btn-link small"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    session.mock
                      ? setShowMock(true)
                      : void openRazorpayCheckout(session, {
                          onSuccess: async (payload) => {
                            const verified = await api.post<{ order: Order }>('/payments/verify', payload)
                            onVerified(verified.order)
                          },
                          onDismiss: () => undefined,
                          onFailure: (message) => setError(message),
                        })
                  }
                >
                  Retry payment
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="card sticky-summary">
          <div className="card-head">
            <h3>Review</h3>
          </div>
          <div className="card-body">
            <div className="stack" style={{ gap: 6, marginBottom: 14 }}>
              {cart.items.map((item) => (
                <div key={item.product_id} className="row-between small">
                  <span>
                    {item.quantity} × {item.name.length > 34 ? `${item.name.slice(0, 34)}…` : item.name}
                  </span>
                  <span>{rupees(item.price_paise * item.quantity)}</span>
                </div>
              ))}
            </div>

            {quote ? (
              <>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <span>{rupees(quote.subtotal_paise)}</span>
                </div>
                {discount > 0 ? (
                  <div className="summary-row discount">
                    <span>Coupon {coupon}</span>
                    <span>−{rupees(discount)}</span>
                  </div>
                ) : null}
                <div className="summary-row">
                  <span>{method === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                  <span>{shipping === 0 ? 'Free' : rupees(shipping)}</span>
                </div>
                <div className="summary-row total">
                  <span>Payable</span>
                  <span>{rupees(total)}</span>
                </div>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  <IconCheck size={12} /> The server recalculates this amount when the order is placed.
                </p>
              </>
            ) : null}

            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: 16 }}
              onClick={placeOrder}
              disabled={placing}
            >
              {placing
                ? 'Placing order…'
                : method === 'razorpay'
                  ? `Pay ${rupees(total)}`
                  : method === 'cod'
                    ? 'Place COD order'
                    : 'Reserve for pickup'}
              {placing ? null : <IconArrow size={16} />}
            </button>

            <div className="trust-row small" style={{ marginTop: 14 }}>
              <div>
                <IconTruck size={14} /> Dispatch same day
              </div>
              <div>
                <IconStore size={14} /> Free store pickup
              </div>
            </div>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              By placing this order you agree to the store's exchange and return policy.
            </p>
          </div>
        </aside>
      </div>

      {showMock && session ? (
        <MockPaymentModal session={session} onVerified={onVerified} onClose={() => setShowMock(false)} />
      ) : null}
    </>
  )
}
