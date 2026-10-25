import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import Home from './pages/Home'
import Products from './pages/Products'
import ProductDetail from './pages/ProductDetail'
import BookLists from './pages/BookLists'
import UsedBooks from './pages/UsedBooks'
import UsedBookDetail from './pages/UsedBookDetail'
import SellBooks from './pages/SellBooks'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import OrderConfirmation from './pages/OrderConfirmation'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Account from './pages/Account'
import Wishlist from './pages/Wishlist'
import Orders from './pages/Orders'
import OrderDetails from './pages/OrderDetails'
import TrackOrder from './pages/TrackOrder'
import BulkOrders from './pages/BulkOrders'
import QuotationView from './pages/QuotationView'
import Contact from './pages/Contact'
import Faq from './pages/Faq'
import About from './pages/About'
import Policies from './pages/Policies'
import NotFound from './pages/NotFound'
import { PageLoading } from './components/ui'

// The admin bundle is only downloaded for signed-in staff.
const AdminApp = lazy(() => import('./admin/AdminApp'))

export default function App() {
  return (
    <Routes>
      <Route
        path="/admin/*"
        element={
          <RequireAuth staffOnly>
            <Suspense fallback={<PageLoading label="Loading administration" />}>
              <AdminApp />
            </Suspense>
          </RequireAuth>
        }
      />

      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/products" element={<Products />} />
              <Route path="/product/:slug" element={<ProductDetail />} />
              <Route path="/book-lists" element={<BookLists />} />
              <Route path="/used-books" element={<UsedBooks />} />
              <Route path="/used-books/:code" element={<UsedBookDetail />} />
              <Route path="/sell-books" element={<SellBooks />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/order-confirmation" element={<OrderConfirmation />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
              <Route path="/wishlist" element={<RequireAuth><Wishlist /></RequireAuth>} />
              <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
              <Route path="/orders/:id" element={<RequireAuth><OrderDetails /></RequireAuth>} />
              <Route path="/track-order" element={<TrackOrder />} />
              <Route path="/bulk-orders" element={<BulkOrders />} />
              <Route path="/quotations/:reference" element={<QuotationView />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy-policy" element={<Policies kind="privacy" />} />
              <Route path="/terms" element={<Policies kind="terms" />} />
              <Route path="/shipping-policy" element={<Policies kind="shipping" />} />
              <Route path="/returns-refunds" element={<Policies kind="returns" />} />
              <Route path="/404" element={<NotFound />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  )
}
