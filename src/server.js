'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const express = require('express');
const { db, tx, getSettings } = require('./db');
const A = require('./auth'); const U = require('./util');
const { err, ok, clean, intIn, audit, notify } = U;

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => { // security headers
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});
app.use(A.attachUser);

/* ---------- helpers ---------- */
const pubSettings = () => { const s = getSettings(); return s; };
function ownerKey(req, res) {
  if (req.user) return 'u:' + req.user.id;
  let gid = A.parseCookies(req).asm_gid;
  if (!gid) { gid = crypto.randomBytes(16).toString('base64url'); if (res) res.cookie('asm_gid', gid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 }); }
  return 'g:' + gid;
}
const productRow = p => p && ({ ...p, in_stock: p.stock > 0, discount_pct: p.mrp_paise && p.mrp_paise > p.price_paise ? Math.round((1 - p.price_paise / p.mrp_paise) * 100) : 0 });
function cartView(key) {
  const items = db.prepare(`SELECT c.*, p.title, p.slug, p.price_paise, p.stock, p.image_url, p.status pstatus
    FROM cart_items c LEFT JOIN products p ON p.id=c.product_id WHERE c.owner_key=? AND c.product_id IS NOT NULL`).all(key)
    .map(i => ({ id: i.id, kind: 'store', product_id: i.product_id, listing_id: null, title: i.title, slug: i.slug, price_paise: i.price_paise, qty: i.qty, stock: i.stock, image_url: i.image_url, available: i.pstatus === 'published' && i.stock >= i.qty, line_total_paise: i.price_paise * i.qty }));
  const used = db.prepare(`SELECT c.*, l.title, l.price_paise, l.images, l.status lstatus, l.seller_id FROM cart_items c
    LEFT JOIN listings l ON l.id=c.listing_id WHERE c.owner_key=? AND c.listing_id IS NOT NULL`).all(key)
    .map(i => ({ id: i.id, kind: 'marketplace', product_id: null, listing_id: i.listing_id, title: i.title, price_paise: i.price_paise, qty: 1, stock: 1, image_url: (JSON.parse(i.images || '[]')[0] || ''), available: i.lstatus === 'active', line_total_paise: i.price_paise }));
  const all = [...items, ...used];
  return { items: all, count: all.reduce((a, i) => a + i.qty, 0), subtotal_paise: all.reduce((a, i) => a + i.line_total_paise, 0),
           store_subtotal_paise: items.reduce((a, i) => a + i.line_total_paise, 0) };
}
function validatePromo(code, storeSubtotal) {
  if (!code) return { discount: 0 };
  const p = db.prepare('SELECT * FROM promotions WHERE code=? AND active=1').get(String(code).toUpperCase().trim());
  const now = new Date().toISOString();
  if (!p) return { error: 'This discount code is not valid.' };
  if (p.starts_at && p.starts_at > now) return { error: 'This discount code is not active yet.' };
  if (p.expires_at && p.expires_at < now) return { error: 'This discount code has expired.' };
  if (p.usage_limit && p.used_count >= p.usage_limit) return { error: 'This discount code has reached its usage limit.' };
  if (storeSubtotal < p.min_subtotal_paise) return { error: `This code needs a store subtotal of at least ${U.inr(p.min_subtotal_paise)}.` };
  const discount = p.kind === 'percent' ? Math.floor(storeSubtotal * Math.min(p.value, 90) / 100) : Math.min(p.value, storeSubtotal);
  return { discount, promo: p };
}
const orderWithItems = o => o && ({ ...o, address: JSON.parse(o.address_snapshot || '{}'),
  items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id),
  events: db.prepare('SELECT * FROM order_events WHERE order_id=? ORDER BY id').all(o.id) });

/* ---------- bootstrap / public catalogue ---------- */
app.get('/api/bootstrap', (req, res) => {
  let csrf; const key = ownerKey(req, res);
  if (req.user) csrf = req.user.csrf;
  else { csrf = crypto.randomBytes(24).toString('base64url'); res.cookie('asm_guest', A.sha(csrf), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5 }); }
  res.set('Cache-Control', 'no-store');
  ok(res, { settings: pubSettings(), csrf,
    categories: db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY sort,name').all(),
    meta: db.prepare('SELECT kind,value FROM meta_options WHERE active=1 ORDER BY kind,value').all(),
    commission: U.activeCommission(),
    user: req.user ? { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, perms: (A_PERMS[req.user.role]||[]) } : null,
    cart_count: cartView(key).count });
});

function productQuery(req) {
  const q = clean(req.query.q, 120), page = intIn(req.query.page, 1, 999, 1), per = intIn(req.query.per, 1, 48, 12);
  const where = ["p.status='published'"]; const args = [];
  const eq = (col, v) => { if (v) { where.push(`p.${col}=?`); args.push(clean(v, 80)); } };
  eq('board', req.query.board); eq('class', req.query.class); eq('subject', req.query.subject); eq('language', req.query.language); eq('brand', req.query.brand);
  if (req.query.category) { where.push('p.category_id IN (SELECT id FROM categories WHERE slug=?)'); args.push(clean(req.query.category, 80)); }
  if (req.query.featured) where.push('p.featured=1');
  if (req.query.min) { where.push('p.price_paise>=?'); args.push(intIn(req.query.min, 0, 1e9, 0)); }
  if (req.query.max) { where.push('p.price_paise<=?'); args.push(intIn(req.query.max, 0, 1e9, 1e9)); }
  if (req.query.instock) where.push('p.stock>0');
  let fuzzy = false;
  if (q) {
    const toks = q.split(/\s+/).filter(Boolean).slice(0, 6);
    const andSql = toks.map(() => "(p.title LIKE ? OR p.author LIKE ? OR p.isbn LIKE ? OR p.brand LIKE ? OR p.publisher LIKE ? OR p.subject LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)").join(' AND ');
    const andArgs = toks.flatMap(t => Array(8).fill('%' + t + '%'));
    const n = db.prepare(`SELECT COUNT(*) n FROM products p WHERE ${[...where, andSql].join(' AND ')}`).get(...args, ...andArgs).n;
    if (n === 0 && toks.length > 1) { fuzzy = true; where.push('(' + toks.map(() => "(p.title LIKE ? OR p.author LIKE ? OR p.subject LIKE ?)").join(' OR ') + ')'); toks.forEach(t => args.push('%' + t + '%', '%' + t + '%', '%' + t + '%')); }
    else { where.push(andSql); andArgs.forEach(a => args.push(a)); }
  }
  const sorts = { relevance: 'p.featured DESC,p.id DESC', price_asc: 'p.price_paise ASC', price_desc: 'p.price_paise DESC', newest: 'p.id DESC', title: 'p.title ASC' };
  const order = sorts[req.query.sort] || sorts.relevance;
  const total = db.prepare(`SELECT COUNT(*) n FROM products p WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT p.*, c.name category_name, c.slug category_slug,
      (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.product_id=p.id AND r.status='published') avg_rating,
      (SELECT COUNT(*) FROM reviews r WHERE r.product_id=p.id AND r.status='published') review_count
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, per, (page - 1) * per).map(productRow);
  return { rows, total, page, per, pages: Math.max(1, Math.ceil(total / per)), fuzzy };
}
app.get('/api/products', (req, res) => ok(res, productQuery(req)));
app.get('/api/products/:slug', (req, res) => {
  const p = db.prepare(`SELECT p.*, c.name category_name, c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=?`).get(req.params.slug);
  if (!p || (p.status !== 'published' && !A.isStaff(req.user))) return err(res, 404, 'Product not found.');
  const reviews = db.prepare(`SELECT r.*, u.name user_name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='published' ORDER BY r.id DESC`).all(p.id);
  const related = db.prepare(`SELECT * FROM products WHERE status='published' AND id!=? AND (category_id=? OR subject=?) ORDER BY featured DESC, id DESC LIMIT 4`).all(p.id, p.category_id, p.subject).map(productRow);
  const usedCopies = db.prepare(`SELECT * FROM listings WHERE status='active' AND (isbn=? AND isbn!='' OR title LIKE ?) ORDER BY price_paise LIMIT 4`).all(p.isbn, '%' + p.title.slice(0, 24) + '%');
  ok(res, { product: productRow(p), reviews, related, used_copies: usedCopies.map(l => ({ ...l, images: JSON.parse(l.images || '[]') })) });
});
app.get('/api/suggest', (req, res) => {
  const q = '%' + clean(req.query.q, 60) + '%';
  if (clean(req.query.q).length < 2) return ok(res, { items: [] });
  const items = db.prepare(`SELECT title,slug,'store' src FROM products WHERE status='published' AND title LIKE ? LIMIT 6`).all(q)
    .concat(db.prepare(`SELECT title,CAST(id AS TEXT) slug,'used' src FROM listings WHERE status='active' AND title LIKE ? LIMIT 4`).all(q));
  ok(res, { items });
});
app.get('/api/home', (req, res) => ok(res, {
  featured: db.prepare(`SELECT p.* FROM products p WHERE p.status='published' AND p.featured=1 ORDER BY p.id DESC LIMIT 8`).all().map(productRow),
  new_arrivals: db.prepare(`SELECT * FROM products WHERE status='published' ORDER BY id DESC LIMIT 8`).all().map(productRow),
  recent_used: db.prepare(`SELECT * FROM listings WHERE status='active' ORDER BY id DESC LIMIT 8`).all().map(l => ({ ...l, images: JSON.parse(l.images || '[]') })),
  offers: db.prepare(`SELECT code,kind,value,min_subtotal_paise,expires_at FROM promotions WHERE active=1 AND (expires_at IS NULL OR expires_at>datetime('now')) ORDER BY id DESC LIMIT 4`).all(),
  top_reviews: db.prepare(`SELECT r.*,u.name user_name,p.title product_title FROM reviews r JOIN users u ON u.id=r.user_id LEFT JOIN products p ON p.id=r.product_id WHERE r.status='published' ORDER BY r.id DESC LIMIT 4`).all(),
}));

/* ---------- marketplace: public ---------- */
app.get('/api/listings', (req, res) => {
  const where = ["l.status='active'"]; const args = [];
  const eq = (col, v) => { if (v) { where.push(`l.${col}=?`); args.push(clean(v, 80)); } };
  eq('board', req.query.board); eq('class', req.query.class); eq('subject', req.query.subject); eq('language', req.query.language); eq('condition_grade', req.query.condition);
  if (req.query.q) { where.push('(l.title LIKE ? OR l.author LIKE ? OR l.isbn LIKE ?)'); const q = '%' + clean(req.query.q, 80) + '%'; args.push(q, q, q); }
  if (req.query.min) { where.push('l.price_paise>=?'); args.push(intIn(req.query.min, 0, 1e9, 0)); }
  if (req.query.max) { where.push('l.price_paise<=?'); args.push(intIn(req.query.max, 0, 1e9, 1e9)); }
  const sorts = { newest: 'l.id DESC', price_asc: 'l.price_paise ASC', price_desc: 'l.price_paise DESC' };
  const page = intIn(req.query.page, 1, 999, 1), per = intIn(req.query.per, 1, 48, 12);
  const total = db.prepare(`SELECT COUNT(*) n FROM listings l WHERE ${where.join(' AND ')}`).get(...args).n;
  const rows = db.prepare(`SELECT l.*, u.name seller_name FROM listings l JOIN users u ON u.id=l.seller_id
    WHERE ${where.join(' AND ')} ORDER BY ${sorts[req.query.sort] || sorts.newest} LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per)
    .map(l => ({ ...l, images: JSON.parse(l.images || '[]') }));
  ok(res, { rows, total, page, per, pages: Math.max(1, Math.ceil(total / per)) });
});
app.get('/api/listings/:id', (req, res) => {
  const l = db.prepare(`SELECT l.*, u.name seller_name FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.id=?`).get(intIn(req.params.id, 0, 1e9, 0));
  if (!l) return err(res, 404, 'Listing not found.');
  const mine = req.user && req.user.id === l.seller_id;
  if (l.status !== 'active' && l.status !== 'sold' && !mine && !A.isStaff(req.user)) return err(res, 404, 'Listing not found.');
  ok(res, { listing: { ...l, images: JSON.parse(l.images || '[]'), seller_contact: undefined },
    similar: db.prepare(`SELECT * FROM listings WHERE status='active' AND id!=? AND (subject=? OR class=?) ORDER BY id DESC LIMIT 4`).all(l.id, l.subject, l.class).map(x => ({ ...x, images: JSON.parse(x.images || '[]') })),
    commission: U.activeCommission() });
});

