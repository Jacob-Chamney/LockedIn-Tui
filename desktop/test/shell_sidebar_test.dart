import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// The sidebar's count for a row, or null when the row shows none.
String? countFor(WidgetTester tester, String row) {
  final finder = find.byKey(ValueKey('sidebar-count-$row'));
  if (finder.evaluate().isEmpty) return null;
  return tester.widget<Text>(finder).data;
}

/// The registry's chord for the sidebar: the terminal app's `<leader>e`.
Future<void> pressSidebarChord(WidgetTester tester) async {
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals view, and navigation must work from all of them.
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
  await tester.pumpAndSettle();
}

/// Open the rail (`Space e`): it expands, takes the keyboard, and `Esc` hands
/// the keyboard back while leaving it open.
Future<void> expandSidebar(WidgetTester tester) async {
  await pressSidebarChord(tester);
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the rail starts shrunk and Space e expands it', (tester) async {
    await pumpShell(tester);

    // Default: icons only, so a new window opens on the chat with navigation
    // still on screen.
    expect(find.text('LEARN'), findsNothing);
    expect(find.byIcon(Icons.history), findsOneWidget);
    expect(find.byKey(const ValueKey('sidebar-rail')), findsNothing);

    await pressSidebarChord(tester);
    expect(find.text('LEARN'), findsOneWidget);
    expect(countFor(tester, 'sessions'), '2');

    // There is no third state: the toggle is a switch.
    await pressSidebarChord(tester);
    expect(find.text('LEARN'), findsNothing);
    expect(find.byIcon(Icons.history), findsOneWidget);
    expect(find.byKey(const ValueKey('sidebar-rail')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('opening the rail gives it the keyboard', (tester) async {
    await pumpShell(tester);
    await pressSidebarChord(tester);

    // The rail owns the keyboard: its cursor sits on the first drawn row.
    expect(
      find.ancestor(
        of: find.text('Chat'),
        matching: find.byKey(const ValueKey('sidebar-row-cursor')),
      ),
      findsOneWidget,
    );
    // The rail owns the keyboard: j moves its cursor. Two rows down from Chat is
    // Skills, and Enter opens it.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    // The breadcrumb and the status bar name the surface that Enter opened.
    expect(find.text('TEACHING'), findsWidgets);
    // Still expanded: activating a row does not shrink the rail.
    expect(find.text('LEARN'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the cursor walks the rows that are drawn', (tester) async {
    await pumpShell(tester);
    await pressSidebarChord(tester);

    // The drawn order (`_sidebarGroups`, then the pinned Settings row), which
    // is not `Surface.values`: Sources has no row and Review sits under Skills.
    const order = [
      'Chat',
      'Sessions',
      'Teaching',
      'Review',
      'Work',
      'Stats',
      'Achievements',
      'Archive',
      'Knowledge',
      'Settings',
    ];
    for (final label in order) {
      expect(
        find.ancestor(
          of: find.text(label),
          matching: find.byKey(const ValueKey('sidebar-row-cursor')),
        ),
        findsOneWidget,
        reason: 'the cursor should sit on $label',
      );
      if (label == order.last) break;
      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
    }

    // The ends are one key away each, and `k` walks back up.
    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    expect(
      find.ancestor(
        of: find.text('Chat'),
        matching: find.byKey(const ValueKey('sidebar-row-cursor')),
      ),
      findsOneWidget,
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(
      find.ancestor(
        of: find.text('Settings'),
        matching: find.byKey(const ValueKey('sidebar-row-cursor')),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a row click opens it and leaves the rail open', (tester) async {
    await pumpShell(tester);
    await expandSidebar(tester);

    await tester.tap(find.text('Teaching').first);
    await tester.pumpAndSettle();

    expect(find.text('TEACHING'), findsWidgets);
    // Clicking is the pointer's Enter: the destination opens, the rail keeps
    // its size, and the page holds the keyboard again.
    expect(find.text('LEARN'), findsOneWidget);
    expect(find.byKey(const ValueKey('sidebar-row-cursor')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Space in the rail opens the leader, it never resizes it', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressSidebarChord(tester);
    expect(find.text('LEARN'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    // Space is the leader, not the rail's switch: the rail keeps its size and
    // only `Space e` (or the button) changes it.
    expect(find.text('LEADER'), findsOneWidget);
    expect(find.text('LEARN'), findsOneWidget);

    // The chord still works from inside the rail.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsNothing);
    expect(find.byKey(const ValueKey('sidebar-row-cursor')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc gives the keyboard back and leaves the rail open', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressSidebarChord(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('LEARN'), findsOneWidget);
    // Space is the leader again, so the page has the keyboard. If the rail still
    // held it, Space would shrink the rail instead.
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();
    expect(find.text('CONTEXT'), findsOneWidget);
    expect(find.text('LEARN'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the top-bar button expands and shrinks with a mouse', (
    tester,
  ) async {
    await pumpShell(tester);
    expect(find.text('LEARN'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('sidebar-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('sidebar-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the mode survives switching surfaces', (tester) async {
    await pumpShell(tester);
    await expandSidebar(tester);
    expect(find.text('LEARN'), findsOneWidget);
    await openSurface(tester, 2);

    // The mode is the window's, not the page's: navigating keeps the rail open
    // because the user opened it deliberately.
    expect(find.text('LEARN'), findsOneWidget);
    expect(find.text('LOCK-IN SESSIONS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sidebar groups its destinations', (tester) async {
    await pumpShell(tester);
    await expandSidebar(tester);

    // Headings, not one flat list (`docs/design.md` §2.4).
    expect(find.text('LEARN'), findsOneWidget);
    expect(find.text('PRODUCTIVITY'), findsOneWidget);
    expect(find.text('REFERENCE'), findsOneWidget);
    // Every surface is still reachable, including Settings under its rule.
    for (final label in [
      'Chat',
      'Sessions',
      'Teaching',
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
    await expandSidebar(tester);

    // The fake serves two sessions, one skill and one project.
    expect(countFor(tester, 'sessions'), '2');
    expect(countFor(tester, 'skills'), '3');
    expect(countFor(tester, 'work'), '2');
    // Chat has nothing countable, so it draws no count at all.
    expect(countFor(tester, 'chat'), isNull);
    // The chord is in the row's tooltip, not beside the count.
    expect(find.byTooltip('Space h · Sessions'), findsOneWidget);
    expect(find.byTooltip('Space , · Settings'), findsOneWidget);
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
    await expandSidebar(tester);

    expect(countFor(tester, 'sessions'), '12');
    // The row's tooltip is the chord, so `12` cannot be read as one.
    expect(find.byTooltip('Space h · Sessions'), findsOneWidget);
  });

  testWidgets('Achievements is a destination of its own', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await expandSidebar(tester);

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
    await expandSidebar(tester);
    // Before the layer is opened nothing has been read, so no count is drawn.
    expect(countFor(tester, 'achievements'), isNull);

    // Stats, then `a` — the same path the registry action takes.
    await openSurface(tester, 5);
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
    await openSurface(tester, 2);
    await openSurface(tester, 1);

    expect(
      tester.widget<TextField>(find.byKey(composer)).controller?.text,
      'half a question',
    );
    expect(tester.takeException(), isNull);
  });

  /// A chord typed faster than a frame.
  ///
  /// The second key used to be handled only by the overlay's own `Focus`, which
  /// asks for focus in a post-frame callback. Two key events in one frame — a
  /// normal typing speed on a 120 Hz display, or a held `Space` — arrived before
  /// that callback ran, so the shell saw `\\` (opening the leader) and then a key
  /// nothing was listening for: the chord was dropped.
  ///
  /// These send both keys with no `pump` between them, which is exactly that
  /// window.
  testWidgets('a leader chord typed with no frame between keys still runs', (
    tester,
  ) async {
    await pumpShell(tester);
    // The rail starts shrunk: icons only, no labels.
    expect(find.text('LEARN'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();

    // The rail expanded and the overlay closed.
    expect(find.text('LEARN'), findsOneWidget);
    expect(find.byKey(const ValueKey('leader-list')), findsNothing);
  });

  testWidgets('two fast chords in a row both run', (tester) async {
    await pumpShell(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();

    // Back to icons: the second chord was not swallowed.
    expect(find.text('LEARN'), findsNothing);
  });
}
