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

SettingsView settingsSnapshot({
  List<String> pluginServers = const ['filesystem'],
}) => SettingsView(
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
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: pluginServers,
  hideHints: false,
  pluginDirs: const [],
  disabledPlugins: const [],
);

const _notesServer = McpServerView(
  name: 'notes',
  transport: 'stdio',
  enabled: true,
  status: 'connected',
  tools: [
    McpToolView(name: 'read_note', write: false),
    McpToolView(name: 'write_note', write: true),
  ],
);

const _wikiServer = McpServerView(
  name: 'wiki',
  transport: 'stdio',
  enabled: false,
  status: 'stopped',
  tools: [],
);

const _failedServer = McpServerView(
  name: 'wiki',
  transport: 'stdio',
  enabled: true,
  status: 'failed',
  tools: [],
  failure: 'connection refused',
);

const _policy = PluginPolicy(<String, Map<String, String>>{
  'chill': {'notes': 'on', 'wiki': 'off'},
  'lockin': {'notes': 'explicit'},
});

/// Row indices in [settingsSnapshot] with two MCP servers and five policy rows:
/// USER 0-1, MODELS 2-6, USAGE 7-10, STORAGE 11-14, PLUGINS 15-23.
const _rowIndex = <String, int>{
  'mcp-servers': 15,
  'mcp-server-notes': 16,
  'mcp-server-wiki': 17,
  'ui-plugins': 23,
};

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

Future<void> selectRow(WidgetTester tester, String id) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.home);
  await tester.pumpAndSettle();
  for (var step = 0; step < _rowIndex[id]!; step++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
  }
}

Finder markedRow(String id) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.byKey(const ValueKey('settings-selected')),
);

/// Every rendered string on the page, for the "nothing leaked" assertion.
String renderedText(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((text) => text.data ?? '')
    .join('\n');

/// A fake whose MCP surface can start failing, to prove a failed read keeps the
/// rows it already had.
class _FlakyMcpCore extends FakeCore {
  bool mcpDown = false;

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    if (mcpDown && method.startsWith('mcp.')) {
      throw const RpcException(
        -32601,
        'the plugin host is not available in this build',
      );
    }
    return super.call(method, params);
  }
}

