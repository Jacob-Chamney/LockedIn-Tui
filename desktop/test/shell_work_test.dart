import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The shell pump the other shell tests use, with an explicit window size.
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

const _digits = [
  LogicalKeyboardKey.digit1,
  LogicalKeyboardKey.digit2,
  LogicalKeyboardKey.digit3,
  LogicalKeyboardKey.digit4,
  LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6,
  LogicalKeyboardKey.digit7,
  LogicalKeyboardKey.digit8,
  LogicalKeyboardKey.digit9,
];

/// One-based surface digit: the shell maps `Alt+N` to `Surface.values[N - 1]`.
Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(
    digit == 0 ? LogicalKeyboardKey.digit0 : _digits[digit - 1],
  );
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

Future<void> pressCtrlK(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the sidebar opens Work with the registered projects', (
    tester,
  ) async {
    await pumpShell(tester);

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

    await pressAlt(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);

    await pressAlt(tester, 0);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter opens the project detail and Esc returns to the list', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await pressAlt(tester, 6);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(store.activeProjectId, FakeCore.projectId);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Esc back'), findsOneWidget);
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
    await pressAlt(tester, 6);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(store.activeProjectId, FakeCore.projectId);

    await pressAlt(tester, 1);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('PROJECT'), findsNothing);

    await pressAlt(tester, 6);
    expect(store.activeProjectId, FakeCore.projectId);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(find.text('WORK PROJECTS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a missing project root is one readable warning', (tester) async {
    await pumpShell(tester);
    await pressAlt(tester, 6);

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

    await pressAlt(tester, 6);
    expect(find.text('WORK PROJECTS'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
