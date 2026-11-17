import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/work/swarm_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _project = WorkProjectDetail(
  id: FakeCore.projectId,
  name: 'My app',
  root: '/home/me/Projects/my-app',
  rootMissing: false,
  mode: 'swarm',
  swarmName: 'Review crew',
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
  tasks: 2,
  hasGit: true,
  lastOpened: '2026-11-15T10:00:00Z',
);

const _settled = SwarmBoardView(
  runId: FakeCore.swarmRunId,
  projectId: FakeCore.projectId,
  objective: 'Review the pagination change',
  status: 'failed',
  parallel: 2,
  startedAt: '2026-11-15T10:00:00.000Z',
  finishedAt: '2026-11-15T10:04:00.000Z',
  reportPath:
      '/home/me/LockedIn/work/projects/my-app-4f2a1c/reports/run-7c1a.md',
  live: false,
  tasks: [
    SwarmTaskRow(
      id: FakeCore.swarmTaskDoneId,
      title: 'Read the pagination code',
      agentId: 'reviewer-9ab12c',
      status: 'done',
      summary: 'Read src/pages.ts and noted the offset handling.',
    ),
    SwarmTaskRow(
      id: FakeCore.swarmTaskFailedId,
      title: 'Check the API tests',
      agentId: 'reviewer-9ab12c',
      status: 'failed',
      error: 'the provider rejected the request',
    ),
  ],
);

const _live = SwarmBoardView(
  runId: 'run-live-1',
  projectId: FakeCore.projectId,
  objective: 'Summarise the pagination change',
  status: 'running',
  parallel: 2,
  startedAt: '2026-11-16T09:00:00.000Z',
  live: true,
  tasks: [
    SwarmTaskRow(
      id: 'task-1',
      title: 'Read the routes',
      agentId: 'reviewer-9ab12c',
      status: 'running',
    ),
    SwarmTaskRow(
      id: 'task-2',
      title: 'Read the tests',
      agentId: 'reviewer-9ab12c',
      status: 'pending',
    ),
  ],
);

/// A settled board payload for an update event.
Map<String, dynamic> _updatedBoard() => {
  'runId': FakeCore.swarmRunId,
  'projectId': FakeCore.projectId,
  'objective': 'Review the pagination change',
  'status': 'done',
  'parallel': 2,
  'startedAt': '2026-11-15T10:00:00.000Z',
  'finishedAt': '2026-11-15T10:06:00.000Z',
  'reportPath':
      '/home/me/LockedIn/work/projects/my-app-4f2a1c/reports/run-7c1a.md',
  'live': false,
  'tasks': [
    {
      'id': 'task-1',
      'title': 'Read the pagination code',
      'agentId': 'reviewer-9ab12c',
      'status': 'done',
      'summary': 'Read src/pages.ts.',
    },
    {
      'id': 'task-2',
      'title': 'Check the API tests',
      'agentId': 'reviewer-9ab12c',
      'status': 'done',
      'summary': 'The tests pass.',
    },
  ],
};

