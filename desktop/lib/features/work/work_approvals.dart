import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The Work pending-approval surface.
///
/// A proposal is a **value**: the core keeps it in process memory and this page
/// never writes a file or starts a process itself. `y` and `n` send one
/// `work.write.decide` / `work.command.decide` and the store drops the row when
/// the core accepts the decision. A refusal leaves the row exactly where it was
/// with the core's own sentence beside it.
///
/// Writes show the unified diff and one checkbox per hunk (all selected by
/// default); `Space` toggles the hunk under the cursor and `y` applies only the
/// selected hunks. Commands show their argv as an argument list, the working
/// directory, the reason and the core's fixed risk sentence.
class WorkApprovalsView extends StatefulWidget {
  const WorkApprovalsView({
    super.key,
    required this.approvals,
    this.projectName = '',
    this.loading = false,
    this.error,
    this.onBack,
    this.onDecideWrite,
    this.onDecideCommand,
    this.permissions,
    this.lastCommand,
    this.onDismissLastCommand,
  });

  /// What the last decided command did, or null when there is none to show.
  ///
  /// The decision consumes the proposal row, so without this card a command
  /// that exited non-zero or timed out looked exactly like one that worked.
  final CommandOutcome? lastCommand;

  /// `x` and the card's close button drop [lastCommand].
  final VoidCallback? onDismissLastCommand;

  /// The pending writes and commands for the open project.
  final WorkApprovals approvals;

  /// The open project's name, for the header.
  final String projectName;

  /// True while `work.approvals.list` is in flight.
  final bool loading;

  /// The last approvals read failure. Page-local: it never replaces the rows.
  final String? error;

  /// `Esc` and the back control return to the project detail.
  final VoidCallback? onBack;

  /// `y`/`n` on a write: `approve` applies only the selected hunks (an empty
  /// selection is refused here), `reject` writes nothing. Null keeps the row
  /// read-only and drops the keys.
  final Future<void> Function(String id, String decision, {List<int>? hunks})?
  onDecideWrite;

  /// `y`/`n` on a command: `approve` runs it, `deny` starts nothing.
  final Future<void> Function(String id, String decision)? onDecideCommand;

  /// The global Work opt-in (`work.permissions.get`), or null before it is read.
  ///
  /// When the matching flag is false the core refuses the approval, so the page
  /// disables **approve** and says why in one sentence naming Settings → Work.
  /// The row still renders and can be rejected; null means "not read yet" and
  /// leaves the keys alone, because the core is still the gate either way.
  final WorkPermissions? permissions;

  @override
  State<WorkApprovalsView> createState() => _WorkApprovalsViewState();
}

class _WorkApprovalsViewState extends State<WorkApprovalsView> {
  final _rowKeys = <String, GlobalKey>{};

  /// The flattened cursor: writes first, then commands.
  var _selected = 0;

  /// The hunk the `Space` key toggles inside the selected write.
  var _hunkCursor = 0;

  /// Selected hunk indices per write id. A new write starts with all of them.
  final _hunks = <String, Set<int>>{};

  /// The proposal whose decide is in flight, so a row can say `applying…` and
  /// the keys are not offered twice.
  String? _decidingId;

  /// One inline core refusal, cleared by the next decision.
  String? _decideError;

  List<WorkWriteProposal> get _writes => widget.approvals.writes;
  List<WorkCommandProposal> get _commands => widget.approvals.commands;
  int get _count => _writes.length + _commands.length;

  bool get _busy => _decidingId != null;

  /// The global opt-ins, only when the core has answered and said `false`.
  bool get _writesBlocked => widget.permissions?.allowWrite == false;

  bool get _commandsBlocked => widget.permissions?.allowCommand == false;

  bool _isWrite(int index) => index < _writes.length;

  WorkWriteProposal? get _selectedWrite =>
      _count == 0 || !_isWrite(_selected) ? null : _writes[_selected];

  WorkCommandProposal? get _selectedCommand =>
      _count == 0 || _isWrite(_selected)
      ? null
      : _commands[_selected - _writes.length];

  @override
  void initState() {
    super.initState();
    _syncHunks();
  }

