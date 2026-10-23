'use strict';
/* Spare-parts warehouses: warehouses, items, suppliers, receipts, transfers, adjustments,
   purchase requests → approval → (partial) receipts → 3-way match, and stock counts. */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound } = require('../lib/errors');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const P = (o, f, fn, ...a) => (has(o, f) ? fn(o, f, ...a) : undefined);
const round2 = V.round2;
const CATS = ['oils', 'filters', 'brakes', 'electrical', 'ac', 'suspension', 'tires', 'batteries', 'other'];

async function nextCode(c, table, prefix, width) {
  const n = (await c.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
  for (let k = n + 1; ; k++) { const code = `${prefix}${String(k).padStart(width, '0')}`; if (!(await c.query(`SELECT 1 FROM ${table} WHERE code = $1`, [code])).rowCount) return code; }
}

define('warehouse.create', G.stock, async (ctx, i, c) => {
  const name = V.text2(i, 'name', { req: true, max: 120 }), keeper = V.text2(i, 'keeper', { max: 120 });
  const w = await insert(c, 'warehouses', { company_id: ctx.companyId, code: V.str(i, 'code', { max: 20 }) || await nextCode(c, 'warehouses', 'WH-', 1), name_ar: name.ar, name_en: name.en, branch_id: V.uuid(i, 'branchId'), type: V.oneOf(i, 'type', ['main', 'branch', 'workshop', 'mobile'], { def: 'branch' }), keeper_ar: keeper.ar, keeper_en: keeper.en, created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'warehouse', w.code);
  return { id: w.id };
});
define('warehouse.update', G.stock, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const w = await core.lock(c, 'warehouses', id, 'warehouse');
  const name = P(i, 'name', V.text2, { max: 120 }), keeper = P(i, 'keeper', V.text2, { max: 120 });
  const status = P(i, 'status', V.oneOf, ['active', 'inactive']);
  if (status === 'inactive' && (await c.query('SELECT 1 FROM stock_balances WHERE warehouse_id = $1 AND qty > 0', [id])).rowCount) throw conflict('has_stock', 'المخزن فيه رصيد. حوّل الرصيد أولاً.', 'The warehouse still holds stock. Transfer it first.');
  await update(c, 'warehouses', id, defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, keeper_ar: keeper ? keeper.ar : undefined, keeper_en: keeper ? keeper.en : undefined, status, type: P(i, 'type', V.oneOf, ['main', 'branch', 'workshop', 'mobile']) }));
  await core.audit(c, ctx, 'update', 'warehouse', w.code);
});

function itemFields(i) {
  const name = P(i, 'name', V.text2, { max: 160 });
  return defined({
    name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, oem: P(i, 'oem', V.str, { max: 40, def: '' }),
    category: P(i, 'category', V.oneOf, CATS), unit: P(i, 'unit', V.oneOf, ['L', 'pc', 'set', 'kg']),
    min_stock: P(i, 'minStock', V.num, { min: 0 }), reorder_point: P(i, 'reorderPoint', V.num, { min: 0 }), max_stock: P(i, 'maxStock', V.num, { min: 0 }),
    serial: has(i, 'serial') ? V.bool(i, 'serial') : undefined, barcode: P(i, 'barcode', V.str, { max: 40, def: '' }),
    compatible: has(i, 'compatible') ? [...new Set(V.arr(i, 'compatible', { max: 40 }).map(String).filter(x => /^[A-Z0-9]{2,8}$/.test(x)))] : undefined,
    external_ref: P(i, 'externalRef', V.str, { max: 80 }),
  });
}
define('item.create', G.stock, async (ctx, i, c) => {
  const f = itemFields(i);
  if (!f.name_ar) throw bad('required', 'اسم الصنف مطلوب', 'The item name is required', 'name');
  f.category = f.category || 'other'; f.unit = f.unit || 'pc';
  const it = await insert(c, 'items', Object.assign({ company_id: ctx.companyId, code: V.str(i, 'code', { max: 30, re: /^[A-Za-z0-9._-]+$/ }) || await nextCode(c, 'items', 'ITM-', 4), avg_cost: V.num(i, 'cost', { min: 0, def: 0 }), last_price: V.num(i, 'cost', { min: 0, def: 0 }), created_by: ctx.user.name }, f));
  await core.audit(c, ctx, 'create', 'item', it.code);
  return { id: it.id, code: it.code };
});
define('item.update', G.stock, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const it = await core.lock(c, 'items', id, 'item');
  await update(c, 'items', id, itemFields(i));
  await core.audit(c, ctx, 'update', 'item', it.code);
});

