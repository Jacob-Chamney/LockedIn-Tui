part of 'settings_page.dart';

/// The settings rows: filter bar, section rail, row builders and values.
extension _SettingsRows on _SettingsBodyState {
  Widget _filterBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 4),
      child: TextField(
        key: const ValueKey('settings-search'),
        controller: _search,
        focusNode: _searchFocus,
        onChanged: _filter,
        decoration: const InputDecoration(
          isDense: true,
          hintText: '/ filter settings',
          prefixIcon: Icon(Icons.search, size: 16),
        ),
      ),
    );
  }

  Widget _sectionRail() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 2, 20, 6),
      child: Wrap(
        spacing: 6,
        runSpacing: 4,
        children: [
          for (final group in _allGroups)
            InkWell(
              key: ValueKey(
                'settings-section-${group.title.toLowerCase().replaceAll(' ', '-')}',
              ),
              onTap: () {
                final target = _groupKeys[group.title]?.currentContext;
                refresh(() => _activeGroup = group.title);
                if (target != null) {
                  Scrollable.ensureVisible(target, alignment: 0.04);
                }
              },
              child: Container(
                key: group.title == _activeGroup
                    ? const ValueKey('settings-section-active')
                    : null,
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: group.title == _activeGroup
                      ? LockedInColors.panel
                      : null,
                  border: Border.all(
                    color: group.title == _activeGroup
                        ? LockedInColors.primary
                        : LockedInColors.line,
                  ),
                  borderRadius: BorderRadius.circular(Radii.control),
                ),
                child: Text(
                  group.title.toLowerCase(),
                  style: TextStyle(
                    color: group.title == _activeGroup
                        ? LockedInColors.foreground
                        : LockedInColors.muted,
                    fontSize: TypeScale.micro,
                    // Weight as well as colour: the active chip is legible
                    // without relying on the accent alone.
                    fontWeight: group.title == _activeGroup
                        ? FontWeight.w700
                        : FontWeight.w400,
                    letterSpacing: 0.6,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _groupWidgets() {
    final widgets = <Widget>[];
    var index = 0;
    for (final group in _groups) {
      widgets.add(
        KeyedSubtree(
          key: _groupKeys[group.title],
          child: GroupHeader(title: group.title),
        ),
      );
      for (final row in group.rows) {
        widgets.add(_buildRow(row, index));
        index += 1;
      }
      if (group.title == 'MODELS') {
        if (widget.settings.chatModel.trim().isEmpty) {
          widgets.add(const ModelHint());
        }
        final connect = widget.onConnect;
        if (connect != null) {
          widgets.add(ConnectModelAction(onPressed: connect));
        }
      }
      if (group.title == 'PLUGINS') {
        final failure = widget.mcpError ?? _mcpFailure;
        if (_refreshingMcp) widgets.add(const PluginsRefreshing());
        if (failure != null && failure.isNotEmpty) {
          widgets.add(PluginsFailure(message: failure));
        }
        if (widget.mcpServers.isEmpty) widgets.add(const PluginsEmpty());
        widgets.add(const PluginsNote());
        if (widget.onSetMcpServer != null || widget.onRemoveMcpServer != null) {
          widgets.add(
            McpServerActions(
              servers: widget.mcpServers,
              onAdd: widget.onSetMcpServer == null ? null : _addMcpServer,
              onEdit: widget.onReadMcpServer == null ? null : _editMcpServer,
              onRemove: widget.onRemoveMcpServer == null
                  ? null
                  : _removeMcpServer,
              error: _mcpActionError,
            ),
          );
        }
      }
      if (group.title == 'KEYBINDS') {
        widgets.add(KeybindFooter(editable: widget.onSetKeybind != null));
      }
      if (group.title == 'DECISION LAYER') {
        final failure = widget.decisionError;
        if (widget.decisionLoading && widget.decision == null) {
          widgets.add(const DecisionLoading());
        } else if (failure != null && failure.isNotEmpty) {
          widgets.add(DecisionFailure(message: failure));
        }
        widgets.add(const DecisionRulesNote());
      }
      if (group.title == 'WORK') {
        final failure = widget.workPermissionsError;
        if (widget.workPermissionsLoading && widget.workPermissions == null) {
          widgets.add(const WorkLoading());
        } else if (failure != null && failure.isNotEmpty) {
          widgets.add(WorkFailure(message: failure));
        }
        widgets.add(const WorkNote());
      }
      widgets.add(const SizedBox(height: 10));
    }
    return widgets;
  }

  Widget _buildRow(SettingRow row, int index) {
    final selected = index == _selected;
    final error = _rowErrorId == row.id ? _rowError : null;
    final notice = _noticeId == row.id ? _notice : null;
    return KeyedSubtree(
      key: _rowKeys[index],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          MouseRegion(
            cursor: SystemMouseCursors.click,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => _select(index),
              child: Container(
                key: ValueKey('settings-row-${row.id}'),
                padding: const EdgeInsets.fromLTRB(9, 8, 12, 9),
                decoration: BoxDecoration(
                  color: selected ? LockedInColors.panel : Colors.transparent,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (selected)
                      Container(
                        key: const ValueKey('settings-selected'),
                        width: 3,
                        height: 15,
                        margin: const EdgeInsets.only(top: 2, right: 9),
                        decoration: BoxDecoration(
                          color: LockedInColors.primary,
                          borderRadius: BorderRadius.circular(Radii.control),
                        ),
                      )
                    else
                      const SizedBox(width: 12),
                    Expanded(
                      child: widget.narrow ? _stackedRow(row) : _wideRow(row),
                    ),
                    // One fixed trailing column for every row: a row without a
                    // control used to reserve less, which pushed its value
                    // 11 px out of line with its neighbours.
                    SizedBox(
                      width: 40,
                      child: _rowHasControl(row)
                          ? IconButton(
                              key: ValueKey('settings-activate-${row.id}'),
                              tooltip: 'Enter',
                              onPressed: _canRun(row)
                                  ? () {
                                      _select(index);
                                      _activate();
                                    }
                                  : null,
                              icon: const Icon(Icons.chevron_right, size: 16),
                              visualDensity: VisualDensity.compact,
                              color: LockedInColors.muted,
                            )
                          : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (row.note != null && row.note!.isNotEmpty)
            Padding(
              key: ValueKey('settings-row-note-${row.id}'),
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 7),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 13,
                    color: LockedInColors.error,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      row.note!,
                      style: TextStyle(
                        color: LockedInColors.error,
                        fontSize: TypeScale.label,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (error != null && error.isNotEmpty)
            Padding(
              key: ValueKey('settings-row-error-${row.id}'),
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 13,
                    color: LockedInColors.error,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      error,
                      style: TextStyle(
                        color: LockedInColors.error,
                        fontSize: TypeScale.label,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (notice != null && notice.isNotEmpty)
            Padding(
              key: ValueKey('settings-row-notice-${row.id}'),
              padding: const EdgeInsets.fromLTRB(24, 0, 12, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 13,
                    color: LockedInColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      notice,
                      style: TextStyle(
                        color: LockedInColors.muted,
                        fontSize: TypeScale.label,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// True when [row] has something `Enter` can run, so it gets a button.
  /// The two rows the connect dialog answers: which model, and which providers.
  ///
  /// They are projections, not editable values, but they are the rows a user
  /// lands on when the badge says `no model connected`. `Enter` (and the
  /// chevron) opens the same dialog the button below them opens, so linking a
  /// model never needs a pointer.
  bool _isConnectRow(SettingRow row) =>
      row.id == 'chat-model' || row.id == 'providers';

  bool _rowHasControl(SettingRow row) =>
      _isConnectRow(row) ||
      row.edit != null ||
      row.policy != null ||
      row.decision != null ||
      row.work != null ||
      row.keybind != null;

  /// True when this build can actually run the row's control. A read-only page
  /// keeps the chevron but disables it, so the pointer never promises more than
  /// the keyboard can do.
  bool _canRun(SettingRow row) {
    if (_isConnectRow(row)) return widget.onConnect != null;
    if (row.policy != null) return widget.onSetMcpPolicy != null;
    if (row.decision != null) return widget.onSetDecision != null;
    if (row.work != null) return widget.onSetWorkPermissions != null;
    if (row.keybind != null) return widget.onSetKeybind != null;
    return row.edit != null && widget.onSaveSettings != null;
  }

  Widget _wideRow(SettingRow row) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 5, child: _rowLabel(row)),
        const SizedBox(width: 16),
        Flexible(flex: 4, child: _valueWidget(row, textAlign: TextAlign.right)),
      ],
    );
  }

  Widget _stackedRow(SettingRow row) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [_rowLabel(row), const SizedBox(height: 4), _valueWidget(row)],
    );
  }

  Widget _valueWidget(SettingRow row, {TextAlign? textAlign}) {
    if (_savingId == row.id) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: textAlign == TextAlign.right
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 6),
          Flexible(
            child: Text(
              'saving…',
              key: ValueKey('settings-row-saving'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.5,
              ),
            ),
          ),
        ],
      );
    }
    if (row.keybind != null) return _keybindValue(row);
    return Text(
      row.value,
      textAlign: textAlign,
      maxLines: widget.narrow ? 3 : 2,
      overflow: TextOverflow.ellipsis,
      style: valueStyle(row.value),
    );
  }

  Widget _keybindValue(SettingRow row) {
    final cell = row.keybind!;
    return KeybindValue(
      binding: cell.binding,
      custom: cell.custom,
      capturing: _capturingId == row.id,
      // A leader capture says so, so `Space` does not look like a dropped key.
      capturingLeader: _capturingId == row.id && _capturingLeader,
    );
  }

  Widget _rowLabel(SettingRow row) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          row.label,
          style: TextStyle(
            color: LockedInColors.foreground,
            fontSize: TypeScale.body,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          row.hint,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
            height: 1.4,
          ),
        ),
      ],
    );
  }
}
