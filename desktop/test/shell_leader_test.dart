import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/shell/leader.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

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

Future<void> pressSpace(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.space);
  await tester.pumpAndSettle();
}

Future<void> pressAlt(WidgetTester tester, int digit) async {
  const digits = [
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
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(digits[digit - 1]);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

int _workspaceReads(FakeCore core) =>
    core.calls.where((call) => call == 'workspace.info').length;

void main() {
  testWidgets('Space opens the leader with the configured bindings', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressSpace(tester);

    expect(find.byType(LeaderOverlay), findsOneWidget);
    for (final group in const ['CONTEXT', 'GLOBAL', 'SYSTEM']) {
      expect(find.text(group), findsOneWidget, reason: 'missing group $group');
    }
    // The stored override, not the default: the overlay shows what runs.
    expect(find.text('Space g'), findsOneWidget);
    expect(find.text('Space r'), findsNothing);
    expect(find.text('Alt+1'), findsWidgets);
    expect(find.text('Ctrl+K'), findsOneWidget);
    expect(find.text('j/k move · Enter run · Esc close'), findsOneWidget);
  });

  testWidgets('Esc cancels the leader and leaves the surface alone', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressSpace(tester);
    expect(find.byType(LeaderOverlay), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byType(LeaderOverlay), findsNothing);
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(find.text('TOKENS'), findsNothing);
  });

  testWidgets('j/k move the leader selection and Enter runs the row', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressSpace(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();

    // chat -> sessions -> skills
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(LeaderOverlay), findsNothing);
    expect(find.text('Read disassembly output'), findsOneWidget);
  });

  testWidgets('a leader chord runs its row directly', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    final before = _workspaceReads(core);

    await pressSpace(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
    await tester.pumpAndSettle();

    expect(find.byType(LeaderOverlay), findsNothing);
    expect(_workspaceReads(core), greaterThan(before));
  });

  testWidgets('a chord with no row is not a leader key', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    final before = _workspaceReads(core);

    await pressSpace(tester);
    // `r` is the default refresh, but the fake stores `space+g`.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(find.byType(LeaderOverlay), findsOneWidget);
    expect(_workspaceReads(core), before);
  });

  testWidgets(
    'a rebound surface shortcut moves and the old key stops working',
    (tester) async {
      final store = await pumpShell(tester);

      await store.setKeybind('surface.stats', 'space+t');
      await tester.pumpAndSettle();

      await pressAlt(tester, 5);
      expect(find.text('TOKENS'), findsNothing);
      expect(find.text('Ask anything…'), findsOneWidget);

      await pressSpace(tester);
      // The sidebar row also shows the real binding now; scope the leader row.
      expect(
        find.descendant(
          of: find.byType(LeaderOverlay),
          matching: find.text('Space t'),
        ),
        findsOneWidget,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.keyT);
      await tester.pumpAndSettle();

      expect(find.byType(LeaderOverlay), findsNothing);
      expect(find.text('TOKENS'), findsOneWidget);
    },
  );

  testWidgets('Space types in a focused search field instead of opening', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressAlt(tester, 2);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    expect(find.byType(LeaderOverlay), findsNothing);
    // The field keeps the keyboard: the press was INPUT, not the leader.
    final focus = FocusManager.instance.primaryFocus?.context;
    final editing =
        focus != null &&
        (focus.widget is EditableText ||
            focus.findAncestorWidgetOfExactType<EditableText>() != null);
    expect(editing, isTrue);
  });

  testWidgets('the leader fits 800x600 without overflow', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await pressSpace(tester);

    expect(find.byType(LeaderOverlay), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The rows scroll instead of overflowing.
    await tester.drag(
      find.byKey(const ValueKey('leader-list')),
      const Offset(0, -300),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(LeaderOverlay), findsOneWidget);
  });
}
