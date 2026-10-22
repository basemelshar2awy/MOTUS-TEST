'use strict';
/* Operating contracts: the company rents vehicles out under terms priced in advance on MOTUS.
   - with or without the company's driver; per trip or per period (week / 2 weeks / month, which
     is also the billing cycle); exclusive (the vehicle does nothing else in the contract's working
     hours) or allowing extra work;
   - the operator (this company) keeps paying maintenance, fuel and oils as usual (they stay
     ordinary MOTUS costs of the vehicle);
   - whoever runs the work (MOTUS, a Sabeel module, an outside system) confirms each finished trip
     (contract.trip — screen or Open API, idempotent by the caller's reference) and MOTUS prices it;
   - contract.bill turns a finished cycle into an invoice (trips × rate, or vehicles × periods). */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const { insert } = require('../lib/sql');
const { bad, conflict, notFound } = require('../lib/errors');
const { createInvoice } = require('./finance');

const CYCLES = ['week', '2weeks', 'month'];
const CYCLE_NAME = { week: ['أسبوع', 'week'], '2weeks': ['أسبوعين', '2 weeks'], month: ['شهر', 'month'] };
const MANAGE = ['company_admin', 'fleet_manager', 'operations', 'accountant'];
const CONFIRM = ['company_admin', 'fleet_manager', 'operations'];   // + Open API keys (contracts:write)

const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
/* last day of the cycle that starts on `from` */
function cycleEnd(cycle, from) {
  if (cycle === 'week') return core.addDays(from, 6);
  if (cycle === '2weeks') return core.addDays(from, 13);
  const d = new Date(from + 'T00:00:00Z'), day = d.getUTCDate();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return core.addDays(next.toISOString().slice(0, 10), -1);
}

function fields(i, isNew) {
  const f = {};
  const name = V.text2(i, 'name', { req: isNew, max: 160 }); if (name.ar) { f.name_ar = name.ar; f.name_en = name.en; }
  if (isNew || i.channel != null) f.channel = V.oneOf(i, 'channel', ['motus', 'sabeel', 'external'], { def: 'external' });
  if (isNew || i.externalSystem != null) f.external_system = V.str(i, 'externalSystem', { max: 120, def: '' });
  if (isNew || i.pricing != null) f.pricing = V.oneOf(i, 'pricing', ['per_trip', 'per_period'], { req: isNew });
  if (isNew || i.rate != null) f.rate = V.num(i, 'rate', { req: isNew, min: 0, max: 1e8 });
  if (isNew || i.cycle != null) f.cycle = V.oneOf(i, 'cycle', CYCLES, { def: 'month' });
  if (isNew || i.withDriver != null) f.with_driver = V.bool(i, 'withDriver', true);
  if (isNew || i.exclusive != null) f.exclusive = V.bool(i, 'exclusive', false);
  if (isNew || i.workDays != null) {
    const days = i.workDays == null ? [0, 1, 2, 3, 4, 5, 6] : V.arr(i, 'workDays', { min: 1, max: 7 }).map(x => V.int({ x }, 'x', { req: true, min: 0, max: 6 }));
    f.work_days = [...new Set(days)].sort();
  }
  if (isNew || i.workStart != null) f.work_start = V.time(i, 'workStart', { def: '00:00' });
  if (isNew || i.workEnd != null) f.work_end = V.time(i, 'workEnd', { def: '23:59' });
  if (isNew || i.startDate != null) f.start_date = V.date(i, 'startDate', { req: isNew });
  if (isNew || i.endDate !== undefined) f.end_date = V.date(i, 'endDate');
  const terms = V.text2(i, 'terms', { max: 4000 }); if (terms.ar) { f.terms_ar = terms.ar; f.terms_en = terms.en; }
  if (i.externalRef != null) f.external_ref = V.str(i, 'externalRef', { max: 80 });
  return f;
}

