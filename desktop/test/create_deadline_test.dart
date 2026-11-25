import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';

/// Review #36 / ADR 0019: a create has its own deadline; a model run still has
/// none, because abandoning it would report a failure while the core writes.
void main() {
  test('session.create gets 60 seconds, model runs get none', () {
    expect(CoreClient.createDeadline, const Duration(seconds: 60));
    expect(CoreClient.deadlineFor('session.create'), CoreClient.createDeadline);
    expect(CoreClient.deadlineFor('session.generateSteps'), isNull);
    expect(CoreClient.deadlineFor('session.output.build'), isNull);
    expect(
      CoreClient.deadlineFor('session.list'),
      CoreClient.quickCallDeadline,
    );
  });
}
