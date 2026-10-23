import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/theme.dart';
import '../core/util.dart';
import '../widgets/common.dart';

/// sign in with the Sabeel account: email or mobile number
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _login = TextEditingController();
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
    if (_login.text.trim().isEmpty || _pw.text.isEmpty) {
      showError(context, Exception());
      return;
    }
    setState(() => _busy = true);
    try {
      await s.signIn(_server.text, _login.text, _pw.text);
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
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
              Text('MOTUS', style: TextStyle(fontFamily: 'Inter', fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: 4, color: Colors.white)),
              Text('FLEET & MOBILITY MANAGEMENT', style: TextStyle(fontFamily: 'Inter', fontSize: 12, letterSpacing: 1, color: Colors.white70)),
            ]),
          ),
          Expanded(
            child: Container(
              decoration: const BoxDecoration(color: Mc.bg, borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
              child: ListView(padding: const EdgeInsets.all(24), children: [
                Text(s.tt('تسجيل الدخول', 'Sign in'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(s.tt('بحساب سبيل بتاعك: الإيميل أو رقم الموبايل.', 'With your Sabeel account: email or mobile number.'), style: const TextStyle(color: Mc.muted)),
                const SizedBox(height: 18),
                TextField(controller: _login, keyboardType: TextInputType.emailAddress, textDirection: TextDirection.ltr, autofillHints: const [AutofillHints.username], decoration: InputDecoration(labelText: s.tt('الإيميل أو الموبايل', 'Email or mobile'))),
                const SizedBox(height: 12),
                TextField(
                  controller: _pw,
                  obscureText: _hide,
                  autofillHints: const [AutofillHints.password],
                  onSubmitted: (_) => _go(),
                  decoration: InputDecoration(labelText: s.tt('كلمة السر', 'Password'), suffixIcon: IconButton(tooltip: s.tt('إظهار', 'Show'), icon: Icon(_hide ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _hide = !_hide))),
                ),
                const SizedBox(height: 18),
                FilledButton(onPressed: _busy ? null : _go, child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(s.tt('دخول', 'Sign in'))),
                const SizedBox(height: 12),
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
                if (_showServer) TextField(controller: _server, keyboardType: TextInputType.url, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: s.tt('السيرفر', 'Server'), helperText: s.tt('سيبه زي ما هو إلا لو شركتك عندها سيرفر خاص', 'Leave as is unless your company has its own server'))),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}

/// the first sign-in with a temporary password
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
        Text(s.tt('أول دخول: اختار كلمة سر جديدة (12 حرف على الأقل، فيها حروف كبيرة وصغيرة وأرقام ورموز).', 'First sign-in: choose a new password (at least 12 characters with upper and lower case, digits and symbols).'), style: const TextStyle(color: Mc.muted)),
        const SizedBox(height: 16),
        TextField(controller: _cur, obscureText: true, decoration: InputDecoration(labelText: s.tt('كلمة السر المؤقتة', 'Temporary password'))),
        const SizedBox(height: 12),
        TextField(controller: _new, obscureText: true, decoration: InputDecoration(labelText: s.tt('كلمة السر الجديدة', 'New password'))),
        const SizedBox(height: 18),
        FilledButton(
          onPressed: _busy
              ? null
              : () async {
                  setState(() => _busy = true);
                  try {
                    await s.changePassword(_cur.text, _new.text);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: Text(s.tt('حفظ', 'Save')),
        ),
      ]),
    );
  }
}

/// pick the company to work on, or answer an invitation
class CompanyScreen extends StatelessWidget {
  const CompanyScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final cos = s.companies, inv = s.invites;
    return Scaffold(
      appBar: AppBar(title: Text(s.tt('اختار الشركة', 'Choose the company')), actions: [TextButton(onPressed: s.signOut, child: Text(s.tt('خروج', 'Sign out')))]),
      body: RefreshIndicator(
        onRefresh: s.reload,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          if (cos.isEmpty && inv.isEmpty) EmptyState(Icons.apartment, s.tt('الحساب مش مربوط بأي شركة', 'This account is not linked to a company'), text: s.tt('اطلب من الشركة اللي بتشتغل معاها تضيفك.', 'Ask the company you work with to add you.')),
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
                  CircleAvatar(backgroundColor: Mc.hover, child: Text(str(c['code']).length > 3 ? str(c['code']).substring(0, 3) : str(c['code']), style: const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, fontSize: 12, color: Mc.navy))),
                  const SizedBox(width: 12),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(s.l(c['name']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)), Text('${_roleName(s, str(c['role']))} · ${str(c['country'])}', style: const TextStyle(color: Mc.muted, fontSize: 12))])),
                  const Icon(Icons.chevron_left, color: Mc.muted),
                ]),
              ),
            ),
          for (final c in inv)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: Mc.warningBg, borderRadius: BorderRadius.circular(14)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(s.tt('دعوة من «${s.l(c['name'])}»', 'Invitation from “${s.l(c['name'])}”'), style: const TextStyle(fontWeight: FontWeight.w700, color: Mc.warningInk)),
                  Text(_roleName(s, str(c['role'])), style: const TextStyle(color: Mc.warningInk)),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(child: FilledButton(onPressed: () => s.answerInvite(str(c['id']), true), child: Text(s.tt('قبول', 'Accept')))),
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton(onPressed: () => s.answerInvite(str(c['id']), false), child: Text(s.tt('رفض', 'Decline')))),
                  ]),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

String _roleName(AppState s, String r) {
  const n = {
    'super_admin': ['فريق سبيل', 'Sabeel team'], 'company_admin': ['مدير الشركة', 'Company admin'], 'fleet_manager': ['مدير الأسطول', 'Fleet manager'], 'operations': ['التشغيل', 'Operations'],
    'accountant': ['محاسب', 'Accountant'], 'maintenance': ['الصيانة', 'Maintenance'], 'viewer': ['مراجع (قراءة بس)', 'Viewer (read only)'], 'driver': ['سائق', 'Driver'],
  };
  final x = n[r];
  return x == null ? r : s.tt(x[0], x[1]);
}

String roleName(AppState s, String r) => _roleName(s, r);
