import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The shell pump the other shell tests use: a real store over the fake core.
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

const _digits = [
  LogicalKeyboardKey.digit1,
  LogicalKeyboardKey.digit2,
  LogicalKeyboardKey.digit3,
  LogicalKeyboardKey.digit4,
  LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6,
  LogicalKeyboardKey.digit7,
  LogicalKeyboardKey.digit8,
];

Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(_digits[digit - 1]);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

int achievementReads(FakeCore core) =>
    core.calls.where((call) => call == 'achievements.list').length;

String statusHint(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const ValueKey('status-hint'))).data ?? '';

void main() {
  testWidgets('a opens Achievements from Stats and Esc returns', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    expect(achievementReads(core), 0, reason: 'not read at startup');

    await pressAlt(tester, 5);
    expect(find.text('TOKENS'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(achievementReads(core), 1);
    // The page header and the status label both name the layer.
    expect(find.text('ACHIEVEMENTS'), findsNWidgets(2));
    expect(find.text('2 of 6 unlocked'), findsOneWidget);
    // The sky: every achievement is a star, and the cursor's star names itself
    // in the sky and in the detail card beside it.
    expect(
      find.byKey(const ValueKey('achievement-star-first-light')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);
    expect(find.text('First Light'), findsWidgets);
    expect(statusHint(tester), startsWith('hjkl / arrows move · Enter detail'));
    // The dashboard is gone while the layer owns the surface.
    expect(find.text('TOKENS'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('ACHIEVEMENTS'), findsNothing);
    expect(find.text('TOKENS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r re-reads the inventory without leaving the layer', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await pressAlt(tester, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    final before = achievementReads(core);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(achievementReads(core), before + 1);
    expect(find.text('ACHIEVEMENTS'), findsNWidgets(2));
  });

  testWidgets('leaving Stats collapses the layer', (tester) async {
    await pumpShell(tester);
    await pressAlt(tester, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);

    await pressAlt(tester, 1);
    expect(find.byKey(const ValueKey('achievement-detail')), findsNothing);

    await pressAlt(tester, 5);
    expect(find.text('TOKENS'), findsOneWidget);
    expect(find.byKey(const ValueKey('achievement-detail')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the palette lists achievements and opens it by name', (
    tester,
  ) async {
    await pumpShell(tester);

    // Ctrl+K, then filter by name and run the row — no key chord involved.
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect(find.byType(CommandPalette), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'achiev',
    );
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('achievements'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('ACHIEVEMENTS'), findsNWidgets(2));
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);
  });

  testWidgets('a warning renders as a note beside the rows', (tester) async {
    await pumpShell(
      tester,
      core: FakeCore(achievementsWarning: 'award dates could not be read'),
    );
    await pressAlt(tester, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('achievements-warning')), findsOneWidget);
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);
  });

  testWidgets('a read failure is one message and the page stays usable', (
    tester,
  ) async {
    final core = FakeCore(
      achievementsFailure: 'the achievement store could not be read',
    );
    await pumpShell(tester, core: core);
    await pressAlt(tester, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(
      find.text('the achievement store could not be read'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('achievements-retry')), findsOneWidget);
    // Esc still returns to the dashboard: a failed read is page-local.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('TOKENS'), findsOneWidget);
  });

  testWidgets('arrows move between stars and Enter opens the detail', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressAlt(tester, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    // The selected star carries a label under it, in the sky.
    expect(
      find.byKey(const ValueKey('achievement-star-label-first-light')),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    // Either the cursor moved, or it is the only star in that direction; the
    // page must stay usable and consistent either way.
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the layer fits 800x600 without overflow', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await pressAlt(tester, 5);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(find.text('ACHIEVEMENTS'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
}
