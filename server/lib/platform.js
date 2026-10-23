'use strict';
/* Platform-level operations: creating companies (with their starting reference data and first
   company admin), suspending companies, and the super-admin overview. */
const db = require('./db');
const auth = require('./auth');
const core = require('./core');
const V = require('./validate');
const D = require('./defaults');
const activities = require('./activities');
const { bad, conflict, notFound, fromPg } = require('./errors');

async function seedCompany(c, companyId, opts) {
  const ins = (sql, p) => c.query(sql, p);
  await ins('INSERT INTO company_settings (company_id, data) VALUES ($1, $2)', [companyId, JSON.stringify({ goLive: core.today() })]);
  for (const t of D.VEHICLE_TYPES) {
    await ins(`INSERT INTO vehicle_types (company_id, code, name_ar, name_en, seats, fuel, oil_km, life_years, life_km, salvage_pct, tank_l, kmpl, price_min, price_max, rate_km, base_price, toll_gate, oil_cost, oil_liters, insurance, license, tire_positions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [companyId, t.code, t.ar, t.en, t.seats, t.fuel, t.oilKm, t.lifeYears, t.lifeKm, t.salvagePct, t.tank, t.kmpl, t.priceMin, t.priceMax, t.rateKm, t.base, t.tollGate, t.oilCost, t.oilLiters, t.insurance, t.license, t.tires]);
  }
  if (opts.referencePlaces !== false) {
    for (const [code, ar, en, lat, lng, kind, radius] of D.PLACES) await ins('INSERT INTO places (company_id, code, name_ar, name_en, kind, lat, lng, radius_m) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [companyId, code, ar, en, kind, lat, lng, radius]);
    for (const [base, from, to, km, type, gates, hours] of D.ROUTES) await ins('INSERT INTO routes (company_id, base_city, from_code, to_code, km, type, toll_gates, hours) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [companyId, base, from, to, km, type, gates, hours]);
  }
  for (const [key, ar, en, code] of D.COA) await ins('INSERT INTO coa (company_id, key, name_ar, name_en, code, erp_code) VALUES ($1,$2,$3,$4,$5,$5)', [companyId, key, ar, en, code]);
  const branches = opts.branches && opts.branches.length ? opts.branches : [{ code: 'HQ', city: 'CAI', ar: 'الفرع الرئيسي', en: 'Head office' }];
  let first = null;
  for (const b of branches) {
    const r = await ins('INSERT INTO branches (company_id, code, city, name_ar, name_en) VALUES ($1,$2,$3,$4,$5) RETURNING id', [companyId, b.code, b.city, b.ar, b.en || b.ar]);
    if (!first) first = r.rows[0].id;
  }
  await ins("INSERT INTO warehouses (company_id, code, name_ar, name_en, branch_id, type) VALUES ($1,'WH-1','المخزن الرئيسي','Main warehouse',$2,'main')", [companyId, first]);
  return first;
}

/* input: { code, name: {ar,en}, taxNo, currency, activities: ['tourism', ...], branches?, admin: { email, name, password? } }
   activities: one or more of activities.CODES. Left out (older callers, console tools) = ['tourism']. */
async function createCompany(actor, input) {
  const code = V.str(input, 'code', { req: true, max: 8, re: /^[A-Z0-9]{2,8}$/ });
  const name = V.text2(input, 'name', { req: true, max: 160 });
  const admin = input.admin || {};
  const email = V.email(admin, 'email', { req: true });
  const adminName = V.text2(admin, 'name', { req: true, max: 120 });
  let password = admin.password ? String(admin.password) : null;
  if (password) auth.checkPolicy(password, email);
  const temporary = !password;
  if (!password) password = auth.randomPassword(16);
  const hash = await auth.hashPassword(password);
  const acts = activities.parseList(input, 'activities', { required: false }) || ['tourism'];
  const branches = V.arr(input, 'branches', { max: 20 }).map(b => ({ code: V.str(b, 'code', { req: true, max: 12, re: /^[A-Z0-9-]+$/ }), city: V.str(b, 'city', { req: true, max: 12 }), ar: V.str(b, 'nameAr', { req: true, max: 120 }), en: V.str(b, 'nameEn', { max: 120 }) }));
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM companies WHERE code = $1', [code])).rowCount) throw conflict('code_taken', 'كود الشركة مستخدم', 'That company code is already in use');
    if ((await client.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount) throw conflict('email_taken', 'البريد الإلكتروني مستخدم بالفعل', 'That email address is already in use');
    const co = (await client.query('INSERT INTO companies (code, name_ar, name_en, tax_no, currency) VALUES ($1,$2,$3,$4,$5) RETURNING id', [code, name.ar, name.en, V.str(input, 'taxNo', { max: 30, def: '' }), V.oneOf(input, 'currency', ['EGP', 'USD', 'EUR', 'SAR'], { def: 'EGP' })])).rows[0];
    await client.query("SELECT set_config('app.company_id', $1, true)", [co.id]);
    const branchId = await seedCompany(client, co.id, { branches, referencePlaces: input.referencePlaces !== false });
    await activities.apply(client, co.id, acts, actor ? actor.name : 'setup');
    const u = (await client.query(`INSERT INTO users (company_id, email, name_ar, name_en, title_ar, title_en, role, branch_id, password_hash, must_change_password)
      VALUES ($1,$2,$3,$4,'مدير النظام','Company admin','company_admin',$5,$6,$7) RETURNING id`, [co.id, email, adminName.ar, adminName.en, branchId, hash, temporary])).rows[0];
    await client.query("INSERT INTO platform_audit (user_id, actor, action, entity, record_ref, detail) VALUES ($1,$2,'create','company',$3,$4)", [actor ? actor.id : null, actor ? actor.name : 'setup', code, JSON.stringify({ admin: email, activities: acts })]);
    await client.query('COMMIT');
    return { id: co.id, code, activities: acts, adminId: u.id, adminEmail: email, temporaryPassword: temporary ? password : null };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw fromPg(e);
  } finally { client.release(); }
}

async function setCompanyStatus(actor, id, status) {
  if (!V.UUID.test(String(id))) throw notFound('company');
  if (!['active', 'suspended'].includes(status)) throw bad('status', 'حالة غير صحيحة', 'Invalid status');
  return db.platform(async c => {
    const r = await c.query('UPDATE companies SET status = $1, updated_at = now() WHERE id = $2 RETURNING code', [status, id]);
    if (!r.rowCount) throw notFound('company');
    if (status === 'suspended') await c.query('DELETE FROM sessions WHERE company_id = $1 OR user_id IN (SELECT id FROM users WHERE company_id = $1)', [id]);
    await c.query("INSERT INTO platform_audit (user_id, actor, action, entity, record_ref, detail) VALUES ($1,$2,'update','company',$3,$4)", [actor.id, actor.name, r.rows[0].code, JSON.stringify({ status })]);
  });
}

/* super admin (Sabeel team) changes a company's activities after talking to the customer */
async function setActivities(actor, id, input) {
  if (!V.UUID.test(String(id))) throw notFound('company');
  const list = activities.parseList(input, 'activities');
  const code = await db.platform(async c => { const r = await c.query('SELECT code FROM companies WHERE id = $1', [id]); if (!r.rowCount) throw notFound('company'); return r.rows[0].code; });
  const change = await db.tx(id, async c => {
    const ch = await activities.apply(c, id, list, actor.name);
    if (ch.enabled.length || ch.disabled.length) await c.query('UPDATE company_settings SET data_version = data_version + 1, updated_at = now() WHERE company_id = $1', [id]);
    return ch;
  });
  if (change.enabled.length || change.disabled.length) {
    await db.platform(c => c.query("INSERT INTO platform_audit (user_id, actor, action, entity, record_ref, detail) VALUES ($1,$2,'update','company_activities',$3,$4)", [actor.id, actor.name, code, JSON.stringify({ activities: list, enabled: change.enabled, disabled: change.disabled })]));
  }
  return { activities: list, enabled: change.enabled, disabled: change.disabled };
}

async function listCompanies() {
  return db.platform(async c => {
    const cos = (await c.query('SELECT id, code, name_ar, name_en, status, created_at FROM companies ORDER BY code')).rows;
    const counts = Object.fromEntries((await c.query('SELECT * FROM company_counts()')).rows.map(r => [r.company_id, r]));
    const acts = {};
    (await c.query('SELECT * FROM company_activity_list()')).rows.forEach(r => { (acts[r.company_id] = acts[r.company_id] || []).push(r.activity); });
    return cos.map(x => ({ id: x.id, code: x.code, name: { ar: x.name_ar, en: x.name_en || x.name_ar }, status: x.status, createdAt: core.fmtTs(x.created_at).slice(0, 10), vehicles: (counts[x.id] || {}).vehicles || 0, drivers: (counts[x.id] || {}).drivers || 0, users: (counts[x.id] || {}).users || 0, bookings: (counts[x.id] || {}).bookings || 0, activities: activities.CODES.filter(a => (acts[x.id] || []).includes(a)) }));
  });
}

/* first super admin — only from the server console (tools/create-admin.js) */
async function createSuperAdmin(email, name, password) {
  auth.checkPolicy(password, email);
  const hash = await auth.hashPassword(password);
  return db.platform(async c => {
    if ((await c.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount) throw conflict('email_taken', 'البريد الإلكتروني مستخدم بالفعل', 'That email address is already in use');
    const u = (await c.query("INSERT INTO users (company_id, email, name_ar, name_en, title_ar, title_en, role, password_hash, must_change_password) VALUES (NULL,$1,$2,$2,'مسؤول المنصة','Platform admin','super_admin',$3,false) RETURNING id", [email, name, hash])).rows[0];
    await c.query("INSERT INTO platform_audit (user_id, actor, action, entity, record_ref) VALUES ($1,'console','create','super_admin',$2)", [u.id, email]);
    return u.id;
  });
}

module.exports = { createCompany, setCompanyStatus, setActivities, listCompanies, createSuperAdmin, seedCompany };
