/** Admin-only payloads mirroring backend/app/routers/admin.py. Amounts are integer paise. */

import type { Order, ReturnRequest, User } from '../types'

export type AdminProduct = {
  id: string
  slug: string
  title: string
  description: string | null
  sku: string | null
  isbn: string | null
  price_paise: number
  compare_at_price_paise: number | null
  cost_paise: number | null
  stock_qty: number
  low_stock_threshold: number
  status: string
  product_type: string
  condition: string
  is_featured: boolean
  is_enquiry_only: boolean
  category_id: string | null
  category: { id: string; name: string; slug: string } | null
  author: string | null
  publisher: string | null
  subject: string | null
  board: string | null
  class_level: string | null
  book_type: string | null
  edition: string | null
  language: string | null
  publication_year: number | null
  academic_year: string | null
  tax_rate_bp: number
  images: { id: string; url: string; alt_text: string }[]
  updated_at: string
  inventory_movements?: { id: string; delta: number; balance_after: number; reason: string; note: string | null; created_at: string }[]
}

export type AdminProductPayload = {
  title: string
  description: string | null
  category_id: string
  sku: string | null
  isbn: string | null
  product_type: 'new' | 'used'
  condition: string
  author: string | null
  publisher: string | null
  subject: string | null
  board: string | null
  class_level: string | null
  book_type: string | null
  edition: string | null
  language: string | null
  publication_year: number | null
  academic_year: string | null
  price_paise: number
  compare_at_price_paise: number | null
  cost_paise: number | null
  tax_rate_bp: number
  stock_qty: number
  low_stock_threshold: number
  status: string
  is_featured: boolean
  is_enquiry_only: boolean
  image_urls: string[]
}

export type AdminCategory = {
  id: string
  slug: string
  name: string
  description: string | null
  image_url: string | null
  sort_order: number
  is_active: boolean
  is_system: boolean
  product_count: number
}

export type AdminOrder = Omit<Order, 'events' | 'returns'> & {
  customer_name: string
  customer_email: string
  customer_phone: string | null
  internal_note: string | null
  coupon_code: string | null
  stock_committed: boolean
  payments: { id: string; method: string; status: string; amount_paise: number; provider: string | null; provider_reference: string | null; failure_reason: string | null; created_at: string }[]
  events: { id: string; type: string; from_status: string | null; to_status: string | null; note: string | null; actor: string; visible: boolean; created_at: string }[]
  next_statuses: string[]
  return_requests: ReturnRequest[]
}

export type AdminListing = {
  id: string
  listing_code: string
  title: string
  condition: string
  condition_notes: string | null
  asking_price_paise: number
  status: string
  seller: { id: string; name: string | null; email: string | null }
  images: { url: string }[]
  created_at: string
  reviewed_at: string | null
  moderation_note: string | null
}

export type AdminSubmission = {
  id: string
  reference: string
  book_title: string
  isbn: string | null
  author: string | null
  condition: string
  expected_price_paise: number | null
  selling_method: string
  status: string
  photos: string[]
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  pickup_address: string | null
  notes: string | null
  admin_note: string | null
  created_at: string
  listing_id: string | null
  user_id: string | null
}

export type AdminQuotation = {
  id: string
  reference: string
  organization_name: string
  organization_type: string
  contact_name: string
  contact_email: string
  contact_phone: string
  delivery_location: string
  target_date: string | null
  status: string
  quote_total_paise: number | null
  quote_valid_until: string | null
  created_at: string
  accepted_at: string | null
  order_id: string | null
  notes: string | null
  quote_notes: string | null
  items: { id: string; description: string; quantity: number; product_id: string | null; unit_price_paise: number | null; line_total_paise: number | null }[]
}

export type AdminCoupon = {
  id: string
  code: string
  description: string | null
  discount_type: 'percent' | 'flat'
  value: number
  min_order_paise: number
  max_discount_paise: number | null
  expires_at: string | null
  usage_limit: number | null
  used_count: number
  per_user_limit: number
  is_active: boolean
}

export type AdminBanner = {
  id: string
  title: string
  subtitle: string | null
  image_url: string | null
  cta_label: string | null
  cta_url: string | null
  theme: string
  sort_order: number
  is_active: boolean
}

export type AdminFaq = {
  id: string
  question: string
  answer: string
  category: string
  sort_order: number
  is_active: boolean
}

export type AdminCustomer = User & { orders_count?: number }

export type AdminReturn = {
  id: string
  reference: string
  order_id: string
  order_number: string | null
  request_type: string
  reason: string
  status: string
  admin_note: string | null
  refund_amount_paise: number | null
  created_at: string
  resolved_at: string | null
}

export type AdminReport = {
  id: string
  listing_id: string
  listing_code: string | null
  listing_title: string | null
  reason: string
  details: string | null
  status: string
  created_at: string
}

export type AdminCommission = {
  id: string
  order_id: string
  order_number: string | null
  seller_id: string
  seller_email: string | null
  gross_paise: number
  commission_rate_bp: number
  commission_paise: number
  seller_proceeds_paise: number
  status: string
  created_at: string
  paid_at: string | null
  payout_id: string | null
}

export type AdminPayout = {
  id: string
  seller_email: string | null
  amount_paise: number
  method: string | null
  reference: string | null
  status: string
  note: string | null
  created_at: string
}

export type AdminAuditEntry = {
  id: string
  actor_email: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  before: unknown
  after: unknown
  created_at: string
}

export type AdminNotification = {
  id: string
  channel: string
  template: string
  recipient: string | null
  subject: string | null
  status: string
  provider: string | null
  error: string | null
  created_at: string
  sent_at: string | null
}

export type AdminMessage = {
  id: string
  name: string
  email: string
  phone: string | null
  subject: string
  message: string
  status: string
  created_at: string
}

export type AdminShipment = {
  id: string
  order_id: string
  order_number: string | null
  status: string
  carrier: string | null
  tracking_number: string | null
  created_at: string
}

export type DashboardPayload = {
  range: string
  metrics: { orders_count: number; gross_paid_paise: number; refunds_paise: number; net_revenue_paise: number; pending_payment_paise: number }
  orders: { by_status: Record<string, number>; total: number; needs_action: number }
  payments: Record<string, { count: number; amount_paise: number }>
  catalogue: { active_products: number; low_stock: number; out_of_stock: number; draft_products: number }
  marketplace: { pending_submissions: number; pending_listings: number; active_listings: number; open_reports: number }
  quotations: { awaiting_quote: number }
  returns: { open: number }
  customers: number
  recent_orders: (Order & { customer_name?: string })[]
  setup: Record<string, boolean>
  definitions: Record<string, string>
}

export type AdminSettingsPayload = {
  settings: Record<string, string | number | boolean | string[] | null>
  schema: Record<string, { group: string; label: string; type: string; public: boolean }>
  capabilities: { online_payments_configured: boolean; email_configured: boolean; environment: string }
}