async function addVehicle(c, ctx, k, row, defFrom) {
  const vehicleId = V.uuid(row, 'vehicleId', { req: true });
  const v = await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  if (v.status === 'sold') throw bad('vehicle', `المركبة ${v.code} مباعة`, `Vehicle ${v.code} is sold`, 'vehicleId');
  const from = V.date(row, 'fromDate', { def: defFrom || (k.start_date > core.today() ? k.start_date : core.today()) });
  if (from < k.start_date || (k.end_date && from > k.end_date)) throw bad('fromDate', 'تاريخ دخول المركبة خارج مدة العقد', 'The vehicle start date is outside the contract', 'fromDate');
  let driverId = V.uuid(row, 'driverId');
  if (k.with_driver && !driverId) driverId = v.driver_id;   // the vehicle's own driver goes with it
  if (!k.with_driver) driverId = null;
  if (driverId) await core.mustExist(c, 'drivers', driverId, 'driver');
  if ((await c.query('SELECT 1 FROM contract_vehicles WHERE contract_id = $1 AND vehicle_id = $2 AND (to_date IS NULL OR to_date >= $3)', [k.id, vehicleId, from])).rowCount) throw conflict('on_contract', `المركبة ${v.code} على العقد بالفعل`, `Vehicle ${v.code} is already on this contract`);
  // one exclusive contract at a time per vehicle
  const other = (await c.query(`SELECT k.number FROM contract_vehicles cv JOIN contracts k ON k.id = cv.contract_id
      WHERE cv.vehicle_id = $1 AND k.id <> $2 AND k.status = 'active' AND (k.exclusive OR $3) AND (cv.to_date IS NULL OR cv.to_date >= $4) AND (k.end_date IS NULL OR k.end_date >= $4)`, [vehicleId, k.id, k.exclusive, from])).rows[0];
  if (other) throw conflict('exclusive', `المركبة ${v.code} عليها عقد ${other.number}، ومينفعش تبقى على عقدين واحد منهم حصري`, `Vehicle ${v.code} is on contract ${other.number}; it cannot be on two contracts when one is exclusive`);
  await insert(c, 'contract_vehicles', { company_id: ctx.companyId, contract_id: k.id, vehicle_id: vehicleId, driver_id: driverId, from_date: from, to_date: k.end_date || null });
  return v.code;
}

define('contract.create', MANAGE, async (ctx, i, c) => {
  const client = await core.mustExist(c, 'clients', V.uuid(i, 'clientId', { req: true }), 'client');
  const f = fields(i, true);
  if (f.end_date && f.end_date < f.start_date) throw bad('endDate', 'نهاية العقد قبل بدايته', 'The contract ends before it starts', 'endDate');
  const number = await core.nextNumber(c, ctx, 'CT', f.start_date);
  const k = await insert(c, 'contracts', Object.assign({ company_id: ctx.companyId, number, client_id: client.id, created_by: ctx.user.name || '' }, f, {
    terms_ar: f.terms_ar || 'المشغّل (الشركة) يتحمل الصيانة والوقود والزيوت.', terms_en: f.terms_en || 'The operator (the company) bears maintenance, fuel and oils.',
  }));
  const codes = [];
  for (const row of V.arr(i, 'vehicles', { max: 200 })) codes.push(await addVehicle(c, ctx, k, row, k.start_date));
  await core.audit(c, ctx, 'create', 'contract', number, { field: 'vehicles', before: '', after: codes.join(', ') });
  return { id: k.id, number };
});

define('contract.update', MANAGE, async (ctx, i, c) => {
  const k = await core.lock(c, 'contracts', V.uuid(i, 'id', { req: true }), 'contract');
  if (k.status !== 'active') throw conflict('state', 'العقد منتهي أو ملغي', 'The contract is ended or cancelled');
  const f = fields(i, false);
  if (f.start_date && k.billed_to) throw conflict('billed', 'العقد اتفوتر، مينفعش تغيير بدايته', 'The contract has been billed; its start cannot change');
  if (f.pricing && f.pricing !== k.pricing && k.billed_to) throw conflict('billed', 'العقد اتفوتر، مينفعش تغيير طريقة التسعير', 'The contract has been billed; its pricing method cannot change');
  const sets = Object.keys(f);
  if (sets.length) await c.query(`UPDATE contracts SET ${sets.map((x, n) => `${x} = $${n + 1}`).join(', ')} WHERE id = $${sets.length + 1}`, [...sets.map(x => f[x]), k.id]);
  await core.audit(c, ctx, 'update', 'contract', k.number, { field: sets.join(', ') });
});

