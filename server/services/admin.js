'use strict';
/* Company administration inside a company: profile, branches, settings & thresholds,
   vehicle types, users & roles, API keys, outbound webhooks, CSV imports, AI logging. */
const crypto = require('crypto');
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const activities = require('../lib/activities');
const auth = require('../lib/auth');
const secrets = require('../lib/secrets');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound, forbidden, AppError } = require('../lib/errors');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const P = (o, f, fn, ...a) => (has(o, f) ? fn(o, f, ...a) : undefined);
const COMPANY_ROLES = ['company_admin', 'fleet_manager', 'operations', 'accountant', 'maintenance', 'viewer'];

/* ---------- company profile & branches ---------- */
define('company.update', G.admin, async (ctx, i, c) => {
  const name = P(i, 'name', V.text2, { max: 160 });
  const f = defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, tax_no: P(i, 'taxNo', V.str, { max: 30, def: '' }), fy_start: P(i, 'fyStart', V.str, { max: 5, re: /^\d\d-\d\d$/ }) });
  if (Object.keys(f).length) {
    const cols = Object.keys(f);
    await c.query(`UPDATE companies SET ${cols.map((k, n) => `${k} = $${n + 1}`).join(', ')}, updated_at = now() WHERE id = $${cols.length + 1}`, [...cols.map(k => f[k]), ctx.companyId]);
  }
  await core.audit(c, ctx, 'update', 'company', '', { field: Object.keys(f).join(', ') });
});
define('branch.create', G.admin, async (ctx, i, c) => {
  const name = V.text2(i, 'name', { req: true, max: 120 });
  const b = await insert(c, 'branches', { company_id: ctx.companyId, code: V.str(i, 'code', { req: true, max: 12, re: /^[A-Z0-9-]+$/ }), city: V.str(i, 'city', { req: true, max: 12 }), name_ar: name.ar, name_en: name.en });
  await core.audit(c, ctx, 'create', 'branch', b.code);
  return { id: b.id };
});
define('branch.update', G.admin, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const b = await core.lock(c, 'branches', id, 'branch');
  const name = P(i, 'name', V.text2, { max: 120 });
  await update(c, 'branches', id, defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, city: P(i, 'city', V.str, { max: 12 }) }));
  await core.audit(c, ctx, 'update', 'branch', b.code);
});

/* ---------- settings (thresholds, tax, prices, AI) ---------- */
const NUMS = { vatRate: [0, 1], fuelDeviation: [0.01, 1], oilWarnKm: [0, 20000], maintWarnDays: [0, 90], expiryWarnDays: [1, 365], lifeWarnPct: [0.1, 1], maintCostPct: [0.01, 5], overspeed: [30, 200], maxDriveHours: [1, 24], minRestHours: [0, 24], laborRate: [0, 100000], defaultTerms: [0, 365], usdRate: [0.0001, 100000], aiMonthlyLimit: [0, 10000000], priceMargin: [0, 0.95] };
define('settings.update', G.admin.concat(['fleet_manager']), async (ctx, i, c) => {
  const cur = await core.settings(c, ctx);
  const next = {};
  for (const [k, [lo, hi]] of Object.entries(NUMS)) if (has(i, k)) next[k] = V.num(i, k, { req: true, min: lo, max: hi });
  if (has(i, 'fuelPrices')) next.fuelPrices = { diesel: V.num(i.fuelPrices, 'diesel', { req: true, min: 0, max: 1000 }), gasoline: V.num(i.fuelPrices, 'gasoline', { req: true, min: 0, max: 1000 }) };
  if (has(i, 'workHours')) next.workHours = V.str(i, 'workHours', { req: true, re: /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/ });
  if (has(i, 'goLive')) next.goLive = V.date(i, 'goLive');
  for (const k of ['aiEnabled', 'aiApproval']) if (has(i, k)) next[k] = V.bool(i, k);
  if (has(i, 'aiFeatures')) { next.aiFeatures = Object.assign({}, cur.aiFeatures); for (const k of Object.keys(cur.aiFeatures)) if (has(i.aiFeatures, k)) next.aiFeatures[k] = V.bool(i.aiFeatures, k); }
  const aiKeys = ['aiEnabled', 'aiApproval', 'aiFeatures', 'aiMonthlyLimit'];
  if (ctx.user.role === 'fleet_manager' && Object.keys(next).some(k => aiKeys.includes(k) || k === 'vatRate')) throw forbidden();
  await c.query("UPDATE company_settings SET data = data || $1::jsonb WHERE company_id = $2", [JSON.stringify(next), ctx.companyId]);
  await core.audit(c, ctx, 'update', 'settings', '', { field: Object.keys(next).join(', '), before: Object.keys(next).map(k => JSON.stringify(cur[k])).join(', '), after: Object.keys(next).map(k => JSON.stringify(next[k])).join(', ') });
});

