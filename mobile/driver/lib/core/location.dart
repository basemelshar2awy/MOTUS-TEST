import 'dart:async';

import 'package:geolocator/geolocator.dart';

import 'app_state.dart';

/// While the driver's trip is running and the app is open, the phone's location goes to the server
/// every 30 seconds (the company sees the vehicle on the live map, like a tracker). Nothing is sent
/// outside a running trip, and the server ignores it then too.
class TripLocation {
  static const bool _huawei = String.fromEnvironment('PUSH') == 'hms';
  Timer? _timer;
  bool _asked = false;
  bool denied = false;

  void follow(AppState s) {
    final running = s.trips.any((t) => t['status'] == 'running');
    if (running && _timer == null) {
      _send(s);
      _timer = Timer.periodic(const Duration(seconds: 30), (_) => _send(s));
    } else if (!running && _timer != null) {
      stop();
    }
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _send(AppState s) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return;
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied && !_asked) {
        _asked = true;
        p = await Geolocator.requestPermission();
      }
      denied = p == LocationPermission.denied || p == LocationPermission.deniedForever;
      if (denied) return;
      final settings = _huawei ? AndroidSettings(accuracy: LocationAccuracy.high, forceLocationManager: true) : const LocationSettings(accuracy: LocationAccuracy.high);
      final pos = await Geolocator.getCurrentPosition(locationSettings: settings).timeout(const Duration(seconds: 20));
      await s.api.act('me.position', {
        'lat': pos.latitude,
        'lng': pos.longitude,
        'speed': pos.speed < 0 ? 0 : (pos.speed * 3.6).round(),
        if (pos.heading >= 0) 'heading': pos.heading.round(),
        'at': pos.timestamp.toUtc().toIso8601String(),
      });
    } catch (_) {
      // no signal or no connection: the next try is in 30 seconds
    }
  }
}
