'use strict';
/* Input validation for actions and the Open API. Every reader throws a bilingual 400 error
   that names the field, so forms can highlight it. */
const { bad } = require('./errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const req = (f) => bad('required', `الحقل "${f}" مطلوب`, `"${f}" is required`, f);
const has = (o, f) => o && o[f] !== undefined && o[f] !== null && o[f] !== '';

function str(o, f, opt = {}) {
  if (!has(o, f)) { if (opt.req) throw req(f); return opt.def !== undefined ? opt.def : null; }
  if (typeof o[f] !== 'string' && typeof o[f] !== 'number') throw bad('format', `الحقل "${f}" غير صالح`, `"${f}" is invalid`, f);
  const s = String(o[f]).trim();
  if (!s) { if (opt.req) throw req(f); return opt.def !== undefined ? opt.def : null; }
  const max = opt.max || 500;
  if (s.length > max) throw bad('too_long', `الحقل "${f}" أطول من ${max} حرف`, `"${f}" is longer than ${max} characters`, f);
  if (opt.re && !opt.re.test(s)) throw bad('format', `صيغة "${f}" غير صحيحة`, `"${f}" has an invalid format`, f);
  return s;
}
function num(o, f, opt = {}) {
  if (!has(o, f)) { if (opt.req) throw req(f); return opt.def !== undefined ? opt.def : null; }
  const n = typeof o[f] === 'number' ? o[f] : Number(String(o[f]).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw bad('number', `الحقل "${f}" لازم يكون رقم`, `"${f}" must be a number`, f);
  if (opt.min != null && n < opt.min) throw bad('min', `الحقل "${f}" لازم يكون ${opt.min} أو أكثر`, `"${f}" must be at least ${opt.min}`, f);
  if (opt.gt != null && !(n > opt.gt)) throw bad('min', `الحقل "${f}" لازم يكون أكبر من ${opt.gt}`, `"${f}" must be greater than ${opt.gt}`, f);
  if (opt.max != null && n > opt.max) throw bad('max', `الحقل "${f}" لازم يكون ${opt.max} أو أقل`, `"${f}" must be at most ${opt.max}`, f);
  return opt.int ? Math.round(n) : Math.round(n * 1e4) / 1e4;
}
const int = (o, f, opt = {}) => num(o, f, Object.assign({ int: true }, opt));
function bool(o, f, def = false) { if (!o || o[f] == null || o[f] === '') return def; return o[f] === true || o[f] === 'true' || o[f] === 1 || o[f] === '1' || o[f] === 'on'; }
function uuid(o, f, opt = {}) {
  if (!has(o, f)) { if (opt.req) throw req(f); return null; }
  const s = String(o[f]);
  if (!UUID.test(s)) throw bad('format', `المعرّف "${f}" غير صالح`, `"${f}" is not a valid id`, f);
  return s.toLowerCase();
}
function date(o, f, opt = {}) {
  const s = str(o, f, Object.assign({}, opt, { max: 10 }));
  if (s == null) return opt.def !== undefined ? opt.def : null;
  if (!DATE.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw bad('date', `التاريخ "${f}" غير صحيح`, `"${f}" is not a valid date (YYYY-MM-DD)`, f);
  return s;
}
function time(o, f, opt = {}) {
  const s = str(o, f, Object.assign({}, opt, { max: 5 }));
  if (s == null) return opt.def !== undefined ? opt.def : null;
  if (!TIME.test(s)) throw bad('time', `الوقت "${f}" غير صحيح`, `"${f}" is not a valid time (HH:MM)`, f);
  return s;
}
function oneOf(o, f, list, opt = {}) {
  const s = str(o, f, opt);
  if (s == null) return opt.def !== undefined ? opt.def : null;
  if (!list.includes(s)) throw bad('choice', `قيمة "${f}" غير مسموح بها`, `"${f}" must be one of: ${list.join(', ')}`, f);
  return s;
}
function arr(o, f, opt = {}) {
  if (!has(o, f)) { if (opt.req) throw req(f); return []; }
  if (!Array.isArray(o[f])) throw bad('format', `الحقل "${f}" لازم يكون قائمة`, `"${f}" must be a list`, f);
  if (opt.max && o[f].length > opt.max) throw bad('max', `عدد عناصر "${f}" أكبر من ${opt.max}`, `"${f}" has more than ${opt.max} items`, f);
  if (opt.min && o[f].length < opt.min) throw bad('min', `"${f}" لازم يحتوي على ${opt.min} عنصر على الأقل`, `"${f}" needs at least ${opt.min} item(s)`, f);
  return o[f];
}
function email(o, f, opt = {}) {
  const s = str(o, f, Object.assign({ max: 254 }, opt));
  if (s == null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw bad('email', 'البريد الإلكتروني غير صحيح', 'The email address is not valid', f);
  return s.toLowerCase();
}
/* bilingual text: accepts {ar, en} or a single string (used for both) */
function text2(o, f, opt = {}) {
  const v = o && o[f];
  if (v && typeof v === 'object') {
    const ar = str(v, 'ar', { max: opt.max }), en = str(v, 'en', { max: opt.max });
    if (!ar && !en) { if (opt.req) throw req(f); return { ar: null, en: null }; }
    return { ar: ar || en, en: en || ar };
  }
  const s = str(o, f, opt);
  return { ar: s, en: s };
}
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

module.exports = { str, num, int, bool, uuid, date, time, oneOf, arr, email, text2, round2, UUID, DATE, TIME };
