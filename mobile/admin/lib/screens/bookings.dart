import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';
import 'dispatch.dart';
import 'routes.dart';

String bookingTitle(AppState s, J b) {
  if (b['activity'] == 'cargo') {
    if (b['tripType'] == 'empty_return') return s.tt('عودة فاضية', 'Empty return');
    return '${str(b['goods']).isEmpty ? s.typeName(b['tripType']) : b['goods']} · ${s.loadText(b)}';
  }
  return '${s.typeName(b['tripType'])} · ${s.loadText(b)}';
}

bool shipmentLate(AppState s, J b) {
  if (str(b['deliverDate']).isEmpty || b['status'] == 'cancelled') return false;
  final due = '${b['deliverDate']} ${str(b['deliverTime']).isEmpty ? '23:59' : b['deliverTime']}';
  if (str(b['deliveredAt']).isNotEmpty) return str(b['deliveredAt']).compareTo(due) > 0;
  final now = DateTime.now();
  final n = '${s.today} ${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
  return n.compareTo(due) > 0;
}

/// the company's bookings — "Shipments" for a cargo company — by state, with search
class BookingsScreen extends StatefulWidget {
  final bool standalone;
  const BookingsScreen({super.key, this.standalone = false});
  @override
  State<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends State<BookingsScreen> {
  int _tab = 0;
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final trips = s.coll('trips');
    bool running(J b) => trips.any((t) => t['bookingId'] == b['id'] && t['status'] == 'running');
    final all = s.coll('bookings').where((b) => str(b['lineId']).isEmpty).toList();
    final groups = <List<J>>[
      all.where((b) => !['cancelled', 'done'].contains(b['status']) && !running(b)).toList()..sort((a, b) => '${a['date']}${a['time']}'.compareTo('${b['date']}${b['time']}')),
      all.where(running).toList(),
      all.where((b) => b['status'] == 'done').toList()..sort((a, b) => '${b['date']}'.compareTo('${a['date']}')),
      all.where((b) => b['status'] == 'cancelled').toList(),
    ];
    final q = _q.trim().toLowerCase();
    final rows = groups[_tab].where((b) => q.isEmpty || '${b['number']} ${s.l(s.find('clients', b['clientId'])['name'])} ${b['goods'] ?? ''} ${s.place(b['pickup'])} ${s.place(b['destination'])}'.toLowerCase().contains(q)).toList();
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: widget.standalone, title: Text(s.unitsLabel)),
      floatingActionButton: s.readOnly
          ? null
          : FloatingActionButton.extended(
              backgroundColor: Mc.navy,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.add),
              label: Text(s.single == 'cargo' ? s.tt('شحنة جديدة', 'New shipment') : s.tt('حجز جديد', 'New booking')),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const BookingFormScreen())),
            ),
      body: RefreshIndicator(
        onRefresh: s.loadSnapshot,
        child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
            child: TextField(onChanged: (v) => setState(() => _q = v), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: s.tt('الرقم، العميل، البضاعة، المكان', 'Number, client, goods, place'))),
          ),
          ChipsRow(
            labels: ['${s.tt('قادمة', 'Upcoming')} ${groups[0].length}', '${s.tt('على الطريق', 'On the road')} ${groups[1].length}', s.tt('اتنفذت', 'Done'), s.tt('ملغاة', 'Cancelled')],
            selected: _tab,
            onSelect: (i) => setState(() => _tab = i),
          ),
          const SizedBox(height: 6),
          if (rows.isEmpty) EmptyState(Icons.inbox_outlined, s.tt('مفيش حاجة هنا', 'Nothing here')),
          for (final b in rows.take(200))
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Box(
                border: shipmentLate(s, b) ? Mc.danger : null,
                onTap: () => openRoute(context, 'booking.${b['id']}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(str(b['number']), style: numStyle.copyWith(fontWeight: FontWeight.w700, fontSize: 13))),
                    if (shipmentLate(s, b))
                      Pill(str(b['deliveredAt']).isEmpty ? s.tt('متأخرة عن التسليم', 'Past deadline') : s.tt('اتسلمت متأخر', 'Delivered late'), fg: Mc.danger, bg: Mc.dangerBg)
                    else if (b['unassigned'] == true && b['status'] != 'cancelled')
                      Pill(s.tt('من غير مركبة', 'Unassigned'), fg: Mc.warningInk, bg: Mc.warningBg)
                    else
                      statusPill(s, str(b['status'])),
                  ]),
                  const SizedBox(height: 4),
                  Text(bookingTitle(s, b), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  Text('${s.l(s.find('clients', b['clientId'])['name'])} · ${s.place(b['pickup'])} ← ${s.place(b['destination'])}', style: const TextStyle(fontSize: 13, color: Mc.muted)),
                  Row(children: [
                    Expanded(child: Text('${date(b['date'])} ${b['time']}${str(b['deliverDate']).isNotEmpty ? ' · ${s.tt('تسليم قبل', 'deliver by')} ${date(b['deliverDate'])} ${str(b['deliverTime'])}' : ''}', style: const TextStyle(fontSize: 12, color: Mc.muted))),
                    Text(s.money(b['price']), style: numStyle.copyWith(fontWeight: FontWeight.w700, fontSize: 13)),
                  ]),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

/// one booking / shipment
class BookingScreen extends StatelessWidget {
  final String id;
  const BookingScreen({super.key, required this.id});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final b = s.find('bookings', id);
    if (b.isEmpty) return Scaffold(appBar: AppBar(), body: EmptyState(Icons.search_off, s.tt('مش موجود في الشركة دي', 'Not found in this company')));
    final cargo = b['activity'] == 'cargo';
    final trips = s.coll('trips').where((t) => t['bookingId'] == id && t['status'] != 'cancelled').toList();
    final flags = (b['cargoFlags'] is List) ? (b['cargoFlags'] as List).map((f) => s.l(obj(s.profiles['cargoFlags'])['$f'])).join(' · ') : '';
    final open = !['cancelled', 'done'].contains(b['status']);
    return Scaffold(
      appBar: AppBar(title: Text(str(b['number']))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Box(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text(bookingTitle(s, b), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))), statusPill(s, str(b['status']))]),
            const SizedBox(height: 8),
            Facts([
              (s.tt('العميل', 'Client'), s.l(s.find('clients', b['clientId'])['name'])),
              if (s.multi) (s.tt('النشاط', 'Activity'), s.actName(str(b['activity']))),
              (s.tt('نوع الرحلة', 'Trip type'), s.typeName(b['tripType'])),
              (s.tt('المسار', 'Route'), '${s.place(b['pickup'])} ← ${s.place(b['destination'])}'),
              (cargo ? s.tt('التحميل', 'Loading') : s.tt('الميعاد', 'Time'), '${date(b['date'])} ${b['time']}'),
              if (cargo && str(b['goods']).isNotEmpty) (s.tt('البضاعة', 'Goods'), '${b['goods']}${flags.isEmpty ? '' : ' · $flags'}'),
              (s.l(obj(s.prof(str(b['activity']))['load'])['label']), s.loadText(b)),
              if (cargo && (b['pieces'] != null || b['volumeM3'] != null)) (s.tt('الطرود / الحجم', 'Pieces / volume'), '${b['pieces'] ?? '—'} · ${b['volumeM3'] == null ? '—' : '${n1(b['volumeM3'])} ${s.tt('م³', 'm³')}'}'),
              if (cargo && str(b['deliverDate']).isNotEmpty) (s.tt('آخر موعد للتسليم', 'Deliver by'), '${date(b['deliverDate'])} ${str(b['deliverTime'])}${shipmentLate(s, b) ? ' · ${s.tt('متأخرة', 'late')}' : ''}'),
              if (b['activity'] == 'tourism' && str(b['flight']).isNotEmpty) (s.tt('رقم الطيران', 'Flight'), str(b['flight'])),
              (s.tt('نوع المركبة', 'Vehicle type'), s.vtype(b['vehicleType'])),
              (s.tt('السعر', 'Price'), s.money(b['price'])),
              if (str(b['notes']).isNotEmpty) (s.tt('ملاحظات', 'Notes'), str(b['notes'])),
            ]),
          ]),
        ),
        if (cargo && b['tripType'] != 'empty_return') ...[
          const SizedBox(height: 12),
          Box(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              SectionTitle(s.tt('إثبات التسليم', 'Proof of delivery')),
              Text(
                str(b['deliveredAt']).isNotEmpty
                    ? '${s.tt('اتسلمت', 'Delivered')} ${b['deliveredAt']} · ${str(b['deliveredBy'])}'
                    : b['codeLocked'] == true
                        ? s.tt('الكود اتقفل بعد 5 محاولات غلط — اعمل كود جديد', 'The code locked after 5 wrong tries — issue a new one')
                        : s.tt('السواق بيقفل التسليم بالكود (6 أرقام) اللي مع المستلم.', 'The driver closes the delivery with the 6-digit code the consignee has.'),
                style: TextStyle(color: b['codeLocked'] == true ? Mc.danger : Mc.muted),
              ),
              if (str(b['deliveredAt']).isEmpty && open && !s.readOnly)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: OutlinedButton(
                    onPressed: () async {
                      final r = await runAction(context, 'shipment.newCode', {'id': id});
                      if (r is Map && context.mounted) showDeliveryCode(context, str(b['number']), str(r['deliveryCode']));
                    },
                    child: Text(s.tt('كود تسليم جديد', 'New delivery code')),
                  ),
                ),
            ]),
          ),
        ],
        const SizedBox(height: 12),
        for (final t in trips)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Box(
              onTap: () => openRoute(context, 'trip.${t['id']}'),
              child: Row(children: [
                const Icon(Icons.local_shipping_outlined, color: Mc.navy),
                const SizedBox(width: 10),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(str(t['number']), style: numStyle.copyWith(fontWeight: FontWeight.w700)), Text('${str(s.find('vehicles', t['vehicleId'])['code'])} · ${s.l(s.find('drivers', t['driverId'])['name'])}', style: const TextStyle(fontSize: 12, color: Mc.muted))])),
                statusPill(s, str(t['status'])),
              ]),
            ),
          ),
        if (open && !s.readOnly) ...[
          if (b['unassigned'] == true) FilledButton(onPressed: () => assignSheet(context, b), child: Text(s.tt('تحويل لرحلة وتخصيص مركبة', 'Convert to trip & assign'))),
          const SizedBox(height: 8),
          OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: Mc.danger),
            onPressed: () async {
              final r = await askText(context, s.tt('إلغاء', 'Cancel'), s.tt('السبب', 'Reason'), danger: true, confirm: s.tt('تأكيد الإلغاء', 'Confirm cancellation'));
              if (r != null && context.mounted) await runAction(context, 'booking.cancel', {'id': id, 'reason': r}, ok: s.tt('اتلغى', 'Cancelled'));
            },
            child: Text(s.tt('إلغاء', 'Cancel')),
          ),
        ],
      ]),
    );
  }
}

