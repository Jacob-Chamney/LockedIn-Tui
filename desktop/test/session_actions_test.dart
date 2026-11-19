import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The manager's seeded rows, in list order: the selection starts on the first.
const _sessions = <SessionRow>[
  SessionRow(
    id: 'physics-unit-4',
    name: 'Physics — Unit 4',
    date: '2026-11-01T14:30:00Z',
    sources: 3,
    stepsDone: 4,
    stepsTotal: 8,
    archived: false,
  ),
  SessionRow(
    id: 'chemistry-bonding',
    name: 'Chemistry — Bonding',
    date: '2026-10-24T09:05:00Z',
    sources: 1,
    stepsDone: 0,
    stepsTotal: 0,
    archived: false,
  ),
];

/// The first `session.list` row the fake serves; archiving it takes it off the
/// open side exactly like the real list.
const _listRowId = '2026-11-15-1200-audit-session';

Future<void> pumpSessions(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pump();
}

Future<CoreStore> startedStore([FakeCore? core]) async {
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  return store;
}

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

void main() {
  group('session manager actions', () {
    testWidgets('a asks first and names the session', (tester) async {
      final archived = <String>[];
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onArchive: (id) async {
            archived.add(id);
            return 'folder';
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();

      expect(find.text('archive session'), findsOneWidget);
      expect(find.text('Archive “Physics — Unit 4”?'), findsOneWidget);
      expect(
        find.textContaining('chat history is not included'),
        findsOneWidget,
      );
      expect(archived, isEmpty);

      await tester.tap(find.byKey(const ValueKey('session-archive-cancel')));
      await tester.pumpAndSettle();

      expect(find.text('archive session'), findsNothing);
      expect(archived, isEmpty);
      expect(find.text('Physics — Unit 4'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('confirming the archive calls the core once and reports it', (
      tester,
    ) async {
      final archived = <String>[];
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onArchive: (id) async {
            archived.add(id);
            return 'folder';
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('session-archive-confirm')));
      await tester.pumpAndSettle();

      expect(archived, ['physics-unit-4']);
      expect(
        find.text('archived “Physics — Unit 4” to the folder archive'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('d names the session and lists what a delete removes', (
      tester,
    ) async {
      final deleted = <String>[];
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onDelete: (id) async => deleted.add(id),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();

      expect(find.text('delete session'), findsOneWidget);
      expect(find.text('Delete “Physics — Unit 4”?'), findsOneWidget);
      expect(
        find.textContaining('removes its sources, steps and chat'),
        findsOneWidget,
      );
      expect(deleted, isEmpty);

      await tester.tap(find.byKey(const ValueKey('session-delete-cancel')));
      await tester.pumpAndSettle();
      expect(deleted, isEmpty);
      expect(find.text('Physics — Unit 4'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('session-delete-confirm')));
      await tester.pumpAndSettle();

      expect(deleted, ['physics-unit-4']);
      expect(find.text('deleted “Physics — Unit 4”'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('x exports without a dialog and shows the returned path', (
      tester,
    ) async {
      final exported = <String>[];
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onExport: (id) async {
            exported.add(id);
            return '/tmp/lockedin/exports/session-$id.zip';
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsNothing);
      expect(exported, ['physics-unit-4']);
      expect(
        find.text(
          'exported to /tmp/lockedin/exports/session-physics-unit-4.zip',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a refused action shows the core message and keeps the row', (
      tester,
    ) async {
      const message =
          'set an archive folder in Settings → Storage and archive first';
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onArchive: (id) async {
            throw const RpcException(-32000, message, {
              'kind': 'session-action',
              'id': 'physics-unit-4',
              'action': 'archive',
              'message': message,
            });
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('session-archive-confirm')));
      await tester.pumpAndSettle();

      expect(find.text(message), findsOneWidget);
      expect(
        find.byKey(const ValueKey('session-action-error')),
        findsOneWidget,
      );
      expect(find.text('Physics — Unit 4'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an in-flight action marks the row and blocks the verbs', (
      tester,
    ) async {
      final pending = Completer<String?>();
      var deletes = 0;
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onArchive: (id) => pending.future,
          onDelete: (id) async => deletes++,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('session-archive-confirm')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('session-row-busy')), findsOneWidget);
      expect(find.text('working…'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pump();
      expect(find.byType(AlertDialog), findsNothing);
      expect(deletes, 0);

      pending.complete('folder');
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('session-row-busy')), findsNothing);
      expect(
        find.text('archived “Physics — Unit 4” to the folder archive'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a/d/x are text while the search field has focus', (
      tester,
    ) async {
      var calls = 0;
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onArchive: (id) async {
            calls++;
            return 'folder';
          },
          onDelete: (id) async => calls++,
          onExport: (id) async {
            calls++;
            return '/tmp/export.zip';
          },
        ),
      );

      await tester.tap(find.byKey(const ValueKey('sessions-search')));
      await tester.pump();
      for (final key in [
        LogicalKeyboardKey.keyA,
        LogicalKeyboardKey.keyD,
        LogicalKeyboardKey.keyX,
      ]) {
        await tester.sendKeyEvent(key);
        await tester.pump();
      }

      expect(calls, 0);
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the action hints and a confirmation fit 800x600', (
      tester,
    ) async {
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: _sessions,
          loading: false,
          onArchive: (id) async => 'folder',
          onDelete: (id) async {},
          onExport: (id) async => '/tmp/export.zip',
        ),
        size: const Size(800, 600),
      );

      expect(find.text('a archive · d delete · x export'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      expect(find.text('Archive “Physics — Unit 4”?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore session actions', () {
    test('archiveSession drops the row and returns the backend', () async {
      final core = FakeCore();
      final store = await startedStore(core);
      expect(store.sessions.map((row) => row.id), contains(_listRowId));

      final backend = await store.archiveSession(_listRowId);

      expect(backend, 'folder');
      expect(core.archiveCalls, [_listRowId]);
      expect(core.archivedSessionIds, [_listRowId]);
      expect(store.sessions.map((row) => row.id), isNot(contains(_listRowId)));
      expect(store.error, isNull);
    });

    test(
      'archiving the open session closes it and drops its transcript',
      () async {
        final core = FakeCore();
        final store = await startedStore(core);
        await store.openSession(FakeCore.sessionId);
        expect(store.activeSessionId, FakeCore.sessionId);
        expect(store.sessionChats.containsKey(FakeCore.sessionId), isTrue);

        await store.archiveSession(FakeCore.sessionId);

        expect(store.activeSession, isNull);
        expect(store.activeSessionId, isNull);
        expect(store.sessionChats.containsKey(FakeCore.sessionId), isFalse);
      },
    );

    test('removeSession deletes the row', () async {
      final core = FakeCore();
      final store = await startedStore(core);

      await store.removeSession(_listRowId);

      expect(core.removeCalls, [_listRowId]);
      expect(core.removedSessionIds, [_listRowId]);
      expect(store.sessions.map((row) => row.id), isNot(contains(_listRowId)));
      expect(store.error, isNull);
    });

    test('exportSession returns the zip path and keeps the row', () async {
      final core = FakeCore();
      final store = await startedStore(core);

      final path = await store.exportSession(_listRowId);

      expect(path, '/tmp/lockedin/exports/session-$_listRowId.zip');
      expect(core.exportCalls, [_listRowId]);
      expect(store.sessions.map((row) => row.id), contains(_listRowId));
      expect(store.error, isNull);
    });

    test('a refused action rethrows and leaves the row', () async {
      const message =
          'set an archive folder in Settings → Storage and archive first';
      final core = FakeCore(sessionActionFailure: message);
      final store = await startedStore(core);

      await expectLater(
        store.archiveSession(_listRowId),
        throwsA(isA<RpcException>()),
      );

      expect(core.archiveCalls, isEmpty);
      expect(core.archivedSessionIds, isEmpty);
      expect(store.sessions.map((row) => row.id), contains(_listRowId));
      // A page-local refusal never becomes the shell's transport error.
      expect(store.error, isNull);
    });
  });

  testWidgets('the shell archives from the manager and refreshes the list', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 2);

    expect(find.text('Audit session'), findsOneWidget);
    expect(find.text('a archive · d delete · x export'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(find.text('Archive “Audit session”?'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('session-archive-confirm')));
    await tester.pumpAndSettle();

    expect(core.archiveCalls, [_listRowId]);
    expect(find.text('Audit session'), findsNothing);
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(
      find.text('archived “Audit session” to the folder archive'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
