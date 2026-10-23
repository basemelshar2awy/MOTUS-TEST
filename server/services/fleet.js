'use strict';
/* Fleet: vehicles, drivers, fuel, oil changes, work orders, tires & batteries, inspections. */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound } = require('../lib/errors');
const { CRITICAL_ITEMS, INSPECTION_ITEMS } = require('../lib/defaults');
const vtypes = require('../lib/vehicletypes');
const countries = require('../lib/countries');
const identity = require('../lib/identity');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const P = (o, f, fn, ...a) => (has(o, f) ? fn(o, f, ...a) : undefined);
const round2 = V.round2;

async function vtype(c, code) {
  const r = await c.query('SELECT * FROM vehicle_types WHERE code = $1', [code]);
  if (!r.rows[0]) throw bad('type', 'نوع المركبة غير معرّف في إعدادات الشركة', 'This vehicle type is not set up for the company', 'type');
  return r.rows[0];
}

/* ===================== VEHICLES ===================== */
async function setDriver(c, ctx, vehicleId, driverId) {
  // keep vehicles.driver_id and drivers.vehicle_id consistent (one driver per vehicle)
  await c.query('UPDATE drivers SET vehicle_id = NULL WHERE vehicle_id = $1 AND ($2::uuid IS NULL OR id <> $2)', [vehicleId, driverId]);
  if (driverId) {
    const d = await core.lock(c, 'drivers', driverId, 'driver');
    if (d.vehicle_id && d.vehicle_id !== vehicleId) await c.query('UPDATE vehicles SET driver_id = NULL WHERE id = $1', [d.vehicle_id]);
    await c.query('UPDATE drivers SET vehicle_id = $1 WHERE id = $2', [vehicleId, driverId]);
  }
  await c.query('UPDATE vehicles SET driver_id = $1 WHERE id = $2', [driverId, vehicleId]);
}

function vehicleFields(i, t, isNew) {
  const plate = P(i, 'plate', V.text2, { max: 40 });
  const f = defined({
    plate_ar: plate ? plate.ar : undefined, plate_en: plate ? plate.en : undefined,
    make: P(i, 'make', V.str, { max: 60, def: '' }), model: P(i, 'model', V.str, { max: 60, def: '' }),
    year: P(i, 'year', V.int, { min: 1980, max: 2100 }), chassis: P(i, 'chassis', V.str, { max: 40, def: '' }),
    seats: P(i, 'seats', V.int, { min: 0, max: 120 }), fuel: P(i, 'fuel', V.oneOf, ['diesel', 'gasoline', 'electric', 'hybrid', 'cng']),
    payload_kg: P(i, 'payloadKg', V.num, { min: 0, max: 100000 }), volume_m3: P(i, 'volumeM3', V.num, { min: 0, max: 500 }),
    ownership: P(i, 'ownership', V.oneOf, ['owned', 'installment', 'leased']),
    purchase_date: P(i, 'purchaseDate', V.date), purchase_price: P(i, 'purchasePrice', V.num, { min: 0 }),
    salvage_value: P(i, 'salvageValue', V.num, { min: 0 }), life_years: P(i, 'lifeYears', V.num, { gt: 0, max: 40 }), life_km: P(i, 'lifeKm', V.int, { gt: 0 }),
    status: P(i, 'status', V.oneOf, ['active', 'maintenance', 'stopped', 'sold']),
    license_expiry: P(i, 'licenseExpiry', V.date), insurance_expiry: P(i, 'insuranceExpiry', V.date),
    insurance_annual: P(i, 'insuranceAnnual', V.num, { min: 0 }), license_annual: P(i, 'licenseAnnual', V.num, { min: 0 }),
    branch_id: P(i, 'branchId', V.uuid), tank_l: P(i, 'tankL', V.num, { min: 0 }),
  });
  const color = P(i, 'color', V.text2, { max: 30 });
  if (color) { f.color_ar = color.ar; f.color_en = color.en; }
  if (isNew) {
    if (!f.plate_ar) throw bad('required', 'رقم اللوحة مطلوب', 'The plate number is required', 'plate');
    if (f.purchase_price == null) throw bad('required', 'سعر الشراء مطلوب', 'The purchase price is required', 'purchasePrice');
    if (!f.purchase_date) throw bad('required', 'تاريخ الشراء مطلوب', 'The purchase date is required', 'purchaseDate');
    if (f.seats == null) f.seats = t.seats; if (f.payload_kg == null) f.payload_kg = Number(t.payload_kg) || 0; if (f.volume_m3 == null) f.volume_m3 = Number(t.volume_m3) || 0;
    if (!(f.seats > 0) && !(f.payload_kg > 0)) throw bad('capacity', 'المركبة محتاجة عدد كراسي أو حمولة', 'The vehicle needs seats or a payload', 'seats');
    f.fuel = f.fuel || t.fuel; f.life_years = f.life_years || t.life_years; f.life_km = f.life_km || t.life_km;
    f.salvage_value = f.salvage_value != null ? f.salvage_value : round2(f.purchase_price * t.salvage_pct);
    f.insurance_annual = f.insurance_annual != null ? f.insurance_annual : t.insurance; f.license_annual = f.license_annual != null ? f.license_annual : t.license;
    f.tank_l = f.tank_l || t.tank_l; f.year = f.year || parseInt(f.purchase_date.slice(0, 4), 10);
  }
  return f;
}

