import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/features/skills/skill_lesson.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _stages = <SkillStage>[
  SkillStage(
    id: 'stage-1',
    title: 'Registers and memory',
    status: 'active',
    milestone: 'Explain a stack frame',
  ),
  SkillStage(id: 'stage-2', title: 'Control flow', status: 'pending'),
  SkillStage(
    id: 'stage-3',
    title: 'Calling conventions',
    status: 'done',
    milestone: 'Trace a call across frames',
  ),
];

const _chapters = <SkillChapter>[
  SkillChapter(
    id: 'ch-1',
    title: 'Getting started',
    guide: '01-getting-started.md',
    practical: '01-getting-started-practical.md',
    done: true,
  ),
  SkillChapter(
    id: 'ch-2',
    title: 'Registers and memory',
    guide: '02-registers.md',
    practical: '',
    done: false,
  ),
];

const _curriculum = SkillDetail(
  id: 'stack-frames-7b1c9d',
  name: 'Stack frames',
  goal: 'Trace stack frames in a debugger',
  prior: '',
  created: '2026-11-10T09:00:00Z',
  plan: 'template',
  chapters: <SkillChapter>[],
  chats: <SkillChatRow>[],
  stages: _stages,
);

const _course = SkillDetail(
  id: 'disassembly-basics-3f9a1c',
  name: 'Read disassembly output',
  goal: 'Read disassembly output confidently',
  prior: 'I know a little C',
  created: '2026-11-01T09:00:00Z',
  plan: 'model',
  chapters: _chapters,
  chats: <SkillChatRow>[],
);

const _citations = <SkillCitation>[
  (
    name: 'lecture-4.md',
    location: 'sources/sha256-a1b2-lecture-4.md',
    excerpt: 'Boundary conditions set the limits.',
  ),
];

Future<void> pumpSkillPage(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1000, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pump();
}

