'use strict';
/* Builds the company data snapshot the browser works with. The shape matches what the views
   and the shared calculation module (shared/calc.js) expect. Everything is read inside one
   READ ONLY transaction with app.company_id set, so Row Level Security guarantees that only
   this company's rows can be returned.
   History window: transactional rows older than MOTUS_HISTORY_DAYS (default 400) are left out
   of the snapshot (they stay in the database, in reports API and exports). */
const db = require('./db');
const core = require('./core');
const activities = require('./activities');
const countries = require('./countries');
const profiles = require('./profiles');

const HISTORY_DAYS = parseInt(process.env.MOTUS_HISTORY_DAYS || '400', 10);
const L = (r, f) => ({ ar: r[f + '_ar'] || r[f + '_en'] || '', en: r[f + '_en'] || r[f + '_ar'] || '' });
const N = v => (v == null ? null : Number(v));
const base = r => ({ id: r.id, companyId: r.company_id, createdAt: r.created_at ? core.fmtTs(r.created_at).slice(0, 10) : null, updatedAt: r.updated_at ? core.fmtTs(r.updated_at).slice(0, 10) : null, createdBy: r.created_by, externalRef: r.external_ref || null, syncStatus: r.sync_status || 'not_synced' });

const cache = new Map();   // companyId -> { version, role-independent data, at }
function invalidate(companyId) { cache.delete(companyId); }

