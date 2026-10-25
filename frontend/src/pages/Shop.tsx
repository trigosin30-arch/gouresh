import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../lib/useApi'
import type { Category, ProductList } from '../lib/types'
import { ProductGrid } from '../components/ProductCard'
import { EmptyState, SkeletonGrid } from '../components/ui'
import { IconSearch } from '../components/Icons'

const SORTS = [
  { value: 'relevance', label: 'Recommended' },
  { value: 'popular', label: 'Most popular' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name A–Z' },
]

const PRICE_BANDS = [
  { label: 'Under ₹100', min: 0, max: 100 },
  { label: '₹100 – ₹250', min: 100, max: 250 },
  { label: '₹250 – ₹500', min: 250, max: 500 },
  { label: '₹500 and above', min: 500, max: undefined },
]

const CLASSES = ['Class 5', 'Class 8', 'Class 10', 'Class 12']

export default function Shop() {
  const [params, setParams] = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const query = useMemo(() => {
    const search = new URLSearchParams(params)
    if (!search.get('page_size')) search.set('page_size', '12')
    if (!search.get('page')) search.set('page', '1')
    return `/products?${search.toString()}`
  }, [params])

  const { data, loading, error } = useApi<ProductList>(query)
  const categories = useApi<{ items: Category[] }>('/categories')

  const update = useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params)
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined || value === '') next.delete(key)
        else next.set(key, value)
      })
      if (!('page' in changes)) next.delete('page')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const activeCategory = params.get('category') ?? ''
  const page = Number(params.get('page') ?? 1)
  const totalPages = data?.pages ?? 1
  const activeFilterCount = ['category', 'min_price', 'in_stock', 'condition', 'board', 'class_level'].filter(
    (key) => params.get(key),
  ).length

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    update({ q: term.trim() || undefined })
  }

  const title = activeCategory
    ? categories.data?.items.find((category) => category.slug === activeCategory)?.name ?? 'Shop'
    : params.get('q')
      ? `Results for “${params.get('q')}”`
      : 'All products'

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>Shop</span>
        {activeCategory ? (
          <>
            <span>/</span>
            <span>{title}</span>
          </>
        ) : null}
      </div>

      <div className="section-head">
        <div>
          <h1>{title}</h1>
          <p>
            {loading ? 'Checking the shelves…' : `${data?.total ?? 0} products available`}
            {params.get('q') ? ' · search across name, ISBN, author, class and board' : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost filter-toggle"
          onClick={() => setFiltersOpen((value) => !value)}
          aria-expanded={filtersOpen}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      <div className="shop-layout">
        <aside className={`filters ${filtersOpen ? 'open' : ''}`} aria-label="Filters">
          <div className="filter-block">
            <form className="search-inline" onSubmit={submitSearch} role="search">
              <input
                className="input"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search products"
                aria-label="Search products"
              />
              <button type="submit" className="btn btn-soft" aria-label="Search">
                <IconSearch size={16} />
              </button>
            </form>
          </div>

          <div className="filter-block">
            <h4>Categories</h4>
            <div className="filter-list">
              <button
                type="button"
                className={!activeCategory ? 'active' : ''}
                onClick={() => update({ category: undefined })}
              >
                All categories
              </button>
              {categories.data?.items.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={activeCategory === category.slug ? 'active' : ''}
                  onClick={() => update({ category: category.slug })}
                >
                  {category.name}
                  <span>{category.product_count ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <h4>Price</h4>
            <div className="chip-row">
              {PRICE_BANDS.map((band) => {
                const active =
                  params.get('min_price') === String(band.min) &&
                  (params.get('max_price') ?? '') === String(band.max ?? '')
                return (
                  <button
                    key={band.label}
                    type="button"
                    className={`chip ${active ? 'active' : ''}`}
                    onClick={() =>
                      update({
                        min_price: active ? undefined : String(band.min),
                        max_price: active ? undefined : band.max ? String(band.max) : undefined,
                      })
                    }
                  >
                    {band.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="filter-block">
            <h4>Availability</h4>
            <div className="chip-row">
              <button
                type="button"
                className={`chip ${params.get('in_stock') === 'true' ? 'active' : ''}`}
                onClick={() => update({ in_stock: params.get('in_stock') === 'true' ? undefined : 'true' })}
              >
                In stock only
              </button>
            </div>
          </div>

          <div className="filter-block">
            <h4>Condition</h4>
            <div className="chip-row">
              {['new', 'refurbished', 'used'].map((condition) => (
                <button
                  key={condition}
                  type="button"
                  className={`chip ${params.get('condition') === condition ? 'active' : ''}`}
                  onClick={() =>
                    update({ condition: params.get('condition') === condition ? undefined : condition })
                  }
                >
                  {condition === 'new' ? 'New' : condition === 'used' ? 'Second-hand' : 'Refurbished'}
                </button>
              ))}
            </div>
          </div>

          {data?.class_levels.length ? (
            <div className="filter-block">
              <h4>Class</h4>
              <div className="chip-row">
                {Array.from(new Set([...CLASSES, ...data.class_levels])).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`chip ${params.get('class_level') === level ? 'active' : ''}`}
                    onClick={() =>
                      update({ class_level: params.get('class_level') === level ? undefined : level })
                    }
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {data?.boards.length ? (
            <div className="filter-block">
              <h4>Board</h4>
              <div className="chip-row">
                {data.boards.map((board) => (
                  <button
                    key={board}
                    type="button"
                    className={`chip ${params.get('board') === board ? 'active' : ''}`}
                    onClick={() => update({ board: params.get('board') === board ? undefined : board })}
                  >
                    {board}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {activeFilterCount > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTerm('')
                setParams(new URLSearchParams(), { replace: true })
              }}
            >
              Clear all filters
            </button>
          ) : null}
        </aside>

        <section>
          <div className="toolbar">
            <span className="small muted">
              {loading
                ? 'Loading…'
                : `Showing ${data?.items.length ?? 0} of ${data?.total ?? 0} products`}
            </span>
            <label className="row small">
              <span className="muted">Sort</span>
              <select
                className="select"
                value={params.get('sort') ?? 'relevance'}
                onChange={(event) => update({ sort: event.target.value })}
                aria-label="Sort products"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? (
            <EmptyState title="Could not load products">{error}</EmptyState>
          ) : loading ? (
            <SkeletonGrid count={6} />
          ) : data && data.items.length > 0 ? (
            <>
              <ProductGrid products={data.items} />
              {totalPages > 1 ? (
                <nav className="pagination" aria-label="Pagination">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) })}
                  >
                    Previous
                  </button>
                  {Array.from({ length: totalPages }).map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      className={page === index + 1 ? 'active' : ''}
                      onClick={() => update({ page: String(index + 1) })}
                      aria-current={page === index + 1 ? 'page' : undefined}
                    >
                      {index + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => update({ page: String(page + 1) })}
                  >
                    Next
                  </button>
                </nav>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="Nothing on this shelf yet"
              action={
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setTerm('')
                    setParams(new URLSearchParams(), { replace: true })
                  }}
                >
                  Clear filters
                </button>
              }
            >
              Try a different search, or clear the filters to see the full catalogue.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  )
}
