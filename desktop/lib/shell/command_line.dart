import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keymap/registry.dart';
import '../theme/palette.dart';

/// One command the `:` line can run.
///
/// A command is a *name* for a [KeymapRegistry] action, never a second handler:
/// running the row dispatches the same action id the binding would, so a rebind
/// moves the key and the command still names the same behaviour.
class CommandEntry {
  const CommandEntry({
    required this.name,
    required this.label,
    required this.actionId,
    required this.hint,
    this.alias = false,
  });

  /// What a person types after `:` (`stats`, `chill`, `q`).
  final String name;

  /// The registry action's own label, used for matching and for the secondary
  /// line.
  final String label;

  /// The action the shell dispatches (`surface.stats`, `help`, …).
  final String actionId;

  /// The row's binding and purpose, resolved from the registry row.
  final String hint;

  /// True when this name is a documented alias of another row's action.
  final bool alias;

  /// Filters on the command name and the action label, case-insensitively.
  bool matches(String query) {
    if (query.isEmpty) return true;
    final needle = query.toLowerCase();
    return name.toLowerCase().contains(needle) ||
        label.toLowerCase().contains(needle);
  }
}

/// The names `docs/product.md` §13 documents, mapped to their registry action.
///
/// Most of them are already the action's own label; listing them all here keeps
/// the documented command surface in one readable table instead of relying on a
/// label happening to match. A name that a row already carries is skipped, so
/// this never duplicates a row and never adds a command for an action that is
/// not in the catalogue.
const commandAliases = <String, String>{
  'chill': 'surface.chat',
  'sessions': 'surface.sessions',
  'skills': 'surface.skills',
  'sources': 'surface.sources',
  'stats': 'surface.stats',
  'work': 'surface.work',
  'review': 'surface.review',
  'archive': 'surface.archive',
  'knowledge': 'surface.knowledge',
  'settings': 'surface.settings',
  'help': 'help',
  'refresh': 'refresh',
  'retry': 'retry',
  'close': 'close',
  // `:q` is the dismissal every editor trains a person to reach for.
  'q': 'close',
};

/// Every command, derived from the key table.
///
/// One entry per catalogue action (named by its own label) plus the documented
/// aliases, in catalogue order. There is no second list of commands: adding an
/// action adds its command, and an action removed from the catalogue removes
/// its command and every alias that pointed at it.
List<CommandEntry> commandEntries(KeymapRegistry keymap) {
  final entries = <CommandEntry>[];
  final byId = <String, CommandEntry>{};
  for (final row in keymap.editorRows()) {
    final entry = CommandEntry(
      name: row.label,
      label: row.label,
      actionId: row.id,
      // The binding is part of the hint, so a rebound action shows the chord
      // that actually runs it.
      hint: '${row.binding.display} · ${row.hint}',
    );
    entries.add(entry);
    byId[row.id] = entry;
  }
  for (final alias in commandAliases.entries) {
    final target = byId[alias.value];
    if (target == null) continue;
    if (entries.any((entry) => entry.name == alias.key)) continue;
    entries.add(
      CommandEntry(
        name: alias.key,
        label: target.label,
        actionId: target.actionId,
        hint: target.hint,
        alias: true,
      ),
    );
  }
  return entries;
}

/// The `:` command line: a centered, borderless window over a dim backdrop.
///
/// The widget owns only transient UI state (query, selection, focus). It never
/// touches the store or the shell: a row's action id is the shell's business,
/// exactly like the palette's.
class CommandLine extends StatefulWidget {
  const CommandLine({
    super.key,
    required this.entries,
    required this.onRun,
    required this.onClose,
    this.pendingInput = '',
  });

  /// Characters typed in the frame before the input held focus; see
  /// [CommandPalette.pendingInput].
  final String pendingInput;

  /// Every command, built from the registry by [commandEntries].
  final List<CommandEntry> entries;
  final ValueChanged<CommandEntry> onRun;
  final VoidCallback onClose;

