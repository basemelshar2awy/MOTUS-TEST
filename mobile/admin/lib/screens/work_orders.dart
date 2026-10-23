import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'web_screen.dart';

/// work orders: open ones first; close one from the phone (parts and labour stay as entered)
class WorkOrdersScreen extends StatefulWidget {
  const WorkOrdersScreen({super.key});
  @override
  State<WorkOrdersScreen> createState() => _WorkOrdersScreenState();
}

class _WorkOrdersScreenState extends State<WorkOrdersScreen> {
  int _f = 0;
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    const openStates = ['open', 'waiting_parts', 'in_progress'];
    final all = s.coll('workOrders').toList()..sort((a, b) => '${b['date']}'.compareTo('${a['date']}'));
    final open = all.where((w) => openStates.contains(w['status'])).toList();
    final rows = _f == 0 ? open : all.where((w) => !openStates.contains(w['status'])).toList();
    final month = s.today.substring(0, 7);
    final cost = all.where((w) => str(w['date']).startsWith(month)).fold<num>(0, (a, w) => a + numv(w['total']));
    final canEdit = ['super_admin', 'company_admin', 'fleet_manager', 'maintenance'].contains(s.role);
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('أوامر الشغل', 'Work orders'))),
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(
              backgroundColor: Mc.navy,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add),
              label: Text(s.tt('أمر جديد', 'New order')),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebScreen(route: 'workorders', title: s.tt('أوامر الشغل', 'Work orders')))),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: const EdgeInsets.fromLTRB(0, 12, 0, 96), children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(children: [
              Expanded(child: Kpi(s.tt('مفتوحة', 'Open'), n0(open.length))),
              const SizedBox(width: 8),
              Expanded(child: Kpi(s.tt('تكلفة الشهر', 'This month'), n0(cost))),
            ]),
          ),
          const SizedBox(height: 8),
          ChipsRow(labels: [s.tt('المفتوحة', 'Open'), s.tt('المقفولة', 'Closed')], selected: _f, onSelect: (i) => setState(() => _f = i)),
          if (rows.isEmpty) EmptyState(Icons.build_circle_outlined, s.tt('مفيش أوامر هنا', 'No work orders here')),
          for (final w in rows.take(100))
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Box(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [Expanded(child: Text(str(w['number']), style: numStyle.copyWith(fontWeight: FontWeight.w700, fontSize: 13))), statusPill(s, str(w['status']))]),
                  Text('${str(s.find('vehicles', w['vehicleId'])['code'])} · ${s.l(w['problem'])}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  Text('${date(w['date'])} · ${s.money(w['total'])}', style: const TextStyle(fontSize: 13, color: Mc.muted)),
                  if (canEdit && openStates.contains(w['status']))
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(children: [
                        Expanded(child: OutlinedButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebScreen(route: 'wo.${w['id']}', title: str(w['number'])))), child: Text(s.tt('التفاصيل والقطع', 'Details & parts')))),
                        const SizedBox(width: 8),
                        Expanded(child: FilledButton(onPressed: () => runAction(context, 'wo.close', {'id': w['id'], 'date': s.today}, ok: s.tt('اتقفل أمر الشغل', 'Work order closed')), child: Text(s.tt('قفل الأمر', 'Close')))),
                      ]),
                    ),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}
