'use strict';
/* Push notifications to the MOTUS apps.
   - Some events (below) queue a notification in the same transaction as the change (push_queue).
   - A worker sends each queued notification to the registered devices of the company's members
     whose role should hear about it: Firebase Cloud Messaging for Android and iPhone, Huawei Push
     Kit for Huawei phones (no Google services). Each message goes in the device's language.
   - The trip's own driver hears about a new trip or a cancelled one on the driver app.
   - Nothing is sent until the server has the credentials (config.push); queued rows are then
     marked 'skipped'. Tokens the services report as gone are deleted. */
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');
const log = require('./log');
const outbound = require('./outbound');

const OPS = ['company_admin', 'fleet_manager', 'operations'];
const MONEY = ['company_admin', 'fleet_manager', 'accountant'];
/* event -> who hears it and what it says ({...} fills from the event's data) */
const TEMPLATES = {
  'shipment.delivered': { roles: OPS, ar: ['اتسلمت الشحنة {number}', 'السواق قفل التسليم بكود المستلم.'], en: ['Shipment {number} delivered', 'The driver closed it with the consignee code.'] },
  'trip.cancelled': { roles: OPS, ar: ['اتلغت الرحلة {number}', 'افتح الرحلة لتفاصيل الإلغاء.'], en: ['Trip {number} cancelled', 'Open the trip for the reason.'] },
  'booking.created': { roles: OPS, external: true, ar: ['حجز جديد {number}', 'وصل من نظام خارجي ومستني تخصيص.'], en: ['New booking {number}', 'Received from an outside system, waiting to be assigned.'] },
  'payment.received': { roles: MONEY, external: true, ar: ['تحصيل جديد {number}', 'اتسجل مبلغ {amount}.'], en: ['Payment {number} received', 'Amount {amount} recorded.'] },
  'tracking.alert': { roles: OPS, ar: ['تنبيه تتبع: {vehicle}', '{type} الساعة {time}.'], en: ['Tracking alert: {vehicle}', '{type} at {time}.'] },
};
/* event -> what the trip's own driver hears on the driver app (data.driverId says which driver) */
const DRIVER = {
  'trip.assigned': { ar: ['رحلة جديدة {number}', '{date} الساعة {time} · {vehicle}'], en: ['New trip {number}', '{date} at {time} · {vehicle}'] },
  'trip.cancelled': { ar: ['اتلغت رحلتك {number}', 'افتح التطبيق وشوف رحلاتك.'], en: ['Your trip {number} was cancelled', 'Open the app to see your trips.'] },
};
const fill = (s, d) => s.replace(/\{(\w+)\}/g, (_, k) => (d && d[k] != null ? String(d[k]) : ''));

/* called from core.emit inside the change's transaction */
async function enqueue(c, ctx, event, data) {
  const dt = DRIVER[event];
  if (dt && data && data.driverId) {
    await c.query('INSERT INTO push_queue (company_id, event, title_ar, title_en, body_ar, body_en, data, roles, driver_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [ctx.companyId, event, fill(dt.ar[0], data), fill(dt.en[0], data), fill(dt.ar[1], data), fill(dt.en[1], data), JSON.stringify({ event, id: String(data.id || ''), number: String(data.number || '') }), [], data.driverId]);
  }
  const t = TEMPLATES[event];
  if (!t) return;
  if (t.external && (ctx.source || 'ui') === 'ui') return;   // the person who did it in the dashboard already knows
  await c.query('INSERT INTO push_queue (company_id, event, title_ar, title_en, body_ar, body_en, data, roles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [ctx.companyId, event, fill(t.ar[0], data), fill(t.en[0], data), fill(t.ar[1], data), fill(t.en[1], data), JSON.stringify({ event, id: data && data.id ? String(data.id) : '', number: data && data.number ? String(data.number) : '' }), t.roles]);
}

/* ---------- senders ---------- */
let CFG = null, allowPrivate = false;
const tokens = {};   // cached access tokens { fcm: {value, exp}, hms: {...} }
const b64u = b => Buffer.from(b).toString('base64url');

function fcmAccount() {
  if (!CFG.fcmServiceAccount) return null;
  try { return JSON.parse(fs.readFileSync(CFG.fcmServiceAccount, 'utf8')); } catch (e) { log.error('push: cannot read the Firebase service account', { err: e }); return null; }
}
async function fcmToken(acc) {
  if (tokens.fcm && tokens.fcm.exp > Date.now() + 60000) return tokens.fcm.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: acc.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: CFG.googleTokenUrl, iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), acc.private_key).toString('base64url');
  const r = await outbound.request(CFG.googleTokenUrl, { allowPrivate, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${claim}.${sig}` });
  const j = JSON.parse(r.body || '{}');
  if (!j.access_token) throw new Error(`Firebase token: HTTP ${r.status}`);
  tokens.fcm = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
async function hmsToken() {
  if (tokens.hms && tokens.hms.exp > Date.now() + 60000) return tokens.hms.value;
  const r = await outbound.request(CFG.hmsTokenUrl, { allowPrivate, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=${encodeURIComponent(CFG.hmsAppId)}&client_secret=${encodeURIComponent(CFG.hmsClientSecret)}` });
  const j = JSON.parse(r.body || '{}');
  if (!j.access_token) throw new Error(`Huawei token: HTTP ${r.status}`);
  tokens.hms = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}
