import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

void main() {
  testWidgets('opening a step row lands on that step', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 7);

    // The fake's step item is `step:<sessionId>:1`; clicking it opens the
    // session with the second step under the cursor.
    final row = find.byKey(
      const ValueKey('review-row-step:2026-11-01-0900-physics:1'),
    );
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();

    expect(store.activeSessionId, FakeCore.sessionId);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('step-row-selected')),
        matching: find.text('Derive the energy balance'),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('opening a card row lands in its deck', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 7);

    final row = find.byKey(const ValueKey('review-row-card:physics-unit-4:2'));
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();

    expect(store.activeSessionId, FakeCore.sessionId);
    expect(store.outputKind, 'flashcards');
    expect(find.byKey(const ValueKey('session-output-deck')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

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
      find.text(
        'j/k move · Enter open · k known · m missed · r refresh · s side · Esc back',
      ),
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
    expect(callsTo(core, 'review.queue'), 0);

    await openSurface(tester, 7);
    expect(callsTo(core, 'review.queue'), 1);
    expect(core.reviewSides, ['all']);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(callsTo(core, 'review.queue'), 2);
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
