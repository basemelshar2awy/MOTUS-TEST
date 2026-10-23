import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'location.dart';
import 'push.dart';
import 'trips.dart';
import 'util.dart';

/// Everything the driver app knows: the server, the driver's account, the company and the
/// driver's own trips (the same data the dashboard's "My trips" page shows).
class AppState extends ChangeNotifier {
  static const String defaultBase = String.fromEnvironment('MOTUS_URL', defaultValue: 'https://motus.sabeelbus.com');
  static const FlutterSecureStorage _store = FlutterSecureStorage();

  final Api api = Api(defaultBase);
  final TripLocation location = TripLocation();
  bool ready = false;
  bool busy = false;
  String lang = 'ar';
  bool mustChangePassword = false;
  J? session;
  J? snap;
  int? _version;
  Timer? _poll;

  bool get ar => lang == 'ar';
  String tt(String a, String e) => ar ? a : e;
  String l(dynamic v) => loc(v, ar);

  J? get user {
    final u = obj(session?['user']);
    return u.isEmpty ? null : u;
  }

  bool get signedIn => user != null;
  bool get isDriver => str(user?['role']) == 'driver';
  J get company => obj(session?['company']);
  bool get hasCompany => company.isNotEmpty;
  List<J> get companies => list(session?['companies']).where((c) => c['role'] == 'driver').toList();

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
  List<J> get trips => coll('trips');
  TripPlan get plan => TripPlan.of(trips, today);
  J get me => coll('drivers').isEmpty ? <String, dynamic>{} : coll('drivers').first;
  String get myName => l(me['name']).isEmpty ? l(user?['name']) : l(me['name']);

  J placeOf(dynamic code) {
    for (final g in coll('geofences')) {
      if (g['code'] == code) return g;
    }
    return <String, dynamic>{};
  }

  String place(dynamic code) {
    final p = placeOf(code);
    return p.isEmpty ? str(code) : l(p['name']);
  }

  String typeName(dynamic type) {
    final n = obj(obj(snap?['profiles'])['tripTypeNames'])[str(type)];
    return n == null ? str(type) : l(n);
  }

  /// "8 طلاب", "1,200 كجم"…: the trip's load in the activity's own words
  String loadText(J t) {
    if (str(t['activity']) == 'cargo') {
      final b = find('bookings', t['bookingId']);
      return numv(b['loadKg']) > 0 ? '${n0(b['loadKg'])} ${tt('كجم', 'kg')}' : tt('شحنة', 'Shipment');
    }
    final p = obj(obj(obj(snap?['profiles'])['byActivity'])[str(t['activity'])]);
    final unit = l(obj(p['load'])['short']);
    return '${n0(t['pax'])} ${unit.isEmpty ? tt('راكب', 'pax') : unit}';
  }

  Future<void> init() async {
    try {
      lang = await _store.read(key: 'lang') ?? 'ar';
      api.base = await _store.read(key: 'base') ?? AppState.defaultBase;
      api.token = await _store.read(key: 'token');
      if (api.token != null) await reload();
    } catch (_) {}
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

  Future<void> reload() async {
    try {
      session = obj(await api.get('/api/session'));
      if (!signedIn) {
        await _forget();
        return;
      }
      mustChangePassword = mustChangePassword || user?['mustChangePassword'] == true;
      final ul = str(user?['lang']);
      if (ul == 'ar' || ul == 'en') lang = ul;
      if (hasCompany && isDriver) {
        await loadSnapshot(notify: false);
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

  Future<void> loadSnapshot({bool notify = true}) async {
    snap = obj(await api.get('/api/snapshot'));
    _version = numv(snap?['version']).toInt();
    location.follow(this);
    if (notify) notifyListeners();
  }

  /// the company changed something (a new trip, a new time): reload
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

  Future<dynamic> act(String name, Map<String, dynamic> input) async {
    busy = true;
    notifyListeners();
    try {
      final r = await api.act(name, input);
      await loadSnapshot(notify: false);
      return r;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> startTrip(String id, num odometer) => act('me.tripStart', {'id': id, 'odometer': odometer});

  Future<void> finishTrip(String id, {required num endKm, num tolls = 0, num parking = 0, String? code, String? note}) => act('me.tripComplete', {
        'id': id,
        'endKm': endKm,
        'expenses': {'tolls': tolls, 'parking': parking},
        if (code != null && code.isNotEmpty) 'deliveryCode': code,
        if (note != null && note.isNotEmpty) 'note': note,
      });

  Future<void> switchCompany(String id) async {
    await api.post('/api/session/company', {'companyId': id});
    snap = null;
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
    location.stop();
    api.token = null;
    session = null;
    snap = null;
    mustChangePassword = false;
    await _store.delete(key: 'token');
    notifyListeners();
  }
}

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);
  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
