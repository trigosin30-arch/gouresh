import { Link } from 'react-router-dom'
import type { Listing } from '../types'
import { rupees } from '../format'
import { ProductImage } from './ProductCard'

export default function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="card flex h-full flex-col overflow-hidden transition hover:shadow-lg">
      <Link to={`/used-books/${listing.listing_code}`} aria-label={listing.title}>
        <ProductImage src={listing.image_url} alt={listing.image_alt} className="aspect-[4/5] w-full" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="badge-used">Second-hand · {listing.condition_label}</span>
          {listing.status !== 'active' && <span className="badge-muted">{listing.status_label}</span>}
        </div>
        <Link to={`/used-books/${listing.listing_code}`} className="line-clamp-2 text-sm font-medium text-navy-900 hover:underline">
          {listing.title}
        </Link>
        {(listing.board || listing.class_level) && (
          <p className="text-xs text-slate-500">
            {[listing.board, listing.class_level ? `Class ${listing.class_level}` : null, listing.subject]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        <div className="mt-auto space-y-1.5">
          <p className="text-base font-semibold text-navy-900">{rupees(listing.asking_price_paise)}</p>
          <p className="text-xs text-slate-500">Seller: {listing.seller_label}</p>
          <Link to={`/used-books/${listing.listing_code}`} className="btn-secondary btn-sm w-full">
            View copy
          </Link>
        </div>
      </div>
    </article>
  )
}
