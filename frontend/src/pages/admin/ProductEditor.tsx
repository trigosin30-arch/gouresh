import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { useToast } from '../../lib/toast'
import { parseRupeesToPaise, rupees } from '../../lib/format'
import type { Category, Product } from '../../lib/types'
import { Field, Loading } from '../../components/ui'
import { IconArrow } from '../../components/Icons'

interface Draft {
  name: string
  sku: string
  category_id: string
  price: string
  mrp: string
  stock: string
  unit: string
  brand: string
  isbn: string
  author: string
  class_level: string
  board: string
  condition: 'new' | 'refurbished' | 'used'
  tags: string
  image_url: string
  description: string
  is_featured: boolean
}

const BLANK: Draft = {
  name: '',
  sku: '',
  category_id: '',
  price: '',
  mrp: '',
  stock: '0',
  unit: 'each',
  brand: '',
  isbn: '',
  author: '',
  class_level: '',
  board: '',
  condition: 'new',
  tags: '',
  image_url: '',
  description: '',
  is_featured: false,
}

export default function ProductEditor() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const categories = useApi<{ items: Category[] }>('/categories')
  const [draft, setDraft] = useState<Draft>(BLANK)
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [movements, setMovements] = useState<{ id: string; delta: number; reason: string; note: string | null; created_at: string }[]>([])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .get<{ items: Product[]; total: number }>(`/admin/products?page_size=100`)
      .then((data) => {
        const product = data.items.find((item) => item.id === id)
        if (!product) {
          setError('Product not found')
          return
        }
        setDraft({
          name: product.name,
          sku: product.sku,
          category_id: product.category_id ?? '',
          price: String(product.price_paise / 100),
          mrp: product.mrp_paise ? String(product.mrp_paise / 100) : '',
          stock: String(product.stock),
          unit: product.unit,
          brand: product.brand ?? '',
          isbn: product.isbn ?? '',
          author: product.author ?? '',
          class_level: product.class_level ?? '',
          board: product.board ?? '',
          condition: product.condition,
          tags: product.tags.join(', '),
          image_url: product.image_url ?? '',
          description: product.description,
          is_featured: product.is_featured,
        })
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load product'))
      .finally(() => setLoading(false))
    api
      .get<{ items: typeof movements }>(`/admin/products/${id}/movements`)
      .then((data) => setMovements(data.items))
      .catch(() => setMovements([]))
  }, [id])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const price = parseRupeesToPaise(draft.price)
    const mrp = draft.mrp ? parseRupeesToPaise(draft.mrp) : null
    if (!draft.name.trim() || draft.name.trim().length < 2) return setError('Enter a product name')
    if (!draft.sku.trim()) return setError('Enter a SKU')
    if (!price || price <= 0) return setError('Enter a selling price above zero')

    const payload = {
      name: draft.name.trim(),
      sku: draft.sku.trim().toUpperCase(),
      category_id: draft.category_id || null,
      price_paise: price,
      mrp_paise: mrp,
      stock: Number(draft.stock) || 0,
      unit: draft.unit || 'each',
      brand: draft.brand.trim() || null,
      isbn: draft.isbn.trim() || null,
      author: draft.author.trim() || null,
      class_level: draft.class_level.trim() || null,
      board: draft.board.trim() || null,
      condition: draft.condition,
      tags: draft.tags,
      image_url: draft.image_url.trim() || null,
      description: draft.description,
      is_featured: draft.is_featured,
    }

    setSaving(true)
    try {
      if (editing) {
        await api.patch(`/admin/products/${id}`, payload)
        toast.push('Product updated', 'success')
      } else {
        await api.post('/admin/products', payload)
        toast.push('Product created', 'success')
      }
      navigate('/admin/products')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save product')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading label="Loading product" />

  return (
    <>
      <div className="section-head">
        <div>
          <Link to="/admin/products" className="btn-link small">
            ← Back to products
          </Link>
          <h2 style={{ marginTop: 6, marginBottom: 4 }}>{editing ? 'Edit product' : 'New product'}</h2>
          <p className="small muted">Changes go live on the storefront immediately.</p>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <div className="card-body form-grid">
          <Field label="Product name" htmlFor="p-name" className="span-2">
            <input id="p-name" className="input" value={draft.name} onChange={(event) => set('name', event.target.value)} required />
          </Field>
          <Field label="SKU" htmlFor="p-sku" hint="Unique stock keeping unit">
            <input id="p-sku" className="input" value={draft.sku} onChange={(event) => set('sku', event.target.value)} required />
          </Field>
          <Field label="Category" htmlFor="p-category">
            <select id="p-category" className="select" value={draft.category_id} onChange={(event) => set('category_id', event.target.value)}>
              <option value="">Uncategorised</option>
              {categories.data?.items.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Selling price (₹)" htmlFor="p-price">
            <input id="p-price" className="input" inputMode="decimal" value={draft.price} onChange={(event) => set('price', event.target.value)} required />
          </Field>
          <Field label="MRP (₹, optional)" htmlFor="p-mrp">
            <input id="p-mrp" className="input" inputMode="decimal" value={draft.mrp} onChange={(event) => set('mrp', event.target.value)} />
          </Field>
          <Field label="Stock on hand" htmlFor="p-stock" hint={editing ? 'Editing stock here is logged as an admin change' : undefined}>
            <input id="p-stock" className="input" inputMode="numeric" value={draft.stock} onChange={(event) => set('stock', event.target.value)} />
          </Field>
          <Field label="Sold as" htmlFor="p-unit">
            <input id="p-unit" className="input" value={draft.unit} onChange={(event) => set('unit', event.target.value)} placeholder="each / pack of 6 / set" />
          </Field>
          <Field label="Brand" htmlFor="p-brand">
            <input id="p-brand" className="input" value={draft.brand} onChange={(event) => set('brand', event.target.value)} />
          </Field>
          <Field label="Condition" htmlFor="p-condition">
            <select id="p-condition" className="select" value={draft.condition} onChange={(event) => set('condition', event.target.value as Draft['condition'])}>
              <option value="new">New</option>
              <option value="refurbished">Refurbished</option>
              <option value="used">Second-hand</option>
            </select>
          </Field>
          <Field label="ISBN" htmlFor="p-isbn" hint="Powers ISBN search">
            <input id="p-isbn" className="input" value={draft.isbn} onChange={(event) => set('isbn', event.target.value)} />
          </Field>
          <Field label="Author" htmlFor="p-author">
            <input id="p-author" className="input" value={draft.author} onChange={(event) => set('author', event.target.value)} />
          </Field>
          <Field label="Class" htmlFor="p-class">
            <input id="p-class" className="input" placeholder="Class 10" value={draft.class_level} onChange={(event) => set('class_level', event.target.value)} />
          </Field>
          <Field label="Board" htmlFor="p-board">
            <input id="p-board" className="input" placeholder="CBSE / HP Board" value={draft.board} onChange={(event) => set('board', event.target.value)} />
          </Field>
          <Field label="Tags" htmlFor="p-tags" hint="Comma separated, used by search">
            <input id="p-tags" className="input" value={draft.tags} onChange={(event) => set('tags', event.target.value)} />
          </Field>
          <Field label="Image URL (optional)" htmlFor="p-image" hint="Leave blank to use generated artwork">
            <input id="p-image" className="input" value={draft.image_url} onChange={(event) => set('image_url', event.target.value)} />
          </Field>
          <Field label="Description" htmlFor="p-description" className="span-2">
            <textarea id="p-description" className="textarea" value={draft.description} onChange={(event) => set('description', event.target.value)} />
          </Field>
          <label className="checkbox span-2">
            <input type="checkbox" checked={draft.is_featured} onChange={(event) => set('is_featured', event.target.checked)} />
            Show in the “Featured this week” section on the homepage
          </label>

          {error ? <div className="notice notice-danger span-2">{error}</div> : null}

          <div className="span-2 row" style={{ gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'} <IconArrow size={15} />
            </button>
            <Link to="/admin/products" className="btn btn-ghost">
              Cancel
            </Link>
            {editing && draft.price ? (
              <span className="small muted">Customer price: {rupees(parseRupeesToPaise(draft.price) ?? 0)}</span>
            ) : null}
          </div>
        </div>
      </form>

      {editing ? (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="card-head">
            <h3>Inventory history</h3>
            <span className="small muted">Last {movements.length} movements</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Reason</th>
                  <th>Note</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className={movement.delta < 0 ? 'stock-out' : 'stock-low'}>
                      {movement.delta > 0 ? '+' : ''}
                      {movement.delta}
                    </td>
                    <td className="small">{movement.reason.replace(/_/g, ' ')}</td>
                    <td className="small muted">{movement.note ?? '—'}</td>
                    <td className="small muted">{new Date(movement.created_at).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
