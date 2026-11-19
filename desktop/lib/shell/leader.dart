import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keymap/binding.dart';
import '../keymap/registry.dart';
import '../theme/palette.dart';

/// The which-key overlay: every runnable binding, grouped and selectable.
///
/// The rows come from [KeymapRegistry.leaderRows], so the overlay can never show
/// a key the shell does not dispatch, and a stored override is what the row says.
/// The widget owns only transient UI state (selection, scroll, focus).
class LeaderOverlay extends StatefulWidget {
  const LeaderOverlay({
    super.key,
    required this.rows,
    required this.onRun,
    required this.onClose,
  });

  /// The actual configured bindings, in catalogue order.
  final List<KeymapRow> rows;
  final ValueChanged<KeymapRow> onRun;
  final VoidCallback onClose;

  @override
  State<LeaderOverlay> createState() => _LeaderOverlayState();
}

class _LeaderOverlayState extends State<LeaderOverlay> {
  static const selectedKey = ValueKey('leader-selected');
  static const listKey = ValueKey('leader-list');

  final _focus = FocusNode();
  final _scroll = ScrollController();
  final _rowKeys = <String, GlobalKey>{};
  var _selected = 0;

  @override
  void initState() {
    super.initState();
    // A node-level handler runs before any ancestor, so the second key of a
    // leader chord is never eaten by the surface underneath.
    _focus.onKeyEvent = _onKey;
    // The shell root already holds focus, so `autofocus` alone does not move it
    // here; ask for it explicitly on the first frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _focus.onKeyEvent = null;
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  int get _index {
    if (widget.rows.isEmpty) return -1;
    return _selected.clamp(0, widget.rows.length - 1);
  }

  void _move(int delta) {
    if (widget.rows.length < 2) return;
    final current = _index;
    final next = (current + delta).clamp(0, widget.rows.length - 1);
    if (next == current) return;
    setState(() => _selected = next);
    _reveal(widget.rows[next].id);
  }

  void _reveal(String id) {
    final target = _rowKeys[id]?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(target, alignment: 0.5, duration: Duration.zero);
  }

  void _run(KeymapRow row) => widget.onRun(row);

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      widget.onClose();
      return KeyEventResult.handled;
    }
    // Which-key first: a chord's own key runs its row. This has to come before
    // j/k movement, because the terminal app binds `Space j` and `Space k`.
    final keyboard = HardwareKeyboard.instance;
    final token = Binding.keyToken(event.logicalKey, event.character);
    if (token != null && !keyboard.isControlPressed && !keyboard.isAltPressed) {
      for (final row in widget.rows) {
        if (row.binding.isLeader && row.binding.key == token) {
          _run(row);
          return KeyEventResult.handled;
        }
      }
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.home) {
      _move(-widget.rows.length);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      _move(widget.rows.length);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      final index = _index;
      if (index >= 0) _run(widget.rows[index]);
      return KeyEventResult.handled;
    }
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final index = _index;
    return Focus(
      focusNode: _focus,
      autofocus: true,
      onKeyEvent: _onKey,
      child: Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: widget.onClose,
              child: Container(
                color: LockedInColors.background.withValues(alpha: 0.78),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomRight,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  maxWidth: 620,
                  maxHeight: 480,
                ),
                child: Container(
                  decoration: BoxDecoration(
                    color: LockedInColors.surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: LockedInColors.line),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
                        child: Row(
                          children: [
                            Text(
                              'LEADER',
                              style: TextStyle(
                                color: LockedInColors.primary,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.2,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                'the keys that work here',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Divider(height: 1, color: LockedInColors.line),
                      Flexible(
                        child: SingleChildScrollView(
                          key: listKey,
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(6, 6, 6, 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            mainAxisSize: MainAxisSize.min,
                            children: _sections(index),
                          ),
                        ),
                      ),
                      Divider(height: 1, color: LockedInColors.line),
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 9,
                        ),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            'j/k move · Enter run · Esc close',
                            style: TextStyle(
                              color: LockedInColors.muted,
                              fontSize: 11,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _sections(int index) {
    final widgets = <Widget>[];
    for (final group in ActionGroup.values) {
      final rows = [
        for (final row in widget.rows)
          if (row.group == group) row,
      ];
      if (rows.isEmpty) continue;
      widgets.add(
        Padding(
          padding: const EdgeInsets.fromLTRB(9, 8, 9, 4),
          child: Text(
            actionGroupTitles[group] ?? group.name.toUpperCase(),
            style: TextStyle(
              color: LockedInColors.secondary,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.0,
            ),
          ),
        ),
      );
      for (final row in rows) {
        final position = widget.rows.indexOf(row);
        final selected = position == index;
        widgets.add(
          KeyedSubtree(
            key: _rowKeys.putIfAbsent(row.id, GlobalKey.new),
            child: _LeaderRow(
              key: selected ? selectedKey : ValueKey('leader-row-${row.id}'),
              row: row,
              selected: selected,
              onTap: () => _run(row),
            ),
          ),
        );
      }
    }
    return widgets;
  }
}

class _LeaderRow extends StatelessWidget {
  const _LeaderRow({
    super.key,
    required this.row,
    required this.selected,
    required this.onTap,
  });

  final KeymapRow row;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 2),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          children: [
            Container(
              width: 2,
              height: 26,
              color: selected ? LockedInColors.primary : Colors.transparent,
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 92,
              child: Text(
                row.binding.display,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.right,
                style: TextStyle(
                  color: selected
                      ? LockedInColors.primary
                      : LockedInColors.foreground,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Row(
                  children: [
                    Text(
                      row.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: LockedInColors.foreground,
                        fontWeight: selected
                            ? FontWeight.w600
                            : FontWeight.w400,
                      ),
                    ),
                    if (row.custom) ...[
                      const SizedBox(width: 6),
                      Icon(
                        Icons.edit_outlined,
                        size: 11,
                        color: LockedInColors.muted,
                      ),
                    ],
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        row.hint,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 11,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 10),
          ],
        ),
      ),
    );
  }
}
