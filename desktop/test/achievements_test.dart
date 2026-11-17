import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/achievements/achievements_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

AchievementRow _row({
  required String id,
  required String name,
  required String task,
  required String category,
  required String metric,
  required int target,
  required int value,
  required int progress,
  bool unlocked = false,
  String difficulty = 'easiest',
  String? awardedAt,
}) => AchievementRow(
  id: id,
  name: name,
  task: task,
  category: category,
  metric: metric,
  target: target,
  value: value,
  progress: progress,
  unlocked: unlocked,
  difficulty: difficulty,
  awardedAt: awardedAt,
);

/// The same six-row projection the fake core sends: two earned, four locked,
/// spread over the four shelves.
final _rows = <AchievementRow>[
  _row(
    id: 'first-light',
    name: 'First Light',
    task: 'Send your first message.',
    category: 'starter',
    metric: 'messages',
    target: 1,
    value: 1,
    progress: 12,
    unlocked: true,
    awardedAt: '2026-11-01',
  ),
  _row(
    id: 'open-book',
    name: 'Open Book',
    task: 'Create your first lock-in session.',
    category: 'starter',
    metric: 'sessions',
    target: 1,
    value: 1,
    progress: 1,
    unlocked: true,
    awardedAt: '2026-11-02',
  ),
  _row(
    id: 'first-steps',
    name: 'First Steps',
    task: 'Tick off ten assignment steps.',
    category: 'learning',
    metric: 'steps',
    target: 10,
    value: 3,
    progress: 3,
  ),
  _row(
    id: 'long-march',
    name: 'Long March',
    task: 'Tick off one hundred assignment steps.',
    category: 'learning',
    metric: 'steps',
    target: 100,
    value: 3,
    progress: 3,
    difficulty: 'hard',
  ),
  _row(
    id: 'toolsmith',
    name: 'Toolsmith',
    task: 'Make twenty-five tool calls.',
    category: 'work',
    metric: 'toolCalls',
    target: 25,
    value: 7,
    progress: 7,
    difficulty: 'easy',
  ),
  _row(
    id: 'locked-in',
    name: 'Locked In',
    task: 'Create ten lock-in sessions.',
    category: 'collection',
    metric: 'sessions',
    target: 10,
    value: 2,
    progress: 2,
  ),
];

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_app(child));
  await tester.pumpAndSettle();
}

String _textOf(WidgetTester tester, String key) =>
    tester.widget<Text>(find.byKey(ValueKey(key))).data ?? '';

void main() {
  testWidgets('the header counts, groups and rows render', (tester) async {
    await _pump(tester, AchievementsPage(rows: _rows, earned: 2, total: 6));

    expect(find.text('ACHIEVEMENTS'), findsOneWidget);
    expect(find.text('2 of 6 unlocked'), findsOneWidget);

    // One header per category, in catalogue order, with its row count.
    expect(find.text('STARTER · 2'), findsOneWidget);
    expect(find.text('LEARNING · 2'), findsOneWidget);
    expect(find.text('WORK · 1'), findsOneWidget);
    expect(find.text('COLLECTION · 1'), findsOneWidget);

    for (final name in const [
      'First Light',
      'Open Book',
      'First Steps',
      'Long March',
      'Toolsmith',
      'Locked In',
    ]) {
      expect(find.text(name), findsOneWidget, reason: 'missing $name');
    }

    // An unlocked row carries the check glyph and the award day.
    expect(_textOf(tester, 'achievement-status-first-light'), '✓ 2026-11-01');
    expect(_textOf(tester, 'achievement-status-open-book'), '✓ 2026-11-02');
    // A locked row says so, and its progress line is the core's numbers.
    expect(_textOf(tester, 'achievement-status-first-steps'), 'locked');
    expect(find.text('locked'), findsNWidgets(4));
    expect(_textOf(tester, 'achievement-progress-first-steps'), '3 / 10 steps');
    // An over-achieved row keeps the clamped bar and shows the raw counter.
    expect(
      _textOf(tester, 'achievement-progress-first-light'),
      '1 / 1 messages · 12',
    );
    expect(find.text('lock-in sessions'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('j/k move the selection and keep it on the visible row', (
    tester,
  ) async {
    await _pump(
      tester,
      AchievementsPage(rows: _rows, earned: 2, total: 6),
      size: const Size(900, 600),
    );

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-selected')),
        matching: find.text('First Light'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-selected')),
        matching: find.text('Open Book'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-selected')),
        matching: find.text('First Steps'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-selected')),
        matching: find.text('Open Book'),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('r re-reads and Esc goes back', (tester) async {
    var reloads = 0;
    var backs = 0;
    await _pump(
      tester,
      AchievementsPage(
        rows: _rows,
        earned: 2,
        total: 6,
        onRefresh: () => reloads += 1,
        onBack: () => backs += 1,
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(reloads, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);
    expect(find.text('j/k move · r reload · Esc back'), findsOneWidget);
  });

  testWidgets('a warning is a muted note, never an error', (tester) async {
    await _pump(
      tester,
      AchievementsPage(
        rows: _rows,
        earned: 2,
        total: 6,
        warning: 'award dates could not be read',
      ),
    );

    final note = find.byKey(const ValueKey('achievements-warning'));
    expect(note, findsOneWidget);
    expect(
      find.textContaining('award dates could not be read'),
      findsOneWidget,
    );
    expect(
      tester.widget<Text>(note).style?.color,
      LockedInColors.muted,
      reason: 'a warning is a quiet note beside the rows',
    );
    // The rows are still complete: a warning never replaces the inventory.
    expect(find.text('First Light'), findsOneWidget);
    expect(find.byKey(const ValueKey('achievements-error')), findsNothing);
  });

  testWidgets('an error keeps the rows and offers a retry', (tester) async {
    var reloads = 0;
    await _pump(
      tester,
      AchievementsPage(
        rows: _rows,
        earned: 2,
        total: 6,
        error: 'achievements.json could not be read',
        onRefresh: () => reloads += 1,
      ),
    );

    expect(find.text('achievements.json could not be read'), findsOneWidget);
    expect(find.text('Toolsmith'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('achievements-retry')));
    await tester.pumpAndSettle();
    expect(reloads, 1);
  });

  testWidgets('an empty reply invites a re-read', (tester) async {
    await _pump(tester, const AchievementsPage());

    expect(find.text('no achievements in this build'), findsOneWidget);
    expect(
      find.text('the core sent no catalogue; r re-reads it'),
      findsOneWidget,
    );
    expect(find.text('0 of 0 unlocked'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a read in flight says so', (tester) async {
    // The progress spinner animates forever, so this case pumps one frame
    // rather than waiting for a settled tree.
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_app(const AchievementsPage(loading: true)));
    await tester.pump();

    expect(find.text('loading achievements…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('800x600 and a narrow window do not overflow', (tester) async {
    await _pump(
      tester,
      AchievementsPage(rows: _rows, earned: 2, total: 6),
      size: const Size(800, 600),
    );
    expect(tester.takeException(), isNull);

    await _pump(
      tester,
      AchievementsPage(rows: _rows, earned: 2, total: 6),
      size: const Size(520, 700),
    );
    expect(tester.takeException(), isNull);
    // The narrow layout keeps the rows and drops only the optional labels.
    expect(find.text('Toolsmith'), findsOneWidget);
    expect(find.text('easy'), findsNothing);
  });
}
