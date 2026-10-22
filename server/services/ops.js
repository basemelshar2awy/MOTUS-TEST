'use strict';
/* Operations & dispatch: clients, tour programs, bookings, assignment, trips, driver availability,
   subcontracting, accidents, fines, shift handover, documents. */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound, AppError } = require('../lib/errors');
const vtypes = require('../lib/vehicletypes');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const P = (o, f, fn, ...a) => (has(o, f) ? fn(o, f, ...a) : undefined);
const round2 = V.round2;
const toMin = s => (+s.slice(0, 2)) * 60 + (+s.slice(3, 5));
const fromMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/* ===================== CLIENTS ===================== */
function clientFields(i) {
  const name = P(i, 'name', V.text2, { max: 160 }), contact = P(i, 'contact', V.text2, { max: 120 }), address = P(i, 'address', V.text2, { max: 300 });
  return defined({
    name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, type: P(i, 'type', V.oneOf, ['agency', 'hotel', 'company', 'individual']),
    tax_no: P(i, 'taxNo', V.str, { max: 30, def: '' }), cr_no: P(i, 'crNo', V.str, { max: 30, def: '' }),
    contact_ar: contact ? contact.ar : undefined, contact_en: contact ? contact.en : undefined, phone: P(i, 'phone', V.str, { max: 30, def: '' }),
    email: has(i, 'email') ? (V.email(i, 'email') || '') : undefined, address_ar: address ? address.ar : undefined, address_en: address ? address.en : undefined,
    terms: P(i, 'terms', V.int, { min: 0, max: 365 }), credit_limit: P(i, 'creditLimit', V.num, { min: 0 }), currency: P(i, 'currency', V.oneOf, ['EGP', 'USD', 'EUR', 'GBP', 'SAR']),
    status: P(i, 'status', V.oneOf, ['active', 'inactive']), external_ref: P(i, 'externalRef', V.str, { max: 80 }),
  });
}
async function createClient(ctx, i, c) {
  const f = clientFields(i);
  if (!f.name_ar) throw bad('required', 'اسم العميل مطلوب', 'The client name is required', 'name');
  f.type = f.type || 'company';
  let code = V.str(i, 'code', { max: 20 });
  if (!code) { const n = (await c.query('SELECT count(*)::int n FROM clients')).rows[0].n; for (let k = n + 1; ; k++) { code = `CL-${String(k).padStart(3, '0')}`; if (!(await c.query('SELECT 1 FROM clients WHERE code = $1', [code])).rowCount) break; } }
  if (f.terms == null) f.terms = (await core.settings(c, ctx)).defaultTerms;
  const cl = await insert(c, 'clients', Object.assign({ company_id: ctx.companyId, code, created_by: ctx.user.name }, f));
  await core.audit(c, ctx, 'create', 'client', `${code} ${cl.name_ar}`);
  await core.emit(c, ctx, 'client.created', { id: cl.id, code, name: cl.name_en });
  return { id: cl.id, code };
}
define('client.create', G.opsFin, createClient);
define('client.update', G.opsFin, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const old = await core.lock(c, 'clients', id, 'client');
  const f = clientFields(i); await update(c, 'clients', id, f);
  await core.audit(c, ctx, 'update', 'client', old.code, { field: Object.keys(f).join(', ') });
});

async function clientBalance(c, clientId) {
  const r = await c.query(`SELECT coalesce(sum(i.total - i.paid - coalesce((SELECT sum(cn.total) FROM credit_notes cn WHERE cn.invoice_id = i.id),0)),0) bal
    FROM invoices i WHERE i.client_id = $1 AND i.status NOT IN ('cancelled','draft')`, [clientId]);
  const open = await c.query("SELECT coalesce(sum(b.price - b.paid),0) s FROM bookings b WHERE b.client_id = $1 AND b.status IN ('confirmed','tentative') AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.booking_id = b.id AND t.invoice_id IS NOT NULL)", [clientId]);
  return { invoiced: Math.max(0, r.rows[0].bal), uninvoiced: open.rows[0].s };
}
async function creditCheck(c, ctx, client, amount, override) {
  if (!client.credit_limit || client.credit_limit <= 0) return null;
  const b = await clientBalance(c, client.id);
  const exposure = round2(b.invoiced + b.uninvoiced + amount);
  if (exposure <= client.credit_limit) return null;
  if (override && ['company_admin', 'fleet_manager', 'accountant', 'super_admin'].includes(ctx.user.role)) return { exposure, limit: client.credit_limit };
  throw new AppError(409, 'credit_limit', `العميل هيتجاوز حد الائتمان (${client.credit_limit}). الرصيد المتوقع ${exposure}. يلزم موافقة مدير/محاسب.`, `This exceeds the client's credit limit (${client.credit_limit}); exposure would be ${exposure}. A manager or accountant must approve.`, { field: 'price' });
}