define('vehicle.create', G.fleet, async (ctx, i, c) => {
  const t = await vtypes.resolve(c, ctx, V.str(i, 'type', { req: true, max: 8 }), 'type');
  const type = t.code;
  const f = vehicleFields(i, t, true);
  if (f.salvage_value > f.purchase_price) throw bad('salvage', 'قيمة الخردة أكبر من سعر الشراء', 'Salvage value is higher than the purchase price', 'salvageValue');
  const odo = V.int(i, 'odometer', { min: 0, def: 0 });
  const co = await core.company(c, ctx);
  let code = V.str(i, 'code', { max: 20 });
  if (!code) {
    const n = (await c.query("SELECT count(*)::int n FROM vehicles")).rows[0].n;
    for (let k = n + 1; ; k++) { code = `${co.code}-${String(k).padStart(2, '0')}`; if (!(await c.query('SELECT 1 FROM vehicles WHERE code = $1', [code])).rowCount) break; }
  }
  if (f.branch_id) await core.mustExist(c, 'branches', f.branch_id, 'branch');
  const v = await insert(c, 'vehicles', Object.assign({ company_id: ctx.companyId, code, type, odometer_start: odo, odometer: odo, status: f.status || 'active', created_by: ctx.user.name, external_ref: V.str(i, 'externalRef', { max: 80 }) }, f));
  const driverId = V.uuid(i, 'driverId');
  if (driverId) await setDriver(c, ctx, v.id, driverId);
  await core.audit(c, ctx, 'create', 'vehicle', `${v.code} ${v.plate_ar}`);
  await core.emit(c, ctx, 'vehicle.created', { id: v.id, code: v.code, plate: v.plate_ar, type });
  return { id: v.id, code: v.code };
});

define('vehicle.update', G.fleet, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const old = await core.lock(c, 'vehicles', id, 'vehicle');
  const t = await vtype(c, old.type);
  const f = vehicleFields(i, t, false);
  if (has(i, 'odometer')) {
    const odo = V.int(i, 'odometer', { min: 0, req: true });
    if (odo < old.odometer && !['company_admin', 'super_admin'].includes(ctx.user.role)) throw bad('odometer', `العداد لا يمكن أن يقل عن ${old.odometer} (تصحيح العداد لمدير النظام فقط)`, `The odometer cannot go below ${old.odometer} (only a company admin can correct it)`, 'odometer');
    f.odometer = odo;
  }
  const seats = f.seats != null ? f.seats : old.seats, payload = f.payload_kg != null ? f.payload_kg : Number(old.payload_kg);
  if (!(seats > 0) && !(payload > 0)) throw bad('capacity', 'المركبة محتاجة عدد كراسي أو حمولة', 'The vehicle needs seats or a payload', 'seats');
  const pp = f.purchase_price != null ? f.purchase_price : old.purchase_price, sv = f.salvage_value != null ? f.salvage_value : old.salvage_value;
  if (sv > pp) throw bad('salvage', 'قيمة الخردة أكبر من سعر الشراء', 'Salvage value is higher than the purchase price', 'salvageValue');
  if (f.status === 'active' && old.status === 'maintenance') {
    const open = (await c.query("SELECT number FROM work_orders WHERE vehicle_id = $1 AND status IN ('open','waiting_parts','in_progress') LIMIT 1", [id])).rows[0];
    if (open) throw conflict('open_wo', `المركبة عليها أمر شغل مفتوح ${open.number}. اقفله أولاً.`, `The vehicle has an open work order ${open.number}. Close it first.`);
  }
  if (has(i, 'externalRef')) f.external_ref = V.str(i, 'externalRef', { max: 80 });
  const v = await update(c, 'vehicles', id, f);
  if (has(i, 'driverId')) await setDriver(c, ctx, id, V.uuid(i, 'driverId'));
  const changed = Object.keys(f).filter(k => String(old[k]) !== String(v[k])).map(k => ({ field: k, before: old[k], after: v[k] }));
  await core.audit(c, ctx, 'update', 'vehicle', v.code, changed.length ? { field: changed.map(x => x.field).join(', '), before: changed.map(x => x.before).join(', '), after: changed.map(x => x.after).join(', ') } : null);
  await core.emit(c, ctx, 'vehicle.updated', { id, code: v.code, status: v.status, odometer: v.odometer });
});

/* ===================== DRIVERS ===================== */
function driverFields(i) {
  const name = P(i, 'name', V.text2, { max: 120 });
  return defined({
    name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined,
    phone: P(i, 'phone', V.str, { max: 30, def: '' }), national_id: P(i, 'nationalId', V.str, { max: 20, def: '', re: /^[0-9A-Za-z-]*$/ }),
    license_no: P(i, 'licenseNo', V.str, { max: 30, def: '' }), license_class: P(i, 'licenseClass', V.str, { max: 20 }),
    license_expiry: P(i, 'licenseExpiry', V.date), employment: P(i, 'employment', V.oneOf, ['salary', 'commission', 'both']),
    salary: P(i, 'salary', V.num, { min: 0 }), commission: P(i, 'commission', V.num, { min: 0 }),
    status: P(i, 'status', V.oneOf, ['active', 'inactive']), branch_id: P(i, 'branchId', V.uuid), hired_at: P(i, 'hiredAt', V.date),
  });
}
/* identity fields follow the company's country (format of the ID, license classes) */
async function countryChecks(c, ctx, f, isNew) {
  const country = (await core.company(c, ctx)).country;
  countries.check(country, 'nationalId', f.national_id, 'nationalId');
  if (f.license_class != null) countries.checkLicense(country, f.license_class);
  else if (isNew) f.license_class = countries.pack(country).defaultLicense;
}
define('driver.create', G.ops, async (ctx, i, c) => {
  const f = driverFields(i);
  await countryChecks(c, ctx, f, true);
  if (!f.name_ar) throw bad('required', 'اسم السائق مطلوب', 'The driver name is required', 'name');
  if (!f.license_expiry) throw bad('required', 'تاريخ انتهاء الرخصة مطلوب', 'The license expiry date is required', 'licenseExpiry');
  let code = V.str(i, 'code', { max: 20 });
  if (!code) {
    const n = (await c.query('SELECT count(*)::int n FROM drivers')).rows[0].n;
    for (let k = n + 1; ; k++) { code = `DRV-${String(k).padStart(3, '0')}`; if (!(await c.query('SELECT 1 FROM drivers WHERE code = $1', [code])).rowCount) break; }
  }
  const d = await insert(c, 'drivers', Object.assign({ company_id: ctx.companyId, code, created_by: ctx.user.name, external_ref: V.str(i, 'externalRef', { max: 80 }) }, f));
  const vid = V.uuid(i, 'vehicleId');
  if (vid) { await core.lock(c, 'vehicles', vid, 'vehicle'); await setDriver(c, ctx, vid, d.id); }
  await core.audit(c, ctx, 'create', 'driver', `${d.code} ${d.name_ar}`);
  return { id: d.id, code };
});
define('driver.update', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const old = await core.lock(c, 'drivers', id, 'driver');
  const f = driverFields(i);
  await countryChecks(c, ctx, f, false);
  if (has(i, 'externalRef')) f.external_ref = V.str(i, 'externalRef', { max: 80 });
  await update(c, 'drivers', id, f);
  if (has(i, 'vehicleId')) {
    const vid = V.uuid(i, 'vehicleId');
    if (vid) await setDriver(c, ctx, vid, id);
    else if (old.vehicle_id) await setDriver(c, ctx, old.vehicle_id, null);
  }
  await core.audit(c, ctx, 'update', 'driver', old.code, { field: Object.keys(f).join(', ') });
});

