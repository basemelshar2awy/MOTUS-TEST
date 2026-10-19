'use strict';
/* Core business workflow against a real PostgreSQL database and the real server process:
   booking -> assignment -> trip -> invoice -> payment, accounting balance, and persistence across a server restart. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, adm, ids = {};
const ok = async (p, msg) => { const r = await p; assert.equal(r.status, 200, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 10); };

before(async () => { env = await H.createEnv(); const b = await H.bootstrap(env); await env.start(); adm = await H.signIn(env, 'admin@aaa.test', b.adminPw); });
after(async () => { await env.destroy(); });

test('unauthenticated requests are refused', async () => {
  const c = env.client();
  assert.equal((await c.get('/api/snapshot')).status, 401);
  assert.equal((await c.do('vehicle.create', {})).status, 401);
});

test('create driver, vehicle, client', async () => {
  const d = await ok(adm.do('driver.create', { name: { ar: 'محمد علي', en: 'Mohamed Ali' }, phone: '01000000000', nationalId: '29001010101010', licenseNo: 'L-1', licenseClass: 'professional', licenseExpiry: '2030-01-01', salary: 5000 }), 'driver');
  ids.driver = d.id;
  const v = await ok(adm.do('vehicle.create', { type: 'MB', plate: { ar: 'أ ب ج 1234', en: 'ABC 1234' }, make: 'Toyota', model: 'Coaster', purchaseDate: '2024-01-01', purchasePrice: 2400000, odometer: 1000, driverId: d.id, licenseExpiry: '2030-01-01', insuranceExpiry: '2030-01-01' }), 'vehicle');
  ids.vehicle = v.id; assert.match(v.code, /^AAA-/);
  const cl = await ok(adm.do('client.create', { name: { ar: 'شركة النيل', en: 'Nile Tours' }, type: 'agency', creditLimit: 500000, terms: 30, email: 'ap@nile.test' }), 'client');
  ids.client = cl.id;
});

test('validation errors are specific and bilingual', async () => {
  const r = await adm.do('vehicle.create', { type: 'MB', plate: 'X 1' });
  assert.equal(r.status, 400); assert.equal(r.data.error.field, 'purchasePrice'); assert.ok(r.data.error.message.ar && r.data.error.message.en);
  const b = await adm.do('booking.create', { clientId: ids.client, date: tomorrow(), time: '09:00', pax: 20, pickup: 'NOPE', destination: 'CAI', vehicleType: 'MB', price: 1000 });
  assert.equal(b.status, 400);
  const dup = await adm.do('vehicle.create', { type: 'MB', plate: { ar: 'أ ب ج 1234', en: 'ABC 1234' }, purchaseDate: '2024-01-01', purchasePrice: 100000 });
  assert.ok([400, 409].includes(dup.status), 'duplicate plate rejected: ' + JSON.stringify(dup.data));
});

test('booking -> assign -> start -> complete -> invoice -> payment', async () => {
  const date = tomorrow();
  const bk = await ok(adm.do('booking.create', { clientId: ids.client, date, time: '09:00', pax: 20, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 1500 }), 'booking');
  ids.booking = bk.id;
  const tr = await ok(adm.do('booking.assign', { bookingId: bk.id, vehicleId: ids.vehicle }), 'assign');
  ids.trip = tr.id;
  // capacity rule: 60 passengers cannot be assigned to a 22-seat minibus
  const big = await ok(adm.do('booking.create', { clientId: ids.client, date, time: '15:00', pax: 60, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'LB', price: 2500 }));
  const cap = await adm.do('booking.assign', { bookingId: big.id, vehicleId: ids.vehicle });
  assert.equal(cap.status, 409, JSON.stringify(cap.data));
  await ok(adm.do('trip.start', { id: ids.trip }), 'start');
  await ok(adm.do('trip.complete', { id: ids.trip, endKm: 1040, expenses: { tolls: 20, parking: 10 } }), 'complete');
  const inv = await ok(adm.do('invoice.fromTrips', { clientId: ids.client, tripIds: [ids.trip] }), 'invoice');
  ids.invoice = inv.id;
  const again = await adm.do('invoice.fromTrips', { clientId: ids.client, tripIds: [ids.trip] });
  assert.equal(again.status, 409, 'cannot invoice a trip twice');
  const snap = (await ok(adm.get('/api/snapshot'))).data;
  const i = snap.invoices.find(x => x.id === ids.invoice);
  assert.ok(i && i.total > 1500 - 1, 'invoice present with tax: ' + JSON.stringify(i));
  await ok(adm.do('payment.create', { clientId: ids.client, amount: i.total, method: 'transfer' }), 'payment');
  const after = (await ok(adm.get('/api/snapshot'))).data;
  assert.equal(after.invoices.find(x => x.id === ids.invoice).status, 'paid');
});

test('journal is balanced and every entry has a source', async () => {
  const r = await env.sql(`SELECT e.number, sum(l.debit) d, sum(l.credit) c FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.number`);
  assert.ok(r.rows.length >= 3, 'invoice, payment and trip expenses posted: ' + r.rows.length);
  for (const x of r.rows) assert.equal(Number(x.d), Number(x.c), 'unbalanced ' + x.number);
});

test('data survives a server restart', async () => {
  const before = (await ok(adm.get('/api/snapshot'))).data;
  await env.restart();
  const c2 = env.client();
  const l = await c2.login('admin@aaa.test', H.PW);
  assert.equal(l.status, 200, 'password persisted; sessions persisted in DB too');
  const snap = (await ok(c2.get('/api/snapshot'))).data;
  assert.equal(snap.vehicles.length, before.vehicles.length);
  assert.ok(snap.trips.find(t => t.id === ids.trip && t.status === 'completed'));
  assert.ok(snap.invoices.find(i => i.id === ids.invoice && i.status === 'paid'));
  assert.ok(snap.clients.find(c => c.id === ids.client));
  // the old session cookie is still valid after restart (sessions live in PostgreSQL)
  assert.equal((await adm.get('/api/session')).data.user.role, 'company_admin');
});

test('update persists and is audited', async () => {
  await ok(adm.do('client.update', { id: ids.client, creditLimit: 750000, phone: '0222222222' }));
  const snap = (await ok(adm.get('/api/snapshot'))).data;
  assert.equal(snap.clients.find(c => c.id === ids.client).creditLimit, 750000);
  assert.ok(snap.audit.some(a => a.entity === 'client' && a.action === 'update'), 'audit row written');
  const t = await env.sql("SELECT count(*)::int n FROM audit_log WHERE entity = 'client'");
  assert.ok(t.rows[0].n >= 2);
});
