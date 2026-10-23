'use strict';
/* Vehicle types as data: each type belongs to a category that serves certain activities, so a
   company only gets and uses the types of its activities. Capacity is seats + payload + volume,
   bookings can carry a cargo load, and a type can be retired. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, root, tour, cargo, ids = {};
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const status = async (p, code, msg) => { const r = await p; assert.equal(r.status, code, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const types = async c => (await ok(c.get('/api/snapshot'))).data.vehicleTypes;

before(async () => {
  env = await H.createEnv();
  const boot = await H.bootstrap(env);
  await env.start();
  root = await H.signIn(env, 'root@t.test', boot.rootPw);
  tour = await H.signIn(env, 'admin@aaa.test', boot.adminPw);
  const co = await ok(root.post('/api/platform/companies', { code: 'CRG', name: { ar: 'بضائع', en: 'Cargo' }, activities: ['cargo'], admin: { email: 'admin@crg.test', name: 'Cargo Admin' } }));
  ids.crg = co.id;
  cargo = await H.signIn(env, 'admin@crg.test', co.temporaryPassword);
  ids.cl = (await ok(cargo.do('client.create', { name: 'Shipper' }))).id;
  ids.d1 = (await ok(cargo.do('driver.create', { name: 'Driver 1', licenseExpiry: '2031-01-01' }))).id;
  ids.d2 = (await ok(cargo.do('driver.create', { name: 'Driver 2', licenseExpiry: '2031-01-01' }))).id;
});
after(async () => { await env.destroy(); });

test('each company starts with the vehicle types of its activities only', async () => {
  const t = await types(tour);
  assert.deepEqual(t.map(x => x.code).sort(), ['LB', 'MB', 'MC', 'SD', 'VN'], 'tourism: passenger types and a van, no trucks');
  assert.ok(!t.some(x => x.category.startsWith('truck') || x.category === 'trailer'));
  const c = await types(cargo);
  assert.deepEqual(c.map(x => x.code).sort(), ['TH', 'TL', 'TM', 'TR', 'VN'], 'cargo: van and trucks, no buses');
  const tl = c.find(x => x.code === 'TL');
  assert.equal(tl.seats, 0); assert.ok(tl.payloadKg > 0 && tl.volumeM3 > 0);
  const snap = await ok(cargo.get('/api/snapshot'));
  assert.ok(!snap.data.vehicleCategories.some(k => k.code === 'bus'), 'bus category is not offered to a cargo company');
});

test('a truck is a vehicle with payload and no seats; types of other activities are refused', async () => {
  const v = await ok(cargo.do('vehicle.create', { type: 'TL', plate: 'T 1', purchaseDate: '2024-01-01', purchasePrice: 1300000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: ids.d1 }));
  ids.tl = v.id;
  const row = (await env.sql('SELECT seats, payload_kg, volume_m3 FROM vehicles WHERE id = $1', [v.id])).rows[0];
  assert.deepEqual([row.seats, Number(row.payload_kg), Number(row.volume_m3)], [0, 1500, 8]);
  ids.tm = (await ok(cargo.do('vehicle.create', { type: 'TM', plate: 'T 2', purchaseDate: '2024-01-01', purchasePrice: 2800000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: ids.d2 }))).id;
  await status(cargo.do('vehicle.create', { type: 'MB', plate: 'B 1', purchaseDate: '2024-01-01', purchasePrice: 1 }), 400, 'not one of its types');
  await status(cargo.do('vehicle.create', { type: 'TL', plate: 'T 3', purchaseDate: '2024-01-01', purchasePrice: 1, seats: 0, payloadKg: 0 }), 400, 'no seats and no payload');
});

test('a company creates its own types, only in the categories of its activities', async () => {
  const bus = await status(cargo.do('vehicleType.create', { code: 'BX', category: 'bus', name: 'Bus' }), 403, 'bus is not a cargo category');
  assert.equal(bus.error.code, 'activity_disabled');
  const t = await ok(cargo.do('vehicleType.create', { code: 'FRZ', category: 'truck_medium', name: { ar: 'نقل مبرّد', en: 'Refrigerated truck' }, payloadKg: 5000, volumeM3: 28 }));
  assert.equal(t.code, 'FRZ');
  const frz = (await types(cargo)).find(x => x.code === 'FRZ');
  assert.equal(frz.category, 'truck_medium'); assert.equal(frz.payloadKg, 5000); assert.equal(frz.seats, 0);
  assert.ok(frz.oilKm > 0 && frz.lifeYears > 0, 'costs and life start from the category default');
  await status(cargo.do('vehicleType.create', { code: 'FRZ', category: 'truck_light', name: 'Again' }), 409, 'duplicate code');
  await status(cargo.do('vehicleType.create', { code: 'x1', category: 'truck_light', name: 'Bad code' }), 400, 'code format');
  await status(cargo.do('vehicleType.update', { code: 'FRZ', payloadKg: 0, seats: 0 }), 400, 'a type keeps seats or payload');
});

test('cargo bookings are shipments: weight required, checked against the payload', async () => {
  const b = await ok(cargo.do('booking.create', { clientId: ids.cl, date: day(2), time: '08:00', pickup: 'CAI', destination: 'ALX', vehicleType: 'TL', loadKg: 1200, goods: 'Cement bags', price: 2500 }));
  assert.equal((await env.sql('SELECT pax, load_kg FROM bookings WHERE id = $1', [b.id])).rows[0].pax, 1, 'pax defaults to 1 for a cargo type');
  await ok(cargo.do('booking.assign', { bookingId: b.id, vehicleId: ids.tl }));
  const heavy = await ok(cargo.do('booking.create', { clientId: ids.cl, date: day(3), time: '08:00', pickup: 'CAI', destination: 'ALX', vehicleType: 'TL', loadKg: 4000, goods: 'Steel', price: 4000 }));
  const over = await status(cargo.do('booking.assign', { bookingId: heavy.id, vehicleId: ids.tl }), 409, 'load above the payload');
  assert.ok(over.error.reasons.some(r => /payload/i.test(r.en)), JSON.stringify(over.error.reasons));
  await ok(cargo.do('booking.assign', { bookingId: heavy.id, vehicleId: ids.tm }), 'the medium truck carries it');
  const noWeight = await status(cargo.do('booking.create', { clientId: ids.cl, date: day(4), time: '08:00', pickup: 'CAI', destination: 'ALX', vehicleType: 'TL', pax: 6, goods: 'Boxes', price: 900 }), 400, 'a shipment needs its weight');
  assert.equal(noWeight.error.field, 'loadKg');
});

test('passenger types still need passengers and cannot take a cargo load', async () => {
  const cl = (await ok(tour.do('client.create', { name: 'Tour client' }))).id;
  await status(tour.do('booking.create', { clientId: cl, date: day(2), time: '09:00', pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }), 400, 'pax required for a bus');
  await status(tour.do('booking.create', { clientId: cl, date: day(2), time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', loadKg: 500, price: 900 }), 400, 'a bus type does not carry cargo');
  await status(tour.do('booking.create', { clientId: cl, date: day(2), time: '09:00', pax: 2, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'TL', price: 900 }), 400, 'trucks are not set up for a tourism company');
});

test('a retired type cannot be used for new vehicles or bookings, and keeps its existing vehicles', async () => {
  await ok(cargo.do('vehicleType.update', { code: 'TM', active: false }));
  const t = await status(cargo.do('vehicle.create', { type: 'TM', plate: 'T 9', purchaseDate: '2024-01-01', purchasePrice: 1 }), 400);
  assert.equal(t.error.code, 'type_retired');
  await status(cargo.do('booking.create', { clientId: ids.cl, date: day(5), time: '08:00', pickup: 'CAI', destination: 'ALX', vehicleType: 'TM', price: 1 }), 400);
  assert.ok((await ok(cargo.get('/api/snapshot'))).data.vehicles.some(v => v.id === ids.tm), 'existing vehicle kept');
  await ok(cargo.do('vehicleType.update', { code: 'TM', active: true }));
});

test('turning an activity on brings its types; turning it off keeps them but they cannot be used', async () => {
  await ok(root.post(`/api/platform/companies/${ids.crg}/activities`, { activities: ['cargo', 'staff'] }));
  const c = (await types(cargo)).map(x => x.code);
  for (const code of ['LB', 'MB', 'MC', 'SD']) assert.ok(c.includes(code), code + ' added with staff transport');
  await ok(cargo.do('vehicle.create', { type: 'MC', plate: 'S 1', purchaseDate: '2024-01-01', purchasePrice: 1600000 }));
  await ok(root.post(`/api/platform/companies/${ids.crg}/activities`, { activities: ['cargo'] }));
  const after = await types(cargo);
  assert.ok(after.some(x => x.code === 'MC' && x.usable === false), 'still there, not usable');
  const r = await status(cargo.do('vehicle.create', { type: 'MC', plate: 'S 2', purchaseDate: '2024-01-01', purchasePrice: 1600000 }), 403);
  assert.equal(r.error.code, 'activity_disabled');
});

test('the category catalog is read-only for the application', async () => {
  const g = await env.sql("SELECT has_table_privilege($1, 'vehicle_categories', 'SELECT') s, has_table_privilege($1, 'vehicle_categories', 'INSERT') i, has_table_privilege($1, 'vehicle_categories', 'UPDATE') u", [env.app]);
  assert.deepEqual([g.rows[0].s, g.rows[0].i, g.rows[0].u], [true, false, false]);
});
