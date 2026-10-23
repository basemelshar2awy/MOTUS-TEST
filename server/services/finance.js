'use strict';
/* Finance & accounting: invoices (from trips / program / booking / manual), credit notes,
   payments with allocation and advances, manual expenses, month-end runs (depreciation,
   payroll), period close, chart-of-accounts mapping, manual journal entries. */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const countries = require('../lib/countries');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound } = require('../lib/errors');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const round2 = V.round2;
const TYPE_AR = { airport: 'استقبال مطار', city: 'جولة داخلية', intercity: 'بين المدن', hire: 'تأجير خاص' };
const TYPE_EN = { airport: 'Airport transfer', city: 'City tour', intercity: 'Intercity', hire: 'Private hire' };

async function placeNames(c) { const r = await c.query('SELECT code, name_ar, name_en FROM places'); return Object.fromEntries(r.rows.map(p => [p.code, p])); }

/* lines: [{ar, en, qty, unit, discount, revKey, tripId, programId, bookingId}] */
async function createInvoice(c, ctx, client, lines, opts) {
  const s = await core.settings(c, ctx);
  if (!lines.length) throw bad('lines', 'الفاتورة بدون بنود', 'The invoice has no lines');
  const issue = opts.issueDate || core.today();
  const due = opts.dueDate || core.addDays(issue, client.terms || 0);
  if (due < issue) throw bad('dueDate', 'تاريخ الاستحقاق قبل تاريخ الإصدار', 'The due date is before the issue date', 'dueDate');
  const taxRate = opts.taxRate != null ? opts.taxRate : s.vatRate;
  const base = (await core.company(c, ctx)).currency;   // the company's currency (country pack)
  const currency = client.currency || base;
  const rate = currency === base ? 1 : (opts.rate || (currency === 'USD' ? s.usdRate : null));
  if (!rate) throw bad('rate', 'أدخل سعر الصرف لعملة العميل', "Enter the exchange rate for the client's currency", 'rate');
  const sub = round2(lines.reduce((x, l) => x + l.qty * l.unit, 0));
  const discount = round2(opts.discount || 0);
  if (discount > sub) throw bad('discount', 'الخصم أكبر من قيمة الفاتورة', 'The discount is larger than the invoice amount', 'discount');
  const taxable = sub - discount, tax = round2(taxable * taxRate), total = round2(taxable + tax);
  const number = await core.nextNumber(c, ctx, 'INV', issue);
  const inv = await insert(c, 'invoices', { company_id: ctx.companyId, number, client_id: client.id, issue_date: issue, due_date: due, currency, rate, subtotal: sub, discount, tax, total, paid: 0, status: 'issued', source: opts.source, einv_provider: countries.pack((await core.company(c, ctx)).country).einvoice.code, created_by: ctx.user.name });
  let n = 0;
  for (const l of lines) await insert(c, 'invoice_lines', { company_id: ctx.companyId, invoice_id: inv.id, line_no: ++n, description_ar: l.ar, description_en: l.en, trip_id: l.tripId || null, program_id: l.programId || null, booking_id: l.bookingId || null, qty: l.qty, unit: l.unit, discount: 0, tax_rate: taxRate, total: round2(l.qty * l.unit) });
  // journal in company currency
  const scale = sub ? (sub - discount) / sub : 1;
  const byKey = {};
  for (const l of lines) byKey[l.revKey] = (byKey[l.revKey] || 0) + l.qty * l.unit * scale * rate;
  await core.post(c, ctx, { date: issue, sourceType: 'invoice', sourceRef: number, desc: { ar: 'فاتورة ' + number, en: 'Invoice ' + number }, lines: [{ a: 'receivables', debit: total * rate }, ...Object.entries(byKey).map(([k, v]) => ({ a: k, credit: v })), { a: 'vat_out', credit: tax * rate }] });
  await core.audit(c, ctx, 'create', 'invoice', number, { field: 'total', before: '', after: total });
  await core.emit(c, ctx, 'invoice.issued', { id: inv.id, number, clientId: client.id, issueDate: issue, dueDate: due, currency, subtotal: sub, discount, tax, total });
  return inv;
}

