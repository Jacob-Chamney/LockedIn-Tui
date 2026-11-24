import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/review/review_page.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Fixtures — plain values only. No core, no filesystem, no network.
// ---------------------------------------------------------------------------

const _lecture = SourceCoverage(
  hash: 'sha256:1111',
  name: 'lecture-4.md',
  originalPath: '/home/me/input/lecture-4.md',
  count: 3,
  documents: ['steps', 'chat'],
  firstLine: 'Read lecture-4.md and summarise the boundary conditions',
  referenced: true,
  fromMemoryOnly: false,
);

const _pdfGap = SourceCoverage(
  hash: 'sha256:2222',
  name: 'complex-numbers.pdf',
  originalPath: '/home/me/input/complex-numbers.pdf',
  count: 0,
  documents: [],
  firstLine: null,
  referenced: false,
  fromMemoryOnly: false,
);

const _pdfReferenced = SourceCoverage(
  hash: 'sha256:2222',
  name: 'complex-numbers.pdf',
  originalPath: '/home/me/input/complex-numbers.pdf',
  count: 2,
  documents: ['steps'],
  firstLine: 'complex-numbers.pdf is used for the integral limits',
  referenced: true,
  fromMemoryOnly: false,
);

const _memoryOnly = SourceCoverage(
  hash: 'sha256:3333',
  name: 'notes-from-memory.md',
  originalPath: '/home/me/input/notes-from-memory.md',
  count: 2,
  documents: ['memory'],
  firstLine: 'notes-from-memory.md came up in an earlier answer',
  referenced: true,
  fromMemoryOnly: true,
);

/// Two sources, one reference: the card's partial state.
const _partialReport = CoverageReport(
  sources: [_lecture, _pdfGap],
  unreferenced: [_pdfGap],
  total: 2,
  referencedCount: 1,
);

/// Two sources, both mentioned: the card's success tone.
const _fullReport = CoverageReport(
  sources: [_lecture, _pdfReferenced],
  unreferenced: [],
  total: 2,
  referencedCount: 2,
);

/// One source mentioned only by session memory.
const _memoryReport = CoverageReport(
  sources: [_memoryOnly],
  unreferenced: [],
  total: 1,
  referencedCount: 1,
);

const _detail = SessionDetail(
  id: '2026-11-01-1430-physics-unit-4',
  name: 'Physics — Unit 4',
  created: '2026-11-01T14:30:00Z',
  archived: false,
  prompt: 'Explain the problem set.',
  sources: [
    SessionSource(
      name: 'lecture-4.md',
      originalPath: '/home/me/input/lecture-4.md',
      storedPath: 'sources/lecture-4.md',
      hash: 'sha256:1111',
      kind: 'markdown',
    ),
    SessionSource(
      name: 'ComplexNumbers.pdf',
      originalPath: '/home/me/input/ComplexNumbers.pdf',
      storedPath: 'sources/ComplexNumbers.pdf',
      hash: 'sha256:2222',
      kind: 'pdf',
    ),
  ],
  steps: SessionSteps(done: 0, total: 1, exists: true, markdown: '- [ ] One'),
);

const _emptyCoverageSummary =
    'no sources yet · add sources so coverage can be measured';
const _caveat =
    'a mention is a lexical fact, not proof that a claim came from that source';
const _nextAction = 'mention a source in chat or the steps, or add steps';