/* ---------- driver accounts: the driver signs in to the Sabeel driver app with one account (lib/identity).
   A new mobile/email → a new account with a temporary password; a driver who already has a Sabeel
   account (another company) gets an invitation and joins after accepting. ---------- */
define('driver.account', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'driverId', { req: true });
  const d = await core.lock(c, 'drivers', id, 'driver');
  const co = await core.company(c, ctx);
  const rawPhone = has(i, 'phone') ? V.str(i, 'phone', { max: 30 }) : d.phone;
  const phone = rawPhone ? countries.normalizePhone(rawPhone, co.country) : null;
  if (rawPhone && !phone) throw bad('phone', 'رقم الموبايل غير صحيح', 'Invalid mobile number', 'phone');
  const email = V.email(i, 'email');
  if (!phone && !email) throw bad('login', 'اكتب رقم موبايل السائق أو بريده', "Enter the driver's mobile number or email", 'phone');
  if ((await c.query('SELECT 1 FROM memberships WHERE driver_id = $1', [id])).rowCount) throw conflict('has_account', 'السائق ده عنده حساب بالفعل', 'This driver already has an account');
  const acc = await identity.findOrCreate(c, { email, phone, name: { ar: d.name_ar, en: d.name_en || d.name_ar } });
  const m = await identity.addMember(c, ctx, acc, { role: 'driver', driverId: id });
  await core.audit(c, ctx, acc.created ? 'create' : 'invite', 'driver_account', `${d.code} ${phone || email}`);
  return { driverId: id, login: phone || email, status: m.status, invited: !acc.created, temporaryPassword: acc.temporaryPassword };
});
define('driver.unlink', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'driverId', { req: true });
  const d = await core.lock(c, 'drivers', id, 'driver');
  const m = (await c.query('DELETE FROM memberships WHERE driver_id = $1 RETURNING user_id', [id])).rows[0];
  if (!m) throw notFound('account');
  await identity.endSessions(c, m.user_id, ctx.companyId);
  await core.audit(c, ctx, 'delete', 'driver_account', d.code);
});

