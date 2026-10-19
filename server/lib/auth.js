'use strict';
/* Passwords: scrypt (N=2^15, r=8, p=1, 64-byte key, 16-byte random salt), constant-time compare.
   Sessions: 256-bit random token in an HttpOnly cookie; only its SHA-256 is stored.
   Lockout: 5 failed logins on an account lock it for 15 minutes; 30 failures from one IP in
   15 minutes block that IP. */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { AppError } = require('./errors');

const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = Buffer.from(keyB64, 'base64');
    const test = await scrypt(String(pw).normalize('NFKC'), Buffer.from(saltB64, 'base64'), key.length, { N: +n, r: +r, p: +p, maxmem: 128 * +n * +r * 2 });
    return crypto.timingSafeEqual(key, test);
  } catch (e) { return false; }
}
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const COMMON = new Set(['password', 'password1', 'password123', '123456789', '1234567890', 'qwertyuiop', 'admin12345', 'motus12345', 'p@ssw0rd123', '11111111111', 'iloveyou123', 'welcome123', 'egypt12345', 'cairo12345']);
function checkPolicy(pw, email) {
  const fail = (ar, en) => { throw new AppError(400, 'weak_password', ar, en, { field: 'password' }); };
  if (typeof pw !== 'string' || pw.length < 10) fail('كلمة المرور لازم تكون 10 أحرف على الأقل', 'The password must be at least 10 characters');
  if (pw.length > 200) fail('كلمة المرور طويلة جداً', 'The password is too long');
  if (COMMON.has(pw.toLowerCase())) fail('كلمة المرور شائعة جداً، اختر كلمة أخرى', 'This password is too common, choose another');
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) fail('كلمة المرور لا يجب أن تحتوي على اسم المستخدم', 'The password must not contain the user name');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  if (classes < 3 && pw.length < 16) fail('استخدم 3 أنواع على الأقل من: حروف صغيرة، كبيرة، أرقام، رموز (أو 16 حرف فأكثر)', 'Use at least 3 of: lowercase, uppercase, digits, symbols (or 16+ characters)');
}

function newToken() { return crypto.randomBytes(32).toString('base64url'); }
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function randomPassword(len = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*-_';
  let out = '';
  while (out.length < len) { const b = crypto.randomBytes(1)[0]; if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length]; }
  return out;
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, checkPolicy, newToken, sha256, randomPassword };
