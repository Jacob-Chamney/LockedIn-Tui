import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../theme/palette.dart';

/// The category order the inventory is grouped in.
///
/// It matches the domain catalogue's shelves; a row whose category the core
/// never sends lands in a trailing `other` group rather than disappearing.
const _categories = <String>['starter', 'learning', 'work', 'collection'];

/// The Achievements layer: a read-only inventory opened over Stats.
///
/// The rows come from one `achievements.list` answer, in catalogue order, and
/// the page keeps them in that order: it never sorts, filters or infers an
/// unlock. `unlocked`/`awardedAt` are the core's own award record, so a dev
/// build that unlocks everything reads honestly, and the page never explains
/// why a counter is short.
///
/// The group headers and the `N of M unlocked` count come from the same reply as
/// the rows, so the header can never disagree with the list. `r` asks the shell
/// for a fresh read, which is also what records new award dates; `j/k` moves and
/// `Esc` returns to Stats.
class AchievementsPage extends StatefulWidget {
  const AchievementsPage({
    super.key,
    this.rows = const [],
    this.earned = 0,
    this.total = 0,
    this.warning,
    this.loading = false,
    this.error,
    this.onRefresh,
    this.onBack,
  });

  /// The catalogue projection, in the core's order.
  final List<AchievementRow> rows;

  /// How many rows the core reports as unlocked.
  final int earned;

  /// The catalogue size the core reported.
  final int total;

  /// The core's note about an unreadable awards file. A note, never an error.
  final String? warning;

  /// True while a read is in flight. With rows on screen it is a quiet bar.
  final bool loading;

  /// The last read failure, page-local: the previous rows stay visible.
  final String? error;

  /// `r` and the Retry button ask the shell for a fresh read.
  final VoidCallback? onRefresh;

  /// `Esc` closes the layer, back to Stats.
  final VoidCallback? onBack;

  @override
  State<AchievementsPage> createState() => _AchievementsPageState();
}

class _AchievementsPageState extends State<AchievementsPage> {
  final _rowKeys = <String, GlobalKey>{};
  var _selectedIndex = 0;
  String? _selectedId;

  @override
  void didUpdateWidget(covariant AchievementsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.rows != widget.rows) _reconcileSelection();
  }

  /// Keep the cursor on the same achievement when it survives a refresh, and on
  /// the row that took its place when it does not.
  void _reconcileSelection() {
    final rows = _flatRows;
    if (rows.isEmpty) {
      _selectedIndex = 0;
      _selectedId = null;
      return;
    }
    final at = _selectedId == null
        ? -1
        : rows.indexWhere((row) => row.id == _selectedId);
    _selectedIndex = at >= 0 ? at : _selectedIndex.clamp(0, rows.length - 1);
    _selectedId = rows[_selectedIndex].id;
  }

  /// Every row in display order: category by category, catalogue order inside a
  /// category.
  List<AchievementRow> get _flatRows {
    final grouped = <AchievementRow>[];
    for (final category in _groupOrder) {
      grouped.addAll(widget.rows.where((row) => _groupOf(row) == category));
    }
    return grouped;
  }

  /// The category groups to render, in order, with any unknown shelf last.
  List<String> get _groupOrder {
    final order = [..._categories];
    for (final row in widget.rows) {
      final category = _groupOf(row);
      if (!order.contains(category)) order.add(category);
    }
    return order;
  }

  static String _groupOf(AchievementRow row) {
    final category = row.category.trim().toLowerCase();
    return _categories.contains(category) ? category : 'other';
  }

  int get _selected {
    final rows = _flatRows;
    if (rows.isEmpty) return -1;
    return _selectedIndex.clamp(0, rows.length - 1);
  }

  GlobalKey _rowKey(int index, String id) => _rowKeys.putIfAbsent(
    '$index:$id',
    () => GlobalKey(debugLabel: 'achievement-$id'),
  );

  void _move(int delta) {
    final rows = _flatRows;
    if (rows.length < 2) return;
    final current = _selectedIndex.clamp(0, rows.length - 1);
    final next = (current + delta).clamp(0, rows.length - 1);
    if (next == current) return;
    setState(() {
      _selectedIndex = next;
      _selectedId = rows[next].id;
    });
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _reveal(next, rows[next].id),
    );
  }

  void _select(int index) {
    final rows = _flatRows;
    if (index < 0 || index >= rows.length) return;
    setState(() {
      _selectedIndex = index;
      _selectedId = rows[index].id;
    });
  }

  void _reveal(int index, String id) {
    final target = _rowKeys['$index:$id']?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      alignment: 0.4,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
    );
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    // The verbs fire once per press, never on repeat: a held `r` must not queue
    // a second read.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.escape) {
      widget.onBack?.call();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR && widget.onRefresh != null) {
      widget.onRefresh!();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 720;
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
                Expanded(child: _body(compact: compact)),
                const SizedBox(height: 8),
                _footer(compact: compact),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _header({required bool compact}) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          'ACHIEVEMENTS',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: 11,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        Container(
          key: const ValueKey('achievements-count'),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            '${widget.earned} of ${widget.total} unlocked',
            style: TextStyle(
              color: widget.earned >= widget.total && widget.total > 0
                  ? LockedInColors.success
                  : LockedInColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const Spacer(),
        if (!compact)
          Flexible(
            child: Text(
              'read-only · awards are the core\'s',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
      ],
    );
  }

  Widget _body({required bool compact}) {
    final rows = _flatRows;
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
    if (widget.warning != null) {
      children.add(
        Text(
          'note · ${widget.warning}',
          key: const ValueKey('achievements-warning'),
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        ),
      );
      children.add(const SizedBox(height: 10));
    }
    if (rows.isEmpty) {
      if (widget.loading) {
        children.add(const _LoadingState());
      } else if (widget.error == null) {
        children.add(const _EmptyState());
      }
    } else {
      final selected = _selected;
      for (final category in _groupOrder) {
        final group = widget.rows
            .where((row) => _groupOf(row) == category)
            .toList(growable: false);
        if (group.isEmpty) continue;
        children.add(
          Padding(
            padding: const EdgeInsets.only(top: 2, bottom: 8),
            child: _GroupHeader(
              key: ValueKey('achievements-group-$category'),
              category: category,
              count: group.length,
            ),
          ),
        );
        for (final row in group) {
          final index = rows.indexOf(row);
          children.add(
            Padding(
              key: _rowKey(index, row.id),
              padding: const EdgeInsets.only(bottom: 6),
              child: _AchievementTile(
                key: ValueKey('achievement-${row.id}'),
                row: row,
                selected: index == selected,
                compact: compact,
                onTap: () => _select(index),
              ),
            ),
          );
        }
      }
    }
    return ListView(
      padding: const EdgeInsets.only(bottom: 8),
      children: children,
    );
  }

  Widget _footer({required bool compact}) {
    final hints = <String>[
      'j/k move',
      if (widget.onRefresh != null) 'r reload',
      if (widget.onBack != null) 'Esc back',
    ];
    return Row(
      children: [
        Expanded(
          child: Text(
            hints.join(' · '),
            key: const ValueKey('achievements-hint'),
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ),
        if (!compact)
          Text(
            'progress is the counter, not a promise',
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
      ],
    );
  }
}

class _GroupHeader extends StatelessWidget {
  const _GroupHeader({super.key, required this.category, required this.count});

  final String category;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          '${category.toUpperCase()} · $count',
          style: TextStyle(
            color: LockedInColors.secondary,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.1,
          ),
        ),
        const SizedBox(width: 10),
        const Expanded(child: Divider(height: 1)),
      ],
    );
  }
}