define('contract.addVehicle', MANAGE, async (ctx, i, c) => {
  const k = await core.lock(c, 'contracts', V.uuid(i, 'id', { req: true }), 'contract');
  if (k.status !== 'active') throw conflict('state', 'العقد منتهي أو ملغي', 'The contract is ended or cancelled');
  const code = await addVehicle(c, ctx, k, i);
  await core.audit(c, ctx, 'update', 'contract', k.number, { field: 'vehicles', before: '', after: '+' + code });
});
define('contract.removeVehicle', MANAGE, async (ctx, i, c) => {
  const k = await core.lock(c, 'contracts', V.uuid(i, 'id', { req: true }), 'contract');
  const vehicleId = V.uuid(i, 'vehicleId', { req: true });
  const to = V.date(i, 'toDate', { def: core.today() });
  const r = await c.query('UPDATE contract_vehicles SET to_date = greatest(from_date, $3::date) WHERE contract_id = $1 AND vehicle_id = $2 AND (to_date IS NULL OR to_date > $3) RETURNING id', [k.id, vehicleId, to]);
  if (!r.rowCount) throw notFound('vehicle');
  await core.audit(c, ctx, 'update', 'contract', k.number, { field: 'vehicles', before: vehicleId, after: 'until ' + to });
});
define('contract.end', MANAGE, async (ctx, i, c) => {
  const k = await core.lock(c, 'contracts', V.uuid(i, 'id', { req: true }), 'contract');
  if (k.status !== 'active') throw conflict('state', 'العقد منتهي أو ملغي', 'The contract is ended or cancelled');
  const end = V.date(i, 'endDate', { def: core.today() });
  if (end < k.start_date) throw bad('endDate', 'نهاية العقد قبل بدايته', 'The contract ends before it starts', 'endDate');
  await c.query("UPDATE contracts SET status = 'ended', end_date = $2 WHERE id = $1", [k.id, end]);
  await c.query('UPDATE contract_vehicles SET to_date = greatest(from_date, $2::date) WHERE contract_id = $1 AND (to_date IS NULL OR to_date > $2)', [k.id, end]);
  await core.audit(c, ctx, 'update', 'contract', k.number, { field: 'status', before: 'active', after: 'ended ' + end });
});

/* a finished trip under the contract, confirmed by whoever ran it (MOTUS screen, Sabeel module,
   outside system). The same reference twice returns the first trip (safe to retry). */
