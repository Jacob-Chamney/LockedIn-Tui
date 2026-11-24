import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

void main() {
  testWidgets('the shell opens on chat with the core connected', (
    tester,
  ) async {
    await pumpShell(tester);

    expect(find.text('LOCKEDIN'), findsWidgets);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(find.text('NORMAL'), findsOneWidget);
    // Usage and the help chord are separate status cells now, so the bar's
    // right side reads as three groups instead of one sentence.
    // The status bar and the composer's own line both report usage, so this is
    // deliberately not `findsOneWidget`.
    expect(find.text('42 tok · cost unknown'), findsWidgets);
    expect(find.text('? help'), findsOneWidget);
    expect(find.text('openai/gpt-4.1-mini'), findsWidgets);
    expect(find.text('core offline'), findsNothing);
  });

  testWidgets('a sidebar tap opens real Stats data', (tester) async {
    await pumpShell(tester);
    await expandSidebar(tester);

    await tester.tap(find.text('Stats'));
    await tester.pumpAndSettle();

    expect(find.text('TOKENS'), findsOneWidget);
    expect(find.text('24.4K'), findsOneWidget);
    expect(find.text('TOKENS OVER TIME'), findsOneWidget);
    expect(find.text('openai/gpt-4.1-mini'), findsWidgets);
    expect(find.text('Jan – Nov 2026'), findsOneWidget);
  });

  testWidgets('Alt+2 opens the real session list', (tester) async {
    await pumpShell(tester);

    await openSurface(tester, 2);

    expect(find.text('Audit session'), findsOneWidget);
    expect(find.text('Physics — Unit 4'), findsOneWidget);
  });

  testWidgets('returning to Stats refetches usage after a chat turn', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await expandSidebar(tester);
    final before = core.calls.where((call) => call == 'stats.summary').length;

    await tester.tap(find.text('Stats'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Chat'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Stats'));
    await tester.pumpAndSettle();

    final after = core.calls.where((call) => call == 'stats.summary').length;
    expect(after, greaterThan(before));
  });

  testWidgets('a first-run user can connect a model from Settings', (
    tester,
  ) async {
    final store = await pumpShell(tester, core: FakeCore(configured: false));
    expect(store.configured, isFalse);

    await expandSidebar(tester);
    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('settings-connect-model')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('settings-provider-key')),
      'sk-test',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('settings-link')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('settings-use-model')));
    await tester.pumpAndSettle();

    expect(store.settings?.chatModel, 'openai/gpt-4.1-mini');
    expect(store.workspace?.configured, isTrue);
    expect(find.text('openai/gpt-4.1-mini'), findsWidgets);
  });

  testWidgets('Settings shows the core projection', (tester) async {
    await pumpShell(tester);
    await expandSidebar(tester);

    await tester.tap(find.text('Settings'));
    await tester.pumpAndSettle();

    expect(find.text('SETTINGS'), findsWidgets);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('openai/gpt-4.1-mini'), findsWidgets);
    expect(find.text('folder'), findsOneWidget);
  });

  testWidgets('a failed sidecar is visible when chat opens', (tester) async {
    await pumpShell(tester, core: FakeCore(fail: true));

    expect(find.text('core offline'), findsWidgets);
    // The chat surface is open. Its name is the breadcrumb now: the in-page
    // header that repeated `Chill` was removed (the top bar already says it).
    expect(find.text('Chat'), findsWidgets);
  });
}