async function load(companyId) {
  return db.read(companyId, async c => {
    const q = async (sql, p) => (await c.query(sql, p)).rows;
    const today = core.today();
    const since = core.addDays(today, -HISTORY_DAYS);
    const co = (await q('SELECT * FROM companies WHERE id = $1', [companyId]))[0];
    const st = (await q('SELECT data, closed_through, data_version FROM company_settings WHERE company_id = $1', [companyId]))[0] || { data: {}, data_version: 0 };
    const settings = Object.assign({}, core.DEFAULT_SETTINGS, st.data, { closedThrough: st.closed_through });
    const D = {};
    const acts = await activities.enabled(c, {});
    const tourism = acts.includes('tourism');

    D.branches = (await q('SELECT * FROM branches ORDER BY code')).map(r => Object.assign(base(r), { code: r.code, city: r.city, name: L(r, 'name') }));
    const vtypes = await q('SELECT t.* FROM vehicle_types t JOIN vehicle_categories k ON k.code = t.category ORDER BY k.sort, t.code');
    // categories the company can use (its activities) + any category one of its types already has
    const cats = await q('SELECT * FROM vehicle_categories WHERE activities && $1::text[] OR code IN (SELECT category FROM vehicle_types) ORDER BY sort', [acts]);
    D.vehicleCategories = cats.map(r => ({ code: r.code, name: L(r, 'name'), kind: r.kind, activities: r.activities, usable: r.activities.some(a => acts.includes(a)) }));
    const usableCat = new Set(D.vehicleCategories.filter(k => k.usable).map(k => k.code));
    D.vehicleTypes = vtypes.map(r => Object.assign(base(r), { code: r.code, name: L(r, 'name'), category: r.category, payloadKg: N(r.payload_kg), volumeM3: N(r.volume_m3), active: r.active, usable: r.active && usableCat.has(r.category), seats: r.seats, fuel: r.fuel, oilKm: r.oil_km, lifeYears: N(r.life_years), lifeKm: r.life_km, salvagePct: N(r.salvage_pct), tank: N(r.tank_l), kmpl: N(r.kmpl), price: [N(r.price_min), N(r.price_max)], rateKm: N(r.rate_km), base: N(r.base_price), tollGate: N(r.toll_gate), oilCost: N(r.oil_cost), oilLiters: N(r.oil_liters), insurance: N(r.insurance), license: N(r.license), tires: r.tire_positions }));
    const places = await q('SELECT * FROM places ORDER BY code');
    D.geofences = places.map(r => Object.assign(base(r), { code: r.code, name: L(r, 'name'), kind: r.kind, lat: r.lat, lng: r.lng, radiusM: r.radius_m, active: r.active }));
    D.routes = (await q('SELECT * FROM routes ORDER BY base_city, from_code, to_code')).map(r => ({ id: r.id, base: r.base_city, from: r.from_code, to: r.to_code, km: N(r.km), type: r.type, gates: r.toll_gates, hours: N(r.hours) }));

    D.vehicles = (await q('SELECT * FROM vehicles ORDER BY code')).map(r => Object.assign(base(r), {
      code: r.code, plate: L(r, 'plate'), type: r.type, make: r.make, model: r.model, year: r.year, chassis: r.chassis, color: [r.color_ar || '', r.color_en || r.color_ar || ''], seats: r.seats, fuel: r.fuel,
      ownership: r.ownership, purchaseDate: r.purchase_date, purchasePrice: N(r.purchase_price), salvageValue: N(r.salvage_value), lifeYears: N(r.life_years), lifeKm: r.life_km,
      odometerStart: r.odometer_start, odometer: r.odometer, status: r.status, licenseExpiry: r.license_expiry, insuranceExpiry: r.insurance_expiry, insuranceAnnual: N(r.insurance_annual), licenseAnnual: N(r.license_annual),
      driverId: r.driver_id, branchId: r.branch_id, tankL: N(r.tank_l), payloadKg: N(r.payload_kg), volumeM3: N(r.volume_m3),
    }));
    D.drivers = (await q('SELECT * FROM drivers ORDER BY code')).map(r => Object.assign(base(r), {
      code: r.code, name: L(r, 'name'), phone: r.phone, nationalId: r.national_id, licenseNo: r.license_no, licenseClass: r.license_class, licenseExpiry: r.license_expiry,
      employment: r.employment, salary: N(r.salary), commission: N(r.commission), branchId: r.branch_id, status: r.status, vehicleId: r.vehicle_id, hiredAt: r.hired_at,
    }));
    D.clients = (await q('SELECT * FROM clients ORDER BY code')).map(r => Object.assign(base(r), { code: r.code, name: L(r, 'name'), type: r.type, taxNo: r.tax_no, crNo: r.cr_no, contact: L(r, 'contact'), phone: r.phone, email: r.email, address: L(r, 'address'), terms: r.terms, creditLimit: N(r.credit_limit), currency: r.currency, status: r.status }));
    D.suppliers = (await q('SELECT * FROM suppliers ORDER BY code')).map(r => Object.assign(base(r), { code: r.code, name: L(r, 'name'), category: r.category, taxNo: r.tax_no, phone: r.phone, terms: r.terms }));

    // tour programs belong to the tourism activity: not loaded at all when it is off
    const progs = tourism ? await q('SELECT * FROM programs WHERE end_date >= $1 OR status IN (\'confirmed\',\'running\',\'tentative\') ORDER BY start_date', [since]) : [];
    const pdays = tourism ? await q('SELECT * FROM program_days ORDER BY program_id, day') : [];
    D.programs = progs.map(r => Object.assign(base(r), {
      number: r.number, name: L(r, 'name'), clientId: r.client_id, start: r.start_date, end: r.end_date, pax: r.pax, price: N(r.price), vehicleId: r.vehicle_id, driverId: r.driver_id,
      guide: L(r, 'guide'), guidePhone: r.guide_phone, status: r.status, bookingId: r.booking_id,
      days: pdays.filter(d => d.program_id === r.id).map(d => ({ day: d.day, date: d.date, from: d.from_code, to: d.to_code, km: N(d.km), time: d.time, vehicleType: d.vehicle_type })),
    }));
    const trips = await q('SELECT * FROM trips WHERE date >= $1 OR status IN (\'scheduled\',\'running\') ORDER BY date, start_time', [since]);
    D.trips = trips.map(r => Object.assign(base(r), {
      number: r.number, bookingId: r.booking_id, programId: r.program_id, clientId: r.client_id, vehicleId: r.vehicle_id, driverId: r.driver_id, date: r.date, type: r.type, activity: r.activity, lineId: r.line_id, lineLeg: r.line_leg, source: r.source, contractId: r.contract_id,
      from: r.from_place, to: r.to_place, startTime: r.start_time, endTime: r.end_time, startsAt: core.fmtTs(r.starts_at), endsAt: core.fmtTs(r.ends_at), durationMin: r.duration_min, startKm: r.start_km, endKm: r.end_km, km: r.km, plannedKm: N(r.planned_km), gpsKm: r.gps_km,
      revenue: N(r.revenue), expenses: { tolls: N(r.exp_tolls), parking: N(r.exp_parking), lodging: N(r.exp_lodging), other: N(r.exp_other) }, plannedTolls: N(r.planned_tolls),
      status: r.status, invoiced: !!r.invoice_id, invoiceId: r.invoice_id, pax: r.pax, flight: r.flight, flightStatus: r.flight_status, onTime: r.on_time, delayMin: r.delay_min,
      cancelReason: r.cancel_reason_ar ? [r.cancel_reason_ar, r.cancel_reason_en || r.cancel_reason_ar] : null,
    }));
    const tripIdsByBooking = {};
    D.trips.forEach(t => { if (t.bookingId) (tripIdsByBooking[t.bookingId] = tripIdsByBooking[t.bookingId] || []).push(t.id); });
    D.bookings = (await q('SELECT * FROM bookings WHERE date >= $1 OR status IN (\'tentative\',\'confirmed\') ORDER BY date, time', [since])).map(r => Object.assign(base(r), {
      number: r.number, activity: r.activity, tripType: r.trip_type, lineId: r.line_id, goods: r.goods, pieces: r.pieces, volumeM3: N(r.volume_m3), cargoFlags: r.cargo_flags || [], hasCode: !!r.otp_hash, codeLocked: (r.otp_attempts || 0) >= 5, deliveredAt: r.delivered_at ? core.fmtTs(r.delivered_at) : null, deliveredBy: r.delivered_by, clientId: r.client_id, programId: r.program_id, pax: r.pax, date: r.date, time: r.time, pickup: r.pickup, destination: r.destination, routeKm: N(r.route_km), routeType: r.route_type,
      vehicleType: r.vehicle_type, loadKg: N(r.load_kg), price: N(r.price), paid: N(r.paid), status: r.status, cancelReason: r.cancel_reason_ar ? [r.cancel_reason_ar, r.cancel_reason_en || r.cancel_reason_ar] : null,
      flight: r.flight, unassigned: r.unassigned && r.status !== 'cancelled', notes: r.notes, tripIds: tripIdsByBooking[r.id] || [],
    }));
    D.passengers = (await q('SELECT p.* FROM trip_passengers p JOIN trips t ON t.id = p.trip_id WHERE t.date >= $1', [core.addDays(today, -30)])).map(r => ({ id: r.id, tripId: r.trip_id, name: r.name, nationality: r.nationality, passportNo: r.passport_no, hotel: r.hotel, pickupTime: r.pickup_time }));

    D.fuel = (await q('SELECT * FROM fuel_records WHERE date >= $1 ORDER BY date, time', [since])).map(r => Object.assign(base(r), { date: r.date, time: r.time, vehicleId: r.vehicle_id, driverId: r.driver_id, liters: N(r.liters), price: N(r.price), total: N(r.total), odometer: r.odometer, kmSince: r.km_since, station: [r.station_ar || '', r.station_en || r.station_ar || ''], fullTank: r.full_tank, source: r.source, anomaly: r.anomaly }));
    // oil: every vehicle's latest change is always included (drives the "next due" calculation)
    D.oil = (await q(`SELECT * FROM oil_changes o WHERE o.date >= $1 OR o.id IN (SELECT DISTINCT ON (vehicle_id) id FROM oil_changes ORDER BY vehicle_id, date DESC, created_at DESC) ORDER BY date`, [since])).map(r => Object.assign(base(r), { date: r.date, vehicleId: r.vehicle_id, odometer: r.odometer, oilType: r.oil_type, liters: N(r.liters), filters: r.filters, cost: N(r.cost), workshop: r.workshop, nextKm: r.next_km, source: r.source }));
    const woParts = await q('SELECT * FROM work_order_parts ORDER BY created_at');
    D.workOrders = (await q("SELECT * FROM work_orders WHERE date >= $1 OR status IN ('open','waiting_parts','in_progress') ORDER BY date", [since])).map(r => Object.assign(base(r), {
      number: r.number, vehicleId: r.vehicle_id, date: r.date, odometer: r.odometer, problem: L(r, 'problem'), type: r.type, provider: r.provider, supplierId: r.supplier_id, mechanics: r.mechanics || [],
      laborHours: N(r.labor_hours), laborRate: N(r.labor_rate), externalCost: N(r.external_cost), status: r.status, downStart: r.down_start, downEnd: r.down_end, downtimeDays: r.downtime_days, nextDate: r.next_date,
      parts: woParts.filter(p => p.work_order_id === r.id).map(p => ({ id: p.id, itemId: p.item_id, qty: N(p.qty), unitCost: N(p.unit_cost), issued: p.issued })),
      partsCost: N(r.parts_cost), laborCost: N(r.labor_cost), total: N(r.total),
    }));
    D.workOrders.forEach(w => { if (w.status !== 'closed') { w.partsCost = w.parts.reduce((s, p) => s + p.qty * p.unitCost, 0); w.laborCost = w.laborHours * w.laborRate; w.total = w.partsCost + w.laborCost + w.externalCost; } });

    const lines = await q('SELECT l.* FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.issue_date >= $1 OR i.status IN (\'issued\',\'partial\') ORDER BY l.line_no', [since]);
    D.invoices = (await q("SELECT * FROM invoices WHERE issue_date >= $1 OR status IN ('issued','partial') ORDER BY issue_date, number", [since])).map(r => Object.assign(base(r), {
      number: r.number, clientId: r.client_id, issueDate: r.issue_date, dueDate: r.due_date, currency: r.currency, rate: N(r.rate), subtotal: N(r.subtotal), discount: N(r.discount), tax: N(r.tax), total: N(r.total), paid: N(r.paid), status: r.status, source: r.source,
      eInvoice: { uuid: r.einv_uuid, status: r.einv_status, provider: r.einv_provider },
      lines: lines.filter(l => l.invoice_id === r.id).map(l => ({ desc: L(l, 'description'), tripId: l.trip_id, programId: l.program_id, bookingId: l.booking_id, contractId: l.contract_id, periodFrom: l.period_from, periodTo: l.period_to, qty: N(l.qty), unit: N(l.unit), discount: N(l.discount), taxRate: N(l.tax_rate), total: N(l.total) })),
    }));
    D.creditNotes = (await q('SELECT * FROM credit_notes ORDER BY date')).map(r => Object.assign(base(r), { number: r.number, invoiceId: r.invoice_id, clientId: r.client_id, date: r.date, reason: L(r, 'reason'), subtotal: N(r.subtotal), tax: N(r.tax), total: N(r.total) }));
    const allocs = await q('SELECT * FROM payment_allocations');
    D.payments = (await q('SELECT * FROM payments WHERE date >= $1 ORDER BY date, number', [since])).map(r => Object.assign(base(r), { number: r.number, clientId: r.client_id, date: r.date, amount: N(r.amount), method: r.method, account: r.account, reference: r.reference, advanceBookingId: r.advance_booking_id, allocations: allocs.filter(a => a.payment_id === r.id).map(a => ({ invoiceId: a.invoice_id, amount: N(a.amount) })) }));
    D.expenses = (await q('SELECT * FROM expenses WHERE date >= $1 ORDER BY date', [since])).map(r => Object.assign(base(r), { date: r.date, category: r.category, amount: N(r.amount), tax: N(r.tax), vehicleId: r.vehicle_id, tripId: r.trip_id, programId: r.program_id, driverId: r.driver_id, supplier: r.supplier, method: r.method, sourceType: r.source_type, sourceId: r.source_id, note: r.note_ar || r.note_en ? L(r, 'note') : null }));
    const jl = await q('SELECT l.* FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.date >= $1 ORDER BY l.line_no', [since]);
    const jlBy = {}; jl.forEach(l => { (jlBy[l.entry_id] = jlBy[l.entry_id] || []).push({ account: l.account, accountKey: l.account_key, costCenter: l.cost_center, debit: N(l.debit), credit: N(l.credit) }); });
    D.journal = (await q('SELECT * FROM journal_entries WHERE date >= $1 ORDER BY date, number', [since])).map(r => Object.assign(base(r), { number: r.number, date: r.date, sourceType: r.source_type, sourceRef: r.source_ref, desc: L(r, 'description'), status: r.status, lines: jlBy[r.id] || [] }));

    D.warehouses = (await q('SELECT * FROM warehouses ORDER BY code')).map(r => Object.assign(base(r), { code: r.code, name: L(r, 'name'), branchId: r.branch_id, type: r.type, keeper: L(r, 'keeper'), status: r.status }));
    D.items = (await q('SELECT * FROM items ORDER BY code')).map(r => Object.assign(base(r), { code: r.code, oem: r.oem, name: L(r, 'name'), category: r.category, unit: r.unit, minStock: N(r.min_stock), reorderPoint: N(r.reorder_point), maxStock: N(r.max_stock), avgCost: N(r.avg_cost), lastPrice: N(r.last_price), serial: r.serial, barcode: r.barcode, compatible: r.compatible }));
    D.stock = {};
    (await q('SELECT * FROM stock_balances')).forEach(r => { D.stock[r.warehouse_id + '|' + r.item_id] = { qty: N(r.qty), value: N(r.value) }; });
    D.movements = (await q('SELECT * FROM stock_movements WHERE date >= $1 ORDER BY date, number', [since])).map(r => Object.assign(base(r), { number: r.number, type: r.type, date: r.date, itemId: r.item_id, warehouseId: r.warehouse_id, qty: N(r.qty), unitCost: N(r.unit_cost), value: N(r.value), ref: { ar: r.ref_ar, en: r.ref_en, woId: r.work_order_id, poId: r.po_id } }));
    const poLines = await q('SELECT * FROM po_lines');
    D.purchaseOrders = (await q("SELECT * FROM purchase_orders WHERE date >= $1 OR status IN ('requested','approved','partial') ORDER BY date, number", [since])).map(r => Object.assign(base(r), { number: r.number, supplierId: r.supplier_id, date: r.date, expected: r.expected, status: r.status, total: N(r.total), match: r.match, source: r.source, supplierInvoiceNo: r.supplier_invoice_no, supplierInvoiceAmount: N(r.supplier_invoice_amount), lines: poLines.filter(l => l.po_id === r.id).map(l => ({ id: l.id, itemId: l.item_id, qty: N(l.qty), price: N(l.price), received: N(l.received) })) }));
    const cLines = await q('SELECT * FROM count_lines');
    D.counts = (await q('SELECT * FROM stock_counts ORDER BY date DESC')).map(r => Object.assign(base(r), { number: r.number, warehouseId: r.warehouse_id, date: r.date, status: r.status, lines: cLines.filter(l => l.count_id === r.id).map(l => ({ itemId: l.item_id, system: N(l.system_qty), counted: N(l.counted), variance: Math.round((N(l.counted) - N(l.system_qty)) * 1000) / 1000 })) }));
    D.tires = (await q("SELECT * FROM tires WHERE status <> 'scrapped' OR updated_at >= now() - interval '180 days' ORDER BY serial")).map(r => Object.assign(base(r), { serial: r.serial, kind: r.kind, itemId: r.item_id, brand: r.brand, size: r.size, vehicleId: r.vehicle_id, position: r.position, installDate: r.install_date, installKm: r.install_km, tread: N(r.tread), cost: N(r.cost), status: r.status, limitKm: r.limit_km }));

    const offlineAfter = Date.now() - 30 * 60000;
    D.devices = (await q('SELECT * FROM devices ORDER BY imei')).map(r => Object.assign(base(r), { imei: r.imei, provider: r.provider, sim: r.sim, vehicleId: r.vehicle_id, installDate: r.install_date, status: r.last_signal && new Date(r.last_signal).getTime() >= offlineAfter ? 'online' : 'offline', lastSignal: r.last_signal ? core.fmtTs(r.last_signal) : null }));
    D.positions = (await q("SELECT DISTINCT ON (vehicle_id) vehicle_id, at, lat, lng, speed, ignition, heading FROM positions WHERE at >= now() - interval '7 days' ORDER BY vehicle_id, at DESC")).map(r => ({ vehicleId: r.vehicle_id, at: core.fmtTs(r.at), ts: new Date(r.at).getTime(), lat: r.lat, lng: r.lng, speed: N(r.speed), ignition: r.ignition, heading: N(r.heading) }));
    D.events = (await q('SELECT * FROM events WHERE date >= $1 ORDER BY date, time', [core.addDays(today, -183)])).map(r => Object.assign(base(r), { date: r.date, time: r.time, vehicleId: r.vehicle_id, driverId: r.driver_id, tripId: r.trip_id, type: r.type, value: N(r.value), place: r.place, severity: r.severity }));

    D.providers = (await q('SELECT id, company_id, code, kind, name_ar, name_en, status, mode, schedule, endpoint_url, last_sync, error_ar, error_en, created_at, updated_at, created_by, (credentials_enc IS NOT NULL) has_credentials FROM providers ORDER BY kind, code')).map(r => Object.assign(base(r), { code: r.code, kind: r.kind, name: L(r, 'name'), status: r.status, mode: r.mode, schedule: r.schedule, endpointUrl: r.endpoint_url, hasCredentials: r.has_credentials, lastSync: r.last_sync ? core.fmtTs(r.last_sync) : null, error: r.error_ar || r.error_en ? L(r, 'error') : null }));
    D.fuelCards = (await q('SELECT * FROM fuel_cards ORDER BY number')).map(r => Object.assign(base(r), { number: r.number, providerId: r.provider_id, vehicleId: r.vehicle_id, driverId: r.driver_id, dailyLiters: N(r.daily_liters), monthlyAmount: N(r.monthly_amount), fuelType: r.fuel_type, hours: r.hours, balance: N(r.balance), status: r.status }));
    D.tollTags = (await q('SELECT * FROM toll_tags ORDER BY tag')).map(r => Object.assign(base(r), { tag: r.tag, providerId: r.provider_id, vehicleId: r.vehicle_id, balance: N(r.balance), lowThreshold: N(r.low_threshold), status: r.status }));
    D.providerTx = (await q("SELECT * FROM provider_tx WHERE date >= $1 OR status = 'unmatched' ORDER BY date, time", [since])).map(r => Object.assign(base(r), { providerId: r.provider_id, kind: r.kind, date: r.date, time: r.time, extId: r.ext_id, cardOrTag: r.card_or_tag, vehicleId: r.vehicle_id, amount: N(r.amount), liters: N(r.liters), location: [r.location_ar || '', r.location_en || r.location_ar || ''], gate: L(r, 'location'), status: r.status, matchedTo: r.matched_type ? { type: r.matched_type, id: r.matched_id } : null, flag: r.flag }));
    D.serviceRequests = (await q('SELECT * FROM service_requests ORDER BY date DESC')).map(r => Object.assign(base(r), { number: r.number, providerId: r.provider_id, vehicleId: r.vehicle_id, date: r.date, time: r.time, services: r.services || [], quote: N(r.quote), compare: r.compare || [], status: r.status, workOrderId: r.work_order_id }));

    D.accidents = (await q('SELECT * FROM accidents ORDER BY date DESC')).map(r => Object.assign(base(r), { number: r.number, date: r.date, place: L(r, 'place'), vehicleId: r.vehicle_id, driverId: r.driver_id, desc: L(r, 'description'), police: r.police, claim: r.claim, repairCost: N(r.repair_cost), insurancePaid: N(r.insurance_paid) }));
    D.fines = (await q('SELECT * FROM fines WHERE date >= $1 ORDER BY date DESC', [since])).map(r => Object.assign(base(r), { date: r.date, vehicleId: r.vehicle_id, driverId: r.driver_id, type: L(r, 'type'), amount: N(r.amount), paidBy: r.paid_by, deducted: r.deducted }));
    D.inspections = (await q('SELECT * FROM inspections WHERE date >= $1 ORDER BY date DESC, created_at DESC', [core.addDays(today, -90)])).map(r => Object.assign(base(r), { date: r.date, tripId: r.trip_id, vehicleId: r.vehicle_id, driverId: r.driver_id, result: r.result, failedItems: r.failed_items, items: r.items, notes: r.notes }));
    D.subcontracts = (await q('SELECT * FROM subcontracts WHERE date >= $1 ORDER BY date DESC', [since])).map(r => Object.assign(base(r), { date: r.date, supplier: L(r, 'supplier'), plate: r.plate, driver: L(r, 'driver'), vehicleType: r.vehicle_type, revenue: N(r.revenue), cost: N(r.cost), clientId: r.client_id, bookingId: r.booking_id, route: { from: r.from_code, to: r.to_code } }));
    // document vault: uploaded documents + the expiry dates kept on vehicles and drivers
    const docs = (await q('SELECT id, company_id, owner, owner_id, kind, number, expiry, file_name, mime, size, created_at, updated_at, created_by FROM documents ORDER BY created_at DESC')).map(r => Object.assign(base(r), { owner: r.owner, ownerId: r.owner_id, kind: r.kind, number: r.number, expiry: r.expiry, fileName: r.file_name, mime: r.mime, size: r.size, uploaded: true }));
    const derived = [];
    D.vehicles.forEach(v => { if (v.licenseExpiry) derived.push({ id: 'vl-' + v.id, owner: 'vehicle', ownerId: v.id, kind: 'license', expiry: v.licenseExpiry }); if (v.insuranceExpiry) derived.push({ id: 'vi-' + v.id, owner: 'vehicle', ownerId: v.id, kind: 'insurance', expiry: v.insuranceExpiry }); });
    D.drivers.forEach(d => derived.push({ id: 'dl-' + d.id, owner: 'driver', ownerId: d.id, kind: 'license', expiry: d.licenseExpiry }));
    D.documents = derived.concat(docs);
    D.handovers = (await q('SELECT * FROM handovers ORDER BY date DESC, created_at DESC LIMIT 60')).map(r => Object.assign(base(r), { date: r.date, shift: r.shift, by: L(r, 'by_name'), notes: L(r, 'notes') }));
    D.availability = (await q('SELECT * FROM availability WHERE to_date >= $1 ORDER BY from_date', [core.addDays(today, -60)])).map(r => Object.assign(base(r), { driverId: r.driver_id, from: r.from_date, to: r.to_date, kind: r.kind, note: r.note }));

    D.coa = (await q('SELECT * FROM coa ORDER BY code')).map(r => ({ id: r.id, key: r.key, name: L(r, 'name'), code: r.code, erpCode: r.erp_code }));
    // people with access to this company (one account each, with the role they have here)
    const members = await q(`SELECT m.id mid, m.user_id, m.role, m.branch_id, m.driver_id, m.status, m.title_ar, m.title_en, m.created_at, u.email, u.phone, u.name_ar, u.name_en, u.last_login_at, u.must_change_password
        FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY m.created_at`);
    D.users = members.filter(r => r.role !== 'driver').map(r => ({ id: r.user_id, companyId, email: r.email || r.phone, name: L(r, 'name'), title: L(r, 'title'), role: r.role, branchId: r.branch_id,
      status: r.status === 'active' && r.must_change_password && !r.last_login_at ? 'invited' : r.status === 'invited' ? 'awaiting' : r.status, lastLogin: r.last_login_at ? core.fmtTs(r.last_login_at).slice(0, 10) : null }));
    // driver accounts (Sabeel driver app): which drivers can sign in, and whether they accepted
    D.driverAccounts = members.filter(r => r.role === 'driver').map(r => ({ driverId: r.driver_id, userId: r.user_id, login: r.phone || r.email, status: r.status, lastLogin: r.last_login_at ? core.fmtTs(r.last_login_at).slice(0, 10) : null }));
    D.apiKeys = (await q('SELECT id, company_id, name_ar, name_en, prefix, scopes, last_used, status, created_at, created_by FROM api_keys ORDER BY created_at DESC')).map(r => Object.assign(base(r), { name: L(r, 'name'), prefix: r.prefix, scopes: r.scopes, lastUsed: r.last_used ? core.fmtTs(r.last_used) : null, status: r.status }));
    D.webhooks = (await q('SELECT id, company_id, url, events, status, created_at, created_by FROM webhooks ORDER BY created_at')).map(r => Object.assign(base(r), { url: r.url, events: r.events, status: r.status, secret: 'whsec_••••' }));
    D.webhookDeliveries = (await q('SELECT id, company_id, webhook_id, event, status, code, attempts, last_error, created_at, delivered_at, next_attempt_at FROM webhook_deliveries ORDER BY created_at DESC LIMIT 200')).map(r => ({ id: r.id, webhookId: r.webhook_id, event: r.event, at: core.fmtTs(r.delivered_at || r.created_at), status: r.status, code: r.code, attempts: r.attempts, error: r.last_error, nextAttempt: r.status === 'retrying' ? core.fmtTs(r.next_attempt_at) : null }));
    D.syncLog = (await q('SELECT * FROM sync_log ORDER BY at DESC LIMIT 200')).map(r => ({ id: r.id, at: core.fmtTs(r.at), entity: r.entity, direction: r.direction, count: r.count, status: r.status, error: r.error_ar || r.error_en ? L(r, 'error') : null }));
    D.audit = (await q('SELECT a.*, u.name_ar u_ar, u.name_en u_en FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 1000')).map(r => ({ id: r.id, at: core.fmtTs(r.at), userId: r.user_id, user: r.u_ar ? { ar: r.u_ar, en: r.u_en || r.u_ar } : { ar: r.actor, en: r.actor }, action: r.action, entity: r.entity, recordRef: r.record_ref, source: r.source, change: r.change }));
    D.aiUsage = (await q('SELECT * FROM ai_usage WHERE date >= $1 ORDER BY date DESC', [core.addDays(today, -90)])).map(r => ({ date: r.date, feature: r.feature, requests: r.requests, tokens: r.tokens }));
    D.aiConversations = (await q('SELECT id, user_id, title, created_at FROM ai_conversations ORDER BY created_at DESC LIMIT 200')).map(r => ({ id: r.id, userId: r.user_id, title: { ar: r.title, en: r.title }, at: core.fmtTs(r.created_at).slice(0, 10) }));

    if (!tourism) {
      // tourism-only fields of shared records (flight, passport, nationality, hotel) are left out
      D.trips.forEach(t => { t.flight = null; t.flightStatus = null; });
      D.bookings.forEach(b => { b.flight = null; });
      D.passengers = D.passengers.map(p => Object.assign({}, p, { nationality: '', passportNo: '', hotel: '' }));
    }

    // unified calendar: what occupies each vehicle and driver from yesterday to two weeks ahead
    const calFrom = core.addDays(today, -1), calTo = core.addDays(today, 15);
    const calQ = (table, col) => q(`SELECT ${col} owner_id, kind, source_type, source_id, note, lower(during) s, upper(during) e FROM ${table}
      WHERE during && tstzrange(local_moment($1::uuid, $2::date, '00:00'), local_moment($1::uuid, $3::date, '00:00'), '[)') ORDER BY lower(during)`, [companyId, calFrom, calTo]);
    const cal = r => ({ kind: r.kind, sourceType: r.source_type, sourceId: r.source_id, note: r.note, from: core.fmtTs(r.s), to: core.fmtTs(r.e) });
    // operating contracts and their vehicles
    D.contracts = (await q('SELECT * FROM contracts ORDER BY start_date DESC, number DESC')).map(r => Object.assign(base(r), {
      number: r.number, clientId: r.client_id, name: L(r, 'name'), channel: r.channel, externalSystem: r.external_system, pricing: r.pricing, rate: N(r.rate), cycle: r.cycle,
      withDriver: r.with_driver, exclusive: r.exclusive, workDays: (r.work_days || []).map(Number), workStart: r.work_start, workEnd: r.work_end, startDate: r.start_date, endDate: r.end_date,
      activity: r.activity, kmAllowance: r.km_allowance, kmBasis: r.km_basis, extraKmRate: N(r.extra_km_rate), billedTo: r.billed_to, status: r.status, terms: L(r, 'terms') }));
    // lines: recurring runs (schools, staff shifts, intercity departures) — counts only
    D.lines = (await q('SELECT * FROM lines ORDER BY number')).map(r => Object.assign(base(r), { number: r.number, activity: r.activity, name: L(r, 'name'), clientId: r.client_id, contractId: r.contract_id, from: r.from_place, to: r.to_place, stops: r.stops || [],
      goTime: r.go_time, returnTime: r.return_time, durationMin: r.duration_min, days: (r.days || []).map(Number), startDate: r.start_date, endDate: r.end_date, vehicleType: r.vehicle_type, vehicleId: r.vehicle_id, driverId: r.driver_id,
      headcount: r.headcount, pricePerRun: N(r.price_per_run), generatedTo: r.generated_to, status: r.status, notes: r.notes }));
    D.contractVehicles = (await q('SELECT * FROM contract_vehicles ORDER BY from_date')).map(r => ({ id: r.id, contractId: r.contract_id, vehicleId: r.vehicle_id, driverId: r.driver_id, from: r.from_date, to: r.to_date }));
    D.calendar = {
      vehicles: (await calQ('vehicle_commitments', 'vehicle_id')).map(r => Object.assign({ vehicleId: r.owner_id }, cal(r))),
      drivers: (await calQ('driver_commitments', 'driver_id')).map(r => Object.assign({ driverId: r.owner_id }, cal(r))),
    };

    D.settings = settings;
    return {
      activities: acts, profiles: profiles.publicProfiles(acts),
      version: Number(st.data_version), loadedAt: Date.now(), today,
      company: { id: co.id, code: co.code, name: L(co, 'name'), taxNo: co.tax_no, country: co.country, timezone: co.timezone, countryPack: countries.publicPack(co.country), countryLocked: (await q('SELECT 1 FROM invoices LIMIT 1')).length > 0, currency: co.currency, fyStart: co.fy_start, status: co.status, createdAt: core.fmtTs(co.created_at).slice(0, 10) },
      data: D,
    };
  });
}