/* ===================== ROUTES / PLACES helpers ===================== */
async function place(c, code, field) {
  const r = await c.query('SELECT * FROM places WHERE code = $1', [code]);
  if (!r.rows[0]) throw bad('place', `المكان "${code}" غير معرّف`, `Place "${code}" is not defined`, field);
  return r.rows[0];
}
function haversineKm(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function routeInfo(c, from, to, type) {
  const r = (await c.query('SELECT * FROM routes WHERE from_code = $1 AND to_code = $2 ORDER BY ($3::text IS NOT NULL AND type = $3) DESC LIMIT 1', [from, to, type || null])).rows[0];
  if (r) return { km: r.km, type: type || r.type, hours: r.hours, gates: r.toll_gates, known: true };
  const a = await place(c, from, 'pickup'), b = await place(c, to, 'destination');
  const km = Math.max(10, Math.round(haversineKm(a, b) * 1.25));
  const t = type || (a.kind === 'airport' || b.kind === 'airport' ? 'airport' : km > 150 ? 'intercity' : 'city');
  return { km, type: t, hours: Math.max(1, km / 70), gates: 0, known: false };
}

/* ===================== AVAILABILITY CHECKS (server side, authoritative) =====================
   Times are minutes from the local midnight of `date` in the company's time zone; `end` may pass
   1440 (the trip ends the next day or later). Conflicts come from the unified calendar
   (vehicle_commitments / driver_commitments), which the database also guards against overlap;
   the 30-minute gap between two commitments is a business rule checked here. */
const GAP_MIN = 30;
async function windowOf(c, date, start, end) {
  const r = await c.query("SELECT local_moment(app_company_id(), $1::date, '00:00', $2) s, local_moment(app_company_id(), $1::date, '00:00', $3) e", [date, start, end]);
  return r.rows[0];
}
const KIND = { maintenance: ['صيانة', 'maintenance'], blocked: ['محجوزة', 'blocked'], leave: ['إجازة', 'leave'] };
async function calendarClashes(c, table, col, id, date, start, end, ignoreTripIds) {
  const w = await windowOf(c, date, start, end);
  return (await c.query(`SELECT k.kind, k.note, k.source_type, t.number, t.start_time, t.end_time, t.date
      FROM ${table} k LEFT JOIN trips t ON k.source_type = 'trip' AND t.id = k.source_id
     WHERE k.${col} = $1 AND k.during && tstzrange($2::timestamptz - make_interval(mins => ${GAP_MIN}), $3::timestamptz + make_interval(mins => ${GAP_MIN}), '[)')
       AND NOT (k.source_type = 'trip' AND k.source_id = ANY($4::uuid[]))
     ORDER BY lower(k.during)`, [id, w.s, w.e, ignoreTripIds])).rows;
}
async function checkVehicle(c, v, date, start, end, ignoreTripIds = [], pax, loadKg) {
  const reasons = [];
  if (['maintenance', 'stopped', 'sold'].includes(v.status)) reasons.push({ ar: 'المركبة غير متاحة (' + v.status + ')', en: `Vehicle is not available (${v.status})` });
  if (pax && v.seats > 0 && v.seats < pax) reasons.push({ ar: `السعة ${v.seats} أقل من ${pax} راكب`, en: `Capacity ${v.seats} is below ${pax} passengers` });
  if (pax > 1 && !(v.seats > 0)) reasons.push({ ar: 'المركبة دي للبضائع ومافيهاش كراسي ركاب', en: 'This vehicle carries cargo and has no passenger seats' });
  if (loadKg && Number(v.payload_kg) < loadKg) reasons.push({ ar: `الحمولة ${Number(v.payload_kg)} كجم أقل من ${loadKg} كجم`, en: `Payload ${Number(v.payload_kg)} kg is below ${loadKg} kg` });
  if (v.license_expiry && v.license_expiry < date) reasons.push({ ar: 'رخصة المركبة منتهية', en: 'Vehicle license expired' });
  if (v.insurance_expiry && v.insurance_expiry < date) reasons.push({ ar: 'تأمين المركبة منتهي', en: 'Vehicle insurance expired' });
  const hit = (await calendarClashes(c, 'vehicle_commitments', 'vehicle_id', v.id, date, start, end, ignoreTripIds))[0];
  if (hit) reasons.push(hit.number
    ? { ar: `متعارضة مع الرحلة ${hit.number} (${hit.date === date ? '' : hit.date + ' '}${hit.start_time}–${hit.end_time})`, en: `Overlaps trip ${hit.number} (${hit.date === date ? '' : hit.date + ' '}${hit.start_time}–${hit.end_time})` }
    : { ar: `المركبة ${(KIND[hit.kind] || [hit.kind])[0]} في الفترة دي ${hit.note}`.trim(), en: `Vehicle is ${(KIND[hit.kind] || [, hit.kind])[1]} in this period ${hit.note}`.trim() });
  return reasons;
}
async function checkDriver(c, d, date, start, end, ignoreTripIds = [], maxHours) {
  const reasons = [], warns = [];
  if (d.status !== 'active') reasons.push({ ar: 'السائق غير نشط', en: 'Driver is inactive' });
  if (d.license_expiry < date) reasons.push({ ar: 'رخصة السائق منتهية', en: "Driver's license expired" });
  const hits = await calendarClashes(c, 'driver_commitments', 'driver_id', d.id, date, start, end, ignoreTripIds);
  for (const h of hits) {
    if (h.kind === 'leave') reasons.push({ ar: 'السائق في ' + (h.note === 'leave' ? 'إجازة' : h.note === 'sick' ? 'إجازة مرضية' : 'راحة'), en: `Driver is on ${h.note}` });
    else if (h.number) reasons.push({ ar: `السائق مشغول في الرحلة ${h.number}`, en: `Driver is busy on trip ${h.number}` });
    else reasons.push({ ar: 'السائق محجوز في الفترة دي', en: 'Driver is blocked in this period' });
  }
  if (maxHours) {
    // driving hours already planned for that local day (trips only)
    const day = await windowOf(c, date, 0, 1440);
    const r = await c.query(`SELECT coalesce(sum(extract(epoch FROM (least(upper(during), $3::timestamptz) - greatest(lower(during), $2::timestamptz)))), 0) / 3600 h
        FROM driver_commitments WHERE driver_id = $1 AND kind = 'trip' AND during && tstzrange($2::timestamptz, $3::timestamptz, '[)') AND NOT (source_type = 'trip' AND source_id = ANY($4::uuid[]))`, [d.id, day.s, day.e, ignoreTripIds]);
    const hours = Number(r.rows[0].h) || 0;
    if (hours + (end - start) / 60 > maxHours) warns.push({ ar: `سيتجاوز ${maxHours} ساعات قيادة`, en: `Would exceed ${maxHours} driving hours` });
  }
  return { reasons, warns };
}
function blocked(reasons, what) {
  const ar = reasons.map(r => r.ar).join('، '), en = reasons.map(r => r.en).join('; ');
  return new AppError(409, 'unavailable', `لا يمكن التخصيص (${what.ar}): ${ar}`, `Cannot assign (${what.en}): ${en}`, { reasons });
}

/* create the trip for a booking on a vehicle — all hard rules checked here */
async function assign(c, ctx, b, vehicleId, driverId, opts = {}) {
  const s = await core.settings(c, ctx);
  const v = await core.lock(c, 'vehicles', vehicleId, 'vehicle');
  const ri = await routeInfo(c, b.pickup, b.destination, b.route_type);
  const start = toMin(b.time), dur = Math.round((b.route_km ? b.route_km / Math.max(1, ri.km) * ri.hours : ri.hours) * 60) + 15;
  const end = start + dur;   // may run past midnight: the calendar works with real moments
  const vr = await checkVehicle(c, v, b.date, start, end, [], b.pax, b.load_kg ? Number(b.load_kg) : null);
  if (vr.length) throw blocked(vr, { ar: v.code, en: v.code });
  let d = null;
  const candidates = driverId ? [driverId] : [v.driver_id, ...(await c.query("SELECT id FROM drivers WHERE vehicle_id IS NULL AND status = 'active' ORDER BY code")).rows.map(r => r.id)].filter(Boolean);
  let lastReasons = [];
  for (const did of candidates) {
    const dd = await core.lock(c, 'drivers', did, 'driver');
    const chk = await checkDriver(c, dd, b.date, start, end, [], s.maxDriveHours);
    if (!chk.reasons.length) { d = dd; break; }
    lastReasons = chk.reasons;
    if (driverId) throw blocked(chk.reasons, { ar: dd.name_ar, en: dd.name_en });
  }
  if (!d) throw blocked(lastReasons.length ? lastReasons : [{ ar: 'لا يوجد سائق متاح برخصة سارية', en: 'No available driver with a valid license' }], { ar: v.code, en: v.code });
  const vt = await core.mustExist(c, 'vehicle_types', (await c.query('SELECT id FROM vehicle_types WHERE code = $1', [v.type])).rows[0].id);
  const number = await core.nextNumber(c, ctx, 'TR', b.date);
  const t = await insert(c, 'trips', {
    company_id: ctx.companyId, number, booking_id: b.id, program_id: b.program_id, client_id: b.client_id, vehicle_id: v.id, driver_id: d.id, date: b.date,
    type: ri.type, from_place: b.pickup, to_place: b.destination, start_time: b.time, end_time: fromMin(end), duration_min: dur, planned_km: b.route_km || ri.km,
    planned_tolls: ri.gates * vt.toll_gate, revenue: opts.revenue != null ? opts.revenue : b.price, pax: b.pax, flight: b.flight, flight_status: b.flight ? 'ontime' : null, status: 'scheduled', created_by: ctx.user.name,
  });
  await c.query("UPDATE bookings SET unassigned = false, status = CASE WHEN status = 'tentative' THEN 'confirmed' ELSE status END WHERE id = $1", [b.id]);
  await core.audit(c, ctx, 'create', 'trip', `${number} ← ${b.number}`, { field: 'vehicle', before: '', after: `${v.code} / ${d.code}` });
  await core.emit(c, ctx, 'trip.assigned', { id: t.id, number, bookingNumber: b.number, date: b.date, time: b.time, vehicle: v.code, plate: v.plate_ar, driver: d.name_en, driverPhone: d.phone });
  return t;
}

/* ===================== BOOKINGS ===================== */
async function createBooking(ctx, i, c) {
  const clientId = V.uuid(i, 'clientId', { req: true });
  const client = await core.mustExist(c, 'clients', clientId, 'client');
  if (client.status !== 'active') throw bad('client', 'العميل غير نشط', 'The client is inactive', 'clientId');
  const date = V.date(i, 'date', { req: true });
  if (date < core.addDays(core.today(), -1) && !V.bool(i, 'backdated')) throw bad('date', 'تاريخ الحجز في الماضي', 'The booking date is in the past', 'date');
  const time = V.time(i, 'time', { req: true });
  const vt = await vtypes.resolve(c, ctx, V.str(i, 'vehicleType', { req: true, max: 8 }));
  // passengers are required for a type with seats; a cargo-only type (no seats) defaults to 1 (the driver's run)
  let pax = V.int(i, 'pax', { min: 1, max: 120 });
  if (pax == null) { if (vt.seats > 0) throw bad('required', 'عدد الركاب مطلوب', 'The number of passengers is required', 'pax'); pax = 1; }
  const loadKg = V.num(i, 'loadKg', { gt: 0, max: 100000 });
  if (loadKg != null && !(Number(vt.payload_kg) > 0)) throw bad('load', `نوع ${vt.code} مش للبضائع`, `Type ${vt.code} does not carry cargo`, 'loadKg');
  const pickup = V.str(i, 'pickup', { req: true, max: 12 }), destination = V.str(i, 'destination', { req: true, max: 12 });
  await place(c, pickup, 'pickup'); await place(c, destination, 'destination');
  const vehicleType = vt.code;
  const price = V.num(i, 'price', { req: true, min: 0 });
  const routeType = V.oneOf(i, 'routeType', ['airport', 'city', 'intercity', 'hire']);
  const ri = await routeInfo(c, pickup, destination, routeType);
  const status = V.oneOf(i, 'status', ['tentative', 'confirmed'], { def: 'confirmed' });
  const credit = await creditCheck(c, ctx, client, price, V.bool(i, 'overrideCredit'));
  const number = await core.nextNumber(c, ctx, 'BK', date);
  const b = await insert(c, 'bookings', {
    company_id: ctx.companyId, number, client_id: clientId, program_id: null, pax, date, time, pickup, destination, route_km: V.num(i, 'routeKm', { gt: 0, def: ri.km }), route_type: ri.type,
    vehicle_type: vehicleType, load_kg: loadKg, price, paid: 0, status, flight: V.str(i, 'flight', { max: 12, re: /^[A-Za-z0-9 ]+$/ }), unassigned: true, notes: V.str(i, 'notes', { max: 1000, def: '' }),
    created_by: ctx.user.name, external_ref: V.str(i, 'externalRef', { max: 80 }),
  });
  if (credit) await core.audit(c, ctx, 'approve', 'credit_limit', number, { field: 'exposure', before: credit.limit, after: credit.exposure });
  await core.audit(c, ctx, 'create', 'booking', number);
  await core.emit(c, ctx, 'booking.created', { id: b.id, number, clientId, date, time, pickup, destination, pax, vehicleType, price, status });
  if (status === 'confirmed') await core.emit(c, ctx, 'booking.confirmed', { id: b.id, number });
  let trip = null;
  const vehicleId = V.uuid(i, 'vehicleId');
  if (vehicleId) trip = await assign(c, ctx, b, vehicleId, V.uuid(i, 'driverId'));
  return { id: b.id, number, trip: trip ? { id: trip.id, number: trip.number } : null };
}
define('booking.create', G.ops, createBooking);

define('booking.update', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const b = await core.lock(c, 'bookings', id, 'booking');
  if (['cancelled', 'done'].includes(b.status)) throw conflict('closed', 'الحجز منتهي أو ملغي', 'The booking is finished or cancelled');
  const trips = (await c.query("SELECT id, status FROM trips WHERE booking_id = $1 AND status <> 'cancelled'", [id])).rows;
  const f = defined({ pax: P(i, 'pax', V.int, { min: 1, max: 100 }), price: P(i, 'price', V.num, { min: 0 }), flight: P(i, 'flight', V.str, { max: 12 }), notes: P(i, 'notes', V.str, { max: 1000, def: '' }), status: P(i, 'status', V.oneOf, ['tentative', 'confirmed']), time: P(i, 'time', V.time), date: P(i, 'date', V.date), vehicle_type: has(i, 'vehicleType') ? (await vtypes.resolve(c, ctx, i.vehicleType)).code : undefined, load_kg: P(i, 'loadKg', V.num, { gt: 0, max: 100000 }) });
  if ((f.date || f.time || f.vehicle_type) && trips.length) throw conflict('assigned', 'الحجز متخصص له رحلة. ألغِ التخصيص أولاً لتغيير الموعد أو النوع.', 'The booking already has a trip. Unassign it first to change the date, time or type.');
  if (f.price != null && trips.length) await c.query("UPDATE trips SET revenue = $1 WHERE booking_id = $2 AND invoice_id IS NULL AND status <> 'cancelled'", [f.price, id]);
  if (f.pax != null && trips.length) {
    const small = (await c.query("SELECT v.code, v.seats FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.booking_id = $1 AND t.status <> 'cancelled' AND v.seats > 0 AND v.seats < $2", [id, f.pax])).rows[0];
    if (small) throw conflict('capacity', `المركبة ${small.code} سعتها ${small.seats} فقط`, `Vehicle ${small.code} only has ${small.seats} seats`);
    await c.query("UPDATE trips SET pax = $1 WHERE booking_id = $2 AND status <> 'cancelled'", [f.pax, id]);
  }
  await update(c, 'bookings', id, f);
  await core.audit(c, ctx, 'update', 'booking', b.number, { field: Object.keys(f).join(', ') });
  if (f.status === 'confirmed' && b.status !== 'confirmed') await core.emit(c, ctx, 'booking.confirmed', { id, number: b.number });
});

