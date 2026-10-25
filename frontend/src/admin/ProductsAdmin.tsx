import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, uploadImage } from '../api'
import { money } from '../format'
import { useStore } from '../context/StoreContext'
import { Field, Modal, Pagination } from '../components/ui'
import { AdminHeader, Empty, MoneyInput, Panel, StatusPill, Toggle, toPaise, toRupees } from './ui'
import type { AdminCategory, AdminProduct, AdminProductPayload } from './types'

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'good', label: 'Good' },
  { value: 'acceptable', label: 'Acceptable' },
]
const BOARDS = ['CBSE', 'ICSE/ISC', 'PSEB', 'Other State Board', 'University', 'Other']
const BOOK_TYPES = ['textbook', 'reference', 'guide', 'workbook', 'question_bank', 'other']
const STATUSES = ['draft', 'active', 'archived']

const blank = {
  title: '',
  description: '',
  category_id: '',
  sku: '',
  isbn: '',
  product_type: 'new' as 'new' | 'used',
  condition: 'new',
  author: '',
  publisher: '',
  subject: '',
  board: '',
  class_level: '',
  book_type: '',
  edition: '',
  language: '',
  publication_year: '',
  academic_year: '',
  price: '',
  compare_at: '',
  cost: '',
  tax_rate: '0',
  stock_qty: '0',
  low_stock_threshold: '5',
  status: 'draft',
  is_featured: false,
  is_enquiry_only: false,
  images: [] as string[],
}

type FormState = typeof blank