/* ---------- auth ---------- */
const authLimit = A.rateLimit(12, 10 * 60 * 1000);
app.post('/api/auth/register', authLimit, A.csrfGuard, (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!clean(name, 80) || !U.isEmail(email) || String(password || '').length < 8) return err(res, 400, 'Enter your name, a valid email and a password of at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(clean(email, 120).toLowerCase())) return err(res, 409, 'An account with this email already exists. Please sign in.');
  const { salt, hash } = A.hashPassword(password);
  const id = db.prepare('INSERT INTO users(email,phone,name,pass_hash,salt) VALUES(?,?,?,?,?)')
    .run(clean(email, 120).toLowerCase(), clean(phone, 20), clean(name, 80), hash, salt).lastInsertRowid;
  const s = A.createSession(id); res.cookie('asm_session', s.token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5 });
  mergeGuestCart(req, id); audit(id, 'register', 'user', id, '', req.ip);
  ok(res, { user: { id, name: clean(name, 80), email: clean(email, 120).toLowerCase(), role: 'customer' }, csrf: s.csrf });
});
app.post('/api/auth/login', authLimit, A.csrfGuard, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(clean(email, 120).toLowerCase());
  if (!u || !A.verifyPassword(String(password || ''), u.salt, u.pass_hash)) return err(res, 401, 'Incorrect email or password.');
  if (u.status !== 'active') return err(res, 403, 'This account is suspended. Please contact the store.');
  const s = A.createSession(u.id); res.cookie('asm_session', s.token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5 });
  mergeGuestCart(req, u.id);
  ok(res, { user: { id: u.id, name: u.name, email: u.email, role: u.role }, csrf: s.csrf });
});
function mergeGuestCart(req, uid) {
  const gid = A.parseCookies(req).asm_gid; if (!gid) return;
  try { db.prepare("UPDATE OR IGNORE cart_items SET owner_key=? WHERE owner_key=?").run('u:' + uid, 'g:' + gid);
        db.prepare('DELETE FROM cart_items WHERE owner_key=?').run('g:' + gid); } catch (_) {}
}
app.post('/api/auth/logout', A.requireAuth, A.csrfGuard, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(A.sha(A.parseCookies(req).asm_session || ''));
  res.clearCookie('asm_session'); ok(res, {});
});
app.get('/api/me', A.requireAuth, (req, res) => {
  const u = req.user;
  ok(res, { user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, created_at: u.created_at },
    addresses: db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id').all(u.id),
    counts: { orders: db.prepare('SELECT COUNT(*) n FROM orders WHERE user_id=?').get(u.id).n,
      listings: db.prepare('SELECT COUNT(*) n FROM listings WHERE seller_id=?').get(u.id).n,
      unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0').get(u.id).n } });
});
app.put('/api/me', A.requireAuth, A.csrfGuard, (req, res) => {
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(clean(req.body.name, 80) || req.user.name, clean(req.body.phone, 20), req.user.id); ok(res, {});
});
app.post('/api/me/password', A.requireAuth, A.csrfGuard, A.rateLimit(6, 600000), (req, res) => {
  const { current, next } = req.body || {};
  if (!A.verifyPassword(String(current || ''), req.user.salt, req.user.pass_hash)) return err(res, 400, 'Current password is incorrect.');
  if (String(next || '').length < 8) return err(res, 400, 'New password must be at least 8 characters.');
  const { salt, hash } = A.hashPassword(next); db.prepare('UPDATE users SET pass_hash=?,salt=? WHERE id=?').run(hash, salt, req.user.id);
  audit(req.user.id, 'password_change', 'user', req.user.id, '', req.ip); ok(res, {});
});
app.post('/api/auth/recover', authLimit, A.csrfGuard, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email, 120).toLowerCase());
  if (u) { const tok = crypto.randomBytes(24).toString('base64url');
    db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+2 hours'))").run(u.id, A.sha(tok));
    audit(u.id, 'password_recovery_requested', 'user', u.id, 'email integration not configured — staff-assisted reset', req.ip); }
  ok(res, { message: 'If this email matches an account, a recovery request has been recorded. Email delivery is not configured yet, so please also contact the store — staff can verify your identity and issue a secure reset link from the admin panel.' });
});
app.post('/api/auth/reset', authLimit, A.csrfGuard, (req, res) => {
  const r = db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at>datetime('now')").get(A.sha(clean(req.body.token, 200)));
  if (!r) return err(res, 400, 'This reset link is invalid or has expired.');
  if (String(req.body.password || '').length < 8) return err(res, 400, 'Password must be at least 8 characters.');
  const { salt, hash } = A.hashPassword(req.body.password);
  tx(() => { db.prepare('UPDATE users SET pass_hash=?,salt=? WHERE id=?').run(hash, salt, r.user_id);
    db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(r.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id); });
  ok(res, { message: 'Password updated. Please sign in.' });
});
app.post('/api/addresses', A.requireAuth, A.csrfGuard, (req, res) => {
  const b = req.body || {};
  if (!clean(b.name, 80) || !clean(b.phone, 20) || !clean(b.line, 200) || !clean(b.city, 60) || !/^\d{6}$/.test(clean(b.pin, 6))) return err(res, 400, 'Complete all address fields with a valid 6-digit PIN code.');
  if (b.is_default) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
  const id = db.prepare('INSERT INTO addresses(user_id,label,name,phone,line,city,pin,state,is_default) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, clean(b.label, 30) || 'Home', clean(b.name, 80), clean(b.phone, 20), clean(b.line, 200), clean(b.city, 60), clean(b.pin, 6), clean(b.state, 60) || 'Punjab', b.is_default ? 1 : 0).lastInsertRowid;
  ok(res, { id });
});
app.delete('/api/addresses/:id', A.requireAuth, A.csrfGuard, (req, res) => {
  const r = db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(intIn(req.params.id, 0, 1e9, 0), req.user.id);
  if (!r.changes) return err(res, 404, 'Address not found.'); ok(res, {});
});

/* ---------- cart & wishlist (server-persisted, guest + account) ---------- */
app.get('/api/cart', (req, res) => ok(res, { cart: cartView(ownerKey(req, res)) }));
app.post('/api/cart/add', A.csrfGuard, (req, res) => {
  const key = ownerKey(req, res), qty = intIn(req.body.qty, 1, 99, 1);
  if (req.body.listing_id) {
    const l = db.prepare('SELECT * FROM listings WHERE id=?').get(intIn(req.body.listing_id, 0, 1e9, 0));
    if (!l || l.status !== 'active') return err(res, 409, 'This used book is no longer available.');
    if (req.user && l.seller_id === req.user.id) return err(res, 400, 'You cannot buy your own listing.');
    db.prepare('INSERT OR IGNORE INTO cart_items(owner_key,listing_id,qty) VALUES(?,?,1)').run(key, l.id);
  } else {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(intIn(req.body.product_id, 0, 1e9, 0));
    if (!p || p.status !== 'published') return err(res, 404, 'Product not found.');
    const cur = db.prepare('SELECT qty FROM cart_items WHERE owner_key=? AND product_id=?').get(key, p.id);
    if ((cur ? cur.qty : 0) + qty > p.stock) return err(res, 409, `Only ${p.stock} in stock.`);
    if (p.stock === 0) return err(res, 409, 'This item is out of stock. Use “Notify me” on the product page.');
    db.prepare(`INSERT INTO cart_items(owner_key,product_id,qty) VALUES(?,?,?) ON CONFLICT(owner_key,product_id) WHERE product_id IS NOT NULL DO UPDATE SET qty=qty+excluded.qty`).run(key, p.id, qty);
  }
  ok(res, { cart: cartView(key) });
});
app.patch('/api/cart/:id', A.csrfGuard, (req, res) => {
  const key = ownerKey(req, res); const item = db.prepare('SELECT * FROM cart_items WHERE id=? AND owner_key=?').get(intIn(req.params.id, 0, 1e9, 0), key);
  if (!item) return err(res, 404, 'Cart item not found.');
  const qty = intIn(req.body.qty, 0, 99, 1);
  if (qty === 0) db.prepare('DELETE FROM cart_items WHERE id=?').run(item.id);
  else { if (item.product_id) { const p = db.prepare('SELECT stock FROM products WHERE id=?').get(item.product_id); if (qty > p.stock) return err(res, 409, `Only ${p.stock} in stock.`); }
    db.prepare('UPDATE cart_items SET qty=? WHERE id=?').run(item.listing_id ? 1 : qty, item.id); }
  ok(res, { cart: cartView(key) });
});
app.delete('/api/cart/:id', A.csrfGuard, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id=? AND owner_key=?').run(intIn(req.params.id, 0, 1e9, 0), ownerKey(req, res)); ok(res, { cart: cartView(ownerKey(req, res)) });
});
app.post('/api/cart/quote', A.csrfGuard, (req, res) => {
  const cart = cartView(ownerKey(req, res)), s = getSettings();
  const v = validatePromo(req.body.promo_code, cart.store_subtotal_paise);
  if (v.error) return err(res, 400, v.error);
  const fee = req.body.fulfilment === 'pickup' ? 0 : (cart.subtotal_paise - v.discount >= +s.free_delivery_above_paise ? 0 : +s.delivery_fee_paise);
  ok(res, { cart, discount_paise: v.discount, delivery_fee_paise: fee, total_paise: cart.subtotal_paise - v.discount + fee });
});
app.get('/api/wishlist', (req, res) => {
  const key = ownerKey(req, res);
  ok(res, { items: db.prepare(`SELECT w.id, p.id product_id, p.title, p.slug, p.price_paise, p.image_url FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.owner_key=? AND w.product_id IS NOT NULL`).all(key)
    .concat(db.prepare(`SELECT w.id, l.id listing_id, l.title, l.price_paise FROM wishlists w JOIN listings l ON l.id=w.listing_id WHERE w.owner_key=? AND w.listing_id IS NOT NULL`).all(key)) });
});
app.post('/api/wishlist', A.csrfGuard, (req, res) => {
  const key = ownerKey(req, res);
  const ex = req.body.product_id ? db.prepare('SELECT id FROM wishlists WHERE owner_key=? AND product_id=?').get(key, +req.body.product_id)
             : db.prepare('SELECT id FROM wishlists WHERE owner_key=? AND listing_id=?').get(key, +req.body.listing_id);
  if (ex) db.prepare('DELETE FROM wishlists WHERE id=?').run(ex.id);
  else db.prepare('INSERT INTO wishlists(owner_key,product_id,listing_id) VALUES(?,?,?)').run(key, req.body.product_id || null, req.body.listing_id || null);
  ok(res, { wishlisted: !ex });
});

