import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// The crimson default's four identity tokens, used to prove `resetPalette()`.
const _crimsonBackground = Color(0xFF0D0F11);
const _crimsonForeground = Color(0xFFE7E7E7);
const _crimsonPrimary = Color(0xFFD9534F);
const _crimsonLine = Color(0xFF30363C);

/// The high-contrast tokens (`src/ui/theme/palettes.ts`), pushed apart on
/// purpose: true black, plain white, a light line and a lighter red.
const _contrastBackground = Color(0xFF000000);
const _contrastForeground = Color(0xFFFFFFFF);
const _contrastPrimary = Color(0xFFFF8080);
const _contrastLine = Color(0xFF8C8C8C);

SettingsView _settings({String theme = 'lockedin'}) => SettingsView(
  username: 'friend',
  theme: theme,
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
  pluginServers: const ['filesystem'],
  hideHints: false,
  pluginDirs: const [],
  disabledPlugins: const [],
);

/// A fake core whose `settings.get`/`settings.patch` carry a chosen theme, so
/// the shell exercises the same projection the real core serves.
class _ThemeCore extends FakeCore {
  _ThemeCore({this.theme = 'high-contrast'});

  String theme;

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    if (method == 'settings.patch') {
      final patch = params?['patch'];
      final ui = patch is Map ? patch['ui'] : null;
      final next = ui is Map ? ui['theme'] : null;
      if (next is String) theme = next;
    }
    final result = await super.call(method, params);
    if (method == 'settings.get' || method == 'settings.patch') {
      result['theme'] = theme;
    }
    return result;
  }
}

Finder _markedRow(String id) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.byKey(const ValueKey('settings-selected')),
);

Future<void> _pumpSettings(
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

/// Move the settings cursor to [id], starting from the top.
Future<void> _selectRow(WidgetTester tester, String id) async {
  const order = [
    'username',
    'theme',
    'chat-model',
    'providers',
    'base-url',
    'max-tool-calls',
    'max-tokens',
  ];
  final target = order.indexOf(id);
  expect(target, greaterThanOrEqualTo(0), reason: 'unknown row $id');
  await tester.sendKeyEvent(LogicalKeyboardKey.home);
  await tester.pumpAndSettle();
  for (var step = 0; step < target; step++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
  }
}

/// Expand the rail: it starts shrunk, so its labels exist only once it is open.
/// `Esc` then leaves it open for the pointer.
Future<void> _expandSidebar(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.escape);
  await tester.pumpAndSettle();
}

