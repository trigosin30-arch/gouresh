'use strict';
/* ⚠️ DEMO DATA ONLY — explicitly labelled sample catalogue for evaluation.
   Never run against a production database with real customers.
   Creates: owner demo@example.com / Demo@1234, customer Aarav@example.com / Demo@1234,
   sample stationery + books, one promo (SCHOOL10) and approved used-book listings. */
const { db, tx } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { slugify } = require('../src/util');
function user(email, name, role) {
  const ex = db.prepare('SELECT id FROM users WHERE email=?').get(email); if (ex) return ex.id;
  const { salt, hash } = hashPassword('Demo@1234');
  return db.prepare('INSERT INTO users(email,name,pass_hash,salt,role,phone) VALUES(?,?,?,?,?,?)')
    .run(email, name, hash, salt, role, '9876543210').lastInsertRowid;
}
const owner = user('demo@example.com', 'Demo Store Owner', 'owner');
const moderator = user('moderator@example.com', 'Demo Moderator', 'moderator');
const Aarav = user('Aarav@example.com', 'Aarav', 'customer');
const Meera = user('Meera@example.com', 'Meera (Demo Seller)', 'customer');
const cat = s => db.prepare('SELECT id FROM categories WHERE slug=?').get(s).id;
const P = [
  ['NCERT Mathematics Class 10 (DEMO listing)', 'books', 18000, 22000, 25, { author: 'NCERT', publisher: 'NCERT', isbn: '9788174500001', board: 'CBSE', class: '10', subject: 'Mathematics', language: 'English', featured: 1 }],
  ['NCERT Science Class 9 (DEMO listing)', 'books', 16500, 19000, 18, { author: 'NCERT', publisher: 'NCERT', isbn: '9788174500002', board: 'CBSE', class: '9', subject: 'Science', language: 'English' }],
  ['English Grammar & Composition — High School (DEMO)', 'books', 39500, 45000, 12, { author: 'Demo Author', subject: 'English', language: 'English', class: '10' }],
  ['Punjabi Sahit Class 8 — PSEB (DEMO)', 'books', 14000, 16000, 0, { board: 'PSEB (Punjab Board)', class: '8', subject: 'Punjabi', language: 'Punjabi' }],
  ['Long Notebook A4 172 Pages — Pack of 6 (DEMO)', 'notebooks-paper', 29900, 36000, 60, { brand: 'DemoBrand', featured: 1 }],
  ['Gel Pen Set 0.5mm Blue — Pack of 10 (DEMO)', 'stationery', 14900, 20000, 120, { brand: 'DemoBrand', featured: 1 }],
  ['Geometry Box 11 Instruments (DEMO)', 'school-supplies', 24900, 29900, 8, { brand: 'DemoBrand' }],
  ['Watercolour Cake Set 24 Shades with Brush (DEMO)', 'art-craft', 19900, 25000, 30, { brand: 'DemoBrand' }],
  ['A4 Copier Paper 75 GSM — 500 Sheets (DEMO)', 'office-supplies', 34000, 38500, 45, { brand: 'DemoBrand' }],
  ['School Bag 3-Compartment 28L (DEMO)', 'school-supplies', 89900, 129900, 6, { brand: 'DemoBrand', featured: 1 }],
];
tx(() => {
  for (const [title, c, price, mrp, stock, x] of P) {
    if (db.prepare('SELECT id FROM products WHERE title=?').get(title)) continue;
    const id = db.prepare(`INSERT INTO products(slug,title,description,category_id,brand,isbn,author,publisher,board,class,subject,language,price_paise,mrp_paise,stock,featured,sku)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slugify(title), title,
      'Demo product seeded for evaluation. Replace with real catalogue data from Admin → Products.',
      cat(c), x.brand || '', x.isbn || '', x.author || '', x.publisher || '', x.board || '', x.class || '', x.subject || '', x.language || '', price, mrp, stock, x.featured || 0, 'DEMO-' + Math.floor(Math.random() * 1e5)).lastInsertRowid;
    if (stock) db.prepare('INSERT INTO stock_movements(product_id,delta,reason,user_id) VALUES(?,?,?,?)').run(id, stock, 'demo-seed', owner);
  }
  db.prepare(`INSERT OR IGNORE INTO promotions(code,kind,value,min_subtotal_paise) VALUES('SCHOOL10','percent',10,29900)`).run();
  const L = [
    ['NCERT Mathematics Class 10 — Used (DEMO)', 'NCERT', 'CBSE', '10', 'Mathematics', 'good', 'Light pencil marks on 3 pages, binding intact.', 9000, '/img/used-books.jpg'],
    ['Harry Potter and the Philosopher\'s Stone — Used (DEMO)', 'J.K. Rowling', '', '', 'General', 'like-new', 'Read once, no markings.', 25000, '/img/school-books.jpg'],
    ['Physics Part 1 Class 11 NCERT — Used (DEMO)', 'NCERT', 'CBSE', '11', 'Physics', 'acceptable', 'Highlighting in 2 chapters, cover slightly worn.', 11000, '/img/used-books.jpg'],
  ];
  for (const [t, a, b, cl, s, cond, def, price, img] of L) {
    if (db.prepare('SELECT id FROM listings WHERE title=?').get(t)) continue;
    const id = db.prepare(`INSERT INTO listings(seller_id,title,author,board,class,subject,condition_grade,defects,description,price_paise,images,status,language)
      VALUES(?,?,?,?,?,?,?,?,?,?,?, 'active','English')`).run(Meera, t, a, b, cl, s, cond, def, 'Demo second-hand listing.', price, JSON.stringify([img])).lastInsertRowid;
    db.prepare('INSERT INTO listing_events(listing_id,status,user_id) VALUES(?,?,?)').run(id, 'active', moderator);
  }
  db.prepare(`INSERT INTO settings(key,value) VALUES('about',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run('Ankit Stationery Mart is a local stationery and bookstore at 147 Moolraj Road, Jalandhar Cantt. (Demo text — edit in Admin → Settings.)');
  db.prepare('INSERT OR IGNORE INTO suppliers(name,contact,notes) VALUES(?,?,?)').run('Demo Supplier Traders', 'Replace with real supplier contact', 'Demo row');
});
console.log('✅ DEMO seed complete. Owner: demo@example.com / Demo@1234 · Customer: Aarav@example.com / Demo@1234 · Seller: Meera@example.com / Demo@1234 · Promo: SCHOOL10');