function supplierFields(i) {
  const name = P(i, 'name', V.text2, { max: 160 });
  return defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, category: P(i, 'category', V.oneOf, ['parts', 'oils', 'tires', 'workshop', 'service', 'rental', 'other']), tax_no: P(i, 'taxNo', V.str, { max: 30, def: '' }), phone: P(i, 'phone', V.str, { max: 30, def: '' }), terms: P(i, 'terms', V.int, { min: 0, max: 365 }), external_ref: P(i, 'externalRef', V.str, { max: 80 }) });
}
define('supplier.create', G.stock, async (ctx, i, c) => {
  const f = supplierFields(i);
  if (!f.name_ar) throw bad('required', 'اسم المورد مطلوب', 'The supplier name is required', 'name');
  const s = await insert(c, 'suppliers', Object.assign({ company_id: ctx.companyId, code: V.str(i, 'code', { max: 20 }) || await nextCode(c, 'suppliers', 'SUP-', 3), category: 'parts', created_by: ctx.user.name }, f));
  await core.audit(c, ctx, 'create', 'supplier', s.code);
  return { id: s.id, code: s.code };
});
define('supplier.update', G.stock, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const s = await core.lock(c, 'suppliers', id, 'supplier');
  await update(c, 'suppliers', id, supplierFields(i));
  await core.audit(c, ctx, 'update', 'supplier', s.code);
});

async function activeWh(c, id, field) { const w = await core.mustExist(c, 'warehouses', id, 'warehouse'); if (w.status !== 'active') throw bad('warehouse', 'المخزن غير نشط', 'The warehouse is inactive', field); return w; }

/* direct receipt without a purchase order (e.g. cash purchase) */
define('stock.receipt', G.stock, async (ctx, i, c) => {
  const warehouseId = V.uuid(i, 'warehouseId', { req: true }); await activeWh(c, warehouseId, 'warehouseId');
  const date = V.date(i, 'date', { def: core.today() });
  const lines = V.arr(i, 'lines', { req: true, min: 1, max: 100 });
  const payment = V.oneOf(i, 'paidBy', ['cash', 'payable'], { def: 'payable' });
  const ref = V.str(i, 'reference', { max: 60, def: '' });
  let value = 0;
  for (const l of lines) { const m = await core.stockMove(c, ctx, { type: 'receipt', date, itemId: V.uuid(l, 'itemId', { req: true }), warehouseId, qty: V.num(l, 'qty', { req: true, gt: 0 }), unitCost: V.num(l, 'unitCost', { req: true, min: 0 }), ref: { ar: 'استلام ' + ref, en: 'Receipt ' + ref } }); value += m.value; }
  const s = await core.settings(c, ctx);
  const vat = V.bool(i, 'withVat', true) ? round2(value * s.vatRate) : 0;
  await core.post(c, ctx, { date, sourceType: 'stock_receipt', sourceRef: ref || date, desc: { ar: 'استلام مخزني ' + ref, en: 'Goods receipt ' + ref }, lines: [{ a: 'inventory', debit: value }, { a: 'vat_in', debit: vat }, { a: payment === 'cash' ? 'cash_main' : 'payables', credit: value + vat }] });
  await core.audit(c, ctx, 'create', 'stock_receipt', ref, { field: 'value', before: '', after: round2(value) });
  return { value: round2(value) };
});

