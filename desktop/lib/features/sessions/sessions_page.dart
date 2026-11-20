import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';

/// The manager's sort orders (`docs/product.md` §4.4: date/name/size). `o`
/// cycles them in this order and wraps back to the newest-first default.
enum _SessionSort {
  dateDesc('date ↓'),
  dateAsc('date ↑'),
  nameAsc('name A–Z'),
  sizeDesc('size ↓');

  const _SessionSort(this.label);

  /// The header's own label, never a second wording the tests would miss.
  final String label;

  _SessionSort get next =>
      _SessionSort.values[(index + 1) % _SessionSort.values.length];
}

/// The Sessions surface.
///
/// The shell owns the store: it passes the latest [SessionRow] projection in and
/// decides what a refresh means. This page reads no files and calls no core
/// method, so an empty list is always the shell's answer, never a local guess.
class SessionsPage extends StatefulWidget {
  const SessionsPage({
    super.key,
    required this.sessions,
    required this.loading,
    this.error,
    this.onRefresh,
    this.onOpen,
    this.onCreate,
    this.onArchive,
    this.onDelete,
    this.onExport,
  });

  final List<SessionRow> sessions;
  final bool loading;
  final String? error;
  final VoidCallback? onRefresh;

  /// Called with the selected row when `Enter` opens it. The shell decides what
  /// opening means (it asks the core and swaps the surface); the list never
  /// reads the session itself.
  final ValueChanged<SessionRow>? onOpen;

  /// Called when `n` is pressed in NORMAL with no search query. The shell owns
  /// the wizard and its core call, so the list never opens an editor itself.
  final VoidCallback? onCreate;

  /// Called with a session id after the user confirms `a`: move the live folder
  /// to the configured archive. The reply is the backend that took it (`folder`
  /// or `github`) and is used for the success line.
  ///
  /// The page asks first, because an archive is destructive. A failure is shown
  /// inline and the row stays; the page never retries and never guesses.
  final Future<String?> Function(String id)? onArchive;

  /// Called with a session id after the user confirms `d`: delete the live
  /// folder. There is no reply to show beyond the session's name.
  final Future<void> Function(String id)? onDelete;

  /// Called with the selected session id on `x`: write its zip and return the
  /// path the core chose. Export asks nothing because it changes nothing.
  final Future<String?> Function(String id)? onExport;

  @override
  State<SessionsPage> createState() => _SessionsPageState();
}

class _SessionsPageState extends State<SessionsPage> {
  static const _searchFieldKey = ValueKey('sessions-search');
  static const _selectedRowKey = ValueKey('session-row-selected');

  final _searchController = TextEditingController();
  final _searchFocus = FocusNode();

  /// The page's own node, where the keyboard returns after the search field.
  ///
  /// `unfocus()` moves the keyboard to the enclosing scope, not to this page,
  /// so after `/`, a query and `Esc` the list's keys were dead and a second
  /// `Esc` fell through to the shell and left Sessions.
  final _pageFocus = FocusNode(debugLabel: 'sessions');
  final _rowKeys = <String, GlobalKey>{};

  var _selectedIndex = 0;

  /// The active order. Sorting is a projection of the rows the shell already
  /// sent: the page never re-reads a session, and the selection follows the
  /// row's id across a re-sort.
  var _sort = _SessionSort.dateDesc;

  /// The session with an archive/delete/export in flight, if any. The row shows
  /// `working…` and the verbs ignore the keyboard until the core answers.
  String? _actionId;

  /// The last action's refusal, shown above the list. A page-local action
  /// failure is never a shell-wide transport failure, so this stays here.
  String? _actionError;

  /// The last action's success line (`exported to …`, `archived …`).
  String? _notice;

  /// True while a confirmation dialog owns the keyboard.
  bool _dialogOpen = false;

  bool get _hasActions =>
      widget.onArchive != null ||
      widget.onDelete != null ||
      widget.onExport != null;

