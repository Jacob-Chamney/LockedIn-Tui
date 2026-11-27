import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../bridge/models.dart';
import '../shared/cards.dart';
import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../shared/content_column.dart';
import '../../theme/tokens.dart';
import 'learning_graph_view.dart';
import '../shared/format.dart';

part 'knowledge_views.dart';
part 'knowledge_rows.dart';

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
    this.graph = learningGraphEmpty,
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
  /// Run one mutation from a view helper extracted into a part file.
  void refresh(VoidCallback fn) => setState(fn);

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
      _setGraphMode(!_graphMode);
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

  /// Switch the list projection without the keyboard: the graph was previously
  /// reachable only by knowing `g`, which made a shipped surface invisible.
  void _setGraphMode(bool graph) {
    if (_graphMode == graph) return;
    setState(() {
      _graphMode = graph;
      _selectedIndex = 0;
    });
    if (graph) widget.onLoadGraph?.call();
  }

  @override
  Widget build(BuildContext context) {
    return ContentColumn(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < Breakpoints.hint;
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
}
