import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';

/// The Archive surface.
///
/// The archive keeps what was already pushed to the configured backend, on both
/// sides of the wall. Every verb is explicit and named:
///
/// * `Enter`/`R` restores the selected item with a named confirmation. The
///   folder backend restores a school session and a skills goal alike.
/// * `d` deletes the **archived** copy with its own named confirmation; the live
///   session or goal is never touched.
/// * `r` re-reads the backend and `Esc` goes back.
///
/// A row with an action in flight reads `restoring…`/`deleting…`; a refusal keeps
/// the row and shows the core's own sentence inline.
class ArchivePage extends StatefulWidget {
  const ArchivePage({
    super.key,
    this.rows = const <ArchiveRow>[],
    this.loading = false,
    this.error,
    this.onRefresh,
    this.onBack,
    this.onRestore,
    this.onDelete,
  });

  /// The latest `archive.list` rows, or empty before the first answer.
  final List<ArchiveRow> rows;

  /// True while `archive.list` is in flight. With a previous [rows] on screen
  /// this is a quiet progress line, not a blank page.
  final bool loading;

  /// The last read failure. Page-local: a failure never replaces the rows.
  final String? error;

  /// `r` (and the Retry button) asks the shell to read the archive again.
  final VoidCallback? onRefresh;

  /// `Esc` — Archive is a snapshot over the workspace, so it goes home to chat.
  final VoidCallback? onBack;

  /// `Enter`/`R` after the named confirmation: move the selected archived item
  /// back into the live workspace, on either side of the wall. Null keeps the
  /// listing read-only (a page rendered without a core still explains itself
  /// rather than offering a dead verb).
  final Future<void> Function(ArchiveRow row)? onRestore;

  /// `d` after the named confirmation: delete the selected **archived** copy.
  /// Null hides the delete verb; the live item is never touched by this action.
  final Future<void> Function(ArchiveRow row)? onDelete;

  @override
  State<ArchivePage> createState() => _ArchivePageState();
}

class _ArchivePageState extends State<ArchivePage> {
  static const _knownSides = ['school', 'skills'];

  final _scroll = ScrollController();
  final _rowKeys = <String, GlobalKey>{};

  /// The row under the cursor, as an index into [_orderedRows].
  var _selectedIndex = 0;

  /// The item with an `archive.restore` in flight, if any. Its row reads
  /// `restoring…` and the verbs ignore the keyboard until the core answers.
  String? _restoringId;

  /// The item with an `archive.remove` in flight, if any. Its row reads
  /// `deleting…` on the same terms as [_restoringId].
  String? _deletingId;

  /// True while any archive action is in flight.
  bool get _busy => _restoringId != null || _deletingId != null;

  /// The last action's refusal, shown above the list with one Retry. A
  /// page-local action failure is never a shell-wide transport failure.
  String? _actionError;

  /// The item whose action failed, kept so Retry asks for the same one.
  ArchiveRow? _failedRow;

  /// True when [_failedRow] failed to delete rather than to restore.
  bool _failedDelete = false;

  /// The last action's success line (`restored “…”` / `deleted “…”`).
  String? _notice;

  /// True while a confirmation dialog owns the keyboard.
  bool _dialogOpen = false;

  /// The keys this page actually offers, generated rather than hard-coded so a
  /// page rendered without a handler never advertises one.
  String get _hint {
    final parts = <String>['j/k move'];
    if (widget.onRestore != null) parts.add('Enter restore');
    if (widget.onDelete != null) parts.add('d delete');
    if (widget.onRefresh != null) parts.add('r reload');
    return parts.length == 1 ? 'read-only' : parts.join(' · ');
  }

