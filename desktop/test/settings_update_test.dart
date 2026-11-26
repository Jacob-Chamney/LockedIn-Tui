import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'settings_test.dart' show populatedSettings;

Future<void> _pump(WidgetTester tester, Widget page) async {
  tester.view.physicalSize = const Size(1280, 800);
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

Finder _row(String id) => find.byKey(ValueKey('settings-row-$id'));

void main() {
  testWidgets(
    'the updates row reports an available build and checks on Enter',
    (tester) async {
      var checked = 0;
      await _pump(
        tester,
        SettingsPage(
          settings: populatedSettings(),
          loading: false,
          appVersion: '2026.11.12',
          update: const UpdateView(
            current: '2026.11.12',
            kind: 'available',
            version: '2026.12.1',
            url: 'https://github.com/a/b/releases/tag/v2026.12.1',
          ),
          onCheckUpdate: () => checked += 1,
        ),
      );

      await tester.scrollUntilVisible(
        _row('updates'),
        240,
        scrollable: find.descendant(
          of: find.byKey(const ValueKey('settings-scroll')),
          matching: find.byType(Scrollable),
        ),
      );
      expect(find.text('2026.11.12'), findsWidgets);
      expect(find.text('v2026.12.1 available'), findsOneWidget);

      await tester.tap(_row('updates'));
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();

      expect(checked, 1);
    },
  );

  testWidgets('the row distinguishes checking, current and failure', (
    tester,
  ) async {
    await _pump(
      tester,
      SettingsPage(
        settings: populatedSettings(),
        loading: false,
        appVersion: '2026.11.12',
        update: const UpdateView(current: '2026.11.12', kind: 'checking'),
        updateChecking: true,
      ),
    );
    await tester.scrollUntilVisible(
      _row('updates'),
      240,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('settings-scroll')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(find.text('checking…'), findsOneWidget);

    await _pump(
      tester,
      SettingsPage(
        settings: populatedSettings(),
        loading: false,
        appVersion: '2026.11.12',
        update: const UpdateView(
          current: '2026.11.12',
          kind: 'current',
          latest: '2026.11.12',
        ),
      ),
    );
    await tester.scrollUntilVisible(
      _row('updates'),
      240,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('settings-scroll')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(find.text('up to date'), findsOneWidget);

    await _pump(
      tester,
      SettingsPage(
        settings: populatedSettings(),
        loading: false,
        updateError: 'the request timed out',
      ),
    );
    await tester.scrollUntilVisible(
      _row('updates'),
      240,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('settings-scroll')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(find.text('check failed'), findsOneWidget);
  });

  testWidgets('before a read the version row is honest', (tester) async {
    await _pump(
      tester,
      SettingsPage(settings: populatedSettings(), loading: false),
    );
    await tester.scrollUntilVisible(
      _row('app-version'),
      240,
      scrollable: find.descendant(
        of: find.byKey(const ValueKey('settings-scroll')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(find.text('not read'), findsOneWidget);
    expect(find.text('not checked'), findsOneWidget);
  });
}
