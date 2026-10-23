import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'web_screen.dart';

/// the open balance of an invoice, as the dashboard computes it (total − paid − credit notes)
num invoiceBalance(AppState s, J inv) {
  final cn = s.coll('creditNotes').where((c) => c['invoiceId'] == inv['id']).fold<num>(0, (a, c) => a + numv(c['total']));
  final b = numv(inv['total']) - numv(inv['paid']) - cn;
  return b < 0 ? 0 : b;
}

bool invoiceOverdue(AppState s, J inv) => invoiceBalance(s, inv) > 0.009 && str(inv['dueDate']).compareTo(s.today) < 0 && ['issued', 'partial'].contains(inv['status']);

/// invoices: unpaid, overdue, paid, all
class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key});
  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  int _f = 0;
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final all = s.coll('invoices').where((i) => i['status'] != 'draft').toList()..sort((a, b) => '${b['issueDate']}${b['number']}'.compareTo('${a['issueDate']}${a['number']}'));
    final open = all.where((i) => ['issued', 'partial'].contains(i['status']) && invoiceBalance(s, i) > 0.009).toList();
    final late = open.where((i) => invoiceOverdue(s, i)).toList();
    final paid = all.where((i) => i['status'] == 'paid').toList();
    final rows = [open, late, paid, all][_f];
    final month = s.today.substring(0, 7);
    final collected = s.coll('payments').where((p) => str(p['date']).startsWith(month)).fold<num>(0, (a, p) => a + numv(p['amount']));
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('الفواتير', 'Invoices'))),
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: const EdgeInsets.fromLTRB(0, 12, 0, 24), children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(children: [
              Expanded(child: Kpi(s.tt('مستحق', 'Open'), n0(open.fold<num>(0, (a, i) => a + invoiceBalance(s, i))))),
              const SizedBox(width: 8),
              Expanded(child: Kpi(s.tt('متأخر', 'Overdue'), n0(late.fold<num>(0, (a, i) => a + invoiceBalance(s, i))), subColor: Mc.danger)),
              const SizedBox(width: 8),
              Expanded(child: Kpi(s.tt('اتحصّل الشهر', 'Collected'), n0(collected))),
            ]),
          ),
          const SizedBox(height: 8),
          ChipsRow(labels: [s.tt('غير مدفوعة', 'Unpaid'), s.tt('متأخرة', 'Overdue'), s.tt('مدفوعة', 'Paid'), s.tt('الكل', 'All')], selected: _f, onSelect: (i) => setState(() => _f = i)),
          if (rows.isEmpty) EmptyState(Icons.receipt_long_outlined, s.tt('مفيش فواتير هنا', 'No invoices here')),
          for (final i in rows.take(150))
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Box(
                border: invoiceOverdue(s, i) ? Mc.danger : null,
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => InvoiceScreen(id: str(i['id'])))),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [Expanded(child: Text(str(i['number']), style: numStyle.copyWith(fontWeight: FontWeight.w700, fontSize: 13))), invoiceOverdue(s, i) ? Pill(s.tt('متأخرة', 'Overdue'), fg: Mc.danger, bg: Mc.dangerBg) : statusPill(s, str(i['status']))]),
                  Row(children: [
                    Expanded(child: Text(s.l(s.find('clients', i['clientId'])['name']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
                    Text(n0(i['total']), style: numStyle.copyWith(fontWeight: FontWeight.w700, fontSize: 16)),
                  ]),
                  Text('${s.tt('استحقاق', 'Due')} ${date(i['dueDate'])} · ${s.tt('فاضل', 'Open')} ${n0(invoiceBalance(s, i))}', style: const TextStyle(fontSize: 12, color: Mc.muted)),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

/// one invoice: lines, payments, and recording a payment
class InvoiceScreen extends StatelessWidget {
  final String id;
  const InvoiceScreen({super.key, required this.id});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final inv = s.find('invoices', id);
    if (inv.isEmpty) return Scaffold(appBar: AppBar(), body: EmptyState(Icons.search_off, s.tt('مش موجودة', 'Not found')));
    final bal = invoiceBalance(s, inv);
    final pays = s.coll('payments').where((p) => ((p['allocations'] as List?) ?? const []).any((a) => a is Map && a['invoiceId'] == id)).toList();
    final canPay = ['super_admin', 'company_admin', 'fleet_manager', 'accountant'].contains(s.role) && bal > 0.009 && ['issued', 'partial'].contains(inv['status']);
    final einv = obj(inv['eInvoice']);
    return Scaffold(
      appBar: AppBar(title: Text(str(inv['number']), style: numStyle.copyWith(fontWeight: FontWeight.w800, fontSize: 17)), actions: [
        IconButton(tooltip: s.tt('طباعة / PDF', 'Print / PDF'), icon: const Icon(Icons.picture_as_pdf_outlined), onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebScreen(route: 'invoice.$id', title: str(inv['number']))))),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Box(
          child: Column(children: [
            Text(s.tt('فاضل على العميل', 'Open balance'), style: const TextStyle(color: Mc.muted)),
            Text(s.money(bal), style: numStyle.copyWith(fontSize: 28, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            invoiceOverdue(s, inv) ? Pill(s.tt('متأخرة', 'Overdue'), fg: Mc.danger, bg: Mc.dangerBg) : statusPill(s, str(inv['status'])),
          ]),
        ),
        const SizedBox(height: 12),
        Box(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Facts([
              (s.tt('العميل', 'Client'), s.l(s.find('clients', inv['clientId'])['name'])),
              (s.tt('التاريخ', 'Issued'), date(inv['issueDate'])),
              (s.tt('الاستحقاق', 'Due'), date(inv['dueDate'])),
              if (str(einv['status']).isNotEmpty) (s.tt('الفاتورة الإلكترونية', 'E-invoice'), '${str(einv['provider']).toUpperCase()} · ${einv['status']}'),
            ]),
            const Divider(),
            for (final l in list(inv['lines']).take(30))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [Expanded(child: Text(s.l(l['desc']), style: const TextStyle(fontSize: 13))), Text(n0(l['total']), style: numStyle.copyWith(fontSize: 13))]),
              ),
            const Divider(),
            Row(children: [Expanded(child: Text(s.tt('الضريبة', 'Tax'), style: const TextStyle(color: Mc.muted))), Text(n0(inv['tax']), style: numStyle)]),
            Row(children: [Expanded(child: Text(s.tt('الإجمالي', 'Total'), style: const TextStyle(fontWeight: FontWeight.w800))), Text(n0(inv['total']), style: numStyle.copyWith(fontWeight: FontWeight.w800))]),
          ]),
        ),
        const SizedBox(height: 12),
        if (pays.isNotEmpty)
          Box(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SectionTitle(s.tt('المدفوعات', 'Payments')),
              for (final p in pays) Row(children: [Expanded(child: Text('${p['number']} · ${date(p['date'])} · ${p['method']}')), Text(n0(p['amount']), style: numStyle.copyWith(color: Mc.success))]),
            ]),
          ),
        const SizedBox(height: 12),
        if (canPay) FilledButton(onPressed: () => _pay(context, inv, bal), child: Text(s.tt('تسجيل تحصيل', 'Record payment'))),
      ]),
    );
  }

  Future<void> _pay(BuildContext context, J inv, num bal) async {
    final s = AppScope.read(context);
    final amount = TextEditingController(text: bal.toStringAsFixed(2));
    String method = 'transfer';
    final accounts = s.coll('coa').where((a) => RegExp(r'^(bank|cash)_').hasMatch(str(a['key']))).toList();
    String? account;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(s.tt('تسجيل تحصيل', 'Record payment'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            TextField(controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: s.tt('المبلغ', 'Amount'))),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'transfer', label: Text(s.tt('تحويل', 'Transfer'))),
                ButtonSegment(value: 'cash', label: Text(s.tt('كاش', 'Cash'))),
                ButtonSegment(value: 'cheque', label: Text(s.tt('شيك', 'Cheque'))),
                ButtonSegment(value: 'card', label: Text(s.tt('كارت', 'Card'))),
              ],
              selected: {method},
              showSelectedIcon: false,
              onSelectionChanged: (v) => set(() {
                method = v.first;
                account = null;
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: ValueKey('acc-$method'), initialValue: account,
              isExpanded: true,
              decoration: InputDecoration(labelText: s.tt('الحساب', 'Account')),
              items: [
                for (final a in accounts.where((a) => str(a['key']).startsWith(method == 'cash' ? 'cash_' : 'bank_')))
                  DropdownMenuItem(value: str(a['key']), child: Text(s.l(a['name']), overflow: TextOverflow.ellipsis)),
              ],
              onChanged: (v) => set(() => account = v),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                final amt = num.tryParse(amount.text.replaceAll(',', '')) ?? 0;
                final r = await runAction(ctx, 'payment.create', {
                  'clientId': inv['clientId'],
                  'date': s.today,
                  'amount': amt,
                  'method': method,
                  if (account != null) 'account': account,
                  'autoAllocate': false,
                  'allocations': [
                    {'invoiceId': inv['id'], 'amount': amt > bal ? bal : amt},
                  ],
                });
                if (r is Map && ctx.mounted) {
                  Navigator.pop(ctx);
                  toast(context, '${s.tt('اتسجل', 'Recorded')} ${r['number']}');
                }
              },
              child: Text(s.tt('حفظ التحصيل', 'Save payment')),
            ),
          ]),
        ),
      ),
    );
  }
}
