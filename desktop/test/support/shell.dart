import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';

import '../fake_core.dart';

/// The shell test harness: boot the app against a fake core, and move between
/// surfaces the way a person does.
///
/// Thirty-two test files carried a byte-identical copy of each helper. They
/// drifted once already — the `size` parameter existed in some copies and not
/// others — so the shell suite shares one copy.

/// Start the shell against a fake core, at a chosen window size.
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

/// Open one shell surface by its ordinal (0 = Chat … 9 = Settings), using the
/// leader the registry actually binds.
Future<void> openSurface(WidgetTester tester, int surface) async {
  // Leave INSERT first: the leader is a NORMAL-mode chord, exactly as in the
  // terminal app, and the chat composer holds the keyboard on first paint. The
  // status bar is the shell's own answer for the mode, so this never presses
  // Esc on a page that would treat it as "back".
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals list, so the suite uses `\` throughout.
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

Future<void> pressCtrlK(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

Future<void> expandSidebar(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await tester.pumpAndSettle();
}

/// How many times one protocol method was called on the fake core.
int callsTo(FakeCore core, String method) =>
    core.calls.where((call) => call == method).length;
