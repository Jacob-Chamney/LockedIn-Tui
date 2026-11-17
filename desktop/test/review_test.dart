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
    expect(find.text('snapshot · marking arrives later'), findsOneWidget);
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
      find.text('finish a step or miss a card to fill this queue'),
      findsOneWidget,
    );
    expect(find.text('snapshot · marking arrives later'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('s cycles all, school, skills and back to all', (tester) async {
    for (final (from, to) in [
      ('all', 'school'),
      ('school', 'skills'),
      ('skills', 'all'),
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
}
