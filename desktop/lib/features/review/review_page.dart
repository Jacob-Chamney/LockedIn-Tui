import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/errors.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../shared/cards.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../shared/content_column.dart';
import '../../theme/tokens.dart';
import '../shared/format.dart';

/// The Review surface.
///
/// The queue is a **snapshot** the core owns. It groups what is actionable —
/// due/missed cards first, then unchecked steps, then unfinished stages — and
/// keeps session memory in a labelled history group that is neither counted nor
/// markable. A card is answered in its deck; steps and stages open where they
/// live. When [onMark] is wired, `k`/`m` send one `review.mark` and the core's
/// returned queue replaces the list; the page never patches a count itself.
class ReviewPage extends StatefulWidget {
  const ReviewPage({
    super.key,
    this.queue,
    this.loading = false,
    this.error,
    this.side = 'all',
    this.onRefresh,
    this.onSide,
    this.onBack,
    this.onMark,
    this.onOpen,
    this.onReview,
    this.markingId,
  });

  /// The latest `review.queue` snapshot, or null before the first answer.
  final ReviewQueue? queue;

  /// True while `review.queue` is in flight. With a previous [queue] on screen
  /// this is a quiet progress line, not a blank page.
  final bool loading;

  /// The last read failure. Page-local: a failure never replaces the snapshot.
  final String? error;

  /// `all`, `school` or `skills`.
  final String side;

  /// `r` (and the Retry button) asks the shell to read the queue again.
  final VoidCallback? onRefresh;

  /// A side chip or `s` asks the shell for another projection.
  final ValueChanged<String>? onSide;

  /// `Esc` — Review is a snapshot over the workspace, so it goes home to chat.
  final VoidCallback? onBack;

  /// `k` (known) and `m` (missed) ask the shell to record one verdict. Null
  /// leaves the surface read-only, which is how the shell renders it until the
  /// store call is wired through.
  final Future<void> Function(String itemId, String result)? onMark;

  /// Opens the item's own surface: a lock-in session for steps, cards and
  /// memory, a skill goal for a stage. Null keeps the page read-only and drops
  /// the verb, exactly like [onMark].
  final ValueChanged<ReviewItem>? onOpen;

  /// The primary verb: open the first card's deck and review. Null leaves the
  /// button off, so a page without a shell never advertises a dead action.
  final VoidCallback? onReview;

  /// The item the shell is currently marking, so `marking…` survives a rebuild.
  final String? markingId;

  @override
  State<ReviewPage> createState() => _ReviewPageState();
}

class _ReviewPageState extends State<ReviewPage> {
  static const _sides = ['all', 'school', 'skills', 'work'];
  static const _kinds = ['card', 'step', 'stage', 'mistake', 'memory', 'task'];

  final _rowKeys = <String, GlobalKey>{};

  var _selectedIndex = 0;
  String? _selectedId;

  /// The item this page is marking itself; [ReviewPage.markingId] covers a
  /// rebuild that arrives from the shell.
  String? _pendingId;

  /// One inline failure from the core's `review.mark`, cleared by the next mark.
  String? _markError;

  /// Session memory is not a reviewable item; this is the page's own notice,
  /// never a request failure.
  String? _markNotice;

