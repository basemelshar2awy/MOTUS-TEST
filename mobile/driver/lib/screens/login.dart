import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';

/// sign in with the mobile number and password the company gave the driver
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _pw = TextEditingController();
  late final TextEditingController _server;
  bool _busy = false, _showServer = false, _hide = true;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: AppScope.read(context).api.base);
  }

  Future<void> _go() async {
    final s = AppScope.read(context);
    if (_phone.text.trim().isEmpty || _pw.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.tt('اكتب رقم الموبايل وكلمة السر', 'Enter your mobile number and password'))));
      return;
    }
    setState(() => _busy = true);
    try {
      await s.signIn(_server.text, _phone.text, _pw.text);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      backgroundColor: Mc.navy,
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('MOTUS', style: TextStyle(fontFamily: 'Inter', fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: 4, color: Colors.white)),
              Text(s.tt('تطبيق السائق', 'Driver app'), style: const TextStyle(fontSize: 16, color: Colors.white70, fontWeight: FontWeight.w600)),
            ]),
          ),
          Expanded(
            child: Container(
              decoration: const BoxDecoration(color: Mc.bg, borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
              child: ListView(padding: const EdgeInsets.all(24), children: [
                Text(s.tt('أهلاً بيك', 'Welcome'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(s.tt('ادخل برقم موبايلك وكلمة السر اللي الشركة إدتهالك.', 'Sign in with your mobile number and the password your company gave you.'), style: const TextStyle(color: Mc.muted, fontSize: 15)),
                const SizedBox(height: 20),
                TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  textDirection: TextDirection.ltr,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  style: const TextStyle(fontFamily: 'Inter', fontSize: 20, fontWeight: FontWeight.w600),
                  decoration: InputDecoration(labelText: s.tt('رقم الموبايل', 'Mobile number'), prefixIcon: const Icon(Icons.phone_iphone)),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _pw,
                  obscureText: _hide,
                  autofillHints: const [AutofillHints.password],
                  onSubmitted: (_) => _go(),
                  style: const TextStyle(fontSize: 18),
                  decoration: InputDecoration(labelText: s.tt('كلمة السر', 'Password'), prefixIcon: const Icon(Icons.lock_outline), suffixIcon: IconButton(tooltip: s.tt('إظهار', 'Show'), icon: Icon(_hide ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _hide = !_hide))),
                ),
                const SizedBox(height: 22),
                BigButton(s.tt('دخول', 'Sign in'), Icons.login, onPressed: _go, busy: _busy),
                const SizedBox(height: 16),
                Row(children: [
                  TextButton(onPressed: () => setState(() => _showServer = !_showServer), child: Text(s.tt('عنوان السيرفر', 'Server address'))),
                  const Spacer(),
                  SegmentedButton<String>(
                    segments: const [ButtonSegment(value: 'ar', label: Text('عربي')), ButtonSegment(value: 'en', label: Text('English'))],
                    selected: {s.lang},
                    showSelectedIcon: false,
                    onSelectionChanged: (v) => s.setLang(v.first),
                  ),
                ]),
                if (_showServer) TextField(controller: _server, keyboardType: TextInputType.url, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: s.tt('السيرفر', 'Server'), helperText: s.tt('سيبه زي ما هو إلا لو الشركة قالتلك غير كده', 'Leave as is unless your company says otherwise'))),
                const SizedBox(height: 12),
                Text(s.tt('نسيت كلمة السر؟ كلم الشركة تعملك كلمة سر جديدة.', 'Forgot the password? Ask your company for a new one.'), textAlign: TextAlign.center, style: const TextStyle(color: Mc.muted)),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

/// the first sign-in: the driver picks their own password
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _cur = TextEditingController();
  final _new = TextEditingController();
  bool _busy = false;
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('كلمة سر جديدة', 'New password')), actions: [TextButton(onPressed: s.signOut, child: Text(s.tt('خروج', 'Sign out')))]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text(s.tt('أول مرة تدخل: اختار كلمة سر خاصة بيك (12 حرف على الأقل، فيها حروف كبيرة وصغيرة وأرقام ورموز).', 'First sign-in: choose your own password (at least 12 characters with upper and lower case, digits and symbols).'), style: const TextStyle(color: Mc.muted, fontSize: 15)),
        const SizedBox(height: 16),
        TextField(controller: _cur, obscureText: true, decoration: InputDecoration(labelText: s.tt('كلمة السر اللي الشركة إدتهالك', 'The password from your company'))),
        const SizedBox(height: 12),
        TextField(controller: _new, obscureText: true, decoration: InputDecoration(labelText: s.tt('كلمة السر الجديدة', 'New password'))),
        const SizedBox(height: 20),
        BigButton(
          s.tt('حفظ', 'Save'),
          Icons.check,
          busy: _busy,
          onPressed: () async {
            setState(() => _busy = true);
            try {
              await s.changePassword(_cur.text, _new.text);
            } catch (e) {
              if (context.mounted) showError(context, e);
            } finally {
              if (mounted) setState(() => _busy = false);
            }
          },
        ),
      ]),
    );
  }
}

/// the account drives for several companies, or this account is not a driver's
class CompanyScreen extends StatelessWidget {
  const CompanyScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cos = s.companies;
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('الشركة', 'Company')), actions: [TextButton(onPressed: s.signOut, child: Text(s.tt('خروج', 'Sign out')))]),
      body: RefreshIndicator(
        onRefresh: s.reload,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (cos.isEmpty)
            EmptyState(Icons.badge_outlined, s.tt('الحساب ده مش حساب سواق', 'This is not a driver account'), text: s.tt('تطبيق السائق للسواقين بس. لو إنت من إدارة الشركة استخدم تطبيق MOTUS للإدارة.', 'The driver app is for drivers. Company staff use the MOTUS admin app.')),
          if (cos.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(s.tt('بتسوق لأكتر من شركة. اختار الشركة:', 'You drive for more than one company. Choose:'), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
          for (final c in cos)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Box(
                border: s.company['id'] == c['id'] ? Mc.navy : null,
                onTap: () async {
                  try {
                    await s.switchCompany(str(c['id']));
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  }
                },
                child: Row(children: [
                  const Icon(Icons.apartment, color: Mc.navy),
                  const SizedBox(width: 12),
                  Expanded(child: Text(s.l(c['name']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17))),
                  const Icon(Icons.chevron_left, color: Mc.muted),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}
