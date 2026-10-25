import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Seo from '../components/Seo'
import ProductCard, { ProductImage } from '../components/ProductCard'
import ListingCard from '../components/ListingCard'
import { EmptyState, ErrorState, SectionHeader, SkeletonGrid, Spinner } from '../components/ui'
import { useStore } from '../context/StoreContext'
import type { HomePayload } from '../types'

type Faq = { id: string; question: string; answer: string; category: string }

export default function Home() {
  const { settings } = useStore()
  const [data, setData] = useState<HomePayload | null>(null)
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([api<HomePayload>('/api/store/home'), api<{ faqs: Faq[] }>('/api/store/faqs')])
      .then(([home, faqData]) => {
        setData(home)
        setFaqs(faqData.faqs.slice(0, 4))
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const primaryBanner = data?.banners[0]

  return (
    <>
      <Seo
        title="Ankit Stationery Mart · Stationery, New & Second-Hand Books"
        description={
          settings?.seo_description ||
          'Shop stationery, school textbooks and verified second-hand books at Ankit Stationery Mart, 147 Moolraj Road, Jalandhar Cantt, Punjab 144005.'
        }
        canonicalPath="/"
        structuredData={{
          '@context': 'https://schema.org',
          '@type': 'Store',
          name: settings?.store_name || 'Ankit Stationery Mart',
          address: {
            '@type': 'PostalAddress',
            streetAddress: '147 Moolraj Road',
            addressLocality: 'Jalandhar Cantt',
            addressRegion: 'Punjab',
            postalCode: '144005',
            addressCountry: 'IN',
          },
          telephone: settings?.store_phone || undefined,
          url: typeof window !== 'undefined' ? window.location.origin : undefined,
        }}
      />

      <section className="bg-navy-900 text-white">
        <div className="shell grid gap-6 py-10 sm:py-14 lg:grid-cols-[1.2fr,0.8fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-300">Jalandhar Cantt · since your school days</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl">
              {primaryBanner?.title || 'Stationery, textbooks and trusted second-hand books'}
            </h1>
            <p className="mt-3 max-w-xl text-sm text-navy-100 sm:text-base">
              {primaryBanner?.subtitle ||
                'Everything for the new session — pens, notebooks, school supplies, board-wise textbooks and a moderated marketplace of pre-owned books.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to={primaryBanner?.cta_url || '/products'}
                className="btn-accent"
              >
                {primaryBanner?.cta_label || 'Browse the catalogue'}
              </Link>
              <Link to="/book-lists" className="btn-secondary border-white/30 bg-white/10 text-white hover:bg-white/20">
                Find books by board &amp; class
              </Link>
            </div>
            <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4 text-xs text-navy-100">
              <div>
                <dt className="font-semibold text-white">Store</dt>
                <dd>147 Moolraj Road, Jalandhar Cantt</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Pickup</dt>
                <dd>{settings?.pickup_enabled ? 'Available at the counter' : 'Not configured'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-white">Delivery</dt>
                <dd>{settings?.delivery_enabled && settings.delivery_pincodes.length ? 'Selected PIN codes' : 'Not configured'}</dd>
              </div>
            </dl>
          </div>
          {primaryBanner?.image_url ? (
            <img
              src={primaryBanner.image_url}
              alt=""
              className="hidden aspect-[4/3] w-full rounded-xl object-cover shadow-2xl lg:block"
              loading="eager"
            />
          ) : (
            <div className="hidden rounded-xl border border-white/15 bg-white/5 p-6 lg:block">
              <h2 className="text-sm font-semibold text-white">Store offerings</h2>
              <ul className="mt-3 space-y-2 text-sm text-navy-100">
                <li>• New stationery and school supplies</li>
                <li>• New textbooks, guides and workbooks</li>
                <li>• Moderated second-hand books</li>
                <li>• Bulk quotations for schools and offices</li>
              </ul>
            </div>
          )}
        </div>
      </section>

      <div className="shell py-10">
        {loading && (
          <div className="space-y-10">
            <Spinner label="Loading the storefront" />
            <SkeletonGrid count={4} />
          </div>
        )}
        {error && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && data && (
          <div className="space-y-12">
            <section aria-labelledby="categories-heading">
              <SectionHeader
                title="Shop by category"
                subtitle="Live catalogue counts from the store database."
                action={<Link to="/products" className="text-sm font-semibold text-navy-700 hover:underline">View all products →</Link>}
              />
              <h2 id="categories-heading" className="sr-only">Categories</h2>
              {data.categories.length === 0 ? (
                <EmptyState title="No categories published yet" message="The store administrator has not added categories." icon="🗂️" />
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {data.categories.map((category) => (
                    <Link
                      key={category.id}
                      to={`/products?category=${encodeURIComponent(category.slug)}`}
                      className="card group overflow-hidden transition hover:shadow-lg"
                    >
                      {category.image_url ? (
                        <img src={category.image_url} alt="" className="aspect-[5/3] w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex aspect-[5/3] items-center justify-center bg-navy-50 text-2xl" aria-hidden="true">📚</div>
                      )}
                      <div className="p-3">
                        <h3 className="text-sm font-semibold text-navy-900 group-hover:underline">{category.name}</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {category.product_count} {category.product_count === 1 ? 'product' : 'products'}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {data.featured.length > 0 && (
              <section aria-labelledby="featured-heading">
                <h2 id="featured-heading" className="sr-only">Featured products</h2>
                <SectionHeader title="Featured this week" subtitle="Chosen by the store team." />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {data.featured.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            )}

            {data.has_sales_data && data.bestsellers.length > 0 && (
              <section aria-labelledby="bestsellers-heading">
                <h2 id="bestsellers-heading" className="sr-only">Bestsellers</h2>
                <SectionHeader title="Bestsellers" subtitle="Ranked by units actually sold through this store." />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {data.bestsellers.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="arrivals-heading">
              <SectionHeader
                title="Recently added"
                subtitle="The newest items in the catalogue."
                action={<Link to="/products?sort=newest" className="text-sm font-semibold text-navy-700 hover:underline">See all new arrivals →</Link>}
              />
              <h2 id="arrivals-heading" className="sr-only">Recently added products</h2>
              {data.new_arrivals.length === 0 ? (
                <EmptyState title="The catalogue is empty" message="Products added by the store will appear here." />
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {data.new_arrivals.slice(0, 8).map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              )}
            </section>

            <section className="card overflow-hidden" aria-labelledby="finder-heading">
              <div className="grid gap-6 p-6 lg:grid-cols-[1fr,1.4fr]">
                <div>
                  <h2 id="finder-heading" className="text-xl font-semibold text-navy-900">Board &amp; class book finder</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Pick your board and class to see which textbooks, guides and workbooks are actually on the shelf right now.
                  </p>
                  <Link to="/book-lists" className="btn-primary mt-4">Open the book finder</Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.keys(data.board_index).length === 0 && (
                    <p className="text-sm text-slate-500">Textbook board/class metadata has not been added yet.</p>
                  )}
                  {Object.entries(data.board_index).slice(0, 4).map(([board, classes]) => (
                    <div key={board} className="rounded-lg border border-slate-200 p-3">
                      <h3 className="text-sm font-semibold text-navy-900">{board}</h3>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(classes)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .slice(0, 8)
                          .map(([klass, count]) => (
                            <Link
                              key={klass}
                              to={`/products?board=${encodeURIComponent(board)}&class_level=${encodeURIComponent(klass)}`}
                              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:border-navy-300 hover:bg-navy-50"
                              title={`${count} titles for class ${klass}`}
                            >
                              Class {klass}
                            </Link>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section aria-labelledby="used-heading">
              <SectionHeader
                title="Second-hand books from other customers"
                subtitle="Every listing is reviewed by the store before it appears. Availability is live."
                action={<Link to="/used-books" className="text-sm font-semibold text-navy-700 hover:underline">Browse all used books →</Link>}
              />
              <h2 id="used-heading" className="sr-only">Second-hand listings</h2>
              {data.listings.length === 0 ? (
                <EmptyState
                  title="No second-hand listings are live"
                  message="Approved customer listings will appear here. You can submit your own books for review at any time."
                  action={<Link to="/sell-books" className="btn-secondary">Sell your books</Link>}
                  icon="📖"
                />
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {data.listings.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} />
                  ))}
                </div>
              )}
              {data.used_store_items.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold text-navy-900">Pre-owned copies sold directly by the store</h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {data.used_store_items.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
              <div className="card p-6">
                <h2 className="text-xl font-semibold text-navy-900">Visit the store</h2>
                <p className="mt-2 text-sm text-slate-600">{settings?.store_address || '147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India.'}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {settings?.store_opening_hours || 'Opening hours have not been published yet.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {settings?.store_map_url && (
                    <a href={settings.store_map_url} className="btn-secondary" target="_blank" rel="noreferrer noopener">
                      Open map
                    </a>
                  )}
                  <Link to="/contact" className="btn-secondary">Contact &amp; directions</Link>
                  <Link to="/bulk-orders" className="btn-primary">Request a bulk quotation</Link>
                </div>
              </div>
              <div className="card p-6">
                <h2 className="text-xl font-semibold text-navy-900">Frequently asked</h2>
                {faqs.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No FAQs have been published yet.</p>
                ) : (
                  <dl className="mt-3 space-y-3">
                    {faqs.map((faq) => (
                      <div key={faq.id}>
                        <dt className="text-sm font-medium text-navy-900">{faq.question}</dt>
                        <dd className="mt-1 line-clamp-2 text-sm text-slate-600">{faq.answer}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <Link to="/faq" className="mt-4 inline-block text-sm font-semibold text-navy-700 hover:underline">
                  All FAQs and support →
                </Link>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  )
}
