'use strict';
/* Accounting export / ERP push.
   - File export: journal entries as CSV or JSON (any ERP can import it).
   - Push: POST the unexported posted entries to the ERP connection's endpoint
     (Settings → Service providers → kind "erp"). Body format is documented in docs/API.md.
     On HTTP 2xx the entries become "exported"; the ERP may return {"refs": {"JE-…": "ERP-ID"}}. */
const crypto = require('crypto');
const db = require('./db');
const core = require('./core');
const secrets = require('./secrets');
const outbound = require('./outbound');
const { AppError, bad } = require('./errors');

async function entries(c, { from, to, status, limit = 5000 }) {
  const where = ['1=1'], p = [];
  if (from) { p.push(from); where.push(`e.date >= $${p.length}`); }
  if (to) { p.push(to); where.push(`e.date <= $${p.length}`); }
  if (status) { p.push(status); where.push(`e.status = $${p.length}`); }
  p.push(limit);
  const es = (await c.query(`SELECT e.* FROM journal_entries e WHERE ${where.join(' AND ')} ORDER BY e.date, e.number LIMIT $${p.length}`, p)).rows;
  if (!es.length) return [];
  const ls = (await c.query('SELECT l.*, a.erp_code FROM journal_lines l LEFT JOIN coa a ON a.key = l.account_key WHERE l.entry_id = ANY($1::uuid[]) ORDER BY l.line_no', [es.map(e => e.id)])).rows;
  return es.map(e => ({ id: e.id, number: e.number, date: e.date, sourceType: e.source_type, sourceRef: e.source_ref, description: e.description_en || e.description_ar, descriptionAr: e.description_ar, status: e.status, externalRef: e.external_ref,
    lines: ls.filter(l => l.entry_id === e.id).map(l => ({ account: l.account, erpAccount: l.erp_code || l.account, accountKey: l.account_key, costCenter: l.cost_center, debit: Number(l.debit), credit: Number(l.credit) })) }));
}

function toCsv(list) {
  const q = s => { s = s == null ? '' : String(s); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['entry', 'date', 'source_type', 'source_ref', 'description', 'line', 'account', 'erp_account', 'cost_center', 'debit', 'credit'].join(',')];
  for (const e of list) e.lines.forEach((l, i) => rows.push([e.number, e.date, e.sourceType, e.sourceRef, e.description, i + 1, l.account, l.erpAccount, l.costCenter, l.debit.toFixed(2), l.credit.toFixed(2)].map(q).join(',')));
  return '﻿' + rows.join('\r\n');
}

async function markExported(c, ids, refs = {}) {
  if (!ids.length) return;
  await c.query("UPDATE journal_entries SET status = 'exported', sync_status = 'synced' WHERE id = ANY($1::uuid[]) AND status = 'posted'", [ids]);
  for (const [number, ref] of Object.entries(refs)) await c.query('UPDATE journal_entries SET external_ref = $1 WHERE number = $2', [String(ref).slice(0, 80), number]);
}

async function exportFile(ctx, q) {
  return db.tx(ctx.companyId, async c => {
    const list = await entries(c, { from: q.from, to: q.to, status: q.status || null });
    if (q.mark === '1') { await markExported(c, list.filter(e => e.status === 'posted').map(e => e.id)); await c.query("INSERT INTO sync_log (company_id, entity, direction, count, status) VALUES ($1,'journal','outbound',$2,'success')", [ctx.companyId, list.length]); await core.audit(c, ctx, 'export', 'journal', `${q.from || ''}..${q.to || ''}`, { field: 'entries', before: '', after: list.length }); await core.touch(c, ctx); }
    return list;
  });
}

async function push(ctx, allowPrivate) {
  const prep = await db.read(ctx.companyId, async c => {
    const p = (await c.query("SELECT * FROM providers WHERE kind = 'erp' AND status = 'connected' AND endpoint_url <> '' ORDER BY updated_at DESC LIMIT 1")).rows[0];
    if (!p) throw new AppError(409, 'no_erp', 'لا يوجد ربط ERP مفعّل بعنوان (Endpoint). أضفه من مزودي الخدمة أو استخدم تصدير الملف.', 'No connected ERP with an endpoint URL. Add it in Service providers, or use the file export.');
    const list = await entries(c, { status: 'posted', limit: 500 });
    return { p, list };
  });
  const { p, list } = prep;
  if (!list.length) return { sent: 0 };
  const creds = p.credentials_enc ? JSON.parse(secrets.decrypt(p.credentials_enc)) : {};
  const body = JSON.stringify({ companyId: ctx.companyId, generatedAt: new Date().toISOString(), entries: list });
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.createHash('sha256').update(list.map(e => e.id).join(',')).digest('hex') };
  if (creds.token) headers.Authorization = 'Bearer ' + creds.token;
  if (creds.apiKey) headers['X-Api-Key'] = creds.apiKey;
  let res = null, error = null;
  try { res = await outbound.request(p.endpoint_url, { body, headers, allowPrivate, timeout: 30000 }); if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}: ${res.body.slice(0, 300)}`; }
  catch (e) { error = e.message; }
  await db.tx(ctx.companyId, async c => {
    if (!error) {
      let refs = {}; try { refs = (JSON.parse(res.body) || {}).refs || {}; } catch (e) { /* optional */ }
      await markExported(c, list.map(e => e.id), refs);
      await c.query("INSERT INTO sync_log (company_id, entity, direction, count, status) VALUES ($1,'journal','outbound',$2,'success')", [ctx.companyId, list.length]);
      await c.query("UPDATE providers SET last_sync = now(), status = 'connected', error_ar = NULL, error_en = NULL WHERE id = $1", [p.id]);
    } else {
      await c.query("UPDATE journal_entries SET sync_status = 'failed' WHERE id = ANY($1::uuid[])", [list.map(e => e.id)]);
      await c.query("INSERT INTO sync_log (company_id, entity, direction, count, status, error_ar, error_en) VALUES ($1,'journal','outbound',$2,'failed',$3,$3)", [ctx.companyId, list.length, error.slice(0, 300)]);
      await c.query("UPDATE providers SET error_ar = $1, error_en = $1 WHERE id = $2", [error.slice(0, 300), p.id]);
    }
    await core.audit(c, ctx, 'export', 'journal', p.code, { field: 'push', before: list.length, after: error ? 'failed: ' + error.slice(0, 120) : 'success' });
    await core.touch(c, ctx);
  });
  if (error) throw new AppError(502, 'erp_failed', 'فشل الإرسال للـ ERP: ' + error, 'Sending to the ERP failed: ' + error);
  return { sent: list.length };
}

module.exports = { entries, toCsv, exportFile, push };
