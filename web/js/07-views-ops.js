/* Operations & dispatch: bookings, programs, trips, calendar, dispatch board and the
   dispatch-manager toolkit. */
'use strict';
(function () {
  const U = M.ui, C = M.calc, tt = M.tt;
  const tripTypeTxt = k => M.L(M.typeName(k));
  // the trip types of the company's activities (+ operating-contract trips)
  const companyTypes = () => [...new Set(M.acts().flatMap(a => Object.keys(M.prof(a).tripTypes)).concat('contract'))];

  /* ---------- availability check used by booking form, dispatch board and AI ---------- */
  U.candidates = (b, opts = {}) => {
    const cid = U.cid(), db = U.db();
    const route = (M.allRoutes || []).find(r => r.from === b.pickup && r.to === b.destination);
    const pa = M.places[b.pickup], pb = M.places[b.destination];
    const crow = pa && pb ? Math.round(Math.hypot((pa.lat - pb.lat) * 111, (pa.lng - pb.lng) * 101) * 1.25) : 60;
    const km = b.routeKm || (route ? route.km : Math.max(10, crow));
    const hours = route ? route.hours * (km / route.km) : Math.max(1, km / 70);
    const toMin = s => (+s.slice(0, 2)) * 60 + (+s.slice(3, 5));
    const bStart = toMin(b.time || '10:00'), bEnd = Math.min(1439, bStart + Math.round(hours * 60) + 15);
    // local 'YYYY-MM-DD HH:MM' moments, comparable as text with the calendar entries
    const shiftLocal = (ts, min) => new Date(Date.parse(ts.replace(' ', 'T') + ':00Z') + min * 60000).toISOString().slice(0, 16).replace('T', ' ');
    const bStartTs = `${b.date} ${b.time || '10:00'}`, bEndTs = shiftLocal(bStartTs, Math.round(hours * 60) + 15);
    return db.vehicles.filter(v => v.status !== 'sold').map(v => {
      const reasons = [], warns = [];
      // a shipment needs payload; people need seats (the activity decides which)
      const isCargo = (b.activity || M.single()) === 'cargo';
      const ld = M.prof(b.activity || M.single()); const who = ld ? M.L(ld.load.short) : tt('راكب', 'pax');
      if (!isCargo && v.seats > 0 && v.seats < b.pax) reasons.push([`السعة ${v.seats} مقعد أقل من ${b.pax} ${who}`, `Capacity ${v.seats} is below ${b.pax} ${who}`]);
      if (!isCargo && !(v.seats > 0)) reasons.push(['المركبة دي للبضائع ومافيهاش كراسي', 'This vehicle carries cargo and has no seats']);
      if (isCargo && !((v.payloadKg || 0) > 0)) reasons.push(['المركبة دي مش للبضائع', 'This vehicle does not carry cargo']);
      if (isCargo && b.loadKg && (v.payloadKg || 0) < b.loadKg) reasons.push([`الحمولة ${M.n0(v.payloadKg || 0)} كجم أقل من ${M.n0(b.loadKg)} كجم`, `Payload ${M.n0(v.payloadKg || 0)} kg is below ${M.n0(b.loadKg)} kg`]);
      if (v.status === 'maintenance') reasons.push(['المركبة في الصيانة', 'Vehicle is in the workshop']);
      if (v.status === 'stopped') reasons.push(['المركبة متوقفة', 'Vehicle is stopped']);
      // unified calendar (real local times, so a night trip from yesterday counts too); 30-minute gap
      const cal = ((db.calendar || {}).vehicles || []).filter(k => k.vehicleId === v.id);
      const hit = cal.find(k => k.from < shiftLocal(bEndTs, 30) && k.to > shiftLocal(bStartTs, -30));
      if (hit) {
        const tr = hit.sourceType === 'trip' ? db.trips.find(t => t.id === hit.sourceId) : null;
        reasons.push(tr ? [`متعارضة مع الرحلة ${tr.number} (${hit.from.slice(5, 16)} → ${hit.to.slice(5, 16)})`, `Overlaps trip ${tr.number} (${hit.from.slice(5, 16)} → ${hit.to.slice(5, 16)})`] : [`المركبة محجوزة (${hit.from.slice(5, 16)} → ${hit.to.slice(5, 16)})`, `Vehicle is booked (${hit.from.slice(5, 16)} → ${hit.to.slice(5, 16)})`]);
      }
      if (v.licenseExpiry && v.licenseExpiry < b.date) reasons.push(['رخصة المركبة منتهية', 'Vehicle license expired']);
      if (v.insuranceExpiry && v.insuranceExpiry < b.date) reasons.push(['تأمين المركبة منتهي', 'Vehicle insurance expired']);
      const oil = C.oilStatus(cid, v); if (oil && oil.state === 'overdue') warns.push(['تغيير الزيت متأخر', 'Oil change overdue']);
      if (v.type !== b.vehicleType) warns.push([`النوع المطلوب ${U.vtype(b.vehicleType)}`, `Requested type is ${U.vtype(b.vehicleType)}`]);
      const drvList = [db.drivers.find(d => d.id === v.driverId), ...db.drivers.filter(d => !d.vehicleId)].filter(d => d && d.status === 'active').map(d => {
        const f = C.driverFree(cid, d, b.date);
        const dts = db.trips.filter(t => t.driverId === d.id && t.date === b.date && t.status !== 'cancelled');
        const busy = dts.some(t => { const a = toMin(t.startTime); let e = toMin(t.endTime); if (e <= a) e = 24 * 60; return bStart < e + 30 && bEnd + 30 > a; });
        const busyH = M.sum(dts, t => (toMin(t.endTime) - toMin(t.startTime) + 1440) % 1440 / 60);
        const w = []; if (busyH + (bEnd - bStart) / 60 > db.settings.maxDriveHours) w.push([`سيتجاوز ${db.settings.maxDriveHours} ساعات قيادة`, `Would exceed ${db.settings.maxDriveHours} driving hours`]);
        return { d, ok: f.ok && !busy, why: f.reason, w, busyH };
      });
      const drv = drvList.find(x => x.ok && !x.w.length) || drvList.find(x => x.ok);
      if (!drv) reasons.push(['لا يوجد سائق متاح برخصة سارية', 'No available driver with a valid license']);
      const per = C.vehiclePL(cid, v.id, C.lifeFrom(), C.lifeTo());
      const vc = M.vehicleClasses[v.type] || {};
      const costKm = per.km ? (per.fuel + per.maintenance + per.oil) / per.km : (M.fuelPrice[v.fuel] || 0) / (vc.kmpl || 5);
      const branch = U.find('branches', v.branchId);
      const empty = branch && (branch.city === b.pickup || (b.pickup || '').startsWith(branch.city)) ? 8 : 60;
      const estCost = (km + empty) * costKm + (per.driver + per.licIns + per.depreciation) / Math.max(1, per.opDays, Math.round(per.days * 0.6));
      const seatFit = v.seats > 0 ? 1 - Math.min(1, Math.max(0, v.seats - b.pax) / v.seats) : (b.loadKg && v.payloadKg ? 1 - Math.min(1, Math.max(0, v.payloadKg - b.loadKg) / v.payloadKg) : 0.5);
      const score = reasons.length ? 0 : Math.round(100 * (0.35 * seatFit + 0.25 * (1 - Math.min(1, estCost / Math.max(1, b.price || estCost * 2))) + 0.2 * (1 - per.util) + 0.2 * (empty < 20 ? 1 : 0.3)) - warns.length * 6);
      return { v, ok: !reasons.length, reasons, warns: warns.concat(drv ? drv.w : []), driver: drv ? drv.d : null, estCost, empty, score, km };
    }).sort((a, b) => (b.ok - a.ok) || (b.score - a.score));
  };

  /* ================= BOOKINGS =================
     A booking has one activity (lib/profiles): a tourism booking carries passengers and a flight,
     an education/staff/intercity booking a headcount (the daily runs come from Lines), a cargo
     booking is a shipment (goods, weight, delivery code). A company with one activity never sees
     the choice; one with several picks it first. */
  const bkAct = b => b.activity || M.single() || 'tourism';
  const unitsTitle = () => { const a = M.single(); return a ? M.L(M.prof(a).units) : tt('الحجوزات والشحنات', 'Bookings & shipments'); };
  U.route('bookings', () => {
    const db = U.db(); const one = M.single(); const p = one ? M.prof(one) : null;
    const rows = db.bookings.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const upcoming = rows.filter(b => b.date >= M.TODAY && b.status !== 'cancelled');
    const cargoOnly = one === 'cargo', anyCargo = M.acts().includes('cargo');
    const newLabel = one ? tt('جديد', 'New') + ' · ' + M.L(p.unit) : tt('جديد', 'New');
    return U.head(unitsTitle(), p ? M.L(p.intro) : tt('كل حجز أو شحنة ليه نشاطه، والحقول بتتغير على حسبه.', 'Every booking or shipment has its activity, and its fields follow it.'), U.btn(newLabel, 'new-booking', '', 'plus')) +
      U.kpis([U.kpi(tt('قادمة', 'Upcoming'), upcoming.length), U.kpi(tt('بدون مركبة', 'Unassigned'), `<span class="${db.bookings.some(b => b.unassigned) ? 'delta-down' : ''}">${db.bookings.filter(b => b.unassigned).length}</span>`), anyCargo ? U.kpi(tt('شحنات اتسلمت', 'Shipments delivered'), db.bookings.filter(b => b.deliveredAt).length) : U.kpi(tt('مبدئي', 'Tentative'), db.bookings.filter(b => b.status === 'tentative').length), U.kpi(tt('نسبة الإلغاء', 'Cancellation rate'), M.pct(db.bookings.filter(b => b.status === 'cancelled').length / Math.max(1, db.bookings.length)))]) +
      U.card(null, U.table({ id: 'bookings', rows, columns: [
        { label: cargoOnly ? tt('رقم الشحنة', 'Shipment') : tt('الرقم', 'Number'), value: b => b.number, render: b => `<a href="#booking.${b.id}" class="cell-main">${b.number}</a>${b.programId ? `<div class="cell-sub">${tt('برنامج', 'Program')}</div>` : ''}${b.lineId ? `<div class="cell-sub">${tt('خط', 'Line')} ${M.esc(U.find('lines', b.lineId).number || '')}</div>` : ''}${!one ? `<div class="cell-sub">${M.L(M.actName(bkAct(b)))}</div>` : ''}` },
        { label: tt('التاريخ', 'Date'), value: b => b.date + b.time, render: b => `${M.date(b.date)} <span class="num muted">${b.time}</span>` },
        { label: tt('العميل', 'Client'), value: b => M.L(U.find('clients', b.clientId).name), render: b => U.cLabel(U.find('clients', b.clientId)) },
        { label: tt('النوع', 'Type'), value: b => M.L(M.typeName(b.tripType)) },
        { label: tt('المسار', 'Route'), value: b => U.routeTxt(b.pickup, b.destination) },
        cargoOnly ? { label: tt('البضاعة', 'Goods'), value: b => b.goods || '' } : null,
        { label: one ? M.L(p.load.label) : tt('الحمولة', 'Load'), num: 1, value: b => bkAct(b) === 'cargo' ? b.loadKg : b.pax, render: b => M.loadText(b, bkAct(b)) },
        { label: tt('السعر', 'Price'), num: 1, value: b => b.price, render: b => M.money(b.price) },
        { label: tt('الحالة', 'Status'), value: b => b.status, render: b => U.status(b.status) + (b.unassigned && b.status !== 'cancelled' ? ' ' + U.badge(tt('بدون مركبة', 'Unassigned'), 'danger') : '') + (b.deliveredAt ? ' ' + U.badge(tt('اتسلمت', 'Delivered'), 'success') : '') },
      ].filter(Boolean), filters: [{ label: tt('الحالة', 'Status'), get: b => b.status, options: ['tentative', 'confirmed', 'done', 'cancelled'].map(k => [k, U.statusText(k)]) }, { label: tt('التوزيع', 'Assignment'), get: b => b.unassigned ? 'u' : 'a', options: [['u', tt('بدون مركبة', 'Unassigned')], ['a', tt('مخصص', 'Assigned')]] }, !one ? { label: tt('النشاط', 'Activity'), get: b => bkAct(b), options: M.acts().map(a => [a, M.L(M.actName(a))]) } : null].filter(Boolean), onRow: b => 'booking.' + b.id }), { flush: true });
  });

  /* the booking form of one activity */
  const bookingFields = act => {
    const db = U.db(); const p = M.prof(act); const pts = M.placesFor(act); const types = M.typesFor(act);
    const def = (list, ...want) => want.find(w => list.includes(w)) || list[0];
    const flags = M.profiles.cargoFlags || {};
    return [
      M.multi() ? { f: 'activity', label: tt('النشاط', 'Activity'), type: 'select', value: act, options: M.acts().map(a => [a, M.L(M.actName(a))]), full: true } : null,
      { f: 'clientId', label: tt('العميل', 'Client'), type: 'select', options: db.clients.filter(c => c.status === 'active' && (!M.multi() || M.clientTypesFor(act).includes(c.type))).map(c => [c.id, M.L(c.name)]), req: true },
      { f: 'tripType', label: tt('نوع الرحلة', 'Trip type'), type: 'select', value: act === 'tourism' ? '' : p.defaultTripType, options: (act === 'tourism' ? [['', tt('حسب المسار', 'From the route')]] : []).concat(Object.entries(p.tripTypes).map(([k, n]) => [k, M.L(n)])) },
      { f: 'date', label: act === 'cargo' ? tt('تاريخ التحميل', 'Loading date') : tt('التاريخ', 'Date'), type: 'date', value: M.addDays(M.TODAY, 1), req: true, attrs: `min="${M.TODAY}"` },
      { f: 'time', label: act === 'cargo' ? tt('ميعاد التحميل', 'Loading time') : tt('ميعاد الاستلام', 'Pickup time'), type: 'time', value: act === 'cargo' ? '08:00' : '10:00', req: true },
      act === 'cargo' ? { f: 'goods', label: tt('البضاعة', 'Goods'), req: true, attrs: 'placeholder="' + tt('مثلاً: أسمنت شكاير', 'e.g. bagged cement') + '"' } : null,
      act === 'cargo' ? { f: 'loadKg', label: tt('الوزن (كجم)', 'Weight (kg)'), type: 'number', req: true, attrs: 'min="1"' } : { f: 'pax', label: M.L(p.load.label), type: 'number', value: act === 'tourism' ? 12 : '', req: true, attrs: 'min="1" max="1000"' },
      act === 'cargo' ? { f: 'pieces', label: tt('عدد الطرود', 'Pieces'), type: 'number', attrs: 'min="1"' } : null,
      act === 'cargo' ? { f: 'volumeM3', label: tt('الحجم (م³)', 'Volume (m³)'), type: 'number', attrs: 'min="0.1" step="0.1"' } : null,
      { f: 'pickup', label: act === 'cargo' ? tt('مكان التحميل', 'Loading point') : tt('مكان الاستلام', 'Pickup'), type: 'select', options: pts.map(k => [k, U.place(k)]), value: def(pts, act === 'tourism' ? 'CAIAP' : act === 'cargo' ? 'RMD10' : 'CAI'), req: true },
      { f: 'destination', label: act === 'cargo' ? tt('مكان التسليم', 'Delivery point') : tt('الوجهة', 'Destination'), type: 'select', options: pts.map(k => [k, U.place(k)]), value: def(pts, act === 'cargo' ? 'ALXPT' : 'CAI'), req: true },
      { f: 'vehicleType', label: tt('نوع المركبة', 'Vehicle type'), type: 'select', options: types.map(k => [k, U.vtype(k)]), value: def(types, act === 'cargo' ? 'TM' : 'MC'), req: true },
      { f: 'price', label: tt('السعر المتفق عليه', 'Agreed price'), type: 'number', req: true, attrs: 'min="0"', help: `<a href="#pricing" data-act="close-overlay">${tt('احسب السعر بالتسعير الذكي', 'Calculate with smart pricing')}</a>` },
      act === 'tourism' ? { f: 'flight', label: tt('رقم الطيران (اختياري)', 'Flight number (optional)'), attrs: 'placeholder="MS985" dir="ltr"' } : null,
      act === 'cargo' ? { f: 'flags', label: tt('طبيعة البضاعة', 'Handling'), type: 'html', full: true, html: `<div class="check-row">${Object.entries(flags).map(([k, n]) => `<label class="check"><input type="checkbox" data-f="flag_${k}"> ${M.L(n)}</label>`).join('')}</div>` } : null,
      { f: 'status', label: tt('الحالة', 'Status'), type: 'select', options: [['confirmed', U.statusText('confirmed')], ['tentative', U.statusText('tentative')]] },
      { f: 'notes', label: tt('ملاحظات', 'Notes'), type: 'textarea', full: true },
      ['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role) ? { f: 'overrideCredit', label: tt('اعتماد تجاوز حد الائتمان لو لزم', 'Approve exceeding the credit limit if needed'), type: 'checkbox', full: true } : null,
    ];
  };
  U.act('new-booking', el => {
    if (!U.guard()) return;
    const db = U.db();
    if (!db.clients.length) { U.toast(tt('أضف عميل أولاً', 'Add a client first'), 'error'); location.hash = 'clients'; return; }
    const act = (el && el.dataset && el.dataset.a) || U._bkAct || M.single() || M.acts()[0] || 'tourism';
    U._bkAct = act;
    const p = M.prof(act);
    const intro = p.lines ? `<p class="muted small">${tt('الرحلات اليومية المتكررة بتتعمل من "الخطوط". هنا رحلة إضافية لمرة واحدة.', 'Daily recurring runs come from "Lines". This is a one-off trip.')}</p>` : act === 'cargo' ? `<p class="muted small">${tt('بعد الحفظ بيظهر كود التسليم مرة واحدة: ابعته للعميل الشاحن عشان يديه للمستلم. السواق ما يقفلش التسليم غير بالكود.', 'After saving, the delivery code is shown once: send it to the shipper to give to the consignee. The driver closes the delivery only with it.')}</p>` : '';
    U.modal(tt('جديد', 'New') + ' · ' + M.L(p.unit) + (M.multi() ? ` · ${M.L(M.actName(act))}` : ''), `${intro}${U.formHtml(bookingFields(act), 'bk')}<h3 style="font-size:15px;margin:16px 0 8px">${tt('مركبات متاحة مقترحة', 'Suggested available vehicles')}</h3><div id="bk-sugg"></div>`, `<button class="btn secondary" data-act="close-overlay">${tt('إلغاء', 'Cancel')}</button><button class="btn" data-act="save-booking">${tt('حفظ', 'Save')}</button>`);
    const g = f => document.querySelector(`#bk [data-f="${f}"]`);
    if (g('activity')) g('activity').addEventListener('change', () => { U._bkAct = g('activity').value; U.closeOverlays(); U.acts['new-booking']({ dataset: { a: U._bkAct } }); });
    const upd = () => {
      const b = { activity: act, pax: act === 'cargo' ? 1 : +g('pax').value || 1, loadKg: g('loadKg') ? +g('loadKg').value || null : null, date: g('date').value, time: g('time').value || '10:00', pickup: g('pickup').value, destination: g('destination').value, vehicleType: g('vehicleType').value, price: +g('price').value };
      const c = U.candidates(b).slice(0, 5);
      document.getElementById('bk-sugg').innerHTML = `<label class="list-row" style="cursor:pointer"><input type="radio" name="bk-veh" value="" style="accent-color:#08264A"><div class="grow"><div class="t">${tt('بدون تخصيص الآن', 'Don’t assign now')}</div><div class="s">${tt('يظهر في لوحة التوزيع', 'It will show on the dispatch board')}</div></div></label>` + c.map((x, i) => `<label class="list-row" style="cursor:${x.ok ? 'pointer' : 'default'}"><input type="radio" name="bk-veh" value="${x.v.id}" data-d="${x.driver ? x.driver.id : ''}" ${x.ok ? '' : 'disabled'} ${i === 0 && x.ok ? 'checked' : ''} style="accent-color:#08264A"><div class="grow"><div class="t">${M.esc(x.v.code)} · ${U.vtype(x.v.type)} · ${U.capacity(x.v, act)}</div><div class="s">${x.ok ? `${tt('السائق', 'Driver')}: ${M.esc(M.L(x.driver.name))} · ${tt('تكلفة تقديرية', 'Est. cost')} ${M.money(x.estCost)}` : x.reasons.map(r => tt(r[0], r[1])).join(' · ')}${x.warns.length ? ' · ' + x.warns.map(r => tt(r[0], r[1])).join(' · ') : ''}</div></div>${x.ok ? U.badge(tt('متاحة', 'Available'), 'success') : U.badge(tt('غير متاحة', 'Unavailable'), 'danger')}</label>`).join('');
      if (!document.querySelector('input[name="bk-veh"]:checked')) document.querySelector('input[name="bk-veh"]').checked = true;
    };
    ['pax', 'loadKg', 'date', 'time', 'pickup', 'destination', 'vehicleType'].forEach(i => g(i) && g(i).addEventListener('change', upd)); upd();
  });
  U.act('save-booking', () => {
    const d = U.readForm('bk'); const act = U._bkAct || M.single();
    d.activity = act;
    const missing = ['clientId', 'date', 'time', act === 'cargo' ? 'loadKg' : 'pax', act === 'cargo' ? 'goods' : null, 'price'].filter(k => k && (d[k] == null || d[k] === ''));
    if (missing.length) { U.showError({ field: missing[0], msg: { ar: 'هذا الحقل مطلوب', en: 'This field is required' } }); return; }
    d.cargoFlags = Object.keys(d).filter(k => k.startsWith('flag_') && d[k]).map(k => k.slice(5));
    Object.keys(d).forEach(k => { if (k.startsWith('flag_')) delete d[k]; });
    if (!d.tripType) delete d.tripType;
    const sel = document.querySelector('input[name="bk-veh"]:checked');
    if (sel && sel.value) { d.vehicleId = sel.value; if (sel.dataset.d) d.driverId = sel.dataset.d; }
    U.run('booking.create', d, { ok: r => tt('تم الحفظ ', 'Saved ') + r.number + (r.trip ? ' · ' + r.trip.number : ''), after: r => { location.hash = 'booking.' + r.id; U.full(); if (r.deliveryCode) U.deliveryCode(r.number, r.deliveryCode); } });
  });
  /* the delivery code is shown once: the shipper gives it to the consignee */
  U.deliveryCode = (number, code) => U.secret(tt('كود التسليم', 'Delivery code') + ' · ' + number, [[tt('الكود', 'Code'), code]], tt('ابعت الكود للعميل الشاحن (أو لنظامه / Sabeel Naql) عشان يديه للمستلم. السواق بيكتبه عند التسليم، ومش هيظهر هنا تاني.', 'Send the code to the shipper (or its system / Sabeel Naql) to give to the consignee. The driver enters it on delivery; it will not be shown here again.'));
  U.act('ship-newcode', el => U.confirm(tt('كود تسليم جديد', 'New delivery code'), tt('الكود القديم هيبطل، والجديد هيظهر مرة واحدة.', 'The old code stops working; the new one is shown once.'), async () => { const r = await U.run('shipment.newCode', { id: el.dataset.id }, { after: () => { } }); if (r) U.deliveryCode(r.number, r.deliveryCode); }));

  /* create trip(s) for a booking on a vehicle */
  /* assignment is done by the server (booking.assign), which re-checks every hard rule */
  U.assignBooking = (b, vehicleId, driverId) => M.api.do('booking.assign', { bookingId: b.id, vehicleId, driverId });

  U.route('booking', id => {
    const db = U.db(); const b = db.bookings.find(x => x.id === id);
    if (!b) return U.empty('ticket', tt('غير موجود في هذه الشركة', 'Not found in this company'));
    const act = bkAct(b), p = M.prof(act) || M.prof(M.acts()[0]);
    const cl = U.find('clients', b.clientId); const trips = db.trips.filter(t => t.bookingId === b.id);
    const prog = b.programId ? U.find('programs', b.programId) : null;
    const line = b.lineId ? U.find('lines', b.lineId) : null;
    const inv = trips.map(t => t.invoiceId).filter(Boolean); const invs = [...new Set(inv)].map(i => U.find('invoices', i));
    const canOps = ['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(M.state.role), canFin = ['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role);
    const invoiced = db.invoices.some(i => i.status !== 'cancelled' && i.lines.some(l => l.bookingId === b.id || trips.some(t => t.id === l.tripId)));
    const cargo = act === 'cargo';
    const acts = `${U.status(b.status)} ${canOps && b.unassigned && !b.programId && b.status !== 'cancelled' ? U.btn(tt('تحويل لرحلة وتخصيص مركبة', 'Convert to trip & assign'), 'convert-booking', '', 'arrow', `data-id="${b.id}"`) + U.btn(tt('إسناد لمورد', 'Subcontract'), 'sub-new', 'secondary', 'truck', `data-b="${b.id}"`) : ''} ${canOps && cargo && b.hasCode && !b.deliveredAt && b.status !== 'cancelled' ? U.btn(tt('كود تسليم جديد', 'New delivery code'), 'ship-newcode', 'secondary', 'key', `data-id="${b.id}"`) : ''} ${canOps && ['tentative', 'confirmed'].includes(b.status) && !b.programId ? U.btn(tt('تعديل', 'Edit'), 'bk-edit', 'secondary', 'settings', `data-id="${b.id}"`) : ''} ${canFin && !b.programId && b.status !== 'cancelled' && !invoiced && (b.status === 'done' || trips.some(t => t.status === 'completed')) ? U.btn(tt('إصدار فاتورة', 'Invoice'), 'inv-booking', 'secondary', 'file', `data-id="${b.id}"`) : ''} ${canFin && b.status !== 'cancelled' ? U.btn(tt('دفعة مقدمة', 'Advance payment'), 'pay-advance', 'ghost', 'wallet', `data-id="${b.id}"`) : ''} ${canOps && !['cancelled', 'done'].includes(b.status) ? U.btn(tt('إلغاء', 'Cancel'), 'cancel-booking', 'danger', '', `data-id="${b.id}"`) : ''}`;
    const details = [[tt('العميل', 'Client'), U.cLabel(cl)], M.multi() ? [tt('النشاط', 'Activity'), M.L(M.actName(act))] : null, [tt('نوع الرحلة', 'Trip type'), M.L(M.typeName(b.tripType))],
      act === 'tourism' ? [tt('البرنامج', 'Program'), prog ? `<a href="#program.${prog.id}">${prog.number} · ${M.L(prog.name)}</a>` : '—'] : null,
      line ? [tt('الخط', 'Line'), `<a href="#line.${line.id}">${line.number} · ${M.esc(M.L(line.name))}</a>`] : null,
      cargo ? [tt('البضاعة', 'Goods'), M.esc(b.goods || '—') + ((b.cargoFlags || []).length ? ' · ' + b.cargoFlags.map(f => U.badge(M.L((M.profiles.cargoFlags || {})[f] || { ar: f, en: f }), 'warning')).join(' ') : '')] : null,
      [M.L(p.load.label), M.loadText(b, act)],
      cargo ? [tt('الطرود / الحجم', 'Pieces / volume'), `${b.pieces || '—'} · ${b.volumeM3 ? M.n1(b.volumeM3) + ' ' + tt('م³', 'm³') : '—'}`] : null,
      [tt('النوع المطلوب', 'Vehicle type'), U.vtype(b.vehicleType)], [tt('السعر المتفق', 'Agreed price'), M.money(b.price)], [tt('دفعة مقدمة', 'Advance paid'), M.money(b.paid)],
      act === 'tourism' ? [tt('رقم الطيران', 'Flight'), M.esc(b.flight || '—')] : null,
      cargo ? [tt('التسليم', 'Delivery'), b.deliveredAt ? `${U.badge(tt('اتسلمت', 'Delivered'), 'success')} <span class="muted small">${M.esc(b.deliveredAt)} · ${M.esc(b.deliveredBy || '')}</span>` : b.codeLocked ? U.badge(tt('الكود اتقفل بعد 5 محاولات غلط — اعمل كود جديد', 'Code locked after 5 wrong tries — issue a new one'), 'danger') : b.hasCode ? U.badge(tt('في انتظار كود المستلم', 'Waiting for the consignee code'), 'warning') : '—'] : null,
      [tt('ملاحظات', 'Notes'), M.esc(b.notes || '—')], [tt('تاريخ الإنشاء', 'Created'), M.date(b.createdAt)], [tt('سبب الإلغاء', 'Cancellation reason'), b.cancelReason ? M.esc(tt(b.cancelReason[0], b.cancelReason[1])) : '—']];
    return U.head(b.number, `${U.routeTxt(b.pickup, b.destination)} · ${M.date(b.date)} ${b.time}`, acts, [[unitsTitle(), 'bookings'], [b.number]]) +
      U.card(tt('السلسلة', 'Chain'), chain(cl, prog, b, trips[0], invs[0], act, line)) + '<div style="height:16px"></div>' +
      `<div class="cols-2">` + U.card(cargo ? tt('بيانات الشحنة', 'Shipment details') : tt('البيانات', 'Details'), U.dl(details)) +
      U.card(tt('الرحلات المرتبطة', 'Linked trips'), trips.length ? trips.map(t => `<div class="list-row"><div class="grow"><div class="t"><a href="#trip.${t.id}">${t.number}</a> · ${M.date(t.date)}</div><div class="s">${U.routeTxt(t.from, t.to)} · ${M.esc(U.find('vehicles', t.vehicleId).code)} · ${M.esc(M.L(U.find('drivers', t.driverId).name))}</div></div>${U.status(t.status)}</div>`).join('') : U.empty('bus', tt('لم يتم التحويل لرحلة بعد', 'Not converted to a trip yet'), tt('حوّل لرحلة واختر المركبة المتاحة.', 'Convert it and pick an available vehicle.'))) + `</div>`;
  });
  U.act('convert-booking', el => {
    if (!U.guard()) return;
    const b = U.find('bookings', el.dataset.id); const c = U.candidates(b);
    U.modal(tt('تحويل لرحلة', 'Convert to trip'), `<p class="muted small">${tt('المركبات مرتبة حسب الأنسب. المركبات المتعارضة أو في الصيانة أو بسعة أقل مقفولة. السيرفر يعيد التحقق عند الحفظ.', 'Vehicles are ranked by fit. Ones that clash, are in the workshop or are too small are blocked. The server re-checks on save.')}</p>${c.slice(0, 10).map(x => `<div class="list-row"><div class="grow"><div class="t">${M.esc(x.v.code)} · ${U.vtype(x.v.type)} · ${U.capacity(x.v, bkAct(b))}</div><div class="s">${x.ok ? `${M.esc(M.L(x.driver.name))} · ${tt('تكلفة تقديرية', 'Est. cost')} ${M.money(x.estCost)}` : x.reasons.map(r => tt(r[0], r[1])).join(' · ')}${x.warns.length ? ' · ' + x.warns.map(r => tt(r[0], r[1])).join(' · ') : ''}</div></div>${x.ok ? `<button class="btn sm" data-act="do-assign" data-b="${b.id}" data-v="${x.v.id}" data-d="${x.driver.id}">${tt('تخصيص', 'Assign')}</button>` : U.badge(tt('غير متاحة', 'Blocked'), 'danger')}</div>`).join('') || U.empty('car', tt('لا توجد مركبات', 'No vehicles'))}`);
  });
  U.act('do-assign', el => U.run('booking.assign', { bookingId: el.dataset.b, vehicleId: el.dataset.v, driverId: el.dataset.d || undefined }, { ok: r => tt(`تم إنشاء الرحلة ${r.number}`, `Trip ${r.number} created`) }));
  U.act('cancel-booking', el => U.confirm(tt('إلغاء', 'Cancel'), tt('الحجز والرحلات المجدولة عليه هيتلغوا.', 'It and its scheduled trips will be cancelled.'), r => U.run('booking.cancel', { id: el.dataset.id, reason: r }, { ok: tt('تم الإلغاء', 'Cancelled') }), { reason: true, danger: true, ok: tt('تأكيد الإلغاء', 'Confirm cancellation') }));
  U.act('bk-edit', el => {
    const b = U.find('bookings', el.dataset.id); const assigned = !b.unassigned; const act = bkAct(b); const p = M.prof(act);
    U.formModal(tt('تعديل', 'Edit') + ' · ' + b.number, [
      assigned ? null : { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: b.date },
      assigned ? null : { f: 'time', label: tt('الميعاد', 'Time'), type: 'time', value: b.time },
      assigned ? null : { f: 'vehicleType', label: tt('نوع المركبة', 'Vehicle type'), type: 'select', value: b.vehicleType, options: [...new Set([b.vehicleType, ...M.typesFor(act)])].map(k => [k, U.vtype(k)]) },
      act === 'cargo' ? null : { f: 'pax', label: M.L(p.load.label), type: 'number', value: b.pax, attrs: 'min="1"' },
      { f: 'price', label: tt('السعر المتفق عليه', 'Agreed price'), type: 'number', value: b.price, attrs: 'min="0"' },
      { f: 'status', label: tt('الحالة', 'Status'), type: 'select', value: b.status, options: [['confirmed', U.statusText('confirmed')], ['tentative', U.statusText('tentative')]] },
      act === 'tourism' ? { f: 'flight', label: tt('رقم الطيران', 'Flight'), value: b.flight } : null, { f: 'notes', label: tt('ملاحظات', 'Notes'), type: 'textarea', value: b.notes, full: true },
    ], 'booking.update', { intro: assigned ? `<p class="muted small">${tt('متخصص له رحلة؛ لتغيير الموعد أو النوع ألغِ التخصيص من صفحة الرحلة.', 'It has a trip; to change the date, time or type, unassign it from the trip page.')}</p>` : '', map: d => Object.assign(d, { id: b.id }) });
  });

  function chain(cl, prog, b, t, inv, act, line) {
    const node = (lbl, html) => `<div class="node"><small>${lbl}</small>${html || '—'}</div>`;
    const ar = `<span class="arrow">${U.icon('arrow', 'flip')}</span>`.replace('<svg class="flip"', '<svg class="flip" style="width:16px;height:16px"');
    // the middle step is the activity's own: program (tourism), line (schools, staff, intercity), none (cargo)
    const mid = act === 'tourism' ? ar + node(tt('البرنامج', 'Program'), prog ? `<a href="#program.${prog.id}">${prog.number}</a>` : `<span class="muted">${tt('حجز مستقل', 'Standalone')}</span>`)
      : line ? ar + node(tt('الخط', 'Line'), `<a href="#line.${line.id}">${line.number}</a>`) : '';
    return `<div class="chain">${node(tt('العميل', 'Client'), cl ? U.cLabel(cl) : '')}${mid}${ar}${node(act === 'cargo' ? tt('الشحنة', 'Shipment') : tt('الحجز', 'Booking'), b ? `<a href="#booking.${b.id}">${b.number}</a>` : '')}${ar}${node(tt('الرحلة', 'Trip'), t ? `<a href="#trip.${t.id}">${t.number}</a>` : '')}${ar}${node(tt('الفاتورة', 'Invoice'), inv ? `<a href="#invoice.${inv.id}">${inv.number}</a>` : `<span class="muted">${tt('لم تُفوتر', 'Not invoiced')}</span>`)}</div>`;
  }

  U.chainHtml = chain;

  /* ================= PROGRAMS ================= */
  U.route('programs', () => {
    const cid = U.cid(), db = U.db();
    const rows = db.programs.map(p => ({ p, pl: C.programPL(cid, p) })).sort((a, b) => a.p.start < b.p.start ? 1 : -1);
    return U.head(tt('البرامج السياحية', 'Tour programs'), tt('برنامج متعدد الأيام لعميل: مسار كل يوم والمركبة والسائق وربحية البرنامج.', 'Multi-day itineraries sold to a client: daily route, vehicle, driver and program profitability.'), U.btn(tt('برنامج جديد', 'New program'), 'prog-new', '', 'plus')) +
      U.kpis([U.kpi(tt('برامج جارية', 'Running'), rows.filter(r => r.p.status === 'running').length), U.kpi(tt('مؤكدة قادمة', 'Confirmed upcoming'), rows.filter(r => r.p.status === 'confirmed').length), U.kpi(tt('إيراد البرامج المنتهية', 'Finished program revenue'), M.moneyK(M.sum(rows.filter(r => r.p.status === 'finished'), r => r.pl.revenue))), U.kpi(tt('متوسط هامش البرامج', 'Avg program margin'), M.pct(M.sum(rows, r => r.pl.profit) / (M.sum(rows, r => r.pl.revenue) || 1)))]) +
      U.card(null, U.table({ id: 'programs', rows, columns: [
        { label: tt('البرنامج', 'Program'), value: r => r.p.number, render: r => `<a class="cell-main" href="#program.${r.p.id}">${M.L(r.p.name)}</a><div class="cell-sub">${r.p.number} · ${r.p.days.length} ${tt('أيام', 'days')}</div>` },
        { label: tt('العميل', 'Client'), value: r => M.L(U.find('clients', r.p.clientId).name), render: r => U.cLabel(U.find('clients', r.p.clientId)) },
        { label: tt('الفترة', 'Dates'), value: r => r.p.start, render: r => `${M.date(r.p.start)} – ${M.date(r.p.end)}` },
        { label: tt('الركاب', 'Pax'), num: 1, value: r => r.p.pax },
        { label: tt('المركبة', 'Vehicle'), value: r => r.p.vehicleId ? U.find('vehicles', r.p.vehicleId).code : '', render: r => r.p.vehicleId ? `<a href="#vehicle.${r.p.vehicleId}">${M.esc(U.find('vehicles', r.p.vehicleId).code)}</a>` : U.badge(tt('بدون مركبة', 'Unassigned'), 'danger') },
        { label: tt('سعر النقل', 'Transport price'), num: 1, value: r => r.p.price, render: r => M.money(r.p.price) },
        { label: tt('الربح', 'Profit'), num: 1, value: r => r.pl.profit, render: r => U.money(r.pl.profit) },
        { label: tt('الحالة', 'Status'), value: r => r.p.status, render: r => U.status(r.p.status) },
      ], onRow: r => 'program.' + r.p.id }), { flush: true });
  });
  U.route('program', id => {
    const cid = U.cid(), db = U.db(); const p = db.programs.find(x => x.id === id);
    if (!p) return U.empty('route', tt('البرنامج غير موجود في هذه الشركة', 'Program not found in this company'));
    const pl = C.programPL(cid, p); const cl = U.find('clients', p.clientId); const v = U.find('vehicles', p.vehicleId); const d = U.find('drivers', p.driverId);
    const invs = db.invoices.filter(i => i.lines.some(l => l.programId === p.id));
    const canOps = ['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(M.state.role), canFin = ['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role);
    const open = ['tentative', 'confirmed', 'running'].includes(p.status);
    const unscheduled = p.days.filter(x => !pl.trips.some(t => t.date === x.date && t.status !== 'cancelled')).length;
    const acts = `${U.status(p.status)} ${canOps && open && (unscheduled || !p.vehicleId) ? U.btn(tt('تخصيص المركبة وجدولة الرحلات', 'Assign vehicle & schedule trips'), 'prog-schedule', '', 'calendar', `data-id="${p.id}"`) : ''} ${canOps && open && p.status !== 'running' && p.vehicleId && !unscheduled ? U.btn(tt('تغيير المركبة/السائق', 'Change vehicle/driver'), 'prog-schedule', 'secondary', 'settings', `data-id="${p.id}"`) : ''} ${canFin && p.status !== 'cancelled' && !invs.some(i => i.status !== 'cancelled') ? U.btn(tt('إصدار فاتورة البرنامج', 'Invoice program'), 'inv-program', 'secondary', 'file', `data-id="${p.id}"`) : ''} ${canOps && ['tentative', 'confirmed'].includes(p.status) ? U.btn(tt('إلغاء البرنامج', 'Cancel program'), 'prog-cancel', 'danger', '', `data-id="${p.id}"`) : ''}`;
    return U.head(M.esc(M.L(p.name)), `${p.number} · ${M.date(p.start)} – ${M.date(p.end)} · ${p.pax} ${tt('راكب', 'pax')}`, acts, [[tt('البرامج السياحية', 'Tour programs'), 'programs'], [p.number]]) +
      U.kpis([U.kpi(tt('سعر النقل المتفق', 'Agreed transport price'), M.money(p.price)), U.kpi(tt('التكلفة الفعلية للرحلات', 'Actual trip cost'), M.money(pl.cost), U.est()), U.kpi(tt('ربح البرنامج', 'Program profit'), U.money(pl.profit), `${tt('هامش', 'Margin')} ${M.pct(pl.margin)}`), U.kpi(tt('كيلومترات البرنامج', 'Program km'), M.n0(M.sum(p.days, x => x.km)))]) +
      `<div class="cols-2-1">` + U.card(tt('جدول البرنامج يوم بيوم', 'Day-by-day timeline'), U.table({ id: 'prog-days', rows: p.days, export: false, search: false, noPaging: true, columns: [
        { label: tt('اليوم', 'Day'), value: x => x.day, render: x => `<b>${tt('اليوم', 'Day')} ${x.day}</b><div class="cell-sub">${M.date(x.date)}</div>` },
        { label: tt('المسار', 'Route'), value: x => U.routeTxt(x.from, x.to) }, { label: tt('الميعاد', 'Time'), value: x => x.time, render: x => `<span class="num">${x.time}</span>` }, { label: tt('كم', 'km'), num: 1, value: x => x.km },
        { label: tt('الرحلة', 'Trip'), value: x => x.date, render: x => { const t = pl.trips.find(t => t.date === x.date); return t ? `<a href="#trip.${t.id}">${t.number}</a> ${U.status(t.status)}` : '—'; } },
      ] }), { flush: true }) +
      U.card(tt('البيانات', 'Details'), U.dl([[tt('العميل', 'Client'), U.cLabel(cl)], [tt('المركبة', 'Vehicle'), U.vLabel(v)], [tt('السائق', 'Driver'), U.dLabel(d)], [tt('المرشد السياحي', 'Tour guide'), `${M.esc(M.L(p.guide)) || '—'}<div class="cell-sub ltr">${M.esc(p.guidePhone)}</div>`], [tt('الحجز', 'Booking'), p.bookingId ? `<a href="#booking.${p.bookingId}">${M.esc(U.find('bookings', p.bookingId).number)}</a>` : '—'], [tt('الفواتير', 'Invoices'), invs.length ? invs.map(i => `<a href="#invoice.${i.id}">${i.number}</a> ${U.status(i.status)}`).join('<br>') : `<span class="muted">${tt('يُفوتر بعد انتهاء البرنامج', 'Invoiced when the program ends')}</span>`]])) + `</div>`;
  });

  /* ================= TRIPS ================= */
  /* ================= DRIVER: MY TRIPS (driver accounts see only their own trips) ================= */
  /* the driver's view of the load: headcount and stops, or the shipment (goods, weight, handling) */
  const myLoad = t => t.activity === 'cargo' ? M.loadText(U.find('bookings', t.bookingId), 'cargo') : M.loadText(t);
  const myExtra = t => {
    if (t.activity === 'cargo') { const b = U.find('bookings', t.bookingId); return `<div class="muted small">${M.esc(b.goods || '')}${b.pieces ? ` · ${b.pieces} ${tt('طرد', 'pieces')}` : ''}${(b.cargoFlags || []).map(f => ' · ' + M.L((M.profiles.cargoFlags || {})[f] || { ar: f, en: f })).join('')}${b.deliveredAt ? ' · ' + U.badge(tt('اتسلمت', 'Delivered'), 'success') : b.hasCode ? ' · ' + tt('التسليم بكود المستلم', 'Delivery with the consignee code') : ''}</div>`; }
    const l = t.lineId ? U.find('lines', t.lineId) : null;
    return l && l.stops && l.stops.length ? `<div class="muted small">${tt('المحطات', 'Stops')}: ${(t.lineLeg === 'return' ? [...l.stops].reverse() : l.stops).map(U.place).map(M.esc).join(' ← ')}</div>` : '';
  };
  U.route('mytrips', () => {
    const db = U.db(), today = M.TODAY;
    const veh = id => db.vehicles.find(v => v.id === id);
    const trips = db.trips.filter(t => ['scheduled', 'running'].includes(t.status) || t.date >= M.addDays(today, -1)).sort((a, b) => (a.startsAt || '') < (b.startsAt || '') ? -1 : 1);
    const card = t => {
      const v = veh(t.vehicleId);
      const act = t.status === 'scheduled' ? U.btn(tt('ابدأ الرحلة', 'Start trip'), 'my-start', '', 'arrow', `data-id="${t.id}"`) : t.status === 'running' ? U.btn(tt('إنهاء الرحلة', 'Finish trip'), 'my-finish', '', 'check', `data-id="${t.id}"`) : '';
      return U.card(null, `<div class="my-trip"><div><div class="muted small">${M.esc(t.number)} · ${M.date(t.date)} · <span class="num">${t.startTime}–${t.endTime}</span>${t.endsAt && t.endsAt.slice(0, 10) !== t.date ? ' ' + U.badge(tt('بتخلص اليوم التالي', 'ends next day'), 'warning') : ''}</div>
        <div class="route">${M.esc(U.place(t.from))} ← ${M.esc(U.place(t.to))}</div>
        <div class="muted small">${v ? `${M.esc(v.code)} · <span class="ltr">${M.esc(M.L(v.plate))}</span>` : ''} · ${M.esc(M.L(M.typeName(t.type)))} · ${myLoad(t)}</div>${myExtra(t)}</div>
        <div class="actions">${U.status(t.status)} ${act}</div></div>`);
    };
    const name = db.drivers[0] ? M.L(db.drivers[0].name) : '';
    return U.head(tt('رحلاتي', 'My trips'), `${M.esc(name)} · ${M.esc(M.L(U.company().name))}`) +
      (trips.length ? `<div class="my-trips">${trips.map(card).join('')}</div>` : U.card(null, U.empty('bus', tt('مفيش رحلات عليك دلوقتي', 'No trips assigned to you right now'), tt('الرحلات اللي الشركة بتحطك عليها بتظهر هنا.', 'Trips the company assigns to you appear here.'))));
  });
  U.act('my-start', el => { const t = U.find('trips', el.dataset.id); const v = U.db().vehicles.find(x => x.id === t.vehicleId);
    U.formModal(tt('بدء الرحلة', 'Start trip') + ' · ' + t.number, [{ f: 'odometer', label: tt('عداد البداية (كم)', 'Start odometer (km)'), type: 'number', value: v ? v.odometer : '', req: true }], 'me.tripStart', { map: x => ({ id: t.id, odometer: Number(x.odometer) }), ok: tt('بدأت الرحلة', 'Trip started') }); });
  U.act('my-finish', el => { const t = U.find('trips', el.dataset.id); const b = U.find('bookings', t.bookingId);
    const code = t.activity === 'cargo' && b.hasCode && !b.deliveredAt;
    U.formModal(tt('إنهاء الرحلة', 'Finish trip') + ' · ' + t.number, [code ? { f: 'deliveryCode', label: tt('كود التسليم (اطلبه من المستلم)', 'Delivery code (ask the consignee)'), req: true, attrs: 'inputmode="numeric" maxlength="6" dir="ltr" autocomplete="off"' } : null, { f: 'endKm', label: tt('عداد النهاية (كم)', 'End odometer (km)'), type: 'number', req: true }, { f: 'tolls', label: tt('رسوم طرق', 'Tolls'), type: 'number', value: 0 }, { f: 'parking', label: tt('انتظار', 'Parking'), type: 'number', value: 0 }],
      'me.tripComplete', { map: x => ({ id: t.id, deliveryCode: x.deliveryCode || undefined, endKm: Number(x.endKm), expenses: { tolls: Number(x.tolls) || 0, parking: Number(x.parking) || 0 } }), ok: tt('انتهت الرحلة', 'Trip finished') }); });

  U.route('trips', () => {
    const db = U.db(); const P = U.periodRange();
    const rows = db.trips.filter(t => t.date >= P.from && t.date <= M.addDays(M.TODAY, 7)).sort((a, b) => (a.date + a.startTime) < (b.date + b.startTime) ? 1 : -1);
    return U.head(tt('الرحلات', 'Trips'), `${P.label} + ${tt('الأسبوع القادم', 'next week')}`, U.periodSeg()) +
      U.kpis([U.kpi(tt('مكتملة', 'Completed'), rows.filter(t => t.status === 'completed').length), U.kpi(tt('مجدولة', 'Scheduled'), rows.filter(t => t.status === 'scheduled').length), U.kpi(tt('جارية الآن', 'In progress'), rows.filter(t => t.status === 'running').length), U.kpi(tt('غير مفوترة', 'Not invoiced'), rows.filter(t => t.status === 'completed' && !t.invoiced).length), U.kpi(tt('إجمالي الكيلومترات', 'Total km'), M.n0(M.sum(rows, t => t.km)))]) +
      U.card(null, U.table({ id: 'trips', rows, columns: [
        { label: tt('الرحلة', 'Trip'), value: t => t.number, render: t => `<a class="cell-main" href="#trip.${t.id}">${t.number}</a>${t.programId ? `<div class="cell-sub">${tt('برنامج', 'Program')}</div>` : ''}${t.contractId ? `<div class="cell-sub">${tt('عقد', 'Contract')} ${M.esc(U.find('contracts', t.contractId).number || '')}</div>` : ''}${t.source && t.source !== 'motus' ? `<div class="cell-sub">${M.L(M.tripSources[t.source])}</div>` : ''}` },
        { label: tt('التاريخ', 'Date'), value: t => t.date + t.startTime, render: t => `${M.date(t.date)} <span class="num muted">${t.startTime}</span>` },
        { label: tt('النوع', 'Type'), value: t => tripTypeTxt(t.type) }, { label: tt('المسار', 'Route'), value: t => U.routeTxt(t.from, t.to) },
        { label: tt('العميل', 'Client'), value: t => M.L(U.find('clients', t.clientId).name) },
        { label: tt('المركبة', 'Vehicle'), value: t => U.find('vehicles', t.vehicleId).code, render: t => `<a href="#vehicle.${t.vehicleId}">${U.find('vehicles', t.vehicleId).code}</a>` },
        { label: tt('السائق', 'Driver'), value: t => M.L(U.find('drivers', t.driverId).name) },
        { label: M.single() ? M.L(M.prof(M.single()).load.label) : tt('الحمولة', 'Load'), num: 1, value: t => t.activity === 'cargo' ? ((U.find('bookings', t.bookingId).loadKg) || 0) : t.pax, render: t => t.activity === 'cargo' ? M.loadText(U.find('bookings', t.bookingId), 'cargo') : M.loadText(t) },
        { label: tt('كم', 'km'), num: 1, value: t => t.km || t.plannedKm, render: t => M.n0(t.km || t.plannedKm) },
        { label: tt('الإيراد', 'Revenue'), num: 1, value: t => t.revenue, render: t => M.money(t.revenue) },
        { label: tt('الحالة', 'Status'), value: t => t.status, render: t => U.status(t.status) + (t.status === 'completed' && !t.invoiced ? ' ' + U.badge(tt('غير مفوترة', 'Not invoiced'), 'muted') : '') },
      ], filters: [{ label: tt('الحالة', 'Status'), get: t => t.status, options: ['scheduled', 'running', 'completed', 'cancelled'].map(k => [k, U.statusText(k)]) }, { label: tt('النوع', 'Type'), get: t => t.type, options: companyTypes().map(k => [k, tripTypeTxt(k)]) }, M.multi() ? { label: tt('النشاط', 'Activity'), get: t => t.activity, options: M.acts().map(a => [a, M.L(M.actName(a))]) } : null, { label: tt('المصدر', 'Source'), get: t => t.source || 'motus', options: Object.keys(M.tripSources).map(k => [k, M.L(M.tripSources[k])]) }, { label: tt('المركبة', 'Vehicle'), get: t => t.vehicleId, options: db.vehicles.map(v => [v.id, v.code]) }, { label: tt('السائق', 'Driver'), get: t => t.driverId, options: db.drivers.map(d => [d.id, M.L(d.name)]) }], onRow: t => 'trip.' + t.id }), { flush: true });
  });

  let tripTab = 'info';
  U.act('triptab', el => { tripTab = el.dataset.t; U.render(); });
  U.route('trip', id => {
    const cid = U.cid(), db = U.db(); const t = db.trips.find(x => x.id === id);
    if (!t) return U.empty('bus', tt('الرحلة غير موجودة في هذه الشركة', 'Trip not found in this company'));
    const v = U.find('vehicles', t.vehicleId), d = U.find('drivers', t.driverId), cl = U.find('clients', t.clientId);
    const b = t.bookingId ? U.find('bookings', t.bookingId) : null, prog = t.programId ? U.find('programs', t.programId) : null, inv = t.invoiceId ? U.find('invoices', t.invoiceId) : null;
    const cost = C.tripCost(cid, t);
    // the passenger manifest is tourism's (MOTUS holds no names for schools, staff or intercity passengers)
    const tabs = [['info', tt('البيانات', 'Details')], ['order', tt('أمر التشغيل', 'Trip order')], t.activity === 'tourism' ? ['manifest', tt('كشف الركاب', 'Passenger manifest')] : null, ['notify', tt('الإشعارات', 'Notifications')]].filter(Boolean);
    if (!tabs.some(x => x[0] === tripTab)) tripTab = 'info';
    const line = t.lineId ? U.find('lines', t.lineId) : null;
    let body = '';
    if (tripTab === 'info') {
      body = `<div class="cols-2">` + U.card(tt('بيانات الرحلة', 'Trip details'), U.dl([[tt('النوع', 'Type'), tripTypeTxt(t.type)], [tt('المصدر', 'Source'), M.L(M.tripSources[t.source || 'motus']) + (t.contractId ? ` · <a href="#contract.${t.contractId}">${M.esc(U.find('contracts', t.contractId).number || '')}</a>` : '') + (t.externalRef ? ` <span class="muted small ltr">${M.esc(t.externalRef)}</span>` : '')], [tt('المسار', 'Route'), U.routeTxt(t.from, t.to)], [tt('التاريخ', 'Date'), M.date(t.date)], [tt('الوقت', 'Time'), `<span class="num">${t.startTime} – ${t.endTime}</span>${t.endsAt && t.endsAt.slice(0, 10) !== t.date ? ' ' + U.badge(tt('بتنتهي ', 'Ends ') + M.date(t.endsAt.slice(0, 10)), 'warning') : ''}`], [tt('المركبة', 'Vehicle'), U.vLabel(v)], [tt('السائق', 'Driver'), U.dLabel(d)], M.multi() ? [tt('النشاط', 'Activity'), M.L(M.actName(t.activity))] : null, line ? [tt('الخط', 'Line'), `<a href="#line.${line.id}">${line.number} · ${M.esc(M.L(line.name))}</a>${t.lineLeg ? ' · ' + M.L((M.prof(t.activity) || {}).legNames ? M.prof(t.activity).legNames[t.lineLeg] : { ar: t.lineLeg, en: t.lineLeg }) : ''}`] : null, t.activity === 'cargo' && b ? [tt('الشحنة', 'Shipment'), `<a href="#booking.${b.id}">${b.number}</a> · ${M.esc(b.goods || '')} · ${M.loadText(b, 'cargo')}${b.deliveredAt ? ' ' + U.badge(tt('اتسلمت', 'Delivered'), 'success') : b.hasCode ? ' ' + U.badge(tt('في انتظار كود المستلم', 'Waiting for the consignee code'), 'warning') : ''}`] : [M.L((M.prof(t.activity) || M.prof(M.acts()[0]) || { load: { label: { ar: 'الركاب', en: 'Passengers' } } }).load.label), t.pax], [tt('عداد البداية', 'Start km'), M.n0(t.startKm)], [tt('عداد النهاية', 'End km'), M.n0(t.endKm)], [tt('المسافة', 'Distance'), t.km ? `${M.n0(t.km)} ${tt('كم', 'km')} ${t.gpsKm ? `<span class="muted small">(GPS ${M.n0(t.gpsKm)})</span>` : ''}` : `${M.n0(t.plannedKm)} ${tt('كم مخطط', 'km planned')}`], M.has('tourism') && [tt('الطيران', 'Flight'), t.flight ? `${M.esc(t.flight)} ${t.flightStatus ? U.badge({ ontime: tt('في الموعد', 'On time'), delayed: tt('متأخر', 'Delayed'), landed: tt('هبطت', 'Landed'), cancelled: tt('ملغاة', 'Cancelled') }[t.flightStatus], t.flightStatus === 'delayed' || t.flightStatus === 'cancelled' ? 'warning' : 'success') : ''}` : '—'], [tt('الالتزام بالموعد', 'On time'), t.onTime == null ? '—' : t.onTime ? U.badge(tt('في الموعد', 'On time'), 'success') : U.badge(tt(`تأخير ${t.delayMin} دقيقة`, `${t.delayMin} min late`), 'warning')], t.cancelReason ? [tt('سبب الإلغاء', 'Cancellation reason'), M.esc(tt(t.cancelReason[0], t.cancelReason[1]))] : null])) +
        U.card(tt('الإيراد والتكلفة', 'Revenue & cost'), U.dl([[tt('الإيراد', 'Revenue'), `<b>${M.money(t.revenue)}</b>`], [tt('كارتة', 'Tolls'), M.money(t.expenses.tolls)], [tt('جراج وانتظار', 'Parking'), M.money(t.expenses.parking)], [tt('إقامة سائق', 'Driver lodging'), M.money(t.expenses.lodging)], [tt('مصروفات أخرى', 'Other'), M.money(t.expenses.other)], [tt('وقود (تقديري)', 'Fuel (est.)'), M.money(cost.fuel)], [tt('صيانة وزيت (تقديري)', 'Maintenance & oil (est.)'), M.money(cost.maint)], [tt('حصة التكاليف الثابتة', 'Fixed cost share'), M.money(cost.fixed)], [tt('ربح الرحلة', 'Trip profit'), U.money(t.revenue - cost.total)]]) + `<div class="muted small" style="margin-top:8px">${tt('الوقود والصيانة محسوبين بتكلفة الكيلو الفعلية للمركبة. الثابت = (سائق + رخص وتأمين + إهلاك) ÷ أيام التشغيل.', 'Fuel and maintenance use the vehicle’s actual cost per km. Fixed = (driver + license & insurance + depreciation) ÷ operating days.')}</div>`) + `</div>`;
    } else if (tripTab === 'order') {
      body = tripOrder(t, v, d, cl, prog);
    } else if (tripTab === 'manifest') {
      const pax = (db.passengers || []).filter(p => p.tripId === t.id);
      body = U.card(tt('كشف الركاب', 'Passenger manifest'), U.table({ id: 'manifest', rows: pax, emptyTitle: tt('لا يوجد كشف ركاب', 'No passenger manifest'), emptyText: tt('استورد الكشف من ملف Excel (CSV).', 'Import the manifest from an Excel (CSV) file.'), columns: [{ label: '#', num: 1, value: (p) => pax.indexOf(p) + 1 }, { label: tt('الاسم', 'Name'), value: p => p.name }, M.has('tourism') && { label: tt('الجنسية', 'Nationality'), value: p => p.nationality }, M.has('tourism') && { label: tt('رقم الجواز', 'Passport'), value: p => p.passportNo, render: p => `<span class="mono">${M.esc(p.passportNo)}</span>` }, M.has('tourism') && { label: tt('الفندق', 'Hotel'), value: p => p.hotel }, { label: tt('ميعاد الاستلام', 'Pickup'), value: p => p.pickupTime || t.startTime, render: p => `<span class="num">${M.esc(p.pickupTime || t.startTime)}</span>` }].filter(Boolean) }), { flush: true, hint: ['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(M.state.role) ? '' : tt('أرقام الجوازات مخفية لدورك.', 'Passport numbers are masked for your role.'), actions: U.btn(tt('استيراد من Excel', 'Import from Excel'), 'pax-import', 'secondary', 'upload', `data-id="${t.id}"`) });
    } else {
      const tpl = U.msgTemplates(t);
      body = U.card(tt('قوالب الرسائل', 'Message templates'), tpl.map((x, i) => `<div class="list-row"><div class="grow"><div class="t">${x[1]} <span class="muted small ltr">${M.esc(x[2] || tt('لا يوجد رقم', 'no number'))}</span></div><div class="s" style="white-space:normal">${M.esc(x[3])}</div></div><div class="actions"><button class="btn secondary sm" data-act="msg-open" data-id="${t.id}" data-i="${i}">${U.icon('message')}WhatsApp</button><button class="btn ghost sm" data-act="msg-sms" data-id="${t.id}" data-i="${i}">SMS</button><button class="btn ghost sm" data-act="msg-copy" data-id="${t.id}" data-i="${i}">${U.icon('copy')}</button></div></div>`).join('') + `<p class="muted small">${tt('الرسالة تفتح في واتساب أو تطبيق الرسائل على جهازك جاهزة للإرسال، ويتسجل الإرسال في سجل العمليات. الربط مع بوابة رسائل آلية يحتاج حساب لدى مزود رسائل.', 'The message opens in WhatsApp or your SMS app ready to send, and the send is logged. Fully automatic sending needs an account with an SMS/WhatsApp gateway provider.')}</p>`);
    }
    const canOps = ['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(M.state.role);
    const acts = !canOps ? '' : t.status === 'scheduled' ? `${U.btn(tt('بدء الرحلة', 'Start trip'), 'app-start', '', 'arrow', `data-id="${t.id}"`)} ${U.btn(tt('تعديل', 'Change'), 'trip-edit', 'secondary', 'settings', `data-id="${t.id}"`)} ${!t.programId ? U.btn(tt('إلغاء التخصيص', 'Unassign'), 'trip-unassign', 'ghost', '', `data-id="${t.id}"`) : ''} ${U.btn(tt('إلغاء الرحلة', 'Cancel trip'), 'trip-cancel', 'danger', '', `data-id="${t.id}"`)}`
      : t.status === 'running' ? `${U.btn(tt('إنهاء الرحلة', 'End trip'), 'app-end', '', 'check', `data-id="${t.id}"`)} ${U.btn(tt('مصروف', 'Expense'), 'app-exp', 'secondary', 'receipt', `data-id="${t.id}"`)}` : '';
    return U.head(t.number, `${U.routeTxt(t.from, t.to)} · ${M.date(t.date)} ${t.startTime}`, `${U.status(t.status)} ${acts}`, [[tt('الرحلات', 'Trips'), 'trips'], [t.number]]) +
      U.card(tt('السلسلة', 'Chain'), chain(cl, prog, b, t, inv, t.activity, line)) + '<div style="height:16px"></div>' +
      `<div class="tabs" role="tablist">${tabs.map(x => `<button role="tab" class="${tripTab === x[0] ? 'on' : ''}" data-act="triptab" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>` + body;
  });
  U.act('trip-edit', el => {
    const t = U.find('trips', el.dataset.id); const db = U.db();
    U.formModal(tt('تعديل الرحلة', 'Change trip'), [
      { f: 'startTime', label: tt('ميعاد الاستلام', 'Pickup time'), type: 'time', value: t.startTime },
      { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', value: t.driverId, options: db.drivers.filter(d => d.status === 'active').map(d => [d.id, M.L(d.name)]) },
      t.activity === 'cargo' ? null : { f: 'pax', label: M.L((M.prof(t.activity) || M.prof(M.acts()[0])).load.label), type: 'number', value: t.pax, attrs: 'min="1"' },
      t.activity === 'tourism' ? { f: 'flight', label: tt('رقم الطيران', 'Flight'), value: t.flight } : null,
      t.activity !== 'tourism' ? null : { f: 'flightStatus', label: tt('حالة الطيران', 'Flight status'), type: 'select', value: t.flightStatus || '', options: [['', '—'], ['ontime', tt('في الموعد', 'On time')], ['delayed', tt('متأخر', 'Delayed')], ['landed', tt('هبطت', 'Landed')], ['cancelled', tt('ملغاة', 'Cancelled')]] },
    ], 'trip.update', { map: d => { const out = { id: t.id }; if (d.startTime !== t.startTime) out.startTime = d.startTime; if (d.driverId !== t.driverId) out.driverId = d.driverId; if (d.pax !== t.pax) out.pax = d.pax; if ((d.flight || null) !== (t.flight || null)) out.flight = d.flight; if (d.flightStatus) out.flightStatus = d.flightStatus; return out; } });
  });
  U.act('trip-cancel', el => U.confirm(tt('إلغاء الرحلة', 'Cancel trip'), tt('الرحلة والحجز المرتبط بيها هيتلغوا.', 'The trip and its booking will be cancelled.'), r => U.run('trip.cancel', { id: el.dataset.id, reason: r }, { ok: tt('تم الإلغاء', 'Cancelled') }), { reason: true, danger: true }));
  U.act('trip-unassign', el => U.confirm(tt('إلغاء التخصيص', 'Unassign'), tt('الرحلة هتتلغي والحجز يرجع لقائمة "بدون مركبة" لتخصيصه من جديد.', 'The trip is cancelled and the booking goes back to the unassigned list to be reassigned.'), r => U.run('trip.cancel', { id: el.dataset.id, reason: r, reassign: true }, { ok: tt('رجع الحجز لقائمة التوزيع', 'Booking returned to the dispatch list'), after: () => { location.hash = 'dispatch'; U.full(); } }), { reason: true }));
  /* messages: opened in the user's own WhatsApp / SMS app with the text filled in (no gateway needed) */
  const intlPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '20' + d.slice(1); return d; };
  U.msgTemplates = t => {
    const v = U.find('vehicles', t.vehicleId), d = U.find('drivers', t.driverId), cl = U.find('clients', t.clientId);
    return [
      ['driver', tt('للسائق: أمر التشغيل', 'To driver: trip order'), d.phone, tt(`أمر تشغيل ${t.number}: ${U.place(t.from)} ← ${U.place(t.to)} يوم ${M.date(t.date)} الساعة ${t.startTime}. العميل ${M.L(cl.name)}، ${M.loadText(t.activity === 'cargo' ? U.find('bookings', t.bookingId) : t, t.activity)}.${t.flight ? ' طيران ' + t.flight : ''}`, `Trip order ${t.number}: ${U.place(t.from)} → ${U.place(t.to)} on ${M.date(t.date)} at ${t.startTime}. Client ${M.L(cl.name)}, ${M.loadText(t.activity === 'cargo' ? U.find('bookings', t.bookingId) : t, t.activity)}.${t.flight ? ' Flight ' + t.flight : ''}`)],
      ['client', tt('للعميل: بيانات السائق', 'To client: driver details'), cl.phone, tt(`السائق ${M.L(d.name)} (${d.phone}) سيستلمكم بالمركبة ${M.L(v.plate)} الساعة ${t.startTime} من ${U.place(t.from)}.`, `Your driver ${M.L(d.name)} (${d.phone}) will pick you up in ${M.L(v.plate)} at ${t.startTime} from ${U.place(t.from)}.`)],
      ['client', tt('تذكير قبلها بيوم', 'Reminder the day before'), cl.phone, tt(`تذكير: رحلتكم يوم ${M.date(t.date)} الساعة ${t.startTime} من ${U.place(t.from)}.`, `Reminder: your trip is on ${M.date(t.date)} at ${t.startTime} from ${U.place(t.from)}.`)],
      ['client', tt('السائق وصل', 'Driver arrived'), cl.phone, tt(`السائق وصل إلى ${U.place(t.from)} ومنتظركم.`, `Your driver has arrived at ${U.place(t.from)}.`)],
    ];
  };
  U.act('msg-open', el => {
    const t = U.find('trips', el.dataset.id); const tpl = U.msgTemplates(t); const m = el.dataset.i != null ? tpl[+el.dataset.i] : tpl.find(x => x[0] === el.dataset.to) || tpl[0];
    const phone = intlPhone(m[2]);
    if (!phone) { U.toast(tt('لا يوجد رقم هاتف مسجل', 'No phone number on file'), 'error'); return; }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(m[3])}`, '_blank', 'noopener');
    M.api.do('message.log', { entity: 'trip', ref: t.number, channel: 'whatsapp' }).catch(() => {});
  });
  U.act('msg-sms', el => { const t = U.find('trips', el.dataset.id); const m = U.msgTemplates(t)[+el.dataset.i]; const phone = '+' + intlPhone(m[2]); location.href = `sms:${phone}?body=${encodeURIComponent(m[3])}`; M.api.do('message.log', { entity: 'trip', ref: t.number, channel: 'sms' }).catch(() => {}); });
  U.act('msg-copy', async el => { const t = U.find('trips', el.dataset.id); const m = U.msgTemplates(t)[+el.dataset.i]; try { await navigator.clipboard.writeText(m[3]); U.toast(tt('تم نسخ الرسالة', 'Message copied')); } catch (e) { U.toast(m[3]); } });
  U.act('pax-import', el => {
    U.formModal(tt('استيراد كشف الركاب', 'Import passenger manifest'), [{ f: 'file', label: tt('ملف CSV من Excel', 'CSV file from Excel'), type: 'html', full: true, html: '<input type="file" id="pax-file" accept=".csv,text/csv">' }], async () => {
      const f = await U.readFile(document.getElementById('pax-file'));
      if (!f) { U.toast(tt('اختر الملف', 'Choose the file'), 'error'); return; }
      const rows = U.parseCsv(f.text);
      const pick = (r, keys) => { for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().replace(/[^a-z؀-ۿ]/g, ''))) return r[k]; return ''; };
      const passengers = rows.map(r => ({ name: pick(r, ['name', 'fullname', 'passenger', 'الاسم']), nationality: pick(r, ['nationality', 'الجنسية']), passportNo: pick(r, ['passport', 'passportno', 'passportnumber', 'رقمالجواز', 'الجواز']), hotel: pick(r, ['hotel', 'الفندق']), pickupTime: pick(r, ['pickup', 'pickuptime', 'time', 'الميعاد']) })).filter(p => p.name);
      if (!passengers.length) { U.toast(tt('لم يتم العثور على عمود "name" أو "الاسم"', 'No "name" column found'), 'error'); return; }
      await U.run('trip.passengers', { id: el.dataset.id, passengers }, { ok: r => tt(`تم استيراد ${r.count} راكب`, `${r.count} passengers imported`) });
    }, { intro: `<p class="muted small">${tt('الأعمدة: name (الاسم) · nationality (الجنسية) · passport (رقم الجواز) · hotel (الفندق) · pickup (الميعاد). الاستيراد يستبدل الكشف الحالي.', 'Columns: name · nationality · passport · hotel · pickup. Importing replaces the current manifest.')}</p>`, submit: tt('استيراد', 'Import') });
  });

  /* real QR code (Project Nayuki library) */
  U.qr = (text) => {
    if (!window.qrcodegen) return '';
    const q = qrcodegen.QrCode.encodeText(String(text), qrcodegen.QrCode.Ecc.MEDIUM); const n = q.size; let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.getModule(x, y)) d += `M${x} ${y}h1v1h-1z`;
    return `<svg class="qr" viewBox="-2 -2 ${n + 4} ${n + 4}" role="img" aria-label="QR ${M.esc(text)}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#08264A"/></svg>`;
  };
  /* what the trip order says about the load: passengers, headcount + stops, or the shipment */
  function orderLoad(t) {
    const p = M.prof(t.activity) || M.prof(M.acts()[0]);
    if (t.activity === 'cargo') { const b = U.find('bookings', t.bookingId); return [[tt('البضاعة', 'Goods'), M.esc(b.goods || '—')], [tt('الوزن / الطرود', 'Weight / pieces'), `${M.loadText(b, 'cargo')} · ${b.pieces || '—'}`], [tt('التسليم', 'Delivery'), tt('بكود المستلم', 'With the consignee code')]]; }
    const line = t.lineId ? U.find('lines', t.lineId) : null;
    return [[M.L(p.load.label), t.pax], line && line.stops && line.stops.length ? [tt('المحطات', 'Stops'), line.stops.map(U.place).map(M.esc).join(' ← ')] : null];
  }
  function tripOrder(t, v, d, cl, prog) {
    const pf = M.places[t.from] || {};
    const mapUrl = pf.lat != null ? `https://www.openstreetmap.org/?mlat=${pf.lat}&mlon=${pf.lng}#map=15/${pf.lat}/${pf.lng}` : null;
    const qrText = `MOTUS ${t.number} | ${t.date} ${t.startTime} | ${U.place(t.from)} > ${U.place(t.to)} | ${v.code} ${M.L(v.plate)} | ${M.L(d.name)} ${d.phone || ''}`;
    return `<div class="doc-sheet" id="trip-order"><div class="doc-head"><div>${U.logo('#08264A').replace('<svg', '<svg style="height:26px"')}<div class="muted small">${M.esc(M.L(U.company().name))}</div></div><div style="text-align:end"><b style="font-size:18px">${tt('أمر تشغيل', 'Trip order')}</b><div class="mono">${t.number}</div><div class="small muted">${M.date(t.date)}</div></div>${U.qr(qrText)}</div>
      <div class="cols-2">${U.dl([[tt('العميل', 'Client'), M.esc(M.L(cl.name))], [tt('مسؤول العميل', 'Client contact'), `${M.esc(M.L(cl.contact))} · <span class="ltr">${M.esc(cl.phone)}</span>`], t.activity === 'tourism' ? [tt('المرشد / قائد المجموعة', 'Guide / group leader'), prog && !prog._missing ? `${M.esc(M.L(prog.guide))} · <span class="ltr">${M.esc(prog.guidePhone)}</span>` : '—'] : null, ...orderLoad(t), t.activity === 'tourism' ? [tt('رقم الطيران', 'Flight'), M.esc(t.flight || '—')] : null])}${U.dl([[tt('المركبة', 'Vehicle'), `${M.esc(v.code)} · ${M.esc(M.L(v.plate))}`], [tt('السائق', 'Driver'), `${M.esc(M.L(d.name))} · <span class="ltr">${M.esc(d.phone)}</span>`], [tt('ميعاد الاستلام', 'Pickup time'), `<b class="num">${t.startTime}</b>`], [tt('مكان الاستلام', 'Pickup point'), `${M.esc(U.place(t.from))}${mapUrl ? ` · <a href="${mapUrl}" target="_blank" rel="noopener">${tt('فتح الخريطة', 'Open map')}</a>` : ''}`], [tt('الوجهة', 'Destination'), M.esc(U.place(t.to))]])}</div>
      <div class="sep"></div>${U.dl([[tt('المسار', 'Route'), `${U.routeTxt(t.from, t.to)} · ${M.n0(t.plannedKm)} ${tt('كم', 'km')}`], [tt('كارتة متوقعة', 'Expected tolls'), M.money(t.plannedTolls)], [tt('ملاحظات', 'Notes'), tt('الفحص قبل الرحلة إلزامي. سجّل العداد عند البدء والانتهاء.', 'Pre-trip inspection is required. Record the odometer at start and end.')]])}
      <div class="actions no-print" style="margin-top:14px"><button class="btn secondary" data-act="print-order">${U.icon('download')}${tt('طباعة / حفظ PDF', 'Print / save as PDF')}</button><button class="btn secondary" data-act="msg-open" data-to="driver" data-id="${t.id}">${U.icon('message')}${tt('إرسال للسائق على واتساب', 'Send to driver on WhatsApp')}</button></div></div>`;
  }
  U.act('print-order', () => { document.body.classList.add('print-doc'); window.print(); setTimeout(() => document.body.classList.remove('print-doc'), 500); });

  /* ================= CALENDAR ================= */
  let calMode = 'week';
  U.act('calmode', el => { calMode = el.dataset.m; U.render(); });
  U.route('calendar', () => {
    const db = U.db(); const n = calMode === 'week' ? 7 : 30; const start = calMode === 'week' ? M.addDays(M.TODAY, -1) : M.addDays(M.TODAY, -15);
    const days = Array.from({ length: n }, (_, i) => M.addDays(start, i));
    const dn = M.lang === 'ar' ? ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cell = (v, d) => {
      const ts = db.trips.filter(t => t.vehicleId === v.id && t.date === d && t.status !== 'cancelled');
      const wo = db.workOrders.find(w => w.vehicleId === v.id && w.downStart <= d && (w.downEnd || M.addDays(M.TODAY, 1)) >= d);
      if (wo) return `<a class="cell cm" href="#wo.${wo.id}" title="${M.esc(M.L(wo.problem))}">${tt('صيانة', 'Shop')}</a>`;
      if (!ts.length) return '';
      const p = ts.find(t => t.programId);
      return `<a class="cell ${ts.length > 2 ? 'c3' : ts.length > 1 ? 'c2' : 'c1'}" href="#trip.${ts[0].id}" title="${ts.map(t => t.number + ' ' + t.startTime).join(', ')}">${p ? '★' : ''}${ts.length}</a>`;
    };
    return U.head(tt('تقويم الحركة', 'Operations calendar'), (M.has('tourism') ? tt('كل صف مركبة وكل عمود يوم. الرقم = عدد الرحلات، ★ = يوم في برنامج.', 'Each row is a vehicle and each column a day. Number = trips, ★ = program day.') : tt('كل صف مركبة وكل عمود يوم. الرقم = عدد الرحلات.', 'Each row is a vehicle and each column a day. Number = trips.')), `<div class="seg"><button data-act="calmode" data-m="week" class="${calMode === 'week' ? 'on' : ''}">${tt('أسبوع', 'Week')}</button><button data-act="calmode" data-m="month" class="${calMode === 'month' ? 'on' : ''}">${tt('شهر', 'Month')}</button></div>`) +
      U.card(null, `<div class="cal"><table><thead><tr><th>${tt('المركبة', 'Vehicle')}</th>${days.map(d => `<th class="${d === M.TODAY ? 'today' : ''}">${dn[M.dow(d)]}<br><span class="num">${d.slice(8)}/${d.slice(5, 7)}</span></th>`).join('')}</tr></thead><tbody>${db.vehicles.map(v => `<tr><td class="lbl"><a href="#vehicle.${v.id}">${v.code}</a> <span class="muted small">${U.vtype(v.type)}</span></td>${days.map(d => `<td class="${d === M.TODAY ? 'today' : ''}">${cell(v, d)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="legend-inline" style="padding:12px 16px"><span><i style="background:#C3CFDC"></i>1 ${tt('رحلة', 'trip')}</span><span><i style="background:#8FA3BA"></i>2</span><span><i style="background:#2C4A6E"></i>3+</span><span><i style="background:#FFF7E6;border:1px solid #B45309"></i>${tt('صيانة', 'Workshop')}</span></div>`, { flush: true });
  });

  /* ================= DISPATCH BOARD ================= */
  let boardDate = M.TODAY; let picked = null;
  U.act('board-date', el => { boardDate = el.dataset.d; U.render(); });
  U.route('dispatch', () => {
    const db = U.db();
    const ua = db.bookings.filter(b => b.unassigned && b.status !== 'cancelled' && b.date === boardDate).sort((a, b) => a.time < b.time ? -1 : 1);
    const H0 = 5, H1 = 23; const span = (H1 - H0) * 60;
    const pos = s => { const m = (+s.slice(0, 2)) * 60 + (+s.slice(3, 5)); return Math.max(0, Math.min(1, (m - H0 * 60) / span)); };
    const lane = v => {
      const ts = db.trips.filter(t => t.vehicleId === v.id && t.date === boardDate && t.status !== 'cancelled');
      const wo = db.workOrders.find(w => w.vehicleId === v.id && w.downStart <= boardDate && (w.downEnd || M.addDays(M.TODAY, 1)) >= boardDate);
      const side = M.lang === 'ar' ? 'right' : 'left';
      let html = wo ? `<a class="board-block maint" href="#wo.${wo.id}" style="${side}:0;width:100%">${tt('في الصيانة', 'In workshop')} · ${M.L(wo.problem)}</a>` : '';
      ts.forEach(t => { const a = pos(t.startTime); let b = pos(t.endTime); if (b <= a) b = 1; html += `<a class="board-block ${t.status === 'completed' ? 'done' : t.status === 'running' ? 'running' : ''}" href="#trip.${t.id}" style="${side}:${(a * 100).toFixed(2)}%;width:${Math.max(3, (b - a) * 100).toFixed(2)}%" title="${t.number} ${t.startTime}–${t.endTime}">${t.startTime} ${U.place(t.to)}</a>`; });
      return html;
    };
    const days = [M.TODAY, M.addDays(M.TODAY, 1), M.addDays(M.TODAY, 2)];
    U.onMount(bindBoard);
    return U.head(tt('لوحة توزيع الحركة', 'Dispatch board'), tt('اسحب الحجز على مركبة لتخصيصه، أو اضغط على الحجز ثم على صف المركبة. التعارضات تمنع التخصيص مع ذكر السبب.', 'Drag a booking onto a vehicle, or tap the booking then the vehicle row. Conflicts block the drop and say why.'), `<div class="seg">${days.map((d, i) => `<button data-act="board-date" data-d="${d}" class="${boardDate === d ? 'on' : ''}">${[tt('اليوم', 'Today'), tt('بكرة', 'Tomorrow'), tt('بعد بكرة', 'In 2 days')][i]}</button>`).join('')}</div><a class="btn secondary" href="#assign">${U.icon('sparkles')}${tt('خطّط بالذكاء الاصطناعي', 'Plan with AI')}</a>`) +
      `<div class="cols-2-1" style="grid-template-columns:minmax(0,1fr) 300px">` +
      U.card(`${M.date(boardDate)} · ${db.vehicles.length} ${tt('مركبة', 'vehicles')}`, `<div class="board"><div class="board-inner"><div class="board-hours"><div class="board-label">${tt('المركبة', 'Vehicle')}</div><div class="h">${Array.from({ length: 18 }, (_, i) => `<span>${String(H0 + i).padStart(2, '0')}</span>`).join('')}</div></div>${db.vehicles.map(v => `<div class="board-row"><div class="board-label"><b>${v.code}</b>${U.vtype(v.type)} · ${v.seats}</div><div class="board-lane" data-lane="${v.id}" tabindex="0" role="button" aria-label="${v.code}">${lane(v)}</div></div>`).join('')}</div></div><div class="legend-inline" style="padding:10px 16px"><span><i style="background:#08264A"></i>${tt('مجدولة', 'Scheduled')}</span><span><i style="background:#2C4A6E"></i>${tt('جارية', 'In progress')}</span><span><i style="background:#8FA3BA"></i>${tt('مكتملة', 'Completed')}</span><span><i style="background:#FFF7E6;border:1px solid #B45309"></i>${tt('صيانة', 'Workshop')}</span></div>`, { flush: true }) +
      U.card(tt('حجوزات بدون مركبة', 'Unassigned bookings') + ` (${ua.length})`, ua.length ? `<div class="unassigned">${ua.map(b => `<div class="ua-card ${picked === b.id ? 'picked' : ''}" draggable="true" data-bk="${b.id}" tabindex="0" role="button"><b>${b.time} · ${U.routeTxt(b.pickup, b.destination)}</b><div class="muted">${b.number} · ${M.L(U.find('clients', b.clientId).name)}</div><div>${b.pax} ${tt('راكب', 'pax')} · ${U.vtype(b.vehicleType)} ${b.status === 'tentative' ? U.badge(U.statusText('tentative'), 'muted') : ''}${b.flight ? ` · ${U.icon('plane').replace('<svg class=""', '<svg style="width:12px;height:12px;vertical-align:-1px"')} ${b.flight}` : ''}</div></div>`).join('')}</div>` : U.empty('check', tt('كل حجوزات اليوم متوزعة', 'Every booking for this day is assigned'))) + `</div>`;
  });
  function bindBoard() {
    const db = U.db();
    const tryAssign = (bkId, vid) => {
      const b = db.bookings.find(x => x.id === bkId); const c = U.candidates(b).find(x => x.v.id === vid);
      if (!c.ok) { U.modal(tt('لا يمكن التخصيص', 'Can’t assign here'), `<p><b>${M.esc(c.v.code)}</b> · ${U.vtype(c.v.type)}</p>${c.reasons.map(r => `<div class="list-row"><span class="sev high"></span><div class="grow">${tt(r[0], r[1])}</div></div>`).join('')}`, `<a class="btn" href="#assign" data-act="close-overlay">${U.icon('sparkles')}${tt('اقترح لي مركبة', 'Suggest a vehicle')}</a>`); return; }
      if (U.readOnly()) { U.guard(); return; }
      picked = null;
      U.run('booking.assign', { bookingId: b.id, vehicleId: vid, driverId: c.driver ? c.driver.id : undefined }, { ok: tt(`تم تخصيص ${c.v.code} للحجز ${b.number}`, `${c.v.code} assigned to ${b.number}`) + (c.warns.length ? ' · ' + tt(c.warns[0][0], c.warns[0][1]) : '') });
    };
    document.querySelectorAll('.ua-card').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', el.dataset.bk); picked = el.dataset.bk; });
      el.addEventListener('click', () => { picked = picked === el.dataset.bk ? null : el.dataset.bk; document.querySelectorAll('.ua-card').forEach(x => x.classList.toggle('picked', x.dataset.bk === picked)); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    });
    document.querySelectorAll('[data-lane]').forEach(l => {
      l.addEventListener('dragover', e => { e.preventDefault(); if (!picked) return; const b = db.bookings.find(x => x.id === picked); const c = U.candidates(b).find(x => x.v.id === l.dataset.lane); l.classList.toggle('drop-ok', c.ok); l.classList.toggle('drop-bad', !c.ok); });
      l.addEventListener('dragleave', () => l.classList.remove('drop-ok', 'drop-bad'));
      l.addEventListener('drop', e => { e.preventDefault(); l.classList.remove('drop-ok', 'drop-bad'); const id = e.dataTransfer.getData('text/plain') || picked; if (id) tryAssign(id, l.dataset.lane); });
      l.addEventListener('click', e => { if (e.target.closest('a')) return; if (picked) tryAssign(picked, l.dataset.lane); });
      l.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && picked) { e.preventDefault(); tryAssign(picked, l.dataset.lane); } });
    });
  }

  /* ================= READINESS ================= */
  U.route('readiness', () => {
    const cid = U.cid(), db = U.db(); const tomorrow = M.addDays(M.TODAY, 1);
    const rows = db.vehicles.map(v => ({ v, r: C.readiness(cid, v), trips: db.trips.filter(t => t.vehicleId === v.id && t.date === tomorrow && t.status !== 'cancelled').length, insp: db.inspections.filter(i => i.vehicleId === v.id).sort((a, b) => a.date < b.date ? 1 : -1)[0] }));
    return U.head(tt('جاهزية المركبات لبكرة', 'Vehicle readiness for tomorrow'), M.date(tomorrow)) +
      U.kpis([U.kpi(tt('جاهزة', 'Ready'), `<span class="delta-up">${rows.filter(r => r.r.ready).length}</span>`), U.kpi(tt('غير جاهزة', 'Not ready'), `<span class="delta-down">${rows.filter(r => !r.r.ready).length}</span>`), U.kpi(tt('عليها رحلات بكرة', 'Booked tomorrow'), rows.filter(r => r.trips).length)]) +
      U.card(null, U.table({ id: 'ready', rows, columns: [
        { label: tt('المركبة', 'Vehicle'), value: r => r.v.code, render: r => U.vLabel(r.v) },
        { label: tt('الحالة', 'Status'), value: r => r.r.ready ? 1 : 0, render: r => U.status(r.r.ready ? 'ready' : 'notready') },
        { label: tt('رحلات بكرة', 'Trips tomorrow'), num: 1, value: r => r.trips },
        { label: tt('آخر فحص', 'Last inspection'), value: r => r.insp ? r.insp.date : '', render: r => r.insp ? `${M.date(r.insp.date)} ${U.status(r.insp.result)}` : '—' },
        { label: tt('الأسباب والملاحظات', 'Reasons & notes'), sort: false, render: r => r.r.reasons.length ? r.r.reasons.map(x => U.badge(tt(x[0], x[1]), 'warning')).join(' ') : `<span class="muted small">${tt('نظيفة، مفحوصة، بها وقود، مستنداتها سارية', 'Cleaned, inspected, fueled, documents valid')}</span>` },
      ], onRow: r => 'vehicle.' + r.v.id }), { flush: true });
  });

  /* ================= INSPECTIONS ================= */
  const inspItems = { tires: ['الكاوتش', 'Tires'], brakes: ['الفرامل', 'Brakes'], lights: ['الإضاءة', 'Lights'], ac: ['التكييف', 'AC'], clean: ['النظافة', 'Cleanliness'], extinguisher: ['طفاية الحريق', 'Fire extinguisher'], firstaid: ['شنطة الإسعافات', 'First aid kit'], documents: ['المستندات', 'Documents'] };
  U.route('inspections', () => {
    const db = U.db(); const rows = db.inspections.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    return U.head(tt('فحص ما قبل الرحلة', 'Pre-trip inspections'), tt('فشل بند حرج يوقف الرحلة ويفتح أمر شغل تلقائياً.', 'A failed critical item blocks the trip and opens a work order.'), U.btn(tt('فحص جديد', 'New inspection'), 'new-insp', '', 'plus')) +
      U.kpis([U.kpi(tt('الفحوصات (90 يوم)', 'Inspections (90 days)'), rows.length), U.kpi(tt('ناجحة', 'Passed'), rows.filter(r => r.result === 'passed').length), U.kpi(tt('فاشلة', 'Failed'), `<span class="delta-down">${rows.filter(r => r.result === 'failed').length}</span>`)]) +
      U.card(null, U.table({ id: 'insp', rows, columns: [
        { label: tt('التاريخ', 'Date'), value: i => i.date, render: i => M.date(i.date) }, { label: tt('المركبة', 'Vehicle'), value: i => U.find('vehicles', i.vehicleId).code, render: i => `<a href="#vehicle.${i.vehicleId}">${U.find('vehicles', i.vehicleId).code}</a>` },
        { label: tt('السائق', 'Driver'), value: i => M.L(U.find('drivers', i.driverId).name) }, { label: tt('الرحلة', 'Trip'), value: i => i.tripId ? U.find('trips', i.tripId).number : '', render: i => i.tripId ? `<a href="#trip.${i.tripId}">${M.esc(U.find('trips', i.tripId).number)}</a>` : '—' },
        { label: tt('النتيجة', 'Result'), value: i => i.result, render: i => U.status(i.result) }, { label: tt('بنود فاشلة', 'Failed items'), value: i => i.failedItems.join(','), render: i => i.failedItems.map(x => U.badge(tt(...(inspItems[x] || [x, x])), 'danger')).join(' ') || '—' }, { label: tt('ملاحظات', 'Notes'), value: i => i.notes || '' },
      ] }), { flush: true });
  });
  U.act('new-insp', (el) => {
    const db = U.db();
    const items = M.inspItems;
    U.formModal(tt('فحص ما قبل الرحلة', 'Pre-trip inspection'), [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', value: el && el.dataset && el.dataset.v, options: db.vehicles.filter(v => v.status !== 'sold').map(v => [v.id, `${v.code} · ${M.L(v.plate)}`]), req: true, full: true },
      ...Object.entries(items).map(([k, l]) => ({ f: 'ok_' + k, label: tt(l[0], l[1]), type: 'checkbox', value: true })),
      { f: 'notes', label: tt('ملاحظات', 'Notes'), type: 'textarea', full: true },
    ], 'inspection.create', { intro: `<p class="muted small">${tt('شيل العلامة من البند اللي فيه مشكلة. فشل الكاوتش أو الفرامل أو الإضاءة يوقف المركبة ويفتح أمر شغل تلقائياً.', 'Untick any item that fails. A failed tire, brake or light check stops the vehicle and opens a work order automatically.')}</p>`, map: d => ({ vehicleId: d.vehicleId, notes: d.notes, failed: Object.keys(items).filter(k => !d['ok_' + k]) }), ok: r => r.blocked ? tt('بند حرج فشل: تم إيقاف المركبة وفتح أمر شغل ', 'Critical item failed: vehicle stopped and work order opened ') + r.workOrder.number : tt('تم حفظ الفحص', 'Inspection saved') });
  });

  /* ================= DRIVER AVAILABILITY ================= */
  U.route('availability', () => {
    const cid = U.cid(), db = U.db(); const days = Array.from({ length: 7 }, (_, i) => M.addDays(M.TODAY, i));
    const toMin = s => (+s.slice(0, 2)) * 60 + (+s.slice(3, 5));
    const cell = (d, day) => {
      const av = db.availability.find(a => a.driverId === d.id && a.from <= day && a.to >= day);
      if (av) return U.status(av.kind);
      if (d.licenseExpiry < day) return U.badge(tt('رخصة منتهية', 'License expired'), 'danger');
      const ts = db.trips.filter(t => t.driverId === d.id && t.date === day && t.status !== 'cancelled');
      const h = M.sum(ts, t => ((toMin(t.endTime) - toMin(t.startTime) + 1440) % 1440) / 60);
      return ts.length ? `<span class="num ${h > db.settings.maxDriveHours ? 'neg' : ''}">${ts.length} · ${M.n1(h)}${tt('س', 'h')}</span>` : `<span class="muted small">${tt('متاح', 'Free')}</span>`;
    };
    const leaves = db.availability.filter(a => a.to >= M.TODAY).sort((a, b) => a.from < b.from ? -1 : 1);
    return U.head(tt('إتاحة السائقين وساعات العمل', 'Driver availability & hours'), tt(`الحد الأقصى ${db.settings.maxDriveHours} ساعات قيادة يومياً وراحة ${db.settings.minRestHours} ساعات بين الورديات (قابلة للتعديل من الإعدادات).`, `Max ${db.settings.maxDriveHours} driving hours a day and ${db.settings.minRestHours} hours rest between shifts (configurable in settings).`), U.btn(tt('تسجيل إجازة', 'Record leave'), 'add-leave', '', 'plus')) +
      U.card(null, `<div class="table-wrap"><table class="dt"><thead><tr><th>${tt('السائق', 'Driver')}</th>${days.map(d => `<th class="n">${M.date(d).slice(0, 5)}</th>`).join('')}</tr></thead><tbody>${db.drivers.filter(d => d.status === 'active').map(d => `<tr><td><a href="#driver.${d.id}">${M.esc(M.L(d.name))}</a><div class="cell-sub">${d.vehicleId ? M.esc(U.find('vehicles', d.vehicleId).code) : tt('احتياطي', 'Spare')}</div></td>${days.map(day => `<td class="n">${cell(d, day)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="muted small" style="padding:10px 16px">${tt('الخلية = عدد الرحلات · ساعات القيادة. الأحمر يعني تجاوز الحد.', 'Cell = trips · driving hours. Red means over the limit.')}</div>`, { flush: true }) + '<div style="height:16px"></div>' +
      U.card(tt('الإجازات والراحات القادمة', 'Upcoming leave & rest days'), U.table({ id: 'leaves', rows: leaves, export: false, search: false, emptyTitle: tt('لا توجد إجازات مسجلة', 'No leave recorded'), emptyText: ' ', columns: [{ label: tt('السائق', 'Driver'), value: a => M.L(U.find('drivers', a.driverId).name), render: a => U.dLabel(U.find('drivers', a.driverId)) }, { label: tt('من', 'From'), value: a => a.from, render: a => M.date(a.from) }, { label: tt('إلى', 'To'), value: a => a.to, render: a => M.date(a.to) }, { label: tt('النوع', 'Kind'), value: a => a.kind, render: a => U.status(a.kind) }, { label: tt('ملاحظة', 'Note'), value: a => a.note }, { label: '', sort: false, render: a => U.readOnly() ? '' : `<button class="btn ghost sm" data-act="leave-del" data-id="${a.id}">${tt('حذف', 'Delete')}</button>` }] }), { flush: true });
  });
  U.act('add-leave', el => { const db = U.db(); U.formModal(tt('تسجيل إجازة / راحة', 'Record leave / rest'), [
    { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', value: el && el.dataset.d, options: db.drivers.filter(d => d.status === 'active').map(d => [d.id, M.L(d.name)]), req: true },
    { f: 'kind', label: tt('النوع', 'Kind'), type: 'select', options: [['leave', tt('إجازة', 'Leave')], ['rest', tt('راحة', 'Rest day')], ['sick', tt('مرضي', 'Sick')]] },
    { f: 'from', label: tt('من', 'From'), type: 'date', value: M.TODAY, req: true }, { f: 'to', label: tt('إلى', 'To'), type: 'date', value: M.TODAY, req: true },
    { f: 'note', label: tt('ملاحظة', 'Note'), full: true },
  ], 'availability.create', { ok: tt('تم التسجيل', 'Recorded') }); });
  U.act('leave-del', el => U.run('availability.delete', { id: el.dataset.id }, { ok: tt('تم الحذف', 'Deleted') }));

  /* ================= SUBCONTRACT ================= */
  U.route('subcontract', () => {
    const db = U.db();
    const rev = M.sum(db.subcontracts, s => s.revenue);
    return U.head(tt('مركبات من الباطن', 'Subcontracted vehicles'), tt('لما الأسطول يكون مشغول بالكامل، تتسند الرحلة لمركبة مورد خارجي ويتحسب الهامش.', 'When the fleet is full, a trip goes to a supplier vehicle and the margin is tracked.'), U.btn(tt('إسناد رحلة لمورد', 'Subcontract a trip'), 'sub-new', '', 'plus')) +
      U.kpis([U.kpi(tt('رحلات من الباطن', 'Subcontracted trips'), db.subcontracts.length), U.kpi(tt('الإيراد', 'Revenue'), M.money(rev)), U.kpi(tt('التكلفة', 'Cost'), M.money(M.sum(db.subcontracts, s => s.cost))), U.kpi(tt('الهامش', 'Margin'), rev ? M.pct(M.sum(db.subcontracts, s => s.revenue - s.cost) / rev) : '—')]) +
      U.card(null, U.table({ id: 'sub', rows: db.subcontracts, emptyTitle: tt('لا توجد رحلات من الباطن', 'No subcontracted trips'), emptyText: ' ', columns: [{ label: tt('التاريخ', 'Date'), value: s => s.date, render: s => M.date(s.date) }, { label: tt('المورد', 'Supplier'), value: s => M.L(s.supplier) }, { label: tt('اللوحة', 'Plate'), value: s => s.plate }, { label: tt('السائق', 'Driver'), value: s => M.L(s.driver) }, { label: tt('النوع', 'Type'), value: s => U.vtype(s.vehicleType) }, { label: tt('المسار', 'Route'), value: s => U.routeTxt(s.route.from, s.route.to) }, { label: tt('الحجز', 'Booking'), value: s => s.bookingId ? U.find('bookings', s.bookingId).number : '', render: s => s.bookingId ? `<a href="#booking.${s.bookingId}">${M.esc(U.find('bookings', s.bookingId).number)}</a>` : '—' }, { label: tt('العميل', 'Client'), value: s => M.L(U.find('clients', s.clientId).name) }, { label: tt('الإيراد', 'Revenue'), num: 1, value: s => s.revenue, render: s => M.money(s.revenue) }, { label: tt('التكلفة', 'Cost'), num: 1, value: s => s.cost, render: s => M.money(s.cost) }, { label: tt('الهامش', 'Margin'), num: 1, value: s => s.revenue - s.cost, render: s => U.money(s.revenue - s.cost) }] }), { flush: true });
  });
  U.act('sub-new', el => {
    const db = U.db(); const b = el && el.dataset.b ? U.find('bookings', el.dataset.b) : null;
    U.formModal(tt('إسناد رحلة لمورد', 'Subcontract a trip'), [
      { f: 'bookingId', label: tt('الحجز (اختياري)', 'Booking (optional)'), type: 'select', value: b ? b.id : '', options: [['', '—'], ...db.bookings.filter(x => x.unassigned && x.status !== 'cancelled').map(x => [x.id, `${x.number} · ${M.date(x.date)} ${x.time} · ${U.place(x.pickup)}`])] },
      { f: 'clientId', label: tt('العميل', 'Client'), type: 'select', value: b ? b.clientId : '', options: db.clients.map(c => [c.id, M.L(c.name)]), req: true },
      { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: b ? b.date : M.TODAY, req: true },
      { f: 'supplier', label: tt('المورد', 'Supplier'), req: true }, { f: 'plate', label: tt('لوحة مركبة المورد', 'Supplier vehicle plate'), req: true }, { f: 'driver', label: tt('سائق المورد', 'Supplier driver') },
      { f: 'vehicleType', label: tt('النوع', 'Type'), type: 'select', value: b ? b.vehicleType : M.usableTypes()[0], options: M.usableTypes().map(k => [k, U.vtype(k)]) },
      { f: 'from', label: tt('من', 'From'), type: 'select', value: b ? b.pickup : '', options: Object.keys(M.places).map(k => [k, U.place(k)]) },
      { f: 'to', label: tt('إلى', 'To'), type: 'select', value: b ? b.destination : '', options: Object.keys(M.places).map(k => [k, U.place(k)]) },
      { f: 'revenue', label: tt('الإيراد من العميل', 'Revenue from client'), type: 'number', value: b ? b.price : '', req: true, attrs: 'min="0"' },
      { f: 'cost', label: tt('تكلفة المورد', 'Supplier cost'), type: 'number', req: true, attrs: 'min="0"' },
    ], 'subcontract.create', { ok: tt('تم الإسناد للمورد', 'Subcontracted') });
  });

  /* ================= INCIDENTS ================= */
  U.route('incidents', () => {
    const db = U.db();
    const claimSel = a => `<select class="select sm" data-change="acc-claim" data-id="${a.id}" aria-label="${tt('مطالبة التأمين', 'Insurance claim')}">${[['open', tt('مفتوحة', 'Open')], ['approved', tt('مقبولة', 'Approved')], ['rejected', tt('مرفوضة', 'Rejected')], ['none', tt('لا يوجد', 'None')]].map(o => `<option value="${o[0]}" ${a.claim === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
    return U.head(tt('الحوادث والمخالفات', 'Accidents & traffic fines'), tt('تؤثر على تقييم السائق وتكلفة المركبة.', 'They feed the driver score and the vehicle cost.'), `${U.btn(tt('تسجيل حادث', 'Record accident'), 'acc-new', '', 'plus')} ${U.btn(tt('تسجيل مخالفة', 'Record fine'), 'fine-new', 'secondary', 'plus')}`) +
      U.card(tt('الحوادث', 'Accidents'), U.table({ id: 'acc', rows: db.accidents, export: false, emptyTitle: tt('لا توجد حوادث مسجلة', 'No accidents recorded'), emptyText: ' ', columns: [{ label: tt('رقم', 'No.'), value: a => a.number }, { label: tt('التاريخ', 'Date'), value: a => a.date, render: a => M.date(a.date) }, { label: tt('المكان', 'Location'), value: a => M.L(a.place) }, { label: tt('المركبة', 'Vehicle'), value: a => U.find('vehicles', a.vehicleId).code, render: a => `<a href="#vehicle.${a.vehicleId}">${M.esc(U.find('vehicles', a.vehicleId).code)}</a>` }, { label: tt('السائق', 'Driver'), value: a => M.L(U.find('drivers', a.driverId).name) }, { label: tt('الوصف', 'Description'), value: a => M.L(a.desc) }, { label: tt('محضر', 'Police report'), value: a => a.police }, { label: tt('مطالبة التأمين', 'Insurance claim'), value: a => a.claim, render: a => U.readOnly() ? U.status(a.claim === 'approved' ? 'approved' : a.claim === 'rejected' ? 'rejected' : 'open') : claimSel(a) }, { label: tt('تكلفة الإصلاح', 'Repair cost'), num: 1, value: a => a.repairCost, render: a => M.money(a.repairCost) }, { label: tt('دفع التأمين', 'Insurance paid'), num: 1, value: a => a.insurancePaid, render: a => M.money(a.insurancePaid) }, { label: '', sort: false, render: a => U.readOnly() ? '' : `<button class="btn ghost sm" data-act="acc-edit" data-id="${a.id}">${tt('تعديل', 'Edit')}</button>` }] }), { flush: true }) + '<div style="height:16px"></div>' +
      U.card(tt('المخالفات المرورية', 'Traffic fines'), U.table({ id: 'fines', rows: db.fines.slice().sort((a, b) => a.date < b.date ? 1 : -1), emptyTitle: tt('لا توجد مخالفات', 'No fines recorded'), emptyText: ' ', columns: [{ label: tt('التاريخ', 'Date'), value: f => f.date, render: f => M.date(f.date) }, { label: tt('المخالفة', 'Violation'), value: f => M.L(f.type) }, { label: tt('المركبة', 'Vehicle'), value: f => U.find('vehicles', f.vehicleId).code }, { label: tt('السائق المسؤول', 'Responsible driver'), value: f => M.L(U.find('drivers', f.driverId).name) }, { label: tt('المبلغ', 'Amount'), num: 1, value: f => f.amount, render: f => M.money(f.amount) }, { label: tt('دفعها', 'Paid by'), value: f => f.paidBy, render: f => f.paidBy === 'company' ? tt('الشركة', 'Company') : tt('السائق', 'Driver') }, { label: tt('خصم من السائق', 'Deducted from driver'), value: f => f.deducted, render: f => f.deducted ? U.badge(tt('نعم', 'Yes'), 'warning') : tt('لا', 'No') }] }), { flush: true });
  });
  U.act('acc-claim', el => U.run('accident.update', { id: el.dataset.id, claim: el.value }, { ok: tt('تم التحديث', 'Updated') }));
  U.act('acc-edit', el => { const a = U.find('accidents', el.dataset.id); U.formModal(tt('تحديث الحادث', 'Update accident'), [{ f: 'repairCost', label: tt('تكلفة الإصلاح', 'Repair cost'), type: 'number', value: a.repairCost, attrs: 'min="0"' }, { f: 'insurancePaid', label: tt('دفع التأمين', 'Insurance paid'), type: 'number', value: a.insurancePaid, attrs: 'min="0"' }, { f: 'police', label: tt('رقم المحضر', 'Police report no.'), value: a.police }], 'accident.update', { map: d => Object.assign(d, { id: a.id }) }); });
  U.act('acc-new', () => { const db = U.db(); U.formModal(tt('تسجيل حادث', 'Record accident'), [
    { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', options: db.vehicles.map(v => [v.id, `${v.code} · ${M.L(v.plate)}`]), req: true },
    { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', options: [['', tt('سائق المركبة', 'Vehicle’s driver')], ...db.drivers.map(d => [d.id, M.L(d.name)])] },
    { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true },
    { f: 'place', label: tt('المكان', 'Location'), req: true }, { f: 'description', label: tt('الوصف', 'Description'), type: 'textarea', req: true, full: true },
    { f: 'police', label: tt('رقم المحضر', 'Police report no.') }, { f: 'repairCost', label: tt('تكلفة الإصلاح المتوقعة', 'Expected repair cost'), type: 'number', value: 0, attrs: 'min="0"' },
  ], 'accident.create', { ok: r => tt('تم التسجيل ', 'Recorded ') + r.number }); });
  U.act('fine-new', () => { const db = U.db(); U.formModal(tt('تسجيل مخالفة', 'Record fine'), [
    { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', options: db.vehicles.map(v => [v.id, `${v.code} · ${M.L(v.plate)}`]), req: true },
    { f: 'driverId', label: tt('السائق المسؤول', 'Responsible driver'), type: 'select', options: [['', tt('سائق المركبة', 'Vehicle’s driver')], ...db.drivers.map(d => [d.id, M.L(d.name)])] },
    { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true }, { f: 'type', label: tt('المخالفة', 'Violation'), req: true },
    { f: 'amount', label: tt('المبلغ', 'Amount'), type: 'number', req: true, attrs: 'min="0"' },
    { f: 'paidBy', label: tt('تتحمّلها', 'Borne by'), type: 'select', options: [['company', tt('الشركة', 'Company')], ['driver', tt('السائق', 'Driver')]] },
    { f: 'deducted', label: tt('تم الخصم من السائق', 'Deducted from the driver'), type: 'checkbox' },
  ], 'fine.create', { ok: tt('تم التسجيل', 'Recorded') }); });

  /* ================= HANDOVER ================= */
  U.route('handover', () => {
    const db = U.db(); const y = M.addDays(M.TODAY, -1);
    const ty = db.trips.filter(t => t.date === y);
    const late = ty.filter(t => t.onTime === false);
    return U.head(tt('تسليم الشيفت والتقرير اليومي', 'Shift handover & daily report'), M.date(y)) +
      `<div class="cols-2">` + U.card(tt('تقرير نهاية اليوم', 'End-of-day report'), U.dl([[tt('رحلات منفذة', 'Trips done'), ty.filter(t => t.status === 'completed').length], [tt('رحلات ملغاة', 'Cancelled'), ty.filter(t => t.status === 'cancelled').length], [tt('رحلات لم تُقفل', 'Not closed yet'), ty.filter(t => t.status === 'scheduled' || t.status === 'running').map(t => `<a href="#trip.${t.id}">${t.number}</a>`).join('، ') || '0'], [tt('تأخيرات', 'Delays'), late.length ? late.map(t => `<a href="#trip.${t.id}">${t.number}</a> (${t.delayMin} ${tt('د', 'min')})`).join('، ') : '0'], [tt('حوادث', 'Incidents'), db.accidents.filter(a => a.date === y).length], [tt('مفتوح لبكرة', 'Open for tomorrow'), `${db.bookings.filter(b => b.unassigned).length} ${tt('حجز بدون مركبة', 'unassigned bookings')} · ${db.workOrders.filter(w => ['open', 'waiting_parts', 'in_progress'].includes(w.status)).length} ${tt('أمر شغل مفتوح', 'open work orders')}`]])) +
      U.card(tt('ملاحظات بين الورديات', 'Notes between shifts'), (db.handovers.length ? db.handovers.map(h => `<div class="list-row"><div class="grow"><div class="t">${M.date(h.date)} · ${({ morning: tt('الوردية الصباحية', 'Morning shift'), evening: tt('الوردية المسائية', 'Evening shift'), night: tt('الوردية الليلية', 'Night shift') })[h.shift]} · ${M.esc(M.L(h.by))}</div><div class="s" style="white-space:pre-wrap">${M.esc(M.L(h.notes))}</div></div></div>`).join('') : `<p class="muted small">${tt('لا توجد ملاحظات بعد.', 'No notes yet.')}</p>`) + `<div class="field" style="margin-top:12px"><label for="ho-shift">${tt('الوردية', 'Shift')}</label><select id="ho-shift"><option value="morning">${tt('الصباحية', 'Morning')}</option><option value="evening">${tt('المسائية', 'Evening')}</option><option value="night">${tt('الليلية', 'Night')}</option></select></div><div class="field" style="margin-top:8px"><label for="ho-note">${tt('ملاحظة جديدة للوردية القادمة', 'New note for the next shift')}</label><textarea id="ho-note" maxlength="2000"></textarea></div><button class="btn" style="margin-top:8px" data-act="save-ho">${tt('حفظ الملاحظة', 'Save note')}</button>`) + `</div>`;
  });
  U.act('save-ho', () => { const n = U.val('ho-note').trim(); if (!n) { U.toast(tt('اكتب الملاحظة الأول', 'Write the note first')); return; } U.run('handover.create', { notes: n, shift: U.val('ho-shift') }, { ok: tt('تم حفظ الملاحظة', 'Note saved') }); });

  /* ================= DOCUMENTS ================= */
  U.route('documents', () => {
    const db = U.db();
    const kinds = { license: tt('رخصة', 'License'), insurance: tt('تأمين', 'Insurance'), contract: tt('عقد', 'Contract'), inspection: tt('فحص فني', 'Technical inspection'), receipt: tt('إيصال', 'Receipt'), invoice: tt('فاتورة', 'Invoice'), other: tt('أخرى', 'Other') };
    const ownerOf = d => d.owner === 'vehicle' ? U.find('vehicles', d.ownerId) : d.owner === 'driver' ? U.find('drivers', d.ownerId) : null;
    const rows = db.documents.map(d => ({ d, owner: ownerOf(d), days: d.expiry ? M.diffDays(d.expiry, M.TODAY) : null })).sort((a, b) => (a.days == null ? 1e9 : a.days) - (b.days == null ? 1e9 : b.days));
    return U.head(tt('خزنة المستندات', 'Document vault'), tt('رخص وتأمين المركبات ورخص السائقين والمستندات المرفوعة؛ تواريخ الانتهاء بتغذي التنبيهات.', 'Vehicle licenses & insurance, driver licenses and uploaded files; expiry dates feed the alerts.'), U.btn(tt('رفع مستند', 'Upload document'), 'doc-upload', '', 'upload')) +
      U.card(null, U.table({ id: 'docs', rows, columns: [
        { label: tt('المستند', 'Document'), value: r => r.d.kind, render: r => (kinds[r.d.kind] || r.d.kind) + ' · ' + (r.d.owner === 'vehicle' ? tt('مركبة', 'vehicle') : r.d.owner === 'driver' ? tt('سائق', 'driver') : tt('الشركة', 'company')) + (r.d.number ? ` <span class="mono small">${M.esc(r.d.number)}</span>` : '') },
        { label: tt('يخص', 'Belongs to'), value: r => !r.owner ? '' : r.d.owner === 'vehicle' ? r.owner.code : M.L(r.owner.name), render: r => !r.owner ? M.esc(M.L(U.company().name)) : r.d.owner === 'vehicle' ? `<a href="#vehicle.${r.owner.id}">${M.esc(r.owner.code)}</a>` : `<a href="#driver.${r.owner.id}">${M.esc(M.L(r.owner.name))}</a>` },
        { label: tt('تاريخ الانتهاء', 'Expiry'), value: r => r.d.expiry || '', render: r => M.date(r.d.expiry) },
        { label: tt('المتبقي', 'Remaining'), num: 1, value: r => r.days == null ? 1e9 : r.days, render: r => r.days == null ? '—' : r.days < 0 ? U.badge(tt(`منتهي منذ ${-r.days} يوم`, `Expired ${-r.days}d ago`), 'danger') : r.days <= db.settings.expiryWarnDays ? U.badge(tt(`${r.days} يوم`, `${r.days} days`), 'warning') : `<span class="num">${r.days}</span>` },
        { label: tt('الملف', 'File'), sort: false, render: r => r.d.uploaded && r.d.fileName ? `<a href="/api/documents/${r.d.id}/file" target="_blank" rel="noopener">${M.esc(r.d.fileName)}</a> <span class="muted small">${M.n0((r.d.size || 0) / 1024)} KB</span>` : r.d.uploaded ? '—' : `<span class="muted small">${tt('من بيانات المركبة/السائق', 'From the vehicle/driver record')}</span>` },
        { label: '', sort: false, render: r => r.d.uploaded && ['super_admin', 'company_admin', 'fleet_manager'].includes(M.state.role) ? `<button class="btn ghost sm" data-act="doc-del" data-id="${r.d.id}">${tt('حذف', 'Delete')}</button>` : '' },
      ] }), { flush: true });
  });
  U.act('doc-upload', el => {
    const db = U.db(); const owner = (el && el.dataset.owner) || 'vehicle';
    const ownerOpts = o => o === 'vehicle' ? db.vehicles.map(v => [v.id, `${v.code} · ${M.L(v.plate)}`]) : o === 'driver' ? db.drivers.map(d => [d.id, M.L(d.name)]) : [['', M.L(U.company().name)]];
    U.formModal(tt('رفع مستند', 'Upload document'), [
      { f: 'owner', label: tt('يخص', 'Belongs to'), type: 'select', value: owner, options: [['vehicle', tt('مركبة', 'Vehicle')], ['driver', tt('سائق', 'Driver')], ['company', tt('الشركة', 'Company')]] },
      { f: 'ownerId', label: tt('المركبة / السائق', 'Vehicle / driver'), type: 'select', value: el && el.dataset.id, options: ownerOpts(owner) },
      { f: 'kind', label: tt('نوع المستند', 'Document type'), type: 'select', options: [['license', tt('رخصة', 'License')], ['insurance', tt('تأمين', 'Insurance')], ['contract', tt('عقد', 'Contract')], ['inspection', tt('فحص فني', 'Technical inspection')], ['receipt', tt('إيصال', 'Receipt')], ['invoice', tt('فاتورة', 'Invoice')], ['other', tt('أخرى', 'Other')]] },
      { f: 'number', label: tt('رقم المستند', 'Document number'), attrs: 'dir="ltr"' },
      { f: 'expiry', label: tt('تاريخ الانتهاء', 'Expiry date'), type: 'date' },
      { f: 'updateRecord', label: tt('حدّث تاريخ الانتهاء في ملف المركبة/السائق', 'Update the expiry on the vehicle/driver record'), type: 'checkbox', value: true, full: true },
      { f: 'file', label: tt('الملف (PDF أو صورة، حتى 10 ميجا)', 'File (PDF or image, up to 10 MB)'), type: 'html', full: true, html: '<input type="file" id="doc-file" accept="application/pdf,image/png,image/jpeg,image/webp">' },
    ], async payload => {
      const inp = document.getElementById('doc-file');
      if (inp.files[0] && inp.files[0].size > 10 * 1024 * 1024) { U.toast(tt('حجم الملف أكبر من 10 ميجا', 'The file is larger than 10 MB'), 'error'); return; }
      const f = await U.readFile(inp, false);
      if (f) payload.file = { name: f.name, mime: f.type, data: f.data };
      if (payload.owner === 'company') delete payload.ownerId;
      await U.run('document.upload', payload, { ok: tt('تم رفع المستند', 'Document uploaded') });
    }, { mount: () => { const o = document.querySelector('#mf [data-f="owner"]'), id = document.querySelector('#mf [data-f="ownerId"]'); o.addEventListener('change', () => { id.innerHTML = ownerOpts(o.value).map(x => `<option value="${M.esc(x[0])}">${M.esc(x[1])}</option>`).join(''); }); } });
  });
  U.act('doc-del', el => U.confirm(tt('حذف المستند', 'Delete document'), tt('سيتم حذف المستند والملف نهائياً.', 'The document and its file will be deleted permanently.'), () => U.run('document.delete', { id: el.dataset.id }, { ok: tt('تم الحذف', 'Deleted') }), { danger: true }));

  /* ================= DRIVER APP VIEW ================= */
  let appDriver = null;
  U.act('app-driver', el => { appDriver = el.value; U.render(); });
  U.route('driverapp', () => {
    const db = U.db(); const d = db.drivers.find(x => x.id === appDriver) || db.drivers.find(x => db.trips.some(t => t.driverId === x.id && t.date === M.TODAY)) || db.drivers[0];
    if (!d) return U.head(tt('شاشة السائق', 'Driver app view'), '') + U.empty('user', tt('لا يوجد سائقين بعد', 'No drivers yet'), `<a class="btn" href="#drivers">${tt('إضافة سائق', 'Add driver')}</a>`);
    const ts = db.trips.filter(t => t.driverId === d.id && (t.date === M.TODAY || t.date === M.addDays(M.TODAY, 1)) && t.status !== 'cancelled');
    return U.head(tt('شاشة السائق', 'Driver app view'), tt('شاشة موبايل لمدير الحركة أو السائق: رحلات اليوم وبكرة، بدء وإنهاء الرحلة بالعداد، الفحص، المصاريف، والإبلاغ عن مشكلة. كل إجراء يُسجّل فعلياً.', 'Mobile screen for the dispatcher or driver: today’s and tomorrow’s trips, start/end with odometer, inspection, expenses and issue reports. Every action is saved.'), `<select class="select" data-change="app-driver" aria-label="${tt('السائق', 'Driver')}">${db.drivers.map(x => `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${M.L(x.name)}</option>`).join('')}</select>`) +
      `<div style="max-width:400px;margin-inline:auto;border:8px solid #061D38;border-radius:28px;overflow:hidden;background:#F4F6F9"><div style="background:#061D38;color:#fff;padding:14px 16px">${U.logo('#fff').replace('<svg', '<svg style="height:20px"')}<div style="margin-top:8px;font-weight:600">${tt('أهلاً', 'Hi')} ${M.L(d.name).split(' ')[0]}</div><div class="small" style="opacity:.7">${d.vehicleId ? U.find('vehicles', d.vehicleId).code + ' · ' + M.L(U.find('vehicles', d.vehicleId).plate) : ''}</div></div><div style="padding:12px;display:grid;gap:10px">${ts.length ? ts.map(t => `<div class="card" style="padding:12px"><div style="display:flex;justify-content:space-between;gap:8px"><b class="num">${t.date === M.TODAY ? tt('اليوم', 'Today') : tt('بكرة', 'Tomorrow')} ${t.startTime}</b>${U.status(t.status)}</div><div style="margin:6px 0">${U.routeTxt(t.from, t.to)}</div><div class="small muted">${M.L(U.find('clients', t.clientId).name)} · ${M.esc(M.L(M.typeName(t.type)))} · ${t.activity === 'cargo' ? M.loadText(U.find('bookings', t.bookingId), 'cargo') : M.loadText(t)}${t.activity === 'tourism' && t.flight ? ' · ' + t.flight : ''}</div><div class="actions" style="margin-top:10px">${t.status === 'scheduled' ? `<button class="btn sm" data-act="app-start" data-id="${t.id}">${tt('بدء الرحلة', 'Start trip')}</button><button class="btn secondary sm" data-act="go-insp" data-v="${t.vehicleId}">${tt('الفحص', 'Inspection')}</button>` : t.status === 'running' ? `<button class="btn sm" data-act="app-end" data-id="${t.id}">${tt('إنهاء الرحلة', 'End trip')}</button>` : ''}${t.status !== 'completed' ? `<button class="btn ghost sm" data-act="app-exp" data-id="${t.id}">${tt('مصروف', 'Expense')}</button>` : ''}<button class="btn ghost sm" data-act="app-issue" data-v="${t.vehicleId}">${tt('بلّغ عن مشكلة', 'Report issue')}</button></div></div>`).join('') : U.empty('calendar', tt('لا توجد رحلات اليوم أو بكرة', 'No trips today or tomorrow'))}</div></div>`;
  });
  U.act('go-insp', el => { const v = el.dataset.v; location.hash = 'inspections'; setTimeout(() => U.acts['new-insp']({ dataset: { v } }), 80); });
  U.act('app-start', el => { const t = U.find('trips', el.dataset.id); const v = U.find('vehicles', t.vehicleId); U.formModal(tt('بدء الرحلة', 'Start trip'), [{ f: 'odometer', label: tt('قراءة العداد', 'Odometer reading'), type: 'number', value: v.odometer, req: true, attrs: 'min="0"' }], 'trip.start', { submit: tt('بدء', 'Start'), map: d => Object.assign(d, { id: t.id }), ok: tt('بدأت الرحلة', 'Trip started') }); });
  U.act('app-end', el => {
    const t = U.find('trips', el.dataset.id); const v = U.find('vehicles', t.vehicleId);
    const bk = t.bookingId ? U.find('bookings', t.bookingId) : null;
    const needCode = t.activity === 'cargo' && bk && bk.hasCode && !bk.deliveredAt;
    const admin = ['super_admin', 'company_admin'].includes(M.state.role);
    U.formModal(tt('إنهاء الرحلة', 'End trip'), [
      needCode ? { f: 'deliveryCode', label: tt('كود التسليم (من المستلم)', 'Delivery code (from the consignee)'), attrs: 'inputmode="numeric" maxlength="6" dir="ltr" autocomplete="off"', help: tt('الرحلة مش هتقفل غير بالكود الصح.', 'The trip closes only with the right code.') } : null,
      needCode && admin ? { f: 'overrideReason', label: tt('أو: سبب القفل بدون كود (مدير النظام بس)', 'Or: reason to close without the code (admin only)'), full: true } : null,
      t.startKm == null ? { f: 'startKm', label: tt('عداد البداية', 'Start odometer'), type: 'number', value: v.odometer, req: true, attrs: 'min="0"' } : null,
      { f: 'endKm', label: tt('عداد النهاية', 'End odometer'), type: 'number', value: Math.round((t.startKm != null ? t.startKm : v.odometer) + (t.plannedKm || 0)), req: true, attrs: 'min="0"' },
      { f: 'tolls', label: tt('كارتة', 'Tolls'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'tollsPaidBy', label: tt('الكارتة اتدفعت', 'Tolls paid by'), type: 'select', options: [['cash', tt('نقدي', 'Cash')], ['tag', tt('كارت الكارتة (يخصم من الرصيد)', 'Toll tag (deducted from balance)')]] },
      { f: 'parking', label: tt('جراج وانتظار', 'Parking'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'lodging', label: tt('إقامة السائق', 'Driver lodging'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'other', label: tt('مصروفات أخرى', 'Other expenses'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'delayMin', label: tt('التأخير عن الموعد (دقائق)', 'Late pickup (minutes)'), type: 'number', value: 0, attrs: 'min="0"' },
    ], 'trip.complete', { submit: tt('إنهاء', 'End'), map: d => ({ id: t.id, deliveryCode: d.deliveryCode || undefined, overrideReason: d.overrideReason || undefined, startKm: d.startKm, endKm: d.endKm, tollsPaidBy: d.tollsPaidBy, delayMin: d.delayMin, expenses: { tolls: d.tolls, parking: d.parking, lodging: d.lodging, other: d.other } }), ok: r => tt(`تم إنهاء الرحلة · ${M.n0(r.km)} كم`, `Trip completed · ${M.n0(r.km)} km`) });
  });
  U.act('app-exp', el => U.formModal(tt('تسجيل مصروف', 'Record expense'), [
    { f: 'kind', label: tt('النوع', 'Type'), type: 'select', options: [['tolls', tt('كارتة', 'Toll')], ['parking', tt('جراج', 'Parking')], ['lodging', tt('إقامة', 'Lodging')], ['other', tt('أخرى', 'Other')]] },
    { f: 'amount', label: tt('المبلغ', 'Amount'), type: 'number', req: true, attrs: 'min="0.01" step="0.01"' },
    { f: 'note', label: tt('ملاحظة', 'Note'), full: true },
  ], 'trip.addExpense', { map: d => Object.assign(d, { id: el.dataset.id }), ok: tt('تم تسجيل المصروف', 'Expense recorded') }));
  U.act('app-issue', el => U.formModal(tt('بلّغ عن مشكلة', 'Report an issue'), [
    { f: 'problem', label: tt('وصف المشكلة', 'What’s wrong?'), type: 'textarea', req: true, full: true },
    { f: 'urgent', label: tt('عاجل — أوقف المركبة عن التشغيل', 'Urgent — take the vehicle out of service'), type: 'checkbox', full: true },
  ], 'vehicle.reportIssue', { submit: tt('إرسال للصيانة', 'Send to maintenance'), map: d => Object.assign(d, { vehicleId: el.dataset.v }), ok: r => tt('تم فتح أمر شغل ', 'Work order opened ') + r.number }));

  /* ---------- program builder ---------- */
  U.act('prog-new', () => {
    const db = U.db(); const pts = Object.keys(M.places);
    if (!db.clients.length) { U.toast(tt('أضف عميل أولاً', 'Add a client first'), 'error'); return; }
    const dayRow = (i, d = {}) => `<div class="prog-day" data-i="${i}"><b class="num">${tt('اليوم', 'Day')} ${i + 1}</b><select data-pd="from" aria-label="${tt('من', 'From')}">${pts.map(k => `<option value="${k}" ${d.from === k ? 'selected' : ''}>${M.esc(U.place(k))}</option>`).join('')}</select><span>${U.arrow()}</span><select data-pd="to" aria-label="${tt('إلى', 'To')}">${pts.map(k => `<option value="${k}" ${d.to === k ? 'selected' : ''}>${M.esc(U.place(k))}</option>`).join('')}</select><input type="time" data-pd="time" value="${d.time || (i ? '08:00' : '10:30')}" aria-label="${tt('الميعاد', 'Time')}"><input type="number" data-pd="km" min="0" placeholder="${tt('كم (تلقائي)', 'km (auto)')}" aria-label="km"></div>`;
    U.modal(tt('برنامج سياحي جديد', 'New tour program'), U.formHtml([
      { f: 'name', label: tt('اسم البرنامج', 'Program name'), req: true, full: true },
      { f: 'clientId', label: tt('العميل', 'Client'), type: 'select', options: db.clients.filter(c => c.status === 'active').map(c => [c.id, M.L(c.name)]), req: true },
      { f: 'start', label: tt('تاريخ البداية', 'Start date'), type: 'date', value: M.addDays(M.TODAY, 7), req: true },
      { f: 'pax', label: tt('عدد الركاب', 'Passengers'), type: 'number', value: 20, req: true, attrs: 'min="1"' },
      { f: 'price', label: tt('سعر النقل المتفق', 'Agreed transport price'), type: 'number', req: true, attrs: 'min="0"' },
      { f: 'vehicleId', label: tt('المركبة (يمكن لاحقاً)', 'Vehicle (can be set later)'), type: 'select', options: [['', '—'], ...db.vehicles.filter(v => v.status !== 'sold').map(v => [v.id, `${v.code} · ${U.vtype(v.type)} · ${v.seats}`])] },
      { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', options: [['', tt('سائق المركبة', 'Vehicle’s driver')], ...db.drivers.filter(d => d.status === 'active').map(d => [d.id, M.L(d.name)])] },
      { f: 'guide', label: tt('المرشد السياحي', 'Tour guide') }, { f: 'guidePhone', label: tt('هاتف المرشد', 'Guide phone'), attrs: 'dir="ltr"' },
      { f: 'status', label: tt('الحالة', 'Status'), type: 'select', options: [['confirmed', U.statusText('confirmed')], ['tentative', U.statusText('tentative')]] },
    ], 'pg') + `<h3 style="font-size:15px;margin:16px 0 8px">${tt('خط سير البرنامج يوم بيوم', 'Day-by-day itinerary')}</h3><div id="pg-days">${dayRow(0)}${dayRow(1)}</div><div class="actions" style="margin-top:8px"><button class="btn ghost sm" type="button" id="pg-add">${U.icon('plus')}${tt('إضافة يوم', 'Add day')}</button><button class="btn ghost sm" type="button" id="pg-rm">${tt('حذف آخر يوم', 'Remove last day')}</button></div>`, `<button class="btn secondary" data-act="close-overlay">${tt('إلغاء', 'Cancel')}</button><button class="btn" data-act="prog-save">${tt('حفظ البرنامج', 'Save program')}</button>`);
    const box = document.getElementById('pg-days');
    document.getElementById('pg-add').addEventListener('click', () => { const n = box.children.length; if (n >= 30) return; const last = box.lastElementChild; box.insertAdjacentHTML('beforeend', dayRow(n, { from: last.querySelector('[data-pd="to"]').value })); });
    document.getElementById('pg-rm').addEventListener('click', () => { if (box.children.length > 1) box.lastElementChild.remove(); });
  });
  U.act('prog-save', () => {
    const d = U.readForm('pg');
    const missing = ['name', 'clientId', 'start', 'pax', 'price'].filter(k => d[k] == null || d[k] === '');
    if (missing.length) { U.showError({ field: missing[0], msg: { ar: 'هذا الحقل مطلوب', en: 'This field is required' } }); return; }
    d.days = [...document.querySelectorAll('#pg-days .prog-day')].map(r => { const g = k => r.querySelector(`[data-pd="${k}"]`).value; const km = g('km'); return { from: g('from'), to: g('to'), time: g('time') || '08:00', km: km === '' ? undefined : Number(km) }; });
    U.run('program.create', d, { ok: r => tt('تم حفظ البرنامج ', 'Program saved ') + r.number, after: r => { location.hash = 'program.' + r.id; U.full(); } });
  });
  U.act('prog-schedule', el => {
    const db = U.db(); const p = U.find('programs', el.dataset.id);
    U.formModal(tt('تخصيص المركبة وجدولة الرحلات', 'Assign vehicle & schedule trips'), [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', value: p.vehicleId || '', options: db.vehicles.filter(v => v.status !== 'sold' && v.seats >= p.pax).map(v => [v.id, `${v.code} · ${U.vtype(v.type)} · ${v.seats}`]), req: true },
      { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', value: p.driverId || '', options: [['', tt('سائق المركبة', 'Vehicle’s driver')], ...db.drivers.filter(d => d.status === 'active').map(d => [d.id, M.L(d.name)])] },
    ], 'program.schedule', { intro: `<p class="muted small">${tt('يتم إنشاء رحلة لكل يوم بعد التحقق من إتاحة المركبة والسائق في كل الأيام. لو يوم واحد متعارض لا يتم حفظ أي شيء.', 'One trip is created per day after checking the vehicle and driver are free on every day. If any day clashes, nothing is saved.')}</p>`, map: x => { const v = U.find('vehicles', x.vehicleId); return { id: p.id, vehicleId: x.vehicleId, driverId: x.driverId || v.driverId || undefined }; }, ok: tt('تمت جدولة رحلات البرنامج', 'Program trips scheduled') });
  });
  U.act('prog-cancel', el => U.confirm(tt('إلغاء البرنامج', 'Cancel program'), tt('سيتم إلغاء البرنامج والحجز وكل الرحلات المجدولة.', 'The program, its booking and all scheduled trips will be cancelled.'), r => U.run('program.cancel', { id: el.dataset.id, reason: r }, { ok: tt('تم إلغاء البرنامج', 'Program cancelled') }), { reason: true, danger: true }));

  /* ================= OPERATING CONTRACTS =================
     Vehicles rented out under terms priced in advance: with/without driver, per trip or per period,
     exclusive in its hours or allowing extra work. Finished trips are confirmed by whoever ran them
     (outside system or Sabeel module over the Open API, or here); MOTUS prices and bills them. */
  const K_CH = { external: ['نظام خارجي', 'Outside system'], sabeel: ['موديول سبيل', 'Sabeel module'], motus: ['موتس', 'MOTUS'] };
  const K_CYCLE = { week: ['أسبوع', 'Week'], '2weeks': ['أسبوعين', '2 weeks'], month: ['شهر', 'Month'] };
  const K_DAYS = [['الأحد', 'Sun'], ['الإثنين', 'Mon'], ['الثلاثاء', 'Tue'], ['الأربعاء', 'Wed'], ['الخميس', 'Thu'], ['الجمعة', 'Fri'], ['السبت', 'Sat']];
  const kDay = (d, n) => M.addDays(d, n);
  const kCycleEnd = (cycle, from) => {
    if (cycle === 'week') return kDay(from, 6);
    if (cycle === '2weeks') return kDay(from, 13);
    const d = M.d(from), day = d.getUTCDate(); const nx = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const last = new Date(Date.UTC(nx.getUTCFullYear(), nx.getUTCMonth() + 1, 0)).getUTCDate(); nx.setUTCDate(Math.min(day, last));
    return kDay(M.iso(nx), -1);
  };
  const kNext = k => { const from = k.billedTo ? kDay(k.billedTo, 1) : k.startDate; let to = kCycleEnd(k.cycle, from); if (k.endDate && to > k.endDate) to = k.endDate; return { from, to, due: to < M.TODAY, done: !!(k.endDate && from > k.endDate) }; };
  const kUsed = (k, vid, n) => U.db().trips.filter(t => t.contractId === k.id && t.vehicleId === vid && t.status === 'completed' && t.date >= n.from && t.date <= n.to).reduce((x, t) => x + (t.km || 0), 0);
  const kVehicles = (k, all) => U.db().contractVehicles.filter(x => x.contractId === k.id && (all || !x.to || x.to >= M.TODAY));
  const kStatus = k => k.status === 'active' ? U.badge(tt('ساري', 'Active'), 'success') : k.status === 'ended' ? U.badge(tt('منتهي', 'Ended'), 'muted') : U.badge(tt('ملغي', 'Cancelled'), 'muted');
  const kPrice = k => `${M.money(k.rate)} ${k.pricing === 'per_trip' ? tt('للرحلة', 'per trip') : tt('لكل مركبة / ', 'per vehicle / ') + tt(...K_CYCLE[k.cycle])}`;
  const kHours = k => k.exclusive ? `${tt('حصري', 'Exclusive')} <span class="num">${k.workStart}–${k.workEnd}</span>` : tt('يسمح بشغل إضافي', 'Allows extra work');
  const kKm = k => k.kmAllowance == null ? tt('مفتوحة (بدون حد)', 'Open (no limit)') : `${M.n0(k.kmAllowance)} ${tt('كم', 'km')} ${k.kmBasis === 'trip' ? tt('للرحلة', 'per trip') : tt('لكل مركبة في الدورة', 'per vehicle per cycle')} · ${M.money(k.extraKmRate)} ${tt('للكيلو الزيادة', 'per extra km')}`;
  const kCan = () => ['super_admin', 'company_admin', 'fleet_manager', 'operations', 'accountant'].includes(M.state.role);

  U.route('contracts', () => {
    const db = U.db(); const rows = db.contracts;
    const active = rows.filter(k => k.status === 'active');
    const onContract = new Set(db.contractVehicles.filter(x => active.some(k => k.id === x.contractId) && (!x.to || x.to >= M.TODAY)).map(x => x.vehicleId));
    const since = kDay(M.TODAY, -30); const kt = db.trips.filter(t => t.contractId && t.date >= since && t.status === 'completed');
    const due = active.filter(k => kNext(k).due);
    return U.head(tt('عقود التشغيل', 'Operating contracts'), tt('مركبات الشركة متأجرة بشروط متسعرة مقدماً. الرحلات بتتأكد من النظام اللي شغّلها، وموتس بيسعّرها ويفوترها. الصيانة والوقود والزيوت على الشركة.', 'Company vehicles rented out on terms priced in advance. Trips are confirmed by the system that ran them; MOTUS prices and bills them. Maintenance, fuel and oils stay with the company.'), kCan() ? U.btn(tt('عقد جديد', 'New contract'), 'k-new', '', 'plus') : '') +
      U.kpis([U.kpi(tt('عقود سارية', 'Active contracts'), active.length), U.kpi(tt('مركبات على عقود', 'Vehicles on contracts'), onContract.size, `${tt('من', 'of')} ${db.vehicles.length}`), U.kpi(tt('رحلات مؤكدة (30 يوم)', 'Confirmed trips (30 days)'), kt.length, `${kt.filter(t => t.source !== 'motus').length} ${tt('من أنظمة تانية', 'from other systems')}`), U.kpi(tt('دورات مستحقة الفوترة', 'Cycles due for billing'), due.length)]) +
      U.card(null, U.table({ id: 'contracts', rows, emptyTitle: tt('مفيش عقود تشغيل', 'No operating contracts yet'), emptyText: tt('اعمل عقد لما تأجر مركبات لعميل أو لنظام تاني يشغّلها.', 'Create a contract when you rent vehicles out to a client or another system.'), columns: [
        { label: tt('العقد', 'Contract'), value: k => k.number, render: k => `<a class="cell-main" href="#contract.${k.id}">${k.number}</a><div class="cell-sub">${M.esc(M.L(k.name))}</div>` },
        { label: tt('العميل', 'Client'), value: k => M.L(U.find('clients', k.clientId).name) },
        { label: tt('التشغيل من', 'Run from'), value: k => k.channel, render: k => `${tt(...K_CH[k.channel])}${k.externalSystem ? `<div class="cell-sub">${M.esc(k.externalSystem)}</div>` : ''}` },
        { label: tt('التسعير', 'Pricing'), value: k => k.rate, render: k => kPrice(k) },
        { label: tt('السائق', 'Driver'), value: k => k.withDriver, render: k => k.withDriver ? tt('بسائق', 'With driver') : tt('بدون سائق', 'Without driver') },
        { label: tt('الكيلومترات', 'Kilometres'), value: k => k.kmAllowance == null ? -1 : k.kmAllowance, render: k => k.kmAllowance == null ? tt('مفتوحة', 'Open') : `${M.n0(k.kmAllowance)} ${tt('كم', 'km')} / ${k.kmBasis === 'trip' ? tt('رحلة', 'trip') : tt('دورة', 'cycle')}` },
        { label: tt('الحصرية', 'Exclusivity'), value: k => k.exclusive, render: k => kHours(k) },
        { label: tt('مركبات', 'Vehicles'), num: 1, value: k => kVehicles(k).length },
        { label: tt('الفوترة', 'Billing'), value: k => kNext(k).from, render: k => { const n = kNext(k); return k.status !== 'active' && n.done ? tt('مكتملة', 'Complete') : `${tt('الدورة', 'Cycle')} <span class="num">${M.date(n.from)} → ${M.date(n.to)}</span>${n.due ? ' ' + U.badge(tt('مستحقة', 'Due'), 'warning') : ''}`; } },
        { label: tt('الحالة', 'Status'), value: k => k.status, render: k => kStatus(k) },
      ] }), { flush: true });
  });

  U.route('contract', id => {
    const db = U.db(); const k = db.contracts.find(x => x.id === id);
    if (!k) return U.empty('clipboard', tt('العقد غير موجود في هذه الشركة', 'Contract not found in this company'));
    const cl = U.find('clients', k.clientId), n = kNext(k), cvs = kVehicles(k, true);
    const trips = db.trips.filter(t => t.contractId === k.id).sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? 1 : -1));
    const can = kCan() && k.status === 'active';
    const acts = can ? `${U.btn(tt('تأكيد رحلة تمت', 'Confirm a finished trip'), 'k-trip', '', 'check', `data-id="${k.id}"`)} ${['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role) ? U.btn(tt('فوترة الدورة', 'Bill the cycle'), 'k-bill', 'secondary', 'receipt', `data-id="${k.id}"`) : ''} ${U.btn(tt('إضافة مركبة', 'Add vehicle'), 'k-addv', 'secondary', 'plus', `data-id="${k.id}"`)} ${U.btn(tt('إنهاء العقد', 'End contract'), 'k-end', 'ghost', '', `data-id="${k.id}"`)}` : kStatus(k);
    const invs = db.invoices.filter(i => i.lines && i.lines.some(l => l.contractId === k.id || trips.some(t => t.id === l.tripId)));
    const rev = trips.filter(t => t.status === 'completed').reduce((x, t) => x + (t.revenue || 0), 0);
    // the contract vehicles' other work during the contract: priced on its own, outside the contract
    const extra = db.trips.filter(t => !t.contractId && t.status !== 'cancelled' && cvs.some(x => x.vehicleId === t.vehicleId && t.date >= x.from && (!x.to || t.date <= x.to))).sort((a, b) => (a.date < b.date ? 1 : -1));
    return U.head(`${k.number} · ${M.esc(M.L(k.name))}`, `${M.esc(M.L(cl.name))} · ${kPrice(k)}`, acts, [[tt('عقود التشغيل', 'Operating contracts'), 'contracts'], [k.number]]) +
      U.kpis([U.kpi(tt('المركبات الحالية', 'Vehicles now'), kVehicles(k).length), U.kpi(tt('رحلات مؤكدة', 'Confirmed trips'), trips.length, tt('آخر 90 يوم في الشاشة', 'last 90 days on screen')), U.kpi(k.pricing === 'per_trip' ? tt('إيراد الرحلات', 'Trip revenue') : tt('سعر الدورة لكل مركبة', 'Cycle price per vehicle'), M.money(k.pricing === 'per_trip' ? rev : k.rate)), U.kpi(tt('الدورة الحالية', 'Current cycle'), `<span class="num" style="font-size:16px">${M.date(n.from)} → ${M.date(n.to)}</span>`, n.due ? tt('خلصت ومستحقة الفوترة', 'Ended, due for billing') : tt('لسه شغالة', 'Still running'))]) +
      `<div class="cols-2">` + U.card(tt('شروط العقد', 'Contract terms'), U.dl([
        [tt('العميل', 'Client'), `<a href="#client.${cl.id}">${M.esc(M.L(cl.name))}</a>`],
        [tt('التشغيل والتأكيد من', 'Run and confirmed from'), `${tt(...K_CH[k.channel])}${k.externalSystem ? ' · ' + M.esc(k.externalSystem) : ''}`],
        [tt('التسعير', 'Pricing'), kPrice(k)], [tt('دورة الفوترة', 'Billing cycle'), tt(...K_CYCLE[k.cycle])], [tt('الكيلومترات', 'Kilometres'), kKm(k)],
        [tt('السائق', 'Driver'), k.withDriver ? tt('بسائق الشركة', "With the company's driver") : tt('بدون سائق (العميل بيسوق)', 'Without driver (the client drives)')],
        [tt('الحصرية', 'Exclusivity'), `${kHours(k)}<div class="muted small">${k.workDays.length === 7 ? tt('كل الأيام', 'Every day') : k.workDays.map(d => tt(...K_DAYS[d])).join('، ')}</div>`],
        [tt('المدة', 'Period'), `${M.date(k.startDate)} → ${k.endDate ? M.date(k.endDate) : tt('مفتوح', 'open-ended')}`],
        [tt('متفوتر لحد', 'Billed up to'), k.billedTo ? M.date(k.billedTo) : '—'],
        [tt('الشروط', 'Terms'), M.esc(M.L(k.terms))],
      ])) +
      U.card(tt('المركبات على العقد', 'Vehicles on the contract'), U.table({ id: 'k-veh', rows: cvs, export: false, pageSize: 8, emptyTitle: tt('مفيش مركبات', 'No vehicles'), emptyText: ' ', columns: [
        { label: tt('المركبة', 'Vehicle'), value: x => U.find('vehicles', x.vehicleId).code, render: x => `<a href="#vehicle.${x.vehicleId}">${U.find('vehicles', x.vehicleId).code}</a> <span class="muted small">${M.esc(M.L(U.find('vehicles', x.vehicleId).plate || ''))}</span>` },
        { label: tt('السائق', 'Driver'), value: x => x.driverId ? M.L(U.find('drivers', x.driverId).name) : '—' },
        { label: tt('من', 'From'), value: x => x.from, render: x => M.date(x.from) }, { label: tt('إلى', 'To'), value: x => x.to || '', render: x => x.to ? M.date(x.to) : tt('مستمرة', 'ongoing') },
        { label: tt('كم الدورة الحالية', 'km this cycle'), num: 1, value: x => kUsed(k, x.vehicleId, n), render: x => { const u = kUsed(k, x.vehicleId, n); return k.kmAllowance != null && k.kmBasis === 'cycle' ? `${M.n0(u)} / ${M.n0(k.kmAllowance)}${u > k.kmAllowance ? ' ' + U.badge(tt('زيادة', 'Over'), 'warning') : ''}` : M.n0(u); } },
        { label: '', sort: false, render: x => can && (!x.to || x.to >= M.TODAY) ? `<button class="btn ghost sm" data-act="k-remv" data-k="${k.id}" data-v="${x.vehicleId}">${tt('شيل من العقد', 'Take off')}</button>` : '' },
      ] }), { flush: true }) + `</div><div style="height:16px"></div>` +
      U.card(tt('الرحلات المؤكدة', 'Confirmed trips'), U.table({ id: 'k-trips', rows: trips, pageSize: 10, emptyTitle: tt('مفيش رحلات اتأكدت لسه', 'No trips confirmed yet'), emptyText: tt('النظام اللي بيشغّل العقد بيبعت كل رحلة بعد ما تخلص (POST /api/v1/contracts/{id}/trips)، أو أكدها من هنا.', 'The system running the contract sends each trip once finished (POST /api/v1/contracts/{id}/trips), or confirm it here.'), columns: [
        { label: tt('الرحلة', 'Trip'), value: t => t.number, render: t => `<a href="#trip.${t.id}">${t.number}</a>${t.externalRef ? `<div class="cell-sub ltr">${M.esc(t.externalRef)}</div>` : ''}` },
        { label: tt('التاريخ', 'Date'), value: t => t.date + t.startTime, render: t => `${M.date(t.date)} <span class="num muted">${t.startTime}–${t.endTime}</span>` },
        { label: tt('المركبة', 'Vehicle'), value: t => U.find('vehicles', t.vehicleId).code },
        { label: tt('المصدر', 'Source'), value: t => t.source, render: t => M.L(M.tripSources[t.source || 'motus']) },
        { label: tt('كم', 'km'), num: 1, value: t => t.km, render: t => M.n0(t.km) },
        { label: tt('الإيراد', 'Revenue'), num: 1, value: t => t.revenue, render: t => k.pricing === 'per_trip' ? M.money(t.revenue) : `<span class="muted small">${tt('ضمن سعر الدورة', 'in the cycle price')}</span>` },
        { label: tt('الفوترة', 'Billing'), value: t => t.invoiced, render: t => t.invoiced ? U.badge(tt('مفوترة', 'Invoiced'), 'success') : k.pricing === 'per_trip' ? U.badge(tt('في الدورة الجاية', 'Next cycle'), 'muted') : '—' },
      ] })) +
      (extra.length ? '<div style="height:16px"></div>' + U.card(tt('شغل إضافي بره العقد', 'Extra work outside the contract'), U.table({ id: 'k-extra', rows: extra, pageSize: 6, export: false, columns: [
        { label: tt('الرحلة', 'Trip'), value: t => t.number, render: t => `<a href="#trip.${t.id}">${t.number}</a>` },
        { label: tt('التاريخ', 'Date'), value: t => t.date + t.startTime, render: t => `${M.date(t.date)} <span class="num muted">${t.startTime}–${t.endTime}</span>` },
        { label: tt('المركبة', 'Vehicle'), value: t => U.find('vehicles', t.vehicleId).code }, { label: tt('العميل', 'Client'), value: t => M.L(U.find('clients', t.clientId).name) },
        { label: tt('السعر', 'Price'), num: 1, value: t => t.revenue, render: t => M.money(t.revenue) }, { label: tt('الحالة', 'Status'), value: t => t.status, render: t => U.status(t.status) },
      ] }), { hint: tt('كل شغل إضافي بيتسعّر لوحده كحجز عادي وقته، ومش داخل في سعر العقد ولا فاتورته.', 'Each extra job is priced on its own as a normal booking at its time; it is not part of the contract price or invoice.') }) : '') +
      (invs.length ? '<div style="height:16px"></div>' + U.card(tt('فواتير العقد', 'Contract invoices'), invs.map(i => `<div class="list-row"><div class="grow"><a href="#invoice.${i.id}">${i.number}</a> · ${M.date(i.issueDate)}</div><div>${M.money(i.total)}</div></div>`).join('')) : '');
  });

  U.act('k-new', () => {
    const db = U.db();
    const busy = new Set(db.contractVehicles.filter(x => (!x.to || x.to >= M.TODAY) && (U.find('contracts', x.contractId).exclusive)).map(x => x.vehicleId));
    const vs = db.vehicles.filter(v => v.status !== 'sold' && !busy.has(v.id));
    U.formModal(tt('عقد تشغيل جديد', 'New operating contract'), [
      M.multi() ? { f: 'activity', label: tt('النشاط اللي العقد بيخدمه', 'Activity the contract serves'), type: 'select', options: M.acts().map(a => [a, M.L(M.actName(a))]) } : null,
      { f: 'clientId', label: tt('العميل (اللي بيدفع)', 'Client (who pays)'), type: 'select', req: true, options: db.clients.map(c => [c.id, M.L(c.name)]) },
      { f: 'name', label: tt('اسم العقد', 'Contract name'), req: true },
      { f: 'channel', label: tt('الرحلات بتتشغّل وتتأكد من', 'Trips are run and confirmed from'), type: 'select', value: 'external', options: Object.entries(K_CH).map(([kk, v]) => [kk, tt(...v)]) },
      { f: 'externalSystem', label: tt('اسم النظام (اختياري)', 'System name (optional)'), attrs: 'placeholder="Sabeel Bus Schools"' },
      { f: 'pricing', label: tt('التسعير', 'Pricing'), type: 'select', value: 'per_trip', options: [['per_trip', tt('بالرحلة', 'Per trip')], ['per_period', tt('بالمدة (لكل مركبة)', 'Per period (per vehicle)')]] },
      { f: 'rate', label: tt('السعر', 'Rate'), type: 'number', req: true },
      { f: 'cycle', label: tt('الدورة (فوترة / مدة)', 'Cycle (billing / period)'), type: 'select', value: 'month', options: Object.entries(K_CYCLE).map(([kk, v]) => [kk, tt(...v)]) },
      { f: 'kmAllowance', label: tt('الكيلومترات المسموحة (فاضي = مفتوحة)', 'Kilometres included (empty = open)'), type: 'number' },
      { f: 'kmBasis', label: tt('الحد ده', 'This limit is'), type: 'select', value: 'cycle', options: [['cycle', tt('لكل مركبة في الدورة', 'per vehicle per cycle')], ['trip', tt('لكل رحلة', 'per trip')]] },
      { f: 'extraKmRate', label: tt('سعر الكيلو الزيادة', 'Extra km rate'), type: 'number' },
      { f: 'startDate', label: tt('بداية العقد', 'Start date'), type: 'date', value: M.TODAY, req: true }, { f: 'endDate', label: tt('نهاية العقد (اختياري)', 'End date (optional)'), type: 'date' },
      { f: 'withDriver', label: tt('بسائق الشركة (كل مركبة بسواقها)', "With the company's driver (each vehicle with its driver)"), type: 'checkbox', value: true },
      { f: 'exclusive', label: tt('حصري في ساعات العمل (المركبة مش هتاخد شغل تاني فيها)', 'Exclusive in working hours (no other work then)'), type: 'checkbox', value: false },
      { f: 'workStart', label: tt('ساعات العمل من', 'Working hours from'), type: 'time', value: '06:00' }, { f: 'workEnd', label: tt('إلى', 'to'), type: 'time', value: '16:00' },
      { f: 'vh', label: tt('المركبات', 'Vehicles'), type: 'html', full: true, html: `<div class="check-grid">${vs.map(v => `<label class="check"><input type="checkbox" data-f="v_${v.id}"> ${M.esc(v.code)} <span class="muted small">${M.esc(U.vtypeName ? U.vtypeName(v.type) : v.type)}</span></label>`).join('')}</div>` },
      { f: 'terms', label: tt('شروط إضافية', 'Additional terms'), type: 'textarea', full: true, value: tt('المشغّل (الشركة) يتحمل الصيانة والوقود والزيوت. يسمح للمركبة بشغل إضافي خارج ساعات العقد، وكل شغل إضافي بيتسعّر لوحده وقته.', 'The operator (the company) bears maintenance, fuel and oils. The vehicle may do extra work outside the contract hours; each extra job is priced on its own at its time.') },
    ], 'contract.create', { map: d => ({ activity: d.activity || undefined, clientId: d.clientId, name: d.name, channel: d.channel, externalSystem: d.externalSystem || '', pricing: d.pricing, rate: d.rate, cycle: d.cycle, startDate: d.startDate, endDate: d.endDate || undefined, withDriver: !!d.withDriver, exclusive: !!d.exclusive, kmAllowance: d.kmAllowance == null ? null : d.kmAllowance, kmBasis: d.kmBasis, extraKmRate: d.extraKmRate || 0, workStart: d.workStart, workEnd: d.workEnd, terms: d.terms || undefined, vehicles: Object.keys(d).filter(x => x.startsWith('v_') && d[x]).map(x => ({ vehicleId: x.slice(2) })) }),
      after: r => { if (r && r.id) U.go('contract', r.id); }, ok: tt('تم إنشاء العقد', 'Contract created') });
  });
  U.act('k-trip', el => {
    const k = U.find('contracts', el.dataset.id);
    U.formModal(tt('تأكيد رحلة تمت', 'Confirm a finished trip') + ' · ' + k.number, [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', req: true, options: kVehicles(k).map(x => [x.vehicleId, U.find('vehicles', x.vehicleId).code]) },
      { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true },
      { f: 'startTime', label: tt('من', 'From'), type: 'time', value: k.workStart, req: true }, { f: 'endTime', label: tt('إلى', 'To'), type: 'time', req: true },
      { f: 'km', label: tt('المسافة (كم)', 'Distance (km)'), type: 'number' }, k.activity === 'cargo' ? null : { f: 'pax', label: M.L((M.prof(k.activity) || M.prof(M.acts()[0])).load.label), type: 'number' },
      { f: 'externalRef', label: tt('مرجع النظام (اختياري، يمنع التكرار)', 'System reference (optional, prevents duplicates)'), attrs: 'dir="ltr"' },
    ], 'contract.trip', { map: d => Object.assign({ contractId: k.id }, d, { km: d.km == null ? undefined : d.km, pax: d.pax == null ? undefined : d.pax }), ok: r => tt(`تم تسجيل الرحلة ${r.number}`, `Trip ${r.number} recorded`) });
  });
  U.act('k-bill', el => {
    const k = U.find('contracts', el.dataset.id); const n = kNext(k);
    const to = n.due ? n.to : kDay(M.TODAY, -1);
    U.formModal(tt('فوترة العقد', 'Bill the contract') + ' · ' + k.number, [
      { f: 'to', label: tt('لحد تاريخ', 'Up to'), type: 'date', value: to, req: true, help: n.due ? tt(`الدورة ${n.from} → ${n.to} خلصت.`, `Cycle ${n.from} → ${n.to} has ended.`) : tt('الدورة الحالية لسه ماخلصتش؛ الفوترة لحد امبارح بتتحسب بنسبة الأيام.', 'The current cycle has not ended; billing up to yesterday is prorated by days.') },
    ], 'contract.bill', { map: d => ({ id: k.id, to: d.to }), intro: `<p class="muted small">${k.pricing === 'per_trip' ? tt('كل الرحلات المؤكدة اللي لسه ماتفوترتش لحد التاريخ ده × سعر الرحلة.', 'Every confirmed trip not yet invoiced up to that date × the trip rate.') : tt('كل مركبة × عدد الدورات (المركبة اللي دخلت أو خرجت في نص الدورة بتدفع نسبة أيامها).', 'Each vehicle × the number of cycles (a vehicle that joined or left mid-cycle pays its share of days).')}${k.kmAllowance != null ? ' ' + tt('+ الكيلومترات الزيادة عن المسموح × سعر الكيلو.', '+ kilometres beyond the allowance × the extra-km rate.') : ''}</p>`, ok: r => tt(`تم إصدار الفاتورة ${r.number}`, `Invoice ${r.number} issued`), submit: tt('إصدار الفاتورة', 'Issue invoice') });
  });
  U.act('k-addv', el => {
    const k = U.find('contracts', el.dataset.id); const db = U.db();
    const on = new Set(kVehicles(k).map(x => x.vehicleId));
    U.formModal(tt('إضافة مركبة للعقد', 'Add a vehicle to the contract'), [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', req: true, options: db.vehicles.filter(v => v.status !== 'sold' && !on.has(v.id)).map(v => [v.id, v.code]) },
      { f: 'fromDate', label: tt('من تاريخ', 'From'), type: 'date', value: M.TODAY },
      k.withDriver ? { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', options: [['', tt('سائق المركبة', "The vehicle's driver")], ...db.drivers.filter(d => d.status === 'active').map(d => [d.id, M.L(d.name)])] } : null,
    ], 'contract.addVehicle', { map: d => Object.assign({ id: k.id }, d, { driverId: d.driverId || undefined }), ok: tt('تمت الإضافة', 'Added') });
  });
  U.act('k-remv', el => U.confirm(tt('شيل المركبة من العقد', 'Take the vehicle off the contract'), tt('المركبة هتخرج من العقد من النهارده، والرحلات اللي اتأكدت قبل كده فاضلة.', 'The vehicle leaves the contract from today; trips confirmed before stay.'), () => U.run('contract.removeVehicle', { id: el.dataset.k, vehicleId: el.dataset.v }, { ok: tt('تم', 'Done') })));
  U.act('k-end', el => { const k = U.find('contracts', el.dataset.id); U.formModal(tt('إنهاء العقد', 'End the contract') + ' · ' + k.number, [{ f: 'endDate', label: tt('آخر يوم في العقد', 'Last day of the contract'), type: 'date', value: M.TODAY, req: true }], 'contract.end', { map: d => ({ id: k.id, endDate: d.endDate }), danger: true, ok: tt('تم إنهاء العقد', 'Contract ended'), intro: `<p class="muted small">${tt('المركبات بتتحرر من العقد بعد آخر يوم، ولسه تقدر تفوتر اللي فاضل.', 'The vehicles are released after the last day; you can still bill what is left.')}</p>` }); });

  /* ================= LINES =================
     Recurring runs of schools and universities, staff shifts and intercity departures. A line
     creates the trips of the coming days on its vehicle and driver. Counts only: the students,
     employees and passengers themselves are in the Sabeel module that serves them. */
  const LINE_ACTS = ['education', 'staff', 'intercity'];
  const lineActs = () => M.acts().filter(a => LINE_ACTS.includes(a));
  const DAYS = [['الأحد', 'Sun'], ['الإثنين', 'Mon'], ['الثلاثاء', 'Tue'], ['الأربعاء', 'Wed'], ['الخميس', 'Thu'], ['الجمعة', 'Fri'], ['السبت', 'Sat']];
  const lineDays = l => l.days.length === 7 ? tt('كل الأيام', 'Every day') : l.days.map(d => tt(...DAYS[d])).join('، ');
  const legName = (l, leg) => { const p = M.prof(l.activity); return p && p.legNames ? M.L(p.legNames[leg]) : leg; };
  const lineTimes = l => [l.goTime ? `${legName(l, 'go')} <span class="num">${l.goTime}</span>` : '', l.returnTime ? `${legName(l, 'return')} <span class="num">${l.returnTime}</span>` : ''].filter(Boolean).join(' · ');
  U.route('lines', () => {
    const db = U.db(); const rows = db.lines || [];
    const today = db.trips.filter(t => t.lineId && t.date === M.TODAY && t.status !== 'cancelled');
    const unassigned = db.bookings.filter(b => b.lineId && b.unassigned && b.status !== 'cancelled' && b.date >= M.TODAY);
    const head = M.sum(rows.filter(l => l.status === 'active'), l => l.headcount);
    const one = lineActs().length === 1 ? M.prof(lineActs()[0]) : null;
    return U.head(tt('الخطوط', 'Lines'), tt('الرحلات اليومية المتكررة: كل خط بمحطاته ومواعيده وأيامه، وبيولّد رحلات الأيام الجاية على مركبته وسواقه. MOTUS بيشوف العدد بس — الأسماء في موديول سبيل.', 'Daily recurring runs: each line with its stops, times and days creates the coming trips on its vehicle and driver. MOTUS sees counts only — the names are in the Sabeel module.'), U.btn(tt('خط جديد', 'New line'), 'line-new', '', 'plus')) +
      U.kpis([U.kpi(tt('خطوط شغالة', 'Active lines'), rows.filter(l => l.status === 'active').length), U.kpi(tt('رحلات النهارده', "Today's runs"), today.length), U.kpi(one ? M.L(one.load.label) : tt('العدد', 'Headcount'), M.n0(head), tt('على الخطوط الشغالة', 'on active lines')), U.kpi(tt('رحلات بدون مركبة', 'Runs without a vehicle'), `<span class="${unassigned.length ? 'delta-down' : ''}">${unassigned.length}</span>`)]) +
      U.card(null, U.table({ id: 'lines', rows, emptyTitle: tt('مفيش خطوط لسه', 'No lines yet'), emptyText: tt('اعمل خط لكل مدرسة أو وردية أو رحلة منتظمة.', 'Create a line for each school, shift or scheduled departure.'), columns: [
        { label: tt('الخط', 'Line'), value: l => l.number, render: l => `<a class="cell-main" href="#line.${l.id}">${M.esc(M.L(l.name))}</a><div class="cell-sub">${l.number}${lineActs().length > 1 ? ' · ' + M.L(M.actName(l.activity)) : ''}</div>` },
        { label: tt('العميل', 'Client'), value: l => M.L(U.find('clients', l.clientId).name) },
        { label: tt('المسار', 'Route'), value: l => U.routeTxt(l.from, l.to), render: l => `${U.routeTxt(l.from, l.to)}${l.stops.length ? `<div class="cell-sub">${l.stops.length} ${tt('محطة', 'stops')}</div>` : ''}` },
        { label: tt('المواعيد', 'Times'), value: l => l.goTime || l.returnTime, render: l => `${lineTimes(l)}<div class="cell-sub">${lineDays(l)}</div>` },
        { label: tt('العدد', 'Count'), num: 1, value: l => l.headcount, render: l => `${l.headcount} ${M.L((M.prof(l.activity) || { load: { short: { ar: '', en: '' } } }).load.short)}` },
        { label: tt('المركبة', 'Vehicle'), value: l => U.find('vehicles', l.vehicleId).code || '', render: l => l.vehicleId ? `${M.esc(U.find('vehicles', l.vehicleId).code)}<div class="cell-sub">${M.esc(M.L(U.find('drivers', l.driverId).name || ''))}</div>` : U.badge(tt('بدون مركبة', 'No vehicle'), 'warning') },
        { label: tt('متولّد لحد', 'Runs up to'), value: l => l.generatedTo || '', render: l => l.generatedTo ? M.date(l.generatedTo) : '—' },
        { label: tt('الحالة', 'Status'), value: l => l.status, render: l => l.status === 'active' ? U.badge(tt('شغال', 'Active'), 'success') : l.status === 'paused' ? U.badge(tt('موقوف', 'Paused'), 'warning') : U.badge(tt('منتهي', 'Ended'), 'muted') },
      ], onRow: l => 'line.' + l.id }), { flush: true });
  });
  U.route('line', id => {
    const db = U.db(); const l = (db.lines || []).find(x => x.id === id);
    if (!l) return U.empty('route', tt('الخط غير موجود في هذه الشركة', 'Line not found in this company'));
    const p = M.prof(l.activity) || M.prof(lineActs()[0]);
    const trips = db.trips.filter(t => t.lineId === l.id && t.status !== 'cancelled').sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? -1 : 1));
    const waiting = db.bookings.filter(b => b.lineId === l.id && b.unassigned && b.status !== 'cancelled' && b.date >= M.TODAY);
    const can = ['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(M.state.role);
    const k = l.contractId ? U.find('contracts', l.contractId) : null;
    const acts = can && l.status === 'active' ? `${U.btn(tt('ولّد رحلات الأيام الجاية', 'Create the coming runs'), 'line-gen', '', 'calendar', `data-id="${l.id}"`)} ${U.btn(tt('تعديل', 'Edit'), 'line-edit', 'secondary', 'settings', `data-id="${l.id}"`)} ${U.btn(tt('إيقاف', 'Pause'), 'line-status', 'ghost', '', `data-id="${l.id}" data-s="paused"`)}` : can && l.status === 'paused' ? U.btn(tt('تشغيل', 'Resume'), 'line-status', '', '', `data-id="${l.id}" data-s="active"`) : '';
    return U.head(M.esc(M.L(l.name)), `${l.number} · ${M.L(M.actName(l.activity))} · ${lineTimes(l)}`, acts, [[tt('الخطوط', 'Lines'), 'lines'], [l.number]]) +
      U.kpis([U.kpi(M.L(p.load.label), l.headcount), U.kpi(tt('رحلات متولّدة', 'Runs created'), trips.length, l.generatedTo ? tt('لحد ', 'up to ') + M.date(l.generatedTo) : ''), U.kpi(tt('بدون مركبة', 'Without a vehicle'), `<span class="${waiting.length ? 'delta-down' : ''}">${waiting.length}</span>`, waiting.length ? tt('المركبة أو السواق مشغولين — وزّعها من لوحة الحركة', 'Vehicle or driver busy — place them on the dispatch board') : ''), U.kpi(tt('سعر الرحلة', 'Price per run'), k ? (k.pricing === 'per_trip' ? M.money(k.rate) : tt('ضمن العقد', 'In the contract')) : M.money(l.pricePerRun))]) +
      `<div class="cols-2">` + U.card(tt('الخط', 'Line'), U.dl([
        [tt('العميل', 'Client'), U.cLabel(U.find('clients', l.clientId))],
        [tt('المسار', 'Route'), `${U.routeTxt(l.from, l.to)}`],
        [tt('المحطات', 'Stops'), l.stops.length ? l.stops.map(U.place).map(M.esc).join(' ← ') : '—'],
        [tt('المواعيد', 'Times'), `${lineTimes(l)} · ${l.durationMin} ${tt('دقيقة', 'min')}`],
        [tt('الأيام', 'Days'), lineDays(l)],
        [tt('المدة', 'Period'), `${M.date(l.startDate)} → ${l.endDate ? M.date(l.endDate) : tt('مفتوح', 'open-ended')}`],
        [tt('المركبة والسائق', 'Vehicle & driver'), l.vehicleId ? `<a href="#vehicle.${l.vehicleId}">${M.esc(U.find('vehicles', l.vehicleId).code)}</a> · ${M.esc(M.L(U.find('drivers', l.driverId).name || ''))}` : '—'],
        [tt('العقد', 'Contract'), k ? `<a href="#contract.${k.id}">${k.number}</a>` : '—'],
        [tt('ملاحظات', 'Notes'), M.esc(l.notes || '—')],
      ])) +
      U.card(tt('بيانات الأفراد', 'People'), `<p class="muted">${tt('أسماء وعناوين الطلاب أو الموظفين أو الركاب مش في MOTUS: بتتسجل في موديول سبيل اللي بيخدمهم (Sabeel Bus Schools / University / Dawra / Swa Bus)، وMOTUS بيستقبل العدد بس.', 'Names and addresses of students, employees or passengers are not in MOTUS: they are kept in the Sabeel module that serves them (Sabeel Bus Schools / University / Dawra / Swa Bus); MOTUS receives the count only.')}</p>`) + `</div><div style="height:16px"></div>` +
      U.card(tt('الرحلات', 'Runs'), U.table({ id: 'line-trips', rows: trips.concat(waiting.map(b => ({ _b: b, date: b.date, startTime: b.time, status: 'unassigned' }))).sort((a, b) => (a.date + a.startTime < b.date + b.startTime ? -1 : 1)), pageSize: 10, export: false, columns: [
        { label: tt('الرحلة', 'Run'), value: t => t.number || t._b.number, render: t => t._b ? `<a href="#booking.${t._b.id}">${t._b.number}</a>` : `<a href="#trip.${t.id}">${t.number}</a>` },
        { label: tt('التاريخ', 'Date'), value: t => t.date + t.startTime, render: t => `${M.date(t.date)} <span class="num muted">${t.startTime}</span>` },
        { label: tt('الاتجاه', 'Direction'), value: t => t.lineLeg || (t._b ? '' : ''), render: t => t._b ? M.L(M.typeName(t._b.tripType)) : M.L(M.typeName(t.type)) },
        { label: tt('المركبة', 'Vehicle'), value: t => t._b ? '' : U.find('vehicles', t.vehicleId).code, render: t => t._b ? U.badge(tt('بدون مركبة', 'No vehicle'), 'danger') : M.esc(U.find('vehicles', t.vehicleId).code) },
        { label: tt('الحالة', 'Status'), value: t => t.status, render: t => t._b ? `<button class="btn sm" data-act="convert-booking" data-id="${t._b.id}">${tt('تخصيص', 'Assign')}</button>` : U.status(t.status) },
      ] }));
  });
  const lineFields = (l, act) => {
    const db = U.db(); l = l || {}; act = l.activity || act;
    const p = M.prof(act); const pts = M.placesFor(act);
    return [
      !l.id && lineActs().length > 1 ? { f: 'activity', label: tt('النشاط', 'Activity'), type: 'select', value: act, options: lineActs().map(a => [a, M.L(M.actName(a))]) } : null,
      { f: 'name', label: tt('اسم الخط', 'Line name'), value: l.name ? M.L(l.name) : '', req: true, attrs: `placeholder="${act === 'education' ? tt('مثلاً: خط المعادي — مدرسة النور', 'e.g. Maadi line — Al Noor school') : act === 'staff' ? tt('مثلاً: وردية الصبح — مصنع العاشر', 'e.g. Morning shift — 10th factory') : tt('مثلاً: القاهرة ← الإسكندرية 8 الصبح', 'e.g. Cairo → Alexandria 8am')}"` },
      { f: 'clientId', label: tt('العميل', 'Client'), type: 'select', value: l.clientId, req: true, options: db.clients.filter(c => c.status === 'active' && M.clientTypesFor(act).includes(c.type)).concat(l.clientId ? [U.find('clients', l.clientId)] : []).filter((c, i, a) => c && c.id && a.findIndex(x => x.id === c.id) === i).map(c => [c.id, M.L(c.name)]) },
      { f: 'from', label: act === 'education' ? tt('أول محطة', 'First stop') : tt('من', 'From'), type: 'select', value: l.from, options: pts.map(k => [k, U.place(k)]), req: true },
      { f: 'to', label: act === 'education' ? tt('المدرسة / الجامعة', 'School / university') : act === 'staff' ? tt('مقر العمل', 'Workplace') : tt('إلى', 'To'), type: 'select', value: l.to, options: pts.map(k => [k, U.place(k)]), req: true },
      { f: 'stopsHtml', label: tt('محطات في النص (اختياري)', 'Stops in between (optional)'), type: 'html', full: true, html: `<div class="check-grid">${pts.map(k => `<label class="check"><input type="checkbox" data-f="stop_${k}" ${(l.stops || []).includes(k) ? 'checked' : ''}> ${M.esc(U.place(k))}</label>`).join('')}</div>` },
      { f: 'goTime', label: M.L(p.legNames.go) + ' — ' + tt('الميعاد', 'time'), type: 'time', value: l.goTime || (act === 'staff' ? '07:00' : '06:30') },
      { f: 'returnTime', label: M.L(p.legNames.return) + ' — ' + tt('الميعاد (فاضي = مفيش)', 'time (empty = none)'), type: 'time', value: l.id ? (l.returnTime || '') : (act === 'staff' ? '16:00' : act === 'education' ? '14:30' : '') },
      { f: 'durationMin', label: tt('مدة الرحلة (دقيقة)', 'Run duration (min)'), type: 'number', value: l.durationMin || 60, attrs: 'min="5"' },
      { f: 'daysHtml', label: tt('الأيام', 'Days'), type: 'html', full: true, html: `<div class="check-row">${DAYS.map((d, i) => `<label class="check"><input type="checkbox" data-f="day_${i}" ${(l.days || [0, 1, 2, 3, 4]).includes(i) ? 'checked' : ''}> ${tt(d[0], d[1])}</label>`).join('')}</div>` },
      { f: 'startDate', label: act === 'education' ? tt('بداية الفصل الدراسي', 'Term start') : tt('من تاريخ', 'From'), type: 'date', value: l.startDate || M.TODAY, req: true },
      { f: 'endDate', label: act === 'education' ? tt('نهاية الفصل الدراسي', 'Term end') : tt('إلى تاريخ (اختياري)', 'To (optional)'), type: 'date', value: l.endDate || '' },
      { f: 'headcount', label: M.L(p.load.label), type: 'number', value: l.headcount || '', req: true, attrs: 'min="1"' },
      { f: 'vehicleType', label: tt('نوع المركبة', 'Vehicle type'), type: 'select', value: l.vehicleType, options: M.typesFor(act).map(k => [k, U.vtype(k)]), req: true },
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', value: l.vehicleId || '', options: [['', tt('— لسه —', '— not yet —')]].concat(db.vehicles.filter(v => v.status !== 'sold' && v.seats > 0).map(v => [v.id, `${v.code} · ${v.seats} ${tt('مقعد', 'seats')}`])) },
      { f: 'driverId', label: tt('السائق', 'Driver'), type: 'select', value: l.driverId || '', options: [['', tt('سائق المركبة', "The vehicle's driver")]].concat(db.drivers.filter(d => d.status === 'active').map(d => [d.id, M.L(d.name)])) },
      { f: 'contractId', label: tt('عقد التشغيل (اختياري)', 'Operating contract (optional)'), type: 'select', value: l.contractId || '', options: [['', '—']].concat(db.contracts.filter(k => k.status === 'active' && (!k.activity || k.activity === act)).map(k => [k.id, `${k.number} · ${M.L(k.name)}`])) },
      { f: 'pricePerRun', label: tt('سعر الرحلة (لو مفيش عقد)', 'Price per run (without a contract)'), type: 'number', value: l.pricePerRun || 0, attrs: 'min="0"' },
      { f: 'notes', label: tt('ملاحظات', 'Notes'), type: 'textarea', value: l.notes || '', full: true },
    ];
  };
  const linePayload = (d, act) => {
    const out = { name: d.name, clientId: d.clientId, from: d.from, to: d.to, goTime: d.goTime || null, returnTime: d.returnTime || null, durationMin: d.durationMin, startDate: d.startDate, endDate: d.endDate || null, headcount: d.headcount, vehicleType: d.vehicleType, vehicleId: d.vehicleId || null, driverId: d.driverId || null, contractId: d.contractId || null, pricePerRun: d.pricePerRun || 0, notes: d.notes || '' };
    out.stops = Object.keys(d).filter(k => k.startsWith('stop_') && d[k]).map(k => k.slice(5)).filter(k => k !== d.from && k !== d.to);
    out.days = Object.keys(d).filter(k => k.startsWith('day_') && d[k]).map(k => +k.slice(4));
    if (act) out.activity = act;
    return out;
  };
  U.act('line-new', el => {
    const act = (el && el.dataset && el.dataset.a) || lineActs()[0];
    if (!act) { U.toast(tt('الخطوط للمدارس والجامعات والموظفين وبين المدن', 'Lines are for education, staff and intercity'), 'error'); return; }
    U.formModal(tt('خط جديد', 'New line') + (lineActs().length > 1 ? ' · ' + M.L(M.actName(act)) : ''), lineFields(null, act), 'line.create', {
      intro: `<p class="muted small">${tt('الخط بيولّد رحلات الأيام الجاية لوحده على مركبته وسواقه، ويتأكد إنهم فاضيين. العدد بس — من غير أسماء.', 'The line creates the coming runs on its vehicle and driver and checks they are free. Counts only — no names.')}</p>`,
      map: d => linePayload(d, act), after: r => { if (r && r.id) U.go('line', r.id); }, ok: tt('تم إنشاء الخط', 'Line created'),
      mount: () => { const s = document.querySelector('#mf [data-f="activity"]'); if (s) s.addEventListener('change', () => { U.closeOverlays(); U.acts['line-new']({ dataset: { a: s.value } }); }); } });
  });
  U.act('line-edit', el => { const l = U.find('lines', el.dataset.id); U.formModal(tt('تعديل الخط', 'Edit line') + ' · ' + l.number, lineFields(l), 'line.update', { map: d => Object.assign(linePayload(d), { id: l.id }), ok: tt('تم الحفظ', 'Saved') }); });
  U.act('line-status', el => U.run('line.update', { id: el.dataset.id, status: el.dataset.s }, { ok: tt('تم', 'Done') }));
  U.act('line-gen', el => {
    const l = U.find('lines', el.dataset.id);
    const from = l.generatedTo && l.generatedTo >= M.TODAY ? M.addDays(l.generatedTo, 1) : M.TODAY;
    U.formModal(tt('توليد الرحلات', 'Create runs') + ' · ' + l.number, [
      { f: 'from', label: tt('من', 'From'), type: 'date', value: from, req: true }, { f: 'to', label: tt('إلى', 'To'), type: 'date', value: M.addDays(from, 6), req: true },
    ], 'line.generate', { intro: `<p class="muted small">${tt('بيعمل رحلة لكل يوم شغل وكل اتجاه. لو المركبة أو السواق مشغولين في ميعاد، الرحلة دي بتفضل "بدون مركبة" بالسبب وتتوزع من لوحة الحركة.', 'One run per working day and direction. If the vehicle or driver is busy at a time, that run stays "without a vehicle" with the reason, to be placed from the dispatch board.')}</p>`,
      map: d => ({ id: l.id, from: d.from, to: d.to }), submit: tt('ولّد', 'Create'),
      ok: r => tt(`اتعمل ${r.created} رحلة (${r.assigned} متخصصة${r.unassigned.length ? '، ' + r.unassigned.length + ' بدون مركبة' : ''})`, `${r.created} runs created (${r.assigned} assigned${r.unassigned.length ? ', ' + r.unassigned.length + ' without a vehicle' : ''})`) });
  });
})();
