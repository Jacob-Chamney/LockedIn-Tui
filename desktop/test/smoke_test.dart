import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

Future<CoreStore> pumpShell(WidgetTester tester, {FakeCore? core}) async {
  tester.view.physicalSize = const Size(1280, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

/// The leader key per surface ordinal (1 = Chat … 0 = Settings), matching the
/// terminal app's grammar: `Space c`, `Space h`, `Space g`, `Space s`, `Space t`,
/// `Space p`, `Space v`, `Space f`, `Space n`, `Space ,`.
const _surfaceLeaderKeys = <LogicalKeyboardKey>[
  LogicalKeyboardKey.keyC,
  LogicalKeyboardKey.keyH,
  LogicalKeyboardKey.keyG,
  LogicalKeyboardKey.keyS,
  LogicalKeyboardKey.keyT,
  LogicalKeyboardKey.keyP,
  LogicalKeyboardKey.keyV,
  LogicalKeyboardKey.keyF,
  LogicalKeyboardKey.keyN,
  LogicalKeyboardKey.comma,
];

/// Open a surface the way the terminal app does: `Space`, then the leader key.
Future<void> openSurface(WidgetTester tester, int surface) async {
  // Leave INSERT first: the leader is a NORMAL-mode chord, exactly as in the
  // terminal app, and the chat composer holds the keyboard on first paint. The
  // status bar is the shell's own answer for the mode, so this never presses
  // Esc on a page that would treat it as "back".
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals view, and navigation must work from all of them.
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  // `0` is the tenth surface (Settings), as in the terminal app.
  final index = surface == 0 ? _surfaceLeaderKeys.length - 1 : surface - 1;
  await tester.sendKeyEvent(_surfaceLeaderKeys[index]);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the shell opens on chat with the core connected', (
    tester,
  ) async {
    await pumpShell(tester);

    expect(find.text('LOCKEDIN'), findsWidgets);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(find.text('NORMAL'), findsOneWidget);
    expect(find.text('42 tok · cost unknown · ? help'), findsOneWidget);
    expect(find.text('openai/gpt-4.1-mini'), findsWidgets);
    expect(find.text('core offline'), findsNothing);
  });

  testWidgets('a sidebar tap opens real Stats data', (tester) async {
    await pumpShell(tester);

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
    expect(find.text('Chill'), findsWidgets);
  });
}
