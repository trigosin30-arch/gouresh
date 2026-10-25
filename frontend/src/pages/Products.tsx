import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, qs } from '../api'
import ProductCard from '../components/ProductCard'
import Seo from '../components/Seo'
import { EmptyState, ErrorState, Pagination, SectionHeader, SkeletonGrid } from '../components/ui'
import type { Product } from '../types'

type Filters = {
  categories: { slug: string; name: string }[]
  boards: string[]
  classes: string[]
  subjects: string[]
  authors: string[]
  publishers: string[]
  book_types: { value: string; label: string }[]
  conditions: { value: string; label: string }[]
  price_min_paise: number
  price_max_paise: number
}

type ProductList = {
  items: Product[]
  total: number
  page: number
  per_page: number
  pages: number
  sort: string
  has_sales_data: boolean
}

const SORTS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'popularity', label: 'Most popular' },
]

export default function Products() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<ProductList | null>(null)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const values = useMemo(() => {
    const read = (key: string) => params.get(key) || ''
    return {
      q: read('q'),
      category: read('category'),
      board: read('board'),
      class_level: read('class_level'),
      subject: read('subject'),
      author: read('author'),
      publisher: read('publisher'),
      condition: read('condition'),
      product_type: read('product_type'),
      book_type: read('book_type'),
      availability: read('availability'),
      sort: read('sort') || (read('q') ? 'relevance' : 'newest'),
      page: Number(read('page') || '1'),
    }
  }, [params])

  useEffect(() => {
    api<Filters>('/api/products/filters').then(setFilters).catch(() => undefined)
  }, [])

  useEffect(() => {
    const min = params.get('min_price')
    const max = params.get('max_price')
    setMinPrice(min ? String(Number(min) / 100) : '')
    setMaxPrice(max ? String(Number(max) / 100) : '')
    // Only react to the price params themselves so typing is not clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('min_price'), params.get('max_price')])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const query = qs({
      q: values.q,
      category: values.category,
      board: values.board,
      class_level: values.class_level,
      subject: values.subject,
      author: values.author,
      publisher: values.publisher,
      condition: values.condition,
      product_type: values.product_type,
      book_type: values.book_type,
      availability: values.availability,
      sort: values.sort,
      page: values.page,
      per_page: 24,
      min_price: params.get('min_price'),
      max_price: params.get('max_price'),
    })
    api<ProductList>(`/api/products${query}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }

  const clearAll = () => setParams(new URLSearchParams())

  const activeFilterCount = ['category', 'board', 'class_level', 'subject', 'condition', 'availability', 'product_type', 'author', 'publisher', 'min_price', 'max_price'].filter(
    (key) => params.get(key),
  ).length

  const applyPrice = () => {
    const next = new URLSearchParams(params)
    const minPaise = minPrice ? Math.round(Number(minPrice) * 100) : null
    const maxPaise = maxPrice ? Math.round(Number(maxPrice) * 100) : null
    if (minPaise) next.set('min_price', String(minPaise))
    else next.delete('min_price')
    if (maxPaise) next.set('max_price', String(maxPaise))
    else next.delete('max_price')
    next.delete('page')
    setParams(next)
  }

  const filterPanel = (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Category</h3>
        <select className="input" value={values.category} onChange={(event) => update('category', event.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {filters?.categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Item type</h3>
        <select className="input" value={values.product_type} onChange={(event) => update('product_type', event.target.value)} aria-label="Item type">
          <option value="">New &amp; pre-owned</option>
          <option value="new">New only</option>
          <option value="used">Store pre-owned</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Education board</h3>
          <select className="input" value={values.board} onChange={(event) => update('board', event.target.value)} aria-label="Board">
            <option value="">Any board</option>
            {filters?.boards.map((board) => (
              <option key={board} value={board}>{board}</option>
            ))}
          </select>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Class</h3>
          <select className="input" value={values.class_level} onChange={(event) => update('class_level', event.target.value)} aria-label="Class">
            <option value="">Any class</option>
            {filters?.classes.map((klass) => (
              <option key={klass} value={klass}>Class {klass}</option>
            ))}
          </select>
        </div>
      </div>

      {filters && filters.subjects.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</h3>
          <select className="input" value={values.subject} onChange={(event) => update('subject', event.target.value)} aria-label="Subject">
            <option value="">Any subject</option>
            {filters.subjects.map((subject) => (
              <option key={subject} value={subject}>{subject}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Book type</h3>
        <select className="input" value={values.book_type} onChange={(event) => update('book_type', event.target.value)} aria-label="Book type">
          <option value="">Any type</option>
          {filters?.book_types.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Condition</h3>
        <select className="input" value={values.condition} onChange={(event) => update('condition', event.target.value)} aria-label="Condition">
          <option value="">Any condition</option>
          {filters?.conditions.map((condition) => (
            <option key={condition.value} value={condition.value}>{condition.label}</option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Availability</h3>
        <select className="input" value={values.availability} onChange={(event) => update('availability', event.target.value)} aria-label="Availability">
          <option value="">Include out of stock</option>
          <option value="in_stock">In stock only</option>
          <option value="out_of_stock">Out of stock / enquiry</option>
        </select>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Price (₹)</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            inputMode="numeric"
            className="input"
            placeholder={filters ? String(Math.floor(filters.price_min_paise / 100)) : 'Min'}
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            aria-label="Minimum price in rupees"
          />
          <span aria-hidden="true">–</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            className="input"
            placeholder={filters ? String(Math.ceil(filters.price_max_paise / 100)) : 'Max'}
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            aria-label="Maximum price in rupees"
          />
        </div>
        <button type="button" className="btn-secondary btn-sm mt-2 w-full" onClick={applyPrice}>
          Apply price
        </button>
      </div>

      <button type="button" className="btn-ghost btn-sm w-full" onClick={clearAll}>
        Clear all filters
      </button>
    </div>
  )

  const heading = values.category
    ? filters?.categories.find((category) => category.slug === values.category)?.name || 'Products'
    : values.product_type === 'used'
      ? 'Store pre-owned items'
      : 'All products'

  return (
    <>
      <Seo
        title={`${values.q ? `Search: ${values.q}` : heading} · Products`}
        description="Search the Ankit Stationery Mart catalogue by name, author, ISBN, publisher, board, class and condition. Live stock from the store database."
        canonicalPath={`/products${params.toString() ? `?${params.toString()}` : ''}`}
      />
      <div className="shell py-8">
        <SectionHeader
          title={values.q ? `Results for “${values.q}”` : heading}
          subtitle={
            data
              ? `${data.total} ${data.total === 1 ? 'product' : 'products'} found${values.q ? ' for your search' : ''}. Stock is checked live.`
              : 'Loading the catalogue…'
          }
          action={
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary btn-sm lg:hidden" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>
                Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span className="whitespace-nowrap">Sort</span>
                <select
                  className="input py-1.5 text-xs"
                  value={values.sort}
                  onChange={(event) => update('sort', event.target.value)}
                  aria-label="Sort products"
                >
                  {SORTS.filter((sort) => sort.value !== 'relevance' || values.q).filter((sort) => sort.value !== 'popularity' || data?.has_sales_data !== false).map((sort) => (
                    <option key={sort.value} value={sort.value}>{sort.label}</option>
                  ))}
                </select>
              </label>
            </div>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[240px,1fr]">
          <aside className={`card h-fit p-4 ${showFilters ? 'block' : 'hidden lg:block'}`} aria-label="Product filters">
            {filterPanel}
          </aside>

          <div>
            {activeFilterCount > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                {Object.entries({
                  category: values.category,
                  board: values.board,
                  class_level: values.class_level,
                  subject: values.subject,
                  condition: values.condition,
                  book_type: values.book_type,
                  availability: values.availability,
                  product_type: values.product_type,
                })
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <button
                      key={key}
                      type="button"
                      className="badge bg-navy-100 text-navy-800 hover:bg-navy-200"
                      onClick={() => update(key, '')}
                      aria-label={`Remove ${key} filter`}
                    >
                      {key === 'class_level' ? `Class ${value}` : value} ✕
                    </button>
                  ))}
              </div>
            )}

            {loading && <SkeletonGrid count={8} />}
            {error && <ErrorState message={error} onRetry={() => setParams(new URLSearchParams(params))} />}
            {!loading && !error && data && data.items.length === 0 && (
              <EmptyState
                title="No products match these filters"
                message="Try removing a filter, checking the spelling, or searching by ISBN. Out-of-stock titles are shown too — use the availability filter."
                action={<button type="button" className="btn-secondary" onClick={clearAll}>Clear filters</button>}
                icon="🔍"
              />
            )}
            {!loading && !error && data && data.items.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                  {data.items.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
                <Pagination page={data.page} pages={data.pages} onChange={(page) => update('page', String(page))} />
                <p className="mt-6 text-center text-xs text-slate-500">
                  Looking for used copies listed by other customers? <Link to="/used-books" className="link">Browse the second-hand marketplace</Link>.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
