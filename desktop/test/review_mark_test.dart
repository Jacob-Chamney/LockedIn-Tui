import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/review/review_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

Map<String, dynamic> _item({
  required String id,
  String kind = 'step',
  required String label,
  String context = 'Physics — Unit 4',
  String contextId = '2026-11-01-0900-physics',
  String reason = 'unchecked',
  int priority = 1,
  int count = 0,
  String origin = 'steps',
}) => {
  'id': id,
  'kind': kind,
  'label': label,
  'context': context,
  'contextId': contextId,
  'reason': reason,
  'priority': priority,
  'count': count,
  'origin': origin,
};

ReviewQueue _queue(List<Map<String, dynamic>> items) {
  final byKind = <String, int>{'card': 0, 'step': 0, 'stage': 0, 'memory': 0};
  for (final item in items) {
    final kind = '${item['kind']}';
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return ReviewQueue.fromJson({
    'items': items,
    'nudge': {
      'intensity': 'balanced',
      'threshold': 3,
      'due': [
        for (final item in items)
          if (item['count'] is int && (item['count'] as int) > 0) item['id'],
      ],
      'suggestions': const <String>[],
    },
    'counts': {'total': items.length, 'byKind': byKind},
    'diagnostics': const <Map<String, dynamic>>[],
    'intensity': 'balanced',
  });
}

ReviewQueue reviewFixture() => _queue([
  _item(
    id: 'card:physics:2',
    kind: 'card',
    label: 'What does the learning rate control?',
    reason: 'missed',
    priority: 2,
    count: 2,
    origin: 'flashcards',
  ),
  _item(id: 'step:physics:1', label: 'Derive the energy balance'),
]);

/// A host that behaves like the shell: the page gets the store's queue, sends
/// one mark through the callback, and renders whatever queue that callback
/// returns. The page never edits a count locally.
class _ReviewHost extends StatefulWidget {
  const _ReviewHost({required this.mark, this.initial});

  final Future<ReviewQueue?> Function(String itemId, String result) mark;
  final ReviewQueue? initial;

  @override
  State<_ReviewHost> createState() => _ReviewHostState();
}

class _ReviewHostState extends State<_ReviewHost> {
  late ReviewQueue? _queue = widget.initial ?? reviewFixture();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ReviewPage(
        queue: _queue,
        onMark: (itemId, result) async {
          final next = await widget.mark(itemId, result);
          if (!mounted || next == null) return;
          setState(() => _queue = next);
        },
      ),
    );
  }
}

