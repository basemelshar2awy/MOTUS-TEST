import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'routes.dart';

int _min(dynamic hhmm) {
  final t = str(hhmm);
  if (t.length < 5) return 0;
  return (int.tryParse(t.substring(0, 2)) ?? 0) * 60 + (int.tryParse(t.substring(3, 5)) ?? 0);
}

/// The dispatch board: a day per tab, every vehicle with its trips on an hour line, and the work
/// still waiting for a vehicle (assign it from here).
class DispatchScreen extends StatefulWidget {
  final bool standalone;
  const DispatchScreen({super.key, this.standalone = false});
  @override
  State<DispatchScreen> createState() => _DispatchScreenState();
}

class _DispatchScreenState extends State<DispatchScreen> {
  int _d = 1;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final days = [for (var i = -1; i < 6; i++) addDays(s.today, i)];
    final day = days[_d];
    final trips = s.coll('trips').where((t) => t['date'] == day && t['status'] != 'cancelled').toList();
    final waiting = s.coll('bookings').where((b) => b['date'] == day && b['unassigned'] == true && !['cancelled', 'done'].contains(b['status'])).toList()..sort((a, b) => str(a['time']).compareTo(str(b['time'])));
    final vehicles = s.coll('vehicles').where((v) => v['status'] != 'sold').toList();
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: widget.standalone, title: Text(s.tt('توزيع الحركة', 'Dispatch'))),
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 10),
            child: Row(children: [
              for (var i = 0; i < days.length; i++)
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _d = i),
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      height: 52,
                      margin: const EdgeInsets.symmetric(horizontal: 2),
                      decoration: BoxDecoration(color: i == _d ? Mc.navy : Colors.transparent, borderRadius: BorderRadius.circular(10)),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text(days[i] == s.today ? s.tt('النهارده', 'Today') : dayName(days[i], s.ar), style: TextStyle(fontSize: 10, color: i == _d ? Colors.white : Mc.muted)),
                        Text(days[i].substring(8), style: numStyle.copyWith(fontSize: 15, fontWeight: FontWeight.w700, color: i == _d ? Colors.white : Mc.navy)),
                      ]),
                    ),
                  ),
                ),
            ]),
          ),
          if (waiting.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Mc.warningBg, borderRadius: BorderRadius.circular(14)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text('${s.tt('من غير مركبة', 'Without a vehicle')} ${waiting.length}', style: const TextStyle(fontWeight: FontWeight.w700, color: Mc.warningInk)),
                  for (final b in waiting)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('${b['time']} · ${str(b['goods']).isNotEmpty ? '${b['goods']} · ' : ''}${s.loadText(b)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                            Text('${s.place(b['pickup'])} ← ${s.place(b['destination'])} · ${s.vtype(b['vehicleType'])}', style: const TextStyle(fontSize: 12, color: Mc.muted)),
                          ]),
                        ),
                        if (!s.readOnly) FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(44, 40)), onPressed: () => assignSheet(context, b), child: Text(s.tt('تخصيص', 'Assign'))),
                      ]),
                    ),
                ]),
              ),
            ),
          const SizedBox(height: 8),
          for (final v in vehicles)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Box(
                padding: const EdgeInsets.all(12),
                onTap: () => openRoute(context, 'vehicle.${v['id']}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Expanded(child: Text('${v['code']} · ${s.vtype(v['type'])} · ${s.l(s.find('drivers', v['driverId'])['name'])}', overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                    statusPill(s, str(v['status'])),
                  ]),
                  const SizedBox(height: 8),
                  _Track(trips: trips.where((t) => t['vehicleId'] == v['id']).toList()),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

/// a vehicle's day from 05:00 to 24:00, trips as bars (tap a bar to open the trip)
class _Track extends StatelessWidget {
  final List<J> trips;
  const _Track({required this.trips});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    const start = 5 * 60, span = 19 * 60;
    return LayoutBuilder(builder: (ctx, c) {
      final w = c.maxWidth;
      return Container(
        height: 30,
        decoration: BoxDecoration(color: Mc.bg, borderRadius: BorderRadius.circular(8)),
        child: Stack(children: [
          for (final t in trips)
            Builder(builder: (_) {
              final int a = (_min(t['startTime']) - start).clamp(0, span).toInt();
              var e = _min(t['endTime']);
              if (e <= _min(t['startTime'])) e = 24 * 60;
              final int b = (e - start).clamp(a + 20 > span ? span : a + 20, span).toInt();
              final empty = t['type'] == 'empty_return';
              return PositionedDirectional(
                start: w * a / span,
                width: (w * (b - a) / span).clamp(18.0, w).toDouble(),
                top: 3,
                bottom: 3,
                child: InkWell(
                  onTap: () => openRoute(context, 'trip.${t['id']}'),
                  child: Container(
                    alignment: AlignmentDirectional.centerStart,
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    decoration: BoxDecoration(color: empty ? Mc.chart5 : (t['status'] == 'running' ? Mc.deep : Mc.navy), borderRadius: BorderRadius.circular(6)),
                    child: Text(empty ? s.tt('عودة فاضية', 'Empty return') : '${t['startTime']} ${s.place(t['to'])}', maxLines: 1, overflow: TextOverflow.clip, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: empty ? Mc.navy : Colors.white)),
                  ),
                ),
              );
            }),
        ]),
      );
    });
  }
}

/// pick a vehicle for a booking; the server checks the calendar, capacity, licence and contracts
Future<void> assignSheet(BuildContext context, J b) async {
  final s = AppScope.read(context);
  final type = str(b['vehicleType']);
  final vs = s.coll('vehicles').where((v) => !['sold', 'out_of_service'].contains(v['status'])).toList()
    ..sort((x, y) => (x['type'] == type ? 0 : 1).compareTo(y['type'] == type ? 0 : 1));
  final busy = s.coll('trips').where((t) => t['date'] == b['date'] && t['status'] != 'cancelled').map((t) => t['vehicleId']).toSet();
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: .7,
      builder: (ctx, sc) => ListView(controller: sc, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
        Text('${s.tt('تخصيص', 'Assign')} ${b['number']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        Text(s.tt('السيرفر بيرفض المركبة المشغولة أو الأصغر أو اللي في الصيانة، وبيقولك السبب.', 'The server refuses a busy, too small or in-workshop vehicle and tells you why.'), style: const TextStyle(fontSize: 12, color: Mc.muted)),
        const SizedBox(height: 8),
        for (final v in vs)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.local_shipping_outlined, color: v['type'] == type ? Mc.navy : Mc.chart4),
            title: Text('${v['code']} · ${s.vtype(v['type'])}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${s.l(s.find('drivers', v['driverId'])['name'])}${busy.contains(v['id']) ? ' · ${s.tt('عليها رحلات اليوم ده', 'has trips that day')}' : ''}'),
            trailing: v['type'] == type ? Pill(s.tt('النوع المطلوب', 'Requested type'), fg: Mc.success, bg: Mc.successBg) : null,
            onTap: () async {
              final r = await runAction(ctx, 'booking.assign', {'bookingId': b['id'], 'vehicleId': v['id']}, ok: s.tt('اتعملت الرحلة', 'Trip created'));
              if (r != null && ctx.mounted) Navigator.pop(ctx);
            },
          ),
      ]),
    ),
  );
}
