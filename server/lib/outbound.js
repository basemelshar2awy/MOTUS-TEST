'use strict';
/* Outbound HTTP for webhooks and ERP push. Only http/https, no redirects, 10 s timeout,
   1 MB response cap, and (unless explicitly allowed) no private / loopback / link-local
   addresses — the resolved address is pinned so DNS cannot be switched mid-request. */
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.') || x.startsWith('::ffff:169.254.');
}

function request(url, { method = 'POST', headers = {}, body = '', allowPrivate = false, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(new Error('invalid URL')); return; }
    if (!['http:', 'https:'].includes(u.protocol)) { reject(new Error('only http/https URLs are allowed')); return; }
    dns.lookup(u.hostname, { all: true }, (err, addrs) => {
      if (err || !addrs || !addrs.length) { reject(new Error('cannot resolve host ' + u.hostname)); return; }
      const pick = addrs[0];
      if (!allowPrivate && addrs.some(a => isPrivate(a.address))) { reject(new Error('destination address is private/internal and is blocked')); return; }
      const lib = u.protocol === 'https:' ? https : http;
      const data = Buffer.from(body);
      const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method, headers: Object.assign({ 'Content-Length': data.length, 'User-Agent': 'MOTUS/1.0' }, headers), timeout,
        lookup: (h, o, cb) => (o && o.all ? cb(null, [{ address: pick.address, family: pick.family }]) : cb(null, pick.address, pick.family)) }, res => {
        const chunks = []; let size = 0;
        res.on('data', d => { size += d.length; if (size <= 1024 * 1024) chunks.push(d); });
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000) }));
      });
      req.on('timeout', () => req.destroy(new Error('timed out after ' + timeout / 1000 + ' s')));
      req.on('error', reject);
      req.end(data);
    });
  });
}

module.exports = { request, isPrivate };
