import { Link } from 'react-router-dom'
import { useCart } from '../lib/cart'
import { useToast } from '../lib/toast'
import { discountPercent, rupees } from '../lib/format'
import type { Product } from '../lib/types'
import { ProductArt } from './ProductArt'
import { Badge } from './ui'

export function ProductCard({ product }: { product: Product }) {
  const cart = useCart()
  const toast = useToast()
  const off = discountPercent(product.price_paise, product.mrp_paise)

  const add = () => {
    const result = cart.add(product, 1)
    toast.push(result.message, result.ok ? 'success' : 'error')
  }

  return (
    <article className="product-card">
      <Link to={`/product/${product.slug}`} className="thumb" aria-label={product.name}>
        <ProductArt
          sku={product.sku}
          categorySlug={product.category?.slug}
          imageUrl={product.image_url}
          alt={product.name}
        />
        {off ? <span className="thumb-badge badge badge-accent">{off}% off</span> : null}
        {product.is_featured ? (
          <span className="thumb-badge-right badge badge-warn">Featured</span>
        ) : null}
      </Link>
      <div className="product-card-body">
        <span className="cat">{product.category?.name ?? product.brand ?? 'Stationery'}</span>
        <h3>
          <Link to={`/product/${product.slug}`}>{product.name}</Link>
        </h3>
        <div className="stock-line">
          {product.stock === 0 ? (
            <span className="stock-out">Out of stock</span>
          ) : product.stock <= 5 ? (
            <span className="stock-low">Only {product.stock} left</span>
          ) : (
            <span>In stock · {product.unit}</span>
          )}
        </div>
        <div className="price-row">
          <span className="price">{rupees(product.price_paise)}</span>
          {product.mrp_paise && product.mrp_paise > product.price_paise ? (
            <span className="mrp">{rupees(product.mrp_paise)}</span>
          ) : null}
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="btn btn-soft"
            onClick={add}
            disabled={product.stock === 0}
            aria-label={`Add ${product.name} to cart`}
          >
            {product.stock === 0 ? 'Unavailable' : 'Add to cart'}
          </button>
        </div>
      </div>
    </article>
  )
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  )
}

export function ConditionBadge({ condition }: { condition: string }) {
  if (condition === 'new') return null
  return <Badge tone="info">{condition}</Badge>
}
