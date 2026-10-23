'use strict';
/* Open API v1  (Authorization: Bearer <api key>, scopes like "vehicles:read").
   Reads are generic and paginated; writes go through the same validated actions the UI uses,
   so every rule (hard checks, numbering, journal posting, audit) is identical for integrations.
   Company comes from the key, never from the request. */
const db = require('../lib/db');
const core = require('../lib/core');
const auth = require('../lib/auth');
const erp = require('../lib/erp');
const registry = require('../services/registry');
const activities = require('../lib/activities');
const tracking = require('../services/tracking');
const { AppError, bad, notFound, fromPg } = require('../lib/errors');
const { json, send } = require('../lib/http');

/* resource -> table, scope, write actions */
const RES = {
  vehicles: { table: 'vehicles', scope: 'vehicles', create: 'vehicle.create', update: 'vehicle.update' },
  drivers: { table: 'drivers', scope: 'drivers', create: 'driver.create', update: 'driver.update', hide: ['national_id'] },
  clients: { table: 'clients', scope: 'clients', create: 'client.create', update: 'client.update' },
  bookings: { table: 'bookings', scope: 'bookings', create: 'booking.create', update: 'booking.update', actions: { cancel: 'booking.cancel', assign: 'booking.assign' } },
  trips: { table: 'trips', scope: 'trips', actions: { start: 'trip.start', complete: 'trip.complete', cancel: 'trip.cancel' } },
  programs: { table: 'programs', scope: 'programs', create: 'program.create', actions: { schedule: 'program.schedule', cancel: 'program.cancel' } },
  invoices: { table: 'invoices', scope: 'invoices', create: 'invoice.manual', actions: { cancel: 'invoice.cancel' } },
  payments: { table: 'payments', scope: 'payments', create: 'payment.create' },
  expenses: { table: 'expenses', scope: 'expenses', create: 'expense.create' },
  items: { table: 'items', scope: 'items', create: 'item.create', update: 'item.update' },
  suppliers: { table: 'suppliers', scope: 'suppliers', create: 'supplier.create', update: 'supplier.update' },
  workorders: { table: 'work_orders', scope: 'workorders', create: 'wo.create', update: 'wo.update', actions: { close: 'wo.close', cancel: 'wo.cancel' } },
  fuel: { table: 'fuel_records', scope: 'fuel', create: 'fuel.create' },
  // lines (education, staff, intercity): POST /lines/{id}/generate creates the coming runs
  lines: { table: 'lines', scope: 'lines', create: 'line.create', update: 'line.update', actions: { generate: 'line.generate' } },
  // operating contracts: POST /contracts/{id}/trips confirms a finished trip (idempotent by externalRef)
  contracts: { table: 'contracts', scope: 'contracts', create: 'contract.create', update: 'contract.update', actions: { trips: 'contract.trip', end: 'contract.end', bill: 'contract.bill' } },
  stock: { table: 'stock_movements', scope: 'stock', post: { receipts: 'stock.receipt', adjustments: 'stock.adjust', transfers: 'stock.transfer' } },
};

const camel = s => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
function shape(row, hide) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'company_id' || (hide && hide.includes(k))) continue;
    o[camel(k)] = v instanceof Date ? v.toISOString() : v;
  }
  return o;
}

/* in-memory per-key rate limit: 600 requests / minute */
const buckets = new Map();
function rateLimit(keyId) {
  const now = Date.now(); let b = buckets.get(keyId);
  if (!b || now - b.t > 60000) { b = { t: now, n: 0 }; buckets.set(keyId, b); }
  if (++b.n > 600) throw new AppError(429, 'rate_limited', 'تجاوزت الحد المسموح من الطلبات في الدقيقة', 'Rate limit exceeded (600 requests per minute)');
}

async function authenticate(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+(mk_live_[A-Za-z0-9_-]{10,120})$/.exec(h);
  if (!m) throw new AppError(401, 'no_key', 'مفتاح API غير موجود أو غير صالح', 'Missing or malformed API key (Authorization: Bearer mk_live_…)');
  const r = await db.platform(c => c.query('SELECT * FROM api_key_lookup($1)', [auth.sha256(m[1])]));
  const k = r.rows[0];
  if (!k || k.status !== 'active') throw new AppError(401, 'bad_key', 'مفتاح API غير صحيح أو ملغي', 'The API key is invalid or revoked');
  rateLimit(k.id);
  db.tx(k.company_id, c => c.query('UPDATE api_keys SET last_used = now() WHERE id = $1 AND (last_used IS NULL OR last_used < now() - interval \'1 minute\')', [k.id])).catch(() => {});
  return { keyId: k.id, companyId: k.company_id, scopes: k.scopes, prefix: m[1].slice(0, 17) };
}
const can = (k, scope, mode) => k.scopes.includes(`${scope}:${mode}`) || (mode === 'read' && k.scopes.includes(`${scope}:write`) && false);
const need = (k, scope, mode) => { if (!can(k, scope, mode)) throw new AppError(403, 'scope', `مفتاح API لا يملك الصلاحية ${scope}:${mode}`, `This API key lacks the scope ${scope}:${mode}`); };
const ctxFor = k => ({ companyId: k.companyId, user: { id: null, name: 'API ' + k.prefix, role: 'integration', apiKey: true }, source: 'api', ip: null });

