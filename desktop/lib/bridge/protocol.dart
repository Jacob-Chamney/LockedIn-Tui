/// The JSON-RPC contract between the Flutter shell and the Bun core.
///
/// The wire format is one JSON object per line over stdin/stdout. The core is
/// authoritative; the shell sends intents and renders events.
const int protocolVersion = 1;

class RpcException implements Exception {
  const RpcException(this.code, this.message, [this.data]);

  final int code;
  final String message;
  final Object? data;

  @override
  String toString() => 'RpcException($code, $message)';
}

Map<String, dynamic> rpcRequest(
  int id,
  String method, [
  Map<String, dynamic>? params,
]) {
  return {'jsonrpc': '2.0', 'id': id, 'method': method, 'params': ?params};
}

Map<String, dynamic> rpcNotification(
  String method, [
  Map<String, dynamic>? params,
]) {
  return {'jsonrpc': '2.0', 'method': method, 'params': ?params};
}
