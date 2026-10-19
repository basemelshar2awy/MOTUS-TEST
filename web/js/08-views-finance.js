/* Finance: clients, invoices, payments, expenses, journal entries. */
'use strict';
(function () {
  const U = M.ui, C = M.calc, tt = M.tt;
  const ctype = { agency: ['وكالة سياحة', 'Travel agency'], hotel: ['فندق', 'Hotel'], company: ['شركة', 'Company'], individual: ['فرد', 'Individual'] };
  U.invStatus = (cid, inv) => { const bal = C.invoiceBalance(cid, inv); if (inv.status === 'draft' || inv.status === 'cancelled') return inv.status; if (bal <= 1) return 'paid'; if (M.diffDays(M.TODAY, inv.dueDate) > 0) return inv.paid > 0 ? 'partial' : 'overdue'; return inv.paid > 0 ? 'partial' : 'issued'; };

  /* ================= CLIENTS ================= */
  U.route('clients', () => {
    const cid = U.cid(), db = U.db();
    const rows = db.clients.map(c => ({ c, s: C.clientStats(cid, c.id) }));
    const ag = C.aging(cid);
    return U.head(tt('العملاء', 'Clients'), tt('كشف حساب لكل عميل ومستحقات وأعمار ديون.', 'Statements, balances and receivables aging for each client.'), `${U.btn(tt('عميل جديد', 'New client'), 'client-new', '', 'plus')}${U.btn(tt('استيراد', 'Import'), 'import-csv', 'secondary', 'upload', 'data-e="clients"')}`) +
      U.kpis([U.kpi(tt('إجمالي المستحقات', 'Total receivables'), M.moneyK(ag.total)), U.kpi(tt('0–30 يوم', '0–30 days'), M.moneyK(ag.b0)), U.kpi(tt('31–60 يوم', '31–60 days'), M.moneyK(ag.b30)), U.kpi(tt('61–90 يوم', '61–90 days'), M.moneyK(ag.b60)), U.kpi(tt('أكثر من 90 يوم', 'Over 90 days'), `<span class="${ag.b90 ? 'delta-down' : ''}">${M.moneyK(ag.b90)}</span>`)]) +
      U.card(null, U.table({ id: 'clients', rows, columns: [
        { label: tt('العميل', 'Client'), value: r => M.L(r.c.name), render: r => `<a class="cell-main" href="#client.${r.c.id}">${M.esc(M.L(r.c.name))}</a><div class="cell-sub">${M.esc(r.c.code)} · ${tt(...ctype[r.c.type])}${r.c.status === 'inactive' ? ' · ' + tt('غير نشط', 'inactive') : ''}</div>` },
        { label: tt('شروط الدفع', 'Terms'), num: 1, value: r => r.c.terms, render: r => r.c.terms ? `${r.c.terms} ${tt('يوم', 'days')}` : tt('نقدي', 'Cash') },
        { label: tt('الرحلات', 'Trips'), num: 1, value: r => r.s.trips, render: r => M.n0(r.s.trips) },
        { label: tt('الإيراد', 'Revenue'), num: 1, value: r => r.s.revenue, render: r => M.money(r.s.revenue) },
        { label: tt('الربح', 'Profit'), num: 1, value: r => r.s.profit, render: r => U.money(r.s.profit) },
        { label: tt('الرصيد', 'Balance'), num: 1, value: r => r.s.balance, render: r => M.money(r.s.balance) },
        { label: tt('متأخر', 'Overdue'), num: 1, value: r => r.s.overdue, render: r => r.s.overdue ? `<span class="neg num">${M.money(r.s.overdue)}</span>` : '—' },
        { label: tt('حد الائتمان', 'Credit limit'), num: 1, value: r => r.c.creditLimit, render: r => r.c.creditLimit ? M.money(r.c.creditLimit) + (r.s.balance > r.c.creditLimit ? ' ' + U.badge(tt('تجاوز', 'Over'), 'danger') : '') : '—' },
        { label: 'ERP', value: r => r.c.externalRef || '', render: r => r.c.externalRef ? `<code>${r.c.externalRef}</code>` : '—' },
      ], filters: [{ label: tt('النوع', 'Type'), get: r => r.c.type, options: Object.entries(ctype).map(([k, v]) => [k, tt(...v)]) }], onRow: r => 'client.' + r.c.id }), { flush: true });
  });

  let cTab = 'statement';
  U.act('ctab', el => { cTab = el.dataset.t; U.render(); });
  U.route('client', id => {
    const cid = U.cid(), db = U.db(); const c = db.clients.find(x => x.id === id);
    if (!c) return U.empty('users', tt('العميل غير موجود في هذه الشركة', 'Client not found in this company'));
    const s = C.clientStats(cid, c.id); const ag = C.aging(cid).byClient[c.id] || { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 };
    const invs = db.invoices.filter(i => i.clientId === c.id), pays = db.payments.filter(p => p.clientId === c.id), cns = db.creditNotes.filter(x => x.clientId === c.id);
    const tabs = [['statement', tt('كشف الحساب', 'Statement')], ['invoices', tt('الفواتير', 'Invoices')], ['bookings', tt('الحجوزات', 'Bookings')], ['info', tt('البيانات', 'Details')]];
    let body = '';
    if (cTab === 'statement') {
      const lines = [...invs.map(i => ({ date: i.issueDate, doc: `<a href="#invoice.${i.id}">${i.number}</a>`, desc: tt('فاتورة', 'Invoice'), dr: i.total, cr: 0 })), ...pays.map(p => ({ date: p.date, doc: p.number, desc: tt('تحصيل', 'Receipt') + ' · ' + U.payMethod(p.method), dr: 0, cr: p.amount })), ...invs.filter(i => i.status === 'cancelled').map(i => ({ date: i.issueDate, doc: i.number, desc: tt('إلغاء فاتورة', 'Invoice cancelled'), dr: 0, cr: i.total })), ...cns.map(x => ({ date: x.date, doc: x.number, desc: tt('إشعار دائن', 'Credit note'), dr: 0, cr: x.total }))].sort((a, b) => a.date < b.date ? -1 : 1);
      let bal = 0; lines.forEach(l => { bal += l.dr - l.cr; l.bal = bal; });
      body = U.card(tt('كشف حساب برصيد متحرك', 'Statement with running balance'), U.table({ id: 'stmt', rows: lines.reverse(), sort: null, columns: [{ label: tt('التاريخ', 'Date'), value: l => l.date, render: l => M.date(l.date) }, { label: tt('المستند', 'Document'), value: l => l.doc.replace(/<[^>]+>/g, ''), render: l => l.doc }, { label: tt('البيان', 'Description'), value: l => l.desc, render: l => l.desc }, { label: tt('مدين', 'Debit'), num: 1, value: l => l.dr, render: l => l.dr ? M.n0(l.dr) : '' }, { label: tt('دائن', 'Credit'), num: 1, value: l => l.cr, render: l => l.cr ? M.n0(l.cr) : '' }, { label: tt('الرصيد', 'Balance'), num: 1, value: l => l.bal, render: l => `<b>${M.n0(l.bal)}</b>` }] }), { flush: true }) + '<div style="height:16px"></div>' +
        U.card(tt('أعمار الديون', 'Receivables aging'), U.chart('ch-aging', { type: 'bar', size: 'short', label: 'aging', data: { labels: [tt('0–30', '0–30'), tt('31–60', '31–60'), tt('61–90', '61–90'), tt('+90', '90+')], datasets: [{ label: tt('المبلغ', 'Amount'), data: [ag.b0, ag.b30, ag.b60, ag.b90].map(Math.round), colors: ['#08264A', '#5A7493', '#B45309', '#B91C1C'] }] } }));
    } else if (cTab === 'invoices') body = U.card(null, U.invoiceTable('cinv', invs), { flush: true });
    else if (cTab === 'bookings') body = U.card(null, U.table({ id: 'cbk', rows: db.bookings.filter(b => b.clientId === c.id).sort((a, b) => a.date < b.date ? 1 : -1), columns: [{ label: tt('الحجز', 'Booking'), value: b => b.number, render: b => `<a href="#booking.${b.id}">${b.number}</a>` }, { label: tt('التاريخ', 'Date'), value: b => b.date, render: b => M.date(b.date) }, { label: tt('المسار', 'Route'), value: b => U.routeTxt(b.pickup, b.destination) }, { label: tt('السعر', 'Price'), num: 1, value: b => b.price, render: b => M.money(b.price) }, { label: tt('الحالة', 'Status'), value: b => b.status, render: b => U.status(b.status) }], onRow: b => 'booking.' + b.id }), { flush: true });
    else body = U.card(tt('البيانات', 'Details'), U.dl([[tt('النوع', 'Type'), tt(...ctype[c.type])], [tt('الرقم الضريبي', 'Tax ID'), c.taxNo || '—'], [tt('السجل التجاري', 'Commercial register'), c.crNo || '—'], [tt('مسؤول التواصل', 'Contact'), M.esc(M.L(c.contact))], [tt('الهاتف', 'Phone'), `<span class="ltr">${M.esc(c.phone)}</span>`], [tt('البريد', 'Email'), `<span class="ltr">${M.esc(c.email)}</span>`], [tt('العنوان', 'Address'), M.esc(M.L(c.address))], [tt('شروط الدفع', 'Payment terms'), `${c.terms} ${tt('يوم', 'days')}`], [tt('حد الائتمان', 'Credit limit'), M.money(c.creditLimit)], [tt('العملة', 'Currency'), c.currency], [tt('كود ERP', 'ERP code'), c.externalRef ? `<code>${c.externalRef}</code> ${U.status(c.syncStatus)}` : '—']]));
    const canFin = ['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role);
    return U.head(M.esc(M.L(c.name)), `${M.esc(c.code)} · ${tt(...ctype[c.type])}`, `${U.btn(tt('تعديل', 'Edit'), 'client-edit', 'secondary', 'settings', `data-id="${c.id}"`)}${canFin ? U.btn(tt('فاتورة جديدة', 'New invoice'), 'new-invoice', 'secondary', 'file', `data-client="${c.id}"`) + U.btn(tt('تسجيل تحصيل', 'Record payment'), 'pay-new', '', 'wallet', `data-client="${c.id}"`) : ''}`, [[tt('العملاء', 'Clients'), 'clients'], [M.esc(M.L(c.name))]]) +
      U.kpis([U.kpi(tt('الإيراد', 'Revenue'), M.moneyK(s.revenue)), U.kpi(tt('ربح العميل', 'Client profit'), U.money(s.profit), `${tt('هامش', 'Margin')} ${M.pct(s.margin)} ${U.est()}`), U.kpi(tt('الرصيد المستحق', 'Balance due'), M.moneyK(s.balance)), U.kpi(tt('متأخر', 'Overdue'), `<span class="${s.overdue ? 'delta-down' : ''}">${M.moneyK(s.overdue)}</span>`), U.kpi(tt('نسبة الإلغاء', 'Cancellation rate'), M.pct(s.cancelRate))]) +
      `<div class="tabs">${tabs.map(t => `<button class="${cTab === t[0] ? 'on' : ''}" data-act="ctab" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>` + body;
  });
  U.payMethod = m => ({ transfer: tt('تحويل بنكي', 'Bank transfer'), cheque: tt('شيك', 'Cheque'), cash: tt('نقدي', 'Cash'), card: tt('بطاقة', 'Card') }[m] || m);

  /* ================= INVOICES ================= */
  U.invoiceTable = (id, rows) => {
    const cid = U.cid();
    return U.table({ id, rows: rows.slice().sort((a, b) => a.issueDate < b.issueDate ? 1 : -1), columns: [
      { label: tt('الفاتورة', 'Invoice'), value: i => i.number, render: i => `<a class="cell-main" href="#invoice.${i.id}">${i.number}</a><div class="cell-sub">${({ program: tt('برنامج', 'Program'), trips: tt('رحلات', 'Trips'), booking: tt('حجز', 'Booking'), manual: tt('يدوية', 'Manual') })[i.source] || i.source}${i.currency !== 'EGP' ? ' · ' + i.currency : ''}</div>` },
      { label: tt('العميل', 'Client'), value: i => M.L(U.find('clients', i.clientId).name) },
      { label: tt('التاريخ', 'Date'), value: i => i.issueDate, render: i => M.date(i.issueDate) },
      { label: tt('الاستحقاق', 'Due'), value: i => i.dueDate, render: i => M.date(i.dueDate) },
      { label: tt('الإجمالي', 'Total'), num: 1, value: i => i.total, render: i => M.money(i.total) },
      { label: tt('المتبقي', 'Balance'), num: 1, value: i => C.invoiceBalance(cid, i), render: i => M.money(C.invoiceBalance(cid, i)) },
      { label: tt('الحالة', 'Status'), value: i => U.invStatus(cid, i), render: i => U.status(U.invStatus(cid, i)) },
      { label: tt('الفاتورة الإلكترونية', 'E-invoice'), value: i => i.eInvoice.status, render: i => U.status(i.eInvoice.status) },
      { label: 'ERP', value: i => i.syncStatus, render: i => U.status(i.syncStatus) },
    ], filters: [{ label: tt('الحالة', 'Status'), get: i => U.invStatus(cid, i), options: ['issued', 'partial', 'paid', 'overdue', 'cancelled'].map(k => [k, U.statusText(k)]) }, { label: 'ERP', get: i => i.syncStatus, options: ['synced', 'failed', 'not_synced'].map(k => [k, U.statusText(k)]) }], onRow: i => 'invoice.' + i.id });
  };
  U.route('invoices', () => {
    const cid = U.cid(), db = U.db();
    const uninv = db.trips.filter(t => t.status === 'completed' && !t.invoiced);
    return U.head(tt('الفواتير', 'Invoices'), tt('فاتورة من حجز أو برنامج كامل أو مجموعة رحلات مكتملة لعميل. الرحلة لا تُفوتر مرتين.', 'Invoice a booking, a full program, or completed trips for one client. A trip can’t be invoiced twice.'), (['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role) ? `${U.btn(tt('فاتورة من رحلات مكتملة', 'Invoice completed trips'), 'new-invoice', '', 'plus')}${U.btn(tt('فاتورة يدوية', 'Manual invoice'), 'inv-manual', 'secondary', 'file')}` : '')) +
      U.kpis([U.kpi(tt('فواتير صادرة', 'Issued invoices'), db.invoices.filter(i => i.status !== 'cancelled').length), U.kpi(tt('إجمالي الفواتير', 'Invoiced total'), M.moneyK(M.sum(db.invoices.filter(i => i.status !== 'cancelled'), i => i.total * (i.rate || 1)))), U.kpi(tt('المتبقي للتحصيل', 'Outstanding'), M.moneyK(C.aging(cid).total)), U.kpi(tt('رحلات غير مفوترة', 'Un-invoiced trips'), uninv.length, M.moneyK(M.sum(uninv, t => t.revenue))), U.kpi(tt('إشعارات دائنة', 'Credit notes'), db.creditNotes.length)]) +
      U.card(null, U.invoiceTable('invoices', db.invoices), { flush: true });
  });
  U.act('new-invoice', (el) => {
    if (!U.guard()) return;
    const db = U.db(); const groups = M.groupBy(db.trips.filter(t => t.status === 'completed' && !t.invoiced && !t.programId), t => t.clientId);
    const pre = el && el.dataset && el.dataset.client;
    const opts = [...groups.keys()].map(k => [k, `${M.L(U.find('clients', k).name)} — ${groups.get(k).length} ${tt('رحلة', 'trips')}`]);
    if (!opts.length) { U.toast(tt('لا توجد رحلات مكتملة غير مفوترة (رحلات البرامج تُفوتر من صفحة البرنامج)', 'No completed un-invoiced trips (program trips are invoiced from the program page)')); return; }
    U.modal(tt('فاتورة جديدة من الرحلات المكتملة', 'New invoice from completed trips'), `<div class="form">${U.field('ni-client', tt('العميل', 'Client'), U.select('ni-client', opts, pre && groups.has(pre) ? pre : opts[0][0]), { full: true })}${U.field('ni-date', tt('تاريخ الإصدار', 'Issue date'), U.input('ni-date', M.TODAY, 'date'))}${U.field('ni-disc', tt('خصم (مبلغ)', 'Discount (amount)'), U.input('ni-disc', '0', 'number', 'min="0"'))}</div><div id="ni-lines" style="margin-top:12px"></div>`, `<button class="btn secondary" data-act="close-overlay">${tt('إلغاء', 'Cancel')}</button><button class="btn" data-act="issue-invoice">${tt('إصدار الفاتورة', 'Issue invoice')}</button>`);
    const upd = () => { const ts = (groups.get(U.val('ni-client')) || []).slice().sort((x, y) => x.date < y.date ? -1 : 1); const vat = U.db().settings.vatRate; document.getElementById('ni-lines').innerHTML = ts.map(t => `<label class="list-row"><input type="checkbox" class="ni-t" value="${t.id}" data-r="${t.revenue}" checked style="accent-color:#08264A"><div class="grow"><div class="t">${t.number} · ${M.date(t.date)}</div><div class="s">${U.routeTxt(t.from, t.to)}</div></div><b class="num">${M.money(t.revenue)}</b></label>`).join('') + `<div class="dl" id="ni-tot" style="margin-top:10px"></div>`; const tot = () => { const sub = M.sum([...document.querySelectorAll('.ni-t:checked')], x => +x.dataset.r); const disc = +U.val('ni-disc') || 0; document.getElementById('ni-tot').innerHTML = `<dt>${tt('الإجمالي قبل الضريبة', 'Subtotal')}</dt><dd class="num">${M.money(sub)}</dd><dt>${tt('خصم', 'Discount')}</dt><dd class="num">${M.money(disc)}</dd><dt>${tt('ضريبة القيمة المضافة', 'VAT')} ${M.pct(vat, 0)}</dt><dd class="num">${M.money((sub - disc) * vat)}</dd><dt>${tt('الإجمالي', 'Total')}</dt><dd class="num"><b>${M.money((sub - disc) * (1 + vat))}</b></dd>`; }; document.querySelectorAll('.ni-t').forEach(x => x.addEventListener('change', tot)); document.getElementById('ni-disc').addEventListener('input', tot); tot(); };
    document.getElementById('ni-client').addEventListener('change', upd); upd();
  });
  U.act('issue-invoice', () => {
    const ids = [...document.querySelectorAll('.ni-t:checked')].map(x => x.value);
    if (!ids.length) { U.toast(tt('اختر رحلة واحدة على الأقل', 'Pick at least one trip'), 'error'); return; }
    U.run('invoice.fromTrips', { clientId: U.val('ni-client'), tripIds: ids, issueDate: U.val('ni-date'), discount: +U.val('ni-disc') || 0 }, { ok: r => tt(`تم إصدار ${r.number} وإنشاء القيد`, `${r.number} issued and journal entry created`), after: r => { location.hash = 'invoice.' + r.id; U.full(); } });
  });
  U.act('inv-program', el => U.formModal(tt('فاتورة البرنامج', 'Invoice program'), [{ f: 'issueDate', label: tt('تاريخ الإصدار', 'Issue date'), type: 'date', value: M.TODAY }, { f: 'discount', label: tt('خصم (مبلغ)', 'Discount (amount)'), type: 'number', value: 0, attrs: 'min="0"' }], 'invoice.fromProgram', { map: d => Object.assign(d, { programId: el.dataset.id }), ok: r => tt('تم إصدار ', 'Issued ') + r.number, after: r => { location.hash = 'invoice.' + r.id; U.full(); } }));
  U.act('inv-booking', el => U.formModal(tt('فاتورة الحجز', 'Invoice booking'), [{ f: 'issueDate', label: tt('تاريخ الإصدار', 'Issue date'), type: 'date', value: M.TODAY }, { f: 'discount', label: tt('خصم (مبلغ)', 'Discount (amount)'), type: 'number', value: 0, attrs: 'min="0"' }], 'invoice.fromBooking', { map: d => Object.assign(d, { bookingId: el.dataset.id }), ok: r => tt('تم إصدار ', 'Issued ') + r.number, after: r => { location.hash = 'invoice.' + r.id; U.full(); } }));
  U.act('inv-manual', () => {
    const db = U.db();
    U.formModal(tt('فاتورة يدوية', 'Manual invoice'), [
      { f: 'clientId', label: tt('العميل', 'Client'), type: 'select', options: db.clients.map(c => [c.id, M.L(c.name)]), req: true },
      { f: 'issueDate', label: tt('تاريخ الإصدار', 'Issue date'), type: 'date', value: M.TODAY },
      { f: 'd1', label: tt('البيان', 'Description'), req: true, full: true }, { f: 'q1', label: tt('الكمية', 'Qty'), type: 'number', value: 1, attrs: 'min="0.01" step="0.01"' }, { f: 'u1', label: tt('سعر الوحدة', 'Unit price'), type: 'number', req: true, attrs: 'min="0"' },
      { f: 'r1', label: tt('حساب الإيراد', 'Revenue account'), type: 'select', options: [['revenue_other', tt('إيرادات أخرى', 'Other revenue')], ['revenue_hire', tt('تأجير خاص', 'Private hire')], ['revenue_city', tt('جولات داخلية', 'City tours')], ['revenue_intercity', tt('بين المدن', 'Intercity')], ['revenue_airport', tt('استقبال مطار', 'Airport')], ['revenue_program', tt('برامج', 'Programs')]] },
      { f: 'd2', label: tt('بند 2 (اختياري)', 'Line 2 (optional)'), full: true }, { f: 'q2', label: tt('الكمية', 'Qty'), type: 'number', value: 1, attrs: 'min="0.01" step="0.01"' }, { f: 'u2', label: tt('سعر الوحدة', 'Unit price'), type: 'number', attrs: 'min="0"' },
      { f: 'discount', label: tt('خصم (مبلغ)', 'Discount (amount)'), type: 'number', value: 0, attrs: 'min="0"' },
      { f: 'taxRate', label: tt('نسبة الضريبة', 'VAT rate'), type: 'number', value: db.settings.vatRate, attrs: 'min="0" max="1" step="0.01"' },
    ], 'invoice.manual', { map: d => ({ clientId: d.clientId, issueDate: d.issueDate, discount: d.discount, taxRate: d.taxRate, lines: [[d.d1, d.q1, d.u1], [d.d2, d.q2, d.u2]].filter(x => x[0] && x[2] != null).map(x => ({ description: x[0], qty: x[1] || 1, unit: x[2], revenue: d.r1 })) }), ok: r => tt('تم إصدار ', 'Issued ') + r.number, after: r => { location.hash = 'invoice.' + r.id; U.full(); } });
  });
  U.act('cn-new', el => { const i = U.find('invoices', el.dataset.id); U.formModal(tt('إشعار دائن', 'Credit note'), [{ f: 'amount', label: tt('المبلغ قبل الضريبة', 'Amount before VAT'), type: 'number', req: true, attrs: 'min="0.01"' }, { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY }, { f: 'reason', label: tt('السبب', 'Reason'), req: true, full: true }], 'creditNote.create', { intro: `<p class="muted small">${tt('يُخصم من رصيد الفاتورة', 'Reduces the invoice balance')} ${i.number} · ${tt('المتبقي', 'open')} ${M.money(C.invoiceBalance(U.cid(), i))}</p>`, map: d => Object.assign(d, { invoiceId: i.id }), ok: r => tt('تم إصدار ', 'Issued ') + r.number }); });
  U.act('inv-cancel', el => U.confirm(tt('إلغاء الفاتورة', 'Cancel invoice'), tt('الرحلات ترجع "غير مفوترة" ويتم عمل قيد عكسي بتاريخ اليوم. لا يمكن إلغاء فاتورة عليها تحصيل.', 'The trips become un-invoiced again and a reversing entry is posted today. An invoice with payments cannot be cancelled.'), r => U.run('invoice.cancel', { id: el.dataset.id, reason: r }, { ok: tt('تم إلغاء الفاتورة', 'Invoice cancelled') }), { reason: true, danger: true }));
  U.act('inv-einv', el => { const i = U.find('invoices', el.dataset.id); U.formModal(tt('حالة الفاتورة الإلكترونية', 'E-invoice status'), [{ f: 'status', label: tt('الحالة', 'Status'), type: 'select', value: i.eInvoice.status, options: [['pending', U.statusText('pending')], ['submitted', U.statusText('submitted')], ['valid', U.statusText('valid')], ['rejected', U.statusText('rejected')]] }, { f: 'uuid', label: 'UUID', value: i.eInvoice.uuid, attrs: 'dir="ltr"' }], 'invoice.einvoice', { intro: `<p class="muted small">${tt('سجّل الحالة ورقم UUID بعد إرسال الفاتورة من منظومة الفاتورة الإلكترونية (ETA). الإرسال الآلي يحتاج بيانات اعتماد المنظومة.', 'Record the status and UUID after submitting the invoice through the e-invoicing system (ETA). Automatic submission needs ETA credentials.')}</p>`, map: d => Object.assign(d, { id: i.id }) }); });
  U.act('inv-print', () => { document.body.classList.add('print-doc'); window.print(); setTimeout(() => document.body.classList.remove('print-doc'), 500); });
  U.route('invoice', id => {
    const cid = U.cid(), db = U.db(); const i = db.invoices.find(x => x.id === id);
    if (!i) return U.empty('file', tt('الفاتورة غير موجودة في هذه الشركة', 'Invoice not found in this company'));
    const cl = U.find('clients', i.clientId); const comp = U.company();
    const pays = db.payments.filter(p => p.allocations.some(a => a.invoiceId === i.id)); const cns = db.creditNotes.filter(c => c.invoiceId === i.id);
    const je = db.journal.find(j => j.sourceType === 'invoice' && j.sourceRef === i.number);
    const st = U.invStatus(cid, i);
    const canFin = ['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role), canAcc = ['super_admin', 'company_admin', 'accountant'].includes(M.state.role);
    const live = i.status !== 'cancelled';
    const acts = `${U.status(st)} ${canFin && live && st !== 'paid' ? U.btn(tt('تسجيل تحصيل', 'Record payment'), 'pay-invoice', '', 'wallet', `data-id="${i.id}"`) : ''} ${canAcc && live && C.invoiceBalance(cid, i) > 0 ? U.btn(tt('إشعار دائن', 'Credit note'), 'cn-new', 'secondary', '', `data-id="${i.id}"`) : ''} ${canAcc && live ? U.btn(tt('الفاتورة الإلكترونية', 'E-invoice'), 'inv-einv', 'secondary', '', `data-id="${i.id}"`) : ''} ${U.btn(tt('طباعة / PDF', 'Print / PDF'), 'inv-print', 'secondary', 'download')} ${canAcc && live && !i.paid ? U.btn(tt('إلغاء', 'Cancel'), 'inv-cancel', 'ghost', '', `data-id="${i.id}"`) : ''}`;
    return U.head(i.number, `${M.esc(M.L(cl.name))} · ${M.date(i.issueDate)}`, acts, [[tt('الفواتير', 'Invoices'), 'invoices'], [i.number]]) +
      `<div class="cols-2-1"><div class="doc-sheet" id="invoice-doc" style="max-width:none">${i.status === 'cancelled' ? `<div class="form-error" role="status">${tt('فاتورة ملغاة', 'Cancelled invoice')}</div>` : ''}<div class="doc-head"><div>${U.logo('#08264A').replace('<svg', '<svg style="height:24px"')}<div class="small" style="margin-top:6px"><b>${M.esc(M.L(comp.name))}</b><br>${tt('رقم ضريبي', 'Tax ID')} <span class="mono">${M.esc(comp.taxNo || '—')}</span></div></div><div style="text-align:end"><b style="font-size:20px">${tt('فاتورة ضريبية', 'Tax invoice')}</b><div class="mono">${i.number}</div><div class="small">${tt('التاريخ', 'Date')} ${M.date(i.issueDate)} · ${tt('الاستحقاق', 'Due')} ${M.date(i.dueDate)}</div></div></div>
        <div class="small" style="margin-bottom:12px"><b>${tt('إلى', 'Bill to')}:</b> ${M.esc(M.L(cl.name))} · ${tt('رقم ضريبي', 'Tax ID')} <span class="mono">${M.esc(cl.taxNo || '—')}</span>${i.currency !== 'EGP' ? ` · ${tt('العملة', 'Currency')} ${i.currency} (${tt('سعر الصرف', 'rate')} ${i.rate})` : ''}</div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>${tt('البيان', 'Description')}</th><th>${tt('مرتبط بـ', 'Linked to')}</th><th class="n">${tt('الكمية', 'Qty')}</th><th class="n">${tt('السعر', 'Price')}</th><th class="n">${tt('الإجمالي', 'Total')}</th></tr></thead><tbody>${i.lines.map(l => `<tr><td>${M.esc(M.L(l.desc))}</td><td>${l.tripId ? `<a href="#trip.${l.tripId}">${M.esc(U.find('trips', l.tripId).number)}</a>` : l.programId ? `<a href="#program.${l.programId}">${M.esc(U.find('programs', l.programId).number)}</a>` : l.bookingId ? `<a href="#booking.${l.bookingId}">${M.esc(U.find('bookings', l.bookingId).number)}</a>` : '—'}</td><td class="n num">${l.qty}</td><td class="n num">${M.n0(l.unit)}</td><td class="n num">${M.n0(l.total)}</td></tr>`).join('')}</tbody></table></div>
        <div style="margin-inline-start:auto;max-width:320px;margin-top:12px">${U.dl([[tt('الإجمالي قبل الخصم', 'Subtotal'), M.money(i.subtotal)], [tt('خصم', 'Discount'), M.money(i.discount)], [`${tt('ضريبة القيمة المضافة', 'VAT')} ${M.pct((i.lines[0] || {}).taxRate || 0, 0)}`, M.money(i.tax)], [tt('الإجمالي', 'Total'), `<b>${M.money(i.total)}</b>`], [tt('المدفوع', 'Paid'), M.money(i.paid)], [tt('المتبقي', 'Balance'), `<b>${M.money(C.invoiceBalance(cid, i))}</b>`]])}</div></div>
        <div class="grid">${U.card(tt('الفاتورة الإلكترونية', 'E-invoice'), U.dl([[tt('الحالة', 'Status'), U.status(i.eInvoice.status)], ['UUID', i.eInvoice.uuid ? `<code>${M.esc(i.eInvoice.uuid)}</code>` : '—'], [tt('رقم المُصدر الضريبي', 'Issuer tax ID'), M.esc(comp.taxNo || '—')], [tt('رقم المستلم الضريبي', 'Receiver tax ID'), cl.taxNo || '—']]) + `<div class="muted small" style="margin-top:8px">${tt('الإرسال الآلي لمنظومة الفاتورة الإلكترونية المصرية غير مفعّل (يحتاج بيانات اعتماد المنظومة). سجّل الحالة يدوياً بعد الإرسال.', 'Automatic submission to the Egyptian e-invoicing system is not enabled (it needs ETA credentials). Record the status manually after submission.')}</div>`)}
        ${U.card(tt('ERP والقيد', 'ERP & journal'), U.dl([[tt('المزامنة', 'Sync'), U.status(i.syncStatus)], [tt('مرجع ERP', 'ERP reference'), i.externalRef ? `<code>${i.externalRef}</code>` : '—'], [tt('القيد', 'Journal entry'), je ? `<a href="#je.${je.id}">${je.number}</a>` : '—']]))}
        ${U.card(tt('التحصيلات', 'Payments'), pays.length || cns.length ? pays.map(p => `<div class="list-row"><div class="grow"><div class="t">${p.number}</div><div class="s">${M.date(p.date)} · ${U.payMethod(p.method)}</div></div><b class="num">${M.money((p.allocations.find(a => a.invoiceId === i.id) || {}).amount)}</b></div>`).join('') + cns.map(c => `<div class="list-row"><div class="grow"><div class="t">${c.number}</div><div class="s">${M.L(c.reason)}</div></div><b class="num">${M.money(c.total)}</b></div>`).join('') : `<span class="muted small">${tt('لا توجد تحصيلات بعد', 'No payments yet')}</span>`)}</div></div>`;
  });
  U.act('pay-invoice', el => { const i = U.find('invoices', el.dataset.id); U.acts['pay-new']({ dataset: { client: i.clientId, invoice: i.id } }); });
  U.act('pay-new', el => {
    if (!U.guard()) return;
    const db = U.db(); const pre = el && el.dataset ? el.dataset : {};
    const accounts = db.coa.filter(a => /^(bank|cash)_/.test(a.key)).map(a => [a.key, `${a.code} · ${M.L(a.name)}`]);
    U.modal(tt('تسجيل تحصيل', 'Record payment'), U.formHtml([
      { f: 'clientId', label: tt('العميل', 'Client'), type: 'select', value: pre.client, options: db.clients.map(c => [c.id, M.L(c.name)]), req: true },
      { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true, attrs: `max="${M.TODAY}"` },
      { f: 'amount', label: tt('المبلغ', 'Amount'), type: 'number', req: true, attrs: 'min="0.01" step="0.01"' },
      { f: 'method', label: tt('طريقة الدفع', 'Method'), type: 'select', options: [['transfer', U.payMethod('transfer')], ['cheque', U.payMethod('cheque')], ['cash', U.payMethod('cash')], ['card', U.payMethod('card')]] },
      { f: 'account', label: tt('الحساب', 'Account'), type: 'select', options: accounts },
      { f: 'reference', label: tt('المرجع (رقم التحويل/الشيك)', 'Reference (transfer/cheque no.)') },
    ], 'pf') + `<h3 style="font-size:15px;margin:16px 0 8px">${tt('التوزيع على الفواتير', 'Allocate to invoices')}</h3><div id="pf-inv"></div><p class="muted small">${tt('المتبقي بدون توزيع يبقى رصيد دائن للعميل.', 'Any unallocated amount stays as a credit on the client account.')}</p>`, `<button class="btn secondary" data-act="close-overlay">${tt('إلغاء', 'Cancel')}</button><button class="btn" data-act="pay-save">${tt('حفظ التحصيل', 'Save payment')}</button>`);
    const g = f => document.querySelector(`#pf [data-f="${f}"]`);
    const upd = () => {
      const open = db.invoices.filter(i => i.clientId === g('clientId').value && ['issued', 'partial'].includes(i.status) && C.invoiceBalance(U.cid(), i) > 0.009).sort((a, b) => a.dueDate < b.dueDate ? -1 : 1);
      document.getElementById('pf-inv').innerHTML = open.length ? open.map(i => `<div class="list-row"><div class="grow"><div class="t">${i.number} · ${tt('استحقاق', 'due')} ${M.date(i.dueDate)}</div><div class="s">${tt('المتبقي', 'Open')} ${M.money(C.invoiceBalance(U.cid(), i))}</div></div><input type="number" class="pf-a" data-inv="${i.id}" data-max="${C.invoiceBalance(U.cid(), i)}" min="0" step="0.01" style="width:130px" value="${pre.invoice === i.id ? C.invoiceBalance(U.cid(), i).toFixed(2) : ''}" aria-label="${tt('المبلغ', 'Amount')}"></div>`).join('') + `<button class="btn ghost sm" type="button" id="pf-auto">${tt('وزّع تلقائياً على الأقدم', 'Auto-allocate oldest first')}</button>` : `<p class="muted small">${tt('لا توجد فواتير مفتوحة لهذا العميل.', 'This client has no open invoices.')}</p>`;
      const auto = document.getElementById('pf-auto'); if (auto) auto.addEventListener('click', () => { let left = +g('amount').value || 0; document.querySelectorAll('.pf-a').forEach(x => { const v = Math.min(left, +x.dataset.max); x.value = v > 0 ? v.toFixed(2) : ''; left -= Math.max(0, v); }); });
      if (pre.invoice) { const x = document.querySelector(`.pf-a[data-inv="${pre.invoice}"]`); if (x) g('amount').value = x.value; }
    };
    g('clientId').addEventListener('change', () => { pre.invoice = null; upd(); }); upd();
    g('method').addEventListener('change', () => { const m = g('method').value; const acc = g('account'); const want = m === 'cash' ? 'cash_' : 'bank_'; const o = [...acc.options].find(x => x.value.startsWith(want)); if (o) acc.value = o.value; });
  });
  U.act('pay-save', () => {
    const d = U.readForm('pf');
    d.allocations = [...document.querySelectorAll('.pf-a')].filter(x => +x.value > 0).map(x => ({ invoiceId: x.dataset.inv, amount: +x.value }));
    d.autoAllocate = false;
    U.run('payment.create', d, { ok: r => tt(`تم تسجيل ${r.number}`, `${r.number} recorded`) + (r.unallocated > 0.009 ? ' · ' + tt('رصيد دائن', 'credit on account') + ' ' + M.money(r.unallocated) : '') });
  });
  U.act('pay-advance', el => { const b = U.find('bookings', el.dataset.id); const db = U.db(); U.formModal(tt('دفعة مقدمة على الحجز', 'Advance payment on booking'), [
    { f: 'amount', label: tt('المبلغ', 'Amount'), type: 'number', req: true, attrs: 'min="0.01"' }, { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY },
    { f: 'method', label: tt('طريقة الدفع', 'Method'), type: 'select', options: [['transfer', U.payMethod('transfer')], ['cheque', U.payMethod('cheque')], ['cash', U.payMethod('cash')], ['card', U.payMethod('card')]] },
    { f: 'account', label: tt('الحساب', 'Account'), type: 'select', options: db.coa.filter(a => /^(bank|cash)_/.test(a.key)).map(a => [a.key, M.L(a.name)]) }, { f: 'reference', label: tt('المرجع', 'Reference') },
  ], 'payment.create', { map: d => Object.assign(d, { clientId: b.clientId, advanceBookingId: b.id, autoAllocate: false }), ok: r => tt('تم تسجيل الدفعة ', 'Advance recorded ') + r.number }); });
  U.act('exp-new', () => { const db = U.db(); U.formModal(tt('مصروف جديد', 'New expense'), [
    { f: 'category', label: tt('البند', 'Category'), type: 'select', options: Object.entries(U.expCats).map(([k, v]) => [k, tt(...v)]), req: true },
    { f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true }, { f: 'amount', label: tt('المبلغ قبل الضريبة', 'Amount before VAT'), type: 'number', req: true, attrs: 'min="0.01" step="0.01"' },
    { f: 'tax', label: tt('ضريبة مدخلات', 'Input VAT'), type: 'number', value: 0, attrs: 'min="0" step="0.01"' },
    { f: 'vehicleId', label: tt('المركبة (مركز تكلفة)', 'Vehicle (cost center)'), type: 'select', options: [['', '—'], ...db.vehicles.map(v => [v.id, `${v.code} · ${M.L(v.plate)}`])] },
    { f: 'method', label: tt('الدفع', 'Paid by'), type: 'select', options: [['cash', tt('نقدي', 'Cash')], ['bank', tt('بنك', 'Bank')], ['payable', tt('آجل (مورد)', 'On credit (supplier)')]] },
    { f: 'supplier', label: tt('المورد', 'Supplier') }, { f: 'note', label: tt('البيان', 'Description'), full: true },
  ], 'expense.create', { ok: tt('تم تسجيل المصروف والقيد', 'Expense and journal entry recorded') }); });
  const ctFields = c => { c = c || {}; return [
    { f: 'name', label: tt('الاسم', 'Name'), value: c.name ? M.L(c.name) : '', req: true },
    { f: 'type', label: tt('النوع', 'Type'), type: 'select', value: c.type || 'agency', options: Object.entries(ctype).map(([k, v]) => [k, tt(...v)]) },
    { f: 'taxNo', label: tt('الرقم الضريبي', 'Tax ID'), value: c.taxNo, attrs: 'dir="ltr"' }, { f: 'crNo', label: tt('السجل التجاري', 'Commercial register'), value: c.crNo, attrs: 'dir="ltr"' },
    { f: 'contact', label: tt('مسؤول التواصل', 'Contact person'), value: c.contact ? M.L(c.contact) : '' }, { f: 'phone', label: tt('الهاتف', 'Phone'), value: c.phone, attrs: 'dir="ltr"' },
    { f: 'email', label: tt('البريد', 'Email'), type: 'email', value: c.email, attrs: 'dir="ltr"' }, { f: 'address', label: tt('العنوان', 'Address'), value: c.address ? M.L(c.address) : '' },
    { f: 'terms', label: tt('شروط الدفع (يوم)', 'Payment terms (days)'), type: 'number', value: c.terms != null ? c.terms : U.db().settings.defaultTerms, attrs: 'min="0" max="365"' },
    { f: 'creditLimit', label: tt('حد الائتمان (0 = بدون حد)', 'Credit limit (0 = none)'), type: 'number', value: c.creditLimit || 0, attrs: 'min="0"' },
    { f: 'currency', label: tt('العملة', 'Currency'), type: 'select', value: c.currency || 'EGP', options: [['EGP', 'EGP'], ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['SAR', 'SAR']] },
    c.id ? { f: 'status', label: tt('الحالة', 'Status'), type: 'select', value: c.status, options: [['active', tt('نشط', 'Active')], ['inactive', tt('غير نشط', 'Inactive')]] } : null,
    { f: 'externalRef', label: tt('كود العميل في ERP', 'ERP customer code'), value: c.externalRef, attrs: 'dir="ltr"' },
  ]; };
  U.act('client-new', () => U.formModal(tt('عميل جديد', 'New client'), ctFields(), 'client.create', { ok: r => tt('تمت إضافة العميل ', 'Client added ') + r.code, after: r => { location.hash = 'client.' + r.id; U.full(); } }));
  U.act('client-edit', el => { const c = U.find('clients', el.dataset.id); U.formModal(tt('تعديل العميل', 'Edit client'), ctFields(c), 'client.update', { map: d => Object.assign(d, { id: c.id, email: d.email || '' }) }); });

  /* ================= PAYMENTS ================= */
  U.route('payments', () => {
    const db = U.db(); const rows = db.payments.slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const by = M.groupBy(rows, p => p.method);
    return U.head(tt('المدفوعات والتحصيل', 'Payments & collection'), tt('توزيع التحصيل على فاتورة أو أكثر، ودفعات مقدمة على الحجوزات.', 'Allocate receipts across one or more invoices, plus advance payments on bookings.'), U.btn(tt('تسجيل تحصيل', 'Record payment'), 'pay-new', '', 'plus')) +
      U.kpis([U.kpi(tt('إجمالي التحصيل', 'Total collected'), M.moneyK(M.sum(rows, p => p.amount))), ...[...by].map(([k, v]) => U.kpi(U.payMethod(k), M.moneyK(M.sum(v, p => p.amount)), `${v.length} ${tt('إيصال', 'receipts')}`))]) +
      U.card(null, U.table({ id: 'payments', rows, columns: [
        { label: tt('الإيصال', 'Receipt'), value: p => p.number, render: p => `<b>${p.number}</b>` }, { label: tt('التاريخ', 'Date'), value: p => p.date, render: p => M.date(p.date) },
        { label: tt('العميل', 'Client'), value: p => M.L(U.find('clients', p.clientId).name), render: p => U.cLabel(U.find('clients', p.clientId)) },
        { label: tt('الطريقة', 'Method'), value: p => U.payMethod(p.method) }, { label: tt('الحساب', 'Account'), value: p => { const a = M.by(U.db().coa, 'key')[p.account]; return a ? M.L(a.name) : p.account; } }, { label: tt('المرجع', 'Reference'), value: p => p.reference },
        { label: tt('موزع على', 'Allocated to'), value: p => p.allocations.length, render: p => (p.advanceBookingId ? U.badge(tt('دفعة مقدمة', 'Advance'), 'warning') + ` <a href="#booking.${p.advanceBookingId}">${M.esc(U.find('bookings', p.advanceBookingId).number)}</a> ` : '') + p.allocations.map(a => `<a href="#invoice.${a.invoiceId}">${M.esc(U.find('invoices', a.invoiceId).number)}</a>`).join('، ') + (!p.advanceBookingId && M.sum(p.allocations, a => a.amount) < p.amount - 0.5 ? ' ' + U.badge(tt('رصيد دائن', 'On account'), 'muted') : '') },
        { label: tt('المبلغ', 'Amount'), num: 1, value: p => p.amount, render: p => M.money(p.amount) }, { label: 'ERP', value: p => p.syncStatus, render: p => U.status(p.syncStatus) },
      ] }), { flush: true });
  });

  /* ================= EXPENSES ================= */
  U.expCats = { fuel: ['وقود', 'Fuel'], oil: ['زيت', 'Oil'], maintenance: ['صيانة', 'Maintenance'], tolls: ['كارتة', 'Tolls'], parking: ['جراج', 'Parking'], lodging: ['إقامة سائق', 'Driver lodging'], salaries: ['رواتب', 'Salaries'], subcontract: ['من الباطن', 'Subcontract'], other: ['أخرى', 'Other'], insurance: ['تأمين', 'Insurance'], license: ['رخص', 'Licenses'] };
  U.route('expenses', () => {
    const db = U.db(); const P = U.periodRange();
    const rows = db.expenses.filter(e => e.date >= P.from && e.date <= P.to).sort((a, b) => a.date < b.date ? 1 : -1);
    const by = [...M.groupBy(rows, e => e.category)].map(([k, v]) => [k, M.sum(v, e => e.amount)]).sort((a, b) => b[1] - a[1]);
    return U.head(tt('المصروفات', 'Expenses'), tt('كل التكاليف في مكان واحد: الوقود والزيت والصيانة تنشئ مصروفاتها تلقائياً.', 'All costs in one place: fuel, oil and maintenance create their expense entries automatically.'), `${U.periodSeg()}${['super_admin', 'company_admin', 'fleet_manager', 'accountant'].includes(M.state.role) ? U.btn(tt('مصروف جديد', 'New expense'), 'exp-new', '', 'plus') : ''}`) +
      `<div class="cols-2-1">` + U.card(tt('حسب البند', 'By category'), U.chart('ch-exp', { type: 'bar', label: 'expenses by category', data: { labels: by.map(b => tt(...(U.expCats[b[0]] || [b[0], b[0]]))), datasets: [{ label: tt('المبلغ', 'Amount'), data: by.map(b => Math.round(b[1])) }] }, options: { indexAxis: 'y' } })) + U.kpis([U.kpi(tt('إجمالي المصروفات', 'Total expenses'), M.moneyK(M.sum(rows, e => e.amount))), U.kpi(tt('عدد القيود', 'Entries'), M.n0(rows.length)), U.kpi(tt('ضريبة مدخلات', 'Input VAT'), M.moneyK(M.sum(rows, e => e.tax)))]).replace('class="kpis"', 'class="kpis" style="grid-template-columns:1fr;margin:0"') + `</div><div style="height:16px"></div>` +
      U.card(null, U.table({ id: 'expenses', rows, columns: [
        { label: tt('التاريخ', 'Date'), value: e => e.date, render: e => M.date(e.date) }, { label: tt('البند', 'Category'), value: e => e.category, render: e => tt(...(U.expCats[e.category] || [e.category, e.category])) + (e.note ? `<div class="cell-sub">${M.esc(M.L(e.note))}</div>` : '') },
        { label: tt('المركبة', 'Vehicle'), value: e => e.vehicleId ? U.find('vehicles', e.vehicleId).code : '', render: e => e.vehicleId ? `<a href="#vehicle.${e.vehicleId}">${U.find('vehicles', e.vehicleId).code}</a>` : '—' },
        { label: tt('الرحلة/البرنامج', 'Trip / program'), value: e => e.tripId || '', render: e => e.tripId ? `<a href="#trip.${e.tripId}">${M.esc(U.find('trips', e.tripId).number)}</a>` : e.programId ? `<a href="#program.${e.programId}">${M.esc(U.find('programs', e.programId).number)}</a>` : '—' },
        { label: tt('المورد', 'Supplier'), value: e => e.supplier }, { label: tt('المصدر', 'Source'), value: e => e.sourceType },
        { label: tt('المبلغ', 'Amount'), num: 1, value: e => e.amount, render: e => M.money(e.amount) }, { label: tt('الضريبة', 'VAT'), num: 1, value: e => e.tax, render: e => e.tax ? M.n0(e.tax) : '—' }, { label: 'ERP', value: e => e.syncStatus, render: e => U.status(e.syncStatus) },
      ], filters: [{ label: tt('البند', 'Category'), get: e => e.category, options: by.map(b => [b[0], tt(...(U.expCats[b[0]] || [b[0], b[0]]))]) }, { label: tt('المركبة', 'Vehicle'), get: e => e.vehicleId || '', options: db.vehicles.map(v => [v.id, v.code]) }] }), { flush: true });
  });

  /* ================= JOURNAL ================= */
  const srcNames = { invoice: ['فاتورة', 'Invoice'], invoice_cancel: ['إلغاء فاتورة', 'Invoice cancellation'], credit_note: ['إشعار دائن', 'Credit note'], payment: ['تحصيل', 'Receipt'], expense: ['مصروف', 'Expense'], depreciation: ['إهلاك', 'Depreciation'], payroll: ['رواتب', 'Payroll'], stock_receipt: ['استلام مخزني', 'Goods receipt'], stock_adjustment: ['تسوية مخزون', 'Stock adjustment'], stock_count: ['جرد', 'Stock count'], stock_return: ['مرتجع مورد', 'Supplier return'], topup: ['شحن رصيد', 'Top-up'], fine: ['مخالفة', 'Fine'], manual: ['يدوي', 'Manual'] };
  U.route('journal', () => {
    const db = U.db(); const rows = db.journal.slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (a.number < b.number ? 1 : -1));
    const failed = rows.filter(j => j.syncStatus === 'failed');
    const canAcc = ['super_admin', 'company_admin', 'accountant'].includes(M.state.role);
    return U.head(tt('القيود المحاسبية', 'Journal entries'), tt('قيود مزدوجة متوازنة تتولد تلقائياً من الأحداث، وتُصدَّر للـ ERP بأكواد حسابات الشركة.', 'Balanced double entries generated from business events and exported to the ERP with this company’s account codes.'), canAcc ? `${U.btn(tt('تصدير للـ ERP', 'Export to ERP'), 'export-erp', '', 'upload')}${U.btn(tt('قيد يدوي', 'Manual entry'), 'je-manual', 'secondary', 'plus')}${U.btn(tt('ترحيل الإهلاك', 'Post depreciation'), 'post-dep', 'secondary', 'trend')}${U.btn(tt('الرواتب', 'Payroll'), 'post-payroll', 'secondary', 'users')}<button class="btn secondary" data-act="close-period">${U.icon('lock')}${tt('إقفال فترة', 'Close period')}</button>` : '') +
      U.kpis([U.kpi(tt('قيود', 'Entries'), M.n0(rows.length)), U.kpi(tt('مرحّلة (غير مُصدّرة)', 'Posted (not exported)'), rows.filter(j => j.status === 'posted').length), U.kpi(tt('مُصدَّرة', 'Exported'), rows.filter(j => j.status === 'exported').length), U.kpi(tt('فشل المزامنة', 'Sync failed'), `<span class="${failed.length ? 'delta-down' : ''}">${failed.length}</span>`), U.kpi(tt('آخر فترة مقفولة', 'Last closed period'), db.settings.closedThrough ? M.monthName(db.settings.closedThrough) : tt('لا يوجد', 'None'))]) +
      U.card(null, U.table({ id: 'journal', rows, columns: [
        { label: tt('القيد', 'Entry'), value: j => j.number, render: j => `<a class="cell-main" href="#je.${j.id}">${j.number}</a>` }, { label: tt('التاريخ', 'Date'), value: j => j.date, render: j => M.date(j.date) },
        { label: tt('المصدر', 'Source'), value: j => j.sourceType, render: j => `${tt(...(srcNames[j.sourceType] || [j.sourceType, j.sourceType]))}<div class="cell-sub mono">${j.sourceRef}</div>` },
        { label: tt('البيان', 'Description'), value: j => M.L(j.desc) }, { label: tt('سطور', 'Lines'), num: 1, value: j => j.lines.length },
        { label: tt('المبلغ', 'Amount'), num: 1, value: j => M.sum(j.lines, l => l.debit), render: j => M.money(M.sum(j.lines, l => l.debit)) },
        { label: tt('الحالة', 'Status'), value: j => j.status, render: j => U.status(j.status) }, { label: 'ERP', value: j => j.syncStatus, render: j => U.status(j.syncStatus) },
      ], filters: [{ label: tt('المصدر', 'Source'), get: j => j.sourceType, options: Object.entries(srcNames).map(([k, v]) => [k, tt(...v)]) }, { label: 'ERP', get: j => j.syncStatus, options: ['synced', 'failed', 'not_synced'].map(k => [k, U.statusText(k)]) }], onRow: j => 'je.' + j.id }), { flush: true });
  });
  U.route('je', id => {
    const db = U.db(); const j = db.journal.find(x => x.id === id);
    if (!j) return U.empty('book', tt('القيد غير موجود', 'Entry not found'));
    const acc = M.by(db.coa, 'key');
    const dr = M.sum(j.lines, l => l.debit), cr = M.sum(j.lines, l => l.credit);
    const A = k => acc[k] || { name: { ar: k, en: k }, erpCode: k };
    const payload = { companyId: j.companyId, entryNumber: j.number, date: j.date, source: { type: j.sourceType, ref: j.sourceRef }, lines: j.lines.map(l => ({ account: A(l.accountKey).erpCode, costCenter: l.costCenter, debit: l.debit, credit: l.credit })), status: j.status };
    return U.head(j.number, M.esc(M.L(j.desc)), `${U.status(j.status)} ${U.status(j.syncStatus)} ${j.externalRef ? `<code>${M.esc(j.externalRef)}</code>` : ''}`, [[tt('القيود', 'Journal'), 'journal'], [j.number]]) +
      U.card(null, `<div class="table-wrap"><table class="dt"><thead><tr><th>${tt('الحساب', 'Account')}</th><th>${tt('كود ERP', 'ERP code')}</th><th>${tt('مركز التكلفة', 'Cost center')}</th><th class="n">${tt('مدين', 'Debit')}</th><th class="n">${tt('دائن', 'Credit')}</th></tr></thead><tbody>${j.lines.map(l => `<tr><td>${M.esc(M.L(A(l.accountKey).name))} <span class="muted mono">${l.account}</span></td><td><code>${M.esc(A(l.accountKey).erpCode)}</code></td><td>${l.costCenter || '—'}</td><td class="n num">${l.debit ? M.n2(l.debit) : ''}</td><td class="n num">${l.credit ? M.n2(l.credit) : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">${tt('الإجمالي', 'Total')} ${Math.abs(dr - cr) < 0.01 ? U.badge(tt('متوازن', 'Balanced'), 'success') : U.badge(tt('غير متوازن', 'Unbalanced'), 'danger')}</td><td class="n num">${M.n2(dr)}</td><td class="n num">${M.n2(cr)}</td></tr></tfoot></table></div>`, { flush: true }) + '<div style="height:16px"></div>' +
      U.card(tt('معاينة الإرسال للـ ERP (JSON)', 'ERP export preview (JSON)'), `<pre class="code">${M.esc(JSON.stringify(payload, null, 2))}</pre>`);
  });
  U.act('export-erp', () => {
    const db = U.db(); const erp = db.providers.find(p => p.kind === 'erp' && p.status === 'connected' && p.endpointUrl);
    U.modal(tt('تصدير القيود للـ ERP', 'Export entries to the ERP'), `${U.formHtml([{ f: 'from', label: tt('من', 'From'), type: 'date', value: `${M.month(M.TODAY)}-01` }, { f: 'to', label: tt('إلى', 'To'), type: 'date', value: M.TODAY }, { f: 'status', label: tt('القيود', 'Entries'), type: 'select', options: [['posted', tt('غير المُصدّرة فقط', 'Not yet exported')], ['', tt('الكل', 'All')]] }, { f: 'mark', label: tt('علّم القيود كمُصدّرة بعد التنزيل', 'Mark the entries as exported after download'), type: 'checkbox', value: true, full: true }], 'ex')}
      <p class="muted small">${tt('ملف CSV أو JSON بأكواد حسابات ERP (من دليل الحسابات) يمكن استيراده في أي نظام محاسبي.', 'A CSV or JSON file with the ERP account codes (from the accounts mapping) that any accounting system can import.')}</p>
      ${erp ? `<div class="sep"></div><p class="small">${tt('أو أرسلها مباشرة لـ', 'Or send them directly to')} <b>${M.esc(M.L(erp.name))}</b> <span class="mono small">${M.esc(erp.endpointUrl)}</span></p><button class="btn secondary" data-act="erp-push">${U.icon('send')}${tt('إرسال القيود غير المُصدّرة الآن', 'Send unexported entries now')}</button>` : `<p class="muted small">${tt('للإرسال الآلي: أضف ربط ERP بعنوان API من صفحة مزودي الخدمة.', 'For automatic sending: add an ERP connection with an API endpoint in Service providers.')}</p>`}`,
      `<button class="btn secondary" data-act="close-overlay">${tt('إغلاق', 'Close')}</button><button class="btn secondary" data-act="erp-file" data-fmt="json">JSON</button><button class="btn" data-act="erp-file" data-fmt="csv">${U.icon('download')}CSV</button>`);
  });
  U.act('erp-file', async el => {
    const d = U.readForm('ex'); const q = new URLSearchParams({ format: el.dataset.fmt, from: d.from || '', to: d.to || '', status: d.status || '', mark: d.mark ? '1' : '0' });
    M.api.download('/api/export/journal?' + q.toString());
    if (d.mark) setTimeout(() => U.reload(true), 1500);
    U.closeOverlays();
  });
  U.act('erp-push', async () => {
    try { const r = await M.api.post('/api/erp/push'); U.closeOverlays(); await U.reload(); U.toast(tt(`تم إرسال ${r.sent} قيد للـ ERP`, `${r.sent} entries sent to the ERP`)); }
    catch (e) { U.showError(e); }
  });
  U.act('close-period', () => {
    const db = U.db(); const last = db.settings.closedThrough; const next = last ? M.addMonths(last, 1) : M.addMonths(M.month(M.TODAY), -1);
    U.confirm(tt(`إقفال فترة ${M.monthName(next)}`, `Close ${M.monthName(next)}`), tt(`بعد الإقفال لا يمكن إضافة أو تعديل قيود بتاريخ في ${M.monthName(next)} أو قبله. أي تصحيح يتم بقيد في فترة مفتوحة.`, `After closing, no entries dated in ${M.monthName(next)} or earlier can be added or changed. Corrections go through an entry in an open period.`), () => U.run('period.close', { month: next }, { ok: tt('تم إقفال الفترة', 'Period closed') }));
  });
  U.act('post-dep', () => U.formModal(tt('ترحيل إهلاك شهر', 'Post monthly depreciation'), [{ f: 'month', label: tt('الشهر', 'Month'), type: 'month', value: M.addMonths(M.month(M.TODAY), -1), req: true }], 'depreciation.post', { intro: `<p class="muted small">${tt('قيد واحد: مدين مصروف إهلاك لكل مركبة (مركز تكلفة) / دائن مجمع الإهلاك. لا يمكن ترحيل نفس الشهر مرتين.', 'One entry: debit depreciation expense per vehicle (cost center) / credit accumulated depreciation. The same month cannot be posted twice.')}</p>`, ok: r => tt(`تم ترحيل ${r.number} لعدد ${r.vehicles} مركبة`, `Posted ${r.number} for ${r.vehicles} vehicles`) }));
  U.act('post-payroll', () => U.formModal(tt('تسجيل رواتب وعمولات السائقين', 'Record driver salaries & commissions'), [{ f: 'month', label: tt('الشهر', 'Month'), type: 'month', value: M.addMonths(M.month(M.TODAY), -1), req: true }], 'payroll.post', { intro: `<p class="muted small">${tt('المرتب الشهري لكل سائق + العمولة × عدد رحلاته المكتملة في الشهر، ويتسجل كمصروف رواتب على المركبة وقيد مدفوع من البنك.', 'Each driver’s monthly salary + commission × completed trips in the month, recorded as a salary expense on the vehicle and a journal entry paid from the bank.')}</p>`, ok: r => tt(`تم تسجيل ${M.money(r.total)} لعدد ${r.drivers} سائق`, `Recorded ${M.money(r.total)} for ${r.drivers} drivers`) }));
  U.act('je-manual', () => {
    const db = U.db(); const opts = db.coa.map(a => [a.key, `${a.code} · ${M.L(a.name)}`]);
    const row = i => `<div class="je-line"><select data-jl="accountKey" aria-label="${tt('الحساب', 'Account')}">${opts.map(o => `<option value="${o[0]}">${M.esc(o[1])}</option>`).join('')}</select><input type="number" data-jl="debit" min="0" step="0.01" placeholder="${tt('مدين', 'Debit')}"><input type="number" data-jl="credit" min="0" step="0.01" placeholder="${tt('دائن', 'Credit')}"><input data-jl="costCenter" placeholder="${tt('مركز تكلفة', 'Cost center')}"></div>`;
    U.modal(tt('قيد يدوي', 'Manual journal entry'), U.formHtml([{ f: 'date', label: tt('التاريخ', 'Date'), type: 'date', value: M.TODAY, req: true }, { f: 'reference', label: tt('المرجع', 'Reference') }, { f: 'description', label: tt('البيان', 'Description'), req: true, full: true }], 'jm') + `<div id="jm-lines" style="margin-top:12px">${row(0)}${row(1)}</div><button class="btn ghost sm" type="button" id="jm-add">${U.icon('plus')}${tt('سطر', 'Line')}</button>`, `<button class="btn secondary" data-act="close-overlay">${tt('إلغاء', 'Cancel')}</button><button class="btn" data-act="je-save">${tt('ترحيل القيد', 'Post entry')}</button>`);
    document.getElementById('jm-add').addEventListener('click', () => document.getElementById('jm-lines').insertAdjacentHTML('beforeend', row(1)));
  });
  U.act('je-save', () => {
    const d = U.readForm('jm');
    d.lines = [...document.querySelectorAll('#jm-lines .je-line')].map(r => ({ accountKey: r.querySelector('[data-jl="accountKey"]').value, debit: +r.querySelector('[data-jl="debit"]').value || 0, credit: +r.querySelector('[data-jl="credit"]').value || 0, costCenter: r.querySelector('[data-jl="costCenter"]').value || null })).filter(l => l.debit || l.credit);
    U.run('journal.manual', d, { ok: r => tt('تم ترحيل ', 'Posted ') + r.number });
  });
})();
