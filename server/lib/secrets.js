'use strict';
/* AES-256-GCM encryption for third-party credentials and webhook signing secrets stored in the
   database. The 32-byte key (hex) lives only in the server config file (MOTUS_CREDENTIALS_KEY). */
const crypto = require('crypto');
const { AppError } = require('./errors');
let KEY = null;

function init(hex) {
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) KEY = Buffer.from(hex, 'hex');
  else KEY = null;
}
const ready = () => !!KEY;
function need() { if (!KEY) throw new AppError(503, 'no_key', 'مفتاح تشفير بيانات الربط غير مضبوط على السيرفر', 'The credentials encryption key is not configured on the server (MOTUS_CREDENTIALS_KEY)'); }

function encrypt(plain) {
  need();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function decrypt(blob) {
  need();
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
const mask = s => (s ? s.slice(0, 4) + '••••' + s.slice(-2) : '');

module.exports = { init, ready, encrypt, decrypt, mask };
