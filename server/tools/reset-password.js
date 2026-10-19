#!/usr/bin/env node
'use strict';
/* Resets a user's password from the server console (for a locked-out admin).
   node server/tools/reset-password.js --email user@example.com [--generate]
   The new password is printed once and must be changed at the next sign-in. Also unlocks the account and
   ends all of its sessions. */
const config = require('../lib/config');
const cfg = config.load();
const db = require('../lib/db');
const auth = require('../lib/auth');

(async () => {
  const v = process.argv.slice(2); const i = v.indexOf('--email');
  const email = i >= 0 ? String(v[i + 1] || '').trim().toLowerCase() : '';
  if (!email) throw new Error('usage: reset-password.js --email <email>');
  db.init(cfg.db);
  const u = (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
  if (!u) throw new Error('no user with that email address');
  const pw = auth.randomPassword(18);
  await db.query('UPDATE users SET password_hash = $1, must_change_password = true, failed_attempts = 0, locked_until = NULL, status = \'active\', password_changed_at = now() WHERE id = $2', [await auth.hashPassword(pw), u.id]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  await db.query("INSERT INTO platform_audit (actor, action, entity, record_ref) VALUES ('console','update','password_reset',$1)", [email]);
  console.log(`Password reset for ${email}.\nTemporary password (shown once, change it at first sign-in): ${pw}`);
})().then(() => db.close()).catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
