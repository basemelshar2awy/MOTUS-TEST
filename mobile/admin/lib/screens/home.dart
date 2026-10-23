import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'bookings.dart';
import 'login.dart';
import 'routes.dart';
import 'shell.dart';

/// The dashboard's headline figures (computed on the server by the dashboard's own code), what needs
/// action, the last six months and the next trips.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Loader<J>(
      key: ValueKey('home-${s.snap?['version']}-${s.company['id']}-${s.lang}'),
      load: () async => obj(await s.api.get('/api/mobile/home')),
      builder: (ctx, h, reload) => _Home(h: h, reload: reload),
    );
  }
}

class _Home extends StatelessWidget {
  final J h;
  final Future<void> Function() reload;
  const _Home({required this.h, required this.reload});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final k = obj(h['kpis']);
    final al = obj(h['alerts']);
    final bk = obj(h['bookings']);
    final rc = obj(h['receivables']);
    final fl = obj(h['fleet']);
    final series = list(h['series']);
    final top = list(al['top']);
    final change = h['kpis'] == null ? null : k['revenueChange'];
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          await s.loadSnapshot();
          await reload();
        },
        child: ListView(padding: EdgeInsets.zero, children: [
          Container(
            color: Mc.navy,
            padding: EdgeInsets.fromLTRB(16, MediaQuery.of(context).padding.top + 10, 8, 26),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: InkWell(
                    onTap: () => _companySheet(context),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Flexible(child: Text(s.l(s.company['name']), overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16))),
                        const Icon(Icons.expand_more, color: Colors.white),
                      ]),
                    ),
                  ),
                ),
                IconButton(tooltip: s.tt('المساعد الذكي', 'Copilot'), color: Colors.white, icon: const Icon(Icons.smart_toy_outlined), onPressed: () => openRoute(context, 'copilot', title: s.tt('المساعد الذكي', 'Copilot'))),
                IconButton(
                  tooltip: s.tt('التنبيهات', 'Alerts'),
                  color: Colors.white,
                  icon: Badge(isLabelVisible: numv(al['total']) > 0, label: Text(n0(al['total'])), child: const Icon(Icons.notifications_none)),
                  onPressed: () => openRoute(context, 'alerts'),
                ),
              ]),
              Text('${roleName(s, s.role)} · ${s.activities.map(s.actName).join(' + ')}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
              const SizedBox(height: 14),
              Text(s.tt('الشهر الحالي', 'This month'), style: const TextStyle(color: Colors.white70, fontSize: 13)),
              if (h['kpis'] != null)
                Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text(n0(k['revenue']), style: numStyle.copyWith(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 6),
                  Padding(padding: const EdgeInsets.only(bottom: 5), child: Text(s.tt('إيراد', 'revenue'), style: const TextStyle(color: Colors.white, fontSize: 14))),
                  const Spacer(),
                  if (change != null)
                    Container(
                      margin: const EdgeInsets.only(left: 8, bottom: 4),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: .14), borderRadius: BorderRadius.circular(99)),
                      child: Text('${numv(change) >= 0 ? '+' : ''}${pct(change)}', style: numStyle.copyWith(color: Colors.white, fontSize: 13)),
                    ),
                ])
              else
                Text(s.tt('أضف مركبات علشان تظهر الأرقام', 'Add vehicles to see the figures'), style: const TextStyle(color: Colors.white)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.75,
                children: [
                  Kpi(s.tt('صافي الربح', 'Net profit'), h['kpis'] == null ? '—' : n0(k['net']), sub: h['kpis'] == null ? null : '${s.tt('هامش', 'Margin')} ${pct(k['margin'])}', subColor: numv(k['net']) < 0 ? Mc.danger : Mc.success),
                  Kpi(s.tt('نسبة التشغيل', 'Fleet utilization'), h['kpis'] == null ? '—' : pct(k['utilization'], 0), sub: '${n0(fl['vehicles'])} ${s.tt('مركبة', 'vehicles')} · ${n0(fl['inMaintenance'])} ${s.tt('صيانة', 'workshop')}'),
                  Kpi(s.tt('${s.unitsLabel} القادمة', 'Upcoming'), n0(bk['upcoming']), sub: '${n0(bk['unassigned'])} ${s.tt('من غير مركبة', 'unassigned')}', subColor: numv(bk['unassigned']) > 0 ? Mc.warning : null),
                  Kpi(s.tt('مستحق على العملاء', 'Receivables'), n0(rc['total']), sub: '${s.tt('متأخر', 'Overdue')} ${n0(rc['overdue30'])}', subColor: numv(rc['overdue30']) > 0 ? Mc.danger : null),
                ],
              ),
              const SizedBox(height: 12),
              Row(children: [
                if (canSee(s, 'bookings') && !s.readOnly) _Quick(Icons.add, s.tt('جديد', 'New'), () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BookingFormScreen()))),
                if (canSee(s, 'dispatch')) _Quick(Icons.view_timeline_outlined, s.tt('التوزيع', 'Dispatch'), () => openRoute(context, 'dispatch')),
                if (canSee(s, 'livemap')) _Quick(Icons.map_outlined, s.tt('الخريطة', 'Map'), () => openRoute(context, 'livemap')),
                if (canSee(s, 'invoices')) _Quick(Icons.receipt_long_outlined, s.tt('الفواتير', 'Invoices'), () => openRoute(context, 'invoices')),
              ]),
              const SizedBox(height: 12),
              if (top.isNotEmpty)
                Box(
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
                  child: Column(children: [
                    SectionTitle(s.tt('محتاج تتصرف فيه', 'Needs action'), trailing: TextButton(onPressed: () => openRoute(context, 'alerts'), child: Text(s.tt('الكل', 'All')))),
                    for (final a in top.take(4))
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        leading: Icon(Icons.circle, size: 10, color: a['sev'] == 'high' ? Mc.danger : (a['sev'] == 'medium' ? Mc.warning : Mc.chart4)),
                        title: Text(s.l(a['title']), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                        subtitle: Text(s.l(a['detail']), style: const TextStyle(fontSize: 12, color: Mc.muted)),
                        onTap: str(a['link']).isEmpty ? null : () => openRoute(context, str(a['link'])),
                      ),
                  ]),
                ),
              const SizedBox(height: 12),
              if (series.isNotEmpty)
                Box(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SectionTitle(s.tt('الإيراد والتكاليف', 'Revenue and costs'), trailing: Text(s.tt('آخر 6 شهور', 'Last 6 months'), style: const TextStyle(fontSize: 12, color: Mc.muted))),
                    _Bars(series: series),
                  ]),
                ),
              const SizedBox(height: 12),
              Box(
                padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
                child: Column(children: [
                  SectionTitle(s.tt('رحلات النهارده وبكرة', 'Trips today and tomorrow')),
                  if (list(h['trips']).isEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(s.tt('مفيش رحلات', 'No trips'), style: const TextStyle(color: Mc.muted))),
                  for (final t in list(h['trips']).take(8))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      title: Text('${t['date'] == h['today'] ? s.tt('النهارده', 'Today') : s.tt('بكرة', 'Tomorrow')} ${t['startTime']} · ${s.place(t['from'])} ← ${s.place(t['to'])}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                      subtitle: Text('${str(s.find('vehicles', t['vehicleId'])['code'])} · ${s.l(s.find('drivers', t['driverId'])['name'])}', style: const TextStyle(fontSize: 12)),
                      trailing: statusPill(s, str(t['status'])),
                      onTap: () => openRoute(context, 'trip.${t['id']}'),
                    ),
                ]),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  void _companySheet(BuildContext context) {
    final s = AppScope.read(context);
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          for (final c in s.companies)
            ListTile(
              leading: Icon(c['id'] == s.company['id'] ? Icons.radio_button_checked : Icons.radio_button_off, color: Mc.navy),
              title: Text(s.l(c['name'])),
              subtitle: Text(roleName(s, str(c['role']))),
              onTap: () async {
                Navigator.pop(ctx);
                if (c['id'] == s.company['id']) return;
                try {
                  await s.switchCompany(str(c['id']));
                } catch (e) {
                  if (context.mounted) showError(context, e);
                }
              },
            ),
        ]),
      ),
    );
  }
}

