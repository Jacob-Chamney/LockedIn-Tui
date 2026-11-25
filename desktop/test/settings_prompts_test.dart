import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'settings_test.dart' show populatedSettings;

const _prompts = [
  PromptNoteView(
    id: 'measure',
    label: 'measure and plan',
    description: 'What the harness asks before it plans a route.',
    note: '',
    custom: false,
  ),
  PromptNoteView(
    id: 'step',
    label: 'teach one step',
    description: 'The prose and check for one reasoning step.',
    note: 'prefer one concrete example',
    custom: true,
  ),
];

Future<void> _pump(
  WidgetTester tester, {
  required Future<void> Function(String id, String text) onSetPrompt,
}) async {
  tester.view.physicalSize = const Size(1280, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: SettingsPage(
          settings: populatedSettings(),
          loading: false,
          prompts: _prompts,
          onSetPrompt: onSetPrompt,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a prompt row says whether it is default or custom', (
    tester,
  ) async {
    await _pump(tester, onSetPrompt: (_, _) async {});
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('settings-row-prompt-measure')),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('no note'), findsWidgets);
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('settings-row-prompt-step')),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('custom'), findsWidgets);
  });

  testWidgets('Enter edits the note and save writes it', (tester) async {
    String? savedId;
    String? savedText;
    await _pump(
      tester,
      onSetPrompt: (id, text) async {
        savedId = id;
        savedText = text;
      },
    );
    final row = find.byKey(const ValueKey('settings-row-prompt-measure'));
    await tester.scrollUntilVisible(
      row,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(row);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('prompt-note-input')), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('prompt-note-input')),
      'use short sentences',
    );
    await tester.tap(find.byKey(const ValueKey('prompt-note-save')));
    await tester.pumpAndSettle();

    expect(savedId, 'measure');
    expect(savedText, 'use short sentences');
  });
}
