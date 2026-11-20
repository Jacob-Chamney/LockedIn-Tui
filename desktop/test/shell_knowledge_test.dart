import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/shell/leader.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

Future<void> search(WidgetTester tester, String text) async {
  await tester.enterText(find.byKey(const ValueKey('knowledge-search')), text);
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Space n opens Knowledge and reads the tree once on entry', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    expect(callsTo(core, 'knowledge.tree'), 0, reason: 'not a boot read');

    await openSurface(tester, 9);

    expect(find.text('KNOWLEDGE'), findsWidgets);
    expect(find.text('PHYSICS'), findsOneWidget);
    expect(find.text('ASSEMBLY'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);
    expect(find.text('Registers and stack frames'), findsOneWidget);
    expect(callsTo(core, 'knowledge.tree'), 1);
    expect(core.knowledgeScopes, ['all']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sidebar and the palette both reach Knowledge', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await expandSidebar(tester);

    expect(find.text('Knowledge'), findsWidgets);
    // The sidebar keeps the chord in the row's tooltip rather than beside the
    // label, where it read as a count.
    expect(find.byTooltip('Space n · Knowledge'), findsOneWidget);
    // Settings is `Space ,` — the terminal app's chord, not a digit.
    expect(find.byTooltip('Space , · Settings'), findsOneWidget);

    await pressCtrlK(tester);
    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('Knowledge'),
      ),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'knowl',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('KNOWLEDGE'), findsWidgets);
    expect(find.text('Entropy and the second law'), findsOneWidget);
  });

  testWidgets('the leader overlay shows Space , for Settings', (tester) async {
    await pumpShell(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    expect(find.byType(LeaderOverlay), findsOneWidget);
    expect(find.text('Space n'), findsOneWidget);
    expect(find.text('Space ,'), findsOneWidget);
  });

  testWidgets('typing searches once with kind, side and history labels', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    await search(tester, 'boundary');

    expect(core.knowledgeQueries, ['boundary']);
    expect(core.knowledgeScopes, ['all', 'all']);
    expect(find.text('2 hits · scope all'), findsOneWidget);
    expect(find.text('SOURCE'), findsOneWidget);
    expect(find.text('MEMORY'), findsOneWidget);
    expect(find.text('school'), findsWidgets);
    // Both rows are history: memory and the source excerpt it came from.
    expect(
      find.byKey(
        const ValueKey(
          'knowledge-history-source:2026-11-01-0900-physics-unit-4:'
          'lecture-4.md',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'knowledge-history-memory:2026-11-01-0900-physics-unit-4',
        ),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty result says so instead of showing a blank list', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    await search(tester, 'zzzz');

    expect(core.knowledgeQueries, ['zzzz']);
    expect(find.byKey(const ValueKey('knowledge-no-hits')), findsOneWidget);
    expect(find.text('no matches for “zzzz”'), findsOneWidget);
    expect(
      find.text('try another word · Esc to browse the tree'),
      findsOneWidget,
    );
  });

  testWidgets('Esc clears the query first, then goes home to Chat', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 9);
    await search(tester, 'boundary');
    expect(find.text('PHYSICS'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('PHYSICS'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(find.text('PHYSICS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed tree read shows one message and retries', (
    tester,
  ) async {
    final core = FakeCore(knowledgeFailure: 'the vault could not be read');
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    expect(find.text('the vault could not be read'), findsOneWidget);
    expect(find.byKey(const ValueKey('knowledge-empty')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('knowledge-retry')));
    await tester.pumpAndSettle();
    expect(callsTo(core, 'knowledge.tree'), 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on a hit opens it in the reader', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 9);
    await search(tester, 'boundary');

    // The platform's search action applies the word and returns the keyboard
    // to the list; the next Enter acts on the selected hit.
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    // The reader layer replaces the list and shows the item's own body.
    expect(find.textContaining('Boundary conditions'), findsWidgets);
    expect(find.text('opens in the reader later'), findsNothing);
  });

  testWidgets('the Knowledge surface fits 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await openSurface(tester, 9);

    expect(find.text('KNOWLEDGE'), findsWidgets);
    expect(find.text('Entropy and the second law'), findsOneWidget);
    expect(find.byKey(const ValueKey('knowledge-search')), findsOneWidget);
    // The scope control is part of the surface, not a wide-window extra.
    expect(find.byKey(const ValueKey('knowledge-scope-chips')), findsOneWidget);
    expect(find.byKey(const ValueKey('knowledge-scope-work')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('s changes the scope and re-runs the search with it', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 9);
    await search(tester, 'boundary');
    // The platform's search action hands the keyboard back to the list, so `s`
    // is the scope key rather than a character typed into the field.
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('2 hits · scope all'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();

    expect(store.knowledgeScope, 'school');
    expect(core.knowledgeScopes.last, 'school');
    expect(find.text('SCOPE'), findsOneWidget);
    expect(find.text('2 hits · scope school'), findsOneWidget);
    // The selected chip is marked with a check, so colour is not the only cue.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('knowledge-scope-school')),
        matching: find.byIcon(Icons.check),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the scope chips are a second path to the same projection', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    await tester.tap(find.byKey(const ValueKey('knowledge-scope-skills')));
    await tester.pumpAndSettle();

    expect(store.knowledgeScope, 'skills');
    expect(core.knowledgeScopes.last, 'skills');
    // The tree read is scoped: only the skills side is left.
    expect(find.text('ASSEMBLY'), findsOneWidget);
    expect(find.text('PHYSICS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a work scope reads the tree with all and explains it', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 9);
    expect(core.knowledgeScopes, ['all']);

    for (var press = 0; press < 3; press++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
    }

    expect(store.knowledgeScope, 'work');
    // The tree only accepts all|school|skills, so the `work` scope sends `all`.
    expect(core.knowledgeScopes, ['all', 'school', 'skills', 'all']);
    expect(find.byKey(const ValueKey('knowledge-work-note')), findsOneWidget);
    expect(
      find.text(
        'the tree covers school and skills; work items appear in search',
      ),
      findsOneWidget,
    );
    // Both vaults are still listed, because that is what the tree covers.
    expect(find.text('PHYSICS'), findsOneWidget);
    expect(find.text('ASSEMBLY'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the scope survives a surface switch', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 9);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();
    expect(store.knowledgeScope, 'school');

    await openSurface(tester, 1);
    await openSurface(tester, 9);

    expect(store.knowledgeScope, 'school');
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('knowledge-scope-school')),
        matching: find.byIcon(Icons.check),
      ),
      findsOneWidget,
    );
    expect(find.textContaining('scope school'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('[ and ] walk the search hits inside the reader', (tester) async {
    final store = await pumpShell(tester, core: FakeCore());
    await openSurface(tester, 9);
    await search(tester, 'boundary');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.knowledgeHitOrder, hasLength(2));
    expect(find.text('1 of 2'), findsOneWidget);
    expect(
      find.text('copied source · content, not a new citation'),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    expect(find.text('2 of 2'), findsOneWidget);
    expect(find.text('session memory · history, not a source'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    expect(find.text('last hit'), findsOneWidget);
    expect(find.text('2 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketLeft);
    await tester.pumpAndSettle();
    expect(find.text('1 of 2'), findsOneWidget);
    expect(
      find.text('copied source · content, not a new citation'),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketLeft);
    await tester.pumpAndSettle();
    expect(find.text('first hit'), findsOneWidget);
    expect(find.text('1 of 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
