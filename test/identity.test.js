'use strict';
/* One Sabeel account per person: memberships give an account a role in each company; a company
   that adds an existing account only invites it; a driver signs in with a mobile number and
   reaches only their own trips; one driver cannot be booked by two companies at the same time. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

let env, root, aaa, bbb, drv, ids = {};
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
const status = async (p, code, msg) => { const r = await p; assert.equal(r.status, code, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const PHONE = '01001234567';

/* a vehicle with its driver, a client and a trip tomorrow 09:00–12:00 */
async function tripFor(c, driverId, code) {
  const v = await ok(c.do('vehicle.create', { type: 'MB', plate: { ar: `ق ر ${code}`, en: `QR ${code}` }, purchaseDate: '2024-01-01', purchasePrice: 900000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId }));
  const cl = await ok(c.do('client.create', { name: 'Client ' + code }));
  const b = await ok(c.do('booking.create', { clientId: cl.id, date: day(1), time: '09:00', endTime: '12:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 900 }));
  return { vehicleId: v.id, clientId: cl.id, bookingId: b.id };
}

before(async () => {
  env = await H.createEnv(); const boot = await H.bootstrap(env); await env.start();
  root = await H.signIn(env, 'root@t.test', boot.rootPw);
  aaa = await H.signIn(env, 'admin@aaa.test', boot.adminPw);
  const co = await ok(root.post('/api/platform/companies', { code: 'BBB', name: { ar: 'شركة ب', en: 'Company B' }, admin: { email: 'admin@bbb.test', name: 'B Admin' } }));
  ids.bbb = co.id;
  bbb = await H.signIn(env, 'admin@bbb.test', co.temporaryPassword);
  ids.aaa = (await ok(aaa.get('/api/session'))).company.id;
});
after(async () => { await env.destroy(); });

test('existing users keep signing in: their company and role moved to a membership', async () => {
  const s = await ok(aaa.get('/api/session'));
  assert.equal(s.user.role, 'company_admin');
  assert.equal(s.user.member, true);
  assert.deepEqual(s.companies.map(c => [c.code, c.role]), [['AAA', 'company_admin']]);
  const cols = (await env.sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")).rows.map(r => r.column_name);
  assert.ok(!cols.includes('company_id'), 'users no longer belong to a company');
  assert.equal((await env.sql("SELECT role FROM users WHERE email = 'root@t.test'")).rows[0].role, 'super_admin');
});

test('adding an existing account only invites it; the person accepts and works in both companies with a role in each', async () => {
  const inv = await ok(bbb.do('user.create', { email: 'admin@aaa.test', name: 'A admin', role: 'viewer' }));
  assert.equal(inv.invited, true);
  assert.equal(inv.temporaryPassword, null, 'no new password for an existing account');
  // B cannot work as that person, change the name or the password of an account A also uses
  await status(bbb.do('user.resetPassword', { id: inv.id }), 409);
  let s = await ok(aaa.get('/api/session'));
  assert.deepEqual(s.invites.map(c => [c.code, c.role]), [['BBB', 'viewer']]);
  await status(aaa.post('/api/session/company', { companyId: ids.bbb }), 403, 'cannot open a company before accepting');
  await ok(aaa.post(`/api/session/invites/${ids.bbb}/accept`));
  s = await ok(aaa.get('/api/session'));
  assert.deepEqual(s.companies.map(c => [c.code, c.role]).sort(), [['AAA', 'company_admin'], ['BBB', 'viewer']]);
  await ok(aaa.post('/api/session/company', { companyId: ids.bbb }));
  s = await ok(aaa.get('/api/session'));
  assert.equal(s.user.role, 'viewer', 'the role follows the company');
  await status(aaa.do('client.create', { name: 'x' }), 403, 'viewer in B');
  await status(bbb.do('user.resetPassword', { id: inv.id }), 409, 'shared account');
  assert.equal((await status(bbb.do('user.update', { id: inv.id, name: 'Other name' }), 409)).error.code, 'shared_account');
  await ok(bbb.do('user.update', { id: inv.id, role: 'accountant', title: 'Auditor' }), 'company fields stay the company\'s');
  // a role change in B signs the person out of B (only)
  assert.equal((await aaa.get('/api/session')).data.user, null);
  aaa = await H.signIn(env, 'admin@aaa.test', H.PW);
  assert.equal((await ok(aaa.get('/api/session'))).user.role, 'accountant', 'signs in to the company used last, with the new role');
  await ok(aaa.post('/api/session/company', { companyId: ids.aaa }));
  assert.equal((await ok(aaa.get('/api/session'))).user.role, 'company_admin');
});

test('a driver gets an account from the company and signs in with a mobile number', async () => {
  const d = await ok(aaa.do('driver.create', { name: { ar: 'سعيد محمود', en: 'Saeed Mahmoud' }, phone: PHONE, licenseExpiry: '2031-01-01' }));
  ids.driverA = d.id;
  const acc = await ok(aaa.do('driver.account', { driverId: d.id }));
  assert.equal(acc.login, '+201001234567', 'stored in international form');
  assert.ok(acc.temporaryPassword);
  drv = await H.signIn(env, '010 0123 4567', acc.temporaryPassword, 'Driver-Pw-77-Road!');
  const s = await ok(drv.get('/api/session'));
  assert.equal(s.user.role, 'driver');
  assert.equal(s.user.driverId, d.id);
  await status(aaa.do('driver.account', { driverId: d.id }), 409, 'one account per driver');
  const snap = (await ok(aaa.get('/api/snapshot'))).data;
  assert.equal(snap.driverAccounts.find(a => a.driverId === d.id).status, 'active');
});

test('a driver reaches only their own trips', async () => {
  const mine = await tripFor(aaa, ids.driverA, 1);
  ids.tripA = (await ok(aaa.do('booking.assign', { bookingId: mine.bookingId, vehicleId: mine.vehicleId }))).id;
  const other = await ok(aaa.do('driver.create', { name: 'Other Driver', licenseExpiry: '2031-01-01' }));
  const theirs = await tripFor(aaa, other.id, 2);
  const otherTrip = (await ok(aaa.do('booking.assign', { bookingId: theirs.bookingId, vehicleId: theirs.vehicleId }))).id;

  const snap = await ok(drv.get('/api/snapshot'));
  assert.equal(snap.driver, true);
  assert.deepEqual(snap.data.trips.map(t => t.id), [ids.tripA]);
  assert.equal(snap.data.clients.length, 0, 'no clients');
  assert.equal(snap.data.drivers.length, 1);
  assert.ok(snap.data.trips.every(t => t.revenue === 0), 'no prices');
  const list = await ok(drv.do('me.trips', {}));
  assert.deepEqual(list.trips.map(t => t.id), [ids.tripA]);

  await status(drv.do('me.tripStart', { id: otherTrip }), 404, 'another driver\'s trip does not exist for them');
  await status(drv.do('trip.start', { id: ids.tripA }), 403, 'staff actions are closed');
  await status(drv.do('booking.create', { clientId: mine.clientId }), 403);
  await status(drv.get('/api/live'), 403, 'no fleet map');
  await ok(drv.do('me.tripStart', { id: ids.tripA }));
  await ok(drv.do('me.tripComplete', { id: ids.tripA, endKm: 60, expenses: { tolls: 20 } }));
  assert.equal((await env.sql('SELECT status FROM trips WHERE id = $1', [ids.tripA])).rows[0].status, 'completed');
});

test('one driver, two companies: invited by the second, and never booked by both at the same time', async () => {
  // A books the driver tomorrow 09:00–12:00
  const a2 = await tripFor(aaa, ids.driverA, 3);
  await ok(aaa.do('booking.assign', { bookingId: a2.bookingId, vehicleId: a2.vehicleId }));
  // B adds the same person (same mobile, typed differently) as its driver
  const dB = await ok(bbb.do('driver.create', { name: 'Saeed', phone: '+20 100 123 4567', licenseExpiry: '2031-01-01' }));
  const inv = await ok(bbb.do('driver.account', { driverId: dB.id }));
  assert.equal(inv.invited, true);
  assert.equal(inv.temporaryPassword, null);
  await ok(drv.post(`/api/session/invites/${ids.bbb}/accept`));
  const s = await ok(drv.get('/api/session'));
  assert.deepEqual(s.companies.map(c => c.code).sort(), ['AAA', 'BBB']);
  // B cannot put him on a trip that overlaps A's (B learns only that he is busy elsewhere)
  const b1 = await tripFor(bbb, dB.id, 4);
  const r = await bbb.do('booking.assign', { bookingId: b1.bookingId, vehicleId: b1.vehicleId });
  assert.notEqual(r.status, 200, 'refused');
  assert.match(JSON.stringify(r.data), /شركة تانية|another company/);
  assert.doesNotMatch(JSON.stringify(r.data), /AAA|TR-AAA/, 'no detail of the other company');
  // a later slot is fine
  const cl = await ok(bbb.do('client.create', { name: 'Late client' }));
  const late = await ok(bbb.do('booking.create', { clientId: cl.id, date: day(1), time: '15:00', endTime: '17:00', pax: 5, pickup: 'CAI', destination: 'CAIAP', vehicleType: 'MB', price: 500 }));
  await ok(bbb.do('booking.assign', { bookingId: late.bookingId || late.id, vehicleId: b1.vehicleId }));
});

test('a company can unlink its driver or remove a user: only its own access ends', async () => {
  await ok(drv.post('/api/session/company', { companyId: ids.aaa }));
  await ok(aaa.do('driver.unlink', { driverId: ids.driverA }));
  assert.equal((await drv.get('/api/session')).data.user, null, 'signed out of A');
  drv = await H.signIn(env, PHONE, 'Driver-Pw-77-Road!', 'Driver-Pw-77-Road!');
  const s = await ok(drv.get('/api/session'));
  assert.deepEqual(s.companies.map(c => c.code), ['BBB'], 'still a driver for B');
  assert.equal(s.company.code, 'BBB');
  const bAdmin = (await env.sql("SELECT id FROM users WHERE email = 'admin@aaa.test'")).rows[0].id;
  await ok(bbb.do('user.remove', { id: bAdmin }));
  const s2 = await ok(aaa.get('/api/session'));
  assert.deepEqual(s2.companies.map(c => c.code), ['AAA']);
  await status(aaa.do('user.remove', { id: bAdmin }), 409, 'cannot remove yourself');
});

test('memberships are company data: one company cannot see another\'s people', async () => {
  const snapA = (await ok(aaa.get('/api/snapshot'))).data;
  assert.ok(snapA.users.every(u => u.email !== 'admin@bbb.test'));
  assert.ok(snapA.driverAccounts.every(a => a.driverId !== undefined));
  const n = await env.sql("SELECT count(*)::int n FROM memberships");
  assert.ok(n.rows[0].n >= 3);
  // the application role sees no membership without a company
  const { Client } = require('pg');
  const c = new Client({ host: env.SU.host, port: env.SU.port, user: env.app, password: require('fs').readFileSync(env.cfgFile, 'utf8').match(/MOTUS_DB_APP_PASSWORD=(.+)/)[1], database: env.dbName });
  await c.connect();
  try { assert.equal((await c.query('SELECT count(*)::int n FROM memberships')).rows[0].n, 0); } finally { await c.end(); }
});
