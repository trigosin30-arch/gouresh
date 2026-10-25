'use strict';
const { db } = require('./db');
const inr = p => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item'; }
function audit(userId, action, entity, entityId, detail, ip) {
  try { db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,detail,ip) VALUES(?,?,?,?,?,?)')
    .run(userId || null, action, entity, String(entityId ?? ''), String(detail ?? '').slice(0, 500), String(ip || '').slice(0, 64)); } catch (_) {}
}
function notify(userId, title, body) {
  if (!userId) return;
  try { db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(userId, title, body || ''); } catch (_) {}
}
function err(res, status, msg, code) { return res.status(status).json({ ok: false, error: msg, code: code || 'ERROR' }); }
function ok(res, data) { return res.json({ ok: true, ...data }); }
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
const clean = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const intIn = (v, min, max, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
function activeCommission() {
  return db.prepare('SELECT * FROM commission_rules WHERE active=1 ORDER BY id DESC LIMIT 1').get()
      || { kind: 'percent', value: 10, label: '10% commission' };
}
function commissionFor(pricePaise) {
  const r = activeCommission();
  const fee = r.kind === 'percent' ? Math.round(pricePaise * r.value / 100) : Math.min(r.value, pricePaise);
  return { rule: r, fee, proceeds: pricePaise - fee };
}
/* Order lifecycle — enforced server-side */
const ORDER_TRANSITIONS = {
  pending: ['confirmed', 'cancelled', 'payment_failed'],
  confirmed: ['processing', 'cancelled'],
  processing: ['ready_for_pickup', 'shipped', 'cancelled'],
  ready_for_pickup: ['delivered', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['return_requested'],
  return_requested: ['refunded', 'delivered'],
  cancelled: [], payment_failed: ['pending', 'cancelled'], refunded: [],
};
const LISTING_FLOW = ['draft', 'submitted', 'under_review', 'active', 'reserved', 'sold'];
module.exports = { inr, esc, slugify, audit, notify, err, ok, isEmail, clean, intIn, commissionFor, activeCommission, ORDER_TRANSITIONS, LISTING_FLOW };
