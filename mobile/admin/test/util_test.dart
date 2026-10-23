import 'package:flutter_test/flutter_test.dart';
import 'package:motus_admin/core/api.dart';
import 'package:motus_admin/core/nav.dart';
import 'package:motus_admin/core/util.dart';

void main() {
  test('numbers use Western digits and the company currency', () {
    expect(n0(1234567.4), '1,234,567');
    expect(moneyFmt(2100, 'EGP', true), '2,100 ج.م');
    expect(moneyFmt(2100, 'SAR', false), '2,100 SAR');
    expect(pct(0.234), '23.4%');
    expect(moneyK(412900, 'EGP', true), '412.9K');
  });

  test('dates and days', () {
    expect(date('2026-10-24'), '24/10/2026');
    expect(addDays('2026-10-31', 1), '2026-11-01');
    expect(addDays('2026-03-01', -1), '2026-02-28');
    expect(dayName('2026-10-24', true), 'السبت');
    expect(dayName('2026-10-25', false), 'Sun');
  });

  test('bilingual values from the server', () {
    expect(loc({'ar': 'شحنة', 'en': 'Shipment'}, true), 'شحنة');
    expect(loc({'ar': 'شحنة', 'en': ''}, false), 'شحنة');
    expect(loc(['أحمر', 'Red'], false), 'Red');
    expect(loc('X', true), 'X');
  });

  test('server errors keep both languages', () {
    final e = ApiError.from(409, {'error': {'code': 'unavailable', 'message': {'ar': 'مشغولة', 'en': 'Busy'}, 'field': 'vehicleId'}});
    expect(e.code, 'unavailable');
    expect(e.message(true), 'مشغولة');
    expect(e.message(false), 'Busy');
    expect(e.field, 'vehicleId');
    expect(ApiError.from(500, 'oops').status, 500);
  });

  test('the screens catalog matches the dashboard menu', () {
    final ids = [for (final g in dashboardMenu) for (final it in g.items) it.id];
    expect(ids.toSet().length, ids.length);
    for (final id in ['dashboard', 'dispatch', 'bookings', 'lines', 'vehicles', 'livemap', 'invoices', 'reports', 'copilot', 'users', 'aisettings']) {
      expect(ids, contains(id));
    }
    final lines = dashboardMenu.expand((g) => g.items).firstWhere((it) => it.id == 'lines');
    expect(lines.activities, ['education', 'staff', 'intercity']);
    expect(ids, isNot(contains('mytrips')));
  });
}