function invOpts(i) {
  return { issueDate: V.date(i, 'issueDate'), dueDate: V.date(i, 'dueDate'), discount: V.num(i, 'discount', { min: 0, def: 0 }), taxRate: V.num(i, 'taxRate', { min: 0, max: 1 }), rate: V.num(i, 'rate', { gt: 0 }) };
}

define('invoice.fromTrips', G.finance, async (ctx, i, c) => {
  const client = await core.mustExist(c, 'clients', V.uuid(i, 'clientId', { req: true }), 'client');
  const ids = [...new Set(V.arr(i, 'tripIds', { req: true, min: 1, max: 500 }).map(x => V.uuid({ x }, 'x', { req: true })))];
  const trips = (await c.query("SELECT * FROM trips WHERE id = ANY($1::uuid[]) FOR UPDATE", [ids])).rows;
  if (trips.length !== ids.length) throw notFound('trip');
  for (const t of trips) {
    if (t.client_id !== client.id) throw bad('client', `الرحلة ${t.number} لعميل آخر`, `Trip ${t.number} belongs to another client`);
    if (t.status !== 'completed') throw bad('status', `الرحلة ${t.number} غير مكتملة`, `Trip ${t.number} is not completed`);
    if (t.invoice_id) throw conflict('invoiced', `الرحلة ${t.number} مفوترة بالفعل`, `Trip ${t.number} is already invoiced`);
    if (t.program_id) throw bad('program', `الرحلة ${t.number} جزء من برنامج — فوتر البرنامج`, `Trip ${t.number} is part of a program — invoice the program`);
  }
  const pl = await placeNames(c);
  trips.sort((a, b) => (a.date + a.start_time < b.date + b.start_time ? -1 : 1));
  const lines = trips.map(t => ({ ar: `${TYPE_AR[t.type]}: ${(pl[t.from_place] || {}).name_ar || t.from_place} ← ${(pl[t.to_place] || {}).name_ar || t.to_place} (${t.number} · ${t.date})`, en: `${TYPE_EN[t.type]}: ${(pl[t.from_place] || {}).name_en || t.from_place} → ${(pl[t.to_place] || {}).name_en || t.to_place} (${t.number} · ${t.date})`, qty: 1, unit: t.revenue, revKey: 'revenue_' + t.type, tripId: t.id, bookingId: t.booking_id }));
  const inv = await createInvoice(c, ctx, client, lines, Object.assign(invOpts(i), { source: 'trips' }));
  const r = await c.query("UPDATE trips SET invoice_id = $1 WHERE id = ANY($2::uuid[]) AND invoice_id IS NULL AND status = 'completed'", [inv.id, ids]);
  if (r.rowCount !== ids.length) throw conflict('invoiced', 'بعض الرحلات اتفوترت في نفس اللحظة من مستخدم آخر', 'Some trips were invoiced at the same moment by another user');
  return { id: inv.id, number: inv.number };
});

define('invoice.fromProgram', G.finance, async (ctx, i, c) => {
  const prog = await core.lock(c, 'programs', V.uuid(i, 'programId', { req: true }), 'program');
  if (prog.status === 'cancelled') throw conflict('cancelled', 'البرنامج ملغي', 'The program is cancelled');
  const already = (await c.query("SELECT i.number FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.program_id = $1 AND i.status <> 'cancelled' LIMIT 1", [prog.id])).rows[0];
  if (already) throw conflict('invoiced', `البرنامج مفوتر بالفاتورة ${already.number}`, `The program is already invoiced (${already.number})`);
  const client = await core.mustExist(c, 'clients', prog.client_id, 'client');
  const days = (await c.query('SELECT count(*)::int n FROM program_days WHERE program_id = $1', [prog.id])).rows[0].n;
  const inv = await createInvoice(c, ctx, client, [{ ar: `برنامج ${prog.name_ar} (${days} أيام) ${prog.number}`, en: `Program ${prog.name_en} (${days} days) ${prog.number}`, qty: 1, unit: prog.price, revKey: 'revenue_program', programId: prog.id, bookingId: prog.booking_id }], Object.assign(invOpts(i), { source: 'program' }));
  await c.query("UPDATE trips SET invoice_id = $1 WHERE program_id = $2 AND invoice_id IS NULL AND status <> 'cancelled'", [inv.id, prog.id]);
  return { id: inv.id, number: inv.number };
});

