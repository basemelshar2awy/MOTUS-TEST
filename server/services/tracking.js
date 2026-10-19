'use strict';
/* GPS tracking: places/geofences, routes, tracking devices, position ingestion (from any GPS
   provider via the Open API or provider webhook) with automatic events: overspeed,
   unauthorized movement (no trip), after-hours driving, geofence enter/exit. */
const { define, G } = require('./registry');
const V = require('../lib/validate');
const core = require('../lib/core');
const { insert, update, defined } = require('../lib/sql');
const { bad, conflict, notFound } = require('../lib/errors');

const has = (o, f) => Object.prototype.hasOwnProperty.call(o || {}, f);
const P = (o, f, fn, ...a) => (has(o, f) ? fn(o, f, ...a) : undefined);
const KINDS = ['city', 'airport', 'site', 'hotel', 'garage', 'client', 'restricted'];

define('place.create', G.ops, async (ctx, i, c) => {
  const name = V.text2(i, 'name', { req: true, max: 120 });
  const p = await insert(c, 'places', { company_id: ctx.companyId, code: V.str(i, 'code', { req: true, max: 12, re: /^[A-Z0-9-]+$/ }), name_ar: name.ar, name_en: name.en, kind: V.oneOf(i, 'kind', KINDS, { def: 'site' }), lat: V.num(i, 'lat', { req: true, min: -90, max: 90 }), lng: V.num(i, 'lng', { req: true, min: -180, max: 180 }), radius_m: V.int(i, 'radiusM', { min: 20, max: 50000, def: 500 }), created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'geofence', p.code);
  return { id: p.id };
});
define('place.update', G.ops, async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const p = await core.lock(c, 'places', id, 'place');
  const name = P(i, 'name', V.text2, { max: 120 });
  await update(c, 'places', id, defined({ name_ar: name ? name.ar : undefined, name_en: name ? name.en : undefined, kind: P(i, 'kind', V.oneOf, KINDS), lat: P(i, 'lat', V.num, { min: -90, max: 90 }), lng: P(i, 'lng', V.num, { min: -180, max: 180 }), radius_m: P(i, 'radiusM', V.int, { min: 20, max: 50000 }), active: has(i, 'active') ? V.bool(i, 'active') : undefined }));
  await core.audit(c, ctx, 'update', 'geofence', p.code);
});
define('route.create', G.ops, async (ctx, i, c) => {
  const from = V.str(i, 'from', { req: true, max: 12 }), to = V.str(i, 'to', { req: true, max: 12 });
  for (const code of [from, to]) if (!(await c.query('SELECT 1 FROM places WHERE code = $1', [code])).rowCount) throw bad('place', `المكان ${code} غير معرّف`, `Place ${code} is not defined`);
  const r = await insert(c, 'routes', { company_id: ctx.companyId, base_city: V.str(i, 'baseCity', { req: true, max: 12 }), from_code: from, to_code: to, km: V.num(i, 'km', { req: true, gt: 0 }), type: V.oneOf(i, 'type', ['airport', 'city', 'intercity', 'hire'], { req: true }), toll_gates: V.int(i, 'tollGates', { min: 0, def: 0 }), hours: V.num(i, 'hours', { req: true, gt: 0 }) });
  await core.audit(c, ctx, 'create', 'route', `${from}→${to}`);
  return { id: r.id };
});
define('route.delete', G.ops, async (ctx, i, c) => {
  const r = await c.query('DELETE FROM routes WHERE id = $1 RETURNING from_code, to_code', [V.uuid(i, 'id', { req: true })]);
  if (!r.rowCount) throw notFound('route');
  await core.audit(c, ctx, 'delete', 'route', `${r.rows[0].from_code}→${r.rows[0].to_code}`);
});

