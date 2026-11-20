import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The same shell pump the other shell tests use, with an explicit window size
/// so the 800×600 case is a real layout pass.
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

Future<void> openSessionChat(WidgetTester tester, CoreStore store) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
  await tester.pumpAndSettle();
}

Future<void> sendSessionTurn(WidgetTester tester, String text) async {
  const composer = ValueKey('session-chat-composer');
  await tester.tap(find.byKey(composer));
  await tester.pump();
  await tester.enterText(find.byKey(composer), text);
  await tester.pump();
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
}

/// Expand the rail: `Space e` opens it *and* focuses it, which is also how the
/// keyboard gets in. `Esc` then leaves it open for the pointer.
Future<void> expandSidebar(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Esc in the search field gives the list its keys back', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 2);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('sessions-search')),
      'phys',
    );
    await tester.pumpAndSettle();
    expect(find.text('Physics — Unit 4'), findsOneWidget);

    String selected() {
      final marker = find.byKey(const ValueKey('session-row-selected'));
      if (marker.evaluate().isEmpty) return '';
      final text = find.descendant(of: marker, matching: find.byType(Text));
      return tester.widget<Text>(text.first).data ?? '';
    }

    // One Esc clears the query and returns the keyboard to the page, not to
    // the focus scope: the list's own keys must keep working.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(selected(), 'Audit session', reason: 'the query is gone');

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(selected(), 'Physics — Unit 4', reason: 'the list has the keys');
    expect(find.text('SESSIONS'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a session chat draft survives leaving the session', (
    tester,
  ) async {
    final store = await openSession(tester);
    await openSessionChat(tester, store);

    const composer = ValueKey('session-chat-composer');
    await tester.tap(find.byKey(composer));
    await tester.pump();
    await tester.enterText(find.byKey(composer), 'half a follow-up');
    await tester.pump();

    // Leave for another surface and come back to the same session chat: the
    // draft is still there, exactly as in Chill.
    await openSurface(tester, 1);
    await openSurface(tester, 2);
    // The session is still open, so the chat is one `c` away again.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.pumpAndSettle();

    expect(
      tester.widget<TextField>(find.byKey(composer)).controller?.text,
      'half a follow-up',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Space l starts a lock-in and Space k opens the deck', (
    tester,
  ) async {
    final store = await pumpShell(tester);

    // `Space l` is the terminal app's new-lock-in verb.
    await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('New lock-in'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // With no session open, `Space k` lands on the sessions manager.
    await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    expect(find.text('LOCK-IN SESSIONS'), findsOneWidget);

    // With a session open it opens that session's deck.
    await store.openSession(FakeCore.sessionId);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    expect(store.outputKind, 'flashcards');
    expect(find.text('FLASHCARDS'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sidebar lists the newest sessions under RECENT', (
    tester,
  ) async {
    final core = FakeCore();
    core.sessionRows
      ..clear()
      ..addAll([
        {
          'id': FakeCore.sessionId,
          'name': 'Physics — Unit 4',
          'date': '2026-11-15T12:00:00Z',
          'sources': 2,
          'steps': {'done': 1, 'total': 4},
          'archived': false,
        },
        {
          'id': '2026-10-01-0900-chemistry',
          'name': 'Chemistry — Bonding',
          'date': '2026-10-01T09:00:00Z',
          'sources': 1,
          'steps': {'done': 0, 'total': 3},
          'archived': false,
        },
        {
          'id': '2026-09-01-0900-archived',
          'name': 'Archived one',
          'date': '2026-09-01T09:00:00Z',
          'sources': 1,
          'steps': {'done': 0, 'total': 3},
          'archived': true,
        },
      ]);
    await pumpShell(tester, core: core);
    await expandSidebar(tester);

    expect(find.text('RECENT'), findsOneWidget);
    // Newest first, and an archived row is not a destination.
    expect(
      find.byKey(const ValueKey('recent-session-${FakeCore.sessionId}')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('recent-session-2026-10-01-0900-chemistry')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('recent-session-2026-09-01-0900-archived')),
      findsNothing,
    );
    final newest = tester.getTopLeft(
      find.byKey(const ValueKey('recent-session-${FakeCore.sessionId}')),
    );
    final older = tester.getTopLeft(
      find.byKey(const ValueKey('recent-session-2026-10-01-0900-chemistry')),
    );
    expect(newest.dy, lessThan(older.dy));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sidebar scrolls instead of overflowing in a short window', (
    tester,
  ) async {
    final core = FakeCore();
    core.sessionRows
      ..clear()
      ..addAll([
        for (var index = 0; index < 3; index++)
          {
            'id': '2026-11-0${index + 1}-0900-short-$index',
            'name': 'Session $index',
            'date': '2026-11-0${index + 1}T09:00:00Z',
            'sources': 1,
            'steps': {'done': 0, 'total': 2},
            'archived': false,
          },
      ]);
    // Wide and short: the sidebar is not compact, so every `RECENT` row shows.
    await pumpShell(tester, core: core, size: const Size(1280, 560));
    await expandSidebar(tester);

    expect(find.text('RECENT'), findsOneWidget);
    // A RenderFlex overflow would surface as a framework exception here.
    expect(tester.takeException(), isNull);
    // The destinations are reachable by scrolling, not clipped away.
    await tester.drag(find.text('RECENT'), const Offset(0, -200));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a recent row opens that session on the Sessions surface', (
    tester,
  ) async {
    final core = FakeCore();
    core.sessionRows
      ..clear()
      ..add({
        'id': FakeCore.sessionId,
        'name': 'Physics — Unit 4',
        'date': '2026-11-15T12:00:00Z',
        'sources': 2,
        'steps': {'done': 1, 'total': 4},
        'archived': false,
      });
    final store = await pumpShell(tester, core: core);
    await expandSidebar(tester);

    await tester.tap(
      find.byKey(const ValueKey('recent-session-${FakeCore.sessionId}')),
    );
    await tester.pumpAndSettle();

    expect(store.activeSessionId, FakeCore.sessionId);
    expect(core.calls, contains('session.open'));
    // The status bar names the layer, and the detail's own content is on screen.
    expect(find.text('SESSION'), findsOneWidget);
    expect(find.text('Explain the problem set.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the session detail shows the coverage report', (tester) async {
    final store = await pumpShell(tester, core: FakeCore());
    await store.openSession(FakeCore.sessionId);
    await tester.pumpAndSettle();

    await openSurface(tester, 2);

    // The shell reads coverage with the detail, so the card has real counts.
    expect(find.byKey(const ValueKey('session-coverage-card')), findsOneWidget);
    expect(find.text('1 of 2 sources referenced'), findsOneWidget);
  });

  testWidgets('Alt+2 shows the opened session detail', (tester) async {
    await openSession(tester);

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('Explain the problem set.'), findsOneWidget);
    // The sources card and the coverage card both name each source.
    expect(find.text('lecture-4.md'), findsWidgets);
    expect(find.text('complex-numbers.pdf'), findsWidgets);
    expect(find.text('SESSION'), findsOneWidget);
    expect(find.text('SESSIONS'), findsNothing);
    expect(
      find.text('↑↓ move · Space toggle · c chat · \\ leader · Esc back'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('c opens the session chat and a turn shows the session echo', (
    tester,
  ) async {
    final store = await openSession(tester);
    await openSessionChat(tester, store);

    expect(find.byKey(const ValueKey('session-chat-composer')), findsOneWidget);
    expect(find.text('SESSION CHAT'), findsOneWidget);
    expect(
      // The page strip and the status bar now agree: Esc leaves INSERT first.
      find.text('Enter send · Shift+Enter newline · Esc normal'),
      findsWidgets,
    );

    await sendSessionTurn(tester, 'hello');

    expect(
      find.textContaining('Session echo: hello', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('hello'), findsOneWidget);
    expect(find.text('SESSION CHAT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc leaves the chat for the detail, then detail for the list', (
    tester,
  ) async {
    final store = await openSession(tester);
    await openSessionChat(tester, store);
    expect(find.byKey(const ValueKey('session-chat-composer')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('session-chat-composer')), findsNothing);
    expect(find.text('Explain the problem set.'), findsOneWidget);
    expect(store.activeSession, isNotNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(store.activeSession, isNull);
    expect(store.activeSessionId, isNull);
    expect(find.text('Audit session'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a session turn never reaches the Chill transcript', (
    tester,
  ) async {
    final store = await openSession(tester);
    await openSessionChat(tester, store);
    await sendSessionTurn(tester, 'hello');
    expect(
      find.textContaining('Session echo: hello', findRichText: true),
      findsOneWidget,
    );

    await openSurface(tester, 1);

    expect(find.text('Chill'), findsWidgets);
    expect(
      find.textContaining('Session echo: hello', findRichText: true),
      findsNothing,
    );
    expect(find.text('hello'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the session composer reports INSERT and NORMAL', (tester) async {
    final store = await openSession(tester);
    await openSessionChat(tester, store);

    expect(find.text('NORMAL'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('session-chat-composer')));
    await tester.pump();
    expect(find.text('INSERT'), findsOneWidget);

    // `Esc` leaves the composer (the view also returns to the detail); the
    // shell must land back in NORMAL, never a stale INSERT.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsNothing);
    expect(find.text('NORMAL'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the open session detail fits 800x600', (tester) async {
    await openSession(tester, size: const Size(800, 600));

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('SESSION'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
