'use strict';
/* Shared building blocks for services: dates in the company time zone, document numbers,
   audit rows, webhook events, journal posting, expenses and stock movements.
   Every function receives the transaction client `c` whose app.company_id is already set. */
const crypto = require('crypto');
const { bad, conflict, notFound } = require('./errors');
const { round2 } = require('./validate');

let TZ = 'Africa/Cairo';
const setTimezone = tz => { TZ = tz; };
/* the company's time zone for the current request (set by withTz), else the server default */
const { AsyncLocalStorage } = require('async_hooks');
const tzStore = new AsyncLocalStorage();
const tz = () => { const s = tzStore.getStore(); return (s && s.tz) || TZ; };
const withTz = (zone, fn) => tzStore.run({ tz: zone || TZ }, fn);
/* the rest of the current request runs in this zone (used after authenticating an API key) */
const enterTz = zone => tzStore.enterWith({ tz: zone || TZ });
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function nowLocal() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return p.replace(/^24/, '00');
}
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const fmtTs = d => {
  if (!d) return null;
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return s.replace(',', '').replace(' 24:', ' 00:');
};

/* ---------- company info cached per transaction ---------- */
async function company(c, ctx) {
  if (ctx._company) return ctx._company;
  const r = await c.query('SELECT id, code, name_ar, name_en, currency, country, timezone FROM companies WHERE id = $1', [ctx.companyId]);
  if (!r.rows[0]) throw notFound('company');
  ctx._company = r.rows[0];
  return ctx._company;
}
async function settings(c, ctx) {
  if (ctx._settings) return ctx._settings;
  const r = await c.query('SELECT data, closed_through FROM company_settings WHERE company_id = $1', [ctx.companyId]);
  const s = Object.assign({}, DEFAULT_SETTINGS, r.rows[0] ? r.rows[0].data : {});
  s.closedThrough = r.rows[0] ? r.rows[0].closed_through : null;
  ctx._settings = s;
  return s;
}
const DEFAULT_SETTINGS = {
  currency: 'EGP', vatRate: 0.14, fuelDeviation: 0.15, oilWarnKm: 500, maintWarnDays: 7, expiryWarnDays: 30,
  lifeWarnPct: 0.9, maintCostPct: 0.2, overspeed: 100, maxDriveHours: 10, minRestHours: 8,
  fuelPrices: { diesel: 17.5, gasoline: 19.25 }, laborRate: 180, defaultTerms: 30, usdRate: 48.5,
  aiEnabled: true, aiMonthlyLimit: 5000, aiApproval: true, aiFeatures: { copilot: true, assignment: true, pricing: true, documents: true, insights: true, fuel: true, maintenance: true, inventory: true, reconciliation: true },
  priceMargin: 0.25, goLive: null, workHours: '05:00-23:00',
};

/* ---------- numbering: PREFIX-COMPANYCODE-YEAR-00001, gap-free per company & year ---------- */
async function nextNumber(c, ctx, prefix, dateStr) {
  const co = await company(c, ctx);
  const year = parseInt((dateStr || today()).slice(0, 4), 10);
  const r = await c.query(
    `INSERT INTO doc_sequences (company_id, prefix, year, last) VALUES ($1, $2, $3, 1)
     ON CONFLICT (company_id, prefix, year) DO UPDATE SET last = doc_sequences.last + 1 RETURNING last`,
    [ctx.companyId, prefix, year]);
  return `${prefix}-${co.code}-${year}-${String(r.rows[0].last).padStart(5, '0')}`;
}

