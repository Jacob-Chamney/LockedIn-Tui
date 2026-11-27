import 'dart:io';

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/archive/archive_page.dart';
import 'package:lockedin_desktop/features/keys.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/features/settings/theme_picker.dart';
import 'package:lockedin_desktop/features/shared/cards.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/features/skills/teaching_rows.dart';
import 'package:lockedin_desktop/features/stats/stats_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The UI review's Phase A defects, each as a behaviour a person can see.
///
/// The bug class these guard is one: a page's `Focus` sits above its inline
/// fields, so a bare key typed into a field used to run the page's command. The
/// widget tests that only use `tester.enterText` cannot see it — `enterText`
/// injects text without a key event — so these tests focus the field and send a
/// real key.

const _session = SessionDetail(
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
      hash: 'sha256:0badf00d5678',
      kind: 'markdown',
    ),
  ],
  steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
);

const _skill = SkillDetail(
  id: 'read-disassembly-3f9a1c',
  name: 'Read disassembly output',
  goal: 'Read disassembly output confidently',
  prior: 'I know C',
  created: '2026-11-01T09:00:00Z',
  plan: 'template',
  chapters: <SkillChapter>[],
  chats: <SkillChatRow>[],
  stages: <SkillStage>[],
);

StatsSummary _stats() => const StatsSummary(
  range: 'all',
  scope: 'all',
  overview: StatsOverview(runs: 2, failed: 0, input: 100, output: 50),
  costMicroUsd: null,
  costLabel: 'cost unknown',
  models: [],
  tools: [],
  learning: LearningStats(steps: 0, cardsKnown: 0, cardsMissed: 0, lessons: 0),
  activity: [],
  bestStreak: 0,
  activeDays: 0,
  period: StatsPeriod(from: '2026-11-01', to: '2026-11-27'),
  diagnostic: null,
);

/// Widget tests draw in the square test font, whose glyphs are one em wide, so
/// a real font's metrics have to be loaded before a fit can be measured.
Future<void> _loadMonoFont(WidgetTester tester) async {
  final bytes = File('assets/fonts/JetBrainsMono-Regular.ttf')
      .readAsBytesSync();
  final loader = FontLoader('JetBrainsMono')
    ..addFont(Future.value(ByteData.sublistView(Uint8List.fromList(bytes))));
  await tester.runAsync(loader.load);
  // Loading a family notifies the system-font channel, which schedules a
  // relayout; flush it before the tree is disposed.
  await tester.pump();
  await tester.pump();
}

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1200, 1800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_app(child));
  await tester.pumpAndSettle();
}

