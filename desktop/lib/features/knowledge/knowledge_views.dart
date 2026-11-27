part of 'knowledge_page.dart';

extension _KnowledgeViews on _KnowledgePageState {
  Widget _modeTab({
    required String label,
    required bool selected,
    required Key key,
    required VoidCallback onTap,
  }) {
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        key: key,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: selected ? LockedInColors.panel : Colors.transparent,
            border: Border(
              bottom: BorderSide(
                color: selected ? LockedInColors.primary : Colors.transparent,
                width: Stroke.focus,
              ),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected
                  ? LockedInColors.foreground
                  : LockedInColors.muted,
              fontSize: TypeScale.label,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            ),
          ),
        ),
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
            fontSize: TypeScale.label,
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
              fontSize: TypeScale.micro,
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
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ),
        const SizedBox(width: 10),
        _modeTab(
          label: 'notes',
          selected: !_graphMode,
          key: const ValueKey('knowledge-mode-notes'),
          onTap: () => _setGraphMode(false),
        ),
        const SizedBox(width: 4),
        _modeTab(
          label: 'graph',
          selected: _graphMode,
          key: const ValueKey('knowledge-mode-graph'),
          onTap: () => _setGraphMode(true),
        ),
        // The modes are the batch of buttons on this header; the keys are
        // named in the status bar, not recited here a second time.
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
      style: TextStyle(
        color: LockedInColors.foreground,
        fontSize: TypeScale.body,
      ),
      decoration: InputDecoration(
        isDense: true,
        filled: true,
        fillColor: LockedInColors.surface,
        hintText: 'search notes, memory, sources, sessions, goals and projects',
        hintStyle: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.label,
        ),
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
            fontSize: TypeScale.micro,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        for (final value in _KnowledgePageState._scopes)
          _ScopeChip(
            key: ValueKey('knowledge-scope-$value'),
            label: value,
            selected: widget.scope == value,
            onTap: widget.onScope == null ? null : () => widget.onScope!(value),
          ),
        if (widget.onScope != null)
          Text(
            's cycles',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
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
              fontSize: TypeScale.label,
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
              fontSize: TypeScale.label,
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
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
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
              fontSize: TypeScale.label,
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
                fontSize: TypeScale.micro,
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
              refresh(() => _selectedIndex = index);
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
                            fontSize: TypeScale.key,
                            height: 1.4,
                          ),
                        ),
                      ),
                      if (node.isAgent)
                        Text(
                          'agent explanation',
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.micro,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${node.context} · ${node.detail}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                    ),
                  ),
                  if (expanded) ...[
                    const SizedBox(height: 4),
                    for (final edge
                        in outgoing[node.id] ?? const <LearningEdge>[])
                      Text(
                        '→ ${edge.kind} · ${byId[edge.to]?.label ?? edge.to}',
                        style: TextStyle(
                          color: LockedInColors.secondary,
                          fontSize: TypeScale.label,
                        ),
                      ),
                    for (final edge
                        in incoming[node.id] ?? const <LearningEdge>[])
                      Text(
                        '← ${edge.kind} · ${byId[edge.from]?.label ?? edge.from}',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.label,
                        ),
                      ),
                    if ((outgoing[node.id] ?? const []).isEmpty &&
                        (incoming[node.id] ?? const []).isEmpty)
                      Text(
                        'no relations',
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.label,
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
    return Column(
      children: [
        SizedBox(
          height: 240,
          child: LearningGraphCanvas(
            graph: widget.graph,
            selectedIndex: _selected.clamp(0, widget.graph.nodes.length - 1),
            onSelect: (index) => refresh(() {
              _selectedIndex = index;
            }),
          ),
        ),
        const Rule(),
        Expanded(
          child: ListView(
            key: const ValueKey('knowledge-graph-list'),
            controller: _scroll,
            padding: const EdgeInsets.only(bottom: 8),
            children: children,
          ),
        ),
      ],
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
                refresh(() => _selectedIndex = index);
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
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
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
                  refresh(() => _selectedIndex = position);
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
