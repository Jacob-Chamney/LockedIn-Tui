import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// A Work detail wired to the real [CoreStore] and the [FakeCore], exactly like
/// the shell: the page reads the store's `work.open` projection and every edit
/// goes back through `work.agent.*`.
class WorkHarness {
  WorkHarness(this.core, this.store);

  final FakeCore core;
  final CoreStore store;
}

Future<WorkHarness> pumpDetail(
  WidgetTester tester, {
  String projectId = FakeCore.projectId,
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final core = FakeCore();
  final store = CoreStore(connection: core);
  addTearDown(store.dispose);
  await store.start();
  await store.refreshProjects();
  await store.openProject(projectId);

  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: AnimatedBuilder(
          animation: store,
          builder: (context, _) {
            final project = store.activeProject;
            if (project == null) return const SizedBox.shrink();
            return WorkDetailView(
              project: project,
              onSaveAgent: (agent) => store.saveAgent(projectId, agent),
              onDeleteAgent: (agentId) => store.deleteAgent(projectId, agentId),
              onSetDefaultAgent: (agentId) =>
                  store.setDefaultAgent(projectId, agentId),
            );
          },
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return WorkHarness(core, store);
}

/// The agent row the cursor is on. The selected marker is a `ValueKey`, so the
/// assertion names the row's text rather than a private widget type.
Finder selectedRow(String text) => find.descendant(
  of: find.byKey(const ValueKey('agent-row-selected')),
  matching: find.text(text),
);

void main() {
  testWidgets('the detail lists agents with permissions and the default', (
    tester,
  ) async {
    await pumpDetail(tester);

    expect(find.text('AGENTS'), findsOneWidget);
    expect(find.text('Reviewer'), findsOneWidget);
    expect(find.text('Review only.'), findsOneWidget);
    // Colour is never the only signal: every capability is also a word.
    expect(find.text('read-only'), findsOneWidget);
    expect(find.text('no command'), findsOneWidget);
    expect(find.text('default'), findsOneWidget);
    expect(find.textContaining('role: reviewer'), findsOneWidget);
    expect(find.textContaining('model: project default'), findsOneWidget);
    // The card teaches the keys that work here.
    expect(
      find.text('a new · Enter edit · d delete · m default'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the selection moves between agents with j/k and the arrows', (
    tester,
  ) async {
    await pumpDetail(tester, projectId: FakeCore.archivedProjectId);

    expect(selectedRow('Builder'), findsOneWidget);
    expect(selectedRow('Tester'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    expect(selectedRow('Tester'), findsOneWidget);
    expect(selectedRow('Builder'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(selectedRow('Builder'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a creates a profile with no id and the new agent appears', (
    tester,
  ) async {
    final harness = await pumpDetail(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(find.text('new agent'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('agent-name')), 'Planner');
    await tester.enterText(find.byKey(const ValueKey('agent-role')), 'planner');
    await tester.enterText(
      find.byKey(const ValueKey('agent-model')),
      'openai/gpt-4.1-mini',
    );
    await tester.enterText(
      find.byKey(const ValueKey('agent-max-tool-calls')),
      '12',
    );
    await tester.enterText(
      find.byKey(const ValueKey('agent-tools')),
      'read_file, search_files',
    );
    await tester.tap(find.byKey(const ValueKey('agent-save')));
    await tester.pumpAndSettle();

    final sent = harness.core.agentSaves.single;
    expect(sent.containsKey('id'), isFalse, reason: 'create omits the id');
    expect(sent['name'], 'Planner');
    expect(sent['role'], 'planner');
    expect(sent['model'], 'openai/gpt-4.1-mini');
    expect(sent['maxToolCalls'], 12);
    expect(sent['allowedTools'], ['read_file', 'search_files']);
    expect(sent['allowWrite'], isFalse);
    expect(sent['allowCommand'], isFalse);

    expect(find.text('new agent'), findsNothing);
    expect(find.text('Planner'), findsOneWidget);
    expect(selectedRow('Planner'), findsOneWidget);
    expect(harness.store.activeProject?.agents, hasLength(2));
    expect(harness.store.error, isNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter edits the selected profile and keeps its id', (
    tester,
  ) async {
    final harness = await pumpDetail(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('edit agent'), findsOneWidget);
    final nameField = tester.widget<TextField>(
      find.byKey(const ValueKey('agent-name')),
    );
    expect(
      nameField.controller?.text,
      'Reviewer',
      reason: 'the editor opens on the saved profile',
    );

    await tester.enterText(
      find.byKey(const ValueKey('agent-name')),
      'Code Reviewer',
    );
    await tester.tap(find.byKey(const ValueKey('agent-save')));
    await tester.pumpAndSettle();

    expect(harness.core.agentSaves.single['id'], 'reviewer-9ab12c');
    expect(harness.core.agentSaves.single['name'], 'Code Reviewer');
    expect(find.text('Code Reviewer'), findsOneWidget);
    expect(find.text('Reviewer'), findsNothing);
    // The update keeps the default that already pointed at this profile.
    expect(harness.store.activeProject?.defaultAgent, 'reviewer-9ab12c');
    expect(find.text('default'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('d confirms by name and a deleted default is cleared', (
    tester,
  ) async {
    final harness = await pumpDetail(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    expect(find.text('delete agent'), findsOneWidget);
    expect(find.text('Delete “Reviewer”?'), findsOneWidget);

    // Cancelling removes nothing.
    await tester.tap(find.byKey(const ValueKey('agent-delete-cancel')));
    await tester.pumpAndSettle();
    expect(harness.core.agentDeletes, isEmpty);
    expect(find.text('Reviewer'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('agent-delete-confirm')));
    await tester.pumpAndSettle();

    expect(harness.core.agentDeletes, ['reviewer-9ab12c']);
    expect(harness.store.activeProject?.agents, isEmpty);
    expect(harness.store.activeProject?.defaultAgent, isNull);
    expect(find.text('Reviewer'), findsNothing);
    expect(find.text('default'), findsNothing);
    expect(find.text('no agents yet'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('m sets and then clears the project default', (tester) async {
    final harness = await pumpDetail(
      tester,
      projectId: FakeCore.archivedProjectId,
    );
    expect(harness.store.activeProject?.defaultAgent, isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
    await tester.pumpAndSettle();

    expect(harness.core.agentDefaults, ['builder-3cd45e']);
    expect(harness.store.activeProject?.defaultAgent, 'builder-3cd45e');
    expect(selectedRow('default'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyM);
    await tester.pumpAndSettle();

    expect(harness.core.agentDefaults, ['builder-3cd45e', null]);
    expect(harness.store.activeProject?.defaultAgent, isNull);
    expect(find.text('default'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a refused save stays in the dialog with the core sentence', (
    tester,
  ) async {
    final harness = await pumpDetail(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    // "Reviewer" is already used in this project, so the core refuses it.
    await tester.enterText(
      find.byKey(const ValueKey('agent-name')),
      'Reviewer',
    );
    await tester.tap(find.byKey(const ValueKey('agent-save')));
    await tester.pumpAndSettle();

    expect(find.text('new agent'), findsOneWidget);
    expect(
      find.text('an agent named "Reviewer" already exists in this project'),
      findsOneWidget,
    );
    expect(harness.store.activeProject?.agents, hasLength(1));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('new agent'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the detail and its editor fit 800x600 and a narrow window', (
    tester,
  ) async {
    await pumpDetail(tester);
    expect(find.text('SUMMARY'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(find.text('new agent'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // The same detail in a narrow window keeps the row layout intact.
    await pumpDetail(
      tester,
      projectId: FakeCore.archivedProjectId,
      size: const Size(480, 600),
    );
    expect(find.text('Tester'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
