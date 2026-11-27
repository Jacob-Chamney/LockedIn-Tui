import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../keys.dart';
import '../../shell/chrome.dart';
import '../../bridge/models.dart';
import '../../bridge/errors.dart';
import '../../theme/palette.dart';
import '../../theme/breakpoints.dart';
import '../shared/content_column.dart';
import '../../theme/tokens.dart';
import 'agent_dialog.dart';
import 'project_dialog.dart';
import 'swarm_page.dart';
import '../shared/cards.dart';

part 'work_detail.dart';
part 'work_widgets.dart';

/// The Work surface: registered projects, then one project's detail.
///
/// The shell owns the store. It passes the `work.list` rows in and decides what
/// opening means; this page reads no files, calls no core method and never
/// writes inside a project folder. Registration happens through
/// [showNewProjectDialog] and the shell's `work.create`.
class WorkPage extends StatefulWidget {
  const WorkPage({
    super.key,
    required this.projects,
    required this.loading,
    this.error,
    this.onRefresh,
    this.onOpen,
    this.onCreate,
    this.onRemove,
  });

  final List<ProjectRow> projects;
  final bool loading;
  final String? error;
  final VoidCallback? onRefresh;

  /// Called with the selected row when `Enter` opens it.
  final ValueChanged<ProjectRow>? onOpen;

  /// Registers a project through `work.create`. Null keeps the list read-only.
  final ProjectCreator? onCreate;

  /// Removes one project's metadata through `work.remove`. Null hides the
  /// row's remove verb. The page confirms by name first; files stay.
  final Future<void> Function(String id)? onRemove;

  @override
  State<WorkPage> createState() => _WorkPageState();
}

class _WorkPageState extends State<WorkPage> {
  static const _selectedRowKey = ValueKey('project-row-selected');
  static const _searchFieldKey = ValueKey('work-search');

  final _rowKeys = <String, GlobalKey>{};
  final _searchController = TextEditingController();
  final _searchFocus = FocusNode();

  /// The page's own node: where the keyboard returns after the search field.
  /// `unfocus()` alone moves it to the enclosing scope, which deadened every
  /// list key until the user clicked.
  final _pageFocus = FocusNode(debugLabel: 'work');
  var _selectedIndex = 0;
  var _dialogOpen = false;

  /// The live search query. Filtering projects the rows the shell already sent:
  /// no project is re-read and nothing is called for a keystroke.
  var _query = '';

  List<ProjectRow> get _visible {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return widget.projects;
    return [
      for (final row in widget.projects)
        if (row.name.toLowerCase().contains(query) ||
            row.id.toLowerCase().contains(query) ||
            row.folder.toLowerCase().contains(query))
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
    _pageFocus.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  GlobalKey _rowKey(String id) =>
      _rowKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'project-$id'));

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
    widget.onOpen?.call(_visible[index]);
  }

  Future<void> _create() async {
    final create = widget.onCreate;
    if (create == null || _dialogOpen) return;
    _dialogOpen = true;
    try {
      // The store refreshes the list and opens the new project, so the shell
      // swaps to its detail as soon as `activeProject` lands.
      await showNewProjectDialog(context, onCreate: create);
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
    // While the search field is focused every bare key is text: `n` would
    // otherwise open the new-project dialog mid-query.
    if (_searchFocus.hasFocus && key != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.slash) {
      if (event is KeyDownEvent) _searchFocus.requestFocus();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape && _query.isNotEmpty) {
      _searchController.clear();
      setState(() => _query = '');
      _pageFocus.requestFocus();
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
      if (widget.onOpen == null) return KeyEventResult.ignored;
      _openSelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN && widget.onCreate != null) {
      if (event is KeyDownEvent) _create();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return ContentColumn(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final showMode = constraints.maxWidth >= Breakpoints.stack;
          return Focus(
            focusNode: _pageFocus,
            autofocus: true,
            onKeyEvent: _onKey,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _header(compact: constraints.maxWidth < Breakpoints.hint),
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
                      hintText: 'search projects',
                      isDense: true,
                      prefixIcon: Icon(Icons.search, size: 16),
                      contentPadding: EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Expanded(child: _body(showMode: showMode)),
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
    return Row(
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 8),
        Text(
          'WORK PROJECTS',
          style: theme.textTheme.labelSmall?.copyWith(
            color: LockedInColors.secondary,
            fontSize: TypeScale.label,
            letterSpacing: 1.4,
          ),
        ),
        const SizedBox(width: 10),
        ValueChip(
          _query.isEmpty
              ? '${widget.projects.length}'
              : '${_visible.length} of ${widget.projects.length}',
        ),
        const Spacer(),
        if (widget.onCreate != null) ...[
          const SizedBox(width: Space.xs),
          HeaderAction(
            key: const ValueKey('work-new'),
            label: 'new',
            keyLabel: 'n',
            icon: Icons.add,
            primary: true,
            iconOnly: compact,
            onPressed: () => unawaited(_create()),
          ),
        ],
      ],
    );
  }

  /// Confirm and remove one project's metadata.
  Future<void> _removeProject(ProjectRow project) async {
    final remove = widget.onRemove;
    if (remove == null || _dialogOpen) return;
    final confirmed = await confirmProjectRemove(
      context,
      name: project.name,
      root: project.folder,
    );
    if (!confirmed || !mounted) return;
    await remove(project.id);
  }

  /// The row's pointer verbs.
  Widget _rowMenu(int index, ProjectRow project) {
    if (widget.onRemove == null) return const SizedBox.shrink();
    return PopupMenuButton<String>(
      key: ValueKey('project-row-menu-${project.id}'),
      tooltip: 'row actions',
      iconSize: 16,
      padding: EdgeInsets.zero,
      onSelected: (value) {
        if (value != 'remove') return;
        setState(() => _selectedIndex = index);
        unawaited(_removeProject(project));
      },
      itemBuilder: (context) => const [
        PopupMenuItem(value: 'remove', child: Text('remove')),
      ],
    );
  }

  Widget _body({required bool showMode}) {
    if (widget.loading && widget.projects.isEmpty) {
      return const _LoadingState(label: 'loading projects…');
    }
    final error = widget.error;
    if (error != null && widget.projects.isEmpty) {
      return _centered(
        _ErrorState(message: error, onRefresh: widget.onRefresh),
      );
    }
    if (widget.projects.isEmpty) {
      return _centered(_EmptyState(onCreate: _create));
    }
    if (_visible.isEmpty) {
      return _centered(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off, size: 26, color: LockedInColors.muted),
            const SizedBox(height: 10),
            Text(
              'no project matches “${_query.trim()}”',
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.body,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Esc clears the search',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
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
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.only(bottom: 8),
            itemCount: _visible.length,
            itemBuilder: (context, index) {
              final project = _visible[index];
              final isSelected = index == _selected;
              return Padding(
                key: _rowKey(project.id),
                padding: const EdgeInsets.only(bottom: 6),
                child: _ProjectRowTile(
                  key: isSelected ? _selectedRowKey : null,
                  project: project,
                  selected: isSelected,
                  showMode: showMode,
                  trailing: _rowMenu(index, project),
                  onTap: () {
                    setState(() => _selectedIndex = index);
                    widget.onOpen?.call(project);
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

/// One project's detail, rendered from the shell's `work.open` projection.
///
/// The agent list is the one editable surface here: `a` creates a profile,
/// `Enter` edits the selected one, `d` deletes after a named confirmation and
/// `m` toggles the project default. Every write goes through the shell's
/// `work.agent.*` calls, which rewrite `work/projects/<id>/meta.json` only:
/// this page reads no file and never touches the project folder.
