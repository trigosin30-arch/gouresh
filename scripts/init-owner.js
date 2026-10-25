'use strict';
/* Production first-run: create the Owner account from environment variables.
   Usage: OWNER_EMAIL=you@example.com OWNER_NAME="Owner" OWNER_PASSWORD='…' node scripts/init-owner.js */
const { db } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD } = process.env;
if (!OWNER_EMAIL || !OWNER_PASSWORD || OWNER_PASSWORD.length < 10) {
  console.error('Set OWNER_EMAIL and OWNER_PASSWORD (10+ chars).'); process.exit(1);
}
if (db.prepare("SELECT id FROM users WHERE role='owner'").get()) { console.error('An owner already exists.'); process.exit(1); }
const { salt, hash } = hashPassword(OWNER_PASSWORD);
const id = db.prepare("INSERT INTO users(email,name,pass_hash,salt,role) VALUES(?,?,?,?,'owner')")
  .run(OWNER_EMAIL.toLowerCase(), OWNER_NAME || 'Store Owner', hash, salt).lastInsertRowid;
console.log('Owner created with id', id, '— sign in at /#/login then visit /#/admin');
