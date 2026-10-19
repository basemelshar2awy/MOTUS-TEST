/* AI intelligence. Every figure comes from M.calc on this company's real data; the assistant
   matches the question to an approved read-only analysis, ranks and explains. No external
   language model is connected (see docs: connecting one needs a provider and an API key). Every
   question, answer and price approval is stored on the server (ai_messages, audit_log) and counted
   against the company's monthly AI limit. */
'use strict';
(function () {
  const U = M.ui, C = M.calc, tt = M.tt;
  const disclaimer = () => `<div class="muted small" style="margin-top:6px">${U.ai()} ${tt('النتائج محسوبة من بيانات الشركة بقواعد تحليل ثابتة وواضحة؛ لا يوجد نموذج لغوي خارجي متصل.', 'Results are calculated from company data with fixed, explainable rules; no external language model is connected.')}</div>`;
  const aiOff = f => { const s = U.db().settings; return s.aiEnabled === false || (s.aiFeatures && s.aiFeatures[f] === false); };
  const offPage = (title) => U.head(title, '') + U.empty('lock', tt('الميزة مقفولة من إعدادات الذكاء الاصطناعي', 'This feature is turned off in AI settings'), `<a class="btn secondary" href="#aisettings">${tt('إعدادات الذكاء الاصطناعي', 'AI settings')}</a>`);

  /* ---------- read-only tools the copilot may call (all company-scoped) ---------- */
  const tools = {
    lossVehicles(cid) { const m = C.months(); const ym = m[m.length - 2] || m[m.length - 1]; const [a, b] = C.monthRange(ym); const rows = C.fleetPL(cid, a, b).rows.filter(r => r.net < 0).sort((x, y) => x.net - y.net); return { period: M.monthName(ym), rows, links: rows.map(r => ['vehicle.' + r.v.id, r.v.code]) }; },
    fuelRise(cid) { const m = C.months(); const cur = m[m.length - 2] || m[m.length - 1], prev = m[m.length - 3] || cur; const f = ym => { const [a, b] = C.monthRange(ym); const fs = U.db().fuel.filter(x => x.date >= a && x.date <= b); return { cost: M.sum(fs, x => x.total), liters: M.sum(fs, x => x.liters), km: M.sum(C.fleetPL(cid, a, b).rows, r => r.km), anomalies: fs.filter(x => C.fuelCheck(cid, x).flag).length }; }; const A = f(prev), B = f(cur); const byV = U.db().vehicles.map(v => { const g = ym => { const [a, b] = C.monthRange(ym); return M.sum(U.db().fuel.filter(x => x.vehicleId === v.id && x.date >= a && x.date <= b), x => x.total); }; return { v, d: g(cur) - g(prev) }; }).sort((x, y) => y.d - x.d); return { cur, prev, A, B, byV }; },
    availableTomorrow(cid) { const d = M.addDays(M.TODAY, 1); return U.db().vehicles.map(v => ({ v, r: C.readiness(cid, v), n: U.db().trips.filter(t => t.vehicleId === v.id && t.date === d && t.status !== 'cancelled').length })).filter(x => x.r.ready && x.n === 0); },
    overdue(cid) { const ag = C.aging(cid); return Object.entries(ag.byClient).filter(([, a]) => a.overdue > 0).map(([k, a]) => ({ c: U.find('clients', k), a })).sort((x, y) => y.a.overdue - x.a.overdue); },
    programs(cid) { return U.db().programs.map(p => Object.assign({ p }, C.programPL(cid, p))).filter(x => x.revenue > 0).sort((a, b) => b.margin - a.margin); },
    partsRunOut(cid) { return U.db().items.map(it => { const use = C.itemUsage(cid, it.id, 90) / 3; const s = C.stockOf(cid, it.id).qty; return { it, use, s, days: use ? s / use * 30 : Infinity }; }).filter(x => x.days < 31).sort((a, b) => a.days - b.days); },
    overspeed(cid) { return [...M.groupBy(U.db().events.filter(e => e.type === 'overspeed' && e.date >= M.addDays(M.TODAY, -30)), e => e.driverId)].map(([k, l]) => ({ d: U.find('drivers', k), n: l.length, max: Math.max(...l.map(e => e.value)) })).sort((a, b) => b.n - a.n); },
  };
  const intents = [
    { k: 'loss', re: /(خسر|خسار|loss|lost money|losing)/i, q: ['أي مركبات خسرت الشهر الماضي؟', 'Which vehicles lost money last month?'] },
    { k: 'fuel', re: /(وقود|سولار|بنزين|fuel)/i, q: ['ليه تكلفة الوقود زادت؟', 'Why did fuel costs rise?'] },
    { k: 'avail', re: /(متاح|فاضي|بكرة|available|tomorrow)/i, q: ['أي مركبات متاحة بكرة؟', 'Which vehicles are available tomorrow?'] },
    { k: 'overdue', re: /(متأخر|سداد|مستحق|فواتير|overdue|invoice)/i, q: ['مين العملاء المتأخرين في السداد؟', 'Which clients have overdue invoices?'] },
    { k: 'prog', re: /(برنامج|برامج|program)/i, q: ['أي البرامج الأكثر ربحية؟', 'Which programs are most profitable?'] },
    { k: 'parts', re: /(قطع|مخزن|هتخلص|parts|stock|run out)/i, q: ['أي قطع غيار هتخلص الشهر ده؟', 'Which parts will run out this month?'] },
    { k: 'speed', re: /(سرعة|overspeed|speed)/i, q: ['مين السائقين الأكثر تجاوزاً للسرعة؟', 'Which drivers had the most overspeed events?'] },
  ];
  const tbl = (head, rows) => `<div class="table-wrap" style="margin-top:8px"><table class="dt"><thead><tr>${head.map(h => `<th class="${h[1] ? 'n' : ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${head[i][1] ? 'n num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  function answer(q) {
    const cid = U.cid(); const it = intents.find(x => x.re.test(q));
    let html = '', period = '', limits = '', src = [];
    if (!it) { const P = U.periodRange(); const pl = C.fleetPL(cid, P.from, P.to).total; html = tt(`مقدرتش أحدد السؤال بدقة، فده ملخص سريع لـ${P.label}: إيراد ${M.money(pl.revenue)}، تكاليف ${M.money(pl.costs)}، صافي ربح ${M.money(pl.net)} بهامش ${M.pct(pl.margin)}. جرّب تسأل عن الخسارة أو الوقود أو المركبات المتاحة أو المتأخرات أو البرامج أو قطع الغيار أو السرعة.`, `I couldn’t match that exactly, so here’s a quick summary for ${P.label}: revenue ${M.money(pl.revenue)}, costs ${M.money(pl.costs)}, net profit ${M.money(pl.net)} at ${M.pct(pl.margin)} margin. Try asking about losses, fuel, availability, overdue invoices, programs, parts or speeding.`); period = P.label; src = [['dashboard', tt('لوحة التحكم', 'Dashboard')]]; }
    else if (it.k === 'loss') { const r = tools.lossVehicles(cid); period = r.period; html = r.rows.length ? tt(`${r.rows.length} مركبات حققت صافي ربح سالب في ${r.period}. السبب الأكبر غالباً قلة التشغيل مقابل تكلفة السائق والإهلاك الثابتة.`, `${r.rows.length} vehicles had negative net profit in ${r.period}. The main driver is usually low utilization against fixed driver and depreciation costs.`) + tbl([[tt('المركبة', 'Vehicle')], [tt('الإيراد', 'Revenue'), 1], [tt('التكاليف', 'Costs'), 1], [tt('صافي', 'Net'), 1], [tt('التشغيل', 'Util.'), 1]], r.rows.map(x => [`<a href="#vehicle.${x.v.id}">${x.v.code}</a> ${U.vtype(x.v.type)}`, M.n0(x.revenue), M.n0(x.costs), `<span class="neg">${M.n0(x.net)}</span>`, M.pct(x.util, 0)])) : tt('ولا مركبة خسرت الشهر الماضي.', 'No vehicle lost money last month.'); src = r.links; limits = tt('الشهر الحالي غير مكتمل فتم استخدام آخر شهر كامل.', 'The current month is incomplete, so the last full month was used.'); }
    else if (it.k === 'fuel') { const r = tools.fuelRise(cid); period = `${M.monthName(r.prev)} ← ${M.monthName(r.cur)}`; const dc = r.B.cost - r.A.cost; const kmEff = r.A.km ? (r.B.km / r.A.km - 1) : 0; html = tt(`تكلفة الوقود ${dc >= 0 ? 'زادت' : 'قلت'} ${M.money(Math.abs(dc))} (${r.A.cost ? M.pct(dc / r.A.cost) : '—'}). الكيلومترات اتغيرت ${M.pct(kmEff)}، يعني جزء كبير من التغير بسبب حجم التشغيل. فيه ${r.B.anomalies} تفويلة عليها علامة استهلاك غير طبيعي في ${M.monthName(r.cur)}.`, `Fuel cost ${dc >= 0 ? 'rose' : 'fell'} by ${M.money(Math.abs(dc))} (${r.A.cost ? M.pct(dc / r.A.cost) : '—'}). Kilometers changed ${M.pct(kmEff)}, so much of it follows activity volume. ${r.B.anomalies} fill-ups in ${M.monthName(r.cur)} are flagged as abnormal.`) + tbl([[tt('المركبة', 'Vehicle')], [tt('تغير التكلفة', 'Cost change'), 1]], r.byV.slice(0, 5).map(x => [`<a href="#vehicle.${x.v.id}">${x.v.code}</a>`, `<span class="${x.d > 0 ? 'neg' : 'pos'}">${x.d > 0 ? '+' : ''}${M.n0(x.d)}</span>`])); src = [['fuel', tt('المحروقات', 'Fuel')], ['fuelai', tt('ذكاء الوقود', 'Fuel intelligence')]]; }
    else if (it.k === 'avail') { const r = tools.availableTomorrow(cid); period = M.date(M.addDays(M.TODAY, 1)); html = tt(`${r.length} مركبات جاهزة ومفيش عليها رحلات بكرة:`, `${r.length} vehicles are ready with no trips tomorrow:`) + tbl([[tt('المركبة', 'Vehicle')], [tt('النوع', 'Type')], [tt('المقاعد', 'Seats'), 1]], r.map(x => [`<a href="#vehicle.${x.v.id}">${x.v.code}</a>`, U.vtype(x.v.type), x.v.seats])); src = [['dispatch', tt('لوحة التوزيع', 'Dispatch board')], ['readiness', tt('الجاهزية', 'Readiness')]]; }
    else if (it.k === 'overdue') { const r = tools.overdue(cid); period = tt('حتى اليوم', 'As of today'); html = tt(`${r.length} عملاء عليهم مبالغ متأخرة بإجمالي ${M.money(M.sum(r, x => x.a.overdue))}.`, `${r.length} clients have overdue balances totalling ${M.money(M.sum(r, x => x.a.overdue))}.`) + tbl([[tt('العميل', 'Client')], [tt('متأخر', 'Overdue'), 1], [tt('+90 يوم', '90+ days'), 1]], r.map(x => [U.cLabel(x.c), M.n0(x.a.overdue), M.n0(x.a.b90)])); src = r.slice(0, 3).map(x => ['client.' + x.c.id, M.L(x.c.name)]); }
    else if (it.k === 'prog') { const r = tools.programs(cid); period = tt('كل البرامج', 'All programs'); html = tt('ترتيب البرامج حسب هامش الربح بعد تكلفة الرحلات الفعلية:', 'Programs ranked by margin after actual trip cost:') + tbl([[tt('البرنامج', 'Program')], [tt('الإيراد', 'Revenue'), 1], [tt('الربح', 'Profit'), 1], [tt('الهامش', 'Margin'), 1]], r.slice(0, 6).map(x => [`<a href="#program.${x.p.id}">${M.L(x.p.name)}</a>`, M.n0(x.revenue), M.n0(x.profit), M.pct(x.margin)])); src = [['report.progpl', tt('تقرير ربحية البرامج', 'Program profitability report')]]; limits = tt('تكلفة الرحلة تقديرية من تكلفة الكيلو للمركبة.', 'Trip cost is estimated from the vehicle’s cost per km.'); }
    else if (it.k === 'parts') { const r = tools.partsRunOut(cid); period = tt('الـ 30 يوم القادمة', 'Next 30 days'); html = r.length ? tt('بمعدل الصرف لآخر 90 يوم، الأصناف دي هتخلص خلال شهر:', 'At the last-90-day usage rate, these items run out within a month:') + tbl([[tt('الصنف', 'Item')], [tt('الرصيد', 'On hand'), 1], [tt('صرف شهري', 'Monthly use'), 1], [tt('يكفي (يوم)', 'Days left'), 1]], r.map(x => [`<a href="#item.${x.it.id}">${M.L(x.it.name)}</a>`, M.n0(x.s), M.n1(x.use), M.n0(x.days)])) : tt('مفيش أصناف متوقع تخلص الشهر ده بمعدل الصرف الحالي.', 'No items are expected to run out this month at the current rate.'); src = [['invai', tt('ذكاء المخزون', 'Inventory intelligence')]]; }
    else if (it.k === 'speed') { const r = tools.overspeed(cid); period = tt('آخر 30 يوم', 'Last 30 days'); html = tt('السائقين حسب عدد أحداث تجاوز السرعة:', 'Drivers by number of overspeed events:') + tbl([[tt('السائق', 'Driver')], [tt('أحداث', 'Events'), 1], [tt('أقصى سرعة', 'Top speed'), 1]], r.slice(0, 6).map(x => [U.dLabel(x.d), x.n, x.max])); src = [['behavior', tt('سلوك السائقين', 'Driver behavior')]]; }
    answer.last = { src: src.map(x => x[1]), label: it ? 'verified' : 'rules', text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000) };
    return `${html}<div class="meta">${U.ai(tt('تحليل من بيانات شركتك', 'Analysis of your company data'))}<span>${tt('الفترة', 'Period')}: ${period}</span>${limits ? `<span>· ${limits}</span>` : ''}${src.length ? `<span>· ${tt('المصادر', 'Sources')}: ${src.map(s => `<a href="#${s[0]}">${s[1]}</a>`).join('، ')}</span>` : ''}</div>`;
  }
  const chatLog = {}; let convId = null;
  U.route('copilot', () => {
    if (aiOff('copilot')) return offPage(tt('المساعد الذكي للأسطول', 'Fleet copilot'));
    const cid = U.cid(); chatLog[cid] = chatLog[cid] || [];
    const log = chatLog[cid];
    U.onMount(() => { const f = document.getElementById('chat-form'); f.addEventListener('submit', e => { e.preventDefault(); const i = document.getElementById('chat-in'); ask(i.value); i.value = ''; }); const l = document.getElementById('chat-log'); l.scrollTop = l.scrollHeight; });
    return U.head(tt('المساعد الذكي للأسطول', 'Fleet copilot'), tt('اسأل بالعربي أو الإنجليزي. الإجابات من بيانات شركتك فقط عن طريق أدوات قراءة معتمدة، بدون SQL حر.', 'Ask in Arabic or English. Answers come only from your company’s data through approved read-only tools, never free-form SQL.'), U.ai()) +
      `<div class="cols-2-1" style="grid-template-columns:minmax(0,1fr) 260px"><section class="card chat"><div class="chat-log" id="chat-log" aria-live="polite">${log.length ? log.map(m => `<div class="msg ${m.who}">${m.html}</div>`).join('') : `<div class="msg ai">${tt('أهلاً! أنا المساعد الذكي لـ ', 'Hi! I’m the copilot for ')}<b>${M.L(U.company().name)}</b>. ${tt('أقدر أجاوب عن الربحية والوقود والإتاحة والتحصيل والمخزون والسلوك.', 'I can answer about profitability, fuel, availability, collections, stock and driver behavior.')}</div>`}</div><div class="suggest">${intents.map(i => `<button data-act="ask" data-q="${M.esc(tt(...i.q))}">${tt(...i.q)}</button>`).join('')}</div><form class="chat-input" id="chat-form"><input id="chat-in" autocomplete="off" placeholder="${tt('اكتب سؤالك…', 'Ask a question…')}" aria-label="${tt('سؤال', 'Question')}"><button class="btn" type="submit">${U.icon('send', 'flip')}${tt('إرسال', 'Send')}</button></form></section>` +
      U.card(tt('المحادثات السابقة', 'Past conversations'), (U.db().aiConversations.map(c => `<div class="list-row" style="cursor:pointer" data-act="conv-open" data-id="${c.id}"><div class="grow"><div class="t">${M.esc(M.L(c.title))}</div><div class="s">${M.date(c.at)}</div></div></div>`).join('') || `<p class="muted small">${tt('لا توجد محادثات بعد.', 'No conversations yet.')}</p>`) + `<button class="btn ghost sm" data-act="conv-new" style="margin-top:6px">${U.icon('plus')}${tt('محادثة جديدة', 'New conversation')}</button><div class="sep"></div><div class="small muted">${tt('الأدوات المسموحة', 'Allowed tools')}:</div><div class="pill-row" style="margin-top:6px">${['fleet_summary', 'vehicle_pl', 'trips', 'fuel', 'maintenance', 'utilization', 'receivables', 'route_profit', 'inventory', 'tracking', 'provider_tx'].map(x => `<code>${x}</code>`).join('')}</div>`) + `</div>`;
  });
  U.act('ask', el => ask(el.dataset.q));
  U.act('conv-new', () => { convId = null; chatLog[U.cid()] = []; U.render(); });
  U.act('conv-open', async el => {
    try {
      const r = await M.api.get('/api/ai/conversations/' + encodeURIComponent(el.dataset.id));
      convId = el.dataset.id;
      chatLog[U.cid()] = r.messages.map(m => ({ who: m.role === 'user' ? 'user' : 'ai', html: m.role === 'user' ? M.esc(m.text) : `${M.esc(m.text)}<div class="meta">${U.ai(tt('إجابة محفوظة', 'Saved answer'))}<span>${m.at}</span>${m.sources && m.sources.length ? `<span>· ${tt('المصادر', 'Sources')}: ${m.sources.map(M.esc).join('، ')}</span>` : ''}</div>` }));
      U.render();
    } catch (e) { U.showError(e); }
  });
  async function ask(q) {
    q = (q || '').trim(); if (!q) return; const cid = U.cid(); const log = chatLog[cid] = chatLog[cid] || [];
    const l = document.getElementById('chat-log'); if (!l) return;
    l.insertAdjacentHTML('beforeend', `<div class="msg user">${M.esc(q)}</div><div class="msg ai" id="typing"><span class="typing"><i></i><i></i><i></i></span></div>`); l.scrollTop = l.scrollHeight;
    let a;
    try { a = answer(q); } catch (e) { a = M.esc(tt('تعذر تحليل السؤال: ', 'Could not analyse the question: ') + e.message); answer.last = { src: [], label: 'rules', text: '' }; }
    try {
      const r = await M.api.do('ai.log', { feature: 'copilot', question: q.slice(0, 2000), answer: answer.last.text, sources: answer.last.src, label: answer.last.label, conversationId: convId || undefined });
      convId = r.conversationId || convId;
    } catch (e) { const t = document.getElementById('typing'); if (t) t.outerHTML = `<div class="msg ai">${M.esc(e.msg ? tt(e.msg.ar, e.msg.en) : e.message)}</div>`; return; }
    log.push({ who: 'user', html: M.esc(q) }, { who: 'ai', html: a });
    const t = document.getElementById('typing'); if (t) { t.outerHTML = `<div class="msg ai">${a}</div>`; l.scrollTop = l.scrollHeight; }
  }

  /* ---------- smart assignment ---------- */
  let plan = null;
  U.route('assign', () => {
    if (aiOff('assignment')) return offPage(tt('التوزيع الذكي', 'Smart assignment'));
    const db = U.db();
    const ua = db.bookings.filter(b => b.unassigned && b.status !== 'cancelled' && b.date <= M.addDays(M.TODAY, 1)).sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
    const w = { seat: 35, cost: 25, balance: 20, empty: 20 };
    return U.head(tt('التوزيع الذكي للمركبات والسائقين', 'Smart vehicle & driver assignment'), tt('القواعد الإلزامية الأول (السعة، التعارض، الصيانة، الرخص، ساعات القيادة)، وبعدين ترتيب بوزن واضح. التخصيص لازم موافقتك.', 'Hard rules first (capacity, conflicts, workshop, licenses, driving hours), then a transparent weighted score. You approve every assignment.'), `${U.btn(tt('خطّط بكرة تلقائياً', 'Auto-plan tomorrow'), 'auto-plan', '', 'sparkles')}`) +
      U.card(tt('أوزان الترتيب', 'Score weights'), `<div class="pill-row">${[[tt('ملاءمة المقاعد', 'Seat fit'), w.seat], [tt('تكلفة التشغيل', 'Operating cost'), w.cost], [tt('توازن التشغيل', 'Utilization balance'), w.balance], [tt('كيلومترات فاضية', 'Empty km'), w.empty]].map(x => U.badge(`${x[0]} <b class="num">${x[1]}%</b>`, 'plain outline')).join(' ')}</div><div class="muted small" style="margin-top:6px">${tt('القواعد الإلزامية يعاد التحقق منها على السيرفر عند التأكيد.', 'Hard rules are re-checked on the server when you confirm.')}</div>`) + '<div style="height:16px"></div>' +
      (plan ? U.card(tt('خطة مقترحة لبكرة', 'Proposed plan for tomorrow') + ' ' + U.ai(), plan.map(p => `<div class="list-row"><div class="grow"><div class="t">${p.b.number} · ${p.b.time} · ${U.routeTxt(p.b.pickup, p.b.destination)}</div><div class="s">${p.c ? `→ ${p.c.v.code} + ${M.L(p.c.driver.name)} · ${tt('تقييم', 'score')} ${p.c.score}` : tt('لا توجد مركبة مناسبة — اقتراح: مركبة من الباطن', 'No suitable vehicle — suggest a subcontracted vehicle')}</div></div></div>`).join('') + `<div class="actions" style="margin-top:12px"><button class="btn" data-act="approve-plan">${U.icon('check')}${tt('اعتماد الخطة', 'Approve plan')}</button><button class="btn secondary" data-act="discard-plan">${tt('تجاهل', 'Discard')}</button></div>`) + '<div style="height:16px"></div>' : '') +
      (ua.length ? ua.map(b => { const c = U.candidates(b); const top = c.filter(x => x.ok).slice(0, 3); return U.card(`${b.number} · ${M.date(b.date)} ${b.time}`, `<div class="small muted" style="margin-bottom:8px">${U.routeTxt(b.pickup, b.destination)} · ${b.pax} ${tt('راكب', 'pax')} · ${U.vtype(b.vehicleType)} · ${M.money(b.price)}</div>${top.length ? top.map((x, i) => `<div class="list-row"><b class="num" style="width:22px">${i + 1}</b><div class="grow"><div class="t">${x.v.code} · ${U.vtype(x.v.type)} · ${x.v.seats} ${tt('مقعد', 'seats')} + ${M.L(x.driver.name)}</div><div class="s">${tt('تكلفة تقديرية', 'Est. cost')} ${M.money(x.estCost)} · ${tt('كم فاضية', 'empty km')} ${x.empty} · ${tt('هامش متوقع', 'expected margin')} ${M.pct((b.price - x.estCost) / b.price, 0)}${x.warns.length ? ' · ' + x.warns.map(r => `<span class="delta-down">${tt(r[0], r[1])}</span>`).join(' · ') : ''}</div></div><span class="score ${x.score >= 70 ? 'g' : x.score >= 50 ? 'w' : 'b'}">${x.score}</span><button class="btn sm" data-act="do-assign" data-b="${b.id}" data-v="${x.v.id}" data-d="${x.driver.id}">${tt('تأكيد', 'Confirm')}</button></div>`).join('') : `<div class="list-row"><span class="sev high"></span><div class="grow">${tt('لا توجد مركبة متاحة تحقق القواعد. استخدم مركبة من الباطن.', 'No vehicle meets the rules. Use a subcontracted vehicle.')}</div><a class="btn secondary sm" href="#subcontract">${tt('من الباطن', 'Subcontract')}</a></div>`}<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">${tt('مركبات مستبعدة ولماذا', 'Excluded vehicles and why')}</summary>${c.filter(x => !x.ok).map(x => `<div class="small" style="padding:4px 0">${x.v.code}: ${x.reasons.map(r => tt(r[0], r[1])).join(' · ')}</div>`).join('')}</details>`); }).join('<div style="height:12px"></div>') : U.empty('check', tt('مفيش حجوزات بدون مركبة لليوم وبكرة', 'No unassigned bookings for today and tomorrow')));
  });
  U.act('auto-plan', () => { M.api.do('ai.log', { feature: 'assignment' }).catch(() => {}); const db = U.db(); const used = new Set(); plan = db.bookings.filter(b => b.unassigned && b.status !== 'cancelled' && b.date === M.addDays(M.TODAY, 1)).map(b => { const c = U.candidates(b).filter(x => x.ok && !used.has(x.v.id))[0]; if (c) used.add(c.v.id); return { b, c }; }); if (!plan.length) U.toast(tt('مفيش حجوزات بكرة بدون مركبة', 'No unassigned bookings tomorrow')); U.render(); });
  U.act('approve-plan', async () => {
    if (!U.guard()) return; let n = 0; const failed = [];
    for (const p of plan) { if (!p.c) continue; try { await U.assignBooking(p.b, p.c.v.id, p.c.driver.id); n++; } catch (e) { failed.push(`${p.b.number}: ${e.msg ? tt(e.msg.ar, e.msg.en) : e.message}`); } }
    plan = null; await U.reload(false);
    U.toast(tt(`تم اعتماد ${n} تخصيص`, `${n} assignments approved`) + (failed.length ? ' · ' + tt('تعذر: ', 'failed: ') + failed.join(' | ') : ''), failed.length ? 'error' : undefined); U.full();
  });
  U.act('discard-plan', () => { plan = null; U.render(); });

  /* ---------- profitability advisor with what-if ---------- */
  const wi = { fuel: 0, util: 0, maint: 0, replace: '' };
  U.act('wi', el => { wi[el.dataset.k] = el.type === 'range' ? +el.value : el.value; U.render(); });
  U.route('profit', () => {
    if (aiOff('insights')) return offPage(tt('مستشار الربحية', 'Profitability advisor'));
    const cid = U.cid(), db = U.db(); const lastFull = M.addMonths(M.month(M.TODAY), -1); const from = M.maxDate(M.START, `${M.addMonths(lastFull, -2)}-01`), to = M.maxDate(from, `${lastFull}-${String(M.daysInMonth(lastFull)).padStart(2, '0')}`);
    const pl = C.fleetPL(cid, from, to); const types = C.typePL(cid, from, to); const routes = C.routePL(cid, from, to);
    const losers = pl.rows.filter(r => r.net < 0).sort((a, b) => a.net - b.net);
    const best = pl.rows.slice().sort((a, b) => b.net - a.net)[0];
    const idle = pl.rows.slice().sort((a, b) => b.idleDays - a.idleDays)[0];
    const T = pl.total;
    const rep = wi.replace ? db.vehicles.find(v => v.id === wi.replace) : null;
    const repRow = rep ? pl.rows.find(r => r.v.id === rep.id) : null;
    const rvc = rep ? (M.vehicleClasses[rep.type] || {}) : {};
    const newPrice = rep ? ((rvc.price && rvc.price[1]) || rep.purchasePrice) : 0;
    const repDelta = rep && repRow ? -(repRow.maintenance * 0.7) + ((newPrice * (1 - (rvc.salvagePct || 0.15))) / (rvc.lifeYears || 10) / 4 - repRow.depreciation) : 0;
    const sc = { revenue: T.revenue * (1 + wi.util / 100), fuel: T.fuel * (1 + wi.fuel / 100) * (1 + wi.util / 100), maint: (T.maintenance + T.oil) * (1 - wi.maint / 100) * (1 + wi.util / 100), tripExp: T.tripExp * (1 + wi.util / 100), fixed: T.driver + T.licIns + T.depreciation + T.fines };
    sc.costs = sc.fuel + sc.maint + sc.tripExp + sc.fixed + repDelta; sc.net = sc.revenue - sc.costs;
    return U.head(tt('مستشار الربحية', 'Profitability advisor'), tt(`آخر 3 شهور مكتملة (${M.date(from)} – ${M.date(to)}). السيناريوهات توقعات مبنية على افتراضات واضحة.`, `Last 3 complete months (${M.date(from)} – ${M.date(to)}). Scenarios are forecasts built on stated assumptions.`), U.ai()) +
      `<div class="cols-2">` + U.card(tt('أكبر الخسائر', 'Biggest losses'), losers.length ? losers.slice(0, 5).map(r => `<div class="list-row"><span class="sev high"></span><div class="grow"><div class="t"><a href="#vehicle.${r.v.id}">${r.v.code}</a> · ${U.vtype(r.v.type)} · ${M.money(r.net)}</div><div class="s" style="white-space:normal">${tt(`التشغيل ${M.pct(r.util, 0)} فقط. التكاليف الثابتة (سائق + إهلاك + تأمين) ${M.money(r.driver + r.depreciation + r.licIns)} مقابل إيراد ${M.money(r.revenue)}.`, `Only ${M.pct(r.util, 0)} utilized. Fixed costs (driver + depreciation + insurance) ${M.money(r.driver + r.depreciation + r.licIns)} vs revenue ${M.money(r.revenue)}.`)}</div></div></div>`).join('') : U.empty('check', tt('لا توجد مركبات خاسرة', 'No loss-making vehicles'))) +
      U.card(tt('فرص التحسين', 'Opportunities'), [
        idle ? [tt(`${idle.v.code} كانت عاطلة ${idle.idleDays} يوم. تشغيلها 4 أيام إضافية شهرياً بمتوسط إيرادها يضيف حوالي ${M.money(idle.revenue / Math.max(1, idle.opDays) * 12)} في 3 شهور.`, `${idle.v.code} sat idle ${idle.idleDays} days. Four extra days a month at its average revenue adds about ${M.money(idle.revenue / Math.max(1, idle.opDays) * 12)} over 3 months.`), 'vehicle.' + idle.v.id] : null,
        types.some(t => t.count) ? [tt(`أعلى هامش للنوع: ${U.vtype(types.filter(t => t.count).sort((a, b) => (b.margin || -9) - (a.margin || -9))[0].type)}. وجّه حجوزات أكثر له عند التساوي.`, `Highest margin type: ${U.vtype(types.filter(t => t.count).sort((a, b) => (b.margin || -9) - (a.margin || -9))[0].type)}. Route more bookings to it when options tie.`), 'report.roc'] : null,
        routes.length ? [tt(`المسار الأقل ربحاً: ${U.routeTxt(routes[routes.length - 1].from, routes[routes.length - 1].to)} بهامش ${M.pct(routes[routes.length - 1].margin)}. راجع تسعيره.`, `Least profitable route: ${U.routeTxt(routes[routes.length - 1].from, routes[routes.length - 1].to)} at ${M.pct(routes[routes.length - 1].margin)} margin. Review its price.`), 'pricing'] : null,
        types.find(t => t.type === 'SD' && t.net < 0) ? [tt('السيدان خسرانة بسبب تكلفة سائق ثابتة على رحلات قصيرة. فكّر في نظام عمولة أو إسناد للباطن في المواسم الهادية.', 'Sedans lose money because a fixed driver salary sits on short trips. Consider commission pay or subcontracting in quiet months.'), 'report.coststruct'] : null,
        best ? [tt(`${best.v.code} الأعلى ربحاً (${M.money(best.net)}). استخدم نفس توزيع المسارات للمركبات المشابهة.`, `${best.v.code} earns the most (${M.money(best.net)}). Apply its route mix to similar vehicles.`), 'vehicle.' + best.v.id] : null,
      ].filter(Boolean).map(x => `<div class="list-row"><span class="sev"></span><div class="grow" style="white-space:normal">${x[0]}</div><a class="btn ghost sm" href="#${x[1]}">${tt('فتح', 'Open')}</a></div>`).join('')) + `</div><div style="height:16px"></div>` +
      U.card(tt('سيناريوهات ماذا لو', 'What-if scenarios'), `<div class="form">
        ${U.field('wi-fuel', `${tt('تغير سعر الوقود', 'Fuel price change')}: <b class="num">${wi.fuel > 0 ? '+' : ''}${wi.fuel}%</b>`, `<input type="range" id="wi-fuel" min="-20" max="40" step="5" value="${wi.fuel}" data-change="wi" data-k="fuel" style="accent-color:#08264A">`)}
        ${U.field('wi-util', `${tt('تغير التشغيل', 'Utilization change')}: <b class="num">${wi.util > 0 ? '+' : ''}${wi.util}%</b>`, `<input type="range" id="wi-util" min="-30" max="30" step="5" value="${wi.util}" data-change="wi" data-k="util" style="accent-color:#08264A">`)}
        ${U.field('wi-maint', `${tt('توفير في الصيانة', 'Maintenance savings')}: <b class="num">${wi.maint}%</b>`, `<input type="range" id="wi-maint" min="0" max="40" step="5" value="${wi.maint}" data-change="wi" data-k="maint" style="accent-color:#08264A">`)}
        ${U.field('wi-rep', tt('استبدال مركبة بجديدة', 'Replace a vehicle with a new one'), `<select id="wi-rep" data-change="wi" data-k="replace"><option value="">${tt('بدون', 'None')}</option>${db.vehicles.map(v => `<option value="${v.id}" ${wi.replace === v.id ? 'selected' : ''}>${v.code} · ${U.vtype(v.type)}</option>`).join('')}</select>`)}
      </div><div class="sep"></div><div class="table-wrap"><table class="dt"><thead><tr><th></th><th class="n">${tt('الفعلي', 'Actual')}</th><th class="n">${tt('السيناريو', 'Scenario')} ${U.est()}</th><th class="n">${tt('الفرق', 'Change')}</th></tr></thead><tbody>${[[tt('الإيراد', 'Revenue'), T.revenue, sc.revenue], [tt('الوقود', 'Fuel'), T.fuel, sc.fuel], [tt('صيانة وزيت', 'Maintenance & oil'), T.maintenance + T.oil, sc.maint], [tt('إجمالي التكاليف', 'Total costs'), T.costs, sc.costs], [tt('صافي الربح', 'Net profit'), T.net, sc.net]].map(r => `<tr><td>${r[0]}</td><td class="n num">${M.n0(r[1])}</td><td class="n num">${M.n0(r[2])}</td><td class="n num ${r[2] - r[1] < 0 ? 'neg' : 'pos'}">${r[2] - r[1] > 0 ? '+' : ''}${M.n0(r[2] - r[1])}</td></tr>`).join('')}</tbody></table></div><div class="muted small" style="margin-top:8px">${tt('الافتراضات: الوقود والصيانة والمصاريف المتغيرة تتحرك مع التشغيل؛ التكاليف الثابتة لا تتغير. الاستبدال: سعر المركبة الجديدة = أعلى سعر للنوع، الصيانة تقل 70%، والإهلاك يتحسب على السعر الجديد.', 'Assumptions: fuel, maintenance and variable costs scale with utilization; fixed costs stay flat. Replacement: new price = top of the type range, maintenance drops 70%, depreciation recalculated on the new price.')}</div>`);
  });

  /* ---------- fuel intelligence ---------- */
  U.route('fuelai', () => {
    if (aiOff('fuel')) return offPage(tt('ذكاء الوقود', 'Fuel intelligence'));
    const cid = U.cid(), db = U.db();
    const fuelList = db.fuel.filter(f => f.date >= M.addDays(M.TODAY, -60)).map(f => ({ f, c: C.fuelCheck(cid, f), v: U.find('vehicles', f.vehicleId) })).filter(x => x.c.flag && !x.v._missing);
    const txs = db.providerTx.filter(x => x.kind === 'fuel' && x.flag && x.status === 'unmatched').map(x => ({ x, v: U.find('vehicles', x.vehicleId) }));
    const rec = flag => ({ consumption: tt('راجع العداد مع كم الـ GPS للفترة، وافحص المركبة لتسريب أو مشكلة حقن، وقارن بسلوك السائق.', 'Compare odometer with GPS km for the period, check the vehicle for leaks or injector issues, and review driver behavior.'), duplicate: tt('غالباً إدخال مكرر. تأكد من إيصال المحطة واحذف واحدة بعد المراجعة.', 'Likely a double entry. Check the station receipt and remove one after review.'), tank: tt('الكمية أكبر من سعة التانك. راجع الإيصال وقراءة العداد.', 'Quantity exceeds tank size. Check the receipt and odometer.'), location_mismatch: tt('موقع المحطة بعيد عن مكان المركبة على الـ GPS وقت المعاملة. راجع الكارت.', 'Station was far from the vehicle’s GPS position at that time. Review the card.'), outside_hours: tt('معاملة خارج ساعات الكارت المسموحة. راجع مع السائق.', 'Transaction outside the card’s allowed hours. Check with the driver.') }[flag]);
    return U.head(tt('ذكاء الوقود — كشف الحالات الشاذة', 'Fuel intelligence — anomaly detection'), tt('مقارنة اللترات والعداد وكم الـ GPS وكم/لتر وتكلفة الكيلو وسعة التانك وموقع المعاملة بمعايير نوع المركبة. الحالة الشاذة ليست دليل على تلاعب.', 'Liters, odometer, GPS km, km/L, cost/km, tank size and transaction location are compared with vehicle-type benchmarks. An anomaly is not proof of fraud.'), U.ai()) +
      U.kpis([U.kpi(tt('حالات آخر 60 يوم', 'Cases (60 days)'), fuelList.length + txs.length), U.kpi(tt('استهلاك غير طبيعي', 'Abnormal consumption'), fuelList.filter(x => x.c.flag === 'consumption').length), U.kpi(tt('مكررة', 'Duplicates'), fuelList.filter(x => x.c.flag === 'duplicate').length), U.kpi(tt('موقع/وقت مشكوك', 'Location/time'), txs.length), U.kpi(tt('حد الانحراف', 'Deviation limit'), M.pct(db.settings.fuelDeviation, 0))]) +
      [...fuelList.map(x => ({ date: x.f.date, v: x.v, flag: x.c.flag, base: x.c.base, actual: x.c.actual, dev: x.c.dev, amount: x.f.total, dq: x.f.source === 'manual' ? tt('إدخال يدوي — ثقة أقل في البيانات', 'Manual entry — lower data confidence') : '' })), ...txs.map(t => ({ date: t.x.date, v: t.v, flag: t.x.flag, base: null, actual: null, dev: null, amount: t.x.amount, dq: tt('معاملة مزود غير مطابقة', 'Unmatched provider transaction') }))].sort((a, b) => a.date < b.date ? 1 : -1).map(x => `<div class="card" style="padding:14px 16px;margin-bottom:10px;display:grid;gap:6px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b><a href="#vehicle.${x.v.id}">${x.v.code}</a> · ${M.date(x.date)} · ${M.money(x.amount)}</b>${U.badge(U.flagName(x.flag), 'danger')}</div>${x.base ? `<div class="small"><span class="muted">${tt('المعيار', 'Baseline')}</span> <b class="num">${M.n2(x.base)}</b> ${tt('كم/لتر', 'km/L')} · <span class="muted">${tt('الفعلي', 'Actual')}</span> <b class="num">${M.n2(x.actual)}</b> · <span class="muted">${tt('الانحراف', 'Deviation')}</span> <b class="num neg">${M.pct(x.dev, 0)}</b></div>` : ''}${x.dq ? `<div class="small"><span class="tag-est">${x.dq}</span></div>` : ''}<div class="small">${U.icon('sparkles').replace('<svg class=""', '<svg style="width:13px;height:13px;vertical-align:-2px"')} ${rec(x.flag)}</div></div>`).join('');
  });

  /* ---------- maintenance intelligence ---------- */
  U.route('maintai', () => {
    if (aiOff('maintenance')) return offPage(tt('ذكاء الصيانة', 'Maintenance intelligence'));
    const cid = U.cid(), db = U.db();
    const rows = db.vehicles.filter(v => v.status !== 'sold').map(v => {
      const d = C.dep(v); const o = C.oilStatus(cid, v); const wos = db.workOrders.filter(w => w.vehicleId === v.id);
      const recent = wos.filter(w => w.date >= M.addDays(M.TODAY, -90)).length, older = wos.filter(w => w.date < M.addDays(M.TODAY, -90)).length;
      const f = { age: Math.min(1, d.pctYears) * 30, km: Math.min(1, d.pctKm) * 20, repairs: Math.min(1, wos.length / 5) * 25, oil: o ? (o.state === 'overdue' ? 15 : o.state === 'soon' ? 8 : 0) : 0, trend: recent > older / 1.5 ? 10 : 0 };
      const score = Math.round(f.age + f.km + f.repairs + f.oil + f.trend);
      const m6 = M.sum(wos.filter(w => w.date >= M.addDays(M.TODAY, -183)), w => w.total);
      const vc = M.vehicleClasses[v.type] || {}; const newPrice = (vc.price && vc.price[1]) || v.purchasePrice;
      const keepCost = m6 * 2 + C.dep(v).annual; const newCost = (newPrice - newPrice * (vc.salvagePct || 0.15)) / (vc.lifeYears || 10) + m6 * 0.6;
      return { v, d, o, f, score, m6, keepCost, newCost, tires: db.tires.filter(t => t.vehicleId === v.id && t.tread != null && t.tread < 4).length };
    }).sort((a, b) => b.score - a.score);
    const lvl = s => s >= 60 ? ['danger', tt('مرتفع', 'High')] : s >= 40 ? ['warning', tt('متوسط', 'Medium')] : ['success', tt('منخفض', 'Low')];
    return U.head(tt('ذكاء الصيانة', 'Maintenance intelligence'), tt('مؤشر مخاطر قابل للتفسير من العمر والكيلومترات وتاريخ الإصلاح والزيت واتجاه التكلفة. هو مؤشر استرشادي وليس احتمال عطل مثبت.', 'An explainable risk indicator from age, km, repair history, oil status and cost trend. It is a heuristic, not a proven failure probability.'), U.ai()) +
      U.card(null, U.table({ id: 'maintai', rows, columns: [
        { label: tt('المركبة', 'Vehicle'), value: r => r.v.code, render: r => U.vLabel(r.v) },
        { label: tt('مؤشر المخاطر', 'Risk indicator'), num: 1, value: r => r.score, render: r => `${U.badge(lvl(r.score)[1], lvl(r.score)[0])} <span class="num">${r.score}</span>` },
        { label: tt('سبب المؤشر', 'Why'), sort: false, render: r => `<span class="small">${[[tt('عمر', 'age'), r.f.age], [tt('كم', 'km'), r.f.km], [tt('إصلاحات', 'repairs'), r.f.repairs], [tt('زيت', 'oil'), r.f.oil], [tt('اتجاه', 'trend'), r.f.trend]].filter(x => x[1] > 0).map(x => `${x[0]} <b class="num">${Math.round(x[1])}</b>`).join(' · ')}</span>` },
        { label: tt('اقتراح الخدمة القادمة', 'Suggested next service'), sort: false, render: r => `<span class="small">${[r.o && r.o.state !== 'ok' ? tt('تغيير زيت وفلاتر', 'Oil & filters') : '', r.tires ? tt(`تغيير ${r.tires} كاوتش`, `Replace ${r.tires} tires`) : '', r.f.repairs > 15 ? tt('فحص عفشة وفرامل شامل', 'Full suspension & brake check') : ''].filter(Boolean).join('، ') || '—'}</span>` },
        { label: tt('نكمل أم نستبدل', 'Keep or replace'), sort: false, render: r => r.keepCost > r.newCost * 1.1 || r.d.pctLife > 0.9 ? U.badge(tt('الاستبدال أوفر', 'Replacing is cheaper'), 'danger') : U.badge(tt('الاستمرار أوفر', 'Keeping is cheaper'), 'success') },
        { label: tt('تكلفة سنوية: الحالية / الجديدة', 'Annual cost: current / new'), num: 1, value: r => r.keepCost, render: r => `${M.moneyK(r.keepCost)} / ${M.moneyK(r.newCost)}` },
      ], onRow: r => 'vehicle.' + r.v.id }), { flush: true }) + `<div class="muted small" style="margin-top:8px">${tt('التكلفة السنوية الحالية = صيانة آخر 6 شهور × 2 + الإهلاك. الجديدة = إهلاك سعر مركبة جديدة + 60% من الصيانة الحالية. أرقام تقديرية.', 'Current annual cost = last 6 months maintenance × 2 + depreciation. New = depreciation on a new vehicle price + 60% of current maintenance. Estimates.')}</div>`;
  });

  /* ---------- smart pricing ---------- */
  const pq = { type: 'MB', route: 'CAI|ALX', hours: 4, empty: 20, margin: 25, days: 1 };
  U.act('pq', el => { pq[el.dataset.k] = el.type === 'number' || el.type === 'range' ? +el.value : el.value; U.render(); });
  U.route('pricing', () => {
    if (aiOff('pricing')) return offPage(tt('التسعير الذكي', 'Smart pricing'));
    const cid = U.cid();
    const allRoutes = (M.allRoutes || []).filter((r, i, a) => a.findIndex(x => x.from === r.from && x.to === r.to) === i);
    if (!allRoutes.length || !Object.keys(M.vehicleClasses).length) return U.head(tt('التسعير الذكي', 'Smart pricing'), '') + U.empty('route', tt('أضف أنواع المركبات والمسارات أولاً', 'Set up vehicle types and routes first'), `<a class="btn secondary" href="#geofences">${tt('الأماكن والمسارات', 'Places & routes')}</a>`);
    if (!M.vehicleClasses[pq.type]) pq.type = Object.keys(M.vehicleClasses)[0];
    const route = allRoutes.find(r => `${r.from}|${r.to}` === pq.route) || allRoutes[0];
    const tolls = route.gates * (M.vehicleClasses[pq.type].tollGate || 0);
    const q = C.quote(cid, { type: pq.type, km: route.km, hours: pq.hours || route.hours, tolls, emptyKm: pq.empty, margin: pq.margin / 100, days: pq.days });
    return U.head(tt('التسعير الذكي', 'Smart pricing'), tt('المبالغ محسوبة بدوال ثابتة من تكلفة الكيلو الفعلية لنوع المركبة؛ الذكاء الاصطناعي يشرح فقط. أي اعتماد أو تعديل يتسجل في سجل العمليات.', 'Amounts come from fixed functions using the vehicle type’s actual cost per km; AI only explains. Every approval or override is written to the audit log.'), U.ai()) +
      `<div class="cols-2">` + U.card(tt('بيانات الرحلة', 'Trip details'), `<div class="form">
        ${U.field('pq-type', tt('نوع المركبة', 'Vehicle type'), `<select id="pq-type" data-change="pq" data-k="type">${Object.keys(M.vehicleClasses).map(k => `<option value="${k}" ${pq.type === k ? 'selected' : ''}>${U.vtype(k)}</option>`).join('')}</select>`)}
        ${U.field('pq-route', tt('المسار', 'Route'), `<select id="pq-route" data-change="pq" data-k="route">${allRoutes.map(r => `<option value="${r.from}|${r.to}" ${pq.route === r.from + '|' + r.to ? 'selected' : ''}>${U.routeTxt(r.from, r.to)} (${r.km} ${tt('كم', 'km')})</option>`).join('')}</select>`)}
        ${U.field('pq-days', tt('عدد الأيام', 'Days'), `<input type="number" id="pq-days" min="1" max="15" value="${pq.days}" data-change="pq" data-k="days">`)}
        ${U.field('pq-empty', tt('كيلومترات فاضية', 'Empty km'), `<input type="number" id="pq-empty" min="0" value="${pq.empty}" data-change="pq" data-k="empty">`, { help: tt('من الجراج لنقطة الاستلام والعودة', 'Garage to pickup and back') })}
        ${U.field('pq-margin', `${tt('الهامش المستهدف', 'Target margin')}: <b class="num">${pq.margin}%</b>`, `<input type="range" id="pq-margin" min="5" max="50" step="5" value="${pq.margin}" data-change="pq" data-k="margin" style="accent-color:#08264A">`, { full: true })}
      </div>`) +
      U.card(tt('عرض السعر', 'Quotation'), U.dl([[tt('وقود', 'Fuel'), `${M.money(q.fuel)} <span class="muted small">(${M.n2(q.fuelKm)}/${tt('كم', 'km')})</span>`], [tt('صيانة وزيت', 'Maintenance & oil'), `${M.money(q.maint)} <span class="muted small">(${M.n2(q.maintKm)}/${tt('كم', 'km')})</span>`], [tt('كارتة متوقعة', 'Expected tolls'), M.money(q.tolls)], [tt('حصة التكاليف الثابتة', 'Fixed cost share'), `${M.money(q.fixed)} <span class="muted small">(${M.money(q.fixedDay)}/${tt('يوم', 'day')})</span>`], [tt('سعر التعادل', 'Break-even price'), `<b>${M.money(q.breakEven)}</b>`], [tt('السعر المقترح', 'Recommended price'), `<b style="font-size:20px" class="num">${M.money(q.price)}</b>`], [tt('الهامش المتوقع', 'Expected margin'), M.pct(q.margin)]]) +
        `<div class="small" style="margin-top:10px">${U.icon('sparkles').replace('<svg class=""', '<svg style="width:13px;height:13px;vertical-align:-2px"')} ${tt(`السعر مبني على ${M.n0(route.km + pq.empty)} كم منها ${pq.empty} فاضية. التكلفة الثابتة هي أكبر بند في الرحلات القصيرة، فلو العميل طلب خصم، الأفضل تجمع رحلتين في نفس اليوم على نفس المركبة.`, `Based on ${M.n0(route.km + pq.empty)} km including ${pq.empty} empty. Fixed cost dominates on short trips, so if the client asks for a discount, pair two trips the same day on one vehicle.`)}</div>` +
        `<div class="form" style="margin-top:12px">${U.field('pq-final', tt('السعر النهائي', 'Final price'), U.input('pq-final', q.price, 'number'))}${U.field('pq-reason', tt('سبب التعديل (لو مختلف)', 'Reason if changed'), U.input('pq-reason', ''))}<div class="field" style="align-self:end"><button class="btn" data-act="approve-price" data-p="${q.price}" data-r="${M.esc(U.routeTxt(route.from, route.to).replace(/<[^>]+>/g, ''))}" style="width:100%">${U.icon('check')}${tt('اعتماد السعر', 'Approve price')}</button></div></div><p class="muted small">${tt('السعر المقترح يعتمد على بيانات التكلفة الفعلية للمركبات من نفس النوع؛ لو مفيش تاريخ تشغيل يكون التقدير أقل دقة.', 'The suggestion uses the actual cost history of vehicles of this type; with little operating history it is less precise.')}</p>`) + `</div>`;
  });
  U.act('approve-price', async el => {
    const fin = +U.val('pq-final'); const rec = +el.dataset.p;
    try { await M.api.do('ai.log', { feature: 'pricing' }); } catch (e) { /* usage counting only */ }
    U.run('price.approve', { suggested: rec, approved: fin, reason: U.val('pq-reason'), ref: `${pq.type} ${el.dataset.r}` }, { ok: fin === rec ? tt('تم اعتماد السعر وتسجيله', 'Price approved and logged') : tt('تم تسجيل تعديل السعر في سجل العمليات', 'Price override written to the audit log'), after: () => U.render() });
  });

  /* ---------- document intake ----------
     The file is stored with the record; the reviewer types the key fields. Automatic text
     extraction (OCR / AI reading) is NOT included — it needs an OCR or AI provider. */
  U.route('docai', () => {
    if (aiOff('documents')) return offPage(tt('قراءة المستندات', 'Document intelligence'));
    const db = U.db(); const recent = db.documents.filter(d => d.uploaded).slice(0, 12);
    return U.head(tt('استلام المستندات', 'Document intake'), tt('ارفع رخصة أو تأمين أو عقد أو إيصال، وسجّل بياناته الأساسية بعد مراجعتها. الملف يتحفظ في مساحة الشركة ويحدّث تاريخ الانتهاء في ملف المركبة/السائق.', 'Upload a license, insurance, contract or receipt and record its key fields after review. The file is stored in the company space and updates the expiry on the vehicle/driver record.')) +
      `<div class="form-error info" role="status">${U.icon('scan')}<div>${tt('القراءة الآلية للنص (OCR) غير مفعّلة في هذا الإصدار — الحقول تُدخل يدوياً بعد المراجعة.', 'Automatic text reading (OCR) is not enabled in this release — fields are entered by hand after review.')}</div></div>` +
      `<div class="cols-2">` + U.card(tt('مستند جديد', 'New document'), `<p class="small">${tt('اضغط لرفع الملف وتسجيل بياناته.', 'Click to upload the file and record its data.')}</p>${U.btn(tt('رفع مستند', 'Upload document'), 'doc-upload', '', 'upload')}`) +
      U.card(tt('آخر المستندات المرفوعة', 'Recently uploaded'), recent.length ? recent.map(d => `<div class="list-row"><div class="grow"><div class="t">${M.esc(d.fileName || d.kind)}</div><div class="s">${M.esc(d.kind)} · ${M.date(d.expiry)} · ${M.esc(d.createdBy || '')}</div></div>${d.fileName ? `<a class="btn ghost sm" href="/api/documents/${d.id}/file" target="_blank" rel="noopener">${tt('فتح', 'Open')}</a>` : ''}</div>`).join('') : `<p class="muted small">${tt('لا توجد مستندات مرفوعة بعد.', 'No documents uploaded yet.')}</p>`) + `</div>`;
  });

  /* ---------- inventory intelligence ---------- */
  U.route('invai', () => {
    if (aiOff('inventory')) return offPage(tt('ذكاء المخزون', 'Inventory intelligence'));
    const cid = U.cid(), db = U.db();
    const upcomingOil = db.vehicles.filter(v => { const o = C.oilStatus(cid, v); return o && o.remaining < 3000; });
    const rows = db.items.map(it => {
      const hist = C.itemUsage(cid, it.id, 90) / 3;
      let planned = 0; const fits = upcomingOil.filter(v => (it.compatible || []).includes(v.type));
      if (it.category === 'oils') { const siblings = db.items.filter(x => x.category === 'oils').length || 1; planned = M.sum(fits, v => (M.vehicleClasses[v.type] || {}).oilLiters || 0) / siblings; }
      if (it.category === 'filters') { const siblings = db.items.filter(x => x.category === 'filters' && (x.compatible || []).some(t => fits.some(v => v.type === t))).length || 1; planned = fits.length / siblings; }
      const forecast = hist + planned; const s = C.stockOf(cid, it.id).qty;
      const suggest = Math.max(0, Math.ceil(forecast * 1.5 + it.minStock - s));
      const priceUp = it.lastPrice > it.avgCost * 1.08;
      return { it, hist, planned, forecast, s, suggest, priceUp, cover: forecast ? s / forecast * 30 : 999 };
    }).sort((a, b) => a.cover - b.cover);
    return U.head(tt('ذكاء المخزون', 'Inventory intelligence'), tt('توقع طلب القطع من الصرف التاريخي والصيانات القادمة، واقتراح كمية وموعد الطلب. طلبات الشراء مسودات حتى الاعتماد.', 'Forecasts parts demand from usage history and upcoming services and suggests what and when to order. Purchase requests stay drafts until approved.'), U.ai()) +
      U.card(null, U.table({ id: 'invai', rows, columns: [
        { label: tt('الصنف', 'Item'), value: r => M.L(r.it.name), render: r => `<a href="#item.${r.it.id}">${M.L(r.it.name)}</a>` },
        { label: tt('الرصيد', 'On hand'), num: 1, value: r => r.s, render: r => M.n0(r.s) },
        { label: tt('صرف شهري تاريخي', 'Monthly historic use'), num: 1, value: r => r.hist, render: r => M.n1(r.hist) },
        { label: tt('صيانات قادمة', 'Upcoming services'), num: 1, value: r => r.planned, render: r => r.planned ? M.n1(r.planned) : '—' },
        { label: tt('يكفي (يوم)', 'Cover (days)'), num: 1, value: r => r.cover, render: r => r.cover > 365 ? '365+' : `<span class="${r.cover < 30 ? 'neg' : ''}">${M.n0(r.cover)}</span>` },
        { label: tt('كمية مقترحة', 'Suggested qty'), num: 1, value: r => r.suggest, render: r => r.suggest ? `<b>${r.suggest}</b>` : '—' },
        { label: tt('ملاحظات', 'Notes'), sort: false, render: r => [r.priceUp ? U.badge(tt('سعر المورد زاد', 'Supplier price up'), 'warning') : '', r.hist === 0 && r.s > 0 ? U.badge(tt('راكد', 'Slow moving'), 'muted') : ''].join(' ') },
        { label: '', sort: false, render: r => r.suggest ? `<button class="btn ghost sm" data-act="create-po" data-item="${r.it.id}" data-q="${r.suggest}">${tt('مسودة طلب', 'Draft request')}</button>` : '' },
      ] }), { flush: true }) + disclaimer();
  });

  /* ---------- tracking & reconciliation intelligence ---------- */
  U.route('reconai', () => {
    if (aiOff('reconciliation')) return offPage(tt('ذكاء التتبع والمطابقة', 'Tracking & matching AI'));
    const cid = U.cid(), db = U.db();
    const un = db.providerTx.filter(x => x.status === 'unmatched').map(x => { const cands = db.trips.filter(t => t.vehicleId === x.vehicleId && Math.abs(M.diffDays(t.date, x.date)) <= 1 && t.status === 'completed'); const best = cands.sort((a, b) => Math.abs(M.diffDays(a.date, x.date)) - Math.abs(M.diffDays(b.date, x.date)))[0]; const conf = !best ? 'none' : best.date === x.date && !x.flag ? 'high' : best.date === x.date ? 'medium' : 'low'; return { x, best, conf }; });
    const coach = db.drivers.map(d => ({ d, s: C.driverStats(cid, d, M.addDays(M.TODAY, -30)) })).filter(r => r.s.events >= 3).sort((a, b) => b.s.events - a.s.events).slice(0, 4);
    const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })(); const toMin = s => (+s.slice(0, 2)) * 60 + (+s.slice(3, 5));
    const running = db.trips.filter(t => t.date === M.TODAY && (t.status === 'running' || t.status === 'scheduled')).map(t => { const late = t.status === 'scheduled' && nowMin > toMin(t.startTime) + 10 ? nowMin - toMin(t.startTime) : 0; const v = U.find('vehicles', t.vehicleId); const reason = t.flightStatus === 'delayed' ? 'flight' : t.flightStatus === 'cancelled' ? 'flightx' : late ? 'late' : v.status === 'maintenance' ? 'shop' : null; return { t, late, reason }; }).filter(x => x.reason);
    const confB = { high: ['success', tt('ثقة عالية', 'High confidence')], medium: ['warning', tt('ثقة متوسطة', 'Medium confidence')], low: ['warning', tt('ثقة منخفضة', 'Low confidence')], none: ['danger', tt('لا يوجد تطابق', 'No match')] };
    return U.head(tt('ذكاء التتبع والمطابقة', 'Tracking & matching intelligence'), tt('اقتراح ربط معاملات الوقود والكارتة غير المطابقة بالرحلات بالمركبة والوقت والمسار، وملخصات تدريب للسائقين، وتوقع التأخير.', 'Suggests trip matches for unmatched fuel and toll transactions using vehicle, time and route; driver coaching summaries; delay prediction.'), U.ai()) +
      U.card(tt('اقتراحات المطابقة', 'Match suggestions'), un.map(u => `<div class="list-row"><div class="grow"><div class="t">${u.x.kind === 'fuel' ? tt('وقود', 'Fuel') : tt('كارتة', 'Toll')} · ${U.find('vehicles', u.x.vehicleId).code} · ${M.date(u.x.date)} ${u.x.time} · ${M.money(u.x.amount)}</div><div class="s">${u.best ? `${tt('مقترح', 'Suggested')}: <a href="#trip.${u.best.id}">${u.best.number}</a> · ${U.routeTxt(u.best.from, u.best.to)}` : tt('لا توجد رحلة للمركبة في هذا الوقت — احتمال استخدام غير مصرح', 'No trip for this vehicle at that time — possible unauthorized use')}${u.x.flag ? ' · ' + U.flagName(u.x.flag) : ''}</div></div>${U.badge(confB[u.conf][1], confB[u.conf][0])}${u.best ? `<button class="btn sm" data-act="match-tx" data-id="${u.x.id}" data-t="${u.best.id}">${tt('تأكيد', 'Confirm')}</button>` : `<a class="btn secondary sm" href="#reconcile">${tt('مراجعة', 'Review')}</a>`}</div>`).join('') || U.empty('check', tt('كل المعاملات مطابقة', 'Everything is matched'))) + '<div style="height:16px"></div>' +
      `<div class="cols-2">` + U.card(tt('ملخصات تدريب السائقين', 'Driver coaching summaries'), coach.map(r => { const top = Object.entries(r.s.eventsByType).sort((a, b) => b[1] - a[1])[0]; return `<div class="list-row"><div class="grow"><div class="t">${U.dLabel(r.d)} · <span class="score ${r.s.score >= 85 ? 'g' : r.s.score >= 70 ? 'w' : 'b'}">${r.s.score}</span></div><div class="s" style="white-space:normal">${tt(`${r.s.events} أحداث في 30 يوم، أكثرها ${(U.evNames[top[0]] || [top[0], top[0]])[0]} (${top[1]}). اقتراح: جلسة توعية قصيرة ومتابعة أسبوعين.`, `${r.s.events} events in 30 days, mostly ${(U.evNames[top[0]] || [top[0], top[0]])[1].toLowerCase()} (${top[1]}). Suggest a short coaching session and two weeks of follow-up.`)}</div></div></div>`; }).join('') || U.empty('check', tt('لا يوجد سائقين محتاجين متابعة', 'No drivers need coaching'))) +
      U.card(tt('رحلات اليوم المعرضة للتأخير', 'Today’s trips at risk of delay'), running.map(x => `<div class="list-row"><span class="sev ${x.reason === 'late' || x.reason === 'shop' ? 'high' : 'medium'}"></span><div class="grow"><div class="t"><a href="#trip.${x.t.id}">${x.t.number}</a> · ${x.t.startTime} · ${U.routeTxt(x.t.from, x.t.to)}</div><div class="s">${({ flight: tt(`الطيران ${x.t.flight} متأخر`, `Flight ${x.t.flight} is delayed`), flightx: tt(`الطيران ${x.t.flight} ملغي`, `Flight ${x.t.flight} is cancelled`), late: tt(`الرحلة لم تبدأ ومتأخرة ${x.late} دقيقة`, `Not started, ${x.late} min past pickup time`), shop: tt('المركبة في الصيانة', 'The vehicle is in the workshop') })[x.reason]}</div></div></div>`).join('') || U.empty('check', tt('لا توجد رحلات معرضة للتأخير الآن', 'No trips at risk right now'))) + `</div>` + disclaimer();
  });
  U.act('match-tx', el => { const x = U.find('providerTx', el.dataset.id); if (x.kind === 'fuel') { location.hash = 'reconcile'; return; } U.run('providerTx.match', { id: x.id, target: 'trip', targetId: el.dataset.t }, { ok: tt('تمت المطابقة وإنشاء المصروف والقيد', 'Matched; expense and journal entry created') }); });

  /* ---------- executive insights ---------- */
  U.route('insights', () => {
    if (aiOff('insights')) return offPage(tt('رؤى الإدارة', 'Executive insights'));
    const cid = U.cid(), db = U.db();
    const al = C.alerts(cid);
    const m = C.months(); const lm = m[m.length - 2] || m[m.length - 1], pm = m[m.length - 3] || lm; const [a1, b1] = C.monthRange(lm); const [a0, b0] = C.monthRange(pm);
    const cur = C.fleetPL(cid, a1, b1).total, prev = C.fleetPL(cid, a0, b0).total;
    const ag = C.aging(cid);
    const tom = M.addDays(M.TODAY, 1);
    const items = [
      { p: 1, kind: 'calc', icon: 'ticket', t: tt(`${db.bookings.filter(b => b.unassigned).length} حجوزات بدون مركبة لليوم وبكرة`, `${db.bookings.filter(b => b.unassigned).length} bookings without a vehicle for today and tomorrow`), a: tt('افتح التوزيع الذكي واعتمد الخطة', 'Open smart assignment and approve the plan'), link: 'assign' },
      { p: 1, kind: 'calc', icon: 'wallet', t: tt(`${M.money(ag.b60 + ag.b90)} مستحقات متأخرة أكتر من 60 يوم`, `${M.money(ag.b60 + ag.b90)} receivables over 60 days`), a: tt('تواصل مع أكبر 3 عملاء متأخرين هذا الأسبوع', 'Call the top 3 overdue clients this week'), link: 'report.aging' },
      { p: 2, kind: 'calc', icon: 'trend', t: tt(`صافي الربح ${cur.net >= prev.net ? 'زاد' : 'قل'} ${M.pct((cur.net - prev.net) / Math.abs(prev.net || 1))} في ${M.monthName(lm)} عن الشهر اللي قبله`, `Net profit ${cur.net >= prev.net ? 'rose' : 'fell'} ${M.pct((cur.net - prev.net) / Math.abs(prev.net || 1))} in ${M.monthName(lm)} vs the month before`), a: tt('راجع مستشار الربحية', 'Review the profitability advisor'), link: 'profit' },
      { p: 2, kind: 'est', icon: 'wrench', t: tt(`${al.filter(x => x.cat === 'oil' || x.cat === 'maintenance').length} مركبات محتاجة زيت أو صيانة قريباً`, `${al.filter(x => x.cat === 'oil' || x.cat === 'maintenance').length} vehicles need oil or service soon`), a: tt('احجز مواعيد مع مزود الخدمة', 'Book slots with the service provider'), link: 'maintai' },
      { p: 2, kind: 'calc', icon: 'fuel', t: tt(`${al.filter(x => x.cat === 'fuel').length} تفويلات و${db.providerTx.filter(x => x.status === 'unmatched').length} معاملات مزود محتاجة مراجعة`, `${al.filter(x => x.cat === 'fuel').length} fill-ups and ${db.providerTx.filter(x => x.status === 'unmatched').length} provider transactions need review`), a: tt('افتح ذكاء الوقود والمطابقة', 'Open fuel intelligence and matching'), link: 'fuelai' },
      { p: 3, kind: 'calc', icon: 'box', t: tt(`${al.filter(x => x.cat === 'stock').length} أصناف تحت حد الطلب أو نفدت`, `${al.filter(x => x.cat === 'stock').length} items are below reorder or out`), a: tt('اعتمد مسودات طلبات الشراء', 'Approve the draft purchase requests'), link: 'invai' },
      { p: 3, kind: 'calc', icon: 'car', t: tt(`${db.vehicles.filter(v => C.readiness(cid, v).ready).length} من ${db.vehicles.length} مركبات جاهزة لبكرة، و${db.trips.filter(t => t.date === tom && t.status === 'scheduled').length} رحلة مجدولة`, `${db.vehicles.filter(v => C.readiness(cid, v).ready).length} of ${db.vehicles.length} vehicles ready for tomorrow, ${db.trips.filter(t => t.date === tom && t.status === 'scheduled').length} trips scheduled`), a: tt('راجع الجاهزية', 'Review readiness'), link: 'readiness' },
    ];
    const s = C.monthlySeries(cid);
    return U.head(tt('رؤى الإدارة', 'Executive insights'), `${tt('ملخص يوم', 'Daily summary for')} ${M.date(M.TODAY)}`, `${U.btn(tt('تحديث', 'Refresh'), 'refresh-ins', 'secondary', 'refresh')}${U.ai()}`) +
      U.kpis([U.kpi(tt('رحلات اليوم', 'Trips today'), db.trips.filter(t => t.date === M.TODAY && t.status !== 'cancelled').length), U.kpi(tt('إيراد الشهر الماضي', 'Last month revenue'), M.moneyK(cur.revenue), `<span class="${cur.revenue >= prev.revenue ? 'delta-up' : 'delta-down'}">${prev.revenue ? M.pct((cur.revenue - prev.revenue) / prev.revenue) : '—'}</span>`), U.kpi(tt('صافي الربح الشهر الماضي', 'Last month net profit'), M.moneyK(cur.net), `<span class="${cur.net >= prev.net ? 'delta-up' : 'delta-down'}">${M.pct((cur.net - prev.net) / Math.abs(prev.net || 1))}</span>`), U.kpi(tt('تنبيهات عالية', 'High alerts'), al.filter(x => x.sev === 'high').length)]) +
      `<div class="cols-2-1">` + U.card(tt('إجراءات مرتبة بالأولوية', 'Prioritized actions'), items.map(x => `<div class="list-row"><b class="num" style="width:20px">${x.p}</b><div class="grow"><div class="t" style="white-space:normal">${x.t}</div><div class="s">${x.a} · ${x.kind === 'calc' ? U.ver() : U.est()}</div></div><a class="btn ghost sm" href="#${x.link}">${tt('فتح', 'Open')}</a></div>`).join('')) +
      U.card(tt('اتجاه الإيراد والتكاليف', 'Revenue & cost trend'), U.chart('ch-ins', { type: 'line', label: 'trend', data: { labels: s.map(x => M.monthName(x.ym)), datasets: [{ label: tt('الإيراد', 'Revenue'), data: s.map(x => Math.round(x.revenue)) }, { label: tt('التكاليف', 'Costs'), data: s.map(x => Math.round(x.costs)) }] } })) + `</div>` + disclaimer();
  });
  U.act('refresh-ins', () => { C.clear(); U.toast(tt('تم التحديث', 'Refreshed')); U.render(); });
})();
