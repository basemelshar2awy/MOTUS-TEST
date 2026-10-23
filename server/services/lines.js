'use strict';
/* Lines: recurring runs of the education (schools, universities), staff (shifts) and intercity
   (scheduled departures) activities. A line has its stops, a go and/or return time, its days,
   its period (term, contract), its vehicle and driver, and a headcount — never the names of the
   students, employees or passengers (they live in the Sabeel module that serves them).
   line.generate creates the bookings and trips of the coming days; a run whose vehicle or driver
   is busy stays as an unassigned booking with the reason, so dispatch can place it. */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const profiles = require('../lib/profiles');
const activities = require('../lib/activities');
const { insert } = require('../lib/sql');
const { bad, conflict } = require('../lib/errors');
const ops = require('./ops');

const LINE_ACTIVITIES = ['education', 'staff', 'intercity'];
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();

async function lineActivity(c, ctx, i) {
  const list = (await activities.enabled(c, ctx)).filter(a => LINE_ACTIVITIES.includes(a));
  const a = V.oneOf(i, 'activity', LINE_ACTIVITIES, { def: list.length === 1 ? list[0] : null });
  if (!a) throw bad('activity', list.length ? 'اختار نشاط الخط' : 'الخطوط للمدارس والجامعات والموظفين وبين المدن', list.length ? "Choose the line's activity" : 'Lines are for education, staff and intercity', 'activity');
  if (!list.includes(a)) throw activities.disabledError(a);
  return a;
}
async function placeCode(c, code, field) {
  if (!(await c.query('SELECT 1 FROM places WHERE code = $1', [code])).rowCount) throw bad(field, `المكان ${code} مش موجود`, `Place ${code} does not exist`, field);
  return code;
}
async function fields(c, ctx, i, isNew, old) {
  const f = {};
  const has = k => isNew || Object.prototype.hasOwnProperty.call(i, k);
  const name = V.text2(i, 'name', { req: isNew, max: 160 }); if (name.ar) { f.name_ar = name.ar; f.name_en = name.en; }
  if (has('clientId')) f.client_id = (await core.mustExist(c, 'clients', V.uuid(i, 'clientId', { req: true }), 'client')).id;
  if (has('contractId')) { const k = V.uuid(i, 'contractId'); if (k) await core.mustExist(c, 'contracts', k, 'contract'); f.contract_id = k; }
  if (has('from')) f.from_place = await placeCode(c, V.str(i, 'from', { req: true, max: 12 }), 'from');
  if (has('to')) f.to_place = await placeCode(c, V.str(i, 'to', { req: true, max: 12 }), 'to');
  if (has('stops')) { f.stops = []; for (const s of V.arr(i, 'stops', { max: 40 })) f.stops.push(await placeCode(c, V.str({ s }, 's', { req: true, max: 12 }), 'stops')); }
  if (has('goTime')) f.go_time = V.time(i, 'goTime');
  if (has('returnTime')) f.return_time = V.time(i, 'returnTime');
  if (has('durationMin')) f.duration_min = V.int(i, 'durationMin', { min: 5, max: 1440, def: 60 });
  if (has('days')) f.days = [...new Set((i.days == null ? [0, 1, 2, 3, 4] : V.arr(i, 'days', { min: 1, max: 7 })).map(x => V.int({ x }, 'x', { req: true, min: 0, max: 6 })))].sort();
  if (has('startDate')) f.start_date = V.date(i, 'startDate', { req: true });
  if (has('endDate')) f.end_date = V.date(i, 'endDate');
  if (has('vehicleType')) f.vehicle_type = V.str(i, 'vehicleType', { req: true, max: 8 });
  if (has('vehicleId')) { const v = V.uuid(i, 'vehicleId'); if (v) await core.mustExist(c, 'vehicles', v, 'vehicle'); f.vehicle_id = v; }
  if (has('driverId')) { const d = V.uuid(i, 'driverId'); if (d) await core.mustExist(c, 'drivers', d, 'driver'); f.driver_id = d; }
  if (has('headcount')) f.headcount = V.int(i, 'headcount', { req: isNew, min: 1, max: 1000 });
  if (has('pricePerRun')) f.price_per_run = V.num(i, 'pricePerRun', { min: 0, def: 0 });
  if (has('notes')) f.notes = V.str(i, 'notes', { max: 1000, def: '' });
  const go = f.go_time !== undefined ? f.go_time : old && old.go_time, back = f.return_time !== undefined ? f.return_time : old && old.return_time;
  if (!go && !back) throw bad('goTime', 'حدد ميعاد الذهاب أو العودة', 'Set the go or the return time', 'goTime');
  const s = f.start_date || (old && old.start_date), e = f.end_date !== undefined ? f.end_date : old && old.end_date;
  if (e && s && e < s) throw bad('endDate', 'نهاية الخط قبل بدايته', 'The line ends before it starts', 'endDate');
  // the vehicle must hold the headcount
  const vid = f.vehicle_id !== undefined ? f.vehicle_id : old && old.vehicle_id, head = f.headcount || (old && old.headcount);
  if (vid && head) { const v = (await c.query('SELECT code, seats FROM vehicles WHERE id = $1', [vid])).rows[0]; if (v.seats > 0 && v.seats < head) throw bad('vehicleId', `المركبة ${v.code} فيها ${v.seats} مقعد بس`, `Vehicle ${v.code} only has ${v.seats} seats`, 'vehicleId'); }
  return f;
}