/* ---------- audit ---------- */
async function audit(c, ctx, action, entity, recordRef, change) {
  await c.query(
    'INSERT INTO audit_log (company_id, user_id, actor, action, entity, record_ref, source, change) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [ctx.companyId, ctx.user && ctx.user.id && !ctx.user.apiKey ? ctx.user.id : null, ctx.user ? ctx.user.name || '' : 'system', action, entity, String(recordRef || ''), ctx.source || 'ui', change ? JSON.stringify(change) : null]);
}

/* ---------- outbound webhook events (queued in the same transaction) ---------- */
async function emit(c, ctx, event, data) {
  const hooks = await c.query("SELECT id FROM webhooks WHERE status = 'active' AND $1 = ANY(events)", [event]);
  if (!hooks.rows.length) return;
  const payload = { id: crypto.randomUUID(), event, companyId: ctx.companyId, occurredAt: new Date().toISOString(), data };
  for (const h of hooks.rows) {
    await c.query('INSERT INTO webhook_deliveries (company_id, webhook_id, event, payload) VALUES ($1,$2,$3,$4)', [ctx.companyId, h.id, event, JSON.stringify(payload)]);
  }
}

/* bump the per-company data version so open browsers know to reload */
async function touch(c, ctx) {
  await c.query('UPDATE company_settings SET data_version = data_version + 1, updated_at = now() WHERE company_id = $1', [ctx.companyId]);
}

/* ---------- journal ---------- */
async function accounts(c, ctx) {
  if (ctx._coa) return ctx._coa;
  const r = await c.query('SELECT key, code FROM coa');
  ctx._coa = Object.fromEntries(r.rows.map(x => [x.key, x.code]));
  return ctx._coa;
}
/* lines: [{a: accountKey, debit, credit, cc}] — amounts rounded to 2dp; tiny rounding
   differences (< 0.05) are absorbed by the last line so the entry always balances. */
async function post(c, ctx, { date, sourceType, sourceRef, desc, lines }) {
  const coa = await accounts(c, ctx);
  const clean = lines.map(l => ({ a: l.a, cc: l.cc || null, debit: round2(Math.max(0, l.debit || 0)), credit: round2(Math.max(0, l.credit || 0)) })).filter(l => l.debit > 0 || l.credit > 0);
  if (!clean.length) return null;
  const dr = round2(clean.reduce((s, l) => s + l.debit, 0)), cr = round2(clean.reduce((s, l) => s + l.credit, 0));
  const diff = round2(dr - cr);
  if (Math.abs(diff) >= 0.05) throw new Error(`unbalanced journal ${sourceType}:${sourceRef} (${dr} vs ${cr})`);
  if (diff !== 0) { const last = clean[clean.length - 1]; if (last.credit > 0) last.credit = round2(last.credit + diff); else last.debit = round2(last.debit - diff); }
  for (const l of clean) if (!coa[l.a]) throw bad('coa_missing', `الحساب "${l.a}" غير موجود في دليل الحسابات`, `Account "${l.a}" is missing from the chart of accounts mapping`);
  const s = await settings(c, ctx);
  if (s.closedThrough && date.slice(0, 7) <= s.closedThrough) throw bad('period_closed', `الفترة ${date.slice(0, 7)} مقفلة محاسبياً. استخدم تاريخ في فترة مفتوحة.`, `Accounting period ${date.slice(0, 7)} is closed. Use a date in an open period.`);
  const number = await nextNumber(c, ctx, 'JE', date);
  const e = await c.query(
    `INSERT INTO journal_entries (company_id, number, date, source_type, source_ref, description_ar, description_en, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'posted',$8) RETURNING id`,
    [ctx.companyId, number, date, sourceType, sourceRef, desc.ar, desc.en, ctx.user ? ctx.user.name : 'system']);
  let i = 0;
  for (const l of clean) {
    await c.query('INSERT INTO journal_lines (company_id, entry_id, line_no, account_key, account, cost_center, debit, credit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [ctx.companyId, e.rows[0].id, ++i, l.a, coa[l.a], l.cc, l.debit, l.credit]);
  }
  await emit(c, ctx, 'journal.posted', { number, date, sourceType, sourceRef, lines: clean.map(l => ({ account: coa[l.a], accountKey: l.a, costCenter: l.cc, debit: l.debit, credit: l.credit })) });
  return { id: e.rows[0].id, number };
}

const EXP_ACCOUNT = { fuel: 'exp_fuel', oil: 'exp_oil', maintenance: 'exp_maint', tolls: 'exp_tolls', parking: 'exp_parking', lodging: 'exp_lodging', salaries: 'exp_salaries', insurance: 'exp_insurance', license: 'exp_license', subcontract: 'exp_subcontract', other: 'exp_other' };
const CREDIT_ACCOUNT = { cash: 'cash_main', bank: 'bank_main', payable: 'payables', prepaid_card: 'prepaid_fuel', prepaid_tag: 'prepaid_toll', inventory: 'inventory', mixed: 'payables' };

async function vehicleCode(c, id) { if (!id) return null; const r = await c.query('SELECT code FROM vehicles WHERE id = $1', [id]); return r.rows[0] ? r.rows[0].code : null; }

/* An expense row (feeds P&L and reports) + its journal entry. */
async function expense(c, ctx, e) {
  const amount = round2(e.amount), tax = round2(e.tax || 0);
  if (!(amount >= 0)) throw bad('amount', 'المبلغ غير صحيح', 'Invalid amount');
  const r = await c.query(
    `INSERT INTO expenses (company_id, date, category, amount, tax, vehicle_id, trip_id, program_id, driver_id, supplier, method, source_type, source_id, note_ar, note_en, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [ctx.companyId, e.date, e.category, amount, tax, e.vehicleId || null, e.tripId || null, e.programId || null, e.driverId || null, e.supplier || '', e.method || 'cash', e.sourceType || 'manual', e.sourceId || null, e.note ? e.note.ar : null, e.note ? e.note.en : null, ctx.user ? ctx.user.name : 'system']);
  if (e.journal !== false && amount + tax > 0) {
    const cc = await vehicleCode(c, e.vehicleId);
    const lines = [{ a: EXP_ACCOUNT[e.category] || 'exp_other', debit: amount, cc }];
    if (tax) lines.push({ a: 'vat_in', debit: tax });
    if (e.creditLines) lines.push(...e.creditLines);
    else lines.push({ a: CREDIT_ACCOUNT[e.method] || 'cash_main', credit: amount + tax });
    await post(c, ctx, { date: e.date, sourceType: 'expense', sourceRef: `${e.sourceType || 'manual'}:${(e.sourceRef || r.rows[0].id).toString().slice(0, 40)}`, desc: e.desc || { ar: 'مصروف ' + e.category, en: 'Expense ' + e.category }, lines });
  }
  return r.rows[0].id;
}

/* ---------- inventory: weighted average, no negative stock, immutable movements ---------- */
async function stockMove(c, ctx, m) {
  const qty = Number(m.qty);
  if (!qty) throw bad('qty', 'الكمية لازم تكون أكبر من صفر', 'Quantity must not be zero');
  await c.query('INSERT INTO stock_balances (company_id, warehouse_id, item_id, qty, value) VALUES ($1,$2,$3,0,0) ON CONFLICT (company_id, warehouse_id, item_id) DO NOTHING', [ctx.companyId, m.warehouseId, m.itemId]);
  const bal = (await c.query('SELECT id, qty, value FROM stock_balances WHERE warehouse_id = $1 AND item_id = $2 FOR UPDATE', [m.warehouseId, m.itemId])).rows[0];
  const it = (await c.query('SELECT id, code, name_ar, name_en, unit, avg_cost FROM items WHERE id = $1 FOR UPDATE', [m.itemId])).rows[0];
  if (!it) throw notFound('item');
  let unit, value;
  if (qty > 0) {
    unit = m.unitCost != null ? Number(m.unitCost) : (bal.qty > 0 ? bal.value / bal.qty : Number(it.avg_cost));
    value = round2(qty * unit);
  } else {
    if (bal.qty + qty < -1e-9) throw conflict('negative_stock', `الرصيد غير كافٍ: ${it.name_ar} (المتاح ${round2(bal.qty)} ${it.unit})`, `Not enough stock: ${it.name_en} (available ${round2(bal.qty)} ${it.unit})`);
    unit = bal.qty > 0 ? bal.value / bal.qty : Number(it.avg_cost);
    value = Math.abs(qty + bal.qty) < 1e-9 ? -round2(bal.value) : round2(qty * unit);
  }
  const newQty = round2(bal.qty + qty * 1), newVal = Math.max(0, round2(bal.value + value));
  await c.query('UPDATE stock_balances SET qty = $1, value = $2 WHERE id = $3', [Math.round((bal.qty + qty) * 1000) / 1000, newQty <= 0 ? 0 : newVal, bal.id]);
  const tot = (await c.query('SELECT coalesce(sum(qty),0) q, coalesce(sum(value),0) v FROM stock_balances WHERE item_id = $1', [m.itemId])).rows[0];
  const sets = ['avg_cost = $1'];
  const params = [tot.q > 0 ? tot.v / tot.q : (qty > 0 ? unit : it.avg_cost), m.itemId];
  if (m.type === 'receipt' && m.unitCost != null) { sets.push('last_price = $3'); params.push(m.unitCost); }
  await c.query(`UPDATE items SET ${sets.join(', ')} WHERE id = $2`, params);
  const number = await nextNumber(c, ctx, 'MV', m.date);
  await c.query(
    `INSERT INTO stock_movements (company_id, number, type, date, item_id, warehouse_id, qty, unit_cost, value, ref_ar, ref_en, work_order_id, po_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [ctx.companyId, number, m.type, m.date, m.itemId, m.warehouseId, qty, Math.round(unit * 10000) / 10000, value, (m.ref && m.ref.ar) || '', (m.ref && m.ref.en) || '', m.workOrderId || null, m.poId || null, ctx.user ? ctx.user.name : 'system']);
  return { qty, unitCost: unit, value, item: it };
}

async function mustExist(c, table, id, what) {
  if (!id) throw notFound(what || table);
  const r = await c.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!r.rows[0]) throw notFound(what || table);
  return r.rows[0];
}
async function lock(c, table, id, what) {
  if (!id) throw notFound(what || table);
  const r = await c.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  if (!r.rows[0]) throw notFound(what || table);
  return r.rows[0];
}

module.exports = { today, nowLocal, addDays, diffDays, fmtTs, setTimezone, withTz, enterTz, tz, company, settings, DEFAULT_SETTINGS, nextNumber, audit, emit, touch, post, expense, stockMove, mustExist, lock, accounts, vehicleCode, EXP_ACCOUNT, CREDIT_ACCOUNT };
