'use strict';
/* PostgreSQL access.
   - The application connects as a non-owner role, so Row Level Security always applies.
   - Every company-scoped unit of work runs in `tx(companyId, fn)`, which sets app.company_id
     for that transaction only (SET LOCAL semantics via set_config(..., true)).
   - Platform work (login, sessions, company list) uses `platform(fn)` with no company set:
     tenant tables then return no rows at all. */
const pg = require('pg');
const log = require('./log');

pg.types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));   // numeric -> number
pg.types.setTypeParser(20, v => (v == null ? null : parseInt(v, 10)));   // int8 -> number (counts)
pg.types.setTypeParser(1082, v => v);                                     // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1231, v => (v == null ? null : pg.types.arrayParser.create(v, parseFloat).parse())); // numeric[]

let pool = null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function init(cfg) {
  pool = new pg.Pool({
    host: cfg.host, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password,
    ssl: cfg.ssl, max: cfg.max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    application_name: 'motus',
    statement_timeout: 60000,
  });
  pool.on('error', err => log.error('db pool error', { err }));
  return pool;
}

async function run(companyId, fn, opts = {}) {
  if (companyId != null && !UUID.test(companyId)) throw Object.assign(new Error('invalid company id'), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query(opts.readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query("SELECT set_config('app.company_id', $1, true), set_config('TimeZone', 'UTC', true)", [companyId || '']);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

const tx = (companyId, fn) => {
  if (!companyId) throw Object.assign(new Error('company context required'), { status: 400 });
  return run(companyId, fn);
};
const read = (companyId, fn) => run(companyId, fn, { readOnly: true });
const platform = fn => run(null, fn);

async function query(text, params) { return pool.query(text, params); }
async function close() { if (pool) await pool.end(); }

/* small helpers used by services */
const one = async (c, sql, p) => (await c.query(sql, p)).rows[0] || null;
const all = async (c, sql, p) => (await c.query(sql, p)).rows;

module.exports = { init, tx, read, platform, query, close, one, all, UUID, get pool() { return pool; } };
