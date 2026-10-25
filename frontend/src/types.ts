export type Availability = {
  state: 'in_stock' | 'low_stock' | 'out_of_stock' | 'enquiry_only' | 'unavailable'
  label: string
  can_buy: boolean
  stock?: number
}

export type CategoryRef = { id: string; name: string; slug: string }

export type Product = {
  id: string
  slug: string
  title: string
  price_paise: number
  compare_at_price_paise: number | null
  discount_percent: number | null
  image_url: string | null
  image_alt: string
  condition: string
  condition_label: string
  product_type: 'new' | 'used'
  category: CategoryRef | null
  author: string | null
  publisher: string | null
  isbn: string | null
  board: string | null
  class_level: string | null
  subject: string | null
  book_type: string | null
  is_featured: boolean
  availability: Availability
  popularity: number
  created_at: string
}

export type ProductDetail = Product & {
  description: string | null
  sku: string | null
  edition: string | null
  language: string | null
  publication_year: number | null
  academic_year: string | null
  images: { id: string; url: string; alt_text: string }[]
  related: Product[]
  delivery: {
    delivery_enabled: boolean
    pickup_enabled: boolean
    pickup_instructions: string
    delivery_fee_paise: number
    free_above_paise: number
  }
  policies: { returns_note: string; return_window_days: number; cancellation_window_hours: number }
}

export type Settings = {
  store_name: string
  store_tagline: string
  store_address: string
  store_phone: string
  store_whatsapp: string
  store_email: string
  store_opening_hours: string
  store_map_url: string
  delivery_enabled: boolean
  delivery_fee_paise: number
  free_delivery_threshold_paise: number
  delivery_pincodes: string[]
  pickup_enabled: boolean
  pickup_instructions: string
  min_order_paise: number
  cod_enabled: boolean
  online_payments_enabled: boolean
  online_payments_available: boolean
  tax_enabled: boolean
  tax_rate_bp: number
  prices_include_tax: boolean
  cancellation_window_hours: number
  return_window_days: number
  returns_note: string
  shipping_note: string
  marketplace_enabled: boolean
  marketplace_commission_bp: number
  marketplace_note: string
  seo_title: string
  seo_description: string
  announcement: string
  support_note: string
  demo_mode: boolean
  payment_methods: string[]
}

export type Bootstrap = {
  settings: Settings
  categories: { id: string; slug: string; name: string; image_url: string | null; description: string | null }[]
  user: User | null
  cart_count: number
  wishlist_count: number
  unread_notifications: number
  env: string
  demo_mode: boolean
}

export type User = {
  id: string
  full_name: string
  email: string
  phone: string | null
  role: 'customer' | 'staff' | 'admin'
  status: string
  email_verified: boolean
  /** False for accounts created through Google sign-in that never set a password. */
  has_password?: boolean
  google_linked?: boolean
  created_at: string
}

export type CartItem = {
  id: string
  product_id: string
  slug: string | null
  title: string
  image_url: string | null
  condition: string | null
  unit_price_paise: number
  quantity: number
  line_total_paise: number
  available_stock: number
  issue: string | null
}

export type Cart = {
  cart_id: string | null
  items: CartItem[]
  item_count: number
  subtotal_paise: number
  discount_paise: number
  delivery_fee_paise: number
  tax_paise: number
  total_paise: number
  min_order_paise: number
  below_minimum: boolean
  has_issue: boolean
  can_checkout: boolean
  delivery_enabled: boolean
  pickup_enabled: boolean
  payment_methods: string[]
  coupon: { code: string; description?: string; discount_paise: number; error?: string } | null
}

export type OrderItem = {
  id: string
  title: string
  quantity: number
  unit_price_paise: number
  line_total_paise: number
  condition: string | null
  listing_id: string | null
  product_id: string | null
}

export type Order = {
  id: string
  order_number: string
  status: string
  payment_status: string
  payment_method: string
  order_type: string
  total_paise: number
  subtotal_paise: number
  discount_paise: number
  delivery_fee_paise: number
  tax_paise: number
  refunded_paise: number
  fulfillment_type: string
  created_at: string
  placed_at: string
  delivered_at: string | null
  cancelled_at: string | null
  customer_note: string | null
  tracking_token: string
  items: OrderItem[]
  shipment: { mode: string; status: string; carrier: string | null; tracking_number: string | null } | null
  shipping_address: { line1: string; line2: string | null; locality: string; city: string; state: string; pincode: string } | null
  events?: { type: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string; actor: string }[]
  returns?: ReturnRequest[]
  can_cancel?: boolean
  can_request_return?: boolean
  tracking?: { carrier?: string | null; tracking_number?: string | null }
}

export type ReturnRequest = {
  id: string
  reference: string
  request_type: string
  reason: string
  status: string
  admin_note: string | null
  refund_amount_paise: number | null
  created_at: string
  resolved_at: string | null
  order_number?: string | null
}

export type Listing = {
  id: string
  listing_code: string
  title: string
  isbn: string | null
  author: string | null
  publisher: string | null
  board: string | null
  class_level: string | null
  subject: string | null
  book_type: string | null
  condition: string
  condition_label: string
  condition_notes: string | null
  asking_price_paise: number
  status: string
  status_label: string
  image_url: string | null
  image_alt: string
  images: { id: string; url: string; alt_text: string }[]
  published_at: string | null
  created_at: string
  seller_label: string
  can_buy?: boolean
  is_owner?: boolean
  moderation_note?: string | null
  commission_bp?: number
  marketplace_note?: string
  delivery?: { delivery_enabled: boolean; pickup_enabled: boolean; delivery_fee_paise: number }
}

export type HomePayload = {
  settings: Settings
  banners: { id: string; title: string; subtitle: string | null; image_url: string | null; cta_label: string | null; cta_url: string | null; theme: string }[]
  categories: { id: string; slug: string; name: string; description: string | null; image_url: string | null; product_count: number }[]
  featured: Product[]
  new_arrivals: Product[]
  bestsellers: Product[]
  used_store_items: Product[]
  listings: Listing[]
  board_index: Record<string, Record<string, number>>
  has_sales_data: boolean
}

export type Submission = {
  id: string
  reference: string
  book_title: string
  isbn: string | null
  author: string | null
  publisher: string | null
  board: string | null
  class_level: string | null
  subject: string | null
  condition: string
  expected_price_paise: number | null
  selling_method: string
  status: string
  photos: string[]
  created_at: string
  admin_note?: string | null
  listing_id?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  pickup_address?: string | null
  notes?: string | null
}

export type Quotation = {
  id: string
  reference: string
  organization_name: string
  organization_type: string
  contact_name: string
  contact_email: string
  contact_phone: string
  delivery_location: string
  target_date: string | null
  notes: string | null
  status: string
  quote_notes: string | null
  quote_total_paise: number | null
  quote_valid_until: string | null
  quoted_at: string | null
  accepted_at: string | null
  order_id: string | null
  created_at: string
  items: { id: string; description: string; quantity: number; product_id: string | null; unit_price_paise: number | null; line_total_paise: number | null }[]
}

export type Notification = {
  id: string
  subject: string | null
  body: string
  created_at: string
  is_read: boolean
  related_type: string | null
  related_id: string | null
}
