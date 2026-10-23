import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'routes.dart';

/// every alert the dashboard raises (documents, oil, maintenance, profit, stock, …), by priority
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});
  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  int _f = 0;
  static const _cats = {
    'docs': ['المستندات', 'Documents'], 'oil': ['الزيت', 'Oil'], 'life': ['العمر الافتراضي', 'Useful life'], 'profit': ['الربحية', 'Profitability'], 'maintenance': ['الصيانة', 'Maintenance'],
    'fuel': ['الوقود', 'Fuel'], 'stock': ['المخزون', 'Stock'], 'tires': ['الكاوتش', 'Tires'], 'dispatch': ['الحركة', 'Dispatch'], 'finance': ['المالية', 'Finance'], 'tracking': ['التتبع', 'Tracking'],
  };

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('التنبيهات', 'Alerts'))),
      body: Loader<List<J>>(
        key: ValueKey('alerts-${s.snap?['version']}-${s.lang}'),
        load: () async => list(obj(await s.api.get('/api/mobile/alerts'))['alerts']),
        builder: (ctx, all, reload) {
          final cats = <String>{for (final a in all) str(a['cat'])}.toList();
          final labels = [s.tt('الكل', 'All'), for (final c in cats) _cats[c] == null ? c : s.tt(_cats[c]![0], _cats[c]![1])];
          final shown = _f == 0 ? all : all.where((a) => a['cat'] == cats[_f - 1]).toList();
          if (all.isEmpty) return EmptyState(Icons.check_circle_outline, s.tt('مفيش تنبيهات', 'No alerts'), text: s.tt('كل حاجة تمام.', 'Everything is in order.'));
          return RefreshIndicator(
            onRefresh: reload,
            child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
              const SizedBox(height: 10),
              ChipsRow(labels: labels, selected: _f, onSelect: (i) => setState(() => _f = i)),
              for (final sev in ['high', 'medium', 'low']) ...[
                if (shown.any((a) => a['sev'] == sev))
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                    child: Text(sev == 'high' ? s.tt('عاجل', 'Urgent') : sev == 'medium' ? s.tt('مهم', 'Important') : s.tt('للعلم', 'For information'), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Mc.muted)),
                  ),
                for (final a in shown.where((a) => a['sev'] == sev))
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                    child: Box(
                      onTap: str(a['link']).isEmpty ? null : () => openRoute(context, str(a['link'])),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(color: sev == 'high' ? Mc.dangerBg : sev == 'medium' ? Mc.warningBg : Mc.hover, borderRadius: BorderRadius.circular(10)),
                          child: Icon(sev == 'high' ? Icons.priority_high : Icons.info_outline, size: 20, color: sev == 'high' ? Mc.danger : sev == 'medium' ? Mc.warning : Mc.navy),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(s.l(a['title']), style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(s.l(a['detail']), style: const TextStyle(fontSize: 13, color: Mc.muted)),
                          ]),
                        ),
                      ]),
                    ),
                  ),
              ],
            ]),
          );
        },
      ),
    );
  }
}
