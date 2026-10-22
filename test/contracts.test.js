'use strict';
/* Operating contracts and trip sources: vehicles rented out under terms priced in advance;
   finished trips confirmed by the system that ran them (here an outside system over the Open
   API); exclusive contracts block other work in their hours; billing per trip or per period. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, adm, ids = {}, key;
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const status = async (p, code, msg) => { const r = await p; assert.equal(r.status, code, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const api = async (method, p, body) => { const r = await fetch(env.base + p, { method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };

before(async () => {
  env = await H.createEnv(); const boot = await H.bootstrap(env); await env.start();
  adm = await H.signIn(env, 'admin@aaa.test', boot.adminPw);
  for (const n of [1, 2, 3, 4, 5]) {
    const d = await ok(adm.do('driver.create', { name: 'Driver ' + n, licenseExpiry: '2031-01-01' }));
    const v = await ok(adm.do('vehicle.create', { type: 'MB', plate: { ar: `ع ق ${n}00`, en: `AQ ${n}00` }, purchaseDate: '2024-01-01', purchasePrice: 900000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: d.id }));
    ids['v' + n] = v.id; ids['d' + n] = d.id;
  }
  ids.school = (await ok(adm.do('client.create', { name: 'Al Noor Schools', type: 'company' }))).id;
  key = (await ok(adm.do('apiKey.create', { name: 'School transport system', scopes: ['contracts:read', 'contracts:write'] }))).key;
});
after(async () => { await env.destroy(); });

test('a per-trip contract with driver, exclusive in its working hours', async () => {
  const k = await ok(adm.do('contract.create', {
    clientId: ids.school, name: { ar: 'نقل طلاب مدارس النور', en: 'Al Noor student transport' }, channel: 'external', externalSystem: 'School transport system',
    pricing: 'per_trip', rate: 750, cycle: 'month', withDriver: true, exclusive: true, workStart: '06:00', workEnd: '16:00', startDate: day(-20),
    vehicles: [{ vehicleId: ids.v1 }, { vehicleId: ids.v2 }],
  }));
  ids.k1 = k.id;
  assert.match(k.number, /^CT-AAA-/);
  const snap = (await ok(adm.get('/api/snapshot'))).data;
  const c = snap.contracts.find(x => x.id === k.id);
  assert.equal(c.pricing, 'per_trip');
  assert.ok(c.terms.ar.includes('الصيانة'), 'operator bears maintenance, fuel and oils');
  const cvs = snap.contractVehicles.filter(x => x.contractId === k.id);
  assert.equal(cvs.length, 2);
  assert.equal(cvs.find(x => x.vehicleId === ids.v1).driverId, ids.d1, 'the vehicle\'s driver goes with it');
  // one exclusive contract at a time
  await status(adm.do('contract.create', { clientId: ids.school, name: 'Other', pricing: 'per_trip', rate: 100, startDate: day(-1), vehicles: [{ vehicleId: ids.v1 }] }), 409);
});

test('the outside system confirms finished trips over the Open API; MOTUS prices them; a retry does not double count', async () => {
  const t = await api('POST', `/api/v1/contracts/${ids.k1}/trips`, { vehicleId: ids.v1, date: day(-2), startTime: '06:30', endTime: '08:00', km: 35, pax: 24, externalRef: 'RUN-1001' });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  assert.equal(t.data.data.revenue, 750);
  const again = await api('POST', `/api/v1/contracts/${ids.k1}/trips`, { vehicleId: ids.v1, date: day(-2), startTime: '06:30', endTime: '08:00', km: 35, externalRef: 'RUN-1001' });
  assert.equal(again.data.data.id, t.data.data.id, 'same reference, same trip');
  await ok(adm.do('contract.trip', { contractId: ids.k1, vehicleId: ids.v2, date: day(-1), startTime: '13:00', endTime: '15:00', km: 30, externalRef: 'RUN-1002' }));
  const row = (await env.sql('SELECT source, type, driver_id, revenue, km, status FROM trips WHERE id = $1', [t.data.data.id])).rows[0];
  assert.deepEqual([row.source, row.type, row.driver_id, Number(row.revenue), row.km, row.status], ['external', 'contract', ids.d1, 750, 35, 'completed']);
  assert.equal((await env.sql('SELECT odometer FROM vehicles WHERE id = $1', [ids.v1])).rows[0].odometer, 35, 'odometer follows the reported km');
  assert.equal((await api('POST', `/api/v1/contracts/${ids.k1}/trips`, { vehicleId: ids.v3, date: day(-1), startTime: '07:00', endTime: '08:00' })).status, 400, 'vehicle not on the contract');
  assert.equal((await api('POST', `/api/v1/contracts/${ids.k1}/trips`, { vehicleId: ids.v1, date: day(1), startTime: '07:00', endTime: '08:00' })).status, 400, 'only finished trips');
  const list = await api('GET', '/api/v1/contracts');
  assert.ok(list.data.data.some(x => x.id === ids.k1));
});

test('an exclusive contract keeps the vehicle and its driver out of other work in its hours only', async () => {
  const b1 = await ok(adm.do('booking.create', { clientId: ids.school, date: day(2), time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }));
  const r = await adm.do('booking.assign', { bookingId: b1.id, vehicleId: ids.v1 });
  assert.notEqual(r.status, 200);
  assert.match(JSON.stringify(r.data), /حصري|exclusive/);
  const r2 = await adm.do('booking.assign', { bookingId: b1.id, vehicleId: ids.v3, driverId: ids.d2 });
  assert.notEqual(r2.status, 200, 'the contract driver is not free either');
  // extra work after the contract's hours is allowed
  const b2 = await ok(adm.do('booking.create', { clientId: ids.school, date: day(2), time: '18:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }));
  await ok(adm.do('booking.assign', { bookingId: b2.id, vehicleId: ids.v1 }), 'evening work outside the contract');
});

test('billing a per-trip contract: trips × rate on the contract revenue account, once', async () => {
  const tripId = (await env.sql("SELECT id FROM trips WHERE contract_id = $1 LIMIT 1", [ids.k1])).rows[0].id;
  await status(adm.do('invoice.fromTrips', { clientId: ids.school, tripIds: [tripId] }), 400, 'contract trips are billed by the contract');
  await status(adm.do('contract.bill', { id: ids.k1 }), 409, 'the current month has not ended');
  const inv = await ok(adm.do('contract.bill', { id: ids.k1, to: day(-1) }));
  const row = (await env.sql('SELECT subtotal, tax FROM invoices WHERE id = $1', [inv.id])).rows[0];
  assert.equal(Number(row.subtotal), 1500);
  const lines = (await env.sql('SELECT qty, unit, contract_id FROM invoice_lines WHERE invoice_id = $1', [inv.id])).rows;
  assert.ok(lines.every(l => l.contract_id === ids.k1));
  const je = (await env.sql("SELECT sum(l.credit) c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_ref = $1 AND l.account_key = 'revenue_contract'", [inv.number])).rows[0];
  assert.equal(Number(je.c), 1500);
  assert.equal((await env.sql('SELECT count(*)::int n FROM trips WHERE contract_id = $1 AND invoice_id IS NULL', [ids.k1])).rows[0].n, 0);
  await status(adm.do('contract.bill', { id: ids.k1, to: day(-1) }), 409, 'nothing left to bill');
  const late = await api('POST', `/api/v1/contracts/${ids.k1}/trips`, { vehicleId: ids.v1, date: day(-3), startTime: '06:30', endTime: '08:00', externalRef: 'RUN-0999' });
  assert.equal(late.status, 409, 'a trip in a billed period is refused');
});

test('a per-period contract without driver: vehicles × months, a vehicle that joined later pays its share', async () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
  const mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 16)).toISOString().slice(0, 10);
  const k = await ok(adm.do('contract.create', {
    clientId: ids.school, name: 'Monthly hire', channel: 'sabeel', externalSystem: 'Sabeel Dawra', pricing: 'per_period', rate: 30000, cycle: 'month',
    withDriver: false, exclusive: false, startDate: start, vehicles: [{ vehicleId: ids.v4 }, { vehicleId: ids.v5, fromDate: mid }],
  }));
  ids.k2 = k.id;
  const t = await ok(adm.do('contract.trip', { contractId: k.id, vehicleId: ids.v4, date: day(-1), startTime: '08:00', endTime: '17:00' }));
  const tr = (await env.sql('SELECT driver_id, revenue, source FROM trips WHERE id = $1', [t.id])).rows[0];
  assert.deepEqual([tr.driver_id, Number(tr.revenue), tr.source], [null, 0, 'sabeel'], 'no company driver; priced by the period');
  // the driver is free: the contract is without driver
  const b = await ok(adm.do('booking.create', { clientId: ids.school, date: day(1), time: '10:00', pax: 5, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 500 }));
  await ok(adm.do('booking.assign', { bookingId: b.id, vehicleId: ids.v3, driverId: ids.d4 }), 'driver of a without-driver contract');
  const inv = await ok(adm.do('contract.bill', { id: k.id }));   // the first full month
  const lines = (await env.sql('SELECT qty, unit, period_from, period_to FROM invoice_lines WHERE invoice_id = $1 ORDER BY qty DESC', [inv.id])).rows;
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0)).getUTCDate();
  assert.equal(Number(lines[0].qty), 1);
  assert.equal(Number(lines[1].qty), Math.round(((days - 15) / days) * 1000) / 1000, 'joined on the 16th');
  assert.equal(inv.from, start);
  const second = await ok(adm.do('contract.bill', { id: k.id }));
  assert.equal(second.from, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10), 'the next month follows');
  await status(adm.do('contract.bill', { id: k.id }), 409, 'the current month is still open');
});

test('ending a contract releases the vehicles; contracts are company data', async () => {
  await ok(adm.do('contract.end', { id: ids.k1, endDate: day(-1) }));
  const b = await ok(adm.do('booking.create', { clientId: ids.school, date: day(3), time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }));
  await ok(adm.do('booking.assign', { bookingId: b.id, vehicleId: ids.v2 }), 'free again after the contract');
  assert.equal((await env.sql('SELECT count(*)::int n FROM contracts')).rows[0].n, 2);
  // the application role sees no contract without a company
  const { Client } = require('pg');
  const c = new Client({ host: env.SU.host, port: env.SU.port, user: env.app, password: require('fs').readFileSync(env.cfgFile, 'utf8').match(/MOTUS_DB_APP_PASSWORD=(.+)/)[1], database: env.dbName });
  await c.connect();
  try { assert.equal((await c.query('SELECT count(*)::int n FROM contracts')).rows[0].n, 0); } finally { await c.end(); }
});
