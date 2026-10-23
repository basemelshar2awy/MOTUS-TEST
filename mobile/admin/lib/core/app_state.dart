import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'push.dart';
import 'util.dart';

/// Everything the app knows: the server, the signed-in account, the company being worked on and
/// its data (the same snapshot the dashboard loads). Screens read from here and call [act].
class AppState extends ChangeNotifier {
  static const String defaultBase = String.fromEnvironment('MOTUS_URL', defaultValue: 'https://motus.sabeelbus.com');
  static const FlutterSecureStorage _store = FlutterSecureStorage();

  final Api api = Api(defaultBase);
  bool ready = false;
  bool busy = false;
  String lang = 'ar';
  bool mustChangePassword = false;
  J? session;
  J? snap;
  int? _version;
  Timer? _poll;

  // ---------- language ----------
  bool get ar => lang == 'ar';
  String tt(String a, String e) => ar ? a : e;
  String l(dynamic v) => loc(v, ar);

  // ---------- account and company ----------
  J? get user {
    final u = obj(session?['user']);
    return u.isEmpty ? null : u;
  }

  bool get signedIn => user != null;
  J get company => obj(session?['company']);
  bool get hasCompany => company.isNotEmpty;
  String get role => str(user?['role']);
  List<J> get companies => list(session?['companies']);
  List<J> get invites => list(session?['invites']);
  bool get readOnly => role == 'viewer';

  // ---------- company data ----------
  J get data => obj(snap?['data']);
  List<J> coll(String name) => list(data[name]);
  J find(String name, dynamic id) {
    if (id == null) return <String, dynamic>{};
    for (final x in coll(name)) {
      if (x['id'] == id) return x;
    }
    return <String, dynamic>{};
  }

  String get today => str(snap?['today']).isEmpty ? DateTime.now().toIso8601String().substring(0, 10) : str(snap?['today']);
  String get currency {
    final c = str(obj(snap?['company'])['currency']);
    return c.isEmpty ? 'EGP' : c;
  }

  List<String> get activities => (snap?['activities'] is List) ? (snap!['activities'] as List).map((e) => '$e').toList() : <String>[];
  bool has(Object? acts) {
    if (acts == null) return true;
    if (acts is List) return acts.any((a) => activities.contains(a));
    return activities.contains(acts);
  }

  String? get single => activities.length == 1 ? activities.first : null;
  bool get multi => activities.length > 1;
  J get profiles => obj(snap?['profiles']);
  J prof(String? act) => obj(obj(profiles['byActivity'])[act ?? single ?? (activities.isEmpty ? 'tourism' : activities.first)]);
  String actName(String act) {
    for (final a in list(snap?['activityCatalog'])) {
      if (a['code'] == act) return l(a['name']);
    }
    const names = {'tourism': ['سياحة', 'Tourism'], 'education': ['مدارس وجامعات', 'Schools & universities'], 'staff': ['نقل موظفين', 'Staff transport'], 'intercity': ['بين المدن', 'Intercity'], 'cargo': ['بضائع', 'Cargo']};
    final n = names[act];
    return n == null ? act : (ar ? n[0] : n[1]);
  }

  /// what the company calls its bookings: "الشحنات" for cargo, "الحجوزات" otherwise
  String get unitsLabel => single != null ? l(prof(single)['units']) : tt('الحجوزات', 'Bookings');
  String typeName(dynamic type) => l(obj(profiles['tripTypeNames'])[str(type)]).isEmpty ? str(type) : l(obj(profiles['tripTypeNames'])[str(type)]);
  String place(dynamic code) {
    for (final g in coll('geofences')) {
      if (g['code'] == code) return l(g['name']);
    }
    return str(code);
  }

  String vtype(dynamic code) {
    for (final t in coll('vehicleTypes')) {
      if (t['code'] == code) return l(t['name']);
    }
    return str(code);
  }

  String loadText(J b) {
    if (str(b['activity']) == 'cargo') return numv(b['loadKg']) > 0 ? '${n0(b['loadKg'])} ${tt('كجم', 'kg')}' : '—';
    final p = prof(str(b['activity']));
    return '${n0(b['pax'])} ${l(obj(p['load'])['short'])}';
  }