  @override
  State<CommandLine> createState() => _CommandLineState();
}

class _CommandLineState extends State<CommandLine> {
  static const inputKey = ValueKey('command-input');
  static const selectedKey = ValueKey('command-selected');
  static const emptyKey = ValueKey('command-empty');
  static const listKey = ValueKey('command-list');

  final _query = TextEditingController();
  final _inputFocus = FocusNode();
  var _selected = 0;

  @override
  void initState() {
    super.initState();
    // A node-level handler runs before the field's own editing shortcuts, so
    // arrows and Enter cannot move the text cursor instead of the selection.
    _inputFocus.onKeyEvent = _onKey;
    if (widget.pendingInput.isNotEmpty) {
      _query.text = widget.pendingInput;
      _query.selection = TextSelection.collapsed(offset: _query.text.length);
    }
    // Another surface's field may hold focus when the line opens; autofocus
    // alone is ignored while the enclosing scope already has a focused child.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _inputFocus.requestFocus();
    });
  }

  @override
  void didUpdateWidget(covariant CommandLine oldWidget) {
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
    _inputFocus.onKeyEvent = null;
    _inputFocus.dispose();
    _query.dispose();
    super.dispose();
  }

  List<CommandEntry> get _filtered => [
    for (final entry in widget.entries)
      if (entry.matches(_query.text)) entry,
  ];

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

  void _run(CommandEntry entry) => widget.onRun(entry);

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
      // An unknown command stays open: the inline line already says what to do
      // next, so Enter must not dismiss the line or invent a row.
      final index = _index;
      if (index >= 0) _run(_filtered[index]);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
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
              constraints: const BoxConstraints(maxWidth: 560, maxHeight: 320),
              child: Container(
                decoration: BoxDecoration(
                  color: LockedInColors.surface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                      child: Row(
                        children: [
                          Text(
                            ':',
                            style: TextStyle(
                              color: LockedInColors.primary,
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextField(
                              key: inputKey,
                              controller: _query,
                              focusNode: _inputFocus,
                              style: TextStyle(
                                color: LockedInColors.foreground,
                                fontSize: 14,
                              ),
                              // Borderless: the window is a surface fill with a
                              // plain header, never a box in a box.
                              decoration: const InputDecoration(
                                hintText: 'command…',
                                isDense: true,
                                filled: false,
                                border: InputBorder.none,
                                enabledBorder: InputBorder.none,
                                focusedBorder: InputBorder.none,
                                contentPadding: EdgeInsets.symmetric(
                                  vertical: 9,
                                ),
                              ),
                              onChanged: (_) => setState(() => _selected = 0),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Divider(height: 1, color: LockedInColors.line),
                    if (filtered.isEmpty)
                      Padding(
                        key: emptyKey,
                        padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            'no such command · try :help',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: LockedInColors.error,
                            ),
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
                                _CommandRow(
                                  key: row == index
                                      ? selectedKey
                                      : ValueKey(
                                          'command-row-${filtered[row].name}',
                                        ),
                                  entry: filtered[row],
                                  selected: row == index,
                                  onTap: () => _run(filtered[row]),
                                ),
                            ],
                          ),
                        ),
                      ),
                    Container(
                      width: double.infinity,
                      color: LockedInColors.panel,
                      padding: const EdgeInsets.symmetric(
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

class _CommandRow extends StatelessWidget {
  const _CommandRow({
    super.key,
    required this.entry,
    required this.selected,
    required this.onTap,
  });

  final CommandEntry entry;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        height: 42,
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
            const SizedBox(width: 10),
            SizedBox(
              width: 130,
              child: Text(
                entry.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: selected
                      ? LockedInColors.foreground
                      : LockedInColors.secondary,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                entry.hint,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: LockedInColors.muted, fontSize: 11),
              ),
            ),
            const SizedBox(width: 10),
          ],
        ),
      ),
    );
  }
}