Future<void> pumpDetail(
  WidgetTester tester, {
  CoverageReport? coverage,
  bool coverageLoading = false,
  String? coverageError,
  VoidCallback? onRetryCoverage,
  SessionDetail detail = _detail,
  Size size = const Size(900, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: SessionDetailView(
          detail: detail,
          loading: false,
          coverage: coverage,
          coverageLoading: coverageLoading,
          coverageError: coverageError,
          onRetryCoverage: onRetryCoverage,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// The core's raw `review.queue` snapshot, with or without coverage rows.
ReviewQueue reviewQueue({bool withCoverage = false}) => ReviewQueue.fromJson({
  'items': <Map<String, dynamic>>[],
  'counts': {
    'total': 0,
    'byKind': {'card': 0, 'step': 0, 'stage': 0, 'memory': 0},
  },
  'diagnostics': <Map<String, dynamic>>[],
  'intensity': 'balanced',
  if (withCoverage)
    'coverage': [
      {
        'sessionId': '2026-11-01-0900-physics',
        'name': 'Physics — Unit 4',
        'report': {
          'sources': <Map<String, dynamic>>[],
          'unreferenced': <Map<String, dynamic>>[],
          'total': 1,
          'referencedCount': 1,
        },
      },
      {
        'sessionId': '2026-10-02-0900-chemistry',
        'name': 'Chemistry — Bonding',
        'report': {
          'sources': <Map<String, dynamic>>[],
          'unreferenced': <Map<String, dynamic>>[],
          'total': 2,
          'referencedCount': 1,
        },
      },
    ],
});

Future<void> pumpReview(
  WidgetTester tester, {
  required ReviewQueue queue,
  Size size = const Size(900, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: ReviewPage(queue: queue)),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the coverage card renders the counts, rows and the gap list', (
    tester,
  ) async {
    await pumpDetail(tester, coverage: _partialReport);

    final card = find.byKey(const ValueKey('session-coverage-card'));
    expect(card, findsOneWidget);
    expect(find.text('COVERAGE'), findsOneWidget);
    expect(find.text('1 of 2 sources referenced'), findsOneWidget);

    // The referenced source names its count and the documents that mention it.
    expect(
      find.descendant(of: card, matching: find.text('lecture-4.md')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: card,
        matching: find.text('3 mentions · steps · chat'),
      ),
      findsOneWidget,
    );

    // The gap list sits under its own subheading, with the next action. Each
    // source is listed once: an unreferenced one only under `not referenced
    // yet`, never a second time among the counted rows.
    expect(find.text('not referenced yet'), findsOneWidget);
    expect(
      find.descendant(of: card, matching: find.text('complex-numbers.pdf')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('coverage-gap-0')), findsOneWidget);
    expect(find.text(_nextAction), findsOneWidget);

    // The honest caveat is always present, and the card is read-only.
    expect(find.text(_caveat), findsOneWidget);
    expect(
      find.descendant(of: card, matching: find.byType(FilledButton)),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a memory-only source is labelled history only', (tester) async {
    await pumpDetail(tester, coverage: _memoryReport);

    final card = find.byKey(const ValueKey('session-coverage-card'));
    expect(
      find.descendant(of: card, matching: find.text('notes-from-memory.md')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: card, matching: find.text('2 mentions · memory')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: card, matching: find.text('history only')),
      findsOneWidget,
    );
    expect(find.text('not referenced yet'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('fully covered is a success tone; partial stays muted', (
    tester,
  ) async {
    await pumpDetail(tester, coverage: _fullReport);
    final full = tester.widget<Text>(find.text('2 of 2 sources referenced'));
    expect(full.style?.color, LockedInColors.success);
    expect(find.text('not referenced yet'), findsNothing);

    await pumpDetail(tester, coverage: _partialReport);
    final partial = tester.widget<Text>(find.text('1 of 2 sources referenced'));
    expect(partial.style?.color, LockedInColors.muted);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the card has empty, loading and error states', (tester) async {
    await pumpDetail(tester, coverage: CoverageReport.empty);
    expect(find.text(_emptyCoverageSummary), findsOneWidget);
    expect(find.text('0 of 0 sources referenced'), findsOneWidget);

    await pumpDetail(tester, coverageLoading: true);
    expect(find.text('loading coverage…'), findsOneWidget);
    expect(find.text('reading…'), findsOneWidget);
    expect(find.text(_emptyCoverageSummary), findsNothing);

    var retries = 0;
    await pumpDetail(
      tester,
      coverage: _partialReport,
      coverageError: 'the session folder could not be read',
      onRetryCoverage: () => retries += 1,
    );
    // The previous report survives the failure; the message and retry join it.
    expect(find.text('1 of 2 sources referenced'), findsOneWidget);
    expect(find.text('could not read coverage'), findsOneWidget);
    expect(find.text('the session folder could not be read'), findsOneWidget);
    // Coverage is context now, below the current step: scroll to it first.
    final retry = find.byKey(const ValueKey('coverage-retry'));
    await tester.ensureVisible(retry);
    await tester.pumpAndSettle();
    await tester.tap(retry);
    await tester.pump();
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the review surface shows one coverage line only with rows', (
    tester,
  ) async {
    await pumpReview(tester, queue: reviewQueue(withCoverage: true));
    expect(
      find.text('coverage · 1 of 2 sessions have every source referenced'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('review-coverage')), findsOneWidget);
    expect(tester.takeException(), isNull);

    await pumpReview(tester, queue: reviewQueue());
    expect(find.byKey(const ValueKey('review-coverage')), findsNothing);
    expect(find.textContaining('coverage ·'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a long coverage card fits 800x600 without overflowing', (
    tester,
  ) async {
    final sources = [
      for (var index = 0; index < 6; index++)
        SourceCoverage(
          hash: 'sha256:long$index',
          name: 'a-very-long-source-file-name-that-has-to-truncate-$index.md',
          originalPath: '/home/me/input/long-$index.md',
          count: index,
          documents: index == 0 ? const ['steps'] : const [],
          firstLine: null,
          referenced: index > 0,
          fromMemoryOnly: false,
        ),
    ];
    final report = CoverageReport(
      sources: sources,
      unreferenced: sources.where((source) => !source.referenced).toList(),
      total: sources.length,
      referencedCount: sources.where((source) => source.referenced).length,
    );
    await pumpDetail(tester, coverage: report, size: const Size(800, 600));

    expect(find.byKey(const ValueKey('session-coverage-card')), findsOneWidget);
    expect(find.text('COVERAGE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('coverage models tolerate absent and malformed fields', () {
    final empty = CoverageReport.fromJson(null);
    expect(empty.sources, isEmpty);
    expect(empty.unreferenced, isEmpty);
    expect(empty.total, 0);
    expect(empty.referencedCount, 0);
    expect(empty.fullyCovered, isFalse);
    expect(empty.hasNoSources, isTrue);

    final malformed = CoverageReport.fromJson({
      'sources': 'not a list',
      'total': 'two',
      'referencedCount': null,
    });
    expect(malformed.sources, isEmpty);
    expect(malformed.total, 0);
    expect(malformed.fullyCovered, isFalse);

    final partial = SourceCoverage.fromJson(const {'name': 'only-a-name'});
    expect(partial.name, 'only-a-name');
    expect(partial.hash, '');
    expect(partial.originalPath, '');
    expect(partial.count, 0);
    expect(partial.documents, isEmpty);
    expect(partial.firstLine, isNull);
    expect(partial.referenced, isFalse);
    expect(partial.fromMemoryOnly, isFalse);

    final firstLine = SourceCoverage.fromJson(const {
      'firstLine': '  a matched line  ',
    });
    expect(firstLine.firstLine, 'a matched line');

    // A row without an id cannot be addressed by the page, so it is dropped.
    final queue = ReviewQueue.fromJson(const {
      'coverage': [
        {'name': 'no id'},
        {
          'sessionId': '2026-11-01-0900-physics',
          'report': {'total': 1, 'referencedCount': 1},
        },
      ],
    });
    expect(queue.coverage.length, 1);
    expect(queue.coverage.single.sessionId, '2026-11-01-0900-physics');
    expect(queue.coverage.single.displayName, '2026-11-01-0900-physics');
    expect(queue.coverage.single.report.fullyCovered, isTrue);

    final absent = ReviewQueue.fromJson(const {'intensity': 'balanced'});
    expect(absent.coverage, isEmpty);
  });

  test(
    'the store reads coverage on open and keeps it when a read fails',
    () async {
      final fake = FakeCore();
      final store = CoreStore(connection: fake);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      expect(fake.coverageRequests, [FakeCore.sessionId]);
      expect(store.coverageLoading, isFalse);
      expect(store.coverageError, isNull);
      expect(store.coverage, isNotNull);
      expect(store.coverage!.total, 2);
      expect(store.coverage!.referencedCount, 1);
      expect(store.coverage!.unreferenced.single.name, 'complex-numbers.pdf');

      fake.coverageFailure = 'the session folder could not be read';
      await store.readCoverage(FakeCore.sessionId);
      expect(store.coverageError, 'the session folder could not be read');
      // The previous report is kept: a failed read never invents an empty one.
      expect(store.coverage, isNotNull);
      expect(store.coverage!.total, 2);
      expect(store.coverageLoading, isFalse);

      store.closeSession();
      expect(store.coverage, isNull);
      expect(store.coverageError, isNull);
      expect(store.coverageLoading, isFalse);
    },
  );

  test('an empty coverage option is a valid report, not an error', () async {
    final store = CoreStore(connection: FakeCore(coverageEmpty: true));
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    expect(store.coverage, isNotNull);
    expect(store.coverage!.hasNoSources, isTrue);
    expect(store.coverage!.fullyCovered, isFalse);
    expect(store.coverageError, isNull);
  });
}
