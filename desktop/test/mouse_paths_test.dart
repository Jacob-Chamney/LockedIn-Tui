import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

void main() {
  testWidgets('the model badge opens Settings', (tester) async {
    await pumpShell(tester);

    expect(find.byKey(const ValueKey('model-badge')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('model-badge')));
    await tester.pumpAndSettle();

    expect(find.text('SETTINGS'), findsWidgets);
    expect(find.text('username'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the chat link to a model opens Settings', (tester) async {
    // Unconfigured is the state that shows the link at all.
    await pumpShell(tester, core: FakeCore(configured: false));

    final link = find.byKey(const ValueKey('chat-link-model'));
    expect(link, findsOneWidget);
    await tester.tap(link);
    await tester.pumpAndSettle();

    expect(find.text('SETTINGS'), findsWidgets);
    expect(find.text('username'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
