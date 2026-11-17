import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _reviewerRow = ProjectAgent(
  id: 'reviewer-9ab12c',
  name: 'Reviewer',
  task: 'Review only.',
  model: '',
  permissions: 'read-only',
);

const _builderRow = ProjectAgent(
  id: 'builder-3cd45e',
  name: 'Builder',
  task: 'Build the small pieces.',
  model: 'openai/gpt-4.1-mini',
  permissions: 'read-only',
);

const _testerRow = ProjectAgent(
  id: 'tester-5ef67a',
  name: 'Tester',
  task: 'Check the result.',
  model: '',
  permissions: 'read-only',
);

const _projects = <ProjectRow>[
  ProjectRow(
    id: 'my-app-4f2a1c',
    name: 'My app',
    folder: '/home/me/Projects/my-app',
    mode: 'chat',
    swarmName: '',
    archived: false,
    agents: [_reviewerRow],
  ),
  ProjectRow(
    id: 'api-service-7c1d2e',
    name: 'API service',
    folder: '/home/me/Projects/api-service',
    mode: 'swarm',
    swarmName: 'Review crew',
    archived: true,
    agents: [_builderRow, _testerRow],
  ),
];

const _detail = WorkProjectDetail(
  id: 'my-app-4f2a1c',
  name: 'My app',
  root: '/home/me/Projects/my-app',
  rootMissing: false,
  mode: 'chat',
  swarmName: '',
  archived: false,
  instructions: 'Prefer small diffs.',
  defaultAgent: 'reviewer-9ab12c',
  agents: [
    AgentProfileView(
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
    ),
  ],
  tasks: 3,
  hasGit: true,
  lastOpened: '2026-11-14T09:12:00Z',
);

const _missingDetail = WorkProjectDetail(
  id: 'api-service-7c1d2e',
  name: 'API service',
  root: '/home/me/Projects/api-service',
  rootMissing: true,
  mode: 'swarm',
  swarmName: 'Review crew',
  archived: true,
  instructions: '',
  defaultAgent: null,
  agents: [],
  tasks: 0,
  hasGit: false,
  lastOpened: '',
);

Future<void> pumpWork(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pump();
}

