'use strict';
/* Ankit Stationery Mart — storefront SPA. Every control calls the real API. */
const S = { settings: {}, categories: [], meta: {}, user: null, csrf: '', commission: null };
const $ = (s, e = document) => e.querySelector(s); const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = p => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rs = p => Math.round(p) / 100;
const app = $('#app');
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }
function modal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalX').onclick = closeModal; $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#menuBtn').onclick = () => $('#mainNav').classList.toggle('open');
$('#mainNav').addEventListener('click', () => $('#mainNav').classList.remove('open'));
addEventListener('offline', () => $('#offlineBar').classList.remove('hidden'));
addEventListener('online', () => $('#offlineBar').classList.add('hidden'));
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': S.csrf }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({ ok: false, error: 'Server error. Please try again.' }));
  if (!d.ok) throw new Error(d.error || 'Request failed'); return d;
}
const metaOpts = k => (S.meta[k] || []);
const COND = { 'like-new': 'Like New', good: 'Good', acceptable: 'Acceptable', worn: 'Well Used' };
const CAT_ICON = { books: '📚', stationery: '✏️', 'school-supplies': '🎒', 'office-supplies': '🗂️', 'art-craft': '🎨', 'notebooks-paper': '📓' };
function stockTag(p) { return p.stock === 0 ? '<span class="stock-out">Out of stock</span>' : p.stock <= p.reorder_at ? `<span class="stock-low">Only ${p.stock} left</span>` : '<span class="stock-ok">In stock</span>'; }
function stars(a, n) { return a ? `<span class="stars">${'★'.repeat(Math.round(a))}${'☆'.repeat(5 - Math.round(a))}</span> <span class="meta">${a} (${n})</span>` : '<span class="meta">No reviews yet</span>'; }
function productCard(p) {
  const icon = CAT_ICON[p.category_slug] || '📦';
  return `<article class="card"><a class="thumb" href="#/product/${p.slug}" aria-label="${esc(p.title)}">
    ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy">` : `<span aria-hidden="true">${icon}</span>`}
    <span class="chip">NEW · Store</span>${p.stock === 0 ? '<span class="chip off" style="left:auto;right:10px">Out of stock</span>' : ''}</a>
   <div class="card-b"><h3><a href="#/product/${p.slug}">${esc(p.title)}</a></h3>
    <div class="meta">${esc([p.author, p.brand, p.board && p.board + ' · Class ' + p.class, p.subject].filter(Boolean).join(' · '))}</div>
    <div>${stars(p.avg_rating, p.review_count || 0)}</div>
    <div class="price">${inr(p.price_paise)} ${p.mrp_paise > p.price_paise ? `<s>${inr(p.mrp_paise)}</s> <span class="off-t">${p.discount_pct}% off</span>` : ''}</div>${stockTag(p)}</div>
   <div class="card-f">${p.stock > 0 ? `<button class="btn sm" onclick="addToCart(${p.id})">Add to Cart</button>` : `<button class="btn sm ghost" onclick="notifyMe(${p.id})">Notify Me</button>`}
    <button class="heart" onclick="toggleWish(this,${p.id},null)" aria-label="Add to wishlist">♡</button></div></article>`;
}
function usedCard(l) {
  const img = (l.images || [])[0];
  return `<article class="card"><a class="thumb" href="#/used/${l.id}">${img ? `<img src="${esc(img)}" alt="${esc(l.title)}" loading="lazy">` : '<span>📖</span>'}
    <span class="chip used">USED · ${esc(COND[l.condition_grade] || l.condition_grade)}</span></a>
   <div class="card-b"><h3><a href="#/used/${l.id}">${esc(l.title)}</a></h3>
    <div class="meta">${esc([l.author, l.board && l.board + ' · Class ' + l.class, l.subject].filter(Boolean).join(' · '))}</div>
    <div class="price">${inr(l.price_paise)}</div><span class="meta">Single copy · sold by a customer via the store marketplace</span></div>
   <div class="card-f"><button class="btn sm pri" onclick="addToCart(null,${l.id})">Add to Cart</button>
    <button class="heart" onclick="toggleWish(this,null,${l.id})" aria-label="Add to wishlist">♡</button></div></article>`;
}
window.addToCart = async (pid, lid, qty = 1, goCart) => {
  try { const d = await api('/api/cart/add', { method: 'POST', body: { product_id: pid, listing_id: lid, qty } });
    $('#cartBadge').textContent = d.cart.count; toast('Added to cart ✓'); if (goCart) location.hash = '#/cart'; }
  catch (e) { toast(e.message); }
};
window.toggleWish = async (btn, pid, lid) => { try { const d = await api('/api/wishlist', { method: 'POST', body: { product_id: pid, listing_id: lid } }); btn.textContent = d.wishlisted ? '♥' : '♡'; toast(d.wishlisted ? 'Saved to wishlist' : 'Removed from wishlist'); } catch (e) { toast(e.message); } };
window.notifyMe = async pid => { try { const d = await api('/api/restock', { method: 'POST', body: { product_id: pid, contact: S.user ? '' : (prompt('Email or phone for the restock alert:') || '') } }); toast(d.message, 6000); } catch (e) { toast(e.message); } };
function pager(page, pages, fn) { if (pages < 2) return ''; let h = '<div class="pager">';
  for (let i = 1; i <= pages; i++) h += `<button class="${i === page ? 'on' : ''}" onclick="${fn}(${i})">${i}</button>`; return h + '</div>'; }
const qs = s2 => Object.fromEntries(new URLSearchParams(s2 || ''));
function recentPush(q) { if (!q) return; const r = JSON.parse(localStorage.getItem('asm_recent') || '[]'); localStorage.setItem('asm_recent', JSON.stringify([q, ...r.filter(x => x !== q)].slice(0, 6))); }

/* ---------------- views ---------------- */
async function vHome() {
  const d = await api('/api/home'); const s = S.settings;
  app.innerHTML = `
  <section class="hero"><div class="hero-in"><h1>${esc(s.hero_title || 'Everything for school, office & reading')}</h1>
   <p>${esc(s.hero_subtitle || '')}</p>
   <p><a class="btn" href="#/shop">Shop Now</a> <a class="btn ghost" href="#/used" style="background:rgba(255,255,255,.12);color:#fff;border-color:#fff">Browse Second-Hand Books</a></p>
   <p class="small" style="color:#bfe3e6">🚚 Local delivery in serviceable PINs (${esc(s.service_pins || '')}) · 🏪 Free store pickup · Free delivery above ${inr(+s.free_delivery_above_paise || 0)}</p></div>
   <img src="/img/hero-stationery.jpg" alt="Inside a stationery and book shop"></section>
  ${d.offers.length ? `<div class="alert good">🎉 <b>Active offers:</b> ${d.offers.map(o => `Use code <b>${esc(o.code)}</b> for ${o.kind === 'percent' ? o.value + '% off' : inr(o.value) + ' off'} on store items${o.min_subtotal_paise ? ' above ' + inr(o.min_subtotal_paise) : ''}`).join(' · ')}</div>` : ''}
  <section class="sec"><div class="sec-head"><h2>Shop by category</h2></div><div class="tiles">
   ${S.categories.map(c => `<a class="tile" href="#/shop?category=${c.slug}"><span class="ic">${esc(c.icon || '📦')}</span>${esc(c.name)}</a>`).join('')}
   <a class="tile" href="#/used"><span class="ic">♻️</span>Second-Hand Books</a>
   <a class="tile" href="#/boards"><span class="ic">🎓</span>Boards & Classes</a>
   <a class="tile" href="#/sell"><span class="ic">💰</span>Sell Your Books</a></div></section>
  ${d.featured.length ? `<section class="sec"><div class="sec-head"><h2>Featured at the store</h2><a href="#/shop">See all →</a></div><div class="grid">${d.featured.map(productCard).join('')}</div></section>` : ''}
  <section class="hero" style="grid-template-columns:.85fr 1.15fr"><img src="/img/used-books.jpg" alt="Second-hand books on a shelf">
   <div class="hero-in"><h2 style="margin-top:0;font-size:28px">Pre-loved books, honest prices</h2>
   <p>Buy used textbooks and novels listed by other customers — every listing is reviewed by the store. Selling? The current marketplace commission is <b>${esc(S.commission?.label || '')}</b>, shown to you before you list.</p>
   <p><a class="btn" href="#/used">Browse Used Books</a> <a class="btn" href="#/sell" style="background:#fff;color:var(--teal)">Sell a Book</a></p></div></section>
  ${d.recent_used.length ? `<section class="sec"><div class="sec-head"><h2>Recently listed second-hand books</h2><a href="#/used">See all →</a></div><div class="grid">${d.recent_used.map(usedCard).join('')}</div></section>` : '<section class="sec"><div class="empty">No second-hand books are listed yet. <a href="#/sell">Be the first to sell one →</a></div></section>'}
  <section class="sec"><div class="sec-head"><h2>New arrivals</h2><a href="#/shop?sort=newest">See all →</a></div>
   ${d.new_arrivals.length ? `<div class="grid">${d.new_arrivals.map(productCard).join('')}</div>` : '<div class="empty">The catalogue is being stocked. <a href="#/contact">Ask us about any book →</a></div>'}</section>
  <section class="sec"><div class="sec-head"><h2>Popular subjects</h2></div><div class="tiles">
   ${metaOpts('subject').slice(0, 8).map(x => `<a class="tile" href="#/shop?subject=${encodeURIComponent(x)}"><span class="ic">📘</span>${esc(x)}</a>`).join('')}</div></section>
  ${d.top_reviews.length ? `<section class="sec"><div class="sec-head"><h2>What customers say</h2></div><div class="grid">${d.top_reviews.map(r => `<div class="panel"><div class="stars">${'★'.repeat(r.rating)}</div><p>“${esc(r.body || r.title)}”</p><p class="meta">— ${esc(r.user_name)} on ${esc(r.product_title || 'a purchase')}${r.verified ? ' · ✔ Verified purchase' : ''}</p></div>`).join('')}</div></section>` : ''}
  <section class="sec panel"><h2 style="margin-top:0">Visit the store</h2>
   <p>📍 ${esc(s.address)}</p>${s.opening_hours ? `<p>🕘 ${esc(s.opening_hours)}</p>` : ''}${s.phone ? `<p>📞 ${esc(s.phone)}</p>` : ''}${s.email ? `<p>✉️ ${esc(s.email)}</p>` : ''}
   <p class="small mut">Delivery: ${s.delivery_enabled === '1' ? `available to PINs ${esc(s.service_pins)} — fee ${inr(+s.delivery_fee_paise)}, free above ${inr(+s.free_delivery_above_paise)}` : 'currently unavailable'} · Pickup: ${s.pickup_enabled === '1' ? 'free at the store counter' : 'unavailable'} · Payment: ${[s.payment_cod === '1' && 'Cash on Delivery', s.payment_store_pay === '1' && 'Pay at Store'].filter(Boolean).join(', ') || 'contact store'}</p>
   <a class="btn pri" href="#/contact">Contact & Directions</a></section>`;
}
let shopState = {};
async function vShop(params) {
  shopState = { q: params.q || '', category: params.category || '', board: params.board || '', class: params.class || '', subject: params.subject || '', language: params.language || '', brand: params.brand || '', sort: params.sort || 'relevance', min: params.min || '', max: params.max || '', instock: params.instock || '', page: +(params.page || 1) };
  app.innerHTML = `<h1 style="margin:6px 0 16px">${shopState.q ? `Results for “${esc(shopState.q)}”` : 'Shop — New Books & Store Products'}</h1>
  <div class="layout"><aside class="filters"><h3>Filters</h3>
    ${[['category', 'Category', S.categories.map(c => [c.slug, c.name])], ['board', 'Board', metaOpts('board').map(v => [v, v])], ['class', 'Class', metaOpts('class').map(v => [v, 'Class ' + v])], ['subject', 'Subject', metaOpts('subject').map(v => [v, v])], ['language', 'Language', metaOpts('language').map(v => [v, v])]]
      .map(([k, lbl, opts]) => `<div class="f-group"><label for="f_${k}">${lbl}</label><select id="f_${k}"><option value="">All</option>${opts.map(([v, t]) => `<option ${shopState[k] === v ? 'selected' : ''} value="${esc(v)}">${esc(t)}</option>`).join('')}</select></div>`).join('')}
    <div class="f-group"><label>Price (₹)</label><div class="two"><input id="f_min" type="number" placeholder="Min" value="${esc(shopState.min)}"><input id="f_max" type="number" placeholder="Max" value="${esc(shopState.max)}"></div></div>
    <div class="f-group"><label><input type="checkbox" id="f_instock" ${shopState.instock ? 'checked' : ''} style="width:auto"> In stock only</label></div>
    <button class="btn pri" style="width:100%;justify-content:center" onclick="applyShop()">Apply Filters</button>
    <p style="text-align:center"><a href="#/shop">Clear all</a></p>
    <div class="alert warn small">Looking for cheaper copies? Check <a href="#/used">second-hand books</a> listed by customers.</div></aside>
   <div><div class="toolbar"><span id="shopCount" class="meta"></span><span>Sort: <select id="f_sort" style="width:auto" onchange="applyShop()">
     ${[['relevance', 'Relevance'], ['price_asc', 'Price: Low to High'], ['price_desc', 'Price: High to Low'], ['newest', 'Newest First'], ['title', 'Title A–Z']].map(([v, t]) => `<option ${shopState.sort === v ? 'selected' : ''} value="${v}">${t}</option>`).join('')}</select></span></div>
    <div id="shopGrid" class="grid"><div class="loading">Searching the shelves…</div></div><div id="shopPager"></div></div></div>`;
  await loadShop();
}
async function loadShop() {
  const p = new URLSearchParams(); Object.entries(shopState).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, k === 'min' || k === 'max' ? Math.round(v * 100) : v); });
  const d = await api('/api/products?' + p);
  $('#shopCount').textContent = `${d.total} product(s)${d.fuzzy ? ' — showing closest matches (check spelling)' : ''}`;
  $('#shopGrid').innerHTML = d.rows.length ? d.rows.map(productCard).join('')
    : `<div class="empty" style="grid-column:1/-1">No products match. Try different filters, or <b>enquire</b> — the store may arrange it for you.<br><br>
       <a class="btn pri" href="#/contact?subject=${encodeURIComponent('Looking for: ' + (shopState.q || 'a product'))}">Enquire About This Item</a>
       <a class="btn ghost" href="#/used${shopState.q ? '?q=' + encodeURIComponent(shopState.q) : ''}">Search Second-Hand</a></div>`;
  $('#shopPager').innerHTML = pager(d.page, d.pages, 'shopPage');
}
window.applyShop = () => { ['category', 'board', 'class', 'subject', 'language', 'min', 'max', 'sort'].forEach(k => shopState[k] = $('#f_' + k).value); shopState.instock = $('#f_instock').checked ? '1' : ''; shopState.page = 1;
  const p = new URLSearchParams(); Object.entries(shopState).forEach(([k, v]) => v && p.set(k, v)); location.hash = '#/shop?' + p; if ($('#shopGrid')) loadShop(); };
window.shopPage = n => { shopState.page = n; loadShop(); scrollTo({ top: 0, behavior: 'smooth' }); };

async function vProduct(slug) {
  const d = await api('/api/products/' + encodeURIComponent(slug)); const p = d.product;
  const icon = CAT_ICON[p.category_slug] || '📦';
  const spec = [['Category', p.category_name], ['Brand', p.brand], ['Author', p.author], ['Publisher', p.publisher], ['Edition', p.edition], ['ISBN', p.isbn], ['SKU', p.sku], ['Board', p.board], ['Class', p.class], ['Subject', p.subject], ['Language', p.language]].filter(([, v]) => v);
  app.innerHTML = `<p class="small"><a href="#/shop">Shop</a> › ${esc(p.category_name || 'Products')} › ${esc(p.title)}</p>
  <div class="pd"><div class="pd-img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}">` : icon}</div>
   <div><span class="tag published">NEW · Sold by Ankit Stationery Mart</span><h1>${esc(p.title)}</h1>
    <div>${stars(d.reviews.length ? (d.reviews.reduce((a, r) => a + r.rating, 0) / d.reviews.length).toFixed(1) : 0, d.reviews.length)}</div>
    <p class="price" style="font-size:30px">${inr(p.price_paise)} ${p.mrp_paise > p.price_paise ? `<s>${inr(p.mrp_paise)}</s> <span class="off-t">${p.discount_pct}% off</span>` : ''}</p>
    <p>${stockTag(p)} ${p.stock > 0 ? `· ${S.settings.pickup_enabled === '1' ? 'Store pickup available' : ''}` : ''}</p>
    <p>${esc(p.description || '')}</p>
    ${spec.length ? `<table class="spec">${spec.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
    ${p.stock > 0 ? `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <span class="qty"><button onclick="qtyAdj(-1,${p.stock})" aria-label="Decrease">−</button><input id="pQty" value="1" inputmode="numeric" aria-label="Quantity"><button onclick="qtyAdj(1,${p.stock})" aria-label="Increase">+</button></span>
      <button class="btn" onclick="addToCart(${p.id},null,+document.getElementById('pQty').value||1)">Add to Cart</button>
      <button class="btn pri" onclick="addToCart(${p.id},null,+document.getElementById('pQty').value||1,true)">Buy Now</button>
      <button class="heart" onclick="toggleWish(this,${p.id},null)">♡ Wishlist</button></div>`
    : `<div class="alert warn">This item is currently out of stock. <button class="btn sm" onclick="notifyMe(${p.id})">Notify Me When Available</button>
       or <a href="#/contact?subject=${encodeURIComponent('Stock enquiry: ' + p.title)}">enquire with the store</a>.</div>`}
    <p class="small mut">Delivery to PINs ${esc(S.settings.service_pins || '')} (fee ${inr(+S.settings.delivery_fee_paise || 0)}, free above ${inr(+S.settings.free_delivery_above_paise || 0)}). Final charges are calculated at checkout.</p>
    <p><a href="#/contact?subject=${encodeURIComponent('Question about: ' + p.title)}&product=${p.id}">❓ Ask a question about this product</a></p>
   </div></div>
  ${d.used_copies.length ? `<section class="sec"><h2>💸 Cheaper second-hand copies</h2><div class="grid">${d.used_copies.map(usedCard).join('')}</div></section>` : ''}
  <section class="sec panel"><h2 style="margin-top:0">Customer reviews</h2>
   ${d.reviews.length ? d.reviews.map(r => `<div class="review"><span class="stars">${'★'.repeat(r.rating)}</span> <b>${esc(r.title)}</b> ${r.verified ? '<span class="tag paid">Verified purchase</span>' : ''}<p>${esc(r.body)}</p><p class="meta">— ${esc(r.user_name)}, ${esc(r.created_at.slice(0, 10))}</p></div>`).join('') : '<p class="mut">No reviews yet.</p>'}
   ${S.user ? `<form onsubmit="return submitReview(event,${p.id})"><h3>Write a review</h3>
     <label class="f">Rating</label><select id="rvRating" style="width:auto">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select>
     <label class="f">Title</label><input id="rvTitle" type="text" maxlength="120"><label class="f">Your review</label><textarea id="rvBody"></textarea>
     <p><button class="btn pri">Submit Review</button></p></form>` : '<p><a href="#/login">Sign in</a> to write a review.</p>'}</section>
  ${d.related.length ? `<section class="sec"><h2>Related products</h2><div class="grid">${d.related.map(productCard).join('')}</div></section>` : ''}`;
}
window.qtyAdj = (d, max) => { const el = $('#pQty'); el.value = Math.min(max, Math.max(1, (+el.value || 1) + d)); };
window.submitReview = async (e, pid) => { e.preventDefault(); try { await api('/api/reviews', { method: 'POST', body: { product_id: pid, rating: +$('#rvRating').value, title: $('#rvTitle').value, body: $('#rvBody').value } }); toast('Review published ✓'); router(); } catch (x) { toast(x.message); } return false; };

let usedState = {};
async function vUsed(params) {
  usedState = { q: params.q || '', board: params.board || '', class: params.class || '', subject: params.subject || '', condition: params.condition || '', sort: params.sort || 'newest', page: 1 };
  app.innerHTML = `<h1 style="margin:6px 0 4px">📚 Second-Hand Book Marketplace</h1>
  <p class="mut">Books listed by <b>customers</b> and reviewed by the store before going live. Each is a single copy — when it's sold, it's gone. Seller contact details are never published. <a href="#/sell">Sell your books →</a></p>
  <div class="layout"><aside class="filters"><h3>Filters</h3>
   <div class="f-group"><label>Search</label><input id="u_q" type="text" value="${esc(usedState.q)}" placeholder="Title, author, ISBN"></div>
   ${[['board', 'Board', metaOpts('board')], ['class', 'Class', metaOpts('class')], ['subject', 'Subject', metaOpts('subject')], ['condition', 'Condition', metaOpts('condition')]]
     .map(([k, l, o]) => `<div class="f-group"><label>${l}</label><select id="u_${k}"><option value="">All</option>${o.map(v => `<option ${usedState[k] === v ? 'selected' : ''} value="${esc(v)}">${esc(COND[v] || v)}</option>`).join('')}</select></div>`).join('')}
   <button class="btn pri" style="width:100%;justify-content:center" onclick="applyUsed()">Apply</button>
   <p style="text-align:center"><a href="#/used">Clear</a></p></aside>
  <div><div class="toolbar"><span id="usedCount" class="meta"></span><span>Sort: <select id="u_sort" style="width:auto" onchange="applyUsed()">
   ${[['newest', 'Newest'], ['price_asc', 'Price: Low to High'], ['price_desc', 'Price: High to Low']].map(([v, t]) => `<option ${usedState.sort === v ? 'selected' : ''} value="${v}">${t}</option>`).join('')}</select></span></div>
   <div id="usedGrid" class="grid"></div><div id="usedPager"></div></div></div>`;
  await loadUsed();
}
async function loadUsed() { const p = new URLSearchParams(); Object.entries(usedState).forEach(([k, v]) => v && p.set(k, v));
  const d = await api('/api/listings?' + p); $('#usedCount').textContent = d.total + ' used book(s) available';
  $('#usedGrid').innerHTML = d.rows.length ? d.rows.map(usedCard).join('') : '<div class="empty" style="grid-column:1/-1">No second-hand books match right now. Try fewer filters — or <a href="#/sell">list a book to sell</a>.</div>';
  $('#usedPager').innerHTML = pager(d.page, d.pages, 'usedPage'); }
window.applyUsed = () => { ['q', 'board', 'class', 'subject', 'condition', 'sort'].forEach(k => usedState[k] = $('#u_' + k).value); usedState.page = 1; loadUsed(); };
window.usedPage = n => { usedState.page = n; loadUsed(); };
async function vUsedDetail(id) {
  const d = await api('/api/listings/' + id); const l = d.listing; const img = (l.images || [])[0];
  const spec = [['Author', l.author], ['ISBN', l.isbn], ['Edition', l.edition], ['Board', l.board], ['Class', l.class], ['Subject', l.subject], ['Language', l.language], ['Condition', COND[l.condition_grade] || l.condition_grade], ['Wear / defects (as disclosed by seller)', l.defects], ['Seller', l.seller_name + ' (customer — contact via store)']].filter(([, v]) => v);
  app.innerHTML = `<p class="small"><a href="#/used">Second-Hand Books</a> › ${esc(l.title)}</p>
  <div class="pd"><div class="pd-img">${img ? `<img src="${esc(img)}" alt="${esc(l.title)}">` : '📖'}</div>
   <div><span class="tag ${esc(l.status)}">${l.status === 'active' ? 'USED · Available (single copy)' : 'USED · ' + esc(l.status.replace(/_/g, ' '))}</span>
    <h1>${esc(l.title)}</h1><p class="price" style="font-size:30px">${inr(l.price_paise)}</p>
    <p>${esc(l.description || '')}</p><table class="spec">${spec.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    <div class="alert warn small"><b>Marketplace purchase:</b> this book is owned by a customer, not the store. You pay the listed price (+ any delivery fee). The store deducts its disclosed commission (${esc(d.commission.label)}) from the <i>seller's</i> proceeds — it is not added to your price. Fulfilment is handled via the store.</div>
    ${l.status === 'active' ? `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn pri" onclick="addToCart(null,${l.id},1,true)">Buy This Copy</button><button class="btn" onclick="addToCart(null,${l.id})">Add to Cart</button><button class="heart" onclick="toggleWish(this,null,${l.id})">♡ Wishlist</button></div>` : '<p class="stock-out">This copy is no longer available.</p>'}
    ${S.user ? `<p style="margin-top:16px"><button class="btn sm ghost" onclick="reportListing(${l.id})">🚩 Report this listing</button></p>` : ''}
   </div></div>
  ${d.similar.length ? `<section class="sec"><h2>Similar used books</h2><div class="grid">${d.similar.map(usedCard).join('')}</div></section>` : ''}`;
}
window.reportListing = async id => { const r = prompt('What is wrong with this listing?'); if (!r) return;
  try { const d = await api(`/api/listings/${id}/report`, { method: 'POST', body: { reason: r } }); toast(d.message); } catch (e) { toast(e.message); } };

async function vSell(params) {
  if (!S.user) { app.innerHTML = `<div class="panel" style="max-width:560px;margin:30px auto;text-align:center"><h1>Sell your books</h1>
    <p>You need an account so the store can review your listing and settle your payment when the book sells.</p>
    <a class="btn pri" href="#/login?next=sell">Sign In</a> <a class="btn" href="#/register?next=sell">Create Account</a></div>`; return; }
  const c = S.commission; const editId = params.edit;
  let ex = null; if (editId) { const d = await api('/api/my/sales'); ex = d.listings.find(x => x.id == editId); }
  const v = k => esc(ex?.[k] || '');
  const sel = (k, opts, cur) => `<select id="s_${k}"><option value="">—</option>${opts.map(o => `<option ${cur === o ? 'selected' : ''} value="${esc(o)}">${esc(COND[o] || o)}</option>`).join('')}</select>`;
  app.innerHTML = `<h1>${ex ? 'Edit listing' : 'Sell a second-hand book'}</h1>
  <div class="split"><form class="panel" onsubmit="return submitListing(event,${ex ? ex.id : 'null'})">
   <div class="alert good small"><b>Commission, upfront:</b> ${esc(c.label)}. If your book sells for ₹<span id="feeDemo">200</span>, the store keeps <b id="feeAmt"></b> and you receive <b id="feeNet"></b>. The exact rule is frozen into the sale record, so later policy changes never alter your completed sale. Settlement is made by the store after delivery is confirmed (track it under Account → My Sales).</div>
   <label class="f">Book title *</label><input id="s_title" type="text" required value="${v('title')}">
   <div class="two"><div><label class="f">Author</label><input id="s_author" type="text" value="${v('author')}"></div>
   <div><label class="f">ISBN (if known)</label><input id="s_isbn" type="text" value="${v('isbn')}"></div></div>
   <div class="three"><div><label class="f">Board</label>${sel('board', metaOpts('board'), ex?.board)}</div>
   <div><label class="f">Class</label>${sel('class', metaOpts('class'), ex?.class)}</div>
   <div><label class="f">Subject</label>${sel('subject', metaOpts('subject'), ex?.subject)}</div></div>
   <div class="three"><div><label class="f">Language</label>${sel('language', metaOpts('language'), ex?.language)}</div>
   <div><label class="f">Condition *</label>${sel('condition_grade', metaOpts('condition').length ? metaOpts('condition') : Object.keys(COND), ex?.condition_grade || 'good')}</div>
   <div><label class="f">Edition / year</label><input id="s_edition" type="text" value="${v('edition')}"></div></div>
   <label class="f">Wear, markings or defects — be honest *</label><textarea id="s_defects" placeholder="e.g. Pencil marks on 2 pages, spine slightly creased, no missing pages">${v('defects')}</textarea>
   <label class="f">Description</label><textarea id="s_description">${v('description')}</textarea>
   <label class="f">Photo</label><input type="file" id="s_photo" accept="image/*"><p class="small mut">…or paste image URLs (one per line):</p>
   <textarea id="s_images" style="min-height:56px">${esc((ex?.images || []).join('\n'))}</textarea>
   <label class="f">Your asking price (₹) *</label><input id="s_price" type="number" min="1" step="1" required value="${ex ? rs(ex.price_paise) : 200}" oninput="feeCalc()">
   <p class="small">You will receive <b id="feeNet2"></b> after commission if it sells at this price.</p>
   <p class="small mut">${S.settings.marketplace_moderation === '1' ? 'Listings are reviewed by the store before going live.' : 'Listings go live immediately.'} Your phone/address are never shown publicly.</p>
   <button class="btn" name="mode" value="draft">Save Draft</button> <button class="btn pri" name="mode" value="submit">Submit for Review</button>
  </form>
  <aside class="panel"><h3 style="margin-top:0">How selling works</h3><ol class="small" style="line-height:1.9">
   <li>List your book with honest condition details.</li><li>The store reviews and approves it.</li>
   <li>A buyer orders it — the copy is <b>reserved</b> instantly so it can't be sold twice.</li>
   <li>Bring/hand over the book as instructed by the store; delivery is confirmed.</li>
   <li>Your proceeds appear under <b>Account → My Sales</b>; the store settles with you and marks it paid.</li></ol>
   <p><a class="btn ghost" href="#/account?tab=listings">Manage My Listings</a></p></aside></div>`;
  window.feeCalc = () => { const p = (+$('#s_price').value || 0) * 100; const fee = c.kind === 'percent' ? Math.round(p * c.value / 100) : Math.min(c.value, p);
    $('#feeAmt').textContent = inr(fee); $('#feeNet').textContent = inr(p - fee); $('#feeNet2').textContent = inr(p - fee); $('#feeDemo').textContent = rs(p); };
  feeCalc();
}
window.submitListing = async (e, editId) => { e.preventDefault();
  const submit = e.submitter?.value === 'submit';
  let images = $('#s_images').value.split('\n').map(x => x.trim()).filter(Boolean);
  const f = $('#s_photo').files[0];
  try { if (f) { const dataUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(f); });
      const up = await api('/api/upload', { method: 'POST', body: { dataUrl } }); images = [up.url, ...images]; }
    const body = { title: $('#s_title').value, author: $('#s_author').value, isbn: $('#s_isbn').value, edition: $('#s_edition').value,
      board: $('#s_board').value, class: $('#s_class').value, subject: $('#s_subject').value, language: $('#s_language').value,
      condition_grade: $('#s_condition_grade').value || 'good', defects: $('#s_defects').value, description: $('#s_description').value,
      price_paise: Math.round((+$('#s_price').value || 0) * 100), images, submit };
    if (editId) { await api('/api/listings/' + editId, { method: 'PATCH', body }); if (submit) await api(`/api/listings/${editId}/action`, { method: 'POST', body: { action: 'submit' } }); toast('Listing updated ✓'); }
    else { const d = await api('/api/listings', { method: 'POST', body }); toast(d.message); }
    location.hash = '#/account?tab=listings'; router();
  } catch (x) { toast(x.message); } return false; };

function boardsView() {
  app.innerHTML = `<h1>🎓 Shop by Board, Class & Subject</h1>
  <p class="mut">Pick your board and class to see books currently in stock. Availability shown is live — if a title is missing, send a stock enquiry and the store will try to arrange it. We never claim a book is in stock when it isn't.</p>
  ${metaOpts('board').map(b => `<section class="sec"><h2>${esc(b)}</h2><div class="tiles">${metaOpts('class').map(c => `<a class="tile" href="#/shop?board=${encodeURIComponent(b)}&class=${encodeURIComponent(c)}"><span class="ic">🎒</span>Class ${esc(c)}</a>`).join('')}</div></section>`).join('')}`;
}
function enquiryForm(kind, title, preset = {}) {
  return `<form class="panel" onsubmit="return submitEnquiry(event,'${kind}')" style="max-width:680px">
   <h1 style="margin-top:0">${title}</h1><input type="hidden" id="e_product" value="${preset.product || ''}">
   ${S.user ? '' : '<div class="two"><div><label class="f">Your name *</label><input id="e_name" type="text" required></div><div><label class="f">Phone or email *</label><input id="e_contact" type="text" required></div></div>'}
   <label class="f">Subject *</label><input id="e_subject" type="text" required value="${esc(preset.subject || '')}">
   <label class="f">Message *</label><textarea id="e_message" required placeholder="${kind === 'bulk' ? 'School/organisation, items needed, quantities, required-by date…' : 'How can the store help?'}"></textarea>
   <input type="text" id="e_website" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">
   <p class="small mut">An enquiry is <b>not</b> a confirmed order. The store replies with availability and a quote.</p>
   <button class="btn pri">Send Enquiry</button></form>`;
}
window.submitEnquiry = async (e, kind) => { e.preventDefault(); try {
  const d = await api('/api/enquiries', { method: 'POST', body: { kind, subject: $('#e_subject').value, message: $('#e_message').value,
    guest_name: $('#e_name')?.value, guest_contact: $('#e_contact')?.value, website: $('#e_website').value, product_id: +$('#e_product').value || null } });
  app.innerHTML = `<div class="panel" style="text-align:center;max-width:560px;margin:40px auto"><h1>✅ Enquiry sent</h1><p>${esc(d.message)}</p><a class="btn" href="#/">Back to Home</a></div>`;
 } catch (x) { toast(x.message); } return false; };
function vBulk() { app.innerHTML = `<div class="split"><div>${enquiryForm('bulk', '🏫 Bulk Orders & School Lists')}</div>
 <aside class="panel"><h3 style="margin-top:0">For schools, coaching centres & offices</h3><ul class="small" style="line-height:1.9"><li>Complete class book-sets and school lists</li><li>Notebook & stationery packs in quantity</li><li>Office paper and supplies</li></ul><p class="small mut">Share your list and quantities — the store replies with a quote. No price is promised until confirmed in the reply.</p></aside></div>`; }
function vContact(params) { const s = S.settings; app.innerHTML = `<div class="split"><div>${enquiryForm(params.product ? 'product_question' : 'contact', '✉️ Contact the Store', params)}</div>
 <aside class="panel"><h3 style="margin-top:0">Visit us</h3><p>📍 ${esc(s.address)}</p>${s.phone ? `<p>📞 ${esc(s.phone)}</p>` : ''}${s.email ? `<p>✉️ ${esc(s.email)}</p>` : ''}${s.opening_hours ? `<p>🕘 ${esc(s.opening_hours)}</p>` : ''}
 <p><a class="btn pri" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Ankit Stationery Mart, 147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India')}">Open in Google Maps</a></p>
 <h4>Delivery areas</h4><p class="small">Serviceable PIN codes: ${esc(s.service_pins || '—')}. Outside these, choose store pickup or send an enquiry.</p></aside></div>`; }
function policyText(key, fallback) { const t = S.settings[key]; return t ? t.split('\n').filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('') : `<div class="alert warn">${fallback}</div>`; }
function vStatic(kind) {
  const s = S.settings;
  const pages = {
    about: ['About Ankit Stationery Mart', () => policyText('about', 'The store has not published its story yet. Visit us at ' + esc(s.address) + '.') + `<p>📍 ${esc(s.address)}</p>`],
    faq: ['Frequently Asked Questions', () => policyText('faq', '') + `<h3>How does delivery work?</h3><p>We deliver to PIN codes ${esc(s.service_pins)}. Delivery fee is ${inr(+s.delivery_fee_paise || 0)}, free on orders above ${inr(+s.free_delivery_above_paise || 0)}. Store pickup is free.</p><h3>How do I pay?</h3><p>${[s.payment_cod === '1' && 'Cash on Delivery', s.payment_store_pay === '1' && 'Pay at Store pickup'].filter(Boolean).join(' or ') || 'Contact the store'}. ${s.payment_online === '1' ? '' : 'Online payment is not configured yet.'}</p><h3>How does selling a book work?</h3><p>Create an account, list your book, the store reviews it, and when it sells you receive the price minus the disclosed commission (${esc(S.commission?.label || '')}).</p><h3>Can I return an item?</h3><p>See the <a href="#/policy/returns">Delivery & Returns</a> page, then request a return from your order page.</p>`],
    returns: ['Delivery & Returns', () => policyText('return_policy', 'The store has not published a detailed return policy yet. Delivered orders can request a return from Account → Orders; the store reviews each request and records the decision. For help, contact the store before returning any item.') + `<h3>Delivery charges</h3><p>Fee ${inr(+s.delivery_fee_paise || 0)} · free above ${inr(+s.free_delivery_above_paise || 0)} · Serviceable PINs: ${esc(s.service_pins)} · Store pickup: free.</p>`],
    privacy: ['Privacy Policy', () => policyText('privacy_policy', 'The store has not published a privacy policy yet. In brief: we store only the account, address and order details needed to serve you; passwords are hashed; seller contact details are never shown in public listings; we do not sell personal data.')],
    terms: ['Terms of Use', () => policyText('terms', 'The store has not published detailed terms yet. Orders are confirmed by the store before fulfilment; marketplace listings are sold by individual customers under the store\u2019s disclosed commission; prices and stock are verified server-side at checkout.')],
  };
  const [t, fn] = pages[kind] || pages.about; app.innerHTML = `<article class="panel" style="max-width:860px"><h1>${t}</h1>${fn()}</article>`;
}

/* ---------------- auth views ---------------- */
function authCard(html) { app.innerHTML = `<div class="panel" style="max-width:460px;margin:26px auto">${html}</div>`; }
function vLogin(params) { authCard(`<h1 style="margin-top:0">Sign in</h1><form onsubmit="return doLogin(event,'${esc(params.next || '')}')">
 <label class="f">Email</label><input id="a_email" type="email" required autocomplete="email">
 <label class="f">Password</label><input id="a_pw" type="password" required autocomplete="current-password">
 <p><button class="btn pri" style="width:100%;justify-content:center">Sign In</button></p></form>
 <p class="small">New here? <a href="#/register">Create an account</a> · <a href="#/recover">Forgot password?</a></p>
 <div class="alert warn small"><b>Demo logins</b> (remove after launch):<br>Owner/Admin: <code>demo@example.com</code><br>Customer: <code>Aarav@example.com</code> · Seller: <code>Meera@example.com</code><br>Password for all: <code>Demo@1234</code></div>`); }
window.doLogin = async (e, next) => { e.preventDefault(); try { const d = await api('/api/auth/login', { method: 'POST', body: { email: $('#a_email').value, password: $('#a_pw').value } });
  S.csrf = d.csrf; await bootstrap(); toast('Welcome back, ' + d.user.name + ' ✓');
  location.hash = next === 'sell' ? '#/sell' : (d.user.role !== 'customer' ? '#/admin' : '#/account'); router(); } catch (x) { toast(x.message); } return false; };
function vRegister(params) { authCard(`<h1 style="margin-top:0">Create account</h1><form onsubmit="return doRegister(event,'${esc(params.next || '')}')">
 <label class="f">Full name</label><input id="a_name" type="text" required><label class="f">Email</label><input id="a_email" type="email" required>
 <label class="f">Mobile (optional)</label><input id="a_phone" type="tel"><label class="f">Password (8+ characters)</label><input id="a_pw" type="password" required minlength="8">
 <p><button class="btn pri" style="width:100%;justify-content:center">Create Account</button></p></form><p class="small">Already registered? <a href="#/login">Sign in</a></p>`); }
window.doRegister = async (e, next) => { e.preventDefault(); try { const d = await api('/api/auth/register', { method: 'POST', body: { name: $('#a_name').value, email: $('#a_email').value, phone: $('#a_phone').value, password: $('#a_pw').value } });
  S.csrf = d.csrf; await bootstrap(); toast('Account created — welcome! ✓'); location.hash = next === 'sell' ? '#/sell' : '#/account'; router(); } catch (x) { toast(x.message); } return false; };
function vRecover() { authCard(`<h1 style="margin-top:0">Account recovery</h1><form onsubmit="return doRecover(event)">
 <label class="f">Registered email</label><input id="a_email" type="email" required><p><button class="btn pri" style="width:100%;justify-content:center">Request Recovery</button></p></form>
 <p class="small mut">Email sending is not configured yet, so recovery is staff-assisted: your request is recorded, and store staff can verify your identity and issue a one-time reset link. Have a reset link already? Open it directly.</p>`); }
window.doRecover = async e => { e.preventDefault(); try { const d = await api('/api/auth/recover', { method: 'POST', body: { email: $('#a_email').value } }); toast(d.message, 8000); } catch (x) { toast(x.message); } return false; };
function vReset(params) { authCard(`<h1 style="margin-top:0">Set a new password</h1><form onsubmit="return doReset(event,'${esc(params.token || '')}')">
 <label class="f">New password (8+ characters)</label><input id="a_pw" type="password" required minlength="8"><p><button class="btn pri" style="width:100%;justify-content:center">Update Password</button></p></form>`); }
window.doReset = async (e, token) => { e.preventDefault(); try { const d = await api('/api/auth/reset', { method: 'POST', body: { token, password: $('#a_pw').value } }); toast(d.message); location.hash = '#/login'; router(); } catch (x) { toast(x.message); } return false; };

/* ---------------- cart / checkout ---------------- */
async function vCart() {
  const d = await api('/api/cart'); const c = d.cart;
  if (!c.items.length) { app.innerHTML = `<div class="empty"><h1>🛒 Your cart is empty</h1><p>Browse new stock or bargain second-hand books.</p><a class="btn pri" href="#/shop">Shop Products</a> <a class="btn" href="#/used">Used Books</a></div>`; return; }
  app.innerHTML = `<h1>🛒 Your Cart</h1><div class="split"><div class="panel">
   ${c.items.map(i => `<div class="cart-row"><div style="flex:1;min-width:200px"><b>${esc(i.title || '(removed item)')}</b>
     <div class="meta">${i.kind === 'marketplace' ? '♻️ Second-hand (single copy)' : 'Store product'} · ${inr(i.price_paise)} each</div>
     ${i.available ? '' : '<div class="alert bad small">⚠ No longer available in this quantity — please remove or reduce it.</div>'}</div>
    ${i.kind === 'store' ? `<span class="qty"><button onclick="cartQty(${i.id},${i.qty - 1})">−</button><input value="${i.qty}" readonly aria-label="qty"><button onclick="cartQty(${i.id},${i.qty + 1})">+</button></span>` : '<span class="tag">Qty 1</span>'}
    <b>${inr(i.line_total_paise)}</b><button class="btn sm danger" onclick="cartQty(${i.id},0)">Remove</button></div>`).join('')}
   <p class="small mut">Prices and stock are re-validated on our server at checkout — if anything changed, we'll tell you before you pay.</p></div>
  <aside class="panel summary"><h3 style="margin-top:0">Order summary</h3>
   <div><span>Subtotal</span><b>${inr(c.subtotal_paise)}</b></div>
   <div><span>Delivery</span><span>Calculated at checkout (free above ${inr(+S.settings.free_delivery_above_paise || 0)}; pickup free)</span></div>
   <label class="f">Discount code (store items)</label><div style="display:flex;gap:8px"><input id="promo" type="text" placeholder="e.g. SCHOOL10"><button class="btn sm ghost" onclick="applyPromo()">Apply</button></div>
   <div id="promoOut"></div>
   <div class="tot"><span>Payable (excl. delivery)</span><span id="cartTotal">${inr(c.subtotal_paise)}</span></div>
   <p><a class="btn pri" href="#/checkout" style="width:100%;justify-content:center">Proceed to Checkout →</a></p>
   <p style="text-align:center"><a href="#/shop">Continue shopping</a></p></aside></div>`;
}
window.cartQty = async (id, qty) => { try { const d = await api('/api/cart/' + id, { method: 'PATCH', body: { qty } }); $('#cartBadge').textContent = d.cart.count; vCart(); } catch (e) { toast(e.message); } };
window.applyPromo = async () => { try { const d = await api('/api/cart/quote', { method: 'POST', body: { promo_code: $('#promo').value, fulfilment: 'pickup' } });
  sessionStorage.setItem('asm_promo', $('#promo').value.toUpperCase());
  $('#promoOut').innerHTML = `<div class="alert good">Code applied: −${inr(d.discount_paise)}</div>`; $('#cartTotal').textContent = inr(d.total_paise); }
  catch (e) { $('#promoOut').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; } };
const IDEM = () => 'w-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
async function vCheckout() {
  const d = await api('/api/cart'); if (!d.cart.items.length) { location.hash = '#/cart'; router(); return; }
  let me = null; if (S.user) me = await api('/api/me');
  const s = S.settings; sessionStorage.setItem('asm_idem', IDEM());
  app.innerHTML = `<h1>Checkout</h1><form onsubmit="return placeOrder(event)"><div class="split"><div>
   <section class="panel"><h3 style="margin-top:0">1 · How will you get your order?</h3>
    ${s.delivery_enabled === '1' ? `<label style="display:block;padding:6px 0"><input type="radio" name="ff" value="delivery" checked onchange="ffToggle()" style="width:auto"> 🚚 Home delivery (PINs ${esc(s.service_pins)} · ${inr(+s.delivery_fee_paise)}, free above ${inr(+s.free_delivery_above_paise)})</label>` : ''}
    ${s.pickup_enabled === '1' ? `<label style="display:block;padding:6px 0"><input type="radio" name="ff" value="pickup" ${s.delivery_enabled !== '1' ? 'checked' : ''} onchange="ffToggle()" style="width:auto"> 🏪 Store pickup — ${esc(s.address)} (free)</label>` : ''}
    <div id="addrBox">
    ${me && me.addresses.length ? `<label class="f">Saved address</label><select id="co_addr">${me.addresses.map(a => `<option value="${a.id}">${esc(a.label)} — ${esc(a.name)}, ${esc(a.line)}, ${esc(a.city)} ${esc(a.pin)}</option>`).join('')}<option value="">Enter a new address below</option></select>` : '<input type="hidden" id="co_addr" value="">'}
    <div class="two"><div><label class="f">Full name</label><input id="co_name" type="text" value="${esc(S.user?.name || '')}"></div>
    <div><label class="f">Mobile</label><input id="co_phone" type="tel" value="${esc(me?.user?.phone || '')}"></div></div>
    <label class="f">Address</label><input id="co_line" type="text" placeholder="House no, street, area">
    <div class="three"><div><label class="f">City</label><input id="co_city" type="text" value="Jalandhar Cantt"></div>
    <div><label class="f">PIN code</label><input id="co_pin" type="text" maxlength="6" value="${esc(localStorage.getItem('asm_pin') || '')}"></div>
    <div><label class="f">State</label><input id="co_state" type="text" value="Punjab"></div></div>
    ${S.user ? '' : '<label class="f">Email (for order updates)</label><input id="co_email" type="email">'}
    </div>
    <label class="f">Order notes / delivery instructions</label><textarea id="co_notes" style="min-height:56px" placeholder="Optional"></textarea></section>
   <section class="panel" style="margin-top:16px"><h3 style="margin-top:0">2 · Payment</h3>
    ${s.payment_cod === '1' ? `<label style="display:block;padding:6px 0"><input type="radio" name="pay" value="cod" checked style="width:auto"> 💵 Cash on Delivery</label>` : ''}
    ${s.payment_store_pay === '1' ? `<label style="display:block;padding:6px 0"><input type="radio" name="pay" value="store_pay" ${s.payment_cod !== '1' ? 'checked' : ''} style="width:auto"> 🏪 Pay at Store (on pickup)</label>` : ''}
    <label style="display:block;padding:6px 0;opacity:.6"><input type="radio" disabled style="width:auto"> 💳 Online payment — ${esc(s.online_payment_note || 'not configured')}</label>
    <p class="small mut">No card details are ever collected on this website.</p></section></div>
  <aside class="panel summary"><h3 style="margin-top:0">3 · Review & place order</h3>
   ${d.cart.items.map(i => `<div><span>${esc(i.title)} × ${i.qty}${i.kind === 'marketplace' ? ' (used)' : ''}</span><b>${inr(i.line_total_paise)}</b></div>`).join('')}
   <label class="f">Discount code</label><input id="co_promo" type="text" value="${esc(sessionStorage.getItem('asm_promo') || '')}" oninput="reQuote()">
   <div id="quoteBox"></div>
   <p><button class="btn pri" id="placeBtn" style="width:100%;justify-content:center">Place Order</button></p>
   <p class="small mut">By placing this order you agree to the store's <a href="#/policy/terms" target="_blank">terms</a>. The final amount is recomputed on our server from live prices & stock.</p>
  </aside></div></form>`;
  window.ffToggle = () => { $('#addrBox').style.display = document.querySelector('input[name=ff]:checked').value === 'pickup' ? 'none' : ''; if (document.querySelector('input[name=ff]:checked').value === 'pickup' && !S.user) { $('#addrBox').style.display = ''; } reQuote(); };
  window.reQuote = async () => { try { const q = await api('/api/cart/quote', { method: 'POST', body: { promo_code: $('#co_promo').value, fulfilment: document.querySelector('input[name=ff]:checked')?.value || 'pickup' } });
    $('#quoteBox').innerHTML = `<div><span>Subtotal</span><b>${inr(q.cart.subtotal_paise)}</b></div><div><span>Discount</span><b>−${inr(q.discount_paise)}</b></div><div><span>Delivery</span><b>${q.delivery_fee_paise ? inr(q.delivery_fee_paise) : 'FREE'}</b></div><div class="tot"><span>Total payable</span><span>${inr(q.total_paise)}</span></div>`;
    $('#placeBtn').textContent = 'Place Order · ' + inr(q.total_paise); } catch (e) { $('#quoteBox').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; } };
  ffToggle();
}
window.placeOrder = async e => { e.preventDefault(); const btn = $('#placeBtn'); btn.disabled = true; btn.textContent = 'Placing order…';
  const ff = document.querySelector('input[name=ff]:checked')?.value || 'pickup';
  const body = { fulfilment: ff, payment_method: document.querySelector('input[name=pay]:checked')?.value || 'cod',
    promo_code: $('#co_promo').value, notes: $('#co_notes').value, idempotency_key: sessionStorage.getItem('asm_idem'),
    address_id: +($('#co_addr')?.value) || null, name: $('#co_name')?.value, phone: $('#co_phone')?.value, line: $('#co_line')?.value,
    city: $('#co_city')?.value, pin: $('#co_pin')?.value, state: $('#co_state')?.value, email: $('#co_email')?.value };
  try { const d = await api('/api/checkout', { method: 'POST', body }); sessionStorage.removeItem('asm_promo');
    $('#cartBadge').textContent = '0'; sessionStorage.setItem('asm_last_order', JSON.stringify({ ref: d.ref, phone: body.phone || '' }));
    location.hash = '#/success/' + d.ref; router(); }
  catch (x) { toast(x.message, 6000); btn.disabled = false; btn.textContent = 'Place Order'; } return false; };
function vSuccess(ref) { app.innerHTML = `<div class="panel" style="text-align:center;max-width:600px;margin:36px auto">
 <h1>🎉 Order placed!</h1><p>Your order reference is</p><p style="font-size:26px;font-weight:800">${esc(ref)}</p>
 <p class="mut">Status starts as <b>Pending</b> — the store will confirm it shortly. ${S.user ? 'Track it any time under Account → Orders.' : 'Save this reference and your phone number to track your order.'}</p>
 <p><a class="btn pri" href="${S.user ? '#/account?tab=orders' : '#/track'}">Track My Order</a> <a class="btn ghost" href="#/shop">Continue Shopping</a></p></div>`; }
function vTrack() { const last = JSON.parse(sessionStorage.getItem('asm_last_order') || '{}');
  app.innerHTML = `<div class="panel" style="max-width:620px;margin:16px auto"><h1 style="margin-top:0">Track your order</h1>
  <form onsubmit="return doTrack(event)"><label class="f">Order reference</label><input id="t_ref" type="text" required value="${esc(last.ref || '')}" placeholder="ASM-20260101-0001">
  <label class="f">Phone used for the order ${S.user ? '(optional when signed in)' : ''}</label><input id="t_phone" type="tel" value="${esc(last.phone || '')}">
  <p><button class="btn pri">Track</button></p></form><div id="trackOut"></div></div>`; }
window.doTrack = async e => { e.preventDefault(); try { const d = await api(`/api/orders/track?ref=${encodeURIComponent($('#t_ref').value)}&phone=${encodeURIComponent($('#t_phone').value)}`);
  $('#trackOut').innerHTML = orderDetailHtml(d.order, false); } catch (x) { $('#trackOut').innerHTML = `<div class="alert bad">${esc(x.message)}</div>`; } return false; };
function orderDetailHtml(o, mine) {
  const steps = o.fulfilment === 'pickup' ? ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'delivered'] : ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
  const idx = steps.indexOf(o.status);
  return `<div class="panel" style="margin-top:14px"><h3 style="margin-top:0">Order ${esc(o.ref)} <span class="tag ${esc(o.status)}">${esc(o.status.replace(/_/g, ' '))}</span></h3>
  ${idx >= 0 ? `<p>${steps.map((x, i) => `<span class="tag ${i <= idx ? 'paid' : ''}">${x.replace(/_/g, ' ')}</span>`).join(' → ')}</p>` : ''}
  <p class="small mut">Placed ${esc(o.created_at.slice(0, 16))} · ${o.fulfilment === 'pickup' ? '🏪 Store pickup' : '🚚 Delivery'} · Payment: ${esc(o.payment_method)} (${esc(o.payment_status)})${o.tracking_ref ? ' · Tracking ref: ' + esc(o.tracking_ref) : ''}</p>
  <table class="spec">${o.items.map(i => `<tr><td>${esc(i.title_snapshot)} × ${i.qty}${i.kind === 'marketplace' ? ' <span class="tag">second-hand</span>' : ''}</td><td>${inr(i.line_total_paise)}</td></tr>`).join('')}
  <tr><td>Subtotal − discount + delivery</td><td>${inr(o.subtotal_paise)} − ${inr(o.discount_paise)} + ${inr(o.delivery_fee_paise)}</td></tr><tr><td><b>Total</b></td><td><b>${inr(o.total_paise)}</b></td></tr></table>
  ${o.address?.line ? `<p class="small"><b>Deliver to:</b> ${esc(o.address.name)}, ${esc(o.address.line)}, ${esc(o.address.city)} — ${esc(o.address.pin)} (${esc(o.address.phone)})</p>` : ''}
  <h4>Status history</h4><div class="timeline">${o.events.map(ev => `<div><b>${esc(ev.status.replace(/_/g, ' '))}</b> <span class="mut small">${esc(ev.created_at.slice(0, 16))}</span>${ev.note ? `<br><span class="small">${esc(ev.note)}</span>` : ''}</div>`).join('')}</div>
  ${mine ? `<p style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm ghost" href="/api/orders/${o.id}/invoice" target="_blank">🧾 Invoice</a>
   <button class="btn sm" onclick="reorder('${o.ref}')">↻ Reorder</button>
   ${['pending', 'confirmed'].includes(o.status) ? `<button class="btn sm danger" onclick="cancelOrder('${o.ref}')">Cancel Order</button>` : ''}
   ${o.status === 'delivered' ? `<button class="btn sm ghost" onclick="returnOrder('${o.ref}')">Request Return</button>` : ''}</p>` : ''}</div>`;
}
window.cancelOrder = async ref => { if (!confirm('Cancel this order? Stock will be released.')) return; try { await api(`/api/my/orders/${ref}/cancel`, { method: 'POST', body: {} }); toast('Order cancelled'); router(); } catch (e) { toast(e.message); } };
window.returnOrder = async ref => { const r = prompt('Reason for return:'); if (!r) return; try { const d = await api(`/api/my/orders/${ref}/return`, { method: 'POST', body: { reason: r } }); toast(d.message, 5000); router(); } catch (e) { toast(e.message); } };
window.reorder = async ref => { try { const d = await api(`/api/my/orders/${ref}/reorder`, { method: 'POST', body: {} }); toast(d.message); if (d.added) { $('#cartBadge').textContent = d.cart.count; location.hash = '#/cart'; router(); } } catch (e) { toast(e.message); } };

/* ---------------- account ---------------- */
async function vAccount(params) {
  if (!S.user) { location.hash = '#/login'; router(); return; }
  const tab = params.tab || 'orders'; const me = await api('/api/me');
  const T = [['orders', '📦 Orders'], ['wishlist', '♡ Wishlist'], ['listings', '📚 My Listings'], ['sales', '💰 My Sales'], ['addresses', '📍 Addresses'], ['support', '🎧 Support'], ['notifications', `🔔 Alerts${me.counts.unread ? ' (' + me.counts.unread + ')' : ''}`], ['profile', '👤 Profile & Security']];
  let body = '';
  if (tab === 'orders') { const d = await api('/api/my/orders');
    body = d.orders.length ? d.orders.map(o => orderDetailHtml(o, true)).join('') : '<div class="empty">No orders yet. <a href="#/shop">Start shopping →</a></div>'; }
  else if (tab === 'wishlist') { const d = await api('/api/wishlist');
    body = `<div class="grid">${d.items.map(i => i.product_id ? `<article class="card"><div class="card-b"><h3><a href="#/product/${i.slug}">${esc(i.title)}</a></h3><div class="price">${inr(i.price_paise)}</div></div><div class="card-f"><button class="btn sm" onclick="addToCart(${i.product_id})">Add to Cart</button></div></article>`
      : `<article class="card"><div class="card-b"><h3><a href="#/used/${i.listing_id}">${esc(i.title)} (used)</a></h3><div class="price">${inr(i.price_paise)}</div></div><div class="card-f"><button class="btn sm pri" onclick="addToCart(null,${i.listing_id})">Add to Cart</button></div></article>`).join('') || '<div class="empty">Wishlist is empty.</div>'}</div>`; }
  else if (tab === 'listings' || tab === 'sales') { const d = await api('/api/my/sales');
    if (tab === 'listings') body = `<p><a class="btn pri" href="#/sell">+ List a Book</a></p>` +
      (d.listings.length ? `<div class="tblwrap"><table class="dt"><tr><th>Book</th><th>Price</th><th>Status</th><th>Store note</th><th>Actions</th></tr>
      ${d.listings.map(l => `<tr><td><b>${esc(l.title)}</b><br><span class="meta">${esc(COND[l.condition_grade] || l.condition_grade)} · ${esc(l.defects || '')}</span></td><td>${inr(l.price_paise)}</td>
       <td><span class="tag ${esc(l.status)}">${esc(l.status.replace(/_/g, ' '))}</span></td><td>${esc(l.moderator_note || '')}</td>
       <td style="white-space:nowrap">${['draft', 'rejected'].includes(l.status) ? `<a class="btn sm ghost" href="#/sell?edit=${l.id}">Edit</a> <button class="btn sm" onclick="listingAction(${l.id},'submit')">Submit</button>` : ''}
        ${['draft', 'submitted', 'under_review', 'active'].includes(l.status) ? `<button class="btn sm danger" onclick="listingAction(${l.id},'withdraw')">Withdraw</button>` : ''}
        ${l.status === 'active' ? `<a class="btn sm ghost" href="#/used/${l.id}">View</a>` : ''}</td></tr>`).join('')}</table></div>
      <p class="small mut">Flow: Draft → Submitted → Under Review → Active → Reserved (ordered) → Sold. Commission on sales: ${esc(S.commission?.label || '')}.</p>` : '<div class="empty">You have not listed any books yet.</div>');
    else body = d.settlements.length ? `<div class="tblwrap"><table class="dt"><tr><th>Book</th><th>Sold for</th><th>Store commission</th><th>You receive</th><th>Settlement</th></tr>
      ${d.settlements.map(x => `<tr><td>${esc(x.title)}</td><td>${inr(x.gross_paise)}</td><td>−${inr(x.commission_paise)}</td><td><b>${inr(x.proceeds_paise)}</b></td>
      <td><span class="tag ${x.status === 'paid' ? 'paid' : 'pending'}">${esc(x.status)}</span><br><span class="meta">${esc(x.method_note || '')}${x.paid_at ? ' · ' + esc(x.paid_at.slice(0, 10)) : ''}</span></td></tr>`).join('')}</table></div>`
      : '<div class="empty">No sales yet. When one of your books sells and is delivered, your proceeds appear here.</div>'; }
  else if (tab === 'addresses') { body = `<div class="grid">${me.addresses.map(a => `<div class="panel"><b>${esc(a.label)}</b>${a.is_default ? ' <span class="tag paid">Default</span>' : ''}<p class="small">${esc(a.name)}<br>${esc(a.line)}<br>${esc(a.city)}, ${esc(a.state)} — ${esc(a.pin)}<br>📞 ${esc(a.phone)}</p><button class="btn sm danger" onclick="delAddr(${a.id})">Delete</button></div>`).join('')}</div>
   <form class="panel" style="margin-top:16px" onsubmit="return addAddr(event)"><h3 style="margin-top:0">Add address</h3>
    <div class="two"><div><label class="f">Label</label><input id="ad_label" type="text" value="Home"></div><div><label class="f">Name</label><input id="ad_name" type="text" required></div></div>
    <div class="two"><div><label class="f">Phone</label><input id="ad_phone" type="tel" required></div><div><label class="f">PIN</label><input id="ad_pin" type="text" maxlength="6" required></div></div>
    <label class="f">Address line</label><input id="ad_line" type="text" required>
    <div class="two"><div><label class="f">City</label><input id="ad_city" type="text" value="Jalandhar Cantt" required></div><div><label class="f">State</label><input id="ad_state" type="text" value="Punjab"></div></div>
    <label style="display:block;margin:10px 0"><input type="checkbox" id="ad_default" style="width:auto"> Make default</label><button class="btn pri">Save Address</button></form>`; }
  else if (tab === 'support') { const d = await api('/api/my/enquiries');
    body = (d.items.length ? d.items.map(e => `<div class="panel" style="margin-bottom:12px"><b>${esc(e.subject)}</b> <span class="tag ${e.status === 'open' ? 'pending' : 'paid'}">${esc(e.status)}</span> <span class="meta">${esc(e.kind)} · ${esc(e.created_at.slice(0, 10))}</span><p class="small">${esc(e.message)}</p>${e.admin_reply ? `<div class="alert good"><b>Store reply:</b> ${esc(e.admin_reply)}</div>` : '<p class="small mut">Awaiting reply…</p>'}</div>`).join('') : '<div class="empty">No enquiries yet.</div>')
      + `<p><a class="btn pri" href="#/contact">New Enquiry</a></p>`; }
  else if (tab === 'notifications') { const d = await api('/api/my/notifications'); await api('/api/my/notifications/read', { method: 'POST', body: {} });
    body = d.items.length ? d.items.map(n => `<div class="panel" style="margin-bottom:10px;${n.is_read ? '' : 'border-color:var(--amber)'}"><b>${esc(n.title)}</b> <span class="meta">${esc(n.created_at.slice(0, 16))}</span><p class="small">${esc(n.body)}</p></div>`).join('') : '<div class="empty">No notifications.</div>'; }
  else if (tab === 'profile') { body = `<form class="panel" onsubmit="return saveProfile(event)"><h3 style="margin-top:0">Profile</h3>
    <label class="f">Name</label><input id="pf_name" type="text" value="${esc(me.user.name)}">
    <label class="f">Email (sign-in ID)</label><input type="email" value="${esc(me.user.email)}" disabled>
    <label class="f">Phone</label><input id="pf_phone" type="tel" value="${esc(me.user.phone || '')}">
    <p class="small mut">Member since ${esc(me.user.created_at.slice(0, 10))} · Role: ${esc(me.user.role)}</p><button class="btn pri">Save Profile</button></form>
   <form class="panel" style="margin-top:16px" onsubmit="return changePw(event)"><h3 style="margin-top:0">Change password</h3>
    <label class="f">Current password</label><input id="pw_cur" type="password" required>
    <label class="f">New password (8+ characters)</label><input id="pw_new" type="password" required minlength="8">
    <p><button class="btn">Update Password</button></p></form>`; }
  app.innerHTML = `<h1>👤 Hello, ${esc(me.user.name.split(' ')[0])}</h1>
   <div class="tabs">${T.map(([k, l]) => `<a class="${tab === k ? 'on' : ''}" href="#/account?tab=${k}">${l}</a>`).join('')}<button onclick="logout()">Sign Out</button></div>${body}`;
}
window.listingAction = async (id, action) => { if (action === 'withdraw' && !confirm('Withdraw this listing?')) return; try { await api(`/api/listings/${id}/action`, { method: 'POST', body: { action } }); toast('Done ✓'); router(); } catch (e) { toast(e.message); } };
window.addAddr = async e => { e.preventDefault(); try { await api('/api/addresses', { method: 'POST', body: { label: $('#ad_label').value, name: $('#ad_name').value, phone: $('#ad_phone').value, pin: $('#ad_pin').value, line: $('#ad_line').value, city: $('#ad_city').value, state: $('#ad_state').value, is_default: $('#ad_default').checked } }); toast('Address saved ✓'); router(); } catch (x) { toast(x.message); } return false; };
window.delAddr = async id => { if (!confirm('Delete this address?')) return; try { await api('/api/addresses/' + id, { method: 'DELETE' }); router(); } catch (e) { toast(e.message); } };
window.saveProfile = async e => { e.preventDefault(); try { await api('/api/me', { method: 'PUT', body: { name: $('#pf_name').value, phone: $('#pf_phone').value } }); toast('Profile saved ✓'); await bootstrap(); } catch (x) { toast(x.message); } return false; };
window.changePw = async e => { e.preventDefault(); try { await api('/api/me/password', { method: 'POST', body: { current: $('#pw_cur').value, next: $('#pw_new').value } }); toast('Password updated ✓'); e.target.reset(); } catch (x) { toast(x.message); } return false; };
window.logout = async () => { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (_) {} S.user = null; await bootstrap(); location.hash = '#/'; router(); };
async function vWishlist() { location.hash = S.user ? '#/account?tab=wishlist' : '#/account?tab=wishlist'; if (!S.user) { const d = await api('/api/wishlist');
  app.innerHTML = `<h1>♡ Wishlist</h1><div class="grid">${d.items.map(i => `<article class="card"><div class="card-b"><h3>${esc(i.title)}</h3><div class="price">${inr(i.price_paise)}</div></div><div class="card-f"><button class="btn sm" onclick="addToCart(${i.product_id || 'null'},${i.listing_id || 'null'})">Add to Cart</button></div></article>`).join('') || '<div class="empty">Wishlist is empty. <a href="#/login">Sign in</a> to keep it across devices.</div>'}</div>`; return; } router(); }

/* ---------------- shell: search, PIN, router ---------------- */
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); const q = $('#searchInput').value.trim(); $('#suggest').classList.add('hidden'); if (!q) return; recentPush(q); location.hash = '#/shop?q=' + encodeURIComponent(q); router(); });
let sugT; $('#searchInput').addEventListener('input', e => { clearTimeout(sugT); const q = e.target.value.trim(); const box = $('#suggest');
  if (q.length < 2) { box.classList.add('hidden'); return; }
  sugT = setTimeout(async () => { try { const d = await api('/api/suggest?q=' + encodeURIComponent(q));
    const recent = JSON.parse(localStorage.getItem('asm_recent') || '[]');
    box.innerHTML = (recent.length ? `<div class="meta" style="padding:8px 14px">Recent: ${recent.map(r => `<a href="#/shop?q=${encodeURIComponent(r)}" style="display:inline;padding:0;border:0">${esc(r)}</a>`).join(' · ')}</div>` : '')
      + (d.items.length ? d.items.map(i => `<a href="#/${i.src === 'store' ? 'product/' + i.slug : 'used/' + i.slug}"><span>${esc(i.title)}</span><span class="tag">${i.src === 'store' ? 'New' : 'Used'}</span></a>`).join('') : '<div style="padding:12px 14px" class="mut small">No quick matches — press Enter to search anyway.</div>');
    box.classList.remove('hidden'); } catch (_) {} }, 220); });
document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#suggest')?.classList.add('hidden'); });
function pinLabel() { const p = localStorage.getItem('asm_pin'); const okP = p && (S.settings.service_pins || '').split(',').some(x => p.startsWith(x.trim()));
  $('#pinLabel').textContent = p ? (okP ? 'Deliver to ' + p : p + ' · pickup only') : 'Set PIN'; }
$('#pinBtn').onclick = () => { modal(`<h2 style="margin-top:0">Choose your delivery PIN</h2>
 <p class="small mut">We currently deliver to PINs: <b>${esc(S.settings.service_pins || '')}</b> (set by the store). Store pickup is always free.</p>
 <label class="f">Your PIN code</label><input id="pinIn" type="text" maxlength="6" inputmode="numeric" value="${esc(localStorage.getItem('asm_pin') || '')}">
 <p><button class="btn pri" onclick="savePin()">Save</button></p><p id="pinMsg" class="small"></p>`); };
window.savePin = () => { const p = $('#pinIn').value.trim(); if (!/^\d{6}$/.test(p)) { $('#pinMsg').textContent = 'Enter a valid 6-digit PIN.'; return; }
  localStorage.setItem('asm_pin', p); pinLabel(); const okP = (S.settings.service_pins || '').split(',').some(x => p.startsWith(x.trim()));
  $('#pinMsg').innerHTML = okP ? '✅ Great — we deliver to ' + p + '.' : 'ℹ️ We don\'t deliver to ' + p + ' yet. You can still order with <b>store pickup</b> or send an enquiry.'; };

async function bootstrap() {
  const d = await api('/api/bootstrap');
  S.settings = d.settings; S.categories = d.categories; S.user = d.user; S.commission = d.commission;
  S.meta = {}; d.meta.forEach(m => (S.meta[m.kind] = S.meta[m.kind] || []).push(m.value));
  if (!S.user) S.csrf = d.csrf; else if (!S.csrf || S.csrf.length < 10) S.csrf = d.csrf;
  $('#cartBadge').textContent = d.cart_count;
  $('#accountName').textContent = S.user ? S.user.name.split(' ')[0] : 'Sign in';
  $('#accountLink').href = S.user ? '#/account' : '#/login';
  $('#adminLink').classList.toggle('hidden', !(S.user && S.user.role !== 'customer'));
  $('#ftrAddr').textContent = d.settings.address || '';
  $('#ftrContact').textContent = [d.settings.phone, d.settings.email].filter(Boolean).join(' · ');
  $('#ftrHours').textContent = d.settings.opening_hours || ''; $('#yr').textContent = new Date().getFullYear();
  document.title = (d.settings.store_name || 'Ankit Stationery Mart') + ' — Stationery, Books & Second-Hand Books | Jalandhar Cantt';
  pinLabel();
}
async function router() {
  const raw = location.hash.replace(/^#\/?/, ''); const [pathPart, queryPart] = raw.split('?');
  const seg = pathPart.split('/').filter(Boolean); const params = qs(queryPart);
  app.innerHTML = '<div class="loading">Loading…</div>'; scrollTo(0, 0);
  try {
    if (seg[0] === 'admin') return window.renderAdmin(seg.slice(1), params);
    if (!seg.length) return vHome();
    const routes = { shop: () => vShop(params), product: () => vProduct(seg[1]), used: () => seg[1] ? vUsedDetail(seg[1]) : vUsed(params),
      sell: () => vSell(params), bulk: vBulk, boards: boardsView, contact: () => vContact(params), about: () => vStatic('about'),
      faq: () => vStatic('faq'), policy: () => vStatic(seg[1] || 'returns'), login: () => vLogin(params), register: () => vRegister(params),
      recover: vRecover, reset: () => vReset(params), cart: vCart, checkout: vCheckout, success: () => vSuccess(seg[1]),
      track: vTrack, account: () => vAccount(params), wishlist: vWishlist };
    if (routes[seg[0]]) return routes[seg[0]]();
    app.innerHTML = '<div class="empty"><h1>Page not found</h1><a class="btn" href="#/">Go Home</a></div>';
  } catch (e) { app.innerHTML = `<div class="empty"><h1>⚠️ ${esc(e.message)}</h1><p><button class="btn" onclick="router()">Try Again</button> <a class="btn ghost" href="#/">Home</a></p></div>`; }
}
addEventListener('hashchange', router);
(async () => { try { await bootstrap(); } catch (_) { app.innerHTML = '<div class="empty">Could not reach the server. <button class="btn" onclick="location.reload()">Retry</button></div>'; return; } router(); })();
