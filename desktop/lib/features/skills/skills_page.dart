import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';

/// The Skills surface: the goals in the skills store, one row each.
///
/// The shell owns the store: it passes the latest `skill.list` projection in and
/// decides what opening means. This page reads no files and calls no core
/// method, so an empty list is always the shell's answer, never a local guess.
///
/// `n` asks the shell for the goal wizard. A page pumped without that handler
/// (a bare widget test) reports the missing action rather than acting silently:
/// no empty screen, no dead key.
class SkillsPage extends StatefulWidget {
  const SkillsPage({
    super.key,
    required this.skills,
    required this.loading,
    this.error,
    this.onRefresh,
    this.onOpen,
    this.onCreate,
    this.onArchive,
    this.onDelete,
    this.onExport,
  });

  final List<SkillRow> skills;
  final bool loading;
  final String? error;
  final VoidCallback? onRefresh;

  /// Called with the selected row when `Enter` opens it. The shell asks the core
  /// for the goal and swaps the surface; the list never reads it itself.
  final ValueChanged<SkillRow>? onOpen;

  /// Opens the goal wizard. The shell owns the wizard layer, so this only
  /// reports the intent: no form, no core call and no write happens here.
  final VoidCallback? onCreate;

  /// Called with a goal id after the user confirms `a`: move the goal folder to
  /// the configured archive. The reply is the backend that took it (`folder` or
  /// `github`) and is used for the success line.
  ///
  /// The page asks first, because an archive moves the folder. A failure is
  /// shown inline and the row stays; the page never retries and never guesses.
  final Future<String?> Function(String id)? onArchive;

  /// Called with a goal id after the user confirms `d`: delete the goal folder
  /// and its lessons. There is no reply to show beyond the goal's name.
  final Future<void> Function(String id)? onDelete;

  /// Called with the selected goal id after the user confirms `x`: write its zip
  /// and return the path the core chose.
  final Future<String?> Function(String id)? onExport;

  @override
  State<SkillsPage> createState() => _SkillsPageState();
}

class _SkillsPageState extends State<SkillsPage> {
  static const _selectedRowKey = ValueKey('skill-row-selected');

  static const _searchFieldKey = ValueKey('skills-search');

  final _rowKeys = <String, GlobalKey>{};
  final _searchController = TextEditingController();
  final _searchFocus = FocusNode();
  var _selectedIndex = 0;

  /// The live search query. Filtering is a projection of the rows the shell
  /// already sent, so a keystroke never re-reads a goal.
  var _query = '';

  /// The one blocked-action line. It is cleared by `Esc` and by opening a goal.
  String? _notice;

  /// The goal with an archive/delete/export in flight, if any. The row shows
  /// `working…` and the verbs ignore the keyboard until the core answers.
  String? _actionId;

  /// The last action's refusal, shown above the list. A page-local action
  /// failure is never a shell-wide transport failure, so this stays here.
  String? _actionError;

  /// The last action's success line (`exported to …`, `archived …`).
  String? _actionNotice;

  /// True while a confirmation dialog owns the keyboard.
  bool _dialogOpen = false;

  bool get _hasActions =>
      widget.onArchive != null ||
      widget.onDelete != null ||
      widget.onExport != null;

  List<SkillRow> get _visible {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return widget.skills;
    return [
      for (final row in widget.skills)
        if (row.name.toLowerCase().contains(query) ||
            row.id.toLowerCase().contains(query))
          row,
    ];
  }

  int get _selected {
    if (_visible.isEmpty) return -1;
    return _selectedIndex.clamp(0, _visible.length - 1);
  }

