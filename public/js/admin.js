'use strict';
/* Admin Control Centre — separate layout, server-enforced RBAC (hiding links is UX only). */
const hasP = p => (S.user?.perms || []).includes(p);
const ADM_NAV = [['', '📊 Overview', null], ['products', '📦 Products', 'catalog'], ['inventory', '🧮 Inventory', 'inventory'],
 ['suppliers', '🚚 Suppliers & POs', 'suppliers'], ['orders', '🧾 Orders', 'orders'], ['customers', '👥 Customers', 'customers'],
 ['marketplace', '♻️ Marketplace', 'marketplace'], ['settlements', '💰 Settlements & Commission', 'finance'],
 ['promotions', '🏷️ Promotions', 'promotions'], ['support', '🎧 Support & Reviews', 'support'],
 ['catalog', '🗂️ Categories & Academic Meta', 'catalog'], ['reports', '📈 Reports', 'reports'],
 ['staff', '🧑‍🤝‍🧑 Staff & Roles', 'staff'], ['settings', '⚙️ Store Settings', 'settings'], ['audit', '🛡️ Audit Log', 'reports']];
function admShell(active, html) {
  app.innerHTML = `<h1 style="margin:4px 0 14px">⚙️ Admin Control Centre <span class="tag">${esc(S.user.role)}</span></h1>
  <div class="adm-layout"><nav class="adm-nav">${ADM_NAV.filter(([, , p]) => !p || hasP(p) || (p === 'orders' && hasP('orders_view')))
    .map(([k, l]) => `<a class="${active === k ? 'on' : ''}" href="#/admin${k ? '/' + k : ''}">${l}</a>`).join('')}
   <a href="#/">← Back to Store</a></nav><div>${html}</div></div>`;
}
window.renderAdmin = async (seg, params) => {
  if (!S.user) { location.hash = '#/login'; return router(); }
  if (S.user.role === 'customer') { app.innerHTML = '<div class="empty"><h1>🔒 Staff only</h1><p>Your account does not have admin access.</p></div>'; return; }
  const page = seg[0] || '';
  try {
    if (page === '') return admOverview();
    if (page === 'products') return admProducts(params);
    if (page === 'inventory') return admInventory();
    if (page === 'suppliers') return admSuppliers();
    if (page === 'orders') return seg[1] ? admOrderDetail(seg[1]) : admOrders(params);
    if (page === 'customers') return admCustomers();
    if (page === 'marketplace') return admMarketplace();
    if (page === 'settlements') return admSettlements();
    if (page === 'promotions') return admPromotions();
    if (page === 'support') return admSupport();
    if (page === 'catalog') return admCatalog();
    if (page === 'reports') return admReports();
    if (page === 'staff') return admStaff();
    if (page === 'settings') return admSettings();
    if (page === 'audit') return admAudit();
    admShell('', '<div class="empty">Admin page not found.</div>');
  } catch (e) { admShell(page, `<div class="alert bad">${esc(e.message)}</div>`); }
};
async function admOverview() {
  const from = sessionStorage.getItem('adm_from') || '', to = sessionStorage.getItem('adm_to') || '';
  const d = await api(`/api/admin/overview?from=${from}&to=${to}`);
  const max = Math.max(1, ...d.daily.map(x => x.total));
  admShell('', `
  <form class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:16px" onsubmit="event.preventDefault();sessionStorage.setItem('adm_from',document.getElementById('ov_from').value);sessionStorage.setItem('adm_to',document.getElementById('ov_to').value);renderAdmin([],{});">
   <div><label class="f">From</label><input type="date" id="ov_from" value="${from}"></div><div><label class="f">To</label><input type="date" id="ov_to" value="${to}"></div>
   <button class="btn pri">Apply Date Range</button><span class="small mut">All figures below come live from the database. A new store honestly shows zeros.</span></form>
  <div class="kpis">
   ${[['Orders today', d.orders_today], ['Orders (period)', d.orders_period], ['Gross order value*', inr(d.gross_paise)], ['Store sales', inr(d.store_sales_paise)],
      ['Marketplace gross (sellers’ sales)', inr(d.marketplace_gross_paise)], ['Marketplace commission earned', inr(d.commission_paise)],
      ['Open orders', d.pending_orders], ['Low stock', d.low_stock], ['Out of stock', d.out_stock], ['Customers', d.customers],
      ['Open enquiries', d.open_enquiries], ['Listings to review', d.pending_listings], ['Seller payouts pending', inr(d.pending_settlements_paise)], ['Return requests', d.open_returns]]
      .map(([k, v]) => `<div class="kpi"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
  <p class="small mut">*Gross order value = total payable of non-cancelled orders (incl. delivery fees & marketplace goods). It is <b>not</b> profit. Marketplace commission is the store's marketplace revenue; the rest of a used-book price belongs to the seller.</p>
  <div class="two"><div class="panel"><h3 style="margin-top:0">Last 14 days</h3>${d.daily.length ? `<div class="bar-row" style="margin-bottom:24px">${d.daily.map(x => `<div class="bar" style="height:${Math.max(4, x.total / max * 100)}%" title="${x.d}: ${inr(x.total)} (${x.orders} orders)"><span>${esc(x.d.slice(5))}</span></div>`).join('')}</div>` : '<p class="mut">No orders in the last 14 days.</p>'}</div>
  <div class="panel"><h3 style="margin-top:0">Best sellers</h3>${d.best_sellers.length ? d.best_sellers.map(b => `<div style="display:flex;justify-content:space-between;padding:5px 0"><span>${esc(b.title)}</span><b>${b.qty} sold · ${inr(b.total)}</b></div>`).join('') : '<p class="mut">No sales yet.</p>'}
   <h3>Sales by category</h3>${d.by_category.length ? d.by_category.map(b => `<div style="display:flex;justify-content:space-between;padding:5px 0"><span>${esc(b.name)}</span><b>${inr(b.total)}</b></div>`).join('') : '<p class="mut">No sales yet.</p>'}</div></div>
  <div class="panel" style="margin-top:16px"><h3 style="margin-top:0">Recent orders</h3>
   ${d.recent_orders.length ? `<div class="tblwrap"><table class="dt"><tr><th>Ref</th><th>Date</th><th>Status</th><th>Payment</th><th>Total</th><th></th></tr>
   ${d.recent_orders.map(o => `<tr><td>${esc(o.ref)}</td><td>${esc(o.created_at.slice(0, 10))}</td><td><span class="tag ${esc(o.status)}">${esc(o.status)}</span></td><td>${esc(o.payment_method)} (${esc(o.payment_status)})</td><td>${inr(o.total_paise)}</td><td><a href="#/admin/orders/${o.id}">View</a></td></tr>`).join('')}</table></div>` : '<p class="mut">No orders yet.</p>'}</div>`);
}
/* ---------- products ---------- */
async function admProducts(params) {
  const d = await api('/api/admin/products?q=' + encodeURIComponent(params.q || ''));
  const edit = params.edit ? d.rows.find(r => r.id == params.edit) : null;
  const f = k => esc(edit?.[k] ?? '');
  admShell('products', `
  <form class="panel" onsubmit="return admSaveProduct(event,${edit ? edit.id : 'null'})"><h3 style="margin-top:0">${edit ? 'Edit: ' + esc(edit.title) : 'Add product'}</h3>
   <label class="f">Title *</label><input id="p_title" type="text" required value="${f('title')}">
   <label class="f">Description</label><textarea id="p_description">${f('description')}</textarea>
   <div class="three"><div><label class="f">Category</label><select id="p_category"><option value="">—</option>${S.categories.map(c => `<option ${edit?.category_id === c.id ? 'selected' : ''} value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
   <div><label class="f">Price (₹) *</label><input id="p_price" type="number" step="0.01" required value="${edit ? rs(edit.price_paise) : ''}"></div>
   <div><label class="f">MRP (₹, for genuine discounts)</label><input id="p_mrp" type="number" step="0.01" value="${edit?.mrp_paise ? rs(edit.mrp_paise) : ''}"></div></div>
   <div class="three"><div><label class="f">Stock (store-owned only)</label><input id="p_stock" type="number" value="${edit?.stock ?? 0}"></div>
   <div><label class="f">Low-stock alert at</label><input id="p_reorder" type="number" value="${edit?.reorder_at ?? 5}"></div>
   <div><label class="f">Status</label><select id="p_status">${['published', 'draft', 'archived'].map(x => `<option ${edit?.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
   <div class="three"><div><label class="f">Brand</label><input id="p_brand" type="text" value="${f('brand')}"></div>
   <div><label class="f">SKU</label><input id="p_sku" type="text" value="${f('sku')}"></div>
   <div><label class="f">ISBN</label><input id="p_isbn" type="text" value="${f('isbn')}"></div></div>
   <div class="three"><div><label class="f">Author</label><input id="p_author" type="text" value="${f('author')}"></div>
   <div><label class="f">Publisher</label><input id="p_publisher" type="text" value="${f('publisher')}"></div>
   <div><label class="f">Edition</label><input id="p_edition" type="text" value="${f('edition')}"></div></div>
   <div class="three">${[['board', 'Board'], ['class', 'Class'], ['subject', 'Subject'], ['language', 'Language']].map(([k, l]) => `<div><label class="f">${l}</label><select id="p_${k}"><option value="">—</option>${metaOpts(k).map(v => `<option ${edit?.[k] === v ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('')}</select></div>`).join('')}
   <div><label class="f">Image URL or upload</label><input id="p_image" type="text" value="${f('image_url')}"><input type="file" id="p_file" accept="image/*" style="margin-top:6px"></div>
   <div><label class="f">Featured</label><select id="p_featured"><option value="0">No</option><option value="1" ${edit?.featured ? 'selected' : ''}>Yes — show on homepage</option></select></div></div>
   <p><button class="btn pri">${edit ? 'Save Changes' : 'Add Product'}</button> ${edit ? '<a class="btn ghost" href="#/admin/products">Cancel edit</a>' : ''}</p>
   <p class="small mut">Stock changes are written to the audit-ready stock ledger with your name.</p></form>
  <div class="panel" style="margin-top:16px"><h3 style="margin-top:0">Bulk import / export</h3>
   <p class="small">Paste a JSON array like <code>[{"title":"…","price_rs":199,"mrp_rs":249,"stock":10,"board":"CBSE","class":"10","subject":"Mathematics"}]</code>. Invalid rows are reported, not silently skipped.</p>
   <textarea id="imp" style="min-height:70px"></textarea><p><button class="btn" onclick="admImport()">Import Products</button> <a class="btn ghost" href="/api/admin/products/export.csv">⬇ Export CSV</a></p><div id="impOut"></div></div>
  <form style="margin:16px 0;display:flex;gap:8px" onsubmit="event.preventDefault();location.hash='#/admin/products?q='+encodeURIComponent(document.getElementById('pq').value);renderAdmin(['products'],{q:document.getElementById('pq').value})">
   <input id="pq" type="text" placeholder="Search by title, SKU, ISBN…" value="${esc(params.q || '')}"><button class="btn pri">Search</button></form>
  <div class="tblwrap"><table class="dt"><tr><th>Product</th><th>Cat</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr>
  ${d.rows.map(r => `<tr><td><b>${esc(r.title)}</b><br><span class="meta">${esc(r.sku || '')} ${esc(r.isbn || '')} ${esc([r.board, r.class && 'Cl ' + r.class, r.subject].filter(Boolean).join(' · '))}</span></td>
   <td>${esc(r.category_name || '')}</td><td>${inr(r.price_paise)}</td><td>${r.stock === 0 ? '<span class="stock-out">0</span>' : r.stock <= r.reorder_at ? '<span class="stock-low">' + r.stock + '</span>' : r.stock}
    <button class="btn sm ghost" onclick="admStock(${r.id})">±</button></td><td><span class="tag ${r.status === 'published' ? 'published' : 'pending'}">${esc(r.status)}</span></td>
   <td style="white-space:nowrap"><a class="btn sm ghost" href="#/admin/products?edit=${r.id}">Edit</a> <a class="btn sm ghost" href="#/product/${r.slug}">View</a> ${hasP('catalog') ? `<button class="btn sm danger" onclick="admDelProduct(${r.id})">Delete</button>` : ''}</td></tr>`).join('')}</table></div>`);
}
window.admSaveProduct = async (e, id) => { e.preventDefault();
  try { let image = $('#p_image').value; const file = $('#p_file').files[0];
    if (file) { const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); });
      image = (await api('/api/upload', { method: 'POST', body: { dataUrl } })).url; }
    const body = { title: $('#p_title').value, description: $('#p_description').value, category_id: +$('#p_category').value || null,
      price_paise: Math.round((+$('#p_price').value || 0) * 100), mrp_paise: Math.round((+$('#p_mrp').value || 0) * 100),
      stock: +$('#p_stock').value || 0, reorder_at: +$('#p_reorder').value || 5, status: $('#p_status').value,
      brand: $('#p_brand').value, sku: $('#p_sku').value, isbn: $('#p_isbn').value, author: $('#p_author').value, publisher: $('#p_publisher').value,
      edition: $('#p_edition').value, board: $('#p_board').value, class: $('#p_class').value, subject: $('#p_subject').value, language: $('#p_language').value,
      image_url: image, featured: +$('#p_featured').value };
    await api(id ? '/api/admin/products/' + id : '/api/admin/products', { method: id ? 'PUT' : 'POST', body });
    toast('Product saved ✓ — the storefront now shows it.'); renderAdmin(['products'], {}); } catch (x) { toast(x.message); } return false; };
window.admDelProduct = async id => { if (!confirm('Delete this product? Products with order history are archived instead.')) return;
  try { const d = await api('/api/admin/products/' + id, { method: 'DELETE' }); toast(d.message || 'Deleted ✓'); renderAdmin(['products'], {}); } catch (e) { toast(e.message); } };
window.admStock = async id => { const v = prompt('Stock adjustment (e.g. +20 received, -3 damaged):'); if (!v) return; const r = prompt('Reason:', 'manual-adjustment') || '';
  try { const d = await api(`/api/admin/products/${id}/stock`, { method: 'POST', body: { delta: parseInt(v, 10), reason: r } }); toast('Stock is now ' + d.stock); renderAdmin(['products'], {}); } catch (e) { toast(e.message); } };
window.admImport = async () => { let rows; try { rows = JSON.parse($('#imp').value); } catch { toast('Invalid JSON'); return; }
  try { const d = await api('/api/admin/products/import', { method: 'POST', body: { rows } });
    $('#impOut').innerHTML = `<div class="alert ${d.created ? 'good' : 'warn'}">Created ${d.created} product(s). ${d.results.filter(r => !r.ok).map(r => `Row ${r.row}: ${esc(r.error)}`).join(' · ')}</div>`; } catch (e) { toast(e.message); } };
async function admInventory() { const d = await api('/api/admin/inventory');
  admShell('inventory', `<h2>Stock levels (store-owned inventory only)</h2>
  <div class="alert warn small">Customer-owned marketplace books are <b>not</b> counted here — see Marketplace for those.</div>
  <div class="tblwrap"><table class="dt"><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Alert at</th><th>Status</th></tr>
  ${d.rows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.sku)}</td><td>${r.stock === 0 ? '<b class="stock-out">0 — OUT</b>' : r.stock <= r.reorder_at ? '<b class="stock-low">' + r.stock + ' — LOW</b>' : r.stock}</td><td>${r.reorder_at}</td><td>${esc(r.status)}</td></tr>`).join('')}</table></div>
  <h2>Stock movement history</h2><div class="tblwrap"><table class="dt"><tr><th>When</th><th>Product</th><th>Change</th><th>Reason</th><th>Ref</th><th>By</th></tr>
  ${d.movements.map(m => `<tr><td>${esc(m.created_at.slice(0, 16))}</td><td>${esc(m.title)}</td><td>${m.delta > 0 ? '+' : ''}${m.delta}</td><td>${esc(m.reason)}</td><td>${esc(m.ref)}</td><td>${esc(m.user_name || '—')}</td></tr>`).join('') || '<tr><td colspan=6>No movements yet.</td></tr>'}</table></div>
  <h2>Restock requests from customers</h2>${d.restock.length ? `<div class="tblwrap"><table class="dt"><tr><th>Product</th><th>Contact</th><th>When</th></tr>${d.restock.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.contact)}</td><td>${esc(r.created_at.slice(0, 10))}</td></tr>`).join('')}</table></div>` : '<p class="mut">None.</p>'}`); }
