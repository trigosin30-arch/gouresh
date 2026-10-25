import { Link } from 'react-router-dom'
import type { Product } from '../types'
import { rupees } from '../format'
import { AvailabilityBadge } from './ui'

export function ProductImage({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 ${className}`} aria-label={alt}>
        <span aria-hidden="true" className="text-2xl">
          🛍️
        </span>
      </div>
    )
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={`bg-slate-100 object-cover ${className}`} />
}

export default function ProductCard({ product }: { product: Product }) {
  return (
    <article className="card group flex h-full flex-col overflow-hidden transition hover:shadow-lg">
      <Link to={`/product/${product.slug}`} className="block" aria-label={product.title}>
        <ProductImage src={product.image_url} alt={product.image_alt} className="aspect-[4/5] w-full transition group-hover:opacity-95" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {product.product_type === 'used' ? (
            <span className="badge-used">{product.condition_label}</span>
          ) : (
            <span className="badge-new">New</span>
          )}
          {product.discount_percent ? <span className="badge bg-accent-100 text-accent-800">{product.discount_percent}% off</span> : null}
        </div>
        <Link to={`/product/${product.slug}`} className="line-clamp-2 text-sm font-medium text-navy-900 hover:underline">
          {product.title}
        </Link>
        {(product.author || product.publisher) && (
          <p className="line-clamp-1 text-xs text-slate-500">{[product.author, product.publisher].filter(Boolean).join(' · ')}</p>
        )}
        <div className="mt-auto">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-base font-semibold text-navy-900">{rupees(product.price_paise)}</span>
            {product.compare_at_price_paise && (
              <span className="text-xs text-slate-400 line-through">{rupees(product.compare_at_price_paise)}</span>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <AvailabilityBadge availability={product.availability} />
            <Link
              to={`/product/${product.slug}`}
              className="text-xs font-semibold text-navy-700 hover:underline"
              aria-label={`View ${product.title}`}
            >
              View →
            </Link>
          </div>
        </div>
      </div>
    </article>
  )
}