void main() {
  group('inline fields own their keys', () {
    testWidgets('a letter or digit typed into the figure form is text', (
      tester,
    ) async {
      var documents = 0;
      var chats = 0;
      var backs = 0;
      await _pump(
        tester,
        SessionDetailView(
          detail: _session,
          loading: false,
          onBack: () => backs += 1,
          onOpenChat: () => chats += 1,
          onGenerateDocument: (kind, {attempt}) async => documents += 1,
          onExtractFigure: ({
            required int page,
            int? x,
            int? y,
            int? width,
            int? height,
            String caption = '',
          }) async {},
        ),
      );

      await tester.tap(find.byKey(const ValueKey('figure-page')));
      await tester.pump();
      expect(
        textInputFocused,
        isTrue,
        reason: 'the page field owns the keyboard',
      );

      // `1` started a study document, `c` opened the chat and `s` opened the
      // session settings before the guard.
      for (final key in [
        LogicalKeyboardKey.digit1,
        LogicalKeyboardKey.keyC,
        LogicalKeyboardKey.keyS,
      ]) {
        await tester.sendKeyEvent(key);
        await tester.pump();
      }
      expect(documents, 0);
      expect(chats, 0);

      // `Esc` leaves the field; the session is still on screen.
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();
      expect(textInputFocused, isFalse);
      expect(backs, 0);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a letter typed into the research question is text', (
      tester,
    ) async {
      var chats = 0;
      var measures = 0;
      await _pump(
        tester,
        SkillDetailView(
          detail: _skill,
          teaching: TeachingState.empty,
          onOpenChat: () => chats += 1,
          onMeasure: () => measures += 1,
          onResearch: (_, _) {},
        ),
      );

      await tester.ensureVisible(
        find.byKey(const ValueKey('skill-context-tab-research')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('skill-context-tab-research')),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('research-question')),
        240,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('research-question')));
      await tester.pump();
      expect(textInputFocused, isTrue);

      // `c` opened the chat and `m` started a paid measurement.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
      await tester.pump();
      expect(chats, 0);
      expect(measures, 0);
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets(
    'the active Stats filter paints the accent and a readable label',
    (tester) async {
      await _pump(tester, StatsPage(summary: _stats(), range: '30d'));

      final active = tester.widget<ValueChip>(
        find.widgetWithText(ValueChip, 'range  30d'),
      );
      expect(
        active.background,
        LockedInColors.primary,
        reason: 'the chip paints its own fill instead of a parent Material',
      );
      expect(active.tone, lockedInTheme().colorScheme.onPrimary);

      final inactive = tester.widget<ValueChip>(
        find.widgetWithText(ValueChip, '7d'),
      );
      expect(inactive.background, isNull);
      expect(inactive.tone, isNull);
    },
  );

  testWidgets('a goal that was never measured opens on measure', (
    tester,
  ) async {
    await _pump(
      tester,
      SkillDetailView(detail: _skill, teaching: TeachingState.empty),
    );

    expect(
      tester
          .widget<PhaseRow>(find.byKey(const ValueKey('teach-phase-measure')))
          .selected,
      isTrue,
      reason: 'step 1 is the phase the record is at',
    );
    expect(
      tester
          .widget<PhaseRow>(find.byKey(const ValueKey('teach-phase-teach')))
          .selected,
      isFalse,
    );
  });

  testWidgets('a measured goal opens on teach', (tester) async {
    const teaching = TeachingState(
      goal: 'Read disassembly output confidently',
      prior: '',
      held: ['Registers hold values'],
      gaps: [],
      plan: [TeachingStep(id: 'step-1', title: 'Read one instruction')],
      checks: [],
    );
    await _pump(tester, SkillDetailView(detail: _skill, teaching: teaching));

    expect(
      tester
          .widget<PhaseRow>(find.byKey(const ValueKey('teach-phase-teach')))
          .selected,
      isTrue,
    );
  });

  testWidgets('the teaching header does not repeat the title as its subtitle', (
    tester,
  ) async {
    const sameName = SkillDetail(
      id: 'read-disassembly-3f9a1c',
      name: 'Read disassembly output confidently',
      goal: 'Read disassembly output confidently',
      prior: '',
      created: '2026-11-01T09:00:00Z',
      plan: 'template',
      chapters: <SkillChapter>[],
      chats: <SkillChatRow>[],
      stages: <SkillStage>[],
    );
    await _pump(tester, SkillDetailView(detail: sameName));

    final line = tester.widget<Text>(
      find.byKey(const ValueKey('skill-goal-line')),
    );
    expect(line.data, isNot('Read disassembly output confidently'));
    expect(line.data, contains('plan'));
    expect(find.text('Open chat'), findsNothing);
  });

  testWidgets('a goal row shows the whole opened date on a wide window', (
    tester,
  ) async {
    await _loadMonoFont(tester);
    await _pump(
      tester,
      SkillsPage(
        skills: const [
          SkillRow(
            id: 'read-disassembly-3f9a1c',
            name: 'Read disassembly output confidently',
            stageDone: 0,
            stageTotal: 1,
            lastOpened: '2026-11-15T12:00:00Z',
            chats: 0,
            archived: false,
          ),
        ],
        loading: false,
      ),
      size: const Size(1400, 900),
    );

    final label = find.text('opened 2026-11-15');
    expect(label, findsOneWidget);
    final paragraph = tester.renderObject<RenderParagraph>(label);
    expect(
      paragraph.getMaxIntrinsicWidth(double.infinity),
      lessThanOrEqualTo(paragraph.size.width + 0.5),
      reason: 'the date column fits its content instead of ellipsising it',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty archive advertises no row verbs and names Teaching', (
    tester,
  ) async {
    await _pump(tester, const ArchivePage(rows: [], loading: false));

    expect(
      find.byKey(const ValueKey('archive-restore-hint')),
      findsNothing,
      reason: 'there is no row for j/k, Enter, d or r to act on',
    );
    expect(find.textContaining('Sessions or Teaching'), findsOneWidget);
    final texts = tester
        .widgetList<Text>(find.byType(Text))
        .map((text) => text.data ?? '')
        .where((data) => data.contains('`'));
    expect(texts, isEmpty, reason: 'keys are not rendered as Markdown');
  });

  testWidgets('Ctrl+J does not move the theme picker selection', (
    tester,
  ) async {
    String? chosen;
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                chosen = await showDialog<String>(
                  context: context,
                  builder: (_) => const ThemePickerDialog(current: 'lockedin'),
                );
              },
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(chosen, 'lockedin', reason: 'the modified chord was not a `j`');
  });
}
