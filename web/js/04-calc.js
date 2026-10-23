/* Shared calculation functions. Every screen and report reads numbers from here, so the
   same figure is identical everywhere. All functions take a companyId (via db). */
'use strict';
(function () {
  const C = M.calc = {};
  const cache = new Map();
  const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
  C.clear = () => cache.clear();

  C.db = cid => M.db[cid];
  C.vc = v => M.vehicleClasses[v.type] || {};

  /* ---- depreciation (straight line, starts from purchase date) ---- */
  C.dep = (v, asOf = M.TODAY) => {
    const annual = (v.purchasePrice - v.salvageValue) / v.lifeYears;
    const yearsUsed = Math.max(0, M.diffDays(asOf, v.purchaseDate) / 365);
    const accumulated = Math.min(v.purchasePrice - v.salvageValue, annual * yearsUsed);
    const book = v.purchasePrice - accumulated;
    const kmUsed = v.odometer;
    const pctYears = yearsUsed / v.lifeYears, pctKm = kmUsed / v.lifeKm;
    return { annual, monthly: annual / 12, accumulated, book, yearsUsed, pctYears, pctKm, pctLife: Math.max(pctYears, pctKm), remainingYears: Math.max(0, v.lifeYears - yearsUsed), remainingKm: Math.max(0, v.lifeKm - kmUsed) };
  };

  /* ---- vehicle P&L for a date range [from, to] inclusive ---- */
  C.vehiclePL = (cid, vid, from, to) => memo(`pl|${cid}|${vid}|${from}|${to}`, () => {
    const db = C.db(cid); const v = db.vehicles.find(x => x.id === vid);
    const days = M.diffDays(to, from) + 1;
    const trips = db.trips.filter(t => t.vehicleId === vid && t.status === 'completed' && t.date >= from && t.date <= to);
    const revenue = M.sum(trips, t => t.revenue);
    const km = M.sum(trips, t => t.km);
    const fuel = M.sum(db.fuel.filter(f => f.vehicleId === vid && f.date >= from && f.date <= to), f => f.total);
    const oil = M.sum(db.oil.filter(o => o.vehicleId === vid && o.date >= from && o.date <= to), o => o.cost);
    const wos = db.workOrders.filter(w => w.vehicleId === vid && w.status === 'closed' && (w.downEnd || w.date) >= from && (w.downEnd || w.date) <= to);
    const maintenance = M.sum(wos, w => w.total);
    const tolls = M.sum(trips, t => t.expenses.tolls);
    const tripExp = M.sum(trips, t => t.expenses.tolls + t.expenses.parking + t.expenses.lodging + t.expenses.other);
    const driver = C.driverCostForVehicle(cid, v, trips, from, to);
    const licIns = (v.insuranceAnnual + v.licenseAnnual) / 365 * days;
    const depreciation = C.dep(v).annual / 365 * days;
    const fines = M.sum(db.fines.filter(f => f.vehicleId === vid && f.paidBy === 'company' && f.date >= from && f.date <= to), f => f.amount);
    const costs = fuel + oil + maintenance + driver + tripExp + licIns + depreciation + fines;
    const opDays = new Set(trips.map(t => t.date)).size;
    const maintDays = M.sum(db.workOrders.filter(w => w.vehicleId === vid), w => { const s = w.downStart, e = w.downEnd || M.TODAY; const a = s > from ? s : from, b = e < to ? e : to; return a <= b ? M.diffDays(b, a) + 1 : 0; });
    const avail = Math.max(1, days - maintDays);
    return { v, from, to, days, trips: trips.length, km, revenue, fuel, oil, maintenance, driver, tolls, tripExp, licIns, depreciation, fines, costs, net: revenue - costs, netBeforeDep: revenue - costs + depreciation, margin: revenue ? (revenue - costs) / revenue : null, opDays, maintDays, idleDays: Math.max(0, avail - opDays), util: opDays / avail, costPerKm: km ? costs / km : null, revPerKm: km ? revenue / km : null, kmpl: C.kmpl(cid, vid, from, to) };
  });

  C.driverCostForVehicle = (cid, v, trips, from, to) => {
    const db = C.db(cid); const drv = db.drivers.find(d => d.id === v.driverId);
    const days = M.diffDays(to, from) + 1;
    let cost = 0;
    if (drv && drv.employment !== 'commission') cost += drv.salary * 12 / 365 * days;
    trips.forEach(t => { const d = db.drivers.find(x => x.id === t.driverId); if (d && d.employment !== 'salary') cost += d.commission; });
    // spare drivers' salaries are shared by the vehicles they drove, by trip count
    const spare = db.drivers.filter(d => !d.vehicleId);
    spare.forEach(sd => {
      if (sd.employment === 'commission') return;
      const all = db.trips.filter(t => t.driverId === sd.id && t.status === 'completed' && t.date >= from && t.date <= to);
      if (!all.length) return;
      const mine = all.filter(t => t.vehicleId === v.id).length;
      cost += sd.salary * 12 / 365 * days * mine / all.length;
    });
    return cost;
  };

  C.kmpl = (cid, vid, from, to) => {
    const f = C.db(cid).fuel.filter(x => x.vehicleId === vid && x.date >= from && x.date <= to && x.anomaly !== 'duplicate' && x.kmSince > 0);
    const l = M.sum(f, x => x.liters), k = M.sum(f, x => x.kmSince);
    return l ? k / l : null;
  };

  C.fleetPL = (cid, from, to) => memo(`fpl|${cid}|${from}|${to}`, () => {
    const rows = C.db(cid).vehicles.map(v => C.vehiclePL(cid, v.id, from, to));
    const keys = ['trips', 'km', 'revenue', 'fuel', 'oil', 'maintenance', 'driver', 'tolls', 'tripExp', 'licIns', 'depreciation', 'fines', 'costs', 'net', 'opDays', 'maintDays', 'idleDays'];
    const total = {}; keys.forEach(k => total[k] = M.sum(rows, r => r[k]));
    total.margin = total.revenue ? total.net / total.revenue : null;
    total.util = M.avg(rows, r => r.util);
    total.costPerKm = total.km ? total.costs / total.km : null;
    return { rows, total };
  });

  C.monthRange = ym => { const a = M.maxDate(`${ym}-01`, M.START); const b = ym === M.month(M.TODAY) ? M.addDays(M.TODAY, -1) : `${ym}-${String(M.daysInMonth(ym)).padStart(2, '0')}`; return [a, M.maxDate(a, b)]; };
  /* the last 6 months (fewer if the company went live more recently) */
  C.months = () => M.monthsBetween(M.maxDate(M.month(M.START), M.addMonths(M.month(M.TODAY), -5)), M.month(M.TODAY));
  /* whole history available in the browser: go-live (or history window start) to yesterday */
  C.lifeFrom = () => M.START;
  C.lifeTo = () => M.maxDate(M.START, M.addDays(M.TODAY, -1));

  C.monthlySeries = cid => memo(`ms|${cid}`, () => C.months().map(ym => { const [a, b] = C.monthRange(ym); const p = C.fleetPL(cid, a, b); return Object.assign({ ym }, p.total); }));

  C.typePL = (cid, from, to) => { const p = C.fleetPL(cid, from, to); return Object.keys(M.vehicleClasses).map(t => { const rows = p.rows.filter(r => r.v.type === t); const capital = M.sum(rows, r => r.v.purchasePrice); const book = M.sum(rows, r => C.dep(r.v).book); const out = { type: t, count: rows.length, capital, book }; ['revenue', 'costs', 'net', 'km', 'trips', 'fuel', 'maintenance', 'depreciation'].forEach(k => out[k] = M.sum(rows, r => r[k])); out.margin = out.revenue ? out.net / out.revenue : null; out.util = M.avg(rows, r => r.util); out.costPerKm = out.km ? out.costs / out.km : null; out.revPerKm = out.km ? out.revenue / out.km : null; const yrs = (M.diffDays(to, from) + 1) / 365; out.roc = book ? out.net / yrs / book : null; return out; }); };

  /* ---- capital recovery: profit before depreciation vs purchase price ---- */
  C.capital = (cid, v) => memo(`cap|${cid}|${v.id}`, () => {
    const from = C.lifeFrom(), to = C.lifeTo();
    const p = C.vehiclePL(cid, v.id, from, to);
    const monthsObserved = Math.max(1, M.diffDays(to, from) + 1) / 30.44;
    const monthly = p.netBeforeDep / monthsObserved;
    const monthsBefore = Math.max(0, M.diffDays(from, v.purchaseDate) / 30.44);
    const recovered = Math.max(0, monthly) * monthsBefore + p.netBeforeDep; // history before April is estimated
    const pct = recovered / v.purchasePrice;
    const remaining = Math.max(0, v.purchasePrice - recovered);
    const monthsToGo = monthly > 0 ? remaining / monthly : null;
    return { monthly, recovered, pct, remaining, monthsToGo, paybackDate: monthsToGo == null ? null : M.addDays(M.TODAY, Math.round(monthsToGo * 30.44)), estimated: monthsBefore > 0 };
  });

  /* ---- oil & maintenance status ---- */
  C.oilStatus = (cid, v) => {
    const db = C.db(cid); const last = db.oil.filter(o => o.vehicleId === v.id).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (!last) return null;
    const remaining = last.nextKm - v.odometer;
    const s = C.db(cid).settings;
    return { last, nextKm: last.nextKm, remaining, state: remaining < 0 ? 'overdue' : remaining <= s.oilWarnKm ? 'soon' : 'ok' };
  };

  /* ---- receivables ---- */
  C.invoiceBalance = (cid, inv) => { const cn = M.sum(C.db(cid).creditNotes.filter(c => c.invoiceId === inv.id), c => c.total); return Math.max(0, inv.total - inv.paid - cn); };
  C.aging = (cid) => {
    const out = { b0: 0, b30: 0, b60: 0, b90: 0, total: 0, byClient: {} };
    C.db(cid).invoices.forEach(inv => {
      const bal = C.invoiceBalance(cid, inv); if (bal <= 0) return;
      const age = M.diffDays(M.TODAY, inv.dueDate);
      const k = age <= 30 ? 'b0' : age <= 60 ? 'b30' : age <= 90 ? 'b60' : 'b90';
      out[k] += bal; out.total += bal;
      const c = out.byClient[inv.clientId] = out.byClient[inv.clientId] || { b0: 0, b30: 0, b60: 0, b90: 0, total: 0, overdue: 0 };
      c[k] += bal; c.total += bal; if (age > 0) c.overdue += bal;
    });
    return out;
  };
  C.clientStats = (cid, clientId) => {
    const db = C.db(cid);
    const trips = db.trips.filter(t => t.clientId === clientId && t.status === 'completed');
    const cancelled = db.bookings.filter(b => b.clientId === clientId && b.status === 'cancelled').length;
    const bookings = db.bookings.filter(b => b.clientId === clientId).length;
    const invoices = db.invoices.filter(i => i.clientId === clientId);
    const revenue = M.sum(trips, t => t.revenue);
    const cost = M.sum(trips, t => C.tripCost(cid, t).total);
    const paidInv = invoices.filter(i => i.status === 'paid');
    const ag = C.aging(cid).byClient[clientId] || { total: 0, overdue: 0 };
    return { trips: trips.length, bookings, cancelled, cancelRate: bookings ? cancelled / bookings : 0, revenue, cost, profit: revenue - cost, margin: revenue ? (revenue - cost) / revenue : null, invoiced: M.sum(invoices, i => i.total), balance: ag.total, overdue: ag.overdue, invoices: invoices.length, paidCount: paidInv.length };
  };

  /* ---- per-trip cost estimate (fuel by vehicle cost/km, tolls, driver commission, fixed share) ---- */
  C.tripCost = (cid, t) => memo(`tc|${cid}|${t.id}`, () => {
    const db = C.db(cid); const v = db.vehicles.find(x => x.id === t.vehicleId);
    if (!v) return { fuel: 0, maint: 0, direct: 0, fixed: 0, total: 0 };
    const per = C.vehiclePL(cid, v.id, C.lifeFrom(), C.lifeTo());
    const fuelKm = per.km ? per.fuel / per.km : 0;
    const maintKm = per.km ? (per.maintenance + per.oil) / per.km : 0;
    // the vehicle's fixed cost of one calendar day (salary, license & insurance, depreciation); idle days stay idle cost
    // instead of landing on the few trips of a vehicle that is new on the system
    const fixedDay = (per.driver + per.licIns + per.depreciation) / Math.max(1, per.days);
    const km = t.km || t.plannedKm;
    const fuel = km * fuelKm, maint = km * maintKm, direct = t.expenses.tolls + t.expenses.parking + t.expenses.lodging;
    const sameDay = db.trips.filter(x => x.vehicleId === t.vehicleId && x.date === t.date && x.status === 'completed').length || 1;
    const fixed = fixedDay / sameDay;
    return { fuel, maint, direct, fixed, total: fuel + maint + direct + fixed };
  });

  C.programPL = (cid, p) => {
    const db = C.db(cid); const trips = db.trips.filter(t => t.programId === p.id);
    const cost = M.sum(trips.filter(t => t.status === 'completed'), t => C.tripCost(cid, t).total);
    const planned = M.sum(p.days, d => d.km) * (p.vehicleId ? C.vehiclePL(cid, p.vehicleId, C.lifeFrom(), C.lifeTo()).costPerKm || 0 : 0);
    const revenue = p.status === 'finished' ? p.price : M.sum(trips.filter(t => t.status === 'completed'), t => t.revenue);
    return { trips, revenue, cost, profit: revenue - cost, margin: revenue ? (revenue - cost) / revenue : null, plannedCost: planned, variance: cost - planned * (trips.filter(t => t.status === 'completed').length / Math.max(1, trips.length)) };
  };

  C.routeKey = t => `${t.from}>${t.to}`;
  C.routePL = (cid, from, to) => {
    const db = C.db(cid);
    const g = M.groupBy(db.trips.filter(t => t.status === 'completed' && t.date >= from && t.date <= to), C.routeKey);
    return [...g].map(([k, ts]) => { const rev = M.sum(ts, t => t.revenue), cost = M.sum(ts, t => C.tripCost(cid, t).total); return { key: k, from: ts[0].from, to: ts[0].to, type: ts[0].type, trips: ts.length, km: M.sum(ts, t => t.km), revenue: rev, cost, profit: rev - cost, margin: rev ? (rev - cost) / rev : null, tolls: M.sum(ts, t => t.expenses.tolls) }; }).sort((a, b) => b.profit - a.profit);
  };

  /* ---- drivers ---- */
  C.driverStats = (cid, d, from = C.lifeFrom(), to = M.TODAY) => {
    const db = C.db(cid);
    const trips = db.trips.filter(t => t.driverId === d.id && t.status === 'completed' && t.date >= from && t.date <= to);
    const ev = db.events.filter(e => e.driverId === d.id && e.date >= from && e.date <= to && !String(e.type).startsWith('geofence'));
    const km = M.sum(trips, t => t.km);
    const w = { overspeed: 4, harsh_brake: 3, harsh_accel: 2, idle: 1, after_hours: 3, route_deviation: 2, unauthorized: 8 };
    const penalty = M.sum(ev, e => w[e.type] || 1);
    const per1000 = km ? penalty / km * 1000 : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 - per1000 * 6)));
    const fuel = db.fuel.filter(f => f.driverId === d.id && f.anomaly !== 'duplicate');
    const kmplRel = (() => { const by = M.groupBy(fuel, f => f.vehicleId); let rel = 0, n = 0; by.forEach((fs, vid) => { const v = db.vehicles.find(x => x.id === vid); const l = M.sum(fs, f => f.liters), k = M.sum(fs, f => f.kmSince); if (l && v && M.vehicleClasses[v.type]) { rel += (k / l) / M.vehicleClasses[v.type].kmpl; n++; } }); return n ? rel / n : null; })();
    return { trips: trips.length, km, revenue: M.sum(trips, t => t.revenue), events: ev.length, eventsByType: Object.fromEntries([...M.groupBy(ev, e => e.type)].map(([k, v]) => [k, v.length])), score, kmplRel, fines: db.fines.filter(f => f.driverId === d.id).length, accidents: db.accidents.filter(a => a.driverId === d.id).length, onTime: trips.length ? trips.filter(t => t.onTime).length / trips.length : null };
  };

  /* ---- inventory ---- */
  C.stockOf = (cid, itemId, whId) => { const db = C.db(cid); if (whId) return db.stock[whId + '|' + itemId] || { qty: 0, value: 0 }; let q = 0, v = 0; db.warehouses.forEach(w => { const s = db.stock[w.id + '|' + itemId]; if (s) { q += s.qty; v += s.value; } }); return { qty: q, value: v }; };
  C.itemState = (cid, it) => { const s = C.stockOf(cid, it.id); return s.qty <= 0 ? 'out' : s.qty <= it.reorderPoint ? 'reorder' : s.qty > it.maxStock ? 'over' : 'ok'; };
  C.itemUsage = (cid, itemId, days = 90) => -M.sum(C.db(cid).movements.filter(m => m.itemId === itemId && m.type === 'issue' && m.date >= M.addDays(M.TODAY, -days)), m => m.qty);

  /* ---- fuel anomaly benchmarking ---- */
  C.fuelCheck = (cid, f) => {
    const db = C.db(cid); const v = db.vehicles.find(x => x.id === f.vehicleId);
    const base = C.typeKmpl(cid, v.type);
    const actual = f.kmSince && f.liters ? f.kmSince / f.liters : null;
    const dev = actual && base ? (base - actual) / base : null;
    const thr = db.settings.fuelDeviation;
    let flag = f.anomaly;
    if (!flag && dev != null && dev > thr) flag = 'consumption';
    return { base, actual, dev, flag };
  };
  C.typeKmpl = (cid, type) => memo(`tk|${cid}|${type}`, () => { const db = C.db(cid); const ids = new Set(db.vehicles.filter(v => v.type === type).map(v => v.id)); const fs = db.fuel.filter(f => ids.has(f.vehicleId) && !f.anomaly && f.kmSince > 0); const l = M.sum(fs, f => f.liters); return l ? M.sum(fs, f => f.kmSince) / l : null; });

  /* ---- availability for a date ---- */
  C.vehicleFree = (cid, v, date) => { const db = C.db(cid); if (v.status === 'maintenance' && date <= M.addDays(M.TODAY, 1)) return { ok: false, reason: 'maintenance' }; const t = db.trips.filter(x => x.vehicleId === v.id && x.date === date && x.status !== 'cancelled'); return { ok: true, trips: t }; };
  C.driverFree = (cid, d, date) => { const db = C.db(cid); if (d.licenseExpiry < date) return { ok: false, reason: 'license' }; if (db.availability.some(a => a.driverId === d.id && a.from <= date && a.to >= date)) return { ok: false, reason: 'leave' }; return { ok: true }; };

  /* ---- readiness for tomorrow ---- */
  C.readiness = (cid, v) => {
    const db = C.db(cid); const reasons = [];
    if (v.status === 'maintenance') reasons.push(['في الصيانة', 'In workshop']);
    if (v.licenseExpiry < M.addDays(M.TODAY, 1)) reasons.push(['الرخصة منتهية', 'License expired']);
    if (v.insuranceExpiry < M.addDays(M.TODAY, 1)) reasons.push(['التأمين منتهي', 'Insurance expired']);
    const oil = C.oilStatus(cid, v); if (oil && oil.state === 'overdue') reasons.push(['الزيت متأخر', 'Oil change overdue']);
    const insp = db.inspections.filter(i => i.vehicleId === v.id).sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (insp && insp.result === 'failed') reasons.push(['فشل في الفحص', 'Failed inspection']);
    const tag = db.tollTags.find(t => t.vehicleId === v.id); if (tag && tag.balance < tag.lowThreshold) reasons.push(['رصيد الكارتة منخفض', 'Low toll balance']);
    const dev = db.devices.find(d => d.vehicleId === v.id); if (dev && dev.status === 'offline') reasons.push(['جهاز التتبع غير متصل', 'Tracker offline']);
    return { ready: reasons.filter(r => !/toll|Tracker/.test(r[1])).length === 0, reasons };
  };

  /* ---- alerts (generated from data) ---- */
  C.alerts = cid => memo(`al|${cid}`, () => {
    const db = C.db(cid); const s = db.settings; const out = [];
    const push = (sev, cat, title, detail, link) => out.push({ id: M.uid('al'), companyId: cid, sev, cat, title, detail, link });
    const vName = v => `${v.code} · ${M.L(v.plate)}`;
    db.vehicles.forEach(v => {
      [['licenseExpiry', ['رخصة المركبة', 'Vehicle license']], ['insuranceExpiry', ['تأمين المركبة', 'Vehicle insurance']]].forEach(([k, lbl]) => {
        const d = M.diffDays(v[k], M.TODAY);
        if (d < 0) push('high', 'docs', [lbl[0] + ' منتهية', lbl[1] + ' expired'], [vName(v) + ` — منذ ${-d} يوم`, vName(v) + ` — ${-d} days ago`], 'vehicle.' + v.id);
        else if (d <= s.expiryWarnDays) push('medium', 'docs', [lbl[0] + ' تنتهي قريباً', lbl[1] + ' expiring'], [vName(v) + ` — باقي ${d} يوم`, vName(v) + ` — ${d} days left`], 'vehicle.' + v.id);
      });
      const o = C.oilStatus(cid, v);
      if (o && o.state === 'overdue') push('high', 'oil', ['تغيير زيت متأخر', 'Oil change overdue'], [vName(v) + ` — متأخر ${M.n0(-o.remaining)} كم`, vName(v) + ` — ${M.n0(-o.remaining)} km over`], 'vehicle.' + v.id);
      else if (o && o.state === 'soon') push('medium', 'oil', ['تغيير زيت قريب', 'Oil change due soon'], [vName(v) + ` — باقي ${M.n0(o.remaining)} كم`, vName(v) + ` — ${M.n0(o.remaining)} km left`], 'vehicle.' + v.id);
      const dp = C.dep(v); if (dp.pctLife >= s.lifeWarnPct) push('medium', 'life', ['اقتراب نهاية العمر الافتراضي', 'Near end of useful life'], [vName(v) + ` — ${M.pct(dp.pctLife, 0)} مستهلك`, vName(v) + ` — ${M.pct(dp.pctLife, 0)} used`], 'vehicle.' + v.id);
      const m = C.months(); const last2 = m.slice(-3, -1).map(ym => { const [a, b] = C.monthRange(ym); return C.vehiclePL(cid, v.id, a, b).net; });
      if (last2.length === 2 && last2.every(x => x < 0)) push('high', 'profit', ['مركبة خسرانة شهرين متتاليين', 'Loss two months in a row'], [vName(v) + ` — ${M.money(last2[1])}`, vName(v) + ` — ${M.money(last2[1])}`], 'vehicle.' + v.id);
      const maint6 = M.sum(db.workOrders.filter(w => w.vehicleId === v.id && w.date >= M.addDays(M.TODAY, -183)), w => w.total);
      if (maint6 > dp.book * s.maintCostPct) push('medium', 'maintenance', ['تكلفة صيانة مرتفعة', 'High maintenance cost'], [vName(v) + ` — ${M.money(maint6)} في 6 شهور`, vName(v) + ` — ${M.money(maint6)} in 6 months`], 'vehicle.' + v.id);
      const tag = db.tollTags.find(t => t.vehicleId === v.id); if (tag && tag.balance < tag.lowThreshold) push('medium', 'providers', ['رصيد كارتة منخفض', 'Low toll balance'], [vName(v) + ` — ${M.money(tag.balance)}`, vName(v) + ` — ${M.money(tag.balance)}`], 'providers');
    });
    db.drivers.forEach(d => { const dd = M.diffDays(d.licenseExpiry, M.TODAY); if (dd < 0) push('high', 'docs', ['رخصة سائق منتهية', 'Driver license expired'], [M.L(d.name), M.L(d.name)], 'driver.' + d.id); else if (dd <= s.expiryWarnDays) push('medium', 'docs', ['رخصة سائق تنتهي قريباً', 'Driver license expiring'], [M.L(d.name) + ` — باقي ${dd} يوم`, M.L(d.name) + ` — ${dd} days left`], 'driver.' + d.id); });
    db.fuel.filter(f => f.date >= M.addDays(M.TODAY, -45)).forEach(f => { const c = C.fuelCheck(cid, f); if (c.flag) { const v = db.vehicles.find(x => x.id === f.vehicleId); push('high', 'fuel', [c.flag === 'duplicate' ? 'تفويلة مكررة' : 'استهلاك وقود غير طبيعي', c.flag === 'duplicate' ? 'Duplicate fuel entry' : 'Abnormal fuel consumption'], [`${vName(v)} — ${M.date(f.date)}${c.dev != null && c.flag !== 'duplicate' ? ` — انحراف ${M.pct(c.dev, 0)}` : ''}`, `${vName(v)} — ${M.date(f.date)}${c.dev != null && c.flag !== 'duplicate' ? ` — ${M.pct(c.dev, 0)} deviation` : ''}`], 'fuel'); } });
    db.items.forEach(it => { const st = C.itemState(cid, it); if (st === 'out' || st === 'reorder') push(st === 'out' ? 'high' : 'medium', 'stock', [st === 'out' ? 'صنف نفد من المخزن' : 'صنف وصل لحد الطلب', st === 'out' ? 'Item out of stock' : 'Item at reorder point'], [`${M.L(it.name)} — ${M.n0(C.stockOf(cid, it.id).qty)} ${it.unit}`, `${M.L(it.name)} — ${M.n0(C.stockOf(cid, it.id).qty)} ${it.unit}`], 'items'); });
    db.workOrders.filter(w => w.status === 'waiting_parts').forEach(w => push('high', 'stock', ['أمر شغل في انتظار قطع', 'Work order waiting for parts'], [w.number, w.number], 'workorders'));
    db.tires.filter(t => t.kind === 'tire' && t.status === 'mounted' && t.tread != null && t.tread < 3.5).forEach(t => { const v = db.vehicles.find(x => x.id === t.vehicleId); push('medium', 'tires', ['عمق مداس الكاوتش منخفض', 'Low tire tread'], [`${v.code} · ${t.position} — ${t.tread} مم`, `${v.code} · ${t.position} — ${t.tread} mm`], 'tires'); });
    const ag = C.aging(cid);
    Object.entries(ag.byClient).forEach(([clid, a]) => { if (a.overdue > 0) { const c = db.clients.find(x => x.id === clid); push(a.overdue > 100000 ? 'high' : 'medium', 'finance', ['فواتير متأخرة السداد', 'Overdue invoices'], [`${M.L(c.name)} — ${M.money(a.overdue)}`, `${M.L(c.name)} — ${M.money(a.overdue)}`], 'client.' + clid); } if (db.clients.find(x => x.id === clid).creditLimit && a.total > db.clients.find(x => x.id === clid).creditLimit) { const c = db.clients.find(x => x.id === clid); push('high', 'finance', ['عميل تجاوز حد الائتمان', 'Client over credit limit'], [M.L(c.name), M.L(c.name)], 'client.' + clid); } });
    db.syncLog.filter(x => x.status === 'failed' && x.at >= M.addDays(M.TODAY, -3)).forEach(x => push('medium', 'integration', ['فشل مزامنة ERP', 'ERP sync failed'], [M.L(x.error), M.L(x.error)], 'erp'));
    db.providerTx.filter(x => x.status === 'unmatched').forEach(x => push(x.flag ? 'high' : 'medium', 'providers', [x.kind === 'toll' ? 'معاملة كارتة بدون رحلة' : 'معاملة وقود غير مطابقة', x.kind === 'toll' ? 'Toll charge with no trip' : 'Unmatched fuel transaction'], [`${M.date(x.date)} — ${M.money(x.amount)}`, `${M.date(x.date)} — ${M.money(x.amount)}`], 'reconcile'));
    db.events.filter(e => e.type === 'unauthorized' && e.date >= M.addDays(M.TODAY, -7)).forEach(e => { const v = db.vehicles.find(x => x.id === e.vehicleId); push('high', 'tracking', ['تحرك مركبة بدون رحلة', 'Vehicle moved without a trip'], [`${v.code} — ${M.date(e.date)} ${e.time}`, `${v.code} — ${M.date(e.date)} ${e.time}`], 'behavior'); });
    db.devices.filter(d => d.status === 'offline').forEach(d => { const v = db.vehicles.find(x => x.id === d.vehicleId); push('medium', 'tracking', ['جهاز تتبع غير متصل', 'Tracker offline'], [`${v.code} — ${d.lastSignal}`, `${v.code} — ${d.lastSignal}`], 'devices'); });
    db.serviceRequests.filter(x => x.status === 'quote_pending').forEach(x => push('medium', 'maintenance', ['عرض سعر صيانة في انتظار الموافقة', 'Service quote awaiting approval'], [`${x.number} — ${M.money(x.quote)}`, `${x.number} — ${M.money(x.quote)}`], 'providers'));
    db.bookings.filter(b => b.unassigned && b.date <= M.addDays(M.TODAY, 1)).forEach(b => push('medium', 'dispatch', ['حجز بدون مركبة', 'Booking without a vehicle'], [`${b.number} — ${M.date(b.date)} ${b.time}`, `${b.number} — ${M.date(b.date)} ${b.time}`], 'dispatch'));
    const order = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  });

  /* ---- smart pricing (deterministic) ---- */
  C.quote = (cid, { type, km, hours, tolls, emptyKm, margin, days }) => {
    const db = C.db(cid); const vs = db.vehicles.filter(v => v.type === type);
    const per = vs.map(v => C.vehiclePL(cid, v.id, C.lifeFrom(), C.lifeTo()));
    const tk = M.sum(per, p => p.km) || 1;
    const fuelKm = M.sum(per, p => p.fuel) / tk, maintKm = M.sum(per, p => p.maintenance + p.oil) / tk;
    // pricing recovers the fixed cost over the working days (at least 60% of the days, so a short history does not inflate it)
    const fixedDay = M.sum(per, p => p.driver + p.licIns + p.depreciation) / Math.max(1, M.sum(per, p => Math.max(p.opDays, Math.round(p.days * 0.6))));
    const totalKm = km + emptyKm;
    const fuel = totalKm * fuelKm, maint = totalKm * maintKm, fixed = fixedDay * Math.max(1, days || Math.ceil(hours / 10));
    const breakEven = fuel + maint + fixed + tolls;
    const price = Math.ceil(breakEven / (1 - margin) / 50) * 50;
    return { fuel, maint, fixed, tolls, breakEven, price, margin: (price - breakEven) / price, fuelKm, maintKm, fixedDay };
  };
})();