/* ---------- checkout (ALL totals recalculated server-side, transactional) ---------- */
app.post('/api/checkout', A.csrfGuard, A.rateLimit(20, 600000), (req, res) => {
  const b = req.body || {}, s = getSettings(), key = ownerKey(req, res);
  if (b.idempotency_key) { const prev = db.prepare('SELECT ref FROM orders WHERE idempotency_key=?').get(clean(b.idempotency_key, 80)); if (prev) return ok(res, { ref: prev.ref, duplicate: true }); }
  const fulfilment = b.fulfilment === 'pickup' ? 'pickup' : 'delivery';
  if (fulfilment === 'delivery' && s.delivery_enabled !== '1') return err(res, 400, 'Home delivery is currently disabled by the store.');
  if (fulfilment === 'pickup' && s.pickup_enabled !== '1') return err(res, 400, 'Store pickup is currently disabled.');
  const pay = clean(b.payment_method, 20) || 'cod';
  if (pay === 'cod' && s.payment_cod !== '1') return err(res, 400, 'Cash on Delivery is not enabled.');
  if (pay === 'store_pay' && s.payment_store_pay !== '1') return err(res, 400, 'Pay at Store is not enabled.');
  if (pay === 'online') return err(res, 400, s.online_payment_note || 'Online payment is not configured yet.');
  let addr = {};
  if (fulfilment === 'delivery') {
    if (b.address_id && req.user) { const a = db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(+b.address_id, req.user.id); if (!a) return err(res, 400, 'Selected address not found.'); addr = a; }
    else addr = { name: clean(b.name, 80), phone: clean(b.phone, 20), line: clean(b.line, 200), city: clean(b.city, 60), pin: clean(b.pin, 6), state: clean(b.state, 60) || 'Punjab' };
    if (!addr.name || !addr.phone || !addr.line || !/^\d{6}$/.test(addr.pin)) return err(res, 400, 'Complete the delivery address with a valid 6-digit PIN.');
    const pins = s.service_pins.split(',').map(x => x.trim()).filter(Boolean);
    if (pins.length && !pins.some(p => addr.pin.startsWith(p))) return err(res, 400, `Sorry, we do not deliver to PIN ${addr.pin} yet. Serviceable PINs: ${pins.join(', ')}. You can choose store pickup or send us an enquiry.`);
  } else { if (!req.user && (!clean(b.name, 80) || !clean(b.phone, 20))) return err(res, 400, 'Name and phone are required for pickup orders.'); addr = { name: clean(b.name, 80), phone: clean(b.phone, 20) }; }
  try {
    const out = tx(() => {
      const cart = cartView(key);
      if (!cart.items.length) throw Object.assign(new Error('Your cart is empty.'), { http: 400 });
      if (fulfilment === 'delivery' && cart.subtotal_paise < +s.min_delivery_order_paise) throw Object.assign(new Error(`Minimum order for delivery is ${U.inr(+s.min_delivery_order_paise)}.`), { http: 400 });
      const v = validatePromo(b.promo_code, cart.store_subtotal_paise);
      if (v.error) throw Object.assign(new Error(v.error), { http: 400 });
      const fee = fulfilment === 'pickup' ? 0 : (cart.subtotal_paise - v.discount >= +s.free_delivery_above_paise ? 0 : +s.delivery_fee_paise);
      const ref = 'ASM-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(db.prepare('SELECT COUNT(*) n FROM orders').get().n + 1).padStart(4, '0');
      const total = cart.subtotal_paise - v.discount + fee;
      const oid = db.prepare(`INSERT INTO orders(ref,user_id,guest_name,guest_phone,guest_email,fulfilment,address_snapshot,payment_method,subtotal_paise,discount_paise,delivery_fee_paise,total_paise,promo_code,notes,idempotency_key)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ref, req.user ? req.user.id : null,
        req.user ? '' : clean(b.name, 80), req.user ? '' : clean(b.phone, 20), req.user ? '' : clean(b.email, 120),
        fulfilment, JSON.stringify(addr), pay, cart.subtotal_paise, v.discount, fee, total, b.promo_code ? String(b.promo_code).toUpperCase() : '', clean(b.notes, 500), clean(b.idempotency_key, 80) || null).lastInsertRowid;
      for (const it of cart.items) {
        if (it.kind === 'store') { // atomic stock guard — cannot oversell
          const r = db.prepare('UPDATE products SET stock=stock-?, updated_at=datetime(\'now\') WHERE id=? AND stock>=? AND status=\'published\'').run(it.qty, it.product_id, it.qty);
          if (!r.changes) throw Object.assign(new Error(`“${it.title}” no longer has enough stock. Please review your cart.`), { http: 409 });
          db.prepare('INSERT INTO stock_movements(product_id,delta,reason,ref,user_id) VALUES(?,?,?,?,?)').run(it.product_id, -it.qty, 'order', ref, req.user ? req.user.id : null);
          db.prepare('INSERT INTO order_items(order_id,kind,product_id,title_snapshot,price_paise,qty,line_total_paise) VALUES(?,?,?,?,?,?,?)').run(oid, 'store', it.product_id, it.title, it.price_paise, it.qty, it.line_total_paise);
        } else { // single-copy listing — exactly one buyer can win
          const c = U.commissionFor(it.price_paise);
          const l = db.prepare('SELECT seller_id FROM listings WHERE id=?').get(it.listing_id);
          const r = db.prepare("UPDATE listings SET status='reserved', reserved_order_id=?, updated_at=datetime('now') WHERE id=? AND status='active'").run(oid, it.listing_id);
          if (!r.changes) throw Object.assign(new Error(`The used book “${it.title}” was just sold or reserved by another buyer.`), { http: 409 });
          db.prepare('INSERT INTO listing_events(listing_id,status,note,user_id) VALUES(?,?,?,?)').run(it.listing_id, 'reserved', 'Order ' + ref, req.user ? req.user.id : null);
          db.prepare('INSERT INTO order_items(order_id,kind,listing_id,title_snapshot,price_paise,qty,line_total_paise,commission_rule,commission_paise,seller_id,seller_proceeds_paise) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(oid, 'marketplace', it.listing_id, it.title, it.price_paise, 1, it.price_paise, `${c.rule.kind}:${c.rule.value} (${c.rule.label})`, c.fee, l.seller_id, c.proceeds);
          notify(l.seller_id, 'Your book was ordered', `“${it.title}” is reserved under order ${ref}. Expected proceeds after commission: ${U.inr(c.proceeds)}.`);
        }
      }
      if (v.promo) db.prepare('UPDATE promotions SET used_count=used_count+1 WHERE id=?').run(v.promo.id);
      db.prepare('INSERT INTO order_events(order_id,status,note,user_id) VALUES(?,?,?,?)').run(oid, 'pending', 'Order placed', req.user ? req.user.id : null);
      db.prepare('DELETE FROM cart_items WHERE owner_key=?').run(key);
      if (req.user) notify(req.user.id, 'Order placed', `Order ${ref} totalling ${U.inr(total)} is pending store confirmation.`);
      return { ref, oid, total };
    });
    ok(res, out);
  } catch (e) { return err(res, e.http || 500, e.http ? e.message : 'Checkout failed. Please try again.'); }
});

/* ---------- customer orders ---------- */
app.get('/api/my/orders', A.requireAuth, (req, res) => ok(res, { orders: db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id).map(orderWithItems) }));
app.get('/api/my/orders/:ref', A.requireAuth, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=? AND user_id=?').get(clean(req.params.ref, 30), req.user.id);
  if (!o) return err(res, 404, 'Order not found.'); ok(res, { order: orderWithItems(o) });
});
app.get('/api/orders/track', (req, res) => { // guest tracking requires matching phone (no IDOR by ref alone)
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(clean(req.query.ref, 30));
  if (!o) return err(res, 404, 'Order not found.');
  const phone = clean(req.query.phone, 20); const snap = JSON.parse(o.address_snapshot || '{}');
  const owns = req.user && o.user_id === req.user.id;
  if (!owns && phone !== (o.guest_phone || snap.phone || '')) return err(res, 403, 'Phone number does not match this order.');
  ok(res, { order: orderWithItems(o) });
});
function restoreOrderStock(o, actorId) {
  for (const it of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id)) {
    if (it.kind === 'store') { db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(it.qty, it.product_id);
      db.prepare('INSERT INTO stock_movements(product_id,delta,reason,ref,user_id) VALUES(?,?,?,?,?)').run(it.product_id, it.qty, 'order-cancelled', o.ref, actorId); }
    else { db.prepare("UPDATE listings SET status='active', reserved_order_id=NULL WHERE id=? AND status IN ('reserved','sold')").run(it.listing_id);
      db.prepare("UPDATE settlements SET status='cancelled' WHERE order_id=? AND status='pending'").run(o.id); }
  }
}
app.post('/api/my/orders/:ref/cancel', A.requireAuth, A.csrfGuard, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=? AND user_id=?').get(clean(req.params.ref, 30), req.user.id);
  if (!o) return err(res, 404, 'Order not found.');
  if (!['pending', 'confirmed'].includes(o.status)) return err(res, 409, 'This order can no longer be cancelled online. Please contact the store.');
  tx(() => { db.prepare("UPDATE orders SET status='cancelled',updated_at=datetime('now') WHERE id=?").run(o.id); restoreOrderStock(o, req.user.id);
    db.prepare('INSERT INTO order_events(order_id,status,note,user_id) VALUES(?,?,?,?)').run(o.id, 'cancelled', clean(req.body.reason, 200) || 'Cancelled by customer', req.user.id); });
  audit(req.user.id, 'order_cancelled', 'order', o.ref, '', req.ip); ok(res, {});
});
app.post('/api/my/orders/:ref/return', A.requireAuth, A.csrfGuard, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=? AND user_id=?').get(clean(req.params.ref, 30), req.user.id);
  if (!o) return err(res, 404, 'Order not found.'); if (o.status !== 'delivered') return err(res, 409, 'Only delivered orders can be returned.');
  if (!clean(req.body.reason, 500)) return err(res, 400, 'Please tell us the reason.');
  tx(() => { db.prepare("UPDATE orders SET status='return_requested' WHERE id=?").run(o.id);
    db.prepare('INSERT INTO returns(order_id,user_id,reason) VALUES(?,?,?)').run(o.id, req.user.id, clean(req.body.reason, 500));
    db.prepare('INSERT INTO order_events(order_id,status,note,user_id) VALUES(?,?,?,?)').run(o.id, 'return_requested', clean(req.body.reason, 200), req.user.id); });
  ok(res, { message: 'Return requested. The store will review it against the return policy.' });
});
app.post('/api/my/orders/:ref/reorder', A.requireAuth, A.csrfGuard, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=? AND user_id=?').get(clean(req.params.ref, 30), req.user.id);
  if (!o) return err(res, 404, 'Order not found.'); const key = 'u:' + req.user.id; let added = 0;
  for (const it of db.prepare("SELECT * FROM order_items WHERE order_id=? AND kind='store'").all(o.id)) {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
    if (p && p.status === 'published' && p.stock >= it.qty) { db.prepare(`INSERT INTO cart_items(owner_key,product_id,qty) VALUES(?,?,?) ON CONFLICT(owner_key,product_id) WHERE product_id IS NOT NULL DO UPDATE SET qty=excluded.qty`).run(key, p.id, it.qty); added++; }
  }
  ok(res, { added, cart: cartView(key), message: added ? 'Available items added to your cart.' : 'None of the store items are currently in stock.' });
});
app.get('/api/my/notifications', A.requireAuth, (req, res) => ok(res, { items: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id) }));
app.post('/api/my/notifications/read', A.requireAuth, A.csrfGuard, (req, res) => { db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id); ok(res, {}); });
app.get('/api/my/sales', A.requireAuth, (req, res) => ok(res, {
  listings: db.prepare('SELECT * FROM listings WHERE seller_id=? ORDER BY id DESC').all(req.user.id).map(l => ({ ...l, images: JSON.parse(l.images || '[]') })),
  settlements: db.prepare('SELECT s.*, l.title FROM settlements s JOIN listings l ON l.id=s.listing_id WHERE s.seller_id=? ORDER BY s.id DESC').all(req.user.id) }));

/* ---------- seller listings ---------- */
const listingSan = b => ({ title: clean(b.title, 160), author: clean(b.author, 120), isbn: clean(b.isbn, 20), edition: clean(b.edition, 40),
  board: clean(b.board, 60), class: clean(b.class, 30), subject: clean(b.subject, 60), language: clean(b.language, 40),
  condition_grade: clean(b.condition_grade, 30) || 'good', defects: clean(b.defects, 500), description: clean(b.description, 1500),
  price_paise: intIn(b.price_paise, 100, 100000000, 0),
  images: JSON.stringify((Array.isArray(b.images) ? b.images : []).slice(0, 5).map(x => clean(x, 500)).filter(x => /^https?:\/\//.test(x) || x.startsWith('/uploads/'))) });
app.post('/api/listings', A.requireAuth, A.csrfGuard, (req, res) => {
  const d = listingSan(req.body); if (!d.title || !d.price_paise) return err(res, 400, 'Book title and a valid asking price are required.');
  const moderate = getSettings().marketplace_moderation === '1';
  const status = req.body.submit ? (moderate ? 'submitted' : 'active') : 'draft';
  const id = db.prepare(`INSERT INTO listings(seller_id,title,author,isbn,edition,board,class,subject,language,condition_grade,defects,description,price_paise,images,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, d.title, d.author, d.isbn, d.edition, d.board, d.class, d.subject, d.language, d.condition_grade, d.defects, d.description, d.price_paise, d.images, status).lastInsertRowid;
  db.prepare('INSERT INTO listing_events(listing_id,status,user_id) VALUES(?,?,?)').run(id, status, req.user.id);
  ok(res, { id, status, ...U.commissionFor(d.price_paise), message: status === 'submitted' ? 'Submitted for store review.' : status === 'active' ? 'Your book is now live.' : 'Draft saved.' });
});
app.patch('/api/listings/:id', A.requireAuth, A.csrfGuard, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND seller_id=?').get(intIn(req.params.id, 0, 1e9, 0), req.user.id);
  if (!l) return err(res, 404, 'Listing not found.'); if (!['draft', 'rejected'].includes(l.status)) return err(res, 409, 'Only draft or rejected listings can be edited. Withdraw first if needed.');
  const d = listingSan({ ...l, ...req.body, images: req.body.images ?? JSON.parse(l.images || '[]') });
  db.prepare(`UPDATE listings SET title=?,author=?,isbn=?,edition=?,board=?,class=?,subject=?,language=?,condition_grade=?,defects=?,description=?,price_paise=?,images=?,updated_at=datetime('now') WHERE id=?`)
    .run(d.title, d.author, d.isbn, d.edition, d.board, d.class, d.subject, d.language, d.condition_grade, d.defects, d.description, d.price_paise, d.images, l.id); ok(res, {});
});
app.post('/api/listings/:id/action', A.requireAuth, A.csrfGuard, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=? AND seller_id=?').get(intIn(req.params.id, 0, 1e9, 0), req.user.id);
  if (!l) return err(res, 404, 'Listing not found.'); const a = clean(req.body.action, 20), moderate = getSettings().marketplace_moderation === '1';
  const next = a === 'submit' && ['draft', 'rejected'].includes(l.status) ? (moderate ? 'submitted' : 'active')
            : a === 'withdraw' && ['draft', 'submitted', 'under_review', 'active'].includes(l.status) ? 'withdrawn' : null;
  if (!next) return err(res, 409, 'This action is not allowed for the current listing status.');
  db.prepare("UPDATE listings SET status=?,updated_at=datetime('now') WHERE id=?").run(next, l.id);
  db.prepare('INSERT INTO listing_events(listing_id,status,user_id) VALUES(?,?,?)').run(l.id, next, req.user.id); ok(res, { status: next });
});
app.post('/api/listings/:id/report', A.requireAuth, A.csrfGuard, (req, res) => {
  if (!clean(req.body.reason, 500)) return err(res, 400, 'Please describe the problem.');
  db.prepare('INSERT INTO reports(listing_id,reporter_id,reason) VALUES(?,?,?)').run(intIn(req.params.id, 0, 1e9, 0), req.user.id, clean(req.body.reason, 500)); ok(res, { message: 'Reported. Our moderators will review this listing.' });
});

/* ---------- reviews, enquiries, restock ---------- */
app.post('/api/reviews', A.requireAuth, A.csrfGuard, (req, res) => {
  const pid = intIn(req.body.product_id, 0, 1e9, 0), rating = intIn(req.body.rating, 1, 5, 0);
  if (!pid || !rating) return err(res, 400, 'Product and rating are required.');
  if (db.prepare('SELECT id FROM reviews WHERE product_id=? AND user_id=?').get(pid, req.user.id)) return err(res, 409, 'You have already reviewed this product.');
  const verified = db.prepare(`SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=? AND oi.product_id=? AND o.status='delivered'`).get(req.user.id, pid) ? 1 : 0;
  db.prepare('INSERT INTO reviews(product_id,user_id,rating,title,body,verified) VALUES(?,?,?,?,?,?)').run(pid, req.user.id, rating, clean(req.body.title, 120), clean(req.body.body, 1000), verified); ok(res, {});
});
app.post('/api/enquiries', A.csrfGuard, A.rateLimit(10, 600000), (req, res) => {
  const b = req.body || {}; if (b.website) return ok(res, {}); // honeypot anti-spam
  if (!clean(b.subject, 160) || !clean(b.message, 2000)) return err(res, 400, 'Subject and message are required.');
  if (!req.user && (!clean(b.guest_name, 80) || !clean(b.guest_contact, 120))) return err(res, 400, 'Your name and a phone or email are required so the store can reply.');
  const kind = ['general', 'stock', 'bulk', 'support', 'product_question', 'contact'].includes(b.kind) ? b.kind : 'general';
  db.prepare('INSERT INTO enquiries(user_id,guest_name,guest_contact,kind,product_id,subject,message) VALUES(?,?,?,?,?,?,?)')
    .run(req.user ? req.user.id : null, clean(b.guest_name, 80), clean(b.guest_contact, 120), kind, intIn(b.product_id, 0, 1e9, 0) || null, clean(b.subject, 160), clean(b.message, 2000));
  ok(res, { message: 'Enquiry sent. This is an enquiry, not a confirmed order — the store will reply with availability and pricing.' });
});
app.get('/api/my/enquiries', A.requireAuth, (req, res) => ok(res, { items: db.prepare('SELECT * FROM enquiries WHERE user_id=? ORDER BY id DESC').all(req.user.id) }));
app.post('/api/restock', A.csrfGuard, (req, res) => {
  const pid = intIn(req.body.product_id, 0, 1e9, 0); const contact = req.user ? req.user.email : clean(req.body.contact, 120);
  if (!pid || !contact) return err(res, 400, 'Product and a contact email/phone are required.');
  db.prepare('INSERT INTO restock_requests(product_id,user_id,contact) VALUES(?,?,?)').run(pid, req.user ? req.user.id : null, contact);
  ok(res, { message: 'Noted — the store will contact you if this item is restocked. (In-app requests are visible to staff; email alerts activate once email is configured.)' });
});
app.post('/api/upload', A.requireAuth, A.csrfGuard, (req, res) => { // base64 image, magic-byte checked, ≤2MB — no fake upload
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(String(req.body.dataUrl || ''));
  if (!m) return err(res, 400, 'Upload a PNG, JPG or WebP image.');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 2 * 1024 * 1024 || buf.length < 100) return err(res, 400, 'Image must be under 2 MB.');
  const magic = { png: buf.slice(0, 4).equals(Buffer.from([137, 80, 78, 71])), jpeg: buf[0] === 0xff && buf[1] === 0xd8, webp: buf.slice(8, 12).toString() === 'WEBP' }[m[1]];
  if (!magic) return err(res, 400, 'File content does not match its image type.');
  const dir = path.join(__dirname, '..', 'public', 'uploads'); fs.mkdirSync(dir, { recursive: true });
  const fn = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(dir, fn), buf); ok(res, { url: '/uploads/' + fn });
});

