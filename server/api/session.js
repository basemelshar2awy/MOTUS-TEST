'use strict';
/* Login, logout, session lookup, password change, company switching, invitations.
   One account per person (email and/or mobile). A member account reaches a company through a
   membership that carries its role there; the session holds the company being worked on. */
const db = require('../lib/db');
const auth = require('../lib/auth');
const log = require('../lib/log');
const { AppError, bad } = require('../lib/errors');
const { setCookie } = require('../lib/http');
const countries = require('../lib/countries');
const core = require('../lib/core');

const COOKIE = 'motus_sid';
let CFG = null;
const init = cfg => { CFG = cfg; };

/* kinds: 'web' (browser cookie), 'mobile' (app, Bearer token), 'embed' (a web screen shown inside the app) */
async function lookup(token, want = ['web', 'embed']) {
  if (!token || token.length < 30 || token.length > 100) return null;
  const hash = auth.sha256(token);
  const r = await db.platform(c => c.query(`
    SELECT s.id sid, s.company_id sc, s.expires_at, s.last_seen_at, s.kind, u.id, u.email, u.phone, u.name_ar, u.name_en, u.role, u.status, u.must_change_password, u.lang,
           co.status co_status, m.role m_role, m.status m_status, m.driver_id, m.branch_id
      FROM sessions s JOIN users u ON u.id = s.user_id
      LEFT JOIN companies co ON co.id = s.company_id
      LEFT JOIN LATERAL (SELECT * FROM user_memberships(u.id) x WHERE x.company_id = s.company_id) m ON u.role <> 'super_admin'
     WHERE s.token_hash = $1`, [hash]));
  const s = r.rows[0];
  if (!s || !want.includes(s.kind)) return null;
  const now = Date.now();
  const idleMs = s.kind === 'mobile' ? CFG.mobileIdleDays * 86400000 : CFG.sessionIdleMinutes * 60000;
  if (new Date(s.expires_at).getTime() < now || new Date(s.last_seen_at).getTime() + idleMs < now || s.status !== 'active' || (s.sc && s.co_status !== 'active')) {
    await db.platform(c => c.query('DELETE FROM sessions WHERE id = $1', [s.sid]));
    return null;
  }
  if (now - new Date(s.last_seen_at).getTime() > 60000) db.platform(c => c.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.sid])).catch(() => {});
  let companyId = s.sc, role = s.role;
  if (s.role !== 'super_admin') {
    // a member works in the session's company only while its membership there is active
    if (s.sc && s.m_status !== 'active') { companyId = null; await db.platform(c => c.query('UPDATE sessions SET company_id = NULL WHERE id = $1', [s.sid])); }
    role = companyId ? s.m_role : 'member';
  }
  return {
    sessionId: s.sid, kind: s.kind, id: s.id, email: s.email, phone: s.phone, login: s.email || s.phone, name: s.name_en || s.name_ar, nameAr: s.name_ar, role, lang: s.lang,
    companyId, driverId: companyId ? s.driver_id : null, branchId: companyId ? s.branch_id : null, member: s.role !== 'super_admin', mustChange: s.must_change_password,
  };
}

async function recentFailures(c, field, value) {
  return (await c.query(`SELECT count(*)::int n FROM login_attempts WHERE ${field} = $1 AND NOT success AND at > now() - interval '15 minutes'`, [value])).rows[0].n;
}

