/* Dashboard, alerts and fleet pages (vehicles, drivers, fuel, oil, work orders, tires). */
'use strict';
(function () {
  const U = M.ui, C = M.calc, tt = M.tt;

  /* ================= DASHBOARD ================= */
  U.route('dashboard', () => {
    const cid = U.cid(), db = U.db(), P = U.periodRange();
    if (!db.vehicles.length) return U.head(tt('لوحة التحكم', 'Executive dashboard'), M.esc(M.L(U.company().name))) + U.gettingStarted();
    const pl = C.fleetPL(cid, P.from, P.to);
    const capital = M.sum(db.vehicles, v => v.purchasePrice), book = M.sum(db.vehicles, v => C.dep(v).book);
    const ag = C.aging(cid);
    const series = C.monthlySeries(cid);
    const openBk = db.bookings.filter(b => b.date >= M.TODAY && b.status !== 'cancelled' && b.status !== 'done');
    const inMaint = db.vehicles.filter(v => v.status === 'maintenance').length;
    const rows = pl.rows.slice().sort((a, b) => b.net - a.net);
    const today = db.trips.filter(t => (t.date === M.TODAY || t.date === M.addDays(M.TODAY, 1)) && t.status !== 'cancelled').sort((a, b) => (a.date + a.startTime) < (b.date + b.startTime) ? -1 : 1);
    const alerts = C.alerts(cid);
    const costParts = [['fuel', tt('وقود', 'Fuel')], ['oil', tt('زيت', 'Oil')], ['maintenance', tt('صيانة', 'Maintenance')], ['driver', tt('سائقين', 'Drivers')], ['tripExp', tt('مصاريف رحلات', 'Trip expenses')], ['licIns', tt('رخص وتأمين', 'License & insurance')], ['depreciation', tt('إهلاك', 'Depreciation')]];
    const types = C.typePL(cid, P.from, P.to);
    return U.head(tt('لوحة التحكم', 'Executive dashboard'), `${M.L(U.company().name)} · ${P.label}: ${M.date(P.from)} – ${M.date(P.to)}`, U.periodSeg()) +
      U.kpis([
        U.kpi(tt('عدد الأسطول', 'Fleet size'), M.n0(db.vehicles.length), `${inMaint} ${tt('في الصيانة', 'in workshop')}`),
        U.kpi(tt('رأس المال المستثمر', 'Capital invested'), M.moneyK(capital), tt('سعر شراء المركبات', 'Vehicle purchase cost')),
        U.kpi(tt('القيمة الدفترية الحالية', 'Current book value'), M.moneyK(book), `${M.pct(book / capital, 0)} ${tt('من رأس المال', 'of capital')}`),
        U.kpi(tt('الإيراد', 'Revenue'), M.moneyK(pl.total.revenue), `${M.n0(pl.total.trips)} ${tt('رحلة', 'trips')} · ${M.n0(pl.total.km)} ${tt('كم', 'km')}`),
        U.kpi(tt('تكاليف التشغيل', 'Operating costs'), M.moneyK(pl.total.costs), tt('شاملة الإهلاك', 'incl. depreciation')),
        U.kpi(tt('صافي الربح', 'Net profit'), `<span class="${pl.total.net < 0 ? 'delta-down' : ''}">${M.moneyK(pl.total.net)}</span>`, `${tt('هامش', 'Margin')} ${M.pct(pl.total.margin)}`),
        U.kpi(tt('نسبة التشغيل', 'Fleet utilization'), M.pct(pl.total.util, 0), tt('أيام تشغيل ÷ أيام متاحة', 'operating ÷ available days')),
        U.kpi(tt('حجوزات قادمة', 'Upcoming bookings'), M.n0(openBk.length), `${db.bookings.filter(b => b.unassigned).length} ${tt('بدون مركبة', 'unassigned')}`),
        U.kpi(tt('مستحقات العملاء', 'Receivables'), M.moneyK(ag.total), `${M.moneyK(ag.b30 + ag.b60 + ag.b90)} ${tt('متأخرة +30 يوم', 'over 30 days')}`),
      ]) +
      `<div class="cols-2-1">` +
      U.card(tt('الإيراد مقابل التكاليف شهرياً', 'Monthly revenue vs costs'), U.chart('ch-rev', { type: 'bar', label: 'revenue vs costs', data: { labels: series.map(s => M.monthName(s.ym)), datasets: [{ label: tt('الإيراد', 'Revenue'), data: series.map(s => Math.round(s.revenue)), color: '#08264A' }, { label: tt('التكاليف', 'Costs'), data: series.map(s => Math.round(s.costs)), color: '#8FA3BA' }, { type: 'line', label: tt('صافي الربح', 'Net profit'), data: series.map(s => Math.round(s.net)), borderColor: '#15803D', backgroundColor: '#15803D', borderWidth: 2, pointRadius: 3, tension: .3 }] } }), { hint: tt('أكتوبر حتى أمس', 'October is month to date') }) +
      U.card(tt('توزيع التكاليف', 'Cost breakdown'), U.chart('ch-cost', { type: 'doughnut', label: 'cost breakdown', data: { labels: costParts.map(c => c[1]), datasets: [{ data: costParts.map(c => Math.round(pl.total[c[0]])), colors: ['#08264A', '#2C4A6E', '#3E5F84', '#5A7493', '#8FA3BA', '#C3CFDC', '#DCE2EA'] }] }, options: { cutout: '62%', plugins: { legend: { display: true, position: 'bottom' } } } })) +
      `</div><div style="height:16px"></div><div class="cols-2">` +
      U.card(tt('صافي الربح لكل مركبة', 'Net profit by vehicle'), U.chart('ch-veh', { type: 'bar', size: 'tall', label: 'profit by vehicle', data: { labels: rows.map(r => r.v.code), datasets: [{ label: tt('صافي الربح', 'Net profit'), data: rows.map(r => Math.round(r.net)), colors: rows.map(r => r.net < 0 ? '#B91C1C' : '#08264A') }] }, options: { indexAxis: 'y' } }), { hint: tt('الأحمر = خسارة في الفترة', 'Red = loss in the period') }) +
      U.card(tt('الربح حسب نوع المركبة', 'Profit by vehicle type'), U.chart('ch-type', { type: 'bar', size: 'tall', label: 'profit by type', data: { labels: types.map(t => U.vtype(t.type)), datasets: [{ label: tt('الإيراد', 'Revenue'), data: types.map(t => Math.round(t.revenue)), color: '#8FA3BA' }, { label: tt('صافي الربح', 'Net profit'), data: types.map(t => Math.round(t.net)), colors: types.map(t => t.net < 0 ? '#B91C1C' : '#08264A') }] } })) +
      `</div><div style="height:16px"></div><div class="cols-3">` +
      U.card(tt('الأعلى ربحاً', 'Top 5 by profit'), rows.slice(0, 5).map(r => `<div class="list-row"><div class="grow"><div class="t"><a href="#vehicle.${r.v.id}">${r.v.code}</a> · ${U.vtype(r.v.type)}</div><div class="s">${M.L(r.v.plate)} · ${M.pct(r.util, 0)} ${tt('تشغيل', 'utilized')}</div></div><b class="num">${M.money(r.net)}</b></div>`).join('')) +
      U.card(tt('الأقل ربحاً', 'Bottom 5 by profit'), rows.slice(-5).reverse().map(r => `<div class="list-row"><div class="grow"><div class="t"><a href="#vehicle.${r.v.id}">${r.v.code}</a> · ${U.vtype(r.v.type)}</div><div class="s">${M.L(r.v.plate)} · ${M.pct(r.util, 0)} ${tt('تشغيل', 'utilized')}</div></div><b class="num ${r.net < 0 ? 'delta-down' : ''}">${M.money(r.net)}</b></div>`).join('')) +
      U.card(tt('أحدث التنبيهات', 'Latest alerts'), alerts.slice(0, 6).map(a => `<div class="list-row"><span class="sev ${a.sev}"></span><div class="grow"><div class="t">${tt(a.title[0], a.title[1])}</div><div class="s">${tt(a.detail[0], a.detail[1])}</div></div></div>`).join('') + `<a class="btn ghost sm" href="#alerts" style="margin-top:8px">${tt('كل التنبيهات', 'All alerts')} (${alerts.length})</a>`) +
      `</div><div style="height:16px"></div>` +
      U.card(tt('رحلات اليوم وبكرة', 'Trips today and tomorrow'), U.table({ id: 'dash-today', rows: today, pageSize: 8, export: false, columns: [
        { label: tt('التاريخ', 'Date'), value: t => t.date + t.startTime, render: t => `${t.date === M.TODAY ? tt('اليوم', 'Today') : tt('بكرة', 'Tomorrow')} <span class="num">${t.startTime}</span>` },
        { label: tt('الرحلة', 'Trip'), value: t => t.number, render: t => `<a href="#trip.${t.id}">${t.number}</a>` },
        { label: tt('المسار', 'Route'), value: t => U.routeTxt(t.from, t.to), render: t => U.routeTxt(t.from, t.to) },
        { label: tt('المركبة', 'Vehicle'), value: t => U.find('vehicles', t.vehicleId).code, render: t => U.vLabel(U.find('vehicles', t.vehicleId)) },
        { label: tt('السائق', 'Driver'), value: t => M.L(U.find('drivers', t.driverId).name), render: t => U.dLabel(U.find('drivers', t.driverId)) },
        { label: tt('الحالة', 'Status'), value: t => t.status, render: t => U.status(t.status) },
      ], onRow: t => 'trip.' + t.id }), { flush: true, actions: `<a class="btn secondary sm" href="#dispatch">${tt('لوحة التوزيع', 'Dispatch board')}</a>` });
  });

  /* ================= ALERTS ================= */
  const catNames = { docs: ['المستندات', 'Documents'], oil: ['الزيت', 'Oil'], life: ['العمر الافتراضي', 'Useful life'], profit: ['الربحية', 'Profitability'], maintenance: ['الصيانة', 'Maintenance'], fuel: ['الوقود', 'Fuel'], stock: ['المخزون', 'Stock'], tires: ['الكاوتش', 'Tires'], finance: ['المالية', 'Finance'], integration: ['التكاملات', 'Integrations'], providers: ['مزودي الخدمة', 'Providers'], tracking: ['التتبع', 'Tracking'], dispatch: ['الحركة', 'Dispatch'] };
  U.route('alerts', () => {
    const al = C.alerts(U.cid());
    const by = M.groupBy(al, a => a.cat);
    return U.head(tt('التنبيهات', 'Alerts'), tt('تتولد تلقائياً من البيانات حسب حدود الشركة في الإعدادات.', 'Generated from the data using this company’s thresholds in settings.')) +
      U.kpis([U.kpi(tt('عالية الأولوية', 'High priority'), `<span class="delta-down">${al.filter(a => a.sev === 'high').length}</span>`), U.kpi(tt('متوسطة', 'Medium'), al.filter(a => a.sev === 'medium').length), U.kpi(tt('الإجمالي', 'Total'), al.length)]) +
      U.card(null, U.table({ id: 'alerts', rows: al, pageSize: 25, sort: null, columns: [
        { label: tt('الأولوية', 'Priority'), value: a => a.sev, render: a => U.status(a.sev) },
        { label: tt('النوع', 'Category'), value: a => tt(...catNames[a.cat]), render: a => tt(...catNames[a.cat]) },
        { label: tt('التنبيه', 'Alert'), value: a => tt(a.title[0], a.title[1]), render: a => `<b>${tt(a.title[0], a.title[1])}</b>` },
        { label: tt('التفاصيل', 'Details'), value: a => tt(a.detail[0], a.detail[1]), render: a => tt(a.detail[0], a.detail[1]) },
        { label: '', sort: false, render: a => `<a class="btn ghost sm" href="#${a.link}">${tt('فتح', 'Open')}</a>` },
      ], filters: [{ label: tt('النوع', 'Category'), get: a => a.cat, options: [...by.keys()].map(k => [k, tt(...catNames[k])]) }, { label: tt('الأولوية', 'Priority'), get: a => a.sev, options: [['high', tt('عالية', 'High')], ['medium', tt('متوسطة', 'Medium')]] }] }), { flush: true });
  });

  /* ================= VEHICLES ================= */
  let vView = 'cards';
  U.act('vview', el => { vView = el.dataset.v; U.render(); });
  U.route('vehicles', () => {
    const cid = U.cid(), db = U.db(); const P = U.periodRange();
    const rows = db.vehicles.map(v => ({ v, pl: C.vehiclePL(cid, v.id, P.from, P.to), dep: C.dep(v), oil: C.oilStatus(cid, v) }));
    const view = vView === 'cards' ? `<div class="cards-grid">${rows.map(({ v, pl, dep }) => `<a class="card vehicle-card" href="#vehicle.${v.id}"><div class="vc-head"><div><div class="vc-plate">${M.L(v.plate)}</div><div class="muted small">${v.code} · ${U.vtype(v.type)} · ${v.make} ${v.model} ${v.year}</div></div>${U.status(v.status)}</div><div class="vc-stats"><div>${tt('العداد', 'Odometer')}<b>${M.n0(v.odometer)}</b></div><div>${tt('القيمة الدفترية', 'Book value')}<b>${M.moneyK(dep.book).replace(' ' + M.cur(), '')}</b></div><div>${tt('صافي الربح', 'Net profit')}<b class="${pl.net < 0 ? 'delta-down' : ''}">${M.moneyK(pl.net).replace(' ' + M.cur(), '')}</b></div></div><div>${U.progress(dep.pctLife, dep.pctLife > .9 ? 'bad' : dep.pctLife > .7 ? 'warn' : '')}<div class="muted small" style="margin-top:4px">${tt('العمر المستهلك', 'Life used')} ${M.pct(dep.pctLife, 0)}</div></div></a>`).join('')}</div>`
      : U.card(null, U.table({ id: 'veh', rows, columns: [
        { label: tt('المركبة', 'Vehicle'), value: r => r.v.code, render: r => U.vLabel(r.v) },
        { label: tt('الموديل', 'Model'), value: r => r.v.make + ' ' + r.v.model, render: r => `${r.v.make} ${r.v.model} <span class="muted">${r.v.year}</span>` },
        { label: tt('الحالة', 'Status'), value: r => r.v.status, render: r => U.status(r.v.status) },
        { label: tt('العداد (كم)', 'Odometer (km)'), num: 1, value: r => r.v.odometer, render: r => M.n0(r.v.odometer) },
        { label: tt('القيمة الدفترية', 'Book value'), num: 1, value: r => r.dep.book, render: r => M.money(r.dep.book) },
        { label: tt('الإيراد', 'Revenue'), num: 1, value: r => r.pl.revenue, render: r => M.money(r.pl.revenue) },
        { label: tt('صافي الربح', 'Net profit'), num: 1, value: r => r.pl.net, render: r => U.money(r.pl.net) },
        { label: tt('التشغيل', 'Utilization'), num: 1, value: r => r.pl.util, render: r => M.pct(r.pl.util, 0) },
        { label: tt('الزيت', 'Oil'), value: r => r.oil ? r.oil.remaining : 0, render: r => r.oil ? U.status(r.oil.state) : '—' },
      ], filters: [{ label: tt('النوع', 'Type'), get: r => r.v.type, options: Object.keys(M.vehicleClasses).map(k => [k, U.vtype(k)]) }, { label: tt('الحالة', 'Status'), get: r => r.v.status, options: [['active', U.statusText('active')], ['maintenance', U.statusText('maintenance')]] }, { label: tt('الفرع', 'Branch'), get: r => r.v.branchId, options: db.branches.map(b => [b.id, M.L(b.name)]) }], onRow: r => 'vehicle.' + r.v.id }), { flush: true });
    return U.head(tt('المركبات', 'Vehicles'), `${db.vehicles.length} ${tt('مركبة', 'vehicles')} · ${tt('أرباح', 'profit for')} ${P.label}`, `${U.periodSeg()}<div class="seg"><button data-act="vview" data-v="cards" class="${vView === 'cards' ? 'on' : ''}">${tt('بطاقات', 'Cards')}</button><button data-act="vview" data-v="table" class="${vView === 'table' ? 'on' : ''}">${tt('جدول', 'Table')}</button></div>${U.btn(tt('إضافة مركبة', 'Add vehicle'), 'add-vehicle', '', 'plus')}`) +
      U.kpis(Object.keys(M.vehicleClasses).map(t => { const vs = db.vehicles.filter(v => v.type === t); return U.kpi(U.vtype(t), vs.length, `${M.moneyK(M.sum(vs, v => v.purchasePrice))} ${tt('رأس مال', 'capital')}`); })) + view;
  });
  function vehicleFields(v) {
    const db = U.db(); v = v || {};
    const types = M.usableTypes();
    return [
      { f: 'plate', label: tt('رقم اللوحة', 'Plate number'), value: v.plate ? M.L(v.plate) : '', req: true, attrs: `placeholder="${M.esc(M.field('plate', ['', '']).placeholder || 'ن ق ط 1234')}"` },
      v.id ? null : { f: 'type', label: tt('النوع', 'Type'), type: 'select', options: types.map(k => [k, U.vtype(k)]), req: true },
      { f: 'make', label: tt('الماركة', 'Make'), value: v.make }, { f: 'model', label: tt('الموديل', 'Model'), value: v.model },
      { f: 'year', label: tt('سنة الصنع', 'Year'), type: 'number', value: v.year || +M.TODAY.slice(0, 4), attrs: 'min="1980" max="2100"' },
      { f: 'chassis', label: tt('رقم الشاسيه', 'Chassis'), value: v.chassis, attrs: 'dir="ltr"' },
      { f: 'color', label: tt('اللون', 'Color'), value: v.color ? M.tt(v.color[0], v.color[1]) : '' },
      { f: 'seats', label: tt('المقاعد', 'Seats'), type: 'number', value: v.seats, attrs: 'min="0" max="120"', help: v.id ? '' : tt('فارغ = من إعدادات النوع', 'Empty = from the type settings') },
      M.cargoTypes().length || (v.payloadKg || 0) > 0 ? { f: 'payloadKg', label: tt('الحمولة (كجم)', 'Payload (kg)'), type: 'number', value: v.payloadKg, attrs: 'min="0"', help: v.id ? '' : tt('فارغ = من إعدادات النوع', 'Empty = from the type settings') } : null,
      M.cargoTypes().length || (v.volumeM3 || 0) > 0 ? { f: 'volumeM3', label: tt('الحجم (م³)', 'Volume (m³)'), type: 'number', value: v.volumeM3, attrs: 'min="0" step="0.1"' } : null,
      { f: 'ownership', label: tt('الملكية', 'Ownership'), type: 'select', value: v.ownership || 'owned', options: [['owned', tt('مملوكة', 'Owned')], ['installment', tt('تقسيط', 'Installment')], ['leased', tt('مؤجرة', 'Leased')]] },
      { f: 'purchaseDate', label: tt('تاريخ الشراء', 'Purchase date'), type: 'date', value: v.purchaseDate || M.TODAY, req: true },
      { f: 'purchasePrice', label: tt('سعر الشراء (رأس المال)', 'Purchase price (capital)'), type: 'number', value: v.purchasePrice, req: true, attrs: 'min="0"' },
      { f: 'salvageValue', label: tt('قيمة الخردة المتوقعة', 'Expected salvage value'), type: 'number', value: v.salvageValue, attrs: 'min="0"', help: v.id ? '' : tt('فارغ = نسبة الخردة من إعدادات النوع', 'Empty = salvage % from the type settings') },
      { f: 'lifeYears', label: tt('العمر الافتراضي (سنين)', 'Useful life (years)'), type: 'number', value: v.lifeYears, attrs: 'min="1" step="0.5"' },
      { f: 'lifeKm', label: tt('العمر الافتراضي (كم)', 'Useful life (km)'), type: 'number', value: v.lifeKm, attrs: 'min="1000"' },
      { f: 'odometer', label: tt('العداد الحالي (كم)', 'Current odometer (km)'), type: 'number', value: v.odometer || 0, attrs: 'min="0"' },
      { f: 'licenseExpiry', label: tt('انتهاء الرخصة', 'License expiry'), type: 'date', value: v.licenseExpiry },
      { f: 'insuranceExpiry', label: tt('انتهاء التأمين', 'Insurance expiry'), type: 'date', value: v.insuranceExpiry },
      { f: 'insuranceAnnual', label: tt('التأمين السنوي', 'Annual insurance'), type: 'number', value: v.insuranceAnnual, attrs: 'min="0"' },
      { f: 'licenseAnnual', label: tt('الرخصة السنوية', 'Annual license fees'), type: 'number', value: v.licenseAnnual, attrs: 'min="0"' },
      { f: 'tankL', label: tt('سعة التانك (لتر)', 'Tank size (L)'), type: 'number', value: v.tankL, attrs: 'min="0"' },
      { f: 'branchId', label: tt('الفرع', 'Branch'), type: 'select', value: v.branchId, options: db.branches.map(b => [b.id, M.L(b.name)]) },
      { f: 'driverId', label: tt('السائق المخصص', 'Assigned driver'), type: 'select', value: v.driverId || '', options: [['', '—'], ...db.drivers.filter(d => d.status === 'active').map(d => [d.id, `${M.L(d.name)}${d.vehicleId && d.vehicleId !== v.id ? ' (' + U.find('vehicles', d.vehicleId).code + ')' : ''}`])] },
      v.id ? { f: 'status', label: tt('الحالة', 'Status'), type: 'select', value: v.status, options: [['active', U.statusText('active')], ['maintenance', U.statusText('maintenance')], ['stopped', U.statusText('stopped')], ['sold', U.statusText('sold')]] } : null,
    ];
  }
  U.act('add-vehicle', () => {
    if (!M.usableTypes().length) { U.toast(tt('أضف أنواع المركبات من الإعدادات أولاً', 'Set up vehicle types in settings first')); return; }
    U.formModal(tt('إضافة مركبة', 'Add vehicle'), vehicleFields(), 'vehicle.create', { ok: r => tt('تمت إضافة المركبة ', 'Vehicle added ') + r.code, after: r => { location.hash = 'vehicle.' + r.id; U.full(); } });
  });
  U.act('edit-vehicle', el => { const v = U.find('vehicles', el.dataset.id); U.formModal(tt('تعديل المركبة', 'Edit vehicle'), vehicleFields(v), 'vehicle.update', { map: d => { d.id = v.id; d.color = d.color || ''; return d; } }); });

  /* ================= VEHICLE DETAIL ================= */
  let vTab = 'overview';
  U.act('vtab', el => { vTab = el.dataset.t; U.render(); });
  U.route('vehicle', id => {
    const cid = U.cid(), db = U.db(); const v = db.vehicles.find(x => x.id === id);
    if (!v) return U.empty('car', tt('المركبة غير موجودة في هذه الشركة', 'Vehicle not found in this company'));
    const dep = C.dep(v), cap = C.capital(cid, v), oil = C.oilStatus(cid, v);
    const drv = db.drivers.find(d => d.id === v.driverId);
    const life = C.vehiclePL(cid, v.id, C.lifeFrom(), C.lifeTo());
    const tabs = [['overview', tt('نظرة عامة', 'Overview')], ['capital', tt('رأس المال والإهلاك', 'Capital & depreciation')], ['trips', tt('الرحلات', 'Trips')], ['calendar', tt('التقويم', 'Calendar')], ['fuel', tt('المحروقات', 'Fuel')], ['maint', tt('الزيت والصيانة', 'Oil & maintenance')], ['tires', tt('الكاوتش', 'Tires')], ['pl', tt('الأرباح والخسائر', 'Profit & loss')]];
    const days = d => { const n = M.diffDays(d, M.TODAY); return n < 0 ? U.badge(tt(`منتهية منذ ${-n} يوم`, `Expired ${-n} days ago`), 'danger') : n <= 30 ? U.badge(tt(`باقي ${n} يوم`, `${n} days left`), 'warning') : U.badge(tt(`باقي ${n} يوم`, `${n} days left`), 'success'); };
    let body = '';
    if (vTab === 'overview') {
      const r = C.readiness(cid, v);
      body = `<div class="cols-2">` + U.card(tt('البيانات الأساسية', 'Details'), U.dl([
        [tt('اللوحة', 'Plate'), M.L(v.plate)], [tt('النوع', 'Type'), U.vtype(v.type)], [tt('الماركة والموديل', 'Make & model'), `${v.make} ${v.model}`], [tt('سنة الصنع', 'Year'), v.year], [tt('رقم الشاسيه', 'Chassis'), `<span class="mono">${v.chassis}</span>`], [tt('اللون', 'Color'), M.tt(v.color[0], v.color[1])],
        [tt('الفئة', 'Category'), U.catName((M.vehicleClasses[v.type] || {}).category)], [tt('المقاعد', 'Seats'), v.seats], (v.payloadKg || 0) > 0 ? [tt('الحمولة', 'Payload'), `${M.n0(v.payloadKg)} ${tt('كجم', 'kg')}${v.volumeM3 ? ` · ${M.n1(v.volumeM3)} ${tt('م³', 'm³')}` : ''}`] : null, [tt('الوقود', 'Fuel'), U.fuelName(v.fuel)], [tt('الملكية', 'Ownership'), U.status(v.ownership)], [tt('الفرع', 'Branch'), M.L(U.find('branches', v.branchId).name)],
        [tt('السائق المخصص', 'Assigned driver'), drv ? U.dLabel(drv) : '—'], [tt('العداد الحالي', 'Odometer'), `<span class="num">${M.n0(v.odometer)} ${tt('كم', 'km')}</span>`], [tt('مرجع ERP', 'ERP reference'), v.externalRef ? `<code>${v.externalRef}</code> ${U.status(v.syncStatus)}` : '—'],
      ])) + `<div class="grid">` + U.card(tt('المستندات', 'Documents'), U.dl([[tt('انتهاء الرخصة', 'License expiry'), `${M.date(v.licenseExpiry)} ${days(v.licenseExpiry)}`], [tt('انتهاء التأمين', 'Insurance expiry'), `${M.date(v.insuranceExpiry)} ${days(v.insuranceExpiry)}`], [tt('التأمين السنوي', 'Annual insurance'), M.money(v.insuranceAnnual)], [tt('الرخصة السنوية', 'Annual license'), M.money(v.licenseAnnual)]])) +
        U.card(tt('جاهزية بكرة', 'Ready for tomorrow'), `${r.ready ? U.status('ready') : U.status('notready')}<div style="margin-top:8px">${r.reasons.length ? r.reasons.map(x => `<div class="list-row"><span class="sev medium"></span><div class="grow">${tt(x[0], x[1])}</div></div>`).join('') : `<span class="muted small">${tt('كل الفحوصات سليمة', 'All checks passed')}</span>`}</div>`) +
        U.card(`${tt('منذ', 'Since')} ${M.date(C.lifeFrom())}`, U.dl([[tt('الرحلات', 'Trips'), M.n0(life.trips)], [tt('الكيلومترات', 'Kilometers'), M.n0(life.km)], [tt('الإيراد', 'Revenue'), M.money(life.revenue)], [tt('صافي الربح', 'Net profit'), U.money(life.net)], [tt('نسبة التشغيل', 'Utilization'), M.pct(life.util, 0)], [tt('أيام الصيانة', 'Workshop days'), life.maintDays]])) + `</div></div>`;
    } else if (vTab === 'capital') {
      const beyond = cap.monthsToGo != null && cap.monthsToGo / 12 > dep.remainingYears;
      body = `<div class="cols-2">` + U.card(tt('الإهلاك (القسط الثابت)', 'Depreciation (straight line)'), U.dl([
        [tt('سعر الشراء (رأس المال)', 'Purchase price (capital)'), M.money(v.purchasePrice)], [tt('تاريخ الشراء', 'Purchase date'), M.date(v.purchaseDate)], [tt('قيمة الخردة المتوقعة', 'Expected salvage value'), M.money(v.salvageValue)], [tt('العمر الافتراضي', 'Useful life'), `${v.lifeYears} ${tt('سنوات', 'years')} · ${M.n0(v.lifeKm)} ${tt('كم', 'km')}`],
        [tt('الإهلاك السنوي', 'Annual depreciation'), M.money(dep.annual)], [tt('الإهلاك الشهري', 'Monthly depreciation'), M.money(dep.monthly)], [tt('الإهلاك المتراكم', 'Accumulated depreciation'), M.money(dep.accumulated)], [tt('القيمة الدفترية', 'Book value'), `<b>${M.money(dep.book)}</b>`],
      ]) + `<div class="muted small" style="margin-top:10px">${tt('الإهلاك السنوي = (سعر الشراء − قيمة الخردة) ÷ العمر بالسنين. القيمة الدفترية لا تقل عن قيمة الخردة.', 'Annual depreciation = (purchase price − salvage) ÷ useful life in years. Book value never drops below salvage.')}</div>`) +
        `<div class="grid">` + U.card(tt('العمر المستهلك', 'Life consumed'), `<div class="grid" style="gap:12px"><div><div class="small">${tt('بالسنين', 'By years')}: <b class="num">${M.pct(dep.pctYears, 0)}</b> · ${tt('متبقي', 'remaining')} ${M.n1(dep.remainingYears)} ${tt('سنة', 'yrs')}</div>${U.progress(dep.pctYears, dep.pctYears > .9 ? 'bad' : dep.pctYears > .7 ? 'warn' : '')}</div><div><div class="small">${tt('بالكيلومتر', 'By kilometers')}: <b class="num">${M.pct(dep.pctKm, 0)}</b> · ${tt('متبقي', 'remaining')} ${M.n0(dep.remainingKm)} ${tt('كم', 'km')}</div>${U.progress(dep.pctKm, dep.pctKm > .9 ? 'bad' : dep.pctKm > .7 ? 'warn' : '')}</div><div class="muted small">${tt('النظام يعتمد الأعلى بين النسبتين للتنبيه بنهاية العمر.', 'The higher of the two drives the end-of-life alert.')}</div></div>`) +
        U.card(tt('استرداد رأس المال', 'Capital recovery'), `<div class="small">${tt('صافي الربح المتراكم قبل الإهلاك مقابل سعر الشراء', 'Cumulative profit before depreciation vs purchase price')} ${cap.estimated ? U.est() : ''}</div><div class="kpi-value num" style="margin:6px 0">${M.pct(Math.min(cap.pct, 9.99), 0)}</div>${U.progress(cap.pct, cap.pct >= 1 ? 'good' : '')}` + U.dl([[tt('المسترد', 'Recovered'), M.money(Math.max(0, cap.recovered))], [tt('المتبقي', 'Remaining'), M.money(cap.remaining)], [tt('متوسط الربح الشهري (قبل الإهلاك)', 'Avg monthly profit before depreciation'), U.money(cap.monthly)], [tt('تاريخ الاسترداد المتوقع', 'Expected payback date'), cap.remaining <= 0 ? U.badge(tt('تم الاسترداد', 'Recovered'), 'success') : cap.paybackDate == null ? U.badge(tt('لا يسترد بالأداء الحالي', 'Not recovering at current results'), 'danger') : beyond ? `${M.date(cap.paybackDate)} ${U.badge(tt('بعد نهاية العمر الافتراضي', 'After end of useful life'), 'danger')}` : M.date(cap.paybackDate)]]) + `<div class="muted small" style="margin-top:8px">${cap.estimated ? tt(`الفترة من الشراء حتى ${M.date(C.lifeFrom())} (قبل بداية البيانات في النظام) محسوبة بمتوسط الربح الشهري الفعلي بعدها، وموسومة "تقدير".`, `The period from purchase to ${M.date(C.lifeFrom())} (before the system has data) is estimated from the actual monthly average since then, and labeled "Estimate".`) : tt('محسوب بالكامل من بيانات النظام.', 'Calculated entirely from system data.')}</div>`) + `</div></div>`;
    } else if (vTab === 'calendar') {
      /* unified calendar: everything that occupies this vehicle from yesterday to two weeks ahead */
      const items = ((db.calendar || {}).vehicles || []).filter(k => k.vehicleId === v.id);
      const kindTxt = k => ({ trip: tt('رحلة', 'Trip'), maintenance: tt('صيانة', 'Maintenance'), blocked: tt('محجوزة', 'Blocked') })[k] || k;
      const when = (a, b) => { const d1 = a.slice(0, 10), d2 = b.slice(0, 10); return `<span class="num">${M.date(d1)} ${a.slice(11, 16)} → ${d2 !== d1 ? M.date(d2) + ' ' : ''}${b.slice(11, 16)}</span>`; };
      body = U.card(tt('التزامات المركبة', 'Vehicle commitments'), items.length ? U.table({ id: 'vcal', rows: items, export: false, search: false, columns: [
        { label: tt('من → إلى', 'From → to'), value: k => k.from, render: k => when(k.from, k.to) },
        { label: tt('النوع', 'Kind'), value: k => k.kind, render: k => U.badge(kindTxt(k.kind)) },
        { label: tt('المرجع', 'Reference'), value: k => k.note, render: k => k.sourceType === 'trip' ? `<a href="#trip.${k.sourceId}">${M.esc(k.note)}</a>` : M.esc(k.note || '—') },
      ] }) : U.empty('calendar', tt('المركبة فاضية الأسبوعين الجايين', 'The vehicle is free for the next two weeks')), { hint: tt('من امبارح لأسبوعين قدام. أي التزام جديد بيتراجع على التقويم ده وماينفعش يتداخل مع التزام تاني.', 'From yesterday to two weeks ahead. Every new commitment is checked against this calendar and cannot overlap another.') });
    } else if (vTab === 'trips') {
      body = U.card(null, U.table({ id: 'vtrips', rows: db.trips.filter(t => t.vehicleId === v.id).sort((a, b) => a.date < b.date ? 1 : -1), columns: [
        { label: tt('التاريخ', 'Date'), value: t => t.date, render: t => M.date(t.date) }, { label: tt('رقم الرحلة', 'Trip'), value: t => t.number, render: t => `<a href="#trip.${t.id}">${t.number}</a>` },
        { label: tt('النوع', 'Type'), value: t => M.L(M.tripTypes[t.type]) }, { label: tt('المسار', 'Route'), value: t => U.routeTxt(t.from, t.to) },
        { label: tt('السائق', 'Driver'), value: t => M.L(U.find('drivers', t.driverId).name) }, { label: tt('كم', 'km'), num: 1, value: t => t.km, render: t => M.n0(t.km) },
        { label: tt('الإيراد', 'Revenue'), num: 1, value: t => t.revenue, render: t => M.money(t.revenue) }, { label: tt('الحالة', 'Status'), value: t => t.status, render: t => U.status(t.status) },
      ], onRow: t => 'trip.' + t.id }), { flush: true });
    } else if (vTab === 'fuel') {
      const fs = db.fuel.filter(f => f.vehicleId === v.id).sort((a, b) => a.date < b.date ? -1 : 1);
      const base = C.typeKmpl(cid, v.type);
      body = U.card(tt('اتجاه الاستهلاك (كم/لتر)', 'Fuel efficiency trend (km/L)'), U.chart('ch-vfuel', { type: 'line', label: 'km per liter', data: { labels: fs.map(f => M.date(f.date).slice(0, 5)), datasets: [{ label: tt('كم/لتر', 'km/L'), data: fs.map(f => f.kmSince ? +(f.kmSince / f.liters).toFixed(2) : null), color: '#08264A' }, { label: tt('متوسط النوع', 'Type average'), data: fs.map(() => base ? +base.toFixed(2) : null), borderDash: [6, 4], color: '#8FA3BA', pointRadius: 0 }] }, options: { scales: { y: { ticks: { callback: v => v } } } } })) + '<div style="height:16px"></div>' + U.card(null, fuelTable('vfuel', fs.slice().reverse()), { flush: true });
    } else if (vTab === 'maint') {
      const oils = db.oil.filter(o => o.vehicleId === v.id).sort((a, b) => a.date < b.date ? 1 : -1);
      const wos = db.workOrders.filter(w => w.vehicleId === v.id).sort((a, b) => a.date < b.date ? 1 : -1);
      body = U.kpis([U.kpi(tt('تغيير الزيت القادم', 'Next oil change'), oil ? `${M.n0(oil.nextKm)} <small>${tt('كم', 'km')}</small>` : '—', oil ? U.status(oil.state) + ' ' + (oil.remaining >= 0 ? `${tt('باقي', 'in')} ${M.n0(oil.remaining)} ${tt('كم', 'km')}` : `${tt('متأخر', 'over by')} ${M.n0(-oil.remaining)} ${tt('كم', 'km')}`) : ''), U.kpi(tt('تكلفة الصيانة (6 شهور)', 'Maintenance cost (6 months)'), M.moneyK(M.sum(wos, w => w.total || 0))), U.kpi(tt('أيام التعطل', 'Downtime days'), M.n0(M.sum(wos, w => w.downtimeDays || 0))), U.kpi(tt('أوامر الشغل', 'Work orders'), wos.length)]) +
        `<div class="cols-2">` + U.card(tt('سجل تغيير الزيت', 'Oil change history'), U.table({ id: 'voil', rows: oils, export: false, search: false, pageSize: 8, columns: [{ label: tt('التاريخ', 'Date'), value: o => o.date, render: o => M.date(o.date) }, { label: tt('العداد', 'Odometer'), num: 1, value: o => o.odometer, render: o => M.n0(o.odometer) }, { label: tt('الفلاتر', 'Filters'), value: o => o.filters.join(', '), render: o => o.filters.map(f => ({ oil: tt('زيت', 'oil'), air: tt('هواء', 'air'), fuel: tt('وقود', 'fuel') }[f])).join('، ') }, { label: tt('التكلفة', 'Cost'), num: 1, value: o => o.cost, render: o => M.money(o.cost) }] }), { flush: true }) +
        U.card(tt('أوامر الشغل', 'Work orders'), woTable('vwo', wos, true), { flush: true }) + `</div>`;
    } else if (vTab === 'tires') {
      body = tireBlock(v);
    } else if (vTab === 'pl') {
      const ms = C.months().map(ym => { const [a, b] = C.monthRange(ym); return Object.assign({ ym }, C.vehiclePL(cid, v.id, a, b)); });
      body = U.card(tt('صافي الربح الشهري', 'Monthly net profit'), U.chart('ch-vpl', { type: 'bar', label: 'monthly profit', data: { labels: ms.map(m => M.monthName(m.ym)), datasets: [{ label: tt('الإيراد', 'Revenue'), data: ms.map(m => Math.round(m.revenue)), color: '#8FA3BA' }, { label: tt('صافي الربح', 'Net profit'), data: ms.map(m => Math.round(m.net)), colors: ms.map(m => m.net < 0 ? '#B91C1C' : '#08264A') }] } })) + '<div style="height:16px"></div>' +
        U.card(tt('قائمة الأرباح والخسائر', 'Profit & loss statement'), plTable('vpl-t', ms), { flush: true });
    }
    return U.head(`${v.code} · ${M.L(v.plate)}`, `${U.vtype(v.type)} · ${v.make} ${v.model} ${v.year}`, `${U.status(v.status)} ${U.btn(tt('تعديل', 'Edit'), 'edit-vehicle', 'secondary', 'settings', `data-id="${v.id}"`)} ${U.btn(tt('تفويلة', 'Fill-up'), 'add-fuel', 'secondary', 'fuel', `data-v="${v.id}"`)} ${U.btn(tt('أمر شغل', 'Work order'), 'new-wo', 'secondary', 'wrench', `data-v="${v.id}"`)} ${U.btn(tt('رفع مستند', 'Upload document'), 'doc-upload', 'secondary', 'upload', `data-owner="vehicle" data-id="${v.id}"`)}`, [[tt('المركبات', 'Vehicles'), 'vehicles'], [v.code]]) +
      U.kpis([U.kpi(tt('القيمة الدفترية', 'Book value'), M.moneyK(dep.book), `${M.pct(dep.book / v.purchasePrice, 0)} ${tt('من سعر الشراء', 'of purchase price')}`), U.kpi(tt('العمر المستهلك', 'Life used'), M.pct(dep.pctLife, 0), U.progress(dep.pctLife, dep.pctLife > .9 ? 'bad' : '')), U.kpi(tt('استرداد رأس المال', 'Capital recovered'), M.pct(Math.min(cap.pct, 9.99), 0), cap.estimated ? U.est() : ''), U.kpi(tt('صافي الربح (منذ بداية البيانات)', 'Net profit (since data start)'), `<span class="${life.net < 0 ? 'delta-down' : ''}">${M.moneyK(life.net)}</span>`, `${tt('هامش', 'Margin')} ${M.pct(life.margin)}`), U.kpi(tt('كم/لتر', 'km/L'), M.n1(life.kmpl), `${tt('متوسط النوع', 'type avg')} ${M.n1(C.typeKmpl(cid, v.type))}`)]) +
      `<div class="tabs" role="tablist">${tabs.map(t => `<button role="tab" aria-selected="${vTab === t[0]}" class="${vTab === t[0] ? 'on' : ''}" data-act="vtab" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>` + body;
  });

  function plTable(id, ms) {
    const lines = [['revenue', tt('الإيراد', 'Revenue')], ['fuel', tt('الوقود', 'Fuel')], ['oil', tt('الزيت', 'Oil')], ['maintenance', tt('الصيانة', 'Maintenance')], ['driver', tt('تكلفة السائق', 'Driver cost')], ['tripExp', tt('مصاريف الرحلات', 'Trip expenses')], ['licIns', tt('رخص وتأمين', 'License & insurance')], ['fines', tt('مخالفات', 'Fines')], ['depreciation', tt('الإهلاك', 'Depreciation')], ['net', tt('صافي الربح', 'Net profit')], ['margin', tt('هامش الربح', 'Margin')]];
    return `<div class="table-wrap"><table class="dt"><thead><tr><th>${tt('البند', 'Line')}</th>${ms.map(m => `<th class="n">${M.monthName(m.ym)}</th>`).join('')}<th class="n">${tt('الإجمالي', 'Total')}</th></tr></thead><tbody>${lines.map(([k, l]) => `<tr><td class="${k === 'net' || k === 'revenue' ? 'cell-main' : ''}">${l}</td>${ms.map(m => `<td class="n num ${k === 'net' && m.net < 0 ? 'neg' : ''}">${k === 'margin' ? M.pct(m.margin) : (k === 'revenue' || k === 'net' ? '' : '−') + M.n0(Math.abs(m[k]))}</td>`).join('')}<td class="n num cell-main">${k === 'margin' ? M.pct(M.sum(ms, m => m.net) / (M.sum(ms, m => m.revenue) || 1)) : M.n0(M.sum(ms, m => m[k]))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  M.ui.plTable = plTable;

  function fuelTable(id, rows, withVehicle) {
    const cid = U.cid();
    return U.table({ id, rows, columns: [
      { label: tt('التاريخ', 'Date'), value: f => f.date, render: f => `${M.date(f.date)} <span class="muted num">${f.time}</span>` },
      ...(withVehicle ? [{ label: tt('المركبة', 'Vehicle'), value: f => U.find('vehicles', f.vehicleId).code, render: f => U.vLabel(U.find('vehicles', f.vehicleId)) }] : []),
      { label: tt('السائق', 'Driver'), value: f => M.L(U.find('drivers', f.driverId).name), render: f => U.dLabel(U.find('drivers', f.driverId)) },
      { label: tt('لتر', 'Liters'), num: 1, value: f => f.liters, render: f => M.n1(f.liters) },
      { label: tt('سعر اللتر', 'Price/L'), num: 1, value: f => f.price, render: f => M.n2(f.price) },
      { label: tt('الإجمالي', 'Total'), num: 1, value: f => f.total, render: f => M.money(f.total) },
      { label: tt('العداد', 'Odometer'), num: 1, value: f => f.odometer, render: f => M.n0(f.odometer) },
      { label: tt('كم/لتر', 'km/L'), num: 1, value: f => f.kmSince / f.liters, render: f => f.kmSince ? M.n2(f.kmSince / f.liters) : '—' },
      { label: tt('تكلفة الكيلو', 'Cost/km'), num: 1, value: f => f.kmSince ? f.total / f.kmSince : 0, render: f => f.kmSince ? M.n2(f.total / f.kmSince) : '—' },
      { label: tt('المحطة', 'Station'), value: f => M.tt(f.station[0], f.station[1]), render: f => `<span class="small">${M.tt(f.station[0], f.station[1])}</span>` },
      { label: tt('المصدر', 'Source'), value: f => f.source, render: f => f.source === 'card' ? U.badge(tt('كارت وقود', 'Fuel card'), 'plain outline') : U.badge(tt('يدوي', 'Manual'), 'plain muted') },
      { label: tt('فحص', 'Check'), value: f => C.fuelCheck(cid, f).flag || '', render: f => { const c = C.fuelCheck(cid, f); return c.flag ? U.badge(c.flag === 'duplicate' ? tt('مكررة', 'Duplicate') : c.flag === 'tank' ? tt('أكبر من التانك', 'Over tank size') : tt('استهلاك غير طبيعي', 'Abnormal'), 'danger') + (c.dev != null && c.flag === 'consumption' ? ` <span class="small num">${M.pct(c.dev, 0)}</span>` : '') : U.badge(tt('سليم', 'OK'), 'success'); } },
    ] });
  }
  M.ui.fuelTable = fuelTable;

  function woTable(id, rows, compact) {
    return U.table({ id, rows, export: !compact, search: !compact, pageSize: compact ? 8 : 15, columns: [
      { label: tt('رقم الأمر', 'Order'), value: w => w.number, render: w => `<a href="#wo.${w.id}">${w.number}</a>` },
      { label: tt('التاريخ', 'Date'), value: w => w.date, render: w => M.date(w.date) },
      ...(compact ? [] : [{ label: tt('المركبة', 'Vehicle'), value: w => U.find('vehicles', w.vehicleId).code, render: w => U.vLabel(U.find('vehicles', w.vehicleId)) }]),
      { label: tt('المشكلة', 'Problem'), value: w => M.L(w.problem) },
      ...(compact ? [] : [{ label: tt('النوع', 'Type'), value: w => w.type, render: w => ({ repair: tt('إصلاح', 'Repair'), emergency: tt('طارئة', 'Emergency'), preventive: tt('وقائية', 'Preventive'), inspection: tt('فحص', 'Inspection') }[w.type]) }, { label: tt('الجهة', 'Done by'), value: w => w.provider, render: w => w.provider === 'internal' ? tt('ورشة داخلية', 'Internal') : tt('مورد خارجي', 'External') }]),
      { label: tt('التكلفة', 'Cost'), num: 1, value: w => w.total, render: w => M.money(w.total) },
      ...(compact ? [] : [{ label: tt('أيام التوقف', 'Downtime'), num: 1, value: w => w.downtimeDays || 0, render: w => w.downtimeDays == null ? '—' : M.n0(w.downtimeDays) }]),
      { label: tt('الحالة', 'Status'), value: w => w.status, render: w => U.status(w.status) },
    ], onRow: w => 'wo.' + w.id });
  }

  function tireBlock(v) {
    const db = U.db(); const tires = db.tires.filter(t => t.vehicleId === v.id);
    const vc = M.vehicleClasses[v.type] || {}; const six = (vc.tires || []).length === 6;
    const pos = six ? { FL: [70, 50], FR: [190, 50], RLO: [50, 230], RLI: [82, 230], RRO: [210, 230], RRI: [178, 230] } : { FL: [70, 60], FR: [190, 60], RL: [70, 220], RR: [190, 220] };
    const col = t => t.tread == null ? '#8FA3BA' : t.tread < 3.5 ? '#B91C1C' : t.tread < 6 ? '#B45309' : '#08264A';
    const svg = `<svg viewBox="0 0 260 300" role="img" aria-label="${tt('خريطة الكاوتش', 'Tire map')}"><rect x="60" y="20" width="140" height="260" rx="26" fill="#F4F6F9" stroke="#DCE2EA" stroke-width="2"/><text x="130" y="16" text-anchor="middle" font-size="10" fill="#64748B">${tt('الأمام', 'Front')}</text>${Object.entries(pos).map(([p, [x, y]]) => { const t = tires.find(z => z.position === p); return `<g><rect x="${x - 13}" y="${y - 24}" width="26" height="48" rx="6" fill="${t ? col(t) : '#DCE2EA'}"/><text x="${x}" y="${y + 40}" text-anchor="middle" font-size="10" fill="#08264A" font-family="Inter">${p}${t && t.tread != null ? ' · ' + t.tread : ''}</text></g>`; }).join('')}</svg>`;
    return `<div class="cols-2-1">` + U.card(tt('الكاوتش والبطارية المركبة', 'Mounted tires & battery'), U.table({ id: 'vtires', rows: tires, export: false, search: false, emptyTitle: tt('لا يوجد كاوتش مسجل على المركبة', 'No tires recorded on this vehicle'), emptyText: tt('استلم الكاوتش بالسيريال ثم ركّبه من هنا.', 'Receive tires by serial, then mount them here.'), columns: [
      { label: tt('المكان', 'Position'), value: t => t.position, render: t => `<b class="mono">${t.position}</b>` }, { label: tt('السيريال', 'Serial'), value: t => t.serial, render: t => `<span class="mono">${t.serial}</span>` }, { label: tt('الماركة', 'Brand'), value: t => t.brand },
      { label: tt('كم منذ التركيب', 'km since fit'), num: 1, value: t => v.odometer - (t.installKm || v.odometer), render: t => t.installKm == null ? '—' : M.n0(v.odometer - t.installKm) }, { label: tt('عمق المداس (مم)', 'Tread (mm)'), num: 1, value: t => t.tread || 0, render: t => t.tread == null ? '—' : `<span class="${t.tread < 3.5 ? 'neg' : ''}">${M.n1(t.tread)}</span>` },
      { label: tt('تكلفة الكيلو', 'Cost/km'), num: 1, value: t => t.cost / Math.max(1, v.odometer - t.installKm), render: t => M.n2(t.cost / Math.max(1, v.odometer - t.installKm)) },
      { label: '', sort: false, render: t => t.kind === 'tire' && t.position !== 'SP' ? `<button class="btn ghost sm" data-act="tire-act" data-id="${t.id}">${tt('تدوير/تغيير', 'Rotate/replace')}</button>` : '' },
    ] }), { flush: true, actions: U.btn(tt('تركيب من المخزن', 'Mount from stock'), 'tire-mount', 'secondary sm', 'plus', `data-v="${v.id}"`) }) + U.card(tt('خريطة المركبة', 'Vehicle map'), `<div class="tire-map">${svg}</div><div class="legend-inline"><span><i style="background:#08264A"></i>${tt('سليم', 'Good')}</span><span><i style="background:#B45309"></i>${tt('أقل من 6 مم', 'Under 6 mm')}</span><span><i style="background:#B91C1C"></i>${tt('أقل من 3.5 مم', 'Under 3.5 mm')}</span></div>`) + `</div>`;
  }
  M.ui.tireBlock = tireBlock;
  U.act('tire-act', el => {
    const db = U.db(); const t = U.find('tires', el.dataset.id); const stock = db.tires.filter(x => x.status === 'in_stock' && x.kind === t.kind);
    const v = U.find('vehicles', t.vehicleId); const others = db.tires.filter(x => x.vehicleId === v.id && x.id !== t.id && x.status === 'mounted' && x.kind === 'tire');
    U.formModal(tt('تدوير أو تغيير كاوتش', 'Rotate or replace tire'), [
      { f: 'action', label: tt('الإجراء', 'Action'), type: 'select', options: [['replace', tt('استبدال من المخزن', 'Replace from stock')], ['rotate', tt('تبديل المكان مع كاوتش آخر', 'Swap position with another tire')], ['tread', tt('تسجيل عمق المداس', 'Record tread depth')], ['unmount', tt('فك وإرجاع للمخزن', 'Unmount to stock')], ['scrap', tt('استبعاد', 'Scrap')]] },
      { f: 'newId', label: tt('الكاوتش البديل', 'Replacement tire'), type: 'select', options: stock.length ? stock.map(s => [s.id, `${s.serial} · ${s.brand} ${s.size}`]) : [['', tt('لا يوجد في المخزن', 'None in stock')]] },
      { f: 'withPosition', label: tt('تبديل مع المكان', 'Swap with position'), type: 'select', options: others.map(o => [o.position, `${o.position} · ${o.serial}`]) },
      { f: 'tread', label: tt('عمق المداس (مم)', 'Tread depth (mm)'), type: 'number', value: t.tread, attrs: 'min="0" max="30" step="0.1"' },
    ], 'tire.action', { intro: `<p>${tt('السيريال', 'Serial')} <code>${M.esc(t.serial)}</code> · ${M.esc(t.position || '')} · ${M.n1(t.tread)} ${tt('مم', 'mm')}</p>`, map: d => Object.assign(d, { id: t.id }), ok: tt('تم تحديث خريطة الكاوتش', 'Tire map updated') });
  });
  U.act('tire-new', () => {
    const db = U.db();
    U.formModal(tt('استلام كاوتش / بطارية بالسيريال', 'Receive a tire / battery by serial'), [
      { f: 'kind', label: tt('النوع', 'Kind'), type: 'select', options: [['tire', tt('كاوتش', 'Tire')], ['battery', tt('بطارية', 'Battery')]] },
      { f: 'serial', label: tt('السيريال', 'Serial'), req: true, attrs: 'dir="ltr"' },
      { f: 'brand', label: tt('الماركة', 'Brand') }, { f: 'size', label: tt('المقاس', 'Size') },
      { f: 'itemId', label: tt('الصنف في المخزن (اختياري)', 'Stock item (optional)'), type: 'select', options: [['', '—'], ...db.items.filter(i => i.category === 'tires' || i.category === 'batteries').map(i => [i.id, M.L(i.name)])] },
      { f: 'cost', label: tt('التكلفة', 'Cost'), type: 'number', attrs: 'min="0"' }, { f: 'tread', label: tt('عمق المداس (مم)', 'Tread (mm)'), type: 'number', value: 16, attrs: 'min="0" max="30" step="0.1"' },
      { f: 'limitKm', label: tt('العمر المتوقع (كم)', 'Expected life (km)'), type: 'number', attrs: 'min="0"' },
    ], 'tire.create', { ok: tt('تم التسجيل في المخزن', 'Added to stock') });
  });
  U.act('tire-mount', el => {
    const db = U.db(); const v = U.find('vehicles', el.dataset.v);
    const free = [...((M.vehicleClasses[v.type] || {}).tires || []), 'SP', 'BAT'].filter(p => !db.tires.some(t => t.vehicleId === v.id && t.position === p && t.status === 'mounted'));
    U.formModal(tt('تركيب من المخزن', 'Mount from stock'), [
      { f: 'id', label: tt('الكاوتش / البطارية', 'Tire / battery'), type: 'select', options: db.tires.filter(t => t.status === 'in_stock').map(t => [t.id, `${t.serial} · ${t.kind === 'tire' ? tt('كاوتش', 'Tire') : tt('بطارية', 'Battery')} ${t.brand} ${t.size}`]), req: true },
      { f: 'position', label: tt('المكان', 'Position'), type: 'select', options: free.map(p => [p, p]), req: true },
    ], 'tire.mount', { map: d => Object.assign(d, { vehicleId: v.id }), ok: tt('تم التركيب', 'Mounted') });
  });

  /* ================= DRIVERS ================= */
  U.route('drivers', () => {
    const cid = U.cid(), db = U.db();
    const rows = db.drivers.map(d => ({ d, s: C.driverStats(cid, d), v: db.vehicles.find(v => v.id === d.vehicleId) }));
    return U.head(tt('السائقين', 'Drivers'), `${db.drivers.length} ${tt('سائق', 'drivers')}`, U.btn(tt('إضافة سائق', 'Add driver'), 'add-driver', '', 'plus')) +
      U.card(null, U.table({ id: 'drivers', rows, columns: [
        { label: tt('السائق', 'Driver'), value: r => M.L(r.d.name), render: r => `<a class="cell-main" href="#driver.${r.d.id}">${M.L(r.d.name)}</a><div class="cell-sub">${r.d.code} · <span class="ltr">${r.d.phone}</span></div>` },
        { label: tt('المركبة', 'Vehicle'), value: r => r.v ? r.v.code : '', render: r => r.v ? U.vLabel(r.v) : U.badge(tt('احتياطي', 'Spare'), 'muted') },
        { label: tt('الرخصة', 'License'), value: r => r.d.licenseExpiry, render: r => { const n = M.diffDays(r.d.licenseExpiry, M.TODAY); return `${M.date(r.d.licenseExpiry)} ${n < 0 ? U.badge(tt('منتهية', 'Expired'), 'danger') : n <= 30 ? U.badge(tt('قريباً', 'Soon'), 'warning') : ''}`; } },
        { label: tt('نظام الأجر', 'Pay'), value: r => r.d.employment, render: r => ({ salary: tt('مرتب', 'Salary'), commission: tt('عمولة', 'Commission'), both: tt('مرتب + عمولة', 'Salary + commission') }[r.d.employment]) },
        { label: tt('الرحلات', 'Trips'), num: 1, value: r => r.s.trips, render: r => M.n0(r.s.trips) }, { label: tt('كم', 'km'), num: 1, value: r => r.s.km, render: r => M.n0(r.s.km) },
        { label: tt('الإيراد', 'Revenue'), num: 1, value: r => r.s.revenue, render: r => M.money(r.s.revenue) },
        { label: tt('تقييم الأمان', 'Safety score'), num: 1, value: r => r.s.score, render: r => `<span class="score ${r.s.score >= 85 ? 'g' : r.s.score >= 70 ? 'w' : 'b'}">${r.s.score}</span>` },
      ], onRow: r => 'driver.' + r.d.id }), { flush: true });
  });
  function driverFields(d) {
    const db = U.db(); d = d || {};
    return [
      { f: 'name', label: tt('الاسم', 'Name'), value: d.name ? M.L(d.name) : '', req: true },
      { f: 'phone', label: tt('الهاتف', 'Phone'), value: d.phone, attrs: 'dir="ltr" inputmode="tel"' },
      U.idField('nationalId', 'nationalId', ['الرقم القومي', 'National ID'], d.nationalId && !d.nationalId.includes('•') ? d.nationalId : ''),
      { f: 'licenseNo', label: tt('رقم الرخصة', 'License number'), value: d.licenseNo, attrs: 'dir="ltr"' },
      { f: 'licenseClass', label: tt('فئة الرخصة', 'License class'), type: 'select', value: d.licenseClass || (M.pack ? M.pack.defaultLicense : 'first'), options: U.licenseOptions() },
      { f: 'licenseExpiry', label: tt('انتهاء الرخصة', 'License expiry'), type: 'date', value: d.licenseExpiry, req: true },
      { f: 'employment', label: tt('نظام الأجر', 'Pay model'), type: 'select', value: d.employment || 'salary', options: [['salary', tt('مرتب', 'Salary')], ['commission', tt('عمولة', 'Commission')], ['both', tt('مرتب + عمولة', 'Salary + commission')]] },
      { f: 'salary', label: tt('المرتب الشهري', 'Monthly salary'), type: 'number', value: d.salary || 0, attrs: 'min="0"' },
      { f: 'commission', label: tt('العمولة لكل رحلة', 'Commission per trip'), type: 'number', value: d.commission || 0, attrs: 'min="0"' },
      { f: 'branchId', label: tt('الفرع', 'Branch'), type: 'select', value: d.branchId, options: db.branches.map(b => [b.id, M.L(b.name)]) },
      { f: 'vehicleId', label: tt('المركبة المخصصة', 'Assigned vehicle'), type: 'select', value: d.vehicleId || '', options: [['', tt('احتياطي (بدون مركبة)', 'Spare (no vehicle)')], ...db.vehicles.filter(v => v.status !== 'sold').map(v => [v.id, `${v.code} · ${M.L(v.plate)}`])] },
      { f: 'hiredAt', label: tt('تاريخ التعيين', 'Hire date'), type: 'date', value: d.hiredAt },
      d.id ? { f: 'status', label: tt('الحالة', 'Status'), type: 'select', value: d.status, options: [['active', tt('نشط', 'Active')], ['inactive', tt('غير نشط', 'Inactive')]] } : null,
    ];
  }
  U.act('add-driver', () => U.formModal(tt('إضافة سائق', 'Add driver'), driverFields(), 'driver.create', { ok: r => tt('تمت إضافة السائق ', 'Driver added ') + r.code, after: r => { location.hash = 'driver.' + r.id; U.full(); } }));
  U.act('edit-driver', el => { const d = U.find('drivers', el.dataset.id); U.formModal(tt('تعديل بيانات السائق', 'Edit driver'), driverFields(d), 'driver.update', { map: x => { x.id = d.id; if (!x.nationalId) delete x.nationalId; return x; } }); });
  U.route('driver', id => {
    const cid = U.cid(), db = U.db(); const d = db.drivers.find(x => x.id === id);
    if (!d) return U.empty('user', tt('السائق غير موجود في هذه الشركة', 'Driver not found in this company'));
    const s = C.driverStats(cid, d); const v = db.vehicles.find(x => x.id === d.vehicleId);
    const ev = db.events.filter(e => e.driverId === d.id).sort((a, b) => a.date < b.date ? 1 : -1);
    const evNames = U.evNames;
    return U.head(M.esc(M.L(d.name)), `${d.code} · ${v ? v.code : tt('سائق احتياطي', 'Spare driver')} · ${U.status(d.status)}`, `${U.btn(tt('تعديل', 'Edit'), 'edit-driver', 'secondary', 'settings', `data-id="${d.id}"`)} ${U.btn(tt('تسجيل إجازة', 'Record leave'), 'add-leave', 'secondary', 'calendar', `data-d="${d.id}"`)} ${U.btn(tt('رفع مستند', 'Upload document'), 'doc-upload', 'secondary', 'upload', `data-owner="driver" data-id="${d.id}"`)}`, [[tt('السائقين', 'Drivers'), 'drivers'], [M.esc(M.L(d.name))]]) +
      U.kpis([U.kpi(tt('الرحلات', 'Trips'), M.n0(s.trips), `${tt('منذ', 'since')} ${M.date(C.lifeFrom())}`), U.kpi(tt('الكيلومترات', 'Kilometers'), M.n0(s.km)), U.kpi(tt('الإيراد المحقق', 'Revenue generated'), M.moneyK(s.revenue)), U.kpi(tt('كفاءة الوقود', 'Fuel efficiency'), s.kmplRel ? M.pct(s.kmplRel, 0) : '—', tt('مقارنة بمعدل نوع المركبة', 'vs vehicle type benchmark')), U.kpi(tt('تقييم الأمان', 'Safety score'), `<span class="score ${s.score >= 85 ? 'g' : s.score >= 70 ? 'w' : 'b'}" style="font-size:22px">${s.score}</span>`, `${s.events} ${tt('حدث سلوك', 'behavior events')}`), U.kpi(tt('الالتزام بالمواعيد', 'On-time pickups'), M.pct(s.onTime, 0))]) +
      `<div class="cols-2">` + U.card(tt('البيانات', 'Details'), U.dl([[tt('الهاتف', 'Phone'), `<span class="ltr">${d.phone}</span>`], [M.L(M.field('nationalId', ['الرقم القومي', 'National ID']).label), d.nationalId ? `<span class="mono">${M.esc(d.nationalId.slice(0, 4))}••••••${M.esc(d.nationalId.slice(-3))}</span> <span class="muted small">${tt('مخفي لحماية البيانات', 'masked for privacy')}</span>` : '—'], [tt('رقم الرخصة', 'License number'), `<span class="mono">${d.licenseNo}</span>`], [tt('درجة الرخصة', 'License class'), d.licenseClass === 'first' ? tt('أولى', 'First') : tt('ثانية', 'Second')], [tt('انتهاء الرخصة', 'License expiry'), M.date(d.licenseExpiry)], [tt('المرتب الشهري', 'Monthly salary'), d.employment === 'commission' ? '—' : M.money(d.salary)], [tt('العمولة لكل رحلة', 'Commission per trip'), d.employment === 'salary' ? '—' : M.money(d.commission)], [tt('المخالفات', 'Fines'), s.fines], [tt('الحوادث', 'Accidents'), s.accidents]])) +
      U.card(tt('أحداث السلوك', 'Behavior events'), U.table({ id: 'drv-ev', rows: ev, export: false, pageSize: 8, columns: [{ label: tt('التاريخ', 'Date'), value: e => e.date, render: e => `${M.date(e.date)} <span class="num muted">${e.time}</span>` }, { label: tt('الحدث', 'Event'), value: e => e.type, render: e => tt(...evNames[e.type]) + (e.value ? ` <span class="num muted">(${e.value}${e.type === 'overspeed' ? ' ' + tt('كم/س', 'km/h') : ' ' + tt('د', 'min')})</span>` : '') }, { label: tt('الخطورة', 'Severity'), value: e => e.severity, render: e => U.status(e.severity) }] }), { flush: true }) + `</div>`;
  });
  U.evNames = { overspeed: ['تجاوز السرعة', 'Overspeed'], harsh_brake: ['فرملة عنيفة', 'Harsh braking'], harsh_accel: ['تسارع عنيف', 'Harsh acceleration'], idle: ['دوران المحرك واقف', 'Excessive idling'], after_hours: ['قيادة خارج المواعيد', 'After-hours driving'], route_deviation: ['انحراف عن المسار', 'Route deviation'], unauthorized: ['تحرك بدون رحلة', 'Unauthorized movement'], geofence_enter: ['دخول منطقة', 'Entered geofence'], geofence_exit: ['خروج من منطقة', 'Left geofence'] };

  /* ================= FUEL ================= */
  U.route('fuel', () => {
    const cid = U.cid(), db = U.db(); const P = U.periodRange();
    const rows = db.fuel.filter(f => f.date >= P.from && f.date <= P.to).sort((a, b) => a.date < b.date ? 1 : -1);
    const flagged = rows.filter(f => C.fuelCheck(cid, f).flag);
    const types = Object.keys(M.vehicleClasses).map(t => C.typeKmpl(cid, t));
    return U.head(tt('المحروقات', 'Fuel'), tt('يحسب النظام كم/لتر وتكلفة الكيلو من تفويلة لتفويلة (تانك كامل).', 'km/L and cost per km are calculated fill to fill (full tank).'), `${U.periodSeg()}${U.btn(tt('تسجيل تفويلة', 'Log fill-up'), 'add-fuel', '', 'plus')}`) +
      U.kpis([U.kpi(tt('تكلفة الوقود', 'Fuel cost'), M.moneyK(M.sum(rows, f => f.total))), U.kpi(tt('اللترات', 'Liters'), M.n0(M.sum(rows, f => f.liters))), U.kpi(tt('تفويلات مشكوك فيها', 'Flagged fill-ups'), `<span class="${flagged.length ? 'delta-down' : ''}">${flagged.length}</span>`, `${tt('حد الانحراف', 'Deviation limit')} ${M.pct(db.settings.fuelDeviation, 0)}`), ...Object.keys(M.vehicleClasses).map((t, i) => U.kpi(`${tt('متوسط', 'Avg')} ${U.vtype(t)}`, `${M.n1(types[i])} <small>${tt('كم/لتر', 'km/L')}</small>`))]) +
      U.card(null, fuelTable('fuel', rows, true), { flush: true });
  });
  U.act('add-fuel', (el) => {
    const db = U.db();
    U.formModal(tt('تسجيل تفويلة', 'Log fill-up'), [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', options: db.vehicles.filter(v => v.status !== 'sold').map(v => [v.id, v.code + ' · ' + M.L(v.plate)]), value: el && el.dataset.v, req: true },
      { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true, attrs: `max="${M.TODAY}"` },
      { f: 'time', label: tt('الوقت', 'Time'), type: 'time' },
      { f: 'liters', label: tt('اللترات', 'Liters'), type: 'number', req: true, attrs: 'min="0.1" step="0.1"' },
      { f: 'price', label: tt('سعر اللتر', 'Price per liter'), type: 'number', attrs: 'step="0.01" min="0"' },
      { f: 'odometer', label: tt('قراءة العداد', 'Odometer'), type: 'number', req: true, attrs: 'min="0"' },
      { f: 'source', label: tt('طريقة الدفع', 'Paid by'), type: 'select', options: [['manual', tt('نقدي', 'Cash')], ['card', tt('كارت وقود', 'Fuel card')]] },
      { f: 'station', label: tt('المحطة', 'Station') },
      { f: 'fullTank', label: tt('تانك كامل (يُستخدم لحساب كم/لتر)', 'Full tank (used for km/L)'), type: 'checkbox', value: true, full: true },
    ], 'fuel.create', {
      mount: () => { const sel = document.querySelector('#mf [data-f="vehicleId"]'); const upd = () => { const v = U.find('vehicles', sel.value); document.querySelector('#mf [data-f="odometer"]').placeholder = M.n0(v.odometer); document.querySelector('#mf [data-f="price"]').value = M.fuelPrice[v.fuel] || ''; }; sel.addEventListener('change', upd); upd(); },
      ok: r => r.anomaly ? tt('تم الحفظ — التفويلة عليها علامة مراجعة', 'Saved — this fill-up is flagged for review') : tt('تم حفظ التفويلة', 'Fill-up saved'),
    });
  });

  /* ================= OIL & MAINTENANCE ================= */
  U.route('oil', () => {
    const cid = U.cid(), db = U.db();
    const sched = db.vehicles.map(v => { const o = C.oilStatus(cid, v); const nextWo = db.workOrders.filter(w => w.vehicleId === v.id && w.status !== 'closed')[0]; return { v, o, nextWo }; }).sort((a, b) => (a.o ? a.o.remaining : 1e9) - (b.o ? b.o.remaining : 1e9));
    const oils = db.oil.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    return U.head(tt('الزيت والصيانة', 'Oil & maintenance'), tt('ترتيب المركبات حسب قرب ميعاد تغيير الزيت.', 'Vehicles ordered by how close the next oil change is.'), `${U.btn(tt('تسجيل تغيير زيت', 'Log oil change'), 'add-oil', '', 'plus')}<a class="btn secondary" href="#workorders">${U.icon('wrench')}${tt('أوامر الشغل', 'Work orders')}</a>`) +
      U.kpis([U.kpi(tt('متأخر', 'Overdue'), `<span class="delta-down">${sched.filter(s => s.o && s.o.state === 'overdue').length}</span>`), U.kpi(tt('قريب (500 كم)', 'Due soon (500 km)'), sched.filter(s => s.o && s.o.state === 'soon').length), U.kpi(tt('تكلفة الزيت (6 شهور)', 'Oil cost (6 months)'), M.moneyK(M.sum(oils.filter(o => o.date >= M.addDays(M.TODAY, -183)), o => o.cost))), U.kpi(tt('تكلفة الصيانة (6 شهور)', 'Maintenance cost (6 months)'), M.moneyK(M.sum(db.workOrders.filter(w => w.status === 'closed' && (w.downEnd || w.date) >= M.addDays(M.TODAY, -183)), w => w.total)))]) +
      U.card(tt('جدول الصيانات القادمة', 'Upcoming service schedule'), U.table({ id: 'oil-sched', rows: sched, pageSize: 12, columns: [
        { label: tt('المركبة', 'Vehicle'), value: s => s.v.code, render: s => U.vLabel(s.v) },
        { label: tt('العداد الحالي', 'Odometer'), num: 1, value: s => s.v.odometer, render: s => M.n0(s.v.odometer) },
        { label: tt('آخر تغيير', 'Last change'), value: s => s.o ? s.o.last.date : '', render: s => s.o ? M.date(s.o.last.date) : '—' },
        { label: tt('التغيير القادم (كم)', 'Next change (km)'), num: 1, value: s => s.o ? s.o.nextKm : 0, render: s => s.o ? M.n0(s.o.nextKm) : '—' },
        { label: tt('المتبقي (كم)', 'Remaining (km)'), num: 1, value: s => s.o ? s.o.remaining : 0, render: s => s.o ? `<span class="${s.o.remaining < 0 ? 'neg' : ''}">${M.n0(s.o.remaining)}</span>` : '—' },
        { label: tt('الحالة', 'Status'), value: s => s.o ? s.o.state : '', render: s => s.o ? U.status(s.o.state) : '—' },
        { label: '', sort: false, render: s => `${U.btn(tt('تسجيل تغيير', 'Log change'), 'add-oil', 'ghost sm', '', `data-v="${s.v.id}"`)}${s.o && s.o.state !== 'ok' ? `<a class="btn ghost sm" href="#providers">${tt('احجز موعد', 'Book service')}</a>` : ''}` },
      ] }), { flush: true }) + '<div style="height:16px"></div>' +
      U.card(tt('سجل تغيير الزيت', 'Oil change log'), U.table({ id: 'oil-log', rows: oils, columns: [
        { label: tt('التاريخ', 'Date'), value: o => o.date, render: o => M.date(o.date) }, { label: tt('المركبة', 'Vehicle'), value: o => U.find('vehicles', o.vehicleId).code, render: o => U.vLabel(U.find('vehicles', o.vehicleId)) },
        { label: tt('العداد', 'Odometer'), num: 1, value: o => o.odometer, render: o => M.n0(o.odometer) }, { label: tt('نوع الزيت', 'Oil type'), value: o => o.oilType, render: o => `<span class="mono">${o.oilType}</span>` },
        { label: tt('الكمية (لتر)', 'Qty (L)'), num: 1, value: o => o.liters }, { label: tt('الفلاتر', 'Filters'), value: o => o.filters.length, render: o => o.filters.map(f => ({ oil: tt('زيت', 'oil'), air: tt('هواء', 'air'), fuel: tt('وقود', 'fuel') }[f])).join('، ') },
        { label: tt('الورشة', 'Workshop'), value: o => o.workshop, render: o => o.workshop === 'internal' ? tt('داخلية', 'Internal') : o.workshop }, { label: tt('التكلفة', 'Cost'), num: 1, value: o => o.cost, render: o => M.money(o.cost) },
      ] }), { flush: true });
  });
  U.act('add-oil', (el) => {
    const db = U.db();
    const oils = db.items.filter(i => i.category === 'oils' || i.category === 'filters');
    U.formModal(tt('تسجيل تغيير زيت', 'Log oil change'), [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', options: db.vehicles.filter(v => v.status !== 'sold').map(v => [v.id, `${v.code} · ${M.L(v.plate)} (${M.n0(v.odometer)} ${tt('كم', 'km')})`]), value: el && el.dataset.v, req: true },
      { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true },
      { f: 'odometer', label: tt('العداد', 'Odometer'), type: 'number', req: true, attrs: 'min="0"' },
      { f: 'workshop', label: tt('الورشة', 'Workshop'), type: 'select', options: [['internal', tt('داخلية (تصرف من المخزن)', 'Internal (issues stock)')], ['external', tt('مركز خدمة خارجي', 'External service center')]] },
      { f: 'warehouseId', label: tt('المخزن (للداخلية)', 'Warehouse (internal)'), type: 'select', options: db.warehouses.filter(w => w.status === 'active').map(w => [w.id, M.L(w.name)]) },
      { f: 'oilItem', label: tt('صنف الزيت', 'Oil item'), type: 'select', options: [['', '—'], ...oils.filter(i => i.category === 'oils').map(i => [i.id, `${i.code} · ${M.L(i.name)}`])] },
      { f: 'liters', label: tt('كمية الزيت (لتر)', 'Oil quantity (L)'), type: 'number', attrs: 'min="0" step="0.1"' },
      { f: 'filterItem', label: tt('فلتر الزيت', 'Oil filter'), type: 'select', options: [['', '—'], ...oils.filter(i => i.category === 'filters').map(i => [i.id, `${i.code} · ${M.L(i.name)}`])] },
      { f: 'airFilterItem', label: tt('فلتر الهواء (اختياري)', 'Air filter (optional)'), type: 'select', options: [['', '—'], ...oils.filter(i => i.category === 'filters').map(i => [i.id, `${i.code} · ${M.L(i.name)}`])] },
      { f: 'cost', label: tt('تكلفة إضافية / فاتورة المركز (قبل الضريبة)', 'Extra cost / service center bill (before VAT)'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'supplier', label: tt('اسم مركز الخدمة (للخارجي)', 'Service center name (external)') },
    ], 'oil.create', {
      intro: `<p class="muted small">${tt('التغيير القادم = العداد + فاصل نوع المركبة (من إعدادات أنواع المركبات).', 'Next change = odometer + the vehicle type interval (from Vehicle types settings).')}</p>`,
      mount: () => { const sel = document.querySelector('#mf [data-f="vehicleId"]'); const upd = () => { const v = U.find('vehicles', sel.value); const o = document.querySelector('#mf [data-f="odometer"]'); o.value = v.odometer; const l = document.querySelector('#mf [data-f="liters"]'); l.value = (M.vehicleClasses[v.type] || {}).oilLiters || ''; }; sel.addEventListener('change', upd); upd(); },
      map: d => { const parts = []; if (d.workshop === 'internal') { if (d.oilItem) parts.push({ itemId: d.oilItem, qty: d.liters || 1 }); if (d.filterItem) parts.push({ itemId: d.filterItem, qty: 1 }); if (d.airFilterItem) parts.push({ itemId: d.airFilterItem, qty: 1 }); } const filters = ['oil', ...(d.airFilterItem ? ['air'] : [])]; const it = d.oilItem ? U.find('items', d.oilItem) : null; return { vehicleId: d.vehicleId, date: d.date, odometer: d.odometer, workshop: d.workshop, warehouseId: d.warehouseId, parts, filters, liters: d.liters, oilType: it && !it._missing ? it.code : '', cost: d.cost, supplier: d.workshop === 'external' ? d.supplier : 'internal' }; },
      ok: r => tt(`تم الحفظ. التغيير القادم عند ${M.n0(r.nextKm)} كم`, `Saved. Next change at ${M.n0(r.nextKm)} km`),
    });
  });

  /* ================= WORK ORDERS ================= */
  U.route('workorders', () => {
    const db = U.db(); const rows = db.workOrders.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const open = rows.filter(w => w.status !== 'closed');
    const closed = rows.filter(w => w.status === 'closed');
    return U.head(tt('أوامر الشغل', 'Work orders'), tt('قفل أمر الشغل يحمّل تكلفة القطع والمصنعية على المركبة ويعمل القيد المحاسبي.', 'Closing a work order posts parts and labor cost to the vehicle and creates the journal entry.'), U.btn(tt('أمر شغل جديد', 'New work order'), 'new-wo', '', 'plus')) +
      U.kpis([U.kpi(tt('مفتوحة', 'Open'), open.length), U.kpi(tt('متوسط مدة الإصلاح', 'Average repair time'), `${M.n1(M.avg(closed, w => w.downtimeDays))} <small>${tt('يوم', 'days')}</small>`), U.kpi(tt('تكلفة القطع', 'Parts cost'), M.moneyK(M.sum(closed, w => w.partsCost))), U.kpi(tt('تكلفة المصنعية', 'Labor cost'), M.moneyK(M.sum(closed, w => w.laborCost))), U.kpi(tt('موردين خارجيين', 'External providers'), M.moneyK(M.sum(closed, w => w.externalCost)))]) +
      U.card(null, woTable('wo', rows, false), { flush: true });
  });
  U.route('wo', id => {
    const db = U.db(); const w = db.workOrders.find(x => x.id === id);
    if (!w) return U.empty('wrench', tt('أمر الشغل غير موجود', 'Work order not found'));
    const v = U.find('vehicles', w.vehicleId);
    return U.head(w.number, M.L(w.problem), `${U.status(w.status)} ${['open', 'waiting_parts', 'in_progress'].includes(w.status) ? U.btn(tt('تعديل', 'Edit'), 'wo-edit', 'secondary', 'settings', `data-id="${w.id}"`) + U.btn(tt('إضافة قطعة', 'Add part'), 'wo-addpart', 'secondary', 'plus', `data-id="${w.id}"`) + U.btn(tt('صرف القطع', 'Issue parts'), 'wo-issue', 'secondary', 'box', `data-id="${w.id}"`) + U.btn(tt('إلغاء', 'Cancel'), 'wo-cancel', 'ghost', '', `data-id="${w.id}"`) + U.btn(tt('قفل أمر الشغل', 'Close work order'), 'close-wo', '', 'check', `data-id="${w.id}"`) : ''}`, [[tt('أوامر الشغل', 'Work orders'), 'workorders'], [w.number]]) +
      `<div class="cols-2-1">` + U.card(tt('قطع الغيار', 'Parts'), U.table({ id: 'wo-parts', rows: w.parts, export: false, search: false, columns: [{ label: tt('الصنف', 'Item'), value: p => M.L(U.find('items', p.itemId).name), render: p => `<a href="#item.${p.itemId}">${M.L(U.find('items', p.itemId).name)}</a>` }, { label: tt('الكمية', 'Qty'), num: 1, value: p => p.qty }, { label: tt('متوسط التكلفة', 'Avg cost'), num: 1, value: p => p.unitCost, render: p => M.money(p.unitCost) }, { label: tt('الإجمالي', 'Total'), num: 1, value: p => p.qty * p.unitCost, render: p => M.money(p.qty * p.unitCost) }, { label: tt('الصرف', 'Issued'), value: p => p.issued, render: p => p.issued ? U.badge(tt('تم الصرف', 'Issued'), 'success') : (C.stockOf(U.cid(), p.itemId).qty >= p.qty ? U.badge(tt('متاح', 'Available'), '') : U.badge(tt('غير متاح', 'Out of stock'), 'danger')) + (['open', 'waiting_parts', 'in_progress'].includes(w.status) ? ` <button class="btn ghost sm" data-act="wo-rmpart" data-wo="${w.id}" data-id="${p.id}">${tt('حذف', 'Remove')}</button>` : '') }], emptyTitle: tt('لا توجد قطع غيار', 'No spare parts'), emptyText: tt('أضف القطع المطلوبة لأمر الشغل.', 'Add the parts this job needs.') }), { flush: true }) +
      U.card(tt('البيانات', 'Details'), U.dl([[tt('المركبة', 'Vehicle'), U.vLabel(v)], [tt('التاريخ', 'Date'), M.date(w.date)], [tt('النوع', 'Type'), w.type], [tt('الجهة', 'Done by'), w.provider === 'internal' ? tt('ورشة داخلية', 'Internal workshop') : (w.supplierId ? M.L(U.find('suppliers', w.supplierId).name) : tt('مورد خارجي', 'External'))], [tt('الميكانيكي', 'Mechanic'), w.mechanics.map(m => M.L(m)).join('، ') || '—'], [tt('ساعات العمل', 'Labor hours'), `${M.n1(w.laborHours)} × ${M.money(w.laborRate)}`], [tt('تكلفة القطع', 'Parts'), M.money(w.partsCost)], [tt('المصنعية', 'Labor'), M.money(w.laborCost)], [tt('خدمة خارجية', 'External service'), M.money(w.externalCost)], [tt('الإجمالي', 'Total'), `<b>${M.money(w.total)}</b>`], [tt('بداية التوقف', 'Downtime start'), M.date(w.downStart)], [tt('نهاية التوقف', 'Downtime end'), M.date(w.downEnd)]])) + `</div>`;
  });
  U.act('close-wo', el => {
    const w = U.find('workOrders', el.dataset.id);
    const pending = w.parts.filter(p => !p.issued);
    U.formModal(tt('قفل أمر الشغل', 'Close work order'), [
      { f: 'date', label: tt('تاريخ القفل', 'Close date'), type: 'date', value: M.TODAY, req: true },
      pending.length ? { f: 'warehouseId', label: tt('صرف القطع المتبقية من مخزن', 'Issue remaining parts from'), type: 'select', options: U.db().warehouses.filter(x => x.status === 'active').map(x => [x.id, M.L(x.name)]), req: true } : null,
      { f: 'laborHours', label: tt('ساعات العمل', 'Labor hours'), type: 'number', value: w.laborHours, attrs: 'min="0" step="0.5"' },
      { f: 'externalCost', label: tt('تكلفة خدمة خارجية (قبل الضريبة)', 'External service cost (before VAT)'), type: 'number', value: w.externalCost, attrs: 'min="0"' },
      { f: 'nextDate', label: tt('ميعاد المتابعة (اختياري)', 'Follow-up date (optional)'), type: 'date' },
    ], 'wo.close', { intro: `<p class="muted small">${tt('القفل يصرف القطع من المخزن، يحسب المصنعية، يحمّل التكلفة على المركبة ويعمل القيد المحاسبي. المركبة ترجع "نشطة" لو مفيش أوامر شغل تانية مفتوحة.', 'Closing issues the parts from stock, adds labor, charges the cost to the vehicle and posts the journal entry. The vehicle returns to active if it has no other open work orders.')}</p>`, map: d => Object.assign(d, { id: w.id }), ok: tt('تم قفل أمر الشغل وتحميل التكلفة على المركبة', 'Work order closed and cost posted to the vehicle') });
  });
  U.act('wo-issue', el => {
    U.formModal(tt('صرف قطع الغيار', 'Issue parts'), [{ f: 'warehouseId', label: tt('المخزن', 'Warehouse'), type: 'select', options: U.db().warehouses.filter(x => x.status === 'active').map(x => [x.id, M.L(x.name)]), req: true }], 'wo.issueParts', { map: d => Object.assign(d, { id: el.dataset.id }), ok: r => r.missing && r.missing.length ? tt('تم صرف المتاح. غير متاح: ', 'Issued what was available. Missing: ') + r.missing.join('، ') : tt('تم صرف القطع', 'Parts issued') });
  });
  U.act('wo-addpart', el => {
    const db = U.db();
    U.formModal(tt('إضافة قطعة', 'Add part'), [{ f: 'itemId', label: tt('الصنف', 'Item'), type: 'select', options: db.items.map(i => [i.id, `${i.code} · ${M.L(i.name)} (${M.n0(M.calc.stockOf(U.cid(), i.id).qty)} ${i.unit})`]), req: true }, { f: 'qty', label: tt('الكمية', 'Quantity'), type: 'number', value: 1, req: true, attrs: 'min="0.01" step="0.01"' }], 'wo.update', { map: d => ({ id: el.dataset.id, addParts: [{ itemId: d.itemId, qty: d.qty }] }) });
  });
  U.act('wo-rmpart', el => U.run('wo.update', { id: el.dataset.wo, removeParts: [el.dataset.id] }, { ok: tt('تم حذف القطعة', 'Part removed') }));
  U.act('wo-edit', el => {
    const w = U.find('workOrders', el.dataset.id);
    U.formModal(tt('تعديل أمر الشغل', 'Edit work order'), [
      { f: 'problem', label: tt('المشكلة / الشغل المطلوب', 'Problem / work required'), value: M.L(w.problem), req: true, full: true },
      { f: 'type', label: tt('النوع', 'Type'), type: 'select', value: w.type, options: [['repair', tt('إصلاح', 'Repair')], ['emergency', tt('طارئة', 'Emergency')], ['preventive', tt('وقائية', 'Preventive')], ['inspection', tt('فحص', 'Inspection')]] },
      { f: 'laborHours', label: tt('ساعات العمل', 'Labor hours'), type: 'number', value: w.laborHours, attrs: 'min="0" step="0.5"' },
      { f: 'laborRate', label: tt('سعر ساعة العمل', 'Labor rate per hour'), type: 'number', value: w.laborRate, attrs: 'min="0"' },
      { f: 'externalCost', label: tt('تكلفة خدمة خارجية', 'External service cost'), type: 'number', value: w.externalCost, attrs: 'min="0"' },
      { f: 'mechanics', label: tt('الميكانيكية (افصل بفاصلة)', 'Mechanics (comma separated)'), value: w.mechanics.map(m => M.L(m)).join(', '), full: true },
    ], 'wo.update', { map: d => Object.assign(d, { id: w.id, mechanics: d.mechanics ? d.mechanics.split(/[,،]/).map(x => x.trim()).filter(Boolean) : [] }) });
  });
  U.act('wo-cancel', el => {
    const w = U.find('workOrders', el.dataset.id); const issued = w.parts.some(p => p.issued);
    U.formModal(tt('إلغاء أمر الشغل', 'Cancel work order'), issued ? [{ f: 'warehouseId', label: tt('إرجاع القطع المصروفة إلى مخزن', 'Return issued parts to'), type: 'select', options: U.db().warehouses.filter(x => x.status === 'active').map(x => [x.id, M.L(x.name)]), req: true }] : [], 'wo.cancel', { danger: true, submit: tt('إلغاء الأمر', 'Cancel order'), intro: `<p>${tt('هل تريد إلغاء أمر الشغل؟', 'Cancel this work order?')} <b>${w.number}</b></p>`, map: d => Object.assign(d, { id: w.id }) });
  });
  U.act('new-wo', (el) => {
    const db = U.db();
    const itemOpts = db.items.map(i => [i.id, `${i.code} · ${M.L(i.name)}`]);
    U.formModal(tt('أمر شغل جديد', 'New work order'), [
      { f: 'vehicleId', label: tt('المركبة', 'Vehicle'), type: 'select', options: db.vehicles.filter(v => v.status !== 'sold').map(v => [v.id, `${v.code} · ${M.L(v.plate)}`]), value: el && el.dataset.v, req: true },
      { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true },
      { f: 'problem', label: tt('المشكلة / الشغل المطلوب', 'Problem / work required'), req: true, full: true },
      { f: 'type', label: tt('النوع', 'Type'), type: 'select', options: [['repair', tt('إصلاح', 'Repair')], ['emergency', tt('طارئة', 'Emergency')], ['preventive', tt('وقائية', 'Preventive')], ['inspection', tt('فحص', 'Inspection')]] },
      { f: 'provider', label: tt('الجهة', 'Done by'), type: 'select', options: [['internal', tt('ورشة داخلية', 'Internal workshop')], ['external', tt('مورد خارجي', 'External supplier')]] },
      { f: 'supplierId', label: tt('المورد (للخارجي)', 'Supplier (external)'), type: 'select', options: [['', '—'], ...db.suppliers.map(s => [s.id, M.L(s.name)])] },
      { f: 'laborHours', label: tt('ساعات عمل متوقعة', 'Expected labor hours'), type: 'number', value: 0, attrs: 'min="0" step="0.5"' },
      { f: 'externalCost', label: tt('تكلفة خارجية متوقعة', 'Expected external cost'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'part1', label: tt('قطعة غيار 1 (اختياري)', 'Spare part 1 (optional)'), type: 'select', options: [['', '—'], ...itemOpts] }, { f: 'qty1', label: tt('الكمية', 'Qty'), type: 'number', value: 1, attrs: 'min="0.01" step="0.01"' },
      { f: 'part2', label: tt('قطعة غيار 2 (اختياري)', 'Spare part 2 (optional)'), type: 'select', options: [['', '—'], ...itemOpts] }, { f: 'qty2', label: tt('الكمية', 'Qty'), type: 'number', value: 1, attrs: 'min="0.01" step="0.01"' },
      { f: 'inWorkshop', label: tt('المركبة تدخل الورشة الآن (تتوقف عن التشغيل)', 'Vehicle goes into the workshop now (taken out of service)'), type: 'checkbox', value: true, full: true },
    ], 'wo.create', { map: d => ({ vehicleId: d.vehicleId, date: d.date, problem: d.problem, type: d.type, provider: d.provider, supplierId: d.supplierId, laborHours: d.laborHours, externalCost: d.externalCost, inWorkshop: d.inWorkshop, parts: [[d.part1, d.qty1], [d.part2, d.qty2]].filter(x => x[0]).map(x => ({ itemId: x[0], qty: x[1] || 1 })) }), ok: r => tt('تم فتح أمر الشغل ', 'Work order opened ') + r.number, after: r => { location.hash = 'wo.' + r.id; U.full(); } });
  });

  /* ================= TIRES ================= */
  U.route('tires', () => {
    const db = U.db();
    const rows = db.tires.slice();
    return U.head(tt('الكاوتش والبطاريات', 'Tires & batteries'), tt('كل كاوتش وبطارية متتبعة بالسيريال ومكانها على المركبة.', 'Every tire and battery is tracked by serial number and position.'), U.btn(tt('استلام بالسيريال', 'Receive by serial'), 'tire-new', '', 'plus')) +
      U.kpis([U.kpi(tt('كاوتش مركب', 'Mounted tires'), rows.filter(t => t.kind === 'tire' && t.status === 'mounted').length), U.kpi(tt('في المخزن', 'In stock'), rows.filter(t => t.status === 'in_stock').length), U.kpi(tt('مداس أقل من 3.5 مم', 'Tread under 3.5 mm'), `<span class="delta-down">${rows.filter(t => t.tread != null && t.tread < 3.5 && t.status === 'mounted').length}</span>`), U.kpi(tt('بطاريات', 'Batteries'), rows.filter(t => t.kind === 'battery').length)]) +
      U.card(null, U.table({ id: 'tires', rows, columns: [
        { label: tt('السيريال', 'Serial'), value: t => t.serial, render: t => `<span class="mono">${t.serial}</span>` }, { label: tt('النوع', 'Kind'), value: t => t.kind, render: t => t.kind === 'tire' ? tt('كاوتش', 'Tire') : tt('بطارية', 'Battery') },
        { label: tt('الماركة', 'Brand'), value: t => t.brand }, { label: tt('المقاس', 'Size'), value: t => t.size },
        { label: tt('المركبة', 'Vehicle'), value: t => t.vehicleId ? U.find('vehicles', t.vehicleId).code : '', render: t => t.vehicleId ? `<a href="#vehicle.${t.vehicleId}">${U.find('vehicles', t.vehicleId).code}</a>` : '—' },
        { label: tt('المكان', 'Position'), value: t => t.position || '', render: t => t.position ? `<span class="mono">${t.position}</span>` : '—' },
        { label: tt('المداس (مم)', 'Tread (mm)'), num: 1, value: t => t.tread || 0, render: t => t.tread == null ? '—' : `<span class="${t.tread < 3.5 ? 'neg' : ''}">${M.n1(t.tread)}</span>` },
        { label: tt('الحالة', 'Status'), value: t => t.status, render: t => U.status(t.status) },
      ], filters: [{ label: tt('النوع', 'Kind'), get: t => t.kind, options: [['tire', tt('كاوتش', 'Tire')], ['battery', tt('بطارية', 'Battery')]] }, { label: tt('الحالة', 'Status'), get: t => t.status, options: [['mounted', U.statusText('mounted')], ['in_stock', U.statusText('in_stock')]] }], onRow: t => t.vehicleId ? 'vehicle.' + t.vehicleId : 'tires' }), { flush: true });
  });
})();
