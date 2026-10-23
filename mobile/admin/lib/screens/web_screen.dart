import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../core/api.dart';
import '../core/app_state.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// A dashboard screen shown inside the app (reports, settings, inventory, AI tools, …). The app asks
/// the server for a one-time link; the in-app browser opens it signed in, with the web menus hidden.
class WebScreen extends StatefulWidget {
  final String route;
  final String title;
  const WebScreen({super.key, required this.route, this.title = ''});
  @override
  State<WebScreen> createState() => _WebScreenState();
}

class _WebScreenState extends State<WebScreen> {
  WebViewController? _c;
  Object? _error;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    final s = AppScope.read(context);
    setState(() => _error = null);
    try {
      final uri = await s.webLink(widget.route);
      final base = s.api.uri('/');
      final c = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(Mc.bg)
        ..setNavigationDelegate(NavigationDelegate(
          onProgress: (p) {
            if (mounted) setState(() => _progress = p);
          },
          // stay on the MOTUS server; anything else opens outside the app
          onNavigationRequest: (r) {
            final u = Uri.tryParse(r.url);
            if (u == null || u.host == base.host) return NavigationDecision.navigate;
            return NavigationDecision.prevent;
          },
        ));
      await c.loadRequest(uri);
      if (mounted) setState(() => _c = c);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title.isEmpty ? 'MOTUS' : widget.title),
        actions: [IconButton(tooltip: s.tt('تحديث', 'Refresh'), icon: const Icon(Icons.refresh), onPressed: () => _c == null ? _open() : _c!.reload())],
        bottom: _c != null && _progress < 100 ? PreferredSize(preferredSize: const Size.fromHeight(2), child: LinearProgressIndicator(value: _progress / 100, minHeight: 2)) : null,
      ),
      body: _error != null
          ? Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                EmptyState(Icons.cloud_off, _error is ApiError ? (_error as ApiError).message(s.ar) : s.tt('مقدرناش نفتح الشاشة', 'Could not open the screen')),
                OutlinedButton(onPressed: _open, child: Text(s.tt('جرب تاني', 'Try again'))),
              ]),
            )
          : _c == null
              ? const Center(child: CircularProgressIndicator())
              : WebViewWidget(controller: _c!),
    );
  }
}
