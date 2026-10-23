import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'routes.dart';

/// where every vehicle is now (the dashboard's live positions), refreshed every 15 seconds.
/// OpenStreetMap tiles: works the same on Google, iPhone and Huawei phones, no map key needed.
class LiveMapScreen extends StatefulWidget {
  const LiveMapScreen({super.key});
  @override
  State<LiveMapScreen> createState() => _LiveMapScreenState();
}

class _LiveMapScreenState extends State<LiveMapScreen> {
  List<J> _pos = [];
  J? _sel;
  Timer? _t;
  int _now = 0;
  final _map = MapController();

  @override
  void initState() {
    super.initState();
    _load();
    _t = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = obj(await AppScope.read(context).api.get('/api/live'));
      if (!mounted) return;
      setState(() {
        _pos = list(r['positions']);
        _now = numv(r['serverNow']).toInt();
        if (_sel != null) _sel = _pos.firstWhere((p) => p['vehicleId'] == _sel!['vehicleId'], orElse: () => _sel!);
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Color _color(J p) {
    final mins = (_now - numv(p['ts'])) / 60000;
    if (mins > 30) return Mc.muted;
    return numv(p['speed']) > 3 ? Mc.success : Mc.navy;
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final center = _pos.isEmpty ? const LatLng(30.0444, 31.2357) : LatLng(numv(_pos.first['lat']).toDouble(), numv(_pos.first['lng']).toDouble());
    final sel = _sel;
    final selV = sel == null ? <String, dynamic>{} : s.find('vehicles', sel['vehicleId']);
    final selTrip = sel == null ? <String, dynamic>{} : s.coll('trips').firstWhere((t) => t['vehicleId'] == sel['vehicleId'] && t['status'] == 'running', orElse: () => <String, dynamic>{});
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('الخريطة المباشرة', 'Live map')), actions: [IconButton(tooltip: s.tt('تحديث', 'Refresh'), onPressed: _load, icon: const Icon(Icons.refresh))]),
      body: Stack(children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(initialCenter: center, initialZoom: 10, onTap: (_, __) => setState(() => _sel = null)),
          children: [
            TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'com.sabeel.motus.admin'),
            MarkerLayer(markers: [
              for (final p in _pos)
                Marker(
                  point: LatLng(numv(p['lat']).toDouble(), numv(p['lng']).toDouble()),
                  width: 90,
                  height: 56,
                  child: GestureDetector(
                    onTap: () => setState(() => _sel = p),
                    child: Column(children: [
                      Container(width: 26, height: 26, decoration: BoxDecoration(color: _color(p), shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3), boxShadow: const [BoxShadow(color: Color(0x5508264A), blurRadius: 6)])),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6)),
                        child: Text(str(s.find('vehicles', p['vehicleId'])['code']), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                      ),
                    ]),
                  ),
                ),
            ]),
            RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
          ],
        ),
        if (_pos.isEmpty) Center(child: Container(color: Colors.white70, child: EmptyState(Icons.gps_off, s.tt('مفيش مواقع لسه', 'No positions yet'), text: s.tt('المواقع بتوصل من أجهزة التتبع أو تطبيق السواق.', 'Positions come from the trackers or the driver app.')))),
        if (sel != null)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(20)), boxShadow: [BoxShadow(color: Color(0x2608264A), blurRadius: 20)]),
              child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: Text('${selV['code']} · ${s.l(s.find('drivers', selV['driverId'])['name'])}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                  Text('${n0(sel['speed'])} ${s.tt('كم/س', 'km/h')}', style: numStyle.copyWith(fontWeight: FontWeight.w700, fontSize: 18)),
                ]),
                Text('${s.tt('آخر إشارة', 'Last signal')} ${str(sel['at'])}', style: const TextStyle(color: Mc.muted, fontSize: 13)),
                const SizedBox(height: 10),
                Row(children: [
                  if (selTrip.isNotEmpty) Expanded(child: FilledButton(onPressed: () => openRoute(context, 'trip.${selTrip['id']}'), child: Text(s.tt('فتح الرحلة', 'Open trip')))),
                  if (selTrip.isNotEmpty) const SizedBox(width: 8),
                  Expanded(child: OutlinedButton(onPressed: () => openRoute(context, 'history', title: s.tt('سجل المسارات', 'Route history')), child: Text(s.tt('سجل المسار', 'Route history')))),
                ]),
              ]),
            ),
          ),
      ]),
    );
  }
}
