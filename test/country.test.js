'use strict';
/* Country packs: a company's country sets its currency, VAT, e-invoice authority, time zone,
   identity formats, license classes and starting places; the country is locked after the first
   invoice; the Sabeel panel lists companies by country. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, root, eg, sa, ids = {};
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const status = async (p, code, msg) => { const r = await p; assert.equal(r.status, code, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  env = await H.createEnv(); const boot = await H.bootstrap(env); await env.start();
  root = await H.signIn(env, 'root@t.test', boot.rootPw);
  eg = await H.signIn(env, 'admin@aaa.test', boot.adminPw);
  const co = await ok(root.post('/api/platform/companies', { code: 'KSA', name: { ar: 'نقل الرياض', en: 'Riyadh Transport' }, country: 'SA', taxNo: '300000000000003', admin: { email: 'admin@ksa.test', name: 'KSA Admin' } }));
  ids.ksa = co.id;
  assert.equal(co.country, 'SA');
  sa = await H.signIn(env, 'admin@ksa.test', co.temporaryPassword);
});
after(async () => { await env.destroy(); });

test('an existing / default company is Egyptian with its pack', async () => {
  const s = await ok(eg.get('/api/session'));
  assert.equal(s.company.country, 'EG');
  const snap = await ok(eg.get('/api/snapshot'));
  assert.equal(snap.company.countryPack.currency, 'EGP');
  assert.equal(snap.company.countryPack.einvoice.code, 'eta');
  assert.equal(snap.data.settings.vatRate, 0.14);
  assert.equal(snap.company.timezone, 'Africa/Cairo');
});

test('a Saudi company gets riyal, 15% VAT, ZATCA, Riyadh time and Saudi places', async () => {
  const snap = await ok(sa.get('/api/snapshot'));
  assert.equal(snap.company.currency, 'SAR');
  assert.equal(snap.company.timezone, 'Asia/Riyadh');
  assert.equal(snap.company.countryPack.einvoice.code, 'zatca');
  assert.equal(snap.data.settings.vatRate, 0.15);
  const codes = snap.data.geofences.map(g => g.code);
  assert.ok(codes.includes('RUH') && codes.includes('JEDAP'), 'Saudi places');
  assert.ok(!codes.includes('CAI'), 'no Egyptian places');
  assert.equal(snap.data.branches[0].city, 'RUH');
  assert.equal(snap.company.countryPack.fields.nationalId.label.ar, 'رقم الهوية / الإقامة');
});

test('identity fields follow the country format', async () => {
  const e1 = await status(sa.do('driver.create', { name: 'Ahmad', licenseExpiry: '2031-01-01', nationalId: '29001010101010' }), 400, 'Egyptian ID in a Saudi company');
  assert.equal(e1.error.code, 'format_nationalId');
  const d = await ok(sa.do('driver.create', { name: 'Ahmad', licenseExpiry: '2031-01-01', nationalId: '2123456789' }));
  ids.saDriver = d.id;
  assert.equal((await env.sql('SELECT license_class FROM drivers WHERE id = $1', [d.id])).rows[0].license_class, 'public', 'Saudi default license class');
  await status(sa.do('driver.update', { id: d.id, licenseClass: 'first' }), 400, 'Egyptian license class in a Saudi company');
  await status(sa.do('client.create', { name: 'Bad VAT', taxNo: '123456789' }), 400);
  ids.saClient = (await ok(sa.do('client.create', { name: 'Hotel Riyadh', taxNo: '310000000000003', crNo: '1010123456' }))).id;
  await status(eg.do('driver.create', { name: 'Ali', licenseExpiry: '2031-01-01', nationalId: '2123456789' }), 400, 'Saudi ID in an Egyptian company');
  await ok(eg.do('driver.create', { name: 'Ali', licenseExpiry: '2031-01-01', nationalId: '29001010101010' }));
  await status(eg.do('client.create', { name: 'Bad tax', taxNo: '300000000000003' }), 400);
});

test('Saudi trips run on Riyadh time and invoices carry 15% VAT and ZATCA', async () => {
  const v = await ok(sa.do('vehicle.create', { type: 'MB', plate: 'أ ب ج 1234', purchaseDate: '2024-01-01', purchasePrice: 400000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: ids.saDriver }));
  const b = await ok(sa.do('booking.create', { clientId: ids.saClient, date: day(1), time: '09:00', pax: 20, pickup: 'RUHAP', destination: 'RUH', vehicleType: 'MB', price: 1000 }));
  await ok(sa.do('booking.assign', { bookingId: b.id, vehicleId: v.id }));
  const t = (await env.sql("SELECT id, to_char(starts_at AT TIME ZONE 'UTC', 'HH24:MI') utc FROM trips WHERE booking_id = $1", [b.id])).rows[0];
  assert.equal(t.utc, '06:00', '09:00 in Riyadh is 06:00 UTC');
  await ok(sa.do('trip.start', { id: t.id }));
  await ok(sa.do('trip.complete', { id: t.id, endKm: 45 }));
  const inv = await ok(sa.do('invoice.fromTrips', { clientId: ids.saClient, tripIds: [t.id] }));
  const row = (await env.sql('SELECT subtotal, tax, currency, einv_provider FROM invoices WHERE id = $1', [inv.id])).rows[0];
  assert.equal(row.einv_provider, 'zatca');
  assert.equal(row.currency, 'SAR');
  assert.equal(Number(row.tax), Math.round(Number(row.subtotal) * 0.15 * 100) / 100);
});

test('the country is locked after the first invoice; before that the Sabeel team can change it', async () => {
  const locked = await status(root.post(`/api/platform/companies/${ids.ksa}/country`, { country: 'EG' }), 409);
  assert.equal(locked.error.code, 'country_locked');
  const co = await ok(root.post('/api/platform/companies', { code: 'MOV', name: { ar: 'شركة', en: 'Mover' }, admin: { email: 'admin@mov.test', name: 'Mover Admin' } }));
  assert.equal(co.country, 'EG');
  await ok(root.post(`/api/platform/companies/${co.id}/country`, { country: 'SA' }));
  const r = (await env.sql('SELECT country, timezone, currency FROM companies WHERE id = $1', [co.id])).rows[0];
  assert.deepEqual([r.country, r.timezone, r.currency], ['SA', 'Asia/Riyadh', 'SAR']);
  await status(root.post(`/api/platform/companies/${co.id}/country`, { country: 'XX' }), 400, 'unknown country');
  // the lock also holds below the application
  await assert.rejects(env.sql("UPDATE companies SET country = 'EG' WHERE id = $1", [ids.ksa]), /country_locked/);
});

test('the Sabeel panel lists companies by country', async () => {
  const all = await ok(root.get('/api/platform/companies'));
  assert.ok(all.countries.some(c => c.code === 'SA') && all.countries.some(c => c.code === 'EG'));
  const ksa = await ok(root.get('/api/platform/companies?country=SA'));
  assert.ok(ksa.companies.length >= 2 && ksa.companies.every(c => c.country === 'SA'));
  assert.equal(ksa.companies.find(c => c.id === ids.ksa).countryLocked, true);
  const egy = await ok(root.get('/api/platform/companies?country=EG'));
  assert.ok(egy.companies.every(c => c.country === 'EG') && egy.companies.some(c => c.code === 'AAA'));
  assert.equal((await sa.post(`/api/platform/companies/${ids.ksa}/country`, { country: 'EG' })).status, 403, 'company admins cannot change it');
});