/* ---------- ADMIN ---------- */
const admin = express.Router();
admin.use(A.requireAuth, (req, res, next) => A.isStaff(req.user) ? next() : err(res, 403, 'Staff access only.'));
admin.get('/overview', (req, res) => {
  const from = clean(req.query.from, 10) || '2000-01-01', to = (clean(req.query.to, 10) || '2999-12-31') + ' 23:59:59';
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const paidStatuses = "o.status NOT IN ('cancelled','payment_failed','refunded')";
  ok(res, {
    orders_today: q(`SELECT COUNT(*) n FROM orders o WHERE date(o.created_at)=date('now','localtime')`).n,
    orders_period: q('SELECT COUNT(*) n FROM orders o WHERE o.created_at BETWEEN ? AND ?', from, to).n,
    gross_paise: q(`SELECT COALESCE(SUM(o.total_paise),0) n FROM orders o WHERE o.created_at BETWEEN ? AND ? AND ${paidStatuses}`, from, to).n,
    store_sales_paise: q(`SELECT COALESCE(SUM(oi.line_total_paise),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.kind='store' AND o.created_at BETWEEN ? AND ? AND ${paidStatuses}`, from, to).n,
    marketplace_gross_paise: q(`SELECT COALESCE(SUM(oi.line_total_paise),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.kind='marketplace' AND o.created_at BETWEEN ? AND ? AND ${paidStatuses}`, from, to).n,
    commission_paise: q(`SELECT COALESCE(SUM(oi.commission_paise),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.created_at BETWEEN ? AND ? AND ${paidStatuses}`, from, to).n,
    pending_orders: q(`SELECT COUNT(*) n FROM orders WHERE status IN ('pending','confirmed','processing')`).n,
    low_stock: q('SELECT COUNT(*) n FROM products WHERE stock>0 AND stock<=reorder_at').n,
    out_stock: q('SELECT COUNT(*) n FROM products WHERE stock=0 AND status=\'published\'').n,
    customers: q("SELECT COUNT(*) n FROM users WHERE role='customer'").n,
    open_enquiries: q("SELECT COUNT(*) n FROM enquiries WHERE status='open'").n,
    pending_listings: q("SELECT COUNT(*) n FROM listings WHERE status IN ('submitted','under_review')").n,
    pending_settlements_paise: q("SELECT COALESCE(SUM(proceeds_paise),0) n FROM settlements WHERE status='pending'").n,
    open_returns: q("SELECT COUNT(*) n FROM orders WHERE status='return_requested'").n,
    best_sellers: db.prepare(`SELECT oi.title_snapshot title, SUM(oi.qty) qty, SUM(oi.line_total_paise) total FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${paidStatuses} GROUP BY title ORDER BY qty DESC LIMIT 5`).all(),
    by_category: db.prepare(`SELECT COALESCE(c.name,'Uncategorised/Marketplace') name, SUM(oi.line_total_paise) total FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id WHERE ${paidStatuses} GROUP BY name ORDER BY total DESC`).all(),
    daily: db.prepare(`SELECT date(o.created_at) d, COUNT(*) orders, SUM(o.total_paise) total FROM orders o WHERE o.created_at>=date('now','-13 days') AND ${paidStatuses} GROUP BY d ORDER BY d`).all(),
    recent_orders: db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 8').all(),
  });
});
/* products */
const prodSan = b => ({ title: clean(b.title, 200), description: clean(b.description, 4000), category_id: intIn(b.category_id, 0, 1e9, 0) || null,
  brand: clean(b.brand, 80), sku: clean(b.sku, 60), isbn: clean(b.isbn, 20), author: clean(b.author, 120), publisher: clean(b.publisher, 120),
  edition: clean(b.edition, 40), board: clean(b.board, 60), class: clean(b.class, 30), subject: clean(b.subject, 60), language: clean(b.language, 40),
  price_paise: intIn(b.price_paise, 0, 1e9, 0), mrp_paise: intIn(b.mrp_paise, 0, 1e9, 0) || null, stock: intIn(b.stock, 0, 1e9, 0),
  reorder_at: intIn(b.reorder_at, 0, 1e5, 5), status: ['published', 'draft', 'archived'].includes(b.status) ? b.status : 'published',
  featured: b.featured ? 1 : 0, image_url: clean(b.image_url, 500) });
