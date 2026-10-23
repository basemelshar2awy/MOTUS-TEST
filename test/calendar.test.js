'use strict';
/* Real time and the unified calendar: trips are real moments (a night trip ends the next day),
   every scheduled trip and every leave sits on the vehicle's / driver's calendar, overlaps are
   refused by the database whoever writes, and the calendar is readable through the Open API. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, adm, ids = {};
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const status = async (p, code, msg) => { const r = await p; assert.equal(r.status, code, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const D1 = day(10), D2 = day(11);
const book = o => adm.do('booking.create', Object.assign({ clientId: ids.cl, pax: 10, vehicleType: 'MB', price: 5000 }, o));

before(async () => {
  env = await H.createEnv(); const b = await H.bootstrap(env); await env.start();
  adm = await H.signIn(env, 'admin@aaa.test', b.adminPw);
  ids.d1 = (await ok(adm.do('driver.create', { name: 'Night Driver', licenseExpiry: '2031-01-01' }))).id;
  ids.d2 = (await ok(adm.do('driver.create', { name: 'Day Driver', licenseExpiry: '2031-01-01' }))).id;
  ids.v = (await ok(adm.do('vehicle.create', { type: 'MB', plate: 'N 1', purchaseDate: '2024-01-01', purchasePrice: 2500000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: ids.d1 }))).id;
  ids.cl = (await ok(adm.do('client.create', { name: 'Calendar client', creditLimit: 0 }))).id;
});
after(async () => { await env.destroy(); });

test('a night trip ends the next morning instead of being cut at midnight', async () => {
  const b = await ok(book({ date: D1, time: '20:00', pickup: 'CAI', destination: 'LXR' }));     // 9 h route + 15 min
  await ok(adm.do('booking.assign', { bookingId: b.id, vehicleId: ids.v, driverId: ids.d1 }));
  const t = (await env.sql("SELECT id, number, end_time, duration_min, to_char(starts_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') s, to_char(ends_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') e FROM trips WHERE booking_id = $1", [b.id])).rows[0];
  ids.night = t.id; ids.nightNo = t.number;
  assert.equal(t.duration_min, 555);
  assert.equal(t.s, `${D1} 20:00`);
  assert.equal(t.e, `${D2} 05:15`, 'ends on the next day');
  assert.equal(t.end_time, '05:15');
  const cal = (await env.sql("SELECT kind FROM vehicle_commitments WHERE source_id = $1 UNION ALL SELECT kind FROM driver_commitments WHERE source_id = $1", [t.id])).rows;
  assert.deepEqual(cal.map(r => r.kind), ['trip', 'trip'], 'on both calendars');
});

test('the next morning is blocked until the night trip ends (plus the 30-minute gap)', async () => {
  const early = await ok(book({ date: D2, time: '05:30', pickup: 'CAI', destination: 'GIZ' }));
  const r = await status(adm.do('booking.assign', { bookingId: early.id, vehicleId: ids.v, driverId: ids.d2 }), 409, 'vehicle still on the night trip');
  assert.ok(r.error.reasons.some(x => x.en.includes(ids.nightNo)), JSON.stringify(r.error.reasons));
  const late = await ok(book({ date: D2, time: '06:00', pickup: 'CAI', destination: 'GIZ' }));
  await ok(adm.do('booking.assign', { bookingId: late.id, vehicleId: ids.v, driverId: ids.d2 }), 'free 45 minutes after arrival');
  ids.morning = (await env.sql('SELECT id FROM trips WHERE booking_id = $1', [late.id])).rows[0].id;
});

test('the database refuses an overlap even when the application rules are skipped', async () => {
  const t = (await env.sql('SELECT * FROM trips WHERE id = $1', [ids.night])).rows[0];
  await assert.rejects(env.sql(`INSERT INTO trips (company_id, number, client_id, vehicle_id, driver_id, date, type, from_place, to_place, start_time, end_time, duration_min, status)
      VALUES ($1, 'TR-RAW-1', $2, $3, $4, $5, 'city', 'CAI', 'GIZ', '23:00', '23:30', 30, 'scheduled')`, [t.company_id, t.client_id, t.vehicle_id, ids.d2, D1]),
  e => e.code === '23P01' && e.constraint === 'vehicle_commitments_no_overlap');
});

test('a driver cannot take leave over a trip that ends after midnight', async () => {
  const r = await status(adm.do('availability.create', { driverId: ids.d1, from: D2, to: D2, kind: 'leave' }), 409, 'night trip runs into that day');
  assert.equal(r.error.code, 'driver_busy');
  await ok(adm.do('availability.create', { driverId: ids.d1, from: day(13), to: day(14), kind: 'leave' }));
  const b = await ok(book({ date: day(13), time: '10:00', pickup: 'CAI', destination: 'GIZ' }));
  const blocked = await status(adm.do('booking.assign', { bookingId: b.id, vehicleId: ids.v, driverId: ids.d1 }), 409);
  assert.ok(blocked.error.reasons.some(x => /leave/.test(x.en)));
});

test('moving a night trip keeps its length; cancelling or finishing a trip frees the calendar', async () => {
  await ok(adm.do('trip.update', { id: ids.night, startTime: '19:00' }));
  const t = (await env.sql("SELECT end_time, to_char(ends_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') e FROM trips WHERE id = $1", [ids.night])).rows[0];
  assert.equal(t.e, `${D2} 04:15`);
  await ok(adm.do('trip.cancel', { id: ids.morning, reason: 'client changed plans' }));
  assert.equal((await env.sql('SELECT count(*)::int n FROM vehicle_commitments WHERE source_id = $1', [ids.morning])).rows[0].n, 0, 'cancelled trip left the calendar');
  const early = await ok(book({ date: D2, time: '05:00', pickup: 'CAI', destination: 'GIZ' }));
  await ok(adm.do('booking.assign', { bookingId: early.id, vehicleId: ids.v, driverId: ids.d2 }), 'the earlier slot is free now');
  const ex = (await env.sql('SELECT id FROM trips WHERE booking_id = $1', [early.id])).rows[0].id;
  await ok(adm.do('trip.start', { id: ex }));
  await ok(adm.do('trip.complete', { id: ex, endKm: 120 }));
  assert.equal((await env.sql('SELECT count(*)::int n FROM vehicle_commitments WHERE source_id = $1', [ex])).rows[0].n, 0, 'finished trip left the calendar');
});

test('the calendar is in the snapshot and in the Open API, with free vehicles for a period', async () => {
  const snap = await ok(adm.get('/api/snapshot'));
  assert.ok(snap.data.calendar.vehicles.some(k => k.sourceId === ids.night && k.kind === 'trip'));
  assert.ok(snap.data.calendar.drivers.some(k => k.kind === 'leave'));
  const night = snap.data.trips.find(t => t.id === ids.night);
  assert.ok(night.startsAt.startsWith(D1) && night.endsAt.startsWith(D2));
  const k = await ok(adm.do('apiKey.create', { name: 'Dispatch partner', scopes: ['vehicles:read'] }));
  const api = async p => { const r = await fetch(env.base + p, { headers: { Authorization: 'Bearer ' + k.key } }); return { status: r.status, data: await r.json() }; };
  const cal = await api(`/api/v1/calendar?from=${D1}&to=${D2}`);
  assert.equal(cal.status, 200, JSON.stringify(cal.data));
  assert.ok(cal.data.data.some(x => x.sourceId === ids.night && x.vehicle));
  const busy = await api(`/api/v1/availability?from=${encodeURIComponent(D2 + 'T01:00:00+02:00')}&to=${encodeURIComponent(D2 + 'T03:00:00+02:00')}&vehicleType=MB`);
  assert.equal(busy.status, 200, JSON.stringify(busy.data));
  assert.ok(!busy.data.data.some(v => v.vehicleId === ids.v), 'on the night trip');
  const free = await api(`/api/v1/availability?from=${encodeURIComponent(day(12) + 'T09:00:00+02:00')}&to=${encodeURIComponent(day(12) + 'T12:00:00+02:00')}`);
  assert.ok(free.data.data.some(v => v.vehicleId === ids.v), 'free that day');
  assert.equal((await api('/api/v1/availability?from=x&to=y')).status, 400);
});

test('calendars are company data', async () => {
  const g = await env.sql("SELECT relrowsecurity FROM pg_class WHERE relname IN ('vehicle_commitments','driver_commitments')");
  assert.deepEqual(g.rows.map(r => r.relrowsecurity), [true, true]);
});
