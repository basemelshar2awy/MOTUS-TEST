'use strict';
/* Vehicle types per company.
   A type is the company's own (code, name, costs, capacity) and belongs to a platform category
   (vehicle_categories: bus, minibus, microbus, car, van, trucks, trailer). The category says
   which activities the type serves, so a company only sees and uses the types of its activities:
   a cargo company gets trucks, a school transport company gets buses and cars.

   Capacity is seats + payload (kg) + volume (m³). A type needs at least one of seats or payload. */
const D = require('./defaults');
const { bad, AppError } = require('./errors');
const activities = require('./activities');

/* categories that serve at least one of the given activities */
async function categoriesFor(c, acts) {
  return (await c.query('SELECT * FROM vehicle_categories WHERE activities && $1::text[] ORDER BY sort', [acts])).rows;
}

/* Add the starting types for the company's activities (only the ones it does not have yet).
   Called when a company is created and when an activity is turned on. */
async function seedDefaults(c, companyId, acts) {
  const cats = new Set((await categoriesFor(c, acts)).map(r => r.code));
  let added = 0;
  for (const t of D.VEHICLE_TYPES) {
    if (!cats.has(t.category)) continue;
    const r = await c.query(`INSERT INTO vehicle_types (company_id, code, category, name_ar, name_en, seats, payload_kg, volume_m3, fuel, oil_km, life_years, life_km, salvage_pct, tank_l, kmpl, price_min, price_max, rate_km, base_price, toll_gate, oil_cost, oil_liters, insurance, license, tire_positions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      ON CONFLICT (company_id, code) DO NOTHING`,
    [companyId, t.code, t.category, t.ar, t.en, t.seats, t.payloadKg || 0, t.volumeM3 || 0, t.fuel, t.oilKm, t.lifeYears, t.lifeKm, t.salvagePct, t.tank, t.kmpl, t.priceMin, t.priceMax, t.rateKm, t.base, t.tollGate, t.oilCost, t.oilLiters, t.insurance, t.license, t.tires]);
    added += r.rowCount;
  }
  return added;
}

/* Is this category usable by the company (one of its activities)? */
async function checkCategory(c, ctx, category) {
  const cat = (await c.query('SELECT * FROM vehicle_categories WHERE code = $1', [category])).rows[0];
  if (!cat) throw bad('category', 'فئة المركبة غير معروفة', 'Unknown vehicle category', 'category');
  const acts = await activities.enabled(c, ctx);
  if (!cat.activities.some(a => acts.includes(a))) {
    throw new AppError(403, 'activity_disabled', `فئة "${cat.name_ar}" تبع نشاط مش مفعّل لشركتك`, `The "${cat.name_en}" category belongs to an activity that is not enabled for your company`, { field: 'category' });
  }
  return cat;
}

const CODE = /^[A-Z0-9]{2,8}$/;
/* Resolve a type code given in a request: it must be one of the company's own, active types,
   and its category must serve one of the company's activities. */
async function resolve(c, ctx, code, field = 'vehicleType') {
  if (!code || !CODE.test(String(code))) throw bad('type', 'نوع المركبة مطلوب', 'The vehicle type is required', field);
  const t = (await c.query('SELECT t.*, k.kind, k.activities cat_activities, k.name_ar cat_ar, k.name_en cat_en FROM vehicle_types t JOIN vehicle_categories k ON k.code = t.category WHERE t.code = $1', [code])).rows[0];
  if (!t) throw bad('type', `نوع المركبة "${code}" غير معرّف في إعدادات الشركة`, `Vehicle type "${code}" is not set up for the company`, field);
  if (!t.active) throw bad('type_retired', `نوع المركبة "${code}" موقوف`, `Vehicle type "${code}" is retired`, field);
  const acts = await activities.enabled(c, ctx);
  if (!t.cat_activities.some(a => acts.includes(a))) {
    throw new AppError(403, 'activity_disabled', `نوع "${t.name_ar}" تبع نشاط مش مفعّل لشركتك`, `The "${t.name_en || t.name_ar}" type belongs to an activity that is not enabled for your company`, { field });
  }
  return t;
}

module.exports = { categoriesFor, seedDefaults, checkCategory, resolve, CODE };
