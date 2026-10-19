'use strict';
/* Login, logout, session lookup, password change, company switching (super admin). */
const db = require('../lib/db');
const auth = require('../lib/auth');
const log = require('../lib/log');
const { AppError, bad } = require('../lib/errors');
const { setCookie } = require('../lib/http');

const COOKIE = 'motus_sid';
let CFG = null;
const init = cfg => { CFG = cfg; };

async function lookup(token) {
  if (!token || token.length < 30 || token.length > 100) return null;
  const hash = auth.sha256(token);
  const r = await db.platform(c => c.query(`
    SELECT s.id sid, s.company_id sc, s.expires_at, s.last_seen_at, u.id, u.email, u.name_ar, u.name_en, u.role, u.company_id, u.status, u.must_change_password, u.lang,
           co.status co_status, co.code co_code
      FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN companies co ON co.id = coalesce(u.company_id, s.company_id)
     WHERE s.token_hash = $1`, [hash]));
  const s = r.rows[0];
  if (!s) return null;
  const now = Date.now();
  const idleMs = CFG.sessionIdleMinutes * 60000;
  if (new Date(s.expires_at).getTime() < now || new Date(s.last_seen_at).getTime() + idleMs < now || s.status !== 'active' || (s.company_id && s.co_status !== 'active')) {
    await db.platform(c => c.query('DELETE FROM sessions WHERE id = $1', [s.sid]));
    return null;
  }
  if (now - new Date(s.last_seen_at).getTime() > 60000) db.platform(c => c.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.sid])).catch(() => {});
  return {
    sessionId: s.sid, id: s.id, email: s.email, name: s.name_en || s.name_ar, nameAr: s.name_ar, role: s.role, lang: s.lang,
    companyId: s.role === 'super_admin' ? s.sc : s.company_id, mustChange: s.must_change_password,
  };
}

async function recentFailures(c, field, value) {
  return (await c.query(`SELECT count(*)::int n FROM login_attempts WHERE ${field} = $1 AND NOT success AND at > now() - interval '15 minutes'`, [value])).rows[0].n;
}

async function login(req, res, body, ip) {
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(body.password || '').slice(0, 300);
  if (!email || !password) throw bad('required', 'اكتب البريد الإلكتروني وكلمة المرور', 'Enter your email and password');
  const fail = new AppError(401, 'bad_login', 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 'Incorrect email or password');
  const out = await db.platform(async c => {
    if (await recentFailures(c, 'ip', ip) >= 30) throw new AppError(429, 'ip_blocked', 'محاولات كثيرة من هذا الجهاز. حاول بعد 15 دقيقة.', 'Too many attempts from this address. Try again in 15 minutes.');
    const u = (await c.query('SELECT u.*, co.status co_status FROM users u LEFT JOIN companies co ON co.id = u.company_id WHERE u.email = $1', [email])).rows[0];
    const ok = await auth.verifyPassword(password, u ? u.password_hash : auth.DUMMY_HASH);
    if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
      await c.query('INSERT INTO login_attempts (email, ip, success) VALUES ($1,$2,false)', [email, ip]);
      throw new AppError(423, 'locked', 'الحساب مقفول مؤقتاً بسبب محاولات خاطئة. حاول بعد 15 دقيقة أو اطلب من مدير النظام إعادة تعيين كلمة المرور.', 'The account is temporarily locked after failed attempts. Try again in 15 minutes or ask an admin to reset the password.');
    }
    if (!u || !ok) {
      await c.query('INSERT INTO login_attempts (email, ip, success) VALUES ($1,$2,false)', [email, ip]);
      if (u) {
        const n = u.failed_attempts + 1;
        await c.query('UPDATE users SET failed_attempts = CASE WHEN $1::int >= 5 THEN 0 ELSE $1::int END, locked_until = CASE WHEN $1::int >= 5 THEN now() + interval \'15 minutes\' ELSE locked_until END WHERE id = $2', [n, u.id]);
        if (n >= 5) log.warn('account locked', { email, ip });
      }
      return { error: fail };
    }
    if (u.status !== 'active') return { error: new AppError(403, 'disabled', 'الحساب معطّل. تواصل مع مدير النظام.', 'This account is disabled. Contact your administrator.') };
    if (u.company_id && u.co_status !== 'active') return { error: new AppError(403, 'company_suspended', 'حساب الشركة موقوف', 'The company account is suspended') };
    await c.query('INSERT INTO login_attempts (email, ip, success) VALUES ($1,$2,true)', [email, ip]);
    await c.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
    await c.query("DELETE FROM sessions WHERE expires_at < now() OR (user_id = $1 AND last_seen_at < now() - interval '1 day')", [u.id]);
    await c.query("DELETE FROM login_attempts WHERE at < now() - interval '30 days'");
    let companyId = u.company_id;
    if (u.role === 'super_admin') { const first = (await c.query("SELECT id FROM companies WHERE status = 'active' ORDER BY code LIMIT 1")).rows[0]; companyId = first ? first.id : null; }
    const token = auth.newToken();
    await c.query('INSERT INTO sessions (token_hash, user_id, company_id, expires_at, ip, user_agent) VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5, $6)',
      [auth.sha256(token), u.id, companyId, CFG.sessionHours, ip, String(req.headers['user-agent'] || '').slice(0, 300)]);
    return { token, user: u };
  });
  if (out.error) throw out.error;
  setCookie(res, COOKIE, out.token, { secure: CFG.secureCookies, maxAge: CFG.sessionHours * 3600 });
  log.info('login', { email, role: out.user.role, ip });
  return { ok: true, mustChangePassword: out.user.must_change_password };
}

