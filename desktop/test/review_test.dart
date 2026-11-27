import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/review/review_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The documented `review.queue` snapshot: a missed card and an unchecked step
/// (the card has the higher priority value, so the step must sort first), a
/// balanced nudge and one skipped folder.
ReviewQueue reviewFixture() => ReviewQueue.fromJson({
  'items': [
    {
      'id': 'card:physics:2',
      'kind': 'card',
      'label': 'What does the learning rate control?',
      'context': 'Physics — Unit 4',
      'contextId': '2026-11-01-0900-physics',
      'reason': 'missed',
      'priority': 2,
      'count': 2,
      'origin': 'flashcards',
    },
    {
      'id': 'step:physics:1',
      'kind': 'step',
      'label': 'Derive the energy balance',
      'context': 'Physics — Unit 4',
      'contextId': '2026-11-01-0900-physics',
      'reason': 'unchecked',
      'priority': 1,
      'count': 0,
      'origin': 'steps',
    },
  ],
  'nudge': {
    'intensity': 'balanced',
    'threshold': 3,
    'due': ['card:physics:2'],
    'suggestions': ['review the missed card before the next step'],
  },
  'counts': {
    'total': 2,
    'byKind': {'card': 1, 'step': 1, 'stage': 0, 'memory': 0},
  },
  'diagnostics': [
    {
      'kind': 'review',
      'path': 'skills/goals/rust-ownership-9c2d4e',
      'message': 'meta.json could not be read',
      'next': 'open the goal folder and fix or remove its meta.json',
    },
  ],
  'intensity': 'balanced',
});

Future<void> pumpReview(
  WidgetTester tester, {
  ReviewQueue? queue,
  bool loading = false,
  String? error,
  String side = 'all',
  VoidCallback? onRefresh,
  ValueChanged<String>? onSide,
  VoidCallback? onBack,
  Future<void> Function(String itemId, String result)? onMark,
  ValueChanged<ReviewItem>? onOpen,
  VoidCallback? onReview,
  Size size = const Size(1280, 800),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: ReviewPage(
          queue: queue,
          loading: loading,
          error: error,
          side: side,
          onRefresh: onRefresh,
          onSide: onSide,
          onBack: onBack,
          onMark: onMark,
          onOpen: onOpen,
          onReview: onReview,
        ),
      ),
    ),
  );
  // A live spinner never settles, so the loading state pumps one frame.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