async function login(req, res, body, ip) {
  // one field: email or mobile number
  const email = String(body.login || body.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(body.password || '').slice(0, 300);
  if (!email || !password) throw bad('required', 'اكتب البريد الإلكتروني أو رقم الموبايل وكلمة المرور', 'Enter your email or mobile number and password');
  const fail = new AppError(401, 'bad_login', 'بيانات الدخول أو كلمة المرور غير صحيحة', 'Incorrect sign-in details or password');
  const phone = email.includes('@') ? null : countries.normalizePhone(email);
  // the apps keep the token themselves (Authorization: Bearer); the browser gets an HttpOnly cookie
  const mobile = body.client === 'mobile';
  const out = await db.platform(async c => {
    if (await recentFailures(c, 'ip', ip) >= 30) throw new AppError(429, 'ip_blocked', 'محاولات كثيرة من هذا الجهاز. حاول بعد 15 دقيقة.', 'Too many attempts from this address. Try again in 15 minutes.');
    const u = (await c.query(phone ? 'SELECT * FROM users WHERE phone = $1' : 'SELECT * FROM users WHERE email = $1', [phone || email])).rows[0];
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
    let companyId = null, ms = [];
    if (u.role === 'super_admin') { const first = (await c.query("SELECT id FROM companies WHERE status = 'active' ORDER BY code LIMIT 1")).rows[0]; companyId = first ? first.id : null; }
    else {
      ms = (await c.query('SELECT * FROM user_memberships($1)', [u.id])).rows;
      const usable = ms.filter(m => m.status === 'active' && m.company_status === 'active');
      const invites = ms.filter(m => m.status === 'invited' && m.company_status === 'active');
      if (!usable.length && !invites.length) {
        return { error: ms.some(m => m.status === 'active')
          ? new AppError(403, 'company_suspended', 'حساب الشركة موقوف', 'The company account is suspended')
          : new AppError(403, 'no_company', 'الحساب مش مربوط بأي شركة حالياً. تواصل مع الشركة اللي بتشتغل معاها.', 'This account is not linked to any company right now. Contact the company you work with.') };
      }
      const want = body.companyId && usable.find(m => m.company_id === body.companyId);
      companyId = (want || usable.find(m => m.company_id === u.last_company_id) || usable[0] || {}).company_id || null;
    }
    await c.query('INSERT INTO login_attempts (email, ip, success) VALUES ($1,$2,true)', [email, ip]);
    await c.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
    await c.query("DELETE FROM sessions WHERE expires_at < now() OR (user_id = $1 AND kind <> 'mobile' AND last_seen_at < now() - interval '1 day')", [u.id]);
    await c.query("DELETE FROM login_attempts WHERE at < now() - interval '30 days'");
    if (companyId && u.role !== 'super_admin') await c.query('UPDATE users SET last_company_id = $1 WHERE id = $2', [companyId, u.id]);
    const token = auth.newToken();
    await c.query('INSERT INTO sessions (token_hash, user_id, company_id, expires_at, ip, user_agent, kind) VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5, $6, $7)',
      [auth.sha256(token), u.id, companyId, mobile ? CFG.mobileSessionDays * 24 : CFG.sessionHours, ip, String(req.headers['user-agent'] || '').slice(0, 300), mobile ? 'mobile' : 'web']);
    return { token, user: u, companies: ms.filter(m => m.status === 'active' && m.company_status === 'active').length, invites: ms.filter(m => m.status === 'invited' && m.company_status === 'active').length };
  });
  if (out.error) throw out.error;
  if (!mobile) setCookie(res, COOKIE, out.token, { secure: CFG.secureCookies, maxAge: CFG.sessionHours * 3600 });
  log.info('login', { login: email, role: out.user.role, ip, client: mobile ? 'mobile' : 'web' });
  return Object.assign({ ok: true, mustChangePassword: out.user.must_change_password, companies: out.companies, invites: out.invites }, mobile ? { token: out.token, expiresInDays: CFG.mobileSessionDays } : {});
}

async function logout(res, user) {
  if (user) await db.platform(c => c.query('DELETE FROM sessions WHERE id = $1', [user.sessionId]));
  setCookie(res, COOKIE, '', { secure: CFG.secureCookies, maxAge: 0 });
}

async function changePassword(user, body, res) {
  const current = String(body.currentPassword || ''), next = String(body.newPassword || '');
  const u = (await db.platform(c => c.query('SELECT coalesce(email, phone) email, password_hash FROM users WHERE id = $1', [user.id]))).rows[0];
  if (!(await auth.verifyPassword(current, u.password_hash))) throw new AppError(400, 'bad_password', 'كلمة المرور الحالية غير صحيحة', 'The current password is incorrect', { field: 'currentPassword' });
  if (current === next) throw new AppError(400, 'same_password', 'اختر كلمة مرور جديدة مختلفة', 'Choose a new password that is different', { field: 'newPassword' });
  auth.checkPolicy(next, u.email);
  const hash = await auth.hashPassword(next);
  const token = auth.newToken();
  const mobile = user.kind === 'mobile';
  await db.platform(async c => {
    await c.query('UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now() WHERE id = $2', [hash, user.id]);
    await c.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);   // sign out every other device
    await c.query('INSERT INTO sessions (token_hash, user_id, company_id, expires_at, kind) VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5)', [auth.sha256(token), user.id, user.companyId, mobile ? CFG.mobileSessionDays * 24 : CFG.sessionHours, mobile ? 'mobile' : 'web']);
  });
  if (!mobile) setCookie(res, COOKIE, token, { secure: CFG.secureCookies, maxAge: CFG.sessionHours * 3600 });
  log.info('password changed', { user: user.login });
  return mobile ? { token } : {};
}

