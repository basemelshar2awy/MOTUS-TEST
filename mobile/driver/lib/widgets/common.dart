import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/theme.dart';

class Box extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final Color? border;
  final VoidCallback? onTap;
  const Box({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.border, this.onTap});
  @override
  Widget build(BuildContext context) {
    final c = Container(
      padding: padding,
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: border ?? Mc.border, width: border == null ? 1 : 2)),
      child: child,
    );
    if (onTap == null) return c;
    return Material(color: Colors.transparent, child: InkWell(borderRadius: BorderRadius.circular(16), onTap: onTap, child: c));
  }
}

class Pill extends StatelessWidget {
  final String text;
  final Color fg;
  final Color bg;
  const Pill(this.text, {super.key, this.fg = Mc.navy, this.bg = Mc.hover});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: TextStyle(color: fg, fontSize: 13, fontWeight: FontWeight.w700)),
      );
}

Pill statusPill(AppState s, String status) {
  switch (status) {
    case 'running':
      return Pill(s.tt('شغالة دلوقتي', 'In progress'), fg: Mc.success, bg: Mc.successBg);
    case 'completed':
      return Pill(s.tt('خلصت', 'Done'), fg: Mc.muted, bg: Mc.hover);
    case 'cancelled':
      return Pill(s.tt('اتلغت', 'Cancelled'), fg: Mc.danger, bg: Mc.dangerBg);
    default:
      return Pill(s.tt('لسه مبدأتش', 'Not started'), fg: Mc.warningInk, bg: Mc.warningBg);
  }
}

/// the one big button a screen is about (start, finish)
class BigButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final Color color;
  final bool busy;
  const BigButton(this.label, this.icon, {super.key, this.onPressed, this.color = Mc.navy, this.busy = false});
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 64,
        child: FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: color, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), textStyle: const TextStyle(fontFamily: 'Cairo', fontSize: 20, fontWeight: FontWeight.w800)),
          onPressed: busy ? null : onPressed,
          icon: busy ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white)) : Icon(icon, size: 28),
          label: Text(label),
        ),
      );
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
          Container(width: 72, height: 72, decoration: const BoxDecoration(color: Mc.hover, shape: BoxShape.circle), child: Icon(icon, size: 36, color: Mc.navy)),
          const SizedBox(height: 14),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          if (text != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(text!, textAlign: TextAlign.center, style: const TextStyle(color: Mc.muted, fontSize: 15))),
        ]),
      );
}

void showError(BuildContext context, Object e) {
  final s = AppScope.read(context);
  final msg = e is ApiError ? e.message(s.ar) : s.tt('حصل خطأ غير متوقع', 'Something went wrong');
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg, style: const TextStyle(fontFamily: 'Cairo', fontSize: 15)), backgroundColor: Mc.danger, behavior: SnackBarBehavior.floating));
}

void toast(BuildContext context, String msg) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg, style: const TextStyle(fontFamily: 'Cairo', fontSize: 15)), backgroundColor: Mc.success, behavior: SnackBarBehavior.floating));
}

/// a big number field (odometer, money, the delivery code)
class NumField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? helper;
  final bool big;
  final bool autofocus;
  const NumField(this.controller, this.label, {super.key, this.helper, this.big = false, this.autofocus = false});
  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        autofocus: autofocus,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        textDirection: TextDirection.ltr,
        textAlign: TextAlign.center,
        style: TextStyle(fontFamily: 'Inter', fontSize: big ? 28 : 20, fontWeight: FontWeight.w700, letterSpacing: big ? 4 : 0, color: Mc.navy),
        decoration: InputDecoration(labelText: label, helperText: helper, helperStyle: const TextStyle(fontSize: 13)),
      );
}

num? parseNum(String v) => num.tryParse(v.replaceAll(',', '').replaceAll('٫', '.').replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}').trim());