define('invoice.fromBooking', G.finance, async (ctx, i, c) => {
  const b = await core.lock(c, 'bookings', V.uuid(i, 'bookingId', { req: true }), 'booking');
  if (b.status === 'cancelled') throw conflict('cancelled', 'الحجز ملغي', 'The booking is cancelled');
  if (b.program_id) throw bad('program', 'حجز برنامج — فوتر البرنامج', 'This is a program booking — invoice the program');
  const already = (await c.query("SELECT i.number FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.booking_id = $1 AND i.status <> 'cancelled' LIMIT 1", [b.id])).rows[0];
  if (already) throw conflict('invoiced', `الحجز مفوتر بالفاتورة ${already.number}`, `The booking is already invoiced (${already.number})`);
  const client = await core.mustExist(c, 'clients', b.client_id, 'client');
  const pl = await placeNames(c);
  const type = b.route_type || 'city';
  const inv = await createInvoice(c, ctx, client, [{ ar: `${TYPE_AR[type]}: ${(pl[b.pickup] || {}).name_ar || b.pickup} ← ${(pl[b.destination] || {}).name_ar || b.destination} (${b.number} · ${b.date})`, en: `${TYPE_EN[type]}: ${(pl[b.pickup] || {}).name_en || b.pickup} → ${(pl[b.destination] || {}).name_en || b.destination} (${b.number} · ${b.date})`, qty: 1, unit: b.price, revKey: 'revenue_' + type, bookingId: b.id }], Object.assign(invOpts(i), { source: 'booking' }));
  await c.query("UPDATE trips SET invoice_id = $1 WHERE booking_id = $2 AND invoice_id IS NULL AND status <> 'cancelled'", [inv.id, b.id]);
  return { id: inv.id, number: inv.number };
});

define('invoice.manual', G.finance, async (ctx, i, c) => {
  const client = await core.mustExist(c, 'clients', V.uuid(i, 'clientId', { req: true }), 'client');
  const lines = V.arr(i, 'lines', { req: true, min: 1, max: 100 }).map(l => {
    const d = V.text2(l, 'description', { req: true, max: 300 });
    return { ar: d.ar, en: d.en, qty: V.num(l, 'qty', { gt: 0, def: 1 }), unit: V.num(l, 'unit', { req: true, min: 0 }), revKey: V.oneOf(l, 'revenue', ['revenue_airport', 'revenue_city', 'revenue_intercity', 'revenue_hire', 'revenue_program', 'revenue_other'], { def: 'revenue_other' }) };
  });
  const inv = await createInvoice(c, ctx, client, lines, Object.assign(invOpts(i), { source: 'manual' }));
  return { id: inv.id, number: inv.number };
});

