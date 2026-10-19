'use strict';
/* Minimal HTTP toolkit: router, JSON bodies with size limits, cookies, security headers,
   pre-compressed static files. No third-party framework. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { AppError } = require('./errors');

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*$/, '(.*)') + '$');
    this.routes.push({ method, re, keys, handler, opts, wildcard: pattern.endsWith('*') });
  }
  match(method, pathname) {
    let pathOnly = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) { pathOnly = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      if (r.wildcard) params.rest = m[m.length - 1];
      return { route: r, params };
    }
    return pathOnly ? { methodNotAllowed: true } : null;
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > limit) { reject(new AppError(413, 'too_large', 'حجم الطلب أكبر من المسموح', 'The request is too large')); req.resume(); return; }
    const chunks = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > limit) { reject(new AppError(413, 'too_large', 'حجم الطلب أكبر من المسموح', 'The request is too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req, limit = 1024 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  if (!ct.startsWith('application/json')) throw new AppError(415, 'content_type', 'نوع المحتوى لازم يكون JSON', 'Content-Type must be application/json');
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' ? v : {}; } catch (e) { throw new AppError(400, 'bad_json', 'صيغة JSON غير صحيحة', 'Invalid JSON body'); }
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAge != null) parts.push('Max-Age=' + Math.floor(opts.maxAge));
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (Array.isArray(prev) ? prev : prev ? [prev] : []).concat(parts.join('; ')));
}

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
function securityHeaders(res, secure) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, Object.assign({ 'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' }, headers));
  res.end(data);
}

/* ---------- static files (loaded once, gzipped in memory, ETag) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
function loadStatic(root) {
  const files = new Map();
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      const ext = path.extname(f.name).toLowerCase();
      if (!TYPES[ext]) continue;
      const raw = fs.readFileSync(p);
      const rel = '/' + path.relative(root, p).split(path.sep).join('/');
      const compressible = !['.png', '.woff2', '.ico'].includes(ext);
      files.set(rel, { type: TYPES[ext], raw, gz: compressible ? zlib.gzipSync(raw, { level: 9 }) : null, etag: '"' + crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20) + '"' });
    }
  };
  walk(root);
  return files;
}
function serveFile(req, res, file, cacheSeconds) {
  if (req.headers['if-none-match'] === file.etag) { res.writeHead(304, { ETag: file.etag }); res.end(); return; }
  const gz = file.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = gz ? file.gz : file.raw;
  const h = { 'Content-Type': file.type, 'Content-Length': body.length, ETag: file.etag, 'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-cache', Vary: 'Accept-Encoding' };
  if (gz) h['Content-Encoding'] = 'gzip';
  res.writeHead(200, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

module.exports = { Router, json, readBody, cookies, setCookie, securityHeaders, send, loadStatic, serveFile };
