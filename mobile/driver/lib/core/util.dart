import 'package:intl/intl.dart';

/// JSON as the server sends it.
typedef J = Map<String, dynamic>;

String str(dynamic v) => v == null ? '' : v.toString();

num numv(dynamic v) {
  if (v is num) return v;
  return num.tryParse(str(v)) ?? 0;
}

J obj(dynamic v) => v is Map ? v.map((k, e) => MapEntry(k.toString(), e)) : <String, dynamic>{};

List<J> list(dynamic v) => v is List ? v.whereType<Map>().map(obj).toList() : <J>[];

/// A bilingual value from the server: {ar, en}, [ar, en] or plain text.
String loc(dynamic v, bool ar) {
  if (v is Map) {
    final a = str(v['ar']), e = str(v['en']);
    return ar ? (a.isNotEmpty ? a : e) : (e.isNotEmpty ? e : a);
  }
  if (v is List && v.length >= 2) return ar ? str(v[0]) : str(v[1]);
  return str(v);
}

/// Numbers always in Western digits, like the dashboard.
final NumberFormat _n0 = NumberFormat('#,##0', 'en');
final NumberFormat _n1 = NumberFormat('#,##0.0', 'en');
String n0(dynamic v) => _n0.format(numv(v));
String n1(dynamic v) => _n1.format(numv(v));
String pct(dynamic v, [int digits = 1]) => '${(numv(v) * 100).toStringAsFixed(digits)}%';

String moneyFmt(dynamic v, String currency, bool ar) {
  final c = currency == 'SAR' ? (ar ? 'ر.س' : 'SAR') : (ar ? 'ج.م' : 'EGP');
  return '${n0(v)} $c';
}

String moneyK(dynamic v, String currency, bool ar) {
  final x = numv(v);
  if (x.abs() >= 1000000) return '${(x / 1000000).toStringAsFixed(2)}M';
  if (x.abs() >= 10000) return '${(x / 1000).toStringAsFixed(1)}K';
  return moneyFmt(x, currency, ar);
}

/// yyyy-mm-dd → dd/mm/yyyy
String date(dynamic v) {
  final s = str(v);
  if (s.length < 10) return s;
  return '${s.substring(8, 10)}/${s.substring(5, 7)}/${s.substring(0, 4)}';
}

String addDays(String iso, int days) {
  final d = DateTime.utc(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10))).add(Duration(days: days));
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

const List<String> _daysAr = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
const List<String> _daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
String dayName(String iso, bool ar) {
  final d = DateTime.utc(int.parse(iso.substring(0, 4)), int.parse(iso.substring(5, 7)), int.parse(iso.substring(8, 10)));
  final i = d.weekday % 7;
  return ar ? _daysAr[i] : _daysEn[i];
}
