'use strict';
/* Sample data for a review/test company, through the same actions the screens use — in the
   words of its activities: a tourism company gets agencies, hotels, airport transfers and a tour
   program; a school transport company schools and daily lines; a staff transport company client
   factories and shift lines; an intercity company a ticketing client and scheduled departures; a
   cargo company shippers and shipments closed with their delivery codes.
   `c` is any client with do(action, input) -> { status, data } and get('/api/snapshot') -> { data }:
   the HTTP test client, or the in-process client of server/tools/demo-data.js. */
const day = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(Date.now() + n * 86400000));

const DRIVERS = [['أحمد حسن', 'Ahmed Hassan'], ['محمود سعيد', 'Mahmoud Saeed'], ['خالد يوسف', 'Khaled Youssef'], ['علي إبراهيم', 'Ali Ibrahim'], ['سامح عادل', 'Sameh Adel'], ['ياسر فوزي', 'Yasser Fawzy']];
const FLEET = {
  tourism: [['LB', 'Mercedes', 'Tourismo', 6500000], ['MB', 'Toyota', 'Coaster', 2400000], ['MC', 'Hyundai', 'H1', 1100000], ['SD', 'Toyota', 'Corolla', 900000]],
  education: [['LB', 'MCV', 'C120', 4200000], ['MB', 'Toyota', 'Coaster', 2400000], ['MB', 'King Long', 'XMQ6800', 2300000], ['MC', 'Hyundai', 'H1', 1100000]],
  staff: [['LB', 'MCV', 'C120', 4200000], ['MB', 'Toyota', 'Coaster', 2400000], ['MC', 'Toyota', 'Hiace', 1300000], ['MC', 'Hyundai', 'H1', 1100000]],
  intercity: [['LB', 'Mercedes', 'Tourismo', 6500000], ['LB', 'MCV', 'C120', 4200000], ['MB', 'Toyota', 'Coaster', 2400000]],
  cargo: [['TH', 'Mercedes', 'Actros', 4500000], ['TM', 'Mitsubishi', 'Canter', 2800000], ['TL', 'Isuzu', 'D-Max', 1300000], ['VN', 'Toyota', 'Hiace', 1500000]],
};
const CLIENTS = {
  tourism: [['النيل للسياحة', 'Nile Tours', 'agency'], ['فندق الهرم', 'Pyramids Hotel', 'hotel'], ['شركة المستقبل', 'Future Co', 'company']],
  education: [['مدارس النور الدولية', 'Al Noor International Schools', 'school'], ['جامعة المستقبل', 'Future University', 'university']],
  staff: [['مصنع الدلتا للأغذية', 'Delta Foods factory', 'factory'], ['شركة أوراسكو', 'Orasco', 'company']],
  intercity: [['منصة سوا للتذاكر', 'Swa ticketing', 'ticketing'], ['شركة الرحلات المتحدة', 'United Trips Co', 'company']],
  cargo: [['مطاحن مصر الوسطى', 'Middle Egypt Mills', 'shipper'], ['مصنع العاشر للحديد', '10th Steel', 'factory'], ['تجارة الهدى', 'Al Huda Trading', 'trader']],
};
/* places each activity's sample work uses (added when missing; approximate) */
const PLACES = {
  education: [['NOORSCH', 'مدرسة النور الدولية', 'Al Noor school', 29.985, 31.29, 'school', 300], ['FUTUNI', 'جامعة المستقبل', 'Future University', 30.03, 31.48, 'school', 500], ['MAADI', 'محطة المعادي', 'Maadi stop', 29.96, 31.257, 'station', 200], ['NASRC', 'محطة مدينة نصر', 'Nasr City stop', 30.056, 31.33, 'station', 200], ['HELIO', 'محطة مصر الجديدة', 'Heliopolis stop', 30.09, 31.32, 'station', 200]],
  staff: [['DELTAF', 'مصنع الدلتا (العاشر)', 'Delta factory (10th)', 30.29, 31.75, 'office', 500], ['ORASHQ', 'مقر أوراسكو', 'Orasco HQ', 30.07, 31.43, 'office', 300], ['OBPICK', 'نقطة تجمّع العبور', 'Obour pickup', 30.22, 31.47, 'pickup', 200], ['SALAMP', 'نقطة تجمّع السلام', 'Salam pickup', 30.17, 31.42, 'pickup', 200]],
  intercity: [], cargo: [], tourism: [],
};
/* the same sample places around Riyadh for a Saudi company */
const PLACES_SA = {
  education: [['NOORSCH', 'مدارس النور الأهلية', 'Al Noor schools', 24.77, 46.68, 'school', 300], ['FUTUNI', 'جامعة المستقبل', 'Future University', 24.72, 46.62, 'school', 500], ['MAADI', 'محطة الملقا', 'Al Malqa stop', 24.81, 46.6, 'station', 200], ['NASRC', 'محطة النرجس', 'Al Narjis stop', 24.87, 46.68, 'station', 200], ['HELIO', 'محطة العليا', 'Olaya stop', 24.69, 46.68, 'station', 200]],
  staff: [['DELTAF', 'مصنع الدلتا (المدينة الصناعية)', 'Delta factory (industrial city)', 24.54, 46.86, 'office', 500], ['ORASHQ', 'مقر أوراسكو', 'Orasco HQ', 24.71, 46.67, 'office', 300], ['OBPICK', 'نقطة تجمّع السلي', 'Al Sulay pickup', 24.6, 46.82, 'pickup', 200], ['SALAMP', 'نقطة تجمّع الروضة', 'Al Rawdah pickup', 24.74, 46.77, 'pickup', 200]],
  intercity: [], cargo: [], tourism: [],
};

