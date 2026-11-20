import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _skills = <SkillRow>[
  SkillRow(
    id: 'disassembly-basics-3f9a1c',
    name: 'Read disassembly output',
    stageDone: 2,
    stageTotal: 4,
    chaptersDone: 1,
    chaptersTotal: 3,
    lastOpened: '2026-11-15T08:30:00Z',
    chats: 2,
    archived: false,
  ),
  SkillRow(
    id: 'rust-ownership-9c2d4e',
    name: 'Rust ownership',
    stageDone: 0,
    stageTotal: 0,
    lastOpened: '',
    chats: 0,
    archived: true,
    broken: 'meta.json could not be read',
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
  SkillChapter(
    id: 'ch-3',
    title: 'Control flow',
    guide: '03-control-flow.md',
    practical: '03-control-flow-practical.md',
    done: false,
  ),
];

const _chats = <SkillChatRow>[
  SkillChatRow(
    id: 'chat-1',
    title: 'Where do I start?',
    lastUsed: '2026-11-01T09:05:06Z',
    messages: 2,
  ),
  SkillChatRow(
    id: 'chat-2',
    title: 'What is a stack frame?',
    lastUsed: '2026-11-02T10:00:00Z',
    messages: 4,
  ),
];

const _detail = SkillDetail(
  id: 'disassembly-basics-3f9a1c',
  name: 'Read disassembly output',
  goal: 'Read disassembly output confidently',
  prior: 'I know a little C',
  created: '2026-11-01T09:00:00Z',
  plan: 'model',
  chapters: _chapters,
  chats: _chats,
);

const _lesson = SkillChapterBody(
  text: '# Lesson: Getting started\n\nRead the lesson for this chapter.',
  practical: false,
  chapterId: 'ch-1',
  chapterTitle: 'Getting started',
);

Future<void> pumpSkillPage(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(900, 700),
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

void main() {
  testWidgets('the list renders goals, progress, chats and badges', (
    tester,
  ) async {
    await pumpSkillPage(
      tester,
      const SkillsPage(skills: _skills, loading: false),
    );

    expect(find.text('SKILLS'), findsOneWidget);
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('Rust ownership'), findsOneWidget);
    expect(find.text('2/4 stages'), findsOneWidget);
    expect(find.text('no stages'), findsOneWidget);
    expect(find.text('1/3 chapters'), findsOneWidget);
    expect(find.text('2 chats'), findsOneWidget);
    expect(find.text('no chats'), findsOneWidget);
    expect(find.text('opened 2026-11-15'), findsOneWidget);
    expect(find.text('never opened'), findsOneWidget);
    expect(find.text('archived'), findsOneWidget);
    expect(find.text('meta.json could not be read'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the empty list teaches the next action', (tester) async {
    await pumpSkillPage(
      tester,
      const SkillsPage(skills: <SkillRow>[], loading: false),
    );

    expect(find.text('no skills yet'), findsOneWidget);
    expect(find.text('n starts a goal'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('loading and error states are stated, not blank', (tester) async {
    await pumpSkillPage(
      tester,
      const SkillsPage(skills: <SkillRow>[], loading: true),
    );
    expect(find.text('loading skills…'), findsOneWidget);

    var retries = 0;
    await pumpSkillPage(
      tester,
      SkillsPage(
        skills: const <SkillRow>[],
        loading: false,
        error: 'could not read the skills folder',
        onRefresh: () => retries++,
      ),
    );
    expect(find.text('could not read the skills folder'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens the selected goal and n names the blocked wizard', (
    tester,
  ) async {
    final opened = <String>[];
    await pumpSkillPage(
      tester,
      SkillsPage(
        skills: _skills,
        loading: false,
        onOpen: (row) => opened.add(row.id),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(opened, ['disassembly-basics-3f9a1c']);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(opened, ['disassembly-basics-3f9a1c', 'rust-ownership-9c2d4e']);

    // `n` is a placeholder until the wizard packet lands: it explains itself.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pump();
    expect(
      find.textContaining('this build cannot open the goal wizard'),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(
      find.textContaining(
        'this build cannot open the goal wizard a later packet',
      ),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the detail shows the goal, the course and the saved chats', (
    tester,
  ) async {
    await pumpSkillPage(tester, const SkillDetailView(detail: _detail));

    expect(find.text('GOAL'), findsOneWidget);
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(find.text('I know a little C'), findsOneWidget);
    expect(find.text('plan · model'), findsOneWidget);
    expect(find.text('COURSE'), findsOneWidget);
    expect(find.text('Getting started'), findsOneWidget);
    expect(find.text('Registers and memory'), findsOneWidget);
    expect(find.text('1/3 chapters'), findsOneWidget);
    expect(find.text('practical'), findsNWidgets(2));
    expect(find.text('CHATS'), findsOneWidget);
    expect(find.text('Where do I start?'), findsOneWidget);
    expect(find.text('2 messages'), findsOneWidget);
    expect(find.text('4 messages'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens a lesson and p opens the practical', (tester) async {
    final opened = <(String, bool)>[];
    await pumpSkillPage(
      tester,
      SkillDetailView(
        detail: _detail,
        onOpenChapter: (id, {practical = false}) => opened.add((id, practical)),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(opened, [('ch-1', false)]);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(opened, [('ch-1', false), ('ch-2', false)]);

    // The second chapter has no exercise: `p` explains instead of opening one.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.pump();
    expect(find.text('this chapter has no practical'), findsOneWidget);
    expect(opened.length, 2);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.pump();
    expect(opened.last, ('ch-1', true));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the chapter reader renders the Markdown and Esc goes back', (
    tester,
  ) async {
    var closed = 0;
    await pumpSkillPage(
      tester,
      SkillDetailView(
        detail: _detail,
        chapterOpen: true,
        chapter: _lesson,
        onCloseChapter: () => closed++,
      ),
    );

    expect(find.text('Getting started'), findsOneWidget);
    expect(find.text('lesson'), findsOneWidget);
    expect(
      find.textContaining(
        'Read the lesson for this chapter',
        findRichText: true,
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(closed, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the reader states loading and a failed read', (tester) async {
    await pumpSkillPage(
      tester,
      const SkillDetailView(
        detail: _detail,
        chapterOpen: true,
        chapterLoading: true,
      ),
    );
    expect(find.text('loading chapter…'), findsOneWidget);

    var retries = 0;
    await pumpSkillPage(
      tester,
      SkillDetailView(
        detail: _detail,
        chapterOpen: true,
        chapterError: 'the lesson file could not be read',
        onRetryChapter: () => retries++,
      ),
    );
    expect(find.text('could not read this chapter'), findsOneWidget);
    expect(find.text('the lesson file could not be read'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('skill-chapter-retry')));
    await tester.pump();
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the list and the detail fit 800x600', (tester) async {
    await pumpSkillPage(
      tester,
      const SkillsPage(skills: _skills, loading: false),
      size: const Size(800, 600),
    );
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await pumpSkillPage(
      tester,
      const SkillDetailView(detail: _detail),
      size: const Size(800, 600),
    );
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