void main() {
  testWidgets('known is the success tone, not another muted label', (
    tester,
  ) async {
    await pumpReview(tester, queue: reviewFixture(), onMark: (_, _) async {});

    final known = tester.widget<TextButton>(
      find.byKey(const ValueKey('review-known-step:physics:1')),
    );
    expect(known.style?.foregroundColor?.resolve({}), LockedInColors.success);
    final missed = tester.widget<TextButton>(
      find.byKey(const ValueKey('review-missed-step:physics:1')),
    );
    expect(missed.style?.foregroundColor?.resolve({}), LockedInColors.warning);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a nudge with nothing due is one quiet line', (tester) async {
    final quiet = ReviewQueue.fromJson({
      'items': <Object>[],
      'nudge': {
        'intensity': 'balanced',
        'threshold': 3,
        'due': <String>[],
        'suggestions': <String>[],
      },
      'counts': {'total': 0, 'byKind': <String, int>{}},
    });
    await pumpReview(tester, queue: quiet);

    expect(find.byKey(const ValueKey('review-nudge-quiet')), findsOneWidget);
    expect(find.textContaining('nothing due'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a row opens its own surface on click or Enter', (tester) async {
    final opened = <String>[];
    await pumpReview(
      tester,
      queue: reviewFixture(),
      onOpen: (item) => opened.add('${item.kind}:${item.contextId}'),
    );

    // Click the step row: the same callback Enter runs.
    final row = find.byKey(const ValueKey('review-row-step:physics:1'));
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(opened, ['step:2026-11-01-0900-physics']);

    // Enter on the selected row opens it too.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(opened, hasLength(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a row carries known and missed buttons', (tester) async {
    final marks = <String>[];
    await pumpReview(
      tester,
      queue: reviewFixture(),
      onMark: (itemId, result) async => marks.add('$itemId:$result'),
    );

    final missed = find.byKey(const ValueKey('review-missed-step:physics:1'));
    expect(missed, findsOneWidget);
    await tester.tap(missed);
    await tester.pumpAndSettle();
    expect(marks, ['step:physics:1:missed']);

    final known = find.byKey(const ValueKey('review-known-step:physics:1'));
    await tester.tap(known);
    await tester.pumpAndSettle();
    expect(marks.last, 'step:physics:1:known');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the purpose line names what is and is not reviewed', (
    tester,
  ) async {
    await pumpReview(tester, queue: reviewFixture());
    expect(find.byKey(const ValueKey('review-purpose')), findsOneWidget);
    expect(find.textContaining('Cards are reviewed here'), findsOneWidget);
    expect(find.text('TO REVIEW'), findsOneWidget);
    expect(find.text('OPEN STEPS'), findsOneWidget);
  });

  testWidgets('history is a labelled read-only group outside the count', (
    tester,
  ) async {
    final queue = ReviewQueue.fromJson({
      'items': [
        {
          'id': 'card:physics:2',
          'kind': 'card',
          'label': 'What does the learning rate control?',
          'context': 'Physics — Unit 4',
          'contextId': '2026-11-01-0900-physics',
          'reason': 'missed',
          'priority': 0,
          'count': 1,
          'origin': 'flashcards',
        },
        {
          'id': 'memory:physics:0',
          'kind': 'memory',
          'label': 'Boundary conditions determine the integral limits.',
          'context': 'Physics — Unit 4',
          'contextId': '2026-11-01-0900-physics',
          'reason': 'memory',
          'priority': 3,
          'count': 0,
          'origin': 'session-memory',
        },
      ],
      'nudge': {
        'intensity': 'balanced',
        'threshold': 3,
        'due': [],
        'suggestions': [],
      },
      'counts': {
        'total': 2,
        'byKind': {'card': 1, 'step': 0, 'stage': 0, 'memory': 1},
      },
      'diagnostics': [],
      'intensity': 'balanced',
    });
    await pumpReview(tester, queue: queue);

    expect(find.text('HISTORY · read-only'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('review-total')),
        matching: find.text('1'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('the queue renders items, counts, a nudge and a diagnostic', (
    tester,
  ) async {
    await pumpReview(tester, queue: reviewFixture());

    expect(find.text('REVIEW'), findsOneWidget);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(find.text('What does the learning rate control?'), findsOneWidget);
    expect(find.text('STEP'), findsOneWidget);
    expect(find.text('CARD'), findsOneWidget);
    expect(find.text('2 misses'), findsOneWidget);

    // Counts: total badge plus the per-kind summary.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('review-total')),
        matching: find.text('2'),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('1 card · 1 step'), findsOneWidget);

    // The priority-1 step sorts above the priority-2 card.
    final stepY = tester.getTopLeft(find.text('Derive the energy balance')).dy;
    final cardY = tester
        .getTopLeft(find.text('What does the learning rate control?'))
        .dy;
    expect(stepY, lessThan(cardY));

    // Nudge strip.
    expect(find.byKey(const ValueKey('review-nudge')), findsOneWidget);
    expect(find.textContaining('balanced · threshold 3'), findsOneWidget);
    expect(find.textContaining('1 due'), findsOneWidget);
    expect(
      find.text('review the missed card before the next step'),
      findsOneWidget,
    );

    // Diagnostics block.
    expect(find.byKey(const ValueKey('review-diagnostics')), findsOneWidget);
    expect(find.text('meta.json could not be read'), findsOneWidget);
    expect(
      find.textContaining(
        'next: open the goal folder and fix or remove its meta.json',
      ),
      findsOneWidget,
    );

    // Read-only copy: this surface never marks.
    expect(find.text('snapshot · marking is available'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('diagnostics are a muted warning, not an error', (tester) async {
    await pumpReview(tester, queue: reviewFixture());

    expect(find.byKey(const ValueKey('review-diagnostics')), findsOneWidget);
    expect(find.text('some items could not be read'), findsOneWidget);
    expect(find.text('not a failure'), findsOneWidget);
    expect(find.byKey(const ValueKey('review-error')), findsNothing);
    expect(find.byKey(const ValueKey('review-retry')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty queue says what fills it', (tester) async {
    await pumpReview(
      tester,
      queue: ReviewQueue.fromJson({
        'items': const <Map<String, dynamic>>[],
        'counts': {
          'total': 0,
          'byKind': {'card': 0, 'step': 0, 'stage': 0, 'memory': 0},
        },
        'diagnostics': const <Map<String, dynamic>>[],
        'intensity': 'balanced',
      }),
    );

    expect(find.byKey(const ValueKey('review-empty')), findsOneWidget);
    expect(find.text('nothing to review'), findsOneWidget);
    expect(
      find.text(
        'leave a lock-in step unchecked or miss a flashcard to fill this '
        'queue',
      ),
      findsOneWidget,
    );
    expect(find.text('snapshot · marking is available'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('s cycles all, school, skills, work and back to all', (
    tester,
  ) async {
    for (final (from, to) in [
      ('all', 'school'),
      ('school', 'skills'),
      ('skills', 'work'),
      ('work', 'all'),
    ]) {
      final next = <String>[];
      await pumpReview(
        tester,
        queue: reviewFixture(),
        side: from,
        onSide: next.add,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
      expect(next, [to], reason: '$from should cycle to $to');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('a side chip asks for that projection', (tester) async {
    final sides = <String>[];
    await pumpReview(tester, queue: reviewFixture(), onSide: sides.add);

    await tester.tap(find.byKey(const ValueKey('review-side-school')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('review-side-skills')));
    await tester.pumpAndSettle();

    expect(sides, ['school', 'skills']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the primary action reviews the cards', (tester) async {
    var reviewed = 0;
    await pumpReview(
      tester,
      queue: reviewFixture(),
      onReview: () => reviewed += 1,
    );
    final button = find.byKey(const ValueKey('review-start'));
    expect(button, findsOneWidget);
    expect(find.text('review 1 card'), findsOneWidget);
    await tester.tap(button);
    await tester.pump();
    expect(reviewed, 1);
  });

  testWidgets('r refreshes and Esc goes back', (tester) async {
    var refreshes = 0;
    var backs = 0;
    await pumpReview(
      tester,
      queue: reviewFixture(),
      onRefresh: () => refreshes += 1,
      onBack: () => backs += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(refreshes, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed read keeps the snapshot and offers Retry', (
    tester,
  ) async {
    var refreshes = 0;
    await pumpReview(
      tester,
      queue: reviewFixture(),
      error: 'core unavailable',
      onRefresh: () => refreshes += 1,
    );

    expect(find.byKey(const ValueKey('review-error')), findsOneWidget);
    expect(find.text('core unavailable'), findsOneWidget);
    // The previous queue is still on screen.
    expect(find.text('Derive the energy balance'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('review-retry')));
    await tester.pumpAndSettle();
    expect(refreshes, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a first read with no snapshot shows the loading state', (
    tester,
  ) async {
    await pumpReview(tester, loading: true, settle: false);
    expect(find.text('loading review…'), findsOneWidget);
    expect(find.byKey(const ValueKey('review-empty')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the page fits 800x600', (tester) async {
    await pumpReview(
      tester,
      queue: reviewFixture(),
      size: const Size(800, 600),
    );

    expect(find.text('REVIEW'), findsOneWidget);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(find.byKey(const ValueKey('review-nudge')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('mistakes and work tasks have their own groups', (tester) async {
    final queue = ReviewQueue.fromJson({
      'items': [
        {
          'id': 'mistake:physics:0',
          'kind': 'mistake',
          'label': 'Energy is conserved per object.',
          'context': 'Physics — Unit 4',
          'contextId': 'physics',
          'reason': 'uncorrected',
          'priority': 3,
          'count': 0,
          'origin': 'session-mistake',
        },
        {
          'id': 'task:my-app:run-1:task-1',
          'kind': 'task',
          'label': 'Check the offset handling',
          'context': 'My app',
          'contextId': 'my-app',
          'reason': 'unverified',
          'priority': 5,
          'count': 0,
          'origin': 'swarm',
        },
      ],
      'nudge': {
        'intensity': 'balanced',
        'threshold': 3,
        'due': [],
        'suggestions': [],
      },
      'counts': {
        'total': 2,
        'byKind': {'mistake': 1, 'task': 1},
      },
      'diagnostics': [],
      'coverage': [],
      'intensity': 'balanced',
    });
    await pumpReview(tester, queue: queue, onMark: (id, result) async {});

    expect(find.text('MISTAKES · no correction yet'), findsOneWidget);
    expect(find.text('WORK · needs verification'), findsOneWidget);

    // A mistake offers both verdicts; a task only offers verification.
    expect(
      find.byKey(const ValueKey('review-known-mistake:physics:0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('review-missed-mistake:physics:0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('review-known-task:my-app:run-1:task-1')),
      findsOneWidget,
    );
    // The task's missed button is present but disabled: a completed task has
    // no miss signal, and the page must not advertise a dead action.
    final missedTask = find.byKey(
      const ValueKey('review-missed-task:my-app:run-1:task-1'),
    );
    expect(missedTask, findsOneWidget);
    expect(tester.widget<TextButton>(missedTask).onPressed, isNull);
    final missedMistake = find.byKey(
      const ValueKey('review-missed-mistake:physics:0'),
    );
    expect(tester.widget<TextButton>(missedMistake).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });
}
