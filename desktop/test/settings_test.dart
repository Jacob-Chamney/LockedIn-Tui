import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _marker = ValueKey('settings-selected');

SettingsView populatedSettings() => const SettingsView(
  username: 'friend',
  theme: 'crimson',
  chatModel: 'deepseek/deepseek-flash',
  baseUrl: 'https://api.example.test/v1',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 5,
  period: 'month',
  warnAt: 0.8,
  pauseAtLimit: true,
  dataDir: '/home/friend/.local/share/lockedin',
  archiveBackend: 'github',
  archiveFolder: '/home/friend/LockedIn-archive',
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: ['filesystem', 'web-search'],
  hideHints: false,
  pluginDirs: ['/home/friend/.config/lockedin/plugins'],
  disabledPlugins: ['legacy'],
);

SettingsView emptySettings() => const SettingsView(
  username: '',
  theme: '',
  chatModel: '',
  baseUrl: '',
  maxToolCalls: 0,
  maxTokensPerRequest: 0,
  budgetUsd: 0,
  period: '',
  warnAt: 0,
  pauseAtLimit: false,
  dataDir: '',
  archiveBackend: '',
  archiveFolder: '',
  historyLimit: 0,
  responseStyle: '',
  tutorPolicy: '',
  pluginServers: [],
  hideHints: true,
  pluginDirs: [],
  disabledPlugins: [],
);

const _providers = [
  ProviderRow(
    id: 'openai',
    label: 'OpenAI',
    keyRequired: true,
    baseUrl: '',
    note: 'GPT models',
    linked: true,
  ),
  ProviderRow(
    id: 'custom',
    label: 'Custom endpoint',
    keyRequired: false,
    baseUrl: '',
    note: 'OpenAI-compatible',
    linked: false,
  ),
];

/// A snapshot with every editable value in range, so a test can exercise one
/// editor without the empty-state fallbacks.
SettingsView editableSettings() => const SettingsView(
  username: 'friend',
  theme: 'crimson',
  chatModel: 'deepseek/deepseek-flash',
  baseUrl: '',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 5,
  period: 'day',
  warnAt: 0.8,
  pauseAtLimit: false,
  dataDir: '/home/friend/.local/share/lockedin',
  archiveBackend: 'folder',
  archiveFolder: '/home/friend/LockedIn-archive',
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: ['filesystem'],
  hideHints: false,
  pluginDirs: [],
  disabledPlugins: [],
);

const _rowIndex = <String, int>{
  'username': 0,
  'base-url': 4,
  'max-tool-calls': 5,
  'max-tokens': 6,
  'budget': 7,
  'period': 8,
  'warn-at': 9,
  'pause-at-limit': 10,
  'history-limit': 14,
};

Future<void> selectRow(WidgetTester tester, String id) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.home);
  await tester.pumpAndSettle();
  for (var step = 0; step < _rowIndex[id]!; step++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
  }
}

Future<void> commitEdit(WidgetTester tester, String text) async {
  await tester.enterText(
    find.byKey(const ValueKey('settings-edit-field')),
    text,
  );
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
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

Finder markedRow(String id) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.byKey(_marker),
);