define('vehicleType.update', G.fleet, async (ctx, i, c) => {
  const code = V.oneOf(i, 'code', ['LB', 'MB', 'MC', 'SD'], { req: true });
  const t = (await c.query('SELECT * FROM vehicle_types WHERE code = $1 FOR UPDATE', [code])).rows[0];
  if (!t) throw notFound('vehicle type');
  const name = P(i, 'name', V.text2, { max: 60 });
  const f = defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, seats: P(i, 'seats', V.int, { min: 1, max: 100 }), oil_km: P(i, 'oilKm', V.int, { min: 1000, max: 100000 }), life_years: P(i, 'lifeYears', V.num, { gt: 0, max: 40 }), life_km: P(i, 'lifeKm', V.int, { min: 1000 }), salvage_pct: P(i, 'salvagePct', V.num, { min: 0, max: 0.9 }), tank_l: P(i, 'tankL', V.num, { gt: 0 }), kmpl: P(i, 'kmpl', V.num, { gt: 0, max: 50 }), rate_km: P(i, 'rateKm', V.num, { min: 0 }), base_price: P(i, 'basePrice', V.num, { min: 0 }), toll_gate: P(i, 'tollGate', V.num, { min: 0 }), oil_cost: P(i, 'oilCost', V.num, { min: 0 }), oil_liters: P(i, 'oilLiters', V.num, { min: 0 }), insurance: P(i, 'insurance', V.num, { min: 0 }), license: P(i, 'license', V.num, { min: 0 }) });
  await update(c, 'vehicle_types', t.id, f);
  await core.audit(c, ctx, 'update', 'vehicle_type', code, { field: Object.keys(f).join(', ') });
});

/* ---------- users (company scope; users table is filtered by company explicitly) ---------- */
async function companyUser(c, ctx, id) {
  const u = (await c.query('SELECT * FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, ctx.companyId])).rows[0];
  if (!u) throw notFound('user');
  return u;
}
async function adminsLeft(c, ctx, exceptId) {
  return (await c.query("SELECT count(*)::int n FROM users WHERE company_id = $1 AND role = 'company_admin' AND status = 'active' AND id <> $2", [ctx.companyId, exceptId])).rows[0].n;
}
define('user.create', G.admin, async (ctx, i, c) => {
  const email = V.email(i, 'email', { req: true });
  const role = V.oneOf(i, 'role', COMPANY_ROLES, { req: true });
  const name = V.text2(i, 'name', { req: true, max: 120 }), title = V.text2(i, 'title', { max: 120 });
  if ((await c.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount) throw conflict('email_taken', 'البريد الإلكتروني مستخدم بالفعل', 'That email address is already in use');
  const branchId = V.uuid(i, 'branchId'); if (branchId) await core.mustExist(c, 'branches', branchId, 'branch');
  const temp = auth.randomPassword(16);
  const u = await insert(c, 'users', { company_id: ctx.companyId, email, name_ar: name.ar, name_en: name.en, title_ar: title.ar || '', title_en: title.en || '', role, branch_id: branchId, password_hash: await auth.hashPassword(temp), must_change_password: true, lang: V.oneOf(i, 'lang', ['ar', 'en'], { def: 'ar' }) });
  await core.audit(c, ctx, 'create', 'user', `${email} (${role})`);
  return { id: u.id, email, temporaryPassword: temp };
});
define('user.update', G.admin, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const u = await companyUser(c, ctx, id);
  const name = P(i, 'name', V.text2, { max: 120 }), title = P(i, 'title', V.text2, { max: 120 });
  const role = P(i, 'role', V.oneOf, COMPANY_ROLES), status = P(i, 'status', V.oneOf, ['active', 'disabled']);
  if ((role && role !== 'company_admin' && u.role === 'company_admin') || (status === 'disabled' && u.role === 'company_admin')) {
    if (!(await adminsLeft(c, ctx, id))) throw conflict('last_admin', 'لازم يفضل مدير نظام واحد نشط على الأقل', 'At least one active company admin must remain');
  }
  if (id === ctx.user.id && status === 'disabled') throw conflict('self', 'لا يمكنك تعطيل حسابك', 'You cannot disable your own account');
  const branchId = P(i, 'branchId', V.uuid); if (branchId) await core.mustExist(c, 'branches', branchId, 'branch');
  await update(c, 'users', id, defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, title_ar: title ? title.ar || '' : undefined, title_en: title ? title.en || '' : undefined, role, status, branch_id: branchId, updated_at: new Date() }));
  if (status === 'disabled' || (role && role !== u.role)) await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await core.audit(c, ctx, 'update', 'user', u.email, { field: [role && 'role', status && 'status'].filter(Boolean).join(', '), before: [role && u.role, status && u.status].filter(Boolean).join(', '), after: [role, status].filter(Boolean).join(', ') });
});
define('user.resetPassword', G.admin, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const u = await companyUser(c, ctx, id);
  const temp = auth.randomPassword(16);
  await c.query('UPDATE users SET password_hash = $1, must_change_password = true, failed_attempts = 0, locked_until = NULL, password_changed_at = now() WHERE id = $2', [await auth.hashPassword(temp), id]);
  await c.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await core.audit(c, ctx, 'update', 'user', u.email, { field: 'password', before: '', after: 'reset' });
  return { email: u.email, temporaryPassword: temp };
});

