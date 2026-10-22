'use strict';
/* Company activities: a company only gets the shared core + the activities it chose. The server
   refuses anything of an activity the company does not have (actions, fields, Open API, API
   key scopes), the snapshot leaves that data out, and switching an activity off keeps the data. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, root, tour, cargo, ids = {};
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const denied = (r, msg) => { assert.equal(r.status, 403, (msg || '') + ' -> ' + JSON.stringify(r.data)); assert.equal(r.data.error.code, 'activity_disabled', msg); };

before(async () => {
  env = await H.createEnv();
  const boot = await H.bootstrap(env);           // company AAA, created by the console tool (no activities given)
  await env.start();
  root = await H.signIn(env, 'root@t.test', boot.rootPw);
  tour = await H.signIn(env, 'admin@aaa.test', boot.adminPw);
  const co = await root.post('/api/platform/companies', { code: 'CRG', name: { ar: 'شركة نقل بضائع', en: 'Cargo Co' }, activities: ['cargo'], admin: { email: 'admin@crg.test', name: 'Cargo Admin' } });
  assert.equal(co.status, 201, JSON.stringify(co.data));
  assert.deepEqual(co.data.activities, ['cargo']);
  ids.crg = co.data.id;
  cargo = await H.signIn(env, 'admin@crg.test', co.data.temporaryPassword);
  ids.cl = (await ok(cargo.do('client.create', { name: 'Shipper' }))).id;
  ids.d = (await ok(cargo.do('driver.create', { name: 'Truck Driver', licenseExpiry: '2031-01-01' }))).id;
  ids.v = (await ok(cargo.do('vehicle.create', { type: 'MB', plate: 'C 1', purchaseDate: '2024-01-01', purchasePrice: 900000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: ids.d }))).id;
});
after(async () => { await env.destroy(); });

test('a company created without choosing (console tool, older callers) gets tourism, as every existing company does', async () => {
  const s = await ok(tour.get('/api/session'));
  assert.deepEqual(s.company.activities, ['tourism']);
  assert.equal(s.activityCatalog.length, 5);
  const snap = await ok(tour.get('/api/snapshot'));
  assert.deepEqual(snap.activities, ['tourism']);
});

test('the activity list is validated: at least one, known codes only', async () => {
  const none = await root.post('/api/platform/companies', { code: 'NON', name: { ar: 'س', en: 'X' }, activities: [], admin: { email: 'x@non.test', name: 'X' } });
  assert.equal(none.status, 400, JSON.stringify(none.data));
  const unknown = await root.post('/api/platform/companies', { code: 'UNK', name: { ar: 'س', en: 'X' }, activities: ['taxi'], admin: { email: 'x@unk.test', name: 'X' } });
  assert.equal(unknown.status, 400, JSON.stringify(unknown.data));
  const clear = await root.post(`/api/platform/companies/${ids.crg}/activities`, { activities: [] });
  assert.equal(clear.status, 400, 'a company cannot be left with no activity');
});

test('a cargo company cannot use tourism tools: programs are refused on the server', async () => {
  const r = await cargo.do('program.create', { name: 'Tour', clientId: ids.cl, start: day(10), pax: 5, price: 1000, days: [{ from: 'CAIAP', to: 'CAI' }] });
  denied(r, 'program.create');
  denied(await cargo.do('program.cancel', { id: '00000000-0000-0000-0000-000000000000' }), 'program.cancel');
  denied(await cargo.do('place.create', { code: 'AP1', name: 'Airport', kind: 'airport', lat: 30, lng: 31 }), 'airport place');
  await ok(cargo.do('place.create', { code: 'WH1', name: 'Depot', kind: 'site', lat: 30, lng: 31 }), 'shared place kind is fine');
});

test('tourism-only fields of shared actions are dropped for a company without tourism', async () => {
  const b = await ok(cargo.do('booking.create', { clientId: ids.cl, date: day(3), time: '09:00', pax: 2, pickup: 'CAI', destination: 'ALX', vehicleType: 'MB', price: 500, flight: 'MS 777' }));
  const row = (await env.sql('SELECT flight FROM bookings WHERE id = $1', [b.id])).rows[0];
  assert.equal(row.flight, null, 'flight not stored');
  await ok(cargo.do('booking.assign', { bookingId: b.id, vehicleId: ids.v }));
  const t = (await env.sql('SELECT id FROM trips WHERE booking_id = $1', [b.id])).rows[0];
  await ok(cargo.do('trip.passengers', { id: t.id, passengers: [{ name: 'Loader', nationality: 'EG', passportNo: 'A123', hotel: 'H' }] }));
  const p = (await env.sql('SELECT name, nationality, passport_no, hotel FROM trip_passengers WHERE trip_id = $1', [t.id])).rows[0];
  assert.deepEqual([p.name, p.nationality, p.passport_no, p.hotel], ['Loader', '', '', '']);
});

test('the snapshot of a company without tourism carries no tourism data', async () => {
  const snap = await ok(cargo.get('/api/snapshot'));
  assert.deepEqual(snap.activities, ['cargo']);
  assert.deepEqual(snap.data.programs, []);
});

test('Open API: tourism resources are refused and API keys cannot get tourism scopes', async () => {
  const bad = await cargo.do('apiKey.create', { name: 'TMS', scopes: ['programs:read'] });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
  assert.equal(bad.data.error.code, 'scope_activity');
  const k = await ok(cargo.do('apiKey.create', { name: 'TMS', scopes: ['vehicles:read'] }));
  const ping = await (await fetch(env.base + '/api/v1/ping', { headers: { Authorization: 'Bearer ' + k.key } })).json();
  assert.deepEqual(ping.activities, ['cargo']);
  // a key that already has the scope (made while tourism was on) is still refused once it is off
  const keyed = await env.sql("UPDATE api_keys SET scopes = scopes || '{programs:read}' WHERE prefix = $1 RETURNING id", [k.prefix]);
  assert.equal(keyed.rowCount, 1);
  const r = await fetch(env.base + '/api/v1/programs', { headers: { Authorization: 'Bearer ' + k.key } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, 'activity_disabled');
});

test('the Sabeel team can add an activity, and switching it off again keeps the data and is recorded', async () => {
  const on = await ok(root.post(`/api/platform/companies/${ids.crg}/activities`, { activities: ['cargo', 'tourism'] }));
  assert.deepEqual(on.enabled, ['tourism']);
  const prog = await ok(cargo.do('program.create', { name: 'Now allowed', clientId: ids.cl, start: day(20), pax: 5, price: 1000, days: [{ from: 'CAIAP', to: 'CAI' }] }));
  assert.equal((await ok(cargo.get('/api/snapshot'))).data.programs.length, 1);

  const off = await ok(root.post(`/api/platform/companies/${ids.crg}/activities`, { activities: ['cargo'] }));
  assert.deepEqual(off.disabled, ['tourism']);
  denied(await cargo.do('program.cancel', { id: prog.id }), 'blocked again');
  assert.equal((await ok(cargo.get('/api/snapshot'))).data.programs.length, 0, 'hidden');
  assert.equal((await env.sql('SELECT count(*)::int n FROM programs WHERE id = $1', [prog.id])).rows[0].n, 1, 'but kept');

  const hist = (await env.sql("SELECT activity, action, actor FROM company_activity_events WHERE company_id = $1 ORDER BY at, action DESC", [ids.crg])).rows;
  assert.deepEqual(hist.map(h => h.activity + ':' + h.action), ['cargo:enabled', 'tourism:enabled', 'tourism:disabled']);
  const list = await ok(root.get('/api/platform/companies'));
  assert.deepEqual(list.companies.find(c => c.id === ids.crg).activities, ['cargo']);
});

test('only the platform admin can change activities, and the history cannot be rewritten by the application', async () => {
  assert.equal((await cargo.post(`/api/platform/companies/${ids.crg}/activities`, { activities: ['cargo', 'tourism'] })).status, 403);
  assert.equal((await tour.post(`/api/platform/companies/${ids.crg}/activities`, { activities: ['cargo'] })).status, 403);
  // the application role may only append to the history
  const g = await env.sql("SELECT has_table_privilege($1, 'company_activity_events', 'UPDATE') u, has_table_privilege($1, 'company_activity_events', 'DELETE') d, has_table_privilege($1, 'company_activity_events', 'INSERT') i", [env.app]);
  assert.deepEqual([g.rows[0].u, g.rows[0].d, g.rows[0].i], [false, false, true]);
});

test('activities are company data: one company cannot read another company\'s activities', async () => {
  const s = await ok(tour.get('/api/session'));
  assert.deepEqual(s.company.activities, ['tourism'], 'AAA still tourism only, untouched by CRG changes');
});