define('booking.assign', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'bookingId', { req: true });
  const b = await core.lock(c, 'bookings', id, 'booking');
  if (b.status === 'cancelled' || b.status === 'done') throw conflict('closed', 'الحجز ملغي أو منفذ', 'The booking is cancelled or already done');
  if (!b.unassigned) throw conflict('assigned', 'الحجز متخصص بالفعل', 'The booking is already assigned');
  if (b.program_id) throw conflict('program', 'حجوزات البرامج تتوزع من صفحة البرنامج', 'Program bookings are scheduled from the program page');
  const t = await assign(c, ctx, b, V.uuid(i, 'vehicleId', { req: true }), V.uuid(i, 'driverId'));
  return { id: t.id, number: t.number };
});

define('booking.cancel', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const b = await core.lock(c, 'bookings', id, 'booking');
  if (b.status === 'cancelled') throw conflict('cancelled', 'الحجز ملغي بالفعل', 'The booking is already cancelled');
  const reason = V.text2(i, 'reason', { req: true, max: 200 });
  const done = (await c.query("SELECT 1 FROM trips WHERE booking_id = $1 AND status IN ('completed','running')", [id])).rowCount;
  if (done) throw conflict('started', 'فيه رحلة بدأت أو انتهت على الحجز، لا يمكن إلغاؤه', 'A trip on this booking has started or finished; it cannot be cancelled');
  await c.query("UPDATE trips SET status = 'cancelled', cancel_reason_ar = $1, cancel_reason_en = $2 WHERE booking_id = $3 AND status = 'scheduled'", [reason.ar, reason.en, id]);
  await c.query("UPDATE bookings SET status = 'cancelled', cancel_reason_ar = $1, cancel_reason_en = $2, unassigned = false WHERE id = $3", [reason.ar, reason.en, id]);
  if (b.program_id) await c.query("UPDATE programs SET status = 'cancelled' WHERE id = $1 AND status IN ('tentative','confirmed')", [b.program_id]);
  await core.audit(c, ctx, 'update', 'booking', b.number, { field: 'status', before: b.status, after: 'cancelled' });
  await core.emit(c, ctx, 'booking.cancelled', { id, number: b.number, reason: reason.en });
});