/* one message to one device; returns 'sent' | 'gone' (token no longer valid) | throws */
async function sendOne(d, msg, acc) {
  if (d.platform === 'huawei') {
    const tok = await hmsToken();
    const body = JSON.stringify({ validate_only: false, message: { token: [d.push_token], data: JSON.stringify(msg.data), android: { notification: { title: msg.title, body: msg.body, click_action: { type: 3 } } } } });
    const r = await outbound.request(`${CFG.hmsUrl}/v1/${encodeURIComponent(CFG.hmsAppId)}/messages:send`, { allowPrivate, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body });
    const j = JSON.parse(r.body || '{}');
    if (j.code === '80000000') return 'sent';
    if (j.code === '80300007' || j.code === '80100000') return 'gone';   // invalid / unregistered token
    throw new Error(`Huawei push: ${j.code || r.status} ${j.msg || ''}`);
  }
  const tok = await fcmToken(acc);
  const body = JSON.stringify({ message: { token: d.push_token, notification: { title: msg.title, body: msg.body }, data: msg.data, apns: { payload: { aps: { sound: 'default' } } } } });
  const r = await outbound.request(`${CFG.fcmUrl}/v1/projects/${encodeURIComponent(acc.project_id)}/messages:send`, { allowPrivate, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body });
  if (r.status >= 200 && r.status < 300) return 'sent';
  if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(r.body || '')) return 'gone';
  throw new Error(`Firebase push: HTTP ${r.status}`);
}

/* ---------- worker ---------- */
let timer = null, running = false;
async function tick() {
  if (running) return; running = true;
  try {
    const rows = (await db.platform(c => c.query("UPDATE push_queue SET status = 'sent', sent_at = now() WHERE id IN (SELECT id FROM push_queue WHERE status = 'pending' ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING *"))).rows;
    if (!rows.length) return;
    const acc = fcmAccount();
    const hms = !!(CFG.hmsAppId && CFG.hmsClientSecret);
    for (const q of rows) {
      // the company's members (active, in a role that should hear it) with a registered app
      // (or, for a driver message, that driver's own account on the driver app)
      const users = (await db.read(q.company_id, c => (q.driver_id
        ? c.query("SELECT user_id FROM memberships WHERE status = 'active' AND role = 'driver' AND driver_id = $1", [q.driver_id])
        : c.query("SELECT user_id FROM memberships WHERE status = 'active' AND role = ANY($1)", [q.roles])))).rows.map(r => r.user_id);
      const devices = users.length ? (await db.platform(c => c.query('SELECT * FROM mobile_devices WHERE user_id = ANY($1::uuid[]) AND app = $2', [users, q.driver_id ? 'driver' : 'admin']))).rows : [];
      let sent = 0, err = null, usable = 0;
      for (const d of devices) {
        if (d.platform === 'huawei' ? !hms : !acc) continue;
        usable++;
        const msg = { title: d.lang === 'en' ? q.title_en : q.title_ar, body: d.lang === 'en' ? q.body_en : q.body_ar, data: Object.fromEntries(Object.entries(q.data || {}).map(([k, v]) => [k, String(v)])) };
        try {
          const r = await sendOne(d, msg, acc);
          if (r === 'sent') sent++;
          else await db.platform(c => c.query('DELETE FROM mobile_devices WHERE id = $1', [d.id]));
        } catch (e) { err = e.message; }
      }
      const status = !usable ? 'skipped' : (err && !sent ? 'failed' : 'sent');
      await db.platform(c => c.query('UPDATE push_queue SET status = $1, sent_count = $2, error = $3 WHERE id = $4', [status, sent, err, q.id]));
      if (err) log.warn('push problem', { event: q.event, error: err });
    }
    await db.platform(c => c.query("DELETE FROM push_queue WHERE status <> 'pending' AND created_at < now() - interval '30 days'"));
  } catch (e) { log.error('push worker error', { err: e }); }
  finally { running = false; }
}
function start(cfg, opts = {}) { CFG = cfg; allowPrivate = !!opts.allowPrivate; if (!timer) { timer = setInterval(tick, opts.intervalMs || 5000); timer.unref(); } }
function stop() { if (timer) clearInterval(timer); timer = null; }
function configure(cfg, opts = {}) { CFG = cfg; allowPrivate = !!opts.allowPrivate; }

module.exports = { enqueue, start, stop, tick, configure, TEMPLATES, DRIVER };
