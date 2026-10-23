'use strict';
/* MOTUS Fleet server entry point.  Plain Node.js (no framework).
   Listens ONLY on 127.0.0.1 (IIS reverse-proxies to it). Start: node server.js */
const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./lib/config');

const cfg = config.load();
const log = require('./lib/log');
log.init({ dir: cfg.logDir, level: cfg.logLevel });

const db = require('./lib/db');
const core = require('./lib/core');
const secrets = require('./lib/secrets');
const snapshot = require('./lib/snapshot');
const webhooks = require('./lib/webhooks');
const push = require('./lib/push');
const registry = require('./services/registry');
['fleet', 'ops', 'finance', 'contracts', 'lines', 'inventory', 'tracking', 'providers', 'admin'].forEach(m => require('./services/' + m));
const session = require('./api/session');
const routes = require('./api/routes');
const v1 = require('./api/v1');
const { send, securityHeaders, loadStatic, serveFile } = require('./lib/http');
const { AppError, fromPg } = require('./lib/errors');

const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(cfg.appDir, 'package.json'), 'utf8')); } catch (e) { return { version: 'dev' }; } })();
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function fatal(msg, e) {
  log.error('startup failed: ' + msg, e ? { err: e } : undefined);
  process.stderr.write(`\nMOTUS cannot start: ${msg}\n`);
  log.close().then(() => process.exit(1));
}

