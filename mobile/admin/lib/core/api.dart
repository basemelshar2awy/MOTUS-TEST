import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// An error from the server, with its Arabic and English message (as the dashboard shows it).
class ApiError implements Exception {
  final int status;
  final String code;
  final String ar;
  final String en;
  final String? field;
  ApiError(this.status, this.code, this.ar, this.en, [this.field]);

  factory ApiError.from(int status, dynamic body) {
    if (body is Map && body['error'] is Map) {
      final e = body['error'] as Map;
      final m = e['message'];
      final ar = m is Map ? '${m['ar'] ?? ''}' : '$m';
      final en = m is Map ? '${m['en'] ?? ''}' : '$m';
      return ApiError(status, '${e['code'] ?? 'error'}', ar, en, e['field']?.toString());
    }
    return ApiError(status, 'http_$status', 'حصل خطأ ($status)', 'Something went wrong ($status)');
  }

  factory ApiError.network() => ApiError(0, 'network', 'مفيش اتصال بالسيرفر. اتأكد من الإنترنت وجرب تاني.', 'Cannot reach the server. Check the connection and try again.');

  String message(bool arabic) => arabic ? (ar.isNotEmpty ? ar : en) : (en.isNotEmpty ? en : ar);

  @override
  String toString() => 'ApiError($status, $code, $en)';
}

/// The MOTUS server: the same routes the dashboard uses, signed in with the app's token.
class Api {
  String base;
  String? token;
  final http.Client _client = http.Client();
  Api(this.base);

  Uri uri(String path) => Uri.parse('${base.replaceAll(RegExp(r'/+$'), '')}$path');

  Future<dynamic> req(String method, String path, [Object? body]) async {
    final headers = <String, String>{'X-Requested-With': 'motus', 'Accept': 'application/json'};
    if (token != null) headers['Authorization'] = 'Bearer $token';
    if (body != null) headers['Content-Type'] = 'application/json';
    http.Response r;
    try {
      final u = uri(path);
      final data = body == null ? null : jsonEncode(body);
      switch (method) {
        case 'GET':
          r = await _client.get(u, headers: headers).timeout(const Duration(seconds: 40));
          break;
        case 'DELETE':
          r = await _client.delete(u, headers: headers).timeout(const Duration(seconds: 40));
          break;
        default:
          r = await _client.post(u, headers: headers, body: data ?? '{}').timeout(const Duration(seconds: 60));
      }
    } on TimeoutException {
      throw ApiError.network();
    } catch (_) {
      throw ApiError.network();
    }
    final text = utf8.decode(r.bodyBytes);
    dynamic out;
    try {
      out = text.isEmpty ? null : jsonDecode(text);
    } catch (_) {
      out = text;
    }
    if (r.statusCode >= 400) throw ApiError.from(r.statusCode, out);
    return out;
  }

  Future<dynamic> get(String path) => req('GET', path);
  Future<dynamic> post(String path, [Object? body]) => req('POST', path, body ?? <String, dynamic>{});
  Future<dynamic> delete(String path) => req('DELETE', path);

  /// one of the dashboard's actions (/api/do/<name>): same validation, permissions and audit
  Future<dynamic> act(String name, Map<String, dynamic> input) => post('/api/do/$name', input);
}
