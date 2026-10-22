'use strict';
/* Country packs. A company belongs to one country; its pack sets the currency, VAT, e-invoice
   authority, time zone, the identity fields and their formats, driving-license classes, starting
   settings and the starting reference places/routes. Adding a country = adding a pack here (and
   its code to the companies.country check); the rest of the system reads the pack.

   A company's country is locked once it has issued its first invoice (changing currency and tax
   under issued invoices would corrupt the books). A company working in two countries is two
   companies. */
const { bad } = require('./errors');
const D = require('./defaults');

/* Saudi reference points (approximate coordinates; editable per company) */
const SA_PLACES = [
  ['RUH', 'الرياض', 'Riyadh', 24.7136, 46.6753, 'city', 15000],
  ['JED', 'جدة', 'Jeddah', 21.4858, 39.1925, 'city', 15000],
  ['MKK', 'مكة المكرمة', 'Makkah', 21.3891, 39.8579, 'city', 10000],
  ['MED', 'المدينة المنورة', 'Madinah', 24.5247, 39.5692, 'city', 10000],
  ['DMM', 'الدمام', 'Dammam', 26.4207, 50.0888, 'city', 12000],
  ['RUHAP', 'مطار الملك خالد الدولي', 'King Khalid International Airport', 24.9576, 46.6988, 'airport', 3000],
  ['JEDAP', 'مطار الملك عبدالعزيز الدولي', 'King Abdulaziz International Airport', 21.6796, 39.1565, 'airport', 3000],
  ['MEDAP', 'مطار الأمير محمد بن عبدالعزيز', 'Prince Mohammad bin Abdulaziz Airport', 24.5534, 39.7051, 'airport', 2500],
];
const SA_ROUTES = [
  ['RUH', 'RUHAP', 'RUH', 40, 'airport', 0, 0.75], ['RUH', 'RUH', 'RUHAP', 40, 'airport', 0, 0.75], ['RUH', 'RUH', 'RUH', 120, 'hire', 0, 8],
  ['RUH', 'RUH', 'JED', 950, 'intercity', 0, 9.5], ['RUH', 'RUH', 'DMM', 400, 'intercity', 0, 4],
  ['JED', 'JEDAP', 'JED', 25, 'airport', 0, 0.6], ['JED', 'JED', 'JEDAP', 25, 'airport', 0, 0.6], ['JED', 'JED', 'MKK', 80, 'intercity', 0, 1.25],
  ['JED', 'JEDAP', 'MKK', 95, 'intercity', 0, 1.5], ['MKK', 'MKK', 'MED', 450, 'intercity', 0, 4.5], ['MED', 'MEDAP', 'MED', 20, 'airport', 0, 0.5],
];

const PACKS = {
  EG: {
    code: 'EG', name: { ar: 'مصر', en: 'Egypt' }, currency: 'EGP', timezone: 'Africa/Cairo', vatRate: 0.14,
    einvoice: { code: 'eta', name: { ar: 'منظومة الفاتورة الإلكترونية (مصلحة الضرائب المصرية)', en: 'Egyptian Tax Authority e-invoicing (ETA)' } },
    fields: {
      taxNo: { label: { ar: 'رقم التسجيل الضريبي', en: 'Tax registration no.' }, re: /^\d{9}$/, hint: { ar: '9 أرقام', en: '9 digits' }, placeholder: '123456789' },
      crNo: { label: { ar: 'رقم السجل التجاري', en: 'Commercial register no.' }, re: /^\d{1,10}$/, hint: { ar: 'أرقام فقط', en: 'Digits only' }, placeholder: '12345' },
      nationalId: { label: { ar: 'الرقم القومي', en: 'National ID' }, re: /^[23]\d{13}$/, hint: { ar: '14 رقم', en: '14 digits' }, placeholder: '29001010101010' },
      plate: { placeholder: 'ن ق ط 1234' },
      phone: { placeholder: '01000000000' },
    },
    licenseClasses: [['first', { ar: 'مهنية درجة أولى', en: 'Professional, 1st grade' }], ['second', { ar: 'مهنية درجة ثانية', en: 'Professional, 2nd grade' }], ['third', { ar: 'مهنية درجة ثالثة', en: 'Professional, 3rd grade' }], ['professional', { ar: 'مهنية', en: 'Professional' }]],
    defaultLicense: 'first',
    settings: { currency: 'EGP', vatRate: 0.14, fuelPrices: { diesel: 17.5, gasoline: 19.25 }, usdRate: 48.5 },
    branch: { code: 'HQ', city: 'CAI' },
    places: D.PLACES, routes: D.ROUTES,
  },
  SA: {
    code: 'SA', name: { ar: 'السعودية', en: 'Saudi Arabia' }, currency: 'SAR', timezone: 'Asia/Riyadh', vatRate: 0.15,
    einvoice: { code: 'zatca', name: { ar: 'فاتورة (هيئة الزكاة والضريبة والجمارك)', en: 'ZATCA e-invoicing (Fatoora)' } },
    fields: {
      taxNo: { label: { ar: 'الرقم الضريبي (VAT)', en: 'VAT number' }, re: /^3\d{13}3$/, hint: { ar: '15 رقم يبدأ وينتهي بـ 3', en: '15 digits, starting and ending with 3' }, placeholder: '300000000000003' },
      crNo: { label: { ar: 'رقم السجل التجاري', en: 'Commercial registration no.' }, re: /^\d{10}$/, hint: { ar: '10 أرقام', en: '10 digits' }, placeholder: '1010000000' },
      nationalId: { label: { ar: 'رقم الهوية / الإقامة', en: 'National ID / Iqama' }, re: /^[12]\d{9}$/, hint: { ar: '10 أرقام تبدأ بـ 1 (مواطن) أو 2 (مقيم)', en: '10 digits starting with 1 (citizen) or 2 (resident)' }, placeholder: '2000000000' },
      plate: { placeholder: 'أ ب ج 1234' },
      phone: { placeholder: '0500000000' },
    },
    licenseClasses: [['private', { ar: 'خاصة', en: 'Private' }], ['public', { ar: 'عمومية', en: 'Public' }], ['heavy', { ar: 'نقل ثقيل', en: 'Heavy transport' }]],
    defaultLicense: 'public',
    settings: { currency: 'SAR', vatRate: 0.15, fuelPrices: { diesel: 1.66, gasoline: 2.33 }, usdRate: 3.75 },
    branch: { code: 'HQ', city: 'RUH' },
    places: SA_PLACES, routes: SA_ROUTES,
  },
};
const CODES = Object.keys(PACKS);