/* ===================== FUEL ===================== */
async function addFuel(ctx, i, c) {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true });
  const v = await core.lock(c, 'vehicles', vehicleId, 'vehicle');
  const s = await core.settings(c, ctx);
  const date = V.date(i, 'date', { def: core.today() });
  if (date > core.today()) throw bad('date', 'تاريخ التفويلة في المستقبل', 'The fill-up date is in the future', 'date');
  const time = V.time(i, 'time', { def: core.nowLocal() });
  const liters = V.num(i, 'liters', { req: true, gt: 0, max: 2000 });
  const price = V.num(i, 'price', { def: (s.fuelPrices || {})[v.fuel] || 0, min: 0, max: 1000 });
  const odometer = V.int(i, 'odometer', { def: v.odometer, min: 0 });
  const last = (await c.query('SELECT odometer, date FROM fuel_records WHERE vehicle_id = $1 ORDER BY odometer DESC, date DESC LIMIT 1', [vehicleId])).rows[0];
  if (last && odometer < last.odometer) throw bad('odometer', `قراءة العداد أقل من آخر تفويلة (${last.odometer})`, `The odometer is lower than the previous fill-up (${last.odometer})`, 'odometer');
  if (odometer < v.odometer - 5 && !(last && odometer >= last.odometer)) throw bad('odometer', `قراءة العداد أقل من آخر قراءة مسجلة للمركبة (${v.odometer})`, `The odometer is lower than the vehicle's last recorded reading (${v.odometer})`, 'odometer');
  if (odometer - v.odometer > 5000) throw bad('odometer', 'قراءة العداد أعلى من آخر قراءة بأكثر من 5000 كم — راجعها', 'The odometer is more than 5,000 km above the last reading — please check it', 'odometer');
  const full = V.bool(i, 'fullTank', true);
  const kmSince = last ? Math.max(0, odometer - last.odometer) : 0;
  const source = V.oneOf(i, 'source', ['manual', 'card', 'import'], { def: 'manual' });
  let anomaly = null;
  if (v.tank_l && liters > v.tank_l * 1.03) anomaly = 'tank';
  const dup = (await c.query('SELECT 1 FROM fuel_records WHERE vehicle_id = $1 AND date = $2 AND abs(liters - $3) <= $3 * 0.01 LIMIT 1', [vehicleId, date, liters])).rowCount;
  if (dup) anomaly = 'duplicate';
  const total = round2(V.num(i, 'total', { def: liters * price, min: 0 }));
  const station = V.text2(i, 'station', { max: 120 });
  const driverId = V.uuid(i, 'driverId') || v.driver_id;
  const rec = await insert(c, 'fuel_records', { company_id: ctx.companyId, date, time, vehicle_id: vehicleId, driver_id: driverId, liters, price, total, odometer, km_since: anomaly === 'duplicate' ? 0 : kmSince, station_ar: station.ar || (source === 'manual' ? 'إدخال يدوي' : ''), station_en: station.en || (source === 'manual' ? 'Manual entry' : ''), full_tank: full, source, anomaly, created_by: ctx.user.name, external_ref: V.str(i, 'externalRef', { max: 80 }) });
  if (odometer > v.odometer) await c.query('UPDATE vehicles SET odometer = $1 WHERE id = $2', [odometer, vehicleId]);
  let method = 'cash';
  if (source === 'card') {
    method = 'prepaid_card';
    const card = (await c.query("SELECT id FROM fuel_cards WHERE vehicle_id = $1 AND status = 'active' LIMIT 1 FOR UPDATE", [vehicleId])).rows[0];
    if (card) await c.query('UPDATE fuel_cards SET balance = balance - $1 WHERE id = $2', [total, card.id]);
  }
  await core.expense(c, ctx, { date, category: 'fuel', amount: total, vehicleId, driverId, method, sourceType: 'fuel', sourceId: rec.id, sourceRef: rec.id, supplier: station.en || '', desc: { ar: `وقود ${v.code} ${liters} لتر`, en: `Fuel ${v.code} ${liters} L` } });
  await core.audit(c, ctx, 'create', 'fuel', `${v.code} ${date}`, anomaly ? { field: 'anomaly', before: '', after: anomaly } : null);
  return { id: rec.id, anomaly, kmSince };
}
define('fuel.create', G.anyWriter, addFuel);

/* ===================== OIL ===================== */
define('oil.create', G.maint, async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true });
  const v = await core.lock(c, 'vehicles', vehicleId, 'vehicle');
  const t = await vtype(c, v.type);
  const date = V.date(i, 'date', { def: core.today() });
  const odometer = V.int(i, 'odometer', { def: v.odometer, min: 0 });
  if (odometer < v.odometer - 5) throw bad('odometer', `قراءة العداد أقل من آخر قراءة (${v.odometer})`, `The odometer is lower than the last reading (${v.odometer})`, 'odometer');
  const workshop = V.oneOf(i, 'workshop', ['internal', 'external'], { def: 'internal' });
  const filters = V.arr(i, 'filters', { max: 5 }).map(x => String(x)).filter(x => ['oil', 'air', 'fuel', 'cabin'].includes(x));
  const parts = V.arr(i, 'parts', { max: 10 }); // [{itemId, qty}] issued from stock for internal changes
  const warehouseId = V.uuid(i, 'warehouseId');
  let stockCost = 0;
  if (workshop === 'internal' && parts.length) {
    if (!warehouseId) throw bad('warehouse', 'اختر المخزن الذي ستصرف منه الزيت والفلاتر', 'Choose the warehouse to issue oil and filters from', 'warehouseId');
    for (const p of parts) {
      const itemId = V.uuid(p, 'itemId', { req: true }); const qty = V.num(p, 'qty', { req: true, gt: 0 });
      const m = await core.stockMove(c, ctx, { type: 'issue', date, itemId, warehouseId, qty: -qty, ref: { ar: 'تغيير زيت ' + v.code, en: 'Oil change ' + v.code } });
      stockCost += -m.value;
    }
  }
  const extra = V.num(i, 'cost', { min: 0, def: 0 });
  const supplier = V.str(i, 'supplier', { max: 120, def: workshop === 'internal' ? 'internal' : '' });
  const cost = round2(workshop === 'internal' ? stockCost + extra : extra);
  const nextKm = V.int(i, 'nextKm', { def: odometer + t.oil_km, min: odometer });
  const oilType = V.str(i, 'oilType', { max: 40, def: '' });
  const liters = V.num(i, 'liters', { min: 0, def: t.oil_liters });
  const rec = await insert(c, 'oil_changes', { company_id: ctx.companyId, date, vehicle_id: vehicleId, odometer, oil_type: oilType, liters, filters, cost, workshop: supplier || workshop, next_km: nextKm, source: workshop === 'internal' ? 'internal' : 'provider', created_by: ctx.user.name });
  if (odometer > v.odometer) await c.query('UPDATE vehicles SET odometer = $1 WHERE id = $2', [odometer, vehicleId]);
  if (cost > 0) {
    const s = await core.settings(c, ctx);
    const tax = workshop === 'external' && V.bool(i, 'withVat', true) ? round2(extra * s.vatRate) : 0;
    const creditLines = workshop === 'internal'
      ? [{ a: 'inventory', credit: round2(stockCost) }, ...(extra ? [{ a: 'cash_main', credit: extra }] : [])]
      : [{ a: 'payables', credit: round2(cost + tax) }];
    await core.expense(c, ctx, { date, category: 'oil', amount: cost, tax, vehicleId, method: workshop === 'internal' ? 'inventory' : 'payable', supplier, sourceType: 'oil', sourceId: rec.id, sourceRef: rec.id, creditLines, desc: { ar: 'تغيير زيت ' + v.code, en: 'Oil change ' + v.code } });
  }
  await core.audit(c, ctx, 'create', 'oil_change', `${v.code} ${odometer}`);
  return { id: rec.id, nextKm };
});