define('stock.transfer', G.stock, async (ctx, i, c) => {
  const from = V.uuid(i, 'fromWarehouseId', { req: true }), to = V.uuid(i, 'toWarehouseId', { req: true });
  if (from === to) throw bad('to', 'المخزن المحوّل إليه هو نفس المخزن', 'Source and destination are the same warehouse', 'toWarehouseId');
  const wf = await activeWh(c, from, 'fromWarehouseId'), wt = await activeWh(c, to, 'toWarehouseId');
  const date = V.date(i, 'date', { def: core.today() });
  const lines = V.arr(i, 'lines', { req: true, min: 1, max: 100 });
  for (const l of lines) {
    const itemId = V.uuid(l, 'itemId', { req: true }), qty = V.num(l, 'qty', { req: true, gt: 0 });
    const out = await core.stockMove(c, ctx, { type: 'transfer_out', date, itemId, warehouseId: from, qty: -qty, ref: { ar: 'تحويل إلى ' + wt.name_ar, en: 'Transfer to ' + wt.name_en } });
    await core.stockMove(c, ctx, { type: 'transfer_in', date, itemId, warehouseId: to, qty, unitCost: Math.abs(out.value) / qty, ref: { ar: 'تحويل من ' + wf.name_ar, en: 'Transfer from ' + wf.name_en } });
  }
  await core.audit(c, ctx, 'create', 'stock_transfer', `${wf.code} → ${wt.code}`);
});

define('stock.adjust', G.stock, async (ctx, i, c) => {
  const warehouseId = V.uuid(i, 'warehouseId', { req: true }); await activeWh(c, warehouseId, 'warehouseId');
  const itemId = V.uuid(i, 'itemId', { req: true });
  const qty = V.num(i, 'qty', { req: true }); if (!qty) throw bad('qty', 'الكمية لازم تكون موجبة أو سالبة', 'Quantity must be positive or negative', 'qty');
  const reason = V.text2(i, 'reason', { req: true, max: 200 });
  const date = V.date(i, 'date', { def: core.today() });
  const m = await core.stockMove(c, ctx, { type: 'adjustment', date, itemId, warehouseId, qty, ref: { ar: 'تسوية: ' + reason.ar, en: 'Adjustment: ' + reason.en } });
  const v = Math.abs(m.value);
  if (v > 0) await core.post(c, ctx, { date, sourceType: 'stock_adjustment', sourceRef: m.item.code, desc: { ar: 'تسوية مخزون ' + m.item.name_ar, en: 'Stock adjustment ' + m.item.name_en }, lines: qty > 0 ? [{ a: 'inventory', debit: v }, { a: 'inv_variance', credit: v }] : [{ a: 'inv_variance', debit: v }, { a: 'inventory', credit: v }] });
  await core.audit(c, ctx, 'create', 'stock_adjustment', m.item.code, { field: 'qty', before: '', after: qty });
});

define('stock.returnSupplier', G.stock, async (ctx, i, c) => {
  const warehouseId = V.uuid(i, 'warehouseId', { req: true }); await activeWh(c, warehouseId, 'warehouseId');
  const itemId = V.uuid(i, 'itemId', { req: true }); const qty = V.num(i, 'qty', { req: true, gt: 0 });
  const supplierId = V.uuid(i, 'supplierId', { req: true }); const s = await core.mustExist(c, 'suppliers', supplierId, 'supplier');
  const date = V.date(i, 'date', { def: core.today() });
  const m = await core.stockMove(c, ctx, { type: 'return_supplier', date, itemId, warehouseId, qty: -qty, ref: { ar: 'مرتجع إلى ' + s.name_ar, en: 'Return to ' + s.name_en } });
  const v = Math.abs(m.value);
  await core.post(c, ctx, { date, sourceType: 'stock_return', sourceRef: s.code, desc: { ar: 'مرتجع مورد ' + s.name_ar, en: 'Supplier return ' + s.name_en }, lines: [{ a: 'payables', debit: v }, { a: 'inventory', credit: v }] });
  await core.audit(c, ctx, 'create', 'stock_return', s.code);
});

