import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'routes.dart';
import 'web_screen.dart';

int lineSeats(AppState s, J l) {
  final v = s.find('vehicles', l['vehicleId']);
  if (numv(v['seats']) > 0) return numv(v['seats']).toInt();
  for (final t in s.coll('vehicleTypes')) {
    if (t['code'] == l['vehicleType']) return numv(t['seats']).toInt();
  }
  return 0;
}

String lineTimes(AppState s, J l) => [
      if (str(l['goTime']).isNotEmpty) '${s.tt('ذهاب', 'Go')} ${l['goTime']}',
      if (str(l['returnTime']).isNotEmpty) '${s.tt('عودة', 'Return')} ${l['returnTime']}',
    ].join(' · ');

String lineDays(AppState s, J l) {
  const ar = ['أحد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'], en = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  final d = ((l['days'] as List?) ?? const []).map((e) => numv(e).toInt()).toList()..sort();
  return d.map((i) => s.ar ? ar[i % 7] : en[i % 7]).join('، ');
}

/// recurring runs (schools, universities, staff shifts, intercity departures): counts only, no names
class LinesScreen extends StatelessWidget {
  final bool standalone;
  const LinesScreen({super.key, this.standalone = false});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final lines = s.coll('lines');
    final today = s.coll('trips').where((t) => str(t['lineId']).isNotEmpty && t['date'] == s.today && t['status'] != 'cancelled').toList();
    final active = lines.where((l) => l['status'] == 'active').toList();
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: standalone, title: Text(s.tt('الخطوط', 'Lines'))),
      floatingActionButton: s.readOnly
          ? null
          : FloatingActionButton.extended(
              backgroundColor: Mc.navy,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add),
              label: Text(s.tt('خط جديد', 'New line')),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebScreen(route: 'lines', title: s.tt('خط جديد', 'New line')))),
            ),
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 96), children: [
          Row(children: [
            Expanded(child: Kpi(s.tt('خطوط شغالة', 'Active lines'), n0(active.length))),
            const SizedBox(width: 8),
            Expanded(child: Kpi(s.tt('رحلات النهارده', "Today's runs"), n0(today.length))),
            const SizedBox(width: 8),
            Expanded(child: Kpi(s.tt('العدد', 'Headcount'), n0(active.fold<num>(0, (a, l) => a + numv(l['headcount']))))),
          ]),
          const SizedBox(height: 10),
          if (lines.isEmpty) EmptyState(Icons.route_outlined, s.tt('مفيش خطوط لسه', 'No lines yet'), text: s.tt('اعمل خط لكل مدرسة أو وردية أو رحلة منتظمة.', 'Create a line for each school, shift or scheduled departure.')),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Box(
                onTap: () => openRoute(context, 'line.${l['id']}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [Expanded(child: Text(s.l(l['name']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))), statusPill(s, str(l['status']))]),
                  Text('${lineTimes(s, l)} · ${lineDays(s, l)}', style: const TextStyle(fontSize: 13, color: Mc.muted)),
                  const SizedBox(height: 6),
                  _Occupancy(line: l),
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final t in today.where((t) => t['lineId'] == l['id']))
                      Pill('${t['lineLeg'] == 'return' ? s.tt('عودة', 'Return') : s.tt('ذهاب', 'Go')} ${t['startTime']} · ${statusPill(s, str(t['status'])).text}', fg: t['status'] == 'completed' ? Mc.success : Mc.navy, bg: t['status'] == 'completed' ? Mc.successBg : Mc.hover),
                  ]),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

class _Occupancy extends StatelessWidget {
  final J line;
  const _Occupancy({required this.line});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final seats = lineSeats(s, line), head = numv(line['headcount']);
    final unit = s.l(obj(s.prof(str(line['activity']))['load'])['short']);
    final text = seats == 0
        ? '${n0(head)} $unit'
        : line['activity'] == 'intercity'
            ? '${s.tt('محجوز', 'Booked')} ${n0(head)} / ${n0(seats)} · ${s.tt('متاح', 'available')} ${n0((seats - head).clamp(0, seats))}'
            : '${n0(head)} $unit · ${pct(head / seats, 0)} ${s.tt('إشغال', 'occupancy')}';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(text, style: const TextStyle(fontSize: 12)),
      if (seats > 0) Padding(padding: const EdgeInsets.only(top: 4), child: LinearProgressIndicator(value: (head / seats).clamp(0, 1).toDouble(), minHeight: 6, color: Mc.navy, backgroundColor: Mc.hover, borderRadius: BorderRadius.circular(3))),
    ]);
  }
}