function page(query) {
  const limit = Math.min(Math.max(parseInt(query.get('limit') || '100', 10) || 100, 1), 500);
  let after = null;
  const cur = query.get('cursor');
  if (cur) { try { after = JSON.parse(Buffer.from(cur, 'base64url').toString()); } catch (e) { throw bad('cursor', 'مؤشر الصفحة غير صحيح', 'Invalid cursor', 'cursor'); } }
  return { limit, after };
}

async function list(k, name, query) {
  const r = RES[name];
  need(k, r.scope, 'read');
  const { limit, after } = page(query);
  const p = [], where = ['1=1'];
  const since = query.get('updatedSince');
  if (since) { if (Number.isNaN(Date.parse(since))) throw bad('updatedSince', 'تاريخ غير صحيح', 'updatedSince must be an ISO date/time', 'updatedSince'); p.push(since); where.push(`updated_at >= $${p.length}`); }
  const ext = query.get('externalRef');
  if (ext) { p.push(ext); where.push(`external_ref = $${p.length}`); }
  if (after) { p.push(after.u, after.i); where.push(`(updated_at, id) > ($${p.length - 1}::timestamptz, $${p.length}::uuid)`); }
  p.push(limit + 1);
  const rows = await db.read(k.companyId, async c => (await c.query(`SELECT * FROM ${r.table} WHERE ${where.join(' AND ')} ORDER BY updated_at, id LIMIT $${p.length}`, p)).rows);
  const more = rows.length > limit; const out = rows.slice(0, limit);
  const last = out[out.length - 1];
  return { data: out.map(x => shape(x, r.hide)), nextCursor: more && last ? Buffer.from(JSON.stringify({ u: last.updated_at.toISOString(), i: last.id })).toString('base64url') : null };
}

async function one(k, name, id) {
  const r = RES[name]; need(k, r.scope, 'read');
  if (!db.UUID.test(id)) throw notFound(name);
  const row = await db.read(k.companyId, async c => (await c.query(`SELECT * FROM ${r.table} WHERE id = $1`, [id])).rows[0]);
  if (!row) throw notFound(name);
  return { data: shape(row, r.hide) };
}