define('invoice.cancel', G.accounting, async (ctx, i, c) => {
  const inv = await core.lock(c, 'invoices', V.uuid(i, 'id', { req: true }), 'invoice');
  if (inv.status === 'cancelled') throw conflict('cancelled', 'الفاتورة ملغية بالفعل', 'The invoice is already cancelled');
  if (inv.paid > 0) throw conflict('paid', 'الفاتورة عليها تحصيل. استخدم إشعار دائن بدلاً من الإلغاء.', 'The invoice has payments. Use a credit note instead of cancelling.');
  if ((await c.query('SELECT 1 FROM credit_notes WHERE invoice_id = $1', [inv.id])).rowCount) throw conflict('credited', 'الفاتورة عليها إشعار دائن', 'The invoice has a credit note');
  if (inv.einv_status === 'valid' || inv.einv_status === 'submitted') throw conflict('einvoice', 'الفاتورة اتبعتت للمنظومة الإلكترونية. استخدم إشعار دائن.', 'The invoice was submitted to the e-invoicing system. Use a credit note.');
  const reason = V.text2(i, 'reason', { req: true, max: 200 });
  await c.query('UPDATE trips SET invoice_id = NULL WHERE invoice_id = $1', [inv.id]);
  await c.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [inv.id]);
  // reversal entry dated today (the original stays for the audit trail)
  const orig = (await c.query('SELECT l.account_key, l.cost_center, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_type = $1 AND e.source_ref = $2', ['invoice', inv.number])).rows;
  if (orig.length) await core.post(c, ctx, { date: core.today(), sourceType: 'invoice_cancel', sourceRef: inv.number, desc: { ar: `إلغاء فاتورة ${inv.number}: ${reason.ar}`, en: `Cancel invoice ${inv.number}: ${reason.en}` }, lines: orig.map(l => ({ a: l.account_key, cc: l.cost_center, debit: l.credit, credit: l.debit })) });
  await core.audit(c, ctx, 'update', 'invoice', inv.number, { field: 'status', before: inv.status, after: 'cancelled' });
  await core.emit(c, ctx, 'invoice.cancelled', { id: inv.id, number: inv.number });
});

define('invoice.einvoice', G.accounting, async (ctx, i, c) => {
  const inv = await core.lock(c, 'invoices', V.uuid(i, 'id', { req: true }), 'invoice');
  const status = V.oneOf(i, 'status', ['pending', 'submitted', 'valid', 'rejected'], { req: true });
  await c.query('UPDATE invoices SET einv_status = $1, einv_uuid = coalesce($2, einv_uuid) WHERE id = $3', [status, V.str(i, 'uuid', { max: 80 }), inv.id]);
  await core.audit(c, ctx, 'update', 'invoice', inv.number, { field: 'e-invoice', before: inv.einv_status, after: status });
});

define('creditNote.create', G.accounting, async (ctx, i, c) => {
  const inv = await core.lock(c, 'invoices', V.uuid(i, 'invoiceId', { req: true }), 'invoice');
  if (inv.status === 'cancelled') throw conflict('cancelled', 'الفاتورة ملغية', 'The invoice is cancelled');
  const subtotal = V.num(i, 'amount', { req: true, gt: 0 });
  const taxRate = inv.subtotal - inv.discount > 0 ? inv.tax / (inv.subtotal - inv.discount) : 0;
  const tax = round2(subtotal * taxRate), total = round2(subtotal + tax);
  const credited = (await c.query('SELECT coalesce(sum(total),0) s FROM credit_notes WHERE invoice_id = $1', [inv.id])).rows[0].s;
  const open = round2(inv.total - inv.paid - credited);
  if (total > open + 0.01) throw bad('amount', `الإشعار (${total}) أكبر من رصيد الفاتورة المفتوح (${open})`, `The credit note (${total}) is more than the open invoice balance (${open})`, 'amount');
  const reason = V.text2(i, 'reason', { req: true, max: 200 });
  const date = V.date(i, 'date', { def: core.today() });
  const number = await core.nextNumber(c, ctx, 'CN', date);
  const cn = await insert(c, 'credit_notes', { company_id: ctx.companyId, number, invoice_id: inv.id, client_id: inv.client_id, date, reason_ar: reason.ar, reason_en: reason.en, subtotal, tax, total, created_by: ctx.user.name });
  const rev = (await c.query("SELECT account_key FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.source_type = 'invoice' AND e.source_ref = $1 AND l.account_key LIKE 'revenue_%' ORDER BY l.credit DESC LIMIT 1", [inv.number])).rows[0];
  await core.post(c, ctx, { date, sourceType: 'credit_note', sourceRef: number, desc: { ar: 'إشعار دائن ' + number, en: 'Credit note ' + number }, lines: [{ a: rev ? rev.account_key : 'revenue_other', debit: subtotal * inv.rate }, { a: 'vat_out', debit: tax * inv.rate }, { a: 'receivables', credit: total * inv.rate }] });
  if (round2(open - total) <= 0.01) await c.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [inv.id]);
  await core.audit(c, ctx, 'create', 'credit_note', number, { field: 'total', before: '', after: total });
  await core.emit(c, ctx, 'credit_note.issued', { id: cn.id, number, invoice: inv.number, total });
  return { id: cn.id, number };
});

