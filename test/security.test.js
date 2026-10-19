'use strict';
/* Tenant isolation (application level AND database level), roles, lockout, CSRF, secrets. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');
const H = require('./helpers');

let env, root, a, b, ids = {};
const ok = async (p, msg) => { const r = await p; assert.equal(r.status, 200, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };

before(async () => {
  env = await H.createEnv();
  const boot = await H.bootstrap(env);
  await env.start();
  a = await H.signIn(env, 'admin@aaa.test', boot.adminPw);
  root = await H.signIn(env, 'root@t.test', boot.rootPw);
  const co = await root.post('/api/platform/companies', { code: 'BBB', name: { ar: 'شركة ب', en: 'Company B' }, branches: [{ code: 'HQ', city: 'CAI', nameAr: 'الرئيسي' }], admin: { email: 'admin@bbb.test', name: 'B Admin' } });
  assert.equal(co.status, 201, JSON.stringify(co.data));
  ids.bbb = co.data.id;
  b = await H.signIn(env, 'admin@bbb.test', co.data.temporaryPassword);
  ids.aClient = (await ok(a.do('client.create', { name: 'A Client' }))).id;
  ids.aVeh = (await ok(a.do('vehicle.create', { type: 'SD', plate: 'A 1', purchaseDate: '2024-01-01', purchasePrice: 500000 }))).id;
  ids.bClient = (await ok(b.do('client.create', { name: 'B Client' }))).id;
});
after(async () => { await env.destroy(); });

test('company B cannot see or touch company A records (application level)', async () => {
  const snapB = (await ok(b.get('/api/snapshot'))).data;
  assert.ok(!snapB.clients.some(c => c.id === ids.aClient));
  assert.ok(!snapB.vehicles.some(v => v.id === ids.aVeh));
  assert.equal(snapB.clients.length, 1);
  const upd = await b.do('client.update', { id: ids.aClient, name: 'hacked' });
  assert.equal(upd.status, 404, JSON.stringify(upd.data));
  const veh = await b.do('vehicle.update', { id: ids.aVeh, make: 'x' });
  assert.equal(veh.status, 404);
  const inv = await b.do('booking.create', { clientId: ids.aClient, date: '2030-01-01', time: '10:00', pax: 2, pickup: 'CAI', destination: 'GIZ', vehicleType: 'SD', price: 100 });
  assert.ok(inv.status === 404 || inv.status === 400, 'cannot book for another company\'s client: ' + inv.status);
  assert.equal((await b.get('/api/history?vehicleId=' + ids.aVeh + '&date=2026-01-01')).data.points.length, 0);
});

test('row level security enforces isolation even for raw SQL by the application role', async () => {
  const cfg = require('fs').readFileSync(env.cfgFile, 'utf8');
  const get = k => new RegExp('^' + k + '=(.*)$', 'm').exec(cfg)[1];
  const c = new pg.Client({ host: get('PGHOST'), port: +get('PGPORT'), database: get('PGDATABASE'), user: get('MOTUS_DB_APP_USER'), password: get('MOTUS_DB_APP_PASSWORD') });
  await c.connect();
  try {
    assert.equal((await c.query('SELECT count(*)::int n FROM clients')).rows[0].n, 0, 'no company context => no tenant rows');
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.company_id', $1, true)", [ids.bbb]);
    const rows = (await c.query('SELECT name_en FROM clients')).rows.map(r => r.name_en);
    assert.deepEqual(rows, ['B Client']);
    await assert.rejects(() => c.query("INSERT INTO clients (company_id, code, name_ar, type, terms, credit_limit, currency, status, created_by) SELECT id, 'X', 'x', 'company', 0, 0, 'EGP', 'active', 'x' FROM companies WHERE code = 'AAA'"), /row-level security/i);
    await c.query('ROLLBACK');
    await assert.rejects(() => c.query('TRUNCATE audit_log'), /permission denied/);
    await assert.rejects(() => c.query("DELETE FROM audit_log"), /permission denied/);
    await assert.rejects(() => c.query("UPDATE stock_movements SET qty = 1"), /permission denied/);
  } finally { await c.end(); }
});

test('roles: viewer and accountant cannot perform operations they are not allowed to', async () => {
  const v = await ok(a.do('user.create', { email: 'viewer@aaa.test', name: 'Viewer', role: 'viewer' }));
  const acc = await ok(a.do('user.create', { email: 'acc@aaa.test', name: 'Acc', role: 'accountant' }));
  const vc = await H.signIn(env, 'viewer@aaa.test', v.temporaryPassword);
  const ac = await H.signIn(env, 'acc@aaa.test', acc.temporaryPassword);
  assert.equal((await vc.do('client.create', { name: 'nope' })).status, 403);
  assert.equal((await vc.do('vehicle.create', { type: 'SD' })).status, 403);
  assert.equal((await ac.do('vehicle.create', { type: 'SD' })).status, 403);
  assert.equal((await ac.do('user.create', { email: 'x@aaa.test', name: 'x', role: 'viewer' })).status, 403);
  assert.equal((await vc.do('apiKey.create', { name: 'k', scopes: ['vehicles:read'] })).status, 403);
  assert.equal((await vc.get('/api/platform/companies')).status, 403);
  const snap = (await ok(vc.get('/api/snapshot'))).data;
  assert.equal(snap.apiKeys.length, 0); assert.equal(snap.audit.length, 0);
  assert.equal(JSON.stringify(snap).includes('password_hash'), false);
  assert.equal(ac.constructor === Object, true);
  assert.equal((await ok(ac.do('expense.create', { category: 'other', amount: 50 }))).id !== undefined, true, 'accountant may record expenses');
});

test('only a super admin can use platform endpoints; company admin cannot', async () => {
  assert.equal((await a.get('/api/platform/companies')).status, 403);
  assert.equal((await a.post('/api/platform/companies', { code: 'ZZZ' })).status, 403);
  assert.equal((await a.post('/api/session/company', { companyId: ids.bbb })).status, 403);
  const list = await ok(root.get('/api/platform/companies'));
  assert.equal(list.companies.length, 2);
});

test('suspended company loses access immediately', async () => {
  const s = await ok(root.post('/api/platform/companies/' + ids.bbb + '/status', { status: 'suspended' }));
  assert.equal((await b.get('/api/snapshot')).status, 401);
  assert.equal((await env.client().login('admin@bbb.test', H.PW)).status, 403);
  await ok(root.post('/api/platform/companies/' + ids.bbb + '/status', { status: 'active' }));
  assert.equal((await env.client().login('admin@bbb.test', H.PW)).status, 200);
});

test('login: wrong password message is generic, account locks after 5 failures', async () => {
  const c = env.client();
  const r = await c.login('admin@aaa.test', 'wrong-password-1');
  assert.equal(r.status, 401); assert.equal((await c.login('nobody@aaa.test', 'wrong-password-1')).data.error.message.en, r.data.error.message.en, 'same message for unknown user');
  for (let i = 0; i < 5; i++) await c.login('admin@aaa.test', 'wrong-password-' + i);
  const locked = await c.login('admin@aaa.test', H.PW);
  assert.equal(locked.status, 423, 'locked even with correct password');
  await env.sql("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE email = 'admin@aaa.test'");
  assert.equal((await c.login('admin@aaa.test', H.PW)).status, 200);
});

test('passwords: policy enforced, hashes never exposed', async () => {
  const c = await H.signIn(env, 'admin@aaa.test', H.PW);
  const weak = await c.post('/api/password', { currentPassword: H.PW, newPassword: 'short' });
  assert.equal(weak.status, 400);
  const row = (await env.sql("SELECT password_hash FROM users WHERE email = 'admin@aaa.test'")).rows[0].password_hash;
  assert.match(row, /^scrypt\$/);
  const snap = JSON.stringify((await c.get('/api/snapshot')).data);
  assert.ok(!snap.includes(row));
});

test('CSRF: state-changing requests need the header and a matching Origin', async () => {
  const bare = await fetch(env.base + '/api/logout', { method: 'POST', headers: { Cookie: Object.entries(a.jar).map(([k, v]) => k + '=' + v).join('; '), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bare.status, 403);
  const evil = await a.req('POST', '/api/session/lang', { lang: 'en' }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const good = await a.req('POST', '/api/session/lang', { lang: 'en' }, { Origin: env.base });
  assert.equal(good.status, 200);
});

test('security headers and cookie flags', async () => {
  const r = await fetch(env.base + '/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const l = await fetch(env.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'motus' }, body: JSON.stringify({ email: 'admin@aaa.test', password: H.PW }) });
  const sc = l.headers.getSetCookie()[0];
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  assert.equal((await fetch(env.base + '/config/motus.env')).status, 404);
  assert.equal((await fetch(env.base + '/../server/lib/config.js')).status, 404);
  assert.equal((await fetch(env.base + '/server/server.js')).status, 404);
});

test('a company admin cannot read or change another company\'s users', async () => {
  b = await H.signIn(env, 'admin@bbb.test', H.PW);   // earlier test suspended the company, which ended B's session
  const bUsers = (await ok(b.get('/api/snapshot'))).data.users;
  assert.ok(bUsers.every(u => u.email !== 'admin@aaa.test'), 'A\'s users not listed for B');
  const aUser = (await env.sql("SELECT id FROM users WHERE email = 'admin@aaa.test'")).rows[0].id;
  for (const [act, body] of [['user.update', { id: aUser, role: 'viewer' }], ['user.resetPassword', { id: aUser }]]) {
    const r = await b.do(act, body); assert.ok([403, 404].includes(r.status), act + ' -> ' + r.status + JSON.stringify(r.data));
  }
  assert.equal((await env.sql("SELECT role FROM users WHERE email = 'admin@aaa.test'")).rows[0].role, 'company_admin');
});
