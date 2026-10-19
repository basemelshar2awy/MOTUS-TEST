'use strict';
/* JSON-lines logger. One file per day: logs/motus-YYYY-MM-DD.log (kept 30 days).
   Also writes to stdout/stderr so the Windows supervisor captures early startup failures. */
const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let dir = null, min = LEVELS.info, stream = null, streamDay = null, keepDays = 30;

function init(opts) {
  dir = opts.dir; min = LEVELS[opts.level] || LEVELS.info;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { dir = null; process.stderr.write(`log dir unavailable: ${e.message}\n`); }
  prune();
}

function day() { return new Date().toISOString().slice(0, 10); }

function prune() {
  if (!dir) return;
  try {
    const cutoff = Date.now() - keepDays * 86400000;
    for (const f of fs.readdirSync(dir)) {
      if (!/^motus-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) { /* best effort */ }
}

function write(level, msg, fields) {
  if ((LEVELS[level] || 0) < min) return;
  const rec = Object.assign({ t: new Date().toISOString(), level, msg }, fields || {});
  if (rec.err instanceof Error) rec.err = { message: rec.err.message, code: rec.err.code, stack: rec.err.stack };
  const line = JSON.stringify(rec) + '\n';
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
  if (!dir) return;
  const d = day();
  if (d !== streamDay) { if (stream) stream.end(); streamDay = d; stream = fs.createWriteStream(path.join(dir, `motus-${d}.log`), { flags: 'a' }); prune(); }
  stream.write(line);
}

module.exports = {
  init,
  debug: (m, f) => write('debug', m, f),
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
  close: () => new Promise(r => (stream ? stream.end(r) : r())),
};
