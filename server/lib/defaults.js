'use strict';
/* Starting reference data copied into a NEW company when it is created. Every value is
   editable per company afterwards (Settings → Vehicle types / Places & routes / Accounts).
   No transactional or sample business data is created. */

const VEHICLE_TYPES = [
  { code: 'LB', ar: 'أتوبيس كبير', en: 'Large bus', seats: 50, fuel: 'diesel', oilKm: 15000, lifeYears: 10, lifeKm: 1000000, salvagePct: 0.15, tank: 400, kmpl: 3.2, priceMin: 4200000, priceMax: 5400000, rateKm: 25, base: 2200, tollGate: 90, oilCost: 9500, oilLiters: 32, insurance: 95000, license: 18000, tires: ['FL', 'FR', 'RLO', 'RLI', 'RRO', 'RRI'] },
  { code: 'MB', ar: 'أتوبيس متوسط', en: 'Medium bus', seats: 33, fuel: 'diesel', oilKm: 10000, lifeYears: 10, lifeKm: 800000, salvagePct: 0.15, tank: 200, kmpl: 5, priceMin: 2500000, priceMax: 3200000, rateKm: 18, base: 1500, tollGate: 60, oilCost: 5200, oilLiters: 16, insurance: 60000, license: 12000, tires: ['FL', 'FR', 'RLO', 'RLI', 'RRO', 'RRI'] },
  { code: 'MC', ar: 'ميكروباص', en: 'Microbus', seats: 14, fuel: 'diesel', oilKm: 10000, lifeYears: 8, lifeKm: 600000, salvagePct: 0.2, tank: 70, kmpl: 9, priceMin: 1600000, priceMax: 2000000, rateKm: 14, base: 950, tollGate: 35, oilCost: 2400, oilLiters: 7, insurance: 32000, license: 6000, tires: ['FL', 'FR', 'RL', 'RR'] },
  { code: 'SD', ar: 'سيارة سيدان', en: 'Sedan', seats: 4, fuel: 'gasoline', oilKm: 7500, lifeYears: 6, lifeKm: 400000, salvagePct: 0.25, tank: 55, kmpl: 12, priceMin: 1100000, priceMax: 1450000, rateKm: 11, base: 600, tollGate: 20, oilCost: 1500, oilLiters: 4.5, insurance: 22000, license: 3500, tires: ['FL', 'FR', 'RL', 'RR'] },
];

/* Common Egyptian tourism points (approximate coordinates). radius = geofence size in meters. */
const PLACES = [
  ['CAI', 'القاهرة', 'Cairo', 30.044, 31.236, 'city', 3000], ['GIZ', 'أهرامات الجيزة', 'Giza Pyramids', 29.979, 31.134, 'site', 800],
  ['CAIAP', 'مطار القاهرة', 'Cairo Airport', 30.112, 31.4, 'airport', 1500], ['ALX', 'الإسكندرية', 'Alexandria', 31.2, 29.918, 'city', 3000],
  ['HRG', 'الغردقة', 'Hurghada', 27.257, 33.811, 'city', 3000], ['HRGAP', 'مطار الغردقة', 'Hurghada Airport', 27.178, 33.799, 'airport', 1500],
  ['SSH', 'شرم الشيخ', 'Sharm El Sheikh', 27.915, 34.33, 'city', 3000], ['SSHAP', 'مطار شرم الشيخ', 'Sharm Airport', 27.977, 34.395, 'airport', 1500],
  ['LXR', 'الأقصر', 'Luxor', 25.687, 32.639, 'city', 3000], ['LXRAP', 'مطار الأقصر', 'Luxor Airport', 25.671, 32.706, 'airport', 1500],
  ['LXRW', 'البر الغربي', 'Luxor West Bank', 25.733, 32.601, 'site', 800], ['ASW', 'أسوان', 'Aswan', 24.089, 32.899, 'city', 3000],
  ['ASWAP', 'مطار أسوان', 'Aswan Airport', 23.964, 32.82, 'airport', 1500], ['ABS', 'أبو سمبل', 'Abu Simbel', 22.336, 31.626, 'site', 800],
  ['SOK', 'العين السخنة', 'Ain Sokhna', 29.6, 32.317, 'city', 3000], ['FYM', 'الفيوم', 'Fayoum', 29.308, 30.842, 'city', 3000],
  ['RMA', 'مرسى علم', 'Marsa Alam', 25.065, 34.892, 'city', 3000],
];