define('contract.trip', CONFIRM, async (ctx, i, c) => {
  // Open API: POST /contracts/{id}/trips passes the contract as id
  const k = await core.lock(c, 'contracts', V.uuid(i.contractId ? i : { contractId: i.id }, 'contractId', { req: true }), 'contract');
  const ref = V.str(i, 'externalRef', { max: 80 });
  if (ref) {
    const dup = (await c.query('SELECT id, number, revenue FROM trips WHERE contract_id = $1 AND external_ref = $2', [k.id, ref])).rows[0];
    if (dup) return { id: dup.id, number: dup.number, revenue: Number(dup.revenue), replayed: true };
  }
  const date = V.date(i, 'date', { req: true });
  if (date > core.today()) throw bad('date', 'الرحلة لسه ماحصلتش — التأكيد بيكون بعد ما الرحلة تخلص', 'The trip has not happened yet — confirm trips after they finish', 'date');
  if (date < k.start_date || (k.end_date && date > k.end_date)) throw bad('date', `التاريخ خارج مدة العقد ${k.number}`, `The date is outside contract ${k.number}`, 'date');
  if (k.status === 'cancelled') throw conflict('state', 'العقد ملغي', 'The contract is cancelled');
  if (k.billed_to && date <= k.billed_to && k.pricing === 'per_trip') throw conflict('billed', `الفترة لحد ${k.billed_to} اتفوترت بالفعل`, `The period up to ${k.billed_to} is already billed`);
  const vehicleId = V.uuid(i, 'vehicleId', { req: true });
  const cv = (await c.query('SELECT * FROM contract_vehicles WHERE contract_id = $1 AND vehicle_id = $2 AND from_date <= $3 AND (to_date IS NULL OR to_date >= $3) LIMIT 1', [k.id, vehicleId, date])).rows[0];
  if (!cv) throw bad('vehicleId', 'المركبة مش على العقد في التاريخ ده', 'The vehicle is not on the contract on that date', 'vehicleId');
  const v = await core.lock(c, 'vehicles', vehicleId, 'vehicle');
  const start = V.time(i, 'startTime', { req: true }), end = V.time(i, 'endTime', { req: true });
  const km = V.int(i, 'km', { min: 0, max: 2500 });
  const pax = V.int(i, 'pax', { min: 1, max: 1000, def: 1 });
  const source = k.channel === 'motus' ? 'motus' : k.channel;
  const number = await core.nextNumber(c, ctx, 'TR', date);
  const revenue = k.pricing === 'per_trip' ? Number(k.rate) : 0;   // per-period contracts are billed by the period
  const startKm = km != null ? v.odometer : null, endKm = km != null ? v.odometer + km : null;
  const t = await insert(c, 'trips', {
    company_id: ctx.companyId, number, client_id: k.client_id, vehicle_id: vehicleId, driver_id: k.with_driver ? cv.driver_id : null, date, type: 'contract',
    from_place: V.str(i, 'from', { max: 120, def: '' }), to_place: V.str(i, 'to', { max: 120, def: '' }), start_time: start, end_time: end,
    start_km: startKm, end_km: endKm, km: km || 0, revenue, pax, status: 'completed', started_at: new Date(), completed_at: new Date(),
    source, contract_id: k.id, external_ref: ref, created_by: ctx.user.name || '',
  });
  if (km) await c.query('UPDATE vehicles SET odometer = greatest(odometer, $2) WHERE id = $1', [vehicleId, endKm]);
  await core.audit(c, ctx, 'create', 'trip', number, { field: 'contract', before: '', after: `${k.number}${ref ? ' / ' + ref : ''}` });
  await core.emit(c, ctx, 'trip.completed', { id: t.id, number, contract: k.number, vehicleId, date, revenue, source });
  return { id: t.id, number, revenue };
});

