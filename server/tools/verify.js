#!/usr/bin/env node
'use strict';
/* Deployment verification.  node server/tools/verify.js [--no-live] [--keep-scratch]
   Part A (read-only, production database): configuration, PostgreSQL connection, migration status, row level
   security, role safety, at least one administrator, the running application's /healthz.
   Part B (throw-away database + temporary application instance on a free local port; production data is never
   touched): admin sign-in with forced password change, real create / read / update through the HTTP API,
   booking -> trip -> invoice -> payment, company isolation (both directions + raw SQL under RLS), data still present
   after the application is restarted. The scratch database is dropped at the end.
   Exit code 0 = everything passed. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const pg = require('pg');
const config = require('../lib/config');

const cfg = config.load();
const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const results = [];
let scratchName = null;

function rec(ok, name, detail) {
  results.push({ ok, name });
  console.log(`${ok === 'warn' ? '[WARN]' : ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' - ' + detail : ''}`);
}
const check = async (name, fn) => { try { const d = await fn(); rec(d === 'warn' ? 'warn' : true, name, typeof d === 'string' && d !== 'warn' ? d : undefined); } catch (e) { rec(false, name, e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* ---------- tiny HTTP client with cookie jar ---------- */
function client(base) {
  const jar = {};
  const c = {
    async req(method, url, body) {
      const h = { 'X-Requested-With': 'motus' }; if (body !== undefined) h['Content-Type'] = 'application/json';
      const ck = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); if (ck) h.Cookie = ck;
      const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1)); if (!v || /Max-Age=0/i.test(sc)) delete jar[k]; else jar[k] = v; }
      const t = await r.text(); let d; try { d = JSON.parse(t); } catch (e) { d = t; }
      return { status: r.status, data: d };
    },
    get: u => c.req('GET', u), post: (u, b) => c.req('POST', u, b || {}), do: (a, b) => c.req('POST', '/api/do/' + a, b || {}),
  };
  return c;
}
async function ok(p, what) { const r = await p; if (r.status !== 200) throw new Error(`${what || 'request'} failed (${r.status}): ${JSON.stringify(r.data && r.data.error ? r.data.error.message.en : r.data).slice(0, 200)}`); return r.data; }

async function partA() {
  console.log('\n== Part A: production configuration and database (read-only) ==');
  await check('configuration file found', () => { assert(cfg.fileFound, `not found: ${cfg.file}`); return cfg.file; });
  await check('database passwords and encryption key configured', () => { assert(cfg.db.password, 'MOTUS_DB_APP_PASSWORD missing'); assert(cfg.db.ownerPassword, 'MOTUS_DB_OWNER_PASSWORD missing'); assert(/^[0-9a-fA-F]{64}$/.test(cfg.credentialsKey), 'MOTUS_CREDENTIALS_KEY must be 64 hex characters'); });
  await check('public address uses HTTPS', () => (cfg.publicOrigin.startsWith('https://') ? cfg.publicOrigin : (rec('warn', 'PUBLIC_ORIGIN is not https', cfg.publicOrigin), 'warn')));
  const app = new pg.Client({ host: cfg.db.host, port: cfg.db.port, database: cfg.db.database, user: cfg.db.user, password: cfg.db.password, ssl: cfg.db.ssl });
  let connected = false;
  await check(`PostgreSQL connection as application user "${cfg.db.user}"`, async () => { await app.connect(); connected = true; const v = (await app.query('SHOW server_version_num')).rows[0].server_version_num; assert(+v >= 140000, `PostgreSQL ${v} is older than 14`); return 'server ' + (await app.query('SHOW server_version')).rows[0].server_version; });
  if (!connected) return;
  await check('application database user cannot bypass row level security', async () => { const r = (await app.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0]; assert(!r.rolsuper && !r.rolbypassrls, 'the application user is a superuser or bypasses RLS'); });
  await check('row level security enabled on every company table', async () => {
    const r = await app.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped) AND NOT c.relrowsecurity AND c.relname NOT IN ('users', 'sessions')`);
    assert(!r.rows.length, 'RLS missing on: ' + r.rows.map(x => x.relname).join(', '));
    const n = (await app.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relrowsecurity`)).rows[0].n;
    return n + ' tables protected (users and sessions are platform tables, always filtered by company in code)';
  });
  await check('no company data is visible without a company context', async () => { const r = await app.query('SELECT count(*)::int n FROM vehicles'); assert(r.rows[0].n === 0, 'rows visible without company'); });
  await check('database schema is up to date (migration status)', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'migrate.js'), '--status'], { encoding: 'utf8', env: process.env });
    assert(r.status === 0, (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ')); return (r.stdout.match(/applied /g) || []).length + ' migration(s) applied';
  });
  await check('at least one active administrator exists', async () => {
    const r = (await app.query('SELECT platform_admins sa, company_admins ca FROM admin_counts()')).rows[0];
    assert(r.sa + r.ca > 0, 'no administrator yet - run the database setup script or server/tools/create-admin.js'); return `${r.sa} platform admin(s), ${r.ca} company admin(s)`;
  });
  await check('data source is PostgreSQL (nothing is kept in memory)', async () => { const r = (await app.query('SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = \'public\'')).rows[0].n; assert(r > 60, 'schema looks incomplete'); return `${r} tables at ${cfg.db.host}:${cfg.db.port}/${cfg.db.database}`; });
  await app.end();
  if (!args.includes('--no-live')) {
    await check('application answers on 127.0.0.1:' + cfg.port, async () => { const r = await fetch(`http://127.0.0.1:${cfg.port}/healthz`, { signal: AbortSignal.timeout(5000) }); assert(r.ok, 'HTTP ' + r.status); const j = await r.json(); assert(j.ok, 'not ok'); return 'version ' + j.version; });
  }
}