/* ===================== PROGRAMS ===================== */
define('program.create', G.ops, async (ctx, i, c) => {
  const name = V.text2(i, 'name', { req: true, max: 160 });
  const clientId = V.uuid(i, 'clientId', { req: true });
  const client = await core.mustExist(c, 'clients', clientId, 'client');
  const start = V.date(i, 'start', { req: true });
  const pax = V.int(i, 'pax', { req: true, min: 1, max: 100 });
  const price = V.num(i, 'price', { req: true, min: 0 });
  const days = V.arr(i, 'days', { req: true, min: 1, max: 60 });
  const vehicleId = V.uuid(i, 'vehicleId'), driverId = V.uuid(i, 'driverId');
  const status = V.oneOf(i, 'status', ['tentative', 'confirmed'], { def: 'confirmed' });
  const guide = V.text2(i, 'guide', { max: 120 });
  const end = core.addDays(start, days.length - 1);
  const credit = await creditCheck(c, ctx, client, price, V.bool(i, 'overrideCredit'));
  const v = vehicleId ? await core.lock(c, 'vehicles', vehicleId, 'vehicle') : null;
  const number = await core.nextNumber(c, ctx, 'PRG', start);
  const prog = await insert(c, 'programs', { company_id: ctx.companyId, number, name_ar: name.ar, name_en: name.en, client_id: clientId, start_date: start, end_date: end, pax, price, vehicle_id: vehicleId, driver_id: driverId || (v ? v.driver_id : null), guide_ar: guide.ar, guide_en: guide.en, guide_phone: V.str(i, 'guidePhone', { max: 30, def: '' }), status, created_by: ctx.user.name });
  const dayRows = [];
  let totalKm = 0;
  for (let k = 0; k < days.length; k++) {
    const d = days[k];
    const from = V.str(d, 'from', { req: true, max: 12 }), to = V.str(d, 'to', { req: true, max: 12 });
    const ri = await routeInfo(c, from, to);
    const km = V.num(d, 'km', { min: 0, def: ri.km });
    const row = await insert(c, 'program_days', { company_id: ctx.companyId, program_id: prog.id, day: k + 1, date: core.addDays(start, k), from_code: from, to_code: to, km, time: V.time(d, 'time', { def: k === 0 ? '10:30' : '08:00' }), vehicle_type: (await vtypes.resolve(c, ctx, d.vehicleType || (v ? v.type : 'LB'))).code });
    dayRows.push(Object.assign(row, { ri })); totalKm += km;
  }
  const bkNumber = await core.nextNumber(c, ctx, 'BK', start);
  const bk = await insert(c, 'bookings', { company_id: ctx.companyId, number: bkNumber, client_id: clientId, program_id: prog.id, pax, date: start, time: dayRows[0].time, pickup: dayRows[0].from_code, destination: dayRows[dayRows.length - 1].to_code, route_km: totalKm, route_type: 'intercity', vehicle_type: dayRows[0].vehicle_type, price, status, unassigned: !v, created_by: ctx.user.name });
  await c.query('UPDATE programs SET booking_id = $1 WHERE id = $2', [bk.id, prog.id]);
  if (v) await scheduleProgram(c, ctx, prog.id);
  if (credit) await core.audit(c, ctx, 'approve', 'credit_limit', number, { field: 'exposure', before: credit.limit, after: credit.exposure });
  await core.audit(c, ctx, 'create', 'program', `${number} ${name.ar}`);
  await core.emit(c, ctx, 'booking.created', { id: bk.id, number: bkNumber, programNumber: number, clientId, date: start, pax, price, status });
  return { id: prog.id, number, bookingId: bk.id };
});