/* base city, from, to, km, type, toll gates, hours */
const ROUTES = [
  ['CAI', 'CAIAP', 'CAI', 35, 'airport', 0, 1.5], ['CAI', 'CAI', 'CAIAP', 35, 'airport', 0, 1.5], ['CAI', 'CAI', 'GIZ', 60, 'city', 0, 6], ['CAI', 'CAI', 'CAI', 140, 'hire', 0, 9],
  ['CAI', 'CAI', 'ALX', 220, 'intercity', 2, 4], ['CAI', 'CAI', 'HRG', 460, 'intercity', 3, 7], ['CAI', 'CAI', 'SOK', 130, 'intercity', 1, 2.5], ['CAI', 'CAI', 'FYM', 100, 'intercity', 1, 2],
  ['CAI', 'CAI', 'SSH', 500, 'intercity', 3, 7.5], ['CAI', 'CAI', 'LXR', 650, 'intercity', 3, 9],
  ['HRG', 'HRGAP', 'HRG', 15, 'airport', 0, 0.7], ['HRG', 'HRG', 'HRGAP', 15, 'airport', 0, 0.7], ['HRG', 'HRG', 'HRG', 50, 'city', 0, 5], ['HRG', 'HRG', 'LXR', 290, 'intercity', 1, 4.5],
  ['HRG', 'HRG', 'RMA', 270, 'intercity', 1, 4], ['HRG', 'HRG', 'CAI', 460, 'intercity', 3, 7], ['HRG', 'HRG', 'HRG', 120, 'hire', 0, 8],
  ['LXR', 'LXRAP', 'LXR', 12, 'airport', 0, 0.5], ['LXR', 'LXR', 'LXRAP', 12, 'airport', 0, 0.5], ['LXR', 'LXR', 'LXRW', 70, 'city', 0, 6], ['LXR', 'LXR', 'ASW', 210, 'intercity', 1, 3.5],
  ['LXR', 'ASW', 'ABS', 280, 'intercity', 0, 3.5], ['LXR', 'LXR', 'HRG', 290, 'intercity', 1, 4.5], ['LXR', 'ASWAP', 'ASW', 25, 'airport', 0, 0.7], ['LXR', 'LXR', 'LXR', 110, 'hire', 0, 8],
];

/* chart-of-accounts mapping: key used by posting rules -> local code; erp code = same until mapped */
const COA = [
  ['revenue_airport', 'إيراد استقبال مطار', 'Revenue – airport transfers', '4101'], ['revenue_city', 'إيراد جولات داخلية', 'Revenue – city tours', '4102'],
  ['revenue_intercity', 'إيراد رحلات بين المدن', 'Revenue – intercity', '4103'], ['revenue_hire', 'إيراد تأجير خاص', 'Revenue – private hire', '4104'],
  ['revenue_program', 'إيراد برامج سياحية', 'Revenue – tour programs', '4105'], ['revenue_other', 'إيرادات أخرى', 'Other revenue', '4109'],
  ['vat_out', 'ضريبة القيمة المضافة – مخرجات', 'VAT output', '2301'], ['vat_in', 'ضريبة القيمة المضافة – مدخلات', 'VAT input', '1501'],
  ['receivables', 'العملاء', 'Accounts receivable', '1201'], ['payables', 'الموردين', 'Accounts payable', '2101'],
  ['bank_main', 'البنك الرئيسي', 'Main bank account', '1102'], ['cash_main', 'الخزينة الرئيسية', 'Main cash', '1101'],
  ['exp_fuel', 'مصروف وقود', 'Fuel expense', '5101'], ['exp_oil', 'مصروف زيوت', 'Oil expense', '5102'], ['exp_maint', 'مصروف صيانة', 'Maintenance expense', '5103'],
  ['exp_tolls', 'مصروف كارتة', 'Toll expense', '5104'], ['exp_parking', 'مصروف جراج وانتظار', 'Parking expense', '5105'], ['exp_lodging', 'إقامة السائقين', 'Driver lodging', '5106'],
  ['exp_subcontract', 'تكلفة مركبات من الباطن', 'Subcontracted vehicles', '5107'], ['exp_other', 'مصروفات تشغيل أخرى', 'Other operating expenses', '5199'],
  ['labor_applied', 'تحميل عمالة الورشة', 'Workshop labor applied', '5209'],
  ['exp_salaries', 'رواتب السائقين', 'Driver salaries', '5201'], ['exp_insurance', 'تأمين المركبات', 'Vehicle insurance', '5202'], ['exp_license', 'رخص المركبات', 'Vehicle licenses', '5203'],
  ['exp_dep', 'مصروف إهلاك', 'Depreciation expense', '5301'], ['fa_vehicles', 'أصول ثابتة – مركبات', 'Fixed assets – vehicles', '1301'], ['acc_dep', 'مجمع إهلاك المركبات', 'Accumulated depreciation', '1391'],
  ['inventory', 'مخزون قطع الغيار', 'Spare parts inventory', '1401'], ['inv_variance', 'فروق جرد', 'Inventory variance', '5401'],
  ['prepaid_fuel', 'أرصدة كروت وقود مقدمة', 'Prepaid fuel cards', '1601'], ['prepaid_toll', 'أرصدة كارتة مقدمة', 'Prepaid toll tags', '1602'],
  ['driver_receivable', 'مستحقات على السائقين', 'Amounts due from drivers', '1205'],
];

const INSPECTION_ITEMS = ['tires', 'brakes', 'lights', 'ac', 'clean', 'extinguisher', 'firstaid', 'documents'];
const CRITICAL_ITEMS = ['tires', 'brakes', 'lights'];

module.exports = { VEHICLE_TYPES, PLACES, ROUTES, COA, INSPECTION_ITEMS, CRITICAL_ITEMS };
