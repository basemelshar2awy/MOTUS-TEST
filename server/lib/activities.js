'use strict';
/* Company activities.
   A company subscribed to MOTUS picks one or more activities. The shared core (fleet,
   maintenance, inventory, tracking, dispatch, bookings, trips, finance, reports, AI, settings,
   Open API) is always on; each activity unlocks its own tools on top of it.

   This module is the single place that says which action, input field, API scope, place kind
   and screen belongs to which activity. The server enforces it (action registry, snapshot,
   Open API, API keys); the browser only hides what the server would refuse anyway.

   Turning an activity off never deletes data: the rows stay, they are just hidden and blocked
   until the activity is turned on again. */
const { AppError, bad } = require('./errors');

const CATALOG = [
  { code: 'tourism', name: { ar: 'النقل السياحي', en: 'Tourism transport' } },
  { code: 'education', name: { ar: 'النقل التعليمي', en: 'Education transport' } },
  { code: 'intercity', name: { ar: 'النقل بين المدن', en: 'Intercity transport' } },
  { code: 'staff', name: { ar: 'نقل الموظفين', en: 'Staff transport' } },
  { code: 'cargo', name: { ar: 'نقل البضائع', en: 'Cargo transport' } },
];
const CODES = CATALOG.map(a => a.code);

/* whole actions that belong to one activity (anything not listed is shared core) */
const ACTION_ACTIVITY = {
  'program.create': 'tourism',
  'program.schedule': 'tourism',
  'program.cancel': 'tourism',
  'invoice.fromProgram': 'tourism',
};

/* input fields of shared actions that belong to one activity: dropped when it is off */
const FIELD_ACTIVITY = {
  'booking.create': { flight: 'tourism' },
  'booking.update': { flight: 'tourism' },
  'trip.update': { flight: 'tourism', flightStatus: 'tourism' },
};
/* passenger manifest columns that belong to tourism */
const PASSENGER_FIELDS = { nationality: 'tourism', passportNo: 'tourism', hotel: 'tourism' };

/* place kinds that belong to one activity */
const PLACE_KIND_ACTIVITY = { airport: 'tourism', hotel: 'tourism' };

/* Open API resources / API key scopes that belong to one activity */
const SCOPE_ACTIVITY = { programs: 'tourism' };

const label = code => (CATALOG.find(a => a.code === code) || { name: { ar: code, en: code } }).name;

function disabledError(code) {
  const n = label(code);
  return new AppError(403, 'activity_disabled',
    `نشاط "${n.ar}" مش مفعّل لشركتك. تواصل مع فريق سبيل لتفعيله.`,
    `The "${n.en}" activity is not enabled for your company. Contact the Sabeel team to enable it.`,
    { activity: code });
}

/* enabled activity codes of the company in the current transaction (cached on ctx) */
async function enabled(c, ctx) {
  if (ctx._activities) return ctx._activities;
  const r = await c.query('SELECT activity FROM company_activities WHERE enabled ORDER BY activity');
  ctx._activities = r.rows.map(x => x.activity);
  return ctx._activities;
}
const has = (list, code) => !code || list.includes(code);

/* Called by the action registry before every handler. Throws when the action belongs to an
   activity the company does not have; otherwise returns the input with fields of disabled
   activities removed. */
async function gate(c, ctx, name, def, input) {
  const list = await enabled(c, ctx);
  const own = (def && def.opts && def.opts.activity) || ACTION_ACTIVITY[name];
  if (!has(list, own)) throw disabledError(own);
  let out = input;
  const fields = FIELD_ACTIVITY[name];
  if (fields) {
    for (const [f, code] of Object.entries(fields)) {
      if (!has(list, code) && Object.prototype.hasOwnProperty.call(out, f)) { if (out === input) out = Object.assign({}, input); delete out[f]; }
    }
  }
  if (name === 'trip.passengers' && !list.includes('tourism') && Array.isArray(out.passengers)) {
    out = Object.assign({}, out, { passengers: out.passengers.map(p => { if (!p || typeof p !== 'object') return p; const q = Object.assign({}, p); for (const f of Object.keys(PASSENGER_FIELDS)) delete q[f]; return q; }) });
  }
  if ((name === 'place.create' || name === 'place.update') && out.kind) {
    // a place kind belongs to the activities that use it (lib/profiles); garages, clients and restricted areas to everyone
    const P = require('./profiles');
    if (!P.COMMON_PLACE_KINDS.includes(out.kind) && !list.some(a => P.PROFILES[a] && P.PROFILES[a].placeKinds.includes(out.kind))) {
      const owner = P.CODES.find(a => P.PROFILES[a].placeKinds.includes(out.kind));
      if (owner) throw disabledError(owner);
    }
  }
  return out;
}

