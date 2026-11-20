import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/sources/sources_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Fixtures — plain values only. No core, no filesystem, no network.
// ---------------------------------------------------------------------------

const _sources = <SessionSource>[
  SessionSource(
    name: 'lecture-4.md',
    originalPath: '/home/me/input/lecture-4.md',
    storedPath: 'sources/lecture-4.md',
    hash: 'sha256:1111',
    kind: 'markdown',
  ),
  SessionSource(
    name: 'complex-numbers.pdf',
    originalPath: '/home/me/input/complex-numbers.pdf',
    storedPath: 'sources/complex-numbers.pdf',
    hash: 'sha256:2222',
    kind: 'pdf',
  ),
];

SessionDetail session({List<SessionSource> sources = _sources}) =>
    SessionDetail(
      id: '2026-11-01-0900-physics',
      name: 'Physics — Unit 4',
      created: '2026-11-01T09:00:00.000Z',
      archived: false,
      prompt: 'Explain the problem set.',
      sources: sources,
      steps: const SessionSteps(
        done: 0,
        total: 1,
        exists: true,
        markdown: '- [ ] Derive the energy balance\n',
      ),
    );

Future<void> pumpPage(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1280, 800),
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
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders the session and its attached sources', (tester) async {
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        onAdd: (paths) async => const SourceAddResult(added: 0, skipped: 0),
      ),
    );

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('2 sources · copied into this session'), findsOneWidget);
    expect(find.text('SOURCES'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.text('complex-numbers.pdf'), findsOneWidget);
    expect(find.text('markdown'), findsOneWidget);
    expect(find.text('pdf'), findsOneWidget);
    // Short hashes prove the row is projected from the core's payload.
    expect(find.text('1111'), findsOneWidget);
    expect(find.text('2222'), findsOneWidget);
    expect(find.byKey(const ValueKey('sources-add')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no session is a blocked state with no add action', (
    tester,
  ) async {
    var adds = 0;
    await pumpPage(
      tester,
      SourcesPage(
        session: null,
        loading: false,
        sources: const [],
        onAdd: (paths) async {
          adds += 1;
          return const SourceAddResult(added: 0, skipped: 0);
        },
        onRefresh: () async {},
      ),
    );

    expect(find.text('open a session first'), findsOneWidget);
    expect(find.byKey(const ValueKey('sources-add')), findsNothing);
    expect(find.byKey(const ValueKey('sources-refresh')), findsNothing);

    // The shortcut cannot bypass the blocked state either.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(adds, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a opens the picker once and sends every chosen path', (
    tester,
  ) async {
    var picks = 0;
    var calls = 0;
    List<String>? sent;
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        pickFiles: () async {
          picks += 1;
          return ['/home/me/input/week-5.md', '/home/me/input/solutions.pdf'];
        },
        onAdd: (paths) async {
          calls += 1;
          sent = paths;
          return const SourceAddResult(added: 2, skipped: 0);
        },
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(picks, 1);
    expect(calls, 1);
    expect(sent, ['/home/me/input/week-5.md', '/home/me/input/solutions.pdf']);
    expect(find.text('added 2 · skipped 0'), findsOneWidget);
    expect(find.byKey(const ValueKey('sources-notice')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a held a opens one picker, not one per repeat', (tester) async {
    var picks = 0;
    final never = Completer<List<String>>();
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        pickFiles: () {
          picks += 1;
          return never.future;
        },
        onAdd: (paths) async => const SourceAddResult(added: 0, skipped: 0),
      ),
    );

    await tester.sendKeyDownEvent(LogicalKeyboardKey.keyA);
    await tester.sendKeyRepeatEvent(LogicalKeyboardKey.keyA);
    await tester.pump();

    // One press, one dialog: the guard used to be set only after the await.
    expect(picks, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the add button runs the same path as the shortcut', (
    tester,
  ) async {
    var calls = 0;
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        pickFiles: () async => ['/home/me/input/week-5.md'],
        onAdd: (paths) async {
          calls += 1;
          return const SourceAddResult(added: 1, skipped: 0);
        },
      ),
    );

    await tester.tap(find.byKey(const ValueKey('sources-add')));
    await tester.pumpAndSettle();

    expect(calls, 1);
    expect(find.text('added 1 · skipped 0'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a duplicate-only add says already attached', (tester) async {
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        pickFiles: () async => ['/home/me/input/lecture-4.md'],
        onAdd: (paths) async => const SourceAddResult(added: 0, skipped: 1),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(find.textContaining('already attached'), findsOneWidget);
    expect(find.text('added 0 · skipped 1'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a cancelled picker sends nothing and changes nothing', (
    tester,
  ) async {
    var calls = 0;
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        pickFiles: () async => const [],
        onAdd: (paths) async {
          calls += 1;
          return const SourceAddResult(added: 1, skipped: 0);
        },
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(calls, 0);
    expect(find.byKey(const ValueKey('sources-notice')), findsNothing);
    expect(find.byKey(const ValueKey('sources-error')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a rejected add shows the core message and no success', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        pickFiles: () async => ['/home/me/input/lecture-4.md'],
        onAdd: (paths) async =>
            throw const RpcException(-32000, 'source.add failed', {
              'kind': 'source',
              'sessionId': '2026-11-01-0900-physics',
              'message': 'could not copy lecture-4.md',
            }),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    // The actionable sentence from `data.message`, not the envelope message.
    expect(find.text('could not copy lecture-4.md'), findsOneWidget);
    expect(find.byKey(const ValueKey('sources-error')), findsOneWidget);
    expect(find.byKey(const ValueKey('sources-notice')), findsNothing);
    // The page keeps the session on screen instead of faking a new row.
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the shell error stays on the page beside the list', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        error: 'core stopped',
        onAdd: (paths) async => const SourceAddResult(added: 0, skipped: 0),
      ),
    );

    expect(find.text('core stopped'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.byKey(const ValueKey('sources-add')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r refreshes through the callback', (tester) async {
    var refreshes = 0;
    await pumpPage(
      tester,
      SourcesPage(
        session: session(),
        loading: false,
        sources: _sources,
        onRefresh: () async => refreshes += 1,
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(refreshes, 1);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('800x600 scrolls a long source list without overflow', (
    tester,
  ) async {
    final many = <SessionSource>[
      for (var index = 0; index < 12; index++)
        SessionSource(
          name:
              'week-$index-lecture-notes-with-a-deliberately-long-name-that-'
              'must-ellipsise.md',
          originalPath: '/home/me/input/week-$index.md',
          storedPath: 'sources/week-$index.md',
          hash: 'sha256:${1000 + index}',
          kind: 'markdown',
        ),
    ];
    await pumpPage(
      tester,
      SourcesPage(
        session: session(sources: many),
        loading: false,
        sources: many,
        pickFiles: () async => const [],
        onAdd: (paths) async => const SourceAddResult(added: 0, skipped: 0),
        onRefresh: () async {},
      ),
      size: const Size(800, 600),
    );

    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('sources-add')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // The list is scrollable: the last row is reachable, not clipped.
    await tester.drag(
      find.byKey(const ValueKey('sources-list')),
      const Offset(0, -1200),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  // -------------------------------------------------------------------------
  // Store projection
  // -------------------------------------------------------------------------

  test(
    'addSources calls source.add and refreshes the active session',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      expect(store.activeSession?.sources, hasLength(2));
      final snapshots = core.calls
          .where((method) => method == 'session.chat.snapshot')
          .length;

      final result = await store.addSources(FakeCore.sessionId, [
        '/home/me/input/week-5.md',
      ]);

      expect(result.added, 1);
      expect(result.skipped, 0);
      expect(core.calls, contains('source.add'));
      expect(core.calls, contains('source.list'));
      expect(store.activeSession?.sources, hasLength(3));
      expect(store.activeSession?.sources.last.name, 'week-5.md');
      expect(store.activeSession?.sources.last.kind, 'markdown');
      expect(store.error, isNull);
      // Adding a source must not reload the transcript.
      expect(
        core.calls.where((method) => method == 'session.chat.snapshot').length,
        snapshots,
      );
      expect(store.sessionChat, isNotNull);
    },
  );

  test('a duplicate is skipped and never becomes a second row', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    final result = await store.addSources(FakeCore.sessionId, [
      '/tmp/lecture-4.md',
    ]);

    expect(result.added, 0);
    expect(result.skipped, 1);
    expect(store.activeSession?.sources, hasLength(2));
  });

  test('a rejected add rethrows and leaves the rows unchanged', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    await expectLater(
      store.addSources(FakeCore.sessionId, ['/home/me/input/reject.md']),
      throwsA(isA<RpcException>()),
    );

    expect(store.activeSession?.sources, hasLength(2));
    // A page-local copy failure is not a shell-wide transport error.
    expect(store.error, isNull);
    expect(core.calls, contains('source.add'));
    expect(core.calls, isNot(contains('source.list')));
  });

  test(
    'refreshSources projects source.list rows onto the active session',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      final rows = await store.refreshSources(FakeCore.sessionId);

      expect(rows, hasLength(2));
      expect(rows.first.name, 'lecture-4.md');
      expect(core.calls, contains('source.list'));
      expect(store.activeSession?.sources.first.name, 'lecture-4.md');
    },
  );

  test('SourceAddResult tolerates a partial payload', () {
    final empty = SourceAddResult.fromJson(const <String, dynamic>{});
    expect(empty.added, 0);
    expect(empty.skipped, 0);
    expect(empty.nothingNew, isTrue);

    final partial = SourceAddResult.fromJson(const {'added': 2, 'skipped': 1});
    expect(partial.added, 2);
    expect(partial.skipped, 1);
    expect(partial.nothingNew, isFalse);
  });
}
