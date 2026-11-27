import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

SettingsView settingsSnapshot() => const SettingsView(
  username: 'friend',
  theme: 'crimson',
  chatModel: 'openai/gpt-4.1-mini',
  baseUrl: '',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 5,
  period: 'day',
  warnAt: 0.8,
  pauseAtLimit: false,
  dataDir: '/tmp/lockedin-data',
  archiveBackend: 'folder',
  archiveFolder: '',
  archiveGithubRepo: '',
  archiveGithubBranch: "main",
  archiveGithubConsent: false,
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: ['notes', 'wiki'],
  hideHints: false,
  pluginDirs: [],
  disabledPlugins: [],
);

const _notes = McpServerView(
  name: 'notes',
  transport: 'stdio',
  enabled: true,
  status: 'connected',
  tools: [
    McpToolView(name: 'read_note', write: false),
    McpToolView(name: 'write_note', write: true),
  ],
);

const _wiki = McpServerView(
  name: 'wiki',
  transport: 'stdio',
  enabled: true,
  status: 'connected',
  tools: [McpToolView(name: 'search_wiki', write: false)],
);

/// The same policy with one cell written, so a test can answer a write exactly
/// like the shell does after the store notifies.
PluginPolicy withCell(
  PluginPolicy policy,
  String command,
  String server,
  String value,
) {
  final cells = <String, Map<String, String>>{
    for (final entry in policy.cells.entries)
      entry.key: <String, String>{...entry.value},
  };
  (cells[command] ??= <String, String>{})[server] = value;
  return PluginPolicy(cells);
}

Future<void> pumpPage(
  WidgetTester tester,
  Widget page, {
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: page),
    ),
  );
  await tester.pumpAndSettle();
}

/// Select a row by tapping it, then keep the keyboard cursor on it.
Future<void> selectRow(WidgetTester tester, String id) async {
  final row = find.byKey(ValueKey('settings-row-$id'));
  await tester.ensureVisible(row);
  await tester.pumpAndSettle();
  await tester.tap(row);
  await tester.pumpAndSettle();
}

Finder rowValue(String id, String value) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.text(value),
);

Finder rowError(String id) => find.byKey(ValueKey('settings-row-error-$id'));

Finder rowSaving(String id) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.byKey(const ValueKey('settings-row-saving')),
);

