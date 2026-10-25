'use strict';
/* Passwords: scrypt + random salt (never plaintextievable).
   Sessions: random token in httpOnly cookie; only its SHA-256 hash is stored.
   CSRF: per-session token required on every mutating API call. */
const crypto = require('crypto');
const { db } = require('./db');
const { err } = require('./util');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function verifyPassword(pw, salt, hash) {
  try { return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 64)); } catch { return false; }
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  db.prepare("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,datetime('now','+7 days'))")
    .run(sha(token), userId, csrf);
  return { token, csrf };
}
function parseCookies(req) {
  const out = {}; String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }); return out;
}
function sessionUser(req) {
  const t = parseCookies(req).asm_session; if (!t) return null;
  const row = db.prepare(`SELECT u.*, s.csrf FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')`).get(sha(t));
  if (!row || row.status !== 'active') return null;
  return row;
}
function attachUser(req, _res, next) { req.user = sessionUser(req); next(); }
function requireAuth(req, res, next) { if (!req.user) return err(res, 401, 'Please sign in to continue.', 'AUTH'); next(); }
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) { // guest mutations (guest cart / checkout / enquiry) require the guest CSRF issued by /api/bootstrap
    const g = parseCookies(req).asm_guest, h = req.headers['x-csrf-token'];
    if (!g || !h || sha(String(h)) !== g) return err(res, 403, 'Session check failed. Please refresh the page.', 'CSRF');
    return next();
  }
  if (req.headers['x-csrf-token'] !== req.user.csrf) return err(res, 403, 'Session check failed. Please refresh and sign in again.', 'CSRF');
  next();
}
/* Least-privilege permission matrix — checked server-side on every admin op */
const PERMS = {
  owner: ['catalog', 'inventory', 'suppliers', 'orders', 'refund', 'customers', 'marketplace', 'promotions', 'support', 'reports', 'settings', 'staff', 'finance'],
  admin: ['catalog', 'inventory', 'suppliers', 'orders', 'refund', 'customers', 'marketplace', 'promotions', 'support', 'reports', 'settings', 'finance'],
  inventory: ['catalog', 'inventory', 'suppliers'],
  fulfilment: ['orders'],
  support: ['support', 'customers', 'orders_view'],
  moderator: ['marketplace', 'support'],
  readonly: ['reports'],
  customer: [],
};
const can = (user, perm) => !!user && (PERMS[user.role] || []).includes(perm);
function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return err(res, 401, 'Please sign in.', 'AUTH');
    if (!can(req.user, perm) && !(perm === 'orders' && can(req.user, 'orders_view') && req.method === 'GET'))
      return err(res, 403, 'Your staff role does not have permission for this action.', 'FORBIDDEN');
    next();
  };
}
const isStaff = u => !!u && u.role !== 'customer';
/* Simple in-memory rate limiter for auth-sensitive endpoints */
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const k = `${req.ip}:${req.path}`, now = Date.now();
    const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return err(res, 429, 'Too many attempts. Please wait a few minutes and try again.', 'RATE');
    hits.set(k, [...arr, now]); next();
  };
}
module.exports = { hashPassword, verifyPassword, sha, createSession, parseCookies, sessionUser, attachUser, requireAuth, csrfGuard, PERMS, can, requirePerm, isStaff, rateLimit };
