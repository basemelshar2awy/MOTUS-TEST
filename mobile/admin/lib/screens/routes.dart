import 'package:flutter/material.dart';

import 'alerts.dart';
import 'bookings.dart';
import 'dispatch.dart';
import 'invoices.dart';
import 'lines.dart';
import 'live_map.dart';
import 'trip.dart';
import 'vehicles.dart';
import 'web_screen.dart';
import 'work_orders.dart';

/// A dashboard route ("vehicle.<id>", "invoices", "report.cargokpi", …) opens its native screen
/// when the app has one, otherwise the dashboard's own screen inside the app — so every task on the
/// web dashboard is reachable from the phone.
Widget screenFor(String route, String title) {
  final i = route.indexOf('.');
  final name = i < 0 ? route : route.substring(0, i);
  final id = i < 0 ? '' : route.substring(i + 1);
  switch (name) {
    case 'alerts':
      return const AlertsScreen();
    case 'dispatch':
      return const DispatchScreen(standalone: true);
    case 'bookings':
      return const BookingsScreen(standalone: true);
    case 'booking':
      return BookingScreen(id: id);
    case 'trip':
      return TripScreen(id: id);
    case 'lines':
      return const LinesScreen(standalone: true);
    case 'line':
      return LineScreen(id: id);
    case 'vehicles':
      return const VehiclesScreen(standalone: true);
    case 'vehicle':
      return VehicleScreen(id: id);
    case 'livemap':
      return const LiveMapScreen();
    case 'workorders':
      return const WorkOrdersScreen();
    case 'invoices':
      return const InvoicesScreen();
    case 'invoice':
      return InvoiceScreen(id: id);
    default:
      return WebScreen(route: route, title: title);
  }
}

void openRoute(BuildContext context, String route, {String title = ''}) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => screenFor(route, title)));
}