class _Quick extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _Quick(this.icon, this.label, this.onTap);
  @override
  Widget build(BuildContext context) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Box(
            padding: const EdgeInsets.symmetric(vertical: 10),
            onTap: onTap,
            child: Column(children: [Icon(icon, color: Mc.navy), const SizedBox(height: 4), Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))]),
          ),
        ),
      );
}

/// revenue bars with the net under them
class _Bars extends StatelessWidget {
  final List<J> series;
  const _Bars({required this.series});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final mx = series.map((x) => numv(x['revenue'])).fold<num>(1, (a, b) => b > a ? b : a);
    return Semantics(
      label: series.map((x) => '${x['label']}: ${n0(x['revenue'])}').join('، '),
      child: SizedBox(
        height: 120,
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          for (var i = 0; i < series.length; i++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                  Text(moneyK(series[i]['revenue'], s.currency, s.ar).split(' ').first, style: numStyle.copyWith(fontSize: 9, color: Mc.muted)),
                  Container(height: 80 * numv(series[i]['revenue']) / mx + 2, decoration: BoxDecoration(color: i == series.length - 1 ? Mc.navy : Mc.chart5, borderRadius: const BorderRadius.vertical(top: Radius.circular(4)))),
                  const SizedBox(height: 4),
                  Text(str(series[i]['label']).split(' ').first, maxLines: 1, overflow: TextOverflow.clip, style: const TextStyle(fontSize: 10, color: Mc.muted)),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}
