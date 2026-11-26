import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The Work activity log (`activity.list`).
///
/// The log answers "did I approve that write?" without keeping any of the code
/// that was decided about. Every row is **metadata only**: a write or command
/// decision, or one swarm lifecycle event. There is no file body, no diff, no
/// prompt and no command output here, because the core's per-kind whitelist
/// never writes one.
///
/// The page is read-only. `s` cycles the kind filter (`all → write → command →
/// swarm`) and re-reads, `r` re-reads the current filter, `j`/`k` move and `Esc`
/// returns to the project detail. The shell owns the read and the filter; this
/// page never calls the core itself and never records a decision.
class ActivityPage extends StatefulWidget {
  const ActivityPage({
    super.key,
    required this.records,
    this.skipped = 0,
    this.empty = false,
    this.loading = false,
    this.error,
    this.kind,
    this.project,
    this.onBack,
    this.onRefresh,
    this.onKind,
  });

  /// The records the core returned for [kind] and [project], newest first.
  final List<ActivityRecordView> records;

  /// Corrupt lines the core skipped on the last read. Shown beside the count and
  /// never treated as an error.
  final int skipped;

  /// The core's flag for a log that does not exist yet.
  final bool empty;

  /// True while `activity.list` is in flight.
  final bool loading;

  /// The last read failure. It never replaces the rows the shell already has.
  final String? error;

  /// The kind filter the rows answer: null for every kind, otherwise
  /// `write-decision`, `command-decision` or `swarm`.
  final String? kind;

  /// The project the log was opened for, or null for every project.
  final String? project;

  /// `Esc` and the back control return to the project detail.
  final VoidCallback? onBack;

  /// `r` re-reads the current filter. Null keeps the page read-only.
  final VoidCallback? onRefresh;

  /// `s` asks for the next kind filter (null means every kind). Null drops the
  /// key, which is what a shell without `activity.list` gets.
  final ValueChanged<String?>? onKind;

  @override
  State<ActivityPage> createState() => _ActivityPageState();
}

/// The kind filter, in the order `s` cycles it.
const _activityKinds = <String?>[
  null,
  'write-decision',
  'command-decision',
  'swarm',
];

class _ActivityPageState extends State<ActivityPage> {
  static const _selectedRowKey = ValueKey('activity-row-selected');

  final _rowKeys = <int, GlobalKey>{};
  var _selected = 0;

  /// The rows whose full record is showing. More than one can be open: the log
  /// is a list to compare, not a set of tabs.
  final _expanded = <int>{};

  int get _selectedRow => widget.records.isEmpty
      ? -1
      : _selected.clamp(0, widget.records.length - 1);