Future<CoreStore> pumpShell(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

void _noop() {}

/// The leader key per surface ordinal (1 = Chat … 0 = Settings), matching the
/// terminal app's grammar: `Space c`, `Space h`, `Space g`, `Space s`, `Space t`,
/// `Space p`, `Space v`, `Space f`, `Space n`, `Space ,`.
const _surfaceLeaderKeys = <LogicalKeyboardKey>[
  LogicalKeyboardKey.keyC,
  LogicalKeyboardKey.keyH,
  LogicalKeyboardKey.keyG,
  LogicalKeyboardKey.keyS,
  LogicalKeyboardKey.keyT,
  LogicalKeyboardKey.keyP,
  LogicalKeyboardKey.keyV,
  LogicalKeyboardKey.keyF,
  LogicalKeyboardKey.keyN,
  LogicalKeyboardKey.comma,
];

/// Open a surface the way the terminal app does: `Space`, then the leader key.
Future<void> openSurface(WidgetTester tester, int surface) async {
  // Leave INSERT first: the leader is a NORMAL-mode chord, exactly as in the
  // terminal app, and the chat composer holds the keyboard on first paint. The
  // status bar is the shell's own answer for the mode, so this never presses
  // Esc on a page that would treat it as "back".
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals view, and navigation must work from all of them.
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  // `0` is the tenth surface (Settings), as in the terminal app.
  final index = surface == 0 ? _surfaceLeaderKeys.length - 1 : surface - 1;
  await tester.sendKeyEvent(_surfaceLeaderKeys[index]);
  await tester.pumpAndSettle();
}

/// Open the seeded curriculum goal: Skills, two rows down, Enter.
Future<CoreStore> openCurriculum(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  final store = await pumpShell(tester, core: core, size: size);
  await openSurface(tester, 3);
  await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
  return store;
}

void main() {
  group('SkillDetailView curriculum stages', () {
    testWidgets('renders stages with status, milestone and no empty course', (
      tester,
    ) async {
      await pumpSkillPage(tester, const SkillDetailView(detail: _curriculum));

      expect(find.text('CURRICULUM STAGES'), findsOneWidget);
      expect(find.text('Registers and memory'), findsOneWidget);
      expect(find.text('Control flow'), findsOneWidget);
      expect(find.text('Calling conventions'), findsOneWidget);
      expect(find.text('1/3 stages'), findsOneWidget);
      expect(find.text('active'), findsOneWidget);
      expect(find.text('pending'), findsOneWidget);
      expect(find.text('done'), findsOneWidget);
      expect(find.text('Explain a stack frame'), findsOneWidget);
      expect(find.text('Trace a call across frames'), findsOneWidget);
      // A curriculum keeps one index: no competing chapter card.
      expect(find.text('COURSE'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('j/k moves the stage and Enter or l opens its lesson', (
      tester,
    ) async {
      final opened = <String>[];
      await pumpSkillPage(
        tester,
        SkillDetailView(
          detail: _curriculum,
          onOpenStage: opened.add,
          onBuildStage: (_) {},
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(opened, ['stage-1']);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(opened, ['stage-1', 'stage-2']);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
      await tester.pump();
      expect(opened, ['stage-1', 'stage-2', 'stage-2']);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
      await tester.pump();
      expect(opened.last, 'stage-1');
      expect(tester.takeException(), isNull);
    });

    testWidgets('b builds the selected stage', (tester) async {
      final built = <String>[];
      await pumpSkillPage(
        tester,
        SkillDetailView(
          detail: _curriculum,
          onOpenStage: (_) {},
          onBuildStage: built.add,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
      await tester.pump();
      expect(built, ['stage-1']);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
      await tester.pump();
      expect(built, ['stage-1', 'stage-2']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a course with no stages keeps the chapter keys', (
      tester,
    ) async {
      final chapters = <(String, bool)>[];
      final stages = <String>[];
      await pumpSkillPage(
        tester,
        SkillDetailView(
          detail: _course,
          onOpenChapter: (id, {practical = false}) {
            chapters.add((id, practical));
          },
          onOpenStage: stages.add,
        ),
      );

      expect(find.text('COURSE'), findsOneWidget);
      expect(find.text('CURRICULUM STAGES'), findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(chapters, [('ch-1', false)]);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pump();
      expect(chapters.last, ('ch-1', true));
      expect(stages, isEmpty);
      expect(tester.takeException(), isNull);
    });
  });

  group('SkillLessonView', () {
    testWidgets('renders a lesson and its labelled citations', (tester) async {
      await pumpSkillPage(
        tester,
        const SkillLessonView(
          stageId: 'stage-2',
          stageTitle: 'Control flow',
          stageStatus: 'pending',
          goalName: 'Stack frames',
          markdown: '# Lesson: Control flow\n\nTrace the loop with the frame pointer.',
          exists: true,
          status: 'draft',
          citations: _citations,
          onBuild: _noop,
          onRebuild: _noop,
        ),
      );

      expect(find.text('Control flow'), findsOneWidget);
      expect(
        find.textContaining('lesson · draft', findRichText: true),
        findsOneWidget,
      );
      expect(
        find.textContaining(
          'Trace the loop with the frame pointer',
          findRichText: true,
        ),
        findsOneWidget,
      );
      expect(find.text('SOURCE CITATIONS'), findsOneWidget);
      expect(find.text('lecture-4.md'), findsOneWidget);
      expect(find.text('Boundary conditions set the limits.'), findsOneWidget);
      // The action labels are reachable without a mouse.
      expect(find.text('b build'), findsOneWidget);
      expect(find.text('R rebuild'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a missing lesson states it and offers the build', (
      tester,
    ) async {
      var builds = 0;
      await pumpSkillPage(
        tester,
        SkillLessonView(
          stageId: 'stage-1',
          stageTitle: 'Registers and memory',
          markdown: '',
          exists: false,
          citations: const <SkillCitation>[],
          onBuild: () => builds++,
        ),
      );

      expect(find.text('no lesson for this stage yet'), findsOneWidget);
      expect(
        find.textContaining('agent explanation', findRichText: true),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('skill-lesson-build')));
      await tester.pump();
      expect(builds, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('b builds and R rebuilds; Esc goes back', (tester) async {
      var builds = 0;
      var rebuilds = 0;
      var backs = 0;
      await pumpSkillPage(
        tester,
        SkillLessonView(
          stageId: 'stage-2',
          stageTitle: 'Control flow',
          markdown: '# Lesson: Control flow',
          exists: true,
          citations: const <SkillCitation>[],
          onBuild: () => builds++,
          onRebuild: () => rebuilds++,
          onBack: () => backs++,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
      await tester.pump();
      expect(builds, 1);

      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pump();
      expect(rebuilds, 1);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();
      expect(backs, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the ready confirm is the core message, with no silent build', (
      tester,
    ) async {
      const confirm =
          'the lesson for "Calling conventions" is ready; rebuilding it '
          'replaces that work';
      var retries = 0;
      await pumpSkillPage(
        tester,
        SkillLessonView(
          stageId: 'stage-3',
          stageTitle: 'Calling conventions',
          markdown: '# Lesson: Calling conventions',
          exists: true,
          status: 'ready',
          citations: const <SkillCitation>[],
          error: confirm,
          onRetry: () => retries++,
        ),
      );

      expect(find.text('could not build or read this lesson'), findsOneWidget);
      expect(find.text(confirm), findsOneWidget);
      expect(find.textContaining('is ready; rebuilding'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('skill-lesson-retry')));
      await tester.pump();
      expect(retries, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('loading and a failed read are stated', (tester) async {
      await pumpSkillPage(
        tester,
        const SkillLessonView(
          stageId: 'stage-2',
          stageTitle: 'Control flow',
          markdown: '',
          exists: false,
          citations: <SkillCitation>[],
          loading: true,
        ),
      );
      expect(find.text('loading lesson…'), findsOneWidget);

      await pumpSkillPage(
        tester,
        const SkillLessonView(
          stageId: 'stage-2',
          stageTitle: 'Control flow',
          markdown: '',
          exists: false,
          citations: <SkillCitation>[],
          error: 'the lesson file could not be read',
        ),
      );
      expect(find.text('could not build or read this lesson'), findsOneWidget);
      expect(find.text('the lesson file could not be read'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the detail and the lesson fit 800x600', (tester) async {
      await pumpSkillPage(
        tester,
        const SkillDetailView(detail: _curriculum),
        size: const Size(800, 600),
      );
      expect(find.text('CURRICULUM STAGES'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await pumpSkillPage(
        tester,
        const SkillLessonView(
          stageId: 'stage-2',
          stageTitle: 'Control flow',
          markdown: '# Lesson: Control flow\n\nTrace one loop.',
          exists: true,
          citations: _citations,
        ),
        size: const Size(800, 600),
      );
      expect(find.text('Control flow'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore staged lessons', () {
    test('openSkill parses the curriculum stages', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.openSkill(FakeCore.stagedSkillId);

      expect(core.calls, contains('skill.open'));
      expect(store.activeSkill?.hasStages, isTrue);
      expect(store.activeSkill?.stages, hasLength(3));
      expect(
        store.activeSkill?.stages.first.milestone,
        'Explain a stack frame',
      );
      expect(store.activeSkill?.stages[1].milestone, isNull);
      expect(store.activeSkill?.stages.last.status, 'done');
      expect(store.activeSkill?.chapters, isEmpty);
    });

    test(
      'a read reports an existing lesson and a missing one as success',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openSkill(FakeCore.stagedSkillId);

        final pending = store.openSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.existingLessonStageId,
        );
        expect(store.skillLessonLoading, isTrue);
        expect(store.skillLessonOpen, isTrue);
        expect(store.activeSkillStageId, FakeCore.existingLessonStageId);
        await pending;

        expect(store.skillLessonLoading, isFalse);
        expect(store.skillLessonExists, isTrue);
        expect(store.skillLessonMarkdown, contains('Trace the loop'));
        expect(store.skillLessonError, isNull);

        await store.openSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.missingLessonStageId,
        );
        expect(store.skillLessonExists, isFalse);
        expect(store.skillLessonMarkdown, isEmpty);
        expect(store.skillLessonError, isNull);
        expect(
          core.calls.where((call) => call == 'skill.lesson.read'),
          hasLength(2),
        );
      },
    );

    test(
      'b builds a draft with citations and replaces the reader copy',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openSkill(FakeCore.stagedSkillId);
        await store.openSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.missingLessonStageId,
        );

        await store.buildSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.missingLessonStageId,
        );

        expect(core.calls, contains('skill.lesson.build'));
        expect(store.skillLessonExists, isTrue);
        expect(store.skillLessonStatus, 'draft');
        expect(store.skillLessonMarkdown, contains('Built draft'));
        expect(store.skillLessonCitations.single.name, 'lecture-4.md');
        expect(store.skillLessonError, isNull);

        // The fake writes what it built, so a re-read agrees with the reply.
        await store.openSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.missingLessonStageId,
        );
        expect(store.skillLessonMarkdown, contains('Built draft'));
      },
    );

    test(
      'a ready lesson answers with a typed confirm and keeps its work',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openSkill(FakeCore.stagedSkillId);
        await store.openSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.readyLessonStageId,
        );
        final before = store.skillLessonMarkdown;

        await store.buildSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.readyLessonStageId,
        );

        expect(store.skillLessonError, contains('is ready; rebuilding'));
        expect(store.skillLessonMarkdown, before);
        expect(store.skillLessonStatus, isEmpty);
      },
    );

    test(
      'a build failure is one message and keeps the previous lesson',
      () async {
        final core = FakeCore(
          skillLessonBuildFailure: 'the lesson build was refused',
        );
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openSkill(FakeCore.stagedSkillId);
        await store.openSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.existingLessonStageId,
        );
        final before = store.skillLessonMarkdown;

        await store.buildSkillLesson(
          FakeCore.stagedSkillId,
          FakeCore.existingLessonStageId,
        );

        expect(store.skillLessonError, 'the lesson build was refused');
        expect(store.skillLessonMarkdown, before);
        expect(store.skillLessonLoading, isFalse);
      },
    );

    test('a read failure is one message with a retry', () async {
      final core = FakeCore(
        skillLessonFailure: 'the lesson file could not be read',
      );
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.stagedSkillId);

      await store.openSkillLesson(
        FakeCore.stagedSkillId,
        FakeCore.existingLessonStageId,
      );

      expect(store.skillLessonError, 'the lesson file could not be read');
      expect(store.skillLessonExists, isFalse);
      expect(store.activeSkillStageId, FakeCore.existingLessonStageId);

      await store.retrySkillLesson();
      expect(
        core.calls.where((call) => call == 'skill.lesson.read'),
        hasLength(2),
      );
    });

    test('a newer stage supersedes an older answer', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.stagedSkillId);

      final first = store.openSkillLesson(
        FakeCore.stagedSkillId,
        FakeCore.existingLessonStageId,
      );
      final second = store.openSkillLesson(
        FakeCore.stagedSkillId,
        FakeCore.missingLessonStageId,
      );
      await Future.wait([first, second]);

      expect(store.activeSkillStageId, FakeCore.missingLessonStageId);
      expect(store.skillLessonExists, isFalse);
      expect(store.skillLessonMarkdown, isEmpty);
    });

    test('closing a lesson and leaving the goal clear the slice', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.stagedSkillId);
      await store.openSkillLesson(
        FakeCore.stagedSkillId,
        FakeCore.existingLessonStageId,
      );

      store.closeSkillLesson();

      expect(store.skillLessonOpen, isFalse);
      expect(store.activeSkillStageId, isNull);
      expect(store.skillLessonMarkdown, isEmpty);

      await store.openSkillLesson(
        FakeCore.stagedSkillId,
        FakeCore.existingLessonStageId,
      );
      store.closeSkill();
      expect(store.skillLessonOpen, isFalse);
      expect(store.skillLessonMarkdown, isEmpty);
      expect(store.skillLessonCitations, isEmpty);
    });
  });

  group('Shell staged lessons', () {
    testWidgets('Enter reads a stage lesson and Esc returns to the goal', (
      tester,
    ) async {
      final store = await openCurriculum(tester);

      expect(store.activeSkillId, FakeCore.stagedSkillId);
      expect(find.text('SKILL'), findsOneWidget);
      expect(find.text('CURRICULUM STAGES'), findsOneWidget);

      // Stage 0 has no lesson: the reader opens on its empty state.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(store.activeSkillStageId, FakeCore.missingLessonStageId);
      expect(find.text('SKILL LESSON'), findsOneWidget);
      expect(find.text('no lesson for this stage yet'), findsOneWidget);
      expect(find.byKey(const ValueKey('skill-lesson-build')), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(store.skillLessonOpen, isFalse);
      expect(find.text('SKILL'), findsOneWidget);
      expect(find.text('CURRICULUM STAGES'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('b builds the selected stage and the reader renders it', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await openCurriculum(tester, core: core);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
      await tester.pumpAndSettle();

      expect(core.calls, contains('skill.lesson.build'));
      expect(store.skillLessonStatus, 'draft');
      expect(find.text('SKILL LESSON'), findsOneWidget);
      expect(
        find.textContaining('Built draft', findRichText: true),
        findsOneWidget,
      );
      expect(find.text('SOURCE CITATIONS'), findsOneWidget);
      expect(find.text('lecture-4.md'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('reading an existing lesson shows its Markdown and citations', (
      tester,
    ) async {
      await openCurriculum(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Trace the loop', findRichText: true),
        findsOneWidget,
      );
      expect(find.text('SKILL LESSON'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('rebuilding a ready lesson shows the core confirm message', (
      tester,
    ) async {
      final store = await openCurriculum(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(store.activeSkillStageId, FakeCore.readyLessonStageId);

      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pumpAndSettle();

      expect(find.text('could not build or read this lesson'), findsOneWidget);
      expect(find.textContaining('is ready; rebuilding'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('leaving Skills collapses the lesson and keeps the goal', (
      tester,
    ) async {
      final store = await openCurriculum(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(store.skillLessonOpen, isTrue);

      await openSurface(tester, 1);
      expect(store.skillLessonOpen, isFalse);
      expect(find.text('SKILL LESSON'), findsNothing);

      await openSurface(tester, 3);
      expect(find.text('SKILL'), findsOneWidget);
      expect(find.text('CURRICULUM STAGES'), findsOneWidget);
      expect(store.activeSkillId, FakeCore.stagedSkillId);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the staged goal and lesson fit 800x600', (tester) async {
      final store = await openCurriculum(tester, size: const Size(800, 600));

      expect(find.text('CURRICULUM STAGES'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(store.skillLessonOpen, isTrue);
      expect(find.text('SKILL LESSON'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
