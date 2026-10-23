import 'dart:io' show Platform;

import 'app_state.dart';

/// Push notifications. The build picks the service:
///   --dart-define=PUSH=fcm     Firebase (Google Play builds and iPhone)
///   --dart-define=PUSH=hms     Huawei Push Kit (AppGallery builds, phones without Google services)
///   (none)                     no push; the app still works and refreshes its data itself
/// The device token is registered with the MOTUS server (POST /api/mobile/devices); the server sends
/// the notifications. The service SDKs plug in through [PushProvider].
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
      await s.api.post('/api/mobile/devices', {'platform': platform, 'pushToken': t, 'app': 'admin', 'lang': s.lang, 'appVersion': const String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0')});
    } catch (_) {
      // notifications are optional; the app keeps working without them
    }
  }

  static Future<void> unregister(AppState s) async {
    try {
      await s.api.delete('/api/mobile/devices');
      await provider?.forget();
    } catch (_) {}
  }
}