define('device.create', G.maint.concat(['operations']), async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true }); await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const d = await insert(c, 'devices', { company_id: ctx.companyId, imei: V.str(i, 'imei', { req: true, max: 20, re: /^[0-9A-Za-z-]+$/ }), provider: V.str(i, 'provider', { max: 60, def: '' }), sim: V.str(i, 'sim', { max: 30, def: '' }), vehicle_id: vehicleId, install_date: V.date(i, 'installDate', { def: core.today() }), status: 'offline', created_by: ctx.user.name });
  await core.audit(c, ctx, 'create', 'device', d.imei);
  return { id: d.id };
});
define('device.update', G.maint.concat(['operations']), async (ctx, i, c) => {
  const id = V.uuid(i, 'id', { req: true }); const d = await core.lock(c, 'devices', id, 'device');
  if (has(i, 'vehicleId')) await core.mustExist(c, 'vehicles', V.uuid(i, 'vehicleId', { req: true }), 'vehicle');
  await update(c, 'devices', id, defined({ vehicle_id: P(i, 'vehicleId', V.uuid), provider: P(i, 'provider', V.str, { max: 60, def: '' }), sim: P(i, 'sim', V.str, { max: 30, def: '' }) }));
  await core.audit(c, ctx, 'update', 'device', d.imei);
});
define('device.delete', G.maint, async (ctx, i, c) => {
  const r = await c.query('DELETE FROM devices WHERE id = $1 RETURNING imei', [V.uuid(i, 'id', { req: true })]);
  if (!r.rowCount) throw notFound('device');
  await core.audit(c, ctx, 'delete', 'device', r.rows[0].imei);
});