void main() {
  group('WorkPage', () {
    testWidgets('renders the header, both projects and their metadata', (
      tester,
    ) async {
      await pumpWork(
        tester,
        const WorkPage(projects: _projects, loading: false),
      );

      expect(find.text('WORK PROJECTS'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('My app'), findsOneWidget);
      expect(find.text('API service'), findsOneWidget);
      expect(find.text('/home/me/Projects/my-app'), findsOneWidget);
      expect(find.text('/home/me/Projects/api-service'), findsOneWidget);
      expect(find.text('chat'), findsOneWidget);
      expect(find.text('swarm'), findsOneWidget);
      expect(find.text('1 agent'), findsOneWidget);
      expect(find.text('2 agents'), findsOneWidget);
      // Only the archived project carries the badge, and the word is a second
      // signal beside the colour.
      expect(find.text('archived'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('empty state teaches the next action', (tester) async {
      await pumpWork(
        tester,
        const WorkPage(projects: <ProjectRow>[], loading: false),
      );

      expect(find.text('no projects yet'), findsOneWidget);
      expect(find.text('n registers one'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('loading and error states are stated, never blank', (
      tester,
    ) async {
      await pumpWork(
        tester,
        const WorkPage(projects: <ProjectRow>[], loading: true),
      );
      expect(find.text('loading projects…'), findsOneWidget);

      var retries = 0;
      await pumpWork(
        tester,
        WorkPage(
          projects: const <ProjectRow>[],
          loading: false,
          error: 'could not read the projects folder',
          onRefresh: () => retries++,
        ),
      );
      expect(find.text('could not read the projects folder'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await tester.pump();
      expect(retries, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('arrows move the selection and Enter opens that project', (
      tester,
    ) async {
      final opened = <ProjectRow>[];
      await pumpWork(
        tester,
        WorkPage(projects: _projects, loading: false, onOpen: opened.add),
      );

      // The first row is selected without any input.
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('project-row-selected')),
          matching: find.text('My app'),
        ),
        findsOneWidget,
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('project-row-selected')),
          matching: find.text('API service'),
        ),
        findsOneWidget,
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(opened.single.id, 'api-service-7c1d2e');
      expect(tester.takeException(), isNull);
    });

    testWidgets('n opens the create dialog and sends name, folder and mode', (
      tester,
    ) async {
      final calls = <Map<String, dynamic>>[];
      await pumpWork(
        tester,
        WorkPage(
          projects: const <ProjectRow>[],
          loading: false,
          onCreate:
              ({
                required String name,
                required String folder,
                required String mode,
              }) async {
                calls.add({'name': name, 'folder': folder, 'mode': mode});
                return WorkCreateResult(id: 'docs-site-4f2a1c', name: name);
              },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(find.text('register a project'), findsOneWidget);

      // Validation is inline and the core is not called with an empty form.
      await tester.tap(find.byKey(const ValueKey('project-create')));
      await tester.pump();
      expect(find.text('a project needs a name'), findsOneWidget);
      expect(calls, isEmpty);

      await tester.enterText(
        find.byKey(const ValueKey('project-name')),
        'Docs site',
      );
      await tester.enterText(
        find.byKey(const ValueKey('project-folder')),
        '/home/me/Projects/docs-site',
      );
      await tester.tap(find.text('swarm'));
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('project-create')));
      await tester.pumpAndSettle();

      expect(calls.single, {
        'name': 'Docs site',
        'folder': '/home/me/Projects/docs-site',
        'mode': 'swarm',
      });
      expect(find.text('register a project'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a core refusal stays in the dialog with its own sentence', (
      tester,
    ) async {
      await pumpWork(
        tester,
        WorkPage(
          projects: const <ProjectRow>[],
          loading: false,
          onCreate:
              ({
                required String name,
                required String folder,
                required String mode,
              }) async {
                throw const RpcException(-32000, 'registration refused', {
                  'kind': 'project-create',
                  'message': 'could not register the folder: permission denied',
                });
              },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('project-name')),
        'Docs site',
      );
      await tester.enterText(
        find.byKey(const ValueKey('project-folder')),
        '/home/me/Projects/reject',
      );
      await tester.tap(find.byKey(const ValueKey('project-create')));
      await tester.pumpAndSettle();

      expect(find.text('register a project'), findsOneWidget);
      expect(
        find.text('could not register the folder: permission denied'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('the list fits 800x600 without overflow', (tester) async {
      await pumpWork(
        tester,
        const WorkPage(projects: _projects, loading: false),
        size: const Size(800, 600),
      );

      expect(find.text('My app'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('WorkDetailView', () {
    testWidgets(
      'shows root, instructions, agents, tasks, git and last opened',
      (tester) async {
        await pumpWork(tester, const WorkDetailView(project: _detail));

        expect(find.text('My app'), findsOneWidget);
        expect(find.text('/home/me/Projects/my-app'), findsOneWidget);
        expect(find.text('registered'), findsOneWidget);
        expect(find.text('INSTRUCTIONS'), findsOneWidget);
        expect(find.text('Prefer small diffs.'), findsOneWidget);
        expect(find.text('AGENTS'), findsOneWidget);
        expect(find.text('Reviewer'), findsOneWidget);
        expect(find.text('Review only.'), findsOneWidget);
        expect(find.text('read-only'), findsOneWidget);
        expect(find.text('default'), findsOneWidget);
        expect(find.textContaining('model: project default'), findsOneWidget);
        expect(find.text('tasks'), findsOneWidget);
        expect(find.text('3'), findsOneWidget);
        expect(find.text('repository present'), findsOneWidget);
        expect(find.text('opened 2026-11-14 09:12'), findsWidgets);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('a missing root warns and the metadata still opens', (
      tester,
    ) async {
      await pumpWork(tester, const WorkDetailView(project: _missingDetail));

      expect(find.text('API service'), findsOneWidget);
      expect(find.text('missing'), findsOneWidget);
      expect(find.text('the project folder is missing'), findsOneWidget);
      expect(find.text('archived'), findsWidgets);
      expect(find.text('swarm'), findsWidgets);
      expect(find.text('Review crew'), findsOneWidget);
      expect(find.text('no project instructions yet'), findsOneWidget);
      expect(find.text('no repository'), findsOneWidget);
      expect(find.text('not opened yet'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Esc returns to the project list', (tester) async {
      var backs = 0;
      await pumpWork(
        tester,
        WorkDetailView(project: _detail, onBack: () => backs++),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(backs, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the detail fits 800x600 without overflow', (tester) async {
      await pumpWork(
        tester,
        const WorkDetailView(project: _detail),
        size: const Size(800, 600),
      );

      expect(find.text('SUMMARY'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore work', () {
    test('refreshProjects projects the work.list rows', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.refreshProjects();

      expect(core.calls, contains('work.list'));
      expect(store.projects, hasLength(2));
      expect(store.projects.first.name, 'My app');
      expect(store.projects.first.mode, 'chat');
      expect(store.projects.first.agents.single.name, 'Reviewer');
      expect(store.projects.last.archived, isTrue);
      expect(store.projects.last.swarmName, 'Review crew');
      expect(store.activeProject, isNull);
    });

    test('openProject sets the detail and closeProject clears it', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();

      await store.openProject(FakeCore.projectId);

      expect(store.activeProjectId, FakeCore.projectId);
      expect(store.activeProject?.name, 'My app');
      expect(store.activeProject?.root, '/home/me/Projects/my-app');
      expect(store.activeProject?.defaultAgent, 'reviewer-9ab12c');
      expect(store.activeProject?.tasks, 3);
      expect(store.activeProject?.hasGit, isTrue);
      expect(store.error, isNull);

      store.closeProject();

      expect(store.activeProject, isNull);
      expect(store.activeProjectId, isNull);
    });

    test('a failed open keeps the previous project and reports once', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);

      await expectLater(store.openProject('missing-project'), completes);

      expect(store.error, 'project missing-project was not found');
      expect(store.activeProjectId, FakeCore.projectId);
      expect(store.activeProject?.name, 'My app');
    });

    test(
      'createProject sends the intent, refreshes and opens the result',
      () async {
        final core = FakeCore(withProjects: false);
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.refreshProjects();
        expect(store.projects, isEmpty);

        final created = await store.createProject(
          name: 'Docs site',
          folder: '/home/me/Projects/docs-site',
          mode: 'swarm',
        );

        expect(core.workCreates.single, {
          'name': 'Docs site',
          'folder': '/home/me/Projects/docs-site',
          'mode': 'swarm',
        });
        expect(store.projects.single.name, 'Docs site');
        expect(store.activeProjectId, created.id);
        expect(store.activeProject?.name, 'Docs site');
        expect(store.activeProject?.root, '/home/me/Projects/docs-site');
        expect(store.activeProject?.mode, 'swarm');
        expect(store.error, isNull);
      },
    );

    test('a rejected create rethrows and registers nothing', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshProjects();

      await expectLater(
        store.createProject(
          name: 'Docs site',
          folder: '/home/me/Projects/reject',
          mode: 'chat',
        ),
        throwsA(isA<RpcException>()),
      );

      expect(core.workCreates, isEmpty);
      expect(store.projects, hasLength(2));
      expect(store.activeProject, isNull);
    });

    test('Work models tolerate missing and malformed fields', () {
      final row = ProjectRow.fromJson(const <String, dynamic>{
        'id': 'x',
        'agents': [
          {'name': 'A'},
          'not-a-map',
        ],
      });
      expect(row.id, 'x');
      expect(row.name, '');
      expect(row.mode, '');
      expect(row.archived, isFalse);
      expect(row.agents, hasLength(1));
      expect(row.agents.single.permissions, '');
      expect(row.agents.single.readOnly, isFalse);

      final detail = WorkProjectDetail.fromJson(const <String, dynamic>{});
      expect(detail.id, '');
      expect(detail.rootMissing, isFalse);
      expect(detail.defaultAgent, isNull);
      expect(detail.agents, isEmpty);
      expect(detail.tasks, 0);
      expect(detail.hasGit, isFalse);

      final profile = AgentProfileView.fromJson(const <String, dynamic>{
        'allowedTools': ['read_file', 7],
      });
      expect(profile.allowedTools, ['read_file']);
      expect(profile.readOnly, isTrue);
    });
  });
}
