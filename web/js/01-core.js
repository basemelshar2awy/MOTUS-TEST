/* MOTUS — core helpers: dates, formatting, i18n. Runs in the browser and (for the Open API
   reports) inside the server. All numbers use Western digits in both languages. */
'use strict';
var M = (typeof window !== 'undefined' ? window : globalThis).M = {};

/* ---------- dates (ISO yyyy-mm-dd strings, UTC math) ---------- */
M.TODAY = new Date().toISOString().slice(0, 10);   // replaced by the server's company-time-zone date at login
/* now as 'YYYY-MM-DD HH:MM' in the company's time zone (same format as the server's timestamps) */
M.nowLocal = () => { try { const z = M.TZ; return new Intl.DateTimeFormat('en-CA', { timeZone: z || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(',', '').replace(' 24:', ' 00:'); } catch (e) { return M.TODAY + ' 00:00'; } };
M.START = M.TODAY;                                   // first day with data (company go-live)
M.d = s => new Date(s + 'T00:00:00Z');
M.iso = dt => dt.toISOString().slice(0, 10);
M.addDays = (s, n) => { const t = M.d(s); t.setUTCDate(t.getUTCDate() + n); return M.iso(t); };
M.diffDays = (a, b) => Math.round((M.d(a) - M.d(b)) / 86400000);
M.month = s => s.slice(0, 7);
M.monthsBetween = (a, b) => { const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7); const ey = +b.slice(0, 4), em = +b.slice(5, 7); while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; };
M.addMonths = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
M.daysInMonth = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
M.dow = s => M.d(s).getUTCDay();
M.maxDate = (a, b) => (a > b ? a : b);

/* ---------- language ---------- */
M.lang = 'ar';
try { const l = localStorage.getItem('motus.lang'); if (l === 'en' || l === 'ar') M.lang = l; } catch (e) { }

M.dict = {};
M.addDict = obj => Object.assign(M.dict, obj);
M.t = (k, ...args) => {
  const e = M.dict[k];
  let s = e ? (M.lang === 'ar' ? e[0] : e[1]) : k;
  args.forEach((a, i) => { s = s.replace('{' + i + '}', a); });
  return s;
};
/* bilingual object {ar, en} or plain string */
M.L = v => (v && typeof v === 'object' && 'ar' in v) ? (v[M.lang] || v.ar || v.en || '') : (v == null ? '' : v);

/* ---------- formatting ---------- */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
M.n0 = v => (v == null || isNaN(v)) ? '—' : nf0.format(Math.round(v));
M.n1 = v => (v == null || isNaN(v)) ? '—' : nf1.format(v);
M.n2 = v => (v == null || isNaN(v)) ? '—' : nf2.format(v);
M.currency = 'EGP';
M.cur = () => M.currency === 'EGP' ? (M.lang === 'ar' ? 'ج.م' : 'EGP') : M.currency === 'SAR' ? (M.lang === 'ar' ? 'ر.س' : 'SAR') : M.currency;
/* the company's country pack (labels, formats, license classes); Egypt until a snapshot arrives */
M.pack = null;
M.field = (k, fallback) => { const f = M.pack && M.pack.fields[k]; return f ? f : { label: { ar: fallback[0], en: fallback[1] }, placeholder: '', hint: null, pattern: null }; };
M.money = v => (v == null || isNaN(v)) ? '—' : `${nf0.format(Math.round(v))} ${M.cur()}`;
M.moneyK = v => { if (v == null || isNaN(v)) return '—'; const a = Math.abs(v); const s = a >= 1e6 ? nf2.format(v / 1e6) + (M.lang === 'ar' ? ' مليون' : 'M') : a >= 1e4 ? nf0.format(v / 1e3) + (M.lang === 'ar' ? ' ألف' : 'K') : nf0.format(v); return `${s} ${M.cur()}`; };
M.pct = (v, d = 1) => (v == null || isNaN(v) || !isFinite(v)) ? '—' : `${(v * 100).toFixed(d)}%`;
M.date = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—';
M.monthName = ym => {
  const ar = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const en = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const i = +ym.slice(5, 7) - 1; return (M.lang === 'ar' ? ar[i] : en[i]) + ' ' + ym.slice(0, 4);
};
M.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- small collection helpers ---------- */
M.sum = (arr, f) => arr.reduce((s, x) => s + (f ? (+f(x) || 0) : (+x || 0)), 0);
M.groupBy = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
M.by = (arr, key) => { const m = {}; for (const x of arr) m[x[key]] = x; return m; };
M.avg = (arr, f) => arr.length ? M.sum(arr, f) / arr.length : 0;
M.uid = (() => { let i = 0; return p => `${p}-${(++i).toString(36).padStart(5, '0')}`; })();
M.tt = (ar, en) => M.lang === 'ar' ? ar : en;

/* deterministic pseudo-random generator — used only for chart colors/jitter, never for data */
M.rng = function (seed) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return r;
};