void main() {
  testWidgets('lists each server with transport, state and tools', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer, _wikiServer],
        mcpPolicy: _policy,
      ),
    );

    expect(find.text('PLUGINS'), findsOneWidget);
    expect(find.text('notes'), findsOneWidget);
    expect(find.text('wiki'), findsOneWidget);
    expect(find.text('stdio · enabled · connected'), findsOneWidget);
    expect(find.text('stdio · disabled · stopped'), findsOneWidget);
    expect(find.text('read_note, write_note (write)'), findsOneWidget);
    expect(find.text('no tools'), findsOneWidget);

    // Plugin output is an external explanation, and the copy says so.
    expect(find.textContaining('external explanation'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the policy matrix shows stored cells and defaults', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer, _wikiServer],
        mcpPolicy: _policy,
      ),
    );

    // Configured rows print the core's cells; the rest are `default`, never an
    // invented value.
    expect(find.text('notes: on · wiki: off'), findsOneWidget);
    expect(find.text('notes: explicit'), findsOneWidget);
    expect(find.text('default'), findsNWidgets(3));
    expect(find.text('skill'), findsOneWidget);
    expect(find.text('flashcards'), findsOneWidget);
    expect(find.text('study-guide'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty policy reads default for every command', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer],
      ),
    );

    expect(find.text('default'), findsNWidgets(5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed server shows its message and the other rows stay', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer, _failedServer],
        mcpPolicy: _policy,
      ),
    );

    expect(find.text('stdio · enabled · failed'), findsOneWidget);
    expect(find.text('failed: connection refused'), findsOneWidget);
    // The healthy row and the policy rows are still there.
    expect(find.text('read_note, write_note (write)'), findsOneWidget);
    expect(find.text('notes: on · wiki: off'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no servers shows the empty state and the next action', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(pluginServers: const []),
        loading: false,
      ),
    );

    expect(find.text('no MCP servers configured'), findsOneWidget);
    expect(find.text('add a server in config.toml'), findsOneWidget);
    expect(find.textContaining('external explanation'), findsOneWidget);
    // The section still teaches the policy shape rather than rendering blank.
    expect(find.text('default'), findsNWidgets(5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('r refreshes once, updates rows and keeps the cursor', (
    tester,
  ) async {
    var refreshes = 0;
    var servers = const [_notesServer, _wikiServer];
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SettingsPage(
            settings: settingsSnapshot(),
            loading: false,
            mcpServers: servers,
            mcpPolicy: _policy,
            onRefreshMcp: () async {
              refreshes += 1;
              setHost(
                () => servers = const [
                  McpServerView(
                    name: 'notes',
                    transport: 'stdio',
                    enabled: true,
                    status: 'connected',
                    tools: [
                      McpToolView(name: 'read_note', write: false),
                      McpToolView(name: 'search_notes', write: false),
                    ],
                  ),
                  _wikiServer,
                ],
              );
            },
          );
        },
      ),
    );

    await selectRow(tester, 'mcp-server-notes');
    expect(markedRow('mcp-server-notes'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(refreshes, 1);
    expect(find.text('read_note, search_notes'), findsOneWidget);
    // The selected row is still the same server after the list changed.
    expect(markedRow('mcp-server-notes'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r shows the refreshing state until the core answers', (
    tester,
  ) async {
    final pending = Completer<void>();
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer],
        onRefreshMcp: () => pending.future,
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pump();
    expect(find.text('refreshing plugins…'), findsOneWidget);

    pending.complete();
    await tester.pumpAndSettle();
    expect(find.text('refreshing plugins…'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no command, path or token reaches the rendered text', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer, _failedServer],
        mcpPolicy: _policy,
      ),
    );

    final text = renderedText(tester);
    for (final secret in [
      'mcp-filesystem',
      '/usr/bin',
      '/home/',
      '--transport',
      'api_key',
      'password',
      'Bearer',
      'secret',
    ]) {
      expect(
        text.contains(secret),
        isFalse,
        reason: 'rendered text leaked "$secret"',
      );
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('800x600 renders the plugins rows without overflow', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer, _failedServer],
        mcpPolicy: _policy,
      ),
      size: const Size(800, 600),
    );
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    // KEYBINDS is the last group of the page, so `End` lands on its last row.
    expect(markedRow('keybind-close'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a narrow column wraps the failed message without overflow', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        mcpServers: const [_notesServer, _failedServer],
        mcpPolicy: _policy,
      ),
      size: const Size(420, 640),
    );

    await selectRow(tester, 'mcp-server-wiki');
    expect(markedRow('mcp-server-wiki'), findsOneWidget);
    expect(find.text('failed: connection refused'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test(
    'refreshMcp loads rows and policy; refreshAll does not call it',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);

      await store.refreshAll();
      expect(core.calls, isNot(contains('mcp.list')));
      expect(store.mcpServers, isEmpty);

      await store.refreshMcp();
      expect(store.mcpError, isNull);
      expect(store.mcpServers, hasLength(2));
      expect(store.mcpServers.first.name, 'notes');
      expect(store.mcpServers.first.tools.single.name, 'read_note');
      expect(store.mcpServers.last.tools.single.write, isTrue);
      expect(store.mcpPolicy.rowFor('chill'), {'notes': 'on'});
      expect(store.mcpPolicy.rowFor('lockin'), {'notes': 'explicit'});
      // An absent command stays absent: the core never invents a cell.
      expect(store.mcpPolicy.rowFor('skill'), isEmpty);

      // refresh is rows-only: the policy matrix is not part of its answer.
      await store.refreshMcpServers();
      expect(
        store.mcpServers.first.tools.map((tool) => tool.name),
        contains('search_notes'),
      );
      expect(store.mcpPolicy.rowFor('lockin'), {'notes': 'explicit'});
      expect(core.calls.where((call) => call == 'mcp.refresh'), hasLength(1));
    },
  );

  test('a failed MCP read keeps the previous rows', () async {
    final core = _FlakyMcpCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.refreshMcp();
    expect(store.mcpServers, hasLength(2));

    core.mcpDown = true;
    await store.refreshMcp();
    expect(store.mcpError, 'the plugin host is not available in this build');
    expect(store.mcpServers, hasLength(2));

    await store.refreshMcpServers();
    expect(store.mcpError, 'the plugin host is not available in this build');
    expect(store.mcpServers, hasLength(2));
  });
}
