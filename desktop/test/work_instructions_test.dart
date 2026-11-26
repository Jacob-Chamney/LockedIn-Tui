import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _project = WorkProjectDetail(
  id: 'my-app-4f2a1c',
  name: 'My app',
  root: '/home/me/Projects/my-app',
  rootMissing: false,
  mode: 'chat',
  swarmName: '',
  archived: false,
  instructions: 'Prefer small diffs.',
  defaultAgent: null,
  agents: <AgentProfileView>[],
  tasks: 0,
  hasGit: false,
  lastOpened: '2026-11-14T09:12:00Z',
);

Future<void> pump(
  WidgetTester tester, {
  Future<void> Function(String text)? onSave,
}) async {
  tester.view.physicalSize = const Size(1100, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: WorkDetailView(project: _project, onSaveInstructions: onSave),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('project instructions open in an editor and save', (
    tester,
  ) async {
    String? saved;
    await pump(tester, onSave: (text) async => saved = text);

    expect(find.text('Prefer small diffs.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('work-edit-instructions')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('work-instructions-field')),
      'Prefer even smaller diffs.',
    );
    await tester.tap(find.byKey(const ValueKey('work-instructions-save')));
    await tester.pumpAndSettle();

    expect(saved, 'Prefer even smaller diffs.');
    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('a refused save keeps the dialog and names the fix', (
    tester,
  ) async {
    await pump(
      tester,
      onSave: (_) async => throw const RpcException(
        -32000,
        'project instructions are at most 20000 characters',
      ),
    );

    await tester.tap(find.byKey(const ValueKey('work-edit-instructions')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('work-instructions-save')));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsOneWidget);
    expect(
      find.text('project instructions are at most 20000 characters'),
      findsOneWidget,
    );
  });

  testWidgets('the i key opens the instructions editor', (tester) async {
    await pump(tester, onSave: (_) async {});
    await tester.sendKeyEvent(LogicalKeyboardKey.keyI);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.text('project instructions'), findsOneWidget);
  });
}
