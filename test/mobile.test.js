'use strict';
/* Mobile apps: token sign-in (Bearer), the same data and actions as the browser, the home figures from
   the dashboard's own calc code, web screens opened inside the app through one-time links, device
   registration and push notifications through Firebase (Android, iPhone) and Huawei Push Kit. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const H = require('./helpers');

let env, boot, fake, got = [];
const ok = async (p, msg) => { const r = await p; assert.ok(r.status === 200 || r.status === 201, (msg || '') + ' -> ' + r.status + ' ' + JSON.stringify(r.data)); return r.data; };
/* an app client: Bearer token + the CSRF header, no cookies */
function app(token) {
  const req = async (method, url, body) => {
    const h = { 'X-Requested-With': 'motus' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const r = await fetch(env.base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  return { get: u => req('GET', u), post: (u, b) => req('POST', u, b === undefined ? {} : b), del: u => req('DELETE', u), do: (a, b) => req('POST', '/api/do/' + a, b || {}) };
}

before(async () => {
  // a fake Google/Firebase and Huawei: token endpoints and send endpoints, recording what arrives
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      got.push({ url: req.url, auth: req.headers.authorization || '', body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/google/token') return res.end(JSON.stringify({ access_token: 'g-token', expires_in: 3600 }));
      if (req.url === '/hms/token') return res.end(JSON.stringify({ access_token: 'h-token', expires_in: 3600 }));
      if (req.url.startsWith('/fcm/')) return res.end(b.includes('dead-android-token') ? (res.statusCode = 404, '{"error":{"status":"UNREGISTERED"}}') : '{"name":"m/1"}');
      if (req.url.startsWith('/hms/')) return res.end(JSON.stringify({ code: '80000000', msg: 'Success' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const saFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'motus-fcm-')), 'sa.json');
  fs.writeFileSync(saFile, JSON.stringify({ project_id: 'motus-test', client_email: 'push@motus-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  env = await H.createEnv({
    MOTUS_WEBHOOK_WORKER: '1', MOTUS_ALLOW_PRIVATE_WEBHOOKS: '1',
    MOTUS_FCM_SERVICE_ACCOUNT: saFile, MOTUS_GOOGLE_TOKEN_URL: `http://127.0.0.1:${port}/google/token`, MOTUS_FCM_URL: `http://127.0.0.1:${port}/fcm`,
    MOTUS_HMS_APP_ID: '10203040', MOTUS_HMS_CLIENT_SECRET: 'hms-secret', MOTUS_HMS_TOKEN_URL: `http://127.0.0.1:${port}/hms/token`, MOTUS_HMS_URL: `http://127.0.0.1:${port}/hms`,
  });
  boot = await H.bootstrap(env); await env.start();
  await H.signIn(env, 'admin@aaa.test', boot.adminPw);   // sets the permanent password
});
after(async () => { fake.close(); await env.destroy(); });

const signInApp = async () => {
  const r = await app(null).post('/api/login', { login: 'admin@aaa.test', password: H.PW, client: 'mobile' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!r.headers.get('set-cookie'), 'the app gets no cookie');
  assert.match(r.data.token, /^.{30,100}$/);
  return r.data.token;
};

test('the app signs in with a token and reaches the same data and actions as the browser', async () => {
  const token = await signInApp();
  const a = app(token);
  const s = await ok(a.get('/api/session'));
  assert.equal(s.user.role, 'company_admin');
  assert.ok(s.company && s.company.id);
  const snap = await ok(a.get('/api/snapshot'));
  assert.ok(Array.isArray(snap.data.vehicles));
  const v = await ok(a.do('vehicle.create', { type: 'MB', plate: 'APP 1', purchaseDate: '2024-01-01', purchasePrice: 900000, odometer: 1000 }));
  assert.ok(v.id);
  // the CSRF header is still required for changes
  const r = await fetch(env.base + '/api/do/vehicle.create', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  // an app token is not a cookie, and a browser session is not a Bearer token
  const asCookie = await fetch(env.base + '/api/session', { headers: { Cookie: 'motus_sid=' + token } });
  assert.equal((await asCookie.json()).user, null);
  const web = await H.signIn(env, 'admin@aaa.test', H.PW);
  const webToken = web.jar.motus_sid;
  assert.equal((await app(webToken).get('/api/snapshot')).status, 401);
});

test('home figures come from the dashboard calc code; alerts too', async () => {
  const a = app(await signInApp());
  const h = await ok(a.get('/api/mobile/home'));
  assert.ok(h.kpis && typeof h.kpis.revenue === 'number' && typeof h.kpis.utilization === 'number');
  assert.equal(h.fleet.vehicles, 1);
  assert.ok(Array.isArray(h.series) && Array.isArray(h.trips) && Array.isArray(h.alerts.top));
  assert.ok(h.period.from <= h.period.to);
  const last = await ok(a.get('/api/mobile/home?period=last'));
  assert.equal(last.period.key, 'last');
  const al = await ok(a.get('/api/mobile/alerts'));
  assert.ok(Array.isArray(al.alerts));
});

test('a web screen opens inside the app through a one-time link, with the web menus hidden', async () => {
  const token = await signInApp();
  const a = app(token);
  assert.equal((await a.post('/api/mobile/link', { route: 'bad route!' })).status, 400);
  const l = await ok(a.post('/api/mobile/link', { route: 'reports' }));
  assert.match(l.path, /^\/m\/open\?code=/);
  const open = await fetch(env.base + l.path, { redirect: 'manual' });
  assert.equal(open.status, 302);
  assert.equal(open.headers.get('location'), '/?embed=1#reports');
  const cookie = open.headers.get('set-cookie').split(';')[0];
  const s = await (await fetch(env.base + '/api/session', { headers: { Cookie: cookie } })).json();
  assert.equal(s.user.role, 'company_admin', 'the in-app browser is signed in');
  assert.equal((await fetch(env.base + l.path, { redirect: 'manual' })).status, 410, 'used once');
  // signing out of the app ends the screens it opened
  await ok(a.post('/api/logout'));
  const after = await (await fetch(env.base + '/api/session', { headers: { Cookie: cookie } })).json();
  assert.equal(after.user, null);
  assert.equal((await a.get('/api/session')).data.user, null);
  // the browser itself cannot ask for links
  const web = await H.signIn(env, 'admin@aaa.test', H.PW);
  assert.equal((await web.post('/api/mobile/link', { route: 'reports' })).status, 403);
});

test('devices register for push; events reach Android/iPhone through Firebase and Huawei through Push Kit', async () => {
  const a = app(await signInApp());
  assert.equal((await a.post('/api/mobile/devices', { platform: 'nokia', pushToken: 'x'.repeat(40) })).status, 400);
  await ok(a.post('/api/mobile/devices', { platform: 'android', pushToken: 'android-token-' + 'a'.repeat(30), lang: 'ar', appVersion: '1.0.0', model: 'Pixel 8' }));
  await ok(a.post('/api/mobile/devices', { platform: 'ios', pushToken: 'ios-token-' + 'b'.repeat(30), lang: 'en' }));
  await ok(a.post('/api/mobile/devices', { platform: 'huawei', pushToken: 'huawei-token-' + 'c'.repeat(30), lang: 'ar' }));
  await ok(a.post('/api/mobile/devices', { platform: 'android', pushToken: 'dead-android-token-' + 'd'.repeat(30) }));
  // a trip cancelled in the dashboard notifies the operations people's phones
  const d = await ok(a.do('driver.create', { name: 'Push Driver', licenseExpiry: '2031-01-01' }));
  const vv = await ok(a.do('vehicle.create', { type: 'MB', plate: 'APP 2', purchaseDate: '2024-01-01', purchasePrice: 900000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: d.id }));
  const veh = { id: vv.id, type: 'MB' };
  const cl = await ok(a.do('client.create', { name: 'Push Client', type: 'agency' }));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() + 3 * 86400000));
  const b = await ok(a.do('booking.create', { clientId: cl.id, date: day, time: '09:00', pax: 10, pickup: 'CAIAP', destination: 'CAI', vehicleType: veh.type, price: 900, vehicleId: veh.id }));
  got = [];
  await ok(a.do('trip.cancel', { id: b.trip.id, reason: 'Client changed plans' }));
  let row;
  for (let i = 0; i < 40; i++) { row = (await env.sql("SELECT * FROM push_queue WHERE event = 'trip.cancelled' AND driver_id IS NULL")).rows[0]; if (row && row.status !== 'pending') break; await new Promise(r => setTimeout(r, 250)); }
  assert.equal(row.status, 'sent', JSON.stringify(row));
  assert.equal(row.sent_count, 3);
  const fcm = got.filter(g => g.url === '/fcm/v1/projects/motus-test/messages:send');
  assert.equal(fcm.length, 3, 'android, iphone and the dead token');
  assert.ok(fcm.every(g => g.auth === 'Bearer g-token'));
  const arMsg = fcm.map(g => JSON.parse(g.body)).find(m => m.message.token.startsWith('android-token'));
  assert.match(arMsg.message.notification.title, /اتلغت الرحلة/);
  const enMsg = fcm.map(g => JSON.parse(g.body)).find(m => m.message.token.startsWith('ios-token'));
  assert.match(enMsg.message.notification.title, /Trip .* cancelled/);
  assert.equal(enMsg.message.data.event, 'trip.cancelled');
  const hms = got.filter(g => g.url === '/hms/v1/10203040/messages:send');
  assert.equal(hms.length, 1);
  assert.equal(JSON.parse(hms[0].body).message.token[0], 'huawei-token-' + 'c'.repeat(30));
  const google = got.find(g => g.url === '/google/token');
  const jwt = new URLSearchParams(google.body).get('assertion').split('.');
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).iss, 'push@motus-test.iam.gserviceaccount.com');
  assert.equal((await env.sql("SELECT count(*)::int n FROM mobile_devices WHERE push_token LIKE 'dead-%'")).rows[0].n, 0, 'a gone token is dropped');
  // signing out removes this phone's registration
  await ok(a.del('/api/mobile/devices'));
  assert.equal((await env.sql('SELECT count(*)::int n FROM mobile_devices')).rows[0].n, 0);
});

test('an app session lasts longer than a browser session and survives the browser clean-up', async () => {
  const token = await signInApp();
  const r = (await env.sql("SELECT kind, expires_at - created_at AS life FROM sessions WHERE kind = 'mobile' ORDER BY created_at DESC LIMIT 1")).rows[0];
  assert.equal(r.kind, 'mobile');
  assert.ok(r.life.days >= 29, JSON.stringify(r.life));
  await env.sql("UPDATE sessions SET last_seen_at = now() - interval '3 days' WHERE kind = 'mobile'");
  await H.signIn(env, 'admin@aaa.test', H.PW);   // a browser sign-in clears old browser sessions only
  assert.equal((await app(token).get('/api/session')).data.user.role, 'company_admin');
});

test('the driver app: sign in by mobile number, own trips, a push for a new trip, start, phone location, finish', async () => {
  const admin = app(await signInApp());
  const d = await ok(admin.do('driver.create', { name: { ar: 'كريم سامي', en: 'Karim Samy' }, phone: '01005556677', licenseExpiry: '2031-01-01' }));
  const acc = await ok(admin.do('driver.account', { driverId: d.id }));
  await H.signIn(env, '01005556677', acc.temporaryPassword, 'Driver-App-88-Go!');   // first sign-in sets the driver's own password
  const r = await app(null).post('/api/login', { login: '010 0555 6677', password: 'Driver-App-88-Go!', client: 'mobile' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const drv = app(r.data.token);
  assert.equal((await ok(drv.get('/api/session'))).user.role, 'driver');
  await ok(drv.post('/api/mobile/devices', { platform: 'android', pushToken: 'driver-token-' + 'e'.repeat(30), app: 'driver', lang: 'ar' }));
  assert.equal((await drv.post('/api/mobile/link', { route: 'reports' })).status, 200, 'link itself is allowed; the web screen keeps the driver limits');

  // the company assigns the driver a trip: the driver's phone (and only it) hears about it
  const vv = await ok(admin.do('vehicle.create', { type: 'MB', plate: 'DRV 1', purchaseDate: '2024-01-01', purchasePrice: 900000, odometer: 5000, licenseExpiry: '2031-01-01', insuranceExpiry: '2031-01-01', driverId: d.id }));
  const cl = await ok(admin.do('client.create', { name: 'Driver App Client', type: 'agency' }));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  got = [];
  const b = await ok(admin.do('booking.create', { clientId: cl.id, date: day, time: '06:00', pax: 8, pickup: 'CAIAP', destination: 'CAI', vehicleType: 'MB', price: 700, vehicleId: vv.id }));
  let row;
  for (let i = 0; i < 40; i++) { row = (await env.sql("SELECT * FROM push_queue WHERE event = 'trip.assigned' AND driver_id = $1", [d.id])).rows[0]; if (row && row.status !== 'pending') break; await new Promise(res => setTimeout(res, 250)); }
  assert.equal(row.driver_id, d.id);
  assert.equal(row.status, 'sent', JSON.stringify(row));
  assert.equal(row.sent_count, 1);
  const msg = JSON.parse(got.find(g => g.url.startsWith('/fcm/')).body).message;
  assert.equal(msg.token, 'driver-token-' + 'e'.repeat(30));
  assert.match(msg.notification.title, /رحلة جديدة/);

  // own trips, start, the phone's location while running, finish
  const list = await ok(drv.do('me.trips', {}));
  assert.deepEqual(list.trips.map(t => t.id), [b.trip.id]);
  assert.deepEqual(await ok(drv.do('me.position', { lat: 30.1, lng: 31.4 })), { stored: 0, running: false }, 'nothing is recorded outside a running trip');
  await ok(drv.do('me.tripStart', { id: b.trip.id, odometer: 5000 }));
  const p = await ok(drv.do('me.position', { positions: [{ lat: 30.11, lng: 31.41, speed: 40, at: new Date(Date.now() - 30000).toISOString() }, { lat: 30.12, lng: 31.42, speed: 45 }] }));
  assert.deepEqual(p, { stored: 2, running: true });
  const live = await ok(admin.get('/api/live'));
  assert.equal(live.positions.find(x => x.vehicleId === vv.id).lat, 30.12, 'the live map shows the phone location');
  await ok(drv.do('me.tripComplete', { id: b.trip.id, endKm: 5042, expenses: { tolls: 15, parking: 0 } }));
  assert.equal((await env.sql('SELECT status, end_km FROM trips WHERE id = $1', [b.trip.id])).rows[0].status, 'completed');
  assert.equal((await drv.do('positions.ingest', { positions: [] })).status, 403, 'the fleet ingest stays closed');
});
