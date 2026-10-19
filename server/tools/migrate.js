#!/usr/bin/env node
'use strict';
/* Applies pending SQL migrations as the OWNER role, then (re)applies the application role's
   privileges. Safe to run repeatedly. Exit code 0 = database is at the latest version.
   Usage:  node server/tools/migrate.js            apply pending migrations
           node server/tools/migrate.js --status   list applied / pending (exit 3 if pending) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pg = require('pg');
const config = require('../lib/config');

const DIR = path.join(__dirname, '..', 'migrations');
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

function files() {
  return fs.readdirSync(DIR).filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
}

async function connectOwner(cfg) {
  if (!cfg.db.ownerPassword) throw new Error('MOTUS_DB_OWNER_PASSWORD is not set in the server configuration file. Run the database setup script first.');
  const c = new pg.Client({ host: cfg.db.host, port: cfg.db.port, database: cfg.db.database, user: cfg.db.ownerUser, password: cfg.db.ownerPassword, ssl: cfg.db.ssl, application_name: 'motus-migrate' });
  await c.connect();
  return c;
}

async function status(c) {
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Map((await c.query('SELECT version, checksum FROM schema_migrations')).rows.map(r => [r.version, r.checksum]));
  return files().map(f => {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const sum = crypto.createHash('sha256').update(sql).digest('hex');
    return { file: f, version: f.slice(0, 3), sql, sum, applied: applied.has(f.slice(0, 3)), changed: applied.has(f.slice(0, 3)) && applied.get(f.slice(0, 3)) !== sum };
  });
}

async function grantApp(c, appUser) {
  if (!IDENT.test(appUser)) throw new Error('invalid application role name: ' + appUser);
  const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser])).rowCount;
  if (!exists) throw new Error(`application role "${appUser}" does not exist. Run the database setup script.`);
  const r = (await c.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [appUser])).rows[0];
  if (r.rolsuper || r.rolbypassrls) throw new Error(`application role "${appUser}" must not be a superuser or bypass row level security.`);
  const q = s => c.query(s);
  await q(`GRANT USAGE ON SCHEMA public TO ${appUser}`);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appUser}`);
  await q(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appUser}`);
  await q(`REVOKE ALL ON schema_migrations FROM ${appUser}`);
  await q(`GRANT SELECT ON schema_migrations TO ${appUser}`);
  // history tables are append-only for the application
  await q(`REVOKE UPDATE, DELETE ON audit_log, stock_movements, platform_audit FROM ${appUser}`);
  await q(`GRANT EXECUTE ON FUNCTION api_key_lookup(text), provider_lookup(uuid), webhook_due_companies(), company_counts() TO ${appUser}`);
}

async function main() {
  const cfg = config.load();
  const wantStatus = process.argv.includes('--status');
  const c = await connectOwner(cfg);
  try {
    await c.query("SELECT pg_advisory_lock(hashtext('motus-migrate'))");
    const list = await status(c);
    const changed = list.filter(m => m.changed);
    if (changed.length) throw new Error('applied migration files were modified after being applied: ' + changed.map(m => m.file).join(', '));
    const pending = list.filter(m => !m.applied);
    if (wantStatus) {
      list.forEach(m => console.log(`${m.applied ? 'applied ' : 'PENDING '} ${m.file}`));
      console.log(pending.length ? `${pending.length} pending migration(s)` : 'database is up to date');
      process.exitCode = pending.length ? 3 : 0;
      return;
    }
    for (const m of pending) {
      console.log(`applying ${m.file} ...`);
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [m.version, m.sum]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`migration ${m.file} failed and was rolled back: ${e.message}`);
      }
    }
    await grantApp(c, cfg.db.user);
    console.log(pending.length ? `applied ${pending.length} migration(s); database is up to date` : 'database is up to date');
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('MIGRATION ERROR: ' + e.message); process.exit(1); });
}
module.exports = { files };
