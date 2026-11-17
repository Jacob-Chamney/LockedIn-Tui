import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/stats/stats_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

StatsSummary _summary() => StatsSummary(
  range: '30d',
  scope: 'all',
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
    StatsModelRow(
      model: 'local/llama',
      runs: 3,
      input: 4240,
      output: 1210,
      costMicroUsd: null,
    ),
  ],
  tools: const [
    StatsToolRow(name: 'read_file', calls: 7),
    StatsToolRow(name: 'search_files', calls: 2),
  ],
  learning: const LearningStats(
    steps: 5,
    cardsKnown: 4,
    cardsMissed: 2,
    lessons: 1,
  ),
  activity: const [
    ActivityDay(date: '2026-11-01', runs: 2, tokens: 1800),
    ActivityDay(date: '2026-11-02', runs: 1, tokens: 600),
    ActivityDay(date: '2026-11-03', runs: 3, tokens: 2400),
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

void main() {
  testWidgets('the dashboard renders summary figures and sections', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app(StatsPage(summary: _summary())));
    await tester.pumpAndSettle();

    expect(find.text('STATS'), findsOneWidget);
    expect(find.text('TOKENS'), findsOneWidget);
    expect(find.text('24.4K'), findsOneWidget);
    expect(find.text('2 failed'), findsOneWidget);
    expect(find.text('18'), findsOneWidget);
    expect(find.text(r'$0.1284'), findsOneWidget);
    expect(find.text('TOKENS OVER TIME'), findsOneWidget);
    expect(find.text('peak 2.4K/day'), findsOneWidget);
    expect(find.text('MODELS'), findsOneWidget);
    expect(find.text('openai/gpt-4.1-mini'), findsOneWidget);
    expect(find.text('TOOLS'), findsOneWidget);
    expect(find.text('LEARNING'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty summary invites work', (tester) async {
    await tester.pumpWidget(_app(const StatsPage()));
    await tester.pumpAndSettle();

    expect(find.text('no stats yet'), findsOneWidget);
    expect(
      find.text('send a message or run a generation to fill this page'),
      findsOneWidget,
    );
  });

  testWidgets('an error offers retry', (tester) async {
    var retried = false;
    await tester.pumpWidget(
      _app(StatsPage(error: 'core unavailable', onRetry: () => retried = true)),
    );
    await tester.pumpAndSettle();

    expect(find.text('core unavailable'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retried, isTrue);
  });

  testWidgets('800x600 does not overflow', (tester) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_app(StatsPage(summary: _summary())));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
