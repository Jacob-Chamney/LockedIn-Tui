import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The shell pump the other shell tests use, with an explicit window size.
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

/// One-based surface digit: the shell maps `Alt+N` to `Surface.values[N - 1]`.
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

Future<void> pressCtrlK(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

/// Expand the rail (`Space e`): it starts shrunk, so its labels only exist once
/// it is open. `Esc` then leaves it open for the pointer.
Future<void> expandSidebar(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the sidebar opens Work with the registered projects', (
    tester,
  ) async {
    await pumpShell(tester);
    await expandSidebar(tester);

    await tester.tap(find.text('Work'));
    await tester.pumpAndSettle();

    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(find.text('My app'), findsOneWidget);
    expect(find.text('API service'), findsOneWidget);
    expect(find.text('WORK'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K lists Work and Enter opens the surface', (tester) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('Work'),
      ),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'work',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Alt+6 opens Work and Alt+0 keeps Settings last', (tester) async {
    await pumpShell(tester);

    await openSurface(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);

    await openSurface(tester, 0);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens the project detail and Esc returns to the list', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 6);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeProjectId, FakeCore.projectId);
    expect(find.text('PROJECT'), findsOneWidget);
    // The statusline names the project page's own keys, not just the way out.
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('status-hint'))).data,
      'c chat · p approvals · w swarm · l activity · r refresh · Esc back',
    );
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(find.text('/home/me/Projects/my-app'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(store.activeProject, isNull);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(find.text('WORK'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('switching surfaces keeps the open project', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 6);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(store.activeProjectId, FakeCore.projectId);

    await openSurface(tester, 1);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('PROJECT'), findsNothing);

    await openSurface(tester, 6);
    expect(store.activeProjectId, FakeCore.projectId);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a missing project root is one readable warning', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 6);

    // Arrow to the archived swarm whose folder is gone.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('the project folder is missing'), findsOneWidget);
    expect(find.text('missing'), findsOneWidget);
    expect(find.text('API service'), findsOneWidget);
    expect(find.text('archived'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Work and the project detail fit 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));

    await openSurface(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