/* create one trip per program day on the program's vehicle/driver (all-or-nothing) */
async function scheduleProgram(c, ctx, programId) {
  const prog = await core.lock(c, 'programs', programId, 'program');
  if (!prog.vehicle_id) throw bad('vehicle', 'اختر مركبة للبرنامج', 'Choose a vehicle for the program', 'vehicleId');
  const v = await core.lock(c, 'vehicles', prog.vehicle_id, 'vehicle');
  const s = await core.settings(c, ctx);
  const days = (await c.query('SELECT * FROM program_days WHERE program_id = $1 ORDER BY day', [programId])).rows;
  const existing = (await c.query("SELECT date FROM trips WHERE program_id = $1 AND status <> 'cancelled'", [programId])).rows.map(r => r.date);
  const totalKm = days.reduce((x, d) => x + Number(d.km), 0) || 1;
  const bk = (await c.query('SELECT * FROM bookings WHERE id = $1', [prog.booking_id])).rows[0];
  const d = prog.driver_id ? await core.lock(c, 'drivers', prog.driver_id, 'driver') : null;
  if (!d) throw bad('driver', 'اختر سائق للبرنامج', 'Choose a driver for the program', 'driverId');
  const vt = (await c.query('SELECT toll_gate FROM vehicle_types WHERE code = $1', [v.type])).rows[0];
  for (const day of days) {
    if (existing.includes(day.date)) continue;
    const ri = await routeInfo(c, day.from_code, day.to_code);
    const start = toMin(day.time), end = start + Math.round(Math.max(1, day.km / 70) * 60);
    const vr = await checkVehicle(c, v, day.date, start, end, [], prog.pax);
    if (vr.length) throw blocked(vr, { ar: `${v.code} يوم ${day.day}`, en: `${v.code} day ${day.day}` });
    const dr = await checkDriver(c, d, day.date, start, end, [], s.maxDriveHours);
    if (dr.reasons.length) throw blocked(dr.reasons, { ar: `${d.name_ar} يوم ${day.day}`, en: `${d.name_en} day ${day.day}` });
    const revenue = round2(prog.price * (0.5 / days.length + 0.5 * day.km / totalKm));
    const number = await core.nextNumber(c, ctx, 'TR', day.date);
    await insert(c, 'trips', { company_id: ctx.companyId, number, booking_id: bk.id, program_id: programId, client_id: prog.client_id, vehicle_id: v.id, driver_id: d.id, date: day.date, type: day.km > 150 ? 'intercity' : ri.type, from_place: day.from_code, to_place: day.to_code, start_time: day.time, end_time: fromMin(end), duration_min: end - start, planned_km: day.km, planned_tolls: ri.gates * vt.toll_gate, revenue, pax: prog.pax, status: 'scheduled', created_by: ctx.user.name });
  }
  await c.query("UPDATE bookings SET unassigned = false, status = CASE WHEN status = 'tentative' THEN 'confirmed' ELSE status END WHERE id = $1", [bk.id]);
  await c.query("UPDATE programs SET status = CASE WHEN status = 'tentative' THEN 'confirmed' ELSE status END WHERE id = $1", [programId]);
}
define('program.schedule', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const vid = V.uuid(i, 'vehicleId'), did = V.uuid(i, 'driverId');
  if (vid || did) {
    const prog = await core.lock(c, 'programs', id, 'program');
    if ((await c.query("SELECT 1 FROM trips WHERE program_id = $1 AND status IN ('running','completed')", [id])).rowCount && vid && vid !== prog.vehicle_id) throw conflict('started', 'البرنامج بدأ بالفعل', 'The program has already started');
    if (vid) { await core.mustExist(c, 'vehicles', vid, 'vehicle'); await c.query("UPDATE trips SET status = 'cancelled', cancel_reason_ar = 'تغيير المركبة', cancel_reason_en = 'Vehicle changed' WHERE program_id = $1 AND status = 'scheduled'", [id]); }
    await c.query('UPDATE programs SET vehicle_id = coalesce($1, vehicle_id), driver_id = coalesce($2, driver_id) WHERE id = $3', [vid, did, id]);
    if (did && !vid) await c.query("UPDATE trips SET driver_id = $1 WHERE program_id = $2 AND status = 'scheduled'", [did, id]);
  }
  await scheduleProgram(c, ctx, id);
  await core.audit(c, ctx, 'update', 'program', id, { field: 'schedule', before: '', after: 'trips created' });
});
define('program.cancel', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const prog = await core.lock(c, 'programs', id, 'program');
  if (['finished', 'cancelled'].includes(prog.status)) throw conflict('closed', 'البرنامج منتهي أو ملغي', 'The program is finished or cancelled');
  if ((await c.query("SELECT 1 FROM trips WHERE program_id = $1 AND status IN ('running','completed')", [id])).rowCount) throw conflict('started', 'البرنامج بدأ، ألغِ الأيام المتبقية من الرحلات', 'The program has started; cancel the remaining trips individually');
  const reason = V.text2(i, 'reason', { def: 'Cancelled', max: 200 });
  await c.query("UPDATE trips SET status = 'cancelled', cancel_reason_ar = $1, cancel_reason_en = $2 WHERE program_id = $3 AND status = 'scheduled'", [reason.ar || 'إلغاء', reason.en || 'Cancelled', id]);
  await c.query("UPDATE programs SET status = 'cancelled' WHERE id = $1", [id]);
  await c.query("UPDATE bookings SET status = 'cancelled', unassigned = false, cancel_reason_ar = $1, cancel_reason_en = $2 WHERE program_id = $3", [reason.ar || 'إلغاء', reason.en || 'Cancelled', id]);
  await core.audit(c, ctx, 'update', 'program', prog.number, { field: 'status', before: prog.status, after: 'cancelled' });
});

/* ===================== TRIPS ===================== */
define('trip.start', G.ops, async (ctx, i, c) => {
  const t = await core.lock(c, 'trips', V.uuid(i, 'id', { req: true }), 'trip');
  if (t.status !== 'scheduled') throw conflict('state', 'الرحلة ليست مجدولة', 'The trip is not scheduled');
  const v = await core.lock(c, 'vehicles', t.vehicle_id, 'vehicle');
  if (v.status === 'maintenance') throw conflict('maintenance', 'المركبة في الصيانة (أو فشلت في الفحص). لا يمكن بدء الرحلة.', 'The vehicle is in the workshop (or failed inspection). The trip cannot start.');
  const insp = (await c.query('SELECT result FROM inspections WHERE vehicle_id = $1 ORDER BY date DESC, created_at DESC LIMIT 1', [v.id])).rows[0];
  if (insp && insp.result === 'failed') {
    const fixed = (await c.query("SELECT 1 FROM work_orders WHERE vehicle_id = $1 AND status = 'closed' AND down_end >= (SELECT max(date) FROM inspections WHERE vehicle_id = $1)", [v.id])).rowCount;
    if (!fixed) throw conflict('inspection', 'آخر فحص للمركبة فشل ولم يتم إصلاحه', "The vehicle's last inspection failed and has not been fixed");
  }
  const odo = V.int(i, 'odometer', { def: v.odometer, min: 0 });
  if (odo < v.odometer - 5) throw bad('odometer', `قراءة العداد أقل من آخر قراءة (${v.odometer})`, `The odometer is lower than the last reading (${v.odometer})`, 'odometer');
  if (odo - v.odometer > 3000) throw bad('odometer', 'قراءة العداد أعلى من آخر قراءة بكثير — راجعها', 'The odometer is far above the last reading — please check it', 'odometer');
  await c.query("UPDATE trips SET status = 'running', start_km = $1, started_at = now() WHERE id = $2", [odo, t.id]);
  if (odo > v.odometer) await c.query('UPDATE vehicles SET odometer = $1 WHERE id = $2', [odo, v.id]);
  if (t.program_id) await c.query("UPDATE programs SET status = 'running' WHERE id = $1 AND status = 'confirmed'", [t.program_id]);
  await core.audit(c, ctx, 'update', 'trip', t.number, { field: 'status', before: 'scheduled', after: 'running' });
  await core.emit(c, ctx, 'trip.started', { id: t.id, number: t.number, startKm: odo });
});

