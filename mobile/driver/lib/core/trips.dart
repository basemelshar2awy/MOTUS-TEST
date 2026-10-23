import 'util.dart';

/// How the driver's trips are arranged on the home screen (pure, so it is tested).
class TripPlan {
  /// the trip the big button is for: the one running, else the next one not started
  final J? focus;
  final List<J> today;
  final List<J> tomorrow;
  final List<J> later;
  final int doneToday;
  const TripPlan(this.focus, this.today, this.tomorrow, this.later, this.doneToday);

  static String _key(J t) => '${str(t['date'])} ${str(t['startTime'])} ${str(t['number'])}';

  factory TripPlan.of(List<J> trips, String today) {
    final live = trips.where((t) => t['status'] != 'cancelled').toList()..sort((a, b) => _key(a).compareTo(_key(b)));
    final running = live.where((t) => t['status'] == 'running').toList();
    // a scheduled trip from an earlier day that nobody started still needs the driver
    final waiting = live.where((t) => t['status'] == 'scheduled' && str(t['date']).compareTo(addDays(today, 1)) <= 0).toList();
    final next = live.where((t) => t['status'] == 'scheduled').toList();
    final focus = running.isNotEmpty ? running.first : (waiting.isNotEmpty ? waiting.first : (next.isNotEmpty ? next.first : null));
    final tomorrow = addDays(today, 1);
    final active = live.where((t) => t['status'] == 'scheduled' || t['status'] == 'running');
    return TripPlan(
      focus,
      active.where((t) => str(t['date']).compareTo(today) <= 0).toList(),
      active.where((t) => t['date'] == tomorrow).toList(),
      active.where((t) => str(t['date']).compareTo(tomorrow) > 0).take(20).toList(),
      live.where((t) => t['status'] == 'completed' && t['date'] == today).length,
    );
  }
}

/// what the finish form asks for: the consignee's code only for a cargo trip whose shipment waits for it
bool needsDeliveryCode(J trip, J booking) => str(trip['activity']) == 'cargo' && booking['hasCode'] == true && str(booking['deliveredAt']).isEmpty;

/// a map link that opens the phone's maps app (Google Maps, Apple Maps, Petal Maps through the browser)
Uri mapLink(num lat, num lng) => Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng');