/* ---------- purchasing ---------- */
define('po.create', G.stock, async (ctx, i, c) => {
  const supplierId = V.uuid(i, 'supplierId', { req: true }); await core.mustExist(c, 'suppliers', supplierId, 'supplier');
  const date = V.date(i, 'date', { def: core.today() });
  const lines = V.arr(i, 'lines', { req: true, min: 1, max: 100 }).map(l => ({ itemId: V.uuid(l, 'itemId', { req: true }), qty: V.num(l, 'qty', { req: true, gt: 0 }), price: V.num(l, 'price', { min: 0 }) }));
  const number = await core.nextNumber(c, ctx, 'PO', date);
  const po = await insert(c, 'purchase_orders', { company_id: ctx.companyId, number, supplier_id: supplierId, date, expected: V.date(i, 'expected', { def: core.addDays(date, 7) }), status: 'requested', source: V.oneOf(i, 'source', ['manual', 'reorder', 'work_order', 'ai'], { def: 'manual' }), created_by: ctx.user.name });
  let total = 0;
  for (const l of lines) {
    const it = await core.mustExist(c, 'items', l.itemId, 'item');
    const price = l.price != null ? l.price : (it.last_price || it.avg_cost);
    await insert(c, 'po_lines', { company_id: ctx.companyId, po_id: po.id, item_id: l.itemId, qty: l.qty, price, received: 0 });
    total += l.qty * price;
  }
  await c.query('UPDATE purchase_orders SET total = $1 WHERE id = $2', [round2(total), po.id]);
  await core.audit(c, ctx, 'create', 'purchase_order', number, { field: 'total', before: '', after: round2(total) });
  return { id: po.id, number };
});
define('po.approve', G.finance.concat(['maintenance']), async (ctx, i, c) => {
  const po = await core.lock(c, 'purchase_orders', V.uuid(i, 'id', { req: true }), 'purchase order');
  if (po.status !== 'requested') throw conflict('state', 'الطلب ليس في انتظار الموافقة', 'The request is not awaiting approval');
  if (ctx.user.role === 'maintenance' && po.created_by === ctx.user.name) throw conflict('sod', 'لا يمكن لنفس الشخص طلب واعتماد أمر الشراء', 'The same person cannot request and approve a purchase order');
  await c.query("UPDATE purchase_orders SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2", [ctx.user.id || null, po.id]);
  await core.audit(c, ctx, 'approve', 'purchase_order', po.number);
});
define('po.cancel', G.stock, async (ctx, i, c) => {
  const po = await core.lock(c, 'purchase_orders', V.uuid(i, 'id', { req: true }), 'purchase order');
  if (!['requested', 'approved'].includes(po.status)) throw conflict('state', 'لا يمكن إلغاء أمر تم الاستلام عليه', 'An order with receipts cannot be cancelled');
  await c.query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", [po.id]);
  await core.audit(c, ctx, 'update', 'purchase_order', po.number, { field: 'status', before: po.status, after: 'cancelled' });
});
define('po.receive', G.stock, async (ctx, i, c) => {
  const po = await core.lock(c, 'purchase_orders', V.uuid(i, 'id', { req: true }), 'purchase order');
  if (!['approved', 'partial'].includes(po.status)) throw conflict('state', 'أمر الشراء لازم يكون معتمد قبل الاستلام', 'The purchase order must be approved before receiving');
  const warehouseId = V.uuid(i, 'warehouseId', { req: true }); await activeWh(c, warehouseId, 'warehouseId');
  const date = V.date(i, 'date', { def: core.today() });
  const lines = (await c.query('SELECT * FROM po_lines WHERE po_id = $1 FOR UPDATE', [po.id])).rows;
  const want = V.arr(i, 'lines', { max: 100 });
  let value = 0, any = false;
  for (const l of lines) {
    const w = want.length ? want.find(x => x.lineId === l.id || x.itemId === l.item_id) : { qty: l.qty - l.received };
    if (!w) continue;
    const q = V.num(w, 'qty', { min: 0, def: 0 });
    if (!q) continue;
    if (l.received + q > l.qty + 1e-9) throw bad('qty', 'الكمية المستلمة أكبر من المطلوبة', 'Received quantity is more than ordered', 'lines');
    const m = await core.stockMove(c, ctx, { type: 'receipt', date, itemId: l.item_id, warehouseId, qty: q, unitCost: l.price, poId: po.id, ref: { ar: po.number, en: po.number } });
    await c.query('UPDATE po_lines SET received = received + $1 WHERE id = $2', [q, l.id]);
    value += m.value; any = true;
  }
  if (!any) throw bad('qty', 'لا توجد كميات للاستلام', 'Nothing to receive', 'lines');
  const after = (await c.query('SELECT bool_and(received >= qty) done FROM po_lines WHERE po_id = $1', [po.id])).rows[0].done;
  await c.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', [after ? 'received' : 'partial', po.id]);
  const s = await core.settings(c, ctx);
  const vat = round2(value * s.vatRate);
  await core.post(c, ctx, { date, sourceType: 'stock_receipt', sourceRef: po.number, desc: { ar: 'استلام مخزني ' + po.number, en: 'Goods receipt ' + po.number }, lines: [{ a: 'inventory', debit: value }, { a: 'vat_in', debit: vat }, { a: 'payables', credit: value + vat }] });
  await core.audit(c, ctx, 'update', 'purchase_order', po.number, { field: 'received', before: po.status, after: after ? 'received' : 'partial' });
  await core.emit(c, ctx, 'stock.received', { po: po.number, value: round2(value) });
  return { status: after ? 'received' : 'partial', value: round2(value) };
});
/* 3-way match: PO price × received qty vs. supplier invoice amount (before VAT) */
define('po.match', G.finance, async (ctx, i, c) => {
  const po = await core.lock(c, 'purchase_orders', V.uuid(i, 'id', { req: true }), 'purchase order');
  if (!['partial', 'received'].includes(po.status)) throw conflict('state', 'لا يوجد استلام للمطابقة', 'Nothing received to match');
  const invNo = V.str(i, 'invoiceNo', { req: true, max: 40 }), amount = V.num(i, 'amount', { req: true, min: 0 });
  const lines = (await c.query('SELECT qty, received, price FROM po_lines WHERE po_id = $1', [po.id])).rows;
  const receivedValue = round2(lines.reduce((s, l) => s + l.received * l.price, 0));
  const fullyReceived = lines.every(l => l.received >= l.qty);
  const diff = round2(amount - receivedValue);
  const match = Math.abs(diff) <= Math.max(1, receivedValue * 0.005) ? (fullyReceived ? 'matched' : 'qty_variance') : 'price_variance';
  await c.query('UPDATE purchase_orders SET match = $1, supplier_invoice_no = $2, supplier_invoice_amount = $3 WHERE id = $4', [match, invNo, amount, po.id]);
  await core.audit(c, ctx, 'update', 'purchase_order', po.number, { field: 'match', before: po.match, after: `${match} (${diff})` });
  return { match, receivedValue, difference: diff };
});

