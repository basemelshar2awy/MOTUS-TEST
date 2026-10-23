'use strict';
/* Browser-facing routes. Every state-changing request needs: a valid session cookie, the
   X-Requested-With header, and (when sent) an Origin that matches this site. */
const crypto = require('crypto');
const db = require('../lib/db');
const activities = require('../lib/activities');
const countries = require('../lib/countries');
const core = require('../lib/core');
const log = require('../lib/log');
const secrets = require('../lib/secrets');
const snapshot = require('../lib/snapshot');
const platform = require('../lib/platform');
const erp = require('../lib/erp');
const webhooks = require('../lib/webhooks');
const registry = require('../services/registry');
const providers = require('../services/providers');
const tracking = require('../services/tracking');
const session = require('./session');
const webcalc = require('../lib/webcalc');
const { Router, json, readBody, cookies, send } = require('../lib/http');
const { AppError, bad, notFound, forbidden } = require('../lib/errors');

const router = new Router();
let CFG = null;
const init = cfg => { CFG = cfg; };

/* ---------- helpers ---------- */
async function currentUser(req) {
  if (req._user !== undefined) return req._user;
  // the apps send their session token as a Bearer header; the browser sends its cookie
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  const u = m ? await session.lookup(m[1], ['mobile']) : await session.lookup(cookies(req)[session.COOKIE]);
  req._user = u; return u;
}
async function requireUser(req, { allowMustChange = false } = {}) {
  const u = await currentUser(req);
  if (!u) throw new AppError(401, 'auth', 'سجّل الدخول للمتابعة', 'Please sign in to continue');
  if (u.mustChange && !allowMustChange) throw new AppError(403, 'password_change_required', 'لازم تغيّر كلمة المرور أولاً', 'You must change your password first');
  return u;
}
/* drivers reach only their own trips (snapshot + driver actions); every other company route is staff only */
const requireCompany = (u, { driver = false } = {}) => {
  if (!u.companyId) throw new AppError(400, 'no_company', 'اختر شركة أولاً', 'Select a company first');
  if (u.role === 'driver' && !driver) throw forbidden();
  return u.companyId;
};
const ctxOf = (u, req) => ({ companyId: u.companyId, user: { id: u.id, name: u.name, role: u.role, driverId: u.driverId || null }, source: 'ui', ip: req._ip });
const ADMIN_ROLES = ['super_admin', 'company_admin'];

function checkOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (req.headers['x-requested-with'] !== 'motus') throw new AppError(403, 'csrf', 'طلب غير مصرح به', 'Request rejected (missing X-Requested-With header)');
  const origin = req.headers.origin;
  if (!origin) return;
  const host = (CFG.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
  const proto = (CFG.trustProxy && req.headers['x-forwarded-proto']) || (CFG.secureCookies ? 'https' : 'http');
  const ok = origin === CFG.publicOrigin || CFG.extraOrigins.includes(origin) || origin === `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
  if (!ok) { log.warn('origin rejected', { origin, host }); throw new AppError(403, 'csrf', 'طلب من مصدر غير معروف', 'Request rejected (unexpected Origin)'); }
}

/* ---------- session ---------- */
async function sessionPayload(u) {
  if (!u) return { user: null };
  const out = { user: { id: u.id, email: u.email, phone: u.phone, login: u.login, name: { ar: u.nameAr || u.name, en: u.name }, role: u.role, member: u.member, driverId: u.driverId, lang: u.lang, mustChangePassword: u.mustChange }, company: null, companies: [], invites: [] };
  await db.platform(async c => {
    if (u.role === 'super_admin') {
      out.companies = (await c.query("SELECT id, code, name_ar, name_en, country FROM companies WHERE status = 'active' ORDER BY code")).rows.map(r => ({ id: r.id, code: r.code, name: { ar: r.name_ar, en: r.name_en || r.name_ar }, country: r.country }));
    } else {
      // one account, several companies: each with the role it has there
      const ms = (await c.query("SELECT * FROM user_memberships($1) WHERE company_status = 'active'", [u.id])).rows;
      const co = m => ({ id: m.company_id, code: m.code, name: { ar: m.name_ar, en: m.name_en || m.name_ar }, country: m.country, role: m.role });
      out.companies = ms.filter(m => m.status === 'active').map(co);
      out.invites = ms.filter(m => m.status === 'invited').map(co);
    }
    out.company = out.companies.find(x => x.id === u.companyId) || null;
    if (out.company) { const r = (await c.query('SELECT currency FROM companies WHERE id = $1', [out.company.id])).rows[0]; out.company.currency = r.currency; }
  });
  out.activityCatalog = activities.CATALOG;
  out.countries = countries.CODES.map(c => countries.publicPack(c));
  if (out.company) out.company.activities = await db.read(out.company.id, c => activities.enabled(c, {}));
  return out;
}
router.add('GET', '/api/session', async (req, res) => send(res, 200, await sessionPayload(await currentUser(req))));
router.add('POST', '/api/login', async (req, res) => send(res, 200, await session.login(req, res, await json(req, 10 * 1024), req._ip)));
router.add('POST', '/api/logout', async (req, res) => { await session.logout(res, await currentUser(req)); send(res, 200, { ok: true }); });
router.add('POST', '/api/password', async (req, res) => {
  const u = await requireUser(req, { allowMustChange: true });
  const out = await session.changePassword(u, await json(req, 10 * 1024), res);
  send(res, 200, Object.assign({ ok: true }, out));
});
router.add('POST', '/api/session/company', async (req, res) => { const u = await requireUser(req); const b = await json(req, 4096); await session.switchCompany(u, b.companyId); await session.syncEmbeds(u); send(res, 200, { ok: true }); });
router.add('POST', '/api/session/invites/:companyId/:answer', async (req, res, p) => {
  const u = await requireUser(req);
  if (!['accept', 'decline'].includes(p.answer)) throw notFound('route');
  send(res, 200, await session.answerInvite(u, p.companyId, p.answer === 'accept'));
});
router.add('POST', '/api/session/lang', async (req, res) => { const u = await requireUser(req); await session.setLang(u, (await json(req, 1024)).lang); send(res, 200, { ok: true }); });

/* ---------- mobile apps ---------- */
const PLATFORMS = ['android', 'ios', 'huawei'];
const requireApp = async req => { const u = await requireUser(req); if (u.kind !== 'mobile') throw new AppError(403, 'forbidden', 'للتطبيق بس', 'For the app only'); return u; };
// a web screen opened inside the app (one-time link, see session.mobileLink)
router.add('POST', '/api/mobile/link', async (req, res) => { const u = await requireApp(req); send(res, 200, await session.mobileLink(u, (await json(req, 4096)).route)); });
// this device's push token (Firebase on Android/iPhone, Huawei Push Kit on Huawei phones)
router.add('POST', '/api/mobile/devices', async (req, res) => {
  const u = await requireApp(req); const b = await json(req, 16 * 1024);
  const platform = String(b.platform || ''), token = String(b.pushToken || '');
  if (!PLATFORMS.includes(platform)) throw bad('platform', 'نوع الجهاز غير معروف', 'Unknown platform', 'platform');
  if (token.length < 20 || token.length > 4096) throw bad('pushToken', 'رمز الإشعارات غير صحيح', 'Invalid push token', 'pushToken');
  const app = b.app === 'driver' ? 'driver' : 'admin', lang = b.lang === 'en' ? 'en' : 'ar';
  const str = (v, n) => String(v || '').slice(0, n);
  const r = await db.platform(c => c.query(`INSERT INTO mobile_devices (user_id, session_id, app, platform, push_token, app_version, model, lang) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (push_token) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, app = EXCLUDED.app, platform = EXCLUDED.platform, app_version = EXCLUDED.app_version, model = EXCLUDED.model, lang = EXCLUDED.lang, last_seen_at = now()
    RETURNING id`, [u.id, u.sessionId, app, platform, token, str(b.appVersion, 40), str(b.model, 80), lang]));
  send(res, 200, { id: r.rows[0].id });
});
router.add('DELETE', '/api/mobile/devices', async (req, res) => {
  const u = await requireApp(req);
  await db.platform(c => c.query('DELETE FROM mobile_devices WHERE session_id = $1', [u.sessionId]));
  send(res, 200, { ok: true });
});
// the home screen: the dashboard's figures from the dashboard's own calc code (lib/webcalc)
router.add('GET', '/api/mobile/home', async (req, res, p, url) => {
  const u = await requireUser(req); const cid = requireCompany(u);
  const snap = snapshot.forRole(await snapshot.get(cid), u.role, u.id, u.driverId);
  const period = url.searchParams.get('period') === 'last' ? 'last' : 'mtd';
  send(res, 200, webcalc.home(snap, { key: `${cid}|${u.role}|${u.id}`, lang: u.lang === 'en' ? 'en' : 'ar', period }));
});
router.add('GET', '/api/mobile/alerts', async (req, res) => {
  const u = await requireUser(req); const cid = requireCompany(u);
  const snap = snapshot.forRole(await snapshot.get(cid), u.role, u.id, u.driverId);
  send(res, 200, { alerts: webcalc.alerts(snap, { key: `${cid}|${u.role}|${u.id}`, lang: u.lang === 'en' ? 'en' : 'ar' }) });
});
/* the one-time link: becomes a short browser session inside the app, then shows the screen with
   the dashboard's menus hidden (the app has its own) */
async function openMobile(req, res, url) {
  const route = await session.openLink(res, url.searchParams.get('code'));
  if (!route) return send(res, 410, 'This link has expired. Go back and open the screen again. / انتهت صلاحية الرابط، ارجع وافتح الشاشة تاني.');
  res.writeHead(302, { Location: `/?embed=1#${route}`, 'Cache-Control': 'no-store' }); res.end();
}

