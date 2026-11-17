import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The same shell pump the other shell tests use, with an explicit window size
/// so the 800×600 case is a real layout pass.
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

Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(
    digit == 0 ? LogicalKeyboardKey.digit0 : _digits[digit - 1],
  );
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

/// Open Settings with `Alt+0` (the tenth surface); the sidebar collapses at
/// 800 px wide, so the shortcut is the one path that works at every size.
Future<void> openSettings(WidgetTester tester) => pressAlt(tester, 0);

int _calls(FakeCore core, String method) =>
    core.calls.where((call) => call == method).length;

void main() {
  testWidgets('opening Settings reads the Work permissions once', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit0);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();

    expect(
      core.calls.where((call) => call == 'work.permissions.get'),
      hasLength(1),
    );
    expect(find.text('WORK'), findsOneWidget);
  });

  testWidgets('opening Settings reads the decision layer once', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit0);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();

    expect(core.calls.where((call) => call == 'decision.get'), hasLength(1));
    // The group is rendered from the core's view, not a local default.
    expect(find.text('DECISION LAYER'), findsOneWidget);
    expect(find.textContaining('not shipped in this build'), findsWidgets);
  });

  testWidgets('opening Settings reads mcp.list once and renders the servers', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSettings(tester);

    expect(_calls(core, 'mcp.list'), 1);
    expect(find.text('notes'), findsOneWidget);
    expect(find.text('wiki'), findsOneWidget);
    expect(find.textContaining('read_note'), findsOneWidget);
    expect(find.textContaining('write_note (write)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r reconnects through mcp.refresh and replaces the rows', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSettings(tester);
    expect(_calls(core, 'mcp.refresh'), 0);
    expect(find.textContaining('search_notes'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(_calls(core, 'mcp.refresh'), 1);
    expect(find.textContaining('search_notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed server row shows the core message', (tester) async {
    final core = FakeCore(mcpRefreshFailure: 'connection refused');
    await pumpShell(tester, core: core);
    await openSettings(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(find.text('failed: connection refused'), findsOneWidget);
    expect(find.text('notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cycling a policy cell writes mcp.policy.set', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSettings(tester);

    // The fake stores `chill → notes = on`; one Enter cycles it to `explicit`.
    final row = find.byKey(
      const ValueKey('settings-row-mcp-policy-chill-notes'),
    );
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(core.mcpPolicySets, hasLength(1));
    expect(core.mcpPolicySets.single, {
      'command': 'chill',
      'server': 'notes',
      'value': 'explicit',
    });
    expect(tester.takeException(), isNull);
  });

  testWidgets('the plugins section fits 800x600', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await openSettings(tester);

    // The page heading and the status-bar scope both read SETTINGS.
    expect(find.text('SETTINGS'), findsWidgets);
    expect(find.text('notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