class _AchievementTile extends StatelessWidget {
  const _AchievementTile({
    super.key,
    required this.row,
    required this.selected,
    required this.compact,
    required this.onTap,
  });

  final AchievementRow row;
  final bool selected;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = row.unlocked
        ? (row.awardedAt == null ? '✓ earned' : '✓ ${row.awardedAt}')
        : 'locked';
    return Material(
      color: selected ? LockedInColors.panel : LockedInColors.surface,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          key: selected ? const ValueKey('achievement-selected') : null,
          padding: const EdgeInsets.fromLTRB(0, 10, 12, 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(6),
            border: Border.all(
              color: selected
                  ? LockedInColors.primary.withValues(alpha: 0.5)
                  : LockedInColors.line,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 3,
                height: 38,
                decoration: BoxDecoration(
                  color: selected ? LockedInColors.primary : Colors.transparent,
                  borderRadius: const BorderRadius.horizontal(
                    right: Radius.circular(2),
                  ),
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      row.name.isEmpty ? row.id : row.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: selected
                            ? FontWeight.w600
                            : FontWeight.w400,
                        color: row.unlocked
                            ? LockedInColors.foreground
                            : LockedInColors.muted,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      row.task,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _progressLabel(row),
                      key: ValueKey('achievement-progress-${row.id}'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 10,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    status,
                    key: ValueKey('achievement-status-${row.id}'),
                    style: TextStyle(
                      color: row.unlocked
                          ? LockedInColors.success
                          : LockedInColors.muted,
                      fontSize: 11,
                      fontWeight: row.unlocked
                          ? FontWeight.w600
                          : FontWeight.w400,
                    ),
                  ),
                  if (!compact && row.difficulty.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      row.difficulty,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 10,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// `3 / 10 steps`, from the core's own numbers: [AchievementRow.value] is the
  /// clamped bar value and [AchievementRow.progress] the raw counter.
  static String _progressLabel(AchievementRow row) {
    final counter = row.metric.isEmpty
        ? '${row.value} / ${row.target}'
        : '${row.value} / ${row.target} ${row.metric}';
    return row.progress > row.target ? '$counter · ${row.progress}' : counter;
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(height: 12),
            Text(
              'loading achievements…',
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'no achievements in this build',
              key: const ValueKey('achievements-empty'),
              style: TextStyle(color: LockedInColors.muted),
            ),
            const SizedBox(height: 6),
            Text(
              'the core sent no catalogue; r re-reads it',
              textAlign: TextAlign.center,
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            ),
          ],
        ),
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: LockedInColors.error.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              message,
              key: const ValueKey('achievements-error'),
              style: TextStyle(color: LockedInColors.error, fontSize: 12),
            ),
          ),
          if (onRetry != null) ...[
            const SizedBox(width: 12),
            OutlinedButton(
              key: const ValueKey('achievements-retry'),
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ],
      ),
    );
  }
}
