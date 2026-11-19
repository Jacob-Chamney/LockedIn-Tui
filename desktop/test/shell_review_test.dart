import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

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

int _calls(FakeCore core, String method) =>
    core.calls.where((call) => call == method).length;

void main() {
  testWidgets('Alt+7 opens Review with the queue snapshot', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 7);

    // The page header and the status-bar scope both read REVIEW.
    expect(find.text('REVIEW'), findsWidgets);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(find.text('What does the learning rate control?'), findsOneWidget);
    expect(find.text('2 misses'), findsOneWidget);
    expect(find.byKey(const ValueKey('review-nudge')), findsOneWidget);
    expect(find.byKey(const ValueKey('review-diagnostics')), findsOneWidget);
    expect(find.byKey(const ValueKey('review-mark-hint')), findsOneWidget);
    expect(
      find.text('r refresh · s side · k known · m missed · Esc back'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('k marks the selected step known through review.mark', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 7);

    // The step has priority 1, so it is the initially selected row.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();

    expect(core.reviewMarks, [
      {'itemId': 'step:${FakeCore.sessionId}:1', 'result': 'known'},
    ]);
    expect(core.calls, contains('review.mark'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('entering Review reads review.queue once, r reads it again', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    expect(_calls(core, 'review.queue'), 0);

    await openSurface(tester, 7);
    expect(_calls(core, 'review.queue'), 1);
    expect(core.reviewSides, ['all']);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(_calls(core, 'review.queue'), 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('s asks the core for the next side and keeps the rows', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 7);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();

    expect(core.reviewSides, ['all', 'school']);
    expect(store.reviewSide, 'school');
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Alt+0 opens Settings and Settings stays last', (tester) async {
    await pumpShell(tester);

    await openSurface(tester, 7);
    expect(find.text('Derive the energy balance'), findsOneWidget);

    await openSurface(tester, 0);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('Derive the energy balance'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K lists Review and Enter opens the surface', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('Review'),
      ),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'review',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc returns from Review to chat', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 7);
    expect(find.text('Derive the energy balance'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('Derive the energy balance'), findsNothing);
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the Review surface fits 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await openSurface(tester, 7);

    expect(find.text('REVIEW'), findsWidgets);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(find.byKey(const ValueKey('review-nudge')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
