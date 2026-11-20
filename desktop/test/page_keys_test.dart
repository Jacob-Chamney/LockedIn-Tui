import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/shell/leader.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// Page keys that used to fight the keyboard they were drawn on.
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

Future<void> press(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyEvent(key);
  await tester.pumpAndSettle();
}

Future<void> leader(WidgetTester tester, LogicalKeyboardKey key) async {
  await press(tester, LogicalKeyboardKey.backslash);
  await press(tester, key);
}

String? selectedLeaderLabel(WidgetTester tester) {
  final selected = find.byKey(const ValueKey('leader-selected'));
  if (selected.evaluate().isEmpty) return null;
  final texts = find.descendant(of: selected, matching: find.byType(Text));
  return texts
      .evaluate()
      .map((element) => (element.widget as Text).data)
      .whereType<String>()
      .firstWhere((data) => data.isNotEmpty, orElse: () => '');
}

void main() {
  testWidgets('letters typed into the Skills search never act on a goal', (
    tester,
  ) async {
    await pumpShell(tester);
    await leader(tester, LogicalKeyboardKey.keyG);

    await press(tester, LogicalKeyboardKey.slash);
    // `a`, `d`, `x` and `n` are the manager verbs. Without a typing guard this
    // query opened the archive dialog on its first letter.
    await tester.enterText(
      find.byKey(const ValueKey('skills-search')),
      'assembly and disassembly next',
    );
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    expect(find.text('ARCHIVE'), findsNothing);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('skills-search')))
          .controller
          ?.text,
      'assembly and disassembly next',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the leader walks the order it draws', (tester) async {
    await pumpShell(tester);
    await press(tester, LogicalKeyboardKey.space);
    expect(find.byType(LeaderOverlay), findsOneWidget);

    // The overlay draws rows grouped by category; the selection used to index
    // the catalogue instead, so `↓` could jump to the bottom of the list and
    // back. Walk the whole table and require a new, distinct row every step.
    final seen = <String>{};
    final first = selectedLeaderLabel(tester);
    expect(first, isNotNull);
    seen.add(first!);
    for (var step = 0; step < 12; step++) {
      await press(tester, LogicalKeyboardKey.arrowDown);
      seen.add(selectedLeaderLabel(tester)!);
    }
    // 13 steps over a table of more than 13 rows must have visited 13 rows.
    expect(seen.length, 13);

    // And `End` is the other end of the same list.
    await press(tester, LogicalKeyboardKey.end);
    final last = selectedLeaderLabel(tester);
    await press(tester, LogicalKeyboardKey.arrowDown);
    expect(
      selectedLeaderLabel(tester),
      last,
      reason: 'the last drawn row is the end of the walk',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('k typed into the palette filters instead of moving', (
    tester,
  ) async {
    await pumpShell(tester);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    // `k` used to move the selection instead of reaching the field, so "kn"
    // became "n" and Enter ran Chat.
    await tester.enterText(find.byKey(const ValueKey('palette-search')), 'kn');
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('Knowledge'),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Space k with a session open shows the deck on Sessions', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await store.openSession(FakeCore.sessionId);
    await tester.pumpAndSettle();
    expect(find.text('Chill'), findsWidgets);

    await press(tester, LogicalKeyboardKey.space);
    await press(tester, LogicalKeyboardKey.keyK);

    // The deck is a layer of Sessions: the chord used to change nothing on
    // screen when the user was on another surface.
    expect(find.text('Sessions'), findsWidgets);
    // The reader's own header and the status bar both name the deck.
    expect(find.text('FLASHCARDS'), findsWidgets);
  });
}