  @override
  void dispose() {
    _pageFocus.dispose();
    _searchController.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  List<SessionRow> get _visible {
    final query = _searchController.text.trim().toLowerCase();
    final filtered = query.isEmpty
        ? widget.sessions.toList()
        : widget.sessions
              .where((session) => session.name.toLowerCase().contains(query))
              .toList();
    return _sorted(filtered);
  }

  /// Order [rows] by the active order without mutating the shell's list.
  ///
  /// Every comparison falls back to the row's original position, so the sort is
  /// stable: two rows that tie keep the order the shell sent. The "size" order
  /// is a documented proxy — `SessionRow` carries no byte size, so it ranks by
  /// source count and then by the step total.
  List<SessionRow> _sorted(List<SessionRow> rows) {
    final indexed = <(int, SessionRow)>[
      for (var at = 0; at < rows.length; at++) (at, rows[at]),
    ];
    indexed.sort((left, right) {
      final bySort = switch (_sort) {
        _SessionSort.dateDesc => _compareDate(
          left.$2,
          right.$2,
          newestFirst: true,
        ),
        _SessionSort.dateAsc => _compareDate(
          left.$2,
          right.$2,
          newestFirst: false,
        ),
        _SessionSort.nameAsc => _compareName(left.$2, right.$2),
        _SessionSort.sizeDesc => _compareSize(left.$2, right.$2),
      };
      return bySort != 0 ? bySort : left.$1.compareTo(right.$1);
    });
    return [for (final entry in indexed) entry.$2];
  }

  /// Newest first or oldest first. A row with no stored date sorts last in both
  /// directions, so an unreadable session never leads the list.
  static int _compareDate(
    SessionRow left,
    SessionRow right, {
    required bool newestFirst,
  }) {
    final leftDate = left.date;
    final rightDate = right.date;
    if (leftDate.isEmpty != rightDate.isEmpty) {
      return leftDate.isEmpty ? 1 : -1;
    }
    final byDate = leftDate.compareTo(rightDate);
    return newestFirst ? -byDate : byDate;
  }

  /// Case-insensitive A–Z, then by id so two identical names stay deterministic.
  static int _compareName(SessionRow left, SessionRow right) {
    final byName = left.name.toLowerCase().compareTo(right.name.toLowerCase());
    if (byName != 0) return byName;
    return left.id.compareTo(right.id);
  }

  /// The documented "size" proxy: source count first, then the step total, both
  /// largest first. `SessionRow` carries no byte size and the shell must not
  /// invent a core field.
  static int _compareSize(SessionRow left, SessionRow right) {
    final bySources = right.sources.compareTo(left.sources);
    if (bySources != 0) return bySources;
    return right.stepsTotal.compareTo(left.stepsTotal);
  }

  int get _selected {
    final visible = _visible;
    if (visible.isEmpty) return -1;
    return _selectedIndex.clamp(0, visible.length - 1);
  }

  GlobalKey _rowKey(String id) =>
      _rowKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'session-$id'));

  /// The row under the cursor, or null when the list is empty or filtered out.
  SessionRow? get _selectedRow {
    final visible = _visible;
    final index = _selected;
    if (index < 0 || index >= visible.length) return null;
    return visible[index];
  }

  /// A session's display name, never an empty label in a confirmation.
  static String _label(SessionRow row) =>
      row.name.isEmpty ? 'untitled session' : row.name;

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

  void _move(int delta) {
    final visible = _visible;
    if (visible.length < 2) return;
    final current = _selectedIndex.clamp(0, visible.length - 1);
    final next = (current + delta).clamp(0, visible.length - 1);
    if (next == current) return;
    setState(() => _selectedIndex = next);
    final id = visible[next].id;
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

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final typing = _searchFocus.hasFocus;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown ||
        key == LogicalKeyboardKey.arrowUp) {
      // While the search field is focused the arrows edit the text, not the
      // list; leaving them alone keeps typing predictable.
      if (typing) return KeyEventResult.ignored;
      _move(key == LogicalKeyboardKey.arrowDown ? 1 : -1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      // While the search field is focused Enter belongs to the field; the row
      // only opens once the list itself has focus.
      if (typing) return KeyEventResult.ignored;
      if (widget.onOpen == null) return KeyEventResult.ignored;
      _openSelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.slash && !typing) {
      _searchFocus.requestFocus();
      return KeyEventResult.handled;
    }
    // `n` starts a new lock-in, but not while the search field has focus and
    // not while a query filters the list: the shell owns the wizard, so this
    // only reports the intent.
    if (key == LogicalKeyboardKey.keyN &&
        !typing &&
        _searchController.text.isEmpty &&
        widget.onCreate != null) {
      widget.onCreate!();
      return KeyEventResult.handled;
    }
    // `o` cycles the manager's sort order. It is only offered when there is
    // more than one row to order, and it is text while the search field has
    // focus. The selection follows the row's id across the re-sort.
    if (key == LogicalKeyboardKey.keyO &&
        !typing &&
        !_dialogOpen &&
        _actionId == null &&
        widget.sessions.length > 1) {
      if (event is KeyDownEvent) _cycleSort();
      return KeyEventResult.handled;
    }
    // The manager verbs. They need a row, a handler and NORMAL: a dialog or an
    // in-flight action owns the keyboard, and while the search field is focused
    // `a`/`d`/`x` are text, never actions.
    if (!typing && !_dialogOpen && _actionId == null && _selectedRow != null) {
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
    if (key == LogicalKeyboardKey.escape &&
        (typing || _searchController.text.isNotEmpty)) {
      _searchController.clear();
      setState(() => _selectedIndex = 0);
      _pageFocus.requestFocus();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _onQueryChanged(String value) {
    setState(() => _selectedIndex = 0);
  }

  /// Cycle to the next order, keeping the selected row by id rather than by
  /// position so `Enter`, `a`, `d` and `x` still act on the same session.
  void _cycleSort() {
    final currentId = _selectedRow?.id;
    setState(() {
      _sort = _sort.next;
      if (currentId == null) {
        _selectedIndex = 0;
        return;
      }
      final at = _visible.indexWhere((row) => row.id == currentId);
      _selectedIndex = at >= 0 ? at : 0;
    });
  }

  /// Opens the row under the cursor. Iterating over [_visible] keeps the index
  /// honest when a search filter is active.
  /// Move the cursor to [index] in the visible list.
  void _selectIndex(int index) {
    if (index < 0 || index >= _visible.length) return;
    setState(() => _selectedIndex = index);
  }

  void _openSelected() {
    final visible = _visible;
    final index = _selected;
    if (index < 0 || index >= visible.length) return;
    widget.onOpen?.call(visible[index]);
  }

  /// Confirms, then archives the selected session.
  ///
  /// An archive moves the live folder, so it is destructive and needs the named
  /// confirmation first. `Cancel`, `Esc` or a dismissal changes nothing.
  Future<void> _archiveSelected() async {
    final row = _selectedRow;
    final archive = widget.onArchive;
    if (row == null || archive == null || _dialogOpen) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmSessionArchive(context, name: _label(row));
      if (!confirmed || !mounted) return;
      setState(() {
        _actionId = row.id;
        _actionError = null;
        _notice = null;
      });
      try {
        final backend = await archive(row.id);
        if (!mounted) return;
        final destination = backend == null
            ? 'the archive'
            : 'the $backend archive';
        setState(() => _notice = 'archived “${_label(row)}” to $destination');
      } catch (failure) {
        if (mounted) setState(() => _actionError = _reason(failure));
      } finally {
        if (mounted) setState(() => _actionId = null);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  /// Confirms, then deletes the selected session's live folder.
  ///
  /// The dialog names the session and lists what goes with it, so `d` is never a
  /// silent delete. `Cancel`, `Esc` or a dismissal changes nothing.
  Future<void> _deleteSelected() async {
    final row = _selectedRow;
    final delete = widget.onDelete;
    if (row == null || delete == null || _dialogOpen) return;
    _dialogOpen = true;
    try {
      final confirmed = await confirmSessionDelete(context, name: _label(row));
      if (!confirmed || !mounted) return;
      setState(() {
        _actionId = row.id;
        _actionError = null;
        _notice = null;
      });
      try {
        await delete(row.id);
        if (!mounted) return;
        setState(() => _notice = 'deleted “${_label(row)}”');
      } catch (failure) {
        if (mounted) setState(() => _actionError = _reason(failure));
      } finally {
        if (mounted) setState(() => _actionId = null);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  /// Exports the selected session. Export changes nothing, so it asks nothing;
  /// the success line carries the path the core chose.
  Future<void> _exportSelected() async {
    final row = _selectedRow;
    final export = widget.onExport;
    if (row == null || export == null || _actionId != null) return;
    setState(() {
      _actionId = row.id;
      _actionError = null;
      _notice = null;
    });
    try {
      final path = await export(row.id);
      if (!mounted) return;
      setState(
        () => _notice = path == null
            ? 'exported “${_label(row)}”'
            : 'exported to $path',
      );
    } catch (failure) {
      if (mounted) setState(() => _actionError = _reason(failure));
    } finally {
      if (mounted) setState(() => _actionId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final showDate = constraints.maxWidth >= 700;
        final compact = constraints.maxWidth < 560;
        return Focus(
          focusNode: _pageFocus,
          autofocus: true,
          onKeyEvent: _onKey,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _header(compact: compact),
                const SizedBox(height: 12),
                TextField(
                  key: _searchFieldKey,
                  controller: _searchController,
                  focusNode: _searchFocus,
                  onChanged: _onQueryChanged,
                  // Enter keeps the query and hands the list its keys back.
                  onSubmitted: (_) => _pageFocus.requestFocus(),
                  onTapOutside: (_) => _pageFocus.requestFocus(),
                  decoration: const InputDecoration(
                    hintText: 'search sessions',
                    isDense: true,
                    prefixIcon: Icon(Icons.search, size: 16),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                if (_hasActions) ...[
                  Text(
                    'a archive · d delete · x export',
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                  const SizedBox(height: 8),
                ],
                if (_actionError != null || _notice != null) ...[
                  _ActionBanner(
                    message: _actionError ?? _notice!,
                    failed: _actionError != null,
                    onDismiss: () => setState(() {
                      _actionError = null;
                      _notice = null;
                    }),
                  ),
                  const SizedBox(height: 10),
                ],
                Expanded(child: _body(showDate)),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _header({required bool compact}) {
    final theme = Theme.of(context);
    final visible = _visible.length;
    final total = widget.sessions.length;
    final count = visible == total ? '$visible' : '$visible of $total';
    return Row(
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          'LOCK-IN SESSIONS',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: 11,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            count,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Container(
          key: const ValueKey('sessions-sort'),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            'sort · ${_sort.label}',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        if (compact)
          const Spacer()
        else
          // The hint owns the remaining space and truncates instead of pushing
          // the row past its width on a narrow window. `o` appears only when
          // there is more than one row for it to order.
          Expanded(
            child: Text(
              widget.sessions.length > 1
                  ? '↑↓ move · Enter open · o sort · n new · / search'
                  : '↑↓ move · Enter open · n new · / search',
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
      ],
    );
  }

  Widget _body(bool showDate) {
    if (widget.loading && widget.sessions.isEmpty) {
      return const _LoadingState();
    }
    final error = widget.error;
    if (error != null && widget.sessions.isEmpty) {
      return _centered(
        _ErrorState(message: error, onRefresh: widget.onRefresh),
      );
    }
    if (widget.sessions.isEmpty) {
      return _centered(const _EmptyState());
    }

    final visible = _visible;
    final selected = _selected;
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
        if (visible.isEmpty)
          Expanded(
            child: _centered(
              _NoMatchState(query: _searchController.text.trim()),
            ),
          )
        else
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: 8),
              itemCount: visible.length,
              itemBuilder: (context, index) {
                final session = visible[index];
                final isSelected = index == selected;
                return Padding(
                  key: _rowKey(session.id),
                  padding: const EdgeInsets.only(bottom: 6),
                  child: _SessionRowTile(
                    key: isSelected ? _selectedRowKey : null,
                    row: session,
                    selected: isSelected,
                    showDate: showDate,
                    busy: _actionId == session.id,
                    // One click is Enter: select the row and open it. A list
                    // where selection has no other purpose does not need the
                    // click-select/double-click-open dance (`ui-notes.md` §15).
                    onTap: () {
                      if (_actionId != null) return;
                      _selectIndex(index);
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

class _SessionRowTile extends StatelessWidget {
  const _SessionRowTile({
    super.key,
    required this.row,
    required this.selected,
    required this.showDate,
    this.busy = false,
    this.onTap,
  });

  final SessionRow row;
  final bool selected;
  final bool showDate;

  /// True while an archive/delete/export for this row is in flight: the row
  /// shows `working…` instead of its step count, so the user can see the core
  /// is running and the verbs are not offered twice.
  final bool busy;

  /// Opens the row. Null keeps the tile inert (a read-only page).
  final VoidCallback? onTap;

  /// Sessions are stored with an ISO timestamp; the list only needs the day.
  String get _dateLabel {
    final date = row.date;
    return date.length >= 10 ? date.substring(0, 10) : date;
  }

  String get _stepsLabel {
    if (row.stepsTotal <= 0) return 'no steps';
    return '${row.stepsDone}/${row.stepsTotal} steps';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final complete = row.stepsTotal > 0 && row.stepsDone >= row.stepsTotal;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: _body(context, theme, complete),
      ),
    );
  }

  Widget _body(BuildContext context, ThemeData theme, bool complete) {
    return Container(
      padding: const EdgeInsets.fromLTRB(0, 10, 12, 10),
      decoration: BoxDecoration(
        color: selected ? LockedInColors.panel : LockedInColors.surface,
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
                        row.name.isEmpty ? 'untitled session' : row.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                    ),
                    if (row.archived) ...[
                      const SizedBox(width: 8),
                      const _ArchivedBadge(),
                    ],
                  ],
                ),
                if (row.broken != null) ...[
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
                          row.broken!,
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
          if (showDate) ...[
            const SizedBox(width: 12),
            SizedBox(
              width: 92,
              child: Text(
                _dateLabel,
                textAlign: TextAlign.right,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: LockedInColors.muted, fontSize: 11),
              ),
            ),
          ],
          const SizedBox(width: 12),
          SizedBox(
            width: 60,
            child: Text(
              '${row.sources} src',
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
          const SizedBox(width: 12),
          SizedBox(
            width: 96,
            child: busy
                ? Text(
                    'working…',
                    key: ValueKey('session-row-busy'),
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.primary,
                      fontSize: 11,
                    ),
                  )
                : Text(
                    _stepsLabel,
                    textAlign: TextAlign.right,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: complete
                          ? LockedInColors.success
                          : LockedInColors.muted,
                      fontSize: 11,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

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
      key: ValueKey(failed ? 'session-action-error' : 'session-action-notice'),
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
            key: const ValueKey('session-action-dismiss'),
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

/// Confirms archiving one session, naming it.
///
/// Returns true only for the explicit Archive button; `Esc`, Cancel or a
/// dismissal is false and nothing moves.
Future<bool> confirmSessionArchive(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _ConfirmDialog(
      title: 'archive session',
      question: 'Archive “$name”?',
      detail:
          'The live folder moves to the configured archive and leaves this '
          'list. Sources, steps and outputs go with it; chat history is not '
          'included.',
      cancelKey: const ValueKey('session-archive-cancel'),
      confirmKey: const ValueKey('session-archive-confirm'),
      confirmLabel: 'Archive',
    ),
  );
  return result ?? false;
}

/// Confirms deleting one session's live folder, naming it and what it removes.
///
/// Returns true only for the explicit Delete button; `Esc`, Cancel or a
/// dismissal is false and nothing is removed.
Future<bool> confirmSessionDelete(
  BuildContext context, {
  required String name,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => _ConfirmDialog(
      title: 'delete session',
      question: 'Delete “$name”?',
      detail:
          'This removes its sources, steps and chat from this workspace. '
          'Nothing else is touched, and an archived copy of the same session '
          'is not deleted.',
      cancelKey: const ValueKey('session-delete-cancel'),
      confirmKey: const ValueKey('session-delete-confirm'),
      confirmLabel: 'Delete',
      destructive: true,
    ),
  );
  return result ?? false;
}

/// The one destructive confirmation shape the session manager uses: a surface
/// fill, the session's name as the question, the consequence spelled out and two
/// explicit buttons.
class _ConfirmDialog extends StatelessWidget {
  const _ConfirmDialog({
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
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                detail,
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
            key: cancelKey,
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: confirmKey,
            style: destructive
                ? FilledButton.styleFrom(backgroundColor: LockedInColors.error)
                : null,
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
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

class _LoadingState extends StatelessWidget {
  const _LoadingState();

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
            'loading sessions…',
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.history, size: 26, color: LockedInColors.muted),
        const SizedBox(height: 10),
        Text('no sessions yet', style: theme.textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(
          'n starts a new lock-in',
          style: TextStyle(color: LockedInColors.muted, fontSize: 12),
        ),
      ],
    );
  }
}

class _NoMatchState extends StatelessWidget {
  const _NoMatchState({required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.search_off, size: 24, color: LockedInColors.muted),
        const SizedBox(height: 10),
        Text(
          'no sessions match “$query”',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: LockedInColors.foreground,
            fontSize: 13,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Esc clears the search',
          style: TextStyle(color: LockedInColors.muted, fontSize: 12),
        ),
      ],
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