/// the delivery code is shown once: the shipper gives it to the consignee
void showDeliveryCode(BuildContext context, String number, String code) {
  final s = AppScope.read(context);
  showDialog(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('${s.tt('كود تسليم', 'Delivery code')} $number'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        SelectableText(code, style: numStyle.copyWith(fontSize: 34, fontWeight: FontWeight.w700, letterSpacing: 6)),
        const SizedBox(height: 8),
        Text(s.tt('الكود ده بيظهر مرة واحدة. ابعته للشاحن علشان يديه للمستلم؛ السواق ما يقدرش يقفل التسليم من غيره.', 'This code is shown once. Send it to the shipper to give to the consignee; the driver cannot close the delivery without it.'), style: const TextStyle(color: Mc.muted)),
      ]),
      actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: Text(s.tt('تمام', 'Done')))],
    ),
  );
}

/// a new booking / shipment; the fields follow the activity (like the dashboard and the server)
class BookingFormScreen extends StatefulWidget {
  const BookingFormScreen({super.key});
  @override
  State<BookingFormScreen> createState() => _BookingFormScreenState();
}

class _BookingFormScreenState extends State<BookingFormScreen> {
  String? _act, _client, _type, _pickup, _dest, _vtype;
  String _status = 'confirmed';
  late String _date;
  String _time = '08:00';
  String? _deliverDate;
  String? _deliverTime;
  final Set<String> _flags = {};
  final _goods = TextEditingController(), _kg = TextEditingController(), _pieces = TextEditingController(), _vol = TextEditingController();
  final _pax = TextEditingController(), _price = TextEditingController(), _flight = TextEditingController(), _notes = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final s = AppScope.read(context);
    _act = s.single ?? (s.activities.isEmpty ? 'tourism' : s.activities.first);
    _date = addDays(s.today, 1);
    _setDefaults(s);
  }

  void _setDefaults(AppState s) {
    final p = s.prof(_act);
    _type = _act == 'tourism' ? null : str(p['defaultTripType']);
    _client = null;
    final places = _places(s);
    _pickup = places.isNotEmpty ? places.first : null;
    _dest = places.length > 1 ? places[1] : _pickup;
    final types = _types(s);
    _vtype = types.isNotEmpty ? types.first : null;
  }

  List<String> _places(AppState s) {
    final p = s.prof(_act);
    final kinds = <String>{...((p['placeKinds'] as List?) ?? const []).map((e) => '$e'), ...((s.profiles['commonPlaceKinds'] as List?) ?? const []).map((e) => '$e')};
    return s.coll('geofences').where((g) => kinds.contains(g['kind'])).map((g) => str(g['code'])).toList();
  }

  List<String> _types(AppState s) {
    final cats = {for (final c in s.coll('vehicleCategories')) str(c['code']): c};
    return s.coll('vehicleTypes').where((t) {
      if (t['usable'] == false || t['active'] == false) return false;
      final c = cats[str(t['category'])];
      if (c == null) return true;
      final acts = (c['activities'] as List?) ?? const [];
      return acts.contains(_act);
    }).map((t) => str(t['code'])).toList();
  }

  bool get _cargo => _act == 'cargo';
  bool get _empty => _cargo && _type == 'empty_return';

  Future<void> _pickDate(bool deliver) async {
    final s = AppScope.read(context);
    final first = DateTime.parse(s.today);
    final d = await showDatePicker(context: context, firstDate: first.subtract(const Duration(days: 1)), lastDate: first.add(const Duration(days: 365)), initialDate: DateTime.parse(deliver ? (_deliverDate ?? _date) : _date));
    if (d == null) return;
    final iso = d.toIso8601String().substring(0, 10);
    setState(() {
      if (deliver) {
        _deliverDate = iso;
      } else {
        _date = iso;
      }
    });
  }

  Future<void> _pickTime(bool deliver) async {
    final cur = deliver ? (_deliverTime ?? '12:00') : _time;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(cur.substring(0, 2)), minute: int.parse(cur.substring(3, 5))));
    if (t == null) return;
    final v = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    setState(() {
      if (deliver) {
        _deliverTime = v;
      } else {
        _time = v;
      }
    });
  }

  Future<void> _save() async {
    final s = AppScope.read(context);
    final input = <String, dynamic>{
      'activity': _act, 'clientId': _client, 'date': _date, 'time': _time, 'pickup': _pickup, 'destination': _dest,
      'vehicleType': _vtype, 'price': num.tryParse(_price.text.replaceAll(',', '')) ?? '', 'status': _status, 'notes': _notes.text.trim(),
    };
    if (_type != null && _type!.isNotEmpty) input['tripType'] = _type;
    if (_cargo && !_empty) {
      input['goods'] = _goods.text.trim();
      input['loadKg'] = num.tryParse(_kg.text.replaceAll(',', ''));
      if (_pieces.text.trim().isNotEmpty) input['pieces'] = int.tryParse(_pieces.text.trim());
      if (_vol.text.trim().isNotEmpty) input['volumeM3'] = num.tryParse(_vol.text.trim());
      input['cargoFlags'] = _flags.toList();
      if (_deliverDate != null) input['deliverDate'] = _deliverDate;
      if (_deliverDate != null && _deliverTime != null) input['deliverTime'] = _deliverTime;
    } else if (!_cargo) {
      input['pax'] = int.tryParse(_pax.text.trim());
      if (_act == 'tourism' && _flight.text.trim().isNotEmpty) input['flight'] = _flight.text.trim();
    }
    setState(() => _busy = true);
    try {
      final r = obj(await s.act('booking.create', input));
      if (!mounted) return;
      Navigator.of(context).pop();
      toast(context, '${s.tt('اتحفظ', 'Saved')} ${r['number']}');
      if (str(r['deliveryCode']).isNotEmpty) showDeliveryCode(context, str(r['number']), str(r['deliveryCode']));
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _gap() => const SizedBox(height: 12);

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final p = s.prof(_act);
    final clientTypes = ((p['clientTypes'] as List?) ?? const []).map((e) => '$e').toSet();
    final clients = s.coll('clients').where((c) => c['status'] == 'active' && (!s.multi || clientTypes.contains(c['type']))).toList();
    final tripTypes = obj(p['tripTypes']);
    final places = _places(s);
    final types = _types(s);
    final flags = obj(s.profiles['cargoFlags']);
    DropdownMenuItem<String> item(String v, String t) => DropdownMenuItem(value: v, child: Text(t, overflow: TextOverflow.ellipsis));
    return Scaffold(
      appBar: AppBar(title: Text(_cargo ? s.tt('شحنة جديدة', 'New shipment') : '${s.tt('جديد', 'New')} · ${s.l(p['unit'])}')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (s.multi) ...[
          DropdownButtonFormField<String>(
            key: ValueKey('act'), initialValue: _act,
            decoration: InputDecoration(labelText: s.tt('النشاط', 'Activity')),
            items: [for (final a in s.activities) item(a, s.actName(a))],
            onChanged: (v) => setState(() {
              _act = v;
              _setDefaults(s);
            }),
          ),
          _gap(),
        ],
        DropdownButtonFormField<String>(key: ValueKey('client-$_act'), initialValue: _client, isExpanded: true, decoration: InputDecoration(labelText: s.tt('العميل', 'Client')), items: [for (final c in clients) item(str(c['id']), s.l(c['name']))], onChanged: (v) => setState(() => _client = v)),
        _gap(),
        DropdownButtonFormField<String>(
          key: ValueKey('type-$_act'), initialValue: _type,
          isExpanded: true,
          decoration: InputDecoration(labelText: s.tt('نوع الرحلة', 'Trip type')),
          items: [if (_act == 'tourism') DropdownMenuItem<String>(value: null, child: Text(s.tt('حسب المسار', 'From the route'))), for (final e in tripTypes.entries) item(e.key, s.l(e.value))],
          onChanged: (v) => setState(() => _type = v),
        ),
        _gap(),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: () => _pickDate(false), icon: const Icon(Icons.event), label: Text('${_cargo ? s.tt('تحميل', 'Load') : ''} ${date(_date)}'))),
          const SizedBox(width: 8),
          Expanded(child: OutlinedButton.icon(onPressed: () => _pickTime(false), icon: const Icon(Icons.schedule), label: Text(_time, style: numStyle))),
        ]),
        _gap(),
        if (_cargo && !_empty) ...[
          TextField(controller: _goods, decoration: InputDecoration(labelText: s.tt('البضاعة', 'Goods'), hintText: s.tt('مثلاً: أسمنت شكاير', 'e.g. bagged cement'))),
          _gap(),
          Row(children: [
            Expanded(child: TextField(controller: _kg, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: s.tt('الوزن (كجم)', 'Weight (kg)')))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _pieces, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: s.tt('عدد الطرود', 'Pieces')))),
          ]),
          _gap(),
          TextField(controller: _vol, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: s.tt('الحجم (م³)', 'Volume (m³)'))),
          _gap(),
          Wrap(spacing: 8, children: [
            for (final f in flags.entries)
              FilterChip(label: Text(s.l(f.value)), selected: _flags.contains(f.key), onSelected: (v) => setState(() {
                if (v) {
                  _flags.add(f.key);
                } else {
                  _flags.remove(f.key);
                }
              })),
          ]),
          _gap(),
          Row(children: [
            Expanded(child: OutlinedButton.icon(onPressed: () => _pickDate(true), icon: const Icon(Icons.flag_outlined), label: Text(_deliverDate == null ? s.tt('آخر موعد للتسليم', 'Deliver by') : date(_deliverDate)))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton(onPressed: _deliverDate == null ? null : () => _pickTime(true), child: Text(_deliverTime ?? s.tt('الساعة', 'Time')))),
          ]),
          _gap(),
        ],
        if (_empty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(s.tt('العودة الفاضية من غير بضاعة ولا وزن ولا كود تسليم.', 'An empty return has no goods, weight or delivery code.'), style: const TextStyle(color: Mc.muted))),
        if (!_cargo) ...[
          TextField(controller: _pax, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: s.l(obj(p['load'])['label']))),
          _gap(),
        ],
        if (_act == 'tourism') ...[
          TextField(controller: _flight, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: s.tt('رقم الطيران (اختياري)', 'Flight number (optional)'), hintText: 'MS985')),
          _gap(),
        ],
        DropdownButtonFormField<String>(key: ValueKey('pickup-$_act'), initialValue: _pickup, isExpanded: true, decoration: InputDecoration(labelText: _cargo ? s.tt('مكان التحميل', 'Loading point') : s.tt('مكان الاستلام', 'Pickup')), items: [for (final c in places) item(c, s.place(c))], onChanged: (v) => setState(() => _pickup = v)),
        _gap(),
        DropdownButtonFormField<String>(key: ValueKey('dest-$_act'), initialValue: _dest, isExpanded: true, decoration: InputDecoration(labelText: _cargo ? s.tt('مكان التسليم', 'Delivery point') : s.tt('الوجهة', 'Destination')), items: [for (final c in places) item(c, s.place(c))], onChanged: (v) => setState(() => _dest = v)),
        _gap(),
        DropdownButtonFormField<String>(key: ValueKey('vtype-$_act'), initialValue: _vtype, isExpanded: true, decoration: InputDecoration(labelText: s.tt('نوع المركبة', 'Vehicle type')), items: [for (final t in types) item(t, s.vtype(t))], onChanged: (v) => setState(() => _vtype = v)),
        _gap(),
        TextField(controller: _price, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: s.tt('السعر المتفق عليه', 'Agreed price'))),
        _gap(),
        SegmentedButton<String>(
          segments: [ButtonSegment(value: 'confirmed', label: Text(s.tt('مؤكد', 'Confirmed'))), ButtonSegment(value: 'tentative', label: Text(s.tt('مبدئي', 'Tentative')))],
          selected: {_status},
          onSelectionChanged: (v) => setState(() => _status = v.first),
        ),
        _gap(),
        TextField(controller: _notes, maxLines: 3, minLines: 1, decoration: InputDecoration(labelText: s.tt('ملاحظات', 'Notes'))),
        const SizedBox(height: 18),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_cargo ? s.tt('حفظ الشحنة', 'Save shipment') : s.tt('حفظ', 'Save'))),
        if (_cargo && !_empty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(s.tt('بعد الحفظ هيظهر كود التسليم مرة واحدة.', 'The delivery code shows once after saving.'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Mc.muted))),
        const SizedBox(height: 24),
      ]),
    );
  }
}