/* ===================== WORK ORDERS ===================== */
async function woParts(c, woId) { return (await c.query('SELECT * FROM work_order_parts WHERE work_order_id = $1 ORDER BY created_at', [woId])).rows; }

define('wo.create', G.maint, async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true });
  const v = await core.lock(c, 'vehicles', vehicleId, 'vehicle');
  const s = await core.settings(c, ctx);
  const problem = V.text2(i, 'problem', { req: true, max: 300 });
  const date = V.date(i, 'date', { def: core.today() });
  const provider = V.oneOf(i, 'provider', ['internal', 'external'], { def: 'internal' });
  const supplierId = V.uuid(i, 'supplierId');
  if (provider === 'external') { if (!supplierId) throw bad('supplier', 'اختر المورد الخارجي', 'Choose the external supplier', 'supplierId'); await core.mustExist(c, 'suppliers', supplierId, 'supplier'); }
  const mechanics = V.arr(i, 'mechanics', { max: 10 }).map(m => (typeof m === 'string' ? { ar: m.slice(0, 80), en: m.slice(0, 80) } : { ar: String(m.ar || '').slice(0, 80), en: String(m.en || m.ar || '').slice(0, 80) }));
  const number = await core.nextNumber(c, ctx, 'WO', date);
  const toShop = V.bool(i, 'inWorkshop', true);
  const wo = await insert(c, 'work_orders', {
    company_id: ctx.companyId, number, vehicle_id: vehicleId, date, odometer: V.int(i, 'odometer', { def: v.odometer, min: 0 }), problem_ar: problem.ar, problem_en: problem.en,
    type: V.oneOf(i, 'type', ['preventive', 'repair', 'emergency', 'inspection'], { def: 'repair' }), provider, supplier_id: supplierId, mechanics: JSON.stringify(mechanics),
    labor_hours: V.num(i, 'laborHours', { min: 0, def: 0 }), labor_rate: V.num(i, 'laborRate', { min: 0, def: s.laborRate }), external_cost: V.num(i, 'externalCost', { min: 0, def: 0 }),
    status: 'open', down_start: date, source_inspection_id: V.uuid(i, 'inspectionId'), created_by: ctx.user.name,
  });
  for (const p of V.arr(i, 'parts', { max: 50 })) await addPart(c, ctx, wo.id, p);
  await refreshWoStatus(c, wo.id);
  if (toShop) await c.query("UPDATE vehicles SET status = 'maintenance' WHERE id = $1 AND status <> 'sold'", [vehicleId]);
  await core.audit(c, ctx, 'create', 'work_order', number);
  return { id: wo.id, number };
});

async function addPart(c, ctx, woId, p) {
  const itemId = V.uuid(p, 'itemId', { req: true }); const qty = V.num(p, 'qty', { req: true, gt: 0, max: 10000 });
  const it = await core.mustExist(c, 'items', itemId, 'item');
  await insert(c, 'work_order_parts', { company_id: ctx.companyId, work_order_id: woId, item_id: itemId, qty, unit_cost: it.avg_cost, issued: false });
}
async function refreshWoStatus(c, woId) {
  const wo = (await c.query('SELECT * FROM work_orders WHERE id = $1', [woId])).rows[0];
  if (!['open', 'waiting_parts', 'in_progress'].includes(wo.status)) return;
  const missing = (await c.query(`SELECT p.id FROM work_order_parts p WHERE p.work_order_id = $1 AND NOT p.issued
     AND p.qty > coalesce((SELECT sum(b.qty) FROM stock_balances b WHERE b.item_id = p.item_id), 0)`, [woId])).rowCount;
  const issuedAny = (await c.query('SELECT 1 FROM work_order_parts WHERE work_order_id = $1 AND issued', [woId])).rowCount;
  const status = missing ? 'waiting_parts' : issuedAny || wo.labor_hours > 0 ? 'in_progress' : 'open';
  await c.query('UPDATE work_orders SET status = $1 WHERE id = $2', [status, woId]);
}

define('wo.update', G.maint, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const wo = await core.lock(c, 'work_orders', id, 'work order');
  if (!['open', 'waiting_parts', 'in_progress'].includes(wo.status)) throw conflict('closed', 'أمر الشغل مقفول ولا يمكن تعديله', 'The work order is closed and cannot be changed');
  const problem = P(i, 'problem', V.text2, { max: 300 });
  const f = defined({
    problem_ar: problem ? problem.ar : undefined, problem_en: problem ? problem.en : undefined,
    labor_hours: P(i, 'laborHours', V.num, { min: 0 }), labor_rate: P(i, 'laborRate', V.num, { min: 0 }), external_cost: P(i, 'externalCost', V.num, { min: 0 }),
    type: P(i, 'type', V.oneOf, ['preventive', 'repair', 'emergency', 'inspection']),
  });
  if (has(i, 'mechanics')) f.mechanics = JSON.stringify(V.arr(i, 'mechanics', { max: 10 }).map(m => ({ ar: String(m.ar || m).slice(0, 80), en: String(m.en || m.ar || m).slice(0, 80) })));
  await update(c, 'work_orders', id, f);
  for (const p of V.arr(i, 'addParts', { max: 50 })) await addPart(c, ctx, id, p);
  for (const pid of V.arr(i, 'removeParts', { max: 50 })) {
    const r = await c.query('DELETE FROM work_order_parts WHERE id = $1 AND work_order_id = $2 AND NOT issued', [String(pid), id]);
    if (!r.rowCount) throw conflict('issued', 'لا يمكن حذف قطعة تم صرفها', 'A part that was already issued cannot be removed');
  }
  await refreshWoStatus(c, id);
  await core.audit(c, ctx, 'update', 'work_order', wo.number);
});