async function preflight() {
  if (!cfg.fileFound && !process.env.PGPASSWORD && !process.env.MOTUS_DB_APP_PASSWORD) throw new Error(`configuration file not found: ${cfg.file}. Run Install-Motus.ps1 (or 2-Setup-Database.ps1) first.`);
  if (!cfg.db.password) throw new Error('the database password (MOTUS_DB_APP_PASSWORD) is not set in ' + cfg.file);
  if (!LOOPBACK.has(cfg.host) && process.env.MOTUS_ALLOW_NON_LOOPBACK !== '1') throw new Error(`MOTUS_HOST is "${cfg.host}". For safety the application only listens on 127.0.0.1 (IIS is the public entry point).`);
  core.setTimezone(cfg.timezone);
  secrets.init(cfg.credentialsKey);
  if (!secrets.ready()) log.warn('MOTUS_CREDENTIALS_KEY is missing or not 64 hex characters: provider credentials and webhook secrets cannot be saved until it is set');
  db.init(cfg.db);
  try { await db.query('SELECT 1'); } catch (e) { throw new Error(`cannot connect to PostgreSQL at ${cfg.db.host}:${cfg.db.port} as "${cfg.db.user}" (${e.message}). Check that the PostgreSQL service is running and the password in the config file is right.`); }
  const m = await db.query("SELECT to_regclass('public.schema_migrations') t").then(r => r.rows[0].t).catch(() => null);
  if (!m) throw new Error('the database has no schema yet. Run:  node server/tools/migrate.js');
  const applied = new Set((await db.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
  const missing = require('./tools/migrate').files().filter(f => !applied.has(f.slice(0, 3)));
  if (missing.length) throw new Error('database migrations pending: ' + missing.join(', ') + '. Run:  node server/tools/migrate.js');
  const role = (await db.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
  if (role.rolsuper || role.rolbypassrls) throw new Error(`the application role "${cfg.db.user}" is a superuser / bypasses row level security. Tenant isolation would not be enforced. Use a normal role.`);
}

/* ---------- request handling ---------- */
const WEB = path.join(cfg.appDir, 'web');
let STATIC = new Map();
const hits = new Map();       // ip -> { t, n } coarse flood limit for /api
function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const fwd = req.headers['x-forwarded-for'];
  if (cfg.trustProxy && fwd && (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1')) {
    const parts = String(fwd).split(',').map(s => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || peer;      // the address IIS/ARR appended is the last one
    return last.replace(/^::ffff:/, '');
  }
  return peer.replace(/^::ffff:/, '');
}
function flood(ip) {
  const now = Date.now(); let h = hits.get(ip);
  if (!h || now - h.t > 60000) { h = { t: now, n: 0 }; hits.set(ip, h); }
  return ++h.n > 900;
}
setInterval(() => { const cut = Date.now() - 120000; for (const [k, v] of hits) if (v.t < cut) hits.delete(k); }, 60000).unref();

async function handle(req, res) {
  const t0 = Date.now();
  req._ip = clientIp(req);
  const secure = cfg.secureCookies || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
  securityHeaders(res, secure);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { return send(res, 400, { error: { code: 'bad_url', message: { ar: 'عنوان غير صحيح', en: 'Bad URL' } } }); }
  const p = url.pathname;
  try {
    if (p === '/healthz') {
      await db.query('SELECT 1');
      return send(res, 200, { ok: true, version: pkg.version, time: new Date().toISOString() });
    }
    if (p.startsWith('/api/')) {
      if (flood(req._ip)) throw new AppError(429, 'rate_limited', 'طلبات كثيرة جداً، انتظر دقيقة', 'Too many requests, wait a minute');
      if (await v1.handle(req, res, url, req._ip)) return;
      if (!p.startsWith('/api/webhooks/')) routes.checkOrigin(req);
      else if (req.method !== 'POST') throw new AppError(405, 'method', 'الطريقة غير مسموحة', 'Method not allowed');
      const m = routes.router.match(req.method, p);
      if (!m) throw new AppError(404, 'not_found', 'المسار غير موجود', 'Not found');
      if (m.methodNotAllowed) throw new AppError(405, 'method', 'الطريقة غير مسموحة', 'Method not allowed');
      await m.route.handler(req, res, m.params, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (p === '/m/open') return routes.openMobile(req, res, url);   // a web screen opened inside the app
    let file = STATIC.get(p === '/' ? '/index.html' : p);
    if (!file) file = /\.[a-z0-9]+$/i.test(p) ? null : STATIC.get('/index.html');   // SPA fallback only for non-file paths
    if (!file) return send(res, 404, 'Not found');
    serveFile(req, res, file, p.startsWith('/fonts/') ? 86400 : 0);
  } catch (e0) {
    const e = fromPg(e0);
    if (e instanceof AppError) {
      if (!res.headersSent) send(res, e.status, { error: { code: e.code, message: e.msg, field: e.field || undefined, rows: e.rows, reasons: e.reasons } });
      if (e.status >= 500) log.error('request failed', { err: e, path: p });
    } else {
      log.error('unhandled error', { err: e0, method: req.method, path: p, ip: req._ip });
      send(res, 500, { error: { code: 'server_error', message: { ar: 'حدث خطأ غير متوقع. تم تسجيله، حاول مرة أخرى أو تواصل مع الدعم.', en: 'An unexpected error occurred. It was logged; try again or contact support.' } } });
    }
  } finally {
    const ms = Date.now() - t0;
    if (p.startsWith('/api/') && (ms > 2000 || res.statusCode >= 500)) log.warn('request', { method: req.method, path: p, status: res.statusCode, ms });
    else log.debug('request', { method: req.method, path: p, status: res.statusCode, ms });
  }
}

async function main() {
  await preflight();
  STATIC = loadStatic(WEB);
  if (!STATIC.has('/index.html')) throw new Error('web/index.html is missing from the application folder');
  session.init(cfg); routes.init(cfg);
  registry.setOnChange(snapshot.invalidate);
  const server = http.createServer((req, res) => { handle(req, res).catch(e => { log.error('fatal handler error', { err: e }); try { res.destroy(); } catch (x) { /* gone */ } }); });
  server.keepAliveTimeout = 65000; server.headersTimeout = 20000; server.requestTimeout = 120000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, cfg.host, resolve); }).catch(e => {
    throw new Error(e.code === 'EADDRINUSE' ? `port ${cfg.port} on ${cfg.host} is already in use (is another copy of MOTUS running?)` : e.message);
  });
  if (cfg.webhookWorker) webhooks.start({ allowPrivate: cfg.allowPrivateWebhooks });
  if (cfg.webhookWorker) push.start(cfg.push, { allowPrivate: cfg.allowPrivateWebhooks });
  log.info('MOTUS started', { version: pkg.version, listen: `${cfg.host}:${cfg.port}`, origin: cfg.publicOrigin, db: `${cfg.db.host}:${cfg.db.port}/${cfg.db.database}`, node: process.version });

  let stopping = false;
  const stop = async sig => {
    if (stopping) return; stopping = true;
    log.info('shutting down', { signal: sig });
    webhooks.stop(); push.stop();
    const force = setTimeout(() => process.exit(0), 10000); force.unref();
    server.close(async () => { try { await db.close(); } catch (e) { /* ignore */ } await log.close(); process.exit(0); });
  };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT')); process.on('SIGBREAK', () => stop('SIGBREAK'));
}

process.on('unhandledRejection', e => log.error('unhandledRejection', { err: e instanceof Error ? e : new Error(String(e)) }));
process.on('uncaughtException', e => { log.error('uncaughtException', { err: e }); log.close().then(() => process.exit(1)); });

main().catch(e => fatal(e.message, e));