/* ---------- Open API keys: shown once, stored as SHA-256 ---------- */
const SCOPES = ['vehicles', 'drivers', 'clients', 'bookings', 'trips', 'programs', 'invoices', 'payments', 'expenses', 'journal', 'items', 'stock', 'fuel', 'tracking', 'reports', 'suppliers', 'workorders'];
define('apiKey.create', G.admin, async (ctx, i, c) => {
  const name = V.text2(i, 'name', { req: true, max: 120 });
  const scopes = [...new Set(V.arr(i, 'scopes', { req: true, min: 1, max: 40 }).map(String))];
  for (const s of scopes) { const [r, a] = s.split(':'); if (!SCOPES.includes(r) || !['read', 'write'].includes(a)) throw bad('scope', 'صلاحية غير معروفة: ' + s, 'Unknown scope: ' + s, 'scopes'); }
  const acts = await activities.enabled(c, ctx);
  for (const s of scopes) { const own = activities.scopeActivity(s); if (own && !acts.includes(own)) throw bad('scope_activity', `الصلاحية ${s} تبع نشاط "${activities.label(own).ar}" وهو مش مفعّل لشركتك`, `The scope ${s} belongs to the "${activities.label(own).en}" activity, which is not enabled for your company`, 'scopes'); }
  const prefix = 'mk_live_' + crypto.randomBytes(4).toString('hex');
  const key = prefix + '_' + crypto.randomBytes(24).toString('base64url');
  const k = await insert(c, 'api_keys', { company_id: ctx.companyId, name_ar: name.ar, name_en: name.en, prefix, key_hash: auth.sha256(key), scopes, status: 'active', created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'api_key', prefix, { field: 'scopes', before: '', after: scopes.join(' ') });
  return { id: k.id, prefix, key };
});
define('apiKey.revoke', G.admin, async (ctx, i, c) => {
  const k = await core.lock(c, 'api_keys', V.uuid(i, 'id', { req: true }), 'API key');
  await c.query("UPDATE api_keys SET status = 'revoked' WHERE id = $1", [k.id]);
  await core.audit(c, ctx, 'update', 'api_key', k.prefix, { field: 'status', before: k.status, after: 'revoked' });
});

/* ---------- outbound webhooks ---------- */
const EVENTS = ['booking.created', 'booking.confirmed', 'booking.cancelled', 'trip.assigned', 'trip.started', 'trip.completed', 'trip.cancelled', 'invoice.issued', 'invoice.cancelled', 'credit_note.issued', 'payment.received', 'journal.posted', 'vehicle.created', 'vehicle.updated', 'client.created', 'work_order.closed', 'stock.received', 'tracking.alert', 'ping'];
define('webhook.create', G.admin, async (ctx, i, c) => {
  const url = V.str(i, 'url', { req: true, max: 400, re: /^https?:\/\/[^\s]+$/ });
  const events = [...new Set(V.arr(i, 'events', { req: true, min: 1, max: 30 }).map(String))];
  for (const e of events) if (!EVENTS.includes(e)) throw bad('event', 'حدث غير معروف: ' + e, 'Unknown event: ' + e, 'events');
  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
  const w = await insert(c, 'webhooks', { company_id: ctx.companyId, url, events, secret_enc: secrets.encrypt(secret), status: 'active', created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'webhook', url);
  return { id: w.id, secret };
});
define('webhook.update', G.admin, async (ctx, i, c) => {
  const w = await core.lock(c, 'webhooks', V.uuid(i, 'id', { req: true }), 'webhook');
  const events = has(i, 'events') ? [...new Set(V.arr(i, 'events', { min: 1, max: 30 }).map(String))] : undefined;
  if (events) for (const e of events) if (!EVENTS.includes(e)) throw bad('event', 'حدث غير معروف: ' + e, 'Unknown event: ' + e, 'events');
  await update(c, 'webhooks', w.id, defined({ events, status: P(i, 'status', V.oneOf, ['active', 'disabled']) }));
  await core.audit(c, ctx, 'update', 'webhook', w.url);
});
define('webhook.delete', G.admin, async (ctx, i, c) => {
  const w = await core.lock(c, 'webhooks', V.uuid(i, 'id', { req: true }), 'webhook');
  await c.query('DELETE FROM webhook_deliveries WHERE webhook_id = $1', [w.id]);
  await c.query('DELETE FROM webhooks WHERE id = $1', [w.id]);
  await core.audit(c, ctx, 'delete', 'webhook', w.url);
});
define('webhook.test', G.admin, async (ctx, i, c) => {
  const w = await core.mustExist(c, 'webhooks', V.uuid(i, 'id', { req: true }), 'webhook');
  await c.query('INSERT INTO webhook_deliveries (company_id, webhook_id, event, payload) VALUES ($1,$2,$3,$4)', [ctx.companyId, w.id, 'ping', JSON.stringify({ id: crypto.randomUUID(), event: 'ping', companyId: ctx.companyId, occurredAt: new Date().toISOString(), data: { message: 'MOTUS webhook test' } })]);
});
define('webhook.retry', G.admin, async (ctx, i, c) => {
  const r = await c.query("UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = now() WHERE id = $1 AND status = 'failed' RETURNING id", [V.uuid(i, 'id', { req: true })]);
  if (!r.rowCount) throw notFound('failed delivery');
});

/* ---------- CSV / Excel import (all rows or nothing; every row error is reported) ---------- */
define('import.rows', G.fleet.concat(['operations', 'accountant', 'maintenance']), async (ctx, i, c) => {
  const entity = V.oneOf(i, 'entity', ['vehicles', 'drivers', 'clients', 'items', 'suppliers'], { req: true });
  const rows = V.arr(i, 'rows', { req: true, min: 1, max: 2000 });
  const roleOk = { vehicles: ['company_admin', 'fleet_manager', 'super_admin'], drivers: ['company_admin', 'fleet_manager', 'operations', 'super_admin'], clients: ['company_admin', 'fleet_manager', 'operations', 'accountant', 'super_admin'], items: ['company_admin', 'fleet_manager', 'maintenance', 'accountant', 'super_admin'], suppliers: ['company_admin', 'fleet_manager', 'maintenance', 'accountant', 'super_admin'] }[entity];
  if (!roleOk.includes(ctx.user.role)) throw forbidden();
  const action = { vehicles: 'vehicle.create', drivers: 'driver.create', clients: 'client.create', items: 'item.create', suppliers: 'supplier.create' }[entity];
  const { actions } = require('./registry');
  const def = actions.get(action);
  const errors = [];
  let ok = 0;
  for (let k = 0; k < rows.length; k++) {
    await c.query('SAVEPOINT r');
    try { await def.handler(ctx, rows[k], c); ok++; await c.query('RELEASE SAVEPOINT r'); }
    catch (e) { await c.query('ROLLBACK TO SAVEPOINT r'); const { fromPg } = require('../lib/errors'); const x = fromPg(e); errors.push({ row: k + 2, field: x.field || null, error: x.msg ? x.msg : { ar: x.message, en: x.message } }); }
  }
  if (errors.length) throw new AppError(400, 'import_failed', `لم يتم استيراد أي صف: ${errors.length} صف به أخطاء`, `Nothing was imported: ${errors.length} row(s) have errors`, { rows: errors.slice(0, 200) });
  await core.audit(c, ctx, 'import', entity, '', { field: 'rows', before: '', after: ok });
  return { imported: ok };
});

/* ---------- AI usage, history, feedback, price approvals ---------- */
define('ai.log', G.anyWriter.concat(['viewer']), async (ctx, i, c) => {
  const s = await core.settings(c, ctx);
  const feature = V.oneOf(i, 'feature', ['copilot', 'assignment', 'pricing', 'documents', 'insights', 'fuel', 'maintenance', 'inventory', 'reconciliation'], { req: true });
  if (!s.aiEnabled || (s.aiFeatures && s.aiFeatures[feature] === false)) throw new AppError(403, 'ai_disabled', 'الميزة مقفولة من إعدادات الذكاء الاصطناعي', 'This AI feature is turned off in AI settings');
  const month = core.today().slice(0, 7);
  const used = (await c.query('SELECT coalesce(sum(requests),0)::int n FROM ai_usage WHERE to_char(date, \'YYYY-MM\') = $1', [month])).rows[0].n;
  if (s.aiMonthlyLimit && used >= s.aiMonthlyLimit) throw new AppError(429, 'ai_limit', 'تم الوصول للحد الشهري لطلبات الذكاء الاصطناعي', 'The monthly AI request limit has been reached');
  await c.query('INSERT INTO ai_usage (company_id, date, feature, requests, tokens) VALUES ($1,$2,$3,1,$4) ON CONFLICT (company_id, date, feature) DO UPDATE SET requests = ai_usage.requests + 1, tokens = ai_usage.tokens + $4', [ctx.companyId, core.today(), feature, V.int(i, 'tokens', { min: 0, def: 0 })]);
  if (feature === 'copilot' && i.question) {
    let convId = V.uuid(i, 'conversationId');
    if (convId) { const cv = (await c.query('SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2', [convId, ctx.user.id])).rows[0]; if (!cv) convId = null; }
    if (!convId) convId = (await insert(c, 'ai_conversations', { company_id: ctx.companyId, user_id: ctx.user.id, title: V.str(i, 'question', { max: 120 }) })).id;
    await insert(c, 'ai_messages', { company_id: ctx.companyId, conversation_id: convId, role: 'user', content: JSON.stringify({ text: V.str(i, 'question', { max: 2000 }) }) });
    const m = await insert(c, 'ai_messages', { company_id: ctx.companyId, conversation_id: convId, role: 'assistant', content: JSON.stringify({ text: V.str(i, 'answer', { max: 8000, def: '' }), sources: V.arr(i, 'sources', { max: 20 }).map(String), label: V.oneOf(i, 'label', ['verified', 'estimate', 'rules'], { def: 'rules' }) }) });
    return { conversationId: convId, messageId: m.id, used: used + 1, limit: s.aiMonthlyLimit };
  }
  return { used: used + 1, limit: s.aiMonthlyLimit };
}, { noTouch: true });
define('ai.feedback', G.anyWriter.concat(['viewer']), async (ctx, i, c) => {
  await insert(c, 'ai_feedback', { company_id: ctx.companyId, user_id: ctx.user.id, message_id: V.uuid(i, 'messageId'), rating: V.int(i, 'rating', { req: true, min: -1, max: 1 }) || 1, comment: V.str(i, 'comment', { max: 500, def: '' }) });
});
define('price.approve', G.opsFin, async (ctx, i, c) => {
  const suggested = V.num(i, 'suggested', { req: true, min: 0 }), approved = V.num(i, 'approved', { req: true, min: 0 });
  const reason = V.str(i, 'reason', { max: 300, def: '' });
  if (Math.abs(approved - suggested) > suggested * 0.05 && !reason) throw bad('reason', 'اكتب سبب تعديل السعر المقترح', 'Give a reason for changing the suggested price', 'reason');
  await core.audit(c, ctx, approved === suggested ? 'approve' : 'override', 'price_quote', V.str(i, 'ref', { max: 80, def: '' }), { field: 'price', before: suggested, after: approved + (reason ? ' — ' + reason : '') });
});

module.exports = { COMPANY_ROLES, SCOPES, EVENTS };
