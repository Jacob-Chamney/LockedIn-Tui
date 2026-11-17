import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/core_scope.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/work/agent_dialog.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The agent editor wired to the real [CoreStore] for its template read, with a
/// local saver so a test asserts the exact `work.agent.save` payload the dialog
/// would send.
class TemplateHarness {
  TemplateHarness(this.core, this.store, this.saved);

  final FakeCore core;
  final CoreStore store;
  final List<Map<String, dynamic>> saved;
}

/// The seeded profile the edit-mode cases open on.
AgentProfileView seededReviewer() => const AgentProfileView(
  id: 'reviewer-9ab12c',
  name: 'Reviewer',
  role: 'reviewer',
  instructions: 'Review only.',
  model: '',
  maxToolCalls: 8,
  allowedTools: ['list_files', 'read_file', 'search_files'],
  allowWrite: false,
  allowCommand: false,
  template: '',
);

/// Pump the Work detail's editor over a started store, then open it.
///
/// [withScope] false pumps the same dialog with **no** `CoreScope`, which is the
/// documented read-only state: the Templates row cannot read and must not invent
/// a template.
Future<TemplateHarness> pumpEditor(
  WidgetTester tester, {
  AgentProfileView? agent,
  bool withScope = true,
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
  await store.openProject(FakeCore.projectId);

  final saved = <Map<String, dynamic>>[];
  Future<String> save(AgentProfileView profile) async {
    saved.add(profile.toSaveJson());
    return profile.id.isEmpty ? 'created-000001' : profile.id;
  }

  final home = Builder(
    builder: (context) => Scaffold(
      body: Center(
        child: TextButton(
          key: const ValueKey('open-agent-editor'),
          onPressed: () =>
              unawaited(showAgentEditor(context, agent: agent, onSave: save)),
          child: const Text('open editor'),
        ),
      ),
    ),
  );

  await tester.pumpWidget(
    withScope
        ? CoreScope(
            store: store,
            child: MaterialApp(theme: lockedInTheme(), home: home),
          )
        : MaterialApp(theme: lockedInTheme(), home: home),
  );
  await tester.tap(find.byKey(const ValueKey('open-agent-editor')));
  await tester.pumpAndSettle();
  return TemplateHarness(core, store, saved);
}

/// The text a labelled field currently holds.
String fieldText(WidgetTester tester, String key) {
  final field = tester.widget<TextField>(find.byKey(ValueKey(key)));
  return field.controller?.text ?? '';
}

Future<void> openPicker(WidgetTester tester) async {
  // The Templates row lives below the fold of the editor's scroll view, so it
  // is scrolled into view before the tap — exactly what a user does.
  await tester.pumpAndSettle();
  final browse = find.byKey(const ValueKey('agent-templates'));
  await tester.ensureVisible(browse);
  await tester.pumpAndSettle();
  await tester.tap(browse);
  await tester.pumpAndSettle();
  expect(
    find.byKey(const ValueKey('template-picker-cancel')),
    findsOneWidget,
    reason: 'the Templates row should open the picker',
  );
}

Future<void> chooseTemplate(WidgetTester tester, String id) async {
  final row = find.byKey(ValueKey('template-row-$id'));
  await tester.ensureVisible(row);
  await tester.pumpAndSettle();
  await tester.tap(row);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the picker lists the built-ins and the project template', (
    tester,
  ) async {
    final harness = await pumpEditor(tester);

    // The row says what it has before the picker opens.
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('agent-templates-hint')))
          .data,
      '3 built-in · 1 project',
    );

    await openPicker(tester);
    expect(find.text('templates'), findsWidgets);
    for (final id in [
      'reviewer',
      'implementer',
      'researcher',
      'pair-programmer',
    ]) {
      expect(find.byKey(ValueKey('template-row-$id')), findsOneWidget);
    }
    // Where a row came from is a word, never only an icon or a colour.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('template-row-reviewer')),
        matching: find.text('built-in'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('template-row-pair-programmer')),
        matching: find.text('project'),
      ),
      findsOneWidget,
    );
    expect(
      find.text('Work one small step at a time and explain each edit.'),
      findsOneWidget,
    );
    // The read was scoped to the open project.
    expect(harness.core.workTemplateQueries, [
      {'projectId': FakeCore.projectId},
    ]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('choosing a template fills the fields it carries', (
    tester,
  ) async {
    final harness = await pumpEditor(tester);
    await openPicker(tester);
    await chooseTemplate(tester, 'pair-programmer');

    // A new profile had nothing set, so this fills silently: a template's job.
    expect(find.text('replace fields?'), findsNothing);
    expect(fieldText(tester, 'agent-name'), 'Pair programmer');
    expect(fieldText(tester, 'agent-role'), 'pair');
    expect(
      fieldText(tester, 'agent-instructions'),
      'Work one small step at a time and explain each edit.',
    );
    expect(fieldText(tester, 'agent-max-tool-calls'), '6');
    expect(fieldText(tester, 'agent-tools'), 'read_file, search_files');
    // The id is recorded in the free-string field; the save path is unchanged.
    expect(fieldText(tester, 'agent-template'), 'pair-programmer');

    await tester.tap(find.byKey(const ValueKey('agent-save')));
    await tester.pumpAndSettle();
    final sent = harness.saved.single;
    expect(sent['name'], 'Pair programmer');
    expect(sent['role'], 'pair');
    expect(
      sent['instructions'],
      'Work one small step at a time and explain each edit.',
    );
    expect(sent['maxToolCalls'], 6);
    expect(sent['allowedTools'], ['read_file', 'search_files']);
    expect(sent['template'], 'pair-programmer');
    // A template seeds fields; it never grants a capability.
    expect(sent['allowWrite'], isFalse);
    expect(sent['allowCommand'], isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a pick that would replace set fields asks first and cancel keeps them',
    (tester) async {
      await pumpEditor(tester, agent: seededReviewer());
      await openPicker(tester);
      await chooseTemplate(tester, 'pair-programmer');

      expect(find.text('replace fields?'), findsOneWidget);
      // The confirmation names the fields, with both values.
      for (final key in [
        'template-replace-name',
        'template-replace-role',
        'template-replace-instructions',
        'template-replace-max tool calls',
        'template-replace-allowed tools',
      ]) {
        expect(find.byKey(ValueKey(key)), findsOneWidget);
      }
      expect(
        find.textContaining('name: Reviewer → Pair programmer'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('template-replace-cancel')));
      await tester.pumpAndSettle();

      // Cancelling replaces nothing, including the template id.
      expect(fieldText(tester, 'agent-name'), 'Reviewer');
      expect(fieldText(tester, 'agent-role'), 'reviewer');
      expect(fieldText(tester, 'agent-instructions'), 'Review only.');
      expect(fieldText(tester, 'agent-max-tool-calls'), '8');
      expect(
        fieldText(tester, 'agent-tools'),
        'list_files, read_file, search_files',
      );
      expect(fieldText(tester, 'agent-template'), '');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('confirming the replacement applies every field', (tester) async {
    await pumpEditor(tester, agent: seededReviewer());
    await openPicker(tester);
    await chooseTemplate(tester, 'pair-programmer');
    await tester.tap(find.byKey(const ValueKey('template-replace-confirm')));
    await tester.pumpAndSettle();

    expect(fieldText(tester, 'agent-name'), 'Pair programmer');
    expect(fieldText(tester, 'agent-role'), 'pair');
    expect(fieldText(tester, 'agent-max-tool-calls'), '6');
    expect(fieldText(tester, 'agent-tools'), 'read_file, search_files');
    expect(fieldText(tester, 'agent-template'), 'pair-programmer');
    // The capability switches are not part of a template pick.
    final write = tester.widget<Switch>(
      find.byKey(const ValueKey('agent-allow-write')),
    );
    expect(write.value, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a typed field is protected and an untouched one is filled', (
    tester,
  ) async {
    await pumpEditor(tester);
    await tester.enterText(find.byKey(const ValueKey('agent-name')), 'Planner');
    await openPicker(tester);
    await chooseTemplate(tester, 'reviewer');

    // Only the field the user typed is listed; empty fields fill silently.
    expect(find.text('replace fields?'), findsOneWidget);
    expect(find.byKey(const ValueKey('template-replace-name')), findsOneWidget);
    expect(find.byKey(const ValueKey('template-replace-role')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('template-replace-confirm')));
    await tester.pumpAndSettle();
    expect(fieldText(tester, 'agent-name'), 'Reviewer');
    expect(fieldText(tester, 'agent-role'), 'reviewer');
    expect(tester.takeException(), isNull);
  });

  testWidgets('without a reader the Templates row is read-only', (
    tester,
  ) async {
    await pumpEditor(tester, withScope: false);

    final browse = tester.widget<TextButton>(
      find.byKey(const ValueKey('agent-templates')),
    );
    expect(browse.onPressed, isNull);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('agent-templates-hint')))
          .data,
      contains('read-only'),
    );
    // The editor itself still saves normally; only the picker is unavailable.
    await tester.enterText(find.byKey(const ValueKey('agent-name')), 'Planner');
    await tester.tap(find.byKey(const ValueKey('agent-save')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the editor and the picker fit 800x600', (tester) async {
    await pumpEditor(tester, size: const Size(800, 600));
    expect(find.text('new agent'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await openPicker(tester);
    expect(
      find.byKey(const ValueKey('template-row-pair-programmer')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const ValueKey('template-picker-cancel')));
    await tester.pumpAndSettle();
    expect(find.text('templates'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
