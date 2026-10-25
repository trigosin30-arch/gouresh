import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import { ProductImage } from '../components/ProductCard'
import { Breadcrumbs, EmptyState, ErrorState, SectionHeader, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { money } from '../format'
import type { Cart as CartType } from '../types'

export default function Cart() {
  const navigate = useNavigate()
  const { user, refresh, toast, confirm } = useStore()
  const [cart, setCart] = useState<CartType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [coupon, setCoupon] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (code?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<CartType>(`/api/cart${code ? `?coupon=${encodeURIComponent(code)}` : ''}`)
      setCart(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateQuantity = async (productId: string, quantity: number) => {
    setBusyId(productId)
    try {
      const data = await api<CartType>('/api/cart/items', { method: 'POST', body: { product_id: productId, quantity } })
      setCart(data)
      await refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
      await load(coupon)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (productId: string, title: string) => {
    const ok = await confirm({ title: 'Remove item?', message: `Remove “${title}” from your cart?`, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    setBusyId(productId)
    try {
      const data = await api<CartType>(`/api/cart/items/${productId}`, { method: 'DELETE' })
      setCart(data)
      await refresh()
      toast('Item removed.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const clear = async () => {
    const ok = await confirm({ title: 'Empty cart?', message: 'This removes every item from your cart.', confirmLabel: 'Empty cart', danger: true })
    if (!ok) return
    try {
      const data = await api<CartType>('/api/cart', { method: 'DELETE' })
      setCart(data)
      await refresh()
      setCoupon('')
      toast('Cart emptied.')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const applyCoupon = async (event: React.FormEvent) => {
    event.preventDefault()
    await load(coupon.trim().toUpperCase())
    const fresh = await api<CartType>(`/api/cart?coupon=${encodeURIComponent(coupon.trim())}`)
    if (fresh.coupon?.error) toast(fresh.coupon.error, 'error')
    else if (fresh.coupon) toast(`Coupon ${fresh.coupon.code} applied.`)
  }

  const checkout = () => {
    navigate(`/checkout${coupon ? `?coupon=${encodeURIComponent(coupon)}` : ''}`)
  }

  return (
    <>
      <Seo title="Your cart" noindex canonicalPath="/cart" />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Cart' }]} />
        <SectionHeader
          title="Shopping cart"
          subtitle={cart ? `${cart.item_count} item${cart.item_count === 1 ? '' : 's'} · stock and prices are verified on the server` : 'Loading your cart…'}
        />

        {loading && <Spinner label="Loading cart" />}
        {error && <ErrorState message={error} onRetry={() => void load()} />}

        {!loading && !error && cart && cart.items.length === 0 && (
          <EmptyState
            title="Your cart is empty"
            message="Browse stationery, textbooks or the second-hand marketplace to get started."
            action={<Link to="/products" className="btn-primary">Start shopping</Link>}
            icon="🛒"
          />
        )}

        {!loading && !error && cart && cart.items.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[1.6fr,1fr]">
            <div className="space-y-4">
              {cart.has_issue && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
                  Some items changed availability. Update your cart to continue — checkout is disabled until it is resolved.
                </div>
              )}
              <div className="card divide-y divide-slate-100">
                {cart.items.map((item) => (
                  <div key={item.id} className="flex gap-4 p-4">
                    <Link to={item.slug ? `/product/${item.slug}` : '/products'} className="shrink-0">
                      <ProductImage src={item.image_url} alt={item.title} className="h-24 w-20 rounded" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link to={item.slug ? `/product/${item.slug}` : '/products'} className="line-clamp-2 text-sm font-medium text-navy-900 hover:underline">
                        {item.title}
                      </Link>
                      <p className="text-xs text-slate-500">{item.condition === 'new' ? 'New' : `Pre-owned · ${item.condition}`}</p>
                      {item.issue && <p className="text-xs font-medium text-red-700">{item.issue}</p>}
                      <p className="text-xs text-slate-500">Available: {item.available_stock}</p>
                      <div className="mt-auto flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          Qty
                          <select
                            className="input w-20 py-1.5 text-xs"
                            value={item.quantity}
                            disabled={busyId === item.product_id}
                            onChange={(event) => void updateQuantity(item.product_id, Number(event.target.value))}
                            aria-label={`Quantity for ${item.title}`}
                          >
                            {Array.from({ length: Math.max(1, Math.min(20, item.available_stock)) }).map((_, index) => (
                              <option key={index} value={index + 1}>{index + 1}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="text-xs font-medium text-red-700 hover:underline"
                          onClick={() => void remove(item.product_id, item.title)}
                          disabled={busyId === item.product_id}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-navy-900">{money(item.line_total_paise || item.unit_price_paise * item.quantity)}</p>
                      <p className="text-xs text-slate-500">{money(item.unit_price_paise)} each</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" className="btn-ghost btn-sm" onClick={() => void clear()}>
                  Empty cart
                </button>
                <Link to="/products" className="text-sm font-semibold text-navy-700 hover:underline">
                  Continue shopping →
                </Link>
              </div>
            </div>

            <aside className="card h-fit p-5">
              <h2 className="text-base font-semibold text-navy-900">Order summary</h2>
              <form onSubmit={applyCoupon} className="mt-3 flex gap-2">
                <label className="sr-only" htmlFor="coupon">Coupon code</label>
                <input
                  id="coupon"
                  className="input"
                  placeholder="Coupon code"
                  value={coupon}
                  onChange={(event) => setCoupon(event.target.value.toUpperCase())}
                />
                <button type="submit" className="btn-secondary btn-sm shrink-0">Apply</button>
              </form>
              {cart.coupon && (
                <p className={`mt-2 text-xs ${cart.coupon.error ? 'text-red-700' : 'text-emerald-700'}`}>
                  {cart.coupon.error ? cart.coupon.error : `Coupon ${cart.coupon.code} applied — you save ${money(cart.coupon.discount_paise)}.`}
                </p>
              )}
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-600">Subtotal</dt>
                  <dd className="font-medium">{money(cart.subtotal_paise)}</dd>
                </div>
                {cart.discount_paise > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <dt>Discount</dt>
                    <dd>− {money(cart.discount_paise)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-slate-600">Delivery</dt>
                  <dd className="font-medium">{cart.delivery_fee_paise ? money(cart.delivery_fee_paise) : 'Calculated at checkout'}</dd>
                </div>
                {cart.tax_paise > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Tax</dt>
                    <dd className="font-medium">{money(cart.tax_paise)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-bold text-navy-900">{money(cart.total_paise)}</dd>
                </div>
              </dl>
              {cart.below_minimum && (
                <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Minimum order value is {money(cart.min_order_paise)}. Add {money(cart.min_order_paise - cart.subtotal_paise)} more to check out.
                </p>
              )}
              <button
                type="button"
                className="btn-accent mt-4 w-full"
                disabled={!cart.can_checkout}
                onClick={checkout}
                title={!cart.can_checkout ? 'Resolve unavailable items to continue' : undefined}
              >
                Proceed to checkout
              </button>
              {!user && (
                <p className="mt-2 text-xs text-slate-500">
                  Checking out as a guest is fine, but <Link to="/login" className="link">signing in</Link> keeps your order history and wishlist in one place.
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                {cart.pickup_enabled && 'Store pickup available. '}
                {cart.delivery_enabled ? 'Home delivery available for serviceable PIN codes.' : 'Home delivery is not configured for this store.'}
              </p>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}
