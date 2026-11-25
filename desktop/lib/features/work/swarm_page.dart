import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';
import 'swarm_dialog.dart';
import '../shared/cards.dart';

/// The glyph, tone and word for one swarm task or run status.
///
/// The word is always shown beside the glyph, so a status is never carried by
/// colour alone (`docs/design.md` §3.1). The project detail's SWARM card uses
/// the same table, so both surfaces agree on `× failed` and `✓ done`.
({String glyph, Color tone, String label}) swarmStatusStyle(String status) {
  return switch (status) {
    'running' => (glyph: '▸', tone: LockedInColors.primary, label: 'running'),
    'done' => (glyph: '✓', tone: LockedInColors.success, label: 'done'),
    'failed' => (glyph: '×', tone: LockedInColors.error, label: 'failed'),
    'blocked' => (glyph: '!', tone: LockedInColors.warning, label: 'blocked'),
    'cancelled' => (
      glyph: '—',
      tone: LockedInColors.warning,
      label: 'cancelled',
    ),
    'pending' => (glyph: '○', tone: LockedInColors.muted, label: 'pending'),
    _ => (
      glyph: '•',
      tone: LockedInColors.muted,
      label: status.isEmpty ? 'pending' : status,
    ),
  };
}

/// The status as one line (`✓ done`), so it reads without the glyph alone.
String swarmStatusText(String status) {
  final style = swarmStatusStyle(status);
  return '${style.glyph} ${style.label}';
}

/// One project's swarm board (`docs/product.md` §8.4).
///
/// The page renders the core's board and sends intents; it never writes a file,
/// never runs a worker and never widens a profile. Every worker is read-only,
/// and the only file a run leaves behind is its Markdown report.
///
/// `n` starts a run (the dialog owns its own validation), `x` cancels a live
/// run, `d` drops a run record, `Enter` retries a failed or blocked task and
/// `r` re-reads the runs. `Esc` returns to the project detail.
class SwarmPage extends StatefulWidget {
  const SwarmPage({
    super.key,
    required this.project,
    this.runs = const [],
    this.board,
    this.loading = false,
    this.error,
    this.onBack,
    this.onRefresh,
    this.onOpenRun,
    this.onNewRun,
    this.onCancel,
    this.onRemove,
    this.onRetry,
    this.onVerify,
  });

  /// The open project, for the header and the agent ids the run dialog checks.
  final WorkProjectDetail project;

  /// Every run the core still remembers for this project, oldest first.
  final List<SwarmBoardView> runs;

  /// The open board, or null when none is selected yet.
  final SwarmBoardView? board;

  final bool loading;

  /// The last board read failure. Page-local: it never replaces the rows.
  final String? error;

  /// `Esc` and the back control return to the project detail.
  final VoidCallback? onBack;

  /// `r` re-reads `work.swarm.runs`.
  final VoidCallback? onRefresh;

  /// Clicking a run chip opens that board.
  final ValueChanged<String>? onOpenRun;

  /// `n` starts a run. A refusal throws and the dialog stays open.
  final SwarmRunner? onNewRun;

  /// `x` cancels one live run after a named confirmation.
  final Future<void> Function(String runId)? onCancel;

  /// `d` drops one run record after a named confirmation.
  final Future<void> Function(String runId)? onRemove;

  /// `Enter` on a failed or blocked task starts a new read-only run.
  final Future<SwarmRunResult> Function(String runId, String taskId)? onRetry;

  /// `v` or the row button marks a done task verified (or clears it).
  final Future<void> Function(String runId, String taskId, bool verified)?
  onVerify;

  @override
  State<SwarmPage> createState() => _SwarmPageState();
}

class _SwarmPageState extends State<SwarmPage> {
  static const _selectedRowKey = ValueKey('swarm-task-selected');

  final _rowKeys = <String, GlobalKey>{};
  var _selected = 0;
  var _dialogOpen = false;
  var _busy = false;
  String? _actionError;

  List<SwarmTaskRow> get _tasks => widget.board?.tasks ?? const [];

