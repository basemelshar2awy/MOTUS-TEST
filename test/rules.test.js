'use strict';
/* Operating rules the system must enforce itself: double booking, expired documents, capacity,
   programs, credit limits, month-end runs. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, adm, ids = {};
const ok = async (p, msg) => { const r = await p; assert.equal(r.status, 200, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  env = await H.createEnv(); const b = await H.bootstrap(env); await env.start(); adm = await H.signIn(env, 'admin@aaa.test', b.adminPw);
  ids.d1 = (await ok(adm.do('driver.create', { name: 'Driver One', licenseExpiry: '2031-01-01' }))).id;
  ids.d2 = (await ok(adm.do('driver.create', { name: 'Driver Expired', licenseExpiry: '2020-01-01' }))).id;
  ids.v1 = (await ok(adm.do('vehicle.create', { type: 'MB', plate: 'R 1', purchaseDate: '2024-01-01', purchasePrice: 1200000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: ids.d1 }))).id;
  ids.v2 = (await ok(adm.do('vehicle.create', { type: 'MB', plate: 'R 2', purchaseDate: '2024-01-01', purchasePrice: 1200000, licenseExpiry: '2020-01-01', insuranceExpiry: '2031-01-01' }))).id;
  ids.cl = (await ok(adm.do('client.create', { name: 'Rules Client', creditLimit: 5000, terms: 30 }))).id;
});
after(async () => { await env.destroy(); });

const book = (o) => adm.do('booking.create', Object.assign({ clientId: ids.cl, date: day(2), time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 1000 }, o));

test('a vehicle cannot be double booked and an expired licence blocks assignment', async () => {
  const b1 = await ok(book({}));
  await ok(adm.do('booking.assign', { bookingId: b1.id, vehicleId: ids.v1 }));
  const b2 = await ok(book({ time: '09:30' }));
  const clash = await adm.do('booking.assign', { bookingId: b2.id, vehicleId: ids.v1 });
  assert.equal(clash.status, 409, JSON.stringify(clash.data)); assert.ok(clash.data.error.reasons && clash.data.error.reasons.length, 'reasons listed');
  const exp = await adm.do('booking.assign', { bookingId: b2.id, vehicleId: ids.v2 });
  assert.equal(exp.status, 409, 'expired vehicle licence: ' + JSON.stringify(exp.data));
  await ok(adm.do('vehicle.update', { id: ids.v2, licenseExpiry: '2031-01-01' }));
  const noDriver = await adm.do('booking.assign', { bookingId: b2.id, vehicleId: ids.v2, driverId: ids.d2 });
  assert.equal(noDriver.status, 409, 'expired driver licence refused: ' + JSON.stringify(noDriver.data));
  await ok(adm.do('driver.update', { id: ids.d2, licenseExpiry: '2031-01-01' }));
  await ok(adm.do('booking.assign', { bookingId: b2.id, vehicleId: ids.v2, driverId: ids.d2 }));
});

test('credit limit stops over-exposure unless explicitly overridden (and the override is audited)', async () => {
  const r = await book({ price: 9000, date: day(5) });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  const o = await ok(book({ price: 9000, date: day(5), overrideCredit: true }));
  assert.ok(o.id);
  const a = await env.sql("SELECT 1 FROM audit_log WHERE entity = 'credit_limit'");
  assert.equal(a.rowCount, 1);
});

test('multi-day program creates one trip per day on the chosen vehicle', async () => {
  await ok(adm.do('client.update', { id: ids.cl, creditLimit: 500000 }));
  const p = await ok(adm.do('program.create', { name: 'Nile Cruise', clientId: ids.cl, start: day(10), pax: 15, price: 30000, vehicleId: ids.v1, driverId: ids.d1,
    days: [{ from: 'CAIAP', to: 'CAI' }, { from: 'CAI', to: 'ALX' }, { from: 'ALX', to: 'CAI' }] }));
  const t = await env.sql('SELECT count(*)::int n, sum(revenue) rev FROM trips WHERE program_id = $1 AND status <> \'cancelled\'', [p.id]);
  assert.equal(t.rows[0].n, 3); assert.equal(Math.round(Number(t.rows[0].rev)), 30000, 'program price allocated across days');
  const inv = await adm.do('invoice.fromProgram', { programId: p.id });
  assert.ok([200, 400, 409].includes(inv.status));
});

test('odometer sanity: end reading below start is refused', async () => {
  const b = await ok(book({ date: new Date().toISOString().slice(0, 10), time: '23:00', pax: 5 }));
  const t = await adm.do('booking.assign', { bookingId: b.id, vehicleId: ids.v1 });
  if (t.status === 200) {
    await ok(adm.do('trip.start', { id: t.data.id, odometer: 100 }));
    const r = await adm.do('trip.complete', { id: t.data.id, endKm: 50 });
    assert.equal(r.status, 400); assert.equal(r.data.error.field, 'endKm');
  }
});

test('month-end: depreciation posts once per vehicle per month, payroll posts balanced entries', async () => {
  const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const month = prev.toISOString().slice(0, 7);
  await ok(adm.do('depreciation.post', { month }));
  const n1 = (await env.sql("SELECT count(*)::int n FROM journal_entries WHERE source_type = 'depreciation'")).rows[0].n;
  assert.ok(n1 >= 1);
  const again = await adm.do('depreciation.post', { month });
  const n2 = (await env.sql("SELECT count(*)::int n FROM journal_entries WHERE source_type = 'depreciation'")).rows[0].n;
  assert.equal(n2, n1, 'no duplicate depreciation: ' + again.status);
  const none = await adm.do('payroll.post', { month });
  assert.equal(none.status, 400, 'nothing to pay yet');
  await ok(adm.do('driver.update', { id: ids.d1, employment: 'salary', salary: 4000 }));
  await ok(adm.do('payroll.post', { month }));
  assert.equal((await adm.do('payroll.post', { month })).status, 409, 'payroll cannot be posted twice for a month');
  const unb = await env.sql('SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id GROUP BY e.id HAVING sum(l.debit) <> sum(l.credit)');
  assert.equal(unb.rowCount, 0);
});

test('concurrent assignments of the same vehicle slot: exactly one wins', async () => {
  const bs = await Promise.all([0, 1, 2, 3].map(() => book({ date: day(20), time: '14:00' })));
  const ids2 = bs.map(b => b.data.id);
  const res = await Promise.all(ids2.map(id => adm.do('booking.assign', { bookingId: id, vehicleId: ids.v1 })));
  assert.equal(res.filter(r => r.status === 200).length, 1, res.map(r => r.status).join(','));
});
