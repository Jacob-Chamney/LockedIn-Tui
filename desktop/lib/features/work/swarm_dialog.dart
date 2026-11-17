import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';

/// Starts one swarm run through the shell's `work.swarm.run`.
///
/// The dialog sends the objective, the plan and the lane width; the core
/// validates every cap and runs one read-only worker per task. A refusal
/// throws, which keeps the dialog open with the core's own sentence.
typedef SwarmRunner = Future<SwarmRunResult> Function({
  required String objective,
  required List<SwarmPlanEntry> plan,
  required int parallel,
});

/// Opens the new-run editor over the swarm board.
///
/// Returns the started run, or null when the user cancelled. Nothing starts
/// when the dialog is dismissed.
Future<SwarmRunResult?> showSwarmRunDialog(
  BuildContext context, {
  required SwarmRunner onCreate,
  List<String> agentIds = const [],
}) {
  return showDialog<SwarmRunResult>(
    context: context,
    // A typed plan is unsaved input: a stray click outside must not throw it
    // away.
    barrierDismissible: false,
    builder: (dialogContext) =>
        _SwarmRunDialog(onCreate: onCreate, agentIds: agentIds),
  );
}

/// Confirms cancelling one live run, naming it.
Future<bool> confirmSwarmCancel(BuildContext context, {required String runId}) {
  return _confirm(
    context,
    title: 'cancel swarm',
    heading: 'Cancel run “$runId”?',
    body:
        'Running and pending tasks become cancelled. The coordinator writes '
        'the report once the workers settle, so the work already done is kept.',
    confirmLabel: 'Cancel run',
    confirmKey: const ValueKey('swarm-cancel-confirm'),
    dismissKey: const ValueKey('swarm-cancel-dismiss'),
    destructive: true,
  );
}

/// Confirms dropping one in-memory run record, naming it and saying the report
/// stays on disk.
Future<bool> confirmSwarmRemove(
  BuildContext context, {
  required String runId,
  String? reportPath,
}) {
  final reason = reportPath == null || reportPath.trim().isEmpty
      ? 'The report will stay in the project’s reports folder once it has '
            'been written.'
      : 'The report at $reportPath stays on disk.';
  return _confirm(
    context,
    title: 'remove swarm record',
    heading: 'Remove run “$runId”?',
    body:
        'This forgets the run record for this session only. $reason The '
        'project and its files are untouched, and there is no undo.',
    confirmLabel: 'Remove',
    confirmKey: const ValueKey('swarm-remove-confirm'),
    dismissKey: const ValueKey('swarm-remove-dismiss'),
    destructive: true,
  );
}

/// Confirms retrying one failed or blocked task as a new read-only run.
Future<bool> confirmSwarmRetry(
  BuildContext context, {
  required String taskTitle,
  required String runId,
}) {
  return _confirm(
    context,
    title: 'retry task',
    heading: 'Retry “$taskTitle”?',
    body:
        'This starts a new read-only run for that task. The original run '
        '“$runId” and its report are untouched, and the worker can read the '
        'project but never write a file or run a command.',
    confirmLabel: 'Start retry',
    confirmKey: const ValueKey('swarm-retry-confirm'),
    dismissKey: const ValueKey('swarm-retry-dismiss'),
    destructive: false,
  );
}

Future<bool> _confirm(
  BuildContext context, {
  required String title,
  required String heading,
  required String body,
  required String confirmLabel,
  required Key confirmKey,
  required Key dismissKey,
  required bool destructive,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey != LogicalKeyboardKey.escape) {
          return KeyEventResult.ignored;
        }
        Navigator.of(dialogContext).pop(false);
        return KeyEventResult.handled;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: Text(title),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                heading,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                body,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: dismissKey,
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: confirmKey,
            style: destructive
                ? FilledButton.styleFrom(backgroundColor: LockedInColors.error)
                : null,
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    ),
  );
  return result ?? false;
}

class _SwarmRunDialog extends StatefulWidget {
  const _SwarmRunDialog({required this.onCreate, required this.agentIds});

  final SwarmRunner onCreate;

  /// The project's profile ids, so a typed third column can be checked before
  /// the request. Empty means the project lists no profiles and the core owns
  /// the default-agent rule.
  final List<String> agentIds;

  @override
  State<_SwarmRunDialog> createState() => _SwarmRunDialogState();
}

