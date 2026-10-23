import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/app_state.dart';
import 'core/theme.dart';
import 'screens/home.dart';
import 'screens/login.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState();
  state.init();
  runApp(AppScope(state: state, child: const DriverApp()));
}

class DriverApp extends StatelessWidget {
  const DriverApp({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return MaterialApp(
      title: 'MOTUS Driver',
      debugShowCheckedModeBanner: false,
      theme: motusTheme(),
      locale: Locale(s.lang),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: const Gate(),
    );
  }
}

/// starting, signed out, first password, not a driver account, company choice, or my trips
class Gate extends StatelessWidget {
  const Gate({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    if (!s.ready) return const Scaffold(backgroundColor: Mc.navy, body: Center(child: CircularProgressIndicator(color: Colors.white)));
    if (!s.signedIn) return const LoginScreen();
    if (s.mustChangePassword) return const ChangePasswordScreen();
    if (!s.isDriver || !s.hasCompany || s.snap == null) return const CompanyScreen();
    return const HomeScreen();
  }
}
