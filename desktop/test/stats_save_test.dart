import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/stats/stats_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

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

/// One export document per format, exactly as the core answers.
class _ExportLog {
  final requests = <Map<String, String>>[];

  Future<StatsExportResult> call({
    required String range,
    required String scope,
    required String format,
  }) async {
    requests.add({'range': range, 'scope': scope, 'format': format});
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

/// A temp workspace under `/tmp/opencode`, deleted on teardown.
Directory _tempDir() {
  final root = Directory('/tmp/opencode');
  if (!root.existsSync()) root.createSync(recursive: true);
  final dir = Directory(
    '${root.path}/stats-save-${DateTime.now().microsecondsSinceEpoch}',
  )..createSync(recursive: true);
  addTearDown(() {
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  });
  return dir;
}

/// Let the save chain finish: the picker's microtask, then the real write.
///
/// `testWidgets` runs in a fake-async zone, so a file write started by the
/// dialog only completes once the test gives the real event loop a turn; the
/// pump between turns flushes the fake zone's microtasks. Bounded and short,
/// because a save writes a few hundred bytes.
Future<void> _pumpIo(WidgetTester tester) async {
  for (var turn = 0; turn < 10; turn++) {
    await tester.pump();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 2)),
    );
  }
  await tester.pumpAndSettle();
}

void _size(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('Save writes the current Markdown document and says where', (
    tester,
  ) async {
    _size(tester, const Size(1280, 800));
    final dir = _tempDir();
    final log = _ExportLog();
    final suggested = <String>[];
    final target = '${dir.path}/stats-all-30d.md';

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          pickSavePath: (name) async {
            suggested.add(name);
            return target;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('Save…'), findsOneWidget);

    await tester.tap(find.text('Save…'));
    await _pumpIo(tester);

    expect(suggested, ['stats-school-30d.md']);
    expect(find.text('saved to $target'), findsOneWidget);
    final file = File(target);
    expect(file.existsSync(), isTrue);
    expect(
      file.readAsStringSync(),
      '# Stats — 30d · school\n\n'
      '> Estimates, not a bill.\n\n'
      '- Tokens: 24,350\n',
    );
    // The dialog is still open, so a second Save is one click away.
    expect(find.text('export stats'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('CSV changes the suggested extension and the written bytes', (
    tester,
  ) async {
    _size(tester, const Size(1280, 800));
    final dir = _tempDir();
    final log = _ExportLog();
    final suggested = <String>[];
    final target = '${dir.path}/stats-all-30d.csv';

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          pickSavePath: (name) async {
            suggested.add(name);
            return target;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    await tester.tap(find.text('csv'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save…'));
    await _pumpIo(tester);

    expect(suggested, ['stats-school-30d.csv']);
    expect(
      File(target).readAsStringSync(),
      'metric,value\nrange,30d\nscope,school\ntokens,24350\n',
    );
    expect(log.requests.last['format'], 'csv');
    expect(tester.takeException(), isNull);
  });

  testWidgets('a cancelled picker writes nothing and shows no error', (
    tester,
  ) async {
    _size(tester, const Size(1280, 800));
    final dir = _tempDir();
    final log = _ExportLog();

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          pickSavePath: (name) async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save…'));
    await _pumpIo(tester);

    expect(dir.listSync(), isEmpty);
    expect(find.textContaining('saved to'), findsNothing);
    expect(find.textContaining('could not save'), findsNothing);
    expect(find.text('export stats'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed write says so once and keeps the dialog open', (
    tester,
  ) async {
    _size(tester, const Size(1280, 800));
    final dir = _tempDir();
    final log = _ExportLog();
    final missing = '${dir.path}/missing/nested/stats.md';

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          pickSavePath: (name) async => missing,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Save…'));
    await _pumpIo(tester);

    expect(find.textContaining('could not save'), findsOneWidget);
    expect(find.textContaining('saved to'), findsNothing);
    expect(File(missing).existsSync(), isFalse);
    expect(find.text('export stats'), findsOneWidget);
    expect(find.text('Close'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('s saves from inside the dialog and never cycles the scope', (
    tester,
  ) async {
    _size(tester, const Size(1280, 800));
    final dir = _tempDir();
    final log = _ExportLog();
    final scopes = <String>[];
    final target = '${dir.path}/stats-school-30d.md';

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          onScope: scopes.add,
          pickSavePath: (name) async => target,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await _pumpIo(tester);

    expect(File(target).readAsStringSync(), contains('Estimates, not a bill.'));
    expect(find.text('saved to $target'), findsOneWidget);
    // `s` belongs to the dialog while it is open; the chip must not move.
    expect(scopes, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Copy still works beside Save', (tester) async {
    _size(tester, const Size(1280, 800));
    final dir = _tempDir();
    final log = _ExportLog();
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          final arguments = call.arguments;
          if (arguments is Map) copied = arguments['text'] as String?;
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

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          pickSavePath: (name) async => '${dir.path}/stats-school-30d.md',
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
    expect(find.text('Save…'), findsOneWidget);
    expect(dir.listSync(), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('800x600 keeps Save, Copy and Close without overflow', (
    tester,
  ) async {
    _size(tester, const Size(800, 600));
    final log = _ExportLog();

    await tester.pumpWidget(
      _app(
        StatsPage(
          summary: _summary(),
          range: '30d',
          scope: 'school',
          onExport: log.call,
          pickSavePath: (name) async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('export stats'), findsOneWidget);
    expect(find.text('Save…'), findsOneWidget);
    expect(find.text('Copy'), findsOneWidget);
    expect(find.text('Close'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
