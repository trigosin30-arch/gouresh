import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, qs } from '../api'
import ListingCard from '../components/ListingCard'
import Seo from '../components/Seo'
import { Breadcrumbs, EmptyState, ErrorState, Pagination, SectionHeader, SkeletonGrid } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { Listing } from '../types'

type Payload = {
  items: Listing[]
  total: number
  page: number
  pages: number
  filters: { classes: string[]; subjects: string[]; conditions: string[] }
  commission_bp: number
  marketplace_note: string
}

const CONDITION_LABELS: Record<string, string> = {
  like_new: 'Like New',
  good: 'Good',
  acceptable: 'Acceptable',
  new: 'New',
}

export default function UsedBooks() {
  const [params, setParams] = useSearchParams()
  const { settings } = useStore()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const values = useMemo(
    () => ({
      q: params.get('q') || '',
      class_level: params.get('class_level') || '',
      subject: params.get('subject') || '',
      condition: params.get('condition') || '',
      sort: params.get('sort') || 'newest',
      page: Number(params.get('page') || '1'),
    }),
    [params],
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    api<Payload>(`/api/listings${qs({ ...values, per_page: 20 })}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [values])

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }

  return (
    <>
      <Seo
        title="Second-hand books marketplace"
        description="Browse moderated second-hand books listed by customers near Jalandhar Cantt. Each listing shows its real condition and is reviewed by the store before publication."
        canonicalPath="/used-books"
      />
      <div className="shell py-8">
        <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Second-hand books' }]} />
        <SectionHeader
          title="Second-hand book marketplace"
          subtitle="Customer-listed copies, reviewed by the store before they go live. Contact details stay private — the store coordinates every handover."
          action={
            <div className="flex gap-2">
              <Link to="/sell-books" className="btn-accent btn-sm">Sell your books</Link>
            </div>
          }
        />

        <div className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="sm:col-span-2">
            <span className="label">Search</span>
            <input
              type="search"
              className="input"
              placeholder="Title, author, ISBN"
              defaultValue={values.q}
              onKeyDown={(event) => {
                if (event.key === 'Enter') update('q', (event.target as HTMLInputElement).value.trim())
              }}
              aria-label="Search second-hand listings"
            />
          </label>
          <label>
            <span className="label">Class</span>
            <select className="input" value={values.class_level} onChange={(event) => update('class_level', event.target.value)}>
              <option value="">Any class</option>
              {data?.filters.classes.map((klass) => (
                <option key={klass} value={klass}>Class {klass}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Subject</span>
            <select className="input" value={values.subject} onChange={(event) => update('subject', event.target.value)}>
              <option value="">Any subject</option>
              {data?.filters.subjects.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Condition</span>
            <select className="input" value={values.condition} onChange={(event) => update('condition', event.target.value)}>
              <option value="">Any condition</option>
              {(data?.filters.conditions || ['like_new', 'good', 'acceptable']).filter((c) => c !== 'new').map((condition) => (
                <option key={condition} value={condition}>{CONDITION_LABELS[condition] || condition}</option>
              ))}
            </select>
          </label>
        </div>

        {settings?.marketplace_note && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{settings.marketplace_note}</p>
        )}

        {loading && <SkeletonGrid count={8} />}
        {error && <ErrorState message={error} onRetry={() => setParams(new URLSearchParams(params))} />}
        {!loading && !error && data && data.items.length === 0 && (
          <EmptyState
            title="No second-hand listings match your filters"
            message="Listings appear only after the store approves them. Try clearing filters, or submit your own book for sale."
            action={
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setParams(new URLSearchParams())}>Clear filters</button>
                <Link to="/sell-books" className="btn-primary">Sell a book</Link>
              </div>
            }
            icon="📚"
          />
        )}
        {!loading && !error && data && data.items.length > 0 && (
          <>
            <p className="mb-3 text-sm text-slate-600">{data.total} approved listing{data.total === 1 ? '' : 's'}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {data.items.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            <Pagination page={data.page} pages={data.pages} onChange={(page) => update('page', String(page))} />
          </>
        )}
      </div>
    </>
  )
}