/* API key scopes ("programs:read") of disabled activities */
function scopeActivity(scope) { return SCOPE_ACTIVITY[String(scope).split(':')[0]] || null; }

/* validate a list of activity codes coming from a request */
function parseList(input, field = 'activities', { required = true } = {}) {
  const raw = input[field];
  if (raw == null && !required) return null;
  if (!Array.isArray(raw)) throw bad('activities', 'اختر نشاط واحد على الأقل', 'Choose at least one activity', field);
  const list = [...new Set(raw.map(String))];
  if (!list.length) throw bad('activities', 'اختر نشاط واحد على الأقل', 'Choose at least one activity', field);
  for (const code of list) if (!CODES.includes(code)) throw bad('activities', 'نشاط غير معروف: ' + code, 'Unknown activity: ' + code, field);
  return CODES.filter(code => list.includes(code));
}

/* Make the company's enabled activities exactly `list` (inside a transaction with the
   company set). Every change is written to the append-only history. Returns the change. */
async function apply(c, companyId, list, actor) {
  const rows = (await c.query('SELECT activity, enabled FROM company_activities')).rows;
  const now = new Map(rows.map(r => [r.activity, r.enabled]));
  const on = list.filter(code => !now.get(code));
  const off = [...now.entries()].filter(([code, en]) => en && !list.includes(code)).map(([code]) => code);
  for (const code of on) {
    await c.query(`INSERT INTO company_activities (company_id, activity, enabled, enabled_at, disabled_at, created_by) VALUES ($1,$2,true,now(),NULL,$3)
      ON CONFLICT (company_id, activity) DO UPDATE SET enabled = true, enabled_at = now(), disabled_at = NULL`, [companyId, code, actor]);
    await c.query("INSERT INTO company_activity_events (company_id, activity, action, actor) VALUES ($1,$2,'enabled',$3)", [companyId, code, actor]);
  }
  for (const code of off) {
    await c.query('UPDATE company_activities SET enabled = false, disabled_at = now() WHERE activity = $1', [code]);
    await c.query("INSERT INTO company_activity_events (company_id, activity, action, actor) VALUES ($1,$2,'disabled',$3)", [companyId, code, actor]);
  }
  // a newly enabled activity brings its starting vehicle types (lazy require: vehicletypes needs this module)
  if (on.length) await require('./vehicletypes').seedDefaults(c, companyId, list);
  // and its starting places (kept if the company already has them)
  if (on.length && rows.length) {
    const P = require('./profiles'), C = require('./countries');
    const co = (await c.query('SELECT country FROM companies WHERE id = $1', [companyId])).rows[0];
    const pack = C.pack(co && co.country);
    for (const [code, ar, en, lat, lng, kind, radius] of P.placesFor(pack.places, pack.code, on)) {
      await c.query('INSERT INTO places (company_id, code, name_ar, name_en, kind, lat, lng, radius_m) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [companyId, code, ar, en, kind, lat, lng, radius]);
    }
  }
  return { enabled: on, disabled: off };
}

module.exports = { CATALOG, CODES, ACTION_ACTIVITY, FIELD_ACTIVITY, PLACE_KIND_ACTIVITY, SCOPE_ACTIVITY, label, enabled, gate, scopeActivity, parseList, apply, disabledError };
