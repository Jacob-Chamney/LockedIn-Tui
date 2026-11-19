import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The second half of the pointer sweep: rows and controls that were keyboard
/// only. Each case asserts the click reaches the same handler the key does.
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

Future<void> openSurface(WidgetTester tester, int surface) async {
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  const keys = <LogicalKeyboardKey>[
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
  final index = surface == 0 ? keys.length - 1 : surface - 1;
  await tester.sendKeyEvent(keys[index]);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the model badge opens Settings', (tester) async {
    await pumpShell(tester);

    expect(find.byKey(const ValueKey('model-badge')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('model-badge')));
    await tester.pumpAndSettle();

    expect(find.text('SETTINGS'), findsWidgets);
    expect(find.text('username'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the chat link to a model opens Settings', (tester) async {
    // Unconfigured is the state that shows the link at all.
    await pumpShell(tester, core: FakeCore(configured: false));

    final link = find.byKey(const ValueKey('chat-link-model'));
    expect(link, findsOneWidget);
    await tester.tap(link);
    await tester.pumpAndSettle();

    expect(find.text('SETTINGS'), findsWidgets);
    expect(find.text('username'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
