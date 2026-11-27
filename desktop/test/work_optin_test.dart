// The global Work write/command opt-in in the shell.
//
// The core is still the gate: the settings page writes `work.permissions.set`
// and renders the reply, and the approvals view disables **approve** when the
// matching flag is off while still allowing a rejection. No test here edits a
// config file or invents a permission.
import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/features/work/work_approvals.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

SettingsView settingsSnapshot() => const SettingsView(
  username: 'friend',
  theme: 'crimson',
  chatModel: 'openai/gpt-4.1-mini',
  baseUrl: '',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 5,
  period: 'day',
  warnAt: 0.8,
  pauseAtLimit: false,
  dataDir: '/tmp/lockedin-data',
  archiveBackend: 'folder',
  archiveFolder: '',
  archiveGithubRepo: '',
  archiveGithubBranch: "main",
  archiveGithubConsent: false,
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: [],
  hideHints: false,
  pluginDirs: [],
  disabledPlugins: [],
);

const _writeOff =
    'Writes are switched off in Settings → Work; turn them on to approve a '
    'write.';
const _commandOff =
    'Commands are switched off in Settings → Work; turn them on to approve a '
    'command.';

Future<void> pumpPage(
  WidgetTester tester,
  Widget page, {
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
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

/// Put the cursor on one settings row: scroll it into view, then tap it.
///
/// Tapping only selects (`onTap` calls `_select`); the action still comes from
/// Enter or Space, so this is the keyboard path with a scroll assist.
Future<void> selectRow(WidgetTester tester, String id) async {
  final row = find.byKey(ValueKey('settings-row-$id'));
  await tester.scrollUntilVisible(
    row,
    120,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.tap(row);
  await tester.pumpAndSettle();
}

Finder rowValue(String id, String text) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.text(text),
);

const _hunk = HunkView(
  index: 0,
  oldStart: 1,
  oldCount: 1,
  newStart: 1,
  newCount: 1,
  lines: [
    HunkLineView(kind: 'remove', text: 'old'),
    HunkLineView(kind: 'add', text: 'new'),
  ],
  oldLines: ['old\n'],
  newLines: ['new\n'],
);

const _write = WorkWriteProposal(
  id: 'write-1',
  projectId: 'my-app-4f2a1c',
  path: 'notes.md',
  kind: 'update',
  diff: '--- a/notes.md\n+++ b/notes.md\n@@ -1,1 +1,1 @@\n-old\n+new\n',
  hunks: [_hunk],
  stats: WriteStats(added: 1, removed: 1),
  baseHash: 'sha256:abc123',
);

const _command = WorkCommandProposal(
  id: 'command-1',
  projectId: 'my-app-4f2a1c',
  argv: ['printf', 'ok'],
  cwd: '.',
  reason: 'check the approval path',
  risk: 'This process can reach outside the project.',
);

const _approvals = WorkApprovals(writes: [_write], commands: [_command]);

void main() {
  group('Settings → WORK', () {
    testWidgets('a toggle calls the store and renders the stored reply', (
      tester,
    ) async {
      final calls = <Map<String, dynamic>>[];
      var permissions = WorkPermissions.off;
      late StateSetter setPageState;

      await pumpPage(
        tester,
        StatefulBuilder(
          builder: (context, setState) {
            setPageState = setState;
            return SettingsPage(
              settings: settingsSnapshot(),
              loading: false,
              workPermissions: permissions,
              onSetWorkPermissions: ({allowWrite, allowCommand}) async {
                calls.add({
                  'allowWrite': allowWrite,
                  'allowCommand': allowCommand,
                });
                setPageState(() {
                  permissions = WorkPermissions(
                    allowWrite: allowWrite ?? permissions.allowWrite,
                    allowCommand: allowCommand ?? permissions.allowCommand,
                  );
                });
              },
            );
          },
        ),
      );

      expect(find.text('WORK'), findsOneWidget);
      await selectRow(tester, 'work-allow-write');
      expect(rowValue('work-allow-write', 'switched off'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(calls, [
        {'allowWrite': true, 'allowCommand': null},
      ]);
      // The rendered value comes from the reply, not from an optimistic flip.
      expect(rowValue('work-allow-write', 'allowed'), findsOneWidget);
      expect(rowValue('work-allow-command', 'switched off'), findsOneWidget);

      // Enter on the other row writes the other flag only.
      await selectRow(tester, 'work-allow-command');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(calls.last, {'allowWrite': null, 'allowCommand': true});
      expect(rowValue('work-allow-command', 'allowed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('shows saving… while the write is pending', (tester) async {
      final reply = Completer<void>();
      await pumpPage(
        tester,
        SettingsPage(
          settings: settingsSnapshot(),
          loading: false,
          workPermissions: WorkPermissions.off,
          onSetWorkPermissions: ({allowWrite, allowCommand}) => reply.future,
        ),
      );

      await selectRow(tester, 'work-allow-write');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();

      expect(find.byKey(const ValueKey('settings-row-saving')), findsOneWidget);

      reply.complete();
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('settings-row-saving')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a core refusal keeps the old value with the core message', (
      tester,
    ) async {
      await pumpPage(
        tester,
        SettingsPage(
          settings: settingsSnapshot(),
          loading: false,
          workPermissions: WorkPermissions.off,
          onSetWorkPermissions: ({allowWrite, allowCommand}) async {
            throw const RpcException(-32000, _writeOff);
          },
        ),
      );

      await selectRow(tester, 'work-allow-write');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(rowValue('work-allow-write', 'switched off'), findsOneWidget);
      expect(find.text(_writeOff), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the WORK note names per-action approval and the profile', (
      tester,
    ) async {
      await pumpPage(
        tester,
        SettingsPage(
          settings: settingsSnapshot(),
          loading: false,
          workPermissions: WorkPermissions.off,
          onSetWorkPermissions: ({allowWrite, allowCommand}) async {},
        ),
      );

      final note = tester.widget<Text>(
        find.byKey(const ValueKey('settings-work-note')),
      );
      expect(note.data, contains('its own approval'));
      expect(note.data, contains('agent profile'));
      expect(note.data, contains('remember this session'));
      expect(tester.takeException(), isNull);
    });
  });

  group('WorkApprovalsView with the global opt-in off', () {
    testWidgets(
      'disables approve with the Settings sentence but allows reject',
      (tester) async {
        final writes = <Map<String, dynamic>>[];
        final commands = <Map<String, dynamic>>[];
        await pumpPage(
          tester,
          WorkApprovalsView(
            approvals: _approvals,
            permissions: WorkPermissions.off,
            onDecideWrite: (id, decision, {hunks}) async {
              writes.add({'id': id, 'decision': decision, 'hunks': hunks});
            },
            onDecideCommand: (id, decision) async {
              commands.add({'id': id, 'decision': decision});
            },
          ),
        );

        expect(find.text(_writeOff), findsOneWidget);
        expect(find.text(_commandOff), findsOneWidget);

        // Approve is a dead key while the gate is off.
        await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
        await tester.pumpAndSettle();
        expect(writes, isEmpty);
        expect(commands, isEmpty);

        // The write can still be rejected, and the command still denied.
        await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
        await tester.pumpAndSettle();
        expect(writes.single, {
          'id': 'write-1',
          'decision': 'reject',
          'hunks': null,
        });

        await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
        await tester.pumpAndSettle();
        await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
        await tester.pumpAndSettle();
        expect(commands.single, {'id': 'command-1', 'decision': 'deny'});
        expect(find.text('2 pending'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('a permissive view keeps the normal approve keys', (
      tester,
    ) async {
      final writes = <Map<String, dynamic>>[];
      await pumpPage(
        tester,
        WorkApprovalsView(
          approvals: _approvals,
          permissions: const WorkPermissions(
            allowWrite: true,
            allowCommand: true,
          ),
          onDecideWrite: (id, decision, {hunks}) async {
            writes.add({'id': id, 'decision': decision, 'hunks': hunks});
          },
        ),
      );

      expect(find.text(_writeOff), findsNothing);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
      await tester.pumpAndSettle();
      expect(writes.single['decision'], 'approve');
      expect(tester.takeException(), isNull);
    });
  });
}