async function invoiceOpen(c, inv) {
  const cn = (await c.query('SELECT coalesce(sum(total),0) s FROM credit_notes WHERE invoice_id = $1', [inv.id])).rows[0].s;
  return round2(inv.total - inv.paid - cn);
}

async function recordPayment(ctx, i, c) {
  const client = await core.mustExist(c, 'clients', V.uuid(i, 'clientId', { req: true }), 'client');
  const amount = V.num(i, 'amount', { req: true, gt: 0 });
  const date = V.date(i, 'date', { def: core.today() });
  if (date > core.today()) throw bad('date', 'تاريخ التحصيل في المستقبل', 'The payment date is in the future', 'date');
  const method = V.oneOf(i, 'method', ['transfer', 'cheque', 'cash', 'card'], { req: true });
  const account = V.str(i, 'account', { def: method === 'cash' ? 'cash_main' : 'bank_main', max: 40, re: /^(bank|cash)_[a-z0-9_]+$/ });
  const coa = await core.accounts(c, ctx);
  if (!coa[account]) throw bad('account', 'حساب البنك/الخزينة غير موجود في دليل الحسابات', 'That bank/cash account is not in the chart of accounts', 'account');
  let allocations = V.arr(i, 'allocations', { max: 200 }).map(a => ({ invoiceId: V.uuid(a, 'invoiceId', { req: true }), amount: V.num(a, 'amount', { req: true, gt: 0 }) }));
  const bookingId = V.uuid(i, 'advanceBookingId');
  if (!allocations.length && !bookingId && V.bool(i, 'autoAllocate', true)) {
    let left = amount;
    const open = (await c.query("SELECT * FROM invoices WHERE client_id = $1 AND status IN ('issued','partial') ORDER BY due_date, issue_date FOR UPDATE", [client.id])).rows;
    for (const inv of open) { if (left <= 0) break; const o = await invoiceOpen(c, inv); if (o <= 0) continue; const a = round2(Math.min(o, left)); allocations.push({ invoiceId: inv.id, amount: a }); left = round2(left - a); }
  }
  const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocSum > amount + 0.01) throw bad('allocations', 'مجموع التوزيع أكبر من مبلغ التحصيل', 'The allocations add up to more than the payment', 'allocations');
  const number = await core.nextNumber(c, ctx, 'RC', date);
  const p = await insert(c, 'payments', { company_id: ctx.companyId, number, client_id: client.id, date, amount, method, account, reference: V.str(i, 'reference', { max: 80, def: '' }), advance_booking_id: bookingId, created_by: ctx.user.name, external_ref: V.str(i, 'externalRef', { max: 80 }) });
  for (const a of allocations) {
    const inv = await core.lock(c, 'invoices', a.invoiceId, 'invoice');
    if (inv.client_id !== client.id) throw bad('allocations', `الفاتورة ${inv.number} لعميل آخر`, `Invoice ${inv.number} belongs to another client`, 'allocations');
    if (inv.status === 'cancelled') throw bad('allocations', `الفاتورة ${inv.number} ملغية`, `Invoice ${inv.number} is cancelled`, 'allocations');
    const open = await invoiceOpen(c, inv);
    if (a.amount > open + 0.01) throw bad('allocations', `المبلغ على الفاتورة ${inv.number} أكبر من رصيدها (${open})`, `The amount on ${inv.number} is more than its balance (${open})`, 'allocations');
    await insert(c, 'payment_allocations', { company_id: ctx.companyId, payment_id: p.id, invoice_id: inv.id, amount: a.amount });
    const paid = round2(inv.paid + a.amount);
    const status = round2(open - a.amount) <= 0.01 ? 'paid' : 'partial';
    await c.query('UPDATE invoices SET paid = $1, status = $2 WHERE id = $3', [paid, status, inv.id]);
  }
  if (bookingId) {
    const b = await core.lock(c, 'bookings', bookingId, 'booking');
    if (b.client_id !== client.id) throw bad('advanceBookingId', 'الحجز لعميل آخر', 'The booking belongs to another client', 'advanceBookingId');
    await c.query('UPDATE bookings SET paid = paid + $1 WHERE id = $2', [round2(amount - allocSum), bookingId]);
  }
  await core.post(c, ctx, { date, sourceType: 'payment', sourceRef: number, desc: { ar: 'تحصيل ' + number + ' ' + client.name_ar, en: 'Receipt ' + number + ' ' + client.name_en }, lines: [{ a: account, debit: amount }, { a: 'receivables', credit: amount }] });
  await core.audit(c, ctx, 'create', 'payment', number, { field: 'amount', before: '', after: amount });
  await core.emit(c, ctx, 'payment.received', { id: p.id, number, clientId: client.id, date, amount, method, allocations });
  return { id: p.id, number, allocated: allocSum, unallocated: round2(amount - allocSum) };
}
define('payment.create', G.finance, recordPayment);

