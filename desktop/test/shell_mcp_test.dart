import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// Open Settings with `Alt+0` (the tenth surface); the sidebar collapses at
/// 800 px wide, so the shortcut is the one path that works at every size.
Future<void> openSettings(WidgetTester tester) => openSurface(tester, 0);

/// Put the cursor on the PLUGINS group: `r` reconnects the servers only from
/// the plugin rows, so it cannot spawn child processes from an unrelated one.
Future<void> selectPlugins(WidgetTester tester) async {
  final row = find.byKey(const ValueKey('settings-row-mcp-servers'));
  await tester.ensureVisible(row);
  await tester.pumpAndSettle();
  await tester.tap(row);
  await tester.pumpAndSettle();
}

Finder serverName(String name) => find.descendant(
  // The name appears in the row and again beside its edit/remove buttons.
  of: find.byKey(ValueKey('settings-row-mcp-server-$name')),
  matching: find.text(name),
);

void main() {
  testWidgets('opening Settings reads the Work permissions once', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);

    await openSurface(tester, 0);

    expect(
      core.calls.where((call) => call == 'work.permissions.get'),
      hasLength(1),
    );
    expect(find.text('WORK'), findsOneWidget);
  });

  testWidgets('opening Settings reads the decision layer once', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);

    await openSurface(tester, 0);

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

    expect(callsTo(core, 'mcp.list'), 1);
    expect(serverName('notes'), findsOneWidget);
    expect(serverName('wiki'), findsOneWidget);
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
    expect(callsTo(core, 'mcp.refresh'), 0);
    expect(find.textContaining('search_notes'), findsNothing);

    await selectPlugins(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(callsTo(core, 'mcp.refresh'), 1);
    expect(find.textContaining('search_notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed server row shows the core message', (tester) async {
    final core = FakeCore(mcpRefreshFailure: 'connection refused');
    await pumpShell(tester, core: core);
    await openSettings(tester);
    await selectPlugins(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(find.text('failed: connection refused'), findsOneWidget);
    expect(serverName('notes'), findsOneWidget);
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
    expect(serverName('notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
