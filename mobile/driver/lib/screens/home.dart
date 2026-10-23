import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'trip.dart';

/// My trips: the trip to do now with one big button, then today, tomorrow and later
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final plan = s.plan;
    final focus = plan.focus;
    final rest = plan.today.where((t) => t['id'] != focus?['id']).toList();
    return Scaffold(
      backgroundColor: Mc.bg,
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: EdgeInsets.zero, children: [
          _Header(),
          Transform.translate(
            offset: const Offset(0, -28),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: focus == null
                  ? Box(child: EmptyState(Icons.directions_bus_outlined, s.tt('مفيش رحلات عليك دلوقتي', 'No trips for you right now'), text: s.tt('أول ما الشركة تحطك على رحلة هتظهر هنا.', 'When the company gives you a trip it appears here.')))
                  : FocusCard(trip: focus),
            ),
          ),
          if (plan.doneToday > 0)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(children: [
                const Icon(Icons.check_circle, color: Mc.success, size: 20),
                const SizedBox(width: 6),
                Text(s.tt('خلصت ${plan.doneToday} رحلة النهارده', '${plan.doneToday} trip(s) done today'), style: const TextStyle(color: Mc.success, fontWeight: FontWeight.w700)),
              ]),
            ),
          _Section(s.tt('باقي النهارده', 'Rest of today'), rest),
          _Section(s.tt('بكرة', 'Tomorrow'), plan.tomorrow),
          _Section(s.tt('بعد كده', 'Later'), plan.later),
          const SizedBox(height: 32),
        ]),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final first = s.myName.split(' ').first;
    return Container(
      color: Mc.navy,
      padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 12, 8, 44),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.tt('أهلاً يا $first', 'Hello, $first'), style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800)),
            Text('${s.l(s.company['name'])} · ${dayName(s.today, s.ar)} ${date(s.today)}', style: const TextStyle(color: Colors.white70, fontSize: 14)),
          ]),
        ),
        IconButton(tooltip: s.tt('القائمة', 'Menu'), icon: const Icon(Icons.more_vert, color: Colors.white, size: 28), onPressed: () => _menu(context)),
      ]),
    );
  }

  void _menu(BuildContext context) {
    final s = AppScope.read(context);
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.refresh), title: Text(s.tt('تحديث الرحلات', 'Refresh trips')), onTap: () {
            Navigator.pop(ctx);
            s.loadSnapshot().catchError((Object e) {
              if (context.mounted) showError(context, e);
            });
          }),
          ListTile(leading: const Icon(Icons.translate), title: Text(s.ar ? 'English' : 'عربي'), onTap: () {
            Navigator.pop(ctx);
            s.setLang(s.ar ? 'en' : 'ar');
          }),
          if (s.companies.length > 1)
            ListTile(leading: const Icon(Icons.apartment), title: Text(s.tt('تغيير الشركة', 'Switch company')), onTap: () {
              Navigator.pop(ctx);
              final other = s.companies.firstWhere((c) => c['id'] != s.company['id']);
              s.switchCompany(str(other['id']));
            }),
          ListTile(leading: const Icon(Icons.logout, color: Mc.danger), title: Text(s.tt('خروج', 'Sign out'), style: const TextStyle(color: Mc.danger)), onTap: () {
            Navigator.pop(ctx);
            s.signOut();
          }),
        ]),
      ),
    );
  }
}

/// the trip to do now: time, from → to, vehicle, and the one big button
class FocusCard extends StatelessWidget {
  final J trip;
  const FocusCard({super.key, required this.trip});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final t = trip;
    final running = t['status'] == 'running';
    final v = s.find('vehicles', t['vehicleId']);
    final isToday = t['date'] == s.today;
    return Box(
      border: running ? Mc.success : null,
      padding: const EdgeInsets.all(18),
      onTap: () => openTrip(context, t),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Text(running ? s.tt('الرحلة الحالية', 'Current trip') : s.tt('رحلتك الجاية', 'Your next trip'), style: const TextStyle(color: Mc.muted, fontWeight: FontWeight.w700)),
          const Spacer(),
          statusPill(s, str(t['status'])),
        ]),
        const SizedBox(height: 6),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(str(t['startTime']), style: numStyle.copyWith(fontSize: 40, fontWeight: FontWeight.w700, color: Mc.navy, height: 1.1)),
          const SizedBox(width: 10),
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(isToday ? s.tt('النهارده', 'Today') : '${dayName(str(t['date']), s.ar)} ${date(t['date'])}', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: isToday ? Mc.navy : Mc.warningInk)),
          ),
        ]),
        const SizedBox(height: 10),
        RouteLine(from: s.place(t['from']), to: s.place(t['to'])),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 6, children: [
          if (v.isNotEmpty) Pill('${v['code']} · ${s.l(v['plate'])}'),
          Pill(s.loadText(t)),
          Pill(str(t['number']), fg: Mc.muted),
        ]),
        const SizedBox(height: 16),
        TripButton(trip: t),
      ]),
    );
  }
}

/// from → to as two dots joined by a line
class RouteLine extends StatelessWidget {
  final String from;
  final String to;
  const RouteLine({super.key, required this.from, required this.to});
  @override
  Widget build(BuildContext context) {
    Widget row(Color c, String text, {bool filled = true}) => Row(children: [
          Container(width: 14, height: 14, decoration: BoxDecoration(color: filled ? c : Colors.white, shape: BoxShape.circle, border: Border.all(color: c, width: 3))),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
        ]);
    return Column(children: [
      row(Mc.navy, from, filled: false),
      Align(alignment: AlignmentDirectional.centerStart, child: Container(margin: const EdgeInsetsDirectional.only(start: 6), width: 2, height: 16, color: Mc.border)),
      row(Mc.navy, to),
    ]);
  }
}

class _Section extends StatelessWidget {
  final String title;
  final List<J> trips;
  const _Section(this.title, this.trips);
  @override
  Widget build(BuildContext context) {
    if (trips.isEmpty) return const SizedBox.shrink();
    final s = AppScope.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.only(bottom: 8, top: 4), child: Text('$title (${trips.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Mc.muted))),
        for (final t in trips)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Box(
              padding: const EdgeInsets.all(14),
              onTap: () => openTrip(context, t),
              child: Row(children: [
                SizedBox(
                  width: 64,
                  child: Column(children: [
                    Text(str(t['startTime']), style: numStyle.copyWith(fontSize: 20, fontWeight: FontWeight.w700)),
                    if (t['date'] != s.today && t['date'] != addDays(s.today, 1)) Text(date(t['date']).substring(0, 5), style: numStyle.copyWith(fontSize: 12, color: Mc.muted)),
                  ]),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${s.place(t['from'])} ${s.ar ? '←' : '→'} ${s.place(t['to'])}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    Text('${s.find('vehicles', t['vehicleId'])['code'] ?? ''} · ${s.loadText(t)}', style: const TextStyle(color: Mc.muted)),
                  ]),
                ),
                const Icon(Icons.chevron_left, color: Mc.muted),
              ]),
            ),
          ),
      ]),
    );
  }
}