define('expense.create', G.finance, async (ctx, i, c) => {
  const category = V.oneOf(i, 'category', ['fuel', 'oil', 'maintenance', 'tolls', 'parking', 'lodging', 'salaries', 'insurance', 'license', 'subcontract', 'other'], { req: true });
  const vehicleId = V.uuid(i, 'vehicleId'); if (vehicleId) await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const tripId = V.uuid(i, 'tripId'); if (tripId) await core.mustExist(c, 'trips', tripId, 'trip');
  const id = await core.expense(c, ctx, { date: V.date(i, 'date', { def: core.today() }), category, amount: V.num(i, 'amount', { req: true, gt: 0 }), tax: V.num(i, 'tax', { min: 0, def: 0 }), vehicleId, tripId, driverId: V.uuid(i, 'driverId'), supplier: V.str(i, 'supplier', { max: 120, def: '' }), method: V.oneOf(i, 'method', ['cash', 'bank', 'payable'], { def: 'cash' }), sourceType: 'manual', note: V.text2(i, 'note', { max: 300 }) });
  await core.audit(c, ctx, 'create', 'expense', `${category} ${i.amount}`);
  return { id };
});

/* ---------- month-end runs ---------- */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDay = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);

define('depreciation.post', G.accounting, async (ctx, i, c) => {
  const ym = V.str(i, 'month', { req: true, re: MONTH });
  if (ym >= core.today().slice(0, 7)) throw bad('month', 'لا يمكن ترحيل إهلاك شهر لم ينتهِ', 'Depreciation can only be posted for a finished month', 'month');
  if ((await c.query("SELECT 1 FROM journal_entries WHERE source_type = 'depreciation' AND source_ref = $1", ['DEP-' + ym])).rowCount) throw conflict('posted', 'إهلاك هذا الشهر مُرحّل بالفعل', 'Depreciation for this month is already posted');
  const end = lastDay(ym);
  const vs = (await c.query("SELECT * FROM vehicles WHERE purchase_date <= $1 AND status <> 'sold'", [end])).rows;
  const lines = [];
  for (const v of vs) {
    const monthly = (v.purchase_price - v.salvage_value) / v.life_years / 12;
    const months = Math.max(0, (Date.parse(end) - Date.parse(v.purchase_date)) / (365.25 / 12 * 86400000));
    const remaining = (v.purchase_price - v.salvage_value) - monthly * Math.max(0, months - 1);
    const amt = round2(Math.max(0, Math.min(monthly, remaining)));
    if (amt > 0) lines.push({ a: 'exp_dep', debit: amt, cc: v.code });
  }
  if (!lines.length) throw bad('none', 'لا توجد مركبات للإهلاك في هذا الشهر', 'No vehicles to depreciate for this month');
  lines.push({ a: 'acc_dep', credit: round2(lines.reduce((s, l) => s + l.debit, 0)) });
  const je = await core.post(c, ctx, { date: end, sourceType: 'depreciation', sourceRef: 'DEP-' + ym, desc: { ar: 'إهلاك شهر ' + ym, en: 'Depreciation ' + ym }, lines });
  await core.audit(c, ctx, 'create', 'journal', je.number, { field: 'depreciation', before: '', after: ym });
  return { number: je.number, vehicles: lines.length - 1 };
});