async function superConn(db) { const c = new pg.Client({ host: cfg.db.host, port: cfg.db.port, database: db, user: cfg.db.ownerUser, password: cfg.db.ownerPassword, ssl: cfg.db.ssl }); await c.connect(); return c; }

async function partB() {
  console.log('\n== Part B: real workflow in a throw-away database (production data is not touched) ==');
  scratchName = 'motus_verify_' + crypto.randomBytes(4).toString('hex');
  let admin = null;
  try {
    admin = await superConn('postgres').catch(() => superConn(cfg.db.database));
    await admin.query(`CREATE DATABASE ${scratchName} OWNER ${cfg.db.ownerUser}`);
    rec(true, 'scratch database created', scratchName);
  } catch (e) { rec(false, 'scratch database created', e.message + ' (the owner role needs CREATEDB)'); return; }
  const port = await freePort();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motus-verify-'));
  const env = Object.assign({}, process.env, { PGDATABASE: scratchName, MOTUS_PORT: String(port), MOTUS_HOST: '127.0.0.1', MOTUS_LOG_DIR: logDir, PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, MOTUS_WEBHOOK_WORKER: '0', MOTUS_LOG_LEVEL: 'warn' });
  let proc = null, out = '';
  const start = async () => {
    proc = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch (e) { /* starting */ } if (proc.exitCode != null) throw new Error('application exited: ' + out.slice(-400)); await new Promise(r => setTimeout(r, 150)); }
    throw new Error('application did not start: ' + out.slice(-400));
  };
  const stop = async () => { if (proc && proc.exitCode == null) { proc.kill('SIGTERM'); await new Promise(r => { proc.once('exit', r); setTimeout(r, 8000); }); } proc = null; };
  const base = `http://127.0.0.1:${port}`;
  try {
    await check('migrations apply to an empty database', () => { const r = spawnSync(process.execPath, [path.join(__dirname, 'migrate.js')], { encoding: 'utf8', env }); assert(r.status === 0, (r.stdout + r.stderr).slice(-300)); });
    const pw1 = 'Verify-Temp-Pass-' + crypto.randomBytes(3).toString('hex') + '!', pwFinal = 'Final-Check-Pass-' + crypto.randomBytes(4).toString('hex') + '#';
    const mk = (code, email) => spawnSync(process.execPath, [path.join(__dirname, 'create-admin.js'), '--email', 'root-' + code + '@verify.invalid', '--name', 'Verify Root ' + code, '--generate', '--company', code, '--company-name', 'Verify ' + code, '--company-admin', email], { encoding: 'utf8', env });
    const r1 = mk('VA', 'admin@va.invalid'); const r2 = mk('VB', 'admin@vb.invalid');
    const lastPw = t => { const m = [...t.matchAll(/Temporary password \(shown once[^)]*\): (\S+)/g)]; return m.length ? m[m.length - 1][1] : null; };
    const tempA = lastPw(r1.stdout), tempB = lastPw(r2.stdout);
    await check('first administrators created from the console tool', () => { assert(tempA && tempB, (r1.stderr + r2.stderr + r1.stdout).slice(-300)); });
    await start(); rec(true, 'application starts against the new database', `port ${port}`);
    const a = client(base), b = client(base), anon = client(base);
    await check('administrator sign-in works and a temporary password must be changed', async () => {
      const l = await ok(a.post('/api/login', { email: 'admin@va.invalid', password: tempA }), 'login'); assert(l.mustChangePassword, 'no forced password change');
      assert((await a.get('/api/snapshot')).status === 403, 'data reachable before password change');
      await ok(a.post('/api/password', { currentPassword: tempA, newPassword: pwFinal }), 'password change');
      await ok(b.post('/api/login', { email: 'admin@vb.invalid', password: tempB }), 'login B'); await ok(b.post('/api/password', { currentPassword: tempB, newPassword: pwFinal }), 'password change B');
    });
    await check('wrong password and anonymous access are refused', async () => { const bad = await client(base).post('/api/login', { email: 'admin@va.invalid', password: 'wrong-wrong-wrong' }); assert(bad.status === 401, 'wrong password accepted?'); assert((await anon.get('/api/snapshot')).status === 401, 'anonymous snapshot'); });
    const ids = {};
    await check('create: driver, vehicle, client (written to PostgreSQL)', async () => {
      ids.d = (await ok(a.do('driver.create', { name: 'Verify Driver', licenseExpiry: '2035-01-01' }))).id;
      ids.v = (await ok(a.do('vehicle.create', { type: 'MB', plate: 'VER 1', purchaseDate: '2025-01-01', purchasePrice: 1000000, odometer: 10, driverId: ids.d, licenseExpiry: '2035-01-01', insuranceExpiry: '2035-01-01' }))).id;
      ids.c = (await ok(a.do('client.create', { name: 'Verify Client', creditLimit: 100000 }))).id;
    });
    await check('workflow: booking -> trip -> invoice -> payment', async () => {
      const bk = await ok(a.do('booking.create', { clientId: ids.c, date: day(1), time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 1500 }));
      ids.t = (await ok(a.do('booking.assign', { bookingId: bk.id, vehicleId: ids.v }))).id;
      await ok(a.do('trip.start', { id: ids.t })); await ok(a.do('trip.complete', { id: ids.t, endKm: 50 }));
      ids.i = (await ok(a.do('invoice.fromTrips', { clientId: ids.c, tripIds: [ids.t] }))).id;
      const snap = (await ok(a.get('/api/snapshot'))).data; const inv = snap.invoices.find(x => x.id === ids.i); assert(inv, 'invoice not found after creating');
      await ok(a.do('payment.create', { clientId: ids.c, amount: inv.total, method: 'transfer' }));
      assert((await ok(a.get('/api/snapshot'))).data.invoices.find(x => x.id === ids.i).status === 'paid', 'invoice not paid');
    });
    await check('update: client credit limit changes and is audited', async () => { await ok(a.do('client.update', { id: ids.c, creditLimit: 250000 })); const s = (await ok(a.get('/api/snapshot'))).data; assert(s.clients.find(x => x.id === ids.c).creditLimit === 250000, 'not updated'); assert(s.audit.some(x => x.entity === 'client' && x.action === 'update'), 'no audit row'); });
    await check('accounting: every journal entry is balanced', async () => { const c = await superConn(scratchName); try { const r = await c.query('SELECT count(*)::int n FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)) x'); const t = await c.query('SELECT count(*)::int n FROM journal_entries'); assert(r.rows[0].n === 0 && t.rows[0].n >= 2, 'unbalanced or missing entries'); return t.rows[0].n + ' entries'; } finally { await c.end(); } });
    await check('isolation: company B sees none of company A\'s data', async () => { const s = (await ok(b.get('/api/snapshot'))).data; assert(!s.clients.some(x => x.id === ids.c) && !s.vehicles.some(x => x.id === ids.v) && !s.invoices.length, 'cross-company data visible'); });
    await check('isolation: company B cannot change company A\'s records', async () => { const r = await b.do('client.update', { id: ids.c, name: 'hacked' }); assert(r.status === 404, 'status ' + r.status); const r2 = await b.do('vehicle.update', { id: ids.v, make: 'x' }); assert(r2.status === 404, 'status ' + r2.status); });
    await check('isolation: database refuses cross-company access even to raw SQL', async () => {
      const c = new pg.Client({ host: cfg.db.host, port: cfg.db.port, database: scratchName, user: cfg.db.user, password: cfg.db.password, ssl: cfg.db.ssl }); await c.connect();
      try { assert((await c.query('SELECT count(*)::int n FROM clients')).rows[0].n === 0, 'rows visible without company context'); await assert_rejects(c.query('TRUNCATE audit_log')); } finally { await c.end(); }
    });
    await stop(); out = '';
    await start();
    await check('persistence: data is still there after the application restarts', async () => {
      const a2 = client(base); await ok(a2.post('/api/login', { email: 'admin@va.invalid', password: pwFinal }), 'login after restart');
      const s = (await ok(a2.get('/api/snapshot'))).data;
      assert(s.vehicles.find(x => x.id === ids.v) && s.clients.find(x => x.id === ids.c && x.creditLimit === 250000) && s.invoices.find(x => x.id === ids.i && x.status === 'paid') && s.trips.find(x => x.id === ids.t && x.status === 'completed'), 'data missing after restart');
    });
  } catch (e) { rec(false, 'part B aborted', e.message); }
  finally {
    await stop();
    if (!args.includes('--keep-scratch')) {
      try { await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`); rec(true, 'scratch database removed'); } catch (e) { rec('warn', 'could not remove scratch database ' + scratchName, e.message); }
    }
    try { await admin.end(); } catch (e) { /* closed */ }
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}
async function assert_rejects(p) { try { await p; } catch (e) { return; } throw new Error('operation was allowed but must be refused'); }

(async () => {
  console.log(`MOTUS deployment verification - ${new Date().toISOString()}\nConfiguration: ${cfg.file}`);
  await partA();
  if (!args.includes('--skip-sandbox')) await partB();
  const failed = results.filter(r => r.ok === false).length, warns = results.filter(r => r.ok === 'warn').length;
  console.log(`\n${results.length - failed - warns} passed, ${failed} failed, ${warns} warning(s).`);
  console.log(failed ? 'RESULT: NOT READY - fix the [FAIL] lines above and run the verification again.' : 'RESULT: READY');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('verification crashed: ' + e.message); process.exit(2); });