define('trip.complete', G.ops, async (ctx, i, c) => {
  const t = await core.lock(c, 'trips', V.uuid(i, 'id', { req: true }), 'trip');
  if (!['running', 'scheduled'].includes(t.status)) throw conflict('state', 'الرحلة منتهية أو ملغية', 'The trip is already finished or cancelled');
  const v = await core.lock(c, 'vehicles', t.vehicle_id, 'vehicle');
  const startKm = t.start_km != null ? t.start_km : V.int(i, 'startKm', { def: v.odometer, min: 0 });
  const endKm = V.int(i, 'endKm', { req: true, min: 0 });
  if (endKm < startKm) throw bad('endKm', `عداد النهاية أقل من عداد البداية (${startKm})`, `The end odometer is lower than the start (${startKm})`, 'endKm');
  if (endKm - startKm > 2500) throw bad('endKm', 'المسافة أكبر من 2500 كم في رحلة واحدة — راجع العداد', 'More than 2,500 km on one trip — check the odometer', 'endKm');
  const exp = i.expenses || {};
  const tolls = V.num(exp, 'tolls', { min: 0, def: 0 }), parking = V.num(exp, 'parking', { min: 0, def: 0 }), lodging = V.num(exp, 'lodging', { min: 0, def: 0 }), other = V.num(exp, 'other', { min: 0, def: 0 });
  const tollsBy = V.oneOf(i, 'tollsPaidBy', ['tag', 'cash'], { def: 'cash' });
  const delay = V.int(i, 'delayMin', { min: 0, max: 1440, def: 0 });
  const date = t.date > core.today() ? core.today() : t.date;
  await c.query(`UPDATE trips SET status = 'completed', start_km = $1, end_km = $2, km = $3, exp_tolls = $4, exp_parking = $5, exp_lodging = $6, exp_other = $7,
    on_time = $8, delay_min = $9, completed_at = now(), started_at = coalesce(started_at, now()) WHERE id = $10`,
  [startKm, endKm, endKm - startKm, tolls, parking, lodging, other, delay <= 10, delay, t.id]);
  if (endKm > v.odometer) await c.query('UPDATE vehicles SET odometer = $1 WHERE id = $2', [endKm, v.id]);
  const base = { date, vehicleId: v.id, tripId: t.id, programId: t.program_id, driverId: t.driver_id, sourceType: 'trip', sourceId: t.id, sourceRef: t.number };
  if (tolls) {
    if (tollsBy === 'tag') { const tag = (await c.query("SELECT id FROM toll_tags WHERE vehicle_id = $1 AND status = 'active' LIMIT 1 FOR UPDATE", [v.id])).rows[0]; if (tag) await c.query('UPDATE toll_tags SET balance = balance - $1 WHERE id = $2', [tolls, tag.id]); }
    await core.expense(c, ctx, Object.assign({}, base, { category: 'tolls', amount: tolls, method: tollsBy === 'tag' ? 'prepaid_tag' : 'cash', desc: { ar: 'كارتة ' + t.number, en: 'Tolls ' + t.number } }));
  }
  if (parking) await core.expense(c, ctx, Object.assign({}, base, { category: 'parking', amount: parking, method: 'cash', desc: { ar: 'جراج ' + t.number, en: 'Parking ' + t.number } }));
  if (lodging) await core.expense(c, ctx, Object.assign({}, base, { category: 'lodging', amount: lodging, method: 'cash', desc: { ar: 'إقامة ' + t.number, en: 'Lodging ' + t.number } }));
  if (other) await core.expense(c, ctx, Object.assign({}, base, { category: 'other', amount: other, method: 'cash', desc: { ar: 'مصروفات ' + t.number, en: 'Trip expenses ' + t.number } }));
  if (t.booking_id) {
    const left = (await c.query("SELECT 1 FROM trips WHERE booking_id = $1 AND status IN ('scheduled','running')", [t.booking_id])).rowCount;
    if (!left) await c.query("UPDATE bookings SET status = 'done' WHERE id = $1 AND status <> 'cancelled'", [t.booking_id]);
  }
  if (t.program_id) {
    const left = (await c.query("SELECT 1 FROM trips WHERE program_id = $1 AND status IN ('scheduled','running')", [t.program_id])).rowCount;
    await c.query(`UPDATE programs SET status = $1 WHERE id = $2 AND status <> 'cancelled'`, [left ? 'running' : 'finished', t.program_id]);
  }
  await core.audit(c, ctx, 'update', 'trip', t.number, { field: 'status', before: t.status, after: 'completed' });
  await core.emit(c, ctx, 'trip.completed', { id: t.id, number: t.number, km: endKm - startKm, revenue: t.revenue, expenses: { tolls, parking, lodging, other } });
  return { km: endKm - startKm };
});

define('trip.cancel', G.ops, async (ctx, i, c) => {
  const t = await core.lock(c, 'trips', V.uuid(i, 'id', { req: true }), 'trip');
  if (t.status !== 'scheduled') throw conflict('state', 'لا يمكن إلغاء رحلة بدأت أو انتهت', 'A trip that has started or finished cannot be cancelled');
  const reason = V.text2(i, 'reason', { req: true, max: 200 });
  const reassign = V.bool(i, 'reassign', false);
  await c.query("UPDATE trips SET status = 'cancelled', cancel_reason_ar = $1, cancel_reason_en = $2 WHERE id = $3", [reason.ar, reason.en, t.id]);
  if (t.booking_id && !t.program_id) {
    if (reassign) await c.query('UPDATE bookings SET unassigned = true WHERE id = $1', [t.booking_id]);
    else await c.query("UPDATE bookings SET status = 'cancelled', unassigned = false, cancel_reason_ar = $1, cancel_reason_en = $2 WHERE id = $3 AND NOT EXISTS (SELECT 1 FROM trips WHERE booking_id = $3 AND status <> 'cancelled')", [reason.ar, reason.en, t.booking_id]);
  }
  await core.audit(c, ctx, 'update', 'trip', t.number, { field: 'status', before: 'scheduled', after: reassign ? 'unassigned' : 'cancelled' });
  await core.emit(c, ctx, 'trip.cancelled', { id: t.id, number: t.number, reason: reason.en, reassign });
});

define('trip.update', G.ops, async (ctx, i, c) => {
  const t = await core.lock(c, 'trips', V.uuid(i, 'id', { req: true }), 'trip');
  if (['completed', 'cancelled'].includes(t.status) && !has(i, 'revenue')) throw conflict('state', 'الرحلة منتهية أو ملغية', 'The trip is finished or cancelled');
  const f = defined({ flight: P(i, 'flight', V.str, { max: 12 }), flight_status: P(i, 'flightStatus', V.oneOf, ['ontime', 'delayed', 'landed', 'cancelled']), pax: P(i, 'pax', V.int, { min: 1, max: 100 }) });
  if (has(i, 'revenue')) { if (t.invoice_id) throw conflict('invoiced', 'الرحلة مفوترة، عدّل بإشعار دائن', 'The trip is invoiced; adjust it with a credit note'); f.revenue = V.num(i, 'revenue', { min: 0 }); }
  if (f.pax) { const v = await core.mustExist(c, 'vehicles', t.vehicle_id); if (v.seats > 0 && v.seats < f.pax) throw bad('pax', `سعة المركبة ${v.seats}`, `Vehicle capacity is ${v.seats}`, 'pax'); }
  if (has(i, 'driverId') || has(i, 'startTime')) {
    if (t.status !== 'scheduled') throw conflict('state', 'لا يمكن تغيير السائق أو الموعد بعد البدء', 'Driver or time cannot change after the trip started');
    const s = await core.settings(c, ctx);
    const startT = has(i, 'startTime') ? V.time(i, 'startTime', { req: true }) : t.start_time;
    const dur = t.duration_min || ((toMin(t.end_time) - toMin(t.start_time)) + 1440) % 1440 || 60;
    const start = toMin(startT), end = start + dur;
    const v = await core.lock(c, 'vehicles', t.vehicle_id);
    const vr = (await checkVehicle(c, v, t.date, start, end, [t.id], t.pax)).filter(r => !/maintenance|الصيانة|غير متاحة/.test(r.ar));
    if (vr.length) throw blocked(vr, { ar: v.code, en: v.code });
    const did = has(i, 'driverId') ? V.uuid(i, 'driverId', { req: true }) : t.driver_id;
    const d = await core.lock(c, 'drivers', did, 'driver');
    const dr = await checkDriver(c, d, t.date, start, end, [t.id], s.maxDriveHours);
    if (dr.reasons.length) throw blocked(dr.reasons, { ar: d.name_ar, en: d.name_en });
    f.driver_id = did; f.start_time = startT; f.end_time = fromMin(end); f.duration_min = dur;
  }
  await update(c, 'trips', t.id, f);
  await core.audit(c, ctx, 'update', 'trip', t.number, { field: Object.keys(f).join(', ') });
});

