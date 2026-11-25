import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../theme/palette.dart';
import 'star_field.dart';
import 'star_map.dart';

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
    this.focusNode,
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

  /// The node the page's key handler listens on. The shell owns it so it can
  /// hand the page the keyboard the moment the layer opens.
  final FocusNode? focusNode;

  /// `Esc` closes the layer, back to Stats.
  final VoidCallback? onBack;

  @override
  State<AchievementsPage> createState() => _AchievementsPageState();
}

class _AchievementsPageState extends State<AchievementsPage> {
  var _selectedIndex = 0;
  String? _selectedId;

  /// True when a narrow window is showing the selected star's detail instead of
  /// the sky. A wide window shows both, so this only matters below 720 px.
  var _detailOpen = false;

  /// Whether the last build was the narrow layout. Kept so `Esc` can peel the
  /// detail layer before it leaves the page, without reading the tree size in a
  /// key handler.
  var _narrow = false;

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

  /// The laid-out sky. Recomputed only when the rows change, so navigation and
  /// rebuilds never move a star.
  List<StarNode>? _nodesCache;
  List<AchievementRow>? _nodesFrom;

  List<StarNode> get _nodes {
    if (!identical(_nodesFrom, widget.rows) || _nodesCache == null) {
      _nodesFrom = widget.rows;
      _nodesCache = layoutStars(_flatRows);
    }
    return _nodesCache!;
  }

  /// The selected star's position in the sky.
  int get _selectedStar {
    final nodes = _nodes;
    if (nodes.isEmpty) return -1;
    final id = _selectedId;
    if (id != null) {
      final at = nodes.indexWhere((node) => node.row.id == id);
      if (at >= 0) return at;
    }
    return _selectedIndex.clamp(0, nodes.length - 1);
  }

  void _moveStar(StarDirection direction) {
    final nodes = _nodes;
    if (nodes.length < 2) return;
    final from = _selectedStar;
    final next = nearestInDirection(nodes, from, direction);
    if (next == from) return;
    _selectStar(next);
  }

  void _selectStar(int index) {
    final nodes = _nodes;
    if (index < 0 || index >= nodes.length) return;
    setState(() {
      _selectedIndex = index;
      _selectedId = nodes[index].row.id;
    });
  }

  /// Enter (or a click on a narrow layout) opens the star's detail.
  void _openStar() {
    final nodes = _nodes;
    final at = _selectedStar;
    if (at < 0) return;
    setState(() {
      _selectedId = nodes[at].row.id;
      _detailOpen = true;
    });
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final direction = switch (key) {
      LogicalKeyboardKey.arrowDown ||
      LogicalKeyboardKey.keyJ => StarDirection.down,
      LogicalKeyboardKey.arrowUp || LogicalKeyboardKey.keyK => StarDirection.up,
      LogicalKeyboardKey.arrowLeft ||
      LogicalKeyboardKey.keyH => StarDirection.left,
      LogicalKeyboardKey.arrowRight ||
      LogicalKeyboardKey.keyL => StarDirection.right,
      _ => null,
    };
    if (direction != null) {
      _moveStar(direction);
      return KeyEventResult.handled;
    }
    // Enter opens the selected star: on a wide window the detail is already
    // beside the sky, so this is what pins it on a narrow one.
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _openStar();
      return KeyEventResult.handled;
    }
    // The verbs fire once per press, never on repeat: a held `r` must not queue
    // a second read.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.escape) {
      // One layer at a time: a narrow window closes the star's detail first,
      // and only a second Esc leaves the page.
      if (_narrow && _detailOpen) {
        setState(() => _detailOpen = false);
        return KeyEventResult.handled;
      }
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
        _narrow = compact;
        return Focus(
          focusNode: widget.focusNode,
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
    final notices = <Widget>[];
    if (widget.loading && rows.isNotEmpty) {
      notices.add(
        LinearProgressIndicator(
          minHeight: 2,
          color: LockedInColors.primary,
          backgroundColor: LockedInColors.line,
        ),
      );
      notices.add(const SizedBox(height: 8));
    }
    if (widget.error != null) {
      notices.add(
        _ErrorBlock(message: widget.error!, onRetry: widget.onRefresh),
      );
      notices.add(const SizedBox(height: 8));
    }
    if (widget.warning != null) {
      notices.add(
        Text(
          'note · ${widget.warning}',
          key: const ValueKey('achievements-warning'),
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        ),
      );
      notices.add(const SizedBox(height: 8));
    }
    if (rows.isEmpty) {
      if (widget.loading) return const _LoadingState();
      if (widget.error != null) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: notices,
        );
      }
      return const _EmptyState();
    }

    final nodes = _nodes;
    final selected = _selectedStar;
    final sky = StarField(
      nodes: nodes,
      selected: selected,
      onSelect: _selectStar,
      onOpen: (_) => _openStar(),
    );

    // A narrow window has no room for a sky and a card side by side, so the
    // card becomes the layer Enter opens and Esc closes.
    if (compact) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ...notices,
          Expanded(
            child: _detailOpen
                ? SingleChildScrollView(
                    child: StarDetail(node: _nodeAt(selected), compact: true),
                  )
                : sky,
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...notices,
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: sky),
              const SizedBox(width: 18),
              SizedBox(
                width: 330,
                child: SingleChildScrollView(
                  child: StarDetail(node: _nodeAt(selected)),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  StarNode? _nodeAt(int index) {
    final nodes = _nodes;
    if (index < 0 || index >= nodes.length) return null;
    return nodes[index];
  }

  Widget _footer({required bool compact}) {
    final hints = <String>[
      'hjkl / arrows move',
      if (compact && _detailOpen) 'Esc back to the sky' else 'Enter detail',
      if (widget.onRefresh != null) 'r reload',
      if (widget.onBack != null && !(compact && _detailOpen)) 'Esc back',
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
              'the core sent no catalogue',
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
