import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/nav.dart';
import 'bookings.dart';
import 'dispatch.dart';
import 'home.dart';
import 'lines.dart';
import 'more.dart';
import 'vehicles.dart';

/// can this person open that dashboard screen (role + company activities), as on the web
bool canSee(AppState s, String id) {
  for (final g in dashboardMenu) {
    for (final it in g.items) {
      if (it.id == id) return it.roles.contains(s.role) && s.has(it.activities);
    }
  }
  return true;
}

class _Tab {
  final String id;
  final IconData icon;
  final String label;
  final Widget page;
  _Tab(this.id, this.icon, this.label, this.page);
}

/// the bottom tabs: Home, Dispatch, the company's work (bookings / shipments / lines), Fleet, More
class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _i = 0;
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    const lineActs = ['education', 'staff', 'intercity'];
    final linesOnly = s.single != null && lineActs.contains(s.single);
    final tabs = <_Tab>[
      _Tab('home', Icons.home_outlined, s.tt('الرئيسية', 'Home'), const HomeScreen()),
      if (canSee(s, 'dispatch')) _Tab('dispatch', Icons.view_timeline_outlined, s.tt('الحركة', 'Dispatch'), const DispatchScreen()),
      if (linesOnly && canSee(s, 'lines'))
        _Tab('lines', Icons.route_outlined, s.tt('الخطوط', 'Lines'), const LinesScreen())
      else if (canSee(s, 'bookings'))
        _Tab('bookings', Icons.inventory_2_outlined, s.unitsLabel, const BookingsScreen()),
      if (canSee(s, 'vehicles')) _Tab('vehicles', Icons.local_shipping_outlined, s.tt('الأسطول', 'Fleet'), const VehiclesScreen()),
      _Tab('more', Icons.more_horiz, s.tt('المزيد', 'More'), const MoreScreen()),
    ];
    if (_i >= tabs.length) _i = 0;
    return Scaffold(
      body: IndexedStack(index: _i, children: [for (final t in tabs) t.page]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        height: 64,
        onDestinationSelected: (v) => setState(() => _i = v),
        destinations: [for (final t in tabs) NavigationDestination(icon: Icon(t.icon), label: t.label)],
      ),
    );
  }
}