void main() {
  testWidgets('renders one row per configured server and command', (
    tester,
  ) async {
    const policy = PluginPolicy(<String, Map<String, String>>{
      'chill': {'notes': 'on', 'wiki': 'off'},
      'lockin': {'notes': 'explicit'},
      'skill': {'ghost': 'on'},
    });
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notes, _wiki],
        mcpPolicy: policy,
        onSetMcpPolicy: (command, server, value) async {},
      ),
    );

    // Five commands by two configured servers.
    expect(find.text('chill · notes'), findsOneWidget);
    expect(find.text('chill · wiki'), findsOneWidget);
    expect(find.text('lockin · notes'), findsOneWidget);
    expect(find.text('skill · notes'), findsOneWidget);
    expect(find.text('flashcards · notes'), findsOneWidget);
    expect(find.text('flashcards · wiki'), findsOneWidget);
    expect(find.text('study-guide · notes'), findsOneWidget);
    expect(find.text('study-guide · wiki'), findsOneWidget);

    // Stored cells print verbatim; absent ones read `default`.
    expect(rowValue('mcp-policy-chill-notes', 'on'), findsOneWidget);
    expect(rowValue('mcp-policy-chill-wiki', 'off'), findsOneWidget);
    expect(rowValue('mcp-policy-lockin-notes', 'explicit'), findsOneWidget);
    expect(rowValue('mcp-policy-lockin-wiki', 'default'), findsOneWidget);
    expect(find.text('default'), findsNWidgets(9));

    // A stored cell for a server that is not configured gets no row, so the
    // page never offers a write the core would refuse.
    expect(
      find.byKey(const ValueKey('settings-row-mcp-policy-skill-ghost')),
      findsNothing,
    );
    expect(find.text('skill · ghost'), findsNothing);

    // The server rows and their tools are still there.
    expect(find.text('stdio · enabled · connected'), findsNWidgets(2));
    expect(find.text('read_note, write_note (write)'), findsOneWidget);
    expect(find.text('search_wiki'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter cycles on, explicit, off and wraps to on', (tester) async {
    var policy = PluginPolicy.empty;
    final calls = <List<String>>[];
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SettingsPage(
            settings: settingsSnapshot(),
            loading: false,
            mcpServers: const [_notes, _wiki],
            mcpPolicy: policy,
            onSetMcpPolicy: (command, server, value) async {
              calls.add([command, server, value]);
              setHost(() => policy = withCell(policy, command, server, value));
            },
          );
        },
      ),
    );

    await selectRow(tester, 'mcp-policy-chill-notes');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls, [
      ['chill', 'notes', 'on'],
    ]);
    expect(rowValue('mcp-policy-chill-notes', 'on'), findsOneWidget);

    // Enter advances the same cell, and the page asks for exactly one write.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['chill', 'notes', 'explicit']);
    expect(rowValue('mcp-policy-chill-notes', 'explicit'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['chill', 'notes', 'off']);
    expect(rowValue('mcp-policy-chill-notes', 'off'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['chill', 'notes', 'on']);
    expect(calls, hasLength(4));
    expect(tester.takeException(), isNull);
  });

  testWidgets('flashcards and study-guide skip on', (tester) async {
    var policy = PluginPolicy.empty;
    final calls = <List<String>>[];
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SettingsPage(
            settings: settingsSnapshot(),
            loading: false,
            mcpServers: const [_notes, _wiki],
            mcpPolicy: policy,
            onSetMcpPolicy: (command, server, value) async {
              calls.add([command, server, value]);
              setHost(() => policy = withCell(policy, command, server, value));
            },
          );
        },
      ),
    );

    await selectRow(tester, 'mcp-policy-flashcards-notes');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['flashcards', 'notes', 'explicit']);
    expect(rowValue('mcp-policy-flashcards-notes', 'explicit'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['flashcards', 'notes', 'off']);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['flashcards', 'notes', 'explicit']);

    await selectRow(tester, 'mcp-policy-study-guide-wiki');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls.last, ['study-guide', 'wiki', 'explicit']);

    expect(calls.any((call) => call.last == 'on'), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a rejected write stays inline and pressing again retries', (
    tester,
  ) async {
    var policy = PluginPolicy.empty;
    var refuse = true;
    final calls = <List<String>>[];
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SettingsPage(
            settings: settingsSnapshot(),
            loading: false,
            mcpServers: const [_notes, _wiki],
            mcpPolicy: policy,
            onSetMcpPolicy: (command, server, value) async {
              calls.add([command, server, value]);
              if (refuse) {
                throw const RpcException(
                  -32000,
                  'the policy could not be written',
                );
              }
              setHost(() => policy = withCell(policy, command, server, value));
            },
          );
        },
      ),
    );

    await selectRow(tester, 'mcp-policy-chill-notes');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(calls, [
      ['chill', 'notes', 'on'],
    ]);
    expect(rowError('mcp-policy-chill-notes'), findsOneWidget);
    expect(find.text('the policy could not be written'), findsOneWidget);
    // The row keeps the stored value: no optimistic write.
    expect(rowValue('mcp-policy-chill-notes', 'default'), findsOneWidget);

    // Pressing again retries the same next value.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls, hasLength(2));
    expect(calls.last, ['chill', 'notes', 'on']);
    expect(rowError('mcp-policy-chill-notes'), findsOneWidget);

    // Once the core accepts, the row updates and the error clears.
    refuse = false;
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(calls, hasLength(3));
    expect(rowValue('mcp-policy-chill-notes', 'on'), findsOneWidget);
    expect(rowError('mcp-policy-chill-notes'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a write in flight shows saving and ignores a second press', (
    tester,
  ) async {
    final pending = Completer<void>();
    var calls = 0;
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notes, _wiki],
        mcpPolicy: PluginPolicy.empty,
        onSetMcpPolicy: (command, server, value) {
          calls += 1;
          return pending.future;
        },
      ),
    );

    await selectRow(tester, 'mcp-policy-chill-notes');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(rowSaving('mcp-policy-chill-notes'), findsOneWidget);
    expect(find.text('saving…'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(calls, 1);

    pending.complete();
    await tester.pumpAndSettle();
    expect(rowSaving('mcp-policy-chill-notes'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('800x600 and narrow layouts keep the policy rows usable', (
    tester,
  ) async {
    Future<void> build(Size size) => pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notes, _wiki],
        mcpPolicy: const PluginPolicy(<String, Map<String, String>>{
          'chill': {'notes': 'on'},
        }),
        onSetMcpPolicy: (command, server, value) async {},
      ),
      size: size,
    );

    await build(const Size(800, 600));
    expect(tester.takeException(), isNull);

    await selectRow(tester, 'mcp-policy-study-guide-wiki');
    expect(rowValue('mcp-policy-study-guide-wiki', 'default'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await build(const Size(420, 640));
    expect(tester.takeException(), isNull);
    await selectRow(tester, 'mcp-policy-chill-notes');
    expect(rowValue('mcp-policy-chill-notes', 'on'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('setMcpPolicy writes one cell and replaces the stored matrix', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.refreshMcp();
    expect(store.mcpPolicy.rowFor('skill'), isEmpty);

    await store.setMcpPolicy('skill', 'wiki', 'explicit');

    expect(core.calls, contains('mcp.policy.set'));
    expect(core.mcpPolicySets, [
      {'command': 'skill', 'server': 'wiki', 'value': 'explicit'},
    ]);
    expect(store.mcpPolicy.rowFor('skill'), {'wiki': 'explicit'});
    // The untouched cells are still the ones the core stored.
    expect(store.mcpPolicy.rowFor('chill'), {'notes': 'on'});
  });

  test('a refused set rethrows and leaves the stored matrix alone', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.refreshMcp();
    final before = store.mcpPolicy;

    await expectLater(
      store.setMcpPolicy('flashcards', 'notes', 'on'),
      throwsA(isA<RpcException>()),
    );
    expect(store.mcpPolicy, same(before));
    expect(core.mcpPolicySets, isEmpty);
    expect(store.mcpPolicy.rowFor('flashcards'), isEmpty);
  });

  test('the fake refuses on for the no-plugin commands', () async {
    final core = FakeCore();
    await expectLater(
      core.call('mcp.policy.set', {
        'command': 'study-guide',
        'server': 'notes',
        'value': 'on',
      }),
      throwsA(isA<RpcException>()),
    );
    expect(core.mcpPolicySets, isEmpty);

    await core.call('mcp.policy.set', {
      'command': 'lockin',
      'server': 'wiki',
      'value': 'off',
    });
    expect(core.mcpPolicySets, [
      {'command': 'lockin', 'server': 'wiki', 'value': 'off'},
    ]);
  });
}