/* ---------- data ---------- */
router.add('GET', '/api/snapshot', async (req, res) => {
  const u = await requireUser(req); const cid = requireCompany(u, { driver: true });
  const snap = await snapshot.get(cid);
  send(res, 200, snapshot.forRole(snap, u.role, u.id, u.driverId));
});
router.add('GET', '/api/version', async (req, res) => {
  const u = await requireUser(req); const cid = requireCompany(u, { driver: true });
  send(res, 200, { version: await snapshot.version(cid) });
});
router.add('POST', '/api/do/:action', async (req, res, p) => {
  const u = await requireUser(req); requireCompany(u, { driver: true });   // the action registry checks the role
  const body = await json(req, 16 * 1024 * 1024 > CFG.maxUploadBytes * 2 ? CFG.maxUploadBytes * 2 : 16 * 1024 * 1024);
  const out = await registry.run(ctxOf(u, req), p.action, body);
  send(res, 200, out === undefined ? { ok: true } : out);
});
router.add('GET', '/api/live', async (req, res) => {
  const u = await requireUser(req); const cid = requireCompany(u);
  const rows = await db.read(cid, async c => (await c.query("SELECT DISTINCT ON (vehicle_id) vehicle_id, at, lat, lng, speed, ignition, heading FROM positions WHERE at >= now() - interval '7 days' ORDER BY vehicle_id, at DESC")).rows);
  send(res, 200, { serverNow: Date.now(), positions: rows.map(r => ({ vehicleId: r.vehicle_id, at: core.fmtTs(r.at), ts: new Date(r.at).getTime(), lat: r.lat, lng: r.lng, speed: Number(r.speed), ignition: r.ignition, heading: r.heading == null ? null : Number(r.heading) })) });
});
router.add('GET', '/api/history', async (req, res, p, url) => {
  const u = await requireUser(req); const cid = requireCompany(u);
  const vid = url.searchParams.get('vehicleId'), date = url.searchParams.get('date');
  if (!db.UUID.test(vid || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('params', 'مركبة أو تاريخ غير صحيح', 'Invalid vehicle or date');
  const out = await db.read(cid, async c => {
    const pts = (await c.query(`SELECT at, lat, lng, speed FROM positions WHERE vehicle_id = $1 AND at >= ($2::date::timestamp AT TIME ZONE $3) AND at < (($2::date + 1)::timestamp AT TIME ZONE $3) ORDER BY at LIMIT 20000`, [vid, date, CFG.timezone])).rows;
    const evs = (await c.query('SELECT * FROM events WHERE vehicle_id = $1 AND date = $2 ORDER BY time', [vid, date])).rows;
    return { points: pts.map(r => ({ at: core.fmtTs(r.at), lat: r.lat, lng: r.lng, speed: Number(r.speed) })), events: evs.map(e => ({ id: e.id, time: e.time, type: e.type, value: e.value == null ? null : Number(e.value), place: e.place, severity: e.severity })) };
  });
  send(res, 200, out);
});
router.add('GET', '/api/ai/conversations/:id', async (req, res, p) => {
  const u = await requireUser(req); const cid = requireCompany(u);
  if (!db.UUID.test(p.id)) throw notFound('conversation');
  const out = await db.read(cid, async c => {
    const cv = (await c.query('SELECT id, user_id FROM ai_conversations WHERE id = $1', [p.id])).rows[0];
    if (!cv || (cv.user_id !== u.id && !ADMIN_ROLES.includes(u.role))) throw notFound('conversation');
    return (await c.query('SELECT role, content, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at, id', [p.id])).rows;
  });
  send(res, 200, { messages: out.map(m => Object.assign({ role: m.role, at: core.fmtTs(m.created_at) }, m.content)) });
});
router.add('GET', '/api/documents/:id/file', async (req, res, p) => {
  const u = await requireUser(req); const cid = requireCompany(u);
  if (!['super_admin', 'company_admin', 'fleet_manager', 'operations', 'maintenance', 'accountant'].includes(u.role)) throw forbidden();
  if (!db.UUID.test(p.id)) throw notFound('document');
  const r = await db.read(cid, async c => (await c.query('SELECT d.file_name, d.mime, f.content FROM documents d JOIN document_files f ON f.document_id = d.id WHERE d.id = $1', [p.id])).rows[0]);
  if (!r) throw notFound('document');
  const name = encodeURIComponent(r.file_name || 'document');
  send(res, 200, r.content, { 'Content-Type': r.mime, 'Content-Disposition': `inline; filename*=UTF-8''${name}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
});

/* ---------- accounting / ERP ---------- */
router.add('GET', '/api/export/journal', async (req, res, p, url) => {
  const u = await requireUser(req); requireCompany(u);
  if (!['super_admin', 'company_admin', 'accountant', 'fleet_manager'].includes(u.role)) throw forbidden();
  const q = Object.fromEntries(url.searchParams);
  const list = await erp.exportFile(ctxOf(u, req), q);
  if (q.mark === '1') snapshot.invalidate(u.companyId);
  const stamp = core.today();
  if (q.format === 'json') send(res, 200, { companyId: u.companyId, generatedAt: new Date().toISOString(), entries: list }, { 'Content-Disposition': `attachment; filename="journal-${stamp}.json"` });
  else send(res, 200, Buffer.from(erp.toCsv(list), 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="journal-${stamp}.csv"` });
});
router.add('POST', '/api/erp/push', async (req, res) => {
  const u = await requireUser(req); requireCompany(u);
  if (!['super_admin', 'company_admin', 'accountant'].includes(u.role)) throw forbidden();
  const r = await erp.push(ctxOf(u, req), CFG.allowPrivateWebhooks);
  snapshot.invalidate(u.companyId);
  send(res, 200, r);
});

/* ---------- platform (super admin) ---------- */
const superOnly = async req => { const u = await requireUser(req); if (u.role !== 'super_admin') throw forbidden(); return u; };
router.add('GET', '/api/platform/companies', async (req, res, p, url) => { await superOnly(req); const country = url.searchParams.get('country'); send(res, 200, { companies: await platform.listCompanies({ country: country || null }), countries: countries.CODES.map(c => countries.publicPack(c)) }); });
router.add('POST', '/api/platform/companies/:id/country', async (req, res, p) => { const u = await superOnly(req); const out = await platform.setCountry(u, p.id, await json(req, 1024)); snapshot.invalidate(p.id); send(res, 200, out); });
router.add('POST', '/api/platform/companies', async (req, res) => { const u = await superOnly(req); send(res, 201, await platform.createCompany(u, await json(req, 64 * 1024))); });
router.add('POST', '/api/platform/companies/:id/activities', async (req, res, p) => {
  const u = await superOnly(req);
  const out = await platform.setActivities(u, p.id, await json(req, 4096));
  snapshot.invalidate(p.id);
  send(res, 200, out);
});
router.add('POST', '/api/platform/companies/:id/status', async (req, res, p) => { const u = await superOnly(req); await platform.setCompanyStatus(u, p.id, (await json(req, 1024)).status); send(res, 200, { ok: true }); });

/* ---------- inbound provider webhooks (HMAC signed with the connection's secret) ---------- */
router.add('POST', '/api/webhooks/providers/:id', async (req, res, p) => {
  if (!db.UUID.test(p.id)) throw notFound('provider');
  const raw = await readBody(req, 5 * 1024 * 1024);
  const found = (await db.platform(c => c.query('SELECT * FROM provider_lookup($1)', [p.id]))).rows[0];
  const reject = () => new AppError(401, 'bad_signature', 'توقيع غير صحيح', 'Invalid webhook signature');
  if (!found || found.status !== 'connected') throw reject();
  const secretEnc = (await db.read(found.company_id, c => c.query('SELECT webhook_secret_enc FROM providers WHERE id = $1', [p.id]))).rows[0];
  if (!secretEnc || !secretEnc.webhook_secret_enc) throw reject();
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(req.headers['x-motus-signature'] || ''));
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) throw reject();
  const expect = Buffer.from(webhooks.sign(secrets.decrypt(secretEnc.webhook_secret_enc), raw.toString('utf8'), Number(m[1])).split('v1=')[1], 'hex');
  if (!crypto.timingSafeEqual(expect, Buffer.from(m[2], 'hex'))) throw reject();
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch (e) { throw bad('bad_json', 'JSON غير صحيح', 'Invalid JSON'); }
  const ctx = { companyId: found.company_id, user: { id: null, name: 'provider:' + found.kind, role: 'integration', apiKey: true }, source: 'integration' };
  const out = await db.tx(found.company_id, async c => {
    let r;
    if (Array.isArray(body.transactions)) r = await providers.importTx(ctx, c, p.id, body.transactions);
    else if (Array.isArray(body.positions) && found.kind === 'gps') r = await tracking.ingestPositions(ctx, c, body.positions);
    else throw bad('payload', 'الحمولة لا تحتوي transactions أو positions', 'Payload must contain "transactions" (fuel/toll/service) or "positions" (gps)');
    await c.query('UPDATE providers SET last_sync = now() WHERE id = $1', [p.id]);
    await core.touch(c, ctx);
    return r;
  });
  snapshot.invalidate(found.company_id);
  send(res, 200, out);
});

module.exports = { router, init, currentUser, checkOrigin, openMobile };
