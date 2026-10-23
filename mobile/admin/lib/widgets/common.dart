import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/theme.dart';

/// a white card with the dashboard's border
class Box extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? border;
  final VoidCallback? onTap;
  const Box({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.border, this.onTap});
  @override
  Widget build(BuildContext context) {
    final c = Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: border ?? Mc.border)),
      padding: padding,
      child: child,
    );
    if (onTap == null) return c;
    return Material(color: Colors.transparent, child: InkWell(borderRadius: BorderRadius.circular(14), onTap: onTap, child: c));
  }
}

/// a small colored status label
class Pill extends StatelessWidget {
  final String text;
  final Color fg;
  final Color bg;
  const Pill(this.text, {super.key, this.fg = Mc.navy, this.bg = Mc.hover});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: fg)),
      );
}

/// the dashboard's status names and colors
Pill statusPill(AppState s, String status) {
  const names = {
    'scheduled': ['مجدولة', 'Scheduled'], 'running': ['على الطريق', 'In progress'], 'completed': ['مكتملة', 'Completed'], 'cancelled': ['ملغاة', 'Cancelled'],
    'confirmed': ['مؤكد', 'Confirmed'], 'tentative': ['مبدئي', 'Tentative'], 'done': ['منفذ', 'Done'], 'issued': ['مستحقة', 'Issued'], 'partial': ['مدفوعة جزئياً', 'Partly paid'],
    'paid': ['مدفوعة', 'Paid'], 'draft': ['مسودة', 'Draft'], 'active': ['شغال', 'Active'], 'paused': ['موقوف', 'Paused'], 'ended': ['منتهي', 'Ended'],
    'available': ['جاهزة', 'Available'], 'maintenance': ['صيانة', 'Workshop'], 'out_of_service': ['خارج الخدمة', 'Out of service'], 'on_trip': ['على الطريق', 'On a trip'],
    'open': ['مفتوح', 'Open'], 'in_progress': ['شغال', 'In progress'], 'waiting_parts': ['مستني قطع', 'Waiting for parts'], 'closed': ['مقفول', 'Closed'],
  };
  final n = names[status];
  final t = n == null ? status : s.tt(n[0], n[1]);
  switch (status) {
    case 'completed':
    case 'paid':
    case 'available':
    case 'done':
    case 'closed':
    case 'active':
      return Pill(t, fg: Mc.success, bg: Mc.successBg);
    case 'cancelled':
    case 'out_of_service':
      return Pill(t, fg: Mc.danger, bg: Mc.dangerBg);
    case 'tentative':
    case 'partial':
    case 'maintenance':
    case 'waiting_parts':
    case 'paused':
      return Pill(t, fg: Mc.warningInk, bg: Mc.warningBg);
    default:
      return Pill(t);
  }
}

/// a figure with its label
class Kpi extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final Color? subColor;
  const Kpi(this.label, this.value, {super.key, this.sub, this.subColor});
  @override
  Widget build(BuildContext context) => Box(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Mc.muted)),
          Text(value, style: numStyle.copyWith(fontSize: 19, fontWeight: FontWeight.w700, color: Mc.navy)),
          if (sub != null) Text(sub!, style: TextStyle(fontSize: 12, color: subColor ?? Mc.muted)),
        ]),
      );
}

class SectionTitle extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const SectionTitle(this.text, {super.key, this.trailing});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6, bottom: 6),
        child: Row(children: [Expanded(child: Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))), if (trailing != null) trailing!]),
      );
}

/// label/value rows (the dashboard's detail lists)
class Facts extends StatelessWidget {
  final List<(String, String)> rows;
  const Facts(this.rows, {super.key});
  @override
  Widget build(BuildContext context) => Column(children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SizedBox(width: 120, child: Text(r.$1, style: const TextStyle(color: Mc.muted, fontSize: 14))),
              Expanded(child: Text(r.$2, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
            ]),
          ),
      ]);
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? text;
  const EmptyState(this.icon, this.title, {super.key, this.text});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 44, color: Mc.chart4),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          if (text != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(text!, textAlign: TextAlign.center, style: const TextStyle(color: Mc.muted))),
        ]),
      );
}

/// filter chips in one scrolling row
class ChipsRow extends StatelessWidget {
  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelect;
  const ChipsRow({super.key, required this.labels, required this.selected, required this.onSelect});
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 44,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: labels.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (_, i) => ChoiceChip(
            label: Text(labels[i]),
            selected: i == selected,
            onSelected: (_) => onSelect(i),
            selectedColor: Mc.navy,
            labelStyle: TextStyle(color: i == selected ? Colors.white : Mc.navy, fontWeight: FontWeight.w600, fontFamily: 'Cairo'),
            backgroundColor: Colors.white,
            side: BorderSide(color: i == selected ? Mc.navy : Mc.border),
            showCheckmark: false,
          ),
        ),
      );
}

/// show a server error (or any error) the way the dashboard does
void showError(BuildContext context, Object e) {
  final s = AppScope.read(context);
  final msg = e is ApiError ? e.message(s.ar) : s.tt('حصل خطأ غير متوقع', 'Something went wrong');
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Mc.danger, behavior: SnackBarBehavior.floating));
}

void toast(BuildContext context, String msg) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Mc.navy, behavior: SnackBarBehavior.floating));
}

/// run an action with a spinner; errors show as a message. Returns the result, or null on error.
Future<dynamic> runAction(BuildContext context, String name, Map<String, dynamic> input, {String? ok}) async {
  final s = AppScope.read(context);
  try {
    final r = await s.act(name, input);
    if (ok != null && context.mounted) toast(context, ok);
    return r ?? true;
  } catch (e) {
    if (context.mounted) showError(context, e);
    return null;
  }
}

/// ask for a reason (cancellations, overrides)
Future<String?> askText(BuildContext context, String title, String label, {String? confirm, bool danger = false}) async {
  final s = AppScope.read(context);
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: TextField(controller: c, decoration: InputDecoration(labelText: label), maxLines: 3, minLines: 1, autofocus: true),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: Text(s.tt('رجوع', 'Back'))),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: Mc.danger) : null,
          onPressed: () => Navigator.pop(ctx, c.text.trim().isEmpty ? null : c.text.trim()),
          child: Text(confirm ?? s.tt('تأكيد', 'Confirm')),
        ),
      ],
    ),
  );
}

/// a loading / error wrapper for screens that fetch their own data
class Loader<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(BuildContext, T, Future<void> Function()) builder;
  const Loader({super.key, required this.load, required this.builder});
  @override
  State<Loader<T>> createState() => _LoaderState<T>();
}

class _LoaderState<T> extends State<Loader<T>> {
  late Future<T> _f;
  @override
  void initState() {
    super.initState();
    _f = widget.load();
  }

  Future<void> _reload() async {
    final f = widget.load();
    setState(() => _f = f);
    await f;
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<T>(
        future: _f,
        builder: (ctx, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) {
            final s = AppScope.of(ctx);
            final e = snap.error;
            return Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                EmptyState(Icons.cloud_off, e is ApiError ? e.message(s.ar) : s.tt('حصل خطأ', 'Something went wrong')),
                OutlinedButton(onPressed: _reload, child: Text(s.tt('جرب تاني', 'Try again'))),
              ]),
            );
          }
          return widget.builder(ctx, snap.data as T, _reload);
        },
      );
}