Future<CoreStore> _pumpApp(
  WidgetTester tester, {
  required FakeCore core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core);
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

void main() {
  setUp(resetPalette);
  tearDown(resetPalette);

  group('palette', () {
    test('applyPalette switches the tokens and reset restores crimson', () {
      resetPalette();
      expect(activeThemeId, 'lockedin');
      expect(LockedInColors.background, _crimsonBackground);
      expect(LockedInColors.foreground, _crimsonForeground);
      expect(LockedInColors.primary, _crimsonPrimary);
      expect(LockedInColors.line, _crimsonLine);

      expect(applyPalette('high-contrast'), isTrue);
      expect(activeThemeId, 'high-contrast');
      expect(LockedInColors.background, _contrastBackground);
      expect(LockedInColors.foreground, _contrastForeground);
      expect(LockedInColors.primary, _contrastPrimary);
      expect(LockedInColors.line, _contrastLine);

      // Visibly stronger: the extremes are further apart than crimson's.
      expect(
        (_contrastForeground.computeLuminance() -
                _contrastBackground.computeLuminance())
            .abs(),
        greaterThan(
          (_crimsonForeground.computeLuminance() -
                  _crimsonBackground.computeLuminance())
              .abs(),
        ),
      );

      resetPalette();
      expect(activeThemeId, 'lockedin');
      expect(LockedInColors.background, _crimsonBackground);
      expect(LockedInColors.foreground, _crimsonForeground);
      expect(LockedInColors.primary, _crimsonPrimary);
      expect(LockedInColors.line, _crimsonLine);
    });

    test('the core theme ids resolve and an unknown id is a no-op', () {
      resetPalette();
      for (final id in lockedInThemeIds) {
        expect(applyPalette(id), isTrue, reason: id);
        expect(activePalette.id, id);
        expect(LockedInColors.background, activePalette.background);
      }

      expect(applyPalette('codex'), isTrue);
      final codex = activePalette;
      expect(applyPalette('no-such-theme'), isFalse);
      expect(activePalette, same(codex), reason: 'a typo keeps the palette');
      expect(activePalette.id, 'codex');
    });

    test('applyPaletteOr falls back to crimson for an unknown id', () {
      applyPaletteOr('codex');
      expect(activeThemeId, 'codex');
      applyPaletteOr('crimson');
      expect(activeThemeId, 'lockedin');
      applyPaletteOr(null);
      expect(activeThemeId, 'lockedin');
    });

    test('lockedInTheme is built from the active palette', () {
      applyPalette('claude-code');
      final theme = lockedInTheme();
      expect(theme.scaffoldBackgroundColor, LockedInColors.background);
      expect(theme.colorScheme.primary, LockedInColors.primary);
      expect(theme.textTheme.bodyMedium?.color, LockedInColors.foreground);

      applyPalette('high-contrast');
      final contrast = lockedInTheme();
      expect(contrast.scaffoldBackgroundColor, _contrastBackground);
      expect(contrast.colorScheme.primary, _contrastPrimary);
      // White on #FF8080 is unreadable; the lighter red takes black labels.
      expect(contrast.colorScheme.onPrimary, Colors.black);

      resetPalette();
      // Crimson's #D9534F is 3.96:1 with white and 5.30:1 with black, so the
      // measured rule takes black here too. `palette_contrast_test` checks the
      // same pair for every palette.
      expect(lockedInTheme().colorScheme.onPrimary, Colors.black);
    });
  });

  group('settings theme picker', () {
    testWidgets('Enter opens the catalogue and saves the chosen theme', (
      tester,
    ) async {
      final saved = <Map<String, dynamic>>[];
      await _pumpSettings(
        tester,
        SettingsPage(
          settings: _settings(),
          loading: false,
          onSaveSettings: (patch) async => saved.add(patch),
        ),
      );

      await _selectRow(tester, 'theme');
      expect(_markedRow('theme'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      // The whole catalogue is visible, with the stored id marked in use.
      for (final label in [
        'LockedIn Crimson',
        'High Contrast',
        'Claude Code',
        'Codex',
        'Custom palette',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.text('in use'), findsOneWidget);

      // Down once lands on High Contrast; Enter applies it.
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(saved, [
        {
          'ui': {'theme': 'high-contrast'},
        },
      ]);
      expect(activeThemeId, 'high-contrast');
      expect(find.text('High Contrast'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('choosing the theme already in use writes nothing', (
      tester,
    ) async {
      final saved = <Map<String, dynamic>>[];
      await _pumpSettings(
        tester,
        SettingsPage(
          settings: _settings(),
          loading: false,
          onSaveSettings: (patch) async => saved.add(patch),
        ),
      );

      await _selectRow(tester, 'theme');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(saved, isEmpty);
      expect(find.text('already using LockedIn Crimson'), findsOneWidget);
    });

    testWidgets('Esc closes the picker without a write', (tester) async {
      final saved = <Map<String, dynamic>>[];
      await _pumpSettings(
        tester,
        SettingsPage(
          settings: _settings(),
          loading: false,
          onSaveSettings: (patch) async => saved.add(patch),
        ),
      );

      await _selectRow(tester, 'theme');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(saved, isEmpty);
      expect(find.text('High Contrast'), findsNothing);
      expect(activeThemeId, 'lockedin');
    });

    testWidgets('an unknown stored id starts the picker on crimson', (
      tester,
    ) async {
      final saved = <Map<String, dynamic>>[];
      await _pumpSettings(
        tester,
        SettingsPage(
          settings: _settings(theme: 'crimson'),
          loading: false,
          onSaveSettings: (patch) async => saved.add(patch),
        ),
      );

      await _selectRow(tester, 'theme');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(saved, [
        {
          'ui': {'theme': 'lockedin'},
        },
      ]);
    });

    testWidgets('without a save callback the row stays read-only', (
      tester,
    ) async {
      await _pumpSettings(
        tester,
        SettingsPage(settings: _settings(), loading: false),
      );

      await _selectRow(tester, 'theme');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('High Contrast'), findsNothing);
      expect(_markedRow('theme'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a rejected write keeps the old theme and shows the reason', (
      tester,
    ) async {
      resetPalette();
      await _pumpSettings(
        tester,
        SettingsPage(
          settings: _settings(),
          loading: false,
          onSaveSettings: (patch) async => throw const RpcException(
            -32000,
            'the config could not be written',
          ),
        ),
      );

      await _selectRow(tester, 'theme');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('the config could not be written'), findsOneWidget);
      expect(activeThemeId, 'lockedin');
      expect(tester.takeException(), isNull);
    });
  });

  group('app', () {
    testWidgets('a high-contrast store theme renders the shell', (
      tester,
    ) async {
      final store = await _pumpApp(tester, core: _ThemeCore());
      expect(store.settings?.theme, 'high-contrast');
      expect(activeThemeId, 'high-contrast');
      expect(LockedInColors.background, _contrastBackground);

      expect(find.text('LOCKEDIN'), findsWidgets);
      expect(find.text('Chill'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a Settings theme write repaints the app', (tester) async {
      final store = await _pumpApp(tester, core: _ThemeCore(theme: 'lockedin'));
      expect(activeThemeId, 'lockedin');

      await _expandSidebar(tester);
      await tester.tap(find.text('Settings'));
      await tester.pumpAndSettle();
      expect(find.text('SETTINGS'), findsWidgets);

      await _selectRow(tester, 'theme');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      // The picker lists the catalogue; the second entry is High Contrast.
      expect(find.text('High Contrast'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(store.settings?.theme, 'high-contrast');
      expect(activeThemeId, 'high-contrast');
      expect(LockedInColors.background, _contrastBackground);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the high-contrast shell has no overflow at 800x600', (
      tester,
    ) async {
      await _pumpApp(tester, core: _ThemeCore(), size: const Size(800, 600));
      expect(activeThemeId, 'high-contrast');
      expect(tester.takeException(), isNull);

      // The sidebar collapses to icons below 900 px, so the shell's own
      // shortcut is the way in at this width (`Settings` is the tenth surface).
      await openSurface(tester, 0);

      expect(find.text('SETTINGS'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });
}
