/* GPS tracking & telematics. Positions come from the company's GPS provider through the API;
   the map is a schematic SVG of Egypt so it works without external tile servers. */
'use strict';
(function () {
  const U = M.ui, C = M.calc, tt = M.tt;
  const W = 600, H = 560, LNG0 = 24.6, LNG1 = 37.2, LAT0 = 21.6, LAT1 = 31.9;
  const px = (lat, lng) => [((lng - LNG0) / (LNG1 - LNG0)) * W, ((LAT1 - lat) / (LAT1 - LAT0)) * H];
  const egypt = [[25.0, 31.6], [27.2, 31.4], [29.0, 30.95], [29.9, 31.25], [31.0, 31.6], [32.3, 31.3], [34.2, 31.3], [34.9, 29.5], [34.6, 28.6], [34.3, 27.85], [33.7, 28.3], [32.7, 29.6], [32.55, 29.95], [32.4, 29.6], [32.7, 28.6], [33.6, 27.3], [34.3, 26.1], [35.0, 24.6], [35.6, 23.9], [36.9, 22.0], [31.4, 22.0], [25.0, 22.0]];
  const nile = [[30.0, 31.5], [31.1, 30.4], [31.25, 30.05], [31.25, 29.0], [30.85, 28.0], [31.2, 27.2], [32.1, 26.2], [32.65, 25.7], [32.9, 24.1], [32.6, 23.4], [31.6, 22.4]];
  const path = pts => pts.map((p, i) => { const [x, y] = px(p[1], p[0]); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join(' ');
  const med = [[24.6, 31.95], [37.2, 31.95], [37.2, 31.3], [34.2, 31.3], [32.3, 31.3], [31.0, 31.6], [29.9, 31.25], [29.0, 30.95], [27.2, 31.4], [25.0, 31.6], [24.6, 31.6]];
  const red = [[32.55, 29.95], [32.4, 29.6], [32.7, 28.6], [33.6, 27.3], [34.3, 26.1], [35.0, 24.6], [35.6, 23.9], [36.9, 22.0], [37.2, 21.6], [37.2, 26.0], [35.2, 28.0], [34.95, 29.5], [34.6, 28.6], [34.3, 27.85], [33.7, 28.3], [32.7, 29.6]];
  const baseMap = () => `<rect width="${W}" height="${H}" fill="#E8ECF1"/><path d="${path(med)} Z" fill="#D6E2EE"/><path d="${path(red)} Z" fill="#D6E2EE"/><path d="${path(egypt)} Z" fill="#FFFFFF" stroke="#C3CFDC" stroke-width="1.5"/><path d="${path(nile)}" fill="none" stroke="#8FA3BA" stroke-width="2.2" stroke-linecap="round"/>` +
    Object.entries(M.places).filter(([k, p]) => p.kind === 'city').map(([k, p]) => { const [x, y] = px(p.lat, p.lng); return `<circle cx="${x}" cy="${y}" r="3" fill="#64748B"/><text x="${x + 6}" y="${y + 4}" font-size="11" fill="#64748B" font-family="${M.lang === 'ar' ? 'Cairo' : 'Inter'}">${M.L(p.name)}</text>`; }).join('') +
    `<text x="${px(31.68, 26.3)[0]}" y="${px(31.68, 26.3)[1]}" font-size="11" fill="#5A7493" font-style="italic" font-family="Inter">${tt('البحر المتوسط', 'Mediterranean Sea')}</text><text x="${px(24.8, 35.4)[0]}" y="${px(24.8, 35.4)[1]}" font-size="11" fill="#5A7493" font-style="italic" font-family="Inter">${tt('البحر الأحمر', 'Red Sea')}</text><text x="${W - 90}" y="${H - 14}" font-size="10" fill="#64748B" font-family="Inter">${tt('خريطة تخطيطية', 'Schematic map')}</text>`;
  const SC = { moving: '#15803D', idling: '#B45309', parked: '#08264A', offline: '#B91C1C', nodata: '#8FA3BA' };
  const stName = { moving: ['متحرك', 'Moving'], idling: ['متوقف والمحرك شغال', 'Idling'], parked: ['واقف', 'Parked'], offline: ['غير متصل', 'Offline'], nodata: ['لا توجد إشارة GPS', 'No GPS data'] };

  /* live positions come from GET /api/live (latest stored GPS fix per vehicle). Positions are sent
     by the company's GPS provider to the Open API (POST /api/v1/tracking/positions) or entered by
     a provider webhook — nothing here is simulated. */
  let live = { positions: [], now: Date.now() };
  const loadLive = async () => { try { live = await M.api.get('/api/live'); live.now = Date.now(); } catch (e) { /* keep the last data */ } };
  U.positions = () => {
    const db = U.db();
    const toMin = s => (+s.slice(0, 2)) * 60 + (+s.slice(3, 5));
    return db.vehicles.filter(v => v.status !== 'sold').map(v => {
      const dev = db.devices.find(d => d.vehicleId === v.id);
      const p = (live.positions || []).find(x => x.vehicleId === v.id);
      const age = p ? (live.serverNow || live.now) - p.ts : Infinity;
      let state = 'nodata';
      if (p) state = age > 30 * 60000 ? 'offline' : p.speed > 5 ? 'moving' : p.ignition ? 'idling' : 'parked';
      else if (dev) state = 'offline';
      const trip = db.trips.find(t => t.vehicleId === v.id && t.date === M.TODAY && t.status === 'running');
      const next = db.trips.filter(t => t.vehicleId === v.id && t.status === 'scheduled' && (t.date > M.TODAY || t.date === M.TODAY)).sort((a, b) => (a.date + a.startTime) < (b.date + b.startTime) ? -1 : 1)[0];
      return { v, dev, p, lat: p ? p.lat : null, lng: p ? p.lng : null, state, speed: p ? p.speed : 0, at: p ? p.at : null, trip, next, driver: U.find('drivers', trip ? trip.driverId : v.driverId) };
    });
  };

  U.route('livemap', () => {
    U.onMount(async () => { await loadLive(); drawLive(); U.timers.push(setInterval(async () => { await loadLive(); drawLive(); }, 20000)); });
    const db = U.db();
    return U.head(tt('الخريطة المباشرة', 'Live map'), tt('آخر موقع مسجل لكل مركبة من مزود التتبع (تحديث كل 20 ثانية). اضغط على مركبة للتفاصيل.', 'Latest recorded position of each vehicle from the GPS provider (refreshes every 20 seconds). Tap a vehicle for details.'), `<span class="badge outline plain num" id="live-clock"></span>`) +
      (db.devices.length ? '' : `<div class="form-error info" role="status">${U.icon('radio')}<div>${tt('لا توجد أجهزة تتبع مربوطة بعد. اربط جهاز لكل مركبة من "أجهزة التتبع"، ثم اجعل مزود الـ GPS يرسل المواقع إلى واجهة MOTUS (POST /api/v1/tracking/positions).', 'No tracking devices are linked yet. Link a device to each vehicle in "Tracking devices", then have the GPS provider send positions to the MOTUS API (POST /api/v1/tracking/positions).')}</div></div>`) +
      `<div class="kpis" id="live-kpis"></div>` +
      `<div class="cols-2-1">` + U.card(null, `<div class="map-wrap"><svg direction="ltr" viewBox="0 0 ${W} ${H}" id="live-svg" role="img" aria-label="${tt('خريطة المركبات', 'Vehicle map')}">${baseMap()}<g id="live-layer"></g></svg><div class="map-legend">${Object.keys(SC).map(k => `<span class="lg"><i style="background:${SC[k]}"></i>${tt(...stName[k])}</span>`).join('')}</div></div>`, { flush: true }) +
      U.card(tt('المركبات', 'Vehicles'), `<div id="live-list"></div>`) + `</div>`;
  });
  function drawLive() {
    const layer = document.getElementById('live-layer'); if (!layer) return;
    const pos = U.positions();
    document.getElementById('live-clock').textContent = `${tt('آخر تحديث', 'Updated')} ${new Date().toTimeString().slice(0, 5)}`;
    document.getElementById('live-kpis').innerHTML = Object.keys(SC).map(k => U.kpi(`<span class="lg"><i style="background:${SC[k]}"></i>${tt(...stName[k])}</span>`, pos.filter(p => p.state === k).length)).join('');
    layer.innerHTML = pos.filter(p => p.lat != null).map(p => { const [x, y] = px(p.lat, p.lng); return `<g class="veh" data-act="veh-pop" data-id="${p.v.id}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="11" fill="${SC[p.state]}" opacity=".18"/><circle cx="${x}" cy="${y}" r="6.5" fill="${SC[p.state]}" stroke="#fff" stroke-width="2"/><text x="${x}" y="${y - 12}" text-anchor="middle" font-size="10" font-weight="700" fill="#061D38" font-family="Inter">${M.esc(p.v.code.split('-').pop())}</text></g>`; }).join('');
    document.getElementById('live-list').innerHTML = pos.map(p => `<div class="list-row" data-act="veh-pop" data-id="${p.v.id}" style="cursor:pointer"><span class="lg"><i style="background:${SC[p.state]}"></i></span><div class="grow"><div class="t">${M.esc(p.v.code)} · ${U.vtype(p.v.type)}</div><div class="s">${tt(...stName[p.state])}${p.speed ? ` · <span class="num">${M.n0(p.speed)}</span> ${tt('كم/س', 'km/h')}` : ''}${p.at ? ` · <span class="num">${p.at.slice(5)}</span>` : ''}${p.trip ? ' · ' + U.routeTxt(p.trip.from, p.trip.to) : ''}</div></div></div>`).join('') || U.empty('car', tt('لا توجد مركبات', 'No vehicles'));
  }
  U.act('veh-pop', el => {
    const p = U.positions().find(x => x.v.id === el.dataset.id); if (!p) return;
    U.sheet(`${M.esc(p.v.code)} · ${M.esc(M.L(p.v.plate))}`, U.dl([[tt('الحالة', 'State'), `<span class="lg"><i style="background:${SC[p.state]}"></i>${tt(...stName[p.state])}</span>`], [tt('السرعة', 'Speed'), p.p ? `${M.n0(p.speed)} ${tt('كم/س', 'km/h')}` : '—'], [tt('السائق', 'Driver'), U.dLabel(p.driver)], [tt('الرحلة الحالية', 'Current trip'), p.trip ? `<a href="#trip.${p.trip.id}">${p.trip.number}</a> · ${U.routeTxt(p.trip.from, p.trip.to)}` : '—'], [tt('الحجز القادم', 'Next booking'), p.next ? `<a href="#trip.${p.next.id}">${p.next.number}</a> · ${M.date(p.next.date)} ${p.next.startTime}` : '—'], [tt('آخر موقع', 'Last fix'), p.at || '—'], [tt('جهاز التتبع', 'Tracker'), p.dev ? `<span class="mono">${M.esc(p.dev.imei)}</span> ${U.status(p.dev.status)}` : tt('غير مربوط', 'Not linked')], [tt('الإحداثيات', 'Coordinates'), p.lat != null ? `<span class="mono">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span> · <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=15/${p.lat}/${p.lng}" target="_blank" rel="noopener">${tt('فتح الخريطة', 'Open map')}</a>` : '—']]) + `<div class="actions" style="margin-top:14px"><a class="btn secondary" href="#vehicle.${p.v.id}">${tt('ملف المركبة', 'Vehicle file')}</a><a class="btn secondary" href="#history" data-act="hist-go" data-id="${p.v.id}">${tt('سجل المسار', 'Route history')}</a></div>`, U.vtype(p.v.type));
  });

  /* history / playback from stored GPS positions */
  let histVehicle = null, histDate = null;
  U.act('hist-go', el => { histVehicle = el.dataset.id; histDate = M.TODAY; U.closeOverlays(); location.hash = 'history'; });
  U.act('hist-veh', el => { histVehicle = el.value; U.render(); });
  U.act('hist-date', el => { histDate = el.value; U.render(); });
  U.route('history', () => {
    const db = U.db();
    const vs = db.vehicles.filter(v => v.status !== 'sold');
    if (!vs.length) return U.head(tt('سجل المسارات', 'Route history'), '') + U.empty('route', tt('لا توجد مركبات', 'No vehicles'));
    const v = vs.find(x => x.id === histVehicle) || vs[0]; histVehicle = v.id; const date = histDate || M.TODAY;
    U.onMount(async () => {
      const box = document.getElementById('hist-body');
      let data;
      try { data = await M.api.get(`/api/history?vehicleId=${encodeURIComponent(v.id)}&date=${encodeURIComponent(date)}`); } catch (e) { box.innerHTML = U.empty('alert', tt('تعذر تحميل المسار', 'Could not load the route'), M.esc(e.msg ? tt(e.msg.ar, e.msg.en) : e.message)); return; }
      const pts = data.points || [];
      if (pts.length < 2) { box.innerHTML = U.empty('route', tt('لا توجد مواقع GPS مسجلة لهذه المركبة في هذا اليوم', 'No GPS positions recorded for this vehicle on this day'), tt('المواقع تُستقبل من مزود التتبع عبر الـ API.', 'Positions are received from the GPS provider through the API.')); return; }
      let km = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; km += 2 * R * Math.asin(Math.sqrt(x)); }
      const stops = pts.filter((p, i) => i > 0 && i < pts.length - 1 && p.speed <= 2 && pts[i - 1].speed > 2);
      const tripsDay = db.trips.filter(t => t.vehicleId === v.id && t.date === date && t.status === 'completed');
      const odoKm = M.sum(tripsDay, t => t.km);
      const path = pts.map((p, i) => { const [x, y] = px(p.lat, p.lng); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join(' ');
      box.innerHTML = U.kpis([U.kpi(tt('كم بالـ GPS', 'GPS km'), M.n1(km)), U.kpi(tt('كم بالعداد (رحلات مكتملة)', 'Odometer km (completed trips)'), M.n0(odoKm), odoKm ? `${tt('فرق', 'diff')} ${M.pct((km - odoKm) / odoKm)}` : ''), U.kpi(tt('أقصى سرعة', 'Top speed'), `${M.n0(Math.max(...pts.map(p => p.speed || 0)))} <small>${tt('كم/س', 'km/h')}</small>`), U.kpi(tt('توقفات', 'Stops'), stops.length), U.kpi(tt('نقاط GPS', 'GPS points'), pts.length)]) +
        `<div class="cols-2-1">` + U.card(`${M.esc(v.code)} · ${M.date(date)}`, `<div class="map-wrap"><svg direction="ltr" viewBox="0 0 ${W} ${H}">${baseMap()}<path d="${path}" fill="none" stroke="#08264A" stroke-width="3" stroke-linejoin="round"/>${stops.map(s => { const [x, y] = px(s.lat, s.lng); return `<circle cx="${x}" cy="${y}" r="5" fill="#B45309" stroke="#fff" stroke-width="1.5"><title>${s.at}</title></circle>`; }).join('')}<circle id="hist-marker" r="8" fill="#15803D" stroke="#fff" stroke-width="2.5"/></svg></div><div class="actions" style="padding:12px 16px"><button class="btn sm" id="hist-play">${U.icon('arrow', 'flip')}${tt('تشغيل', 'Play')}</button><input type="range" id="hist-slider" min="0" max="${pts.length - 1}" value="0" style="flex:1;accent-color:#08264A" aria-label="${tt('موضع المسار', 'Route position')}"><b class="num" id="hist-speed"></b></div>`, { flush: true }) +
        U.card(tt('السرعة على مدار اليوم', 'Speed through the day'), `<div class="chart-box" id="ch-speed"></div>` + (data.events || []).map(e => `<div class="list-row"><span class="sev ${e.severity}"></span><div class="grow">${tt(...(U.evNames[e.type] || [e.type, e.type]))} · <span class="num">${e.time}</span>${e.value ? ` · <span class="num">${e.value}</span>` : ''}</div></div>`).join('')) + `</div>`;
      U.drawChart(document.getElementById('ch-speed'), { type: 'line', label: 'speed', data: { labels: pts.map(p => p.at.slice(11, 16)), datasets: [{ label: tt('كم/س', 'km/h'), data: pts.map(p => p.speed), fill: true, color: '#08264A', pointRadius: 0 }] } });
      const sl = document.getElementById('hist-slider'), mk = document.getElementById('hist-marker'), sp = document.getElementById('hist-speed');
      const upd = () => { const p = pts[+sl.value]; const [x, y] = px(p.lat, p.lng); mk.setAttribute('cx', x); mk.setAttribute('cy', y); sp.textContent = `${p.at.slice(11, 16)} · ${M.n0(p.speed)} ${tt('كم/س', 'km/h')}`; };
      sl.addEventListener('input', upd); upd();
      let playing = null; document.getElementById('hist-play').addEventListener('click', () => { if (playing) { clearInterval(playing); playing = null; return; } playing = setInterval(() => { sl.value = (+sl.value + 1) % pts.length; upd(); if (+sl.value === pts.length - 1) { clearInterval(playing); playing = null; } }, 150); U.timers.push(playing); });
    });
    return U.head(tt('سجل المسارات', 'Route history'), tt('إعادة تشغيل المسار من مواقع GPS المسجلة مع السرعة والتوقفات، ومقارنة كم GPS بالعداد.', 'Replay the route from recorded GPS positions with speed and stops, and compare GPS km with the odometer.'), `<select class="select" data-change="hist-veh" aria-label="${tt('المركبة', 'Vehicle')}">${vs.map(x => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>${M.esc(x.code)} · ${M.esc(M.L(x.plate))}</option>`).join('')}</select><input type="date" class="select" data-change="hist-date" value="${date}" max="${M.TODAY}" aria-label="${tt('التاريخ', 'Date')}">`) + `<div id="hist-body">${U.empty('clock', tt('جاري التحميل…', 'Loading…'))}</div>`;
  });

  U.route('geofences', () => {
    const db = U.db();
    const kind = M.placeKinds;
    const visits = g => db.trips.filter(t => (t.from === g.code || t.to === g.code) && t.status === 'completed' && t.date >= M.addDays(M.TODAY, -30)).length;
    const enters = g => db.events.filter(e => e.type === 'geofence_enter' && e.place === g.code && e.date >= M.addDays(M.TODAY, -30)).length;
    const canEdit = ['super_admin', 'company_admin', 'fleet_manager', 'operations'].includes(M.state.role);
    return U.head(tt('المناطق الجغرافية والأماكن', 'Geofences & places'), tt('كل مكان (مطار، فندق، موقع سياحي، جراج) له نصف قطر. دخول وخروج المركبة يتسجل تلقائياً من مواقع GPS، والمناطق المحظورة تعمل تنبيه عالي.', 'Every place (airport, hotel, site, garage) has a radius. Vehicle entry and exit are logged automatically from GPS positions, and restricted zones raise a high alert.'), canEdit ? U.btn(tt('مكان / منطقة جديدة', 'New place / geofence'), 'geo-new', '', 'plus') : '') +
      `<div class="cols-2-1">` + U.card(null, U.table({ id: 'geo', rows: db.geofences, columns: [{ label: tt('المنطقة', 'Zone'), value: g => M.L(g.name), render: g => `<b>${M.esc(M.L(g.name))}</b><div class="cell-sub mono">${M.esc(g.code)}</div>` }, { label: tt('النوع', 'Type'), value: g => g.kind, render: g => tt(...(kind[g.kind] || [g.kind, g.kind])) }, { label: tt('نصف القطر', 'Radius'), num: 1, value: g => g.radiusM, render: g => `${M.n0(g.radiusM)} ${tt('م', 'm')}` }, { label: tt('رحلات 30 يوم', 'Trips 30d'), num: 1, value: g => visits(g) }, { label: tt('دخول GPS 30 يوم', 'GPS entries 30d'), num: 1, value: g => enters(g) }, { label: tt('الحالة', 'Status'), value: g => g.active ? 1 : 0, render: g => g.active ? U.status('active') : U.badge(tt('موقوفة', 'Disabled'), 'muted') }, { label: '', sort: false, render: g => canEdit ? `<button class="btn ghost sm" data-act="geo-edit" data-id="${g.id}">${tt('تعديل', 'Edit')}</button>` : '' }] }), { flush: true }) +
      U.card(tt('الخريطة', 'Map'), `<div class="map-wrap" style="border-radius:8px"><svg direction="ltr" viewBox="0 0 ${W} ${H}">${baseMap()}${db.geofences.filter(g => g.active).map(g => { const [x, y] = px(g.lat, g.lng); return `<circle cx="${x}" cy="${y}" r="${Math.max(5, g.radiusM / 300)}" fill="${g.kind === 'restricted' ? '#B91C1C' : '#08264A'}" fill-opacity=".15" stroke="${g.kind === 'restricted' ? '#B91C1C' : '#08264A'}" stroke-width="1.2"><title>${M.esc(M.L(g.name))}</title></circle>`; }).join('')}</svg></div>`) + `</div><div style="height:16px"></div>` +
      U.card(tt('المسافات بين الأماكن', 'Distances between places'), U.table({ id: 'routes', rows: M.allRoutes || [], columns: [{ label: tt('الفرع', 'Base'), value: r => r.base }, { label: tt('المسار', 'Route'), value: r => U.routeTxt(r.from, r.to) }, { label: tt('النوع', 'Type'), value: r => M.L(M.tripTypes[r.type]) }, { label: tt('كم', 'km'), num: 1, value: r => r.km }, { label: tt('ساعات', 'Hours'), num: 1, value: r => r.hours }, { label: tt('بوابات كارتة', 'Toll gates'), num: 1, value: r => r.gates }, { label: '', sort: false, render: r => canEdit ? `<button class="btn ghost sm" data-act="route-del" data-id="${r.id}">${tt('حذف', 'Delete')}</button>` : '' }] }), { flush: true, actions: canEdit ? U.btn(tt('مسار جديد', 'New route'), 'route-new', 'secondary sm', 'plus') : '' });
  });
  const geoFields = g => { g = g || {}; return [g.id ? null : { f: 'code', label: tt('الكود (حروف إنجليزية كبيرة)', 'Code (capital letters)'), req: true, attrs: 'dir="ltr" maxlength="12" pattern="[A-Z0-9-]+"' }, { f: 'name', label: tt('الاسم', 'Name'), value: g.name ? M.L(g.name) : '', req: true }, { f: 'kind', label: tt('النوع', 'Type'), type: 'select', value: g.kind || 'site', options: Object.entries(M.placeKinds).filter(([k]) => M.has({ airport: 'tourism', hotel: 'tourism' }[k]) || k === g.kind).map(([k, v]) => [k, tt(...v)]) }, { f: 'lat', label: tt('خط العرض', 'Latitude'), type: 'number', value: g.lat, req: true, attrs: 'step="0.000001" min="-90" max="90"' }, { f: 'lng', label: tt('خط الطول', 'Longitude'), type: 'number', value: g.lng, req: true, attrs: 'step="0.000001" min="-180" max="180"' }, { f: 'radiusM', label: tt('نصف القطر (متر)', 'Radius (m)'), type: 'number', value: g.radiusM || 500, attrs: 'min="20" max="50000"' }, g.id ? { f: 'active', label: tt('مفعّلة', 'Active'), type: 'checkbox', value: g.active } : null]; };
  U.act('geo-new', () => U.formModal(tt('مكان / منطقة جديدة', 'New place / geofence'), geoFields(), 'place.create', { map: d => Object.assign(d, { code: String(d.code || '').toUpperCase() }) }));
  U.act('geo-edit', el => { const g = U.find('geofences', el.dataset.id); U.formModal(tt('تعديل المكان', 'Edit place'), geoFields(g), 'place.update', { map: d => Object.assign(d, { id: g.id }) }); });
  U.act('route-new', () => { const pts = Object.keys(M.places).map(k => [k, U.place(k)]); U.formModal(tt('مسار جديد', 'New route'), [{ f: 'baseCity', label: tt('الفرع/المدينة الأساسية', 'Base city'), type: 'select', options: U.db().branches.map(b => [b.city, M.L(b.name)]) }, { f: 'from', label: tt('من', 'From'), type: 'select', options: pts, req: true }, { f: 'to', label: tt('إلى', 'To'), type: 'select', options: pts, req: true }, { f: 'type', label: tt('النوع', 'Type'), type: 'select', options: Object.keys(M.tripTypes).map(k => [k, M.L(M.tripTypes[k])]) }, { f: 'km', label: tt('المسافة (كم)', 'Distance (km)'), type: 'number', req: true, attrs: 'min="1"' }, { f: 'hours', label: tt('المدة (ساعات)', 'Duration (hours)'), type: 'number', req: true, attrs: 'min="0.1" step="0.1"' }, { f: 'tollGates', label: tt('عدد بوابات الكارتة', 'Toll gates'), type: 'number', value: 0, attrs: 'min="0"' }], 'route.create'); });
  U.act('route-del', el => U.confirm(tt('حذف المسار', 'Delete route'), tt('هل تريد حذف هذا المسار من القائمة المرجعية؟', 'Delete this route from the reference list?'), () => U.run('route.delete', { id: el.dataset.id }, { ok: tt('تم الحذف', 'Deleted') }), { danger: true }));

  U.route('behavior', () => {
    const cid = U.cid(), db = U.db();
    const rows = db.drivers.filter(d => d.status === 'active').map(d => ({ d, s: C.driverStats(cid, d, M.addDays(M.TODAY, -90)) })).sort((a, b) => b.s.score - a.s.score);
    const by = Object.keys(U.evNames).map(k => [k, db.events.filter(e => e.type === k && e.date >= M.addDays(M.TODAY, -90)).length]);
    return U.head(tt('سلوك السائقين', 'Driver behavior'), tt('تقييم أمان من 0 لـ 100 بأوزان واضحة: تجاوز السرعة 4، فرملة 3، خارج المواعيد 3، تسارع 2، انحراف 2، دوران المحرك 1، تحرك بدون رحلة 8 — لكل 1000 كم.', 'Safety score 0–100 with clear weights per 1,000 km: overspeed 4, harsh braking 3, after hours 3, harsh acceleration 2, deviation 2, idling 1, unauthorized 8.')) +
      `<div class="cols-2-1">` + U.card(null, U.table({ id: 'beh', rows, columns: [{ label: '#', num: 1, value: r => rows.indexOf(r) + 1 }, { label: tt('السائق', 'Driver'), value: r => M.L(r.d.name), render: r => U.dLabel(r.d) }, { label: tt('كم (90 يوم)', 'km (90d)'), num: 1, value: r => r.s.km, render: r => M.n0(r.s.km) }, { label: tt('أحداث', 'Events'), num: 1, value: r => r.s.events }, { label: tt('تجاوز سرعة', 'Overspeed'), num: 1, value: r => r.s.eventsByType.overspeed || 0 }, { label: tt('فرملة عنيفة', 'Harsh braking'), num: 1, value: r => r.s.eventsByType.harsh_brake || 0 }, { label: tt('التقييم', 'Score'), num: 1, value: r => r.s.score, render: r => `<span class="score ${r.s.score >= 85 ? 'g' : r.s.score >= 70 ? 'w' : 'b'}">${r.s.score}</span>` }], onRow: r => 'driver.' + r.d.id }), { flush: true }) +
      U.card(tt('الأحداث حسب النوع', 'Events by type'), U.chart('ch-ev', { type: 'bar', label: 'events', data: { labels: by.map(b => tt(...U.evNames[b[0]])), datasets: [{ label: tt('العدد', 'Count'), data: by.map(b => b[1]) }] }, options: { indexAxis: 'y' } })) + `</div>`;
  });

  U.route('devices', () => {
    const db = U.db();
    const canEdit = ['super_admin', 'company_admin', 'fleet_manager', 'maintenance', 'operations'].includes(M.state.role);
    return U.head(tt('أجهزة التتبع', 'Tracking devices'), tt('أي مزود GPS يرسل المواقع لواجهة MOTUS بالـ IMEI أو المركبة. الجهاز يظهر "غير متصل" لو مفيش إشارة خلال 30 دقيقة.', 'Any GPS provider sends positions to the MOTUS API by IMEI or vehicle. A device shows offline when no signal arrived in 30 minutes.'), canEdit ? U.btn(tt('ربط جهاز', 'Link device'), 'dev-new', '', 'plus') : '') +
      U.card(null, U.table({ id: 'devices', rows: db.devices, emptyTitle: tt('لا توجد أجهزة مربوطة', 'No devices linked'), emptyText: ' ', columns: [{ label: 'IMEI', value: d => d.imei, render: d => `<span class="mono">${M.esc(d.imei)}</span>` }, { label: tt('المزود', 'Provider'), value: d => d.provider }, { label: 'SIM', value: d => d.sim, render: d => `<span class="ltr">${M.esc(d.sim)}</span>` }, { label: tt('المركبة', 'Vehicle'), value: d => U.find('vehicles', d.vehicleId).code, render: d => `<a href="#vehicle.${d.vehicleId}">${M.esc(U.find('vehicles', d.vehicleId).code)}</a>` }, { label: tt('تاريخ التركيب', 'Installed'), value: d => d.installDate, render: d => M.date(d.installDate) }, { label: tt('آخر إشارة', 'Last signal'), value: d => d.lastSignal || '', render: d => d.lastSignal ? `<span class="num">${d.lastSignal}</span>` : '—' }, { label: tt('الحالة', 'Status'), value: d => d.status, render: d => U.status(d.status) }, { label: '', sort: false, render: d => canEdit ? `<button class="btn ghost sm" data-act="dev-edit" data-id="${d.id}">${tt('تعديل', 'Edit')}</button><button class="btn ghost sm" data-act="dev-del" data-id="${d.id}">${tt('فك', 'Unlink')}</button>` : '' }] }), { flush: true });
  });
  const devFields = d => { d = d || {}; return [d.id ? null : { f: 'imei', label: 'IMEI', req: true, attrs: 'dir="ltr" inputmode="numeric"' }, { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', value: d.vehicleId, options: U.db().vehicles.filter(v => v.status !== 'sold' && (!U.db().devices.some(x => x.vehicleId === v.id) || v.id === d.vehicleId)).map(v => [v.id, `${v.code} · ${M.L(v.plate)}`]), req: true }, { f: 'provider', label: tt('مزود التتبع', 'GPS provider'), value: d.provider }, { f: 'sim', label: tt('رقم الشريحة', 'SIM number'), value: d.sim, attrs: 'dir="ltr"' }, d.id ? null : { f: 'installDate', label: tt('تاريخ التركيب', 'Install date'), type: 'date', value: M.TODAY }]; };
  U.act('dev-new', () => U.formModal(tt('ربط جهاز تتبع', 'Link tracking device'), devFields(), 'device.create'));
  U.act('dev-edit', el => { const d = U.find('devices', el.dataset.id); U.formModal(tt('تعديل الجهاز', 'Edit device'), devFields(d), 'device.update', { map: x => Object.assign(x, { id: d.id }) }); });
  U.act('dev-del', el => U.confirm(tt('فك الجهاز', 'Unlink device'), tt('سيتم فك الجهاز من المركبة. المواقع المسجلة تبقى.', 'The device will be unlinked from the vehicle. Recorded positions are kept.'), () => U.run('device.delete', { id: el.dataset.id }, { ok: tt('تم', 'Done') }), { danger: true }));
})();
