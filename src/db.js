'use strict';
/* Real persistent SQLite database via Node's built-in node:sqlite.
   FILE-backed (survives restarts), WAL mode, foreign keys ON.
   All money is stored as integer paise (₹1 = 100). */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'ankit.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const MIGRATIONS = [`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','owner','admin','inventory','fulfilment','support','moderator','readonly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS password_resets(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, icon TEXT DEFAULT '📦',
  kind TEXT NOT NULL DEFAULT 'store', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS meta_options(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('board','class','subject','language','condition')),
  value TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(kind,value));
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id), brand TEXT DEFAULT '', sku TEXT DEFAULT '', isbn TEXT DEFAULT '',
  author TEXT DEFAULT '', publisher TEXT DEFAULT '', edition TEXT DEFAULT '',
  board TEXT DEFAULT '', class TEXT DEFAULT '', subject TEXT DEFAULT '', language TEXT DEFAULT '',
  price_paise INTEGER NOT NULL CHECK(price_paise>=0), mrp_paise INTEGER,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), reorder_at INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','draft','archived')),
  featured INTEGER NOT NULL DEFAULT 0, image_url TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_products_search ON products(title,author,isbn,board,class,subject,status);
CREATE TABLE IF NOT EXISTS stock_movements(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  delta INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT DEFAULT '', user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS addresses(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Home', name TEXT NOT NULL, phone TEXT NOT NULL, line TEXT NOT NULL,
  city TEXT NOT NULL, pin TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'Punjab', is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cart_items(
  id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id), listing_id INTEGER,
  qty INTEGER NOT NULL CHECK(qty>0), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((product_id IS NOT NULL) != (listing_id IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_prod ON cart_items(owner_key,product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_list ON cart_items(owner_key,listing_id) WHERE listing_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS wishlists(
  id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, product_id INTEGER, listing_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS promotions(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK(value>0), min_subtotal_paise INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT, expires_at TEXT, usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS commission_rules(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')), value INTEGER NOT NULL CHECK(value>=0),
  label TEXT NOT NULL, effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  active INTEGER NOT NULL DEFAULT 1, created_by INTEGER);
CREATE TABLE IF NOT EXISTS listings(
  id INTEGER PRIMARY KEY, seller_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, author TEXT DEFAULT '', isbn TEXT DEFAULT '', edition TEXT DEFAULT '',
  board TEXT DEFAULT '', class TEXT DEFAULT '', subject TEXT DEFAULT '', language TEXT DEFAULT '',
  condition_grade TEXT NOT NULL DEFAULT 'good', defects TEXT DEFAULT '', description TEXT DEFAULT '',
  price_paise INTEGER NOT NULL CHECK(price_paise>0), images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','active','reserved','sold','rejected','suspended','withdrawn')),
  moderator_note TEXT DEFAULT '', reserved_order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_listings ON listings(status,board,class,subject);
CREATE TABLE IF NOT EXISTS listing_events(
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT DEFAULT '', user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id),
  guest_name TEXT DEFAULT '', guest_phone TEXT DEFAULT '', guest_email TEXT DEFAULT '',
  fulfilment TEXT NOT NULL CHECK(fulfilment IN ('delivery','pickup')),
  address_snapshot TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','processing','ready_for_pickup','shipped','delivered','cancelled','payment_failed','return_requested','refunded')),
  payment_method TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded','failed')),
  subtotal_paise INTEGER NOT NULL, discount_paise INTEGER NOT NULL DEFAULT 0,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL,
  promo_code TEXT DEFAULT '', notes TEXT DEFAULT '', tracking_ref TEXT DEFAULT '',
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('store','marketplace')),
  product_id INTEGER, listing_id INTEGER, title_snapshot TEXT NOT NULL,
  price_paise INTEGER NOT NULL, qty INTEGER NOT NULL CHECK(qty>0), line_total_paise INTEGER NOT NULL,
  commission_rule TEXT DEFAULT '', commission_paise INTEGER NOT NULL DEFAULT 0,
  seller_id INTEGER, seller_proceeds_paise INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_events(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT DEFAULT '', user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS returns(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested',
  admin_note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settlements(
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL, order_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
  gross_paise INTEGER NOT NULL, commission_paise INTEGER NOT NULL, proceeds_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','disputed','cancelled')),
  method_note TEXT DEFAULT '', paid_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  listing_id INTEGER, user_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title TEXT DEFAULT '', body TEXT DEFAULT '', verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','pending','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS enquiries(
  id INTEGER PRIMARY KEY, user_id INTEGER, guest_name TEXT DEFAULT '', guest_contact TEXT DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('general','stock','bulk','support','product_question','contact')),
  product_id INTEGER, subject TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','replied','closed')),
  admin_reply TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS restock_requests(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, user_id INTEGER, contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT DEFAULT '', notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS purchase_orders(
  id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL CHECK(qty>0),
  cost_paise INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','received','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), received_at TEXT);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT DEFAULT '', is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id TEXT DEFAULT '', detail TEXT DEFAULT '', ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
`];
for (const m of MIGRATIONS) db.exec(m);

/* Default (editable in Admin → Settings). No invented phone/email/policies. */
const DEFAULT_SETTINGS = {
  store_name: 'Ankit Stationery Mart',
  tagline: 'Stationery, books & second-hand books — Jalandhar Cantt',
  address: '147 Moolraj Road, Jalandhar Cantt, Punjab 144005, India',
  phone: '', email: '', opening_hours: '',
  delivery_enabled: '1', pickup_enabled: '1',
  service_pins: '144005', delivery_fee_paise: '4000', free_delivery_above_paise: '49900',
  min_delivery_order_paise: '0',
  payment_cod: '1', payment_store_pay: '1', payment_online: '0',
  online_payment_note: 'Online payment is not configured yet. Please choose Cash on Delivery or Pay at Store.',
  marketplace_moderation: '1',
  hero_title: 'Everything for school, office & reading', hero_subtitle: 'New books, stationery and pre-loved second-hand books from your neighbourhood store.',
  return_policy: '', privacy_policy: '', terms: '', faq: '', about: '',
  tax_note: 'All prices include applicable taxes unless stated otherwise.',
};
const insS = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insS.run(k, v);
db.prepare(`INSERT INTO commission_rules(kind,value,label) SELECT 'percent',10,'Standard marketplace commission — 10%'
            WHERE NOT EXISTS (SELECT 1 FROM commission_rules)`).run();
const insM = db.prepare('INSERT OR IGNORE INTO meta_options(kind,value) VALUES(?,?)');
[['board','CBSE'],['board','PSEB (Punjab Board)'],['board','ICSE'],['board','Other'],
 ...['Nursery','KG','1','2','3','4','5','6','7','8','9','10','11','12','College','Competitive Exams'].map(c=>['class',c]),
 ...['English','Hindi','Punjabi','Mathematics','Science','Social Science','Physics','Chemistry','Biology','Computer Science','Accounts','Economics','General'].map(s=>['subject',s]),
 ...['English','Hindi','Punjabi'].map(l=>['language',l]),
 ['condition','like-new'],['condition','good'],['condition','acceptable'],['condition','worn']
].forEach(([k,v])=>insM.run(k,v));
const insC = db.prepare('INSERT OR IGNORE INTO categories(name,slug,icon,kind,sort) VALUES(?,?,?,?,?)');
[['Books','books','📚',1],['Stationery','stationery','✏️',2],['School Supplies','school-supplies','🎒',3],
 ['Office Supplies','office-supplies','🗂️',4],['Art & Craft','art-craft','🎨',5],['Notebooks & Paper','notebooks-paper','📓',6]
].forEach(([n,s,i,o])=>insC.run(n,s,i,'store',o));

function tx(fn) { // Immediate write transaction: prevents concurrent overselling
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}
function getSettings() {
  const out = {}; for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}
module.exports = { db, tx, getSettings, DB_PATH };
