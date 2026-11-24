import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

Finder inPalette(String text) =>
    find.descendant(of: find.byType(CommandPalette), matching: find.text(text));

void main() {
  testWidgets('the shell wires the curriculum editor and goal actions', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await store.openSkill(FakeCore.skillId);
    await tester.pumpAndSettle();
    await openSurface(tester, 3);
    await tester.pumpAndSettle();

    final detail = tester.widget<SkillDetailView>(find.byType(SkillDetailView));
    expect(detail.onSaveStages, isNotNull);

    // Back to the list: the manager's confirmations are offered.
    store.closeSkill();
    await tester.pumpAndSettle();
    final list = tester.widget<SkillsPage>(find.byType(SkillsPage));
    expect(list.onArchive, isNotNull);
    expect(list.onDelete, isNotNull);
    expect(list.onExport, isNotNull);
  });

  testWidgets('Alt+3 opens the Skills list with its goals', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 3);

    expect(find.text('TEACHING'), findsWidgets);
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('Rust ownership'), findsOneWidget);
    // The course row reports chapters; its stage count is not drawn.
    expect(find.text('2/4 stages'), findsNothing);
    expect(find.text('1/3 chapters'), findsOneWidget);
    expect(find.text('meta.json could not be read'), findsOneWidget);
    expect(find.text('Enter open · n new goal · Esc back'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K lists Skills and Enter opens the surface', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    expect(inPalette('Teaching'), findsOneWidget);

    // The surface is `Teaching` now; `tea` is its prefix.
    await tester.enterText(find.byKey(const ValueKey('palette-search')), 'tea');
    await tester.pumpAndSettle();
    expect(inPalette('Teaching'), findsOneWidget);
    expect(inPalette('Sessions'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the ten surfaces keep their Alt indices and Settings last', (
    tester,
  ) async {
    await pumpShell(tester);

    await openSurface(tester, 3);
    expect(find.text('Read disassembly output'), findsOneWidget);

    // Sources moved to Alt+4 behind Skills.
    await openSurface(tester, 4);
    expect(find.text('open a session first'), findsOneWidget);
    expect(find.text('Read disassembly output'), findsNothing);

    await openSurface(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);

    await openSurface(tester, 7);
    expect(find.text('Derive the energy balance'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);

    // Knowledge is the ninth surface (Alt+9); Settings is the tenth (Alt+0).
    await openSurface(tester, 9);
    expect(find.text('KNOWLEDGE'), findsWidgets);
    expect(find.text('Derive the energy balance'), findsNothing);

    await openSurface(tester, 0);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('KNOWLEDGE'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens a goal and Esc returns to the list', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 3);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeSkillId, FakeCore.skillId);
    expect(find.text('TEACHING'), findsOneWidget);
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(find.text('I know a little C'), findsOneWidget);
    expect(find.text('COURSE'), findsOneWidget);
    expect(find.text('Where do I start?'), findsOneWidget);
    // The goal page's own status scope, not the list's title.
    expect(find.text('TEACHING'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(store.activeSkill, isNull);
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('TEACHING'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the goal page shows its gathered source names', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 3);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeSkillId, FakeCore.skillId);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.text('registers-cheatsheet.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter reads a chapter and Esc returns to the goal', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 3);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeSkillChapterId, 'ch-1');
    expect(store.activeSkillChapter?.practical, isFalse);
    expect(find.text('CHAPTER'), findsOneWidget);
    expect(find.text('lesson'), findsOneWidget);
    expect(
      find.textContaining('Read the lesson for', findRichText: true),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(store.skillChapterOpen, isFalse);
    expect(find.text('TEACHING'), findsOneWidget);
    expect(find.text('COURSE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('p reads the practical of the selected chapter', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 3);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.pumpAndSettle();

    expect(store.activeSkillChapterId, 'ch-1');
    expect(store.activeSkillChapter?.practical, isTrue);
    expect(find.text('practical'), findsWidgets);
    expect(
      find.textContaining('Practical: Getting started', findRichText: true),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed chapter read is one message with a retry', (
    tester,
  ) async {
    final core = FakeCore(
      skillChapterFailure: 'the lesson file could not be read',
    );
    await pumpShell(tester, core: core);
    await openSurface(tester, 3);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('could not read this chapter'), findsOneWidget);
    expect(find.text('the lesson file could not be read'), findsOneWidget);

    final before = core.calls.where((call) => call == 'skill.chapter').length;
    await tester.tap(find.byKey(const ValueKey('skill-chapter-retry')));
    await tester.pumpAndSettle();
    final after = core.calls.where((call) => call == 'skill.chapter').length;
    expect(after, before + 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a broken goal is one readable error and keeps the list', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 3);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeSkill, isNull);
    expect(
      find.textContaining('has no readable course in this workspace'),
      findsOneWidget,
    );
    // The list is still there, with both rows and a retry.
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('Rust ownership'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('switching surfaces keeps the open goal', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 3);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(store.activeSkillId, FakeCore.skillId);

    await openSurface(tester, 1);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('COURSE'), findsNothing);

    await openSurface(tester, 3);
    expect(store.activeSkillId, FakeCore.skillId);
    expect(find.text('COURSE'), findsOneWidget);
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Skills and the goal page fit 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await openSurface(tester, 3);

    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