/* role filtering: what each role may see. Secrets are never in the snapshot at all. */
const ADMIN = ['super_admin', 'company_admin'];
/* a driver sees only their own record, their own trips (and those trips' vehicles) and the places */
const DRIVER_KEEP = ['geofences', 'vehicleTypes', 'branches'];
function forDriver(snap, driverId) {
  const src = snap.data, D = {};
  const trips = src.trips.filter(t => t.driverId === driverId);
  const me = src.drivers.find(d => d.id === driverId);
  const vids = new Set(trips.map(t => t.vehicleId).concat(me && me.vehicleId ? [me.vehicleId] : []));
  for (const [k, v] of Object.entries(src)) D[k] = Array.isArray(v) ? (DRIVER_KEEP.includes(k) ? v : []) : v;
  D.trips = trips.map(t => Object.assign({}, t, { revenue: 0, clientId: null }));
  // what the driver needs about the trip's shipment or line (no prices, no client)
  const bids = new Set(trips.map(t => t.bookingId)), lids = new Set(trips.map(t => t.lineId).filter(Boolean));
  D.bookings = src.bookings.filter(b => bids.has(b.id)).map(b => ({ id: b.id, number: b.number, activity: b.activity, tripType: b.tripType, goods: b.goods, loadKg: b.loadKg, pieces: b.pieces, cargoFlags: b.cargoFlags, hasCode: b.hasCode, deliveredAt: b.deliveredAt }));
  D.lines = (src.lines || []).filter(l => lids.has(l.id)).map(l => ({ id: l.id, number: l.number, activity: l.activity, name: l.name, stops: l.stops, headcount: l.headcount, from: l.from, to: l.to }));
  D.drivers = me ? [me] : [];
  D.vehicles = src.vehicles.filter(v => vids.has(v.id)).map(v => ({ id: v.id, code: v.code, plate: v.plate, type: v.type, make: v.make, model: v.model, seats: v.seats, status: v.status, odometer: v.odometer }));
  D.calendar = { vehicles: [], drivers: src.calendar.drivers.filter(x => x.driverId === driverId) };
  D.stock = {}; D.settings = { vatRate: src.settings.vatRate, currency: src.settings.currency };
  return { version: snap.version, today: snap.today, company: snap.company, activities: snap.activities, profiles: snap.profiles, activityCatalog: activities.CATALOG, data: D, driver: true };
}
function forRole(snap, role, userId, driverId) {
  if (role === 'driver') return forDriver(snap, driverId);
  const D = Object.assign({}, snap.data);
  if (!ADMIN.includes(role)) { D.users = D.users.map(u => ({ id: u.id, name: u.name, title: u.title, role: u.role, status: u.status })); D.driverAccounts = D.driverAccounts.map(a => ({ driverId: a.driverId, status: a.status })); D.apiKeys = []; D.webhooks = []; D.webhookDeliveries = []; }
  if (!ADMIN.includes(role) && role !== 'accountant') { D.audit = []; D.syncLog = []; }
  if (!['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(role)) {
    D.drivers = D.drivers.map(d => Object.assign({}, d, { nationalId: d.nationalId ? d.nationalId.slice(0, 2) + '••••••••' + d.nationalId.slice(-2) : '' }));
    D.passengers = D.passengers.map(p => Object.assign({}, p, { passportNo: p.passportNo ? p.passportNo.slice(0, 2) + '•••••' + p.passportNo.slice(-2) : '' }));
  }
  D.aiConversations = D.aiConversations.filter(cv => cv.userId === userId || ADMIN.includes(role));
  return { version: snap.version, today: snap.today, company: snap.company, activities: snap.activities, profiles: snap.profiles, activityCatalog: activities.CATALOG, data: D };
}

/* cached per company; reused only while the data version is unchanged and the day has not rolled */
async function get(companyId) {
  // dates and times in the company's own time zone
  const zone = (await db.platform(c => c.query('SELECT timezone FROM companies WHERE id = $1', [companyId]))).rows[0];
  return core.withTz(zone && zone.timezone, () => getIn(companyId));
}
async function getIn(companyId) {
  const hit = cache.get(companyId);
  if (hit && hit.today === core.today() && hit.version === await version(companyId) && Date.now() - hit.loadedAt < 15 * 60000) return hit;
  const snap = await load(companyId);
  cache.set(companyId, snap);
  return snap;
}
async function version(companyId) {
  const r = await db.read(companyId, c => c.query('SELECT data_version FROM company_settings WHERE company_id = $1', [companyId]));
  return r.rows[0] ? Number(r.rows[0].data_version) : 0;
}

module.exports = { get, forRole, invalidate, version, load };
