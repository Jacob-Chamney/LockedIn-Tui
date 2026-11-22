import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/palette.dart';

/// One runnable row in the command palette.
///
/// The shell builds the list from `Surface.values` plus the core commands, so
/// the sidebar and the palette can never disagree about a surface's label or
/// hint.
class PaletteAction {
  const PaletteAction({
    required this.id,
    required this.label,
    required this.hint,
    required this.icon,
    required this.run,
    this.binding,
  });

  /// Stable id, used for widget keys and tests.
  final String id;
  final String label;
  final String hint;
  final IconData icon;

  /// Runs the action. The shell closes the palette around this call.
  final VoidCallback run;

  /// The registry's chord for this action, shown on the row so the palette
  /// teaches the shortcut instead of only being a list of names.
  final String? binding;

  /// Filters on the label or the hint, case-insensitively.
  bool matches(String query) => rank(query) < 3;

  /// How well this action answers [query]: 0 the name starts with it, 1 the
  /// name contains it, 2 only the hint mentions it, 3 no match.
  ///
  /// A name always outranks a hint. Hints are sentences about a destination
  /// (`a achievements` on Stats), so ranking them level with names put Stats
  /// above the `achievements` action for the query `achiev`, and `Enter` ran
  /// the wrong row.
  int rank(String query) {
    if (query.isEmpty) return 0;
    final needle = query.toLowerCase();
    final name = label.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.contains(needle)) return 1;
    return hint.toLowerCase().contains(needle) ? 2 : 3;
  }
}

/// A centered command palette drawn over the current surface.
///
/// The widget owns only transient UI state (query, selection, focus). It never
/// touches the store: an action's [PaletteAction.run] is the shell's business.
class CommandPalette extends StatefulWidget {
  const CommandPalette({
    super.key,
    required this.actions,
    required this.onRun,
    required this.onClose,
    this.pendingInput = '',
  });

  /// Characters the shell caught in the frame before this field had focus.
  ///
  /// The search field takes focus in a post-frame callback, so a fast hand's
  /// first character arrived while nothing was listening and was dropped. The
  /// shell buffers those keystrokes and hands them over here.
  final String pendingInput;

  /// The single action registry: one entry per surface plus the core commands.
  final List<PaletteAction> actions;
  final ValueChanged<PaletteAction> onRun;
  final VoidCallback onClose;

  @override
  State<CommandPalette> createState() => _CommandPaletteState();
}

class _CommandPaletteState extends State<CommandPalette> {
  static const searchKey = ValueKey('palette-search');
  static const selectedKey = ValueKey('palette-selected');
  static const emptyKey = ValueKey('palette-empty');
  static const listKey = ValueKey('palette-list');

  final _query = TextEditingController();
  final _searchFocus = FocusNode();
  var _selected = 0;