Future<void> pumpSurface(
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

Future<CoreStore> pumpShell(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

const _digits = [
  LogicalKeyboardKey.digit1,
  LogicalKeyboardKey.digit2,
  LogicalKeyboardKey.digit3,
  LogicalKeyboardKey.digit4,
  LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6,
  LogicalKeyboardKey.digit7,
  LogicalKeyboardKey.digit8,
  LogicalKeyboardKey.digit9,
];

Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(_digits[digit - 1]);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

Future<void> openWorkProject(WidgetTester tester) async {
  await pressAlt(tester, 6);
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
}

void main() {
  group('swarm models', () {
    test('parse a documented board tolerantly', () {
      final board = SwarmBoardView.fromJson(_updatedBoard());
      expect(board.runId, FakeCore.swarmRunId);
      expect(board.status, 'done');
      expect(board.parallel, 2);
      expect(board.finishedAt, isNotNull);
      expect(board.reportPath, contains('run-7c1a.md'));
      expect(board.retryOf, isNull);
      expect(board.tasks, hasLength(2));
      expect(board.tasks.first.summary, 'Read src/pages.ts.');

      final retried = SwarmBoardView.fromJson({
        ..._updatedBoard(),
        'retryOf': {'runId': 'run-1', 'taskId': 'task-2'},
        'reportPath': null,
        'parallel': 'not-a-number',
        'tasks': 'not-a-list',
      });
      expect(retried.retryOf?.runId, 'run-1');
      expect(retried.retryOf?.taskId, 'task-2');
      expect(retried.reportPath, isNull);
      expect(retried.parallel, 0);
      expect(retried.tasks, isEmpty);
      expect(SwarmBoardView.fromJson(null).runId, '');
    });

    test('only failed and blocked tasks are retryable', () {
      SwarmTaskRow task(String status) => SwarmTaskRow(
        id: 'task-1',
        title: 'Read the code',
        agentId: 'reviewer-9ab12c',
        status: status,
      );
      expect(task('failed').retryable, isTrue);
      expect(task('blocked').retryable, isTrue);
      for (final status in ['pending', 'running', 'done', 'cancelled']) {
        expect(task(status).retryable, isFalse, reason: status);
      }
    });
  });

  group('CoreStore swarms', () {
    test('lists runs, opens a board and starts a new run', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.openProject(FakeCore.projectId);
      expect(core.calls, contains('work.swarm.runs'));
      expect(store.swarmRuns, hasLength(1));
      expect(store.swarmRuns.single.objective, 'Review the pagination change');
      expect(store.swarmError, isNull);

      final opened = await store.openSwarm(
        FakeCore.projectId,
        FakeCore.swarmRunId,
      );
      expect(opened, isTrue);
      expect(store.activeSwarmId, FakeCore.swarmRunId);
      expect(store.activeSwarm!.tasks, hasLength(2));
      expect(store.activeSwarm!.tasks.last.error, isNotNull);

      final result = await store.runSwarm(
        FakeCore.projectId,
        objective: 'Summarise the API',
        plan: const [
          SwarmPlanEntry(title: 'Read routes', assignment: 'read routes.ts'),
          SwarmPlanEntry(
            title: 'Check tests',
            assignment: 'check the tests',
            agentId: 'reviewer-9ab12c',
          ),
        ],
        parallel: 2,
      );

      expect(core.swarmRunRequests, hasLength(1));
      expect(core.swarmRunRequests.single['objective'], 'Summarise the API');
      expect(core.swarmRunRequests.single['parallel'], 2);
      expect(core.swarmRunRequests.single['plan'], hasLength(2));
      expect(store.activeSwarmId, result.runId);
      expect(store.activeSwarm!.live, isTrue);
      expect(store.swarmRuns.last.runId, result.runId);

      // The fake settles the run through `work.swarm.updated`.
      await Future<void>.delayed(const Duration(milliseconds: 30));
      await pumpEventQueue();
      expect(store.activeSwarm!.live, isFalse);
      expect(store.activeSwarm!.status, 'done');
      expect(store.activeSwarm!.reportPath, isNotNull);
    });

    test(
      'an update event refreshes the visible board and the run list',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);
        await store.openSwarm(FakeCore.projectId, FakeCore.swarmRunId);
        expect(store.activeSwarm!.status, 'failed');

        core.emitEvent('work.swarm.updated', {
          'projectId': FakeCore.projectId,
          'runId': FakeCore.swarmRunId,
          'board': _updatedBoard(),
        });
        await pumpEventQueue();

        expect(store.activeSwarm!.status, 'done');
        expect(store.swarmRuns.single.status, 'done');
        expect(store.activeSwarm!.tasks.last.status, 'done');
      },
    );

    test('cancel, remove and retry update only this project state', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);
      final started = await store.runSwarm(
        FakeCore.projectId,
        objective: 'Read the routes',
        plan: const [
          SwarmPlanEntry(title: 'Read routes', assignment: 'read routes.ts'),
        ],
      );

      await store.cancelSwarm(FakeCore.projectId, started.runId);
      expect(core.swarmCancels, [started.runId]);
      expect(store.activeSwarm!.status, 'cancelled');

      await store.removeSwarm(FakeCore.projectId, started.runId);
      expect(core.swarmRemoves, [started.runId]);
      expect(store.swarmRuns.any((run) => run.runId == started.runId), isFalse);
      expect(store.activeSwarmId, FakeCore.swarmRunId);

      final retried = await store.retrySwarmTask(
        FakeCore.projectId,
        FakeCore.swarmRunId,
        FakeCore.swarmTaskFailedId,
      );
      expect(core.swarmRetries.single, {
        'runId': FakeCore.swarmRunId,
        'taskId': FakeCore.swarmTaskFailedId,
      });
      expect(store.activeSwarmId, retried.runId);
      expect(store.activeSwarm!.retryOf?.taskId, FakeCore.swarmTaskFailedId);
    });

    test(
      'a refused swarm read is page-local, not a transport failure',
      () async {
        final core = FakeCore(
          swarmFailure: 'the swarm board could not be read',
        );
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();

        await store.openProject(FakeCore.projectId);
        expect(store.error, isNull);
        expect(store.activeProject, isNotNull);
        expect(store.swarmError, 'the swarm board could not be read');
        expect(store.swarmRuns, isEmpty);
      },
    );
  });

  group('SwarmPage', () {
    testWidgets('renders the board rows, statuses and summary', (tester) async {
      await pumpSurface(
        tester,
        const SwarmPage(project: _project, runs: [_settled], board: _settled),
      );

      expect(find.text('SWARM'), findsWidgets);
      expect(find.text('Review the pagination change'), findsOneWidget);
      expect(find.text('run run-7c1a'), findsOneWidget);
      expect(find.text('parallel 2'), findsOneWidget);
      expect(find.text('started 2026-11-15 10:00'), findsOneWidget);
      expect(find.text('finished 2026-11-15 10:04'), findsOneWidget);
      expect(find.text('failed'), findsOneWidget);
      expect(find.textContaining('run-7c1a.md'), findsOneWidget);
      expect(find.text('✓ done'), findsOneWidget);
      expect(find.text('× failed'), findsOneWidget);
      expect(find.text('Read the pagination code'), findsOneWidget);
      expect(
        find.text('Read src/pages.ts and noted the offset handling.'),
        findsOneWidget,
      );
      expect(find.text('the provider rejected the request'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a live run reads as running and offers no report yet', (
      tester,
    ) async {
      await pumpSurface(
        tester,
        const SwarmPage(project: _project, runs: [_live], board: _live),
      );

      expect(find.text('running'), findsWidgets);
      expect(find.text('report not written yet'), findsOneWidget);
      expect(find.text('▸ running'), findsOneWidget);
      expect(find.text('○ pending'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the run dialog validates locally and sends the parsed plan', (
      tester,
    ) async {
      final calls = <Map<String, dynamic>>[];
      Future<SwarmRunResult> create({
        required String objective,
        required List<SwarmPlanEntry> plan,
        required int parallel,
      }) async {
        calls.add({'objective': objective, 'plan': plan, 'parallel': parallel});
        return const SwarmRunResult(runId: 'run-new-1', board: _live);
      }

      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          runs: const [_settled],
          board: _settled,
          onNewRun: create,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(find.text('start a swarm run'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('swarm-run-create')));
      await tester.pumpAndSettle();
      expect(find.text('a swarm run needs an objective'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('swarm-objective')),
        'Review the docs',
      );
      await tester.tap(find.byKey(const ValueKey('swarm-run-create')));
      await tester.pumpAndSettle();
      expect(find.text('a swarm run needs at least one task'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('swarm-plan')),
        'no separator',
      );
      await tester.tap(find.byKey(const ValueKey('swarm-run-create')));
      await tester.pumpAndSettle();
      expect(find.textContaining('use title | assignment'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('swarm-plan')),
        'Read the docs | read README.md | nobody-1234',
      );
      await tester.tap(find.byKey(const ValueKey('swarm-run-create')));
      await tester.pumpAndSettle();
      expect(find.textContaining('unknown agent'), findsOneWidget);
      expect(calls, isEmpty);

      await tester.enterText(
        find.byKey(const ValueKey('swarm-plan')),
        'Read the docs | read README.md | reviewer-9ab12c\n'
        'Check links | check the links',
      );
      await tester.tap(find.byKey(const ValueKey('swarm-run-create')));
      await tester.pumpAndSettle();

      expect(find.text('start a swarm run'), findsNothing);
      expect(calls, hasLength(1));
      expect(calls.single['objective'], 'Review the docs');
      expect(calls.single['parallel'], 1);
      final plan = calls.single['plan'] as List<SwarmPlanEntry>;
      expect(plan, hasLength(2));
      expect(plan.first.title, 'Read the docs');
      expect(plan.first.assignment, 'read README.md');
      expect(plan.first.agentId, 'reviewer-9ab12c');
      expect(plan.last.agentId, isNull);
      expect(tester.takeException(), isNull);
    });

    testWidgets('cancel asks first and only then sends the run id', (
      tester,
    ) async {
      final cancelled = <String>[];
      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          runs: const [_live],
          board: _live,
          onCancel: (runId) async {
            cancelled.add(runId);
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();
      expect(find.text('cancel swarm'), findsOneWidget);
      expect(find.textContaining('Cancel run “run-live-1”'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('swarm-cancel-dismiss')));
      await tester.pumpAndSettle();
      expect(cancelled, isEmpty);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('swarm-cancel-confirm')));
      await tester.pumpAndSettle();
      expect(cancelled, ['run-live-1']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a settled run is not cancellable', (tester) async {
      final cancelled = <String>[];
      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          runs: const [_settled],
          board: _settled,
          onCancel: (runId) async {
            cancelled.add(runId);
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();
      expect(find.text('cancel swarm'), findsNothing);
      expect(cancelled, isEmpty);
    });

    testWidgets('remove names the run and says the report stays', (
      tester,
    ) async {
      final removed = <String>[];
      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          runs: const [_settled],
          board: _settled,
          onRemove: (runId) async {
            removed.add(runId);
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();
      expect(find.text('remove swarm record'), findsOneWidget);
      expect(
        find.textContaining('The report at /home/me/LockedIn'),
        findsOneWidget,
      );
      expect(find.textContaining('stays on disk'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('swarm-remove-dismiss')));
      await tester.pumpAndSettle();
      expect(removed, isEmpty);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('swarm-remove-confirm')));
      await tester.pumpAndSettle();
      expect(removed, ['run-7c1a']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Enter retries only a failed or blocked task', (tester) async {
      final retried = <String>[];
      Future<SwarmRunResult> retry(String runId, String taskId) async {
        retried.add(taskId);
        return const SwarmRunResult(runId: 'run-new-1', board: _live);
      }

      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          runs: const [_settled],
          board: _settled,
          onRetry: retry,
        ),
      );

      // The cursor starts on the done task, which offers no retry.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('retry task'), findsNothing);
      expect(retried, isEmpty);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('retry task'), findsOneWidget);
      expect(
        find.textContaining('This starts a new read-only run'),
        findsOneWidget,
      );
      expect(
        find.textContaining('The original run “run-7c1a”'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('swarm-retry-confirm')));
      await tester.pumpAndSettle();
      expect(retried, ['task-2']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('empty, loading and error states are legible', (tester) async {
      final emptyCalls = <String>[];
      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          runs: const [],
          onRefresh: () => emptyCalls.add('refresh'),
        ),
      );
      expect(find.text('no swarm runs yet'), findsOneWidget);
      expect(find.text('n starts one'), findsOneWidget);
      expect(emptyCalls, isEmpty);
      await tester.pumpWidget(const SizedBox());

      await pumpSurface(
        tester,
        const SwarmPage(project: _project, loading: true),
      );
      expect(find.text('loading swarm runs…'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());

      var retried = 0;
      await pumpSurface(
        tester,
        SwarmPage(
          project: _project,
          error: 'the swarm board could not be read',
          onRefresh: () => retried += 1,
        ),
      );
      expect(find.text('the swarm board could not be read'), findsOneWidget);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Retry'));
      expect(retried, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the board fits 800x600', (tester) async {
      await pumpSurface(
        tester,
        const SwarmPage(project: _project, runs: [_settled], board: _settled),
        size: const Size(800, 600),
      );
      expect(find.text('Read the pagination code'), findsOneWidget);
      expect(find.text('Check the API tests'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Work shell swarm layer', () {
    testWidgets('w opens the board and Esc returns to the project', (
      tester,
    ) async {
      final store = await pumpShell(tester);
      await openWorkProject(tester);
      expect(store.activeProjectId, FakeCore.projectId);
      expect(store.swarmRuns, hasLength(1));

      await tester.sendKeyEvent(LogicalKeyboardKey.keyW);
      await tester.pumpAndSettle();

      expect(store.activeSwarmId, FakeCore.swarmRunId);
      expect(find.text('Read the pagination code'), findsOneWidget);
      expect(find.text('Check the API tests'), findsOneWidget);
      expect(find.text('SWARM'), findsWidgets);
      expect(tester.takeException(), isNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('Check the API tests'), findsNothing);
      expect(store.activeProjectId, FakeCore.projectId);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the board fits 800x600 in the shell', (tester) async {
      await pumpShell(tester, size: const Size(800, 600));
      await openWorkProject(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyW);
      await tester.pumpAndSettle();

      expect(find.text('Read the pagination code'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an empty project opens the board empty state', (tester) async {
      await pumpShell(tester, core: FakeCore(withSwarms: false));
      await openWorkProject(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyW);
      await tester.pumpAndSettle();

      expect(find.text('no swarm runs yet'), findsOneWidget);
      expect(find.text('n starts one'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a refused run read shows one actionable error', (
      tester,
    ) async {
      await pumpShell(
        tester,
        core: FakeCore(swarmFailure: 'the swarm board could not be read'),
      );
      await openWorkProject(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyW);
      await tester.pumpAndSettle();

      expect(find.text('the swarm board could not be read'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
