import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/trips.dart';
import '../core/util.dart';
import '../widgets/common.dart';

void openTrip(BuildContext context, J t) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TripScreen(id: str(t['id']))));

/// one trip: where, when, what, the way on the map, and the big button
class TripScreen extends StatelessWidget {
  final String id;
  const TripScreen({super.key, required this.id});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final t = s.find('trips', id);
    if (t.isEmpty) return Scaffold(appBar: AppBar(), body: EmptyState(Icons.search_off, s.tt('الرحلة دي مش عليك دلوقتي', 'This trip is no longer yours')));
    final v = s.find('vehicles', t['vehicleId']);
    final b = s.find('bookings', t['bookingId']);
    final line = s.find('lines', t['lineId']);
    final cargo = str(t['activity']) == 'cargo';
    // a line's stops between the two ends (the return run goes the other way)
    var mid = line['stops'] is List ? (line['stops'] as List).map(str).where((c) => c != str(t['from']) && c != str(t['to'])).toList() : <String>[];
    if (str(t['lineLeg']) == 'return') mid = mid.reversed.toList();
    final stops = <String>[str(t['from']), ...mid, str(t['to'])];
    final flags = b['cargoFlags'] is List ? (b['cargoFlags'] as List).map(str).toList() : <String>[];
    final active = t['status'] == 'scheduled' || t['status'] == 'running';
    return Scaffold(
      appBar: AppBar(title: Text(str(t['number']), style: numStyle.copyWith(fontWeight: FontWeight.w800, fontSize: 18))),
      bottomNavigationBar: active ? SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 12), child: TripButton(trip: t))) : null,
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Box(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Text(str(t['startTime']), style: numStyle.copyWith(fontSize: 34, fontWeight: FontWeight.w700)),
              Text('  ${s.tt('لحد', 'to')} ${str(t['endTime'])}', style: numStyle.copyWith(fontSize: 16, color: Mc.muted)),
              const Spacer(),
              statusPill(s, str(t['status'])),
            ]),
            Text('${dayName(str(t['date']), s.ar)} ${date(t['date'])} · ${s.typeName(t['type'])}', style: const TextStyle(color: Mc.muted, fontSize: 15)),
            if (t['status'] == 'running' && numv(t['startKm']) > 0) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${s.tt('عداد البداية', 'Start odometer')}: ${n0(t['startKm'])}', style: const TextStyle(color: Mc.success, fontWeight: FontWeight.w700))),
          ]),
        ),
        const SizedBox(height: 12),
        Box(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(line.isEmpty ? s.tt('الطريق', 'Route') : '${s.tt('الخط', 'Line')} ${line['number']} · ${s.l(line['name'])}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 8),
            for (var i = 0; i < stops.length; i++) _Stop(code: stops[i], first: i == 0, last: i == stops.length - 1),
          ]),
        ),
        const SizedBox(height: 12),
        Box(
          child: Column(children: [
            _Fact(Icons.directions_bus, s.tt('العربية', 'Vehicle'), v.isEmpty ? '—' : '${v['code']} · ${s.l(v['plate'])}'),
            _Fact(cargo ? Icons.inventory_2_outlined : Icons.groups_outlined, cargo ? s.tt('الحمولة', 'Load') : s.tt('العدد', 'Count'), s.loadText(t)),
            if (cargo && str(b['goods']).isNotEmpty) _Fact(Icons.category_outlined, s.tt('البضاعة', 'Goods'), '${b['goods']}${numv(b['pieces']) > 0 ? ' · ${n0(b['pieces'])} ${s.tt('قطعة', 'pcs')}' : ''}'),
            if (cargo && flags.isNotEmpty) _Fact(Icons.warning_amber, s.tt('تنبيه', 'Handling'), flags.map((f) => _flag(s, f)).join(' · '), warn: true),
            if (cargo && str(b['deliverDate']).isNotEmpty) _Fact(Icons.schedule, s.tt('التسليم قبل', 'Deliver by'), '${date(b['deliverDate'])} ${str(b['deliverTime'])}'),
            if (cargo && needsDeliveryCode(t, b)) _Fact(Icons.pin_outlined, s.tt('كود التسليم', 'Delivery code'), s.tt('اطلبه من المستلم وانت بتسلم', 'Ask the consignee when you deliver'), warn: true),
            if (cargo && str(b['deliveredAt']).isNotEmpty) _Fact(Icons.verified_outlined, s.tt('التسليم', 'Delivery'), s.tt('اتسلمت', 'Delivered')),
          ]),
        ),
        if (t['status'] == 'running')
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Row(children: [
              const Icon(Icons.my_location, size: 18, color: Mc.muted),
              const SizedBox(width: 6),
              Expanded(child: Text(s.location.denied ? s.tt('الموقع مقفول: افتحه من إعدادات الموبايل عشان الشركة تشوف العربية.', 'Location is off: allow it in the phone settings so the company can see the vehicle.') : s.tt('مكانك بيتبعت للشركة طول ما الرحلة شغالة والتطبيق مفتوح.', 'Your location is shared with the company while the trip runs and the app is open.'), style: TextStyle(color: s.location.denied ? Mc.danger : Mc.muted, fontSize: 13))),
            ]),
          ),
      ]),
    );
  }

  static String _flag(AppState s, String f) {
    final n = obj(obj(s.snap?['profiles'])['cargoFlags'])[f];
    return n == null ? f : s.l(n);
  }
}