admin.get('/products', A.requirePerm('catalog'), (req, res) => {
  const q = '%' + clean(req.query.q, 80) + '%';
  ok(res, { rows: db.prepare('SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.title LIKE ? OR p.sku LIKE ? OR p.isbn LIKE ? ORDER BY p.id DESC LIMIT 300').all(q, q, q) });
});
admin.post('/products', A.requirePerm('catalog'), A.csrfGuard, (req, res) => {
  const d = prodSan(req.body); if (!d.title) return err(res, 400, 'Product title is required.');
  let slug = U.slugify(d.title); if (db.prepare('SELECT id FROM products WHERE slug=?').get(slug)) slug += '-' + Date.now().toString(36);
  const id = db.prepare(`INSERT INTO products(slug,title,description,category_id,brand,sku,isbn,author,publisher,edition,board,class,subject,language,price_paise,mrp_paise,stock,reorder_at,status,featured,image_url)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, d.title, d.description, d.category_id, d.brand, d.sku, d.isbn, d.author, d.publisher, d.edition, d.board, d.class, d.subject, d.language, d.price_paise, d.mrp_paise, d.stock, d.reorder_at, d.status, d.featured, d.image_url).lastInsertRowid;
  if (d.stock) db.prepare('INSERT INTO stock_movements(product_id,delta,reason,user_id) VALUES(?,?,?,?)').run(id, d.stock, 'initial-stock', req.user.id);
  audit(req.user.id, 'product_create', 'product', id, d.title, req.ip); ok(res, { id, slug });
});
admin.put('/products/:id', A.requirePerm('catalog'), A.csrfGuard, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(intIn(req.params.id, 0, 1e9, 0)); if (!p) return err(res, 404, 'Product not found.');
  const d = prodSan(req.body);
  tx(() => { db.prepare(`UPDATE products SET title=?,description=?,category_id=?,brand=?,sku=?,isbn=?,author=?,publisher=?,edition=?,board=?,class=?,subject=?,language=?,price_paise=?,mrp_paise=?,stock=?,reorder_at=?,status=?,featured=?,image_url=?,updated_at=datetime('now') WHERE id=?`)
    .run(d.title, d.description, d.category_id, d.brand, d.sku, d.isbn, d.author, d.publisher, d.edition, d.board, d.class, d.subject, d.language, d.price_paise, d.mrp_paise, d.stock, d.reorder_at, d.status, d.featured, d.image_url, p.id);
    if (d.stock !== p.stock) db.prepare('INSERT INTO stock_movements(product_id,delta,reason,user_id) VALUES(?,?,?,?)').run(p.id, d.stock - p.stock, 'admin-adjustment', req.user.id); });
  audit(req.user.id, 'product_update', 'product', p.id, `stock ${p.stock}→${d.stock}, price ${p.price_paise}→${d.price_paise}`, req.ip); ok(res, {});
});
admin.delete('/products/:id', A.requirePerm('catalog'), A.csrfGuard, (req, res) => {
  const id = intIn(req.params.id, 0, 1e9, 0);
  if (db.prepare('SELECT id FROM order_items WHERE product_id=? LIMIT 1').get(id)) { db.prepare("UPDATE products SET status='archived' WHERE id=?").run(id); return ok(res, { archived: true, message: 'Product has order history, so it was archived instead of deleted.' }); }
  db.prepare('DELETE FROM products WHERE id=?').run(id); audit(req.user.id, 'product_delete', 'product', id, '', req.ip); ok(res, {});
});
admin.post('/products/:id/stock', A.requirePerm('inventory'), A.csrfGuard, (req, res) => {
  const id = intIn(req.params.id, 0, 1e9, 0), delta = intIn(req.body.delta, -1e6, 1e6, 0);
  if (!delta) return err(res, 400, 'Enter a non-zero adjustment.');
  const r = db.prepare('UPDATE products SET stock=stock+? WHERE id=? AND stock+?>=0').run(delta, id, delta);
  if (!r.changes) return err(res, 409, 'Adjustment would make stock negative or product not found.');
  db.prepare('INSERT INTO stock_movements(product_id,delta,reason,user_id) VALUES(?,?,?,?)').run(id, delta, clean(req.body.reason, 120) || 'manual-adjustment', req.user.id);
  audit(req.user.id, 'stock_adjust', 'product', id, (delta > 0 ? '+' : '') + delta, req.ip); ok(res, { stock: db.prepare('SELECT stock FROM products WHERE id=?').get(id).stock });
});
admin.get('/inventory', A.requirePerm('inventory'), (req, res) => ok(res, {
  rows: db.prepare('SELECT id,title,sku,stock,reorder_at,status FROM products ORDER BY (stock<=reorder_at) DESC, stock ASC LIMIT 300').all(),
  movements: db.prepare('SELECT m.*,p.title,u.name user_name FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 100').all(),
  restock: db.prepare('SELECT r.*,p.title FROM restock_requests r JOIN products p ON p.id=r.product_id ORDER BY r.id DESC LIMIT 50').all() }));
admin.post('/products/import', A.requirePerm('catalog'), A.csrfGuard, (req, res) => { // bulk import w/ per-row error report
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : []; const results = []; let created = 0;
  rows.forEach((r, i) => { try { const d = prodSan({ ...r, price_paise: Math.round((+r.price_rs || 0) * 100), mrp_paise: Math.round((+r.mrp_rs || 0) * 100) });
    if (!d.title || !d.price_paise) throw new Error('title and price_rs required');
    let slug = U.slugify(d.title); if (db.prepare('SELECT id FROM products WHERE slug=?').get(slug)) slug += '-' + (i + 1);
    db.prepare(`INSERT INTO products(slug,title,description,category_id,brand,sku,isbn,author,publisher,edition,board,class,subject,language,price_paise,mrp_paise,stock,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, d.title, d.description, d.category_id, d.brand, d.sku, d.isbn, d.author, d.publisher, d.edition, d.board, d.class, d.subject, d.language, d.price_paise, d.mrp_paise, d.stock, d.status); created++; results.push({ row: i + 1, ok: true }); }
    catch (e) { results.push({ row: i + 1, ok: false, error: e.message }); } });
  audit(req.user.id, 'product_import', 'product', '', created + ' created', req.ip); ok(res, { created, results });
});
admin.get('/products/export.csv', A.requirePerm('catalog'), (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
  const csv = ['id,title,sku,isbn,board,class,subject,price_rs,stock,status', ...rows.map(r => [r.id, JSON.stringify(r.title), r.sku, r.isbn, r.board, r.class, r.subject, r.price_paise / 100, r.stock, r.status].join(','))].join('\n');
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=products.csv' }).send(csv);
});
admin.post('/categories', A.requirePerm('catalog'), A.csrfGuard, (req, res) => {
  const name = clean(req.body.name, 80); if (!name) return err(res, 400, 'Name required.');
  db.prepare('INSERT OR IGNORE INTO categories(name,slug,icon,sort) VALUES(?,?,?,?)').run(name, U.slugify(name), clean(req.body.icon, 8) || '📦', intIn(req.body.sort, 0, 999, 0)); ok(res, {});
});
admin.delete('/categories/:id', A.requirePerm('catalog'), A.csrfGuard, (req, res) => { db.prepare('UPDATE categories SET active=0 WHERE id=?').run(intIn(req.params.id, 0, 1e9, 0)); ok(res, {}); });
admin.post('/meta', A.requirePerm('catalog'), A.csrfGuard, (req, res) => {
  if (!['board', 'class', 'subject', 'language', 'condition'].includes(req.body.kind) || !clean(req.body.value, 60)) return err(res, 400, 'Kind and value required.');
  db.prepare('INSERT OR IGNORE INTO meta_options(kind,value) VALUES(?,?)').run(req.body.kind, clean(req.body.value, 60)); ok(res, {});
});
admin.delete('/meta/:id', A.requirePerm('catalog'), A.csrfGuard, (req, res) => { db.prepare('UPDATE meta_options SET active=0 WHERE id=?').run(intIn(req.params.id, 0, 1e9, 0)); ok(res, {}); });
admin.get('/meta', A.requirePerm('catalog'), (req, res) => ok(res, { rows: db.prepare('SELECT * FROM meta_options WHERE active=1 ORDER BY kind,value').all() }));
/* orders */
admin.get('/orders', A.requirePerm('orders'), (req, res) => {
  const w = [], a = []; if (req.query.status) { w.push('o.status=?'); a.push(clean(req.query.status, 30)); }
  if (req.query.q) { w.push('(o.ref LIKE ? OR o.guest_name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)'); const q = '%' + clean(req.query.q, 60) + '%'; a.push(q, q, q, q); }
  ok(res, { rows: db.prepare(`SELECT o.*, u.name customer_name, u.email customer_email FROM orders o LEFT JOIN users u ON u.id=o.user_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 200`).all(...a) });
});
admin.get('/orders/:id', A.requirePerm('orders'), (req, res) => {
  const o = db.prepare('SELECT o.*, u.name customer_name, u.email customer_email, u.phone customer_phone FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?').get(intIn(req.params.id, 0, 1e9, 0));
  if (!o) return err(res, 404, 'Order not found.'); ok(res, { order: orderWithItems(o) });
});
admin.post('/orders/:id/status', A.requirePerm('orders'), A.csrfGuard, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(intIn(req.params.id, 0, 1e9, 0)); if (!o) return err(res, 404, 'Order not found.');
  const next = clean(req.body.status, 30);
  if (!(U.ORDER_TRANSITIONS[o.status] || []).includes(next)) return err(res, 409, `Cannot move an order from “${o.status}” to “${next}”.`);
  if (next === 'refunded' && !A.can(req.user, 'refund')) return err(res, 403, 'Your role cannot issue refunds.');
  if ((next === 'shipped') && o.fulfilment === 'pickup') return err(res, 409, 'Pickup orders use “Ready for Pickup”, not “Shipped”.');
  if ((next === 'ready_for_pickup') && o.fulfilment === 'delivery') return err(res, 409, 'Delivery orders use “Shipped”, not “Ready for Pickup”.');
  tx(() => {
    db.prepare("UPDATE orders SET status=?, tracking_ref=?, updated_at=datetime('now'), payment_status=CASE WHEN ?='delivered' AND payment_method='cod' THEN 'paid' WHEN ?='refunded' THEN 'refunded' ELSE payment_status END WHERE id=?")
      .run(next, clean(req.body.tracking_ref, 80) || o.tracking_ref, next, next, o.id);
    db.prepare('INSERT INTO order_events(order_id,status,note,user_id) VALUES(?,?,?,?)').run(o.id, next, clean(req.body.note, 300), req.user.id);
    if (next === 'cancelled' || next === 'refunded') { restoreOrderStock(o, req.user.id); if (next === 'refunded') db.prepare("UPDATE returns SET status='refunded' WHERE order_id=?").run(o.id); }
    if (next === 'delivered') for (const it of db.prepare("SELECT * FROM order_items WHERE order_id=? AND kind='marketplace'").all(o.id)) {
      db.prepare("UPDATE listings SET status='sold' WHERE id=? AND status='reserved'").run(it.listing_id);
      db.prepare('INSERT INTO listing_events(listing_id,status,user_id) VALUES(?,?,?)').run(it.listing_id, 'sold', req.user.id);
      db.prepare('INSERT INTO settlements(listing_id,order_id,seller_id,gross_paise,commission_paise,proceeds_paise) VALUES(?,?,?,?,?,?)')
        .run(it.listing_id, o.id, it.seller_id, it.line_total_paise, it.commission_paise, it.seller_proceeds_paise);
      notify(it.seller_id, 'Your book sold', `“${it.title_snapshot}” sold via order ${o.ref}. Proceeds of ${U.inr(it.seller_proceeds_paise)} are pending settlement by the store.`);
    }
    if (o.user_id) notify(o.user_id, 'Order update: ' + o.ref, `Status is now ${next.replace(/_/g, ' ')}.`);
  });
  audit(req.user.id, 'order_status', 'order', o.ref, `${o.status}→${next}`, req.ip); ok(res, { status: next });
});
admin.post('/orders/:id/payment', A.requirePerm('finance'), A.csrfGuard, (req, res) => {
  if (!['unpaid', 'paid', 'refunded', 'failed'].includes(req.body.payment_status)) return err(res, 400, 'Invalid payment status.');
  db.prepare('UPDATE orders SET payment_status=? WHERE id=?').run(req.body.payment_status, intIn(req.params.id, 0, 1e9, 0));
  audit(req.user.id, 'order_payment', 'order', req.params.id, req.body.payment_status, req.ip); ok(res, {});
});
/* customers */
admin.get('/customers', A.requirePerm('customers'), (req, res) => {
  const q = '%' + clean(req.query.q, 60) + '%';
  ok(res, { rows: db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.status,u.created_at,(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) orders FROM users u WHERE u.name LIKE ? OR u.email LIKE ? ORDER BY u.id DESC LIMIT 200`).all(q, q) });
});
admin.post('/customers/:id/status', A.requirePerm('customers'), A.csrfGuard, (req, res) => {
  const id = intIn(req.params.id, 0, 1e9, 0); if (id === req.user.id) return err(res, 400, 'You cannot suspend your own account.');
  const t = db.prepare('SELECT role FROM users WHERE id=?').get(id); if (!t) return err(res, 404, 'User not found.');
  if (t.role === 'owner') return err(res, 403, 'The owner account cannot be suspended here.');
  db.prepare('UPDATE users SET status=? WHERE id=?').run(req.body.status === 'suspended' ? 'suspended' : 'active', id);
  if (req.body.status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(req.user.id, 'customer_status', 'user', id, req.body.status, req.ip); ok(res, {});
});
admin.post('/customers/:id/reset-link', A.requirePerm('customers'), A.csrfGuard, (req, res) => { // staff-assisted recovery (no email provider configured)
  const id = intIn(req.params.id, 0, 1e9, 0); const tok = crypto.randomBytes(24).toString('base64url');
  db.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+2 hours'))").run(id, A.sha(tok));
  audit(req.user.id, 'password_reset_issued', 'user', id, 'verify identity before sharing', req.ip);
  ok(res, { reset_path: '/#/reset?token=' + tok, note: 'Share this one-time link (valid 2 hours) only after verifying the customer\u2019s identity.' });
});
/* marketplace moderation / finance */
admin.get('/listings', A.requirePerm('marketplace'), (req, res) => ok(res, {
  rows: db.prepare(`SELECT l.*, u.name seller_name FROM listings l JOIN users u ON u.id=l.seller_id ORDER BY (l.status IN ('submitted','under_review')) DESC, l.id DESC LIMIT 200`).all().map(l => ({ ...l, images: JSON.parse(l.images || '[]') })),
  reports: db.prepare(`SELECT r.*, l.title, u.name reporter FROM reports r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.reporter_id ORDER BY r.id DESC LIMIT 50`).all() }));
admin.post('/listings/:id/moderate', A.requirePerm('marketplace'), A.csrfGuard, (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id=?').get(intIn(req.params.id, 0, 1e9, 0)); if (!l) return err(res, 404, 'Listing not found.');
  const map = { approve: 'active', reject: 'rejected', suspend: 'suspended', review: 'under_review', reinstate: 'active' };
  const next = map[clean(req.body.action, 20)]; if (!next) return err(res, 400, 'Invalid action.');
  if (['sold', 'reserved'].includes(l.status) && next !== l.status) return err(res, 409, 'Reserved/sold listings cannot be moderated this way.');
  db.prepare("UPDATE listings SET status=?, moderator_note=?, updated_at=datetime('now') WHERE id=?").run(next, clean(req.body.note, 500), l.id);
  db.prepare('INSERT INTO listing_events(listing_id,status,note,user_id) VALUES(?,?,?,?)').run(l.id, next, clean(req.body.note, 300), req.user.id);
  audit(req.user.id, 'listing_moderate', 'listing', l.id, `${l.status}→${next}`, req.ip);
  notify(l.seller_id, 'Listing ' + next, `Your listing “${l.title}” is now ${next}. ${clean(req.body.note, 200)}`); ok(res, { status: next });
});
admin.post('/reports/:id/resolve', A.requirePerm('marketplace'), A.csrfGuard, (req, res) => { db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(intIn(req.params.id, 0, 1e9, 0)); ok(res, {}); });
admin.get('/settlements', A.requirePerm('finance'), (req, res) => ok(res, {
  rows: db.prepare(`SELECT s.*, l.title, u.name seller_name, u.email seller_email, o.ref FROM settlements s JOIN listings l ON l.id=s.listing_id JOIN users u ON u.id=s.seller_id JOIN orders o ON o.id=s.order_id ORDER BY s.id DESC`).all(),
  rules: db.prepare('SELECT * FROM commission_rules ORDER BY id DESC').all() }));
admin.post('/settlements/:id', A.requirePerm('finance'), A.csrfGuard, (req, res) => {
  const st = ['pending', 'paid', 'disputed'].includes(req.body.status) ? req.body.status : null; if (!st) return err(res, 400, 'Invalid status.');
  db.prepare("UPDATE settlements SET status=?, method_note=?, paid_at=CASE WHEN ?='paid' THEN datetime('now') ELSE paid_at END WHERE id=?").run(st, clean(req.body.method_note, 200), st, intIn(req.params.id, 0, 1e9, 0));
  audit(req.user.id, 'settlement_' + st, 'settlement', req.params.id, clean(req.body.method_note, 120), req.ip); ok(res, {});
});
admin.post('/commission', A.requirePerm('finance'), A.csrfGuard, (req, res) => {
  const kind = req.body.kind === 'fixed' ? 'fixed' : 'percent'; const value = intIn(req.body.value, 0, kind === 'percent' ? 90 : 1e8, -1);
  if (value < 0) return err(res, 400, 'Enter a valid commission value.');
  tx(() => { db.prepare('UPDATE commission_rules SET active=0').run();
    db.prepare('INSERT INTO commission_rules(kind,value,label,created_by) VALUES(?,?,?,?)').run(kind, value, clean(req.body.label, 120) || (kind === 'percent' ? value + '% commission' : 'Fixed ' + U.inr(value)), req.user.id); });
  audit(req.user.id, 'commission_change', 'commission_rules', '', `${kind}:${value}`, req.ip); ok(res, { rule: U.activeCommission() });
});
/* promotions / support / reviews */
admin.get('/promotions', A.requirePerm('promotions'), (req, res) => ok(res, { rows: db.prepare('SELECT * FROM promotions ORDER BY id DESC').all() }));
admin.post('/promotions', A.requirePerm('promotions'), A.csrfGuard, (req, res) => {
  const b = req.body || {}; const code = clean(b.code, 40).toUpperCase();
  if (!code || !['percent', 'fixed'].includes(b.kind) || !(+b.value > 0)) return err(res, 400, 'Code, type and value are required.');
  try { db.prepare('INSERT INTO promotions(code,kind,value,min_subtotal_paise,starts_at,expires_at,usage_limit) VALUES(?,?,?,?,?,?,?)')
    .run(code, b.kind, intIn(b.value, 1, 1e8, 1), intIn(b.min_subtotal_paise, 0, 1e9, 0), clean(b.starts_at, 30) || null, clean(b.expires_at, 30) || null, intIn(b.usage_limit, 0, 1e6, 0) || null); }
  catch { return err(res, 409, 'A code with this name already exists.'); }
  audit(req.user.id, 'promotion_create', 'promotion', code, '', req.ip); ok(res, {});
});
admin.post('/promotions/:id/toggle', A.requirePerm('promotions'), A.csrfGuard, (req, res) => { db.prepare('UPDATE promotions SET active=1-active WHERE id=?').run(intIn(req.params.id, 0, 1e9, 0)); ok(res, {}); });
admin.get('/support', A.requirePerm('support'), (req, res) => ok(res, {
  enquiries: db.prepare('SELECT e.*, u.name user_name FROM enquiries e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 150').all(),
  reviews: db.prepare('SELECT r.*, u.name user_name, p.title product_title FROM reviews r JOIN users u ON u.id=r.user_id LEFT JOIN products p ON p.id=r.product_id ORDER BY r.id DESC LIMIT 100').all() }));
admin.post('/enquiries/:id', A.requirePerm('support'), A.csrfGuard, (req, res) => {
  const e = db.prepare('SELECT * FROM enquiries WHERE id=?').get(intIn(req.params.id, 0, 1e9, 0)); if (!e) return err(res, 404, 'Not found.');
  db.prepare('UPDATE enquiries SET admin_reply=?, status=? WHERE id=?').run(clean(req.body.reply, 2000), req.body.close ? 'closed' : 'replied', e.id);
  if (e.user_id) notify(e.user_id, 'Reply from Ankit Stationery Mart', clean(req.body.reply, 300)); ok(res, {});
});
admin.post('/reviews/:id', A.requirePerm('support'), A.csrfGuard, (req, res) => {
  if (!['published', 'hidden'].includes(req.body.status)) return err(res, 400, 'Invalid status.');
  db.prepare('UPDATE reviews SET status=? WHERE id=?').run(req.body.status, intIn(req.params.id, 0, 1e9, 0)); ok(res, {});
});
/* suppliers */
admin.get('/suppliers', A.requirePerm('suppliers'), (req, res) => ok(res, {
  suppliers: db.prepare('SELECT * FROM suppliers ORDER BY name').all(),
  pos: db.prepare('SELECT po.*, s.name supplier, p.title FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id JOIN products p ON p.id=po.product_id ORDER BY po.id DESC').all() }));
admin.post('/suppliers', A.requirePerm('suppliers'), A.csrfGuard, (req, res) => {
  if (!clean(req.body.name, 120)) return err(res, 400, 'Supplier name required.');
  ok(res, { id: db.prepare('INSERT INTO suppliers(name,contact,notes) VALUES(?,?,?)').run(clean(req.body.name, 120), clean(req.body.contact, 200), clean(req.body.notes, 500)).lastInsertRowid });
});
admin.post('/purchase-orders', A.requirePerm('suppliers'), A.csrfGuard, (req, res) => {
  const sid = intIn(req.body.supplier_id, 1, 1e9, 0), pid = intIn(req.body.product_id, 1, 1e9, 0), qty = intIn(req.body.qty, 1, 1e6, 0);
  if (!sid || !pid || !qty) return err(res, 400, 'Supplier, product and quantity are required.');
  ok(res, { id: db.prepare('INSERT INTO purchase_orders(supplier_id,product_id,qty,cost_paise) VALUES(?,?,?,?)').run(sid, pid, qty, intIn(req.body.cost_paise, 0, 1e9, 0)).lastInsertRowid });
});
admin.post('/purchase-orders/:id/receive', A.requirePerm('suppliers'), A.csrfGuard, (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(intIn(req.params.id, 0, 1e9, 0));
  if (!po || po.status !== 'ordered') return err(res, 409, 'Purchase order is not awaiting receipt.');
  tx(() => { db.prepare("UPDATE purchase_orders SET status='received', received_at=datetime('now') WHERE id=?").run(po.id);
    db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(po.qty, po.product_id);
    db.prepare('INSERT INTO stock_movements(product_id,delta,reason,ref,user_id) VALUES(?,?,?,?,?)').run(po.product_id, po.qty, 'purchase-receipt', 'PO-' + po.id, req.user.id); });
  audit(req.user.id, 'po_receive', 'purchase_order', po.id, '+' + po.qty, req.ip); ok(res, {});
});
/* reports / staff / settings / audit */
admin.get('/reports.csv', A.requirePerm('reports'), (req, res) => {
  const rows = db.prepare(`SELECT date(o.created_at) d, COUNT(DISTINCT o.id) orders, SUM(o.total_paise)/100.0 gross_rs, COALESCE(SUM(oi.commission_paise),0)/100.0 commission_rs
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.status NOT IN ('cancelled','payment_failed') GROUP BY d ORDER BY d`).all();
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=sales-report.csv' })
    .send(['date,orders,gross_rs,commission_rs', ...rows.map(r => [r.d, r.orders, r.gross_rs, r.commission_rs].join(','))].join('\n'));
});
admin.get('/staff', A.requirePerm('staff'), (req, res) => ok(res, { rows: db.prepare('SELECT id,name,email,role,status,created_at FROM users ORDER BY id').all(), perms: A_PERMS }));
admin.post('/staff/:id/role', A.requirePerm('staff'), A.csrfGuard, (req, res) => {
  const id = intIn(req.params.id, 0, 1e9, 0), role = clean(req.body.role, 20);
  if (!['customer', 'admin', 'inventory', 'fulfilment', 'support', 'moderator', 'readonly'].includes(role)) return err(res, 400, 'Invalid role (owner cannot be assigned here).');
  if (id === req.user.id) return err(res, 400, 'You cannot change your own role.');
  db.prepare('UPDATE users SET role=? WHERE id=? AND role!=\'owner\'').run(role, id);
  audit(req.user.id, 'role_change', 'user', id, role, req.ip); ok(res, {});
});
admin.post('/staff', A.requirePerm('staff'), A.csrfGuard, (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!U.isEmail(email) || String(password || '').length < 8) return err(res, 400, 'Valid email and 8+ character password required.');
  if (!['admin', 'inventory', 'fulfilment', 'support', 'moderator', 'readonly'].includes(role)) return err(res, 400, 'Choose a staff role.');
  const { salt, hash } = A.hashPassword(password);
  try { const id = db.prepare('INSERT INTO users(email,name,pass_hash,salt,role) VALUES(?,?,?,?,?)').run(clean(email, 120).toLowerCase(), clean(name, 80), hash, salt, role).lastInsertRowid;
    audit(req.user.id, 'staff_create', 'user', id, role, req.ip); ok(res, { id }); } catch { return err(res, 409, 'Email already in use.'); }
});
admin.get('/settings', A.requirePerm('settings'), (req, res) => ok(res, { settings: getSettings() }));
admin.put('/settings', A.requirePerm('settings'), A.csrfGuard, (req, res) => {
  const allowed = Object.keys(getSettings()); const upd = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => { for (const [k, v] of Object.entries(req.body.settings || {})) if (allowed.includes(k)) upd.run(k, clean(v, 8000)); });
  audit(req.user.id, 'settings_update', 'settings', '', Object.keys(req.body.settings || {}).join(','), req.ip); ok(res, { settings: getSettings() });
});
admin.get('/audit', A.requirePerm('reports'), (req, res) => ok(res, {
  rows: db.prepare('SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200').all() }));
app.use('/api/admin', admin);

/* ---------- invoice / SEO / static ---------- */
app.get('/api/orders/:id/invoice', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(intIn(req.params.id, 0, 1e9, 0));
  if (!o) return res.status(404).send('Not found');
  if (!((req.user && o.user_id === req.user.id) || A.isStaff(req.user))) return res.status(403).send('Forbidden');
  const full = orderWithItems(o), s = getSettings();
  const rows = full.items.map(i => `<tr><td>${U.esc(i.title_snapshot)}${i.kind === 'marketplace' ? ' (second-hand marketplace)' : ''}</td><td>${i.qty}</td><td>${U.inr(i.price_paise)}</td><td>${U.inr(i.line_total_paise)}</td></tr>`).join('');
  res.set('Content-Type', 'text/html').send(`<!doctype html><title>Invoice ${o.ref}</title><body style="font-family:Arial;max-width:700px;margin:32px auto">
   <h2>${U.esc(s.store_name)}</h2><p>${U.esc(s.address)}<br>${U.esc(s.phone)} ${U.esc(s.email)}</p><h3>Invoice ${o.ref}</h3>
   <p>Date: ${o.created_at} · Status: ${o.status} · Payment: ${o.payment_method} (${o.payment_status})<br>Fulfilment: ${o.fulfilment}</p>
   <table border=1 cellspacing=0 cellpadding=8 style="border-collapse:collapse;width:100%"><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>${rows}</table>
   <p style="text-align:right">Subtotal ${U.inr(o.subtotal_paise)}<br>Discount −${U.inr(o.discount_paise)}<br>Delivery ${U.inr(o.delivery_fee_paise)}<br><b>Total ${U.inr(o.total_paise)}</b></p>
   <p>${U.esc(s.tax_note)}</p><button onclick="print()">Print / Save PDF</button></body>`);
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\n'));
app.get('/sitemap.xml', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const urls = ['', '#/shop', '#/used', '#/bulk', '#/about', '#/contact', '#/faq']
    .concat(db.prepare("SELECT slug FROM products WHERE status='published' LIMIT 500").all().map(p => '#/product/' + p.slug))
    .map(u => `<url><loc>${base}/${u}</loc></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));
app.get('*', (req, res) => { if (req.path.startsWith('/api/')) return err(res, 404, 'Not found.'); res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); });
app.use((e, req, res, _n) => { console.error(e); err(res, 500, 'Something went wrong. Please try again.'); });

if (require.main === module) app.listen(PORT, '0.0.0.0', () => console.log(`Ankit Stationery Mart → http://0.0.0.0:${PORT}  (DB: ${require('./db').DB_PATH})`));
module.exports = { app };
