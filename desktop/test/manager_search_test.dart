import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The manager pages gained a search field; this file proves both filters are a
/// projection of the rows the shell already sent, and that `/` and `Esc` behave
/// like the Sessions manager's box.
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

Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(_digits[digit - 1]);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

const _digits = [
  LogicalKeyboardKey.digit1,
  LogicalKeyboardKey.digit2,
  LogicalKeyboardKey.digit3,
  LogicalKeyboardKey.digit4,
  LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6,
];

void main() {
  testWidgets('the Skills manager filters as you type', (tester) async {
    await pumpShell(tester);
    await pressAlt(tester, 3);

    // The fake serves three goals.
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('Rust ownership'), findsOneWidget);
    expect(find.text('Stack frames'), findsOneWidget);

    // `/` focuses the box, then typing narrows the list.
    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('skills-search')), 'rust');
    await tester.pumpAndSettle();

    expect(find.text('Rust ownership'), findsOneWidget);
    expect(find.text('Read disassembly output'), findsNothing);
    expect(find.text('Stack frames'), findsNothing);
    // The header reports the filtered size against the total.
    expect(find.text('1 of 3'), findsOneWidget);

    // `Esc` clears the query before it leaves the surface.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('3'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the Work manager filters projects by name and folder', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressAlt(tester, 6);

    expect(find.text('My app'), findsOneWidget);
    expect(find.text('API service'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('work-search')), 'api');
    await tester.pumpAndSettle();

    expect(find.text('API service'), findsOneWidget);
    expect(find.text('My app'), findsNothing);
    expect(find.text('1 of 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a query that matches nothing keeps a next action', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressAlt(tester, 3);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('skills-search')),
      'nothing matches this',
    );
    await tester.pumpAndSettle();

    // The empty state names the query and the key that clears it.
    expect(
      find.textContaining('no goal matches', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Esc clears the search'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
