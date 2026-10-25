import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import ProductCard, { ProductImage } from '../components/ProductCard'
import { AvailabilityBadge, Breadcrumbs, EmptyState, ErrorState, Price, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import { money } from '../format'
import type { ProductDetail as ProductDetailType } from '../types'

export default function ProductDetail() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { user, settings, refresh, toast } = useStore()
  const [product, setProduct] = useState<ProductDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [adding, setAdding] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setNotFound(false)
    api<ProductDetailType>(`/api/products/${encodeURIComponent(slug || '')}`)
      .then((data) => {
        setProduct(data)
        setActiveImage(0)
        setQuantity(1)
      })
      .catch((err) => {
        if (err.status === 404 || err.status === 410) setNotFound(true)
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [slug])

  const addToCart = async () => {
    if (!product) return
    setAdding(true)
    try {
      const cart = await api<{ item_count: number }>('/api/cart/items', {
        method: 'POST',
        body: { product_id: product.id, quantity },
      })
      await refresh()
      toast(`${quantity} × ${product.title} added to cart.`)
      if (cart.item_count) navigate('/cart')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  const addToWishlist = async () => {
    if (!product) return
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/product/${product.slug}`)}`)
      return
    }
    try {
      await api(`/api/wishlist/${product.id}`, { method: 'POST' })
      await refresh()
      toast('Saved to your wishlist.')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const maxQty = Math.min(20, product?.availability.stock || 0)

  return (
    <div className="shell py-6">
      {loading && <Spinner label="Loading product" />}
      {error && <ErrorState message={error} onRetry={() => navigate(0)} />}
      {notFound && (
        <EmptyState
          title="This product is not available"
          message="It may have been removed from sale or archived by the store. Browse the catalogue for similar titles."
          action={<Link to="/products" className="btn-primary">Browse products</Link>}
          icon="📕"
        />
      )}

      {product && !loading && (
        <>
          <Seo
            title={product.title}
            description={(product.description || `${product.title} available at Ankit Stationery Mart, Jalandhar Cantt.`).slice(0, 300)}
            canonicalPath={`/product/${product.slug}`}
            image={product.images[0]?.url}
            structuredData={{
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: product.title,
              image: product.images.map((image) => image.url),
              description: product.description || undefined,
              sku: product.sku || undefined,
              isbn: product.isbn || undefined,
              brand: product.publisher ? { '@type': 'Brand', name: product.publisher } : undefined,
              offers: product.availability.can_buy
                ? {
                    '@type': 'Offer',
                    priceCurrency: 'INR',
                    price: (product.price_paise / 100).toFixed(2),
                    availability: 'https://schema.org/InStock',
                    itemCondition:
                      product.condition === 'new'
                        ? 'https://schema.org/NewCondition'
                        : 'https://schema.org/UsedCondition',
                  }
                : {
                    '@type': 'Offer',
                    priceCurrency: 'INR',
                    price: (product.price_paise / 100).toFixed(2),
                    availability: 'https://schema.org/OutOfStock',
                  },
            }}
          />
          <Breadcrumbs
            items={[
              { label: 'Home', to: '/' },
              { label: 'Products', to: '/products' },
              ...(product.category ? [{ label: product.category.name, to: `/products?category=${product.category.slug}` }] : []),
              { label: product.title },
            ]}
          />

          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <div className="card overflow-hidden">
                <ProductImage
                  src={product.images[activeImage]?.url || product.image_url}
                  alt={product.images[activeImage]?.alt_text || product.image_alt}
                  className="aspect-square w-full"
                />
              </div>
              {product.images.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {product.images.map((image, index) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setActiveImage(index)}
                      className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                        index === activeImage ? 'border-navy-700' : 'border-transparent'
                      }`}
                      aria-label={`View image ${index + 1}`}
                      aria-pressed={index === activeImage}
                    >
                      <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                {product.product_type === 'used' ? (
                  <span className="badge-used">Pre-owned · {product.condition_label}</span>
                ) : (
                  <span className="badge-new">New</span>
                )}
                <AvailabilityBadge availability={product.availability} />
                {product.category && (
                  <Link to={`/products?category=${product.category.slug}`} className="badge-muted hover:bg-slate-200">
                    {product.category.name}
                  </Link>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold text-navy-900 sm:text-3xl">{product.title}</h1>
              <p className="mt-2 text-sm text-slate-600">
                {[product.author, product.publisher, product.edition].filter(Boolean).join(' · ') || 'Product details below'}
              </p>

              <div className="mt-4">
                <Price paise={product.price_paise} compareAt={product.compare_at_price_paise} size="lg" />
                {product.discount_percent ? (
                  <p className="mt-1 text-xs font-medium text-emerald-700">Save {product.discount_percent}% versus the listed original price.</p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">Inclusive of applicable taxes as configured at checkout.</p>
              </div>

              <div className="mt-5 space-y-3 border-t border-slate-200 pt-5">
                {product.availability.can_buy ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor="qty" className="label">Quantity</label>
                      <select
                        id="qty"
                        className="input w-24"
                        value={quantity}
                        onChange={(event) => setQuantity(Number(event.target.value))}
                      >
                        {Array.from({ length: Math.max(1, maxQty) }).map((_, index) => (
                          <option key={index} value={index + 1}>{index + 1}</option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className="btn-accent flex-1" onClick={addToCart} disabled={adding}>
                      {adding ? 'Adding…' : 'Add to cart'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={addToWishlist}>
                      ♡ Wishlist
                    </button>
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-medium text-navy-900">{product.availability.label}</p>
                    <p className="mt-1">
                      {product.availability.state === 'enquiry_only'
                        ? 'This title is enquiry-only. Contact the store to check whether a copy can be arranged.'
                        : 'This item cannot be ordered while it is unavailable. Contact the store for the next availability.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link to="/contact" className="btn-secondary btn-sm">Contact the store</Link>
                      <button type="button" className="btn-ghost btn-sm" onClick={addToWishlist}>♡ Save for later</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 p-4 text-sm">
                <h2 className="text-sm font-semibold text-navy-900">Delivery &amp; pickup</h2>
                <ul className="mt-2 space-y-1 text-slate-600">
                  <li>
                    {product.delivery.pickup_enabled
                      ? `Store pickup available${product.delivery.pickup_instructions ? `: ${product.delivery.pickup_instructions}` : '.'}`
                      : 'Store pickup is not currently offered.'}
                  </li>
                  <li>
                    {product.delivery.delivery_enabled
                      ? `Home delivery within configured PIN codes. Fee ${money(product.delivery.delivery_fee_paise)}${
                          product.delivery.free_above_paise
                            ? `, free above ${money(product.delivery.free_above_paise)}`
                            : ''
                        }.`
                      : 'Home delivery is not configured for this store.'}
                  </li>
                </ul>
                <Link to="/shipping-policy" className="mt-2 inline-block text-xs font-semibold text-navy-700 hover:underline">
                  Delivery policy →
                </Link>
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 p-4 text-sm">
                <h2 className="text-sm font-semibold text-navy-900">Returns &amp; cancellation</h2>
                <p className="mt-1 text-slate-600">
                  {product.policies.returns_note ||
                    'The store has not published a returns policy on this website. Contact the store before ordering if you need one.'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Self-service cancellation:{' '}
                  {product.policies.cancellation_window_hours
                    ? `within ${product.policies.cancellation_window_hours} hours of ordering`
                    : 'not offered online — contact the store'}.
                </p>
                <Link to="/returns-refunds" className="mt-2 inline-block text-xs font-semibold text-navy-700 hover:underline">
                  Returns &amp; refunds policy →
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[2fr,1fr]">
            <div>
              <h2 className="text-lg font-semibold text-navy-900">About this item</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {product.description || 'No description has been added for this product yet.'}
              </p>

              {product.related.length > 0 && (
                <section className="mt-10">
                  <h2 className="text-lg font-semibold text-navy-900">Related items</h2>
                  <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {product.related.slice(0, 3).map((related) => (
                      <ProductCard key={related.id} product={related} />
                    ))}
                  </div>
                </section>
              )}
            </div>
            <aside className="card h-fit p-4">
              <h2 className="text-sm font-semibold text-navy-900">Product details</h2>
              <dl className="mt-2 divide-y divide-slate-100 text-sm">
                {[
                  ['Condition', product.condition_label],
                  ['SKU', product.sku],
                  ['ISBN', product.isbn],
                  ['Author', product.author],
                  ['Publisher', product.publisher],
                  ['Board', product.board],
                  ['Class', product.class_level],
                  ['Subject', product.subject],
                  ['Book type', product.book_type],
                  ['Edition', product.edition],
                  ['Language', product.language],
                  ['Publication year', product.publication_year],
                  ['Academic year', product.academic_year],
                ]
                  .filter(([, value]) => value !== null && value !== undefined && value !== '')
                  .map(([label, value]) => (
                    <div key={String(label)} className="flex justify-between gap-3 py-2">
                      <dt className="text-slate-500">{label}</dt>
                      <dd className="text-right font-medium text-slate-800">{String(value)}</dd>
                    </div>
                  ))}
              </dl>
              <p className="mt-4 text-xs text-slate-500">
                Need help with this item?{' '}
                <Link to="/contact" className="link">Contact the store</Link>
                {settings?.store_phone ? ` or call ${settings.store_phone}` : ''}.
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
