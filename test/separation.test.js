'use strict';
/* Activity separation: each booking/trip has its activity and only that activity's fields, trip
   types, client types, places and revenue account; cargo bookings are shipments closed with a
   delivery code; education/staff/intercity work runs from lines (counts only). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, root, tour, cargo, multi, ids = {};
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const status = async (p, code, msg) => { const r = await p; assert.equal(r.status, code, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() + n * 86400000));
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();

async function company(code, acts) {
  const co = await ok(root.post('/api/platform/companies', { code, name: { ar: code, en: code }, activities: acts, admin: { email: `admin@${code.toLowerCase()}.test`, name: code + ' Admin' } }));
  return { id: co.id, c: await H.signIn(env, `admin@${code.toLowerCase()}.test`, co.temporaryPassword) };
}
async function vehicleWithDriver(c, type, n) {
  const d = await ok(c.do('driver.create', { name: 'Driver ' + n, licenseExpiry: '2031-01-01' }));
  const v = await ok(c.do('vehicle.create', { type, plate: { ar: `س ع ${n}`, en: `SA ${n}` }, purchaseDate: '2024-01-01', purchasePrice: 900000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: d.id }));
  return { v: v.id, d: d.id };
}

before(async () => {
  env = await H.createEnv({ MOTUS_WEBHOOK_WORKER: '1', MOTUS_ALLOW_PRIVATE_WEBHOOKS: '1' }); const boot = await H.bootstrap(env); await env.start();
  root = await H.signIn(env, 'root@t.test', boot.rootPw);
  tour = { c: await H.signIn(env, 'admin@aaa.test', boot.adminPw) };
  cargo = await company('CGO', ['cargo']);
  multi = await company('MLT', ['education', 'cargo']);
});
after(async () => { await env.destroy(); });

test('starting places, client types and snapshot profiles follow the activities', async () => {
  const cs = (await ok(cargo.c.get('/api/snapshot')));
  const kinds = new Set(cs.data.geofences.map(g => g.kind));
  assert.ok(!kinds.has('airport') && !kinds.has('hotel') && !kinds.has('site'), 'no tourist places for cargo: ' + [...kinds]);
  assert.ok(kinds.has('port') && kinds.has('warehouse'), 'cargo starting places');
  assert.deepEqual(Object.keys(cs.profiles.byActivity), ['cargo']);
  const ts = (await ok(tour.c.get('/api/snapshot')));
  assert.ok(ts.data.geofences.some(g => g.kind === 'airport'));
  await status(tour.c.do('client.create', { name: 'A school', type: 'school' }), 400, 'school is not a tourism client type');
  const cl = await ok(cargo.c.do('client.create', { name: 'Delta Mills' }));
  assert.equal((await env.sql('SELECT type FROM clients WHERE id = $1', [cl.id])).rows[0].type, 'shipper', 'default client type of the activity');
  ids.shipper = cl.id;
  await status(cargo.c.do('place.create', { code: 'HTL1', name: 'Hotel', kind: 'hotel', lat: 30, lng: 31 }), 403, 'hotel is a tourism place');
});

test('a tourism booking has passengers and no weight; trip types are the tourism ones', async () => {
  const cl = await ok(tour.c.do('client.create', { name: 'Nile Tours', type: 'agency' }));
  await status(tour.c.do('booking.create', { clientId: cl.id, date: day(5), time: '09:00', pax: 10, loadKg: 500, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }), 400, 'weight is for shipments');
  await status(tour.c.do('booking.create', { clientId: cl.id, date: day(5), time: '09:00', pax: 10, tripType: 'freight', pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }), 400, 'cargo trip type');
  const b = await ok(tour.c.do('booking.create', { clientId: cl.id, date: day(5), time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }));
  const row = (await env.sql('SELECT activity, trip_type, number FROM bookings WHERE id = $1', [b.id])).rows[0];
  assert.deepEqual([row.activity, row.trip_type], ['tourism', 'airport']);
  assert.match(row.number, /^BK-/);
});

test('a cargo booking is a shipment: weight and goods, its own number, a delivery code that closes the trip', async () => {
  const t = await vehicleWithDriver(cargo.c, 'TM', 1);
  ids.truck = t;
  await status(cargo.c.do('booking.create', { clientId: ids.shipper, date: day(1), time: '08:00', goods: 'Cement', pickup: 'RMD10', destination: 'ALXPT', vehicleType: 'TM', price: 4000 }), 400, 'weight required');
  const s = await ok(cargo.c.do('booking.create', { clientId: ids.shipper, date: day(0), time: '06:00', loadKg: 5000, goods: 'Cement bags', pieces: 100, cargoFlags: ['fragile'], pickup: 'RMD10', destination: 'ALXPT', vehicleType: 'TM', price: 4000, vehicleId: t.v }));
  assert.match(s.number, /^SH-/);
  assert.match(s.deliveryCode, /^\d{6}$/, 'the code is shown once to whoever created the shipment');
  const row = (await env.sql('SELECT activity, trip_type, otp_hash, goods, cargo_flags FROM bookings WHERE id = $1', [s.id])).rows[0];
  assert.deepEqual([row.activity, row.trip_type, row.goods, row.cargo_flags], ['cargo', 'freight', 'Cement bags', ['fragile']]);
  assert.ok(row.otp_hash && !row.otp_hash.includes(s.deliveryCode), 'only a hash is kept');
  const trip = (await env.sql('SELECT id, activity, type, pax FROM trips WHERE booking_id = $1', [s.id])).rows[0];
  assert.deepEqual([trip.activity, trip.type], ['cargo', 'freight']);
  await ok(cargo.c.do('trip.start', { id: trip.id }));
  assert.equal((await status(cargo.c.do('trip.complete', { id: trip.id, endKm: 220 }), 400)).error.field, 'deliveryCode', 'no code, no delivery');
  const wrong = await status(cargo.c.do('trip.complete', { id: trip.id, endKm: 220, deliveryCode: '000000' === s.deliveryCode ? '111111' : '000000' }), 400);
  assert.match(wrong.error.message.en, /Wrong delivery code \(4 tries left\)/);
  assert.equal((await env.sql('SELECT otp_attempts FROM bookings WHERE id = $1', [s.id])).rows[0].otp_attempts, 1, 'the wrong try is counted');
  await ok(cargo.c.do('trip.complete', { id: trip.id, endKm: 220, deliveryCode: s.deliveryCode }));
  const done = (await env.sql('SELECT delivered_at, status FROM bookings WHERE id = $1', [s.id])).rows[0];
  assert.ok(done.delivered_at); assert.equal(done.status, 'done');
  // invoiced on the cargo revenue account
  const inv = await ok(cargo.c.do('invoice.fromTrips', { clientId: ids.shipper, tripIds: [trip.id] }));
  const je = (await env.sql("SELECT l.account_key FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_ref = (SELECT number FROM invoices WHERE id = $1) AND l.credit > 0", [inv.id])).rows.map(r => r.account_key);
  assert.ok(je.includes('revenue_cargo'), je.join(','));
});

test('a lost code: dispatch issues a new one; a company admin can close without it, with a reason', async () => {
  const s = await ok(cargo.c.do('booking.create', { clientId: ids.shipper, date: day(0), time: '18:00', loadKg: 800, goods: 'Paper', pickup: 'OCT6', destination: 'CAIWH', vehicleType: 'TM', price: 1500, vehicleId: ids.truck.v }));
  const n = await ok(cargo.c.do('shipment.newCode', { id: s.id }));
  assert.notEqual(n.deliveryCode, undefined);
  const trip = (await env.sql('SELECT id FROM trips WHERE booking_id = $1', [s.id])).rows[0];
  await ok(cargo.c.do('trip.start', { id: trip.id }));
  await status(cargo.c.do('trip.complete', { id: trip.id, endKm: 300, deliveryCode: s.deliveryCode }), 400, 'the old code no longer works');
  await ok(cargo.c.do('trip.complete', { id: trip.id, endKm: 300, overrideReason: 'Consignee lost the SMS; signed paper copy' }));
  assert.match((await env.sql('SELECT delivered_by FROM bookings WHERE id = $1', [s.id])).rows[0].delivered_by, /signed paper copy/);
});

test('a company with two activities chooses the activity of each booking', async () => {
  const cl = await ok(multi.c.do('client.create', { name: 'Future School', type: 'school' }));
  ids.school = cl.id;
  await status(multi.c.do('booking.create', { clientId: cl.id, date: day(3), time: '09:00', pax: 20, pickup: 'CAI', destination: 'CAI', vehicleType: 'MB', price: 500 }), 400, 'which activity?');
  await status(multi.c.do('booking.create', { activity: 'tourism', clientId: cl.id, date: day(3), time: '09:00', pax: 20, pickup: 'CAI', destination: 'CAI', vehicleType: 'MB', price: 500 }), 403, 'not one of its activities');
  const b = await ok(multi.c.do('booking.create', { activity: 'education', clientId: cl.id, date: day(3), time: '09:00', pax: 20, pickup: 'CAI', destination: 'CAI', vehicleType: 'MB', price: 500 }));
  assert.equal((await env.sql('SELECT trip_type FROM bookings WHERE id = $1', [b.id])).rows[0].trip_type, 'school_trip');
});

test('a school line creates the week\'s runs on its bus; a busy run stays unassigned with the reason', async () => {
  await ok(multi.c.do('place.create', { code: 'FSCH', name: 'Future School', kind: 'school', lat: 30.05, lng: 31.3 }));
  await ok(multi.c.do('place.create', { code: 'MAADI', name: 'Maadi stop', kind: 'station', lat: 29.96, lng: 31.25 }));
  const bus = await vehicleWithDriver(multi.c, 'MB', 7);
  const line = await ok(multi.c.do('line.create', { activity: 'education', name: { ar: 'خط المعادي', en: 'Maadi line' }, clientId: ids.school, from: 'MAADI', to: 'FSCH', stops: ['CAI'], goTime: '06:30', returnTime: '14:30', durationMin: 60, days: [0, 1, 2, 3, 4], startDate: day(0), vehicleType: 'MB', vehicleId: bus.v, driverId: bus.d, headcount: 25, pricePerRun: 300 }));
  // book the bus for a whole-day trip on the first school day (06:15–15:30) so both runs of that day cannot be assigned
  let first = 1; while (![0, 1, 2, 3, 4].includes(dow(day(first)))) first++;
  const other = await ok(multi.c.do('booking.create', { activity: 'education', clientId: ids.school, date: day(first), time: '06:15', pax: 10, tripType: 'school_trip', pickup: 'CAI', destination: 'CAI', vehicleType: 'MB', price: 100, vehicleId: bus.v }));
  assert.ok(other.trip);
  const g = await ok(multi.c.do('line.generate', { id: line.id, from: day(1), to: day(7) }));
  const schoolDays = [1, 2, 3, 4, 5, 6, 7].map(day).filter(d => [0, 1, 2, 3, 4].includes(dow(d))).length;
  assert.equal(g.created, schoolDays * 2, 'go and return every school day');
  assert.equal(g.unassigned.length, 2, JSON.stringify(g.unassigned));
  assert.ok(g.unassigned.every(u => u.date === day(first) && /Overlaps trip/.test(u.reason.en)));
  assert.equal(g.assigned, g.created - 2);
  const dur = (await env.sql("SELECT duration_min FROM trips WHERE line_id = $1 LIMIT 1", [line.id])).rows[0].duration_min;
  assert.equal(dur, 60, 'a run takes the line duration');
  const trips = (await env.sql('SELECT activity, type, line_leg, pax, revenue FROM trips WHERE line_id = $1 ORDER BY date, start_time', [line.id])).rows;
  assert.ok(trips.every(t => t.activity === 'education' && t.pax === 25 && Number(t.revenue) === 300));
  assert.deepEqual([...new Set(trips.map(t => t.type))].sort(), ['school_go', 'school_return']);
  const again = await ok(multi.c.do('line.generate', { id: line.id, from: day(1), to: day(7) }));
  assert.equal(again.created, 0, 'runs are created once'); assert.equal(again.skipped, schoolDays * 2);
  // the line holds counts only: no names are stored anywhere for it
  const cols = (await env.sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'lines'")).rows.map(r => r.column_name);
  assert.ok(!cols.some(c => /student|employee|passenger|name_list/.test(c)));
});

test('a line under an exclusive per-trip contract: runs priced by the contract, the contract does not block its own line', async () => {
  const bus = await vehicleWithDriver(multi.c, 'MB', 8);
  const k = await ok(multi.c.do('contract.create', { activity: 'education', clientId: ids.school, name: 'School term', pricing: 'per_trip', rate: 450, withDriver: true, exclusive: true, workStart: '06:00', workEnd: '16:00', workDays: [0, 1, 2, 3, 4], startDate: day(0), vehicles: [{ vehicleId: bus.v }] }));
  const line = await ok(multi.c.do('line.create', { activity: 'education', name: 'Contract line', clientId: ids.school, contractId: k.id, from: 'MAADI', to: 'FSCH', goTime: '07:00', days: [0, 1, 2, 3, 4], startDate: day(0), vehicleType: 'MB', vehicleId: bus.v, driverId: bus.d, headcount: 20 }));
  const g = await ok(multi.c.do('line.generate', { id: line.id, from: day(1), to: day(7) }));
  assert.equal(g.unassigned.length, 0, JSON.stringify(g.unassigned));
  const t = (await env.sql('SELECT revenue, contract_id FROM trips WHERE line_id = $1 LIMIT 1', [line.id])).rows[0];
  assert.deepEqual([Number(t.revenue), t.contract_id], [450, k.id]);
});

test('a shipment deadline comes after loading; edits follow the booking\'s activity', async () => {
  const base = { clientId: ids.shipper, date: day(6), time: '08:00', loadKg: 3000, goods: 'Cement', pickup: 'RMD10', destination: 'ALXPT', vehicleType: 'TM', price: 2000 };
  await status(cargo.c.do('booking.create', Object.assign({ deliverDate: day(5) }, base)), 400, 'deadline before loading');
  await status(cargo.c.do('booking.create', Object.assign({ deliverDate: day(6), deliverTime: '07:00' }, base)), 400, 'deadline before the loading time');
  const f = await ok(cargo.c.do('booking.create', Object.assign({ flight: 'MS985' }, base)));
  assert.equal((await env.sql('SELECT flight FROM bookings WHERE id = $1', [f.id])).rows[0].flight, null, 'a tourism field is dropped in a company without tourism');
  const s = await ok(cargo.c.do('booking.create', Object.assign({ deliverDate: day(7), deliverTime: '12:00' }, base)));
  const snap = await ok(cargo.c.get('/api/snapshot'));
  const b = snap.data.bookings.find(x => x.id === s.id);
  assert.deepEqual([b.deliverDate, b.deliverTime], [day(7), '12:00']);
  await status(cargo.c.do('booking.update', { id: s.id, pax: 20 }), 400, 'a shipment has no headcount');
  await status(cargo.c.do('booking.update', { id: s.id, deliverDate: day(5) }), 400, 'edited deadline before loading');
  await ok(cargo.c.do('booking.update', { id: s.id, goods: 'Bagged cement', pieces: 120, deliverTime: '16:00' }));
  const row = (await env.sql('SELECT goods, pieces, deliver_time FROM bookings WHERE id = $1', [s.id])).rows[0];
  assert.deepEqual([row.goods, row.pieces, row.deliver_time], ['Bagged cement', 120, '16:00']);
  const tc = (await env.sql("SELECT id FROM clients WHERE type = 'agency' LIMIT 1")).rows[0];
  const tb = await ok(tour.c.do('booking.create', { clientId: tc.id, date: day(6), time: '09:00', pax: 8, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 700 }));
  await status(tour.c.do('booking.update', { id: tb.id, loadKg: 300 }), 400, 'no weight on a passenger booking');
  await status(tour.c.do('booking.update', { id: tb.id, goods: 'x' }), 400, 'no goods on a passenger booking');
  await ok(tour.c.do('booking.update', { id: tb.id, pax: 9, flight: 'MS985' }));
});

test('an empty return carries no load and needs no delivery code', async () => {
  const t = await vehicleWithDriver(cargo.c, 'TM', 7);
  await status(cargo.c.do('booking.create', { clientId: ids.shipper, tripType: 'empty_return', loadKg: 100, date: day(8), time: '15:00', pickup: 'ALXPT', destination: 'RMD10', vehicleType: 'TM', price: 0 }), 400, 'empty means empty');
  const e = await ok(cargo.c.do('booking.create', { clientId: ids.shipper, tripType: 'empty_return', date: day(8), time: '15:00', pickup: 'ALXPT', destination: 'RMD10', vehicleType: 'TM', price: 0, vehicleId: t.v }));
  assert.equal(e.deliveryCode, undefined);
  const row = (await env.sql('SELECT trip_type, otp_hash, load_kg FROM bookings WHERE id = $1', [e.id])).rows[0];
  assert.deepEqual([row.trip_type, row.otp_hash, row.load_kg], ['empty_return', null, null]);
  await env.sql("UPDATE trips SET date = $2 WHERE id = $1", [e.trip.id, day(0)]);
  await ok(cargo.c.do('trip.start', { id: e.trip.id }));
  const odo = (await env.sql('SELECT odometer FROM vehicles WHERE id = $1', [t.v])).rows[0].odometer;
  await ok(cargo.c.do('trip.complete', { id: e.trip.id, endKm: Number(odo) + 210 }), 'closes without a code');
});

test('the delivery code reaches the shipper once and is not kept in plain text or shown by the API', async () => {
  const http = require('node:http'); const got = [];
  const rcv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push(b); res.end('ok'); }); });
  await new Promise(r => rcv.listen(0, '127.0.0.1', r));
  try {
    await ok(cargo.c.do('webhook.create', { url: `http://127.0.0.1:${rcv.address().port}/naql`, events: ['shipment.code'] }));
    const s = await ok(cargo.c.do('booking.create', { clientId: ids.shipper, date: day(9), time: '08:00', loadKg: 2000, goods: 'Rice', pickup: 'RMD10', destination: 'ALXPT', vehicleType: 'TM', price: 1500 }));
    for (let n = 0; n < 40 && !got.length; n++) await new Promise(r => setTimeout(r, 500));
    assert.equal(JSON.parse(got[0]).data.deliveryCode, s.deliveryCode, 'the shipper system gets the code');
    for (let n = 0; n < 20; n++) { const st = (await env.sql("SELECT status FROM webhook_deliveries WHERE event = 'shipment.code'")).rows[0].status; if (st === 'delivered') break; await new Promise(r => setTimeout(r, 250)); }
    const kept = (await env.sql("SELECT payload FROM webhook_deliveries WHERE event = 'shipment.code'")).rows[0].payload;
    assert.notEqual(kept.data.deliveryCode, s.deliveryCode, 'not kept in plain text after delivery');
    const k = await ok(cargo.c.do('apiKey.create', { name: 'Naql', scopes: ['bookings:read', 'bookings:write'] }));
    const api = (m, u, b) => fetch(env.base + '/api/v1' + u, { method: m, headers: { Authorization: 'Bearer ' + k.key, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, data: await r.json() }));
    const one = await api('GET', '/bookings/' + s.id);
    assert.equal(one.status, 200); assert.ok(!('otpHash' in one.data.data), 'no code hash over the API');
    assert.equal(one.data.data.goods, 'Rice');
    const nc = await api('POST', `/bookings/${s.id}/newcode`, {});
    assert.ok([200, 201].includes(nc.status), JSON.stringify(nc.data)); assert.match(nc.data.data.deliveryCode, /^\d{6}$/);
  } finally { rcv.close(); }
});
