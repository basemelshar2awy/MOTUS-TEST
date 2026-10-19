'use strict';
/* Service-provider integrations: fuel cards, toll tags, oil/maintenance service apps.
   Connections store credentials encrypted (AES-256-GCM). Transactions arrive by CSV import,
   the Open API or a signed provider webhook and are auto-matched; the rest wait in the
   reconciliation queue for a human. */
const crypto = require('crypto');
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const secrets = require('../lib/secrets');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound } = require('../lib/errors');
const fleet = require('./fleet');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const P = (o, f, fn, ...a) => (has(o, f) ? fn(o, f, ...a) : undefined);
const round2 = V.round2;
const KINDS = ['fuel', 'toll', 'service', 'gps', 'erp', 'messaging', 'flight'];

define('provider.create', G.providers, async (ctx, i, c) => {
  const name = V.text2(i, 'name', { req: true, max: 120 });
  const kind = V.oneOf(i, 'kind', KINDS, { req: true });
  const code = V.str(i, 'code', { max: 20, re: /^[A-Z0-9_-]+$/ }) || (kind.toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase());
  const p = await insert(c, 'providers', { company_id: ctx.companyId, code, kind, name_ar: name.ar, name_en: name.en, status: 'not_connected', mode: V.oneOf(i, 'mode', ['api', 'csv', 'webhook'], { def: 'csv' }), schedule: V.str(i, 'schedule', { max: 20, def: 'manual' }), endpoint_url: V.str(i, 'endpointUrl', { max: 300, def: '', re: /^(https?:\/\/.+)?$/ }), created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'provider', code);
  return { id: p.id, code };
});

/* connect = save credentials (encrypted) and issue a webhook signing secret (shown once) */
define('provider.connect', G.providers, async (ctx, i, c) => {
  const p = await core.lock(c, 'providers', V.uuid(i, 'id', { req: true }), 'provider');
  const creds = i.credentials && typeof i.credentials === 'object' ? i.credentials : {};
  const clean = {};
  for (const [k, v] of Object.entries(creds).slice(0, 10)) { if (!/^[a-zA-Z0-9_]{1,40}$/.test(k)) continue; clean[k] = String(v).slice(0, 500); }
  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
  await c.query("UPDATE providers SET credentials_enc = $1, webhook_secret_enc = $2, status = 'connected', mode = coalesce($3, mode), endpoint_url = coalesce($4, endpoint_url), schedule = coalesce($5, schedule), error_ar = NULL, error_en = NULL WHERE id = $6",
    [Object.keys(clean).length ? secrets.encrypt(JSON.stringify(clean)) : null, secrets.encrypt(secret), V.oneOf(i, 'mode', ['api', 'csv', 'webhook']), V.str(i, 'endpointUrl', { max: 300, re: /^https?:\/\/.+$/ }), V.str(i, 'schedule', { max: 20 }), p.id]);
  await core.audit(c, ctx, 'update', 'provider', p.code, { field: 'status', before: p.status, after: 'connected' });
  return { webhookSecret: secret, webhookPath: `/api/webhooks/providers/${p.id}` };
});
define('provider.disconnect', G.providers, async (ctx, i, c) => {
  const p = await core.lock(c, 'providers', V.uuid(i, 'id', { req: true }), 'provider');
  await c.query("UPDATE providers SET credentials_enc = NULL, webhook_secret_enc = NULL, status = 'not_connected' WHERE id = $1", [p.id]);
  await core.audit(c, ctx, 'update', 'provider', p.code, { field: 'status', before: p.status, after: 'not_connected' });
});

define('fuelCard.create', G.providers, async (ctx, i, c) => {
  const providerId = V.uuid(i, 'providerId', { req: true }); const pr = await core.mustExist(c, 'providers', providerId, 'provider');
  if (pr.kind !== 'fuel') throw bad('provider', 'المزود ليس مزود وقود', 'That provider is not a fuel provider', 'providerId');
  const vehicleId = V.uuid(i, 'vehicleId'); if (vehicleId) await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const card = await insert(c, 'fuel_cards', { company_id: ctx.companyId, number: V.str(i, 'number', { req: true, max: 30 }), provider_id: providerId, vehicle_id: vehicleId, driver_id: V.uuid(i, 'driverId'), daily_liters: V.num(i, 'dailyLiters', { min: 0, def: 0 }), monthly_amount: V.num(i, 'monthlyAmount', { min: 0, def: 0 }), fuel_type: V.oneOf(i, 'fuelType', ['diesel', 'gasoline'], { def: 'diesel' }), hours: V.str(i, 'hours', { max: 20, def: '00:00–23:59' }), balance: 0, status: 'active', created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'fuel_card', card.number);
  return { id: card.id };
});
define('fuelCard.update', G.providers, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const card = await core.lock(c, 'fuel_cards', id, 'fuel card');
  await update(c, 'fuel_cards', id, defined({ vehicle_id: P(i, 'vehicleId', V.uuid), driver_id: P(i, 'driverId', V.uuid), daily_liters: P(i, 'dailyLiters', V.num, { min: 0 }), monthly_amount: P(i, 'monthlyAmount', V.num, { min: 0 }), hours: P(i, 'hours', V.str, { max: 20 }), status: P(i, 'status', V.oneOf, ['active', 'blocked']) }));
  await core.audit(c, ctx, 'update', 'fuel_card', card.number);
});
define('tollTag.create', G.providers, async (ctx, i, c) => {
  const providerId = V.uuid(i, 'providerId', { req: true }); const pr = await core.mustExist(c, 'providers', providerId, 'provider');
  if (pr.kind !== 'toll') throw bad('provider', 'المزود ليس مزود كارتة', 'That provider is not a toll provider', 'providerId');
  const vehicleId = V.uuid(i, 'vehicleId', { req: true }); await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const t = await insert(c, 'toll_tags', { company_id: ctx.companyId, tag: V.str(i, 'tag', { req: true, max: 30 }), provider_id: providerId, vehicle_id: vehicleId, balance: 0, low_threshold: V.num(i, 'lowThreshold', { min: 0, def: 300 }), status: 'active', created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'toll_tag', t.tag);
  return { id: t.id };
});
define('tollTag.update', G.providers, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const t = await core.lock(c, 'toll_tags', id, 'toll tag');
  await update(c, 'toll_tags', id, defined({ vehicle_id: P(i, 'vehicleId', V.uuid), low_threshold: P(i, 'lowThreshold', V.num, { min: 0 }), status: P(i, 'status', V.oneOf, ['active', 'blocked']) }));
  await core.audit(c, ctx, 'update', 'toll_tag', t.tag);
});

/* top up a fuel card or toll tag: Dr prepaid, Cr bank */
define('balance.topup', G.providers, async (ctx, i, c) => {
  const kind = V.oneOf(i, 'kind', ['card', 'tag'], { req: true });
  const id = V.uuid(i, 'id', { req: true }); const amount = V.num(i, 'amount', { req: true, gt: 0 });
  const account = V.str(i, 'account', { def: 'bank_main', max: 40, re: /^(bank|cash)_[a-z0-9_]+$/ });
  const row = await core.lock(c, kind === 'card' ? 'fuel_cards' : 'toll_tags', id, kind === 'card' ? 'fuel card' : 'toll tag');
  await c.query(`UPDATE ${kind === 'card' ? 'fuel_cards' : 'toll_tags'} SET balance = balance + $1 WHERE id = $2`, [amount, id]);
  const ref = kind === 'card' ? row.number : row.tag;
  await core.post(c, ctx, { date: V.date(i, 'date', { def: core.today() }), sourceType: 'topup', sourceRef: ref, desc: { ar: 'شحن رصيد ' + ref, en: 'Top-up ' + ref }, lines: [{ a: kind === 'card' ? 'prepaid_fuel' : 'prepaid_toll', debit: amount }, { a: account, credit: amount }] });
  await core.audit(c, ctx, 'update', kind === 'card' ? 'fuel_card' : 'toll_tag', ref, { field: 'balance', before: row.balance, after: round2(Number(row.balance) + amount) });
});

/* ---------- provider transactions ---------- */
async function autoMatch(c, ctx, tx) {
  if (!tx.vehicle_id) return null;
  if (tx.kind === 'fuel') {
    const f = (await c.query(`SELECT f.id FROM fuel_records f WHERE f.vehicle_id = $1 AND f.date = $2 AND abs(f.liters - coalesce($3, f.liters)) <= greatest(0.5, f.liters * 0.02)
      AND NOT EXISTS (SELECT 1 FROM provider_tx p WHERE p.matched_type = 'fuel' AND p.matched_id = f.id) LIMIT 1`, [tx.vehicle_id, tx.date, tx.liters])).rows[0];
    return f ? { type: 'fuel', id: f.id } : null;
  }
  if (tx.kind === 'toll') {
    const t = (await c.query("SELECT id FROM trips WHERE vehicle_id = $1 AND date = $2 AND status IN ('running','completed') ORDER BY start_time LIMIT 1", [tx.vehicle_id, tx.date])).rows[0];
    return t ? { type: 'trip', id: t.id } : null;
  }
  return null;
}
async function postTollCharge(c, ctx, tx, tripId) {
  const trip = tripId ? await core.mustExist(c, 'trips', tripId) : null;
  const tag = (await c.query('SELECT id FROM toll_tags WHERE tag = $1 FOR UPDATE', [tx.card_or_tag])).rows[0];
  if (tag) await c.query('UPDATE toll_tags SET balance = balance - $1 WHERE id = $2', [tx.amount, tag.id]);
  if (trip) await c.query('UPDATE trips SET exp_tolls = exp_tolls + $1 WHERE id = $2', [tx.amount, trip.id]);
  await core.expense(c, ctx, { date: tx.date, category: 'tolls', amount: tx.amount, vehicleId: tx.vehicle_id, tripId: trip ? trip.id : null, programId: trip ? trip.program_id : null, method: 'prepaid_tag', supplier: 'toll', sourceType: 'provider_tx', sourceId: tx.id, sourceRef: tx.ext_id, desc: { ar: 'كارتة ' + tx.ext_id, en: 'Toll ' + tx.ext_id } });
}

async function importTx(ctx, c, providerId, rows) {
  const pr = await core.mustExist(c, 'providers', providerId, 'provider');
  if (!['fuel', 'toll', 'service'].includes(pr.kind)) throw bad('provider', 'هذا المزود لا يرسل معاملات', 'This provider does not send transactions');
  if (!Array.isArray(rows) || !rows.length) throw bad('rows', 'لا توجد معاملات', 'No transactions were sent', 'rows');
  if (rows.length > 5000) throw bad('rows', 'أقصى عدد 5000 معاملة', 'At most 5,000 transactions per import', 'rows');
  const cards = (await c.query('SELECT number, vehicle_id, hours FROM fuel_cards')).rows, tags = (await c.query('SELECT tag, vehicle_id FROM toll_tags')).rows;
  let inserted = 0, duplicates = 0, matched = 0; const errors = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    try {
      const extId = V.str(r, 'extId', { req: true, max: 60 });
      const date = V.date(r, 'date', { req: true });
      const time = V.time(r, 'time', { def: '00:00' });
      const amount = V.num(r, 'amount', { req: true, min: 0 });
      const ref = V.str(r, 'cardOrTag', { max: 40, def: '' });
      const holder = pr.kind === 'fuel' ? cards.find(x => x.number.replace(/\s/g, '') === ref.replace(/\s/g, '')) : tags.find(x => x.tag === ref);
      let vehicleId = holder ? holder.vehicle_id : null;
      if (!vehicleId && r.plate) { const v = (await c.query('SELECT id FROM vehicles WHERE plate_ar = $1 OR plate_en = $1 OR code = $1', [String(r.plate)])).rows[0]; vehicleId = v ? v.id : null; }
      let flag = holder ? null : 'unknown_card';
      if (pr.kind === 'fuel' && holder && holder.hours && /\d\d:\d\d.\d\d:\d\d/.test(holder.hours)) { const [a, b] = [holder.hours.slice(0, 5), holder.hours.slice(-5)]; if (time < a || time > b) flag = 'outside_hours'; }
      const loc = V.text2(r, 'location', { max: 160 });
      const ins = await c.query(`INSERT INTO provider_tx (company_id, provider_id, kind, date, time, ext_id, card_or_tag, vehicle_id, amount, liters, location_ar, location_en, status, flag)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'unmatched',$13) ON CONFLICT (company_id, provider_id, ext_id) DO NOTHING RETURNING *`,
      [ctx.companyId, pr.id, pr.kind, date, time, extId, ref, vehicleId, amount, V.num(r, 'liters', { min: 0 }), loc.ar || '', loc.en || '', flag]);
      if (!ins.rowCount) { duplicates++; continue; }
      inserted++;
      const tx = ins.rows[0];
      const m = flag ? null : await autoMatch(c, ctx, tx);
      if (m) {
        await c.query("UPDATE provider_tx SET status = 'matched', matched_type = $1, matched_id = $2 WHERE id = $3", [m.type, m.id, tx.id]);
        if (tx.kind === 'toll') await postTollCharge(c, ctx, tx, m.id);
        matched++;
      } else if (tx.kind === 'toll' && !flag) await c.query("UPDATE provider_tx SET flag = 'no_trip' WHERE id = $1", [tx.id]);
    } catch (e) {
      errors.push({ row: k + 1, error: e.msg ? e.msg.en : e.message });
    }
  }
  await c.query('UPDATE providers SET last_sync = now(), status = CASE WHEN status = $2 THEN status ELSE status END WHERE id = $1', [pr.id, 'connected']);
  await core.audit(c, ctx, 'import', 'provider_tx', pr.code, { field: 'rows', before: rows.length, after: `${inserted} new, ${matched} matched, ${duplicates} duplicates, ${errors.length} errors` });
  return { inserted, matched, duplicates, errors };
}
define('providerTx.import', G.providers, async (ctx, i, c) => importTx(ctx, c, V.uuid(i, 'providerId', { req: true }), i.rows));