define('payroll.post', G.accounting, async (ctx, i, c) => {
  const ym = V.str(i, 'month', { req: true, re: MONTH });
  if (ym > core.today().slice(0, 7)) throw bad('month', 'شهر في المستقبل', 'That month is in the future', 'month');
  if ((await c.query("SELECT 1 FROM expenses WHERE source_type = 'payroll' AND note_en = $1 LIMIT 1", ['PAYROLL-' + ym])).rowCount) throw conflict('posted', 'رواتب هذا الشهر مسجلة بالفعل', 'Payroll for this month is already recorded');
  const from = ym + '-01', end = lastDay(ym);
  const drivers = (await c.query("SELECT * FROM drivers WHERE status = 'active' AND (hired_at IS NULL OR hired_at <= $1)", [end])).rows;
  let n = 0, total = 0;
  for (const d of drivers) {
    let amt = d.employment !== 'commission' ? Number(d.salary) : 0;
    if (d.employment !== 'salary') { const cnt = (await c.query("SELECT count(*)::int n FROM trips WHERE driver_id = $1 AND status = 'completed' AND date BETWEEN $2 AND $3", [d.id, from, end])).rows[0].n; amt += cnt * Number(d.commission); }
    if (amt <= 0) continue;
    await core.expense(c, ctx, { date: end, category: 'salaries', amount: amt, driverId: d.id, vehicleId: d.vehicle_id, method: 'bank', sourceType: 'payroll', note: { ar: 'PAYROLL-' + ym, en: 'PAYROLL-' + ym }, journal: false });
    n++; total += amt;
  }
  if (!n) throw bad('none', 'لا يوجد سائقين لهم رواتب أو عمولات في هذا الشهر', 'No driver pay to record for this month');
  const je = await core.post(c, ctx, { date: end, sourceType: 'payroll', sourceRef: 'PAY-' + ym, desc: { ar: 'رواتب وعمولات السائقين ' + ym, en: 'Driver salaries & commissions ' + ym }, lines: [{ a: 'exp_salaries', debit: total }, { a: 'bank_main', credit: total }] });
  await core.audit(c, ctx, 'create', 'journal', je.number, { field: 'payroll', before: '', after: ym });
  return { number: je.number, drivers: n, total: round2(total) };
});

