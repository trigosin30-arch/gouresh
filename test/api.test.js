'use strict';
/* End-to-end acceptance tests against a throwaway DB (node --test). */
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.DB_PATH = path.join(os.tmpdir(), 'asm-test-' + Date.now() + '.db');
const { test, before, after } = require('node:test'); const assert = require('node:assert');
const { app } = require('../src/server'); const { db } = require('../src/db'); const { hashPassword } = require('../src/auth');
let server, base;
class Client {
  constructor() { this.cookies = new Map(); this.csrf = ''; }
  async req(method, url, body) {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)); });
    const data = await r.json().catch(() => ({})); if (data.csrf) this.csrf = data.csrf; return { status: r.status, data };
  }
  get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b || {}); }
  async boot() { const d = await this.get('/api/bootstrap'); this.csrf = d.data.csrf; return d; }
  async login(email, pw = 'TestPass123') { await this.boot(); const r = await this.post('/api/auth/login', { email, password: pw }); assert.equal(r.data.ok, true, 'login ' + email + ': ' + JSON.stringify(r.data)); return r; }
}
function mkUser(email, role = 'customer', name = 'T') { const { salt, hash } = hashPassword('TestPass123');
  return db.prepare('INSERT INTO users(email,name,pass_hash,salt,role) VALUES(?,?,?,?,?)').run(email, name, hash, salt, role).lastInsertRowid; }
let owner, seller, buyer2, productId, scarceId, listingId, orderRef, orderId;
before(async () => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  mkUser('owner@test.local', 'owner', 'Owner'); owner = new Client(); await owner.login('owner@test.local'); });
after(() => { server.close(); try { fs.rmSync(process.env.DB_PATH); } catch {} });