async function admSuppliers() { const d = await api('/api/admin/suppliers'); const prods = await api('/api/admin/products');
  admShell('suppliers', `<div class="two"><form class="panel" onsubmit="return admAddSupplier(event)"><h3 style="margin-top:0">Add supplier</h3>
   <label class="f">Name *</label><input id="sup_name" type="text" required><label class="f">Contact</label><input id="sup_contact" type="text">
   <label class="f">Notes</label><textarea id="sup_notes"></textarea><p><button class="btn pri">Add Supplier</button></p></form>
  <form class="panel" onsubmit="return admAddPO(event)"><h3 style="margin-top:0">New purchase order</h3>
   <label class="f">Supplier</label><select id="po_sup">${d.suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
   <label class="f">Product</label><select id="po_prod">${prods.rows.map(p => `<option value="${p.id}">${esc(p.title)} (stock ${p.stock})</option>`).join('')}</select>
   <div class="two"><div><label class="f">Quantity</label><input id="po_qty" type="number" min="1" required></div>
   <div><label class="f">Cost per unit (₹)</label><input id="po_cost" type="number" step="0.01"></div></div>
   <p><button class="btn pri">Create PO</button></p></form></div>
  <h3>Suppliers</h3>${d.suppliers.length ? `<div class="tblwrap"><table class="dt"><tr><th>Name</th><th>Contact</th><th>Notes</th></tr>${d.suppliers.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.contact)}</td><td>${esc(s.notes)}</td></tr>`).join('')}</table></div>` : '<p class="mut">None yet.</p>'}
  <h3>Purchase orders</h3>${d.pos.length ? `<div class="tblwrap"><table class="dt"><tr><th>PO</th><th>Supplier</th><th>Product</th><th>Qty</th><th>Cost/unit</th><th>Status</th><th></th></tr>
   ${d.pos.map(p => `<tr><td>PO-${p.id}</td><td>${esc(p.supplier)}</td><td>${esc(p.title)}</td><td>${p.qty}</td><td>${inr(p.cost_paise)}</td><td><span class="tag ${p.status === 'received' ? 'paid' : 'pending'}">${esc(p.status)}</span></td>
   <td>${p.status === 'ordered' ? `<button class="btn sm pri" onclick="admReceivePO(${p.id})">Receive into stock</button>` : esc(p.received_at?.slice(0, 10) || '')}</td></tr>`).join('')}</table></div>` : '<p class="mut">None yet. Receiving a PO adds stock with a full audit trail.</p>'}`); }
window.admAddSupplier = async e => { e.preventDefault(); try { await api('/api/admin/suppliers', { method: 'POST', body: { name: $('#sup_name').value, contact: $('#sup_contact').value, notes: $('#sup_notes').value } }); renderAdmin(['suppliers'], {}); } catch (x) { toast(x.message); } return false; };
window.admAddPO = async e => { e.preventDefault(); try { await api('/api/admin/purchase-orders', { method: 'POST', body: { supplier_id: +$('#po_sup').value, product_id: +$('#po_prod').value, qty: +$('#po_qty').value, cost_paise: Math.round((+$('#po_cost').value || 0) * 100) } }); renderAdmin(['suppliers'], {}); } catch (x) { toast(x.message); } return false; };
window.admReceivePO = async id => { if (!confirm('Mark received and add quantity to stock?')) return; try { await api(`/api/admin/purchase-orders/${id}/receive`, { method: 'POST', body: {} }); toast('Stock received ✓'); renderAdmin(['suppliers'], {}); } catch (e) { toast(e.message); } };
/* ---------- orders ---------- */
async function admOrders(params) { const d = await api('/api/admin/orders?q=' + encodeURIComponent(params.q || '') + (params.status ? '&status=' + params.status : ''));
  admShell('orders', `<form style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap" onsubmit="event.preventDefault();renderAdmin(['orders'],{q:document.getElementById('oq').value,status:document.getElementById('os').value})">
   <input id="oq" type="text" placeholder="Order ref, customer name or email…" value="${esc(params.q || '')}" style="max-width:320px">
   <select id="os" style="width:auto"><option value="">All statuses</option>${['pending', 'confirmed', 'processing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'payment_failed', 'return_requested', 'refunded'].map(x => `<option ${params.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
   <button class="btn pri">Filter</button></form>
  <div class="tblwrap"><table class="dt"><tr><th>Ref</th><th>Customer</th><th>Type</th><th>Status</th><th>Payment</th><th>Total</th><th>Date</th><th></th></tr>
  ${d.rows.map(o => `<tr><td><b>${esc(o.ref)}</b></td><td>${esc(o.customer_name || o.guest_name || 'Guest')}<br><span class="meta">${esc(o.customer_email || o.guest_email || '')}</span></td>
   <td>${o.fulfilment === 'pickup' ? '🏪 Pickup' : '🚚 Delivery'}</td><td><span class="tag ${esc(o.status)}">${esc(o.status)}</span></td>
   <td>${esc(o.payment_method)} · ${esc(o.payment_status)}</td><td>${inr(o.total_paise)}</td><td>${esc(o.created_at.slice(0, 10))}</td>
   <td><a class="btn sm ghost" href="#/admin/orders/${o.id}">Manage</a></td></tr>`).join('') || '<tr><td colspan=8>No orders match.</td></tr>'}</table></div>`); }
async function admOrderDetail(id) { const d = await api('/api/admin/orders/' + id); const o = d.order;
  const NEXT = { pending: ['confirmed', 'cancelled', 'payment_failed'], confirmed: ['processing', 'cancelled'], processing: ['ready_for_pickup', 'shipped', 'cancelled'], ready_for_pickup: ['delivered', 'cancelled'], shipped: ['delivered'], delivered: ['return_requested'], return_requested: ['refunded', 'delivered'], payment_failed: ['pending', 'cancelled'] }[o.status] || [];
  admShell('orders', `<p><a href="#/admin/orders">← All orders</a></p>
  <div class="split"><div>${orderDetailHtml({ ...o, customer_name: o.customer_name }, false)}
   <div class="panel" style="margin-top:14px"><h3 style="margin-top:0">Customer</h3><p class="small">${esc(o.customer_name || o.guest_name || 'Guest')}<br>${esc(o.customer_email || o.guest_email || '')}<br>${esc(o.customer_phone || o.guest_phone || '')}</p>
   <p class="small mut">Personal data is shown to authorised staff only and its access is role-controlled.</p>
   <a class="btn sm ghost" href="/api/orders/${o.id}/invoice" target="_blank">🧾 Print Invoice</a></div></div>
  <aside><div class="panel"><h3 style="margin-top:0">Move order forward</h3>
   ${NEXT.length ? NEXT.map(n => `<button class="btn ${n === 'cancelled' || n === 'refunded' ? 'danger' : 'pri'}" style="display:block;width:100%;justify-content:center;margin:8px 0" onclick="admOrderStatus(${o.id},'${n}')">${n === 'delivered' ? '✔ Mark Delivered' : esc(n.replace(/_/g, ' '))}</button>`).join('')
     + `<label class="f">Note / internal remark</label><input id="os_note" type="text" placeholder="Visible in history"><label class="f">Tracking reference (courier, if any)</label><input id="os_track" type="text" value="${esc(o.tracking_ref || '')}">`
     : '<p class="mut">This order is in a final state.</p>'}
   <p class="small mut">Only valid next steps are shown — the server enforces the same rules. Cancelling/refunding restores stock and releases used-book listings. Delivering a marketplace order marks the book sold and creates the seller settlement.</p></div>
  ${hasP('finance') ? `<div class="panel" style="margin-top:14px"><h3 style="margin-top:0">Payment status</h3>
   <select id="pay_status">${['unpaid', 'paid', 'refunded', 'failed'].map(x => `<option ${o.payment_status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
   <p><button class="btn sm" onclick="admPayStatus(${o.id})">Update Payment</button></p>
   <p class="small mut">COD orders auto-mark as paid when delivered. Refunds here record the financial state; actual money movement follows store policy.</p></div>` : ''}</aside></div>`); }
window.admOrderStatus = async (id, status) => { if (['cancelled', 'refunded'].includes(status) && !confirm(`Really mark this order ${status}? Stock/listings will be restored.`)) return;
  try { await api(`/api/admin/orders/${id}/status`, { method: 'POST', body: { status, note: document.getElementById('os_note')?.value || '', tracking_ref: document.getElementById('os_track')?.value || '' } });
    toast('Order updated ✓'); renderAdmin(['orders', String(id)], {}); } catch (e) { toast(e.message); } };
window.admPayStatus = async id => { try { await api(`/api/admin/orders/${id}/payment`, { method: 'POST', body: { payment_status: $('#pay_status').value } }); toast('Payment updated ✓'); renderAdmin(['orders', String(id)], {}); } catch (e) { toast(e.message); } };
/* ---------- customers ---------- */
async function admCustomers() { const d = await api('/api/admin/customers');
  admShell('customers', `<div class="tblwrap"><table class="dt"><tr><th>Customer</th><th>Contact</th><th>Role</th><th>Orders</th><th>Status</th><th>Actions</th></tr>
  ${d.rows.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="meta">since ${esc(u.created_at.slice(0, 10))}</span></td><td>${esc(u.email)}<br>${esc(u.phone || '')}</td>
   <td>${esc(u.role)}</td><td>${u.orders}</td><td><span class="tag ${u.status === 'active' ? 'paid' : 'cancelled'}">${esc(u.status)}</span></td>
   <td style="white-space:nowrap">${u.role !== 'owner' ? `<button class="btn sm ${u.status === 'active' ? 'danger' : 'pri'}" onclick="admCustStatus(${u.id},'${u.status === 'active' ? 'suspended' : 'active'}')">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button> <button class="btn sm ghost" onclick="admResetLink(${u.id})">Reset link</button>` : ''}</td></tr>`).join('')}</table></div>
  <p class="small mut">Passwords are hashed — staff can never view them. “Reset link” issues a one-time link (valid 2 hrs) to share only after verifying identity, until email sending is configured.</p><div id="resetOut"></div>`); }
window.admCustStatus = async (id, st) => { if (!confirm('Set this account to ' + st + '?')) return; try { await api(`/api/admin/customers/${id}/status`, { method: 'POST', body: { status: st } }); renderAdmin(['customers'], {}); } catch (e) { toast(e.message); } };
window.admResetLink = async id => { try { const d = await api(`/api/admin/customers/${id}/reset-link`, { method: 'POST', body: {} });
  $('#resetOut').innerHTML = `<div class="alert warn"><b>One-time reset link:</b> <a href="${esc(d.reset_path)}">${esc(location.origin + d.reset_path)}</a><br><span class="small">${esc(d.note)}</span></div>`; } catch (e) { toast(e.message); } };
/* ---------- marketplace ---------- */
async function admMarketplace() { const d = await api('/api/admin/listings');
  admShell('marketplace', `<h2>Listing moderation queue</h2>
  <div class="tblwrap"><table class="dt"><tr><th>Book</th><th>Seller</th><th>Condition / defects</th><th>Price</th><th>Status</th><th>Moderate</th></tr>
  ${d.rows.map(l => `<tr><td><b>${esc(l.title)}</b><br><span class="meta">${esc([l.author, l.board, l.class && 'Cl ' + l.class, l.subject].filter(Boolean).join(' · '))}</span><br><span class="meta">${esc(l.description || '')}</span></td>
   <td>${esc(l.seller_name)}</td><td>${esc(COND[l.condition_grade] || l.condition_grade)}<br><span class="meta">${esc(l.defects || '')}</span></td><td>${inr(l.price_paise)}</td>
   <td><span class="tag ${esc(l.status)}">${esc(l.status)}</span></td>
   <td style="white-space:nowrap">${!['sold', 'reserved'].includes(l.status) ? `
    <button class="btn sm pri" onclick="admModerate(${l.id},'approve')">Approve</button>
    <button class="btn sm ghost" onclick="admModerate(${l.id},'review')">Review</button>
    <button class="btn sm danger" onclick="admModerate(${l.id},'reject')">Reject</button>
    <button class="btn sm danger" onclick="admModerate(${l.id},'suspend')">Suspend</button>` : '<span class="meta">in order flow</span>'}</td></tr>`).join('') || '<tr><td colspan=6>No listings yet.</td></tr>'}</table></div>
  <h2>Buyer/seller reports</h2>${d.reports.length ? `<div class="tblwrap"><table class="dt"><tr><th>Listing</th><th>Reporter</th><th>Reason</th><th>Status</th><th></th></tr>
   ${d.reports.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.reporter)}</td><td>${esc(r.reason)}</td><td>${esc(r.status)}</td>
   <td>${r.status === 'open' ? `<button class="btn sm pri" onclick="admResolveReport(${r.id})">Resolve</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="mut">No reports.</p>'}`); }
window.admModerate = async (id, action) => { const note = action === 'reject' || action === 'suspend' ? (prompt('Reason shown to the seller:') || '') : '';
  try { await api(`/api/admin/listings/${id}/moderate`, { method: 'POST', body: { action, note } }); toast('Listing ' + action + 'd ✓'); renderAdmin(['marketplace'], {}); } catch (e) { toast(e.message); } };
window.admResolveReport = async id => { try { await api(`/api/admin/reports/${id}/resolve`, { method: 'POST', body: {} }); renderAdmin(['marketplace'], {}); } catch (e) { toast(e.message); } };
async function admSettlements() { const d = await api('/api/admin/settlements'); const active = d.rules.find(r => r.active);
  admShell('settlements', `<div class="two"><div class="panel"><h3 style="margin-top:0">Commission rule (current)</h3>
   <p style="font-size:20px"><b>${esc(active?.label || '—')}</b></p><p class="small mut">Effective from ${esc(active?.effective_from?.slice(0, 10) || '')}. Changing this never rewrites past sales — every transaction stores the rule applied at sale time.</p>
   <form onsubmit="return admSetCommission(event)"><div class="two"><div><label class="f">Type</label><select id="cm_kind"><option value="percent">Percentage %</option><option value="fixed">Fixed fee (₹)</option></select></div>
   <div><label class="f">Value</label><input id="cm_value" type="number" min="0" required></div></div>
   <label class="f">Label shown to sellers</label><input id="cm_label" type="text" placeholder="e.g. 10% marketplace commission">
   <p><button class="btn pri">Update Commission (audited)</button></p></form>
   <h4>History</h4>${d.rules.map(r => `<div class="small">• ${esc(r.label)} — from ${esc(r.effective_from.slice(0, 10))} ${r.active ? '<span class="tag paid">current</span>' : ''}</div>`).join('')}</div>
  <div class="panel"><h3 style="margin-top:0">How settlement works</h3><p class="small" style="line-height:1.8">When a used-book order is delivered, a settlement is created: sale price − commission = seller proceeds. Pay the seller (cash/UPI at store), then mark it <b>Paid</b> with a note. There is no automatic payout or escrow unless a payment provider is integrated later — the system never pretends otherwise.</p></div></div>
  <h2>Seller settlements</h2>${d.rows.length ? `<div class="tblwrap"><table class="dt"><tr><th>Order</th><th>Book</th><th>Seller</th><th>Sold</th><th>Commission</th><th>Proceeds</th><th>Status</th><th>Settle</th></tr>
  ${d.rows.map(x => `<tr><td>${esc(x.ref)}</td><td>${esc(x.title)}</td><td>${esc(x.seller_name)}<br><span class="meta">${esc(x.seller_email)}</span></td>
   <td>${inr(x.gross_paise)}</td><td>−${inr(x.commission_paise)}</td><td><b>${inr(x.proceeds_paise)}</b></td>
   <td><span class="tag ${x.status === 'paid' ? 'paid' : 'pending'}">${esc(x.status)}</span><br><span class="meta">${esc(x.method_note || '')}</span></td>
   <td style="white-space:nowrap">${x.status !== 'paid' ? `<button class="btn sm pri" onclick="admSettle(${x.id},'paid')">Mark Paid</button> <button class="btn sm danger" onclick="admSettle(${x.id},'disputed')">Dispute</button>` : esc(x.paid_at?.slice(0, 10) || '')}</td></tr>`).join('')}</table></div>` : '<p class="mut">No completed marketplace sales yet.</p>'}`); }
window.admSetCommission = async e => { e.preventDefault(); const kind = $('#cm_kind').value; const value = kind === 'fixed' ? Math.round(+$('#cm_value').value * 100) : +$('#cm_value').value;
  if (!confirm('Change the marketplace commission for FUTURE sales?')) return false;
  try { await api('/api/admin/commission', { method: 'POST', body: { kind, value, label: $('#cm_label').value } }); toast('Commission updated ✓'); await bootstrap(); renderAdmin(['settlements'], {}); } catch (x) { toast(x.message); } return false; };
window.admSettle = async (id, status) => { const note = prompt(status === 'paid' ? 'How was the seller paid? (e.g. UPI / cash at counter)' : 'Dispute note:') || '';
  try { await api('/api/admin/settlements/' + id, { method: 'POST', body: { status, method_note: note } }); renderAdmin(['settlements'], {}); } catch (e) { toast(e.message); } };
/* ---------- promotions / support ---------- */
async function admPromotions() { const d = await api('/api/admin/promotions');
  admShell('promotions', `<form class="panel" onsubmit="return admAddPromo(event)"><h3 style="margin-top:0">Create discount code</h3>
  <div class="three"><div><label class="f">Code *</label><input id="pr_code" type="text" required placeholder="SCHOOL10"></div>
  <div><label class="f">Type</label><select id="pr_kind"><option value="percent">% off store subtotal</option><option value="fixed">Fixed ₹ off</option></select></div>
  <div><label class="f">Value</label><input id="pr_value" type="number" required placeholder="10 (=10% or ₹10)"></div></div>
  <div class="three"><div><label class="f">Min store subtotal (₹)</label><input id="pr_min" type="number" value="0"></div>
  <div><label class="f">Expiry (optional)</label><input id="pr_exp" type="date"></div>
  <div><label class="f">Usage limit (0 = unlimited)</label><input id="pr_limit" type="number" value="0"></div></div>
  <p class="small mut">Expiry, limits and minimums are validated on the server at checkout — expired codes cannot be reused. For fixed ₹ codes the value is whole rupees.</p>
  <button class="btn pri">Create Code</button></form>
  <div class="tblwrap" style="margin-top:16px"><table class="dt"><tr><th>Code</th><th>Offer</th><th>Min</th><th>Used</th><th>Expires</th><th>Active</th><th></th></tr>
  ${d.rows.map(p => `<tr><td><b>${esc(p.code)}</b></td><td>${p.kind === 'percent' ? p.value + '%' : inr(p.value)}</td><td>${inr(p.min_subtotal_paise)}</td>
   <td>${p.used_count}${p.usage_limit ? '/' + p.usage_limit : ''}</td><td>${esc(p.expires_at?.slice(0, 10) || '—')}</td><td>${p.active ? 'Yes' : 'No'}</td>
   <td><button class="btn sm ghost" onclick="admTogglePromo(${p.id})">${p.active ? 'Disable' : 'Enable'}</button></td></tr>`).join('') || '<tr><td colspan=7>No promotions yet — the homepage honestly shows none.</td></tr>'}</table></div>`); }
window.admAddPromo = async e => { e.preventDefault(); const kind = $('#pr_kind').value;
  try { await api('/api/admin/promotions', { method: 'POST', body: { code: $('#pr_code').value, kind, value: kind === 'fixed' ? Math.round(+$('#pr_value').value * 100) : +$('#pr_value').value,
    min_subtotal_paise: Math.round((+$('#pr_min').value || 0) * 100), expires_at: $('#pr_exp').value || null, usage_limit: +$('#pr_limit').value || null } });
    renderAdmin(['promotions'], {}); } catch (x) { toast(x.message); } return false; };
window.admTogglePromo = async id => { try { await api(`/api/admin/promotions/${id}/toggle`, { method: 'POST', body: {} }); renderAdmin(['promotions'], {}); } catch (e) { toast(e.message); } };
async function admSupport() { const d = await api('/api/admin/support');
  admShell('support', `<h2>Enquiries & support tickets</h2>
  ${d.enquiries.map(e => `<div class="panel" style="margin-bottom:12px"><b>${esc(e.subject)}</b> <span class="tag ${e.status === 'open' ? 'pending' : 'paid'}">${esc(e.status)}</span>
   <span class="meta">${esc(e.kind)} · ${esc(e.user_name || e.guest_name || '')} ${esc(e.guest_contact || '')} · ${esc(e.created_at.slice(0, 10))}</span>
   <p class="small">${esc(e.message)}</p>
   ${e.status !== 'closed' ? `<div style="display:flex;gap:8px"><input id="rep_${e.id}" type="text" placeholder="Reply (visible in customer account)…" value="${esc(e.admin_reply || '')}">
    <button class="btn sm pri" onclick="admReply(${e.id},false)">Reply</button><button class="btn sm ghost" onclick="admReply(${e.id},true)">Reply & Close</button></div>`
    : `<div class="alert good"><b>Reply:</b> ${esc(e.admin_reply)}</div>`}</div>`).join('') || '<p class="mut">No enquiries yet.</p>'}
  <h2>Review moderation</h2><div class="tblwrap"><table class="dt"><tr><th>Product</th><th>By</th><th>Review</th><th>Verified</th><th>Status</th><th></th></tr>
  ${d.reviews.map(r => `<tr><td>${esc(r.product_title || '')}</td><td>${esc(r.user_name)}</td><td>${'★'.repeat(r.rating)} ${esc(r.title)}<br><span class="meta">${esc(r.body)}</span></td>
   <td>${r.verified ? '✔' : '—'}</td><td>${esc(r.status)}</td>
   <td><button class="btn sm ghost" onclick="admReview(${r.id},'${r.status === 'published' ? 'hidden' : 'published'}')">${r.status === 'published' ? 'Hide' : 'Publish'}</button></td></tr>`).join('') || '<tr><td colspan=6>No reviews yet.</td></tr>'}</table></div>`); }
window.admReply = async (id, close) => { try { await api('/api/admin/enquiries/' + id, { method: 'POST', body: { reply: $('#rep_' + id).value, close } }); toast('Reply saved ✓'); renderAdmin(['support'], {}); } catch (e) { toast(e.message); } };
window.admReview = async (id, status) => { try { await api('/api/admin/reviews/' + id, { method: 'POST', body: { status } }); renderAdmin(['support'], {}); } catch (e) { toast(e.message); } };
/* ---------- catalog meta / reports / staff / settings / audit ---------- */
async function admCatalog() { const d = await api('/api/admin/meta');
  admShell('catalog', `<div class="two"><div class="panel"><h3 style="margin-top:0">Categories</h3>
   ${S.categories.map(c => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(c.icon)} ${esc(c.name)}</span><button class="btn sm danger" onclick="admDelCategory(${c.id})">Disable</button></div>`).join('')}
   <form onsubmit="return admAddCategory(event)" style="margin-top:12px;display:flex;gap:8px"><input id="cat_name" type="text" required placeholder="New category"><input id="cat_icon" type="text" placeholder="📦" style="max-width:70px"><button class="btn sm pri">Add</button></form></div>
  <div class="panel"><h3 style="margin-top:0">Boards, classes, subjects, languages, conditions</h3>
   <form onsubmit="return admAddMeta(event)" style="display:flex;gap:8px;flex-wrap:wrap"><select id="meta_kind" style="width:auto">${['board', 'class', 'subject', 'language', 'condition'].map(k => `<option>${k}</option>`).join('')}</select>
   <input id="meta_value" type="text" required placeholder="Value" style="max-width:200px"><button class="btn sm pri">Add</button></form>
   <div style="max-height:360px;overflow:auto;margin-top:10px">${['board', 'class', 'subject', 'language', 'condition'].map(k => `<p class="small"><b>${k}:</b> ${d.rows.filter(r => r.kind === k).map(r => `${esc(r.value)} <a href="#" onclick="admDelMeta(${r.id});return false" title="Remove">✕</a>`).join(' · ')}</p>`).join('')}</div>
   <p class="small mut">These lists power search filters. Adding a board does not claim its books are in stock — stock is always shown live.</p></div></div>`); }
window.admAddCategory = async e => { e.preventDefault(); try { await api('/api/admin/categories', { method: 'POST', body: { name: $('#cat_name').value, icon: $('#cat_icon').value } }); await bootstrap(); renderAdmin(['catalog'], {}); } catch (x) { toast(x.message); } return false; };
window.admDelCategory = async id => { if (!confirm('Disable this category? Products keep their data.')) return; try { await api('/api/admin/categories/' + id, { method: 'DELETE' }); await bootstrap(); renderAdmin(['catalog'], {}); } catch (e) { toast(e.message); } };
window.admAddMeta = async e => { e.preventDefault(); try { await api('/api/admin/meta', { method: 'POST', body: { kind: $('#meta_kind').value, value: $('#meta_value').value } }); await bootstrap(); renderAdmin(['catalog'], {}); } catch (x) { toast(x.message); } return false; };
window.admDelMeta = async id => { try { await api('/api/admin/meta/' + id, { method: 'DELETE' }); await bootstrap(); renderAdmin(['catalog'], {}); } catch (e) { toast(e.message); } };
async function admReports() { const d = await api('/api/admin/overview');
  admShell('reports', `<div class="panel"><h3 style="margin-top:0">Reports & exports</h3>
  <p class="small">Definitions: <b>Gross order value</b> = payable totals of non-cancelled orders. <b>Store sales</b> = store-owned items only. <b>Marketplace gross</b> = used-book prices (belongs mostly to sellers). <b>Commission</b> = the store's marketplace earnings. None of these equal profit (purchase costs live in Purchase Orders).</p>
  <p><a class="btn pri" href="/api/admin/reports.csv">⬇ Sales by Day (CSV)</a> <a class="btn ghost" href="/api/admin/products/export.csv">⬇ Product/Inventory (CSV)</a></p>
  <div class="kpis">${[['Gross (all time)', inr(d.gross_paise)], ['Store sales', inr(d.store_sales_paise)], ['Marketplace gross', inr(d.marketplace_gross_paise)], ['Commission earned', inr(d.commission_paise)], ['Payouts pending', inr(d.pending_settlements_paise)]]
   .map(([k, v]) => `<div class="kpi"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
  <h4>Sales by category (all time)</h4>${d.by_category.map(b => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${esc(b.name)}</span><b>${inr(b.total)}</b></div>`).join('') || '<p class="mut">No sales yet.</p>'}</div>`); }
async function admStaff() { const d = await api('/api/admin/staff');
  admShell('staff', `<form class="panel" onsubmit="return admAddStaff(event)"><h3 style="margin-top:0">Create staff account</h3>
  <div class="three"><div><label class="f">Name</label><input id="st_name" type="text" required></div>
  <div><label class="f">Email</label><input id="st_email" type="email" required></div>
  <div><label class="f">Password (8+)</label><input id="st_pw" type="password" required minlength="8"></div></div>
  <label class="f">Role (least privilege)</label><select id="st_role" style="max-width:320px">${['admin', 'inventory', 'fulfilment', 'support', 'moderator', 'readonly'].map(r => `<option>${r}</option>`).join('')}</select>
  <p><button class="btn pri">Create Staff</button></p></form>
  <div class="panel" style="margin:16px 0"><h3 style="margin-top:0">What each role can do (enforced on the server)</h3>
  ${Object.entries(d.perms).map(([r, p]) => `<p class="small"><b>${esc(r)}:</b> ${p.length ? p.join(', ') : 'storefront only'}</p>`).join('')}</div>
  <div class="tblwrap"><table class="dt"><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Change role</th></tr>
  ${d.rows.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><b>${esc(u.role)}</b></td><td>${esc(u.status)}</td>
   <td>${u.role !== 'owner' && u.id !== S.user.id ? `<select id="role_${u.id}" style="width:auto">${['customer', 'admin', 'inventory', 'fulfilment', 'support', 'moderator', 'readonly'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select> <button class="btn sm pri" onclick="admSetRole(${u.id})">Apply</button>` : '<span class="meta">protected</span>'}</td></tr>`).join('')}</table></div>`); }
window.admAddStaff = async e => { e.preventDefault(); try { await api('/api/admin/staff', { method: 'POST', body: { name: $('#st_name').value, email: $('#st_email').value, password: $('#st_pw').value, role: $('#st_role').value } }); toast('Staff created ✓'); renderAdmin(['staff'], {}); } catch (x) { toast(x.message); } return false; };
window.admSetRole = async id => { if (!confirm('Change this user\u2019s role? The change is audit-logged.')) return; try { await api(`/api/admin/staff/${id}/role`, { method: 'POST', body: { role: $('#role_' + id).value } }); toast('Role updated ✓'); renderAdmin(['staff'], {}); } catch (e) { toast(e.message); } };
const SET_FIELDS = [['store_name', 'Store name', 'text'], ['tagline', 'Tagline', 'text'], ['address', 'Store address', 'text'], ['phone', 'Phone (public)', 'text'], ['email', 'Email (public)', 'text'], ['opening_hours', 'Opening hours', 'text'],
 ['hero_title', 'Homepage hero title', 'text'], ['hero_subtitle', 'Homepage hero subtitle', 'text'],
 ['service_pins', 'Delivery PIN codes (comma-separated, prefix match)', 'text'], ['delivery_fee_paise', 'Delivery fee (paise: ₹40 = 4000)', 'number'], ['free_delivery_above_paise', 'Free delivery above (paise)', 'number'], ['min_delivery_order_paise', 'Minimum delivery order (paise)', 'number'],
 ['delivery_enabled', 'Enable delivery (1/0)', 'text'], ['pickup_enabled', 'Enable pickup (1/0)', 'text'], ['payment_cod', 'Cash on Delivery (1/0)', 'text'], ['payment_store_pay', 'Pay at Store (1/0)', 'text'],
 ['payment_online', 'Online payments (1 only after gateway is integrated)', 'text'], ['online_payment_note', 'Online payment unavailable message', 'text'], ['marketplace_moderation', 'Moderate listings before publishing (1/0)', 'text'], ['tax_note', 'Invoice tax note', 'text'],
 ['about', 'About page', 'ta'], ['faq', 'FAQ extra content', 'ta'], ['return_policy', 'Return & cancellation policy', 'ta'], ['privacy_policy', 'Privacy policy', 'ta'], ['terms', 'Terms of use', 'ta']];
async function admSettings() { const d = await api('/api/admin/settings'); const s = d.settings;
  admShell('settings', `<form class="panel" onsubmit="return admSaveSettings(event)"><h3 style="margin-top:0">Store & website settings</h3>
  <p class="small mut">Nothing here is hard-coded in the storefront. Leave phone/email blank rather than inventing them. Amounts are in <b>paise</b>.</p>
  ${SET_FIELDS.map(([k, l, t]) => `<label class="f">${l}</label>${t === 'ta' ? `<textarea id="set_${k}">${esc(s[k] || '')}</textarea>` : `<input id="set_${k}" type="${t}" value="${esc(s[k] || '')}">`}`).join('')}
  <p><button class="btn pri">Save Settings</button></p></form>
  <div class="panel" style="margin-top:16px"><h3 style="margin-top:0">🔌 Integrations requiring credentials (currently OFF — honestly disabled)</h3>
  <ul class="small" style="line-height:1.9"><li><b>Online payments</b> (Razorpay/PayU etc.): needs merchant keys + webhook secret in server environment, then server-side verification before enabling.</li>
  <li><b>Email/SMS/WhatsApp notifications:</b> needs provider credentials (SMTP/API key). Until then, customers get <b>in-app notifications</b> and order tracking on this website only.</li>
  <li><b>Courier tracking:</b> displayed only when staff enter a genuine tracking reference.</li></ul></div>`); }
window.admSaveSettings = async e => { e.preventDefault(); const settings = {}; SET_FIELDS.forEach(([k]) => settings[k] = document.getElementById('set_' + k).value);
  try { await api('/api/admin/settings', { method: 'PUT', body: { settings } }); toast('Settings saved ✓ — storefront updated.'); await bootstrap(); } catch (x) { toast(x.message); } return false; };
async function admAudit() { const d = await api('/api/admin/audit');
  admShell('audit', `<h2>Audit trail</h2><p class="small mut">Inventory, order, refund, commission, role and settings changes. Passwords, tokens and payment secrets are never logged.</p>
  <div class="tblwrap"><table class="dt"><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr>
  ${d.rows.map(r => `<tr><td>${esc(r.created_at.slice(0, 16))}</td><td>${esc(r.user_name || '—')}</td><td>${esc(r.action)}</td><td>${esc(r.entity)} ${esc(r.entity_id)}</td><td>${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan=5>No audited actions yet.</td></tr>'}</table></div>`); }
