import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useToast } from '../../lib/toast'
import { rupees } from '../../lib/format'
import type { Category, Product } from '../../lib/types'
import { EmptyState, Loading } from '../../components/ui'
import { IconPlus, IconSearch } from '../../components/Icons'

interface ProductsResponse {
  items: Product[]
  total: number
  page: number
  pages: number
}

export default function AdminProducts() {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const archived = params.get('archived') === 'true'
  const page = Number(params.get('page') ?? 1)
  const { data, loading, error, reload } = useApi<ProductsResponse>(
    `/admin/products?archived=${archived}&page=${page}&page_size=20${
      params.get('q') ? `&q=${encodeURIComponent(params.get('q') as string)}` : ''
    }`,
  )
  const categories = useApi<{ items: Category[] }>('/categories')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({})

  const toggleArchive = async (product: Product) => {
    setBusyId(product.id)
    try {
      await api.post(`/admin/products/${product.id}/${product.is_archived ? 'restore' : 'archive'}`)
      toast.push(product.is_archived ? 'Product restored' : 'Product archived', 'success')
      void reload()
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Action failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const adjustStock = async (product: Product) => {
    const raw = Number(stockDraft[product.id])
    if (!raw) return
    setBusyId(product.id)
    try {
      await api.post(`/admin/products/${product.id}/stock`, { delta: raw, note: 'Adjusted from admin list' })
      setStockDraft((current) => ({ ...current, [product.id]: '' }))
      toast.push('Stock updated', 'success')
      void reload()
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : 'Stock update failed', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    setParams(next, { replace: true })
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>Products</h2>
          <p className="small muted">
            {data ? `${data.total} ${archived ? 'archived' : 'active'} products` : 'Loading catalogue…'}
          </p>
        </div>
        <Link to="/admin/products/new" className="btn btn-primary btn-sm">
          <IconPlus size={15} /> New product
        </Link>
      </div>

      <div className="toolbar">
        <form
          className="search-inline"
          onSubmit={(event) => {
            event.preventDefault()
            update({ q: term.trim() || undefined, page: undefined })
          }}
        >
          <input
            className="input"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search name, SKU or ISBN"
            aria-label="Search products"
          />
          <button type="submit" className="btn btn-soft" aria-label="Search">
            <IconSearch size={16} />
          </button>
        </form>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className={`chip ${!archived ? 'active' : ''}`}
            onClick={() => update({ archived: undefined, page: undefined })}
          >
            Active
          </button>
          <button
            type="button"
            className={`chip ${archived ? 'active' : ''}`}
            onClick={() => update({ archived: 'true', page: undefined })}
          >
            Archived
          </button>
        </div>
      </div>

      {error ? (
        <EmptyState title="Could not load products">{error}</EmptyState>
      ) : loading ? (
        <Loading label="Loading products" />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="No products here">Create your first product to start selling.</EmptyState>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Quick stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/admin/products/${product.id}`}>
                        <strong>{product.name}</strong>
                      </Link>
                      <div className="tiny muted mono">{product.sku}</div>
                    </td>
                    <td className="small">{product.category?.name ?? '—'}</td>
                    <td className="small nowrap">
                      {rupees(product.price_paise)}
                      {product.mrp_paise && product.mrp_paise > product.price_paise ? (
                        <div className="tiny muted">{rupees(product.mrp_paise)} MRP</div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`badge ${product.stock === 0 ? 'badge-bad' : product.stock <= 5 ? 'badge-warn' : 'badge-good'}`}
                      >
                        {product.stock}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <input
                          className="input"
                          style={{ width: 72, padding: '6px 8px', fontSize: '0.82rem' }}
                          placeholder="±qty"
                          inputMode="numeric"
                          value={stockDraft[product.id] ?? ''}
                          onChange={(event) =>
                            setStockDraft((current) => ({ ...current, [product.id]: event.target.value }))
                          }
                          aria-label={`Adjust stock for ${product.name}`}
                        />
                        <button
                          type="button"
                          className="btn btn-soft btn-sm"
                          disabled={busyId === product.id || !stockDraft[product.id]}
                          onClick={() => adjustStock(product)}
                        >
                          Apply
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link to={`/admin/products/${product.id}`} className="btn btn-ghost btn-sm">
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleArchive(product)}
                          disabled={busyId === product.id}
                        >
                          {product.is_archived ? 'Restore' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.pages > 1 ? (
            <div className="card-foot row-between">
              <span className="small muted">
                Page {data.page} of {data.pages}
              </span>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1}
                  onClick={() => update({ page: String(page - 1) })}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= data.pages}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {categories.data ? (
        <p className="tiny muted" style={{ marginTop: 12 }}>
          {categories.data.items.length} categories in the catalogue.
        </p>
      ) : null}
    </>
  )
}