class _SwarmRunDialogState extends State<_SwarmRunDialog> {
  final _objective = TextEditingController();
  final _plan = TextEditingController();
  var _parallel = 1;
  var _saving = false;
  String? _error;
  List<SwarmPlanEntry> _parsed = const [];

  @override
  void dispose() {
    _objective.dispose();
    _plan.dispose();
    super.dispose();
  }

  /// The dialog's own checks. The core validates the caps and the agent rule;
  /// this catches the mistakes that would otherwise cost a round trip.
  String? _validate() {
    if (_objective.text.trim().isEmpty) {
      return 'a swarm run needs an objective';
    }
    final lines = _plan.text.split('\n');
    final entries = <SwarmPlanEntry>[];
    for (var index = 0; index < lines.length; index++) {
      final line = lines[index].trim();
      if (line.isEmpty) continue;
      final parts = [for (final part in line.split('|')) part.trim()];
      if (parts.length < 2 || parts.length > 3) {
        return 'line ${index + 1}: use title | assignment, with an optional '
            'agent id';
      }
      if (parts[0].isEmpty) return 'line ${index + 1}: the title is empty';
      if (parts[1].isEmpty) {
        return 'line ${index + 1}: the assignment is empty';
      }
      String? agentId;
      if (parts.length == 3) {
        if (parts[2].isEmpty) {
          return 'line ${index + 1}: the agent id is empty; leave the third '
              'column out to use the default agent';
        }
        if (widget.agentIds.isNotEmpty && !widget.agentIds.contains(parts[2])) {
          return 'line ${index + 1}: unknown agent “${parts[2]}”; this project '
              'has ${widget.agentIds.join(', ')}';
        }
        agentId = parts[2];
      }
      entries.add(
        SwarmPlanEntry(title: parts[0], assignment: parts[1], agentId: agentId),
      );
    }
    if (entries.isEmpty) return 'a swarm run needs at least one task';
    _parsed = entries;
    return null;
  }

  Future<void> _submit() async {
    if (_saving) return;
    final problem = _validate();
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.onCreate(
        objective: _objective.text.trim(),
        plan: _parsed,
        parallel: _parallel,
      );
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = _reason(failure);
      });
    }
  }

  /// The core's own sentence when it sent one, otherwise the exception's.
  String _reason(Object failure) {
    if (failure is RpcException) {
      final data = failure.data;
      if (data is Map && data['message'] is String) {
        final message = (data['message'] as String).trim();
        if (message.isNotEmpty) return message;
      }
      return failure.message;
    }
    return failure.toString();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (event.logicalKey != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    if (_saving) return KeyEventResult.handled;
    Navigator.of(context).pop();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      onKeyEvent: _onKey,
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('start a swarm run'),
        content: SizedBox(
          width: 540,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Each task runs in its own read-only worker: it can read this '
                  'project’s files, and can never write a file or run a command.',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 12,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  key: const ValueKey('swarm-objective'),
                  controller: _objective,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'objective',
                    hintText: 'Review the pagination change',
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 10),
                TextField(
                  key: const ValueKey('swarm-plan'),
                  controller: _plan,
                  minLines: 3,
                  maxLines: 6,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                  decoration: const InputDecoration(
                    labelText: 'tasks',
                    hintText:
                        'Read the pagination code | read src/pages.ts | '
                        'reviewer-9ab12c\nCheck the API tests | check the '
                        'offset handling',
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'one task per line: title | assignment, with an optional '
                  'agent id as a third column',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 11,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    SizedBox(
                      width: 76,
                      child: Text(
                        'parallel',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    SegmentedButton<int>(
                      key: const ValueKey('swarm-parallel'),
                      segments: const [
                        ButtonSegment(value: 1, label: Text('1')),
                        ButtonSegment(value: 2, label: Text('2')),
                        ButtonSegment(value: 3, label: Text('3')),
                        ButtonSegment(value: 4, label: Text('4')),
                      ],
                      selected: {_parallel},
                      onSelectionChanged: _saving
                          ? null
                          : (selected) =>
                                setState(() => _parallel = selected.first),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'lanes run side by side; the hard cap is 4',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 11,
                    height: 1.4,
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  _ErrorNote(message: _error!),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('swarm-run-cancel'),
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('swarm-run-create'),
            onPressed: _saving ? null : _submit,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Start run'),
          ),
        ],
      ),
    );
  }
}

class _ErrorNote extends StatelessWidget {
  const _ErrorNote({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 15, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: 12,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
