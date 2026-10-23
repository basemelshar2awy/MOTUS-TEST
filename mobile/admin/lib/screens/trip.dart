import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'routes.dart';
import 'web_screen.dart';

/// a trip: its details, the trip order (waybill for a shipment) and the dispatcher's actions
class TripScreen extends StatelessWidget {
  final String id;
  const TripScreen({super.key, required this.id});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final t = s.find('trips', id);
    if (t.isEmpty) return Scaffold(appBar: AppBar(), body: EmptyState(Icons.search_off, s.tt('مش موجودة في الشركة دي', 'Not found in this company')));
    final b = s.find('bookings', t['bookingId']);
    final v = s.find('vehicles', t['vehicleId']);
    final d = s.find('drivers', t['driverId']);
    final cargo = t['activity'] == 'cargo';
    final line = s.find('lines', t['lineId']);
    final status = str(t['status']);
    final code = cargo && b['hasCode'] == true && str(b['deliveredAt']).isEmpty;
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(str(t['number']), style: numStyle.copyWith(fontWeight: FontWeight.w800, fontSize: 17)),
          actions: [Padding(padding: const EdgeInsetsDirectional.only(end: 12), child: Center(child: statusPill(s, status)))],
          bottom: TabBar(labelColor: Mc.navy, indicatorColor: Mc.navy, tabs: [Tab(text: s.tt('البيانات', 'Details')), Tab(text: cargo ? s.tt('بوليصة الشحن', 'Waybill') : s.tt('أمر التشغيل', 'Trip order'))]),
        ),
        body: TabBarView(children: [
          ListView(padding: const EdgeInsets.all(16), children: [
            Box(
              child: Facts([
                (s.tt('النوع', 'Type'), s.typeName(t['type'])),
                (s.tt('المسار', 'Route'), '${s.place(t['from'])} ← ${s.place(t['to'])}'),
                (s.tt('الميعاد', 'Time'), '${date(t['date'])} ${t['startTime']}–${t['endTime']}'),
                if (line.isNotEmpty) (s.tt('الخط', 'Line'), s.l(line['name'])),
                if (b.isNotEmpty) (s.tt('العميل', 'Client'), s.l(s.find('clients', b['clientId'])['name'])),
                if (cargo && str(b['goods']).isNotEmpty) (s.tt('البضاعة', 'Goods'), '${b['goods']} · ${s.loadText(b)}'),
                if (!cargo) (s.l(obj(s.prof(str(t['activity']))['load'])['label']), n0(t['pax'])),
                if (cargo && str(b['deliverDate']).isNotEmpty) (s.tt('آخر موعد للتسليم', 'Deliver by'), '${date(b['deliverDate'])} ${str(b['deliverTime'])}'),
                (s.tt('المركبة', 'Vehicle'), '${str(v['code'])} · ${s.l(v['plate'])}'),
                (s.tt('السواق', 'Driver'), s.l(d['name'])),
                (s.tt('الإيراد', 'Revenue'), s.money(t['revenue'])),
                if (numv(t['km']) > 0) (s.tt('الكيلومترات', 'Distance'), '${n0(t['km'])} ${s.tt('كم', 'km')}'),
              ]),
            ),
            const SizedBox(height: 12),
            Row(children: [
              if (str(d['phone']).isNotEmpty)
                Expanded(child: OutlinedButton.icon(onPressed: () => launchUrl(Uri(scheme: 'tel', path: str(d['phone']))), icon: const Icon(Icons.call_outlined), label: Text(s.tt('اتصل بالسواق', 'Call driver')))),
              if (str(d['phone']).isNotEmpty) const SizedBox(width: 8),
              Expanded(child: OutlinedButton.icon(onPressed: () => openRoute(context, 'livemap'), icon: const Icon(Icons.place_outlined), label: Text(s.tt('مكانه دلوقتي', 'Where now')))),
            ]),
            if (b.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton(onPressed: () => openRoute(context, 'booking.${b['id']}'), child: Text('${s.tt('فتح', 'Open')} ${b['number']}'))),
            const SizedBox(height: 16),
            if (!s.readOnly && status == 'scheduled') ...[
              FilledButton(onPressed: () => runAction(context, 'trip.start', {'id': id}, ok: s.tt('بدأت الرحلة', 'Trip started')), child: Text(s.tt('بدء الرحلة', 'Start trip'))),
              const SizedBox(height: 8),
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: Mc.danger),
                onPressed: () async {
                  final r = await askText(context, s.tt('إلغاء الرحلة', 'Cancel trip'), s.tt('السبب', 'Reason'), danger: true);
                  if (r != null && context.mounted) await runAction(context, 'trip.cancel', {'id': id, 'reason': r}, ok: s.tt('اتلغت', 'Cancelled'));
                },
                child: Text(s.tt('إلغاء الرحلة', 'Cancel trip')),
              ),
            ],
            if (!s.readOnly && status == 'running') FilledButton(onPressed: () => _finish(context, t, v, code), child: Text(s.tt('إنهاء الرحلة', 'Finish trip'))),
          ]),
          ListView(padding: const EdgeInsets.all(16), children: [
            Box(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  const Text('MOTUS', style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, letterSpacing: 2)),
                  const Spacer(),
                  Text(cargo ? s.tt('بوليصة شحن', 'Waybill') : s.tt('أمر تشغيل', 'Trip order'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                ]),
                const Divider(),
                Facts([
                  (s.tt('رقم الرحلة', 'Trip no.'), str(t['number'])),
                  if (cargo) (s.tt('رقم الشحنة', 'Shipment no.'), str(b['number'])),
                  (s.tt('العميل', 'Client'), s.l(s.find('clients', b['clientId'] ?? t['clientId'])['name'])),
                  if (cargo) (s.tt('البضاعة', 'Goods'), '${str(b['goods'])} · ${s.loadText(b)} · ${b['pieces'] ?? '—'}'),
                  if (line.isNotEmpty && line['stops'] is List) (s.tt('المحطات', 'Stops'), (line['stops'] as List).map((x) => s.place(x)).join(' ← ')),
                  if (t['activity'] == 'tourism' && str(t['flight']).isNotEmpty) (s.tt('رقم الطيران', 'Flight'), str(t['flight'])),
                  (s.tt('المسار', 'Route'), '${s.place(t['from'])} ← ${s.place(t['to'])} · ${n0(t['plannedKm'])} ${s.tt('كم', 'km')}'),
                  (s.tt('المركبة', 'Vehicle'), '${str(v['code'])} · ${s.l(v['plate'])}'),
                  (s.tt('السواق', 'Driver'), '${s.l(d['name'])} ${str(d['phone'])}'),
                  if (cargo)
                    (s.tt('إثبات التسليم', 'Proof of delivery'),
                        str(b['deliveredAt']).isNotEmpty ? '${s.tt('اتسلمت', 'Delivered')} ${b['deliveredAt']}' : s.tt('بكود المستلم (6 أرقام)', 'With the consignee code (6 digits)')),
                ]),
              ]),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebScreen(route: 'trip.$id', title: str(t['number'])))),
              icon: const Icon(Icons.print_outlined),
              label: Text(s.tt('طباعة من لوحة التحكم', 'Print from the dashboard')),
            ),
          ]),
        ]),
      ),
    );
  }

  Future<void> _finish(BuildContext context, J t, J v, bool code) async {
    final s = AppScope.read(context);
    final km = TextEditingController(text: str(v['odometer']));
    final cd = TextEditingController();
    final why = TextEditingController();
    final admin = ['super_admin', 'company_admin'].contains(s.role);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(s.tt('إنهاء الرحلة', 'Finish trip')),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (code) TextField(controller: cd, keyboardType: TextInputType.number, maxLength: 6, decoration: InputDecoration(labelText: s.tt('كود التسليم (من المستلم)', 'Delivery code (from the consignee)'))),
            TextField(controller: km, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: s.tt('عداد النهاية (كم)', 'End odometer (km)'))),
            if (code && admin) Padding(padding: const EdgeInsets.only(top: 8), child: TextField(controller: why, decoration: InputDecoration(labelText: s.tt('أو: سبب القفل من غير كود (مدير الشركة)', 'Or: reason to close without the code (company admin)')))),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(s.tt('رجوع', 'Back'))), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(s.tt('إنهاء', 'Finish')))],
      ),
    );
    if (ok != true || !context.mounted) return;
    await runAction(context, 'trip.complete', {
      'id': t['id'],
      'endKm': int.tryParse(km.text.trim()),
      if (cd.text.trim().isNotEmpty) 'deliveryCode': cd.text.trim(),
      if (why.text.trim().isNotEmpty) 'overrideReason': why.text.trim(),
    }, ok: s.tt('انتهت الرحلة', 'Trip finished'));
  }
}
