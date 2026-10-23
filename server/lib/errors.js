'use strict';
/* Errors carry a bilingual, user-facing message. Anything that is not an AppError is logged
   with its stack and shown to the user as a generic message (no internals leak out). */
class AppError extends Error {
  constructor(status, code, ar, en, extra) {
    super(en || code);
    this.status = status; this.code = code; this.msg = { ar: ar || en, en: en || ar };
    if (extra) Object.assign(this, extra);
  }
}
const bad = (code, ar, en, field) => new AppError(400, code, ar, en, field ? { field } : null);
const notFound = (what = 'record') => new AppError(404, 'not_found', 'السجل غير موجود في هذه الشركة', `The ${what} was not found in this company`);
const forbidden = () => new AppError(403, 'forbidden', 'لا تملك صلاحية لهذا الإجراء', 'You do not have permission for this action');
const conflict = (code, ar, en) => new AppError(409, code, ar, en);

/* Translate PostgreSQL errors raised by constraints/triggers into plain messages. */
function fromPg(e) {
  if (!e || !e.code || e instanceof AppError) return e;
  switch (e.code) {
    case '23505': return conflict('duplicate', 'القيمة مسجلة بالفعل في هذه الشركة (مكررة)', 'This value already exists in this company (duplicate)' + (e.constraint ? ` [${e.constraint}]` : ''));
    case '23503': return bad('reference', 'السجل مرتبط ببيانات أخرى أو يشير لسجل غير موجود', 'The record is linked to other data or refers to a record that does not exist');
    case '23514': return bad('check', 'قيمة غير مسموح بها: ' + (e.message || ''), 'Value not allowed: ' + (e.message || ''));
    case '23502': return bad('required', 'حقل مطلوب ناقص', 'A required field is missing' + (e.column ? ` (${e.column})` : ''));
    case '22P02': case '22007': case '22008': case '22003': return bad('format', 'صيغة قيمة غير صحيحة', 'A value has an invalid format');
    case 'P0001': if (e.message === 'country_locked') return conflict('country_locked', 'بلد الشركة مقفول لأنها أصدرت فواتير. الشركة اللي شغالة في بلد تاني تتعمل كشركة جديدة.', 'The company country is locked because it has issued invoices. A company working in another country is set up as a new company.');
      return bad('rule', e.message.includes('period') ? 'الفترة المحاسبية مقفلة ولا يمكن التسجيل فيها' : e.message, e.message);
    case '23P01': return e.constraint && e.constraint.startsWith('driver_')
      ? conflict('driver_busy', 'السائق مشغول في الفترة دي (متسجّل له رحلة أو إجازة في نفس الوقت)', 'The driver is already booked for this period (a trip or leave at the same time)')
      : conflict('vehicle_busy', 'المركبة مشغولة في الفترة دي (متسجّل لها التزام تاني في نفس الوقت)', 'The vehicle is already booked for this period (another commitment at the same time)');
    case '40001': case '40P01': return conflict('retry', 'تعارض مع عملية أخرى، حاول مرة ثانية', 'Conflicted with another operation, please try again');
    case '42501': return new AppError(403, 'rls', 'لا يمكن الوصول لهذه البيانات', 'Access to this data is not allowed');
    default: return e;
  }
}

module.exports = { AppError, bad, notFound, forbidden, conflict, fromPg };
