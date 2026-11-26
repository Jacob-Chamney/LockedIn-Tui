import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

void main() {
  testWidgets('the sidebar opens Work with the registered projects', (
    tester,
  ) async {
    await pumpShell(tester);
    await expandSidebar(tester);

    await tester.tap(find.text('Work'));
    await tester.pumpAndSettle();

    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(find.text('My app'), findsOneWidget);
    expect(find.text('API service'), findsOneWidget);
    expect(find.text('WORK'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K lists Work and Enter opens the surface', (tester) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('Work'),
      ),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'work',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Alt+6 opens Work and Alt+0 keeps Settings last', (tester) async {
    await pumpShell(tester);

    await openSurface(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);

    await openSurface(tester, 0);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens the project detail and Esc returns to the list', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 6);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeProjectId, FakeCore.projectId);
    expect(find.text('PROJECT'), findsOneWidget);
    // The statusline names the project page's own keys, not just the way out.
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('status-hint'))).data,
      'c chat · i instructions · p approvals · w swarm · l activity · r refresh · Esc back',
    );
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(find.text('/home/me/Projects/my-app'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(store.activeProject, isNull);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(find.text('WORK'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('switching surfaces keeps the open project', (tester) async {
    final store = await pumpShell(tester);
    await openSurface(tester, 6);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(store.activeProjectId, FakeCore.projectId);

    await openSurface(tester, 1);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('PROJECT'), findsNothing);

    await openSurface(tester, 6);
    expect(store.activeProjectId, FakeCore.projectId);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a missing project root is one readable warning', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 6);

    // Arrow to the archived swarm whose folder is gone.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('the project folder is missing'), findsOneWidget);
    expect(find.text('missing'), findsOneWidget);
    expect(find.text('API service'), findsOneWidget);
    expect(find.text('archived'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Work and the project detail fit 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));

    await openSurface(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