define('trip.passengers', G.ops, async (ctx, i, c) => {
  const t = await core.mustExist(c, 'trips', V.uuid(i, 'id', { req: true }), 'trip');
  const list = V.arr(i, 'passengers', { max: 120 });
  await c.query('DELETE FROM trip_passengers WHERE trip_id = $1', [t.id]);
  for (const p of list) {
    await insert(c, 'trip_passengers', { company_id: ctx.companyId, trip_id: t.id, name: V.str(p, 'name', { req: true, max: 120 }), nationality: V.str(p, 'nationality', { max: 40, def: '' }), passport_no: V.str(p, 'passportNo', { max: 20, def: '' }), hotel: V.str(p, 'hotel', { max: 120, def: '' }), pickup_time: V.str(p, 'pickupTime', { max: 5, def: '' }) });
  }
  if (list.length > t.pax) await c.query('UPDATE trips SET pax = $1 WHERE id = $2', [list.length, t.id]);
  await core.audit(c, ctx, 'update', 'trip', t.number, { field: 'manifest', before: '', after: `${list.length} passengers` });
  return { count: list.length };
});

/* expense recorded by the driver / dispatcher during a trip (toll, parking, other) */
define('trip.addExpense', G.ops, async (ctx, i, c) => {
  const t = await core.lock(c, 'trips', V.uuid(i, 'id', { req: true }), 'trip');
  if (!['scheduled', 'running', 'completed'].includes(t.status)) throw conflict('state', 'الرحلة ملغية', 'The trip is cancelled');
  const kind = V.oneOf(i, 'kind', ['tolls', 'parking', 'lodging', 'other'], { req: true });
  const amount = V.num(i, 'amount', { req: true, gt: 0, max: 100000 });
  const col = { tolls: 'exp_tolls', parking: 'exp_parking', lodging: 'exp_lodging', other: 'exp_other' }[kind];
  await c.query(`UPDATE trips SET ${col} = ${col} + $1 WHERE id = $2`, [amount, t.id]);
  await core.expense(c, ctx, { date: t.date > core.today() ? core.today() : t.date, category: kind, amount, vehicleId: t.vehicle_id, tripId: t.id, programId: t.program_id, driverId: t.driver_id, method: 'cash', sourceType: 'trip', sourceId: t.id, sourceRef: t.number, note: V.text2(i, 'note', { max: 200 }), desc: { ar: 'مصروف رحلة ' + t.number, en: 'Trip expense ' + t.number } });
  await core.audit(c, ctx, 'create', 'trip_expense', `${t.number} ${kind} ${amount}`);
});

/* ===================== DRIVER AVAILABILITY ===================== */
define('availability.create', G.ops, async (ctx, i, c) => {
  const driverId = V.uuid(i, 'driverId', { req: true }); const d = await core.mustExist(c, 'drivers', driverId, 'driver');
  const from = V.date(i, 'from', { req: true }), to = V.date(i, 'to', { req: true });
  if (to < from) throw bad('to', 'تاريخ النهاية قبل البداية', 'The end date is before the start date', 'to');
  const busy = (await c.query("SELECT number, date FROM trips WHERE driver_id = $1 AND date BETWEEN $2 AND $3 AND status IN ('scheduled','running') ORDER BY date LIMIT 3", [driverId, from, to])).rows;
  if (busy.length) throw conflict('has_trips', 'السائق عليه رحلات في الفترة: ' + busy.map(b => b.number).join('، ') + '. غيّر السائق فيها أولاً.', 'The driver has trips in this period: ' + busy.map(b => b.number).join(', ') + '. Reassign them first.');
  const a = await insert(c, 'availability', { company_id: ctx.companyId, driver_id: driverId, from_date: from, to_date: to, kind: V.oneOf(i, 'kind', ['leave', 'rest', 'sick'], { def: 'leave' }), note: V.str(i, 'note', { max: 300, def: '' }) });
  await core.audit(c, ctx, 'create', 'availability', `${d.code} ${from}→${to}`);
  return { id: a.id };
});
define('availability.delete', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const r = await c.query('DELETE FROM availability WHERE id = $1 RETURNING driver_id', [id]);
  if (!r.rowCount) throw notFound('leave record');
  await core.audit(c, ctx, 'delete', 'availability', id);
});

/* ===================== SUBCONTRACTING ===================== */
define('subcontract.create', G.ops, async (ctx, i, c) => {
  const clientId = V.uuid(i, 'clientId', { req: true }); await core.mustExist(c, 'clients', clientId, 'client');
  const bookingId = V.uuid(i, 'bookingId');
  let b = null;
  if (bookingId) { b = await core.lock(c, 'bookings', bookingId, 'booking'); if (!b.unassigned || b.status === 'cancelled') throw conflict('assigned', 'الحجز متخصص أو ملغي', 'The booking is already assigned or cancelled'); }
  const supplier = V.text2(i, 'supplier', { req: true, max: 160 }), driver = V.text2(i, 'driver', { max: 120 });
  const revenue = V.num(i, 'revenue', { req: true, min: 0 }), cost = V.num(i, 'cost', { req: true, min: 0 });
  const date = V.date(i, 'date', { def: b ? b.date : core.today() });
  const s = await insert(c, 'subcontracts', { company_id: ctx.companyId, date, supplier_ar: supplier.ar, supplier_en: supplier.en, plate: V.str(i, 'plate', { req: true, max: 30 }), driver_ar: driver.ar, driver_en: driver.en, vehicle_type: (await vtypes.resolve(c, ctx, i.vehicleType || (b ? b.vehicle_type : null))).code, revenue, cost, client_id: clientId, booking_id: bookingId, from_code: V.str(i, 'from', { max: 12, def: b ? b.pickup : '' }), to_code: V.str(i, 'to', { max: 12, def: b ? b.destination : '' }), created_by: ctx.user.name });
  if (b) await c.query("UPDATE bookings SET unassigned = false, status = 'done' WHERE id = $1", [b.id]);
  if (cost > 0) await core.expense(c, ctx, { date, category: 'subcontract', amount: cost, method: 'payable', supplier: supplier.en, sourceType: 'subcontract', sourceId: s.id, sourceRef: s.id, desc: { ar: 'مركبة من الباطن ' + supplier.ar, en: 'Subcontracted vehicle ' + supplier.en } });
  await core.audit(c, ctx, 'create', 'subcontract', `${supplier.ar} ${b ? b.number : ''}`);
  return { id: s.id };
});