async function idempotent(k, req, fn) {
  const key = String(req.headers['idempotency-key'] || '').slice(0, 120);
  if (!key) return fn();
  const hit = await db.read(k.companyId, async c => (await c.query('SELECT response FROM idempotency_keys WHERE key = $1', [key])).rows[0]);
  if (hit) return Object.assign({}, hit.response, { replayed: true });
  const out = await fn();
  await db.tx(k.companyId, c => c.query('INSERT INTO idempotency_keys (company_id, key, response) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [k.companyId, key, JSON.stringify(out)])).catch(() => {});
  return out;
}

async function act(k, req, action, input) {
  return idempotent(k, req, async () => ({ data: await registry.run(ctxFor(k), action, input) }));
}

const REPORTS = {
  async summary(c, q) {
    const from = q.get('from') || core.addDays(core.today(), -30), to = q.get('to') || core.today();
    const inv = (await c.query("SELECT coalesce(sum(total),0) total, coalesce(sum(paid),0) paid, count(*)::int n FROM invoices WHERE issue_date BETWEEN $1 AND $2 AND status <> 'cancelled'", [from, to])).rows[0];
    const trips = (await c.query("SELECT count(*)::int n, coalesce(sum(km),0) km FROM trips WHERE date BETWEEN $1 AND $2 AND status = 'completed'", [from, to])).rows[0];
    const exp = (await c.query('SELECT category, coalesce(sum(amount),0) amount FROM expenses WHERE date BETWEEN $1 AND $2 GROUP BY category ORDER BY category', [from, to])).rows;
    const bk = (await c.query('SELECT status, count(*)::int n FROM bookings WHERE created_at::date BETWEEN $1 AND $2 GROUP BY status', [from, to])).rows;
    return { from, to, invoices: { count: inv.n, total: Number(inv.total), paid: Number(inv.paid) }, completedTrips: { count: trips.n, km: Number(trips.km) }, expensesByCategory: exp.map(e => ({ category: e.category, amount: Number(e.amount) })), bookingsByStatus: bk };
  },
  async 'trial-balance'(c, q) {
    const to = q.get('to') || core.today();
    const r = await c.query(`SELECT l.account_key, l.account, sum(l.debit) debit, sum(l.credit) credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.date <= $1 AND e.status <> 'draft' GROUP BY l.account_key, l.account ORDER BY l.account_key`, [to]);
    return { to, accounts: r.rows.map(x => ({ accountKey: x.account_key, account: x.account, debit: Number(x.debit), credit: Number(x.credit) })) };
  },
};

/* returns false when the path is not an API v1 path */
async function handle(req, res, url, ip) {
  if (!url.pathname.startsWith('/api/v1/')) return false;
  const parts = url.pathname.slice(8).split('/').filter(Boolean);
  const q = url.searchParams;
  try {
    const k = await authenticate(req);
    core.enterTz((await db.platform(c => c.query('SELECT timezone FROM companies WHERE id = $1', [k.companyId]))).rows[0].timezone);
    const [name, a, b] = parts;
    const method = req.method;
    let out;

    if (name === 'ping' && method === 'GET') out = { ok: true, companyId: k.companyId, scopes: k.scopes, activities: await db.read(k.companyId, c => activities.enabled(c, {})), serverTime: new Date().toISOString() };
    else if (name === 'journal') {
      need(k, 'journal', method === 'GET' ? 'read' : 'write');
      if (method === 'GET' && !a) {
        const list2 = await db.read(k.companyId, c => erp.entries(c, { from: q.get('from'), to: q.get('to'), status: q.get('status') }));
        if (q.get('format') === 'csv') { send(res, 200, erp.toCsv(list2), { 'Content-Type': 'text/csv; charset=utf-8' }); return true; }
        out = { data: list2 };
      } else if (method === 'POST' && a === 'ack') {      // ERP acknowledges entries it imported
        const body = await json(req);
        const ids = Array.isArray(body.numbers) ? body.numbers.map(String).slice(0, 1000) : [];
        out = await db.tx(k.companyId, async c => {
          const r = await c.query("UPDATE journal_entries SET status = 'exported', sync_status = 'synced' WHERE number = ANY($1::text[]) AND status = 'posted' RETURNING number", [ids]);
          for (const [num, ref] of Object.entries(body.refs || {})) await c.query('UPDATE journal_entries SET external_ref = $1 WHERE number = $2', [String(ref).slice(0, 80), String(num)]);
          await c.query("INSERT INTO sync_log (company_id, entity, direction, count, status) VALUES ($1,'journal','outbound',$2,'success')", [k.companyId, r.rowCount]);
          await core.touch(c, { companyId: k.companyId });
          return { acknowledged: r.rowCount };
        });
      } else throw new AppError(404, 'not_found', 'المسار غير موجود', 'Unknown endpoint');
    } else if (name === 'tracking') {
      if (a === 'positions' && method === 'POST') {
        need(k, 'tracking', 'write');
        const body = await json(req, 2 * 1024 * 1024);
        out = { data: await registry.run(ctxFor(k), 'positions.ingest', { positions: body.positions }) };
      } else if (a === 'positions' && method === 'GET') {
        need(k, 'tracking', 'read');
        out = { data: await db.read(k.companyId, async c => (await c.query("SELECT DISTINCT ON (vehicle_id) vehicle_id, at, lat, lng, speed, ignition, heading FROM positions WHERE at >= now() - interval '7 days' ORDER BY vehicle_id, at DESC")).rows.map(r => shape(r))) };
      } else if (a === 'events' && method === 'GET') {
        need(k, 'tracking', 'read');
        const from = q.get('from') || core.addDays(core.today(), -7);
        out = { data: await db.read(k.companyId, async c => (await c.query('SELECT * FROM events WHERE date >= $1 ORDER BY date DESC, time DESC LIMIT 1000', [from])).rows.map(r => shape(r))) };
      } else throw new AppError(404, 'not_found', 'المسار غير موجود', 'Unknown endpoint');
    } else if (name === 'calendar' && method === 'GET') {
      // what occupies each vehicle (trips today; contracts and holds in later steps)
      need(k, 'vehicles', 'read');
      const from = q.get('from') || core.today(), to = q.get('to') || core.addDays(from, 7);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw bad('range', 'الفترة غير صحيحة', 'from/to must be dates (YYYY-MM-DD) and to >= from', 'from');
      const vid = q.get('vehicleId');
      if (vid && !db.UUID.test(vid)) throw bad('vehicleId', 'مركبة غير صحيحة', 'Invalid vehicleId', 'vehicleId');
      out = { data: await db.read(k.companyId, async c => (await c.query(`SELECT k.vehicle_id, v.code, k.kind, k.source_type, k.source_id, k.note, lower(k.during) starts_at, upper(k.during) ends_at
          FROM vehicle_commitments k JOIN vehicles v ON v.id = k.vehicle_id
         WHERE k.during && tstzrange(local_moment(app_company_id(), $1::date, '00:00'), local_moment(app_company_id(), $2::date + 1, '00:00'), '[)') AND ($3::uuid IS NULL OR k.vehicle_id = $3)
         ORDER BY lower(k.during)`, [from, to, vid || null])).rows.map(r => ({ vehicleId: r.vehicle_id, vehicle: r.code, kind: r.kind, sourceType: r.source_type, sourceId: r.source_id, note: r.note, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString() }))) };
    } else if (name === 'availability' && method === 'GET') {
      // vehicles free for a whole period (with the 30-minute gap), optionally of one type
      need(k, 'vehicles', 'read');
      const from = q.get('from'), to = q.get('to');
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) <= Date.parse(from)) throw bad('range', 'الفترة غير صحيحة', 'from and to are required ISO date-times and to must be after from', 'from');
      const type = q.get('vehicleType');
      out = { data: await db.read(k.companyId, async c => (await c.query(`SELECT v.id, v.code, v.type, v.seats, v.payload_kg FROM vehicles v JOIN vehicle_types t ON t.code = v.type
         WHERE v.status = 'active' AND t.active AND ($3::text IS NULL OR v.type = $3)
           AND NOT EXISTS (SELECT 1 FROM vehicle_commitments k WHERE k.vehicle_id = v.id AND k.during && tstzrange($1::timestamptz - interval '30 minutes', $2::timestamptz + interval '30 minutes', '[)'))
         ORDER BY v.code`, [from, to, type || null])).rows.map(r => ({ vehicleId: r.id, code: r.code, vehicleType: r.type, seats: r.seats, payloadKg: Number(r.payload_kg) }))) };
    } else if (name === 'reports') {
      need(k, 'reports', 'read');
      if (!REPORTS[a]) throw new AppError(404, 'not_found', 'تقرير غير موجود', 'Unknown report. Available: ' + Object.keys(REPORTS).join(', '));
      out = { data: await db.read(k.companyId, c => REPORTS[a](c, q)) };
    } else if (RES[name]) {
      const r = RES[name];
      // resources of an activity the company does not have are refused (reads too)
      const own = activities.scopeActivity(r.scope);
      if (own && !(await db.read(k.companyId, c => activities.enabled(c, {}))).includes(own)) throw activities.disabledError(own);
      if (method === 'GET' && !a) out = await list(k, name, q);
      else if (method === 'GET' && a) out = await one(k, name, a);
      else if (method === 'POST' && !a && r.create) { need(k, r.scope, 'write'); out = await act(k, req, r.create, await json(req)); }
      else if (method === 'POST' && r.post && r.post[a]) { need(k, r.scope, 'write'); out = await act(k, req, r.post[a], await json(req)); }
      else if (method === 'POST' && a && b && r.actions && r.actions[b]) { need(k, r.scope, 'write'); out = await act(k, req, r.actions[b], Object.assign({}, await json(req), { id: a })); }
      else if ((method === 'PUT' || method === 'PATCH') && a && r.update) { need(k, r.scope, 'write'); out = await act(k, req, r.update, Object.assign({}, await json(req), { id: a })); }
      else throw new AppError(404, 'not_found', 'المسار أو الطريقة غير مدعومة', 'Endpoint or method not supported for this resource');
    } else throw new AppError(404, 'not_found', 'المسار غير موجود', 'Unknown endpoint');

    send(res, method === 'POST' && out && out.data && !out.replayed ? 201 : 200, out);
  } catch (e0) {
    const e = fromPg(e0);
    if (e instanceof AppError) send(res, e.status, { error: { code: e.code, message: e.msg, field: e.field || undefined } });
    else { require('../lib/log').error('api v1 error', { err: e, path: url.pathname, ip }); send(res, 500, { error: { code: 'server_error', message: { ar: 'حدث خطأ غير متوقع في السيرفر', en: 'Unexpected server error' } } }); }
  }
  return true;
}

module.exports = { handle, RES, REPORTS };
