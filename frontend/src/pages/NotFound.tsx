import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="empty">
      <div className="kicker">404</div>
      <h1>That shelf is empty</h1>
      <p className="muted">The page you asked for is not here. Try the shop instead.</p>
      <Link to="/shop" className="btn btn-primary">
        Browse products
      </Link>
    </div>
  )
}
