'use strict';
/* Inventory, maintenance, GPS, documents, ERP export, Open API, provider webhooks, outbound webhooks. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const H = require('./helpers');

let env, adm, ids = {}, receiver, received = [];
const ok = async (p, msg) => { const r = await p; assert.equal(r.status, 200, (msg || '') + ' -> ' + JSON.stringify(r.data)); return r.data; };
const sign = (secret, body, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

before(async () => {
  receiver = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.end('ok'); }); });
  await new Promise(r => receiver.listen(0, '127.0.0.1', r));
  env = await H.createEnv({ MOTUS_WEBHOOK_WORKER: '1', MOTUS_ALLOW_PRIVATE_WEBHOOKS: '1' });
  const b = await H.bootstrap(env); await env.start(); adm = await H.signIn(env, 'admin@aaa.test', b.adminPw);
  const v = await ok(adm.do('vehicle.create', { type: 'MB', plate: 'T 100', purchaseDate: '2024-01-01', purchasePrice: 1000000, odometer: 500 }));
  ids.veh = v.id;
});
after(async () => { receiver.close(); await env.destroy(); });

test('inventory: purchase order -> receipt -> weighted average -> work order issue -> no negative stock', async () => {
  const snap0 = (await ok(adm.get('/api/snapshot'))).data;
  const wh = snap0.warehouses[0].id;
  const sup = await ok(adm.do('supplier.create', { name: 'Parts Co' }));
  const item = await ok(adm.do('item.create', { name: { ar: 'فلتر زيت', en: 'Oil filter' }, category: 'filters', unit: 'pc', cost: 100, minQty: 2 }));
  ids.item = item.id;
  const po = await ok(adm.do('po.create', { supplierId: sup.id, lines: [{ itemId: item.id, qty: 10, price: 100 }] }));
  await ok(adm.do('po.approve', { id: po.id }));
  await ok(adm.do('po.receive', { id: po.id, warehouseId: wh }));
  const bal1 = (await env.sql('SELECT qty FROM stock_balances WHERE item_id = $1', [item.id])).rows[0];
  assert.equal(Number(bal1.qty), 10);
  await ok(adm.do('stock.receipt', { warehouseId: wh, lines: [{ itemId: item.id, qty: 10, unitCost: 200 }] }));
  const avg = (await env.sql('SELECT avg_cost FROM items WHERE id = $1', [item.id])).rows[0];
  assert.equal(Number(avg.avg_cost), 150, 'weighted average cost');
  const wo = await ok(adm.do('wo.create', { vehicleId: ids.veh, problem: 'Oil service', parts: [{ itemId: item.id, qty: 4 }] }));
  await ok(adm.do('wo.issueParts', { id: wo.id, warehouseId: wh }));
  assert.equal(Number((await env.sql('SELECT qty FROM stock_balances WHERE item_id = $1', [item.id])).rows[0].qty), 16);
  const over = await adm.do('stock.adjust', { warehouseId: wh, lines: [{ itemId: item.id, qty: -999, reason: 'test' }] });
  assert.ok(over.status >= 400 && over.status < 500, 'negative stock refused: ' + over.status + JSON.stringify(over.data));
  assert.equal(Number((await env.sql('SELECT qty FROM stock_balances WHERE item_id = $1', [item.id])).rows[0].qty), 16);
  await ok(adm.do('wo.close', { id: wo.id, laborHours: 2, warehouseId: wh }));
  assert.equal((await env.sql('SELECT status FROM vehicles WHERE id = $1', [ids.veh])).rows[0].status, 'active', 'vehicle returns to service');
  const mv = await env.sql('SELECT count(*)::int n FROM stock_movements WHERE item_id = $1', [item.id]);
  assert.ok(mv.rows[0].n >= 3);
});

test('Open API: scopes, pagination, idempotency, revocation', async () => {
  const k = await ok(adm.do('apiKey.create', { name: 'ERP', scopes: ['vehicles:read', 'clients:read', 'clients:write', 'tracking:write', 'tracking:read', 'journal:read', 'reports:read'] }));
  ids.key = k.id;
  const api = (m, u, b, h = {}) => fetch(env.base + u, { method: m, headers: Object.assign({ Authorization: 'Bearer ' + k.key, 'Content-Type': 'application/json' }, h), body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
  assert.equal((await fetch(env.base + '/api/v1/vehicles')).status, 401);
  assert.equal((await api('GET', '/api/v1/ping')).data.ok, true);
  const list = await api('GET', '/api/v1/vehicles?limit=1');
  assert.equal(list.status, 200); assert.equal(list.data.data.length, 1);
  assert.equal(list.data.data[0].companyId, undefined, 'company id not leaked in rows');
  assert.equal((await api('GET', '/api/v1/invoices')).status, 403, 'missing scope');
  assert.equal((await api('POST', '/api/v1/vehicles', { type: 'SD' })).status, 403, 'read-only scope cannot write');
  const body = { name: { ar: 'عميل API', en: 'API client' }, externalRef: 'ERP-77' };
  const c1 = await api('POST', '/api/v1/clients', body, { 'Idempotency-Key': 'abc-1' });
  const c2 = await api('POST', '/api/v1/clients', body, { 'Idempotency-Key': 'abc-1' });
  assert.equal(c1.status, 201, JSON.stringify(c1.data)); assert.equal(c2.data.data.id, c1.data.data.id, 'same id on replay');
  assert.equal((await env.sql("SELECT count(*)::int n FROM clients WHERE external_ref = 'ERP-77'")).rows[0].n, 1);
  const byRef = await api('GET', '/api/v1/clients?externalRef=ERP-77');
  assert.equal(byRef.data.data.length, 1);
  const bad = await api('POST', '/api/v1/clients', {});
  assert.equal(bad.status, 400); assert.ok(bad.data.error.message.en);
  assert.equal((await api('GET', '/api/v1/reports/summary')).status, 200);
  // GPS positions with overspeed -> event
  const pos = await api('POST', '/api/v1/tracking/positions', { positions: [{ vehicleId: ids.veh, at: new Date(Date.now() - 60000).toISOString(), lat: 30.05, lng: 31.24, speed: 150, ignition: true }, { plate: 'NOPE', at: new Date().toISOString(), lat: 30, lng: 31, speed: 10 }] });
  assert.equal(pos.status, 201, JSON.stringify(pos.data)); assert.equal(pos.data.data.stored, 1); assert.equal(pos.data.data.rejected.length, 1);
  const live = await ok(adm.get('/api/live'));
  assert.equal(live.positions.find(p => p.vehicleId === ids.veh).speed, 150);
  assert.ok((await env.sql("SELECT 1 FROM events WHERE type = 'overspeed'")).rowCount >= 1, 'overspeed event created');
  const cairoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const hist = await ok(adm.get(`/api/history?vehicleId=${ids.veh}&date=${cairoToday}`));
  assert.ok(hist.points.length >= 1);
  await ok(adm.do('apiKey.revoke', { id: ids.key }));
  assert.equal((await api('GET', '/api/v1/ping')).status, 401, 'revoked key refused');
  const stored = (await env.sql('SELECT key_hash FROM api_keys')).rows[0].key_hash;
  assert.notEqual(stored, k.key); assert.equal(stored.length, 64, 'only a hash is stored');
});

test('provider webhook: signature required, transactions imported once', async () => {
  const p = await ok(adm.do('provider.create', { name: 'Fuel Co', kind: 'fuel', mode: 'webhook' }));
  const conn = await ok(adm.do('provider.connect', { id: p.id, credentials: { apiKey: 'sekret-123' } }));
  assert.match(conn.webhookSecret, /^whsec_/);
  const row = (await env.sql('SELECT credentials_enc, webhook_secret_enc FROM providers WHERE id = $1', [p.id])).rows[0];
  assert.ok(!row.credentials_enc.includes('sekret-123') && row.credentials_enc.startsWith('v1.'), 'credentials encrypted at rest');
  assert.ok(!row.webhook_secret_enc.includes(conn.webhookSecret));
  const body = JSON.stringify({ transactions: [{ extId: 'TX-1', date: new Date().toISOString().slice(0, 10), time: '10:00', amount: 400, liters: 80, cardOrTag: 'CARD-9' }] });
  const post = (sig) => fetch(env.base + conn.webhookPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Motus-Signature': sig }, body });
  assert.equal((await post('t=1,v1=' + '0'.repeat(64))).status, 401);
  assert.equal((await post(sign('whsec_wrong', body))).status, 401);
  assert.equal((await post(sign(conn.webhookSecret, body, Math.floor(Date.now() / 1000) - 3600))).status, 401, 'stale timestamp refused');
  const good = await post(sign(conn.webhookSecret, body));
  assert.equal(good.status, 200, await good.text());
  const again = await (await post(sign(conn.webhookSecret, body))).json();
  assert.equal(again.duplicates, 1);
  assert.equal((await env.sql("SELECT count(*)::int n FROM provider_tx WHERE ext_id = 'TX-1'")).rows[0].n, 1);
  assert.equal((await fetch(env.base + '/api/webhooks/providers/' + p.id)).status, 405);
});

test('outbound webhooks are signed and delivered', async () => {
  const w = await ok(adm.do('webhook.create', { url: `http://127.0.0.1:${receiver.address().port}/hook`, events: ['client.created'] }));
  await ok(adm.do('client.create', { name: 'Hooked Client' }));
  for (let i = 0; i < 40 && !received.length; i++) await new Promise(r => setTimeout(r, 500));
  assert.ok(received.length, 'delivery arrived');
  const r = received[0];
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(r.headers['x-motus-signature']);
  const expect = crypto.createHmac('sha256', w.secret).update(`${t}.${r.body}`).digest('hex');
  assert.equal(v1, expect, 'signature verifies with the shown secret');
  assert.equal(JSON.parse(r.body).event, 'client.created');
});

test('documents: content must match type; download is company scoped', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const up = await ok(adm.do('document.upload', { owner: 'vehicle', ownerId: ids.veh, kind: 'insurance', expiry: '2031-01-01', file: { name: 'ins.png', mime: 'image/png', data: png.toString('base64') } }));
  const fake = await adm.do('document.upload', { owner: 'vehicle', ownerId: ids.veh, kind: 'insurance', file: { name: 'x.pdf', mime: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') } });
  assert.equal(fake.status, 400);
  const dl = await fetch(`${env.base}/api/documents/${up.id}/file`, { headers: { Cookie: Object.entries(adm.jar).map(([k, v]) => k + '=' + v).join('; ') } });
  assert.equal(dl.status, 200); assert.equal(Buffer.from(await dl.arrayBuffer()).length, png.length);
  assert.equal((await env.client().get(`/api/documents/${up.id}/file`)).status, 401);
});

test('ERP: journal export CSV/JSON, mark exported, closed periods are immutable', async () => {
  const cl = (await ok(adm.get('/api/snapshot'))).data.clients[0];
  await ok(adm.do('invoice.manual', { clientId: cl.id, lines: [{ description: 'Service', qty: 1, unit: 1000 }] }));
  const csv = await adm.get('/api/export/journal?format=csv');
  assert.equal(csv.status, 200); assert.match(csv.data, /entry,date,source_type/);
  const js = await ok(adm.get('/api/export/journal?format=json&mark=1'));
  assert.ok(js.entries.length >= 1);
  assert.equal((await env.sql("SELECT count(*)::int n FROM journal_entries WHERE status = 'posted'")).rows[0].n, 0, 'marked as exported');
  const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const month = prev.toISOString().slice(0, 7);
  await ok(adm.do('period.close', { month }));
  const late = await adm.do('expense.create', { category: 'other', amount: 10, date: month + '-15' });
  assert.ok(late.status >= 400 && late.status < 500, 'posting into a closed period refused: ' + JSON.stringify(late.data));
  await assert.rejects(() => env.sql("UPDATE journal_lines SET debit = debit + 1 WHERE id = (SELECT id FROM journal_lines LIMIT 1)"), /./, 'balance trigger blocks unbalanced edit');
});
