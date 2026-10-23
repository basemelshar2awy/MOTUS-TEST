import 'package:flutter_test/flutter_test.dart';
import 'package:motus_driver/core/trips.dart';
import 'package:motus_driver/core/util.dart';
import 'package:motus_driver/widgets/common.dart';

J trip(String id, String date, String time, String status, {String activity = 'education'}) => {'id': id, 'number': 'TR-$id', 'date': date, 'startTime': time, 'status': status, 'activity': activity};

void main() {
  const today = '2026-10-24';

  test('the big button is for the running trip first', () {
    final p = TripPlan.of([trip('a', today, '06:00', 'scheduled'), trip('b', today, '07:30', 'running'), trip('c', today, '05:00', 'completed')], today);
    expect(p.focus?['id'], 'b');
    expect(p.doneToday, 1);
    expect(p.today.map((t) => t['id']), ['a', 'b']);
  });

  test('otherwise the earliest trip not started, even one left from yesterday', () {
    final p = TripPlan.of([trip('late', '2026-10-23', '22:00', 'scheduled'), trip('a', today, '06:00', 'scheduled'), trip('t', '2026-10-25', '06:00', 'scheduled'), trip('x', today, '05:00', 'cancelled')], today);
    expect(p.focus?['id'], 'late');
    expect(p.today.map((t) => t['id']), ['late', 'a']);
    expect(p.tomorrow.map((t) => t['id']), ['t']);
    expect(p.later, isEmpty);
  });

  test('a trip next week is shown under later and is the next one when nothing is nearer', () {
    final p = TripPlan.of([trip('w', '2026-10-30', '08:00', 'scheduled')], today);
    expect(p.focus?['id'], 'w');
    expect(p.later.length, 1);
    expect(TripPlan.of([], today).focus, isNull);
  });

  test('the delivery code is asked only for a cargo shipment still waiting for it', () {
    final t = trip('c', today, '09:00', 'running', activity: 'cargo');
    expect(needsDeliveryCode(t, {'hasCode': true}), isTrue);
    expect(needsDeliveryCode(t, {'hasCode': true, 'deliveredAt': '2026-10-24 10:00'}), isFalse);
    expect(needsDeliveryCode(t, {'hasCode': false}), isFalse);
    expect(needsDeliveryCode(trip('s', today, '09:00', 'running'), {'hasCode': true}), isFalse);
  });

  test('numbers typed with Arabic digits or commas', () {
    expect(parseNum('١٢٣٤٥'), 12345);
    expect(parseNum('12,500'), 12500);
    expect(parseNum('٣٫٥'), 3.5);
    expect(parseNum(''), isNull);
    expect(mapLink(30.1, 31.4).toString(), contains('destination=30.1,31.4'));
  });
}
