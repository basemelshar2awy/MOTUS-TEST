'use strict';
/* Runtime configuration.
   Values come from (lowest to highest priority):
     1. built-in defaults below
     2. the server-only config file (KEY=VALUE lines). Path: MOTUS_CONFIG env var, otherwise
        <deployment root>/config/motus.env (one level above the app folder).
     3. real environment variables.
   Secrets are never written to source files or to anything served to the browser. */
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_ROOT = path.resolve(APP_DIR, '..');

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function load() {
  const file = process.env.MOTUS_CONFIG || path.join(DEFAULT_ROOT, 'config', 'motus.env');
  let fileVals = {};
  let fileFound = false;
  try { fileVals = parseEnvFile(fs.readFileSync(file, 'utf8')); fileFound = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const get = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : fileVals[k] != null && fileVals[k] !== '' ? fileVals[k] : d);
  const root = path.resolve(get('MOTUS_ROOT', DEFAULT_ROOT));
  const cfg = {
    file, fileFound, appDir: APP_DIR, root,
    host: get('MOTUS_HOST', '127.0.0.1'),
    port: parseInt(get('MOTUS_PORT', '3000'), 10),
    publicOrigin: (get('PUBLIC_ORIGIN', 'http://127.0.0.1:3000') || '').replace(/\/+$/, ''),
    extraOrigins: (get('MOTUS_EXTRA_ORIGINS', 'http://127.0.0.1:3000,http://localhost:3000') || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
    trustProxy: get('MOTUS_TRUST_PROXY', '1') === '1',
    timezone: get('MOTUS_TIMEZONE', 'Africa/Cairo'),
    logDir: path.resolve(root, get('MOTUS_LOG_DIR', 'logs')),
    logLevel: get('MOTUS_LOG_LEVEL', 'info'),
    db: {
      host: get('PGHOST', '127.0.0.1'),
      port: parseInt(get('PGPORT', '5432'), 10),
      database: get('PGDATABASE', 'motus'),
      user: get('MOTUS_DB_APP_USER', get('PGUSER', 'motus_app')),
      password: get('MOTUS_DB_APP_PASSWORD', get('PGPASSWORD', '')),
      ownerUser: get('MOTUS_DB_OWNER_USER', 'motus_owner'),
      ownerPassword: get('MOTUS_DB_OWNER_PASSWORD', ''),
      ssl: get('PGSSLMODE', 'disable') === 'require' ? { rejectUnauthorized: false } : false,
      max: parseInt(get('MOTUS_DB_POOL', '15'), 10),
    },
    sessionHours: parseInt(get('MOTUS_SESSION_HOURS', '12'), 10),
    sessionIdleMinutes: parseInt(get('MOTUS_SESSION_IDLE_MINUTES', '120'), 10),
    // mobile apps: a phone stays signed in longer than a browser (still ends when unused)
    mobileSessionDays: parseInt(get('MOTUS_MOBILE_SESSION_DAYS', '30'), 10),
    mobileIdleDays: parseInt(get('MOTUS_MOBILE_IDLE_DAYS', '14'), 10),
    // push notifications: Firebase (Android, iPhone) and Huawei Push Kit; off until configured
    push: {
      fcmServiceAccount: get('MOTUS_FCM_SERVICE_ACCOUNT', ''),       // path to the Firebase service-account JSON
      hmsAppId: get('MOTUS_HMS_APP_ID', ''),
      hmsClientSecret: get('MOTUS_HMS_CLIENT_SECRET', ''),
      fcmUrl: get('MOTUS_FCM_URL', 'https://fcm.googleapis.com'),
      googleTokenUrl: get('MOTUS_GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
      hmsUrl: get('MOTUS_HMS_URL', 'https://push-api.cloud.huawei.com'),
      hmsTokenUrl: get('MOTUS_HMS_TOKEN_URL', 'https://oauth-login.cloud.huawei.com/oauth2/v3/token'),
    },
    credentialsKey: get('MOTUS_CREDENTIALS_KEY', ''),
    maxUploadBytes: parseInt(get('MOTUS_MAX_UPLOAD_BYTES', String(10 * 1024 * 1024)), 10),
    webhookWorker: get('MOTUS_WEBHOOK_WORKER', '1') === '1',
    allowPrivateWebhooks: get('MOTUS_ALLOW_PRIVATE_WEBHOOKS', '0') === '1',
    env: get('NODE_ENV', 'production'),
  };
  cfg.secureCookies = cfg.publicOrigin.startsWith('https://');
  return cfg;
}

module.exports = { load, parseEnvFile, APP_DIR };