async function issueParts(c, ctx, wo, warehouseId, date) {
  const parts = (await woParts(c, wo.id)).filter(p => !p.issued);
  const v = await core.mustExist(c, 'vehicles', wo.vehicle_id);
  const missing = [];
  for (const p of parts) {
    const bal = (await c.query('SELECT qty FROM stock_balances WHERE warehouse_id = $1 AND item_id = $2', [warehouseId, p.item_id])).rows[0];
    if (!bal || bal.qty < p.qty) { const it = await core.mustExist(c, 'items', p.item_id); missing.push(`${it.name_ar} × ${p.qty}`); continue; }
    const m = await core.stockMove(c, ctx, { type: 'issue', date, itemId: p.item_id, warehouseId, qty: -p.qty, workOrderId: wo.id, ref: { ar: `${wo.number} · ${v.code}`, en: `${wo.number} · ${v.code}` } });
    await c.query('UPDATE work_order_parts SET issued = true, unit_cost = $1 WHERE id = $2', [Math.abs(m.value) / p.qty, p.id]);
  }
  return missing;
}

define('wo.issueParts', G.maint, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const wo = await core.lock(c, 'work_orders', id, 'work order');
  if (!['open', 'waiting_parts', 'in_progress'].includes(wo.status)) throw conflict('closed', 'أمر الشغل مقفول', 'The work order is closed');
  const warehouseId = V.uuid(i, 'warehouseId', { req: true });
  await core.mustExist(c, 'warehouses', warehouseId, 'warehouse');
  const missing = await issueParts(c, ctx, wo, warehouseId, V.date(i, 'date', { def: core.today() }));
  await refreshWoStatus(c, id);
  await core.audit(c, ctx, 'update', 'work_order', wo.number, { field: 'parts', before: '', after: 'issued' });
  return { missing };
});

define('wo.close', G.maint, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const wo = await core.lock(c, 'work_orders', id, 'work order');
  if (!['open', 'waiting_parts', 'in_progress'].includes(wo.status)) throw conflict('closed', 'أمر الشغل مقفول بالفعل', 'The work order is already closed');
  const date = V.date(i, 'date', { def: core.today() });
  if (date < wo.down_start) throw bad('date', 'تاريخ القفل قبل تاريخ فتح أمر الشغل', 'The close date is before the work order date', 'date');
  const warehouseId = V.uuid(i, 'warehouseId');
  if (has(i, 'laborHours')) await c.query('UPDATE work_orders SET labor_hours = $1 WHERE id = $2', [V.num(i, 'laborHours', { min: 0 }), id]);
  if (has(i, 'externalCost')) await c.query('UPDATE work_orders SET external_cost = $1 WHERE id = $2', [V.num(i, 'externalCost', { min: 0 }), id]);
  let pending = (await woParts(c, id)).filter(p => !p.issued);
  if (pending.length) {
    if (!warehouseId) throw bad('warehouse', 'فيه قطع لسه ما اتصرفتش. اختر المخزن للصرف منه.', 'Some parts are not issued yet. Choose the warehouse to issue them from.', 'warehouseId');
    const missing = await issueParts(c, ctx, wo, warehouseId, date);
    if (missing.length) throw conflict('missing_parts', 'لا يمكن القفل — قطع غير متاحة في المخزن: ' + missing.join('، '), 'Cannot close — parts not in stock: ' + missing.join(', '));
  }
  const cur = (await c.query('SELECT * FROM work_orders WHERE id = $1', [id])).rows[0];
  const parts = await woParts(c, id);
  const partsCost = round2(parts.reduce((s, p) => s + p.qty * p.unit_cost, 0));
  const laborCost = round2(cur.labor_hours * cur.labor_rate);
  const external = round2(cur.external_cost);
  const total = round2(partsCost + laborCost + external);
  const days = core.diffDays(date, cur.down_start) + 1;
  await c.query("UPDATE work_orders SET status = 'closed', parts_cost = $1, labor_cost = $2, total = $3, down_end = $4, downtime_days = $5, next_date = $6 WHERE id = $7",
    [partsCost, laborCost, total, date, days, V.date(i, 'nextDate'), id]);
  await c.query("UPDATE service_requests SET status = 'completed' WHERE work_order_id = $1", [id]);
  const v = await core.mustExist(c, 'vehicles', cur.vehicle_id);
  const stillOpen = (await c.query("SELECT 1 FROM work_orders WHERE vehicle_id = $1 AND id <> $2 AND status IN ('open','waiting_parts','in_progress')", [v.id, id])).rowCount;
  if (!stillOpen && v.status === 'maintenance') await c.query("UPDATE vehicles SET status = 'active' WHERE id = $1", [v.id]);
  const s = await core.settings(c, ctx);
  if (total > 0) {
    const tax = cur.provider === 'external' && V.bool(i, 'withVat', true) ? round2(external * s.vatRate) : 0;
    let supplier = '-';
    if (cur.supplier_id) supplier = (await core.mustExist(c, 'suppliers', cur.supplier_id)).name_en;
    await core.expense(c, ctx, {
      date, category: 'maintenance', amount: total, tax, vehicleId: v.id, method: 'mixed', supplier, sourceType: 'work_order', sourceId: id, sourceRef: cur.number,
      creditLines: [{ a: 'inventory', credit: partsCost }, { a: 'labor_applied', credit: laborCost }, { a: 'payables', credit: round2(external + tax) }],
      desc: { ar: `أمر شغل ${cur.number} · ${v.code}`, en: `Work order ${cur.number} · ${v.code}` },
    });
  }
  await core.audit(c, ctx, 'update', 'work_order', cur.number, { field: 'status', before: cur.status, after: 'closed' });
  await core.emit(c, ctx, 'work_order.closed', { id, number: cur.number, vehicleId: v.id, total, downtimeDays: days });
  return { total };
});

