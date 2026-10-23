'use strict';
/* Sample data for a review/test company, through the same actions the screens use.
   `c` is any client with do(action, input) -> { status, data } and get('/api/snapshot') -> { data }:
   the HTTP test client, or the in-process client of server/tools/demo-data.js. */
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function seed(c) {
  const ok = async (a, b) => { const r = await c.do(a, b); if (r.status !== 200) throw new Error(a + ' ' + JSON.stringify(r.data)); return r.data; };
  const snapRes = (await c.get('/api/snapshot')).data;
  const snap0 = snapRes.data;
  const tourism = (snapRes.activities || ['tourism']).includes('tourism');
  // places of the company's country (Egypt by default)
  const sa = snapRes.company && snapRes.company.country === 'SA';
  const P = sa ? { AP: 'RUHAP', A: 'RUH', B: 'JED' } : { AP: 'CAIAP', A: 'CAI', B: 'ALX' };
  const wh = snap0.warehouses[0].id;
  const drv = [];
  for (const [n, e] of [['أحمد حسن', 'Ahmed Hassan'], ['محمود سعيد', 'Mahmoud Saeed'], ['خالد يوسف', 'Khaled Youssef'], ['علي إبراهيم', 'Ali Ibrahim']]) drv.push((await ok('driver.create', { name: { ar: n, en: e }, phone: '0100000000' + drv.length, licenseExpiry: '2030-06-01', salary: 4500, employment: 'both', commission: 120 })).id);
  const veh = [];
  // passenger fleet for passenger activities, trucks for a cargo-only company (its types follow its activities)
  const usable = snap0.vehicleTypes.filter(t => t.usable !== false).map(t => t.code);
  const cargoOnly = !usable.includes('MB');
  const types = cargoOnly
    ? [['TH', 'Mercedes', 'Actros', 4500000], ['TM', 'Mitsubishi', 'Canter', 2800000], ['TL', 'Isuzu', 'D-Max', 1300000], ['VN', 'Toyota', 'Hiace', 1500000]]
    : [['LB', 'Mercedes', 'Tourismo', 6500000], ['MB', 'Toyota', 'Coaster', 2400000], ['MC', 'Hyundai', 'H1', 1100000], ['SD', 'Toyota', 'Corolla', 900000]];
  for (let k = 0; k < types.length; k++) veh.push((await ok('vehicle.create', { type: types[k][0], plate: { ar: `س ص ${1000 + k}`, en: `SS ${1000 + k}` }, make: types[k][1], model: types[k][2], purchaseDate: '2024-03-01', purchasePrice: types[k][3], odometer: 20000, driverId: drv[k], licenseExpiry: '2030-01-01', insuranceExpiry: '2030-01-01' })).id);
  const cls = [];
  for (const [n, e, t] of [['النيل للسياحة', 'Nile Tours', 'agency'], ['فندق الهرم', 'Pyramids Hotel', 'hotel'], ['شركة المستقبل', 'Future Co', 'company']]) cls.push((await ok('client.create', { name: { ar: n, en: e }, type: t, creditLimit: 800000, terms: 30, email: 'ap@x.test' })).id);
  const trips = [];
  for (let k = 0; k < 4; k++) {
    const b = await ok('booking.create', { clientId: cls[k % 3], date: day(-3 + k), time: '09:00', pax: cargoOnly ? [undefined, undefined, undefined, 2][k] : [40, 20, 8, 3][k], loadKg: cargoOnly ? [12000, 5000, 1000, 600][k] : undefined, pickup: P.AP, destination: P.A, vehicleType: types[k][0], price: 800 + k * 400, backdated: true });
    const t = await ok('booking.assign', { bookingId: b.id, vehicleId: veh[k] });
    trips.push({ id: t.id, client: cls[k % 3] });
  }
  await ok('trip.start', { id: trips[0].id }); await ok('trip.complete', { id: trips[0].id, endKm: 20040, expenses: { tolls: 30 } });
  await ok('trip.start', { id: trips[1].id }); await ok('trip.complete', { id: trips[1].id, endKm: 20045 });
  const inv = await ok('invoice.fromTrips', { clientId: trips[0].client, tripIds: [trips[0].id] });
  await ok('payment.create', { clientId: trips[0].client, amount: 500, method: 'cash' });
  await ok('booking.create', cargoOnly ? { clientId: cls[0], date: day(3), time: '10:00', loadKg: 4000, pickup: P.A, destination: P.B, vehicleType: 'TM', price: 3500 } : { clientId: cls[0], date: day(3), time: '10:00', pax: 20, pickup: P.A, destination: P.B, vehicleType: 'MB', price: 3500 });
  if (tourism) await ok('program.create', { name: { ar: 'برنامج القاهرة والإسكندرية', en: 'Cairo & Alexandria' }, clientId: cls[1], start: day(7), pax: 12, price: 24000, vehicleId: veh[2], driverId: drv[2], days: [{ from: P.AP, to: P.A }, { from: P.A, to: P.B }, { from: P.B, to: P.A }] });
  const sup = await ok('supplier.create', { name: { ar: 'مورد القطع', en: 'Parts Supplier' } });
  const item = await ok('item.create', { name: { ar: 'فلتر زيت', en: 'Oil filter' }, category: 'filters', unit: 'pc', cost: 120, minQty: 5 });
  await ok('stock.receipt', { warehouseId: wh, lines: [{ itemId: item.id, qty: 8, unitCost: 120 }] });
  await ok('wo.create', { vehicleId: veh[3], problem: { ar: 'تغيير زيت وفلتر', en: 'Oil and filter service' }, type: 'preventive', parts: [{ itemId: item.id, qty: 1 }] });
  await ok('fuel.create', { vehicleId: veh[0], liters: 90, amount: 1350, date: day(-1), odometer: 20040 }).catch(() => {});
  await ok('expense.create', { category: 'other', amount: 250, vehicleId: veh[1] });
  await ok('provider.create', { name: 'Fuel Card Co', kind: 'fuel', mode: 'csv' });
  return { veh, drv, cls, inv };
}
module.exports = { seed };

