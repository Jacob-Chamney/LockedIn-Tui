import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The same shell pump the other shell tests use, with an explicit window size
/// so the 800×600 cases are real layout passes.
Future<CoreStore> pumpShell(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
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

/// Open the one session the fake serves (the list rows use other ids, so the
/// test opens through the store) and land on the Sessions surface.
Future<CoreStore> openSession(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  final store = await pumpShell(tester, core: core, size: size);
  await store.openSession(FakeCore.sessionId);
  await tester.pumpAndSettle();
  await openSurface(tester, 2);
  return store;
}

Future<void> openWizard(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Sources shows the open session and its attached rows', (
    tester,
  ) async {
    await openSession(tester);
    await openSurface(tester, 4);
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();

    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.text('complex-numbers.pdf'), findsOneWidget);
    // The page's card label and the status-bar scope both read SOURCES.
    expect(find.text('SOURCES'), findsWidgets);
    expect(find.text('open a session first'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Sources without a session is the blocked empty state', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 4);

    expect(find.text('open a session first'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsNothing);
    expect(find.text('SOURCES'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('n opens the wizard and creating lands on the session detail', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 2);

    await openWizard(tester);
    expect(find.text('New lock-in'), findsOneWidget);
    expect(find.text('NEW LOCK-IN'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('new-session-name')),
      'Chemistry — Unit 5',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('new-session-next')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('new-session-prompt')),
      'Explain ionic bonding.',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('new-session-next')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('new-session-create')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('new-session-create')));
    await tester.pumpAndSettle();

    expect(find.text('New lock-in'), findsNothing);
    expect(store.activeSession, isNotNull);
    expect(store.activeSession?.name, 'Chemistry — Unit 5');
    expect(find.text('Chemistry — Unit 5'), findsOneWidget);
    expect(find.text('Explain ionic bonding.'), findsOneWidget);
    expect(find.text('SESSION'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc on the wizard returns to the session list', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 2);
    await openWizard(tester);
    expect(find.text('New lock-in'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('New lock-in'), findsNothing);
    expect(find.text('Audit session'), findsOneWidget);
    expect(store.activeSession, isNull);
    expect(find.text('SESSIONS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Sources and the wizard fit 800x600', (tester) async {
    await openSession(tester, size: const Size(800, 600));
    await openSurface(tester, 4);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the New lock-in wizard fits 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await openSurface(tester, 2);
    await openWizard(tester);

    expect(find.text('New lock-in'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
