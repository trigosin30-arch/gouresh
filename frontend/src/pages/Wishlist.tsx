import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import ProductCard from '../components/ProductCard'
import { EmptyState, ErrorState, SectionHeader, SkeletonGrid } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { Product } from '../types'

export default function Wishlist() {
  const { refresh, toast } = useStore()
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    api<{ items: Product[] }>('/api/wishlist')
      .then((data) => setItems(data.items))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const remove = async (product: Product) => {
    try {
      await api(`/api/wishlist/${product.id}`, { method: 'DELETE' })
      setItems((current) => current.filter((item) => item.id !== product.id))
      await refresh()
      toast('Removed from wishlist.')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <>
      <Seo title="Your wishlist" noindex canonicalPath="/wishlist" />
      <div className="shell py-8">
        <SectionHeader title="Wishlist" subtitle="Saved products, with live availability." />
        {loading && <SkeletonGrid count={4} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && (
          <EmptyState
            title="Your wishlist is empty"
            message="Tap the wishlist button on a product to save it here."
            action={<Link to="/products" className="btn-primary">Browse products</Link>}
            icon="♡"
          />
        )}
        {!loading && !error && items.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((product) => (
                <div key={product.id} className="relative">
                  <ProductCard product={product} />
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-xs font-semibold text-red-700 shadow hover:bg-white"
                    onClick={() => void remove(product)}
                    aria-label={`Remove ${product.title} from wishlist`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-slate-500">
              Saved products do not reserve stock. Availability shown here is checked live each time the page loads.
            </p>
          </>
        )}
      </div>
    </>
  )
}