export default function ProductsAdmin() {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminProduct[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [lowStock, setLowStock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminProduct | null>(null)
  const [form, setForm] = useState<FormState>(blank)
  const [busy, setBusy] = useState(false)
  const [stockTarget, setStockTarget] = useState<AdminProduct | null>(null)
  const [stockDelta, setStockDelta] = useState('')
  const [stockNote, setStockNote] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ dry_run: boolean; created: number; updated: number; committed: boolean; errors: { row: number; error: string }[] } | null>(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '20' })
      if (q.trim()) params.set('q', q.trim())
      if (status) params.set('status', status)
      if (lowStock) params.set('low_stock', 'true')
      const data = await api<{ items: AdminProduct[]; total: number; pages: number }>(`/api/admin/products?${params}`)
      setItems(data.items)
      setTotal(data.total)
      setPages(data.pages)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, q, status, lowStock])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api<{ categories: AdminCategory[] }>('/api/admin/categories')
      .then((data) => setCategories(data.categories))
      .catch(() => setCategories([]))
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...blank, category_id: categories[0]?.id || '' })
    setFormOpen(true)
  }

  const openEdit = async (product: AdminProduct) => {
    setEditing(product)
    setForm({
      title: product.title,
      description: product.description || '',
      category_id: product.category_id || '',
      sku: product.sku || '',
      isbn: product.isbn || '',
      product_type: product.product_type === 'used' ? 'used' : 'new',
      condition: product.condition,
      author: product.author || '',
      publisher: product.publisher || '',
      subject: product.subject || '',
      board: product.board || '',
      class_level: product.class_level || '',
      book_type: product.book_type || '',
      edition: product.edition || '',
      language: product.language || '',
      publication_year: product.publication_year ? String(product.publication_year) : '',
      academic_year: product.academic_year || '',
      price: toRupees(product.price_paise),
      compare_at: toRupees(product.compare_at_price_paise),
      cost: toRupees(product.cost_paise),
      tax_rate: String(product.tax_rate_bp),
      stock_qty: String(product.stock_qty),
      low_stock_threshold: String(product.low_stock_threshold),
      status: product.status,
      is_featured: product.is_featured,
      is_enquiry_only: product.is_enquiry_only,
      images: product.images.map((image) => image.url),
    })
    setFormOpen(true)
  }

  const payload = (): AdminProductPayload => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    category_id: form.category_id,
    sku: form.sku.trim() || null,
    isbn: form.isbn.trim() || null,
    product_type: form.product_type,
    condition: form.condition,
    author: form.author.trim() || null,
    publisher: form.publisher.trim() || null,
    subject: form.subject.trim() || null,
    board: form.board || null,
    class_level: form.class_level.trim() || null,
    book_type: form.book_type || null,
    edition: form.edition.trim() || null,
    language: form.language.trim() || null,
    publication_year: form.publication_year ? Number(form.publication_year) : null,
    academic_year: form.academic_year.trim() || null,
    price_paise: toPaise(form.price),
    compare_at_price_paise: form.compare_at ? toPaise(form.compare_at) : null,
    cost_paise: form.cost ? toPaise(form.cost) : null,
    tax_rate_bp: Number(form.tax_rate || 0),
    stock_qty: Number(form.stock_qty || 0),
    low_stock_threshold: Number(form.low_stock_threshold || 0),
    status: form.status,
    is_featured: form.is_featured,
    is_enquiry_only: form.is_enquiry_only,
    image_urls: form.images,
  })

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      if (editing) {
        await api(`/api/admin/products/${editing.id}`, { method: 'PUT', body: payload() })
        toast('Product updated.')
      } else {
        await api('/api/admin/products', { method: 'POST', body: payload() })
        toast('Product created.')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const adjustStock = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!stockTarget) return
    const delta = Number(stockDelta)
    if (!Number.isInteger(delta) || delta === 0) {
      toast('Enter a non-zero whole number.', 'error')
      return
    }
    setBusy(true)
    try {
      await api(`/api/admin/products/${stockTarget.id}/stock`, { method: 'POST', body: { delta, note: stockNote || 'Manual adjustment' } })
      toast('Stock adjusted.')
      setStockTarget(null)
      setStockDelta('')
      setStockNote('')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (product: AdminProduct) => {
    const ok = await confirm({
      title: 'Delete this product?',
      message: `“${product.title}” will be removed. Products that appear in past orders are archived instead of deleted so order history stays correct.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      const result = await api<{ archived?: boolean; message?: string }>(`/api/admin/products/${product.id}`, { method: 'DELETE' })
      toast(result.message || 'Product deleted.')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const uploadPhoto = async (file: File) => {
    setUploading(true)
    try {
      const result = await uploadImage(file, '/api/uploads/product-photo')
      setForm((current) => ({ ...current, images: [...current.images, result.url] }))
      toast('Photo uploaded.')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const runImport = async (dryRun: boolean) => {
    if (!importFile) return
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', importFile)
      const result = await api<{ dry_run: boolean; created: number; updated: number; committed: boolean; errors: { row: number; error: string }[] }>(
        `/api/admin/products/import?dry_run=${dryRun}`,
        { method: 'POST', body },
      )
      setImportResult(result)
      if (!dryRun) {
        toast(`Import committed: ${result.created} created, ${result.updated} updated.`)
        await load()
      }
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <AdminHeader
        title="Products"
        description="Catalogue, prices and stock. Stock changes are recorded as inventory movements; order history is never rewritten."
        actions={
          <>
            <a href="/api/admin/products/export" className="btn-secondary btn-sm">Export CSV</a>
            {isAdmin && (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setImportOpen(true)}>Import CSV</button>
                <button type="button" className="btn-primary btn-sm" onClick={openCreate}>New product</button>
              </>
            )}
          </>
        }
      />

      {!isAdmin && (
        <p className="mb-3 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-900">
          Your account has staff access. You can adjust stock, but creating, editing and deleting products requires an administrator.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1">
          <span className="label">Search</span>
          <input
            className="input"
            placeholder="Title, SKU, ISBN or author"
            value={q}
            onChange={(event) => {
              setPage(1)
              setQ(event.target.value)
            }}
          />
        </label>
        <label>
          <span className="label">Status</span>
          <select
            className="input"
            value={status}
            onChange={(event) => {
              setPage(1)
              setStatus(event.target.value)
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={lowStock}
            onChange={(event) => {
              setPage(1)
              setLowStock(event.target.checked)
            }}
          />
          Low stock only
        </label>
        <span className="pb-2.5 text-xs text-slate-500">{total} products</span>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-slate-500">Loading products…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6">
                  <Empty title="No products match" hint="Try clearing the search or status filter." />
                </td>
              </tr>
            )}
            {items.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="flex items-center gap-2">
                    {product.images[0] ? (
                      <img src={product.images[0].url} alt="" className="h-10 w-8 rounded object-cover" />
                    ) : (
                      <span className="flex h-10 w-8 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">—</span>
                    )}
                    <div>
                      <p className="font-medium text-navy-900">{product.title}</p>
                      <p className="text-xs text-slate-500">
                        {product.product_type} · {product.condition}
                        {product.isbn ? ` · ISBN ${product.isbn}` : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="text-xs">{product.category?.name || '—'}</td>
                <td>
                  <span className="font-medium">{money(product.price_paise)}</span>
                  {product.compare_at_price_paise ? (
                    <span className="block text-xs text-slate-400 line-through">{money(product.compare_at_price_paise)}</span>
                  ) : null}
                </td>
                <td>
                  <span className={product.stock_qty <= 0 ? 'font-semibold text-red-700' : product.stock_qty <= product.low_stock_threshold ? 'font-semibold text-amber-700' : ''}>
                    {product.stock_qty}
                  </span>
                  {product.is_enquiry_only && <span className="badge-muted ml-1">enquiry</span>}
                </td>
                <td><StatusPill status={product.status} /></td>
                <td>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Link to={`/product/${product.slug}`} className="link" target="_blank" rel="noreferrer">View</Link>
                    {isAdmin && (
                      <button type="button" className="link" onClick={() => void openEdit(product)}>Edit</button>
                    )}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setStockTarget(product)
                        setStockDelta('')
                        setStockNote('')
                      }}
                    >
                      Stock
                    </button>
                    {isAdmin && (
                      <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void remove(product)}>Delete</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <Pagination page={page} pages={pages} onChange={setPage} />
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.title}` : 'New product'}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" form="product-form" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
            </button>
          </>
        }
      >
        <form id="product-form" onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" required>
              <input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Category" required>
              <select className="input" required value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Product type" required>
              <select
                className="input"
                value={form.product_type}
                onChange={(e) => {
                  const type = e.target.value as 'new' | 'used'
                  setForm({ ...form, product_type: type, condition: type === 'new' ? 'new' : form.condition === 'new' ? 'good' : form.condition })
                }}
              >
                <option value="new">New</option>
                <option value="used">Second-hand (store stock)</option>
              </select>
            </Field>
            <Field label="Condition" required>
              <select className="input" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                {CONDITIONS.filter((option) => (form.product_type === 'new' ? option.value === 'new' : option.value !== 'new')).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <MoneyInput label="Selling price" value={form.price} onChange={(value) => setForm({ ...form, price: value })} required />
            <MoneyInput label="Compare-at price" value={form.compare_at} onChange={(value) => setForm({ ...form, compare_at: value })} hint="Optional. Must be at least the selling price." />
            <MoneyInput label="Cost price" value={form.cost} onChange={(value) => setForm({ ...form, cost: value })} hint="Internal only, never shown to customers." />
            <Field label="Status" required>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="draft">Draft (hidden)</option>
                <option value="active">Active (on sale)</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Stock quantity" required hint={editing ? 'Changing this records an inventory movement.' : 'Initial stock.'}>
              <input className="input" type="number" min={0} required value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} />
            </Field>
            <Field label="Low-stock threshold">
              <input className="input" type="number" min={0} value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
            </Field>
            <Field label="SKU">
              <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </Field>
            <Field label="Tax rate (basis points)" hint="0 unless the store is registered for tax on this item.">
              <input className="input" type="number" min={0} max={10000} value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Author">
              <input className="input" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </Field>
            <Field label="Publisher">
              <input className="input" value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} />
            </Field>
            <Field label="ISBN">
              <input className="input" value={form.isbn} onChange={(e) => setForm({ ...form, isbn: e.target.value })} />
            </Field>
            <Field label="Board">
              <select className="input" value={form.board} onChange={(e) => setForm({ ...form, board: e.target.value })}>
                <option value="">Not applicable</option>
                {BOARDS.map((board) => (
                  <option key={board} value={board}>{board}</option>
                ))}
              </select>
            </Field>
            <Field label="Class / level">
              <input className="input" value={form.class_level} onChange={(e) => setForm({ ...form, class_level: e.target.value })} />
            </Field>
            <Field label="Subject">
              <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
            <Field label="Book type">
              <select className="input" value={form.book_type} onChange={(e) => setForm({ ...form, book_type: e.target.value })}>
                <option value="">Not a book</option>
                {BOOK_TYPES.map((type) => (
                  <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="Edition">
              <input className="input" value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })} />
            </Field>
            <Field label="Language">
              <input className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            </Field>
            <Field label="Publication year">
              <input className="input" type="number" min={1900} max={2100} value={form.publication_year} onChange={(e) => setForm({ ...form, publication_year: e.target.value })} />
            </Field>
            <Field label="Academic year">
              <input className="input" value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} placeholder="2026-27" />
            </Field>
          </div>

          <Field label="Description">
            <textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          <div className="space-y-2">
            <Toggle checked={form.is_featured} onChange={(value) => setForm({ ...form, is_featured: value })} label="Feature on the home page" hint="Only feature items that genuinely matter this week." />
            <Toggle
              checked={form.is_enquiry_only}
              onChange={(value) => setForm({ ...form, is_enquiry_only: value })}
              label="Enquiry only (not purchasable online)"
              hint="For items that must be sourced or discussed. The product stays visible but cannot be added to the cart."
            />
          </div>

          <div>
            <span className="label">Photos</span>
            <div className="flex flex-wrap gap-2">
              {form.images.map((url) => (
                <div key={url} className="relative">
                  <img src={url} alt="" className="h-20 w-16 rounded border border-slate-200 object-cover" />
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white"
                    onClick={() => setForm({ ...form, images: form.images.filter((item) => item !== url) })}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
              <label className="flex h-20 w-16 cursor-pointer flex-col items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-500">
                <span>{uploading ? '…' : 'Add'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadPhoto(file)
                    event.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500">JPEG, PNG or WebP. Images are re-encoded on the server to strip metadata.</p>
          </div>
        </form>
      </Modal>

      <Modal
        open={stockTarget !== null}
        onClose={() => setStockTarget(null)}
        title={stockTarget ? `Adjust stock · ${stockTarget.title}` : 'Adjust stock'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setStockTarget(null)}>Cancel</button>
            <button type="submit" form="stock-form" className="btn-primary" disabled={busy}>Apply adjustment</button>
          </>
        }
      >
        {stockTarget && (
          <form id="stock-form" onSubmit={adjustStock} className="space-y-3">
            <p className="text-sm text-slate-600">
              Current stock: <strong>{stockTarget.stock_qty}</strong>. Use a positive number to add stock and a negative number to remove it.
            </p>
            <Field label="Adjustment" required>
              <input className="input" type="number" required value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} placeholder="e.g. 12 or -3" />
            </Field>
            <Field label="Reason">
              <input className="input" value={stockNote} onChange={(event) => setStockNote(event.target.value)} placeholder="New delivery, damage, stock count…" />
            </Field>
            <p className="text-xs text-slate-500">Removing more than the available stock is refused by the server.</p>
          </form>
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import products from CSV"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>Close</button>
            <button type="button" className="btn-secondary" onClick={() => void runImport(true)} disabled={!importFile || busy}>Validate (dry run)</button>
            <button type="button" className="btn-primary" onClick={() => void runImport(false)} disabled={!importFile || busy || !importResult?.dry_run}>
              Commit import
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Required columns: <code>title</code>, <code>category</code> (slug), <code>price_rupees</code>, <code>stock</code>. Optional:
            sku, isbn, compare_at_rupees, cost_rupees, status, product_type, condition, author, publisher, board, class_level, subject,
            book_type, edition, language, description. Rows match on SKU, then on title within the category.
          </p>
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Always run the dry run first. Nothing is written until you commit.</p>
          <input
            type="file"
            accept="text/csv"
            onChange={(event) => {
              setImportFile(event.target.files?.[0] || null)
              setImportResult(null)
            }}
            className="block w-full text-sm"
          />
          {importResult && (
            <div className="rounded border border-slate-200 p-3 text-xs">
              <p className="font-medium text-navy-900">
                {importResult.dry_run ? 'Validation result (nothing saved)' : 'Import committed'}
              </p>
              <p className="mt-1">{importResult.created} created · {importResult.updated} updated · {importResult.errors.length} errors</p>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-red-700">
                  {importResult.errors.map((item, index) => (
                    <li key={index}>Row {item.row}: {item.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
