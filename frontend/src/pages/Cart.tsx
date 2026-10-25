import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { cartPayload, useCart } from '../lib/cart'
import { useToast } from '../lib/toast'
import { rupees } from '../lib/format'
import type { Quote } from '../lib/types'
import { ProductArt } from '../components/ProductArt'
import { EmptyState, Loading } from '../components/ui'
import { IconArrow, IconTrash, IconTruck } from '../components/Icons'

export default function Cart() {
  const cart = useCart()
  const navigate = useNavigate()
  const toast = useToast()
  const [coupon, setCoupon] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null)
  const [discount, setDiscount] = useState(0)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // The server is the only place cart totals are calculated.
  const signature = cart.items.map((item) => `${item.product_id}:${item.quantity}`).join('|')
  useEffect(() => {
    if (cart.items.length === 0) {
      setQuote(null)
      setQuoteLoading(false)
      return
    }
    let cancelled = false
    setQuoteLoading(true)
    api
      .post<Quote>('/cart/quote', cartPayload(cart.items))
      .then((data) => {
        if (cancelled) return
        setQuote(data)
        setQuoteError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setQuote(null)
        setQuoteError(error instanceof ApiError ? error.message : 'Could not price this cart')
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, reloadKey])

  // Recalculate the coupon discount whenever the subtotal changes.
  useEffect(() => {
    if (!appliedCoupon || !quote) return
    api
      .post<{ discount_paise: number }>('/coupons/validate', {
        code: appliedCoupon,
        subtotal_paise: quote.subtotal_paise,
      })
      .then((data) => setDiscount(data.discount_paise))
      .catch(() => {
        setAppliedCoupon(null)
        setDiscount(0)
        setCouponError('Coupon no longer applies to this cart')
      })
  }, [appliedCoupon, quote])

  const applyCoupon = async (event: React.FormEvent) => {
    event.preventDefault()
    setCouponError(null)
    if (!quote) return
    try {
      const data = await api.post<{ discount_paise: number; code: string }>('/coupons/validate', {
        code: coupon,
        subtotal_paise: quote.subtotal_paise,
      })
      setAppliedCoupon(data.code)
      setDiscount(data.discount_paise)
      setCoupon(data.code)
      toast.push(`Coupon ${data.code} applied`, 'success')
    } catch (error) {
      setCouponError(error instanceof ApiError ? error.message : 'Coupon could not be applied')
    }
  }

  if (cart.items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        action={
          <Link to="/shop" className="btn btn-primary">
            Browse the shop
          </Link>
        }
      >
        Add textbooks, notebooks or supplies and they will wait here for you.
      </EmptyState>
    )
  }

  const shipping = quote ? quote.shipping_paise : 0
  const total = quote ? Math.max(quote.subtotal_paise - discount + shipping, 0) : 0
  const threshold = quote?.free_shipping_threshold_paise ?? 49900
  const away = Math.max(threshold - (quote?.subtotal_paise ?? 0), 0)

  const proceed = () => {
    setChecking(true)
    if (appliedCoupon) sessionStorage.setItem('asm.coupon', appliedCoupon)
    else sessionStorage.removeItem('asm.coupon')
    navigate('/checkout')
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Your cart</h1>
          <p>
            {cart.count} item{cart.count === 1 ? '' : 's'} · prices include GST
          </p>
        </div>
        <Link to="/shop" className="btn btn-ghost btn-sm">
          Keep shopping
        </Link>
      </div>

      <div className="cart-layout">
        <div className="card">
          <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {cart.items.map((item) => (
              <div className="cart-line" key={item.product_id}>
                <Link to={`/product/${item.slug}`} className="cart-thumb">
                  <ProductArt
                    sku={item.product_id.slice(0, 8)}
                    categorySlug={item.category_slug}
                    imageUrl={item.image_url}
                    alt={item.name}
                  />
                </Link>
                <div>
                  <h4>
                    <Link to={`/product/${item.slug}`}>{item.name}</Link>
                  </h4>
                  <p className="small muted" style={{ marginBottom: 8 }}>
                    {rupees(item.price_paise)} · {item.unit}
                    {item.stock <= 5 ? ` · only ${item.stock} left` : ''}
                  </p>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="qty">
                      <button
                        type="button"
                        onClick={() => cart.setQuantity(item.product_id, item.quantity - 1)}
                        aria-label={`Reduce quantity of ${item.name}`}
                      >
                        −
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => cart.setQuantity(item.product_id, item.quantity + 1)}
                        disabled={item.quantity >= Math.min(item.stock, 10)}
                        aria-label={`Increase quantity of ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn-link small"
                      onClick={() => cart.remove(item.product_id)}
                    >
                      <IconTrash size={14} /> Remove
                    </button>
                  </div>
                </div>
                <div className="line-total" style={{ textAlign: 'right' }}>
                  <strong>{rupees(item.price_paise * item.quantity)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="card sticky-summary">
          <div className="card-head">
            <h3>Order summary</h3>
          </div>
          <div className="card-body">
            {quoteLoading && !quote ? (
              <Loading label="Repricing cart" />
            ) : quote ? (
              <>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <span>{rupees(quote.subtotal_paise)}</span>
                </div>
                {discount > 0 ? (
                  <div className="summary-row discount">
                    <span>Coupon {appliedCoupon}</span>
                    <span>−{rupees(discount)}</span>
                  </div>
                ) : null}
                <div className="summary-row">
                  <span>Delivery</span>
                  <span>{shipping === 0 ? 'Free' : rupees(shipping)}</span>
                </div>
                <div className="summary-row total">
                  <span>Total</span>
                  <span>{rupees(total)}</span>
                </div>

                {away > 0 ? (
                  <p className="small muted" style={{ marginTop: 10 }}>
                    <IconTruck size={14} /> Add {rupees(away)} more for free delivery.
                  </p>
                ) : (
                  <p className="small" style={{ marginTop: 10, color: 'var(--sage)' }}>
                    <IconTruck size={14} /> Free delivery unlocked.
                  </p>
                )}

                <form onSubmit={applyCoupon} style={{ marginTop: 16 }}>
                  <label className="label" htmlFor="coupon">
                    Coupon code
                  </label>
                  <div className="row" style={{ gap: 8, marginTop: 6 }}>
                    <input
                      id="coupon"
                      className="input"
                      placeholder="ASM10"
                      value={coupon}
                      onChange={(event) => {
                        setCoupon(event.target.value.toUpperCase())
                        setCouponError(null)
                      }}
                    />
                    <button type="submit" className="btn btn-soft btn-sm">
                      Apply
                    </button>
                  </div>
                  {couponError ? <span className="error-text">{couponError}</span> : null}
                  {discount > 0 ? (
                    <span className="hint">Applied: {rupees(discount)} off. Try ASM10 or SHIMLA50.</span>
                  ) : null}
                </form>

                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  style={{ marginTop: 18 }}
                  onClick={proceed}
                  disabled={checking || cart.items.length === 0}
                >
                  Continue to checkout <IconArrow size={16} />
                </button>
                <p className="tiny muted center" style={{ marginTop: 10 }}>
                  Delivery charges and totals are calculated on our server.
                </p>
              </>
            ) : (
              <p className="error-text">
                {quoteError ?? 'Could not price this cart'}
                <button type="button" className="btn-link small" onClick={() => setReloadKey((key) => key + 1)}>
                  {' '}
                  Try again
                </button>
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
