'use strict';
/* Test harness: creates a throw-away database on a real PostgreSQL server, applies the real
   migrations, starts the real server process on a random port and talks to it over HTTP.
   Needs a PostgreSQL superuser: MOTUS_TEST_PG_HOST/PORT/USER/PASSWORD (defaults: 127.0.0.1:5433 postgres/superpass). */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const pg = require('pg');

const ROOT = path.resolve(__dirname, '..');
const SU = { host: process.env.MOTUS_TEST_PG_HOST || '127.0.0.1', port: +(process.env.MOTUS_TEST_PG_PORT || 5433), user: process.env.MOTUS_TEST_PG_USER || 'postgres', password: process.env.MOTUS_TEST_PG_PASSWORD || 'superpass', database: 'postgres' };

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function createEnv(extra = {}) {
  const id = crypto.randomBytes(4).toString('hex');
  const dbName = 'motus_t_' + id, owner = 'mt_owner_' + id, app = 'mt_app_' + id;
  const ownerPw = crypto.randomBytes(12).toString('hex'), appPw = crypto.randomBytes(12).toString('hex');
  const su = new pg.Client(SU); await su.connect();
  await su.query(`CREATE ROLE ${owner} LOGIN PASSWORD '${ownerPw}'`);
  await su.query(`CREATE ROLE ${app} LOGIN PASSWORD '${appPw}' NOSUPERUSER NOBYPASSRLS`);
  await su.query(`CREATE DATABASE ${dbName} OWNER ${owner}`);
  await su.end();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motus-test-'));
  const cfgFile = path.join(dir, 'motus.env');
  const port = await freePort();
  const lines = {
    PGHOST: SU.host, PGPORT: SU.port, PGDATABASE: dbName, MOTUS_DB_APP_USER: app, MOTUS_DB_APP_PASSWORD: appPw, MOTUS_DB_OWNER_USER: owner, MOTUS_DB_OWNER_PASSWORD: ownerPw,
    MOTUS_CREDENTIALS_KEY: crypto.randomBytes(32).toString('hex'), PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, MOTUS_PORT: port, MOTUS_LOG_DIR: path.join(dir, 'logs'), MOTUS_LOG_LEVEL: 'warn', MOTUS_WEBHOOK_WORKER: '0',
  };
  Object.assign(lines, extra);
  fs.writeFileSync(cfgFile, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n'));
  const env = { dbName, owner, app, dir, cfgFile, port, base: `http://127.0.0.1:${port}`, proc: null, SU };
  env.node = (script, args = [], opts = {}) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], { env: Object.assign({}, process.env, { MOTUS_CONFIG: cfgFile }), encoding: 'utf8', ...opts });
  const m = env.node('server/tools/migrate.js');
  if (m.status !== 0) throw new Error('migrate failed: ' + m.stdout + m.stderr);
  env.start = async () => {
    env.proc = spawn(process.execPath, [path.join(ROOT, 'server/server.js')], { env: Object.assign({}, process.env, { MOTUS_CONFIG: cfgFile }), stdio: ['ignore', 'pipe', 'pipe'] });
    env.out = ''; env.proc.stdout.on('data', d => { env.out += d; }); env.proc.stderr.on('data', d => { env.out += d; });
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(env.base + '/healthz'); if (r.ok) return; } catch (e) { /* not yet */ }
      if (env.proc.exitCode != null) throw new Error('server exited: ' + env.out);
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('server did not start: ' + env.out);
  };
  env.stop = async () => { if (env.proc && env.proc.exitCode == null) { env.proc.kill('SIGTERM'); await new Promise(r => env.proc.once('exit', r)); } };
  env.restart = async () => { await env.stop(); await env.start(); };
  env.destroy = async () => {
    await env.stop();
    const s = new pg.Client(SU); await s.connect();
    await s.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await s.query(`DROP ROLE IF EXISTS ${app}`); await s.query(`DROP ROLE IF EXISTS ${owner}`); await s.end();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  env.client = () => client(env.base);
  env.sql = async (text, params) => { const c = new pg.Client({ host: SU.host, port: SU.port, user: owner, password: ownerPw, database: dbName }); await c.connect(); try { return await c.query(text, params); } finally { await c.end(); } };
  return env;
}

/* HTTP client with a cookie jar and the CSRF header the browser sends */
function client(base) {
  const jar = {};
  const c = {
    async req(method, url, body, headers = {}) {
      const h = Object.assign({ 'X-Requested-With': 'motus' }, headers);
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const ck = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (ck) h.Cookie = ck;
      const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1)); if (/Max-Age=0/i.test(sc) || !v) delete jar[k]; else jar[k] = v; }
      const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (e) { data = text; }
      return { status: r.status, data, headers: r.headers };
    },
    get: (u, h) => c.req('GET', u, undefined, h),
    post: (u, b, h) => c.req('POST', u, b === undefined ? {} : b, h),
    do: (a, b) => c.req('POST', '/api/do/' + a, b || {}),
    jar,
    async login(email, password) { return c.post('/api/login', { email, password }); },
  };
  return c;
}

const PW = 'Str0ng-Test-Passw0rd!';
/* creates a super admin + company(ies) through the same console tool the operator uses and signs in */
async function bootstrap(env, companies = ['AAA']) {
  const out = {};
  const r = env.node('server/tools/create-admin.js', ['--email', 'root@t.test', '--name', 'Root', '--generate', '--company', companies[0], '--company-name', 'Company ' + companies[0], '--company-admin', `admin@${companies[0].toLowerCase()}.test`]);
  if (r.status !== 0) throw new Error('create-admin failed: ' + r.stdout + r.stderr);
  const pws = [...r.stdout.matchAll(/password[^:]*: (.+)$/gim)].map(m => m[1].trim());
  out.rootPw = pws[0]; out.adminPw = pws[1];
  return out;
}
/* sign in with a temporary password and set the permanent one */
async function signIn(env, email, temp, pw = PW) {
  const c = env.client();
  const l = await c.login(email, temp);
  if (l.status !== 200) throw new Error('login failed ' + JSON.stringify(l.data));
  if (l.data.mustChangePassword) {
    const p = await c.post('/api/password', { currentPassword: temp, newPassword: pw });
    if (p.status !== 200) throw new Error('password change failed ' + JSON.stringify(p.data));
  }
  return c;
}

module.exports = { createEnv, client, bootstrap, signIn, PW, ROOT };