define('period.close', G.accounting, async (ctx, i, c) => {
  const ym = V.str(i, 'month', { req: true, re: MONTH });
  if (ym >= core.today().slice(0, 7)) throw bad('month', 'لا يمكن إقفال الشهر الحالي أو شهر مستقبلي', 'You cannot close the current or a future month', 'month');
  const s = await core.settings(c, ctx);
  if (s.closedThrough && ym <= s.closedThrough) throw conflict('closed', `الفترة مقفلة بالفعل حتى ${s.closedThrough}`, `Periods are already closed through ${s.closedThrough}`);
  await c.query('UPDATE company_settings SET closed_through = $1 WHERE company_id = $2', [ym, ctx.companyId]);
  await core.audit(c, ctx, 'update', 'period', ym, { field: 'closed_through', before: s.closedThrough || '', after: ym });
});
define('period.reopen', G.admin, async (ctx, i, c) => {
  const ym = V.str(i, 'month', { req: true, re: MONTH });
  const reason = V.str(i, 'reason', { req: true, max: 200 });
  const s = await core.settings(c, ctx);
  if (!s.closedThrough || ym > s.closedThrough) throw conflict('open', 'الفترة مفتوحة بالفعل', 'That period is already open');
  const prev = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
  await c.query('UPDATE company_settings SET closed_through = $1 WHERE company_id = $2', [prev, ctx.companyId]);
  await core.audit(c, ctx, 'update', 'period', ym, { field: 'reopen: ' + reason, before: s.closedThrough, after: prev });
});

/* ---------- chart of accounts mapping ---------- */
define('coa.update', G.accounting, async (ctx, i, c) => {
  const key = V.str(i, 'key', { req: true, max: 40, re: /^[a-z0-9_]+$/ });
  const name = has(i, 'name') ? V.text2(i, 'name', { max: 120 }) : null;
  const r = await c.query('UPDATE coa SET code = coalesce($1, code), erp_code = coalesce($2, erp_code), name_ar = coalesce($3, name_ar), name_en = coalesce($4, name_en) WHERE key = $5 RETURNING code',
    [V.str(i, 'code', { max: 20, re: /^[0-9A-Za-z.-]+$/ }), V.str(i, 'erpCode', { max: 40 }), name ? name.ar : null, name ? name.en : null, key]);
  if (!r.rowCount) throw notFound('account');
  await core.audit(c, ctx, 'update', 'coa', key);
});
define('coa.create', G.accounting, async (ctx, i, c) => {
  const key = V.str(i, 'key', { req: true, max: 40, re: /^(bank|cash)_[a-z0-9_]+$/ });
  const name = V.text2(i, 'name', { req: true, max: 120 });
  const code = V.str(i, 'code', { req: true, max: 20, re: /^[0-9A-Za-z.-]+$/ });
  await insert(c, 'coa', { company_id: ctx.companyId, key, name_ar: name.ar, name_en: name.en, code, erp_code: V.str(i, 'erpCode', { max: 40, def: code }) });
  await core.audit(c, ctx, 'create', 'coa', key);
});

define('journal.manual', G.accounting, async (ctx, i, c) => {
  const date = V.date(i, 'date', { req: true });
  const desc = V.text2(i, 'description', { req: true, max: 300 });
  const lines = V.arr(i, 'lines', { req: true, min: 2, max: 100 }).map(l => ({ a: V.str(l, 'accountKey', { req: true, max: 40 }), debit: V.num(l, 'debit', { min: 0, def: 0 }), credit: V.num(l, 'credit', { min: 0, def: 0 }), cc: V.str(l, 'costCenter', { max: 30 }) }));
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0)), cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr || dr === 0) throw bad('unbalanced', `القيد غير متوازن (مدين ${dr} / دائن ${cr})`, `The entry does not balance (debit ${dr} / credit ${cr})`, 'lines');
  if (lines.some(l => l.debit > 0 && l.credit > 0)) throw bad('line', 'السطر الواحد يكون مدين أو دائن فقط', 'Each line must be either debit or credit', 'lines');
  const je = await core.post(c, ctx, { date, sourceType: 'manual', sourceRef: V.str(i, 'reference', { max: 60, def: 'manual' }), desc, lines });
  await core.audit(c, ctx, 'create', 'journal', je.number);
  return je;
});

module.exports = { recordPayment, createInvoice };
