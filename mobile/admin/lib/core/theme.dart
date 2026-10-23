import 'package:flutter/material.dart';

/// MOTUS colors (the dashboard's tokens).
class Mc {
  static const Color navy = Color(0xFF08264A);
  static const Color deep = Color(0xFF061D38);
  static const Color bg = Color(0xFFF4F6F9);
  static const Color border = Color(0xFFDCE2EA);
  static const Color muted = Color(0xFF64748B);
  static const Color hover = Color(0xFFEEF2F7);
  static const Color success = Color(0xFF15803D);
  static const Color successBg = Color(0xFFECFDF3);
  static const Color warning = Color(0xFFB45309);
  static const Color warningInk = Color(0xFF7A3A06);
  static const Color warningBg = Color(0xFFFFF7E6);
  static const Color danger = Color(0xFFB91C1C);
  static const Color dangerBg = Color(0xFFFEF2F2);
  static const Color chart5 = Color(0xFFC3CFDC);
  static const Color chart4 = Color(0xFF8FA3BA);
}

ThemeData motusTheme() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Cairo',
    colorScheme: ColorScheme.fromSeed(seedColor: Mc.navy, primary: Mc.navy, surface: Colors.white, error: Mc.danger),
    scaffoldBackgroundColor: Mc.bg,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(backgroundColor: Colors.white, foregroundColor: Mc.navy, elevation: 0, scrolledUnderElevation: 0.5, centerTitle: false, titleTextStyle: TextStyle(fontFamily: 'Cairo', fontSize: 18, fontWeight: FontWeight.w800, color: Mc.navy)),
    cardTheme: CardThemeData(color: Colors.white, elevation: 0, margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: Mc.border))),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Mc.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Mc.border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Mc.navy, width: 2)),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(backgroundColor: Mc.navy, minimumSize: const Size(44, 50), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), textStyle: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 15))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(foregroundColor: Mc.navy, minimumSize: const Size(44, 44), side: const BorderSide(color: Mc.border), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)), textStyle: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600))),
    navigationBarTheme: NavigationBarThemeData(backgroundColor: Colors.white, indicatorColor: Mc.hover, labelTextStyle: WidgetStateProperty.all(const TextStyle(fontFamily: 'Cairo', fontSize: 11, fontWeight: FontWeight.w600, color: Mc.navy))),
    dividerColor: Mc.hover,
  );
}

/// numbers in Inter, tabular
const TextStyle numStyle = TextStyle(fontFamily: 'Inter', fontFeatures: [FontFeature.tabularFigures()]);
