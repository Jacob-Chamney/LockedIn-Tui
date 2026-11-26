import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _detail = SkillDetail(
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

Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(1100, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openResearch(WidgetTester tester) async {
  await tester.ensureVisible(
    find.byKey(const ValueKey('skill-context-tab-research')),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('skill-context-tab-research')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a question and its sources start one brief', (tester) async {
    String? question;
    List<String>? urls;
    await _pump(
      tester,
      SkillDetailView(
        detail: _detail,
        onResearch: (q, u) {
          question = q;
          urls = u;
        },
      ),
    );
    await _openResearch(tester);

    await _openResearch(tester);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('research-question')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.enterText(
      find.byKey(const ValueKey('research-question')),
      'why do registers survive a call?',
    );
    await tester.enterText(
      find.byKey(const ValueKey('research-sources')),
      'https://example.org/a\nhttps://example.org/b',
    );
    await tester.ensureVisible(find.byKey(const ValueKey('research-run')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('research-run')));
    await tester.pump();

    expect(question, 'why do registers survive a call?');
    expect(urls, ['https://example.org/a', 'https://example.org/b']);
  });

  testWidgets('an empty source list is refused in place', (tester) async {
    var runs = 0;
    await _pump(
      tester,
      SkillDetailView(detail: _detail, onResearch: (_, _) => runs += 1),
    );
    await _openResearch(tester);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('research-question')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.enterText(
      find.byKey(const ValueKey('research-question')),
      'why?',
    );
    await tester.ensureVisible(find.byKey(const ValueKey('research-run')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('research-run')));
    await tester.pump();

    expect(runs, 0);
    expect(find.byKey(const ValueKey('research-notice')), findsOneWidget);
  });

  testWidgets('a saved brief opens in place and closes', (tester) async {
    String? opened;
    var closed = 0;
    await _pump(
      tester,
      SkillDetailView(
        detail: _detail,
        research: const [
          ResearchItem(
            id: '202611241000-why',
            question: 'why do registers survive?',
            created: '2026-11-24T10:00:00.000Z',
            sources: [ResearchSource(url: 'https://example.org/a', title: 'A')],
          ),
        ],
        researchOpenId: '202611241000-why',
        researchMarkdown: '---\nquestion: "why"\ncreated: "2026-11-24T10:00:00.000Z"\n---\n\n# Research\n\nA register holds state [1].',
        onOpenResearch: (id) => opened = id,
        onCloseResearch: () => closed += 1,
      ),
    );
    await _openResearch(tester);

    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('research-item-202611241000-why')),
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey('research-item-202611241000-why')),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('research-item-202611241000-why')),
    );
    await tester.pump();
    expect(opened, '202611241000-why');
    expect(find.byKey(const ValueKey('research-brief')), findsOneWidget);
    expect(find.textContaining('A register holds state'), findsOneWidget);
    // Frontmatter is not rendered as prose.
    expect(find.textContaining('created:'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('research-close')));
    await tester.pump();
    expect(closed, 1);
  });
}