function dist(a, b) {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const localDateTime = at => { const s = core.fmtTs(at); return { date: s.slice(0, 10), time: s.slice(11, 16) }; };

/* positions: [{vehicleId | imei | plate, at (ISO), lat, lng, speed, ignition, heading}] */
async function ingestPositions(ctx, c, list) {
  if (!Array.isArray(list) || !list.length) throw bad('positions', 'لا توجد مواقع', 'No positions were sent', 'positions');
  if (list.length > 5000) throw bad('positions', 'أقصى عدد 5000 موقع في الطلب', 'At most 5,000 positions per request', 'positions');
  const s = await core.settings(c, ctx);
  const places = (await c.query('SELECT code, name_ar, name_en, kind, lat, lng, radius_m FROM places WHERE active')).rows;
  const devices = (await c.query('SELECT id, imei, vehicle_id FROM devices')).rows;
  const vehicles = (await c.query('SELECT id, code, plate_ar, plate_en, driver_id FROM vehicles')).rows;
  const [wh0, wh1] = String(s.workHours || '05:00-23:00').split('-');
  let stored = 0, events = 0; const rejected = [];
  const sorted = list.map((p, k) => ({ p, k })).sort((a, b) => String(a.p.at).localeCompare(String(b.p.at)));
  const lastByVehicle = {};
  for (const { p, k } of sorted) {
    try {
      let vid = p.vehicleId && V.UUID.test(p.vehicleId) ? p.vehicleId : null;
      if (!vid && p.imei) { const d = devices.find(x => x.imei === String(p.imei)); vid = d ? d.vehicle_id : null; }
      if (!vid && p.plate) { const v = vehicles.find(x => x.plate_ar === p.plate || x.plate_en === p.plate || x.code === p.plate); vid = v ? v.id : null; }
      const v = vehicles.find(x => x.id === vid);
      if (!v) throw new Error('unknown vehicle/device');
      const at = new Date(p.at);
      if (Number.isNaN(at.getTime())) throw new Error('invalid timestamp');
      if (at.getTime() > Date.now() + 10 * 60000) throw new Error('timestamp in the future');
      const lat = V.num(p, 'lat', { req: true, min: -90, max: 90 }), lng = V.num(p, 'lng', { req: true, min: -180, max: 180 });
      const speed = V.num(p, 'speed', { min: 0, max: 300, def: 0 });
      const prev = lastByVehicle[vid] || (await c.query('SELECT lat, lng, speed, at FROM positions WHERE vehicle_id = $1 ORDER BY at DESC LIMIT 1', [vid])).rows[0] || null;
      if (prev && new Date(prev.at) >= at) { lastByVehicle[vid] = prev; continue; }   // duplicates / out of order
      await c.query('INSERT INTO positions (company_id, vehicle_id, at, lat, lng, speed, ignition, heading) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [ctx.companyId, vid, at, lat, lng, speed, p.ignition == null ? null : !!p.ignition, V.num(p, 'heading', { min: 0, max: 360 })]);
      stored++;
      const { date, time } = localDateTime(at);
      const ev = async (type, value, place, severity) => {
        const m10 = Math.max(0, (+time.slice(0, 2)) * 60 + (+time.slice(3, 5)) - 10);
        const since = `${String(Math.floor(m10 / 60)).padStart(2, '0')}:${String(m10 % 60).padStart(2, '0')}`;
        const recent = (await c.query('SELECT 1 FROM events WHERE vehicle_id = $1 AND type = $2 AND date = $3 AND time >= $4 LIMIT 1', [vid, type, date, since])).rowCount;
        if (recent && !type.startsWith('geofence')) return;
        const trip = (await c.query("SELECT id, driver_id FROM trips WHERE vehicle_id = $1 AND date = $2 AND status = 'running' LIMIT 1", [vid, date])).rows[0];
        await c.query('INSERT INTO events (company_id, date, time, vehicle_id, driver_id, trip_id, type, value, place, severity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [ctx.companyId, date, time, vid, trip ? trip.driver_id : v.driver_id, trip ? trip.id : null, type, value, place, severity]);
        events++;
        if (severity === 'high') await core.emit(c, ctx, 'tracking.alert', { vehicle: v.code, type, value, date, time, lat, lng });
      };
      if (speed > s.overspeed) await ev('overspeed', speed, null, speed > s.overspeed * 1.2 ? 'high' : 'medium');
      if (speed > 5) {
        const active = (await c.query("SELECT 1 FROM trips WHERE vehicle_id = $1 AND date = $2 AND status IN ('running','scheduled') LIMIT 1", [vid, date])).rowCount;
        if (!active) await ev('unauthorized', speed, null, 'high');
        else if (time < wh0 || time > wh1) await ev('after_hours', speed, null, 'medium');
      }
      const inside = pt => places.filter(pl => dist(pt, pl) <= pl.radius_m).map(pl => pl.code);
      const nowIn = inside({ lat, lng });
      if (prev) {
        const wasIn = inside({ lat: prev.lat, lng: prev.lng });
        for (const code of nowIn.filter(x => !wasIn.includes(x))) await ev('geofence_enter', null, code, places.find(x => x.code === code).kind === 'restricted' ? 'high' : 'low');
        for (const code of wasIn.filter(x => !nowIn.includes(x))) await ev('geofence_exit', null, code, 'low');
      }
      lastByVehicle[vid] = { lat, lng, speed, at };
      await c.query("UPDATE devices SET last_signal = greatest(coalesce(last_signal, $1), $1), status = 'online' WHERE vehicle_id = $2", [at, vid]);
    } catch (e) {
      rejected.push({ index: k, error: e.msg ? e.msg.en : e.message });
    }
  }
  return { stored, events, rejected };
}
define('positions.ingest', G.ops.concat(['maintenance']), async (ctx, i, c) => { const r = await ingestPositions(ctx, c, i.positions); if (r.events) await core.touch(c, ctx); return r; }, { noTouch: true });

define('event.create', G.ops, async (ctx, i, c) => {
  const vehicleId = V.uuid(i, 'vehicleId', { req: true }); const v = await core.mustExist(c, 'vehicles', vehicleId, 'vehicle');
  const e = await insert(c, 'events', { company_id: ctx.companyId, date: V.date(i, 'date', { def: core.today() }), time: V.time(i, 'time', { def: core.nowLocal() }), vehicle_id: vehicleId, driver_id: V.uuid(i, 'driverId') || v.driver_id, trip_id: V.uuid(i, 'tripId'), type: V.oneOf(i, 'type', ['overspeed', 'harsh_brake', 'harsh_accel', 'idle', 'after_hours', 'route_deviation', 'unauthorized'], { req: true }), value: V.num(i, 'value'), place: V.str(i, 'place', { max: 12 }), severity: V.oneOf(i, 'severity', ['low', 'medium', 'high'], { def: 'medium' }) });
  await core.audit(c, ctx, 'create', 'event', `${v.code} ${e.type}`);
  return { id: e.id };
});

module.exports = { ingestPositions };