define('providerTx.match', G.providers, async (ctx, i, c) => {
  const tx = await core.lock(c, 'provider_tx', V.uuid(i, 'id', { req: true }), 'transaction');
  if (tx.status !== 'unmatched') throw conflict('state', 'المعاملة تمت مطابقتها أو رفضها', 'The transaction is already matched or rejected');
  const target = V.oneOf(i, 'target', ['fuel', 'trip', 'create_fuel', 'expense'], { req: true });
  let matchedType = null, matchedId = null;
  if (target === 'fuel') {
    const f = await core.mustExist(c, 'fuel_records', V.uuid(i, 'targetId', { req: true }), 'fuel record');
    if ((await c.query("SELECT 1 FROM provider_tx WHERE matched_type = 'fuel' AND matched_id = $1", [f.id])).rowCount) throw conflict('used', 'التفويلة مربوطة بمعاملة أخرى', 'That fill-up is already linked to another transaction');
    matchedType = 'fuel'; matchedId = f.id;
  } else if (target === 'trip') {
    const t = await core.mustExist(c, 'trips', V.uuid(i, 'targetId', { req: true }), 'trip');
    if (tx.vehicle_id && t.vehicle_id !== tx.vehicle_id) throw bad('vehicle', 'الرحلة على مركبة مختلفة', 'The trip is on a different vehicle');
    matchedType = 'trip'; matchedId = t.id;
    await postTollCharge(c, ctx, tx, t.id);
  } else if (target === 'create_fuel') {
    if (!tx.vehicle_id) throw bad('vehicle', 'حدد المركبة أولاً', 'Set the vehicle first');
    const r = await fleet.addFuel(ctx, { vehicleId: tx.vehicle_id, date: tx.date, time: tx.time, liters: V.num(i, 'liters', { def: tx.liters, gt: 0 }), total: tx.amount, price: tx.liters ? tx.amount / tx.liters : undefined, odometer: V.int(i, 'odometer', { req: true, min: 0 }), source: 'card', station: { ar: tx.location_ar, en: tx.location_en }, externalRef: tx.ext_id }, c);
    matchedType = 'fuel'; matchedId = r.id;
  } else {
    await core.expense(c, ctx, { date: tx.date, category: V.oneOf(i, 'category', ['tolls', 'fuel', 'maintenance', 'other'], { def: 'other' }), amount: tx.amount, vehicleId: tx.vehicle_id, method: tx.kind === 'toll' ? 'prepaid_tag' : tx.kind === 'fuel' ? 'prepaid_card' : 'payable', sourceType: 'provider_tx', sourceId: tx.id, sourceRef: tx.ext_id });
  }
  await c.query("UPDATE provider_tx SET status = 'matched', matched_type = $1, matched_id = $2 WHERE id = $3", [matchedType, matchedId, tx.id]);
  await core.audit(c, ctx, 'update', 'provider_tx', tx.ext_id, { field: 'status', before: 'unmatched', after: 'matched:' + target });
});
define('providerTx.reject', G.providers, async (ctx, i, c) => {
  const tx = await core.lock(c, 'provider_tx', V.uuid(i, 'id', { req: true }), 'transaction');
  if (tx.status !== 'unmatched') throw conflict('state', 'المعاملة ليست في الانتظار', 'The transaction is not pending');
  await c.query("UPDATE provider_tx SET status = 'rejected', flag = coalesce(flag, 'disputed') WHERE id = $1", [tx.id]);
  await core.audit(c, ctx, 'update', 'provider_tx', tx.ext_id, { field: 'status', before: 'unmatched', after: 'rejected: ' + V.str(i, 'reason', { max: 200, def: '' }) });
});

