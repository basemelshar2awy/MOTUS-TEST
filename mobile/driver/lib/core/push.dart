import 'dart:io' show Platform;

import 'app_state.dart';

/// Push notifications (a new trip, a cancelled trip). The build picks the service:
///   --dart-define=PUSH=fcm     Firebase (Google Play builds and iPhone)
///   --dart-define=PUSH=hms     Huawei Push Kit (AppGallery builds)
///   (none)                     no push; the app refreshes its trips itself while open
/// The service SDKs plug in through [PushProvider] once the store accounts exist.
abstract class PushProvider {
  Future<String?> token();
  Future<void> forget();
}

class Push {
  static const String service = String.fromEnvironment('PUSH', defaultValue: 'none');
  static PushProvider? provider;

  static String get platform {
    if (service == 'hms') return 'huawei';
    try {
      return Platform.isIOS ? 'ios' : 'android';
    } catch (_) {
      return 'android';
    }
  }

  static Future<void> register(AppState s) async {
    final p = provider;
    if (p == null) return;
    try {
      final t = await p.token();
      if (t == null || t.length < 20) return;
      await s.api.post('/api/mobile/devices', {'platform': platform, 'pushToken': t, 'app': 'driver', 'lang': s.lang, 'appVersion': const String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0')});
    } catch (_) {}
  }

  static Future<void> unregister(AppState s) async {
    try {
      await s.api.delete('/api/mobile/devices');
      await provider?.forget();
    } catch (_) {}
  }
}
