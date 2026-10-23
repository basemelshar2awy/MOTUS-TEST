'use strict';
/* The dashboard's own calculation code (web/js/01-core.js + 04-calc.js) run on the server, so the
   apps show exactly the figures the web dashboard shows for the same data and role. Each company's
   context is rebuilt when its data version changes. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', '..', 'web', 'js');
const SOURCES = ['01-core.js', '04-calc.js'].map(f => new vm.Script(fs.readFileSync(path.join(WEB, f), 'utf8'), { filename: 'web/js/' + f }));
const cache = new Map();   // `${companyId}|${role}|${userId}` -> { version, M }
const MAX = 50;

function contextFor(snap, key, lang) {
  const hit = cache.get(key);
  if (hit && hit.version === snap.version) { hit.M.lang = lang; return hit.M; }
  const sandbox = { console, Intl, Math, Date, JSON, Object, Array, Number, String, Map, Set };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  sandbox.M = {};
  vm.runInContext('var M = this.M;', sandbox);
  for (const s of SOURCES) s.runInContext(sandbox);
  const M = sandbox.M;
  M.lang = lang;
  M.applySnapshot(snap);
  if (cache.size >= MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { version: snap.version, M });
  return M;
}

/* the app's home screen: the dashboard's headline figures, the monthly series, what needs action
   and the next trips — every number from the shared calc code */
function home(snap, { key, lang = 'ar', period = 'mtd' }) {
  const M = contextFor(snap, key, lang);
  const C = M.calc, cid = snap.company.id, D = snap.data;
  const months = C.months();
  const cur = months[months.length - 1], prev = months[months.length - 2] || cur;
  const [from, to] = period === 'last' ? C.monthRange(prev) : C.monthRange(cur);
  const pl = D.vehicles.length ? C.fleetPL(cid, from, to).total : null;
  const prevPl = D.vehicles.length && prev !== cur && period !== 'last' ? C.fleetPL(cid, ...C.monthRange(prev)).total : null;
  const ag = C.aging(cid);
  const series = C.monthlySeries(cid).slice(-6).map(s => ({ month: s.ym, label: M.monthName(s.ym), revenue: Math.round(s.revenue), costs: Math.round(s.costs), net: Math.round(s.net) }));
  const alerts = C.alerts(cid);
  const today = M.TODAY, tomorrow = M.addDays(today, 1);
  const trips = D.trips.filter(t => (t.date === today || t.date === tomorrow) && t.status !== 'cancelled')
    .sort((a, b) => (a.date + a.startTime) < (b.date + b.startTime) ? -1 : 1).slice(0, 20)
    .map(t => ({ id: t.id, number: t.number, date: t.date, startTime: t.startTime, from: t.from, to: t.to, vehicleId: t.vehicleId, driverId: t.driverId, status: t.status, activity: t.activity }));
  const open = D.bookings.filter(b => b.date >= today && !['cancelled', 'done'].includes(b.status));
  const r = n => (n == null ? null : Math.round(n * 100) / 100);
  return {
    company: { id: cid, name: snap.company.name, currency: snap.company.currency, activities: snap.activities },
    today, period: { key: period, from, to, month: period === 'last' ? prev : cur },
    kpis: pl ? {
      revenue: r(pl.revenue), costs: r(pl.costs), net: r(pl.net), margin: r(pl.margin), utilization: r(pl.util), trips: pl.trips, km: r(pl.km),
      revenueChange: prevPl && prevPl.revenue ? r(pl.revenue / prevPl.revenue - 1) : null,
    } : null,
    fleet: { vehicles: D.vehicles.length, inMaintenance: D.vehicles.filter(v => v.status === 'maintenance').length, drivers: D.drivers.length },
    bookings: { upcoming: open.length, unassigned: open.filter(b => b.unassigned).length, today: open.filter(b => b.date === today).length },
    receivables: { total: r(ag.total), overdue30: r(ag.b30 + ag.b60 + ag.b90) },
    series,
    alerts: { high: alerts.filter(a => a.sev === 'high').length, total: alerts.length, top: alerts.slice(0, 8).map(a => ({ sev: a.sev, cat: a.cat, title: { ar: a.title[0], en: a.title[1] }, detail: { ar: a.detail[0], en: a.detail[1] }, link: a.link || null })) },
    trips,
  };
}

/* every alert, for the alerts screen and for push notifications */
function alerts(snap, { key, lang = 'ar' }) {
  const M = contextFor(snap, key, lang);
  return M.calc.alerts(snap.company.id).map(a => ({ sev: a.sev, cat: a.cat, title: { ar: a.title[0], en: a.title[1] }, detail: { ar: a.detail[0], en: a.detail[1] }, link: a.link || null }));
}

module.exports = { home, alerts };
