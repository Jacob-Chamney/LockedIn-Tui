import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../shared/cards.dart';
import '../../theme/palette.dart';
import '../shared/content_column.dart';
import '../../theme/tokens.dart';
import '../shared/format.dart';

/// The Knowledge surface: the unified, read-only index over both vaults.
///
/// It has two states and no verbs that write:
///
/// * **the tree** — topics from `knowledge.tree`, each with its notes;
/// * **search** — hits from `knowledge.search`, typed in the field `/` focuses.
///
/// Session memory and source excerpts are marked `history`: they are labelled
/// material, never a new fact, and this surface never shows the activity log or
/// a lesson. `Enter` opens the selected row in the shell's reader layer through
/// [KnowledgePage.onOpen]; a page with no reader wired says so instead of
/// failing silently.
class KnowledgePage extends StatefulWidget {
  const KnowledgePage({
    super.key,
    this.hits = const <KnowledgeHit>[],
    this.groups = const <KnowledgeGroup>[],
    this.loading = false,
    this.error,
    this.query = '',
    this.scope = 'all',
    this.active = true,
    this.onSearch,
    this.onScope,
    this.onRefresh,
    this.onBack,
    this.onOpen,
    this.graph = LearningGraph.empty,
    this.graphLoading = false,
    this.graphError,
    this.onLoadGraph,
  });

  /// The latest `knowledge.search` hits, empty before a search.
  final List<KnowledgeHit> hits;

  /// The latest `knowledge.tree` groups, empty before the first read.
  final List<KnowledgeGroup> groups;

  /// True while a Knowledge read is in flight. With rows already on screen this
  /// is a quiet progress line, not a blank page.
  final bool loading;

  /// The last read failure. Page-local: a failure never replaces the rows.
  final String? error;

  /// The query the visible [hits] answer; empty shows the tree.
  final String query;

  /// `all`, `school`, `skills` or `work`; shown, never re-derived here.
  final String scope;

  /// The debounced search. An empty string returns to the tree without a call.
  final Future<void> Function(String query)? onSearch;

  /// The scope control: a chip or `s` asks the shell for another projection.
  ///
  /// Null leaves the chips visible but inert, so a page rendered without a store
  /// still says what the scopes are instead of hiding the control.
  final ValueChanged<String>? onScope;

  /// `r` and the Retry button: read the tree again.
  final VoidCallback? onRefresh;

  /// `Esc` with no query: Knowledge is a snapshot over the vaults, so it goes
  /// home to chat instead of inventing a parent list.
  final VoidCallback? onBack;

  /// `Enter` on the selected row: open it in the shell's reader layer.
  ///
  /// The argument is the item's `knowledge.read` id — a hit id for a search row,
  /// `note:<workspace path>` for a tree note. Null keeps the page self-contained
  /// and says the reader is not wired rather than pretending to open something.
  final ValueChanged<String>? onOpen;

  /// False while the shell's reader layer covers this page.
  ///
  /// The page stays mounted so the selection, the query and the scroll position
  /// are exactly where the user left them; it simply stops owning the keyboard
  /// until it is active again.
  final bool active;

  /// The source-grounded learning graph (`knowledge.graph`), or empty.
  final LearningGraph graph;
  final bool graphLoading;
  final String? graphError;

  /// Load the graph when `g` opens the graph view. Null keeps it read-only.
  final VoidCallback? onLoadGraph;

  @override
  State<KnowledgePage> createState() => _KnowledgePageState();
}

class _KnowledgePageState extends State<KnowledgePage> {
  /// Long enough that a typed word is one request, short enough to feel live.
  static const _debounce = Duration(milliseconds: 250);

  /// The scope chips, in the order `s` cycles them.
  static const _scopes = ['all', 'school', 'skills', 'work'];

  final _search = TextEditingController();
  final _searchFocus = FocusNode();

  /// The list's own focus node. It is the page's root node: when the search
  /// field gives the keyboard back (Enter or Esc), focus returns here so `j/k`
  /// and Enter act on the rows instead of falling through to the shell.
  final _listFocus = FocusNode();
  final _scroll = ScrollController();
  final _rowKeys = <int, GlobalKey>{};

  Timer? _timer;
  late String _query;

  var _selectedIndex = 0;

  /// True while the graph projection is the visible list. It is a mode of the
  /// same surface, not a second screen: `g` toggles it and the header says
  /// which projection is on.
  var _graphMode = false;

  /// Node ids whose relations are expanded.
  final _graphExpanded = <String>{};

