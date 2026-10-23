import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/nav.dart';
import '../core/theme.dart';
import '../core/util.dart';
import 'login.dart';
import 'routes.dart';

const Map<String, IconData> _icons = {
  'dashboard': Icons.dashboard_outlined, 'bell': Icons.notifications_none, 'board': Icons.view_timeline_outlined, 'calendar': Icons.calendar_month_outlined, 'shield': Icons.verified_user_outlined,
  'clipboard': Icons.fact_check_outlined, 'clock': Icons.schedule, 'truck': Icons.local_shipping_outlined, 'alert': Icons.report_outlined, 'handover': Icons.swap_horiz, 'file': Icons.description_outlined,
  'phone': Icons.phone_android, 'ticket': Icons.confirmation_number_outlined, 'route': Icons.route_outlined, 'bus': Icons.directions_bus_outlined, 'contract': Icons.handshake_outlined,
  'car': Icons.directions_car_outlined, 'users': Icons.groups_outlined, 'fuel': Icons.local_gas_station_outlined, 'oil': Icons.oil_barrel_outlined, 'wrench': Icons.build_outlined, 'tire': Icons.tire_repair,
  'box': Icons.inventory_2_outlined, 'warehouse': Icons.warehouse_outlined, 'movement': Icons.sync_alt, 'cart': Icons.shopping_cart_outlined, 'supplier': Icons.storefront_outlined, 'count': Icons.checklist,
  'map': Icons.map_outlined, 'history': Icons.timeline, 'geofence': Icons.fence, 'behavior': Icons.speed, 'device': Icons.router_outlined, 'invoice': Icons.receipt_long_outlined, 'money': Icons.payments_outlined,
  'expense': Icons.request_quote_outlined, 'journal': Icons.menu_book_outlined, 'chart': Icons.bar_chart, 'bot': Icons.smart_toy_outlined, 'spark': Icons.auto_awesome_outlined, 'building': Icons.apartment,
  'user': Icons.person_outline, 'settings': Icons.settings_outlined, 'link': Icons.link, 'plug': Icons.power_outlined, 'key': Icons.key_outlined, 'audit': Icons.history_edu_outlined,
};

/// Every dashboard screen this person may open, grouped like the web menu. Screens the app has
/// natively open natively; the rest open the dashboard's own screen inside the app.
class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key});
  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final q = _q.trim().toLowerCase();
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: false, title: Text(s.tt('المزيد', 'More'))),
      body: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
          child: TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: s.tt('ابحث عن شاشة', 'Find a screen'))),
        ),
        for (final g in dashboardMenu)
          Builder(builder: (_) {
            final items = g.items.where((it) => it.roles.contains(s.role) && s.has(it.activities) && (q.isEmpty || '${it.ar} ${it.en}'.toLowerCase().contains(q))).toList();
            if (items.isEmpty) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Container(
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Mc.border)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Padding(padding: const EdgeInsets.fromLTRB(14, 10, 14, 2), child: Text(s.tt(g.ar, g.en), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Mc.muted))),
                  for (final it in items)
                    ListTile(
                      dense: true,
                      leading: Icon(_icons[it.icon] ?? Icons.circle_outlined, color: Mc.navy, size: 22),
                      title: Text(it.id == 'bookings' ? s.unitsLabel : s.tt(it.ar, it.en), style: const TextStyle(fontSize: 15)),
                      trailing: const Icon(Icons.chevron_left, color: Mc.muted, size: 20),
                      onTap: () => openRoute(context, it.id, title: s.tt(it.ar, it.en)),
                    ),
                ]),
              ),
            );
          }),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Container(
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Mc.border)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Padding(padding: const EdgeInsets.fromLTRB(14, 10, 14, 2), child: Text(s.tt('حسابي', 'My account'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Mc.muted))),
              ListTile(dense: true, leading: const Icon(Icons.person_outline, color: Mc.navy), title: Text(str(s.user?['login'])), subtitle: Text('${roleName(s, s.role)} · ${s.l(s.company['name'])}')),
              if (s.companies.length > 1 || s.invites.isNotEmpty)
                ListTile(dense: true, leading: const Icon(Icons.swap_horiz, color: Mc.navy), title: Text(s.tt('تبديل الشركة', 'Switch company')), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CompanyScreen()))),
              ListTile(
                dense: true,
                leading: const Icon(Icons.language, color: Mc.navy),
                title: Text(s.tt('اللغة', 'Language')),
                trailing: SegmentedButton<String>(
                  segments: const [ButtonSegment(value: 'ar', label: Text('عربي')), ButtonSegment(value: 'en', label: Text('EN'))],
                  selected: {s.lang},
                  showSelectedIcon: false,
                  onSelectionChanged: (v) => s.setLang(v.first),
                ),
              ),
              ListTile(dense: true, leading: const Icon(Icons.dns_outlined, color: Mc.navy), title: Text(s.tt('السيرفر', 'Server')), subtitle: Text(s.api.base, textDirection: TextDirection.ltr)),
              ListTile(
                dense: true,
                leading: const Icon(Icons.logout, color: Mc.danger),
                title: Text(s.tt('تسجيل الخروج', 'Sign out'), style: const TextStyle(color: Mc.danger)),
                onTap: () async {
                  await s.signOut();
                  if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
                },
              ),
            ]),
          ),
        ),
        Padding(padding: const EdgeInsets.all(16), child: Text('MOTUS · ${const String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0')}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Mc.muted))),
      ]),
    );
  }
}