  int get _selectedTask =>
      _tasks.isEmpty ? -1 : _selected.clamp(0, _tasks.length - 1);

  SwarmTaskRow? get _selectedRow {
    final index = _selectedTask;
    return index < 0 ? null : _tasks[index];
  }

  @override
  void didUpdateWidget(SwarmPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.board?.runId != widget.board?.runId) {
      _selected = 0;
      _actionError = null;
      return;
    }
    if (_selected >= _tasks.length) {
      _selected = _tasks.isEmpty ? 0 : _tasks.length - 1;
    }
  }

  GlobalKey _rowKey(String id) =>
      _rowKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'swarm-task-$id'));

  void _select(int index) {
    if (index < 0 || index >= _tasks.length || index == _selected) return;
    setState(() {
      _selected = index;
      _actionError = null;
    });
    final id = _tasks[index].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _rowKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  void _move(int delta) {
    if (_tasks.length < 2) return;
    _select((_selectedTask + delta).clamp(0, _tasks.length - 1));
  }

  /// The core's own sentence when it sent one, otherwise the exception's.

  /// Run one mutation, keeping a refusal inline instead of leaving the page.
  Future<void> _mutate(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _actionError = null;
    });
    try {
      await action();
    } catch (failure) {
      if (mounted) setState(() => _actionError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _newRun() async {
    final create = widget.onNewRun;
    if (create == null || _dialogOpen || _busy) return;
    _dialogOpen = true;
    try {
      final result = await showSwarmRunDialog(
        context,
        onCreate: create,
        agentIds: [for (final agent in widget.project.agents) agent.id],
      );
      if (!mounted || result == null) return;
      setState(() {
        _selected = 0;
        _actionError = null;
      });
    } finally {
      _dialogOpen = false;
    }
  }

  Future<void> _cancelRun() async {
    final board = widget.board;
    final cancel = widget.onCancel;
    if (board == null ||
        cancel == null ||
        !board.isRunning ||
        _dialogOpen ||
        _busy) {
      return;
    }
    _dialogOpen = true;
    try {
      final confirmed = await confirmSwarmCancel(context, runId: board.runId);
      if (!confirmed || !mounted) return;
      await _mutate(() => cancel(board.runId));
    } finally {
      _dialogOpen = false;
    }
  }

  Future<void> _removeRun() async {
    final board = widget.board;
    final remove = widget.onRemove;
    if (board == null || remove == null || _dialogOpen || _busy) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmSwarmRemove(
        context,
        runId: board.runId,
        reportPath: board.reportPath,
      );
      if (!confirmed || !mounted) return;
      await _mutate(() => remove(board.runId));
      if (mounted) setState(() => _selected = 0);
    } finally {
      _dialogOpen = false;
    }
  }

  Future<void> _retrySelected() async {
    final board = widget.board;
    final task = _selectedRow;
    final retry = widget.onRetry;
    if (board == null ||
        task == null ||
        retry == null ||
        !task.retryable ||
        _dialogOpen ||
        _busy) {
      return;
    }
    _dialogOpen = true;
    try {
      final confirmed = await confirmSwarmRetry(
        context,
        taskTitle: task.title.isEmpty ? task.id : task.title,
        runId: board.runId,
      );
      if (!confirmed || !mounted) return;
      await _mutate(() async {
        await retry(board.runId, task.id);
      });
      if (mounted) {
        setState(() {
          _selected = 0;
          _actionError = null;
        });
      }
    } finally {
      _dialogOpen = false;
    }
  }

  void _switchRun(int delta) {
    final open = widget.onOpenRun;
    final runs = widget.runs;
    if (open == null || runs.length < 2) return;
    final current = runs.indexWhere((run) => run.runId == widget.board?.runId);
    final from = current < 0 ? runs.length - 1 : current;
    final next = (from + delta).clamp(0, runs.length - 1);
    if (next == from) return;
    open(runs[next].runId);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape && widget.onBack != null) {
      widget.onBack!();
      return KeyEventResult.handled;
    }
    // A dialog owns the keyboard while it is open, and a mutation is not
    // offered twice.
    if (_dialogOpen || _busy) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.bracketLeft) {
      _switchRun(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.bracketRight) {
      _switchRun(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN && widget.onNewRun != null) {
      if (event is KeyDownEvent) _newRun();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyX && widget.onCancel != null) {
      if (event is KeyDownEvent) _cancelRun();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyD && widget.onRemove != null) {
      if (event is KeyDownEvent) _removeRun();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyV && widget.onVerify != null) {
      if (event is KeyDownEvent) unawaited(_verifySelected());
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      // Enter is retry, and only a failed or blocked task offers it. It is
      // still consumed so the key cannot fall through to a list default.
      if (event is KeyDownEvent) _retrySelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR && widget.onRefresh != null) {
      if (event is KeyDownEvent) widget.onRefresh!();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(context),
          if (widget.loading)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          Expanded(child: _body(context)),
        ],
      ),
    );
  }

  Widget _header(BuildContext context) {
    final theme = Theme.of(context);
    final board = widget.board;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to project',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('SWARM', style: theme.textTheme.titleMedium),
                Text(
                  widget.project.name.isEmpty
                      ? 'read-only workers'
                      : '${widget.project.name} · read-only workers',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          if (_busy) ...[
            _Chip('working…', tone: LockedInColors.warning),
            const SizedBox(width: 10),
          ],
          if (board != null)
            _Chip(
              swarmStatusStyle(board.isRunning ? 'running' : board.status)
                  .label,
              tone: swarmStatusStyle(board.isRunning ? 'running' : board.status)
                  .tone,
            ),
          if (board != null &&
              board.tasks.any(
                (task) => task.status == 'done' && !task.verified,
              )) ...[
            const SizedBox(width: 8),
            _Chip(
              '${board.tasks.where((task) => task.status == 'done' && !task.verified).length} unverified',
              tone: LockedInColors.warning,
            ),
          ] else if (widget.loading)
            _Chip('reading…', tone: LockedInColors.warning),
          // The pointer path for r / x / d, gated on the same callbacks.
          if (widget.onRefresh != null)
            IconButton(
              key: const ValueKey('swarm-refresh'),
              tooltip: 'refresh (r)',
              onPressed: _busy ? null : widget.onRefresh,
              icon: const Icon(Icons.refresh, size: 17),
              visualDensity: VisualDensity.compact,
              color: LockedInColors.muted,
            ),
          // Both buttons run the same paths as `x` and `d`: the named
          // confirmation, the busy flag and the inline error. Calling the
          // callback directly skipped all three, so one click cancelled a live
          // run and a refusal surfaced as an unhandled error.
          if (board != null && widget.onCancel != null)
            IconButton(
              key: const ValueKey('swarm-cancel'),
              tooltip: 'cancel the run (x)',
              onPressed: _busy || !board.isRunning
                  ? null
                  : () => unawaited(_cancelRun()),
              icon: const Icon(Icons.stop_circle_outlined, size: 17),
              visualDensity: VisualDensity.compact,
              color: LockedInColors.warning,
            ),
          if (board != null && widget.onRemove != null)
            IconButton(
              key: const ValueKey('swarm-remove'),
              tooltip: 'remove the record (d)',
              onPressed: _busy || board.isRunning
                  ? null
                  : () => unawaited(_removeRun()),
              icon: const Icon(Icons.delete_outline, size: 17),
              visualDensity: VisualDensity.compact,
              color: LockedInColors.muted,
            ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    final board = widget.board;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _ErrorNote(message: widget.error!, onRetry: widget.onRefresh),
                  const SizedBox(height: 12),
                ],
                if (_actionError != null) ...[
                  _ErrorNote(message: _actionError!),
                  const SizedBox(height: 12),
                ],
                // The error note above already explains a failed read; the
                // empty card would claim "no runs yet" over a state the app
                // could not read.
                if (board == null) ...[
                  if (widget.error == null) _emptyCard(),
                ] else ...[
                  _runCard(board),
                  const SizedBox(height: 14),
                  if (widget.runs.length > 1) ...[
                    _runsCard(),
                    const SizedBox(height: 14),
                  ],
                  _tasksCard(board),
                ],
                const SizedBox(height: 14),
                Text(
                  'j/k move · Enter retry · n new run · x cancel · d remove · '
                  'r refresh · [ ] switch run · Esc back',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 10.5,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _emptyCard() {
    if (widget.loading) {
      return SectionCard(
        label: 'RUN',
        child: Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: LockedInColors.primary,
              ),
            ),
            const SizedBox(width: 12),
            Text(
              'loading swarm runs…',
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            ),
          ],
        ),
      );
    }
    return SectionCard(
      label: 'RUN',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.hub_outlined, size: 16, color: LockedInColors.muted),
              const SizedBox(width: 8),
              Text(
                'no swarm runs yet',
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'n starts one',
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Text(
            'A run is a coordinator’s plan of independent tasks. Each task runs '
            'in its own read-only worker and leaves one Markdown report.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 11.5,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }

  Widget _runCard(SwarmBoardView board) {
    final report = board.reportPath;
    return SectionCard(
      label: 'RUN',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            board.objective.isEmpty ? 'no objective recorded' : board.objective,
            style: TextStyle(
              color: LockedInColors.foreground,
              fontSize: 14,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              _Chip('run ${board.runId}'),
              _Chip('parallel ${board.parallel}'),
              _Chip('started ${_timeLabel(board.startedAt)}'),
              if (board.finishedAt != null)
                _Chip('finished ${_timeLabel(board.finishedAt!)}')
              else
                _Chip('not finished', tone: LockedInColors.warning),
              if (board.retryOf != null)
                _Chip(
                  'retry of ${board.retryOf!.runId}/${board.retryOf!.taskId}',
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                report == null
                    ? Icons.schedule_outlined
                    : Icons.description_outlined,
                size: 14,
                color: LockedInColors.muted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  report ?? 'report not written yet',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 11,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// The run chips, oldest first. A run record is only process state, so the
  /// strip is the way back to an earlier run the core still remembers.
  Widget _runsCard() {
    final active = widget.board?.runId;
    final open = widget.onOpenRun;
    return SectionCard(
      label: 'RUNS',
      trailing: _Chip('${widget.runs.length}'),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final run in widget.runs)
            _runChip(run, selected: run.runId == active, onTap: open),
        ],
      ),
    );
  }

  Widget _runChip(
    SwarmBoardView run, {
    required bool selected,
    required ValueChanged<String>? onTap,
  }) {
    final status = run.isRunning ? 'running' : run.status;
    final style = swarmStatusStyle(status);
    return Material(
      color: selected ? LockedInColors.panel : LockedInColors.background,
      borderRadius: BorderRadius.circular(5),
      child: InkWell(
        borderRadius: BorderRadius.circular(5),
        onTap: onTap == null || selected ? null : () => onTap(run.runId),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(5),
            border: Border.all(
              color: selected
                  ? LockedInColors.primary.withValues(alpha: 0.5)
                  : LockedInColors.line,
            ),
          ),
          child: Text(
            '${run.runId} · ${style.glyph} ${style.label}',
            style: TextStyle(
              color: selected
                  ? LockedInColors.foreground
                  : LockedInColors.muted,
              fontSize: 11,
              fontFamily: 'monospace',
            ),
          ),
        ),
      ),
    );
  }

  Widget _tasksCard(SwarmBoardView board) {
    final failed = board.tasks.where((task) => task.status == 'failed').length;
    return SectionCard(
      label: 'BOARD',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (failed > 0) ...[
            _Chip('$failed failed', tone: LockedInColors.error),
            const SizedBox(width: 6),
          ],
          _Chip(
            board.tasks.length == 1 ? '1 task' : '${board.tasks.length} tasks',
          ),
        ],
      ),
      child: board.tasks.isEmpty
          ? Text(
              'this run has no tasks',
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < board.tasks.length; index++)
                  _taskRow(board.tasks[index], index),
                if (board.isRunning) ...[
                  const SizedBox(height: 4),
                  Text(
                    'x cancels this run · the report is written when the '
                    'workers settle',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 10.5,
                    ),
                  ),
                ] else if (board.retryableTasks.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Enter retries a failed or blocked task as a new read-only '
                    'run',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 10.5,
                    ),
                  ),
                ],
              ],
            ),
    );
  }

  /// Toggle verification on the selected done task.
  Future<void> _verifySelected() async {
    final verify = widget.onVerify;
    final task = _selectedRow;
    final board = widget.board;
    if (verify == null || task == null || board == null || _busy) return;
    if (task.status != 'done') return;
    setState(() {
      _busy = true;
      _actionError = null;
    });
    try {
      await verify(board.runId, task.id, !task.verified);
    } catch (failure) {
      if (mounted) setState(() => _actionError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _taskRow(SwarmTaskRow task, int index) {
    final selected = index == _selectedTask;
    final style = swarmStatusStyle(task.status);
    final detail = task.error ?? task.summary;
    return Padding(
      key: _rowKey(task.id),
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected ? LockedInColors.panel : LockedInColors.surface,
        borderRadius: BorderRadius.circular(7),
        child: InkWell(
          borderRadius: BorderRadius.circular(7),
          onTap: () => _select(index),
          child: Container(
            key: selected ? _selectedRowKey : null,
            padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(7),
              border: Border.all(
                color: selected
                    ? LockedInColors.primary.withValues(alpha: 0.5)
                    : LockedInColors.line,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 88,
                  child: Text(
                    '${style.glyph} ${style.label}',
                    style: TextStyle(
                      color: style.tone,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        task.title.isEmpty ? 'untitled task' : task.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        task.agentId.isEmpty
                            ? 'agent · project default'
                            : 'agent · ${task.agentId}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 10.5,
                          fontFamily: 'monospace',
                        ),
                      ),
                      if (task.requires.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          'after ${task.requires.join(', ')}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.secondary,
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                      if (task.status == 'done') ...[
                        const SizedBox(height: 3),
                        Text(
                          task.verified ? 'verified' : 'unverified',
                          style: TextStyle(
                            color: task.verified
                                ? LockedInColors.success
                                : LockedInColors.warning,
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                      const SizedBox(height: 4),
                      Text(
                        detail == null || detail.trim().isEmpty
                            ? (task.status == 'running'
                                  ? 'working…'
                                  : 'no summary yet')
                            : detail.trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: task.error != null
                              ? LockedInColors.error
                              : LockedInColors.muted,
                          fontSize: 11.5,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
                if (task.status == 'done' && widget.onVerify != null)
                  TextButton(
                    key: ValueKey('swarm-verify-${task.id}'),
                    onPressed: _busy
                        ? null
                        : () {
                            _select(index);
                            unawaited(_verifySelected());
                          },
                    child: Text(task.verified ? 'unverify' : 'verify'),
                  ),
                if ((task.status == 'failed' || task.status == 'blocked') &&
                    widget.onRetry != null)
                  TextButton(
                    key: ValueKey('swarm-retry-${task.id}'),
                    onPressed: _busy
                        ? null
                        : () {
                            _select(index);
                            unawaited(_retrySelected());
                          },
                    child: const Text('retry'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `ISO-8601` to a short local-looking label, without re-deriving a timezone.
String _timeLabel(String value) {
  if (value.trim().isEmpty) return 'not recorded';
  final stamp = value.replaceFirst('T', ' ');
  return stamp.length > 16 ? stamp.substring(0, 16) : stamp;
}

class _Chip extends StatelessWidget {
  const _Chip(this.text, {this.tone});

  final String text;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: tone ?? LockedInColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _ErrorNote extends StatelessWidget {
  const _ErrorNote({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
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
          if (onRetry != null) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 15),
                label: const Text('Retry'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
