/* boot: session → (sign in | change password | load company snapshot) → render */
'use strict';
(function () {
  const U = M.ui, A = M.api, tt = M.tt;
  U.bind();
  A.onSignedOut = () => U.loginScreen(tt('انتهت الجلسة. سجّل الدخول مرة أخرى.', 'Your session has ended. Please sign in again.'));
  A.onMustChange = () => U.passwordScreen(true);
  const fail = e => {
    let root = document.getElementById('app-root'); if (!root) { root = document.createElement('div'); root.id = 'app-root'; document.body.appendChild(root); }
    root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-brand">${U.logo('#08264A')}</div>${U.empty('alert', tt('تعذر تحميل النظام', 'MOTUS could not load'), M.esc(e && e.msg ? tt(e.msg.ar, e.msg.en) : String(e && e.message || e)))}<button class="btn block" id="retry">${tt('إعادة المحاولة', 'Try again')}</button></div></div>`;
    document.getElementById('retry').addEventListener('click', () => location.reload());
  };
  (async () => {
    try {
      const s = await A.loadSession();
      if (!s.user) { U.loginScreen(); return; }
      let stored = null; try { stored = localStorage.getItem('motus.lang'); } catch (e) { }
      if (!stored && s.user.lang) M.lang = s.user.lang;
      if (s.user.mustChangePassword) { U.passwordScreen(true); return; }
      U.applySession();
      if (!M.state.companyId) { U.platformOnly(); return; }
      await A.loadSnapshot();
      U.full();
      setInterval(async () => {
        if (document.visibilityState !== 'visible' || document.getElementById('overlay') || U.busy) return;
        const a = document.activeElement; if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
        if (await A.changed()) { const y = window.scrollY; await A.loadSnapshot(); U.renderShell(); U.render(); window.scrollTo(0, y); }
      }, 45000);
    } catch (e) { if (e && e.status === 401) U.loginScreen(); else fail(e); }
  })();
})();