/* ---------- oil / maintenance service requests ---------- */
define('serviceRequest.create', G.maint, async (ctx, i, c) => {
  const providerId = V.uuid(i, 'providerId', { req: true }); const pr = await core.mustExist(c, 'providers', providerId, 'provider');
  if (pr.kind !== 'service') throw bad('provider', 'المزود ليس مركز خدمة', 'That provider is not a service center', 'providerId');
  const vehicleId = V.uuid(i, 'vehicleId', { req: true }); await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const date = V.date(i, 'date', { req: true });
  const services = V.arr(i, 'services', { req: true, min: 1, max: 10 }).map(s => (typeof s === 'string' ? { ar: s.slice(0, 120), en: s.slice(0, 120) } : { ar: String(s.ar || s.en || '').slice(0, 120), en: String(s.en || s.ar || '').slice(0, 120) }));
  const compare = V.arr(i, 'compare', { max: 10 }).map(x => ({ provider: String(x.provider || '').slice(0, 80), price: V.num(x, 'price', { min: 0, def: 0 }) }));
  const quote = V.num(i, 'quote', { min: 0 });
  const number = await core.nextNumber(c, ctx, 'SR', date);
  const sr = await insert(c, 'service_requests', { company_id: ctx.companyId, number, provider_id: providerId, vehicle_id: vehicleId, date, time: V.time(i, 'time', { def: '09:00' }), services: JSON.stringify(services), quote, compare: JSON.stringify(compare), status: quote != null ? 'quote_pending' : 'requested', created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'service_request', number);
  return { id: sr.id, number };
});
define('serviceRequest.quote', G.maint, async (ctx, i, c) => {
  const sr = await core.lock(c, 'service_requests', V.uuid(i, 'id', { req: true }), 'service request');
  if (!['requested', 'quote_pending'].includes(sr.status)) throw conflict('state', 'الطلب ليس في انتظار عرض سعر', 'The request is not waiting for a quote');
  await c.query("UPDATE service_requests SET quote = $1, status = 'quote_pending' WHERE id = $2", [V.num(i, 'quote', { req: true, min: 0 }), sr.id]);
  await core.audit(c, ctx, 'update', 'service_request', sr.number, { field: 'quote', before: sr.quote, after: i.quote });
});
define('serviceRequest.approve', G.fleet.concat(['accountant']), async (ctx, i, c) => {
  const sr = await core.lock(c, 'service_requests', V.uuid(i, 'id', { req: true }), 'service request');
  if (sr.status !== 'quote_pending') throw conflict('state', 'لا يوجد عرض سعر للموافقة', 'There is no quote to approve');
  const pr = await core.mustExist(c, 'providers', sr.provider_id);
  const v = await core.mustExist(c, 'vehicles', sr.vehicle_id);
  const number = await core.nextNumber(c, ctx, 'WO', sr.date);
  const services = sr.services || [];
  const wo = await insert(c, 'work_orders', { company_id: ctx.companyId, number, vehicle_id: v.id, date: sr.date, odometer: v.odometer, problem_ar: services.map(s => s.ar).join('، ') + ' — ' + pr.name_ar, problem_en: services.map(s => s.en).join(', ') + ' — ' + pr.name_en, type: 'preventive', provider: 'external', supplier_id: null, mechanics: '[]', external_cost: sr.quote, status: 'in_progress', down_start: sr.date, created_by: ctx.user.name });
  await c.query("UPDATE service_requests SET status = 'approved', work_order_id = $1 WHERE id = $2", [wo.id, sr.id]);
  await core.audit(c, ctx, 'approve', 'service_request', sr.number, { field: 'quote', before: '', after: sr.quote });
  return { workOrder: { id: wo.id, number } };
});
define('serviceRequest.reject', G.maint.concat(['accountant']), async (ctx, i, c) => {
  const sr = await core.lock(c, 'service_requests', V.uuid(i, 'id', { req: true }), 'service request');
  if (['completed', 'rejected'].includes(sr.status)) throw conflict('state', 'الطلب مقفول', 'The request is closed');
  await c.query("UPDATE service_requests SET status = 'rejected' WHERE id = $1", [sr.id]);
  await core.audit(c, ctx, 'update', 'service_request', sr.number, { field: 'status', before: sr.status, after: 'rejected' });
});

module.exports = { importTx };
