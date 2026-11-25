import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/work/work_approvals.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

const _hunk0 = HunkView(
  index: 0,
  oldStart: 1,
  oldCount: 2,
  newStart: 1,
  newCount: 2,
  lines: [
    HunkLineView(kind: 'context', text: '# Notes'),
    HunkLineView(kind: 'remove', text: 'old first line'),
    HunkLineView(kind: 'add', text: 'new first line'),
  ],
  oldLines: ['# Notes\n', 'old first line\n'],
  newLines: ['# Notes\n', 'new first line\n'],
);

const _hunk1 = HunkView(
  index: 1,
  oldStart: 5,
  oldCount: 1,
  newStart: 5,
  newCount: 2,
  lines: [
    HunkLineView(kind: 'context', text: 'tail'),
    HunkLineView(kind: 'add', text: 'added tail'),
  ],
  oldLines: ['tail\n'],
  newLines: ['tail\n', 'added tail\n'],
);

const _write = WorkWriteProposal(
  id: 'write-1',
  projectId: FakeCore.projectId,
  path: 'notes.md',
  kind: 'update',
  diff:
      '--- a/notes.md\n'
      '+++ b/notes.md\n'
      '@@ -1,2 +1,2 @@\n'
      ' # Notes\n'
      '-old first line\n'
      '+new first line\n'
      '@@ -5,1 +5,2 @@\n'
      ' tail\n'
      '+added tail\n',
  hunks: [_hunk0, _hunk1],
  stats: WriteStats(added: 2, removed: 1),
  baseHash: 'sha256:abc123',
);

const _command = WorkCommandProposal(
  id: 'command-1',
  projectId: FakeCore.projectId,
  argv: ['printf', 'ok'],
  cwd: '.',
  reason: 'check the approval path',
  risk:
      'This process can read and write outside the project and can reach the '
      'network.',
);

const _approvals = WorkApprovals(writes: [_write], commands: [_command]);

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

Future<void> openWorkProject(WidgetTester tester) async {
  await openSurface(tester, 6);
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
}

Checkbox hunkBox(WidgetTester tester, String writeId, int index) {
  return tester.widget<Checkbox>(
    find.byKey(ValueKey('approval-hunk-$writeId-$index')),
  );
}

