import 'dart:async';

import 'protocol.dart';

/// One user-facing sentence for any failure the shell catches.
///
/// `docs/design.md` §8 forbids raw exception text: a timeout used to read
/// `TimeoutException after 0:00:30.000000: core did not answer settings.get`,
/// and a dead core `Bad state: core is not running`. The core's own typed
/// message wins when there is one; everything else is mapped to a sentence that
/// says what happened and what to do.
String userMessage(Object failure) {
  if (failure is RpcException) {
    final data = failure.data;
    if (data is Map && data['message'] is String) {
      final message = (data['message'] as String).trim();
      if (message.isNotEmpty) return message;
    }
    return failure.message;
  }
  if (failure is TimeoutException) {
    return 'the core did not answer in time — try again';
  }
  if (failure is StateError) {
    return 'the core is not running — reconnect from the top bar';
  }
  return 'something went wrong — try again';
}