/// one line: stops, schedule, vehicle, runs, and creating the coming runs
class LineScreen extends StatelessWidget {
  final String id;
  const LineScreen({super.key, required this.id});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final l = s.find('lines', id);
    if (l.isEmpty) return Scaffold(appBar: AppBar(), body: EmptyState(Icons.search_off, s.tt('الخط مش موجود', 'Line not found')));
    final runs = s.coll('trips').where((t) => t['lineId'] == id && t['status'] != 'cancelled' && str(t['date']).compareTo(s.today) >= 0).toList()..sort((a, b) => '${a['date']}${a['startTime']}'.compareTo('${b['date']}${b['startTime']}'));
    final waiting = s.coll('bookings').where((b) => b['lineId'] == id && b['unassigned'] == true && b['status'] != 'cancelled' && str(b['date']).compareTo(s.today) >= 0).length;
    final stops = ((l['stops'] as List?) ?? const []).map((x) => s.place(x)).join(' ← ');
    return Scaffold(
      appBar: AppBar(title: Text(s.l(l['name']))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Box(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _Occupancy(line: l),
            const SizedBox(height: 8),
            Facts([
              (s.tt('الرقم', 'Number'), str(l['number'])),
              (s.tt('العميل', 'Client'), s.l(s.find('clients', l['clientId'])['name'])),
              (s.tt('المسار', 'Route'), '${s.place(l['from'])} ← ${s.place(l['to'])}'),
              if (stops.isNotEmpty) (s.tt('المحطات', 'Stops'), stops),
              (s.tt('المواعيد', 'Times'), '${lineTimes(s, l)} · ${n0(l['durationMin'])} ${s.tt('دقيقة', 'min')}'),
              (s.tt('الأيام', 'Days'), lineDays(s, l)),
              (s.tt('المركبة والسائق', 'Vehicle & driver'), '${str(s.find('vehicles', l['vehicleId'])['code'])} · ${s.l(s.find('drivers', l['driverId'])['name'])}'),
              (s.tt('متولّد لحد', 'Runs up to'), str(l['generatedTo']).isEmpty ? '—' : date(l['generatedTo'])),
              if (waiting > 0) (s.tt('من غير مركبة', 'Without a vehicle'), n0(waiting)),
            ]),
            const SizedBox(height: 6),
            Text(s.tt('أسماء الطلاب أو الموظفين أو الركاب في موديول سبيل؛ MOTUS بيستقبل العدد بس.', 'Names of students, employees or passengers stay in the Sabeel module; MOTUS receives the count only.'), style: const TextStyle(fontSize: 12, color: Mc.muted)),
          ]),
        ),
        const SizedBox(height: 12),
        if (!s.readOnly && l['status'] == 'active')
          FilledButton(
            onPressed: () async {
              final from = str(l['generatedTo']).compareTo(s.today) >= 0 ? addDays(str(l['generatedTo']), 1) : s.today;
              final r = await runAction(context, 'line.generate', {'id': id, 'from': from, 'to': addDays(from, 6)});
              if (r is Map && context.mounted) {
                toast(context, s.tt('اتعمل ${r['created']} رحلة (${r['assigned']} متخصصة)', '${r['created']} runs created (${r['assigned']} assigned)'));
              }
            },
            child: Text(s.tt('ولّد رحلات الأسبوع الجاي', 'Create next week\'s runs')),
          ),
        const SizedBox(height: 12),
        SectionTitle(s.tt('الرحلات الجاية', 'Coming runs')),
        for (final t in runs.take(30))
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${dayName(str(t['date']), s.ar)} ${date(t['date'])} · ${t['startTime']}', style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('${t['lineLeg'] == 'return' ? s.tt('عودة', 'Return') : s.tt('ذهاب', 'Go')} · ${str(s.find('vehicles', t['vehicleId'])['code'])}'),
            trailing: statusPill(s, str(t['status'])),
            onTap: () => openRoute(context, 'trip.${t['id']}'),
          ),
      ]),
    );
  }
}