/* ---------- stock counts ---------- */
define('count.create', G.stock, async (ctx, i, c) => {
  const warehouseId = V.uuid(i, 'warehouseId', { req: true }); await activeWh(c, warehouseId, 'warehouseId');
  if ((await c.query("SELECT 1 FROM stock_counts WHERE warehouse_id = $1 AND status = 'in_progress'", [warehouseId])).rowCount) throw conflict('open', 'فيه جرد مفتوح على المخزن ده', 'There is already an open count for this warehouse');
  const date = V.date(i, 'date', { def: core.today() });
  const number = await core.nextNumber(c, ctx, 'CNT', date);
  const cnt = await insert(c, 'stock_counts', { company_id: ctx.companyId, number, warehouse_id: warehouseId, date, status: 'in_progress', created_by: ctx.user.name });
  const items = V.arr(i, 'itemIds', { max: 2000 });
  const rows = items.length ? (await c.query('SELECT i.id, coalesce(b.qty,0) qty FROM items i LEFT JOIN stock_balances b ON b.item_id = i.id AND b.warehouse_id = $1 WHERE i.id = ANY($2::uuid[])', [warehouseId, items])).rows
    : (await c.query('SELECT item_id id, qty FROM stock_balances WHERE warehouse_id = $1', [warehouseId])).rows;
  for (const r of rows) await insert(c, 'count_lines', { company_id: ctx.companyId, count_id: cnt.id, item_id: r.id, system_qty: r.qty, counted: r.qty });
  await core.audit(c, ctx, 'create', 'stock_count', number);
  return { id: cnt.id, number, lines: rows.length };
});
define('count.setLines', G.stock, async (ctx, i, c) => {
  const cnt = await core.lock(c, 'stock_counts', V.uuid(i, 'id', { req: true }), 'count');
  if (cnt.status !== 'in_progress') throw conflict('state', 'الجرد مقفول', 'The count is closed');
  for (const l of V.arr(i, 'lines', { req: true, max: 2000 })) {
    const itemId = V.uuid(l, 'itemId', { req: true }); const counted = V.num(l, 'counted', { req: true, min: 0 });
    const r = await c.query('UPDATE count_lines SET counted = $1 WHERE count_id = $2 AND item_id = $3', [counted, cnt.id, itemId]);
    if (!r.rowCount) { const bal = (await c.query('SELECT qty FROM stock_balances WHERE warehouse_id = $1 AND item_id = $2', [cnt.warehouse_id, itemId])).rows[0]; await insert(c, 'count_lines', { company_id: ctx.companyId, count_id: cnt.id, item_id: itemId, system_qty: bal ? bal.qty : 0, counted }); }
  }
});
define('count.approve', G.finance.concat(['maintenance']), async (ctx, i, c) => {
  const cnt = await core.lock(c, 'stock_counts', V.uuid(i, 'id', { req: true }), 'count');
  if (cnt.status !== 'in_progress') throw conflict('state', 'الجرد مقفول', 'The count is closed');
  const lines = (await c.query('SELECT * FROM count_lines WHERE count_id = $1', [cnt.id])).rows;
  let gain = 0, loss = 0;
  for (const l of lines) {
    const bal = (await c.query('SELECT qty FROM stock_balances WHERE warehouse_id = $1 AND item_id = $2', [cnt.warehouse_id, l.item_id])).rows[0];
    const now = bal ? Number(bal.qty) : 0;
    const diff = Math.round((l.counted - now) * 1000) / 1000;   // compare with the balance now (movements since the count started count too)
    if (!diff) continue;
    const m = await core.stockMove(c, ctx, { type: 'adjustment', date: cnt.date > core.today() ? core.today() : core.today(), itemId: l.item_id, warehouseId: cnt.warehouse_id, qty: diff, ref: { ar: 'فرق جرد ' + cnt.number, en: 'Count variance ' + cnt.number } });
    if (diff > 0) gain += Math.abs(m.value); else loss += Math.abs(m.value);
  }
  const date = core.today();
  if (gain > 0) await core.post(c, ctx, { date, sourceType: 'stock_count', sourceRef: cnt.number + '+', desc: { ar: 'زيادة جرد ' + cnt.number, en: 'Count gain ' + cnt.number }, lines: [{ a: 'inventory', debit: gain }, { a: 'inv_variance', credit: gain }] });
  if (loss > 0) await core.post(c, ctx, { date, sourceType: 'stock_count', sourceRef: cnt.number + '-', desc: { ar: 'عجز جرد ' + cnt.number, en: 'Count shortage ' + cnt.number }, lines: [{ a: 'inv_variance', debit: loss }, { a: 'inventory', credit: loss }] });
  await c.query("UPDATE stock_counts SET status = 'approved', approved_by = $1 WHERE id = $2", [ctx.user.id || null, cnt.id]);
  await core.audit(c, ctx, 'approve', 'stock_count', cnt.number, { field: 'variance', before: '', after: `+${round2(gain)} / -${round2(loss)}` });
  return { gain: round2(gain), loss: round2(loss) };
});