test('1. empty store: honest zeros, then admin product appears on storefront', async () => {
  const ov = await owner.get('/api/admin/overview'); assert.equal(ov.data.orders_today, 0); assert.equal(ov.data.gross_paise, 0);
  const c = await owner.post('/api/admin/products', { title: 'Test Notebook', price_paise: 10000, stock: 5, board: 'CBSE', class: '10', subject: 'Mathematics' });
  assert.equal(c.data.ok, true, JSON.stringify(c.data)); productId = c.data.id;
  const s = await owner.post('/api/admin/products', { title: 'Scarce Pen', price_paise: 5000, stock: 1 }); scarceId = s.data.id;
  const pub = await new Client().get('/api/products?board=CBSE&class=10');
  assert.equal(pub.data.rows.length, 1); assert.equal(pub.data.rows[0].title, 'Test Notebook');
});
test('2. customer journey: register → cart → checkout → order; stock decrements', async () => {
  seller = new Client(); await seller.boot();
  let r = await seller.post('/api/auth/register', { name: 'Seller S', email: 'seller@test.local', password: 'TestPass123' }); assert.equal(r.data.ok, true, JSON.stringify(r.data));
  buyer2 = new Client(); await buyer2.boot();
  r = await buyer2.post('/api/auth/register', { name: 'Buyer B', email: 'buyer@test.local', password: 'TestPass123' }); assert.equal(r.data.ok, true);
  r = await seller.post('/api/cart/add', { product_id: productId, qty: 2 }); assert.equal(r.data.cart.subtotal_paise, 20000);
  r = await seller.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'store_pay', name: 'Seller S', phone: '9999999999', idempotency_key: 't1' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data)); orderRef = r.data.ref; orderId = r.data.oid;
  const again = await seller.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'store_pay', idempotency_key: 't1' });
  assert.equal(again.data.duplicate, true, 'duplicate submit must not create a second order');
  const prod = await seller.get('/api/products/test-notebook'); assert.equal(prod.data.product.stock, 3);
  const mine = await seller.get('/api/my/orders/' + orderRef); assert.equal(mine.data.order.total_paise, 20000);
});
test('3. overselling prevented (stock=1, second buyer fails; qty>stock blocked)', async () => {
  let r = await seller.post('/api/cart/add', { product_id: scarceId, qty: 5 }); assert.equal(r.data.ok, false);
  await seller.post('/api/cart/add', { product_id: scarceId, qty: 1 }); await buyer2.post('/api/cart/add', { product_id: scarceId, qty: 1 });
  r = await seller.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'cod', idempotency_key: 't2' }); assert.equal(r.data.ok, true, JSON.stringify(r.data));
  r = await buyer2.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'cod', idempotency_key: 't3' }); assert.equal(r.data.ok, false, 'second checkout must fail');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(scarceId).stock, 0);
});
test('4. IDOR: another customer cannot see my order; guest track needs phone', async () => {
  const r = await buyer2.get('/api/my/orders/' + orderRef); assert.equal(r.status, 404);
  const g = await new Client().get('/api/orders/track?ref=' + orderRef + '&phone=wrong'); assert.equal(g.status, 403);
});
async function clearCart(c) { const v = await c.get('/api/cart'); for (const i of v.data.cart.items) await c.req('DELETE', '/api/cart/' + i.id); }
test('5. discount: valid applies, expired rejected server-side', async () => {
  await clearCart(buyer2); await clearCart(seller);
  await owner.post('/api/admin/promotions', { code: 'OK10', kind: 'percent', value: 10, min_subtotal_paise: 0 });
  db.prepare('INSERT INTO promotions(code,kind,value,expires_at) VALUES(\'OLD\',\'percent\',50,\'2020-01-01\')').run();
  await buyer2.post('/api/cart/add', { product_id: productId, qty: 1 });
  let r = await buyer2.post('/api/cart/quote', { promo_code: 'OK10', fulfilment: 'pickup' }); assert.equal(r.data.discount_paise, 1000);
  r = await buyer2.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'cod', promo_code: 'OLD', idempotency_key: 't4' }); assert.equal(r.data.ok, false);
  r = await buyer2.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'cod', promo_code: 'OK10', idempotency_key: 't5' }); assert.equal(r.data.ok, true);
  assert.equal(db.prepare('SELECT total_paise FROM orders WHERE ref=?').get(r.data.ref).total_paise, 9000);
});
test('6+7. marketplace: submit → approve → single-copy purchase; commission snapshot', async () => {
  let r = await seller.post('/api/listings', { title: 'Used Maths Book', price_paise: 20000, condition_grade: 'good', defects: 'pencil marks', submit: true });
  assert.equal(r.data.status, 'submitted'); listingId = r.data.id; assert.equal(r.data.fee, 2000); assert.equal(r.data.proceeds, 18000);
  const pre = await buyer2.get('/api/listings'); assert.equal(pre.data.rows.length, 0, 'unapproved listing must be hidden');
  r = await owner.post(`/api/admin/listings/${listingId}/moderate`, { action: 'approve' }); assert.equal(r.data.status, 'active');
  r = await buyer2.post('/api/cart/add', { listing_id: listingId }); assert.equal(r.data.ok, true);
  await seller.post('/api/cart/add', { listing_id: listingId }).then(x => assert.equal(x.data.ok, false, 'cannot buy own listing'));
  r = await buyer2.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'cod', idempotency_key: 't6' }); assert.equal(r.data.ok, true);
  orderId = r.data.oid; orderRef = r.data.ref;
  const item = db.prepare("SELECT * FROM order_items WHERE order_id=? AND kind='marketplace'").get(orderId);
  assert.equal(item.commission_paise, 2000); assert.equal(item.seller_proceeds_paise, 18000);
  assert.equal(db.prepare('SELECT status FROM listings WHERE id=?').get(listingId).status, 'reserved');
  const third = new Client(); await third.boot(); await third.post('/api/auth/register', { name: 'C', email: 'c@test.local', password: 'TestPass123' });
  const t = await third.post('/api/cart/add', { listing_id: listingId }); assert.equal(t.data.ok, false, 'sold/reserved copy cannot be bought twice');
});
test('8. order lifecycle: invalid jump rejected, valid path to delivered creates settlement', async () => {
  let r = await owner.post(`/api/admin/orders/${orderId}/status`, { status: 'delivered' }); assert.equal(r.status, 409);
  for (const s of ['confirmed', 'processing', 'ready_for_pickup', 'delivered']) { r = await owner.post(`/api/admin/orders/${orderId}/status`, { status: s }); assert.equal(r.data.ok, true, s + JSON.stringify(r.data)); }
  const st = db.prepare('SELECT * FROM settlements WHERE order_id=?').get(orderId);
  assert.equal(st.gross_paise, 20000); assert.equal(st.commission_paise, 2000); assert.equal(st.proceeds_paise, 18000); assert.equal(st.status, 'pending');
  assert.equal(db.prepare('SELECT status FROM listings WHERE id=?').get(listingId).status, 'sold');
  const sales = await seller.get('/api/my/sales'); assert.equal(sales.data.settlements.length, 1);
});
test('9. RBAC: inventory staff cannot touch commission/staff/finance', async () => {
  mkUser('inv@test.local', 'inventory', 'Inv'); const inv = new Client(); await inv.login('inv@test.local');
  let r = await inv.post('/api/admin/commission', { kind: 'percent', value: 99 }); assert.equal(r.status, 403);
  r = await inv.get('/api/admin/staff'); assert.equal(r.status, 403);
  r = await inv.post(`/api/admin/products/${productId}/stock`, { delta: 4, reason: 'received' }); assert.equal(r.data.stock, 6);
  const anon = await new Client().get('/api/admin/overview'); assert.equal(anon.status, 401);
});
test('10. price tampering impossible: client-sent totals are ignored', async () => {
  await buyer2.post('/api/cart/add', { product_id: productId, qty: 1 });
  const r = await buyer2.post('/api/checkout', { fulfilment: 'pickup', payment_method: 'cod', total_paise: 1, subtotal_paise: 1, idempotency_key: 't7' });
  assert.equal(db.prepare('SELECT total_paise FROM orders WHERE ref=?').get(r.data.ref).total_paise, 10000);
});
