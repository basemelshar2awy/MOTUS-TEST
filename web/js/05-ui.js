/* UI shell, router and shared MOTUS components. */
'use strict';
(function () {
  const U = M.ui = {};
  const $ = (s, el = document) => el.querySelector(s);
  U.$ = $;

  /* ---------- icons (stroke icons drawn at 24x24) ---------- */
  const IC = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    bus: '<path d="M8 6v6M15 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    fuel: '<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    oil: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
    map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/><circle cx="12" cy="12" r="2"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    warehouse: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12M6 14h12"/><rect x="6" y="10" width="12" height="12"/>',
    swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    tire: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
    board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu: '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  };
  U.icon = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || IC.file}</svg>`;

  /* MOTUS wordmark: bold letters with a diagonal road stroke through the O */
  U.logo = (color = '#fff') => `<svg viewBox="0 0 150 32" role="img" aria-label="MOTUS" direction="ltr" style="direction:ltr"><g fill="${color}" font-family="Inter, Arial, sans-serif" font-weight="800" font-size="27"><text x="0" y="26" text-anchor="start">M</text><text x="58" y="26" text-anchor="start" letter-spacing="1">TUS</text></g><g transform="translate(29 3)"><circle cx="13" cy="13" r="10.5" fill="none" stroke="${color}" stroke-width="4.5"/><path d="M4.5 23 L21.5 3" stroke="${color}" stroke-width="3" stroke-dasharray="3 2.4"/></g></svg>`;

  /* ---------- state ---------- */
  const store = { get(k, d) { try { const v = localStorage.getItem('motus.' + k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('motus.' + k, v); } catch (e) { } } };
  /* who is signed in comes from the server session; nothing here is trusted by the server */
  M.state = { companyId: null, role: 'viewer', user: null };
  U.store = store;
  U.cid = () => M.state.companyId;
  U.db = () => M.db[M.state.companyId];
  U.company = () => M.company || { id: null, code: '', name: { ar: '', en: '' } };

  /* ---------- navigation & roles ---------- */
  U.roles = {
    super_admin: ['مسؤول المنصة (كل الشركات)', 'Platform admin (all companies)'], company_admin: ['مدير النظام', 'Company admin'], fleet_manager: ['مدير الأسطول', 'Fleet manager'],
    operations: ['مدير الحركة', 'Dispatch manager'], accountant: ['المحاسب', 'Accountant'], maintenance: ['مسؤول الصيانة', 'Maintenance lead'], viewer: ['مراجع (قراءة فقط)', 'Viewer (read only)'],
  };
  const ALL = ['super_admin', 'company_admin', 'fleet_manager'];
  U.nav = [
    { g: ['الرئيسية', 'Overview'], items: [['dashboard', 'dashboard', 'لوحة التحكم', 'Executive dashboard', [...ALL, 'operations', 'accountant', 'maintenance', 'viewer']], ['alerts', 'bell', 'التنبيهات', 'Alerts', [...ALL, 'operations', 'accountant', 'maintenance', 'viewer']]] },
    { g: ['مدير الحركة', 'Dispatch'], items: [['dispatch', 'board', 'لوحة توزيع الحركة', 'Dispatch board', [...ALL, 'operations']], ['calendar', 'calendar', 'تقويم الحركة', 'Operations calendar', [...ALL, 'operations', 'viewer']], ['readiness', 'shield', 'جاهزية المركبات', 'Vehicle readiness', [...ALL, 'operations', 'maintenance']], ['inspections', 'clipboard', 'فحص ما قبل الرحلة', 'Pre-trip inspections', [...ALL, 'operations', 'maintenance']], ['availability', 'clock', 'إتاحة السائقين', 'Driver availability', [...ALL, 'operations']], ['subcontract', 'truck', 'مركبات من الباطن', 'Subcontracted vehicles', [...ALL, 'operations', 'accountant']], ['incidents', 'alert', 'الحوادث والمخالفات', 'Accidents & fines', [...ALL, 'operations']], ['handover', 'history', 'تسليم الشيفت', 'Shift handover', [...ALL, 'operations']], ['documents', 'folder', 'المستندات', 'Document vault', [...ALL, 'operations', 'maintenance']], ['driverapp', 'phone', 'شاشة السائق', 'Driver app view', [...ALL, 'operations']]] },
    { g: ['العمليات', 'Operations'], items: [['bookings', 'ticket', 'الحجوزات', 'Bookings', [...ALL, 'operations', 'accountant', 'viewer']], ['programs', 'route', 'البرامج السياحية', 'Tour programs', [...ALL, 'operations', 'accountant', 'viewer']], ['trips', 'bus', 'الرحلات', 'Trips', [...ALL, 'operations', 'accountant', 'viewer']]] },
    { g: ['الأسطول', 'Fleet'], items: [['vehicles', 'car', 'المركبات', 'Vehicles', [...ALL, 'operations', 'accountant', 'maintenance', 'viewer']], ['drivers', 'users', 'السائقين', 'Drivers', [...ALL, 'operations', 'viewer']], ['fuel', 'fuel', 'المحروقات', 'Fuel', [...ALL, 'maintenance', 'accountant']], ['oil', 'oil', 'الزيت والصيانة', 'Oil & maintenance', [...ALL, 'maintenance']], ['workorders', 'wrench', 'أوامر الشغل', 'Work orders', [...ALL, 'maintenance']], ['tires', 'tire', 'الكاوتش والبطاريات', 'Tires & batteries', [...ALL, 'maintenance']]] },
    { g: ['المخازن', 'Warehouses'], items: [['items', 'box', 'الأصناف وقطع الغيار', 'Items & spare parts', [...ALL, 'maintenance', 'accountant']], ['stock', 'warehouse', 'المخازن والأرصدة', 'Warehouses & stock', [...ALL, 'maintenance', 'accountant']], ['movements', 'swap', 'حركة المخزون', 'Stock movements', [...ALL, 'maintenance', 'accountant']], ['purchasing', 'cart', 'طلبات وأوامر الشراء', 'Purchasing', [...ALL, 'maintenance', 'accountant']], ['suppliers', 'building', 'الموردين', 'Suppliers', [...ALL, 'maintenance', 'accountant']], ['counts', 'clipboard', 'الجرد', 'Stock counts', [...ALL, 'maintenance', 'accountant']]] },
    { g: ['التتبع', 'Tracking'], items: [['livemap', 'map', 'الخريطة المباشرة', 'Live map', [...ALL, 'operations', 'viewer']], ['history', 'route', 'سجل المسارات', 'Route history', [...ALL, 'operations']], ['geofences', 'pin', 'المناطق الجغرافية', 'Geofences', [...ALL, 'operations']], ['behavior', 'gauge', 'سلوك السائقين', 'Driver behavior', [...ALL, 'operations']], ['devices', 'radio', 'أجهزة التتبع', 'Tracking devices', [...ALL, 'maintenance']]] },
    { g: ['المالية', 'Finance'], items: [['clients', 'users', 'العملاء', 'Clients', [...ALL, 'accountant', 'operations', 'viewer']], ['invoices', 'file', 'الفواتير', 'Invoices', [...ALL, 'accountant', 'viewer']], ['payments', 'wallet', 'المدفوعات والتحصيل', 'Payments & collection', [...ALL, 'accountant']], ['expenses', 'receipt', 'المصروفات', 'Expenses', [...ALL, 'accountant']], ['journal', 'book', 'القيود المحاسبية', 'Journal entries', [...ALL, 'accountant']]] },
    { g: ['التقارير', 'Reports'], items: [['reports', 'chart', 'مركز التقارير', 'Reports center', [...ALL, 'operations', 'accountant', 'maintenance', 'viewer']]] },
    { g: ['الذكاء الاصطناعي', 'AI intelligence'], items: [['copilot', 'bot', 'المساعد الذكي', 'Fleet copilot', [...ALL, 'operations', 'accountant', 'maintenance']], ['insights', 'sparkles', 'رؤى الإدارة', 'Executive insights', [...ALL, 'accountant', 'viewer']], ['assign', 'board', 'التوزيع الذكي', 'Smart assignment', [...ALL, 'operations']], ['profit', 'trend', 'مستشار الربحية', 'Profitability advisor', [...ALL, 'accountant']], ['fuelai', 'fuel', 'ذكاء الوقود', 'Fuel intelligence', [...ALL, 'maintenance', 'accountant']], ['maintai', 'wrench', 'ذكاء الصيانة', 'Maintenance intelligence', [...ALL, 'maintenance']], ['pricing', 'tag', 'التسعير الذكي', 'Smart pricing', [...ALL, 'operations', 'accountant']], ['docai', 'scan', 'قراءة المستندات', 'Document intelligence', [...ALL, 'operations', 'accountant', 'maintenance']], ['invai', 'box', 'ذكاء المخزون', 'Inventory intelligence', [...ALL, 'maintenance']], ['reconai', 'swap', 'ذكاء التتبع والمطابقة', 'Tracking & matching AI', [...ALL, 'accountant', 'operations']]] },
    { g: ['الإعدادات', 'Settings'], items: [['company', 'building', 'بيانات الشركة', 'Company profile', ['super_admin', 'company_admin']], ['users', 'user', 'المستخدمين والصلاحيات', 'Users & roles', ['super_admin', 'company_admin']], ['vtypes', 'bus', 'أنواع المركبات', 'Vehicle types', ['super_admin', 'company_admin', 'fleet_manager']], ['coa', 'book', 'دليل الحسابات والربط', 'Accounts mapping', ['super_admin', 'company_admin', 'accountant']], ['erp', 'db', 'مزامنة ERP', 'ERP sync', ['super_admin', 'company_admin', 'accountant']], ['providers', 'plug', 'مزودي الخدمة', 'Service providers', ['super_admin', 'company_admin', 'fleet_manager', 'accountant']], ['reconcile', 'swap', 'مطابقة المعاملات', 'Transaction matching', ['super_admin', 'company_admin', 'fleet_manager', 'accountant']], ['api', 'key', 'التكاملات وAPI', 'Integrations & API', ['super_admin', 'company_admin']], ['audit', 'history', 'سجل العمليات', 'Audit log', ['super_admin', 'company_admin', 'accountant']], ['aisettings', 'sparkles', 'إعدادات الذكاء الاصطناعي', 'AI settings', ['super_admin', 'company_admin']]] },
  ];
  U.navItem = id => { for (const g of U.nav) for (const it of g.items) if (it[0] === id) return { g, it }; return null; };
  /* screens that belong to one activity (anything not listed is shared core) */
  U.navActivity = { programs: 'tourism' };
  U.activityOf = id => U.navActivity[id] || U.navActivity[U.routeParent[id]] || null;
  U.can = id => { if (!M.has(U.activityOf(id))) return false; const n = U.navItem(id); return !n || n.it[4].includes(M.state.role); };
  U.readOnly = () => M.state.role === 'viewer';

  /* ---------- routes ---------- */
  U.routes = {};
  U.route = (name, fn) => { U.routes[name] = fn; };
  U.parse = () => { const h = (location.hash || '#dashboard').slice(1); const i = h.indexOf('.'); return i < 0 ? { name: h, id: null } : { name: h.slice(0, i), id: h.slice(i + 1) }; };
  U.go = (name, id) => { location.hash = id ? `${name}.${id}` : name; };

  /* ---------- render shell ---------- */
  U.renderShell = () => {
    const html = document.documentElement;
    html.lang = M.lang; html.dir = M.lang === 'ar' ? 'rtl' : 'ltr';
    const comp = U.company();
    const alerts = M.calc.alerts(U.cid());
    const navHtml = U.nav.map(g => {
      const items = g.items.filter(it => it[4].includes(M.state.role) && M.has(U.navActivity[it[0]]));
      if (!items.length) return '';
      return `<div class="nav-group"><div class="nav-group-title">${M.tt(g.g[0], g.g[1])}</div>${items.map(it => `<a href="#${it[0]}" data-nav="${it[0]}">${U.icon(it[1])}<span>${M.tt(it[2], it[3])}</span>${it[0] === 'alerts' ? `<span class="count">${alerts.length}</span>` : it[0] === 'dispatch' ? `<span class="count">${U.db().bookings.filter(b => b.unassigned).length}</span>` : ''}</a>`).join('')}</div>`;
    }).join('');
    let root = document.getElementById('app-root'); if (!root) { root = document.createElement('div'); root.id = 'app-root'; document.body.appendChild(root); }
    root.innerHTML = `
      <div class="app">
        <aside class="sidebar" aria-label="${M.tt('القائمة الرئيسية', 'Main menu')}">
          <a class="brand" href="#dashboard" aria-label="MOTUS">${U.logo('#fff')}</a>
          <div class="brand-tag">Fleet &amp; Mobility Management</div>
          <nav class="nav">${navHtml}</nav>
        </aside>
        <div class="scrim" data-act="close-nav"></div>
        <div class="main">
          <header class="topbar">
            <button class="icon-btn menu-btn" data-act="open-nav" aria-label="${M.tt('فتح القائمة', 'Open menu')}">${U.icon('menu')}</button>
            <div class="search">${U.icon('search')}<input id="gsearch" type="search" autocomplete="off" placeholder="${M.tt('ابحث برقم لوحة، حجز، فاتورة، عميل…', 'Search plate, booking, invoice, client…')}" aria-label="${M.tt('بحث', 'Search')}"><div class="search-results" id="gsearch-res" hidden></div></div>
            <div class="top-actions">
              ${M.state.role === 'super_admin' ? `<select class="select" id="company-switch" aria-label="${M.tt('الشركة', 'Company')}">${M.companies.filter(c => c.status === 'active').map(c => `<option value="${c.id}" ${c.id === comp.id ? 'selected' : ''}>${M.esc(M.L(c.name))}</option>`).join('')}</select>` : `<span class="badge outline plain hide-sm">${M.esc(M.L(comp.name))}</span>`}
              <button class="icon-btn user-btn" data-act="user-menu" aria-label="${M.tt('حسابي', 'My account')}" title="${M.esc(M.state.user ? M.state.user.email : '')}">${U.icon('user')}</button>
              <div class="lang-switch" role="group" aria-label="Language"><button data-lang="ar" class="${M.lang === 'ar' ? 'on' : ''}">عربي</button><button data-lang="en" class="${M.lang === 'en' ? 'on' : ''}">English</button></div>
              <a class="icon-btn" href="#alerts" aria-label="${M.tt('التنبيهات', 'Alerts')}">${U.icon('bell')}<span class="dot">${alerts.length}</span></a>
            </div>
          </header>
          ${U.banner ? U.banner() : ''}
          <main class="content" id="main" tabindex="-1"></main>
        </div>
      </div>`;
  };

  U.render = () => {
    const { name, id } = U.parse();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name || (U.routeParent[name] === a.dataset.nav)));
    document.body.classList.remove('nav-open');
    const main = $('#main');
    U.charts = [];
    if (U.timers) U.timers.forEach(t => clearInterval(t)); U.timers = [];
    const fn = U.routes[name] || U.routes.dashboard;
    if (!M.has(U.activityOf(name))) { const n = (M.activityCatalog.find(x => x.code === U.activityOf(name)) || { name: { ar: '', en: '' } }).name; main.innerHTML = U.empty('lock', M.tt(`نشاط "${n.ar}" مش مفعّل لشركتك`, `The "${n.en}" activity is not enabled for your company`), M.tt('تواصل مع فريق سبيل لتفعيله.', 'Contact the Sabeel team to enable it.')); return; }
    if (!U.can(name)) { main.innerHTML = U.empty('lock', M.tt('لا تملك صلاحية لهذه الصفحة', 'You don’t have access to this page'), M.tt('اطلب من مدير النظام تعديل صلاحيات حسابك إذا كنت تحتاجها.', 'Ask your company admin to change your role if you need it.')); return; }
    try { main.innerHTML = fn(id) || ''; if (U.after.length) { const a = U.after; U.after = []; a.forEach(f => f()); } }
    catch (e) { console.error(e); main.innerHTML = U.empty('alert', M.tt('حصل خطأ في عرض الصفحة', 'This page failed to load'), String(e.message)); }
    window.scrollTo(0, 0);
  };
  U.routeParent = { vehicle: 'vehicles', driver: 'drivers', client: 'clients', program: 'programs', trip: 'trips', invoice: 'invoices', booking: 'bookings', wo: 'workorders', item: 'items', je: 'journal', report: 'reports' };
  U.after = []; U.charts = []; U.timers = [];
  U.onMount = fn => U.after.push(fn);

  /* ---------- components ---------- */
  U.head = (title, sub, actions = '', crumbs = null) => `<div class="page-head"><div>${crumbs ? `<div class="crumbs">${crumbs.map(c => c[1] ? `<a href="#${c[1]}">${c[0]}</a>` : `<span>${c[0]}</span>`).join('<span>/</span>')}</div>` : ''}<h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="actions">${actions}</div></div>`;
  U.kpi = (label, value, foot = '', extra = '') => `<div class="kpi" ${extra}><div class="kpi-label">${label}</div><div class="kpi-value">${String(value).replace(/ (ج\.م|EGP)(?=<\/span>|$)/, ' <small>$1</small>')}</div>${foot ? `<div class="kpi-foot">${foot}</div>` : ''}</div>`;
  U.kpis = arr => `<div class="kpis">${arr.join('')}</div>`;
  U.card = (title, body, opts = {}) => `<section class="card ${opts.cls || ''}">${title != null ? `<div class="card-head"><div><h2>${title}</h2>${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}</div>${opts.actions ? `<div class="actions">${opts.actions}</div>` : ''}</div>` : ''}<div class="card-body ${opts.flush ? 'flush' : ''}">${body}</div></section>`;
  U.badge = (text, kind = '') => `<span class="badge ${kind}">${text}</span>`;
  U.empty = (icon, title, text = '') => `<div class="empty">${U.icon(icon)}<strong>${title}</strong>${text ? `<div>${text}</div>` : ''}</div>`;
  U.btn = (label, act, kind = '', icon = '', extra = '') => `<button class="btn ${kind}" data-act="${act}" ${extra}>${icon ? U.icon(icon) : ''}${label}</button>`;
  U.link = (label, route) => `<a href="#${route}">${label}</a>`;
  U.progress = (v, kind = '') => `<div class="progress ${kind}"><i style="width:${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%"></i></div>`;
  U.dl = pairs => `<dl class="dl">${pairs.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
  U.money = v => `<span class="num ${v < 0 ? 'neg' : ''}">${M.money(v)}</span>`;
  U.ai = (txt) => `<span class="tag-ai">${U.icon('sparkles')}${txt || M.tt('تحليل ذكي بقواعد واضحة', 'Smart analysis · explainable rules')}</span>`.replace('<svg class=""', '<svg style="width:12px;height:12px"');
  U.est = () => `<span class="tag-est">${M.tt('تقدير', 'Estimate')}</span>`;
  U.ver = () => `<span class="tag-ok">${M.tt('قيمة مؤكدة', 'Verified')}</span>`;

  /* status badges — semantic colors only */
  const ST = {
    active: ['نشطة', 'Active', 'success'], maintenance: ['في الصيانة', 'In workshop', 'warning'], stopped: ['متوقفة', 'Stopped', 'muted'], sold: ['مباعة', 'Sold', 'muted'],
    scheduled: ['مجدولة', 'Scheduled', ''], running: ['جارية', 'In progress', 'warning'], completed: ['مكتملة', 'Completed', 'success'], cancelled: ['ملغاة', 'Cancelled', 'muted'],
    tentative: ['مبدئي', 'Tentative', 'muted'], confirmed: ['مؤكد', 'Confirmed', ''], done: ['منفذ', 'Executed', 'success'],
    finished: ['منتهي', 'Finished', 'success'],
    draft: ['مسودة', 'Draft', 'muted'], issued: ['صادرة', 'Issued', ''], partial: ['مدفوعة جزئياً', 'Partially paid', 'warning'], paid: ['مدفوعة', 'Paid', 'success'], overdue: ['متأخرة', 'Overdue', 'danger'],
    posted: ['مرحّل', 'Posted', ''], exported: ['مُصدَّر', 'Exported', 'success'],
    synced: ['متزامن', 'Synced', 'success'], failed: ['فشل', 'Failed', 'danger'], not_synced: ['غير متزامن', 'Not synced', 'muted'],
    ok: ['سليم', 'OK', 'success'], soon: ['قريب', 'Due soon', 'warning'], reorder: ['حد الطلب', 'Reorder', 'warning'], out: ['نفد', 'Out of stock', 'danger'], over: ['زيادة', 'Overstock', 'muted'],
    open: ['مفتوح', 'Open', ''], waiting_parts: ['في انتظار قطع', 'Waiting for parts', 'warning'], in_progress: ['جاري', 'In progress', 'warning'], closed: ['مغلق', 'Closed', 'success'],
    approved: ['معتمد', 'Approved', 'success'], received: ['مستلم', 'Received', 'success'], pending: ['قيد الانتظار', 'Pending', 'warning'],
    online: ['متصل', 'Online', 'success'], offline: ['غير متصل', 'Offline', 'danger'], connected: ['متصل', 'Connected', 'success'], not_connected: ['غير متصل', 'Not connected', 'muted'], error: ['خطأ', 'Error', 'danger'],
    matched: ['مطابقة', 'Matched', 'success'], unmatched: ['غير مطابقة', 'Unmatched', 'warning'], rejected: ['مرفوضة', 'Rejected', 'danger'],
    passed: ['ناجح', 'Passed', 'success'], high: ['عالية', 'High', 'danger'], medium: ['متوسطة', 'Medium', 'warning'], low: ['منخفضة', 'Low', 'muted'],
    mounted: ['مركّب', 'Mounted', 'success'], in_stock: ['في المخزن', 'In stock', ''], scrapped: ['مستبعد', 'Scrapped', 'muted'],
    invited: ['دعوة مرسلة', 'Invited', 'muted'], revoked: ['ملغي', 'Revoked', 'muted'], delivered: ['تم التسليم', 'Delivered', 'success'], retrying: ['إعادة محاولة', 'Retrying', 'warning'], success: ['ناجح', 'Success', 'success'],
    valid: ['مقبولة', 'Valid', 'success'], submitted: ['مُرسلة', 'Submitted', 'warning'], quote_pending: ['عرض سعر للموافقة', 'Quote to approve', 'warning'],
    blocked: ['موقوف', 'Blocked', 'danger'], leave: ['إجازة', 'Leave', 'warning'], rest: ['راحة', 'Rest day', 'muted'], ready: ['جاهزة', 'Ready', 'success'], notready: ['غير جاهزة', 'Not ready', 'danger'],
    owned: ['مملوكة', 'Owned', 'plain'], installment: ['تقسيط', 'Installment', 'plain'], leased: ['مؤجرة', 'Leased', 'plain'], price_variance: ['فرق سعر', 'Price variance', 'warning'],
  };
  U.status = (k) => { const s = ST[k]; return s ? U.badge(M.tt(s[0], s[1]), s[2]) : U.badge(M.esc(k), 'muted'); };
  U.statusText = k => { const s = ST[k]; return s ? M.tt(s[0], s[1]) : k; };

  /* entity labels */
  U.vtype = t => M.vehicleClasses[t] ? M.L(M.vehicleClasses[t].name) : (t || '—');
  /* a vehicle's capacity in words: seats for passenger vehicles, payload for cargo ones */
  U.capacity = v => (v.seats > 0 ? `${v.seats} ${M.tt('مقعد', 'seats')}` : '') + ((v.payloadKg || 0) > 0 ? `${v.seats > 0 ? ' · ' : ''}${M.n0(v.payloadKg)} ${M.tt('كجم', 'kg')}` : '');
  /* a form field for an identity number, labelled and checked the way the company's country writes it */
  U.idField = (f, key, fallback, value) => { const p = M.field(key, fallback); return { f, label: M.L(p.label), value, help: p.hint ? M.L(p.hint) : '', attrs: `dir="ltr" inputmode="numeric"${p.placeholder ? ` placeholder="${p.placeholder}"` : ''}${p.pattern ? ` pattern="${p.pattern.replace(/^\^|\$$/g, '')}"` : ''}` }; };
  U.licenseOptions = () => (M.pack ? M.pack.licenseClasses : [['first', { ar: 'أولى', en: 'First' }], ['second', { ar: 'ثانية', en: 'Second' }], ['third', { ar: 'ثالثة', en: 'Third' }], ['professional', { ar: 'مهنية', en: 'Professional' }]]).map(([k, n]) => [k, M.L(n)]);
  U.catName = code => { const k = (M.vehicleCategories || []).find(x => x.code === code); return k ? M.L(k.name) : (code || '—'); };
  U.FUELS = ['diesel', 'gasoline', 'electric', 'hybrid', 'cng'];
  U.fuelName = f => ({ diesel: M.tt('سولار', 'Diesel'), gasoline: M.tt('بنزين', 'Gasoline'), electric: M.tt('كهرباء', 'Electric'), hybrid: M.tt('هايبرد', 'Hybrid'), cng: M.tt('غاز طبيعي', 'CNG') })[f] || f;
  U.vLabel = v => v && !v._missing ? `<a href="#vehicle.${v.id}" class="cell-main">${M.esc(v.code)}</a><div class="cell-sub">${M.esc(M.L(v.plate))} · ${M.esc(U.vtype(v.type))}</div>` : '—';
  U.dLabel = d => d && !d._missing ? `<a href="#driver.${d.id}">${M.esc(M.L(d.name))}</a>` : '—';
  U.cLabel = c => c && !c._missing ? `<a href="#client.${c.id}">${M.esc(M.L(c.name))}</a>` : '—';
  U.place = k => M.places[k] ? M.L(M.places[k].name) : (k || '—');
  U.arrow = () => M.lang === 'ar' ? '←' : '→';
  U.routeTxt = (a, b) => `${M.esc(U.place(a))} ${U.arrow()} ${M.esc(U.place(b))}`;
  /* records referenced by id always exist in the database; when one falls outside the
     browser's history window a neutral placeholder is returned instead of crashing */
  const MISSING = { _missing: true, id: '', code: '—', number: '—', name: { ar: '—', en: '—' }, plate: { ar: '—', en: '—' }, type: '', seats: 0, phone: '', contact: { ar: '', en: '' }, odometer: 0, lines: [], days: [], parts: [] };
  U.find = (coll, id) => (id && (U.db()[coll] || []).find(x => x.id === id)) || MISSING;
  U.has = (coll, id) => !!(id && (U.db()[coll] || []).find(x => x.id === id));

  /* ---------- data table ---------- */
  let tblSeq = 0; U.tables = {};
  U.table = (cfg) => {
    const id = cfg.id || ('t' + (++tblSeq));
    const st = U.tables[id] = Object.assign({ page: 0, q: '', sort: cfg.sort || null, dir: cfg.dir || -1, filters: {}, size: cfg.pageSize || 15 }, U.tables[id] && U.tables[id].keep ? U.tables[id] : {}, { cfg });
    U.onMount(() => U.drawTable(id));
    const tools = (cfg.search !== false || cfg.filters || cfg.export !== false) ? `<div class="table-tools">
      ${cfg.search !== false ? `<input type="search" data-tbl-q="${id}" placeholder="${M.tt('بحث في الجدول…', 'Search this table…')}" aria-label="${M.tt('بحث', 'Search')}">` : ''}
      ${(cfg.filters || []).map((f, i) => `<select data-tbl-f="${id}" data-fi="${i}" aria-label="${f.label}"><option value="">${f.label}: ${M.tt('الكل', 'All')}</option>${f.options.map(o => `<option value="${M.esc(o[0])}">${o[1]}</option>`).join('')}</select>`).join('')}
      <span style="flex:1"></span>${cfg.tools || ''}
      ${cfg.export !== false ? `<div class="seg" role="group" aria-label="${M.tt('تصدير', 'Export')}"><button data-export="${id}" data-fmt="xlsx">Excel</button><button data-export="${id}" data-fmt="pdf">PDF</button><button data-export="${id}" data-fmt="csv">CSV</button></div>` : ''}
    </div>` : '';
    return `<div class="dt-box" id="${id}">${tools}<div class="table-wrap" data-tbl-body="${id}"></div><div class="pager" data-tbl-pager="${id}"></div></div>`;
  };
  U.tableRows = (id) => {
    const st = U.tables[id]; const cfg = st.cfg;
    let rows = cfg.rows.slice();
    (cfg.filters || []).forEach((f, i) => { const v = st.filters[i]; if (v) rows = rows.filter(r => String(f.get(r)) === v); });
    if (st.q) { const q = st.q.toLowerCase(); rows = rows.filter(r => cfg.columns.some(c => { const v = c.text ? c.text(r) : c.value ? c.value(r) : r[c.key]; return v != null && String(v).toLowerCase().includes(q); })); }
    if (st.sort != null) { const c = cfg.columns[st.sort]; const g = c.value || (r => r[c.key]); rows.sort((a, b) => { const x = g(a), y = g(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; }); }
    return rows;
  };
  U.drawTable = (id) => {
    const st = U.tables[id]; if (!st) return; const cfg = st.cfg;
    const body = document.querySelector(`[data-tbl-body="${id}"]`); if (!body) return;
    const rows = U.tableRows(id);
    const pages = Math.max(1, Math.ceil(rows.length / st.size)); if (st.page >= pages) st.page = pages - 1;
    const slice = cfg.noPaging ? rows : rows.slice(st.page * st.size, st.page * st.size + st.size);
    if (!rows.length) { body.innerHTML = U.empty('search', cfg.emptyTitle || M.tt('لا توجد بيانات', 'Nothing to show'), cfg.emptyText || M.tt('جرّب تغيير البحث أو الفلاتر.', 'Try a different search or filter.')); document.querySelector(`[data-tbl-pager="${id}"]`).innerHTML = ''; return; }
    const th = cfg.columns.map((c, i) => `<th class="${c.num ? 'n' : ''} ${c.sort !== false ? 'sortable' : ''}" ${c.sort !== false ? `data-tbl-sort="${id}" data-ci="${i}" tabindex="0"` : ''}>${c.label}${st.sort === i ? `<span class="arrow">${st.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');
    const tr = slice.map(r => `<tr ${cfg.onRow ? `class="click" data-row-go="${cfg.onRow(r)}"` : ''}>${cfg.columns.map(c => { const v = c.render ? c.render(r) : M.esc(c.value ? c.value(r) : r[c.key]); return `<td class="${c.num ? 'n num' : ''}">${v == null ? '—' : v}</td>`; }).join('')}</tr>`).join('');
    const foot = cfg.footer ? `<tfoot><tr>${cfg.columns.map((c, i) => `<td class="${c.num ? 'n num' : ''}">${cfg.footer(rows, c, i) ?? ''}</td>`).join('')}</tr></tfoot>` : '';
    body.innerHTML = `<table class="dt"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${foot}</table>`;
    const pager = document.querySelector(`[data-tbl-pager="${id}"]`);
    pager.innerHTML = cfg.noPaging ? `<span>${M.n0(rows.length)} ${M.tt('سجل', 'records')}</span>` : `<span>${M.tt('عرض', 'Showing')} ${M.n0(st.page * st.size + 1)}–${M.n0(Math.min(rows.length, (st.page + 1) * st.size))} ${M.tt('من', 'of')} ${M.n0(rows.length)}</span><span class="btns"><button class="btn secondary sm" data-tbl-page="${id}" data-d="-1" ${st.page === 0 ? 'disabled' : ''}>${M.tt('السابق', 'Previous')}</button><button class="btn secondary sm" data-tbl-page="${id}" data-d="1" ${st.page >= pages - 1 ? 'disabled' : ''}>${M.tt('التالي', 'Next')}</button></span>`;
  };
  U.csv = (id) => {
    const st = U.tables[id]; const cfg = st.cfg; const rows = U.tableRows(id);
    const strip = s => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/&amp;/g, '&');
    const q = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const head = cfg.columns.map(c => q(strip(c.label))).join(',');
    return [head, ...rows.map(r => cfg.columns.map(c => q(strip(c.text ? c.text(r) : c.value ? c.value(r) : c.render ? c.render(r) : r[c.key]))).join(','))].join('\n');
  };

  /* ---------- charts: dependency-free SVG (bar, line, mixed, horizontal bar, doughnut) ----------
     Same call shape as before: U.chart(id, { type, size, label, data: { labels, datasets }, options }).
     Drawn after the page is mounted so the SVG uses the real width; redrawn on resize. */
  U.palette = ['#08264A', '#5A7493', '#8FA3BA', '#2C4A6E', '#C3CFDC', '#3E5F84'];
  const fmtAxis = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v * 100) / 100); };
  const fmtVal = v => v == null || isNaN(v) ? '—' : Math.abs(v) >= 100 ? M.n0(v) : M.n2(v);
  function niceScale(min, max, ticks = 5) {
    if (min === max) { max = min + 1; }
    const span = max - min; const step0 = span / ticks; const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || mag * 10;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return { lo, hi, ticks: out };
  }
  function drawChart(el, config) {
    const W = Math.max(240, el.clientWidth || 600), H = Math.max(160, el.clientHeight || 260);
    const rtl = M.lang === 'ar', font = rtl ? 'Cairo, sans-serif' : 'Inter, sans-serif';
    const ds = (config.data.datasets || []).filter(Boolean), labels = config.data.labels || [];
    const legendItems = [];
    let svg = '';
    const esc = M.esc;
    if (config.type === 'doughnut' || config.type === 'pie') {
      const d0 = ds[0] || { data: [] }; const vals = d0.data.map(v => Math.max(0, +v || 0)); const tot = M.sum(vals);
      const colors = d0.colors || U.palette; const cx = Math.min(W, H) / 2, cy = H / 2, r = Math.min(W, H) / 2 - 8, ir = r * 0.62;
      const ox = rtl ? W - cx - 8 : cx + 8;
      let ang = -Math.PI / 2;
      vals.forEach((v, i) => {
        const col = colors[i % colors.length]; legendItems.push([col, labels[i], tot ? v / tot : 0, v]);
        if (!tot || !v) return;
        const a2 = ang + (v / tot) * Math.PI * 2; const big = a2 - ang > Math.PI ? 1 : 0;
        const p = (a, rr) => [ox + rr * Math.cos(a), cy + rr * Math.sin(a)];
        const [x1, y1] = p(ang, r), [x2, y2] = p(a2, r), [x3, y3] = p(a2, ir), [x4, y4] = p(ang, ir);
        const full = v === tot;
        svg += full ? `<circle cx="${ox}" cy="${cy}" r="${(r + ir) / 2}" fill="none" stroke="${col}" stroke-width="${r - ir}"><title>${esc(labels[i])}: ${fmtVal(v)}</title></circle>`
          : `<path d="M${x1} ${y1} A${r} ${r} 0 ${big} 1 ${x2} ${y2} L${x3} ${y3} A${ir} ${ir} 0 ${big} 0 ${x4} ${y4} Z" fill="${col}" stroke="#fff" stroke-width="2"><title>${esc(labels[i])}: ${fmtVal(v)} (${M.pct(v / tot)})</title></path>`;
        ang = a2;
      });
      if (!tot) svg += `<text x="${ox}" y="${cy}" text-anchor="middle" font-size="12" fill="#64748B" font-family="${font}">${M.tt('لا توجد بيانات', 'No data')}</text>`;
      const lx = rtl ? 12 : Math.min(W, H) + 24;
      const legend = legendItems.map((l, i) => `<g transform="translate(${rtl ? W - Math.min(W, H) - 24 - 180 : lx} ${16 + i * 20})"><rect width="10" height="10" rx="2" fill="${l[0]}"/><text x="16" y="9" font-size="12" fill="#08264A" font-family="${font}">${esc(l[1])} · ${M.pct(l[2], 0)}</text></g>`).join('');
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(config.label || '')}">${svg}${W > Math.min(W, H) + 200 ? legend : ''}</svg>`;
      return;
    }
    const horizontal = config.options && config.options.indexAxis === 'y';
    const showLegend = ds.length > 1;
    const padL = horizontal ? Math.min(140, Math.max(60, Math.max(...labels.map(l => String(l).length)) * 7)) : 52, padR = 12, padT = 10, padB = (showLegend ? 46 : 28);
    const pw = W - padL - padR, ph = H - padT - padB;
    let all = []; ds.forEach(d => d.data.forEach(v => { if (v != null && !isNaN(v)) all.push(+v); }));
    if (!all.length) all = [0];
    const sc = niceScale(Math.min(0, ...all), Math.max(0, ...all));
    const n = labels.length || 1;
    const vpos = v => (v - sc.lo) / (sc.hi - sc.lo);
    const X = i => { const x = padL + (i + 0.5) / n * pw; return rtl && !horizontal ? W - x + padL - padR : x; };
    const plotX0 = rtl && !horizontal ? padR : padL;
    const grid = sc.ticks.map(t => {
      if (horizontal) { let x = padL + vpos(t) * pw; if (rtl) x = W - x + padL - padR; return `<line x1="${x}" x2="${x}" y1="${padT}" y2="${padT + ph}" stroke="#EEF1F5"/><text x="${x}" y="${H - padB + 16}" text-anchor="middle" font-size="11" fill="#64748B" font-family="Inter">${fmtAxis(t)}</text>`; }
      const y = padT + ph - vpos(t) * ph; const tx = rtl ? W - padR - 4 + 0 : padL - 6;
      return `<line x1="${rtl ? padR : padL}" x2="${rtl ? W - padL : W - padR}" y1="${y}" y2="${y}" stroke="#EEF1F5"/><text x="${rtl ? W - padL + 6 : tx}" y="${y + 4}" text-anchor="${rtl ? 'start' : 'end'}" font-size="11" fill="#64748B" font-family="Inter">${fmtAxis(t)}</text>`;
    }).join('');
    const bars = ds.filter(d => (d.type || config.type) === 'bar'), lines = ds.filter(d => (d.type || config.type) === 'line');
    let body = '';
    if (horizontal) {
      const bh = ph / n * 0.7 / Math.max(1, bars.length);
      labels.forEach((lab, i) => {
        const y0 = padT + i / n * ph + ph / n * 0.15;
        const ly = padT + (i + 0.5) / n * ph + 4;
        body += `<text x="${rtl ? W - 4 : padL - 6}" y="${ly}" text-anchor="${rtl ? 'start' : 'end'}" font-size="11" fill="#08264A" font-family="${font}" direction="${rtl ? 'rtl' : 'ltr'}">${esc(lab)}</text>`;
        bars.forEach((d, k) => {
          const v = +d.data[i] || 0; const col = (d.colors && d.colors[i]) || d.color || U.palette[k % U.palette.length];
          let a = padL + vpos(Math.min(0, v)) * pw, b = padL + vpos(Math.max(0, v)) * pw;
          if (rtl) { const a2 = W - b + padL - padR, b2 = W - a + padL - padR; a = a2; b = b2; }
          body += `<rect x="${a}" y="${y0 + k * bh}" width="${Math.max(1, b - a)}" height="${Math.max(2, bh - 2)}" rx="3" fill="${col}"><title>${esc(lab)} · ${esc(d.label || '')}: ${fmtVal(v)}</title></rect>`;
        });
      });
    } else {
      const slot = pw / n, bw = Math.min(34, slot * 0.7 / Math.max(1, bars.length));
      const step = Math.ceil(n / Math.max(1, Math.floor(pw / 70)));
      labels.forEach((lab, i) => { if (i % step === 0) body += `<text x="${X(i)}" y="${padT + ph + 16}" text-anchor="middle" font-size="11" fill="#64748B" font-family="${font}">${esc(lab)}</text>`; });
      const zero = padT + ph - vpos(0) * ph;
      bars.forEach((d, k) => d.data.forEach((v0, i) => {
        if (v0 == null || isNaN(v0)) return; const v = +v0;
        const col = (d.colors && d.colors[i]) || d.color || U.palette[k % U.palette.length];
        const x = X(i) - bars.length * bw / 2 + k * bw; const y = padT + ph - vpos(Math.max(0, v)) * ph; const h = Math.abs(padT + ph - vpos(v) * ph - zero);
        body += `<rect x="${x + 1}" y="${v >= 0 ? y : zero}" width="${Math.max(1, bw - 2)}" height="${Math.max(1, h)}" rx="3" fill="${col}"><title>${esc(lab(labels, i))} · ${esc(d.label || '')}: ${fmtVal(v)}</title></rect>`;
      }));
      lines.forEach((d, k) => {
        const col = d.color || d.borderColor || U.palette[(bars.length + k) % U.palette.length];
        const pts = d.data.map((v, i) => v == null || isNaN(v) ? null : [X(i), padT + ph - vpos(+v) * ph, v, i]);
        let path = '', open = false;
        pts.forEach(p => { if (!p) { open = false; return; } path += (open ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; open = true; });
        if (d.fill && pts.filter(Boolean).length > 1) { const f = pts.filter(Boolean); body += `<path d="${path} L${f[f.length - 1][0]} ${zero} L${f[0][0]} ${zero} Z" fill="${col}" opacity=".08"/>`; }
        body += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2" ${d.borderDash ? `stroke-dasharray="${d.borderDash.join(' ')}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
        if (d.pointRadius !== 0 && pts.length <= 60) pts.forEach(p => { if (p) body += `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${col}"><title>${esc(labels[p[3]])} · ${esc(d.label || '')}: ${fmtVal(p[2])}</title></circle>`; });
      });
    }
    function lab(l, i) { return l[i]; }
    const legend = showLegend ? ds.map((d, k) => { const col = (d.type || config.type) === 'line' ? (d.color || d.borderColor || U.palette[k % U.palette.length]) : (d.color || U.palette[k % U.palette.length]); return [col, d.label]; }) : [];
    let lx = 0; const leg = legend.map(([col, l]) => { const w = String(l).length * 7 + 28; const g = `<g transform="translate(${lx} 0)"><rect width="10" height="10" rx="5" fill="${col}"/><text x="15" y="9" font-size="12" fill="#08264A" font-family="${font}">${esc(l)}</text></g>`; lx += w; return g; }).join('');
    const legG = showLegend ? `<g transform="translate(${Math.max(4, (W - lx) / 2)} ${H - 14})">${leg}</g>` : '';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(config.label || '')}" direction="ltr">${grid}${body}${legG}</svg>`;
  }
  U.chart = (id, config) => {
    U.onMount(() => { const el = document.getElementById(id); if (!el) return; U.charts.push({ el, config }); drawChart(el, config); });
    return `<div class="chart-box ${config.size || ''}" id="${id}"></div>`;
  };
  U.drawChart = drawChart;
  let rz = null;
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => U.charts.forEach(c => { if (document.body.contains(c.el)) drawChart(c.el, c.config); }), 150); });

  /* ---------- sheet / modal / toast ---------- */
  U.sheet = (title, body, sub = '') => { U.closeOverlays(); const d = document.createElement('div'); d.id = 'overlay'; d.innerHTML = `<div class="sheet-scrim" data-act="close-overlay"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="${M.esc(title)}"><div class="sheet-head"><div><h2>${title}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button class="icon-btn" data-act="close-overlay" aria-label="${M.tt('إغلاق', 'Close')}">${U.icon('x')}</button></div><div class="sheet-body">${body}</div></aside>`; document.body.appendChild(d); if (U.after.length) { const a = U.after; U.after = []; a.forEach(f => f()); } d.querySelector('.sheet .icon-btn').focus(); };
  U.modal = (title, body, foot = '') => { U.closeOverlays(); const d = document.createElement('div'); d.id = 'overlay'; d.innerHTML = `<div class="modal-scrim" data-act="close-overlay"></div><div class="modal" role="dialog" aria-modal="true" aria-label="${M.esc(title)}"><div class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-act="close-overlay" aria-label="${M.tt('إغلاق', 'Close')}">${U.icon('x')}</button></div><div class="sheet-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`; document.body.appendChild(d); if (U.after.length) { const a = U.after; U.after = []; a.forEach(f => f()); } const f = d.querySelector('input,select,textarea,button.btn'); if (f) f.focus(); };
  U.closeOverlays = () => { const o = document.getElementById('overlay'); if (o) o.remove(); };
  U.toast = (msg, kind) => { document.querySelectorAll('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.setAttribute('role', kind === 'error' ? 'alert' : 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000); };

  /* actions registry: data-act="name" -> handler(el, event) */
  U.acts = {};
  U.act = (name, fn) => { U.acts[name] = fn; };
  U.act('open-nav', () => document.body.classList.add('nav-open'));
  U.act('close-nav', () => document.body.classList.remove('nav-open'));
  U.act('close-overlay', () => U.closeOverlays());
  U.guard = () => { if (U.readOnly()) { U.toast(M.tt('دور المراجع للقراءة فقط', 'The viewer role is read only')); return false; } return true; };

  /* ---------- global events ---------- */
  U.bind = () => {
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (a && U.acts[a.dataset.act]) { const nav = a.tagName === 'A' && a.dataset.act === 'close-overlay'; if (!nav) e.preventDefault(); U.acts[a.dataset.act](a, e); return; }
      const l = e.target.closest('[data-lang]'); if (l) { M.lang = l.dataset.lang; store.set('lang', M.lang); if (M.api.session && M.api.session.user) M.api.post('/api/session/lang', { lang: M.lang }).catch(() => {}); U.full(); return; }
      const s = e.target.closest('[data-tbl-sort]'); if (s) { const st = U.tables[s.dataset.tblSort]; const ci = +s.dataset.ci; st.dir = st.sort === ci ? -st.dir : -1; st.sort = ci; U.drawTable(s.dataset.tblSort); return; }
      const p = e.target.closest('[data-tbl-page]'); if (p) { const st = U.tables[p.dataset.tblPage]; st.page += +p.dataset.d; U.drawTable(p.dataset.tblPage); return; }
      const ex = e.target.closest('[data-export]'); if (ex) { U.exportTable(ex.dataset.export, ex.dataset.fmt); return; }
      const row = e.target.closest('[data-row-go]'); if (row && !e.target.closest('a,button')) { const v = row.dataset.rowGo; if (v.startsWith('fn:')) U.acts[v.slice(3).split('|')[0]](row, e, v.slice(3).split('|')[1]); else location.hash = v; return; }
      const sr = e.target.closest('#gsearch-res a'); if (sr) { $('#gsearch-res').hidden = true; }
      if (!e.target.closest('.search')) { const r = $('#gsearch-res'); if (r) r.hidden = true; }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { U.closeOverlays(); document.body.classList.remove('nav-open'); }
      if (e.key === 'Enter' && e.target.matches('[data-tbl-sort]')) e.target.click();
    });
    document.addEventListener('input', e => {
      if (e.target.matches('[data-tbl-q]')) { const st = U.tables[e.target.dataset.tblQ]; st.q = e.target.value; st.page = 0; U.drawTable(e.target.dataset.tblQ); }
      if (e.target.id === 'gsearch') U.globalSearch(e.target.value);
    });
    document.addEventListener('change', e => {
      if (e.target.matches('[data-tbl-f]')) { const st = U.tables[e.target.dataset.tblF]; st.filters[e.target.dataset.fi] = e.target.value; st.page = 0; U.drawTable(e.target.dataset.tblF); }
      if (e.target.id === 'company-switch') { U.switchCompany(e.target.value); }
      const h = e.target.closest('[data-change]'); if (h && U.acts[h.dataset.change]) U.acts[h.dataset.change](h, e);
    });
    window.addEventListener('hashchange', () => { U.closeOverlays(); U.render(); });
  };
  U.full = () => { U.renderShell(); U.render(); };

  U.globalSearch = (q) => {
    const box = $('#gsearch-res'); q = q.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; return; }
    const db = U.db(); const res = [];
    db.vehicles.forEach(v => { if ((v.code + ' ' + v.plate.ar + ' ' + v.plate.en + ' ' + v.make + ' ' + v.model).toLowerCase().includes(q)) res.push([`vehicle.${v.id}`, 'car', v.code + ' · ' + M.L(v.plate), U.vtype(v.type)]); });
    db.drivers.forEach(d => { if ((d.name.ar + ' ' + d.name.en + ' ' + d.code + ' ' + d.phone).toLowerCase().includes(q)) res.push([`driver.${d.id}`, 'user', M.L(d.name), d.code]); });
    db.clients.forEach(c => { if ((c.name.ar + ' ' + c.name.en + ' ' + c.code).toLowerCase().includes(q)) res.push([`client.${c.id}`, 'users', M.L(c.name), c.code]); });
    db.bookings.forEach(b => { if (b.number.toLowerCase().includes(q)) res.push([`booking.${b.id}`, 'ticket', b.number, M.date(b.date)]); });
    db.invoices.forEach(i => { if (i.number.toLowerCase().includes(q)) res.push([`invoice.${i.id}`, 'file', i.number, M.money(i.total)]); });
    db.trips.forEach(t => { if (t.number.toLowerCase().includes(q)) res.push([`trip.${t.id}`, 'bus', t.number, M.date(t.date)]); });
    db.programs.forEach(p => { if ((p.number + ' ' + p.name.ar + ' ' + p.name.en).toLowerCase().includes(q)) res.push([`program.${p.id}`, 'route', p.number, M.L(p.name)]); });
    box.innerHTML = res.length ? res.slice(0, 12).map(r => `<a href="#${r[0]}">${U.icon(r[1])}<span><b>${M.esc(r[2])}</b><div class="cell-sub">${M.esc(r[3])}</div></span></a>`).join('') : `<div class="empty small">${M.tt('لا توجد نتائج في هذه الشركة', 'No results in this company')}</div>`;
    box.querySelectorAll('svg').forEach(s => { s.style.width = '16px'; s.style.height = '16px'; s.style.flex = 'none'; s.style.marginTop = '3px'; });
    box.hidden = false;
  };

  /* period selector shared by several pages */
  U.periods = () => {
    const m = M.calc.months(); const cur = m[m.length - 1], prev = m[m.length - 2] || cur;
    return [
      ['mtd', M.tt('الشهر الحالي', 'This month'), ...M.calc.monthRange(cur)],
      ['last', M.tt('الشهر الماضي', 'Last month'), ...M.calc.monthRange(prev)],
      ['q', M.tt('آخر 3 شهور', 'Last 3 months'), M.maxDate(M.START, `${M.addMonths(cur, -3)}-01`), M.maxDate(M.START, M.addDays(M.TODAY, -1))],
      ['h', M.tt('آخر 6 شهور', 'Last 6 months'), M.maxDate(M.START, M.addDays(M.TODAY, -183)), M.maxDate(M.START, M.addDays(M.TODAY, -1))],
    ];
  };
  U.period = store.get('period', 'last');
  U.periodRange = () => { const p = U.periods().find(x => x[0] === U.period) || U.periods()[1]; return { key: p[0], label: p[1], from: p[2], to: p[3] }; };
  U.periodSeg = () => `<div class="seg" role="group" aria-label="${M.tt('الفترة', 'Period')}">${U.periods().map(p => `<button data-act="set-period" data-p="${p[0]}" class="${p[0] === U.period ? 'on' : ''}">${p[1]}</button>`).join('')}</div>`;
  U.act('set-period', el => { U.period = el.dataset.p; store.set('period', U.period); U.render(); });

  /* simple form helper */
  U.field = (id, label, input, opts = {}) => `<div class="field ${opts.full ? 'full' : ''}"><label for="${id}">${label}</label>${input}${opts.help ? `<div class="help">${opts.help}</div>` : ''}</div>`;
  U.input = (id, value = '', type = 'text', extra = '') => `<input id="${id}" type="${type}" value="${M.esc(value)}" ${extra}>`;
  U.select = (id, options, value = '', extra = '') => `<select id="${id}" ${extra}>${options.map(o => `<option value="${M.esc(o[0])}" ${String(o[0]) === String(value) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  U.val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
})();