  @override
  void dispose() {
    _searchController.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  GlobalKey _rowKey(String id) =>
      _rowKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'skill-$id'));

  void _move(int delta) {
    if (_visible.length < 2) return;
    final current = _selected;
    final next = (current + delta).clamp(0, _visible.length - 1);
    if (next == current) return;
    setState(() => _selectedIndex = next);
    final id = _visible[next].id;
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

  void _openSelected() {
    final index = _selected;
    if (index < 0) return;
    setState(() => _notice = null);
    widget.onOpen?.call(_visible[index]);
  }

  void _newGoal() {
    final create = widget.onCreate;
    if (create != null) {
      create();
      return;
    }
    // A page with no handler still answers: the wizard lives in the shell, so a
    // bare page can only name that gap instead of opening a form nobody wired.
    setState(
      () => _notice =
          'this build cannot open the goal wizard · Esc dismisses this notice',
    );
  }

  SkillRow? get _selectedRow {
    final index = _selected;
    return index < 0 ? null : _visible[index];
  }

  static String _label(SkillRow row) =>
      row.name.isEmpty ? 'untitled goal' : row.name;

  /// One readable reason. The core puts the actionable sentence in `data`, so
  /// prefer it over the envelope message.
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

  /// Confirms, then archives the selected goal.
  ///
  /// An archive moves the goal folder, so it is destructive and needs the named
  /// confirmation first. `Cancel`, `Esc` or a dismissal changes nothing.
  Future<void> _archiveSelected() async {
    final row = _selectedRow;
    final archive = widget.onArchive;
    if (row == null || archive == null || _dialogOpen) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmSkillArchive(context, name: _label(row));
      if (!confirmed || !mounted) return;
      setState(() {
        _actionId = row.id;
        _actionError = null;
        _actionNotice = null;
        _notice = null;
      });
      try {
        final backend = await archive(row.id);
        if (!mounted) return;
        final destination = backend == null
            ? 'the archive'
            : 'the $backend archive';
        setState(
          () => _actionNotice = 'archived “${_label(row)}” to $destination',
        );
      } catch (failure) {
        if (mounted) setState(() => _actionError = _reason(failure));
      } finally {
        if (mounted) setState(() => _actionId = null);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  /// Confirms, then deletes the selected goal folder.
  ///
  /// The dialog names the goal and lists what goes, so `d` is never a silent
  /// delete. `Cancel`, `Esc` or a dismissal changes nothing.
  Future<void> _deleteSelected() async {
    final row = _selectedRow;
    final delete = widget.onDelete;
    if (row == null || delete == null || _dialogOpen) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmSkillDelete(context, name: _label(row));
      if (!confirmed || !mounted) return;
      setState(() {
        _actionId = row.id;
        _actionError = null;
        _actionNotice = null;
        _notice = null;
      });
      try {
        await delete(row.id);
        if (!mounted) return;
        setState(() => _actionNotice = 'deleted “${_label(row)}”');
      } catch (failure) {
        if (mounted) setState(() => _actionError = _reason(failure));
      } finally {
        if (mounted) setState(() => _actionId = null);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  /// Confirms, then exports the selected goal as a zip.
  ///
  /// Export changes nothing, but it writes a file and takes a while, so it asks
  /// first and then reports the path the core chose.
  Future<void> _exportSelected() async {
    final row = _selectedRow;
    final export = widget.onExport;
    if (row == null || export == null || _dialogOpen) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmSkillExport(context, name: _label(row));
      if (!confirmed || !mounted) return;
      setState(() {
        _actionId = row.id;
        _actionError = null;
        _actionNotice = null;
        _notice = null;
      });
      try {
        final path = await export(row.id);
        if (!mounted) return;
        setState(
          () => _actionNotice = path == null
              ? 'exported “${_label(row)}”'
              : 'exported to $path',
        );
      } catch (failure) {
        if (mounted) setState(() => _actionError = _reason(failure));
      } finally {
        if (mounted) setState(() => _actionId = null);
      }
    } finally {
      _dialogOpen = false;
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
    // While the search field is focused every bare key is text. A page
    // handler runs before the field's editing shortcuts, so without this a
    // query containing `a`, `d`, `x`, `n`, `j` or `k` archived, deleted or
    // exported the selected goal instead of typing.
    final typing = _searchFocus.hasFocus;
    if (typing && key != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.slash && !_dialogOpen) {
      if (event is KeyDownEvent) _searchFocus.requestFocus();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown ||
        key == LogicalKeyboardKey.arrowUp ||
        key == LogicalKeyboardKey.keyJ ||
        key == LogicalKeyboardKey.keyK) {
      final forward =
          key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ;
      _move(forward ? 1 : -1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (widget.onOpen == null || _actionId != null) {
        return KeyEventResult.ignored;
      }
      _openSelected();
      return KeyEventResult.handled;
    }
    // The manager verbs. They need a row, a handler and NORMAL: a dialog or an
    // in-flight action owns the keyboard.
    if (!_dialogOpen && _actionId == null && _selectedRow != null) {
      if (key == LogicalKeyboardKey.keyA && widget.onArchive != null) {
        if (event is KeyDownEvent) unawaited(_archiveSelected());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyD && widget.onDelete != null) {
        if (event is KeyDownEvent) unawaited(_deleteSelected());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyX && widget.onExport != null) {
        if (event is KeyDownEvent) unawaited(_exportSelected());
        return KeyEventResult.handled;
      }
    }
    // `n` starts a new goal (`typing` already returned above).
    if (key == LogicalKeyboardKey.keyN && !_dialogOpen && _actionId == null) {
      if (event is KeyDownEvent) _newGoal();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape && _query.isNotEmpty) {
      _searchController.clear();
      setState(() => _query = '');
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape &&
        (_notice != null || _actionError != null || _actionNotice != null)) {
      setState(() {
        _notice = null;
        _actionError = null;
        _actionNotice = null;
      });
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final showChapters = constraints.maxWidth >= 700;
        final showOpened = constraints.maxWidth >= 620;
        return Focus(
          autofocus: true,
          onKeyEvent: _onKey,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _header(compact: constraints.maxWidth < 560),
                const SizedBox(height: 10),
                TextField(
                  key: _searchFieldKey,
                  controller: _searchController,
                  focusNode: _searchFocus,
                  onChanged: (value) => setState(() {
                    _query = value;
                    _selectedIndex = 0;
                  }),
                  decoration: const InputDecoration(
                    hintText: 'search goals',
                    isDense: true,
                    prefixIcon: Icon(Icons.search, size: 16),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                  ),
                ),
                if (_hasActions) ...[
                  const SizedBox(height: 8),
                  Text(
                    'a archive · d delete · x export',
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ],
                const SizedBox(height: 12),
                Expanded(
                  child: _body(
                    showChapters: showChapters,
                    showOpened: showOpened,
                  ),
                ),
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
          'SKILLS',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: 11,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        _CountChip(
          _query.isEmpty
              ? '${widget.skills.length}'
              : '${_visible.length} of ${widget.skills.length}',
        ),
        if (!compact) ...[
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '↑↓ move · Enter open · n new goal · / search',
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
        ],
      ],
    );
  }

  Widget _body({required bool showChapters, required bool showOpened}) {
    if (widget.loading && widget.skills.isEmpty) {
      return const _LoadingState(label: 'loading skills…');
    }
    final error = widget.error;
    if (error != null && widget.skills.isEmpty) {
      return _centered(
        _ErrorState(message: error, onRefresh: widget.onRefresh),
      );
    }
    if (widget.skills.isEmpty) {
      return _centered(
        _EmptyState(onCreate: widget.onCreate, onNotice: _newGoal),
      );
    }
    // A search that matches nothing is a state, not a blank panel: it names the
    // query and the key that clears it (`docs/design.md` §8).
    if (_visible.isEmpty) {
      return _centered(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off, size: 26, color: LockedInColors.muted),
            const SizedBox(height: 10),
            Text(
              'no goal matches “${_query.trim()}”',
              style: TextStyle(color: LockedInColors.foreground, fontSize: 13),
            ),
            const SizedBox(height: 4),
            Text(
              'Esc clears the search',
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.loading)
          LinearProgressIndicator(
            minHeight: 2,
            color: LockedInColors.primary,
            backgroundColor: LockedInColors.line,
          ),
        if (error != null) ...[
          _ErrorState(message: error, onRefresh: widget.onRefresh),
          const SizedBox(height: 10),
        ],
        if (_notice != null) ...[
          _BlockedState(message: _notice!),
          const SizedBox(height: 10),
        ],
        if (_actionError != null || _actionNotice != null) ...[
          _ActionBanner(
            message: _actionError ?? _actionNotice!,
            failed: _actionError != null,
            onDismiss: () => setState(() {
              _actionError = null;
              _actionNotice = null;
            }),
          ),
          const SizedBox(height: 10),
        ],
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.only(bottom: 8),
            itemCount: _visible.length,
            itemBuilder: (context, index) {
              final skill = _visible[index];
              final isSelected = index == _selected;
              return Padding(
                key: _rowKey(skill.id),
                padding: const EdgeInsets.only(bottom: 6),
                child: _SkillRowTile(
                  key: isSelected ? _selectedRowKey : null,
                  skill: skill,
                  selected: isSelected,
                  showChapters: showChapters,
                  showOpened: showOpened,
                  busy: _actionId == skill.id,
                  onTap: () {
                    if (_actionId != null) return;
                    setState(() => _selectedIndex = index);
                    _openSelected();
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _centered(Widget child) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: child,
        ),
      ),
    );
  }
}

class _SkillRowTile extends StatelessWidget {
  const _SkillRowTile({
    super.key,
    required this.skill,
    required this.selected,
    required this.showChapters,
    required this.showOpened,
    required this.onTap,
    this.busy = false,
  });

  final SkillRow skill;
  final bool selected;
  final bool showChapters;
  final bool showOpened;
  final VoidCallback onTap;

  /// True while an archive/delete/export for this row is in flight: the row
  /// shows `working…` instead of its stage count, so the user can see the core
  /// is running and the verbs are not offered twice.
  final bool busy;

  String get _stageLabel {
    if (skill.stageTotal <= 0) return 'no stages';
    return '${skill.stageDone}/${skill.stageTotal} stages';
  }

  String get _chaptersLabel {
    final done = skill.chaptersDone ?? 0;
    final total = skill.chaptersTotal ?? 0;
    if (total <= 0) return 'no chapters';
    return '$done/$total chapters';
  }

  String get _chatsLabel {
    if (skill.chats <= 0) return 'no chats';
    return skill.chats == 1 ? '1 chat' : '${skill.chats} chats';
  }

  String get _openedLabel {
    final value = skill.lastOpened;
    if (value.isEmpty) return 'never opened';
    final day = value.length >= 10 ? value.substring(0, 10) : value;
    return 'opened $day';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: selected ? LockedInColors.panel : LockedInColors.surface,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Container(
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
                        Flexible(
                          child: Text(
                            skill.name.isEmpty ? 'untitled goal' : skill.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: selected
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                        if (skill.archived) ...[
                          const SizedBox(width: 8),
                          const _ArchivedBadge(),
                        ],
                      ],
                    ),
                    if (skill.broken != null) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(
                            Icons.error_outline,
                            size: 13,
                            color: LockedInColors.error,
                          ),
                          const SizedBox(width: 5),
                          Expanded(
                            child: Text(
                              skill.broken!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: LockedInColors.error,
                                fontSize: 11,
                                height: 1.35,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              if (showChapters) ...[
                const SizedBox(width: 12),
                SizedBox(
                  width: 92,
                  child: Text(
                    _chaptersLabel,
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ),
              ],
              if (showOpened) ...[
                const SizedBox(width: 12),
                SizedBox(
                  width: 104,
                  child: Text(
                    _openedLabel,
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ),
              ],
              const SizedBox(width: 12),
              SizedBox(
                width: 70,
                child: Text(
                  _chatsLabel,
                  textAlign: TextAlign.right,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 84,
                child: busy
                    ? Text(
                        'working…',
                        key: ValueKey('skill-row-busy'),
                        textAlign: TextAlign.right,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.primary,
                          fontSize: 11,
                        ),
                      )
                    : Text(
                        _stageLabel,
                        textAlign: TextAlign.right,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: skill.complete
                              ? LockedInColors.success
                              : LockedInColors.muted,
                          fontSize: 11,
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ArchivedBadge extends StatelessWidget {
  const _ArchivedBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.archive_outlined, size: 10, color: LockedInColors.muted),
          SizedBox(width: 4),
          Text(
            'archived',
            style: TextStyle(color: LockedInColors.muted, fontSize: 10),
          ),
        ],
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
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
          const SizedBox(height: 14),
          Text(
            label,
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onCreate, required this.onNotice});

  final VoidCallback? onCreate;
  final VoidCallback onNotice;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.school_outlined, size: 26, color: LockedInColors.muted),
        const SizedBox(height: 10),
        Text('no skills yet', style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(
          'n starts a goal',
          style: TextStyle(color: LockedInColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 14),
        OutlinedButton(
          key: const ValueKey('skills-new-goal'),
          onPressed: onCreate ?? onNotice,
          child: const Text('New goal'),
        ),
      ],
    );
  }
}

class _BlockedState extends StatelessWidget {
  const _BlockedState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('skills-notice'),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: LockedInColors.warning.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 16, color: LockedInColors.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.warning,
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

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, this.onRefresh});

  final String message;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    return Container(
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
          if (onRefresh != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: onRefresh,
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

/// Confirms archiving one goal, naming it.
///
/// Returns true only for the explicit Archive button; `Esc`, Cancel or a
/// dismissal is false and nothing moves.
Future<bool> confirmSkillArchive(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _SkillConfirmDialog(
      title: 'archive goal',
      question: 'Archive “$name”?',
      detail:
          'The goal folder moves to the configured archive and leaves this '
          'list. Its curriculum, lessons, gathered sources and progress go with '
          'it; its chats are not included.',
      cancelKey: const ValueKey('skill-archive-cancel'),
      confirmKey: const ValueKey('skill-archive-confirm'),
      confirmLabel: 'Archive',
    ),
  );
  return result ?? false;
}

/// Confirms deleting one goal's folder, naming it and what it removes.
///
/// Returns true only for the explicit Delete button; `Esc`, Cancel or a
/// dismissal is false and nothing is removed.
Future<bool> confirmSkillDelete(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _SkillConfirmDialog(
      title: 'delete goal',
      question: 'Delete “$name”?',
      detail:
          'This removes the goal and its lessons, gathered sources and chats '
          'from this workspace. Nothing else is touched, and an archived copy of '
          'the same goal is not deleted.',
      cancelKey: const ValueKey('skill-delete-cancel'),
      confirmKey: const ValueKey('skill-delete-confirm'),
      confirmLabel: 'Delete',
      destructive: true,
    ),
  );
  return result ?? false;
}

/// Confirms exporting one goal as a zip, naming it and what the zip is.
///
/// Returns true only for the explicit Export button; `Esc`, Cancel or a
/// dismissal is false and nothing is written.
Future<bool> confirmSkillExport(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _SkillConfirmDialog(
      title: 'export goal',
      question: 'Export “$name”?',
      detail:
          'This writes a zip of the goal to the workspace exports folder. The '
          'goal itself is not moved, changed or deleted.',
      cancelKey: const ValueKey('skill-export-cancel'),
      confirmKey: const ValueKey('skill-export-confirm'),
      confirmLabel: 'Export',
    ),
  );
  return result ?? false;
}

/// The one destructive confirmation shape the skills manager uses: a surface
/// fill, the goal's name as the question, the consequence spelled out and two
/// explicit buttons.
class _SkillConfirmDialog extends StatelessWidget {
  const _SkillConfirmDialog({
    required this.title,
    required this.question,
    required this.detail,
    required this.cancelKey,
    required this.confirmKey,
    required this.confirmLabel,
    this.destructive = false,
  });

  final String title;
  final String question;
  final String detail;
  final Key cancelKey;
  final Key confirmKey;
  final String confirmLabel;
  final bool destructive;

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
        title: Text(title),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                question,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: 14,
                  height: 1.45,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                detail,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: 12.5,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: cancelKey,
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: confirmKey,
            style: destructive
                ? FilledButton.styleFrom(
                    backgroundColor: LockedInColors.error,
                    foregroundColor: LockedInColors.background,
                  )
                : null,
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
  }
}

/// One archive/delete/export outcome: a success line (`exported to …`) in
/// `success` or the core's refusal in `error`, with a dismiss control.
class _ActionBanner extends StatelessWidget {
  const _ActionBanner({
    required this.message,
    required this.failed,
    required this.onDismiss,
  });

  final String message;
  final bool failed;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final color = failed ? LockedInColors.error : LockedInColors.success;
    return Container(
      key: ValueKey(failed ? 'skills-action-error' : 'skills-action-notice'),
      padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
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
          IconButton(
            key: const ValueKey('skills-action-dismiss'),
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