class _Stop extends StatelessWidget {
  final String code;
  final bool first;
  final bool last;
  const _Stop({required this.code, required this.first, required this.last});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final p = s.placeOf(code);
    final hasMap = p['lat'] != null && p['lng'] != null;
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SizedBox(
          width: 20,
          child: Column(children: [
            Expanded(child: Container(width: 2, color: first ? Colors.transparent : Mc.border)),
            Container(width: 14, height: 14, decoration: BoxDecoration(color: last ? Mc.navy : Colors.white, shape: BoxShape.circle, border: Border.all(color: Mc.navy, width: 3))),
            Expanded(child: Container(width: 2, color: last ? Colors.transparent : Mc.border)),
          ]),
        ),
        const SizedBox(width: 10),
        Expanded(child: Padding(padding: const EdgeInsets.symmetric(vertical: 10), child: Text(s.place(code), style: TextStyle(fontSize: 17, fontWeight: first || last ? FontWeight.w800 : FontWeight.w600)))),
        if (hasMap)
          TextButton.icon(
            onPressed: () => launchUrl(mapLink(numv(p['lat']), numv(p['lng'])), mode: LaunchMode.externalApplication),
            icon: const Icon(Icons.navigation_outlined),
            label: Text(s.tt('الخريطة', 'Map')),
          ),
      ]),
    );
  }
}

class _Fact extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool warn;
  const _Fact(this.icon, this.label, this.value, {this.warn = false});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: warn ? Mc.warning : Mc.navy, size: 22),
          const SizedBox(width: 12),
          SizedBox(width: 96, child: Text(label, style: const TextStyle(color: Mc.muted, fontSize: 15))),
          Expanded(child: Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: warn ? Mc.warningInk : Mc.navy))),
        ]),
      );
}

/// Start (scheduled) or Finish (running): the only two things a driver does to a trip
class TripButton extends StatelessWidget {
  final J trip;
  const TripButton({super.key, required this.trip});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    if (trip['status'] == 'running') return BigButton(s.tt('خلّصت الرحلة', 'Finish trip'), Icons.flag, color: Mc.success, busy: s.busy, onPressed: () => finishSheet(context, trip));
    if (trip['status'] == 'scheduled') {
      final other = s.trips.any((t) => t['status'] == 'running' && t['id'] != trip['id']);
      return BigButton(s.tt('ابدأ الرحلة', 'Start trip'), Icons.play_arrow_rounded, busy: s.busy, onPressed: other ? () => _busyElsewhere(context) : () => startSheet(context, trip));
    }
    return const SizedBox.shrink();
  }

  void _busyElsewhere(BuildContext context) {
    final s = AppScope.read(context);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.tt('خلّص الرحلة اللي شغالة الأول', 'Finish the trip in progress first'))));
  }
}