async function seed(c) {
  const ok = async (a, b) => { const r = await c.do(a, b); if (r.status !== 200) throw new Error(a + ' ' + JSON.stringify(r.data)); return r.data; };
  const snapRes = (await c.get('/api/snapshot')).data;
  const snap0 = snapRes.data;
  const acts = (snapRes.activities || ['tourism']);
  const sa = snapRes.company && snapRes.company.country === 'SA';
  const wh = snap0.warehouses[0].id;
  const have = new Set(snap0.geofences.map(g => g.code));
  const out = { veh: [], drv: [], cls: [], inv: null, byActivity: {} };
  let n = 0;
  for (const act of acts) {
    const mine = out.byActivity[act] = { veh: [], drv: [], cls: [] };
    for (const p of (sa ? PLACES_SA : PLACES)[act]) if (!have.has(p[0])) { await ok('place.create', { code: p[0], name: { ar: p[1], en: p[2] }, lat: p[3], lng: p[4], kind: p[5], radiusM: p[6] }); have.add(p[0]); }
    const fleet = FLEET[act];
    for (const [k, [type, make, model, price]] of fleet.entries()) {
      const [ar, en] = DRIVERS[n % DRIVERS.length];
      const d = (await ok('driver.create', { name: { ar, en }, phone: '0100000000' + n, licenseExpiry: '2030-06-01', salary: 4500, employment: 'both', commission: 120 })).id;
      const v = (await ok('vehicle.create', { type, plate: { ar: `س ص ${1000 + n}`, en: `SS ${1000 + n}` }, make, model, purchaseDate: '2024-03-01', purchasePrice: price, odometer: 20000, driverId: d, licenseExpiry: '2030-01-01', insuranceExpiry: '2030-01-01' })).id;
      mine.veh.push({ id: v, type, driver: d }); mine.drv.push(d); out.veh.push(v); out.drv.push(d); n++;
      if (k === 0 && act === acts[0]) out.firstVehicle = v;
    }
    for (const [ar, en, type] of CLIENTS[act]) { const id = (await ok('client.create', { name: { ar, en }, type, creditLimit: 800000, terms: 30, email: 'ap@x.test' })).id; mine.cls.push(id); out.cls.push(id); }
    const A = acts.length > 1 ? { activity: act } : {};
    if (act === 'tourism') {
      const P = sa ? { AP: 'RUHAP', A: 'RUH', B: 'JED' } : { AP: 'CAIAP', A: 'CAI', B: 'ALX' };
      const trips = [];
      for (let k = 0; k < 4; k++) {
        const b = await ok('booking.create', Object.assign({ clientId: mine.cls[k % 3], date: day(-3 + k), time: '09:00', pax: [40, 20, 8, 3][k], pickup: P.AP, destination: P.A, vehicleType: mine.veh[k].type, price: 800 + k * 400, backdated: true }, A));
        trips.push({ id: (await ok('booking.assign', { bookingId: b.id, vehicleId: mine.veh[k].id })).id, client: mine.cls[k % 3] });
      }
      await ok('trip.start', { id: trips[0].id }); await ok('trip.complete', { id: trips[0].id, endKm: 20040, expenses: { tolls: 30 } });
      await ok('trip.start', { id: trips[1].id }); await ok('trip.complete', { id: trips[1].id, endKm: 20045 });
      out.inv = await ok('invoice.fromTrips', { clientId: trips[0].client, tripIds: [trips[0].id] });
      await ok('payment.create', { clientId: trips[0].client, amount: 500, method: 'cash' });
      await ok('booking.create', Object.assign({ clientId: mine.cls[0], date: day(3), time: '10:00', pax: 20, pickup: P.A, destination: P.B, vehicleType: 'MB', price: 3500 }, A));
      await ok('program.create', { name: { ar: 'برنامج القاهرة والإسكندرية', en: 'Cairo & Alexandria' }, clientId: mine.cls[1], start: day(7), pax: 12, price: 24000, vehicleId: mine.veh[2].id, driverId: mine.veh[2].driver, days: [{ from: P.AP, to: P.A }, { from: P.A, to: P.B }, { from: P.B, to: P.A }] });
    }
    if (['education', 'staff', 'intercity'].includes(act)) {
      // daily lines; the last days' runs are done, the coming week's are scheduled
      const L = act === 'education'
        ? [{ name: { ar: 'خط المعادي — مدرسة النور', en: 'Maadi line — Al Noor school' }, client: 0, from: 'MAADI', to: 'NOORSCH', stops: ['NASRC'], goTime: '06:30', returnTime: '14:30', durationMin: 70, headcount: 26, v: 1, price: 350 },
          { name: { ar: 'خط مصر الجديدة — جامعة المستقبل', en: 'Heliopolis line — Future University' }, client: 1, from: 'HELIO', to: 'FUTUNI', stops: [], goTime: '07:15', returnTime: '15:30', durationMin: 60, headcount: 42, v: 0, price: 520 }]
        : act === 'staff'
          ? [{ name: { ar: 'وردية الصبح — مصنع الدلتا', en: 'Morning shift — Delta factory' }, client: 0, from: 'OBPICK', to: 'DELTAF', stops: ['SALAMP'], goTime: '06:00', returnTime: '15:00', durationMin: 75, headcount: 48, v: 0, price: 600 },
            { name: { ar: 'موظفين المقر — أوراسكو', en: 'HQ staff — Orasco' }, client: 1, from: 'SALAMP', to: 'ORASHQ', stops: [], goTime: '08:00', returnTime: '17:00', durationMin: 45, headcount: 22, v: 1, price: 380 }]
          : [{ name: { ar: 'القاهرة ← الإسكندرية 8 الصبح', en: 'Cairo → Alexandria 8am' }, client: 0, from: sa ? 'RUHST' : 'CAIST', to: sa ? 'JEDST' : 'ALXST', stops: [], goTime: '08:00', returnTime: '17:00', durationMin: 210, headcount: 38, v: 0, price: 4200, days: [0, 1, 2, 3, 4, 5, 6] }];
      for (const l of L) {
        const veh = mine.veh[l.v];
        const line = await ok('line.create', Object.assign({ name: l.name, clientId: mine.cls[l.client], from: l.from, to: l.to, stops: l.stops, goTime: l.goTime, returnTime: l.returnTime, durationMin: l.durationMin, days: l.days || [0, 1, 2, 3, 4], startDate: day(-30), vehicleType: veh.type, vehicleId: veh.id, driverId: veh.driver, headcount: l.headcount, pricePerRun: l.price }, act === acts[0] && acts.length === 1 ? {} : { activity: act }));
        await ok('line.generate', { id: line.id, from: day(-3), to: day(7) });
      }
      // finish the past runs
      const snap = (await c.get('/api/snapshot')).data.data;
      for (const t of snap.trips.filter(t => t.lineId && t.date < day(0) && t.status === 'scheduled' && t.activity === act).sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? -1 : 1))) {
        await ok('trip.start', { id: t.id }); await ok('trip.complete', { id: t.id, endKm: (snap.vehicles.find(v => v.id === t.vehicleId) || {}).odometer + 30 || 20030 });
        snap.vehicles.find(v => v.id === t.vehicleId).odometer += 30;
      }
      const extra = act === 'education' ? { tripType: 'school_trip', pickup: 'NOORSCH', destination: sa ? 'RUH' : 'CAI', pax: 30, price: 1200 } : act === 'staff' ? { tripType: 'staff_extra', pickup: 'ORASHQ', destination: sa ? 'RUH' : 'CAI', pax: 15, price: 700 } : { tripType: 'coach_hire', pickup: sa ? 'RUHST' : 'CAIST', destination: sa ? 'JEDST' : 'HRGST', pax: 45, price: 9000 };
      await ok('booking.create', Object.assign({ clientId: mine.cls[0], date: day(4), time: '09:00', vehicleType: mine.veh[0].type }, extra, A));
    }
    if (act === 'cargo') {
      const C = sa ? { a: 'RUHIC', b: 'JEDPT', w: 'RUHWH' } : { a: 'RMD10', b: 'ALXPT', w: 'CAIWH' };
      // [client, goods, kg, pieces, vehicle, day, deliver by] — the food load arrives after its deadline (shows in "On-time delivery")
      const S = [[mine.cls[0], 'دقيق مكيّس', 12000, 240, 0, -3, [1, '18:00']], [mine.cls[1], 'حديد تسليح', 6500, null, 1, -2, [2, null]], [mine.cls[2], 'مواد غذائية', 1200, 80, 2, -1, [-1, '14:00']], [mine.cls[0], 'كراتين مياه', 900, 120, 3, -1, [0, '20:00']]];
      const done = [];
      for (const [cl, goods, kg, pcs, vi, d, [dd, dt]] of S) {
        const v = mine.veh[vi];
        const s = await ok('booking.create', Object.assign({ clientId: cl, date: day(d), time: '07:00', loadKg: kg, goods, pieces: pcs || undefined, cargoFlags: goods === 'مواد غذائية' ? ['refrigerated'] : [], deliverDate: day(dd), deliverTime: dt || undefined, pickup: vi === 3 ? C.w : C.a, destination: vi === 3 ? (sa ? 'RUH' : 'CAI') : C.b, vehicleType: v.type, price: Math.round(kg * 0.35), backdated: true, vehicleId: v.id }, A));
        done.push({ s, v });
      }
      let odo = 20000;
      for (const [k, { s }] of done.entries()) {
        if (k === 3) continue;   // the last one is on the road: the driver closes it with the code
        const trip = (await c.get('/api/snapshot')).data.data.trips.find(t => t.bookingId === s.id);
        odo += 230;
        await ok('trip.start', { id: trip.id }); await ok('trip.complete', { id: trip.id, endKm: 20000 + 230 + k, deliveryCode: s.deliveryCode });
      }
      // the steel truck comes back empty from the port (empty km)
      { const v = done[1].v; const snap = (await c.get('/api/snapshot')).data.data; const odo0 = snap.vehicles.find(x => x.id === v.id).odometer;
        const e = await ok('booking.create', Object.assign({ clientId: mine.cls[1], tripType: 'empty_return', date: day(-2), time: '17:00', pickup: C.b, destination: C.a, vehicleType: v.type, price: 0, backdated: true, vehicleId: v.id }, A));
        await ok('trip.start', { id: e.trip.id }); await ok('trip.complete', { id: e.trip.id, endKm: odo0 + 225 }); }
      const last = (await c.get('/api/snapshot')).data.data.trips.find(t => t.bookingId === done[3].s.id);
      await ok('trip.start', { id: last.id });
      out.openShipment = { number: done[3].s.number, code: done[3].s.deliveryCode, tripId: last.id };
      await ok('booking.create', Object.assign({ clientId: mine.cls[1], date: day(2), time: '06:00', loadKg: 15000, goods: 'لفائف صاج', deliverDate: day(3), deliverTime: '12:00', pickup: C.a, destination: C.b, vehicleType: 'TH', price: 6500 }, A));
      if (!out.inv) { const t0 = (await c.get('/api/snapshot')).data.data.trips.find(t => t.bookingId === done[0].s.id); out.inv = await ok('invoice.fromTrips', { clientId: mine.cls[0], tripIds: [t0.id] }); }
    }
  }
  const item = await ok('item.create', { name: { ar: 'فلتر زيت', en: 'Oil filter' }, category: 'filters', unit: 'pc', cost: 120, minQty: 5 });
  await ok('supplier.create', { name: { ar: 'مورد القطع', en: 'Parts Supplier' } });
  await ok('stock.receipt', { warehouseId: wh, lines: [{ itemId: item.id, qty: 8, unitCost: 120 }] });
  await ok('wo.create', { vehicleId: out.veh[out.veh.length - 1], problem: { ar: 'تغيير زيت وفلتر', en: 'Oil and filter service' }, type: 'preventive', parts: [{ itemId: item.id, qty: 1 }] });
  await ok('fuel.create', { vehicleId: out.veh[0], liters: 90, amount: 1350, date: day(-1), odometer: 20040 }).catch(() => {});
  await ok('expense.create', { category: 'other', amount: 250, vehicleId: out.veh[1] });
  await ok('provider.create', { name: 'Fuel Card Co', kind: 'fuel', mode: 'csv' });
  return out;
}
module.exports = { seed };