void main() {
  group('work approval models', () {
    test('parse the documented write and command views', () {
      final approvals = WorkApprovals.fromJson(const <String, dynamic>{
        'writes': [
          {
            'id': 'w1',
            'path': 'notes.md',
            'kind': 'create',
            'diff': '--- a/notes.md\n+++ b/notes.md\n+# Notes\n',
            'hunks': [
              {
                'index': 0,
                'oldStart': 0,
                'oldCount': 0,
                'newStart': 1,
                'newCount': 1,
                'lines': [
                  {'kind': 'add', 'text': '# Notes'},
                ],
                'oldLines': <String>[],
                'newLines': ['# Notes\n'],
              },
            ],
            'stats': {'added': 1},
            'baseHash': null,
          },
        ],
        'commands': [
          {
            'id': 'c1',
            'argv': ['printf', 'ok', 7],
            'cwd': '.',
            'reason': 'check',
          },
        ],
      }, projectId: 'p1');

      final write = approvals.writes.single;
      expect(write.id, 'w1');
      expect(write.projectId, 'p1');
      expect(write.path, 'notes.md');
      expect(write.kind, 'create');
      expect(write.baseHash, isNull);
      expect(write.stats.added, 1);
      expect(write.stats.removed, 0);
      expect(write.hunks.single.index, 0);
      expect(write.hunks.single.lines.single.kind, 'add');
      expect(write.hunks.single.lines.single.text, '# Notes');

      final command = approvals.commands.single;
      expect(command.id, 'c1');
      expect(command.projectId, 'p1');
      expect(command.argv, ['printf', 'ok']);
      expect(command.risk, '');
      expect(approvals.total, 2);
      expect(approvals.isEmpty, isFalse);
    });

    test('an absent or malformed payload is an empty approval set', () {
      expect(WorkApprovals.fromJson(null).isEmpty, isTrue);
      final approvals = WorkApprovals.fromJson(const <String, dynamic>{
        'writes': 'not-a-list',
        'commands': [
          {'id': 7, 'argv': 'printf'},
          'not-a-map',
        ],
      });
      expect(approvals.isEmpty, isTrue);
      expect(approvals.total, 0);
    });
  });

  group('CoreStore approvals', () {
    test('openProject reads the pending writes and commands', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.openProject(FakeCore.projectId);

      expect(core.calls, contains('work.approvals.list'));
      expect(store.pendingWrites.single.id, FakeCore.writeProposalId);
      expect(store.pendingWrites.single.hunks, hasLength(2));
      expect(store.pendingCommands.single.id, FakeCore.commandProposalId);
      expect(store.pendingCommands.single.argv, ['printf', 'ok']);
      expect(store.pendingApprovalCount, 2);
      expect(store.approvalsError, isNull);
      expect(store.workApprovals.total, 2);
    });

    test(
      'decideWrite approves only the selected hunks and clears the row',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);

        await store.decideWrite(
          FakeCore.writeProposalId,
          'approve',
          hunks: [1],
        );

        expect(core.writeDecisions.single, {
          'id': FakeCore.writeProposalId,
          'decision': 'approve',
          'hunks': [1],
        });
        expect(store.pendingWrites, isEmpty);
        expect(store.pendingCommands, hasLength(1));
        expect(core.calls, contains('work.changes'));
        expect(store.approvalsError, isNull);
      },
    );

    test('decideCommand records the decision and clears the row', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);

      await store.decideCommand(FakeCore.commandProposalId, 'approve');

      expect(core.commandDecisions.single, {
        'id': FakeCore.commandProposalId,
        'decision': 'approve',
      });
      expect(store.pendingCommands, isEmpty);
      expect(store.pendingWrites, hasLength(1));
    });

    test('a refused decision rethrows and keeps the pending row', () async {
      final core = FakeCore(
        approvalDecideFailure: 'the agent “Reviewer” is not allowed to write',
      );
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);

      await expectLater(
        store.decideWrite(FakeCore.writeProposalId, 'approve'),
        throwsA(isA<RpcException>()),
      );

      expect(core.writeDecisions, isEmpty);
      expect(store.pendingWrites, hasLength(1));
      expect(store.pendingWrites.single.id, FakeCore.writeProposalId);
    });

    test('proposal events add and resolved events remove rows', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);

      core.emitEvent('work.write.proposal', {
        'id': 'write-2',
        'projectId': FakeCore.projectId,
        'path': 'src/app.ts',
        'kind': 'update',
        'diff': '@@ -1,1 +1,1 @@\n-a\n+b\n',
        'hunks': [
          {'index': 0, 'lines': <Map<String, dynamic>>[]},
        ],
        'stats': {'added': 1, 'removed': 1},
        'baseHash': 'sha256:def',
      });
      await pumpEventQueue();
      expect(store.pendingWrites, hasLength(2));
      expect(store.pendingWrites.last.path, 'src/app.ts');

      core.emitEvent('work.write.proposal', {
        'id': 'write-2',
        'projectId': FakeCore.projectId,
        'path': 'src/app.ts',
        'kind': 'update',
        'diff': '@@ -1,1 +1,1 @@\n-a\n+c\n',
        'hunks': [
          {'index': 0, 'lines': <Map<String, dynamic>>[]},
        ],
        'stats': {'added': 1, 'removed': 1},
      });
      await pumpEventQueue();
      expect(store.pendingWrites, hasLength(2));
      expect(store.pendingWrites.last.diff, contains('+c'));

      core.emitEvent('work.command.proposal', {
        'id': 'command-2',
        'projectId': FakeCore.projectId,
        'argv': ['ls'],
        'cwd': '.',
        'risk': 'risk',
      });
      await pumpEventQueue();
      expect(store.pendingCommands, hasLength(2));

      core.emitEvent('work.approval.resolved', {
        'id': 'write-2',
        'kind': 'write',
      });
      core.emitEvent('work.approval.resolved', {
        'id': 'command-2',
        'kind': 'command',
      });
      await pumpEventQueue();

      expect(store.pendingWrites.single.id, FakeCore.writeProposalId);
      expect(store.pendingCommands.single.id, FakeCore.commandProposalId);
    });

    test(
      'a proposal for another project is not added to the open one',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);

        core.emitEvent('work.write.proposal', {
          'id': 'elsewhere',
          'projectId': 'some-other-project',
          'path': 'x.md',
          'kind': 'create',
        });
        await pumpEventQueue();

        expect(store.pendingWrites, hasLength(1));
        expect(store.pendingWrites.single.id, FakeCore.writeProposalId);
      },
    );

    test('closeProject and closeApprovals clear the pending rows', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);
      expect(store.pendingApprovalCount, 2);

      store.closeApprovals();
      expect(store.pendingApprovalCount, 0);

      await store.refreshApprovals(FakeCore.projectId);
      expect(store.pendingApprovalCount, 2);
      store.closeProject();
      expect(store.pendingApprovalCount, 0);
      expect(store.approvalsLoading, isFalse);
      expect(store.approvalsError, isNull);
    });
  });

  group('WorkDetailView approvals card', () {
    testWidgets('shows the count, rows and p opens the layer', (tester) async {
      var opened = 0;
      await pumpSurface(
        tester,
        WorkDetailView(
          project: _detail,
          approvals: _approvals,
          onOpenApprovals: () => opened++,
        ),
      );

      expect(find.text('APPROVALS'), findsOneWidget);
      expect(find.text('2 pending'), findsOneWidget);
      expect(find.text('notes.md'), findsOneWidget);
      expect(find.text('printf ok'), findsOneWidget);
      expect(find.text('Review approvals'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pumpAndSettle();
      expect(opened, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the empty card says no approvals pending', (tester) async {
      await pumpSurface(tester, const WorkDetailView(project: _detail));

      expect(find.text('APPROVALS'), findsOneWidget);
      expect(find.text('none pending'), findsOneWidget);
      expect(find.text('no approvals pending'), findsOneWidget);
      expect(find.text('Review approvals'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('WorkApprovalsView', () {
    testWidgets('renders a write diff, hunks and a command', (tester) async {
      await pumpSurface(tester, const WorkApprovalsView(approvals: _approvals));

      expect(find.text('APPROVALS'), findsOneWidget);
      expect(find.text('2 pending'), findsOneWidget);
      expect(find.text('WRITES'), findsOneWidget);
      expect(find.text('COMMANDS'), findsOneWidget);
      expect(find.text('notes.md'), findsOneWidget);
      expect(find.text('update'), findsOneWidget);
      expect(find.text('+2'), findsOneWidget);
      expect(find.text('-1'), findsOneWidget);
      expect(find.text('+new first line'), findsOneWidget);
      expect(find.text('-old first line'), findsOneWidget);
      expect(find.text('hunk 1 · -1,2 +1,2'), findsOneWidget);
      expect(find.text('hunk 2 · -5,1 +5,2'), findsOneWidget);
      expect(find.textContaining('printf'), findsOneWidget);
      expect(find.text('cwd .'), findsOneWidget);
      expect(find.textContaining('check the approval path'), findsOneWidget);
      expect(find.textContaining('can reach the network'), findsOneWidget);
      expect(hunkBox(tester, _write.id, 0).value, isTrue);
      expect(hunkBox(tester, _write.id, 1).value, isTrue);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Space toggles a hunk and y approves only the selection', (
      tester,
    ) async {
      final calls = <Map<String, dynamic>>[];
      await pumpSurface(
        tester,
        WorkApprovalsView(
          approvals: _approvals,
          onDecideWrite: (id, decision, {hunks}) async {
            calls.add({'id': id, 'decision': decision, 'hunks': hunks});
          },
        ),
      );

      // Hunk 1 starts selected; Space on the cursor (hunk 1) unselects it.
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(hunkBox(tester, _write.id, 0).value, isFalse);
      expect(hunkBox(tester, _write.id, 1).value, isTrue);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
      await tester.pumpAndSettle();

      expect(calls.single, {
        'id': _write.id,
        'decision': 'approve',
        'hunks': [1],
      });
      expect(tester.takeException(), isNull);
    });

    testWidgets('an empty hunk selection is refused before any request', (
      tester,
    ) async {
      final calls = <Map<String, dynamic>>[];
      await pumpSurface(
        tester,
        WorkApprovalsView(
          approvals: _approvals,
          onDecideWrite: (id, decision, {hunks}) async {
            calls.add({'id': id, 'decision': decision, 'hunks': hunks});
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(hunkBox(tester, _write.id, 1).value, isFalse);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
      await tester.pumpAndSettle();

      expect(calls, isEmpty);
      expect(
        find.text('select at least one hunk before approving this write'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('n rejects the selected write', (tester) async {
      final calls = <Map<String, dynamic>>[];
      await pumpSurface(
        tester,
        WorkApprovalsView(
          approvals: _approvals,
          onDecideWrite: (id, decision, {hunks}) async {
            calls.add({'id': id, 'decision': decision, 'hunks': hunks});
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();

      expect(calls.single, {
        'id': _write.id,
        'decision': 'reject',
        'hunks': null,
      });
      expect(tester.takeException(), isNull);
    });

    testWidgets('a command is approved with y and denied with n', (
      tester,
    ) async {
      final calls = <Map<String, dynamic>>[];
      await pumpSurface(
        tester,
        WorkApprovalsView(
          approvals: _approvals,
          onDecideCommand: (id, decision) async {
            calls.add({'id': id, 'decision': decision});
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
      await tester.pumpAndSettle();
      expect(calls.single, {'id': _command.id, 'decision': 'approve'});

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(calls.last, {'id': _command.id, 'decision': 'deny'});
      expect(tester.takeException(), isNull);
    });

    testWidgets('a core refusal keeps the row and shows its sentence', (
      tester,
    ) async {
      await pumpSurface(
        tester,
        WorkApprovalsView(
          approvals: _approvals,
          onDecideWrite: (id, decision, {hunks}) async {
            throw const RpcException(-32000, 'the write was refused', {
              'kind': 'write',
              'message': 'the agent “Reviewer” is not allowed to write',
            });
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
      await tester.pumpAndSettle();

      expect(
        find.text('the agent “Reviewer” is not allowed to write'),
        findsOneWidget,
      );
      expect(find.text('notes.md'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the empty state teaches the next action', (tester) async {
      await pumpSurface(
        tester,
        const WorkApprovalsView(approvals: WorkApprovals.empty),
      );

      expect(find.text('nothing to approve'), findsOneWidget);
      expect(find.textContaining('Nothing is written or run'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Esc returns to the project detail', (tester) async {
      var backs = 0;
      await pumpSurface(
        tester,
        WorkApprovalsView(approvals: _approvals, onBack: () => backs++),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(backs, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a 110-character cwd is capped, not overflowing, at 800x600', (
      tester,
    ) async {
      // The review's unconfirmed case: static arithmetic said this could
      // overflow; the chip has to cap and ellipsise instead.
      final longCwd = 'a/' * 70 + 'z';
      await pumpSurface(
        tester,
        WorkApprovalsView(
          approvals: WorkApprovals(
            writes: const [],
            commands: [
              WorkCommandProposal(
                id: 'command-long',
                projectId: FakeCore.projectId,
                argv: const ['printf', 'ok'],
                cwd: longCwd,
                reason: 'deep folder',
                risk: 'This process can read and write outside the project.',
              ),
            ],
          ),
        ),
        size: const Size(800, 600),
      );

      expect(tester.takeException(), isNull);
      final chip = find.textContaining('cwd a/a/');
      expect(chip, findsOneWidget);
      final text = tester.widget<Text>(chip);
      expect(text.maxLines, 1);
      expect(text.overflow, TextOverflow.ellipsis);
      expect(tester.getSize(chip).width, lessThanOrEqualTo(220));
    });

    testWidgets('the approval surface fits 800x600 without overflow', (
      tester,
    ) async {
      await pumpSurface(
        tester,
        const WorkApprovalsView(approvals: _approvals),
        size: const Size(800, 600),
      );

      expect(find.text('notes.md'), findsOneWidget);
      expect(find.text('COMMANDS'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('shell work approvals', () {
    testWidgets('p opens APPROVALS and Esc returns to the project', (
      tester,
    ) async {
      final store = await pumpShell(tester);
      await openWorkProject(tester);

      expect(find.text('PROJECT'), findsOneWidget);
      expect(find.text('2 pending'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pumpAndSettle();

      expect(find.text('APPROVALS'), findsNWidgets(2));
      expect(find.text('PROJECT'), findsNothing);
      expect(find.text('notes.md'), findsOneWidget);
      expect(store.pendingApprovalCount, 2);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(find.text('PROJECT'), findsOneWidget);
      expect(find.text('APPROVALS'), findsOneWidget);
      expect(find.text('WRITES'), findsNothing);
      expect(find.text('Review approvals'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('approving a write then denying a command empties the layer', (
      tester,
    ) async {
      final store = await pumpShell(tester);
      await openWorkProject(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pumpAndSettle();

      // The write starts with both hunks selected.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
      await tester.pumpAndSettle();
      expect(store.pendingWrites, isEmpty);
      expect(store.pendingCommands, hasLength(1));
      expect(find.text('no pending writes'), findsOneWidget);
      expect(find.textContaining('printf'), findsOneWidget);

      // The command row is now the only one; the cursor stays put and the
      // selection clamps onto it.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(store.pendingCommands, isEmpty);
      expect(find.text('nothing to approve'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('leaving Work collapses the approval layer', (tester) async {
      final store = await pumpShell(tester);
      await openWorkProject(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pumpAndSettle();
      expect(find.text('APPROVALS'), findsNWidgets(2));

      await openSurface(tester, 1);
      expect(find.text('APPROVALS'), findsNothing);

      await openSurface(tester, 6);
      expect(store.activeProjectId, FakeCore.projectId);
      expect(find.text('PROJECT'), findsOneWidget);
      expect(find.text('APPROVALS'), findsOneWidget);
      expect(find.text('WRITES'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the approval layer fits 800x600', (tester) async {
      await pumpShell(tester, size: const Size(800, 600));
      await openWorkProject(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pumpAndSettle();

      expect(find.text('APPROVALS'), findsNWidgets(2));
      expect(find.text('notes.md'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
