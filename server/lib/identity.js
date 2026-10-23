'use strict';
/* One Sabeel account per person.
   An account (users) is the person: email and/or mobile, password, language. A membership gives
   it a role in one company (staff roles, or 'driver' tied to the company's driver record).
   When a company adds someone:
     - no account with that email/mobile → a new account with a temporary password, active at once;
     - an account exists → only an invitation: the person accepts it after signing in (a company
       cannot attach itself to someone's account, or reset the password of an account other
       companies share). */
const auth = require('./auth');
const { conflict, AppError } = require('./errors');

/* every company the account belongs to (owner-run lookup: only codes, roles and states) */
const membershipsOf = async (c, userId) => (await c.query('SELECT company_id, role, status FROM user_memberships($1)', [userId])).rows;

/* true when the account also belongs to another company (then only the person or the Sabeel team
   can change its name or password) */
async function shared(c, userId, companyId) {
  return (await membershipsOf(c, userId)).some(m => m.company_id !== companyId && m.status !== 'disabled');
}
const sharedError = () => new AppError(409, 'shared_account', 'الحساب ده مستخدم في شركات تانية على سبيل، فاسمه وكلمة مروره بيتغيروا من صاحبه أو من فريق سبيل بس', 'This account is also used by other companies on Sabeel, so only its owner or the Sabeel team can change its name or password');

/* find the account by email or mobile, or create it. Returns { user, created, temporaryPassword } */
async function findOrCreate(c, { email, phone, name, lang }) {
  const byEmail = email ? (await c.query('SELECT id, role, email, phone FROM users WHERE email = $1', [email])).rows[0] : null;
  const byPhone = phone ? (await c.query('SELECT id, role, email, phone FROM users WHERE phone = $1', [phone])).rows[0] : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) throw conflict('login_mismatch', 'البريد ورقم الموبايل تبع حسابين مختلفين', 'The email and the mobile number belong to two different accounts');
  const found = byEmail || byPhone;
  if (found) {
    if (found.role === 'super_admin') throw conflict('email_taken', 'البيانات دي لحساب في فريق سبيل', 'Those details belong to a Sabeel team account');
    return { user: found, created: false, temporaryPassword: null };
  }
  const temp = auth.randomPassword(16);
  const u = (await c.query(`INSERT INTO users (email, phone, name_ar, name_en, role, password_hash, must_change_password, lang)
      VALUES ($1,$2,$3,$4,'member',$5,true,$6) RETURNING id, role, email, phone`, [email || null, phone || null, name.ar, name.en || name.ar, await auth.hashPassword(temp), lang || 'ar'])).rows[0];
  return { user: u, created: true, temporaryPassword: temp };
}

/* add the account to this company (active when the company just created it, invited otherwise) */
async function addMember(c, ctx, account, row) {
  const exists = (await c.query('SELECT id, role, status FROM memberships WHERE user_id = $1', [account.user.id])).rows[0];
  if (exists) throw conflict('already_member', 'الشخص ده عنده حساب في الشركة بالفعل', 'This person already has access to this company');
  const status = account.created ? 'active' : 'invited';
  const m = (await c.query(`INSERT INTO memberships (company_id, user_id, role, branch_id, driver_id, title_ar, title_en, status, invited_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [ctx.companyId, account.user.id, row.role, row.branchId || null, row.driverId || null, (row.title && row.title.ar) || '', (row.title && row.title.en) || '', status, ctx.user.name || ''])).rows[0];
  if (account.created) await c.query('UPDATE users SET last_company_id = $1 WHERE id = $2', [ctx.companyId, account.user.id]);
  return { membershipId: m.id, status };
}

/* sign the person out of this company only (other companies' sessions stay) */
const endSessions = (c, userId, companyId) => c.query('DELETE FROM sessions WHERE user_id = $1 AND company_id = $2', [userId, companyId]);

module.exports = { membershipsOf, shared, sharedError, findOrCreate, addMember, endSessions };