async function logout(res, user) {
  if (user) await db.platform(c => c.query('DELETE FROM sessions WHERE id = $1', [user.sessionId]));
  setCookie(res, COOKIE, '', { secure: CFG.secureCookies, maxAge: 0 });
}

async function changePassword(user, body, res) {
  const current = String(body.currentPassword || ''), next = String(body.newPassword || '');
  const u = (await db.platform(c => c.query('SELECT email, password_hash FROM users WHERE id = $1', [user.id]))).rows[0];
  if (!(await auth.verifyPassword(current, u.password_hash))) throw new AppError(400, 'bad_password', 'كلمة المرور الحالية غير صحيحة', 'The current password is incorrect', { field: 'currentPassword' });
  if (current === next) throw new AppError(400, 'same_password', 'اختر كلمة مرور جديدة مختلفة', 'Choose a new password that is different', { field: 'newPassword' });
  auth.checkPolicy(next, u.email);
  const hash = await auth.hashPassword(next);
  const token = auth.newToken();
  await db.platform(async c => {
    await c.query('UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now() WHERE id = $2', [hash, user.id]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);   // sign out every other device
    await c.query('INSERT INTO sessions (token_hash, user_id, company_id, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))', [auth.sha256(token), user.id, user.companyId, CFG.sessionHours]);
  });
  setCookie(res, COOKIE, token, { secure: CFG.secureCookies, maxAge: CFG.sessionHours * 3600 });
  log.info('password changed', { user: user.email });
}

async function switchCompany(user, companyId) {
  if (user.role !== 'super_admin') throw new AppError(403, 'forbidden', 'لا تملك صلاحية تبديل الشركة', 'You cannot switch companies');
  if (!db.UUID.test(String(companyId))) throw bad('company', 'شركة غير صحيحة', 'Invalid company');
  await db.platform(async c => {
    const co = (await c.query("SELECT 1 FROM companies WHERE id = $1 AND status = 'active'", [companyId])).rowCount;
    if (!co) throw new AppError(404, 'not_found', 'الشركة غير موجودة', 'Company not found');
    await c.query('UPDATE sessions SET company_id = $1 WHERE id = $2', [companyId, user.sessionId]);
  });
}
async function setLang(user, lang) {
  if (!['ar', 'en'].includes(lang)) throw bad('lang', 'لغة غير مدعومة', 'Unsupported language');
  await db.platform(c => c.query('UPDATE users SET lang = $1 WHERE id = $2', [lang, user.id]));
}

module.exports = { init, COOKIE, lookup, login, logout, changePassword, switchCompany, setLang };
