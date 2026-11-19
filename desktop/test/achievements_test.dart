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
    task: 'Build every output for one session.',
    category: 'work',
    metric: 'outputs',
    target: 3,
    value: 3,
    progress: 3,
    unlocked: true,
    difficulty: 'medium',
  ),
  _row(
    id: 'collector',
    name: 'Collector',
    task: 'Archive ten sessions.',
    category: 'collection',
    metric: 'archived',
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

Finder _star(String id) => find.byKey(ValueKey('achievement-star-$id'));

String _hint(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const ValueKey('achievements-hint'))).data ??
    '';

void main() {
  testWidgets('the header counts and every achievement is a star', (
    tester,
  ) async {
    await _pump(tester, AchievementsPage(rows: _rows, earned: 3, total: 6));

    expect(find.text('ACHIEVEMENTS'), findsOneWidget);
    expect(find.text('3 of 6 unlocked'), findsOneWidget);
    for (final row in _rows) {
      expect(_star(row.id), findsOneWidget, reason: row.id);
    }
    // The sky names its keys, and the detail card belongs to the cursor.
    expect(_hint(tester), contains('hjkl / arrows move'));
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the detail card follows the selected star', (tester) async {
    await _pump(tester, AchievementsPage(rows: _rows, earned: 3, total: 6));

    // The first catalogue row is selected at rest.
    expect(
      find.byKey(const ValueKey('achievement-star-label-first-light')),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-detail')),
        matching: find.text('Send your first message.'),
      ),
      findsOneWidget,
    );

    await tester.tap(_star('open-book'));
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-detail')),
        matching: find.text('Create your first lock-in session.'),
      ),
      findsOneWidget,
    );
    // The award date is the core's record, shown as a chip on the detail.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('achievement-detail')),
        matching: find.textContaining('awarded 2026-11-02'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('arrows and hjkl walk the sky by compass direction', (
    tester,
  ) async {
    await _pump(tester, AchievementsPage(rows: _rows, earned: 3, total: 6));

    // The selected star is the one carrying a label under it.
    String selectedLabel() {
      const ids = [
        'first-light',
        'open-book',
        'first-steps',
        'long-march',
        'toolsmith',
        'collector',
      ];
      for (final id in ids) {
        if (find
            .byKey(ValueKey('achievement-star-label-$id'))
            .evaluate()
            .isNotEmpty) {
          return id;
        }
      }
      return '';
    }

    final start = selectedLabel();
    expect(start, isNotEmpty);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(selectedLabel(), isNotEmpty);
    expect(_hint(tester), contains('hjkl / arrows move'));

    // Every direction is live: none of them may throw, and the sky keeps exactly
    // one labelled star.
    for (final key in [
      LogicalKeyboardKey.keyJ,
      LogicalKeyboardKey.keyK,
      LogicalKeyboardKey.keyH,
      LogicalKeyboardKey.keyL,
      LogicalKeyboardKey.arrowDown,
      LogicalKeyboardKey.arrowUp,
      LogicalKeyboardKey.arrowLeft,
    ]) {
      await tester.sendKeyEvent(key);
      await tester.pumpAndSettle();
      expect(selectedLabel(), isNotEmpty);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens the detail on a narrow window, Esc returns', (
    tester,
  ) async {
    await _pump(
      tester,
      AchievementsPage(rows: _rows, earned: 3, total: 6, onBack: () {}),
      size: const Size(620, 700),
    );

    // Narrow: the sky only, then the detailed star.
    expect(find.byKey(const ValueKey('achievement-detail')), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('achievement-detail')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('achievement-detail')), findsNothing);
    expect(
      find.byKey(const ValueKey('achievement-star-first-light')),
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
        earned: 3,
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
  });

  testWidgets('a warning is a muted note, never an error', (tester) async {
    await _pump(
      tester,
      AchievementsPage(
        rows: _rows,
        earned: 3,
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
    expect(tester.widget<Text>(note).style?.color, LockedInColors.muted);
    // The sky is still complete: a warning never replaces the inventory.
    expect(_star('first-light'), findsOneWidget);
    expect(find.byKey(const ValueKey('achievements-error')), findsNothing);
  });

  testWidgets('an error keeps the sky and offers a retry', (tester) async {
    var reloads = 0;
    await _pump(
      tester,
      AchievementsPage(
        rows: _rows,
        earned: 3,
        total: 6,
        error: 'achievements.json could not be read',
        onRefresh: () => reloads += 1,
      ),
    );

    expect(find.text('achievements.json could not be read'), findsOneWidget);
    expect(_star('toolsmith'), findsOneWidget);

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
    // The spinner animates forever, so this case pumps one frame rather than
    // waiting for a settled tree.
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
      AchievementsPage(rows: _rows, earned: 3, total: 6),
      size: const Size(800, 600),
    );
    expect(tester.takeException(), isNull);
    expect(_star('toolsmith'), findsOneWidget);

    await _pump(
      tester,
      AchievementsPage(rows: _rows, earned: 3, total: 6),
      size: const Size(520, 700),
    );
    expect(tester.takeException(), isNull);
    expect(_star('first-light'), findsOneWidget);
  });
}
