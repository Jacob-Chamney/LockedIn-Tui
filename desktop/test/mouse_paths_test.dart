import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/work/work_approvals.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The pointer paths for actions that used to be keyboard-only.
///
/// Each case names the key it stands for, so a regression reads as "the button
/// stopped running `y`", not "a widget moved".
Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(1280, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

const _hunk = HunkView(
  index: 0,
  oldStart: 1,
  oldCount: 1,
  newStart: 1,
  newCount: 1,
  lines: [HunkLineView(kind: 'add', text: 'new')],
  oldLines: ['old\n'],
  newLines: ['new\n'],
);

const _write = WorkWriteProposal(
  id: 'w1',
  projectId: 'p1',
  path: 'notes.md',
  kind: 'update',
  diff: '--- a/notes.md\n+++ b/notes.md\n@@ -1,1 +1,1 @@\n-new\n+new\n',
  hunks: [_hunk],
  stats: WriteStats(added: 1, removed: 1),
  baseHash: 'sha256:abc123',
);

const _command = WorkCommandProposal(
  id: 'c1',
  projectId: 'p1',
  argv: ['printf', 'ok'],
  cwd: '.',
  reason: 'check',
  risk: 'This process can read and write outside the project.',
);

void main() {
  group('work approvals', () {
    testWidgets('approve and reject are buttons, not only y/n', (tester) async {
      final calls = <Map<String, dynamic>>[];
      await _pump(
        tester,
        WorkApprovalsView(
          approvals: const WorkApprovals(
            writes: [_write],
            commands: [_command],
          ),
          onDecideWrite: (id, decision, {hunks}) async {
            calls.add({'write': id, 'decision': decision, 'hunks': hunks});
          },
          onDecideCommand: (id, decision, {reason}) async {
            calls.add({'command': id, 'decision': decision});
          },
        ),
      );

      await tester.tap(find.byKey(const ValueKey('approval-reject-w1')));
      await tester.pumpAndSettle();
      expect(calls.single, {
        'write': 'w1',
        'decision': 'reject',
        'hunks': null,
      });

      await tester.tap(find.byKey(const ValueKey('approval-approve-w1')));
      await tester.pumpAndSettle();
      expect(calls.last['decision'], 'approve');
      expect(calls.last['hunks'], [0]);

      await tester.tap(find.byKey(const ValueKey('approval-run-c1')));
      await tester.pumpAndSettle();
      expect(calls.last, {'command': 'c1', 'decision': 'approve'});
      expect(tester.takeException(), isNull);
    });

    testWidgets('a blocked approval is disabled, not silent', (tester) async {
      await _pump(
        tester,
        const WorkApprovalsView(
          approvals: WorkApprovals(writes: [_write], commands: []),
        ),
      );

      final approve = tester.widget<FilledButton>(
        find.byKey(const ValueKey('approval-approve-w1')),
      );
      expect(approve.onPressed, isNull);
      expect(find.text('read-only'), findsOneWidget);
    });
  });
}