  @override
  void didUpdateWidget(ActivityPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_selected >= widget.records.length) {
      _selected = widget.records.isEmpty ? 0 : widget.records.length - 1;
    }
    if (oldWidget.records != widget.records ||
        oldWidget.kind != widget.kind ||
        oldWidget.project != widget.project) {
      // The expansion set is keyed by position, so it cannot survive a
      // different list.
      _expanded.clear();
    }
  }

  GlobalKey _rowKey(int index) => _rowKeys.putIfAbsent(
    index,
    () => GlobalKey(debugLabel: 'activity-$index'),
  );

  void _move(int delta) {
    if (widget.records.length < 2) return;
    final next = (_selectedRow + delta).clamp(0, widget.records.length - 1);
    if (next == _selectedRow) return;
    setState(() => _selected = next);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _rowKeys[next]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  /// Advance the kind filter and re-read through the shell.
  void _cycleKind() {
    final onKind = widget.onKind;
    if (onKind == null) return;
    final index = _activityKinds.indexOf(widget.kind);
    final next = _activityKinds[(index + 1) % _activityKinds.length];
    onKind(next);
  }

  void _toggleSelected() {
    if (widget.records.isEmpty) return;
    setState(() {
      if (!_expanded.remove(_selected)) _expanded.add(_selected);
    });
  }

  void _refresh() {
    final refresh = widget.onRefresh;
    if (refresh == null) return;
    refresh();
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
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    // Enter is the pointer's click: the full timestamp, argv and hunks are
    // otherwise unreachable from the keyboard.
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (event is KeyDownEvent) _toggleSelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS && widget.onKind != null) {
      if (event is KeyDownEvent) _cycleKind();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR && widget.onRefresh != null) {
      if (event is KeyDownEvent) _refresh();
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
    final count = widget.records.length;
    final skipped = widget.skipped;
    final project = widget.project?.trim() ?? '';
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
                Text('ACTIVITY', style: theme.textTheme.titleMedium),
                Text(
                  project.isEmpty
                      ? 'write, command and swarm decisions'
                      : '$project · write, command and swarm decisions',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
                // A skipped line is a note beside the rows, never an error: one
                // interrupted append must not hide every other decision.
                if (skipped > 0)
                  Text(
                    'skipped $skipped unreadable line(s)',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.micro,
                    ),
                  ),
              ],
            ),
          ),
          if (widget.loading) ...[
            const SizedBox(width: 8),
            _Chip('reading…', tone: LockedInColors.warning),
          ],
          const SizedBox(width: 8),
          _Chip(count == 1 ? '1 record' : '$count records'),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    final error = widget.error;
    final records = widget.records;
    if (records.isEmpty) {
      if (widget.loading) {
        return Center(
          child: Text(
            'reading activity…',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        );
      }
      if (error != null) {
        return _centered(
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _filterLine(),
              const SizedBox(height: 10),
              _errorCard(error),
            ],
          ),
        );
      }
      return _centered(
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _filterLine(),
            const SizedBox(height: 10),
            _emptyCard(),
            const SizedBox(height: 12),
            _metadataNote(),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _filterLine(),
                const SizedBox(height: 10),
                if (error != null) ...[
                  _errorCard(error),
                  const SizedBox(height: 10),
                ],
                for (var index = 0; index < records.length; index++)
                  _row(records[index], index),
                const SizedBox(height: 12),
                _metadataNote(),
                const SizedBox(height: 10),
                Text(
                  'j/k move · s kind · r re-read · Esc back',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
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

  /// The active project and kind filters. The kind line is always shown, so a
  /// filter is never invisible; the project line appears only when the shell
  /// opened the log for one project.
  Widget _filterLine() {
    final project = widget.project?.trim() ?? '';
    return Wrap(
      spacing: 10,
      runSpacing: 3,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (project.isNotEmpty)
          Text(
            'project · $project',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              fontFamily: 'monospace',
            ),
          ),
        if (widget.onKind == null)
          Text(
            'kind · ${_kindLabel(widget.kind)}',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
            ),
          )
        else
          // The filter is a chip: `s` and a click run the same cycle.
          InkWell(
            key: const ValueKey('activity-kind-filter'),
            borderRadius: BorderRadius.circular(Radii.control),
            onTap: _cycleKind,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: LockedInColors.panel,
                borderRadius: BorderRadius.circular(Radii.control),
                border: Border.all(color: LockedInColors.line),
              ),
              child: Text(
                'kind · ${_kindLabel(widget.kind)}',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.micro,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        if (widget.onKind != null)
          Text(
            's cycles the kind filter',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
            ),
          ),
      ],
    );
  }

  Widget _row(ActivityRecordView record, int index) {
    final selected = index == _selectedRow;
    final tag = _kindTag(record.kind);
    final tone = _kindTone(record.kind);
    final subject = _subject(record);
    final decision = _decisionText(record);
    final decisionTone = _decisionTone(record);
    final cwd = record.cwd ?? '';
    final hunks = record.hunks;
    final exitCode = record.exitCode;
    return Padding(
      key: _rowKey(index),
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected ? LockedInColors.panel : LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          key: ValueKey('activity-row-$index'),
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: () => setState(() {
            _selected = index;
            if (!_expanded.remove(index)) _expanded.add(index);
          }),
          child: Container(
            key: selected ? _selectedRowKey : null,
            padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.layer),
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
                  width: 62,
                  child: Text(
                    tag,
                    style: TextStyle(
                      color: tone,
                      fontSize: TypeScale.label,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        subject,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.key,
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 10,
                        runSpacing: 2,
                        children: [
                          Text(
                            record.project.isEmpty
                                ? '(no project)'
                                : record.project,
                            style: TextStyle(
                              color: LockedInColors.muted,
                              fontSize: TypeScale.micro,
                              fontFamily: 'monospace',
                            ),
                          ),
                          Text(
                            decision,
                            style: TextStyle(
                              color: decisionTone,
                              fontSize: TypeScale.micro,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (hunks.isNotEmpty)
                            Text(
                              hunks.length == 1
                                  ? '1 hunk'
                                  : '${hunks.length} hunks',
                              style: TextStyle(
                                color: LockedInColors.muted,
                                fontSize: TypeScale.micro,
                              ),
                            ),
                          if (cwd.isNotEmpty)
                            Text(
                              'cwd $cwd',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: LockedInColors.muted,
                                fontSize: TypeScale.micro,
                                fontFamily: 'monospace',
                              ),
                            ),
                          if (exitCode != null)
                            Text(
                              'exit $exitCode',
                              style: TextStyle(
                                color: LockedInColors.muted,
                                fontSize: TypeScale.micro,
                                fontFamily: 'monospace',
                              ),
                            ),
                          if (record.timedOut)
                            Text(
                              'timed out',
                              style: TextStyle(
                                color: LockedInColors.warning,
                                fontSize: TypeScale.micro,
                              ),
                            ),
                        ],
                      ),
                      if (_expanded.contains(index)) ...[
                        const SizedBox(height: 8),
                        Container(
                          key: ValueKey('activity-expanded-$index'),
                          padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
                          decoration: BoxDecoration(
                            color: LockedInColors.background,
                            borderRadius: BorderRadius.circular(Radii.control),
                            border: Border.all(color: LockedInColors.line),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                record.at.isEmpty
                                    ? 'time not recorded'
                                    : record.at,
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: TypeScale.micro,
                                  fontFamily: 'monospace',
                                ),
                              ),
                              if (record.argv.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text(
                                  record.argv.join(' '),
                                  style: TextStyle(
                                    color: LockedInColors.foreground,
                                    fontSize: TypeScale.label,
                                    fontFamily: 'monospace',
                                    height: 1.4,
                                  ),
                                ),
                              ],
                              if (hunks.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text(
                                  'hunks ${hunks.join(', ')}',
                                  style: TextStyle(
                                    color: LockedInColors.muted,
                                    fontSize: TypeScale.micro,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ],
                              if (cwd.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text(
                                  'cwd ${record.cwd}',
                                  style: TextStyle(
                                    color: LockedInColors.muted,
                                    fontSize: TypeScale.micro,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 74,
                  child: Text(
                    _timeLabel(record.at),
                    textAlign: TextAlign.right,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.micro,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _centered(Widget child) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: child,
        ),
      ),
    );
  }

  Widget _emptyCard() {
    final kind = widget.kind;
    return _Panel(
      icon: Icons.history_toggle_off,
      title: widget.empty || kind == null
          ? 'no decisions recorded yet · approve or deny a Work change to '
                'fill this'
          : 'no ${_kindLabel(kind)} records for this project · s cycles the '
                'kind filter',
      body: widget.empty || kind == null
          ? 'A write approval, a command decision and a swarm run each add one '
                'row. The log lives outside the workspace, so it never leaves '
                'with an export or an archive.'
          : 'r re-reads the log after a decision is taken elsewhere.',
    );
  }

  Widget _errorCard(String message) {
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
                    fontSize: TypeScale.label,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
          if (widget.onRefresh != null) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: widget.onRefresh,
                icon: const Icon(Icons.refresh, size: 15),
                label: const Text('Retry'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// The honest limit of the surface: it is a decision log, not a diff or a
  /// transcript.
  Widget _metadataNote() {
    return Text(
      'metadata only · no file bodies, no prompts, no output',
      style: TextStyle(
        color: LockedInColors.muted,
        fontSize: TypeScale.micro,
        height: 1.4,
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 17, color: LockedInColors.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontSize: TypeScale.proseSmall, height: 1.4),
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
        ],
      ),
    );
  }
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
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// The short word for one record kind: the wire values are long, the tag is not.
String _kindTag(String kind) {
  return switch (kind) {
    'write-decision' => 'write',
    'command-decision' => 'command',
    'swarm' => 'swarm',
    _ => kind.isEmpty ? 'record' : kind,
  };
}

String _kindLabel(String? kind) {
  if (kind == null || kind.isEmpty) return 'all';
  return _kindTag(kind);
}

Color _kindTone(String kind) {
  return switch (kind) {
    'write-decision' => LockedInColors.secondary,
    'command-decision' => LockedInColors.warning,
    'swarm' => LockedInColors.primary,
    _ => LockedInColors.muted,
  };
}

/// The one-line subject: the relative path, the argv, or the run and task.
String _subject(ActivityRecordView record) {
  final path = record.path;
  if (path != null && path.isNotEmpty) return path;
  if (record.argv.isNotEmpty) return record.argv.join(' ');
  final run = record.run ?? '';
  final task = record.task;
  if (run.isEmpty) return '(no subject)';
  return task == null || task.isEmpty ? run : '$run · $task';
}

/// The decision word, or the swarm event. A word is always shown, so a tone is
/// never the only signal.
String _decisionText(ActivityRecordView record) {
  final decision = record.decision;
  if (decision != null && decision.isNotEmpty) return decision;
  final event = record.event;
  if (event == null || event.isEmpty) return 'event';
  if (event == 'task') {
    final status = record.status;
    return status == null || status.isEmpty ? 'task' : 'task · $status';
  }
  return event;
}

Color _decisionTone(ActivityRecordView record) {
  final decision = record.decision;
  if (decision != null && decision.isNotEmpty) {
    return decision == 'approve'
        ? LockedInColors.success
        : LockedInColors.error;
  }
  return switch (record.event) {
    'started' => LockedInColors.primary,
    'finished' => LockedInColors.success,
    'failed' => LockedInColors.error,
    'cancelled' => LockedInColors.warning,
    _ => LockedInColors.muted,
  };
}

/// `2026-11-01T10:01:00.000Z` becomes `11-01 10:01`; anything else is unchanged.
String _timeLabel(String value) {
  if (value.trim().isEmpty) return 'not recorded';
  final match = RegExp(r'^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2})').firstMatch(value);
  return match == null ? value : '${match.group(1)} ${match.group(2)}';
}