  @override
  void didUpdateWidget(covariant ReviewPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.side != widget.side) {
      _selectedIndex = 0;
      _selectedId = null;
    }
    if (oldWidget.queue != widget.queue && widget.queue != null) {
      _reconcileSelection();
    }
  }

  /// Keep the cursor on the same item when it survives a mark, and on the item
  /// that took its place when it does not. Never patch the queue here: only the
  /// core's answer changes what is listed.
  void _reconcileSelection() {
    final items = _orderedItems;
    if (items.isEmpty) {
      _selectedIndex = 0;
      _selectedId = null;
      return;
    }
    final at = _selectedId == null
        ? -1
        : items.indexWhere((item) => item.id == _selectedId);
    _selectedIndex = at >= 0 ? at : _selectedIndex.clamp(0, items.length - 1);
    _selectedId = items[_selectedIndex].id;
  }

  /// The queue in display order: the core's priority first, file order as the
  /// tie-break so a refresh cannot shuffle equal-priority rows.
  List<ReviewItem> get _orderedItems {
    final items = widget.queue?.items ?? const <ReviewItem>[];
    final indexed = items.asMap().entries.toList()
      ..sort((a, b) {
        final byPriority = a.value.priority.compareTo(b.value.priority);
        return byPriority != 0 ? byPriority : a.key.compareTo(b.key);
      });
    return [for (final entry in indexed) entry.value];
  }

  int get _selected {
    final items = _orderedItems;
    if (items.isEmpty) return -1;
    return _selectedIndex.clamp(0, items.length - 1);
  }

  ReviewItem? get _selectedItem {
    final items = _orderedItems;
    final at = _selected;
    return at < 0 ? null : items[at];
  }

  GlobalKey _rowKey(int index, String id) => _rowKeys.putIfAbsent(
    '$index:$id',
    () => GlobalKey(debugLabel: 'review-$id'),
  );

  void _move(int delta) {
    final items = _orderedItems;
    if (items.length < 2) return;
    final current = _selectedIndex.clamp(0, items.length - 1);
    final next = (current + delta).clamp(0, items.length - 1);
    if (next == current) return;
    setState(() {
      _selectedIndex = next;
      _selectedId = items[next].id;
    });
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _reveal(next, items[next].id),
    );
  }

  void _select(int index) {
    final items = _orderedItems;
    if (index < 0 || index >= items.length) return;
    setState(() {
      _selectedIndex = index;
      _selectedId = items[index].id;
    });
  }

  /// Record one verdict for the selected row.
  ///
  /// Session memory never reaches the core: it is history, not a reviewable
  /// item, so the page says so instead of offering a doomed request. Every
  /// other row is sent once; failure is one inline message and the previous
  /// queue stays exactly as it was.
  Future<void> _mark(String result) async {
    final onMark = widget.onMark;
    if (onMark == null) return;
    final index = _selected;
    final items = _orderedItems;
    if (index < 0 || index >= items.length) return;
    final item = items[index];
    if (item.kind == 'memory') {
      setState(() {
        _markError = null;
        _markNotice = 'session memory is read-only and cannot be marked';
      });
      return;
    }
    if (_pendingId != null || widget.markingId != null) return;
    setState(() {
      _pendingId = item.id;
      _markError = null;
      _markNotice = null;
    });
    try {
      await onMark(item.id, result);
    } catch (failure) {
      if (!mounted) return;
      setState(() => _markError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _pendingId = null);
    }
  }

  void _reveal(int index, String id) {
    final target = _rowKeys['$index:$id']?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      alignment: 0.5,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
    );
  }

  static String _nextSide(String side) {
    final at = _sides.indexOf(side);
    return _sides[(at + 1) % _sides.length];
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    // `k` is the known verdict on this surface, so only the arrow moves up.
    if (key == LogicalKeyboardKey.arrowUp) {
      _move(-1);
      return KeyEventResult.handled;
    }
    // The verbs fire once per press, never on key repeat: a held `r` must not
    // queue a second read and a held `s` must not spin through every side.
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      final open = widget.onOpen;
      final row = _selectedItem;
      if (open == null || row == null) return KeyEventResult.ignored;
      open(row);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyK && widget.onMark != null) {
      unawaited(_mark('known'));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyM && widget.onMark != null) {
      unawaited(_mark('missed'));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape) {
      widget.onBack?.call();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR && widget.onRefresh != null) {
      widget.onRefresh!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS && widget.onSide != null) {
      widget.onSide!(_nextSide(widget.side));
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return ContentColumn(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < Breakpoints.hint;
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
                  _sideChips(),
                  const SizedBox(height: 12),
                  Expanded(child: _body()),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _header({required bool compact}) {
    final theme = Theme.of(context);
    final counts = widget.queue?.counts ?? ReviewCounts.zero;
    // Session memory is history, not a task. Counting it in the badge made the
    // surface look like it had more work than it did.
    final actionable = counts.total - counts.countFor('memory');
    final summary = [
      for (final kind in _kinds)
        if (counts.countFor(kind) > 0) _countLabel(kind, counts.countFor(kind)),
    ].join(' · ');
    return Row(
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          'REVIEW',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: 11,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        Container(
          key: const ValueKey('review-total'),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(Radii.control),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            '$actionable',
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
          // The status bar carries the full list; the header keeps the verbs it
          // can fit, and ellipsises rather than overflowing a narrow window.
          Flexible(
            child: Text(
              widget.onMark == null
                  ? 'r refresh · s side'
                  : 'k known · m missed · r refresh · s side',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
      ],
    );
  }

  /// One muted line under the counts: how many school sessions have every source
  /// referenced (`review.queue.coverage`).
  ///
  /// It is a projection only — the reports come from the core, one per readable
  /// session — and it adds no keys: the Review surface still has exactly the
  /// bindings it had. No rows means no line at all.
  Widget _coverageSummary(ReviewQueue queue) {
    final total = queue.coverage.length;
    final covered = queue.coverage
        .where((row) => row.report.fullyCovered)
        .length;
    return Text(
      'coverage · $covered of $total sessions have every source referenced',
      key: const ValueKey('review-coverage'),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(color: LockedInColors.muted, fontSize: 11),
    );
  }

  Widget _sideChips() {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          'SIDE',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 10,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        for (final value in _sides)
          _SideChip(
            key: ValueKey('review-side-$value'),
            label: value,
            selected: widget.side == value,
            onTap: widget.onSide == null ? null : () => widget.onSide!(value),
          ),
      ],
    );
  }

  Widget _body() {
    final queue = widget.queue;
    final children = <Widget>[
      // The one sentence that says what this surface is for. Without it the
      // queue read as a random mix of cards, steps and history.
      Text(
        'What the workspace already records. Cards are reviewed here; steps, '
        'stages and mistakes open where they live; work tasks wait for '
        'verification; memory is history, not review.',
        key: const ValueKey('review-purpose'),
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 11,
          height: 1.45,
        ),
      ),
      const SizedBox(height: 10),
    ];
    if (widget.loading && queue != null) {
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
    if (_markError != null) {
      children.add(
        _ErrorBlock(message: _markError!, blockKey: 'review-mark-error'),
      );
      children.add(const SizedBox(height: 10));
    }
    if (_markNotice != null) {
      children.add(_NoticeBlock(message: _markNotice!));
      children.add(const SizedBox(height: 10));
    }
    if (queue == null) {
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
      final nudge = queue.nudge;
      if (nudge != null) {
        children.add(_NudgeStrip(nudge: nudge));
        children.add(const SizedBox(height: 10));
      }
      if (queue.diagnostics.isNotEmpty) {
        children.add(_DiagnosticsBlock(diagnostics: queue.diagnostics));
        children.add(const SizedBox(height: 10));
      }
      final cards = queue.counts.countFor('card');
      if (cards > 0 && widget.onReview != null) {
        children.add(
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              key: const ValueKey('review-start'),
              onPressed: widget.onReview,
              style: FilledButton.styleFrom(
                backgroundColor: LockedInColors.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
              child: Text('review $cards ${cards == 1 ? 'card' : 'cards'}'),
            ),
          ),
        );
        children.add(const SizedBox(height: 10));
      }
      final items = _orderedItems;
      if (items.isEmpty) {
        children.add(
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 32),
            child: _EmptyState(),
          ),
        );
      } else {
        final selected = _selected;
        final marking = _pendingId ?? widget.markingId;
        String? lastKind;
        for (var index = 0; index < items.length; index++) {
          final item = items[index];
          if (item.kind != lastKind) {
            children.add(
              _SectionHeading(
                label: switch (item.kind) {
                  'card' => 'TO REVIEW',
                  'step' => 'OPEN STEPS',
                  'stage' => 'OPEN STAGES',
                  'mistake' => 'MISTAKES · no correction yet',
                  'memory' => 'HISTORY · read-only',
                  'task' => 'WORK · needs verification',
                  _ => item.kind.toUpperCase(),
                },
                count: queue.counts.countFor(item.kind),
              ),
            );
            lastKind = item.kind;
          }
          children.add(
            Padding(
              key: _rowKey(index, item.id),
              padding: const EdgeInsets.only(bottom: 6),
              child: _ReviewRow(
                key: ValueKey('review-row-${item.id}'),
                item: item,
                selected: index == selected,
                marking: marking == item.id,
                onTap: () {
                  _select(index);
                  final open = widget.onOpen;
                  final row = _selectedItem;
                  if (open != null && row != null) open(row);
                },
                onKnown:
                    widget.onMark == null ||
                        marking == item.id ||
                        item.kind == 'memory'
                    ? null
                    : () {
                        _select(index);
                        unawaited(_mark('known'));
                      },
                onMissed:
                    widget.onMark == null ||
                        marking == item.id ||
                        item.kind == 'memory' ||
                        item.kind == 'task'
                    ? null
                    : () {
                        _select(index);
                        unawaited(_mark('missed'));
                      },
              ),
            ),
          );
        }
      }
      if (queue.coverage.isNotEmpty) {
        children.add(const SizedBox(height: 6));
        children.add(_coverageSummary(queue));
      }
      children.add(const SizedBox(height: 4));
      children.add(
        widget.onMark == null
            ? Text(
                'snapshot · marking is available',
                key: ValueKey('review-readonly'),
                style: TextStyle(color: LockedInColors.muted, fontSize: 11),
              )
            : Text(
                'k known · m missed · session memory is read-only',
                key: ValueKey('review-mark-hint'),
                style: TextStyle(color: LockedInColors.muted, fontSize: 11),
              ),
      );
    }
    return ListView(
      padding: const EdgeInsets.only(bottom: 8),
      children: children,
    );
  }
}