void main() {
  testWidgets('a row with a control has a chevron that runs it', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: populatedSettings(),
        loading: false,
        onSaveSettings: (patch) async {},
      ),
    );

    // The pointer path for Enter: one click on the row's chevron opens the
    // control the row stands for (here, the theme picker).
    final chevron = find.byKey(const ValueKey('settings-activate-theme'));
    expect(chevron, findsOneWidget);
    await tester.tap(chevron);
    await tester.pumpAndSettle();
    expect(find.text('LockedIn Crimson'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('LockedIn Crimson'), findsNothing);

    // A read-only page keeps the chevron but disables it: the row cannot be
    // changed, so the pointer path must not pretend otherwise.
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
    );
    final disabled = tester.widget<IconButton>(
      find.byKey(const ValueKey('settings-activate-theme')),
    );
    expect(disabled.onPressed, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('renders the populated settings groups', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
    );

    expect(find.text('SETTINGS'), findsOneWidget);
    for (final group in ['USER', 'MODELS', 'USAGE', 'STORAGE', 'PLUGINS']) {
      expect(find.text(group), findsOneWidget, reason: 'missing group $group');
    }

    expect(find.text('friend'), findsOneWidget);
    expect(find.text('crimson'), findsOneWidget);
    expect(find.text('deepseek/deepseek-flash'), findsOneWidget);
    expect(find.text('configured'), findsOneWidget);
    expect(find.text('https://api.example.test/v1'), findsOneWidget);
    expect(find.text('8'), findsOneWidget);
    expect(find.text('16,000'), findsOneWidget);
    expect(find.text(r'$5.00'), findsOneWidget);
    expect(find.text('month'), findsOneWidget);
    expect(find.text('80%'), findsOneWidget);
    expect(find.text('yes'), findsOneWidget);
    expect(find.text('/home/friend/.local/share/lockedin'), findsOneWidget);
    expect(find.text('github'), findsOneWidget);
    expect(find.text('/home/friend/LockedIn-archive'), findsOneWidget);
    expect(find.text('20 messages'), findsOneWidget);
    expect(find.text('filesystem, web-search'), findsOneWidget);
    expect(find.text('1 loaded · 1 disabled'), findsOneWidget);

    // Every populated row shows a real value, so nothing reads "not set".
    expect(find.text('not set'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty values read as not set or an explicit no', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(settings: emptySettings(), loading: false),
    );

    expect(find.text('not set'), findsWidgets);
    expect(find.text('no limit'), findsOneWidget);
    expect(find.text('0%'), findsOneWidget);
    expect(find.text('no'), findsOneWidget);
    expect(find.text('off'), findsOneWidget);
    expect(find.text('none'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('null snapshot shows the offline empty state', (tester) async {
    var refreshes = 0;
    await pumpPage(
      tester,
      SettingsPage(
        settings: null,
        loading: false,
        onRefresh: () => refreshes += 1,
      ),
    );

    expect(find.text('SETTINGS'), findsOneWidget);
    expect(find.text('Settings unavailable'), findsOneWidget);
    expect(find.textContaining('core is not connected'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(refreshes, 1);
  });

  testWidgets('null snapshot without a callback offers no dead button', (
    tester,
  ) async {
    await pumpPage(tester, const SettingsPage(settings: null, loading: false));

    expect(find.text('Settings unavailable'), findsOneWidget);
    expect(find.text('Retry'), findsNothing);
  });

  testWidgets('error state shows the reason and retries', (tester) async {
    var refreshes = 0;
    await pumpPage(
      tester,
      SettingsPage(
        settings: populatedSettings(),
        loading: false,
        error: 'provider list unavailable',
        onRefresh: () => refreshes += 1,
      ),
    );

    expect(find.text('Settings could not load'), findsOneWidget);
    expect(find.text('provider list unavailable'), findsOneWidget);
    expect(find.text('USER'), findsNothing);

    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(refreshes, 1);
  });

  testWidgets('loading state says loading settings', (tester) async {
    await pumpPage(tester, const SettingsPage(settings: null, loading: true));

    expect(find.text('loading settings…'), findsOneWidget);
    expect(find.text('USER'), findsNothing);
  });

  testWidgets('Down and Up move the selected row', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
    );

    expect(markedRow('username'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(markedRow('username'), findsNothing);
    expect(markedRow('theme'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(markedRow('chat-model'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(markedRow('theme'), findsOneWidget);

    // Up clamps at the first row; Enter is a read-only no-op.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(markedRow('username'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(markedRow('username'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no overflow at 800x600 and the cursor reaches the last row', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
      size: const Size(800, 600),
    );
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    // KEYBINDS is the last group, so its final row is the last row of the page.
    expect(markedRow('keybind-close'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    expect(markedRow('username'), findsOneWidget);
  });

  testWidgets('narrow stacked rows do not overflow', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
      size: const Size(420, 640),
    );
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the dialog fills itself when providers load late', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        providers: const [],
        onLoadProviders: () async => _providers,
        onLinkProvider: (providerId, key, baseUrl) async => ProviderLink(
          providerId: providerId,
          models: const ['gpt-4.1-mini'],
          secretRef: 'lockedin/openai',
        ),
        onSaveSettings: (patch) async {},
      ),
      size: const Size(1280, 900),
    );

    await tester.tap(find.byKey(const ValueKey('settings-connect-model')));
    await tester.pumpAndSettle();

    // The dialog opened with an empty list; the load arrives one frame later
    // and must render without reopening the dialog.
    expect(find.text('OpenAI'), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-provider-key')), findsOneWidget);
  });

  testWidgets('connect action is absent without callbacks', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(settings: emptySettings(), loading: false),
      size: const Size(1280, 900),
    );

    expect(find.byKey(const ValueKey('settings-connect-model')), findsNothing);
    expect(
      find.byKey(const ValueKey('settings-model-not-connected')),
      findsOneWidget,
    );
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('connect opens the provider list and links a key', (
    tester,
  ) async {
    var loads = 0;
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        providers: _providers,
        onLoadProviders: () async {
          loads += 1;
          return _providers;
        },
        onLinkProvider: (providerId, key, baseUrl) async => ProviderLink(
          providerId: providerId,
          models: const ['gpt-4.1-mini'],
          secretRef: 'lockedin/openai',
        ),
        onSaveSettings: (patch) async {},
      ),
      size: const Size(1280, 900),
    );

    await tester.tap(find.byKey(const ValueKey('settings-connect-model')));
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.text('OpenAI'), findsOneWidget);
    expect(find.text('Custom endpoint'), findsOneWidget);
    expect(find.text('linked'), findsOneWidget);
    expect(find.text('not linked'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('settings-provider-key')),
      'sk-test',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('settings-link')));
    await tester.pumpAndSettle();

    expect(find.text('gpt-4.1-mini'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on the chat model row opens the connect dialog', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        providers: _providers,
        onLoadProviders: () async => _providers,
        onLinkProvider: (providerId, key, baseUrl) async => ProviderLink(
          providerId: providerId,
          models: const ['gpt-4.1-mini'],
          secretRef: 'lockedin/openai',
        ),
        onSaveSettings: (patch) async {},
      ),
      size: const Size(1280, 900),
    );

    // chat model is the third row: the dialog must not need a pointer.
    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(markedRow('chat-model'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('settings-provider-key')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // The providers row has the same pointer path as every other control.
    await tester.tap(find.byKey(const ValueKey('settings-activate-providers')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('settings-provider-key')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('every value starts in the same column', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        onSaveSettings: (patch) async {},
      ),
    );

    // `chat model` has no editor and `base URL` has one; both read `not set`.
    // A row without a control used to reserve a narrower trailing column, so
    // its value sat 11 px to the right of its neighbour's.
    final values = find.text('not set');
    expect(values, findsWidgets);
    final rights = {
      for (final element in values.evaluate())
        tester.getTopRight(find.byWidget(element.widget)).dx.round(),
    };
    expect(rights, hasLength(1), reason: 'values share one right edge');
    expect(tester.takeException(), isNull);
  });

  testWidgets('use this model saves the provider/model pair', (tester) async {
    Map<String, dynamic>? saved;
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        providers: _providers,
        onLinkProvider: (providerId, key, baseUrl) async => ProviderLink(
          providerId: providerId,
          models: const ['gpt-4.1-mini'],
          secretRef: 'lockedin/openai',
        ),
        onSaveSettings: (patch) async => saved = patch,
      ),
      size: const Size(1280, 900),
    );

    await tester.tap(find.byKey(const ValueKey('settings-connect-model')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('settings-provider-key')),
      'sk-test',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('settings-link')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('settings-use-model')));
    await tester.pumpAndSettle();

    expect(saved, {
      'models': {'chat': 'openai/gpt-4.1-mini'},
    });
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a rejected key stays in the dialog and saves nothing', (
    tester,
  ) async {
    var saves = 0;
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        providers: _providers,
        onLinkProvider: (providerId, key, baseUrl) async =>
            throw const RpcException(-32000, 'the provider rejected the key', {
              'kind': 'auth',
            }),
        onSaveSettings: (patch) async => saves += 1,
      ),
      size: const Size(1280, 900),
    );

    await tester.tap(find.byKey(const ValueKey('settings-connect-model')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('settings-provider-key')),
      'sk-bad',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('settings-link')));
    await tester.pumpAndSettle();

    expect(find.text('the provider rejected the key'), findsOneWidget);
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-use-model')), findsOneWidget);
    expect(saves, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('custom provider shows a base URL and saves it', (tester) async {
    Map<String, dynamic>? saved;
    String? seenBaseUrl;
    await pumpPage(
      tester,
      SettingsPage(
        settings: emptySettings(),
        loading: false,
        providers: _providers,
        onLinkProvider: (providerId, key, baseUrl) async {
          seenBaseUrl = baseUrl;
          return ProviderLink(
            providerId: providerId,
            models: const ['llama3'],
            secretRef: '',
          );
        },
        onSaveSettings: (patch) async => saved = patch,
      ),
      size: const Size(1280, 900),
    );

    await tester.tap(find.byKey(const ValueKey('settings-connect-model')));
    await tester.pumpAndSettle();

    // The first provider is key-based, so no base URL field until custom wins.
    expect(
      find.byKey(const ValueKey('settings-provider-base-url')),
      findsNothing,
    );
    await tester.tap(find.byKey(const ValueKey('settings-provider-custom')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('settings-provider-base-url')),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('settings-provider-base-url')),
      'http://localhost:11434/v1',
    );
    // A custom endpoint may need no key at all.
    await tester.tap(find.byKey(const ValueKey('settings-link')));
    await tester.pumpAndSettle();

    expect(seenBaseUrl, 'http://localhost:11434/v1');
    expect(find.text('llama3'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('settings-use-model')));
    await tester.pumpAndSettle();

    expect(saved, {
      'models': {
        'chat': 'custom/llama3',
        'base_url': 'http://localhost:11434/v1',
      },
    });
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on max tool calls opens an editor and saves an integer', (
    tester,
  ) async {
    Map<String, dynamic>? saved;
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async => saved = patch,
      ),
    );

    await selectRow(tester, 'max-tool-calls');
    expect(markedRow('max-tool-calls'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('settings-edit-field')), findsOneWidget);

    await commitEdit(tester, '16');

    expect(saved, {
      'models': {'max_tool_calls': 16},
    });
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an out-of-range value shows the range and saves nothing', (
    tester,
  ) async {
    var saves = 0;
    Map<String, dynamic>? saved;
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async {
          saves += 1;
          saved = patch;
        },
      ),
    );

    await selectRow(tester, 'max-tool-calls');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await commitEdit(tester, '0');

    expect(
      find.textContaining('for max tool calls from 1 to 64'),
      findsOneWidget,
    );
    expect(saves, 0);
    expect(saved, isNull);
    // The editor stays open with the rejected value, not a fake success.
    expect(find.byKey(const ValueKey('settings-edit-field')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a rejected write stays in the editor with the message', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async =>
            throw const RpcException(-32000, 'the config could not be written'),
      ),
    );

    await selectRow(tester, 'max-tool-calls');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await commitEdit(tester, '16');

    expect(find.text('the config could not be written'), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-edit-field')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on pause at limit toggles it and saves', (tester) async {
    Map<String, dynamic>? saved;
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async => saved = patch,
      ),
    );

    await selectRow(tester, 'pause-at-limit');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(saved, {
      'usage': {'pause_at_limit': true},
    });
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on period toggles day to month and saves', (tester) async {
    Map<String, dynamic>? saved;
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async => saved = patch,
      ),
    );

    await selectRow(tester, 'period');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(saved, {
      'usage': {'period': 'month'},
    });
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('username and base URL save through the text editor', (
    tester,
  ) async {
    final saved = <Map<String, dynamic>>[];
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async => saved.add(patch),
      ),
    );

    await selectRow(tester, 'username');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await commitEdit(tester, 'sam');

    await selectRow(tester, 'base-url');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await commitEdit(tester, 'https://api.new.test/v1');

    expect(saved, [
      {
        'ui': {'username': 'sam'},
      },
      {
        'models': {'base_url': 'https://api.new.test/v1'},
      },
    ]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a read-only page opens no editor on Enter', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
    );

    await selectRow(tester, 'max-tool-calls');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    expect(find.byKey(const ValueKey('settings-edit-field')), findsNothing);
    expect(markedRow('max-tool-calls'), findsOneWidget);
    expect(
      find.text('selection only · use connect to change the chat model'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the editor fits at 800x600', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async {},
      ),
      size: const Size(800, 600),
    );

    await selectRow(tester, 'max-tool-calls');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('settings-edit-field')), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('the editor fits in a narrow column', (tester) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: editableSettings(),
        loading: false,
        onSaveSettings: (patch) async {},
      ),
      size: const Size(420, 640),
    );

    await selectRow(tester, 'max-tool-calls');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('settings-edit-field')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('/ filters rows and Escape restores the full page', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    await tester.enterText(
      find.byKey(const ValueKey('settings-search')),
      'budget',
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('settings-row-budget')), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-row-username')), findsNothing);
    expect(find.text('USAGE'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('username'), findsOneWidget);
    expect(find.text('USAGE'), findsOneWidget);

    // The section index is a pointer path to the same groups.
    await tester.tap(find.byKey(const ValueKey('settings-section-usage')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