  @override
  void didUpdateWidget(covariant ArchivePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final count = _orderedRows.length;
    if (count > 0 && _selectedIndex > count - 1) _selectedIndex = count - 1;
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// The sides present in the list: school first, then skills, then anything a
  /// newer core archived that this shell does not know about.
  List<String> get _sides {
    final present = <String>{};
    for (final row in widget.rows) {
      final side = _sideOf(row);
      if (side.isNotEmpty) present.add(side);
    }
    final ordered = <String>[];
    for (final side in _knownSides) {
      if (present.remove(side)) ordered.add(side);
    }
    final extra = present.toList()..sort();
    return [...ordered, ...extra];
  }

  /// The rows in display order: grouped by side, matching the rendered list, so
  /// `j`/`k` never jump between groups in a different order than they appear.
  List<ArchiveRow> get _orderedRows {
    final rows = <ArchiveRow>[];
    for (final side in _sides) {
      rows.addAll(widget.rows.where((row) => _sideOf(row) == side));
    }
    return rows;
  }

  int get _selected {
    final rows = _orderedRows;
    if (rows.isEmpty) return -1;
    return _selectedIndex.clamp(0, rows.length - 1);
  }

  ArchiveRow? get _selectedRow {
    final rows = _orderedRows;
    final index = _selected;
    if (index < 0 || index >= rows.length) return null;
    return rows[index];
  }

  GlobalKey _rowKey(String id) =>
      _rowKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'archive-$id'));

  /// A row's side, with an unnamed side kept visible instead of dropped.
  static String _sideOf(ArchiveRow row) {
    final side = row.side.trim();
    return side.isEmpty ? 'other' : side;
  }

  int _countOf(String side) =>
      widget.rows.where((row) => _sideOf(row) == side).length;

  void _move(int delta) {
    final rows = _orderedRows;
    if (rows.length < 2) return;
    final current = _selectedIndex.clamp(0, rows.length - 1);
    final next = (current + delta).clamp(0, rows.length - 1);
    if (next == current) return;
    setState(() => _selectedIndex = next);
    final id = rows[next].id;
    WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(id));
  }

  void _reveal(String id) {
    final target = _rowKeys[id]?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      alignment: 0.5,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
    );
  }

  /// The core's own one-line reason for a refusal, read from the error data so
  /// the page shows the sentence the core wrote, not a wrapper.
  static String _reason(Object failure) {
    if (failure is RpcException) {
      final data = failure.data;
      if (data is Map) {
        final message = data['message'];
        if (message is String && message.isNotEmpty) return message;
      }
      return failure.message;
    }
    return failure.toString();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // A confirmation dialog owns the keyboard while it is open.
    if (_dialogOpen) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    // The verbs fire once per press, never on key repeat: a held `r` must not
    // queue a second read and a held Enter must not restore twice.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.escape) {
      widget.onBack?.call();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (widget.onRestore == null || _selectedRow == null || _busy) {
        return KeyEventResult.ignored;
      }
      _restoreSelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyD) {
      if (widget.onDelete == null || _selectedRow == null || _busy) {
        return KeyEventResult.ignored;
      }
      _deleteSelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      if (HardwareKeyboard.instance.isShiftPressed) {
        if (widget.onRestore == null || _selectedRow == null || _busy) {
          return KeyEventResult.ignored;
        }
        _restoreSelected();
        return KeyEventResult.handled;
      }
      if (widget.onRefresh != null) {
        widget.onRefresh!();
        return KeyEventResult.handled;
      }
    }
    return KeyEventResult.ignored;
  }

  void _restoreSelected() {
    final row = _selectedRow;
    if (row == null) return;
    unawaited(_restore(row));
  }

  void _deleteSelected() {
    final row = _selectedRow;
    if (row == null) return;
    unawaited(_delete(row));
  }

  void _retry() {
    final row = _failedRow;
    if (row == null) {
      widget.onRefresh?.call();
      return;
    }
    unawaited(_failedDelete ? _delete(row) : _restore(row));
  }

  /// Confirms, then restores one archived item on either side of the wall.
  ///
  /// A restore moves the archived copy back into the live workspace, so it is a
  /// destructive change and needs the named confirmation first. `Cancel`, `Esc`
  /// or a dismissal changes nothing.
  Future<void> _restore(ArchiveRow row) async {
    final restore = widget.onRestore;
    if (restore == null || _dialogOpen || _busy) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmArchiveRestore(
        context,
        name: row.displayName,
        side: _sideOf(row),
      );
      if (!confirmed || !mounted) return;
      setState(() {
        _restoringId = row.id;
        _actionError = null;
        _failedRow = null;
        _failedDelete = false;
        _notice = null;
      });
      try {
        await restore(row);
        if (!mounted) return;
        setState(() => _notice = 'restored “${row.displayName}”');
      } catch (failure) {
        if (mounted) {
          setState(() {
            _actionError = _reason(failure);
            _failedRow = row;
            _failedDelete = false;
          });
        }
      } finally {
        if (mounted) setState(() => _restoringId = null);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  /// Confirms, then deletes one **archived** item (`archive.remove`).
  ///
  /// The confirmation names the row and says both halves of the consequence:
  /// the archive copy goes and the live item is untouched. `Cancel`, `Esc` or a
  /// dismissal changes nothing and shows no banner.
  Future<void> _delete(ArchiveRow row) async {
    final remove = widget.onDelete;
    if (remove == null || _dialogOpen || _busy) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmArchiveDelete(
        context,
        name: row.displayName,
      );
      if (!confirmed || !mounted) return;
      setState(() {
        _deletingId = row.id;
        _actionError = null;
        _failedRow = null;
        _failedDelete = true;
        _notice = null;
      });
      try {
        await remove(row);
        if (!mounted) return;
        setState(
          () => _notice = 'deleted “${row.displayName}” from the archive',
        );
      } catch (failure) {
        if (mounted) {
          setState(() {
            _actionError = _reason(failure);
            _failedRow = row;
            _failedDelete = true;
          });
        }
      } finally {
        if (mounted) setState(() => _deletingId = null);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 620;
        return Focus(
          autofocus: true,
          onKeyEvent: _onKey,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _header(compact: compact),
                const SizedBox(height: 12),
                Text(
                  _hint,
                  key: const ValueKey('archive-restore-hint'),
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
                const SizedBox(height: 8),
                if (_actionError != null || _notice != null) ...[
                  _ActionBanner(
                    message: _actionError ?? _notice!,
                    failed: _actionError != null,
                    onRetry: _failedRow == null ? null : _retry,
                    onDismiss: () => setState(() {
                      _actionError = null;
                      _notice = null;
                      _failedRow = null;
                    }),
                  ),
                  const SizedBox(height: 10),
                ],
                Expanded(child: _body()),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _header({required bool compact}) {
    final theme = Theme.of(context);
    final summary = [
      for (final side in _sides) _countLabel(side, _countOf(side)),
    ].join(' · ');
    return Row(
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          'ARCHIVE',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: 11,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        Container(
          key: const ValueKey('archive-total'),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            '${widget.rows.length}',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            summary,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ),
        if (!compact)
          Text(
            'r refresh · Esc back',
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
      ],
    );
  }

  Widget _body() {
    final rows = widget.rows;
    final children = <Widget>[];
    if (widget.loading && rows.isNotEmpty) {
      children.add(
        LinearProgressIndicator(
          minHeight: 2,
          color: LockedInColors.primary,
          backgroundColor: LockedInColors.line,
        ),
      );
      children.add(const SizedBox(height: 10));
    }
    if (widget.error != null) {
      children.add(
        _ErrorBlock(message: widget.error!, onRetry: widget.onRefresh),
      );
      children.add(const SizedBox(height: 10));
    }
    if (rows.isEmpty) {
      if (widget.loading) {
        children.add(const _LoadingState());
      } else if (widget.error == null) {
        children.add(
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 32),
            child: _EmptyState(),
          ),
        );
      }
    } else {
      final ordered = _orderedRows;
      String? currentSide;
      var index = 0;
      for (final row in ordered) {
        final side = _sideOf(row);
        if (side != currentSide) {
          if (currentSide != null) children.add(const SizedBox(height: 4));
          children.add(_GroupHeader(side: side, count: _countOf(side)));
          children.add(const SizedBox(height: 6));
          currentSide = side;
        }
        final selected = index == _selected;
        children.add(
          Padding(
            key: _rowKey(row.id),
            padding: const EdgeInsets.only(bottom: 6),
            child: _ArchiveRowTile(
              key: ValueKey('archive-row-${row.id}'),
              row: row,
              selected: selected,
              restoring: _restoringId == row.id,
              deleting: _deletingId == row.id,
              onTap: () {
                if (_busy) return;
                setState(() => _selectedIndex = index);
              },
              onRestore: widget.onRestore == null || _busy
                  ? null
                  : () {
                      setState(() => _selectedIndex = index);
                      unawaited(_restore(row));
                    },
              onDelete: widget.onDelete == null || _busy
                  ? null
                  : () {
                      setState(() => _selectedIndex = index);
                      unawaited(_delete(row));
                    },
            ),
          ),
        );
        index += 1;
      }
      children.add(const SizedBox(height: 6));
    }
    return ListView(
      key: const ValueKey('archive-list'),
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 8),
      children: children,
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({required this.side, required this.count});

  final String side;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Row(
      key: ValueKey('archive-group-$side'),
      children: [
        Icon(_sideIcon(side), size: 13, color: LockedInColors.muted),
        const SizedBox(width: 6),
        Text(
          side.toUpperCase(),
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 10,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 8),
        Container(
          key: ValueKey('archive-group-$side-count'),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

/// One archived item: its kind, title, date, size and backend.
class _ArchiveRowTile extends StatelessWidget {
  const _ArchiveRowTile({
    super.key,
    required this.row,
    this.selected = false,
    this.restoring = false,
    this.deleting = false,
    this.onTap,
    this.onRestore,
    this.onDelete,
  });

  final ArchiveRow row;

  /// True for the row under the cursor. Selection is a fill plus a `▌` marker,
  /// never colour alone.
  final bool selected;

  /// True while this row's `archive.restore` is in flight.
  final bool restoring;

  /// True while this row's `archive.remove` is in flight.
  final bool deleting;

  final VoidCallback? onTap;

  /// The pointer path for `Enter` / `d`. Both still confirm first; the buttons
  /// only start the same flow the keys do.
  final VoidCallback? onRestore;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final detail = _joinDot([
      _dateLabel(row.date),
      _sizeLabel(row.sizeBytes),
      row.backend,
    ]);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 10, 12, 10),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: selected ? LockedInColors.primary : LockedInColors.line,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 14,
              child: selected
                  ? Text(
                      '▌',
                      key: ValueKey('archive-row-cursor'),
                      style: TextStyle(
                        color: LockedInColors.primary,
                        fontSize: 13,
                      ),
                    )
                  : null,
            ),
            _KindTag(kind: row.kind),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium,
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      detail,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (restoring) ...[
              const SizedBox(width: 10),
              Text(
                'restoring…',
                key: ValueKey('archive-restoring'),
                style: TextStyle(color: LockedInColors.accent, fontSize: 11),
              ),
            ] else if (deleting) ...[
              const SizedBox(width: 10),
              Text(
                'deleting…',
                key: ValueKey('archive-deleting'),
                style: TextStyle(color: LockedInColors.error, fontSize: 11),
              ),
            ] else if (onRestore != null || onDelete != null) ...[
              const SizedBox(width: 8),
              if (onRestore != null)
                TextButton(
                  key: ValueKey('archive-restore-${row.id}'),
                  onPressed: onRestore,
                  child: const Text('restore'),
                ),
              if (onDelete != null)
                IconButton(
                  key: ValueKey('archive-delete-${row.id}'),
                  tooltip: 'delete (d)',
                  onPressed: onDelete,
                  icon: const Icon(Icons.delete_outline, size: 16),
                  visualDensity: VisualDensity.compact,
                  color: LockedInColors.muted,
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A row's kind, paired with a glyph so colour is never the only signal.
class _KindTag extends StatelessWidget {
  const _KindTag({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    final label = kind.trim().isEmpty ? 'item' : kind.trim();
    final color = _kindColor(label);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_kindIcon(label), size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            label.toUpperCase(),
            style: TextStyle(
              color: color,
              fontSize: 9,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorBlock extends StatelessWidget {
  const _ErrorBlock({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('archive-error'),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.error_outline, size: 16, color: LockedInColors.error),
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
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                key: const ValueKey('archive-retry'),
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

/// One page-local restore outcome: a refusal with an optional Retry, or the
/// success line after the row moved back. It never replaces the list.
class _ActionBanner extends StatelessWidget {
  const _ActionBanner({
    required this.message,
    required this.failed,
    required this.onDismiss,
    this.onRetry,
  });

  final String message;
  final bool failed;
  final VoidCallback onDismiss;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final color = failed ? LockedInColors.error : LockedInColors.success;
    return Container(
      key: const ValueKey('archive-action-banner'),
      padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.55)),
      ),
      child: Row(
        children: [
          Icon(
            failed ? Icons.error_outline : Icons.check_circle_outline,
            size: 15,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: color, fontSize: 12, height: 1.4),
            ),
          ),
          if (onRetry != null)
            TextButton(
              key: const ValueKey('archive-restore-retry'),
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          IconButton(
            key: const ValueKey('archive-action-dismiss'),
            tooltip: 'dismiss',
            onPressed: onDismiss,
            icon: const Icon(Icons.close, size: 14),
            visualDensity: VisualDensity.compact,
            color: LockedInColors.muted,
          ),
        ],
      ),
    );
  }
}

/// Confirms restoring one archived item, naming it and the consequence.
///
/// [side] picks the copy: a school session says the archived copy moves back and
/// that chat history was not archived; a skills goal says the curriculum and
/// gathered sources come back.
///
/// Returns true only for the explicit Restore button; `Esc`, Cancel or a
/// dismissal is false and nothing moves.
Future<bool> confirmArchiveRestore(
  BuildContext context, {
  required String name,
  String side = 'school',
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _RestoreDialog(name: name, side: side),
  );
  return result ?? false;
}

/// Confirms deleting one **archived** item, naming it and the consequence.
///
/// The live item is never touched by this action, and the copy says so.
/// Returns true only for the explicit Delete button; `Esc`, Cancel or a
/// dismissal is false and nothing is deleted.
Future<bool> confirmArchiveDelete(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _DeleteDialog(name: name),
  );
  return result ?? false;
}

/// The named confirmation a restore needs: the item's name as the question, the
/// consequence spelled out for its side, and two explicit buttons.
class _RestoreDialog extends StatelessWidget {
  const _RestoreDialog({required this.name, required this.side});

  final String name;
  final String side;

  String get _consequence => side == 'skills'
      ? "The goal's curriculum and sources come back; chats were not archived."
      : 'The archived copy moves back; chat history was not archived.';

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey != LogicalKeyboardKey.escape) {
          return KeyEventResult.ignored;
        }
        Navigator.of(context).pop(false);
        return KeyEventResult.handled;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('restore from archive'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Restore “$name”?',
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                _consequence,
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
            key: const ValueKey('archive-restore-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('archive-restore-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Restore'),
          ),
        ],
      ),
    );
  }
}

/// The named confirmation a delete needs: the item's name as the question, the
/// archive-copy consequence spelled out, and two explicit buttons.
class _DeleteDialog extends StatelessWidget {
  const _DeleteDialog({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (event.logicalKey != LogicalKeyboardKey.escape) {
          return KeyEventResult.ignored;
        }
        Navigator.of(context).pop(false);
        return KeyEventResult.handled;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: const Text('delete from archive'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Delete “$name” from the archive?',
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'The archived copy goes; the live item is untouched.',
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
            key: const ValueKey('archive-delete-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('archive-delete-confirm'),
            style: FilledButton.styleFrom(
              backgroundColor: LockedInColors.error,
              foregroundColor: LockedInColors.background,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 32),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: LockedInColors.primary,
              ),
            ),
            SizedBox(height: 14),
            Text(
              'loading archive…',
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      key: const ValueKey('archive-empty'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.archive_outlined, size: 26, color: LockedInColors.muted),
          const SizedBox(height: 10),
          Text('nothing archived yet', style: theme.textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'archive a session or goal to see it here',
            textAlign: TextAlign.center,
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

Color _kindColor(String kind) => switch (kind) {
  'session' => LockedInColors.primary,
  'goal' => LockedInColors.secondary,
  'project' => LockedInColors.accent,
  _ => LockedInColors.muted,
};

IconData _kindIcon(String kind) => switch (kind) {
  'session' => Icons.description_outlined,
  'goal' => Icons.school_outlined,
  'project' => Icons.work_outline,
  _ => Icons.archive_outlined,
};

IconData _sideIcon(String side) => switch (side) {
  'school' => Icons.school_outlined,
  'skills' => Icons.auto_awesome_outlined,
  _ => Icons.folder_outlined,
};

/// The date part of an ISO-8601 instant; anything shorter is shown as it is.
String _dateLabel(String date) {
  final trimmed = date.trim();
  if (trimmed.isEmpty) return '';
  return trimmed.length >= 10 ? trimmed.substring(0, 10) : trimmed;
}

/// A human readable size. The core reports bytes, so the shell only formats.
String _sizeLabel(int bytes) {
  final value = bytes < 0 ? 0 : bytes;
  if (value < 1024) return '$value B';
  final kb = value / 1024;
  if (kb < 1024) return '${kb.toStringAsFixed(1)} KB';
  final mb = kb / 1024;
  if (mb < 1024) return '${mb.toStringAsFixed(1)} MB';
  return '${(mb / 1024).toStringAsFixed(1)} GB';
}

String _countLabel(String side, int count) {
  final noun = switch (side) {
    'school' => 'school',
    'skills' => 'skills',
    _ => side,
  };
  return '$count $noun';
}

String _joinDot(List<String> parts) =>
    parts.where((part) => part.trim().isNotEmpty).join(' · ');
