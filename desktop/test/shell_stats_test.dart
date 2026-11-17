import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The same shell pump the other shell tests use, with an explicit window size.
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
];

Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(_digits[digit - 1]);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Alt+5 opens Stats and x exports through the core', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await pressAlt(tester, 5);

    expect(find.text('TOKENS'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('status-hint'))).data,
      'r range · s scope · x export',
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('export stats'), findsOneWidget);
    expect(core.statsExports, hasLength(1));
    expect(core.statsExports.single['range'], 'all');
    expect(core.statsExports.single['scope'], 'all');
    expect(core.statsExports.single['format'], 'md');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the export dialog fits 800x600', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core, size: const Size(800, 600));
    await pressAlt(tester, 5);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('export stats'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
