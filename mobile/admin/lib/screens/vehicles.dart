import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'routes.dart';
import 'web_screen.dart';

/// the fleet, by status, with search
class VehiclesScreen extends StatefulWidget {
  final bool standalone;
  const VehiclesScreen({super.key, this.standalone = false});
  @override
  State<VehiclesScreen> createState() => _VehiclesScreenState();
}

class _VehiclesScreenState extends State<VehiclesScreen> {
  String _q = '';
  int _f = 0;
  static const _states = ['', 'available', 'on_trip', 'maintenance', 'out_of_service'];

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final running = s.coll('trips').where((t) => t['status'] == 'running').map((t) => t['vehicleId']).toSet();
    String state(J v) => running.contains(v['id']) ? 'on_trip' : str(v['status']);
    final all = s.coll('vehicles').where((v) => v['status'] != 'sold').toList();
    final q = _q.trim().toLowerCase();
    final rows = all.where((v) => (_f == 0 || state(v) == _states[_f]) && (q.isEmpty || '${v['code']} ${s.l(v['plate'])} ${s.l(s.find('drivers', v['driverId'])['name'])}'.toLowerCase().contains(q))).toList();
    int count(String st) => all.where((v) => state(v) == st).length;
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: widget.standalone, title: Text('${s.tt('المركبات', 'Vehicles')} ${all.length}')),
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 10, 16, 6), child: TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: s.tt('الكود، اللوحة، السواق', 'Code, plate, driver')))),
          ChipsRow(
            labels: [s.tt('الكل', 'All'), '${s.tt('جاهزة', 'Ready')} ${count('available')}', '${s.tt('على الطريق', 'On a trip')} ${count('on_trip')}', '${s.tt('صيانة', 'Workshop')} ${count('maintenance')}', s.tt('خارج الخدمة', 'Out of service')],
            selected: _f,
            onSelect: (i) => setState(() => _f = i),
          ),
          const SizedBox(height: 6),
          for (final v in rows)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Box(
                onTap: () => openRoute(context, 'vehicle.${v['id']}'),
                child: Row(children: [
                  Container(width: 46, height: 46, decoration: BoxDecoration(color: Mc.hover, borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.local_shipping_outlined, color: Mc.navy)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [Expanded(child: Text(str(v['code']), style: const TextStyle(fontWeight: FontWeight.w700))), statusPill(s, state(v))]),
                      Text('${s.vtype(v['type'])} · ${s.l(v['plate'])} · ${s.l(s.find('drivers', v['driverId'])['name'])}', style: const TextStyle(fontSize: 13, color: Mc.muted)),
                      Text('${s.tt('العداد', 'Odometer')} ${n0(v['odometer'])} ${s.tt('كم', 'km')}${numv(v['payloadKg']) > 0 ? ' · ${s.tt('الحمولة', 'Payload')} ${n0(v['payloadKg'])} ${s.tt('كجم', 'kg')}' : ''}${numv(v['seats']) > 0 ? ' · ${n0(v['seats'])} ${s.tt('كرسي', 'seats')}' : ''}', style: const TextStyle(fontSize: 12, color: Mc.muted)),
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

/// one vehicle: what's coming, maintenance and documents, and quick actions; the full profit
/// analysis opens from the dashboard
class VehicleScreen extends StatelessWidget {
  final String id;
  const VehicleScreen({super.key, required this.id});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final v = s.find('vehicles', id);
    if (v.isEmpty) return Scaffold(appBar: AppBar(), body: EmptyState(Icons.search_off, s.tt('مش موجودة في الشركة دي', 'Not found in this company')));
    final d = s.find('drivers', v['driverId']);
    final coming = s.coll('trips').where((t) => t['vehicleId'] == id && t['status'] != 'cancelled' && str(t['date']).compareTo(s.today) >= 0).toList()..sort((a, b) => '${a['date']}${a['startTime']}'.compareTo('${b['date']}${b['startTime']}'));
    final wos = s.coll('workOrders').where((w) => w['vehicleId'] == id && ['open', 'waiting_parts', 'in_progress'].contains(w['status'])).toList();
    final fuel = s.coll('fuel').where((f) => f['vehicleId'] == id).toList()..sort((a, b) => '${b['date']}'.compareTo('${a['date']}'));
    void web(String route, String title) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebScreen(route: route, title: title)));
    return Scaffold(
      appBar: AppBar(title: Text('${v['code']} · ${s.vtype(v['type'])}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Box(
          child: Facts([
            (s.tt('اللوحة', 'Plate'), s.l(v['plate'])),
            (s.tt('الحالة', 'Status'), statusPill(s, str(v['status'])).text),
            (s.tt('السواق', 'Driver'), s.l(d['name'])),
            (s.tt('العداد', 'Odometer'), '${n0(v['odometer'])} ${s.tt('كم', 'km')}'),
            if (numv(v['seats']) > 0) (s.tt('الكراسي', 'Seats'), n0(v['seats'])),
            if (numv(v['payloadKg']) > 0) (s.tt('الحمولة', 'Payload'), '${n0(v['payloadKg'])} ${s.tt('كجم', 'kg')}'),
            (s.tt('الترخيص', 'Licence'), date(v['licenseExpiry'])),
            (s.tt('التأمين', 'Insurance'), date(v['insuranceExpiry'])),
          ]),
        ),
        const SizedBox(height: 12),
        if (!s.readOnly)
          Wrap(spacing: 8, runSpacing: 8, children: [
            OutlinedButton.icon(onPressed: () => web('fuel', s.tt('المحروقات', 'Fuel')), icon: const Icon(Icons.local_gas_station_outlined), label: Text(s.tt('تفويل', 'Fill-up'))),
            OutlinedButton.icon(onPressed: () => web('workorders', s.tt('أوامر الشغل', 'Work orders')), icon: const Icon(Icons.build_outlined), label: Text(s.tt('أمر شغل', 'Work order'))),
            OutlinedButton.icon(onPressed: () => web('documents', s.tt('المستندات', 'Documents')), icon: const Icon(Icons.description_outlined), label: Text(s.tt('مستند', 'Document'))),
            if (str(d['phone']).isNotEmpty) OutlinedButton.icon(onPressed: () => launchUrl(Uri(scheme: 'tel', path: str(d['phone']))), icon: const Icon(Icons.call_outlined), label: Text(s.tt('اتصل بالسواق', 'Call driver'))),
          ]),
        const SizedBox(height: 12),
        Box(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
          child: Column(children: [
            SectionTitle(s.tt('الرحلات الجاية', 'Coming trips')),
            if (coming.isEmpty) Padding(padding: const EdgeInsets.all(10), child: Text(s.tt('فاضية', 'Free'), style: const TextStyle(color: Mc.success))),
            for (final t in coming.take(10))
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text('${date(t['date'])} ${t['startTime']} · ${s.place(t['from'])} ← ${s.place(t['to'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
                trailing: statusPill(s, str(t['status'])),
                onTap: () => openRoute(context, 'trip.${t['id']}'),
              ),
          ]),
        ),
        const SizedBox(height: 12),
        Box(
          padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
          child: Column(children: [
            SectionTitle(s.tt('الصيانة', 'Maintenance')),
            if (wos.isEmpty) Padding(padding: const EdgeInsets.all(10), child: Text(s.tt('مفيش أوامر شغل مفتوحة', 'No open work orders'), style: const TextStyle(color: Mc.muted))),
            for (final w in wos) ListTile(contentPadding: EdgeInsets.zero, dense: true, title: Text('${w['number']} · ${s.l(w['problem'])}'), trailing: statusPill(s, str(w['status'])), onTap: () => openRoute(context, 'workorders')),
            if (fuel.isNotEmpty) ListTile(contentPadding: EdgeInsets.zero, dense: true, title: Text(s.tt('آخر تفويل', 'Last fill-up')), subtitle: Text('${date(fuel.first['date'])} · ${n1(fuel.first['liters'])} ${s.tt('لتر', 'L')}')),
          ]),
        ),
        const SizedBox(height: 12),
        FilledButton(onPressed: () => web('vehicle.$id', str(v['code'])), child: Text(s.tt('الربحية والتفاصيل الكاملة', 'Profitability and full details'))),
      ]),
    );
  }
}