/* bill a finished cycle (or up to a date when the contract ends early) */
define('contract.bill', ['company_admin', 'fleet_manager', 'accountant'], async (ctx, i, c) => {
  const k = await core.lock(c, 'contracts', V.uuid(i, 'id', { req: true }), 'contract');
  if (k.status === 'cancelled') throw conflict('state', 'العقد ملغي', 'The contract is cancelled');
  const from = k.billed_to ? core.addDays(k.billed_to, 1) : k.start_date;
  if (k.end_date && from > k.end_date) throw conflict('done', 'العقد اتفوتر بالكامل', 'The contract is fully billed');
  let to = V.date(i, 'to');
  if (!to) {
    to = cycleEnd(k.cycle, from);
    if (k.end_date && to > k.end_date) to = k.end_date;
    if (to >= core.today()) throw conflict('cycle_open', `الدورة الحالية (${from} → ${to}) لسه ماخلصتش`, `The current cycle (${from} → ${to}) has not ended yet`);
  }
  if (k.billed_to && to <= k.billed_to) throw conflict('billed', `العقد متفوتر لحد ${k.billed_to}`, `The contract is billed up to ${k.billed_to}`);
  if (to < from) throw bad('to', 'تاريخ الفوترة قبل بداية الفترة', 'The billing date is before the period start', 'to');
  if (to >= core.today()) throw bad('to', 'الفوترة بتكون لأيام خلصت (لحد امبارح)', 'Only finished days can be billed (up to yesterday)', 'to');
  const client = await core.mustExist(c, 'clients', k.client_id, 'client');
  const lines = [];
  let tripIds = [];
  if (k.pricing === 'per_trip') {
    const trips = (await c.query(`SELECT t.id, t.vehicle_id, t.revenue, v.code FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.contract_id = $1 AND t.status = 'completed' AND t.invoice_id IS NULL AND t.date <= $2 ORDER BY v.code, t.date`, [k.id, to])).rows;
    const groups = {};
    for (const t of trips) { const g = groups[t.code + '|' + t.revenue] = groups[t.code + '|' + t.revenue] || { code: t.code, unit: Number(t.revenue), n: 0 }; g.n++; }
    for (const g of Object.values(groups)) lines.push({ ar: `عقد ${k.number} · مركبة ${g.code} · ${g.n} رحلة · من ${from} إلى ${to}`, en: `Contract ${k.number} · vehicle ${g.code} · ${g.n} trips · ${from} to ${to}`, qty: g.n, unit: g.unit, revKey: 'revenue_contract', contractId: k.id, periodFrom: from, periodTo: to });
    tripIds = trips.map(t => t.id);
  } else {
    // vehicles × periods: a vehicle on the contract for part of a cycle pays its share of the days
    const cvs = (await c.query('SELECT cv.*, v.code FROM contract_vehicles cv JOIN vehicles v ON v.id = cv.vehicle_id WHERE cv.contract_id = $1 ORDER BY v.code, cv.from_date', [k.id])).rows;
    for (let a = from; a <= to;) {
      const full = cycleEnd(k.cycle, a), b = full < to ? full : to, cycleDays = daysBetween(a, full) + 1;
      for (const cv of cvs) {
        const s = cv.from_date > a ? cv.from_date : a, e = cv.to_date && cv.to_date < b ? cv.to_date : b;
        if (s > e) continue;
        const qty = Math.round(((daysBetween(s, e) + 1) / cycleDays) * 1000) / 1000;   // invoice quantities keep 3 decimals
        const [cn, ce] = CYCLE_NAME[k.cycle];
        lines.push({ ar: `عقد ${k.number} · مركبة ${cv.code} · ${qty === 1 ? cn + ' كامل' : 'جزء من ' + cn + ' (' + (daysBetween(s, e) + 1) + ' يوم من ' + cycleDays + ')'} · من ${s} إلى ${e}`, en: `Contract ${k.number} · vehicle ${cv.code} · ${qty === 1 ? 'full ' + ce : 'part of a ' + ce + ' (' + (daysBetween(s, e) + 1) + ' of ' + cycleDays + ' days)'} · ${s} to ${e}`, qty, unit: Number(k.rate), revKey: 'revenue_contract', contractId: k.id, periodFrom: s, periodTo: e });
      }
      a = core.addDays(b, 1);
    }
  }
  if (!lines.length || !lines.some(l => l.qty * l.unit > 0)) throw conflict('nothing', 'مفيش حاجة تتفوتر في الفترة دي', 'Nothing to bill for this period');
  const inv = await createInvoice(c, ctx, client, lines.filter(l => l.qty > 0), { issueDate: core.today(), source: 'contract' });
  if (tripIds.length) await c.query('UPDATE trips SET invoice_id = $1 WHERE id = ANY($2::uuid[])', [inv.id, tripIds]);
  await c.query('UPDATE contracts SET billed_to = $2 WHERE id = $1', [k.id, to]);
  return { id: inv.id, number: inv.number, from, to, total: Number(inv.total) };
});

/* used by booking checks: is the vehicle (or driver) reserved by an exclusive contract at that time?
   start/end are minutes from midnight of `date` (end may pass midnight). */
async function exclusiveClash(c, col, id, date, start, end) {
  const rows = (await c.query(`SELECT k.number, k.name_ar, k.name_en, k.work_days, k.work_start, k.work_end, cv.from_date, cv.to_date, k.start_date, k.end_date
      FROM contract_vehicles cv JOIN contracts k ON k.id = cv.contract_id
     WHERE cv.${col} = $1 AND k.exclusive AND k.status = 'active' AND (${col === 'driver_id' ? 'k.with_driver' : 'true'})
       AND cv.from_date <= $2::date + 1 AND (cv.to_date IS NULL OR cv.to_date >= $2::date - 1)`, [id, date])).rows;
  for (const k of rows) {
    for (let d = -1; d <= Math.floor(end / 1440); d++) {
      const day = core.addDays(date, d);
      if (day < k.start_date || (k.end_date && day > k.end_date) || day < k.from_date || (k.to_date && day > k.to_date)) continue;
      if (!k.work_days.map(Number).includes(dow(day))) continue;
      const ws = mins(k.work_start) + d * 1440; let we = mins(k.work_end) + d * 1440;
      if (we <= ws) we += 1440;   // overnight shift
      if (start < we && end > ws) return k;
    }
  }
  return null;
}

module.exports = { exclusiveClash, cycleEnd };
