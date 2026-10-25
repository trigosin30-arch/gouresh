import { useCallback, useEffect, useState } from 'react'
import { api, uploadImage } from '../api'
import { useStore } from '../context/StoreContext'
import { Field, Modal } from '../components/ui'
import { AdminHeader, Empty, Panel, StatusPill, Tabs, Toggle } from './ui'
import type { AdminBanner, AdminCategory, AdminFaq } from './types'

export default function ContentAdmin() {
  const [tab, setTab] = useState('categories')
  return (
    <div>
      <AdminHeader
        title="Catalogue content"
        description="Categories, home-page banners and FAQs. Everything here is shown on the storefront, so keep it factual."
      />
      <Tabs
        tabs={[
          { id: 'categories', label: 'Categories' },
          { id: 'banners', label: 'Banners' },
          { id: 'faqs', label: 'FAQs' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'categories' && <Categories />}
      {tab === 'banners' && <Banners />}
      {tab === 'faqs' && <Faqs />}
    </div>
  )
}

function Categories() {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AdminCategory | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '', image_url: '', sort_order: '0', is_active: true })
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ categories: AdminCategory[] }>('/api/admin/categories')
      setItems(data.categories)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const body = {
      name: form.name.trim(),
      slug: form.slug.trim() || null,
      description: form.description.trim() || null,
      image_url: form.image_url.trim() || null,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api(`/api/admin/categories/${editing.id}`, { method: 'PUT', body })
        toast('Category updated.')
      } else {
        await api('/api/admin/categories', { method: 'POST', body })
        toast('Category created.')
      }
      setOpen(false)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (category: AdminCategory) => {
    const ok = await confirm({ title: 'Delete category?', message: `${category.name} will be removed. Categories with products cannot be deleted.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await api(`/api/admin/categories/${category.id}`, { method: 'DELETE' })
      toast('Category deleted.')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        {isAdmin && (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setEditing(null)
              setForm({ name: '', slug: '', description: '', image_url: '', sort_order: '0', is_active: true })
              setOpen(true)
            }}
          >
            New category
          </button>
        )}
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading categories…</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Category</th><th>Slug</th><th>Products</th><th>Order</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {items.map((category) => (
              <tr key={category.id}>
                <td>
                  <p className="font-medium text-navy-900">{category.name}</p>
                  {category.description && <p className="text-xs text-slate-500">{category.description}</p>}
                </td>
                <td className="text-xs">{category.slug}</td>
                <td>{category.product_count}</td>
                <td>{category.sort_order}</td>
                <td>
                  <StatusPill status={category.is_active ? 'active' : 'draft'} />
                  {category.is_system && <span className="badge-muted ml-1">system</span>}
                </td>
                <td>
                  <div className="flex gap-2 text-xs">
                    {isAdmin && !category.is_system && (
                      <>
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            setEditing(category)
                            setForm({
                              name: category.name,
                              slug: category.slug,
                              description: category.description || '',
                              image_url: category.image_url || '',
                              sort_order: String(category.sort_order),
                              is_active: category.is_active,
                            })
                            setOpen(true)
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="text-red-700 hover:underline" onClick={() => void remove(category)}>Delete</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && items.length === 0 && <Empty title="No categories yet" hint="Products need a category before they can be created." />}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New category'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="category-form" className="btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        <form id="category-form" onSubmit={save} className="space-y-3">
          <Field label="Name" required>
            <input className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Slug" hint="Used in URLs. Leave blank to generate it from the name.">
            <input className="input" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} />
          </Field>
          <Field label="Description">
            <textarea className="input" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <Field label="Image URL" hint="Upload a photo or paste an https URL.">
            <input className="input" value={form.image_url} onChange={(event) => setForm({ ...form, image_url: event.target.value })} />
          </Field>
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setUploading(true)
                try {
                  const result = await uploadImage(file, '/api/uploads/product-photo')
                  setForm((current) => ({ ...current, image_url: result.url }))
                  toast('Image uploaded.')
                } catch (err) {
                  toast((err as Error).message, 'error')
                } finally {
                  setUploading(false)
                  event.target.value = ''
                }
              }}
            />
            {uploading && <span>Uploading…</span>}
          </label>
          <Field label="Sort order" hint="Lower numbers appear first.">
            <input className="input" type="number" min={0} value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
          </Field>
          <Toggle checked={form.is_active} onChange={(value) => setForm({ ...form, is_active: value })} label="Visible on the storefront" />
        </form>
      </Modal>
    </div>
  )
}

function Banners() {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AdminBanner | null>(null)
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    image_url: '',
    cta_label: '',
    cta_url: '',
    theme: 'navy',
    sort_order: '0',
    is_active: true,
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ banners: AdminBanner[] }>('/api/admin/banners')
      setItems(data.banners)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const body = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      image_url: form.image_url.trim() || null,
      cta_label: form.cta_label.trim() || null,
      cta_url: form.cta_url.trim() || null,
      theme: form.theme,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api(`/api/admin/banners/${editing.id}`, { method: 'PUT', body })
        toast('Banner updated.')
      } else {
        await api('/api/admin/banners', { method: 'POST', body })
        toast('Banner created.')
      }
      setOpen(false)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (banner: AdminBanner) => {
    const ok = await confirm({ title: 'Delete banner?', message: `“${banner.title}” will be removed from the home page.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await api(`/api/admin/banners/${banner.id}`, { method: 'DELETE' })
      toast('Banner deleted.')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        {isAdmin && (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setEditing(null)
              setForm({ title: '', subtitle: '', image_url: '', cta_label: '', cta_url: '', theme: 'navy', sort_order: '0', is_active: true })
              setOpen(true)
            }}
          >
            New banner
          </button>
        )}
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading banners…</p>}
      {!loading && items.length === 0 && <Empty title="No banners" hint="Without banners the home page shows the default hero section." />}

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((banner) => (
          <Panel key={banner.id} title={banner.title} description={banner.subtitle || undefined} actions={<StatusPill status={banner.is_active ? 'active' : 'draft'} />}>
            {banner.image_url && <img src={banner.image_url} alt="" className="mb-2 h-28 w-full rounded object-cover" />}
            <dl className="space-y-1 text-xs text-slate-600">
              <div><dt className="inline text-slate-500">CTA: </dt><dd className="inline">{banner.cta_label || '—'} {banner.cta_url ? `→ ${banner.cta_url}` : ''}</dd></div>
              <div><dt className="inline text-slate-500">Theme: </dt><dd className="inline">{banner.theme}</dd></div>
              <div><dt className="inline text-slate-500">Order: </dt><dd className="inline">{banner.sort_order}</dd></div>
            </dl>
            {isAdmin && (
              <div className="mt-2 flex gap-3 text-xs">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setEditing(banner)
                    setForm({
                      title: banner.title,
                      subtitle: banner.subtitle || '',
                      image_url: banner.image_url || '',
                      cta_label: banner.cta_label || '',
                      cta_url: banner.cta_url || '',
                      theme: banner.theme,
                      sort_order: String(banner.sort_order),
                      is_active: banner.is_active,
                    })
                    setOpen(true)
                  }}
                >
                  Edit
                </button>
                <button type="button" className="text-red-700 hover:underline" onClick={() => void remove(banner)}>Delete</button>
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit banner' : 'New banner'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="banner-form" className="btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        <form id="banner-form" onSubmit={save} className="space-y-3">
          <Field label="Title" required hint="Keep promotional wording accurate — do not advertise discounts you are not actually running.">
            <input className="input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="Subtitle">
            <input className="input" value={form.subtitle} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} />
          </Field>
          <Field label="Image URL">
            <input className="input" value={form.image_url} onChange={(event) => setForm({ ...form, image_url: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Button label">
              <input className="input" value={form.cta_label} onChange={(event) => setForm({ ...form, cta_label: event.target.value })} />
            </Field>
            <Field label="Button link" hint="Internal path like /products?sale=1, or an https URL.">
              <input className="input" value={form.cta_url} onChange={(event) => setForm({ ...form, cta_url: event.target.value })} />
            </Field>
            <Field label="Theme">
              <select className="input" value={form.theme} onChange={(event) => setForm({ ...form, theme: event.target.value })}>
                <option value="navy">Navy</option>
                <option value="orange">Orange accent</option>
                <option value="light">Light</option>
              </select>
            </Field>
            <Field label="Sort order">
              <input className="input" type="number" min={0} value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
            </Field>
          </div>
          <Toggle checked={form.is_active} onChange={(value) => setForm({ ...form, is_active: value })} label="Show on the home page" />
        </form>
      </Modal>
    </div>
  )
}

function Faqs() {
  const { user, toast, confirm } = useStore()
  const isAdmin = user?.role === 'admin'
  const [items, setItems] = useState<AdminFaq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AdminFaq | null>(null)
  const [form, setForm] = useState({ question: '', answer: '', category: 'General', sort_order: '0', is_active: true })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ faqs: AdminFaq[] }>('/api/admin/faqs')
      setItems(data.faqs)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const body = {
      question: form.question.trim(),
      answer: form.answer.trim(),
      category: form.category.trim() || 'General',
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api(`/api/admin/faqs/${editing.id}`, { method: 'PUT', body })
        toast('FAQ updated.')
      } else {
        await api('/api/admin/faqs', { method: 'POST', body })
        toast('FAQ created.')
      }
      setOpen(false)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (faq: AdminFaq) => {
    const ok = await confirm({ title: 'Delete FAQ?', message: 'This question will disappear from the public FAQ page.', confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await api(`/api/admin/faqs/${faq.id}`, { method: 'DELETE' })
      toast('FAQ deleted.')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        {isAdmin && (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              setEditing(null)
              setForm({ question: '', answer: '', category: 'General', sort_order: '0', is_active: true })
              setOpen(true)
            }}
          >
            New FAQ
          </button>
        )}
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading FAQs…</p>}
      {!loading && items.length === 0 && <Empty title="No FAQs published" hint="Customers see an honest “no FAQs published” message until you add some." />}

      <div className="space-y-2">
        {items.map((faq) => (
          <Panel key={faq.id} title={faq.question} description={`${faq.category} · order ${faq.sort_order}`} actions={<StatusPill status={faq.is_active ? 'active' : 'draft'} />}>
            <p className="whitespace-pre-line text-sm text-slate-600">{faq.answer}</p>
            {isAdmin && (
              <div className="mt-2 flex gap-3 text-xs">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setEditing(faq)
                    setForm({ question: faq.question, answer: faq.answer, category: faq.category, sort_order: String(faq.sort_order), is_active: faq.is_active })
                    setOpen(true)
                  }}
                >
                  Edit
                </button>
                <button type="button" className="text-red-700 hover:underline" onClick={() => void remove(faq)}>Delete</button>
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit FAQ' : 'New FAQ'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="faq-form" className="btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        <form id="faq-form" onSubmit={save} className="space-y-3">
          <Field label="Question" required>
            <input className="input" required value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} />
          </Field>
          <Field label="Answer" required hint="Answer only with verified store policy. Do not promise timelines or services you cannot guarantee.">
            <textarea className="input" rows={5} required value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <input className="input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
            </Field>
            <Field label="Sort order">
              <input className="input" type="number" min={0} value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
            </Field>
          </div>
          <Toggle checked={form.is_active} onChange={(value) => setForm({ ...form, is_active: value })} label="Show on the FAQ page" />
        </form>
      </Modal>
    </div>
  )
}
