import { Link } from 'react-router-dom'
import Seo from '../components/Seo'

export default function NotFound() {
  return (
    <>
      <Seo title="Page not found" noindex canonicalPath="/404" />
      <div className="shell py-16">
        <div className="mx-auto max-w-md text-center">
          <p className="text-5xl font-black text-navy-200">404</p>
          <h1 className="mt-2 text-2xl font-bold text-navy-900">We could not find that page</h1>
          <p className="mt-2 text-sm text-slate-600">
            The link may be old or mistyped. The catalogue, book lists and used books are all still here.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link to="/" className="btn-primary">Go to the home page</Link>
            <Link to="/products" className="btn-secondary">Browse products</Link>
            <Link to="/used-books" className="btn-secondary">Used books</Link>
            <Link to="/contact" className="btn-ghost">Contact the store</Link>
          </div>
        </div>
      </div>
    </>
  )
}
