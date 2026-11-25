import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/stats/export_saver.dart';

/// The Stats save dialog's failure copy: one readable line, never a raw
/// exception payload, a stack trace or a path the user did not choose.
void main() {
  test('a filesystem failure keeps the OS reason, not the path', () {
    final reason = saveFailureReason(
      const FileSystemException(
        'write failed',
        '/home/me/secret/stats.md',
        OSError('No space left on device', 28),
      ),
    );
    expect(reason, 'No space left on device');
    expect(reason, isNot(contains('/home/me')));
  });

  test('a filesystem failure without an OS reason keeps its message', () {
    expect(
      saveFailureReason(const FileSystemException('write failed')),
      'write failed',
    );
  });

  test('a missing save dialog says so on this platform', () {
    expect(
      saveFailureReason(MissingPluginException('no implementation')),
      'no save dialog on this platform',
    );
  });

  test('a timeout and a dead core are the shared sentences', () {
    expect(
      saveFailureReason(TimeoutException('core did not answer')),
      'the core did not answer in time — try again',
    );
    expect(
      saveFailureReason(StateError('Bad state: core is not running')),
      'the core is not running — reconnect from the top bar',
    );
  });

  test('a short one-line exception keeps its own message', () {
    expect(
      saveFailureReason(Exception('could not save: disk is full')),
      'could not save: disk is full',
    );
  });

  test('a stack trace or a multi-line blob is replaced, never printed', () {
    final multi = saveFailureReason(
      Exception('FileSystemException: write failed\n#0      main (app.dart:1)'),
    );
    expect(multi, 'something went wrong — try again');
    expect(multi, isNot(contains('\n')));
    expect(multi, isNot(contains('app.dart')));

    final long = saveFailureReason(Exception('x' * 300));
    expect(long, 'something went wrong — try again');
    expect(long.length, lessThanOrEqualTo(200));
  });
}
