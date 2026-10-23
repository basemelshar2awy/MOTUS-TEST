#!/usr/bin/env node
'use strict';
/* Loads review companies with sample data into this server, so the Sabeel team can try the new
   features (activities and their separation, lines, shipments with a delivery code, vehicle types,
   calendar, country packs, one account per person, driver accounts, operating contracts).
   Run from the server console only, on a TEST server:
     node server/tools/demo-data.js --yes [--domain example.com]
   Creates companies whose codes start with D — one per activity (DTR tourism, DSC schools &
   universities, DST staff, DIC intercity, DCG cargo), DMX with two activities (schools + cargo),
   DKS in Saudi Arabia (tourism + staff) and DNW new without data — fills them through the same
   actions the screens use, links one driver to two companies, gives a truck driver an open
   shipment to close with its delivery code, adds contracts, and prints every sign-in with a
   temporary password (shown once; each must be changed at first sign-in). Refuses to run twice. */
const config = require('../lib/config');
const cfg = config.load();
const db = require('../lib/db');
const core = require('../lib/core');
const platform = require('../lib/platform');
const snapshot = require('../lib/snapshot');
const { fromPg } = require('../lib/errors');
const registry = require('../services/registry');
['fleet', 'ops', 'finance', 'contracts', 'lines', 'inventory', 'tracking', 'providers', 'admin'].forEach(m => require('../services/' + m));
const { seed } = require('./lib/sample-data');

function args() {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (v[i].startsWith('--')) { const k = v[i].slice(2); a[k] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true; } }
  return a;
}
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/* the same actions as the screens, run in this process as the company's admin */
function client(companyId, user) {
  const ctx = () => ({ companyId, user, source: 'system', ip: null });
  return {
    async do(action, input) {
      try { return { status: 200, data: await registry.run(ctx(), action, input || {}) }; } catch (e) { const er = fromPg(e); return { status: er.status || 500, data: { error: { code: er.code, message: er.msg || er.message } } }; }
    },
    async get() { snapshot.invalidate(companyId); return { status: 200, data: snapshot.forRole(await snapshot.get(companyId), 'company_admin', user.id) }; },
  };
}
const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(what + ': ' + JSON.stringify(r.data)); return r.data; };

