'use strict';
/* Outbound webhook delivery worker.
   Each delivery is signed:  X-Motus-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
   Retries with back-off (1 min, 5 min, 30 min, 2 h, 6 h); after 6 attempts it is marked failed
   and can be retried from Settings → Integrations. */
const crypto = require('crypto');
const db = require('./db');
const log = require('./log');
const secrets = require('./secrets');
const outbound = require('./outbound');

const BACKOFF = [60, 300, 1800, 7200, 21600];
let timer = null, running = false, allowPrivate = false;

function sign(secret, body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

async function claim(companyId) {
  return db.tx(companyId, async c => {
    const r = await c.query(`UPDATE webhook_deliveries d SET next_attempt_at = now() + interval '5 minutes'
       WHERE d.id IN (SELECT id FROM webhook_deliveries WHERE status IN ('pending','retrying') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
       RETURNING d.id, d.webhook_id, d.event, d.payload, d.attempts`);
    const hooks = r.rows.length ? (await c.query('SELECT id, url, secret_enc, status FROM webhooks WHERE id = ANY($1::uuid[])', [r.rows.map(x => x.webhook_id)])).rows : [];
    return r.rows.map(d => Object.assign(d, { hook: hooks.find(h => h.id === d.webhook_id) }));
  });
}

async function deliverOne(companyId, d) {
  let status = 'delivered', code = null, error = null;
  if (!d.hook || d.hook.status !== 'active') { status = 'failed'; error = 'webhook disabled or removed'; }
  else {
    try {
      const body = JSON.stringify(d.payload);
      const secret = secrets.decrypt(d.hook.secret_enc);
      const res = await outbound.request(d.hook.url, { body, allowPrivate, headers: { 'Content-Type': 'application/json', 'X-Motus-Event': d.event, 'X-Motus-Delivery': d.id, 'X-Motus-Signature': sign(secret, body) } });
      code = res.status;
      if (res.status < 200 || res.status >= 300) { status = 'retry'; error = `HTTP ${res.status}: ${res.body.slice(0, 200)}`; }
    } catch (e) { status = 'retry'; error = e.message; }
  }
  const attempts = d.attempts + 1;
  if (status === 'retry') status = attempts >= 6 ? 'failed' : 'retrying';
  await db.tx(companyId, c => c.query(
    // a shipment's delivery code is kept only until its delivery is over (MOTUS keeps the hash only)
    `UPDATE webhook_deliveries SET status = $1, code = $2, attempts = $3, last_error = $4, delivered_at = CASE WHEN $1 = 'delivered' THEN now() ELSE delivered_at END,
       payload = CASE WHEN event = 'shipment.code' AND $1 IN ('delivered','failed') THEN jsonb_set(payload, '{data,deliveryCode}', '"******"') ELSE payload END,
       next_attempt_at = now() + make_interval(secs => $5) WHERE id = $6`,
    [status, code, attempts, error, BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)], d.id]));
  if (status !== 'delivered') log.warn('webhook delivery problem', { companyId, delivery: d.id, event: d.event, status, error });
}

async function tick() {
  if (running) return; running = true;
  try {
    const due = (await db.platform(c => c.query('SELECT company_id FROM webhook_due_companies()'))).rows;
    for (const { company_id } of due) {
      const list = await claim(company_id);
      for (const d of list) await deliverOne(company_id, d);
    }
  } catch (e) { log.error('webhook worker error', { err: e }); }
  finally { running = false; }
}

function start(opts = {}) { allowPrivate = !!opts.allowPrivate; if (!timer) timer = setInterval(tick, opts.intervalMs || 10000); timer.unref(); }
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, tick, sign };
