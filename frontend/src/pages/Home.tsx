import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { rupees } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { Category, Product, ProductList } from '../lib/types'
import { ProductGrid } from '../components/ProductCard'
import { SkeletonGrid } from '../components/ui'
import { IconArrow, IconBox, IconClock, IconSearch, IconShield, IconTruck } from '../components/Icons'

const CATEGORY_GLYPHS: Record<string, string> = {
  'school-textbooks': 'M4 5h7a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4zM20 5h-3a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h3z',
  'notebooks-registers': 'M6 3h12v18H6zM6 7H4M6 12H4M6 17H4M9 7h6M9 11h6',
  'writing-instruments': 'M4 20l4-1 10-10-3-3L5 16zM14 6l3 3M4 20l1-4',
  'art-craft': 'M12 3a9 9 0 1 0 0 18c1.6 0 2-1.1 1.2-2.2-.8-1.1 0-2.3 1.5-2.3H17a4 4 0 0 0 4-4A9 9 0 0 0 12 3zM8 9h.01M12 7h.01M16 10h.01',
  'office-supplies': 'M4 8h16v11H4zM9 8V5h6v3M8 13h8',
  'exam-competition': 'M6 3h9l4 4v14H6zM15 3v4h4M9 13l2 2 4-4',
}

export default function Home() {
  const navigate = useNavigate()
  const { config } = useAuth()
  const [term, setTerm] = useState('')
  const categories = useApi<{ items: Category[] }>('/categories')
  const featured = useApi<ProductList>('/products?featured=true&page_size=8&sort=popular')
  const fresh = useApi<ProductList>('/products?sort=newest&page_size=4')
  const store = config?.store

  const search = (event: React.FormEvent) => {
    event.preventDefault()
    navigate(term.trim() ? `/shop?q=${encodeURIComponent(term.trim())}` : '/shop')
  }

  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow">Shimla · Lower Bazaar · since 1994</span>
          <h1>Every school list, sorted before the first bell.</h1>
          <p>
            Textbooks, notebooks, art supplies and exam guides from the counter you already know —
            now with online ordering, UPI payments and home delivery across Shimla.
          </p>
          <form className="hero-search" onSubmit={search} role="search">
            <label htmlFor="hero-search" className="visually-hidden">
              Search products
            </label>
            <input
              id="hero-search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search “class 10 maths”, ISBN, author or brand…"
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary">
              <IconSearch size={17} /> Search
            </button>
          </form>
          <div className="hero-meta">
            <span>
              <strong>4,000+</strong> SKUs on the shelf
            </span>
            <span>
              <strong>{rupees(store?.free_shipping_threshold_paise ?? 49900)}</strong> free delivery
            </span>
            <span>
              <strong>Same day</strong> dispatch in Shimla
            </span>
          </div>
        </div>
      </section>

      <section className="banner-strip">
        <div className="promo accent">
          <strong>School list bundle</strong>
          <p>Send us the class list on WhatsApp — we pack it and confirm stock the same evening.</p>
        </div>
        <div className="promo gold">
          <strong>Exam season shelf</strong>
          <p>HPPSC, JEE and NEET guides with previous-year papers, updated for this session.</p>
        </div>
        <div className="promo sage">
          <strong>Store pickup in 2 hours</strong>
          <p>Order online, collect from the counter at Lower Bazaar. Pay at pickup if you prefer.</p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="kicker">Browse the shelves</div>
            <h2>Shop by category</h2>
          </div>
          <Link to="/shop" className="btn btn-ghost btn-sm">
            All products <IconArrow size={15} />
          </Link>
        </div>
        <div className="category-grid">
          {categories.data?.items.map((category) => (
            <Link key={category.id} to={`/shop?category=${category.slug}`} className="category-tile">
              <svg
                className="glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={CATEGORY_GLYPHS[category.slug] ?? CATEGORY_GLYPHS['office-supplies']} />
              </svg>
              <strong>{category.name}</strong>
              <span>{category.product_count ?? 0} products</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="kicker">Picked by the counter</div>
            <h2>Featured this week</h2>
            <p>What parents and teachers have been asking for most.</p>
          </div>
          <Link to="/shop?sort=popular" className="btn btn-ghost btn-sm">
            Most popular
          </Link>
        </div>
        {featured.loading ? (
          <SkeletonGrid count={4} />
        ) : featured.data && featured.data.items.length > 0 ? (
          <ProductGrid products={featured.data.items} />
        ) : (
          <p className="muted">Featured products will appear here once they are marked in the admin.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="kicker">Fresh stock</div>
            <h2>New arrivals</h2>
          </div>
          <Link to="/shop?sort=newest" className="btn btn-ghost btn-sm">
            See all new stock
          </Link>
        </div>
        {fresh.loading ? (
          <SkeletonGrid count={4} />
        ) : (
          <ProductGrid products={(fresh.data?.items ?? []) as Product[]} />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="kicker">Visit us</div>
            <h2>Ordering, delivery and the shop</h2>
          </div>
        </div>
        <div className="store-facts">
          <div>
            <h4>
              <IconTruck size={15} /> Delivery
            </h4>
            <p>
              Free within Shimla above {rupees(store?.free_shipping_threshold_paise ?? 49900)}; a flat{' '}
              {rupees(store?.shipping_fee_paise ?? 4900)} below that. Orders placed before 4 pm are packed
              the same day.
            </p>
          </div>
          <div>
            <h4>
              <IconClock size={15} /> Shop hours
            </h4>
            <p>{store?.hours ?? 'Mon–Sat, 9:30 am – 8:00 pm'}</p>
          </div>
          <div>
            <h4>
              <IconBox size={15} /> Pickup
            </h4>
            <p>Collect at the counter within 2 hours of ordering. Pay online or at pickup.</p>
          </div>
          <div>
            <h4>
              <IconShield size={15} /> Returns
            </h4>
            <p>
              Unused books and sealed packs can be returned within 7 days with the bill. Printed textbooks
              are exchange-only.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