(async () => {
  const a = args();
  if (!a.yes) throw new Error('usage: demo-data.js --yes [--domain example.com]   (adds the review companies DTR, DSC, DST, DIC, DCG, DMX, DKS, DNW with sample data - test servers only)');
  const domain = String(a.domain && a.domain !== true ? a.domain : 'motus.test').toLowerCase();
  core.setTimezone(cfg.timezone);
  db.init(cfg.db);
  if ((await db.query("SELECT 1 FROM companies WHERE code IN ('DTR','DSC','DST','DIC','DCG','DMX','DKS','DNW')")).rowCount) throw new Error('The review companies (DTR, DSC, DST, DIC, DCG, DMX, DKS, DNW) already exist - nothing changed.');
  const logins = [];
  const make = async (input, label) => {
    const r = await platform.createCompany(null, input);
    logins.push([label, input.admin.email, r.temporaryPassword || '(existing account - its own password)']);
    return { id: r.id, c: client(r.id, { id: r.adminId, name: 'Demo data', role: 'company_admin' }) };
  };
  const admin = (key, ar, en) => ({ email: `demo.${key}@${domain}`, name: { ar, en } });
  console.log('Creating the review companies...');
  const T = await make({ code: 'DTR', name: { ar: 'شركة تجربة للنقل السياحي', en: 'Demo Tourism Transport' }, activities: ['tourism'], admin: admin('tourism', 'منى عادل', 'Mona Adel') }, 'Tourism company admin (Egypt)');
  const E = await make({ code: 'DSC', name: { ar: 'النور للنقل المدرسي', en: 'Al Noor School Transport' }, activities: ['education'], admin: admin('schools', 'هالة سمير', 'Hala Samir') }, 'Schools & universities company admin');
  const S = await make({ code: 'DST', name: { ar: 'الدلتا لنقل الموظفين', en: 'Delta Staff Transport' }, activities: ['staff'], admin: admin('staff', 'طارق حسن', 'Tarek Hassan') }, 'Staff transport company admin');
  const I = await make({ code: 'DIC', name: { ar: 'الطريق للنقل بين المدن', en: 'Al Tareeq Intercity' }, activities: ['intercity'], admin: admin('intercity', 'وليد شريف', 'Walid Sherif') }, 'Intercity company admin');
  const G = await make({ code: 'DCG', name: { ar: 'شركة تجربة لنقل البضائع', en: 'Demo Cargo Transport' }, activities: ['cargo'], admin: admin('cargo', 'كريم فؤاد', 'Karim Fouad') }, 'Cargo company admin (Egypt)');
  const X = await make({ code: 'DMX', name: { ar: 'المتحدة للنقل (مدارس + بضائع)', en: 'United Transport (schools + cargo)' }, activities: ['education', 'cargo'], admin: admin('multi', 'نادية فاروق', 'Nadia Farouk') }, 'Two activities (schools + cargo) admin');
  const K = await make({ code: 'DKS', country: 'SA', taxNo: '300000000000003', name: { ar: 'شركة تجربة الرياض للنقل', en: 'Demo Riyadh Transport' }, activities: ['tourism', 'staff'], admin: admin('saudi', 'فهد العتيبي', 'Fahad Alotaibi') }, 'Saudi company admin (tourism + staff)');
  await make({ code: 'DNW', name: { ar: 'شركة تجربة جديدة', en: 'Demo New Company' }, activities: ['intercity'], admin: admin('new', 'سامي نبيل', 'Sami Nabil') }, 'New company admin (no data)');

  console.log('Filling them with sample data...');
  const out = {};
  for (const [k, x] of Object.entries({ T, E, S, I, G, X, K })) out[k] = await seed(x.c);

  // one Sabeel account: the same driver (same mobile) drives for DTR and is invited by DCG
  const PHONE = '01099990001';
  const tS = (await T.c.get()).data.data, gS = (await G.c.get()).data.data;
  const road = gS.trips.find(t => t.id === out.G.openShipment.tripId);
  const tDrv = tS.drivers[0], tVeh = tS.vehicles.find(v => v.driverId === tDrv.id);
  const gDrv = gS.drivers.find(d => d.id !== road.driverId);
  await must(T.c.do('driver.update', { id: tDrv.id, phone: PHONE }), 'driver phone');
  await must(G.c.do('driver.update', { id: gDrv.id, phone: PHONE }), 'driver phone');
  const tBk = await must(T.c.do('booking.create', { clientId: tS.clients[0].id, date: day(1), time: '08:00', pax: 30, pickup: 'CAIAP', destination: 'CAI', vehicleType: tVeh.type, price: 2200 }), 'driver trip');
  await must(T.c.do('booking.assign', { bookingId: tBk.id, vehicleId: tVeh.id }), 'driver trip');
  const acc = await must(T.c.do('driver.account', { driverId: tDrv.id }), 'driver account');
  logins.push(['Driver (mobile) - works for DTR, invited by DCG', PHONE, acc.temporaryPassword || '(existing account - its own password)']);
  await must(G.c.do('driver.account', { driverId: gDrv.id }), 'driver invitation');
  await must(G.c.do('user.create', { email: `demo.tourism@${domain}`, name: 'Mona Adel', role: 'viewer', title: 'مراجع خارجي' }), 'admin invitation');
  // the truck driver with a shipment on the road closes it with the delivery code
  const truck = await must(G.c.do('driver.account', { driverId: road.driverId }), 'truck driver account');
  logins.push([`Truck driver (mobile) - closes shipment ${out.G.openShipment.number} with code ${out.G.openShipment.code}`, truck.login, truck.temporaryPassword || '(existing account - its own password)']);

  // operating contracts: an exclusive hotel shuttle in DTR (its vehicles are refused for other work in its hours)
  const kVeh = tS.vehicles.filter(v => v.id !== tVeh.id).slice(0, 2);
  const hotel = await must(T.c.do('client.create', { name: { ar: 'منتجع النيل الكبير', en: 'Grand Nile Resort' }, type: 'hotel', terms: 30 }), 'hotel');
  const k1 = await must(T.c.do('contract.create', { clientId: hotel.id, name: { ar: 'شاتل نزلاء المنتجع', en: 'Resort guest shuttle' }, channel: 'external', externalSystem: 'Resort PMS',
    pricing: 'per_trip', rate: 850, cycle: 'month', withDriver: true, exclusive: true, workStart: '06:00', workEnd: '16:00', workDays: [0, 1, 2, 3, 4], startDate: day(-20), vehicles: kVeh.map(v => ({ vehicleId: v.id })) }), 'contract');
  for (let d = -12; d <= -1; d++) {
    const dt = day(d); if ([5, 6].includes(new Date(dt + 'T00:00:00Z').getUTCDay())) continue;
    for (const [i, v] of kVeh.entries()) for (const [st, en] of [['06:30', '08:00'], ['13:30', '15:00']]) {
      await must(T.c.do('contract.trip', { contractId: k1.id, vehicleId: v.id, date: dt, startTime: st, endTime: en, km: 28 + i * 4, pax: 30 - i * 6, externalRef: `PMS-${dt}-${v.code}-${st}` }), 'contract trip');
    }
  }
  let wd = 1; while ([5, 6].includes(new Date(day(wd) + 'T00:00:00Z').getUTCDay())) wd++;
  await must(T.c.do('booking.create', { clientId: tS.clients[1].id, date: day(wd), time: '09:00', pax: 20, pickup: 'CAIAP', destination: 'CAI', vehicleType: kVeh[0].type, price: 1800, notes: 'جرّب تخصيص مركبة العقد هنا الساعة 9 الصبح' }), 'booking to try');
  const ex = await must(T.c.do('booking.create', { clientId: tS.clients[1].id, date: day(wd), time: '18:30', pax: 25, pickup: 'CAI', destination: 'CAIAP', vehicleType: kVeh[0].type, price: 1400 }), 'extra work');
  await must(T.c.do('booking.assign', { bookingId: ex.id, vehicleId: kVeh[0].id }), 'extra work');
  // a monthly truck hire in DCG with a km allowance, ready to bill
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const mid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 11)).toISOString().slice(0, 10);
  const trucks = gS.vehicles.filter(v => v.id !== road.vehicleId).slice(0, 2);
  const k2 = await must(G.c.do('contract.create', { clientId: gS.clients[2].id, name: { ar: 'تأجير شاحنات شهري', en: 'Monthly truck hire' }, channel: 'external', externalSystem: 'Client TMS',
    pricing: 'per_period', rate: 45000, cycle: 'month', withDriver: false, exclusive: false, kmAllowance: 4000, kmBasis: 'cycle', extraKmRate: 6, startDate: lastMonth, vehicles: [{ vehicleId: trucks[0].id }, { vehicleId: trucks[1].id, fromDate: mid }] }), 'contract');
  for (const [dd, km, tr] of [[3, 1600, 0], [12, 1500, 0], [24, 1600, 0], [18, 1900, 1]]) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, dd)).toISOString().slice(0, 10);
    await must(G.c.do('contract.trip', { contractId: k2.id, vehicleId: trucks[tr].id, date: dt, startTime: '07:00', endTime: '19:00', km, externalRef: 'TMS-' + dt + '-' + tr }), 'contract trip');
  }

  console.log('\nReview companies are ready. Sign-ins (temporary passwords, shown once - change at first sign-in):\n');
  for (const [label, login, pw] of logins) console.log(`  ${login.padEnd(30)} ${pw.padEnd(22)} ${label}`);
  console.log('\nThe Sabeel team signs in with its own platform account (Sabeel panel: companies by country, country change, activities).');
})().then(() => db.close()).catch(e => { console.error('ERROR: ' + (e.msg ? e.msg.en : e.message)); db.close().catch(() => {}); process.exit(1); });