/* the Sabeel team can open any active company; a member only the companies it is an active member of */
async function switchCompany(user, companyId) {
  if (!db.UUID.test(String(companyId))) throw bad('company', 'شركة غير صحيحة', 'Invalid company');
  await db.platform(async c => {
    if (user.member) {
      const m = (await c.query('SELECT * FROM user_memberships($1) WHERE company_id = $2', [user.id, companyId])).rows[0];
      if (!m || m.status !== 'active' || m.company_status !== 'active') throw new AppError(403, 'forbidden', 'لا تملك صلاحية على هذه الشركة', 'You have no access to this company');
      await c.query('UPDATE users SET last_company_id = $1 WHERE id = $2', [companyId, user.id]);
    } else {
      const co = (await c.query("SELECT 1 FROM companies WHERE id = $1 AND status = 'active'", [companyId])).rowCount;
      if (!co) throw new AppError(404, 'not_found', 'الشركة غير موجودة', 'Company not found');
    }
    await c.query('UPDATE sessions SET company_id = $1 WHERE id = $2', [companyId, user.sessionId]);
  });
}

/* a company invited an existing account: the person accepts (and can start working there) or declines */
async function answerInvite(user, companyId, accept) {
  if (!user.member) throw new AppError(403, 'forbidden', 'غير متاح لحساب المنصة', 'Not available to platform accounts');
  if (!db.UUID.test(String(companyId))) throw bad('company', 'شركة غير صحيحة', 'Invalid company');
  const m = (await db.platform(c => c.query('SELECT * FROM user_memberships($1) WHERE company_id = $2', [user.id, companyId]))).rows[0];
  if (!m || m.status !== 'invited' || m.company_status !== 'active') throw new AppError(404, 'not_found', 'الدعوة غير موجودة', 'Invitation not found');
  await db.tx(companyId, async c => {
    if (accept) await c.query("UPDATE memberships SET status = 'active', updated_at = now() WHERE user_id = $1 AND status = 'invited'", [user.id]);
    else await c.query("DELETE FROM memberships WHERE user_id = $1 AND status = 'invited'", [user.id]);
    await core.audit(c, { companyId, user: { id: user.id, name: user.name }, source: 'ui' }, accept ? 'accept' : 'decline', 'membership', `${user.login} (${m.role})`);
    await c.query('UPDATE company_settings SET data_version = data_version + 1 WHERE company_id = $1', [companyId]);
  });
  if (accept && !user.companyId) await switchCompany(user, companyId);
  return { ok: true, role: m.role };
}
async function setLang(user, lang) {
  if (!['ar', 'en'].includes(lang)) throw bad('lang', 'لغة غير مدعومة', 'Unsupported language');
  await db.platform(c => c.query('UPDATE users SET lang = $1 WHERE id = $2', [lang, user.id]));
}

/* a web screen shown inside the app: the app asks for a one-time link (60 s), the in-app browser opens
   it and gets its own short cookie session ('embed'), tied to the app's session — no long-lived token in a URL */
async function mobileLink(user, route) {
  if (user.kind !== 'mobile') throw new AppError(403, 'forbidden', 'للتطبيق بس', 'For the app only');
  route = String(route || 'dashboard');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(route)) throw bad('route', 'شاشة غير صحيحة', 'Invalid screen');
  const code = auth.newToken();
  await db.platform(c => c.query("INSERT INTO mobile_links (code_hash, session_id, route, expires_at) VALUES ($1,$2,$3, now() + interval '60 seconds')", [auth.sha256(code), user.sessionId, route]));
  return { path: `/m/open?code=${code}` };
}
async function openLink(res, code) {
  if (!code || code.length < 30 || code.length > 100) return null;
  return db.platform(async c => {
    const l = (await c.query("UPDATE mobile_links SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING session_id, route", [auth.sha256(code)])).rows[0];
    if (!l) return null;
    const p = (await c.query("SELECT user_id, company_id FROM sessions WHERE id = $1 AND kind = 'mobile' AND expires_at > now()", [l.session_id])).rows[0];
    if (!p) return null;
    const token = auth.newToken();
    await c.query("INSERT INTO sessions (token_hash, user_id, company_id, expires_at, kind, parent_id) VALUES ($1,$2,$3, now() + make_interval(hours => $4), 'embed', $5)", [auth.sha256(token), p.user_id, p.company_id, CFG.sessionHours, l.session_id]);
    await c.query("DELETE FROM mobile_links WHERE expires_at < now() - interval '1 hour'");
    setCookie(res, COOKIE, token, { secure: CFG.secureCookies, maxAge: CFG.sessionHours * 3600 });
    return l.route;
  });
}
/* switching company in the app also moves the screens it has open from the web */
async function syncEmbeds(user) { if (user.kind === 'mobile') await db.platform(c => c.query('UPDATE sessions SET company_id = (SELECT company_id FROM sessions WHERE id = $1) WHERE parent_id = $1', [user.sessionId])); }

module.exports = { init, COOKIE, lookup, login, logout, changePassword, switchCompany, answerInvite, setLang, mobileLink, openLink, syncEmbeds };
