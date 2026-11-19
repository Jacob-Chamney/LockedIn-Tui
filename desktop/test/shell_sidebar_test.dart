import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The shell pump the other shell tests use, at a width where the sidebar has
/// labels (it collapses to icons below 900 px).
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

/// The sidebar's count for a row, or null when the row shows none.
String? countFor(WidgetTester tester, String row) {
  final finder = find.byKey(ValueKey('sidebar-count-$row'));
  if (finder.evaluate().isEmpty) return null;
  return tester.widget<Text>(finder).data;
}

/// The chord the registry gives the sidebar action, so a rebind test would not
/// have to change this file.
Future<void> pressSidebarChord(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Ctrl+B cycles expanded, icons, hidden', (tester) async {
    await pumpShell(tester);
    expect(find.text('LEARN'), findsOneWidget);
    expect(find.text('Sessions'), findsWidgets);

    // Expanded → icon rail: labels and counts go, icons stay.
    await pressSidebarChord(tester);
    expect(find.text('LEARN'), findsNothing);
    expect(countFor(tester, 'sessions'), isNull);
    expect(find.byIcon(Icons.history), findsOneWidget);
    // The window is not covered: the chat is still there.
    expect(find.text('Chill'), findsWidgets);

    // Icon rail → hidden: only the re-open chip remains.
    await pressSidebarChord(tester);
    expect(find.byIcon(Icons.history), findsNothing);
    expect(find.byKey(const ValueKey('sidebar-rail')), findsOneWidget);
    expect(find.text('Chill'), findsWidgets);

    // Hidden → expanded again.
    await pressSidebarChord(tester);
    expect(find.text('LEARN'), findsOneWidget);
    expect(countFor(tester, 'sessions'), '2');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the top-bar button runs the same cycle with a mouse', (
    tester,
  ) async {
    await pumpShell(tester);
    expect(find.text('LEARN'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('sidebar-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('sidebar-toggle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('sidebar-rail')), findsOneWidget);

    // The rail chip is the second pointer path back.
    await tester.tap(find.byKey(const ValueKey('sidebar-rail')));
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the mode survives switching surfaces', (tester) async {
    await pumpShell(tester);
    await pressSidebarChord(tester); // icons
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();

    expect(find.text('LEARN'), findsNothing);
    expect(find.text('LOCK-IN SESSIONS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sidebar groups its destinations', (tester) async {
    await pumpShell(tester);

    // Headings, not one flat list (`docs/design.md` §2.4).
    expect(find.text('LEARN'), findsOneWidget);
    expect(find.text('PRODUCTIVITY'), findsOneWidget);
    expect(find.text('REFERENCE'), findsOneWidget);
    // Every surface is still reachable, including Settings under its rule.
    for (final label in [
      'Chat',
      'Sessions',
      'Skills',
      'Work',
      'Stats',
      'Archive',
      'Knowledge',
      'Settings',
    ]) {
      expect(find.text(label), findsWidgets, reason: label);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('each row shows its size, not just its shortcut', (tester) async {
    await pumpShell(tester);

    // The fake serves two sessions, one skill and one project.
    expect(countFor(tester, 'sessions'), '2');
    expect(countFor(tester, 'skills'), '3');
    expect(countFor(tester, 'work'), '2');
    // Chat has nothing countable, so it draws no count at all.
    expect(countFor(tester, 'chat'), isNull);
    // The chord is in the row's tooltip, not beside the count.
    expect(find.byTooltip('Alt+2 · Sessions'), findsOneWidget);
    expect(find.byTooltip('Alt+0 · Settings'), findsOneWidget);
  });

  testWidgets('a count reads as a count and a chord as a chord', (
    tester,
  ) async {
    final core = FakeCore();
    // Twelve sessions: the old sidebar drew `2` for the Alt+2 chord beside the
    // row, which looked exactly like a count of two.
    core.sessionRows
      ..clear()
      ..addAll([
        for (var index = 0; index < 12; index++)
          {
            'id':
                '2026-11-${(index + 1).toString().padLeft(2, '0')}-0900-s$index',
            'name': 'Session $index',
            'date': '2026-11-01T09:00:00Z',
            'sources': 1,
            'steps': {'done': 0, 'total': 2},
            'archived': false,
          },
      ]);
    await pumpShell(tester, core: core);

    expect(countFor(tester, 'sessions'), '12');
    // The row's tooltip is the chord, so `12` cannot be read as one.
    expect(find.byTooltip('Alt+2 · Sessions'), findsOneWidget);
  });

  testWidgets('Achievements is a destination of its own', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);

    expect(find.text('Achievements'), findsOneWidget);
    await tester.tap(find.text('Achievements'));
    await tester.pumpAndSettle();

    // It is a layer over Stats, and `a` still opens it from anywhere. The page
    // title and the status bar both name the layer.
    expect(find.text('ACHIEVEMENTS'), findsWidgets);
    expect(store.achievements, isNotEmpty);
    expect(core.calls, contains('achievements.list'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sidebar says how many achievements are earned', (
    tester,
  ) async {
    await pumpShell(tester);
    // Before the layer is opened nothing has been read, so no count is drawn.
    expect(countFor(tester, 'achievements'), isNull);

    // Stats, then `a` — the same path the registry action takes.
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit5);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    final earned = tester.widget<Text>(
      find.byKey(const ValueKey('sidebar-count-achievements')),
    );
    expect(earned.data, matches(RegExp(r'^\d+/\d+$')));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a narrow window keeps the rows as icons', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));

    // Compact: labels and counts are gone, icons remain.
    expect(find.text('LEARN'), findsNothing);
    expect(countFor(tester, 'sessions'), isNull);
    expect(find.byIcon(Icons.history), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a Chill draft survives switching surfaces', (tester) async {
    await pumpShell(tester);

    const composer = ValueKey('chat-composer');
    await tester.tap(find.byKey(composer));
    await tester.pump();
    await tester.enterText(find.byKey(composer), 'half a question');
    await tester.pump();

    // Leave for Sessions and come back: chat is home, and the draft is still
    // there — losing it is the one thing a chat-first app must not do.
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit1);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();

    expect(
      tester.widget<TextField>(find.byKey(composer)).controller?.text,
      'half a question',
    );
    expect(tester.takeException(), isNull);
  });
}
