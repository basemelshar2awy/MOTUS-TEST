// Generated from the web dashboard menu (web/js/05-ui.js U.nav) — keep in step with it.
// Every dashboard screen: id, icon, Arabic, English, roles that see it, activity it belongs to.

class NavItem {
  final String id;
  final String icon;
  final String ar;
  final String en;
  final List<String> roles;
  final List<String>? activities;
  const NavItem(this.id, this.icon, this.ar, this.en, this.roles, [this.activities]);
}

class NavGroup {
  final String ar;
  final String en;
  final List<NavItem> items;
  const NavGroup(this.ar, this.en, this.items);
}

const List<NavGroup> dashboardMenu = [
  NavGroup("الرئيسية", "Overview", [
    NavItem("dashboard", "dashboard", "لوحة التحكم", "Executive dashboard", ["super_admin","company_admin","fleet_manager","operations","accountant","maintenance","viewer"]),
    NavItem("alerts", "bell", "التنبيهات", "Alerts", ["super_admin","company_admin","fleet_manager","operations","accountant","maintenance","viewer"]),
  ]),
  NavGroup("مدير الحركة", "Dispatch", [
    NavItem("dispatch", "board", "لوحة توزيع الحركة", "Dispatch board", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("calendar", "calendar", "تقويم الحركة", "Operations calendar", ["super_admin","company_admin","fleet_manager","operations","viewer"]),
    NavItem("readiness", "shield", "جاهزية المركبات", "Vehicle readiness", ["super_admin","company_admin","fleet_manager","operations","maintenance"]),
    NavItem("inspections", "clipboard", "فحص ما قبل الرحلة", "Pre-trip inspections", ["super_admin","company_admin","fleet_manager","operations","maintenance"]),
    NavItem("availability", "clock", "إتاحة السائقين", "Driver availability", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("subcontract", "truck", "مركبات من الباطن", "Subcontracted vehicles", ["super_admin","company_admin","fleet_manager","operations","accountant"]),
    NavItem("incidents", "alert", "الحوادث والمخالفات", "Accidents & fines", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("handover", "history", "تسليم الشيفت", "Shift handover", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("documents", "folder", "المستندات", "Document vault", ["super_admin","company_admin","fleet_manager","operations","maintenance"]),
    NavItem("driverapp", "phone", "شاشة السائق", "Driver app view", ["super_admin","company_admin","fleet_manager","operations"]),
  ]),
  NavGroup("العمليات", "Operations", [
    NavItem("bookings", "ticket", "الحجوزات", "Bookings", ["super_admin","company_admin","fleet_manager","operations","accountant","viewer"]),
    NavItem("programs", "route", "البرامج السياحية", "Tour programs", ["super_admin","company_admin","fleet_manager","operations","accountant","viewer"], ["tourism"]),
    NavItem("lines", "route", "الخطوط", "Lines", ["super_admin","company_admin","fleet_manager","operations","accountant","viewer"], ["education","staff","intercity"]),
    NavItem("trips", "bus", "الرحلات", "Trips", ["super_admin","company_admin","fleet_manager","operations","accountant","viewer"]),
    NavItem("contracts", "clipboard", "عقود التشغيل", "Operating contracts", ["super_admin","company_admin","fleet_manager","operations","accountant","viewer"]),
  ]),
  NavGroup("الأسطول", "Fleet", [
    NavItem("vehicles", "car", "المركبات", "Vehicles", ["super_admin","company_admin","fleet_manager","operations","accountant","maintenance","viewer"]),
    NavItem("drivers", "users", "السائقين", "Drivers", ["super_admin","company_admin","fleet_manager","operations","viewer"]),
    NavItem("fuel", "fuel", "المحروقات", "Fuel", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("oil", "oil", "الزيت والصيانة", "Oil & maintenance", ["super_admin","company_admin","fleet_manager","maintenance"]),
    NavItem("workorders", "wrench", "أوامر الشغل", "Work orders", ["super_admin","company_admin","fleet_manager","maintenance"]),
    NavItem("tires", "tire", "الكاوتش والبطاريات", "Tires & batteries", ["super_admin","company_admin","fleet_manager","maintenance"]),
  ]),
  NavGroup("المخازن", "Warehouses", [
    NavItem("items", "box", "الأصناف وقطع الغيار", "Items & spare parts", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("stock", "warehouse", "المخازن والأرصدة", "Warehouses & stock", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("movements", "swap", "حركة المخزون", "Stock movements", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("purchasing", "cart", "طلبات وأوامر الشراء", "Purchasing", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("suppliers", "building", "الموردين", "Suppliers", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("counts", "clipboard", "الجرد", "Stock counts", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
  ]),
  NavGroup("التتبع", "Tracking", [
    NavItem("livemap", "map", "الخريطة المباشرة", "Live map", ["super_admin","company_admin","fleet_manager","operations","viewer"]),
    NavItem("history", "route", "سجل المسارات", "Route history", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("geofences", "pin", "المناطق الجغرافية", "Geofences", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("behavior", "gauge", "سلوك السائقين", "Driver behavior", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("devices", "radio", "أجهزة التتبع", "Tracking devices", ["super_admin","company_admin","fleet_manager","maintenance"]),
  ]),
  NavGroup("المالية", "Finance", [
    NavItem("clients", "users", "العملاء", "Clients", ["super_admin","company_admin","fleet_manager","accountant","operations","viewer"]),
    NavItem("invoices", "file", "الفواتير", "Invoices", ["super_admin","company_admin","fleet_manager","accountant","viewer"]),
    NavItem("payments", "wallet", "المدفوعات والتحصيل", "Payments & collection", ["super_admin","company_admin","fleet_manager","accountant"]),
    NavItem("expenses", "receipt", "المصروفات", "Expenses", ["super_admin","company_admin","fleet_manager","accountant"]),
    NavItem("journal", "book", "القيود المحاسبية", "Journal entries", ["super_admin","company_admin","fleet_manager","accountant"]),
  ]),
  NavGroup("التقارير", "Reports", [
    NavItem("reports", "chart", "مركز التقارير", "Reports center", ["super_admin","company_admin","fleet_manager","operations","accountant","maintenance","viewer"]),
  ]),
  NavGroup("الذكاء الاصطناعي", "AI intelligence", [
    NavItem("copilot", "bot", "المساعد الذكي", "Fleet copilot", ["super_admin","company_admin","fleet_manager","operations","accountant","maintenance"]),
    NavItem("insights", "sparkles", "رؤى الإدارة", "Executive insights", ["super_admin","company_admin","fleet_manager","accountant","viewer"]),
    NavItem("assign", "board", "التوزيع الذكي", "Smart assignment", ["super_admin","company_admin","fleet_manager","operations"]),
    NavItem("profit", "trend", "مستشار الربحية", "Profitability advisor", ["super_admin","company_admin","fleet_manager","accountant"]),
    NavItem("fuelai", "fuel", "ذكاء الوقود", "Fuel intelligence", ["super_admin","company_admin","fleet_manager","maintenance","accountant"]),
    NavItem("maintai", "wrench", "ذكاء الصيانة", "Maintenance intelligence", ["super_admin","company_admin","fleet_manager","maintenance"]),
    NavItem("pricing", "tag", "التسعير الذكي", "Smart pricing", ["super_admin","company_admin","fleet_manager","operations","accountant"]),
    NavItem("docai", "scan", "قراءة المستندات", "Document intelligence", ["super_admin","company_admin","fleet_manager","operations","accountant","maintenance"]),
    NavItem("invai", "box", "ذكاء المخزون", "Inventory intelligence", ["super_admin","company_admin","fleet_manager","maintenance"]),
    NavItem("reconai", "swap", "ذكاء التتبع والمطابقة", "Tracking & matching AI", ["super_admin","company_admin","fleet_manager","accountant","operations"]),
  ]),
  NavGroup("الإعدادات", "Settings", [
    NavItem("company", "building", "بيانات الشركة", "Company profile", ["super_admin","company_admin"]),
    NavItem("users", "user", "المستخدمين والصلاحيات", "Users & roles", ["super_admin","company_admin"]),
    NavItem("vtypes", "bus", "أنواع المركبات", "Vehicle types", ["super_admin","company_admin","fleet_manager"]),
    NavItem("coa", "book", "دليل الحسابات والربط", "Accounts mapping", ["super_admin","company_admin","accountant"]),
    NavItem("erp", "db", "مزامنة ERP", "ERP sync", ["super_admin","company_admin","accountant"]),
    NavItem("providers", "plug", "مزودي الخدمة", "Service providers", ["super_admin","company_admin","fleet_manager","accountant"]),
    NavItem("reconcile", "swap", "مطابقة المعاملات", "Transaction matching", ["super_admin","company_admin","fleet_manager","accountant"]),
    NavItem("api", "key", "التكاملات وAPI", "Integrations & API", ["super_admin","company_admin"]),
    NavItem("audit", "history", "سجل العمليات", "Audit log", ["super_admin","company_admin","accountant"]),
    NavItem("aisettings", "sparkles", "إعدادات الذكاء الاصطناعي", "AI settings", ["super_admin","company_admin"]),
  ]),
];
