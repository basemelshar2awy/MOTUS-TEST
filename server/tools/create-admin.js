#!/usr/bin/env node
'use strict';
/* Creates the first platform administrator (and optionally the first company with its admin).
   Run from the server console only.  Examples:
     node server/tools/create-admin.js --email you@example.com --name "Your Name" --password-file C:\path\pw.txt
     node server/tools/create-admin.js --email you@example.com --name "Your Name" --generate
   (or pass the password in the MOTUS_ADMIN_PASSWORD environment variable)
   Add  --company CODE --company-name "Company Name" --company-admin admin@company.com  to also create a company.
   A generated password is printed once (it must be changed at first sign-in). */
const fs = require('fs');
const config = require('../lib/config');
const cfg = config.load();
const db = require('../lib/db');
const core = require('../lib/core');
const auth = require('../lib/auth');
const platform = require('../lib/platform');

function args() {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (v[i].startsWith('--')) { const k = v[i].slice(2); a[k] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; } }
  return a;
}

(async () => {
  const a = args();
  if (!a.email || !a.name) throw new Error('usage: create-admin.js --email <email> --name <name> (--generate | --password-file <file>) [--company CODE --company-name NAME --company-admin EMAIL]');
  core.setTimezone(cfg.timezone);
  db.init(cfg.db);
  let password, generated = false;
  if (process.env.MOTUS_ADMIN_PASSWORD) { password = process.env.MOTUS_ADMIN_PASSWORD; delete process.env.MOTUS_ADMIN_PASSWORD; }
  else if (a['password-file']) password = fs.readFileSync(a['password-file'], 'utf8').replace(/^\uFEFF/, '').trim();
  else if (a.generate) { password = auth.randomPassword(18); generated = true; }
  else throw new Error('give --generate, --password-file, or set MOTUS_ADMIN_PASSWORD');
  const email = String(a.email).trim().toLowerCase();
  const existing = (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
  if (existing) { console.log(`The user ${email} already exists - nothing changed.`); }
  else {
    await platform.createSuperAdmin(email, String(a.name), password);
    if (generated) await db.query('UPDATE users SET must_change_password = true WHERE email = $1', [email]);
    console.log(`Platform administrator created: ${email}`);
    if (generated) console.log(`Temporary password (shown once, change it at first sign-in): ${password}`);
  }
  if (a.company) {
    const exists = (await db.query('SELECT 1 FROM companies WHERE code = $1', [String(a.company).toUpperCase()])).rowCount;
    if (exists) console.log(`Company ${a.company} already exists - nothing changed.`);
    else {
      const r = await platform.createCompany(null, { code: String(a.company).toUpperCase(), name: { ar: a['company-name-ar'] || a['company-name'], en: a['company-name'] || a['company-name-ar'] }, admin: { email: a['company-admin'] || email + '.co', name: { ar: String(a.name), en: String(a.name) } } });
      console.log(`Company ${r.code} created. Company admin: ${r.adminEmail}${r.temporaryPassword ? '\nTemporary password (shown once): ' + r.temporaryPassword : ''}`);
    }
  }
})().then(() => db.close()).catch(e => { console.error('ERROR: ' + (e.msg ? e.msg.en : e.message)); process.exit(1); });
