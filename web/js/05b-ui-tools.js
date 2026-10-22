/* UI tools: running server actions, forms, confirmations, file export (CSV / real .xlsx /
   print-to-PDF), sign-in screens, user menu and company switching. */
'use strict';
(function () {
  const U = M.ui, tt = M.tt, A = M.api;

  /* ---------- run a server action ----------
     U.run('booking.create', payload, { ok: 'Saved', after: res => ..., form: '#overlay' }) */
  U.busy = false;
  U.run = async (action, payload, opts = {}) => {
    if (U.busy) return null;
    if (U.readOnly()) { U.guard(); return null; }
    U.busy = true;
    const btns = document.querySelectorAll('#overlay .btn, .main .btn');
    btns.forEach(b => b.classList.add('wait'));
    clearFieldErrors();
    try {
      const res = await A.do(action, payload);
      if (opts.close !== false) U.closeOverlays();
      await U.reload(false);
      if (opts.ok) U.toast(typeof opts.ok === 'function' ? opts.ok(res) : opts.ok);
      if (opts.after) opts.after(res);
      else U.full();
      return res;
    } catch (e) {
      U.showError(e);
      return null;
    } finally {
      U.busy = false;
      document.querySelectorAll('.btn.wait').forEach(b => b.classList.remove('wait'));
    }
  };
  function clearFieldErrors() { document.querySelectorAll('.field.err').forEach(f => { f.classList.remove('err'); f.querySelectorAll('.msg').forEach(m => m.remove()); }); const b = document.getElementById('form-error'); if (b) b.remove(); }
  U.showError = e => {
    const msg = e && e.msg ? tt(e.msg.ar, e.msg.en) : String(e && e.message || e);
    let placed = false;
    if (e && e.field) {
      const el = document.querySelector(`#overlay [data-f="${e.field}"], [data-f="${e.field}"]`);
      if (el) { const f = el.closest('.field') || el.parentElement; f.classList.add('err'); f.insertAdjacentHTML('beforeend', `<div class="msg">${M.esc(msg)}</div>`); el.focus && el.focus(); placed = true; }
    }
    const box = document.querySelector('#overlay .sheet-body, #overlay .modal .sheet-body');
    if (box && !placed) {
      const rows = e && e.rows ? `<ul class="small">${e.rows.slice(0, 30).map(r => `<li>${tt('صف', 'Row')} ${r.row}${r.field ? ' · ' + M.esc(r.field) : ''}: ${M.esc(tt(r.error.ar || r.error, r.error.en || r.error))}</li>`).join('')}</ul>` : '';
      box.insertAdjacentHTML('afterbegin', `<div class="form-error" id="form-error" role="alert">${U.icon('alert')}<div>${M.esc(msg)}${rows}</div></div>`);
    }
    U.toast(msg, 'error');
  };
  U.reload = async (render = true) => { await A.loadSnapshot(); if (render) U.full(); };

  /* ---------- forms ----------
     fields: [{ f: 'name', label, type: 'text|number|date|time|select|textarea|checkbox|bi', options, value, req, help, full, attrs }] */
  U.formHtml = (fields, id = 'f') => `<form class="form" id="${id}" novalidate>${fields.filter(Boolean).map(x => {
    const fid = `${id}-${x.f}`;
    const attrs = `data-f="${x.f}" ${x.req ? 'required aria-required="true"' : ''} ${x.attrs || ''}`;
    let input;
    if (x.type === 'select') input = `<select id="${fid}" ${attrs}>${(x.options || []).map(o => `<option value="${M.esc(o[0])}" ${String(o[0]) === String(x.value == null ? '' : x.value) ? 'selected' : ''}>${M.esc(o[1])}</option>`).join('')}</select>`;
    else if (x.type === 'textarea') input = `<textarea id="${fid}" ${attrs}>${M.esc(x.value || '')}</textarea>`;
    else if (x.type === 'checkbox') return `<div class="field ${x.full ? 'full' : ''}"><label class="check"><input type="checkbox" id="${fid}" ${attrs} ${x.value ? 'checked' : ''}> ${x.label}</label>${x.help ? `<div class="help">${x.help}</div>` : ''}</div>`;
    else if (x.type === 'html') return `<div class="field ${x.full ? 'full' : ''}">${x.label ? `<label>${x.label}</label>` : ''}${x.html}</div>`;
    else input = `<input id="${fid}" type="${x.type || 'text'}" value="${M.esc(x.value == null ? '' : x.value)}" ${attrs}>`;
    return `<div class="field ${x.full ? 'full' : ''}"><label for="${fid}">${x.label}${x.req ? ' <span class="req">*</span>' : ''}</label>${input}${x.help ? `<div class="help">${x.help}</div>` : ''}</div>`;
  }).join('')}</form>`;
  U.readForm = (id = 'f') => {
    const out = {};
    document.querySelectorAll(`#${id} [data-f]`).forEach(el => {
      const k = el.dataset.f;
      if (el.type === 'checkbox') out[k] = el.checked;
      else if (el.type === 'number') out[k] = el.value === '' ? null : Number(el.value);
      else out[k] = el.value.trim() === '' ? null : el.value.trim();
    });
    return out;
  };
  /* open a modal form and run an action on submit */
  U.formModal = (title, fields, action, opts = {}) => {
    if (!U.guard()) return;
    U.modal(title, (opts.intro || '') + U.formHtml(fields, 'mf') + (opts.extra || ''), `<button class="btn secondary" data-act="close-overlay">${tt('إلغاء', 'Cancel')}</button><button class="btn ${opts.danger ? 'danger' : ''}" data-act="mf-submit">${opts.submit || tt('حفظ', 'Save')}</button>`);
    U._mf = { action, opts };
    const f = document.getElementById('mf'); if (f) f.addEventListener('submit', e => { e.preventDefault(); U.acts['mf-submit'](); });
    if (opts.mount) opts.mount();
  };
  U.act('mf-submit', async () => {
    const { action, opts } = U._mf || {}; if (!action) return;
    let payload = U.readForm('mf');
    const missing = [...document.querySelectorAll('#mf [required]')].filter(el => el.type !== 'checkbox' && !el.value.trim());
    if (missing.length) { clearFieldErrors(); missing.forEach(el => { const f = el.closest('.field'); f.classList.add('err'); f.insertAdjacentHTML('beforeend', `<div class="msg">${tt('هذا الحقل مطلوب', 'This field is required')}</div>`); }); missing[0].focus(); return; }
    if (opts.map) { try { payload = opts.map(payload); } catch (e) { U.showError(e); return; } if (!payload) return; }
    if (typeof action === 'function') return action(payload);
    await U.run(action, payload, { ok: opts.ok || tt('تم الحفظ', 'Saved'), after: opts.after });
  });

  /* confirmation with optional reason */
  U.confirm = (title, text, onOk, opts = {}) => {
    U.modal(title, `<p>${text}</p>${opts.reason ? U.formHtml([{ f: 'reason', label: tt('السبب', 'Reason'), type: 'textarea', req: true, full: true }], 'cf') : ''}`, `<button class="btn secondary" data-act="close-overlay">${tt('رجوع', 'Back')}</button><button class="btn ${opts.danger ? 'danger' : ''}" data-act="cf-ok">${opts.ok || tt('تأكيد', 'Confirm')}</button>`);
    U._cf = onOk;
  };
  U.act('cf-ok', () => {
    const r = document.querySelector('#cf [data-f="reason"]');
    if (r && !r.value.trim()) { const f = r.closest('.field'); f.classList.add('err'); if (!f.querySelector('.msg')) f.insertAdjacentHTML('beforeend', `<div class="msg">${tt('اكتب السبب', 'Enter the reason')}</div>`); return; }
    U._cf && U._cf(r ? r.value.trim() : null);
  });

  /* show a one-time secret (temporary password, API key, webhook secret) */
  U.secret = (title, rows, note) => U.modal(title, `<div class="form-error info" role="status">${U.icon('lock')}<div>${note || tt('انسخ القيمة الآن — لن تظهر مرة أخرى.', 'Copy this now — it will not be shown again.')}</div></div>${rows.map(([k, v]) => `<div class="field full"><label>${k}</label><div class="secret-row"><code class="mono" id="sec-${M.esc(k).replace(/\W/g, '')}">${M.esc(v)}</code><button class="btn secondary sm" data-act="copy-text" data-v="${M.esc(v)}">${U.icon('copy')}${tt('نسخ', 'Copy')}</button></div></div>`).join('')}`, `<button class="btn" data-act="close-overlay">${tt('تم', 'Done')}</button>`);
  U.act('copy-text', async el => { try { await navigator.clipboard.writeText(el.dataset.v); U.toast(tt('تم النسخ', 'Copied')); } catch (e) { U.toast(tt('انسخ النص يدوياً', 'Copy the text manually')); } });

  /* ---------- export: CSV, Excel (.xlsx), PDF (print) ---------- */
  const strip = s => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  U.tableData = id => {
    const st = U.tables[id]; const cfg = st.cfg; const rows = U.tableRows(id);
    const cols = cfg.columns.filter(c => strip(c.label));
    return { head: cols.map(c => strip(c.label)), rows: rows.map(r => cols.map(c => { const v = c.text ? c.text(r) : c.value ? c.value(r) : c.render ? c.render(r) : r[c.key]; return typeof v === 'number' ? v : strip(c.render && !c.num && typeof v !== 'number' ? c.render(r) : v); })) };
  };
  const saveBlob = (blob, name) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  const fname = ext => `${(document.querySelector('.page-head h1') || {}).textContent || 'motus'}-${M.TODAY}.${ext}`.replace(/[\\/:*?"<>|]+/g, '_');
  U.exportTable = (id, fmt) => {
    const d = U.tableData(id);
    if (fmt === 'csv') {
      const q = s => { s = String(s); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      saveBlob(new Blob(['﻿' + [d.head, ...d.rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), fname('csv'));
    } else if (fmt === 'xlsx') saveBlob(U.xlsx(d.head, d.rows, (document.querySelector('.page-head h1') || {}).textContent || 'Sheet1'), fname('xlsx'));
    else U.printTable(d);
  };
  U.printTable = d => {
    const title = (document.querySelector('.page-head h1') || {}).textContent || 'MOTUS';
    const w = window.open('', '_blank'); if (!w) { U.toast(tt('اسمح بالنوافذ المنبثقة للطباعة', 'Allow pop-ups to print')); return; }
    const css = `body{font-family:${M.lang === 'ar' ? 'Cairo' : 'Inter'},sans-serif;color:#08264A;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #DCE2EA;padding:4px 6px;text-align:start}th{background:#F4F6F9}.m{color:#64748B;font-size:11px}`;
    w.document.write(`<!doctype html><html lang="${M.lang}" dir="${M.lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${M.esc(title)}</title><style>${css}</style></head><body><h1>${M.esc(title)}</h1><div class="m">${M.esc(M.L(U.company().name))} · ${M.date(M.TODAY)}</div><table><thead><tr>${d.head.map(h => `<th>${M.esc(h)}</th>`).join('')}</tr></thead><tbody>${d.rows.map(r => `<tr>${r.map(c => `<td>${M.esc(typeof c === 'number' ? M.n2(c).replace(/\.00$/, '') : c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  /* minimal XLSX writer (Office Open XML, stored zip) — no external library */
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    files.forEach(([name, text]) => {
      const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nb.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nb);
      offset += 30 + nb.length + data.length;
    });
    const csize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  U.xlsx = (head, rows, sheetName) => {
    const cell = (v, r, c) => typeof v === 'number' && isFinite(v) ? `<c r="${colName(c)}${r}"><v>${v}</v></c>` : `<c r="${colName(c)}${r}" t="inlineStr"${r === 1 ? ' s="1"' : ''}><is><t xml:space="preserve">${x(v == null ? '' : v)}</t></is></c>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${M.lang === 'ar' ? '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>' : ''}<sheetData>${[head, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i + 1, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
    const name = x(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>'],
      ['xl/worksheets/sheet1.xml', sheet],
    ]);
  };
  U.zipFiles = zip;

  /* ---------- CSV parsing for imports (handles quotes, BOM, ; or , separators) ---------- */
  U.parseCsv = text => {
    text = text.replace(/^﻿/, '');
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const clean = rows.filter(r => r.some(c => c.trim() !== ''));
    if (!clean.length) return [];
    const head = clean[0].map(h => h.trim());
    return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  };
  U.readFile = (input, asText = true) => new Promise((resolve, reject) => {
    const f = input.files && input.files[0]; if (!f) { resolve(null); return; }
    const r = new FileReader(); r.onerror = () => reject(r.error);
    r.onload = () => resolve(asText ? { name: f.name, text: r.result, size: f.size, type: f.type } : { name: f.name, data: String(r.result).split(',')[1], size: f.size, type: f.type });
    if (asText) r.readAsText(f, 'utf-8'); else r.readAsDataURL(f);
  });

  /* ---------- account: sign in, change password, sign out, switch company ---------- */
  U.switchCompany = async id => {
    try { await A.post('/api/session/company', { companyId: id }); await A.loadSession(); U.applySession(); await A.loadSnapshot(); U.toast(tt('تم التبديل إلى ', 'Switched to ') + M.L(U.company().name)); location.hash = M.state.role === 'driver' ? 'mytrips' : 'dashboard'; U.full(); }
    catch (e) { U.showError(e); }
  };
  U.applySession = () => {
    const s = A.session;
    M.state.user = s.user; M.state.role = s.user.role; M.state.companyId = s.company ? s.company.id : null;
    M.companies = s.companies || (s.company ? [s.company] : []);
  };
  U.act('user-menu', () => {
    const u = M.state.user || {};
    U.sheet(M.esc(M.L(u.name) || u.email), U.dl([[tt('الدخول بـ', 'Signs in with'), `<span class="ltr">${M.esc([u.email, u.phone].filter(Boolean).join(' · '))}</span>`], [tt('الدور', 'Role'), U.roles[u.role] ? tt(...U.roles[u.role]) : u.role], [tt('الشركة', 'Company'), M.esc(M.L(U.company().name))], M.companies.length > 1 && u.member ? [tt('شركاتك على سبيل', 'Your companies on Sabeel'), M.companies.map(c => `${M.esc(M.L(c.name))} <span class="muted small">(${U.roles[c.role] ? tt(...U.roles[c.role]) : c.role})</span>`).join('<br>')] : null]) +
      `<div class="actions" style="margin-top:16px;flex-wrap:wrap">${u.role === 'super_admin' ? `<a class="btn secondary" href="#platform" data-act="close-overlay">${U.icon('building')}${tt('إدارة الشركات', 'Manage companies')}</a>` : ''}<button class="btn secondary" data-act="change-password">${U.icon('key')}${tt('تغيير كلمة المرور', 'Change password')}</button><button class="btn danger" data-act="logout">${tt('تسجيل الخروج', 'Sign out')}</button></div>`, tt('حسابي', 'My account'));
  });
  U.act('logout', async () => { try { await A.post('/api/logout'); } catch (e) { } location.hash = ''; location.reload(); });
  U.act('change-password', () => { U.closeOverlays(); U.passwordScreen(false); });

  const authShell = (inner) => {
    document.documentElement.lang = M.lang; document.documentElement.dir = M.lang === 'ar' ? 'rtl' : 'ltr';
    let root = document.getElementById('app-root'); if (!root) { root = document.createElement('div'); root.id = 'app-root'; document.body.appendChild(root); }
    root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-brand">${U.logo('#08264A')}<div class="brand-tag dark">Fleet &amp; Mobility Management</div></div>${inner}<div class="auth-foot"><div class="lang-switch light" role="group" aria-label="Language"><button data-lang="ar" class="${M.lang === 'ar' ? 'on' : ''}">عربي</button><button data-lang="en" class="${M.lang === 'en' ? 'on' : ''}">English</button></div></div></div></div>`;
  };
  U.loginScreen = (msg) => {
    U.full = () => U.loginScreen();
    authShell(`<h1>${tt('تسجيل الدخول', 'Sign in')}</h1>${msg ? `<div class="form-error" role="alert">${U.icon('alert')}<div>${M.esc(msg)}</div></div>` : ''}<form id="login-form" class="form one" novalidate>
      <div class="field full"><label for="lg-email">${tt('البريد الإلكتروني أو رقم الموبايل', 'Email or mobile number')}</label><input id="lg-email" name="email" type="text" inputmode="email" autocomplete="username" required dir="ltr"></div>
      <div class="field full"><label for="lg-pass">${tt('كلمة المرور', 'Password')}</label><input id="lg-pass" type="password" autocomplete="current-password" required dir="ltr"></div>
      <div class="field full"><button class="btn block" type="submit" id="lg-btn">${tt('دخول', 'Sign in')}</button></div></form>
      <p class="muted small">${tt('نسيت كلمة المرور؟ اطلب من مدير النظام في شركتك إعادة تعيينها.', 'Forgot your password? Ask your company admin to reset it.')}</p>`);
    const f = document.getElementById('login-form');
    setTimeout(() => document.getElementById('lg-email').focus(), 0);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = document.getElementById('lg-btn'); btn.disabled = true;
      try { await A.post('/api/login', { login: document.getElementById('lg-email').value, password: document.getElementById('lg-pass').value }); location.reload(); }
      catch (err) { btn.disabled = false; U.loginScreen(err.msg ? tt(err.msg.ar, err.msg.en) : String(err.message)); }
    });
  };
  U.passwordScreen = (forced, msg) => {
    const prev = U.full;
    if (forced) U.full = () => U.passwordScreen(true);
    const inner = `<h1>${forced ? tt('غيّر كلمة المرور المؤقتة', 'Change your temporary password') : tt('تغيير كلمة المرور', 'Change password')}</h1>${msg ? `<div class="form-error" role="alert">${U.icon('alert')}<div>${M.esc(msg)}</div></div>` : ''}<form id="pw-form" class="form one" novalidate>
      <div class="field full"><label for="pw-cur">${tt('كلمة المرور الحالية', 'Current password')}</label><input id="pw-cur" type="password" autocomplete="current-password" required dir="ltr"></div>
      <div class="field full"><label for="pw-new">${tt('كلمة المرور الجديدة', 'New password')}</label><input id="pw-new" type="password" autocomplete="new-password" required dir="ltr"><div class="help">${tt('10 أحرف على الأقل، و3 أنواع من: حروف صغيرة، كبيرة، أرقام، رموز.', 'At least 10 characters with 3 of: lowercase, uppercase, digits, symbols.')}</div></div>
      <div class="field full"><label for="pw-new2">${tt('تأكيد كلمة المرور الجديدة', 'Confirm new password')}</label><input id="pw-new2" type="password" autocomplete="new-password" required dir="ltr"></div>
      <div class="field full"><button class="btn block" type="submit" id="pw-btn">${tt('حفظ كلمة المرور', 'Save password')}</button></div>${forced ? `<div class="field full"><button class="btn ghost block" type="button" data-act="logout">${tt('تسجيل الخروج', 'Sign out')}</button></div>` : `<div class="field full"><button class="btn ghost block" type="button" id="pw-cancel">${tt('رجوع', 'Back')}</button></div>`}</form>`;
    authShell(inner);
    const c = document.getElementById('pw-cancel'); if (c) c.addEventListener('click', () => { U.full = prev; U.full(); });
    document.getElementById('pw-form').addEventListener('submit', async e => {
      e.preventDefault();
      const n1 = document.getElementById('pw-new').value, n2 = document.getElementById('pw-new2').value;
      if (n1 !== n2) { U.passwordScreen(forced, tt('كلمتا المرور غير متطابقتين', 'The new passwords do not match')); return; }
      try { await A.post('/api/password', { currentPassword: document.getElementById('pw-cur').value, newPassword: n1 }); U.toast(tt('تم تغيير كلمة المرور', 'Password changed')); location.reload(); }
      catch (err) { U.passwordScreen(forced, err.msg ? tt(err.msg.ar, err.msg.en) : String(err.message)); }
    });
  };
})();