const pack = code => PACKS[code] || PACKS.EG;

/* what the browser needs (no regexes, no seed lists) */
function publicPack(code) {
  const p = pack(code);
  const fields = {};
  for (const [k, f] of Object.entries(p.fields)) fields[k] = { label: f.label, hint: f.hint, placeholder: f.placeholder, pattern: f.re ? f.re.source : null };
  return { code: p.code, name: p.name, currency: p.currency, timezone: p.timezone, vatRate: p.vatRate, einvoice: p.einvoice, fields, licenseClasses: p.licenseClasses, defaultLicense: p.defaultLicense, cities: p.places.filter(x => x[5] === 'city').map(x => [x[0], { ar: x[1], en: x[2] }]) };
}

/* validate an identity field of the company's country (empty is allowed: the fields are optional) */
function check(code, field, value, inputField) {
  if (value == null || value === '') return value;
  const f = pack(code).fields[field];
  if (f && f.re && !f.re.test(String(value))) {
    throw bad('format_' + field, `${f.label.ar} غير صحيح: ${f.hint.ar}`, `Invalid ${f.label.en}: ${f.hint.en}`, inputField || field);
  }
  return value;
}
function checkLicense(code, value, inputField = 'licenseClass') {
  if (value == null) return value;
  const p = pack(code);
  if (!p.licenseClasses.some(([k]) => k === value)) throw bad('license_class', 'فئة رخصة غير معروفة في بلد الشركة', `Unknown license class for ${p.name.en}`, inputField);
  return value;
}

/* mobile numbers are kept in international form (+20…, +966…) so one person has one login
   whichever company typed the number. Local forms are read by their shape (Egypt 01xxxxxxxxx,
   Saudi 05xxxxxxxx) or, when ambiguous, by the company's country. Returns null when it is not a
   mobile number. */
const DIAL = { EG: '20', SA: '966' };
function normalizePhone(value, country) {
  let v = String(value == null ? '' : value).replace(/[\s\-().]/g, '').replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
  if (!v) return null;
  if (v.startsWith('00')) v = '+' + v.slice(2);
  if (/^\+[1-9]\d{7,14}$/.test(v)) return v.replace(/^\+(20|966)0/, '+$1');
  if (/^01[0-25]\d{8}$/.test(v)) return '+20' + v.slice(1);
  if (/^05\d{8}$/.test(v)) return '+966' + v.slice(1);
  if (/^0\d{8,10}$/.test(v) && DIAL[country]) return '+' + DIAL[country] + v.slice(1);
  if (/^(20|966)\d{8,11}$/.test(v)) return '+' + v;
  return null;
}

module.exports = { PACKS, CODES, pack, publicPack, check, checkLicense, normalizePhone };
