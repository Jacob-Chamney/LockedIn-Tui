import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/work/agent_dialog.dart';

/// The Templates row's failure copy goes through the shared mapper, so a raw
/// exception never reaches the dialog.
void main() {
  test('a dead core becomes its sentence, not a StateError', () {
    final line = templateReadFailure(
      StateError('Bad state: core is not running'),
    );
    expect(line, contains('the core is not running'));
    expect(line, isNot(contains('StateError')));
    expect(line, isNot(contains('\n')));
  });

  test('a short one-line reason survives', () {
    expect(
      templateReadFailure(Exception('the templates folder is unreadable')),
      'the templates could not be read — the templates folder is unreadable',
    );
  });

  test('a multi-line payload is replaced rather than printed', () {
    final line = templateReadFailure(
      Exception('RpcException: failed\n#0      main (app.dart:1)'),
    );
    expect(
      line,
      'the templates could not be read — something went wrong — try again',
    );
    expect(line, isNot(contains('app.dart')));
    expect(line, isNot(contains('\n')));
  });
}