/// One intent group in the queue: cards, open steps, open stages or history.
class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.label, required this.count});

  final String label;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 5),
      child: Row(
        children: [
          Text(
            label,
            style: TextStyle(
              color: LockedInColors.secondary,
              fontSize: 10,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '$count',
            style: TextStyle(color: LockedInColors.muted, fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class _SideChip extends StatelessWidget {
  const _SideChip({
    super.key,
    required this.label,
    required this.selected,
    this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    // One chip for the whole app; the tick marks the selection, so the state
    // never rests on the accent fill alone.
    return Material(
      color: selected ? LockedInColors.primary : Colors.transparent,
      borderRadius: BorderRadius.circular(Radii.control),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.control),
        child: Padding(
          padding: const EdgeInsets.all(Radii.control),
          child: ValueChip(
            selected ? '✓ $label' : label,
            tone: selected ? Theme.of(context).colorScheme.onPrimary : null,
          ),
        ),
      ),
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({
    super.key,
    required this.item,
    required this.selected,
    required this.onTap,
    this.marking = false,
    this.onKnown,
    this.onMissed,
  });

  final ReviewItem item;
  final bool selected;
  final VoidCallback onTap;
  final bool marking;

  /// The pointer path for `k` and `m`. Null on a read-only row (session memory)
  /// or while a mark is in flight.
  final VoidCallback? onKnown;
  final VoidCallback? onMissed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final detail = joinDot([item.context, item.reason]);
    final trailing = marking
        ? 'marking…'
        : item.kind == 'memory'
        ? 'read-only'
        : item.count > 0
        ? '${item.count} miss${item.count == 1 ? '' : 'es'}'
        : item.origin;
    return Material(
      color: selected ? LockedInColors.panel : LockedInColors.surface,
      borderRadius: BorderRadius.circular(Radii.control),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.control),
        child: Container(
          padding: const EdgeInsets.fromLTRB(0, 10, 12, 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Radii.control),
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
                height: 34,
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
                    Row(
                      children: [
                        _KindTag(kind: item.kind),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            item.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: selected
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                      ],
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
              const SizedBox(width: 8),
              if (onKnown != null || onMissed != null) ...[
                TextButton(
                  key: ValueKey('review-known-${item.id}'),
                  onPressed: onKnown,
                  child: const Text('known'),
                ),
                TextButton(
                  key: ValueKey('review-missed-${item.id}'),
                  onPressed: onMissed,
                  style: TextButton.styleFrom(
                    foregroundColor: LockedInColors.warning,
                  ),
                  child: const Text('missed'),
                ),
                const SizedBox(width: 4),
              ],
              const SizedBox(width: 8),
              Text(
                trailing,
                style: TextStyle(
                  color: marking
                      ? LockedInColors.secondary
                      : item.count > 0
                      ? LockedInColors.warning
                      : LockedInColors.muted,
                  fontSize: 11,
                ),
              ),
            ],
          ),
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
    final color = _kindColor(kind);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_kindIcon(kind), size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            kind.toUpperCase(),
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

class _NudgeStrip extends StatelessWidget {
  const _NudgeStrip({required this.nudge});

  final ReviewNudge nudge;

  @override
  Widget build(BuildContext context) {
    final intensity = nudge.intensity.isEmpty ? 'balanced' : nudge.intensity;
    return Container(
      key: const ValueKey('review-nudge'),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.tips_and_updates_outlined,
                size: 15,
                color: LockedInColors.secondary,
              ),
              const SizedBox(width: 8),
              Text(
                'NUDGE',
                style: TextStyle(
                  color: LockedInColors.secondary,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.0,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '$intensity · threshold ${nudge.threshold} · '
                  '${nudge.due.length} due',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          if (nudge.suggestions.isNotEmpty) ...[
            const SizedBox(height: 6),
            Padding(
              padding: const EdgeInsets.only(left: 23),
              child: Text(
                nudge.suggestions.first,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 11,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The queue's skipped folders, shown as a muted warning — **not** an error.
///
/// One unreadable folder never hides the rest of the queue; the core's own
/// message and next action are printed verbatim.
class _DiagnosticsBlock extends StatelessWidget {
  const _DiagnosticsBlock({required this.diagnostics});

  final List<ReviewDiagnostic> diagnostics;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('review-diagnostics'),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      decoration: BoxDecoration(
        color: LockedInColors.warning.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(
          color: LockedInColors.warning.withValues(alpha: 0.4),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                size: 15,
                color: LockedInColors.warning,
              ),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'some items could not be read',
                  style: TextStyle(
                    color: LockedInColors.warning,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                'not a failure',
                style: TextStyle(color: LockedInColors.muted, fontSize: 10),
              ),
            ],
          ),
          for (final diagnostic in diagnostics)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (diagnostic.kind.isNotEmpty || diagnostic.path.isNotEmpty)
                    Text(
                      joinDot([diagnostic.kind, diagnostic.path]),
                      style: TextStyle(
                        color: LockedInColors.warning,
                        fontSize: 11,
                      ),
                    ),
                  const SizedBox(height: 2),
                  Text(
                    diagnostic.message,
                    style: TextStyle(
                      color: LockedInColors.foreground,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                  if (diagnostic.next.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      'next: ${diagnostic.next}',
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: 11,
                        height: 1.4,
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ErrorBlock extends StatelessWidget {
  const _ErrorBlock({
    required this.message,
    this.onRetry,
    this.blockKey = 'review-error',
  });

  final String message;
  final VoidCallback? onRetry;
  final String blockKey;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey(blockKey),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
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
                key: const ValueKey('review-retry'),
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

/// The page's own muted note: session memory is not a reviewable item.
class _NoticeBlock extends StatelessWidget {
  const _NoticeBlock({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('review-mark-notice'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 15, color: LockedInColors.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.muted,
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
              'loading review…',
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
      key: const ValueKey('review-empty'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.check_circle_outline,
            size: 26,
            color: LockedInColors.success,
          ),
          const SizedBox(height: 10),
          Text('nothing to review', style: theme.textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'leave a lock-in step unchecked or miss a flashcard to fill this '
            'queue',
            textAlign: TextAlign.center,
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

Color _kindColor(String kind) => switch (kind) {
  'card' => LockedInColors.accent,
  'step' => LockedInColors.primary,
  'stage' => LockedInColors.secondary,
  'memory' => LockedInColors.success,
  _ => LockedInColors.muted,
};

IconData _kindIcon(String kind) => switch (kind) {
  'card' => Icons.style_outlined,
  'step' => Icons.check_box_outlined,
  'stage' => Icons.school_outlined,
  'memory' => Icons.memory,
  _ => Icons.circle_outlined,
};

String _countLabel(String kind, int count) {
  final noun = switch (kind) {
    'card' => count == 1 ? 'card' : 'cards',
    'step' => count == 1 ? 'step' : 'steps',
    'stage' => count == 1 ? 'stage' : 'stages',
    'memory' => 'memory',
    _ => count == 1 ? kind : '${kind}s',
  };
  return '$count $noun';
}
