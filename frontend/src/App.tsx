import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { PublicLayout, ScrollToTop } from './components/Layout'
import { Loading } from './components/ui'
import Home from './pages/Home'
import Shop from './pages/Shop'
import ProductDetail from './pages/ProductDetail'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Account from './pages/Account'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import About from './pages/About'
import NotFound from './pages/NotFound'

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const Dashboard = lazy(() => import('./pages/admin/Dashboard'))
const AdminProducts = lazy(() => import('./pages/admin/Products'))
const ProductEditor = lazy(() => import('./pages/admin/ProductEditor'))
const AdminOrders = lazy(() => import('./pages/admin/Orders'))
const AdminOrderDetail = lazy(() => import('./pages/admin/OrderDetail'))
const AdminCustomers = lazy(() => import('./pages/admin/Customers'))
const AdminActivity = lazy(() => import('./pages/admin/Activity'))

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<div className="container page"><Loading label="Loading" /></div>}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Home />} />
            <Route path="shop" element={<Shop />} />
            <Route path="product/:slug" element={<ProductDetail />} />
            <Route path="cart" element={<Cart />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:ref" element={<OrderDetail />} />
            <Route path="account" element={<Account />} />
            <Route path="login" element={<Login />} />
            <Route path="auth/callback" element={<AuthCallback />} />
            <Route path="about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Route>

          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="products/new" element={<ProductEditor />} />
            <Route path="products/:id" element={<ProductEditor />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="orders/:ref" element={<AdminOrderDetail />} />
            <Route path="customers" element={<AdminCustomers />} />
            <Route path="activity" element={<AdminActivity />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
