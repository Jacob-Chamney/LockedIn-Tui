import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// Review #39: the composer strip owns the input keys; the status bar keeps
/// the global leader chord and does not repeat the same line on one screen.
void main() {
  testWidgets('the chat status hint and composer do not duplicate keys', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);

    final status = tester
        .widget<Text>(find.byKey(const ValueKey('status-hint')))
        .data;
    expect(status, 'Space leader');
    expect(status, isNot(contains('Enter send')));
    expect(status, isNot(contains('Shift+Enter')));

    // The composer still names the input keys, exactly once.
    expect(find.textContaining('Enter send'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the usage figures use tabular numerals', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);

    final usage = tester
        .widget<Text>(find.byKey(const ValueKey('status-usage')))
        .style;
    expect(usage?.fontFeatures, contains(const FontFeature.tabularFigures()));
  });
}