  @override
  void didUpdateWidget(WorkApprovalsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncHunks();
    if (_selected >= _count) {
      _selected = _count == 0 ? 0 : _count - 1;
      _hunkCursor = 0;
    }
  }

  /// Keep the selection map in step with the core's rows: a new write starts
  /// fully selected, a consumed write is forgotten.
  void _syncHunks() {
    final live = <String>{};
    for (final write in _writes) {
      if (write.id.isEmpty) continue;
      live.add(write.id);
      _hunks.putIfAbsent(
        write.id,
        () => {for (final hunk in write.hunks) hunk.index},
      );
    }
    _hunks.removeWhere((id, _) => !live.contains(id));
  }

  Set<int> _hunksFor(WorkWriteProposal write) => _hunks.putIfAbsent(
    write.id,
    () => {for (final hunk in write.hunks) hunk.index},
  );

  GlobalKey _rowKey(String id) =>
      _rowKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'approval-$id'));

  void _select(int index) {
    if (index < 0 || index >= _count || index == _selected) return;
    setState(() {
      _selected = index;
      _hunkCursor = 0;
      _decideError = null;
    });
    final id = _isWrite(index)
        ? _writes[index].id
        : _commands[index - _writes.length].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _rowKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(target, alignment: 0.35);
    });
  }

  void _move(int delta) {
    if (_count < 2) return;
    _select((_selected + delta).clamp(0, _count - 1));
  }

  void _moveHunk(int delta) {
    final write = _selectedWrite;
    if (write == null || write.hunks.length < 2) return;
    setState(() {
      _hunkCursor = (_hunkCursor + delta).clamp(0, write.hunks.length - 1);
    });
  }

  void _toggleHunk() {
    final write = _selectedWrite;
    if (write == null || write.hunks.isEmpty) return;
    final index = _hunkCursor.clamp(0, write.hunks.length - 1);
    final hunk = write.hunks[index];
    setState(() {
      final selected = _hunksFor(write);
      if (!selected.remove(hunk.index)) selected.add(hunk.index);
      _decideError = null;
    });
  }

  void _toggleHunkAt(WorkWriteProposal write, int index) {
    setState(() {
      final selected = _hunksFor(write);
      if (!selected.remove(index)) selected.add(index);
      _decideError = null;
    });
  }

  /// The core's own sentence when it sent one, otherwise the exception's.

  /// Put the cursor on the card with [id] before a button decides it.
  ///
  /// The verbs read the selected row, so a card's own button has to select that
  /// card first; otherwise `approve` on card 2 would apply card 1.
  void _selectFor(String id) {
    final at = _writes.indexWhere((write) => write.id == id);
    if (at >= 0) {
      setState(() => _selected = at);
      return;
    }
    final command = _commands.indexWhere((item) => item.id == id);
    if (command >= 0) {
      setState(() => _selected = _writes.length + command);
    }
  }

  Future<void> _approve() async {
    if (_busy) return;
    final write = _selectedWrite;
    if (write != null) {
      // The core refuses this too; returning here keeps the page from showing a
      // request that can only fail.
      if (_writesBlocked) return;
      final decide = widget.onDecideWrite;
      if (decide == null) return;
      final selected = _hunksFor(write).toList()..sort();
      // The core refuses an empty selection too; the page says so before the
      // request so the user gets the fix, not a round trip.
      if (selected.isEmpty) {
        setState(
          () => _decideError =
              'select at least one hunk before approving this write',
        );
        return;
      }
      await _decide(
        write.id,
        () => decide(write.id, 'approve', hunks: selected),
      );
      return;
    }
    final command = _selectedCommand;
    if (_commandsBlocked) return;
    final decide = widget.onDecideCommand;
    if (command == null || decide == null) return;
    await _decide(command.id, () => decide(command.id, 'approve'));
  }

  Future<void> _reject() async {
    if (_busy) return;
    final write = _selectedWrite;
    if (write != null) {
      final decide = widget.onDecideWrite;
      if (decide == null) return;
      await _decide(write.id, () => decide(write.id, 'reject'));
      return;
    }
    final command = _selectedCommand;
    final decide = widget.onDecideCommand;
    if (command == null || decide == null) return;
    await _decide(command.id, () => decide(command.id, 'deny'));
  }

  Future<void> _decide(String id, Future<void> Function() run) async {
    setState(() {
      _decidingId = id;
      _decideError = null;
    });
    try {
      await run();
    } catch (failure) {
      if (!mounted) return;
      setState(() => _decideError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _decidingId = null);
    }
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
    if (key == LogicalKeyboardKey.keyX &&
        widget.lastCommand != null &&
        widget.onDismissLastCommand != null) {
      if (event is KeyDownEvent) widget.onDismissLastCommand!();
      return KeyEventResult.handled;
    }
    if (_busy) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.tab) {
      _moveHunk(HardwareKeyboard.instance.isShiftPressed ? -1 : 1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowRight ||
        key == LogicalKeyboardKey.keyL) {
      _moveHunk(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.keyH) {
      _moveHunk(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.space) {
      if (event is KeyDownEvent) _toggleHunk();
      return KeyEventResult.handled;
    }
    final write = _selectedWrite;
    if (write != null && widget.onDecideWrite != null) {
      if (key == LogicalKeyboardKey.keyY) {
        if (event is KeyDownEvent) _approve();
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyN) {
        if (event is KeyDownEvent) _reject();
        return KeyEventResult.handled;
      }
    }
    final command = _selectedCommand;
    if (command != null && widget.onDecideCommand != null) {
      if (key == LogicalKeyboardKey.keyY) {
        if (event is KeyDownEvent) _approve();
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyN) {
        if (event is KeyDownEvent) _reject();
        return KeyEventResult.handled;
      }
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
          if (widget.lastCommand != null) _outcomeCard(widget.lastCommand!),
          Expanded(child: _body(context)),
        ],
      ),
    );
  }

  /// The last decided command: what ran, how it ended and what it printed.
  ///
  /// The state is a word and an icon as well as a colour: `exit 0`, `exit 2`,
  /// `timed out` and `denied` must be told apart without relying on hue.
  Widget _outcomeCard(CommandOutcome outcome) {
    final (label, tone, icon) = !outcome.approved
        ? ('denied · nothing ran', LockedInColors.muted, Icons.block)
        : outcome.timedOut
        ? ('timed out', LockedInColors.warning, Icons.timer_off_outlined)
        : outcome.exitCode == null
        ? ('no exit code', LockedInColors.warning, Icons.help_outline)
        : outcome.succeeded
        ? ('exit 0', LockedInColors.success, Icons.check_circle_outline)
        : (
            'exit ${outcome.exitCode}',
            LockedInColors.error,
            Icons.error_outline,
          );
    final output = [
      if (outcome.stdout.trim().isNotEmpty) outcome.stdout.trimRight(),
      if (outcome.stderr.trim().isNotEmpty) outcome.stderr.trimRight(),
    ].join('\n');
    return Padding(
      key: const ValueKey('approvals-last-command'),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 860),
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 6, 10),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(Radii.control),
              border: Border.all(color: tone.withValues(alpha: 0.6)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 15, color: tone),
                    const SizedBox(width: 8),
                    Text(
                      'LAST COMMAND',
                      style: TextStyle(
                        color: LockedInColors.secondary,
                        fontSize: TypeScale.label,
                        letterSpacing: 1.4,
                      ),
                    ),
                    const SizedBox(width: 10),
                    _Chip(label, tone: tone),
                    const Spacer(),
                    if (widget.onDismissLastCommand != null)
                      IconButton(
                        key: const ValueKey('approvals-last-command-dismiss'),
                        tooltip: 'dismiss (x)',
                        visualDensity: VisualDensity.compact,
                        onPressed: widget.onDismissLastCommand,
                        icon: const Icon(Icons.close, size: 15),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  outcome.argv.join(' '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontFamily: 'monospace',
                    fontSize: TypeScale.label,
                  ),
                ),
                if (output.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  // The core caps each stream; the card caps its own height so
                  // a long log cannot push the pending rows off the screen.
                  Container(
                    constraints: const BoxConstraints(maxHeight: 132),
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: LockedInColors.background,
                      borderRadius: BorderRadius.circular(Radii.control),
                      border: Border.all(color: LockedInColors.line),
                    ),
                    child: SingleChildScrollView(
                      child: SelectableText(
                        output,
                        key: const ValueKey('approvals-last-command-output'),
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontFamily: 'monospace',
                          fontSize: TypeScale.label,
                          height: 1.45,
                        ),
                      ),
                    ),
                  ),
                ] else if (outcome.approved) ...[
                  const SizedBox(height: 4),
                  Text(
                    'no output',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    final theme = Theme.of(context);
    final total = _count;
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
                Text('APPROVALS', style: theme.textTheme.titleMedium),
                Text(
                  widget.projectName.isEmpty
                      ? 'pending writes and commands'
                      : '${widget.projectName} · pending writes and commands',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
            ),
          ),
          if (widget.loading) ...[
            const SizedBox(width: 10),
            _Chip('reading…', tone: LockedInColors.warning),
          ],
          const SizedBox(width: 10),
          _Chip(
            total == 1 ? '1 pending' : '$total pending',
            tone: total == 0 ? LockedInColors.muted : LockedInColors.warning,
          ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    final total = _count;
    if (total == 0) {
      if (widget.loading) {
        return Center(
          child: Text(
            'reading approvals…',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        );
      }
      return _emptyState(
        title: 'nothing to approve',
        body:
            'A write or command an agent proposes appears here. Nothing is '
            'written or run until you approve it.',
        error: widget.error,
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 860),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _errorNote(widget.error!),
                  const SizedBox(height: 10),
                ],
                if (_decideError != null) ...[
                  _errorNote(_decideError!),
                  const SizedBox(height: 10),
                ],
                _sectionHeader('WRITES', _writes.length),
                const SizedBox(height: 8),
                if (_writes.isEmpty)
                  const _Muted('no pending writes')
                else
                  for (var index = 0; index < _writes.length; index++)
                    _writeCard(_writes[index], index),
                const SizedBox(height: 16),
                _sectionHeader('COMMANDS', _commands.length),
                const SizedBox(height: 8),
                if (_commands.isEmpty)
                  const _Muted('no pending commands')
                else
                  for (var index = 0; index < _commands.length; index++)
                    _commandCard(_writes.length + index),
                const SizedBox(height: 16),
                Text(
                  'y approve · n reject/deny · Space toggle a hunk · '
                  'Tab/h/l move hunks · Esc back',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _emptyState({
    required String title,
    required String body,
    String? error,
  }) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(Radii.control),
              border: Border.all(color: LockedInColors.line),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.fact_check_outlined,
                      size: 17,
                      color: LockedInColors.primary,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.key,
                    height: 1.45,
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: 10),
                  _errorNote(error),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _sectionHeader(String label, int count) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Container(width: 3, height: 12, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 8),
        _Chip('$count'),
      ],
    );
  }

  Widget _writeCard(WorkWriteProposal write, int index) {
    final selected = index == _selected;
    final hunks = _hunksFor(write);
    final deciding = _decidingId == write.id;
    final canDecide = widget.onDecideWrite != null && !_busy;
    final canApprove = canDecide && !_writesBlocked;
    return Padding(
      key: _rowKey(write.id),
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(Radii.control),
          border: Border.all(
            color: selected
                ? LockedInColors.primary.withValues(alpha: 0.5)
                : LockedInColors.line,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.description_outlined,
                  size: 15,
                  color: LockedInColors.muted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    write.path.isEmpty ? '(unnamed file)' : write.path,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.foreground,
                      fontSize: TypeScale.body,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _Chip(
                  write.kind.isEmpty ? 'change' : write.kind,
                  tone: LockedInColors.warning,
                ),
                if (write.stats.added > 0) ...[
                  const SizedBox(width: 6),
                  _Chip('+${write.stats.added}', tone: LockedInColors.success),
                ],
                if (write.stats.removed > 0) ...[
                  const SizedBox(width: 6),
                  _Chip('-${write.stats.removed}', tone: LockedInColors.error),
                ],
                if (deciding) ...[
                  const SizedBox(width: 8),
                  _Chip('applying…', tone: LockedInColors.warning),
                ],
              ],
            ),
            const SizedBox(height: 8),
            _diffBox(write),
            const SizedBox(height: 8),
            if (write.hunks.isEmpty)
              const _Muted('this proposal has no hunks')
            else
              for (var i = 0; i < write.hunks.length; i++)
                _hunkRow(
                  write,
                  i,
                  checked: hunks.contains(write.hunks[i].index),
                  focused: selected && i == _hunkCursor,
                  enabled: canDecide,
                ),
            if (_writesBlocked) ...[
              const SizedBox(height: 8),
              const _OptInBlocked(
                key: ValueKey('approval-write-optin-off'),
                message:
                    'Writes are switched off in Settings → Work; turn them '
                    'on to approve a write.',
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                if (!deciding) ...[
                  OutlinedButton(
                    key: ValueKey('approval-reject-${write.id}'),
                    onPressed: canDecide
                        ? () {
                            _selectFor(write.id);
                            _reject();
                          }
                        : null,
                    child: const Text('reject'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: ValueKey('approval-approve-${write.id}'),
                    onPressed: canApprove
                        ? () {
                            _selectFor(write.id);
                            _approve();
                          }
                        : null,
                    child: Text(
                      hunks.length == write.hunks.length &&
                              write.hunks.isNotEmpty
                          ? 'approve'
                          : 'approve ${hunks.length}',
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Text(
                    _writesBlocked
                        ? 'approve is off in Settings → Work · n reject'
                        : canApprove
                        ? 'y approve ${hunks.length} of ${write.hunks.length} '
                              'hunk${write.hunks.length == 1 ? '' : 's'} · n reject'
                        : 'read-only',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.micro,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _diffBox(WorkWriteProposal write) {
    final lines = write.diff.split('\n');
    return Container(
      key: ValueKey('approval-diff-${write.id}'),
      constraints: const BoxConstraints(maxHeight: 180),
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Scrollbar(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final line in lines)
                  if (line.isNotEmpty)
                    Text(
                      line,
                      maxLines: 1,
                      softWrap: false,
                      style: TextStyle(
                        color: _diffTone(line),
                        fontSize: TypeScale.label,
                        fontFamily: 'monospace',
                        height: 1.4,
                      ),
                    ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _hunkRow(
    WorkWriteProposal write,
    int position, {
    required bool checked,
    required bool focused,
    required bool enabled,
  }) {
    final hunk = write.hunks[position];
    return Material(
      color: focused && enabled
          ? LockedInColors.primary.withValues(alpha: 0.10)
          : Colors.transparent,
      borderRadius: BorderRadius.circular(Radii.control),
      child: InkWell(
        borderRadius: BorderRadius.circular(Radii.control),
        onTap: enabled ? () => _toggleHunkAt(write, hunk.index) : null,
        child: Row(
          children: [
            SizedBox(
              width: 28,
              height: 28,
              child: Checkbox(
                key: ValueKey('approval-hunk-${write.id}-${hunk.index}'),
                value: checked,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
                onChanged: enabled
                    ? (_) => _toggleHunkAt(write, hunk.index)
                    : null,
              ),
            ),
            Expanded(
              child: Text(
                'hunk ${hunk.index + 1} · -${hunk.oldStart},${hunk.oldCount} '
                '+${hunk.newStart},${hunk.newCount}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  fontFamily: 'monospace',
                ),
              ),
            ),
            if (focused && enabled)
              Padding(
                padding: EdgeInsets.only(right: 6),
                child: Text(
                  'Space',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _commandCard(int index) {
    final command = _commands[index - _writes.length];
    final selected = index == _selected;
    final deciding = _decidingId == command.id;
    final canDecide = widget.onDecideCommand != null && !_busy;
    final canApprove = canDecide && !_commandsBlocked;
    return Padding(
      key: _rowKey(command.id),
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(Radii.control),
          border: Border.all(
            color: selected
                ? LockedInColors.primary.withValues(alpha: 0.5)
                : LockedInColors.line,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.terminal_outlined,
                  size: 15,
                  color: LockedInColors.muted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'command',
                    style: TextStyle(
                      color: LockedInColors.foreground,
                      fontSize: TypeScale.body,
                    ),
                  ),
                ),
                if (deciding) ...[
                  _Chip('running…', tone: LockedInColors.warning),
                  const SizedBox(width: 8),
                ],
                // A project-relative cwd can be deep; the chip is a value,
                // so it caps and ellipsises instead of widening the row.
                Flexible(
                  child: _Chip(
                    'cwd ${command.cwd.isEmpty ? '.' : command.cwd}',
                    maxWidth: 220,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              decoration: BoxDecoration(
                color: LockedInColors.background,
                borderRadius: BorderRadius.circular(Radii.control),
                border: Border.all(color: LockedInColors.line),
              ),
              child: command.argv.isEmpty
                  ? const _Muted('this command has no arguments')
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (var i = 0; i < command.argv.length; i++)
                          Text(
                            '$i  ${command.argv[i]}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: LockedInColors.foreground,
                              fontSize: TypeScale.label,
                              fontFamily: 'monospace',
                              height: 1.4,
                            ),
                          ),
                      ],
                    ),
            ),
            if (command.reason.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'reason · ${command.reason.trim()}',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.4,
                ),
              ),
            ],
            if (command.risk.trim().isNotEmpty) ...[
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.warning_amber_rounded,
                    size: 14,
                    color: LockedInColors.warning,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      command.risk.trim(),
                      style: TextStyle(
                        color: LockedInColors.warning,
                        fontSize: TypeScale.label,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            if (_commandsBlocked) ...[
              const SizedBox(height: 8),
              const _OptInBlocked(
                key: ValueKey('approval-command-optin-off'),
                message:
                    'Commands are switched off in Settings → Work; turn them '
                    'on to approve a command.',
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                if (!deciding) ...[
                  OutlinedButton(
                    key: ValueKey('approval-deny-${command.id}'),
                    onPressed: canDecide
                        ? () {
                            _selectFor(command.id);
                            _reject();
                          }
                        : null,
                    child: const Text('deny'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: ValueKey('approval-run-${command.id}'),
                    onPressed: canApprove
                        ? () {
                            _selectFor(command.id);
                            _approve();
                          }
                        : null,
                    child: const Text('approve and run'),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Text(
                    _commandsBlocked
                        ? 'approve is off in Settings → Work · n deny'
                        : canApprove
                        ? 'y approve and run · n deny'
                        : widget.onDecideCommand == null
                        ? 'read-only'
                        : 'deciding…',
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.micro,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _errorNote(String message) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.error),
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
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The colour of one unified-diff line; the prefix is the signal, colour is the
/// second cue.
Color _diffTone(String line) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return LockedInColors.secondary;
  }
  if (line.startsWith('+')) return LockedInColors.success;
  if (line.startsWith('-')) return LockedInColors.error;
  if (line.startsWith('@@')) return LockedInColors.primary;
  return LockedInColors.muted;
}

/// The one-line reason an approval is disabled by the global opt-in.
///
/// It is deliberately separate from a core refusal: the core is still the gate,
/// so a stale local view can never light this up as a false "allowed", and a
/// refusal from `decide` still renders its own message above the rows.
class _OptInBlocked extends StatelessWidget {
  const _OptInBlocked({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.lock_outline, size: 14, color: LockedInColors.warning),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: TextStyle(
              color: LockedInColors.warning,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.text, {this.tone, this.maxWidth});

  final String text;
  final Color? tone;

  /// Caps a chip whose text is a value (a path), never a label.
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    final label = Text(
      text,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        color: tone ?? LockedInColors.muted,
        fontSize: TypeScale.micro,
        fontWeight: FontWeight.w600,
      ),
    );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: maxWidth == null
          ? label
          : ConstrainedBox(
              constraints: BoxConstraints(maxWidth: maxWidth!),
              child: label,
            ),
    );
  }
}

class _Muted extends StatelessWidget {
  const _Muted(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(color: LockedInColors.muted, fontSize: TypeScale.label),
    );
  }
}