  String money(dynamic v) => moneyText(v);
  String moneyText(dynamic v) => moneyFmt(v, currency, ar);

  // ---------- lifecycle ----------
  Future<void> init() async {
    try {
      lang = await _store.read(key: 'lang') ?? 'ar';
      api.base = await _store.read(key: 'base') ?? AppState.defaultBase;
      api.token = await _store.read(key: 'token');
      if (api.token != null) await reload();
    } catch (_) {
      // a stored token that no longer works: start signed out
    }
    ready = true;
    notifyListeners();
  }

  Future<void> signIn(String base, String login, String password) async {
    api.base = base.trim().isEmpty ? AppState.defaultBase : base.trim();
    api.token = null;
    final r = obj(await api.post('/api/login', {'login': login.trim(), 'password': password, 'client': 'mobile'}));
    api.token = str(r['token']);
    mustChangePassword = r['mustChangePassword'] == true;
    await _store.write(key: 'base', value: api.base);
    await _store.write(key: 'token', value: api.token);
    await reload();
    unawaited(Push.register(this));
  }

  Future<void> changePassword(String current, String next) async {
    final r = obj(await api.post('/api/password', {'currentPassword': current, 'newPassword': next}));
    if (str(r['token']).isNotEmpty) {
      api.token = str(r['token']);
      await _store.write(key: 'token', value: api.token);
    }
    mustChangePassword = false;
    await reload();
  }

  /// the account and its companies, then the company's data
  Future<void> reload() async {
    try {
      session = obj(await api.get('/api/session'));
      if (!signedIn) {
        await _forget();
        return;
      }
      final ul = str(user?['lang']);
      if (ul == 'ar' || ul == 'en') lang = ul;
      if (hasCompany) {
        snap = obj(await api.get('/api/snapshot'));
        _version = numv(snap?['version']).toInt();
        _startPolling();
      } else {
        snap = null;
      }
    } on ApiError catch (e) {
      if (e.status == 401) {
        await _forget();
        return;
      }
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> loadSnapshot() async {
    if (!hasCompany) return;
    snap = obj(await api.get('/api/snapshot'));
    _version = numv(snap?['version']).toInt();
    notifyListeners();
  }

  /// another person (or a Sabeel module) changed the company's data: reload it
  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) async {
      if (!signedIn || !hasCompany) return;
      try {
        final v = numv(obj(await api.get('/api/version'))['version']).toInt();
        if (v != _version) await loadSnapshot();
      } catch (_) {}
    });
  }

  /// a dashboard action; the data reloads after it so every screen shows the change
  Future<dynamic> act(String name, Map<String, dynamic> input) async {
    busy = true;
    notifyListeners();
    try {
      final r = await api.act(name, input);
      await loadSnapshot();
      return r;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> switchCompany(String id) async {
    await api.post('/api/session/company', {'companyId': id});
    snap = null;
    await reload();
  }

  Future<void> answerInvite(String companyId, bool accept) async {
    await api.post('/api/session/invites/$companyId/${accept ? 'accept' : 'decline'}');
    await reload();
  }

  Future<void> setLang(String l) async {
    lang = l;
    await _store.write(key: 'lang', value: l);
    notifyListeners();
    try {
      await api.post('/api/session/lang', {'lang': l});
    } catch (_) {}
  }

  Future<void> signOut() async {
    try {
      await Push.unregister(this);
      await api.post('/api/logout');
    } catch (_) {}
    await _forget();
  }

  Future<void> _forget() async {
    _poll?.cancel();
    api.token = null;
    session = null;
    snap = null;
    await _store.delete(key: 'token');
    notifyListeners();
  }

  /// a one-time link that opens a dashboard screen inside the app
  Future<Uri> webLink(String route) async {
    final r = obj(await api.post('/api/mobile/link', {'route': route}));
    return api.uri(str(r['path']));
  }
}

/// the app state for the widget tree
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);
  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