  /// The page's own muted line after `Enter`; never a core failure.
  String? _notice;

  @override
  void initState() {
    super.initState();
    _query = widget.query.trim();
    if (_query.isNotEmpty) _search.text = _query;
  }

  @override
  void didUpdateWidget(covariant KnowledgePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Another projection is another list: start at the top rather than keeping a
    // cursor that named a row the new projection may not have.
    if (oldWidget.scope != widget.scope) {
      _selectedIndex = 0;
      _notice = null;
    }
    // The core can clear the query out from under the page (a restart resets
    // the store). Only follow that when the store drops a query it had already
    // reported: a word still in flight is the user's, not the store's.
    if (widget.query.trim().isEmpty &&
        oldWidget.query.trim().isNotEmpty &&
        _query.trim() == oldWidget.query.trim()) {
      _timer?.cancel();
      _search.clear();
      _query = '';
      _selectedIndex = 0;
      _notice = null;
    }
    // The reader closed: the row is still selected, and the keyboard belongs
    // back on the list so `j`/`k` and `Enter` work without a second click.
    if (!oldWidget.active && widget.active) {
      _notice = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _listFocus.requestFocus();
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _search.dispose();
    _searchFocus.dispose();
    _listFocus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  bool get _searching => _query.trim().isNotEmpty;

  /// Every note in the tree, in display order. Topic headings are not cursor
  /// stops, so `j`/`k` walk notes only.
  List<KnowledgeNote> get _notes => [
    for (final group in widget.groups) ...group.notes,
  ];

  int get _count => _graphMode
      ? widget.graph.nodes.length
      : _searching
      ? widget.hits.length
      : _notes.length;

  int get _selected {
    if (_count == 0) return -1;
    return _selectedIndex.clamp(0, _count - 1);
  }

  void _move(int delta) {
    if (_count < 2) return;
    final current = _selected;
    final next = (current + delta).clamp(0, _count - 1);
    if (next == current) return;
    setState(() => _selectedIndex = next);
    WidgetsBinding.instance.addPostFrameCallback((_) => _reveal(next));
  }

  void _reveal(int index) {
    final target = _rowKeys[index]?.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      alignment: 0.5,
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
    );
  }

  GlobalKey _rowKey(int index) => _rowKeys.putIfAbsent(
    index,
    () => GlobalKey(debugLabel: 'knowledge-$index'),
  );

  /// Filter the tree locally.
  void _onQueryChanged(String value) {
    _timer?.cancel();
    setState(() {
      _query = value;
      _selectedIndex = 0;
      _notice = null;
    });
    if (value.trim().isEmpty) {
      // Clearing the box restores the tree immediately; the store clears the
      // hits without a request.
      unawaited(widget.onSearch?.call('') ?? Future<void>.value());
      return;
    }
    _timer = Timer(_debounce, () {
      if (!mounted) return;
      unawaited(widget.onSearch?.call(value) ?? Future<void>.value());
    });
  }

  /// Submit the typed word now rather than waiting out the debounce.
  void _searchNow(String value) {
    _timer?.cancel();
    unawaited(widget.onSearch?.call(value) ?? Future<void>.value());
  }

  void _clearQuery() {
    _timer?.cancel();
    _search.clear();
    setState(() {
      _query = '';
      _selectedIndex = 0;
      _notice = null;
    });
    _searchFocus.unfocus();
    _listFocus.requestFocus();
    unawaited(widget.onSearch?.call('') ?? Future<void>.value());
  }

  /// The `knowledge.read` id of the selected row.
  ///
  /// A search hit carries its own id; a tree note has only a workspace-relative
  /// path, which the core accepts as the read id for a vault note (`docs`:
  /// a bare `school/…` or `skills/…` note path).
  String? _selectedId() {
    final index = _selected;
    if (index < 0) return null;
    if (_graphMode) return widget.graph.nodes[index].id;
    if (_searching) return widget.hits[index].id;
    final path = _notes[index].path.trim();
    return path.isEmpty ? null : path;
  }

  void _open() {
    if (_graphMode) {
      final node = _selected < widget.graph.nodes.length
          ? widget.graph.nodes[_selected]
          : null;
      if (node == null) return;
      setState(() {
        if (!_graphExpanded.remove(node.id)) _graphExpanded.add(node.id);
      });
      return;
    }
    final id = _selectedId();
    if (id == null) return;
    final open = widget.onOpen;
    if (open == null) {
      // A page without a reader layer cannot show the item; say so rather than
      // appearing to do nothing.
      setState(() => _notice = 'no reader in this build');
      return;
    }
    open(id);
  }

  /// The next projection in chip order, wrapping back to `all`. An unknown scope
  /// starts again at `all` rather than guessing.
  static String _nextScope(String scope) {
    final at = _scopes.indexOf(scope);
    return _scopes[(at + 1) % _scopes.length];
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (!widget.active) return KeyEventResult.ignored;
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final editing = _searchFocus.hasFocus;
    if (key == LogicalKeyboardKey.escape) {
      if (_graphMode) {
        setState(() => _graphMode = false);
        return KeyEventResult.handled;
      }
      if (editing || _query.trim().isNotEmpty) {
        _clearQuery();
        return KeyEventResult.handled;
      }
      widget.onBack?.call();
      return KeyEventResult.handled;
    }
    // `g` is the graph projection of the same surface, not another screen.
    if (key == LogicalKeyboardKey.keyG && !editing) {
      setState(() {
        _graphMode = !_graphMode;
        _selectedIndex = 0;
      });
      if (_graphMode) widget.onLoadGraph?.call();
      return KeyEventResult.handled;
    }
    // `/` focuses the field; while it is focused every other bare key is INPUT.
    if (key == LogicalKeyboardKey.slash && !editing && !_graphMode) {
      _searchFocus.requestFocus();
      return KeyEventResult.handled;
    }
    if (editing) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _move(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _move(-1);
      return KeyEventResult.handled;
    }
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    // The scope control fires once per press, never on key repeat: a held `s`
    // must not spin through every projection and issue a request per frame.
    if (key == LogicalKeyboardKey.keyS &&
        widget.onScope != null &&
        !_graphMode) {
      widget.onScope!(_nextScope(widget.scope));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _open();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      if (_graphMode) {
        widget.onLoadGraph?.call();
        return KeyEventResult.handled;
      }
      if (widget.onRefresh != null) {
        widget.onRefresh!();
        return KeyEventResult.handled;
      }
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return ContentColumn(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 620;
          return Focus(
            focusNode: _listFocus,
            autofocus: true,
            onKeyEvent: _onKey,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _header(compact: compact),
                  const SizedBox(height: 10),
                  if (_graphMode)
                    _graphHint()
                  else ...[
                    _searchField(),
                    const SizedBox(height: 8),
                    _scopeChips(),
                  ],
                  if (_showsWorkTreeNote) ...[
                    const SizedBox(height: 8),
                    _workTreeNote(),
                  ],
                  const SizedBox(height: 8),
                  _historyNote(),
                  const SizedBox(height: 8),
                  if (_notice != null) ...[
                    _noticeBlock(_notice!),
                    const SizedBox(height: 8),
                  ],
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
    final notes = _notes.length;
    final total = _count;
    final scope = widget.scope.trim().isEmpty ? 'all' : widget.scope;
    final summary = _graphMode
        ? '${widget.graph.nodes.length} '
              '${widget.graph.nodes.length == 1 ? 'node' : 'nodes'} · '
              '${widget.graph.edges.length} '
              '${widget.graph.edges.length == 1 ? 'relation' : 'relations'}'
        : _searching
        ? '$total ${total == 1 ? 'hit' : 'hits'} · scope $scope'
        : '$notes ${notes == 1 ? 'note' : 'notes'} · '
              '${widget.groups.length} '
              '${widget.groups.length == 1 ? 'topic' : 'topics'}'
              '${scope == 'all' ? '' : ' · scope $scope'}';
    return Row(
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          'KNOWLEDGE',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: 11,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        Container(
          key: const ValueKey('knowledge-total'),
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: LockedInColors.panel,
            borderRadius: BorderRadius.circular(Radii.control),
            border: Border.all(color: LockedInColors.line),
          ),
          child: Text(
            '$total',
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
            key: const ValueKey('knowledge-summary'),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
        ),
        if (!compact)
          Text(
            '/ search · j/k move · Enter open · Esc back',
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
      ],
    );
  }

  Widget _searchField() {
    return TextField(
      key: const ValueKey('knowledge-search'),
      controller: _search,
      focusNode: _searchFocus,
      onChanged: _onQueryChanged,
      // Enter applies the word now and hands the keyboard back to the list, so
      // `j`/`k` and Enter-on-a-hit work without a second, undiscoverable key.
      onSubmitted: (value) {
        _searchFocus.unfocus();
        _listFocus.requestFocus();
        _searchNow(value);
      },
      textInputAction: TextInputAction.search,
      style: TextStyle(color: LockedInColors.foreground, fontSize: 13),
      decoration: InputDecoration(
        isDense: true,
        filled: true,
        fillColor: LockedInColors.surface,
        hintText: 'search notes, memory, sources, sessions, goals and projects',
        hintStyle: TextStyle(color: LockedInColors.muted, fontSize: 12),
        prefixIcon: Icon(Icons.search, size: 16, color: LockedInColors.muted),
        prefixIconConstraints: const BoxConstraints(minWidth: 32, minHeight: 0),
        suffixIcon: _query.trim().isEmpty
            ? null
            : IconButton(
                key: const ValueKey('knowledge-clear'),
                tooltip: 'clear search',
                icon: Icon(Icons.close, size: 14, color: LockedInColors.muted),
                onPressed: _clearQuery,
              ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 10,
          vertical: 11,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.control),
          borderSide: BorderSide(color: LockedInColors.line),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.control),
          borderSide: BorderSide(color: LockedInColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.control),
          borderSide: BorderSide(color: LockedInColors.primary),
        ),
      ),
    );
  }

  /// The scope control, matching the Review surface's side chips: one chip per
  /// projection, the selected one marked with a check and a fill so colour is
  /// never the only signal. `s` cycles them and a click is the secondary path.
  Widget _scopeChips() {
    return Wrap(
      key: const ValueKey('knowledge-scope-chips'),
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          'SCOPE',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: 10,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        for (final value in _scopes)
          _ScopeChip(
            key: ValueKey('knowledge-scope-$value'),
            label: value,
            selected: widget.scope == value,
            onTap: widget.onScope == null ? null : () => widget.onScope!(value),
          ),
        if (widget.onScope != null)
          Text(
            's cycles',
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
          ),
      ],
    );
  }

  /// True only while the tree is the visible projection and the scope is `work`.
  ///
  /// The tree covers the two vaults, so the shell reads it with `all` and this
  /// note is what explains the mismatch between the chip and the rows.
  bool get _showsWorkTreeNote => widget.scope == 'work' && !_searching;

  Widget _workTreeNote() {
    return Row(
      key: const ValueKey('knowledge-work-note'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'the tree covers school and skills; work items appear in search',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }

  /// The product's labelling rule, stated once on the surface itself.
  Widget _historyNote() {
    return Row(
      key: const ValueKey('knowledge-history-note'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, size: 13, color: LockedInColors.muted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'memory and sources are labelled history, not new facts · '
            'this surface never shows the activity log or lessons',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }

  Widget _noticeBlock(String message) {
    return Container(
      key: const ValueKey('knowledge-notice'),
      padding: const EdgeInsets.fromLTRB(
        Space.sm,
        Space.xs,
        Space.sm,
        Space.xs,
      ),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: LockedInColors.primary, width: Stroke.focus),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.menu_book_outlined, size: 14, color: LockedInColors.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  /// The line that explains the graph projection and its one key.
  Widget _graphHint() {
    return Row(
      key: const ValueKey('knowledge-graph-hint'),
      children: [
        Icon(Icons.hub_outlined, size: 13, color: LockedInColors.muted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'derived from goals, sessions, sources and cards · read-only · '
            'Enter expands relations · g returns to notes',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }

  /// One row per node, grouped by kind, with its relations when expanded.
  Widget _graphBody() {
    if (widget.graphLoading && widget.graph.nodes.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 32),
        child: Center(child: Text('reading the graph…')),
      );
    }
    if (widget.graphError != null && widget.graph.nodes.isEmpty) {
      return _ErrorBlock(
        message: widget.graphError!,
        onRetry: widget.onLoadGraph,
      );
    }
    if (widget.graph.nodes.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 32),
        child: Text('no learning artifacts yet · start a goal or a session'),
      );
    }
    final byId = <String, LearningNode>{
      for (final node in widget.graph.nodes) node.id: node,
    };
    final outgoing = <String, List<LearningEdge>>{};
    final incoming = <String, List<LearningEdge>>{};
    for (final edge in widget.graph.edges) {
      outgoing.putIfAbsent(edge.from, () => []).add(edge);
      incoming.putIfAbsent(edge.to, () => []).add(edge);
    }
    final children = <Widget>[];
    String? lastKind;
    for (final (index, node) in widget.graph.nodes.indexed) {
      if (node.kind != lastKind) {
        children.add(
          Padding(
            padding: EdgeInsets.only(top: index == 0 ? 0 : 10, bottom: 4),
            child: Text(
              node.kind.toUpperCase(),
              style: TextStyle(
                color: LockedInColors.secondary,
                fontSize: 10,
                letterSpacing: 1.2,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        );
        lastKind = node.kind;
      }
      final selected = index == _selected;
      final expanded = _graphExpanded.contains(node.id);
      children.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: InkWell(
            key: ValueKey('knowledge-graph-${node.id}'),
            onTap: () {
              setState(() => _selectedIndex = index);
              _open();
            },
            child: Container(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              decoration: BoxDecoration(
                color: selected ? LockedInColors.panel : Colors.transparent,
                border: Border(
                  left: BorderSide(
                    color: selected
                        ? LockedInColors.primary
                        : Colors.transparent,
                    width: Stroke.focus,
                  ),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          node.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: selected
                                ? LockedInColors.foreground
                                : LockedInColors.secondary,
                            fontSize: 12.5,
                            height: 1.4,
                          ),
                        ),
                      ),
                      if (node.isAgent)
                        Text(
                          'agent explanation',
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: 10,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${node.context} · ${node.detail}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                  if (expanded) ...[
                    const SizedBox(height: 4),
                    for (final edge
                        in outgoing[node.id] ?? const <LearningEdge>[])
                      Text(
                        '→ ${edge.kind} · ${byId[edge.to]?.label ?? edge.to}',
                        style: TextStyle(
                          color: LockedInColors.secondary,
                          fontSize: 11,
                        ),
                      ),
                    for (final edge
                        in incoming[node.id] ?? const <LearningEdge>[])
                      Text(
                        '← ${edge.kind} · ${byId[edge.from]?.label ?? edge.from}',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 11,
                        ),
                      ),
                    if ((outgoing[node.id] ?? const []).isEmpty &&
                        (incoming[node.id] ?? const []).isEmpty)
                      Text(
                        'no relations',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: 11,
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    }
    return ListView(
      key: const ValueKey('knowledge-graph-list'),
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 8),
      children: children,
    );
  }

  Widget _body() {
    if (_graphMode) return _graphBody();
    final children = <Widget>[];
    if (widget.loading && _count > 0) {
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
    if (_count == 0) {
      if (widget.loading) {
        children.add(_LoadingState(searching: _searching));
      } else if (widget.error == null) {
        children.add(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 32),
            child: _searching
                ? _NoHits(query: _query.trim())
                : const _EmptyTree(),
          ),
        );
      }
    } else if (_searching) {
      for (var index = 0; index < widget.hits.length; index++) {
        final hit = widget.hits[index];
        children.add(
          Padding(
            key: _rowKey(index),
            padding: const EdgeInsets.only(bottom: 6),
            child: _HitTile(
              key: ValueKey('knowledge-hit-${hit.id}'),
              hit: hit,
              selected: index == _selected,
              onTap: () {
                setState(() => _selectedIndex = index);
                _open();
              },
            ),
          ),
        );
      }
      children.add(const SizedBox(height: 4));
      children.add(
        Text(
          'Enter opens the reader · history is reference, not a source',
          key: const ValueKey('knowledge-search-hint'),
          style: TextStyle(color: LockedInColors.muted, fontSize: 11),
        ),
      );
    } else {
      var index = 0;
      for (final group in widget.groups) {
        children.add(_TopicHeading(group: group));
        children.add(const SizedBox(height: 6));
        for (final note in group.notes) {
          final position = index;
          children.add(
            Padding(
              key: _rowKey(position),
              padding: const EdgeInsets.only(bottom: 6),
              child: _NoteTile(
                key: ValueKey('knowledge-note-${note.path}'),
                note: note,
                selected: position == _selected,
                onTap: () {
                  setState(() => _selectedIndex = position);
                  _open();
                },
              ),
            ),
          );
          index += 1;
        }
        children.add(const SizedBox(height: 6));
      }
    }
    return ListView(
      key: const ValueKey('knowledge-list'),
      controller: _scroll,
      padding: const EdgeInsets.only(bottom: 8),
      children: children,
    );
  }
}

/// One projection chip, matching the Review surface's `_SideChip`.
class _ScopeChip extends StatelessWidget {
  const _ScopeChip({
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

class _TopicHeading extends StatelessWidget {
  const _TopicHeading({required this.group});

  final KnowledgeGroup group;

  @override
  Widget build(BuildContext context) {
    final topic = group.topic.trim().isEmpty ? 'untitled' : group.topic;
    return Row(
      key: ValueKey('knowledge-topic-$topic'),
      children: [
        Icon(Icons.folder_outlined, size: 13, color: LockedInColors.muted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            topic.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Text(
          '${group.notes.length}',
          style: TextStyle(color: LockedInColors.muted, fontSize: 10),
        ),
      ],
    );
  }
}

class _NoteTile extends StatelessWidget {
  const _NoteTile({
    super.key,
    required this.note,
    this.selected = false,
    this.onTap,
  });

  final KnowledgeNote note;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(Radii.control),
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
                      key: const ValueKey('knowledge-cursor'),
                      style: TextStyle(
                        color: LockedInColors.primary,
                        fontSize: 13,
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    note.displayTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    joinDot([note.path, dateLabel(note.updated)]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HitTile extends StatelessWidget {
  const _HitTile({
    super.key,
    required this.hit,
    this.selected = false,
    this.onTap,
  });

  final KnowledgeHit hit;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final meta = joinDot([hit.path, dateLabel(hit.updated)]);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 9, 12, 9),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(Radii.control),
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
                      key: const ValueKey('knowledge-cursor'),
                      style: TextStyle(
                        color: LockedInColors.primary,
                        fontSize: 13,
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _KindTag(kind: hit.kind),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          hit.displayTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: selected
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _SideBadge(side: hit.side),
                    ],
                  ),
                  if (hit.excerpt.trim().isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      hit.excerpt,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.foreground,
                        fontSize: 12,
                        height: 1.4,
                      ),
                    ),
                  ],
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (hit.isHistory) ...[
                        _HistoryTag(hitId: hit.id),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          meta,
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
                ],
              ),
            ),
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
    final color = _kindColor(kind);
    final label = kind.trim().isEmpty ? 'item' : kind;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_kindIcon(kind), size: 11, color: color),
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

/// The wall a hit belongs to, always labelled, never colour only.
class _SideBadge extends StatelessWidget {
  const _SideBadge({required this.side});

  final String side;

  @override
  Widget build(BuildContext context) {
    final label = side.trim().isEmpty ? 'unknown' : side;
    return Container(
      key: ValueKey('knowledge-side-$label'),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: sideColor(label),
          fontSize: 9,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// The `history` marker on memory and source rows.
class _HistoryTag extends StatelessWidget {
  const _HistoryTag({required this.hitId});

  final String hitId;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('knowledge-history-$hitId'),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.success.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(
          color: LockedInColors.success.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.history, size: 10, color: LockedInColors.success),
          const SizedBox(width: 3),
          Text(
            'history',
            style: TextStyle(
              color: LockedInColors.success,
              fontSize: 9,
              fontWeight: FontWeight.w600,
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
      key: const ValueKey('knowledge-error'),
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
                key: const ValueKey('knowledge-retry'),
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

class _LoadingState extends StatelessWidget {
  const _LoadingState({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
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
            const SizedBox(height: 14),
            Text(
              searching ? 'searching…' : 'loading knowledge…',
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyTree extends StatelessWidget {
  const _EmptyTree();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      key: const ValueKey('knowledge-empty'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.hub_outlined, size: 26, color: LockedInColors.muted),
          const SizedBox(height: 10),
          Text(
            'no notes yet · notes appear here once a vault has Markdown',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _NoHits extends StatelessWidget {
  const _NoHits({required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      key: const ValueKey('knowledge-no-hits'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.search_off, size: 26, color: LockedInColors.muted),
          const SizedBox(height: 10),
          Text(
            query.isEmpty ? 'no matches' : 'no matches for “$query”',
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            'try another word · Esc to browse the tree',
            textAlign: TextAlign.center,
            style: TextStyle(color: LockedInColors.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

Color _kindColor(String kind) => switch (kind) {
  'note' => LockedInColors.primary,
  'memory' => LockedInColors.success,
  'source' => LockedInColors.secondary,
  'session' => LockedInColors.accent,
  'goal' => LockedInColors.secondary,
  'project' => LockedInColors.accent,
  'archive' => LockedInColors.warning,
  _ => LockedInColors.muted,
};

IconData _kindIcon(String kind) => switch (kind) {
  'note' => Icons.description_outlined,
  'memory' => Icons.memory,
  'source' => Icons.article_outlined,
  'session' => Icons.history,
  'goal' => Icons.school_outlined,
  'project' => Icons.work_outline,
  'archive' => Icons.archive_outlined,
  _ => Icons.circle_outlined,
};