define('wo.cancel', G.maint, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true });
  const wo = await core.lock(c, 'work_orders', id, 'work order');
  if (!['open', 'waiting_parts', 'in_progress'].includes(wo.status)) throw conflict('closed', 'أمر الشغل مقفول', 'The work order is closed');
  const date = core.today();
  const issued = (await woParts(c, id)).filter(p => p.issued);
  if (issued.length) {
    const warehouseId = V.uuid(i, 'warehouseId', { req: true });
    for (const p of issued) await core.stockMove(c, ctx, { type: 'return_wo', date, itemId: p.item_id, warehouseId, qty: p.qty, unitCost: p.unit_cost, workOrderId: id, ref: { ar: 'مرتجع ' + wo.number, en: 'Return ' + wo.number } });
  }
  await c.query("UPDATE work_orders SET status = 'cancelled', down_end = $1 WHERE id = $2", [date, id]);
  const stillOpen = (await c.query("SELECT 1 FROM work_orders WHERE vehicle_id = $1 AND status IN ('open','waiting_parts','in_progress')", [wo.vehicle_id])).rowCount;
  if (!stillOpen) await c.query("UPDATE vehicles SET status = 'active' WHERE id = $1 AND status = 'maintenance'", [wo.vehicle_id]);
  await core.audit(c, ctx, 'update', 'work_order', wo.number, { field: 'status', before: wo.status, after: 'cancelled' });
});

/* a dispatcher or driver reports a problem: opens a work order without stopping the vehicle */
define('vehicle.reportIssue', G.opsMaint, async (ctx, i, c) => {
  const v = await core.mustExist(c, 'vehicles', V.uuid(i, 'vehicleId', { req: true }), 'vehicle');
  const problem = V.text2(i, 'problem', { req: true, max: 300 });
  const s = await core.settings(c, ctx);
  const date = core.today();
  const number = await core.nextNumber(c, ctx, 'WO', date);
  const urgent = V.bool(i, 'urgent', false);
  const wo = await insert(c, 'work_orders', { company_id: ctx.companyId, number, vehicle_id: v.id, date, odometer: v.odometer, problem_ar: problem.ar, problem_en: problem.en, type: urgent ? 'emergency' : 'repair', provider: 'internal', mechanics: '[]', labor_rate: s.laborRate, status: 'open', down_start: date, created_by: ctx.user.name });
  if (urgent) await c.query("UPDATE vehicles SET status = 'maintenance' WHERE id = $1 AND status = 'active'", [v.id]);
  await core.audit(c, ctx, 'create', 'work_order', number, { field: 'reported', before: '', after: problem.en });
  return { id: wo.id, number };
});

/* ===================== TIRES & BATTERIES ===================== */
define('tire.create', G.maint, async (ctx, i, c) => {
  const kind = V.oneOf(i, 'kind', ['tire', 'battery'], { def: 'tire' });
  const t = await insert(c, 'tires', {
    company_id: ctx.companyId, serial: V.str(i, 'serial', { req: true, max: 40 }), kind, item_id: V.uuid(i, 'itemId'), brand: V.str(i, 'brand', { max: 40, def: '' }), size: V.str(i, 'size', { max: 30, def: '' }),
    tread: kind === 'tire' ? V.num(i, 'tread', { min: 0, max: 30, def: 16 }) : null, cost: V.num(i, 'cost', { min: 0, def: 0 }), status: 'in_stock', limit_km: V.int(i, 'limitKm', { min: 0 }), created_by: ctx.user.name,
  });
  await core.audit(c, ctx, 'create', 'tire', t.serial);
  return { id: t.id };
});

async function positionsFor(c, v) { const t = await vtype(c, v.type); return [...t.tire_positions, 'SP', 'BAT']; }

define('tire.mount', G.maint, async (ctx, i, c) => {
  const t = await core.lock(c, 'tires', V.uuid(i, 'id', { req: true }), 'tire');
  if (t.status !== 'in_stock') throw conflict('not_in_stock', 'الكاوتش/البطارية مش في المخزن', 'This tire/battery is not in stock');
  const v = await core.lock(c, 'vehicles', V.uuid(i, 'vehicleId', { req: true }), 'vehicle');
  const pos = V.str(i, 'position', { req: true, max: 6 });
  const allowed = await positionsFor(c, v);
  if (!allowed.includes(pos) || (t.kind === 'battery') !== (pos === 'BAT')) throw bad('position', 'المكان غير مناسب لهذه المركبة', 'That position is not valid for this vehicle', 'position');
  const busy = (await c.query("SELECT serial FROM tires WHERE vehicle_id = $1 AND position = $2 AND status = 'mounted'", [v.id, pos])).rows[0];
  if (busy) throw conflict('position_busy', `المكان ${pos} عليه ${busy.serial}. استخدم الاستبدال.`, `Position ${pos} already has ${busy.serial}. Use replace instead.`);
  await c.query("UPDATE tires SET status = 'mounted', vehicle_id = $1, position = $2, install_date = $3, install_km = $4 WHERE id = $5", [v.id, pos, core.today(), v.odometer, t.id]);
  await core.audit(c, ctx, 'update', 'tire', t.serial, { field: 'position', before: '', after: `${v.code} ${pos}` });
});