/* ===================== ACCIDENTS & FINES ===================== */
define('accident.create', G.ops, async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true }); const v = await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const date = V.date(i, 'date', { def: core.today() });
  const placeTxt = V.text2(i, 'place', { req: true, max: 200 }), desc = V.text2(i, 'description', { req: true, max: 1000 });
  const number = await core.nextNumber(c, ctx, 'ACD', date);
  const a = await insert(c, 'accidents', { company_id: ctx.companyId, number, date, place_ar: placeTxt.ar, place_en: placeTxt.en, vehicle_id: vehicleId, driver_id: V.uuid(i, 'driverId') || v.driver_id, description_ar: desc.ar, description_en: desc.en, police: V.str(i, 'police', { max: 60, def: '' }), claim: V.oneOf(i, 'claim', ['open', 'approved', 'rejected', 'none'], { def: 'open' }), repair_cost: V.num(i, 'repairCost', { min: 0, def: 0 }), insurance_paid: V.num(i, 'insurancePaid', { min: 0, def: 0 }), created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'accident', number);
  return { id: a.id, number };
});
define('accident.update', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const a = await core.lock(c, 'accidents', id, 'accident');
  const f = defined({ claim: P(i, 'claim', V.oneOf, ['open', 'approved', 'rejected', 'none']), repair_cost: P(i, 'repairCost', V.num, { min: 0 }), insurance_paid: P(i, 'insurancePaid', V.num, { min: 0 }), police: P(i, 'police', V.str, { max: 60, def: '' }) });
  await update(c, 'accidents', id, f);
  await core.audit(c, ctx, 'update', 'accident', a.number, { field: Object.keys(f).join(', ') });
});
define('fine.create', G.ops, async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true }); const v = await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const date = V.date(i, 'date', { def: core.today() });
  const type = V.text2(i, 'type', { req: true, max: 120 });
  const amount = V.num(i, 'amount', { req: true, min: 0 });
  const paidBy = V.oneOf(i, 'paidBy', ['company', 'driver'], { def: 'company' });
  const driverId = V.uuid(i, 'driverId') || v.driver_id;
  const f = await insert(c, 'fines', { company_id: ctx.companyId, date, vehicle_id: vehicleId, driver_id: driverId, type_ar: type.ar, type_en: type.en, amount, paid_by: paidBy, deducted: V.bool(i, 'deducted', false), created_by: ctx.user.name });
  if (amount > 0) {
    if (paidBy === 'company') await core.expense(c, ctx, { date, category: 'other', amount, vehicleId, driverId, method: 'cash', sourceType: 'fine', sourceId: f.id, sourceRef: f.id, note: type, desc: { ar: 'مخالفة ' + v.code, en: 'Traffic fine ' + v.code } });
    else await core.post(c, ctx, { date, sourceType: 'fine', sourceRef: f.id, desc: { ar: 'مخالفة على السائق ' + v.code, en: 'Fine charged to driver ' + v.code }, lines: [{ a: 'driver_receivable', debit: amount }, { a: 'cash_main', credit: amount }] });
  }
  await core.audit(c, ctx, 'create', 'fine', `${v.code} ${amount}`);
  return { id: f.id };
});

/* ===================== SHIFT HANDOVER ===================== */
define('handover.create', G.ops, async (ctx, i, c) => {
  const notes = V.text2(i, 'notes', { req: true, max: 2000 });
  const h = await insert(c, 'handovers', { company_id: ctx.companyId, date: V.date(i, 'date', { def: core.today() }), shift: V.oneOf(i, 'shift', ['morning', 'evening', 'night'], { def: 'morning' }), by_name_ar: ctx.user.nameAr || ctx.user.name, by_name_en: ctx.user.name, notes_ar: notes.ar, notes_en: notes.en, created_by: ctx.user.name });
  return { id: h.id };
});

/* ===================== DOCUMENTS ===================== */
const MIME = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
define('document.upload', G.opsMaint.concat(['accountant']), async (ctx, i, c) => {
  const owner = V.oneOf(i, 'owner', ['vehicle', 'driver', 'company'], { req: true });
  const ownerId = owner === 'company' ? null : V.uuid(i, 'ownerId', { req: true });
  if (owner === 'vehicle') await core.mustExist(c, 'vehicles', ownerId, 'vehicle');
  if (owner === 'driver') await core.mustExist(c, 'drivers', ownerId, 'driver');
  const kind = V.oneOf(i, 'kind', ['license', 'insurance', 'contract', 'inspection', 'receipt', 'invoice', 'other'], { req: true });
  const expiry = V.date(i, 'expiry');
  let file = null, mime = null, name = null;
  if (i.file) {
    mime = V.oneOf(i.file, 'mime', Object.keys(MIME), { req: true });
    name = V.str(i.file, 'name', { req: true, max: 160 }).replace(/[\\/:*?"<>|]+/g, '_');
    file = Buffer.from(String(i.file.data || ''), 'base64');
    if (!file.length) throw bad('file', 'الملف فارغ', 'The file is empty', 'file');
    if (file.length > 10 * 1024 * 1024) throw bad('file', 'حجم الملف أكبر من 10 ميجا', 'The file is larger than 10 MB', 'file');
    const sig = MIME[mime];
    if (!sig.every((b, k) => file[k] === b)) throw bad('file', 'محتوى الملف لا يطابق نوعه', 'The file content does not match its type', 'file');
  }
  const d = await insert(c, 'documents', { company_id: ctx.companyId, owner, owner_id: ownerId, kind, number: V.str(i, 'number', { max: 60, def: '' }), expiry, file_name: name, mime, size: file ? file.length : null, reviewed: true, created_by: ctx.user.name });
  if (file) await c.query('INSERT INTO document_files (company_id, document_id, content) VALUES ($1,$2,$3)', [ctx.companyId, d.id, file]);
  if (V.bool(i, 'updateRecord', true) && expiry) {
    if (owner === 'vehicle' && kind === 'license') await c.query('UPDATE vehicles SET license_expiry = $1 WHERE id = $2', [expiry, ownerId]);
    if (owner === 'vehicle' && kind === 'insurance') await c.query('UPDATE vehicles SET insurance_expiry = $1 WHERE id = $2', [expiry, ownerId]);
    if (owner === 'driver' && kind === 'license') await c.query('UPDATE drivers SET license_expiry = $1 WHERE id = $2', [expiry, ownerId]);
  }
  await core.audit(c, ctx, 'create', 'document', `${kind} ${name || ''}`);
  return { id: d.id };
});
define('document.delete', G.fleet, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  await c.query('DELETE FROM document_files WHERE document_id = $1', [id]);
  const r = await c.query('DELETE FROM documents WHERE id = $1 RETURNING kind, file_name', [id]);
  if (!r.rowCount) throw notFound('document');
  await core.audit(c, ctx, 'delete', 'document', `${r.rows[0].kind} ${r.rows[0].file_name || ''}`);
});

/* message templates are sent from the user's own WhatsApp/SMS app; we only log that it was sent */
define('message.log', G.ops, async (ctx, i, c) => {
  await core.audit(c, ctx, 'notify', V.oneOf(i, 'entity', ['trip', 'booking', 'driver', 'client'], { def: 'trip' }), V.str(i, 'ref', { max: 60, def: '' }), { field: 'channel', before: '', after: V.oneOf(i, 'channel', ['whatsapp', 'sms', 'copy'], { def: 'whatsapp' }) });
}, { readOnly: false });

module.exports = { createBooking, createClient, assign, routeInfo, checkVehicle, checkDriver };