Future<void> pumpHost(
  WidgetTester tester,
  Future<ReviewQueue?> Function(String itemId, String result) mark, {
  ReviewQueue? initial,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: _ReviewHost(initial: initial, mark: mark),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'k marks the selected step known and renders the returned queue',
    (tester) async {
      final calls = <String>[];
      await pumpHost(tester, (itemId, result) async {
        calls.add('$itemId:$result');
        // The real core answers with the whole queue after the mark: the known
        // step is gone. This queue deliberately has no step, so a page that
        // patched only a count could not produce it.
        return _queue([
          _item(
            id: 'card:physics:2',
            kind: 'card',
            label: 'What does the learning rate control?',
            reason: 'missed',
            priority: 2,
            count: 2,
            origin: 'flashcards',
          ),
        ]);
      });

      // The priority-1 step sorts first, so `k` marks it.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pumpAndSettle();

      expect(calls, ['step:physics:1:known']);
      expect(find.text('Derive the energy balance'), findsNothing);
      expect(find.text('What does the learning rate control?'), findsOneWidget);
      expect(
        find.text('k known · m missed · r refresh · s side'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('m marks the selected item missed and keeps the returned count', (
    tester,
  ) async {
    final calls = <String>[];
    await pumpHost(tester, (itemId, result) async {
      calls.add('$itemId:$result');
      // A missed card stays with the count the core recorded, not a local +1.
      return _queue([
        _item(id: 'step:physics:1', label: 'Derive the energy balance'),
        _item(
          id: 'card:physics:2',
          kind: 'card',
          label: 'What does the learning rate control?',
          reason: 'missed',
          priority: 2,
          count: 5,
          origin: 'flashcards',
        ),
      ]);
    });

    // Move to the card with the arrow key (k is the known verdict here).
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
    await tester.pumpAndSettle();

    expect(calls, ['card:physics:2:missed']);
    expect(find.text('5 misses'), findsOneWidget);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('session memory is not markable and says so', (tester) async {
    final calls = <String>[];
    await pumpHost(
      tester,
      (itemId, result) async {
        calls.add('$itemId:$result');
        return null;
      },
      initial: _queue([
        _item(
          id: 'memory:physics:memory',
          kind: 'memory',
          label: 'Key points',
          reason: 'memory',
          origin: 'memory',
        ),
      ]),
    );

    expect(find.text('read-only'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    expect(
      find.text('session memory is read-only and cannot be marked'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('review-mark-notice')), findsOneWidget);
    expect(find.byKey(const ValueKey('review-mark-error')), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(find.text('Key points'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a mark in flight says marking… and then shows the new queue', (
    tester,
  ) async {
    final completer = Completer<ReviewQueue?>();
    await pumpHost(tester, (itemId, result) => completer.future);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pump();

    expect(find.text('marking…'), findsOneWidget);
    expect(find.text('Derive the energy balance'), findsOneWidget);

    completer.complete(
      _queue([
        _item(
          id: 'card:physics:2',
          kind: 'card',
          label: 'What does the learning rate control?',
          reason: 'missed',
          priority: 2,
          count: 2,
          origin: 'flashcards',
        ),
      ]),
    );
    await tester.pumpAndSettle();

    expect(find.text('marking…'), findsNothing);
    expect(find.text('Derive the energy balance'), findsNothing);
    expect(find.text('What does the learning rate control?'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed mark keeps the previous queue and shows one message', (
    tester,
  ) async {
    await pumpHost(tester, (itemId, result) async {
      throw const RpcException(-32000, 'could not record the verdict', {
        'kind': 'review',
        'itemId': 'step:physics:1',
        'message': 'could not record the verdict',
      });
    });

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('review-mark-error')), findsOneWidget);
    expect(find.text('could not record the verdict'), findsOneWidget);
    // Both rows are still there: a refused mark changes nothing.
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(find.text('What does the learning rate control?'), findsOneWidget);
    expect(find.text('marking…'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('selection lands on the next item after the marked one leaves', (
    tester,
  ) async {
    final calls = <String>[];
    var first = true;
    await pumpHost(tester, (itemId, result) async {
      calls.add('$itemId:$result');
      if (first) {
        first = false;
        return _queue([
          _item(
            id: 'card:physics:2',
            kind: 'card',
            label: 'What does the learning rate control?',
            reason: 'missed',
            priority: 2,
            count: 2,
            origin: 'flashcards',
          ),
        ]);
      }
      return _queue([
        _item(
          id: 'card:physics:2',
          kind: 'card',
          label: 'What does the learning rate control?',
          reason: 'missed',
          priority: 2,
          count: 3,
          origin: 'flashcards',
        ),
      ]);
    });

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    // The step is gone and the cursor is on the card that took its place.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
    await tester.pumpAndSettle();

    expect(calls, ['step:physics:1:known', 'card:physics:2:missed']);
    expect(find.text('3 misses'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the marking surface fits 800x600', (tester) async {
    await pumpHost(
      tester,
      (itemId, result) async => reviewFixture(),
      size: const Size(800, 600),
    );

    expect(find.text('REVIEW'), findsOneWidget);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(
      find.text('k known · m missed · r refresh · s side'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  test('CoreStore.markReview replaces the queue from the reply', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.refreshReview();

    final stepId = 'step:${FakeCore.sessionId}:1';
    expect(store.review!.items.map((item) => item.id), contains(stepId));

    final pending = <String?>[];
    store.addListener(() => pending.add(store.reviewMarkingId));

    await store.markReview(stepId, 'known');

    expect(core.reviewMarks, [
      {'itemId': stepId, 'result': 'known'},
    ]);
    expect(store.review!.items.map((item) => item.id), isNot(contains(stepId)));
    expect(store.reviewMarkingId, isNull);
    // The pending id was published before the answer arrived.
    expect(pending, contains(stepId));
  });

  test(
    'CoreStore.markReview rethrows and keeps the queue on failure',
    () async {
      final core = FakeCore(reviewMarkFailure: 'could not record the verdict');
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshReview();
      final before = store.review!.items.map((item) => item.id).toList();

      await expectLater(
        store.markReview('step:${FakeCore.sessionId}:1', 'known'),
        throwsA(
          isA<RpcException>().having(
            (failure) => failure.message,
            'message',
            'could not record the verdict',
          ),
        ),
      );

      expect(store.review!.items.map((item) => item.id), before);
      expect(store.reviewMarkingId, isNull);
      expect(core.reviewMarks, isEmpty);
    },
  );
}
