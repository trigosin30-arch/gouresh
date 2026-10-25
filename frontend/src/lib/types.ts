export type Money = number // integer paise everywhere

export interface StoreConfig {
  name: string
  phone: string
  email: string
  address: string
  hours: string
  currency: string
  free_shipping_threshold_paise: Money
  shipping_fee_paise: Money
  cod_enabled: boolean
  pickup_enabled: boolean
  max_quantity_per_line: number
}

export interface AppConfig {
  store: StoreConfig
  auth: {
    provider: 'supabase' | 'demo'
    supabase_url: string
    supabase_anon_key: string
    dev_auth: boolean
  }
  payments: { mode: 'mock' | 'test' | 'live'; razorpay_key_id: string }
  environment: string
}

export interface Category {
  id: string
  name: string
  slug: string
  description?: string | null
  image_url?: string | null
  sort_order?: number
  product_count?: number
}

export type Condition = 'new' | 'refurbished' | 'used'

export interface Product {
  id: string
  sku: string
  slug: string
  name: string
  description: string
  category_id: string | null
  category: { id: string; name: string; slug: string } | null
  price_paise: Money
  mrp_paise: Money | null
  stock: number
  in_stock: boolean
  unit: string
  brand: string | null
  isbn: string | null
  author: string | null
  class_level: string | null
  board: string | null
  condition: Condition
  tags: string[]
  image_url: string | null
  is_featured: boolean
  sold_count: number
  created_at: string
  is_archived?: boolean
  updated_at?: string
}

export interface ProductList {
  items: Product[]
  total: number
  page: number
  page_size: number
  pages: number
  boards: string[]
  class_levels: string[]
}

export interface Profile {
  id: string
  email: string
  full_name: string
  phone: string | null
  role: 'customer' | 'staff' | 'admin'
  avatar_url: string | null
  created_at: string
  last_login_at: string | null
  order_count?: number
}

export interface Address {
  id: string
  label: string
  contact_name: string
  phone: string
  line1: string
  line2?: string | null
  locality?: string | null
  city: string
  state: string
  pincode: string
  is_default: boolean
}

export type AddressDraft = Omit<Address, 'id' | 'is_default'>

export type OrderStatus =
  | 'payment_pending'
  | 'payment_failed'
  | 'confirmed'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refunded'

export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded' | 'refund_due'

export interface OrderItem {
  id: string
  product_id: string | null
  sku: string
  name: string
  image_url: string | null
  unit_price_paise: Money
  quantity: number
  line_total_paise: Money
}

export interface OrderEvent {
  id: string
  status: OrderStatus
  note: string | null
  created_at: string
}

export interface PaymentRecord {
  id: string
  provider: string
  provider_order_id: string | null
  provider_payment_id: string | null
  amount_paise: Money
  status: string
  method: string | null
  signature_verified: boolean
  failure_reason: string | null
  created_at: string
}

export interface Order {
  id: string
  order_number: string
  user_id: string
  status: OrderStatus
  payment_method: 'razorpay' | 'cod' | 'pickup'
  payment_status: PaymentStatus
  contact_name: string
  phone: string
  email: string
  shipping_address: {
    line1: string
    line2?: string | null
    locality?: string | null
    city: string
    state: string
    pincode: string
  }
  notes: string | null
  subtotal_paise: Money
  shipping_paise: Money
  discount_paise: Money
  total_paise: Money
  coupon_code: string | null
  courier: string | null
  tracking_number: string | null
  cancel_reason: string | null
  items: OrderItem[]
  events: OrderEvent[]
  payments?: PaymentRecord[]
  created_at: string
  paid_at: string | null
  delivered_at: string | null
  updated_at: string
  timeline?: { stage: string; index: number; stages: string[]; terminal: boolean }
  customer?: Profile
  allowed_transitions?: string[]
}

export interface PaymentSession {
  provider: string
  mode: 'mock' | 'test' | 'live'
  provider_order_id: string
  amount_paise: Money
  currency: string
  key_id: string
  order_number: string
  mock: boolean
  prefill: { name: string; email: string; contact: string }
}

export interface Quote {
  items: {
    product_id: string
    name: string
    image_url: string | null
    unit_price_paise: Money
    quantity: number
    line_total_paise: Money
    stock: number
  }[]
  subtotal_paise: Money
  discount_paise: Money
  shipping_paise: Money
  total_paise: Money
  coupon_code: string | null
  free_shipping_threshold_paise: Money
}

export interface AdminStats {
  totals: {
    revenue_paise: Money
    orders: number
    open_orders: number
    customers: number
    pending_payments: number
    products: number
    inventory_value_paise: Money
  }
  orders_by_status: Record<string, number>
  low_stock: Product[]
  recent_orders: Order[]
  top_products: Product[]
  generated_at: string
}

export interface AuditLog {
  id: string
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  meta: Record<string, unknown>
  created_at: string
}

export interface PaymentEventRow {
  id: string
  event_id: string
  event_type: string
  processed: boolean
  note: string | null
  created_at: string
}

export interface CartItem {
  product_id: string
  slug: string
  name: string
  price_paise: Money
  mrp_paise: Money | null
  image_url: string | null
  unit: string
  stock: number
  quantity: number
  category_slug?: string | null
}