define('tire.action', G.maint, async (ctx, i, c) => {
  const t = await core.lock(c, 'tires', V.uuid(i, 'id', { req: true }), 'tire');
  const action = V.oneOf(i, 'action', ['replace', 'rotate', 'scrap', 'unmount', 'tread'], { req: true });
  const v = t.vehicle_id ? await core.lock(c, 'vehicles', t.vehicle_id, 'vehicle') : null;
  const today = core.today();
  if (action === 'tread') { await c.query('UPDATE tires SET tread = $1 WHERE id = $2', [V.num(i, 'tread', { req: true, min: 0, max: 30 }), t.id]); }
  else if (action === 'scrap') { await c.query("UPDATE tires SET status = 'scrapped', vehicle_id = NULL, position = NULL WHERE id = $1", [t.id]); }
  else if (action === 'unmount') { if (!v) throw conflict('not_mounted', 'غير مركّب', 'Not mounted'); await c.query("UPDATE tires SET status = 'in_stock', vehicle_id = NULL, position = NULL WHERE id = $1", [t.id]); }
  else if (action === 'replace') {
    if (!v) throw conflict('not_mounted', 'غير مركّب على مركبة', 'Not mounted on a vehicle');
    const n = await core.lock(c, 'tires', V.uuid(i, 'newId', { req: true }), 'replacement');
    if (n.status !== 'in_stock' || n.kind !== t.kind) throw conflict('bad_replacement', 'البديل غير متاح أو من نوع مختلف', 'The replacement is not available or is a different kind');
    const old = V.oneOf(i, 'oldTo', ['scrapped', 'in_stock'], { def: 'scrapped' });
    await c.query('UPDATE tires SET status = $1, vehicle_id = NULL, position = NULL WHERE id = $2', [old, t.id]);
    await c.query("UPDATE tires SET status = 'mounted', vehicle_id = $1, position = $2, install_date = $3, install_km = $4 WHERE id = $5", [v.id, t.position, today, v.odometer, n.id]);
  } else if (action === 'rotate') {
    if (!v) throw conflict('not_mounted', 'غير مركّب على مركبة', 'Not mounted on a vehicle');
    const withPos = V.str(i, 'withPosition', { def: 'SP', max: 6 });
    const other = (await c.query("SELECT * FROM tires WHERE vehicle_id = $1 AND position = $2 AND status = 'mounted' FOR UPDATE", [v.id, withPos])).rows[0];
    if (!other) throw conflict('no_partner', `لا يوجد كاوتش في المكان ${withPos}`, `There is no tire at position ${withPos}`);
    await c.query('UPDATE tires SET position = NULL WHERE id = $1', [other.id]);
    await c.query('UPDATE tires SET position = $1 WHERE id = $2', [withPos, t.id]);
    await c.query('UPDATE tires SET position = $1 WHERE id = $2', [t.position, other.id]);
  }
  await core.audit(c, ctx, 'update', 'tire', t.serial, { field: action, before: t.position || '', after: '' });
});

/* ===================== INSPECTIONS ===================== */
define('inspection.create', G.opsMaint, async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true });
  const v = await core.lock(c, 'vehicles', vehicleId, 'vehicle');
  const failed = V.arr(i, 'failed', { max: 20 }).map(String).filter(x => INSPECTION_ITEMS.includes(x));
  const date = V.date(i, 'date', { def: core.today() });
  let tripId = V.uuid(i, 'tripId');
  if (tripId) { const t = await core.mustExist(c, 'trips', tripId, 'trip'); if (t.vehicle_id !== vehicleId) throw bad('trip', 'الرحلة ليست على هذه المركبة', 'That trip is not on this vehicle', 'tripId'); }
  else { const t = (await c.query("SELECT id FROM trips WHERE vehicle_id = $1 AND date BETWEEN $2 AND $3 AND status = 'scheduled' ORDER BY date, start_time LIMIT 1", [vehicleId, date, core.addDays(date, 1)])).rows[0]; tripId = t ? t.id : null; }
  const driverId = V.uuid(i, 'driverId') || v.driver_id;
  const ins = await insert(c, 'inspections', { company_id: ctx.companyId, date, trip_id: tripId, vehicle_id: vehicleId, driver_id: driverId, result: failed.length ? 'failed' : 'passed', failed_items: failed, items: INSPECTION_ITEMS, notes: V.str(i, 'notes', { max: 1000, def: '' }), created_by: ctx.user.name });
  const critical = failed.filter(f => CRITICAL_ITEMS.includes(f));
  let wo = null;
  if (critical.length) {
    const names = { tires: ['الكاوتش', 'Tires'], brakes: ['الفرامل', 'Brakes'], lights: ['الإضاءة', 'Lights'] };
    const number = await core.nextNumber(c, ctx, 'WO', date);
    const s = await core.settings(c, ctx);
    wo = await insert(c, 'work_orders', { company_id: ctx.companyId, number, vehicle_id: vehicleId, date, odometer: v.odometer, problem_ar: 'فشل فحص: ' + critical.map(x => names[x][0]).join('، '), problem_en: 'Failed inspection: ' + critical.map(x => names[x][1]).join(', '), type: 'inspection', provider: 'internal', labor_rate: s.laborRate, status: 'open', down_start: date, source_inspection_id: ins.id, created_by: ctx.user.name });
    await c.query("UPDATE vehicles SET status = 'maintenance' WHERE id = $1", [vehicleId]);
  }
  await core.audit(c, ctx, 'create', 'inspection', `${v.code} ${failed.length ? 'failed' : 'passed'}`);
  return { id: ins.id, workOrder: wo ? { id: wo.id, number: wo.number } : null, blocked: !!wo };
});

module.exports = { addFuel, vtype };