/* ---------- company data loaded from the server ----------
   snap = { today, company, data: {...collections, vehicleTypes, geofences, routes, settings} } */
M.db = {};
M.companies = [];
/* company activities (tourism, education, intercity, staff, cargo): the server decides; the UI only hides */
M.activities = [];
M.activityCatalog = [];
M.has = code => !code || (Array.isArray(code) ? code.some(c => M.activities.includes(c)) : M.activities.includes(code));
/* vehicle types a company can use for NEW vehicles and bookings (active + a category of its activities) */
M.vehicleCategories = [];
M.usableTypes = () => Object.keys(M.vehicleClasses).filter(k => M.vehicleClasses[k].usable !== false);
M.cargoTypes = () => M.usableTypes().filter(k => (M.vehicleClasses[k].payloadKg || 0) > 0);
M.vehicleClasses = {}; M.places = {}; M.routes = {}; M.fuelPrice = { diesel: 0, gasoline: 0 };
/* activity profiles (server/lib/profiles.js): each activity's units, trip types, load, places, client types */
M.profiles = { byActivity: {}, placeKinds: {}, clientTypes: {}, cargoFlags: {}, commonPlaceKinds: [], tripTypeNames: {} };
M.acts = () => Object.keys(M.profiles.byActivity);
M.prof = a => M.profiles.byActivity[a] || null;
M.single = () => { const a = M.acts(); return a.length === 1 ? a[0] : null; };
M.multi = () => M.acts().length > 1;
M.actName = a => (M.activityCatalog.find(x => x.code === a) || { name: { ar: a, en: a } }).name;
M.typeName = t => M.profiles.tripTypeNames[t] || (M.tripTypes && M.tripTypes[t]) || { ar: t, en: t };
/* what a booking or trip carries, in its activity's words: "25 طالب", "5,000 كجم" */
M.loadText = (x, act) => { const p = M.prof(act || x.activity); if ((act || x.activity) === 'cargo') return x.loadKg ? `${M.n0(x.loadKg)} ${M.tt('كجم', 'kg')}` : '—'; return `${x.pax || 0} ${p ? M.L(p.load.short) : M.tt('راكب', 'pax')}`; };
/* the places an activity uses (its kinds + garages, clients, restricted areas) */
M.placesFor = act => { const p = M.prof(act); const kinds = new Set([...(p ? p.placeKinds : Object.keys(M.profiles.placeKinds)), ...M.profiles.commonPlaceKinds]); return Object.keys(M.places).filter(k => kinds.has(M.places[k].kind)); };
/* vehicle types usable for an activity (its categories) */
M.typesFor = act => M.usableTypes().filter(k => { const cat = M.vehicleCategories.find(c => c.code === (M.vehicleClasses[k] || {}).category); return !act || !cat || (cat.activities || []).includes(act); });
/* client types of the company's activities */
M.clientTypesFor = act => [...new Set((act ? [act] : M.acts()).flatMap(a => (M.prof(a) || { clientTypes: [] }).clientTypes))];
M.applySnapshot = snap => {
  const D = snap.data, cid = snap.company.id;
  M.TODAY = snap.today;
  M.TZ = snap.company.timezone || null;
  M.activities = snap.activities || [];
  M.activityCatalog = snap.activityCatalog || [];
  M.profiles = Object.assign({ byActivity: {}, placeKinds: {}, clientTypes: {}, cargoFlags: {}, commonPlaceKinds: [], tripTypeNames: {} }, snap.profiles || {});
  M.currency = snap.company.currency || 'EGP';
  M.pack = snap.company.countryPack || null;
  M.db = {}; M.db[cid] = D;
  M.vehicleClasses = {};
  D.vehicleTypes.forEach(t => { M.vehicleClasses[t.code] = t; });
  M.vehicleCategories = D.vehicleCategories || [];
  M.places = {};
  D.geofences.forEach(g => { M.places[g.code] = g; });
  M.routes = {};
  D.routes.forEach(r => { (M.routes[r.base] = M.routes[r.base] || []).push(r); });
  M.allRoutes = D.routes;
  M.fuelPrice = Object.assign({ diesel: 0, gasoline: 0 }, D.settings.fuelPrices || {});
  const dates = [D.settings.goLive, ...D.trips.slice(0, 1).map(t => t.date), ...D.fuel.slice(0, 1).map(f => f.date)].filter(Boolean).sort();
  M.START = dates.length ? dates[0] : snap.company.createdAt || M.TODAY;
  if (M.START > M.TODAY) M.START = M.TODAY;
  M.company = snap.company;
  if (M.calc) M.calc.clear();
};
