import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../lib/useApi'
import { useCart } from '../lib/cart'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import { discountPercent, rupees } from '../lib/format'
import type { Product } from '../lib/types'
import { ProductArt } from '../components/ProductArt'
import { ProductGrid } from '../components/ProductCard'
import { Badge, EmptyState, Loading } from '../components/ui'
import { IconBox, IconClock, IconShield, IconTruck } from '../components/Icons'

interface DetailResponse {
  product: Product
  related: Product[]
}

export default function ProductDetail() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const cart = useCart()
  const toast = useToast()
  const { config } = useAuth()
  const { data, loading, error } = useApi<DetailResponse>(`/products/${slug}`)
  const [quantity, setQuantity] = useState(1)

  useEffect(() => setQuantity(1), [slug])

  if (loading) return <Loading label="Fetching product" />
  if (error || !data) return <EmptyState title="Product not found">{error ?? 'This item is no longer listed.'}</EmptyState>

  const product = data.product
  const off = discountPercent(product.price_paise, product.mrp_paise)
  const maxQty = Math.min(product.stock, config?.store.max_quantity_per_line ?? 10)
  const soldOut = product.stock === 0

  const add = (goToCart = false) => {
    const result = cart.add(product, quantity)
    toast.push(result.message, result.ok ? 'success' : 'error')
    if (result.ok && goToCart) navigate('/cart')
  }

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <Link to="/shop">Shop</Link>
        {product.category ? (
          <>
            <span>/</span>
            <Link to={`/shop?category=${product.category.slug}`}>{product.category.name}</Link>
          </>
        ) : null}
        <span>/</span>
        <span>{product.name}</span>
      </div>

      <div className="detail-grid">
        <div>
          <div className="detail-art">
            <ProductArt
              sku={product.sku}
              categorySlug={product.category?.slug}
              imageUrl={product.image_url}
              alt={product.name}
            />
          </div>
          <div className="trust-row">
            <div>
              <IconTruck size={16} /> Same-day dispatch in Shimla
            </div>
            <div>
              <IconShield size={16} /> Verified store stock
            </div>
            <div>
              <IconBox size={16} /> 7-day exchange
            </div>
          </div>
        </div>

        <div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            {product.category ? <Badge tone="muted">{product.category.name}</Badge> : null}
            {product.condition !== 'new' ? <Badge tone="info">{product.condition}</Badge> : null}
            {product.is_featured ? <Badge tone="warn">Featured</Badge> : null}
            {off ? <Badge tone="accent">{off}% off</Badge> : null}
          </div>
          <h1 className="detail-title">{product.name}</h1>
          {product.brand ? <p className="muted small">{product.brand}{product.author ? ` · ${product.author}` : ''}</p> : null}

          <div className="detail-price">
            <span className="price">{rupees(product.price_paise)}</span>
            {product.mrp_paise && product.mrp_paise > product.price_paise ? (
              <>
                <span className="mrp">{rupees(product.mrp_paise)}</span>
                <span className="save">You save {rupees(product.mrp_paise - product.price_paise)}</span>
              </>
            ) : null}
          </div>
          <p className="small muted">
            {soldOut ? (
              <span className="stock-out">Out of stock — ask the counter to reorder</span>
            ) : product.stock <= 5 ? (
              <span className="stock-low">Hurry, only {product.stock} left in the shop</span>
            ) : (
              <span>In stock · sold as {product.unit}</span>
            )}
            {' · '}SKU {product.sku}
          </p>

          <p style={{ marginTop: 18 }}>{product.description}</p>

          <div className="buy-box">
            <div className="qty" aria-label="Quantity">
              <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={quantity <= 1} aria-label="Decrease quantity">
                −
              </button>
              <span aria-live="polite">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((value) => Math.min(maxQty, value + 1))}
                disabled={quantity >= maxQty}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => add(false)} disabled={soldOut}>
              Add {quantity} to cart
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => add(true)} disabled={soldOut}>
              Buy now
            </button>
          </div>
          <p className="small muted">
            Free delivery above {rupees(config?.store.free_shipping_threshold_paise ?? 49900)} in Shimla ·
            Cash on delivery and store pickup available.
          </p>

          <div className="spec-list">
            {product.isbn ? (
              <div>
                <span>ISBN</span>
                <strong>{product.isbn}</strong>
              </div>
            ) : null}
            {product.author ? (
              <div>
                <span>Author</span>
                <strong>{product.author}</strong>
              </div>
            ) : null}
            {product.board ? (
              <div>
                <span>Board</span>
                <strong>{product.board}</strong>
              </div>
            ) : null}
            {product.class_level ? (
              <div>
                <span>Class</span>
                <strong>{product.class_level}</strong>
              </div>
            ) : null}
            <div>
              <span>Sold as</span>
              <strong>{product.unit}</strong>
            </div>
            <div>
              <span>Availability</span>
              <strong>{soldOut ? 'Out of stock' : `${product.stock} in stock`}</strong>
            </div>
          </div>

          <div className="notice notice-info row" style={{ gap: 10 }}>
            <IconClock size={18} />
            <span>
              Order before 4 pm for same-day dispatch. Collect free from the counter at Lower Bazaar any
              time the shop is open.
            </span>
          </div>
        </div>
      </div>

      {data.related.length > 0 ? (
        <section className="section" style={{ marginTop: 46 }}>
          <div className="section-head">
            <div>
              <div className="kicker">On the same shelf</div>
              <h2>You may also need</h2>
            </div>
          </div>
          <ProductGrid products={data.related} />
        </section>
      ) : null}
    </>
  )
}