define('line.create', G.ops, async (ctx, i, c) => {
  const activity = await lineActivity(c, ctx, i);
  const f = await fields(c, ctx, i, true);
  const number = await core.nextNumber(c, ctx, 'LN', f.start_date);
  const l = await insert(c, 'lines', Object.assign({ company_id: ctx.companyId, number, activity, created_by: ctx.user.name }, f));
  await core.audit(c, ctx, 'create', 'line', `${number} ${f.name_ar}`);
  return { id: l.id, number };
});
define('line.update', G.ops, async (ctx, i, c) => {
  const l = await core.lock(c, 'lines', V.uuid(i, 'id', { req: true }), 'line');
  const f = await fields(c, ctx, i, false, l);
  const st = V.oneOf(i, 'status', ['active', 'paused', 'ended']); if (st) f.status = st;
  const keys = Object.keys(f);
  if (keys.length) await c.query(`UPDATE lines SET ${keys.map((k, n) => `${k} = $${n + 1}`).join(', ')} WHERE id = $${keys.length + 1}`, [...keys.map(k => f[k]), l.id]);
  await core.audit(c, ctx, 'update', 'line', l.number, { field: keys.join(', ') });
});

/* create the runs of the coming days (default: the next 7 days) */
define('line.generate', G.ops, async (ctx, i, c) => {
  const l = await core.lock(c, 'lines', V.uuid(i, 'id', { req: true }), 'line');
  if (l.status !== 'active') throw conflict('state', 'الخط موقوف أو منتهي', 'The line is paused or ended');
  const today = core.today();
  let to = V.date(i, 'to', { def: core.addDays(today, 7) });
  if (to > core.addDays(today, 62)) throw bad('to', 'التوليد لحد شهرين قدام بس', 'Runs can be created up to two months ahead', 'to');
  if (l.end_date && to > l.end_date) to = l.end_date;
  let from = V.date(i, 'from', { def: today });
  if (from < l.start_date) from = l.start_date;
  const prof = profiles.PROFILES[l.activity];
  const k = l.contract_id ? (await c.query('SELECT id, pricing, rate, status FROM contracts WHERE id = $1', [l.contract_id])).rows[0] : null;
  const price = k ? (k.pricing === 'per_trip' ? Number(k.rate) : 0) : Number(l.price_per_run);
  const out = { created: 0, assigned: 0, skipped: 0, unassigned: [] };
  for (let d = from; d <= to; d = core.addDays(d, 1)) {
    if (!l.days.map(Number).includes(dow(d))) continue;
    for (const [leg, time, a, b] of [['go', l.go_time, l.from_place, l.to_place], ['return', l.return_time, l.to_place, l.from_place]]) {
      if (!time) continue;
      if ((await c.query("SELECT 1 FROM bookings WHERE line_id = $1 AND date = $2 AND line_leg = $3 AND status <> 'cancelled'", [l.id, d, leg])).rowCount) { out.skipped++; continue; }
      const res = await ops.createBooking(ctx, { activity: l.activity, tripType: prof.lineLegs[leg], clientId: l.client_id, date: d, time, pax: l.headcount, pickup: a, destination: b, vehicleType: l.vehicle_type, price, status: 'confirmed', backdated: true }, c, { lineId: l.id, lineLeg: leg, contractId: l.contract_id });
      out.created++;
      if (l.vehicle_id) {
        // a busy vehicle or driver leaves this run unassigned, with the reason, instead of stopping the rest
        await c.query('SAVEPOINT line_run');
        try {
          const bk = (await c.query('SELECT * FROM bookings WHERE id = $1', [res.id])).rows[0];
          await ops.assign(c, ctx, bk, l.vehicle_id, l.driver_id, { lineLeg: leg, contractId: l.contract_id, revenue: price });
          await c.query('RELEASE SAVEPOINT line_run'); out.assigned++;
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT line_run');
          out.unassigned.push({ date: d, leg, time, reason: e.msg || { ar: e.message, en: e.message } });
        }
      }
    }
  }
  await c.query('UPDATE lines SET generated_to = greatest(coalesce(generated_to, $2::date), $2::date) WHERE id = $1', [l.id, to]);
  await core.audit(c, ctx, 'create', 'line_runs', l.number, { field: 'runs', before: '', after: `${out.created} (${from} → ${to})` });
  return Object.assign(out, { from, to });
});

module.exports = { LINE_ACTIVITIES };
