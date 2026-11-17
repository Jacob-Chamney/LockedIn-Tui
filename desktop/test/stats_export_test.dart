import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/stats/stats_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

StatsSummary _summary() => StatsSummary(
  range: '30d',
  scope: 'school',
  overview: const StatsOverview(
    runs: 12,
    failed: 2,
    input: 18240,
    output: 6110,
  ),
  costMicroUsd: 128400,
  costLabel: r'$0.1284',
  models: const [
    StatsModelRow(
      model: 'openai/gpt-4.1-mini',
      runs: 9,
      input: 14000,
      output: 4900,
      costMicroUsd: 128400,
    ),
  ],
  tools: const [StatsToolRow(name: 'read_file', calls: 7)],
  learning: const LearningStats(
    steps: 5,
    cardsKnown: 4,
    cardsMissed: 2,
    lessons: 1,
  ),
  activity: const [
    ActivityDay(date: '2026-11-01', runs: 2, tokens: 1800),
    ActivityDay(date: '2026-11-02', runs: 1, tokens: 600),
  ],
  bestStreak: 14,
  activeDays: 18,
  period: const StatsPeriod(from: '2026-01-05', to: '2026-11-02'),
  diagnostic: null,
);

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

/// Records every export request and answers one document per format.
class _ExportLog {
  final requests = <Map<String, String>>[];
  String? failure;
  bool failOnce = false;

  Future<StatsExportResult> call({
    required String range,
    required String scope,
    required String format,
  }) async {
    requests.add({'range': range, 'scope': scope, 'format': format});
    final failure = this.failure;
    if (failure != null) {
      if (failOnce) {
        this.failure = null;
      }
      throw RpcException(-32000, failure, {
        'kind': 'stats',
        'message': failure,
      });
    }
    if (format == 'csv') {
      return const StatsExportResult(
        text: 'metric,value\nrange,30d\nscope,school\ntokens,24350\n',
        format: 'csv',
      );
    }
    return const StatsExportResult(
      text:
          '# Stats — 30d · school\n\n'
          '> Estimates, not a bill.\n\n'
          '- Tokens: 24,350\n',
      format: 'md',
    );
  }
}

void main() {
  group('CoreStore.exportStats', () {
    test('forwards range, scope and format and returns the document', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      final result = await store.exportStats(
        range: '30d',
        scope: 'school',
        format: 'csv',
      );

      expect(core.statsExports, hasLength(1));
      expect(core.statsExports.single, {
        'range': '30d',
        'scope': 'school',
        'format': 'csv',
      });
      expect(result.format, 'csv');
      expect(result.text, contains('metric,value'));
      expect(result.text, contains('scope,school'));
      // The export writes nothing: the store keeps no projection of it.
      expect(core.calls, contains('stats.export'));
      expect(store.stats, isNotNull);
    });

    test('a typed stats refusal rethrows for the page', () async {
      final core = FakeCore(statsExportFailure: 'usage.json could not be read');
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await expectLater(
        store.exportStats(range: 'all', scope: 'all'),
        throwsA(
          isA<RpcException>().having(
            (error) => error.message,
            'message',
            'usage.json could not be read',
          ),
        ),
      );
      expect(core.statsExports, isEmpty);
    });
  });

  group('StatsPage export dialog', () {
    testWidgets('x opens with the Markdown document', (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final log = _ExportLog();
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onExport: log.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('x export'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      expect(find.text('export stats'), findsOneWidget);
      expect(find.text('markdown'), findsOneWidget);
      expect(find.text('csv'), findsOneWidget);
      expect(find.textContaining('Estimates, not a bill.'), findsOneWidget);
      expect(log.requests, hasLength(1));
      expect(log.requests.single, {
        'range': '30d',
        'scope': 'school',
        'format': 'md',
      });
      expect(tester.takeException(), isNull);
    });

    testWidgets('choosing CSV refetches the same range and scope', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final log = _ExportLog();
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onExport: log.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      await tester.tap(find.text('csv'));
      await tester.pumpAndSettle();

      expect(log.requests, hasLength(2));
      expect(log.requests.last, {
        'range': '30d',
        'scope': 'school',
        'format': 'csv',
      });
      expect(find.textContaining('metric,value'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Copy puts the document on the clipboard and says so', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            final arguments = call.arguments;
            if (arguments is Map) {
              copied = arguments['text'] as String?;
            }
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );

      final log = _ExportLog();
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onExport: log.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Copy'));
      await tester.pumpAndSettle();

      expect(copied, contains('Estimates, not a bill.'));
      expect(find.text('copied'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a failure shows one message and Retry asks again', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final log = _ExportLog()
        ..failure = 'usage.json could not be read'
        ..failOnce = true;
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onExport: log.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      expect(find.text('usage.json could not be read'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);

      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(log.requests, hasLength(2));
      expect(find.text('usage.json could not be read'), findsNothing);
      expect(find.textContaining('Estimates, not a bill.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Close returns to the dashboard', (tester) async {
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final log = _ExportLog();
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onExport: log.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();
      expect(find.text('export stats'), findsOneWidget);

      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();

      expect(find.text('export stats'), findsNothing);
      expect(find.text('STATS'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('800x600 shows the dialog without overflow', (tester) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final log = _ExportLog();
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onExport: log.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      expect(find.text('export stats'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('r and s still cycle the range and scope chips', (
      tester,
    ) async {
      final ranges = <String>[];
      final scopes = <String>[];
      await tester.pumpWidget(
        _app(
          StatsPage(
            summary: _summary(),
            range: '30d',
            scope: 'school',
            onRange: ranges.add,
            onScope: scopes.add,
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();

      expect(ranges, ['90d']);
      expect(scopes, ['skills']);
      // Without onExport the action is not offered, so the footer never
      // advertises a key that does nothing.
      expect(find.textContaining('x export'), findsNothing);
    });
  });
}
