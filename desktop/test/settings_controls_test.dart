import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/keymap/registry.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The three row families whose chevron used to be a live button that did
/// nothing, and the modifier guard the page lacked.
///
/// Kept in its own file so the `settings_test` row-index map does not have to
/// grow: every test here finds its row by key.

SettingsView _settings() => const SettingsView(
  username: 'friend',
  theme: 'lockedin',
  chatModel: '',
  baseUrl: '',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 0,
  period: 'day',
  warnAt: 0.8,
  pauseAtLimit: false,
  dataDir: '/tmp/lockedin',
  archiveBackend: 'folder',
  archiveFolder: '',
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: [],
  hideHints: false,
  pluginDirs: [],
  disabledPlugins: [],
);

Future<void> _pump(WidgetTester tester, SettingsPage page) async {
  tester.view.physicalSize = const Size(1280, 900);
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

void main() {
  testWidgets('the chevron on the Work write switch flips it', (tester) async {
    var write = false;
    var calls = 0;
    await _pump(
      tester,
      SettingsPage(
        settings: _settings(),
        loading: false,
        workPermissions: WorkPermissions.off,
        onSetWorkPermissions: ({allowWrite, allowCommand}) async {
          calls += 1;
          write = allowWrite ?? write;
        },
        onSaveSettings: (patch) async {},
      ),
    );

    final row = find.byKey(
      const ValueKey('settings-activate-work-allow-write'),
    );
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();

    // Before the fix the chevron was enabled and `_activate()` fell through,
    // so a mouse user could never turn writes on.
    expect(calls, 1);
    expect(write, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the chevron on the decision toggle flips it', (tester) async {
    var nextEnabled = false;
    var calls = 0;
    await _pump(
      tester,
      SettingsPage(
        settings: _settings(),
        loading: false,
        decision: DecisionView.disabled,
        onSetDecision: ({bool? enabled, String? model}) async {
          calls += 1;
          nextEnabled = enabled ?? false;
        },
        onSaveSettings: (patch) async {},
      ),
    );

    final row = find.byKey(
      const ValueKey('settings-activate-decision-enabled'),
    );
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();

    expect(calls, 1);
    expect(nextEnabled, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the chevron on a keybind row starts the capture', (
    tester,
  ) async {
    final writes = <String?>[];
    await _pump(
      tester,
      SettingsPage(
        settings: _settings(),
        loading: false,
        keymap: KeymapRegistry(),
        onSetKeybind: (action, binding, {fixed = false}) async {
          writes.add(binding);
        },
        onSaveSettings: (patch) async {},
      ),
    );

    final row = find.byKey(const ValueKey('settings-activate-keybind-close'));
    expect(row, findsOneWidget);
    await tester.ensureVisible(row);
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.pumpAndSettle();

    // The row now waits for a chord; the next key is stored, not run.
    expect(find.byKey(const ValueKey('keybind-capturing')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyQ);
    await tester.pumpAndSettle();
    expect(writes, ['q']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+C on the theme row does not write the theme', (
    tester,
  ) async {
    final patches = <Map<String, dynamic>>[];
    await _pump(
      tester,
      SettingsPage(
        settings: _settings(),
        loading: false,
        onSaveSettings: (patch) async => patches.add(patch),
      ),
    );

    // Cursor on THEME (second row), then the copy chord.
    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    // `c` alone applies the custom palette; with Ctrl it must be inert.
    expect(patches, isEmpty);
    expect(tester.takeException(), isNull);
  });
}
