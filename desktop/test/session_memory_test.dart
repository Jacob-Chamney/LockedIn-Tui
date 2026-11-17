import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Fixtures — plain values only. No filesystem, no network.
// ---------------------------------------------------------------------------

const _points = [
  'Boundary conditions set the limits of the integral.',
  'The energy balance runs over the stated domain.',
];

const _folded = [
  'energy is conserved in a closed system, so the total is fixed',
];

const _emptyState = 'no memory yet · it fills after a completed chat turn';

SessionDetail _detail({SessionMemory? memory}) => SessionDetail(
  id: '2026-11-01-1430-physics-unit-4',
  name: 'Physics — Unit 4',
  created: '2026-11-01T14:30:00Z',
  archived: false,
  prompt: 'Explain the problem set.',
  sources: const [],
  steps: const SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
  memory: memory,
);

const _memory = SessionMemory(
  points: _points,
  folded: _folded,
  updated: '2026-11-01T15:00:00Z',
);

Future<void> pumpDetail(
  WidgetTester tester,
  SessionDetail detail, {
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: SessionDetailView(detail: detail, loading: false)),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('memory card renders points, the folded line and the timestamp', (
    tester,
  ) async {
    await pumpDetail(tester, _detail(memory: _memory));

    expect(find.text('SESSION MEMORY'), findsOneWidget);
    // The label says history, labelled session memory and never a source.
    expect(find.text('session memory · not a source'), findsOneWidget);

    expect(find.text(_points[0]), findsOneWidget);
    expect(find.text(_points[1]), findsOneWidget);
    expect(find.text('earlier'), findsOneWidget);
    expect(find.textContaining(_folded[0]), findsOneWidget);
    expect(find.textContaining('updated 2026-11-01 15:00'), findsOneWidget);

    // A populated note never shows the empty state.
    expect(find.text(_emptyState), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty memory states the next action and stays read-only', (
    tester,
  ) async {
    await pumpDetail(tester, _detail());

    expect(find.text('SESSION MEMORY'), findsOneWidget);
    expect(find.text('session memory · not a source'), findsOneWidget);
    expect(find.text(_emptyState), findsOneWidget);

    // No action or toggle lives on this card.
    final card = find.byKey(const ValueKey('session-memory-card'));
    expect(
      find.descendant(of: card, matching: find.byType(FilledButton)),
      findsNothing,
    );
    expect(
      find.descendant(of: card, matching: find.byType(TextButton)),
      findsNothing,
    );
    expect(
      find.descendant(of: card, matching: find.byType(OutlinedButton)),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('an absent memory key still opens the session', (tester) async {
    final parsed = SessionDetail.fromJson(const {
      'id': '2026-11-01-1430-physics-unit-4',
      'name': 'Physics — Unit 4',
      'created': '2026-11-01T14:30:00Z',
      'archived': false,
      'prompt': 'Explain the problem set.',
      'sources': <Map<String, dynamic>>[],
      'steps': {'done': 0, 'total': 0, 'exists': false, 'markdown': ''},
    });
    expect(parsed.memory, isNull);

    await pumpDetail(tester, parsed);

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('SESSION MEMORY'), findsOneWidget);
    expect(find.text(_emptyState), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the memory card fits 800x600 and a narrow window', (
    tester,
  ) async {
    final points = [
      for (var index = 1; index <= 8; index++)
        'Point $index: a long key point that has to wrap without overflowing '
            'the session detail at a narrow window width',
    ];
    for (final size in const [Size(800, 600), Size(480, 720)]) {
      await pumpDetail(
        tester,
        _detail(
          memory: SessionMemory(
            points: points,
            folded: _folded,
            updated: '2026-11-01T15:00:00Z',
          ),
        ),
        size: size,
      );

      expect(find.byKey(const ValueKey('session-memory-card')), findsOneWidget);
      expect(find.text(points.first), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'memory at $size');
    }
  });

  test('absent memory parses to null; a present block parses tolerantly', () {
    final absent = SessionDetail.fromJson(const {
      'id': 'x',
      'name': 'X',
      'steps': <String, dynamic>{},
    });
    expect(absent.memory, isNull);

    final present = SessionDetail.fromJson(const {
      'id': 'x',
      'name': 'X',
      'steps': <String, dynamic>{},
      'memory': {
        'points': ['a', 'b'],
        'folded': ['c'],
        'updated': '2026-11-01T15:00:00Z',
      },
    });
    expect(present.memory, isNotNull);
    expect(present.memory!.points, ['a', 'b']);
    expect(present.memory!.folded, ['c']);
    expect(present.memory!.updated, '2026-11-01T15:00:00Z');

    // A malformed block is the absent case, not a crash.
    final malformed = SessionDetail.fromJson(const {
      'id': 'x',
      'steps': <String, dynamic>{},
      'memory': 'not a block',
    });
    expect(malformed.memory, isNull);

    // A partial block defaults each missing field instead of throwing.
    final partial = SessionMemory.fromJson(const {
      'points': ['only'],
    });
    expect(partial.points, ['only']);
    expect(partial.folded, isEmpty);
    expect(partial.updated, '');
  });

  test(
    'the fake seeds two points and one folded line, or omits them',
    () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      final memory = store.activeSession?.memory;
      expect(memory, isNotNull);
      expect(memory!.points.length, 2);
      expect(memory.folded.length, 1);
      expect(memory.updated, isNotEmpty);

      final emptyStore = CoreStore(connection: FakeCore(withMemory: false));
      addTearDown(emptyStore.dispose);
      await emptyStore.start();
      await emptyStore.openSession(FakeCore.sessionId);
      expect(emptyStore.activeSession, isNotNull);
      expect(emptyStore.activeSession!.memory, isNull);
    },
  );
}
