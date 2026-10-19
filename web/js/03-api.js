/* Talking to the server. Every change goes through POST /api/do/<action>; the server checks
   the role, validates, writes to PostgreSQL in one transaction and returns either a result or a
   bilingual error. After a change the browser reloads the company snapshot. */
'use strict';
(function () {
  const A = M.api = {};

  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.error && body.error.message && body.error.message.en) || ('HTTP ' + status));
      this.status = status; this.code = body && body.error ? body.error.code : 'http';
      this.msg = body && body.error ? body.error.message : { ar: 'تعذر الاتصال بالسيرفر', en: 'Could not reach the server' };
      this.field = body && body.error ? body.error.field : null;
      this.rows = body && body.error ? body.error.rows : null;
      this.reasons = body && body.error ? body.error.reasons : null;
    }
  }
  A.ApiError = ApiError;

  A.req = async (method, url, body) => {
    let res;
    try {
      res = await fetch(url, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-Requested-With': 'motus' } : { 'X-Requested-With': 'motus' }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (e) { throw new ApiError(0, null); }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) { try { data = await res.json(); } catch (e) { data = null; } }
    if (!res.ok) {
      const err = new ApiError(res.status, data);
      if (res.status === 401 && !url.endsWith('/api/login') && !url.endsWith('/api/password')) { A.onSignedOut && A.onSignedOut(); }
      if (err.code === 'password_change_required') { A.onMustChange && A.onMustChange(); }
      throw err;
    }
    return data;
  };
  A.get = url => A.req('GET', url);
  A.post = (url, body) => A.req('POST', url, body || {});
  A.do = (action, payload) => A.post('/api/do/' + encodeURIComponent(action), payload || {});

  /* session + snapshot */
  A.session = null;
  A.version = null;
  A.loadSession = async () => { A.session = await A.get('/api/session'); return A.session; };
  A.loadSnapshot = async () => {
    const snap = await A.get('/api/snapshot');
    A.version = snap.version;
    M.applySnapshot(snap);
    return snap;
  };
  A.changed = async () => {
    try { const v = await A.get('/api/version'); return v.version !== A.version; } catch (e) { return false; }
  };
  /* download a file returned by a GET endpoint (CSV/JSON/PDF) using a normal link so cookies apply */
  A.download = url => { const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); };
})();