  @override
  void initState() {
    super.initState();
    // A node-level handler runs before the field's own editing shortcuts, so
    // arrows and Enter cannot move the text cursor instead of the selection.
    _searchFocus.onKeyEvent = _onKey;
    if (widget.pendingInput.isNotEmpty) {
      _query.text = widget.pendingInput;
      _query.selection = TextSelection.collapsed(offset: _query.text.length);
    }
    // The chat composer usually has focus when the palette opens; autofocus
    // alone is ignored while the scope already has a focused child.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _searchFocus.requestFocus();
    });
  }

  @override
  void didUpdateWidget(covariant CommandPalette oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A second character can arrive in the same frame, after this field was
    // built but before it held focus. The shell appends to the buffer, so take
    // the whole value: nothing here can have been typed yet.
    if (widget.pendingInput != oldWidget.pendingInput &&
        widget.pendingInput.length > _query.text.length &&
        widget.pendingInput.startsWith(_query.text)) {
      _query.text = widget.pendingInput;
      _query.selection = TextSelection.collapsed(offset: _query.text.length);
    }
  }

  @override
  void dispose() {
    _searchFocus.onKeyEvent = null;
    _searchFocus.dispose();
    _query.dispose();
    super.dispose();
  }

  /// The matching actions, best match first. The sort is stable on the
  /// catalogue order, so an empty query lists the actions exactly as given.
  List<PaletteAction> get _filtered {
    final query = _query.text;
    final ranked =
        [
          for (final (index, action) in widget.actions.indexed)
            (action.rank(query), index, action),
        ].where((entry) => entry.$1 < 3).toList()..sort((a, b) {
          final byRank = a.$1.compareTo(b.$1);
          return byRank != 0 ? byRank : a.$2.compareTo(b.$2);
        });
    return [for (final entry in ranked) entry.$3];
  }

  int get _index {
    final length = _filtered.length;
    if (length == 0) return -1;
    return _selected.clamp(0, length - 1);
  }

  void _move(int delta) {
    final length = _filtered.length;
    if (length < 2) return;
    final current = _index;
    final next = (current + delta).clamp(0, length - 1);
    if (next == current) return;
    setState(() => _selected = next);
  }

  void _run(PaletteAction action) {
    widget.onRun(action);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      widget.onClose();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      final index = _index;
      if (index >= 0) _run(_filtered[index]);
      return KeyEventResult.handled;
    }
    // j/k are not movement here: the search field owns the keyboard, so both
    // letters are text. Typing "kn" for Knowledge used to drop the `k` (it
    // moved the selection), and Enter then ran Chat. The arrows move.
    return KeyEventResult.ignored;
  }

  void _onQueryChanged(String value) {
    setState(() => _selected = 0);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filtered;
    final index = _index;
    return Stack(
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
        Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560, maxHeight: 420),
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
                      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
                      child: TextField(
                        key: searchKey,
                        controller: _query,
                        focusNode: _searchFocus,
                        onChanged: _onQueryChanged,
                        decoration: const InputDecoration(
                          hintText: 'run a command…',
                          isDense: true,
                          prefixIcon: Icon(Icons.search, size: 16),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                        ),
                      ),
                    ),
                    Divider(height: 1, color: LockedInColors.line),
                    if (filtered.isEmpty)
                      Padding(
                        key: emptyKey,
                        padding: const EdgeInsets.fromLTRB(18, 22, 18, 22),
                        child: Text(
                          'no matching actions',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: LockedInColors.muted,
                          ),
                        ),
                      )
                    else
                      Flexible(
                        child: SingleChildScrollView(
                          key: listKey,
                          padding: const EdgeInsets.fromLTRB(6, 6, 6, 6),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              for (var row = 0; row < filtered.length; row++)
                                _PaletteRow(
                                  key: row == index
                                      ? selectedKey
                                      : ValueKey(
                                          'palette-row-${filtered[row].id}',
                                        ),
                                  action: filtered[row],
                                  selected: row == index,
                                  onTap: () => _run(filtered[row]),
                                ),
                            ],
                          ),
                        ),
                      ),
                    Divider(height: 1, color: LockedInColors.line),
                    Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 9,
                      ),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '↑↓ move · Enter run · Esc close',
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
    );
  }
}

class _PaletteRow extends StatelessWidget {
  const _PaletteRow({
    super.key,
    required this.action,
    required this.selected,
    required this.onTap,
  });

  final PaletteAction action;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        height: 46,
        margin: const EdgeInsets.only(bottom: 2),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          children: [
            Container(
              width: 2,
              height: 30,
              color: selected ? LockedInColors.primary : Colors.transparent,
            ),
            const SizedBox(width: 10),
            Icon(
              action.icon,
              size: 16,
              color: selected ? LockedInColors.primary : LockedInColors.muted,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    action.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: LockedInColors.foreground,
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    action.hint,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            if (action.binding != null && action.binding!.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: LockedInColors.background,
                  borderRadius: BorderRadius.circular(3),
                  border: Border.all(color: LockedInColors.line),
                ),
                child: Text(
                  action.binding!,
                  key: ValueKey('palette-binding-${action.id}'),
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 10),
            ] else
              const SizedBox(width: 10),
          ],
        ),
      ),
    );
  }
}