Future<void> startSheet(BuildContext context, J t) async {
  final s = AppScope.read(context);
  final v = s.find('vehicles', t['vehicleId']);
  final odo = TextEditingController(text: numv(v['odometer']) > 0 ? numv(v['odometer']).round().toString() : '');
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _Sheet(
      title: s.tt('ابدأ الرحلة', 'Start the trip'),
      subtitle: '${s.place(t['from'])} ${s.ar ? '←' : '→'} ${s.place(t['to'])}',
      fields: [NumField(odo, s.tt('العداد دلوقتي (كم)', 'Odometer now (km)'), big: true, autofocus: true, helper: s.tt('اكتب الرقم اللي على عداد العربية', 'The number on the vehicle odometer'))],
      button: BigButton(s.tt('ابدأ', 'Start'), Icons.play_arrow_rounded, onPressed: () async {
        final n = parseNum(odo.text);
        if (n == null) return;
        try {
          await s.startTrip(str(t['id']), n);
          if (ctx.mounted) Navigator.pop(ctx);
          if (context.mounted) toast(context, s.tt('بدأت الرحلة. طريق السلامة', 'Trip started. Drive safe'));
        } catch (e) {
          if (ctx.mounted) showError(ctx, e);
        }
      }),
    ),
  );
}

Future<void> finishSheet(BuildContext context, J t) async {
  final s = AppScope.read(context);
  final b = s.find('bookings', t['bookingId']);
  final withCode = needsDeliveryCode(t, b);
  final code = TextEditingController(), endKm = TextEditingController(), tolls = TextEditingController(), parking = TextEditingController();
  await showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _Sheet(
      title: s.tt('خلّصت الرحلة', 'Finish the trip'),
      subtitle: '${s.tt('وصلت', 'Arrived at')} ${s.place(t['to'])}',
      fields: [
        if (withCode) NumField(code, s.tt('كود التسليم من المستلم', 'Delivery code from the consignee'), big: true, autofocus: true),
        NumField(endKm, s.tt('العداد دلوقتي (كم)', 'Odometer now (km)'), big: !withCode, autofocus: !withCode, helper: numv(t['startKm']) > 0 ? '${s.tt('بدأت على', 'Started at')} ${n0(t['startKm'])}' : null),
        Row(children: [
          Expanded(child: NumField(tolls, s.tt('كارتة (لو دفعت)', 'Tolls paid'))),
          const SizedBox(width: 10),
          Expanded(child: NumField(parking, s.tt('جراج / انتظار', 'Parking'))),
        ]),
      ],
      button: BigButton(s.tt('تم', 'Done'), Icons.check, color: Mc.success, onPressed: () async {
        final km = parseNum(endKm.text);
        if (km == null) return;
        try {
          await s.finishTrip(str(t['id']), endKm: km, tolls: parseNum(tolls.text) ?? 0, parking: parseNum(parking.text) ?? 0, code: withCode ? code.text.trim() : null);
          if (ctx.mounted) Navigator.pop(ctx);
          if (context.mounted) {
            Navigator.of(context).popUntil((r) => r.isFirst);
            toast(context, s.tt('عاش! الرحلة خلصت', 'Well done! Trip finished'));
          }
        } catch (e) {
          if (ctx.mounted) showError(ctx, e);
        }
      }),
    ),
  );
}

class _Sheet extends StatelessWidget {
  final String title;
  final String subtitle;
  final List<Widget> fields;
  final Widget button;
  const _Sheet({required this.title, required this.subtitle, required this.fields, required this.button});
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.of(context).viewInsets.bottom + 24),
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
            Text(subtitle, style: const TextStyle(color: Mc.muted, fontSize: 15)),
            const SizedBox(height: 16),
            for (final f in fields) Padding(padding: const EdgeInsets.only(bottom: 14), child: f),
            button,
          ]),
        ),
      );
}
