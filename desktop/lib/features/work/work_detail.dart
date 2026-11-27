part of 'work_page.dart';

class WorkDetailView extends StatefulWidget {
  const WorkDetailView({
    super.key,
    required this.project,
    this.loading = false,
    this.error,
    this.chatCount = 0,
    this.latestChatId,
    this.changes,
    this.changesLoading = false,
    this.changesError,
    this.approvals,
    this.approvalsLoading = false,
    this.approvalsError,
    this.onOpenApprovals,
    this.swarmRuns = const [],
    this.swarmLoading = false,
    this.swarmError,
    this.onOpenSwarm,
    this.activityCount = 0,
    this.activityLoading = false,
    this.activityError,
    this.onOpenActivity,
    this.onBack,
    this.onRetry,
    this.onOpenChat,
    this.onRefreshChanges,
    this.onSaveAgent,
    this.onDeleteAgent,
    this.onSetDefaultAgent,
    this.onSaveInstructions,
  });

  final WorkProjectDetail project;
  final bool loading;

  /// One readable failure from a refresh. It never replaces a project the shell
  /// already has.
  final String? error;

  /// The project's saved chats, from `work.chat.list`.
  final int chatCount;

  /// The newest chat id, or null when the project has none yet.
  final String? latestChatId;

  /// The read-only working-tree summary, from `work.changes`.
  ///
  /// Null until the first answer arrives. `available: false` is a success and
  /// renders the core's own sentence in a muted note, never an error.
  final ChangeSummary? changes;

  /// True while `work.changes` is in flight.
  final bool changesLoading;

  /// The last changes read failure, or null. It never clears [changes].
  final String? changesError;

  /// The open project's pending approvals (`work.approvals.list`).
  ///
  /// Null is the same as empty: no proposal is waiting. The card opens the
  /// approval layer; it never applies or runs anything itself.
  final WorkApprovals? approvals;

  /// True while `work.approvals.list` is in flight.
  final bool approvalsLoading;

  /// The last approvals read failure, or null.
  final String? approvalsError;

  /// `p` and the card's own control open the pending-approval layer. Null keeps
  /// the card read-only and drops the key.
  final VoidCallback? onOpenApprovals;

  /// Every swarm run the core still remembers for this project, oldest first
  /// (`work.swarm.runs`).
  final List<SwarmBoardView> swarmRuns;

  /// True while `work.swarm.runs` is in flight.
  final bool swarmLoading;

  /// The last swarm read failure, or null. It never clears [swarmRuns].
  final String? swarmError;

  /// `w` and the card's own control open the swarm board. Null keeps the card
  /// read-only and drops the key.
  final VoidCallback? onOpenSwarm;

  /// How many activity-log records the open project has (`activity.list`).
  ///
  /// The log is metadata about decisions already taken: it never carries a file
  /// body, a prompt or a command's output. The count is read with the project
  /// so the card can answer "did I approve that write?" before the log opens.
  final int activityCount;

  /// True while the activity count read is in flight.
  final bool activityLoading;

  /// The last activity count read failure, or null.
  final String? activityError;

  /// `l` and the card's own control open the activity log. Null keeps the card
  /// read-only and drops the key.
  final VoidCallback? onOpenActivity;

  final VoidCallback? onBack;
  final VoidCallback? onRetry;

  /// Open the project chat (the newest one, or the project's first). Null keeps
  /// the detail read-only and hides the action.
  final VoidCallback? onOpenChat;

  /// Re-read the working tree (`work.changes`). Null keeps the card read-only
  /// and drops the `g`/`r` keys.
  final VoidCallback? onRefreshChanges;

  /// Create or update one agent profile. A profile with an empty id creates a
  /// new one; a saved id updates it in place. Null keeps the list read-only,
  /// which is what a shell without the agent methods gets.
  final Future<String> Function(AgentProfileView agent)? onSaveAgent;

  /// Remove one agent profile. Null keeps the list read-only.
  final Future<void> Function(String agentId)? onDeleteAgent;

  /// Set (or clear, with null) the project's default agent.
  final Future<void> Function(String? agentId)? onSetDefaultAgent;

  /// Replace the project's standing instructions. Null keeps the card
  /// read-only and drops the `i` key.
  final Future<void> Function(String instructions)? onSaveInstructions;

  @override
  State<WorkDetailView> createState() => _WorkDetailViewState();
}

class _WorkDetailViewState extends State<WorkDetailView> {
  static const _selectedAgentKey = ValueKey('agent-row-selected');

  final _agentKeys = <String, GlobalKey>{};
  var _selectedAgent = 0;
  var _dialogOpen = false;
  var _savingAgent = false;
  String? _agentError;

  /// The profile the next rebuild should land the cursor on (a create answers
  /// with an id the previous `project.agents` did not contain).
  String? _pendingSelectionId;

  List<AgentProfileView> get _agents => widget.project.agents;

  int get _selected =>
      _agents.isEmpty ? -1 : _selectedAgent.clamp(0, _agents.length - 1);

  AgentProfileView? get _selectedProfile {
    final index = _selected;
    return index < 0 ? null : _agents[index];
  }

  bool get _canEditAgents =>
      widget.onSaveAgent != null ||
      widget.onDeleteAgent != null ||
      widget.onSetDefaultAgent != null;

  @override
  void didUpdateWidget(WorkDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.project.id != widget.project.id) {
      _selectedAgent = 0;
      _agentError = null;
      _pendingSelectionId = null;
      return;
    }
    final pending = _pendingSelectionId;
    if (pending == null) return;
    final index = _agents.indexWhere((agent) => agent.id == pending);
    if (index < 0) return;
    _selectedAgent = index;
    _pendingSelectionId = null;
  }

  GlobalKey _agentKey(String id) =>
      _agentKeys.putIfAbsent(id, () => GlobalKey(debugLabel: 'agent-$id'));

  void _selectAgent(int index) {
    if (index < 0 || index >= _agents.length) return;
    if (_selectedAgent == index) return;
    setState(() => _selectedAgent = index);
    final id = _agents[index].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _agentKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  void _moveAgent(int delta) {
    if (_agents.length < 2) return;
    _selectAgent((_selected + delta).clamp(0, _agents.length - 1));
  }

  /// The core's own sentence when it sent one, otherwise the exception's.

  Future<void> _createAgent() async {
    final save = widget.onSaveAgent;
    if (save == null || _dialogOpen || _savingAgent) return;
    _dialogOpen = true;
    try {
      final created = await showAgentEditor(context, agent: null, onSave: save);
      if (!mounted || created == null) return;
      setState(() {
        _agentError = null;
        final index = _agents.indexWhere((agent) => agent.id == created);
        if (index >= 0) {
          _selectedAgent = index;
          _pendingSelectionId = null;
        } else {
          _pendingSelectionId = created;
        }
      });
    } finally {
      _dialogOpen = false;
    }
  }

  Future<void> _editAgent() async {
    final agent = _selectedProfile;
    final save = widget.onSaveAgent;
    if (agent == null || save == null || _dialogOpen || _savingAgent) return;
    _dialogOpen = true;
    try {
      final saved = await showAgentEditor(context, agent: agent, onSave: save);
      if (!mounted || saved == null) return;
      setState(() {
        _agentError = null;
        final index = _agents.indexWhere((row) => row.id == saved);
        if (index >= 0) _selectedAgent = index;
      });
    } finally {
      _dialogOpen = false;
    }
  }

  Future<void> _deleteAgent() async {
    final agent = _selectedProfile;
    final delete = widget.onDeleteAgent;
    if (agent == null || delete == null || _dialogOpen || _savingAgent) {
      return;
    }
    _dialogOpen = true;
    try {
      final confirmed = await confirmAgentDelete(
        context,
        name: agent.name.isEmpty ? 'unnamed agent' : agent.name,
      );
      if (!confirmed || !mounted) return;
      setState(() {
        _savingAgent = true;
        _agentError = null;
      });
      try {
        await delete(agent.id);
      } catch (failure) {
        if (mounted) setState(() => _agentError = userMessage(failure));
      } finally {
        if (mounted) setState(() => _savingAgent = false);
      }
    } finally {
      _dialogOpen = false;
    }
  }

  Future<void> _toggleDefaultAgent() async {
    final agent = _selectedProfile;
    final setDefault = widget.onSetDefaultAgent;
    if (agent == null || setDefault == null || _dialogOpen || _savingAgent) {
      return;
    }
    final next = widget.project.defaultAgent == agent.id ? null : agent.id;
    setState(() {
      _savingAgent = true;
      _agentError = null;
    });
    try {
      await setDefault(next);
    } catch (failure) {
      if (mounted) setState(() => _agentError = userMessage(failure));
    } finally {
      if (mounted) setState(() => _savingAgent = false);
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    // A dialog owns the keyboard while it is open.
    if (_dialogOpen) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape && widget.onBack != null) {
      widget.onBack!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyI &&
        widget.onSaveInstructions != null &&
        event is KeyDownEvent) {
      unawaited(_editInstructions());
      return KeyEventResult.handled;
    }
    // `c` opens the project chat even when there are no agents to edit.
    if (key == LogicalKeyboardKey.keyC && widget.onOpenChat != null) {
      if (event is KeyDownEvent) widget.onOpenChat!();
      return KeyEventResult.handled;
    }
    // `p` opens the pending-approval layer. It works with no agents and no
    // changes read, because a proposal can arrive from a chat at any time.
    if (key == LogicalKeyboardKey.keyP && widget.onOpenApprovals != null) {
      if (event is KeyDownEvent) widget.onOpenApprovals!();
      return KeyEventResult.handled;
    }
    // `w` opens the swarm board. Like `p` it needs no agents, because the
    // board is process state and a run may have been started from a chat.
    if (key == LogicalKeyboardKey.keyW && widget.onOpenSwarm != null) {
      if (event is KeyDownEvent) widget.onOpenSwarm!();
      return KeyEventResult.handled;
    }
    // `l` opens the activity log. It is a read-only history of decisions, so it
    // needs no agents and no changes read.
    if (key == LogicalKeyboardKey.keyL && widget.onOpenActivity != null) {
      if (event is KeyDownEvent) widget.onOpenActivity!();
      return KeyEventResult.handled;
    }
    // `g` or `r` reads the working tree again. Neither key is part of agent
    // selection (`j`/`k`, arrows, Enter, a, d, m), so the card cannot swallow
    // an edit key and the list keeps its own controls.
    if (widget.onRefreshChanges != null &&
        (key == LogicalKeyboardKey.keyG || key == LogicalKeyboardKey.keyR)) {
      if (event is KeyDownEvent) widget.onRefreshChanges!();
      return KeyEventResult.handled;
    }
    // `a` comes before the empty-list guard: a brand-new project has no agents,
    // and that is exactly when its first one has to be creatable. It needs no
    // selection, so an empty roster does not block it.
    if (key == LogicalKeyboardKey.keyA &&
        widget.onSaveAgent != null &&
        _canEditAgents &&
        !_savingAgent) {
      if (event is KeyDownEvent) _createAgent();
      return KeyEventResult.handled;
    }
    if (_savingAgent || !_canEditAgents || _agents.isEmpty) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      _moveAgent(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      _moveAgent(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (widget.onSaveAgent == null) return KeyEventResult.ignored;
      _editAgent();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyD && widget.onDeleteAgent != null) {
      if (event is KeyDownEvent) _deleteAgent();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyM && widget.onSetDefaultAgent != null) {
      if (event is KeyDownEvent) _toggleDefaultAgent();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _onKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(context),
          _subnav(),
          if (widget.loading)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          Expanded(child: _body(context)),
        ],
      ),
    );
  }

  Widget _header(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to projects',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.project.name.isEmpty ? 'project' : widget.project.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  _subtitle(widget.project),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
            ),
          ),
          if (widget.project.archived) ...[
            const SizedBox(width: 10),
            const _ArchivedBadge(),
          ],
        ],
      ),
    );
  }

  /// The project's layers as one row of buttons: chat, approvals, the swarm
  /// board and the activity log.
  ///
  /// The detail used to be a single scroll of eight stacked sections, so chat
  /// (the reason a project exists) sat between instructions and the swarm
  /// board and the only path to approvals was a key in the status bar.
  Widget _subnav() {
    final actions = <Widget>[
      if (widget.onOpenChat != null)
        _navAction('work-nav-chat', 'chat', 'c', widget.onOpenChat),
      if (widget.onOpenApprovals != null)
        _navAction(
          'work-nav-approvals',
          'approvals',
          'p',
          widget.onOpenApprovals,
        ),
      if (widget.onOpenSwarm != null)
        _navAction('work-nav-swarm', 'swarm', 'w', widget.onOpenSwarm),
      if (widget.onOpenActivity != null)
        _navAction('work-nav-activity', 'activity', 'l', widget.onOpenActivity),
    ];
    if (actions.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 6, 20, 6),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Wrap(spacing: 4, runSpacing: 4, children: actions),
    );
  }

  Widget _navAction(
    String keyName,
    String label,
    String chord,
    VoidCallback? onPressed,
  ) {
    return TextButton(
      key: ValueKey(keyName),
      onPressed: onPressed,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          const SizedBox(width: Space.xs),
          KeyCap(chord),
        ],
      ),
    );
  }

  Widget _body(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _ErrorState(
                    message: widget.error!,
                    onRefresh: widget.onRetry,
                  ),
                  const SizedBox(height: 12),
                ],
                _rootCard(),
                const SizedBox(height: 14),
                _changesCard(),
                const SizedBox(height: 14),
                _instructionsCard(),
                const SizedBox(height: 14),
                _chatCard(),
                const SizedBox(height: 14),
                _swarmCard(),
                const SizedBox(height: 14),
                _activityCard(),
                const SizedBox(height: 14),
                _approvalsCard(),
                const SizedBox(height: 14),
                _agentsCard(),
                const SizedBox(height: 14),
                _summaryCard(),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _rootCard() {
    final project = widget.project;
    return SectionCard(
      label: 'ROOT',
      trailing: ValueChip(
        project.rootMissing ? 'missing' : 'registered',
        tone: project.rootMissing
            ? LockedInColors.warning
            : LockedInColors.muted,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                project.rootMissing
                    ? Icons.folder_off_outlined
                    : Icons.folder_outlined,
                size: 15,
                color: project.rootMissing
                    ? LockedInColors.warning
                    : LockedInColors.muted,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  project.root.isEmpty ? 'no folder recorded' : project.root,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: project.rootMissing
                        ? LockedInColors.warning
                        : LockedInColors.foreground,
                    fontSize: TypeScale.body,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
          ),
          if (project.rootMissing) ...[
            const SizedBox(height: 10),
            _EmptyNote(
              tone: LockedInColors.warning,
              title: 'the project folder is missing',
              body:
                  'The metadata still opens. Restore the folder at this path, '
                  'or register a new project. LockedIn never moves or deletes '
                  'your files.',
            ),
          ],
        ],
      ),
    );
  }

  Widget _changesCard() {
    final changes = widget.changes;
    final loading = widget.changesLoading;
    final error = widget.changesError;
    final refresh = widget.onRefreshChanges;
    return SectionCard(
      label: 'CHANGES',
      trailing: const ValueChip('read-only summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (loading) ...[
            Text(
              'reading changes…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (error != null) ...[
            _ErrorState(message: error, onRefresh: refresh),
            const SizedBox(height: 10),
          ],
          if (changes != null && changes.available)
            _availableChanges(changes)
          else if (changes != null)
            _unavailableChanges(changes)
          else if (error == null && !loading)
            _EmptyNote(
              tone: LockedInColors.muted,
              title: 'the working tree has not been read yet',
              body:
                  'g or r reads this project’s git status and diff summary. '
                  'This is a read-only summary: nothing is staged, committed '
                  'or written.',
            ),
          const SizedBox(height: 10),
          if (refresh != null) ...[
            Text(
              'g or r refresh',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.micro,
              ),
            ),
            const SizedBox(height: 4),
          ],
          Text(
            'read-only summary · approve writes in Approvals (p)',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _availableChanges(ChangeSummary changes) {
    final files = changes.files;
    final branch = changes.branch.trim();
    final headline = branch.isEmpty
        ? (changes.detached ? 'detached head' : 'no branch recorded')
        : branch;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Icon(
              Icons.account_tree_outlined,
              size: 14,
              color: LockedInColors.muted,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                headline,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.key,
                  fontFamily: 'monospace',
                ),
              ),
            ),
            if (changes.detached) ...[
              const SizedBox(width: 8),
              ValueChip('detached', tone: LockedInColors.warning),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            ValueChip(
              changes.dirty ? 'dirty' : 'clean',
              tone: changes.dirty
                  ? LockedInColors.warning
                  : LockedInColors.success,
            ),
            ValueChip(
              changes.staged == 1 ? '1 staged' : '${changes.staged} staged',
            ),
            ValueChip(
              changes.unstaged == 1
                  ? '1 unstaged'
                  : '${changes.unstaged} unstaged',
            ),
            ValueChip(files.length == 1 ? '1 file' : '${files.length} files'),
          ],
        ),
        const SizedBox(height: 10),
        if (files.isEmpty)
          Text(
            'the working tree has no changed files',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          )
        else
          _changeFileList(files),
      ],
    );
  }

  Widget _approvalsCard() {
    final approvals = widget.approvals ?? WorkApprovals.empty;
    final writes = approvals.writes;
    final commands = approvals.commands;
    final total = approvals.total;
    final canOpen = widget.onOpenApprovals != null;
    final error = widget.approvalsError;
    return SectionCard(
      label: 'APPROVALS',
      trailing: ValueChip(
        total == 0 ? 'none pending' : '$total pending',
        tone: total == 0 ? LockedInColors.muted : LockedInColors.warning,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.approvalsLoading) ...[
            Text(
              'reading approvals…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (error != null) ...[
            _ErrorState(message: error),
            const SizedBox(height: 10),
          ],
          if (total == 0 && !widget.approvalsLoading && error == null)
            _EmptyNote(
              tone: LockedInColors.muted,
              title: 'no approvals pending',
              body:
                  'A write or command an agent proposes waits here until you '
                  'decide. Nothing is written or run without a decision.',
            )
          else ...[
            for (final write in writes.take(3))
              _pendingRow(
                glyph: '+',
                tone: LockedInColors.warning,
                label: write.path.isEmpty ? '(unnamed file)' : write.path,
                detail: _writeSummary(write),
              ),
            for (final command in commands.take(3))
              _pendingRow(
                glyph: '!',
                tone: LockedInColors.error,
                label: command.argv.isEmpty
                    ? '(empty command)'
                    : command.argv.join(' '),
                detail: command.cwd.isEmpty
                    ? 'command'
                    : 'command · cwd ${command.cwd}',
              ),
            if (total > 6) ...[
              const SizedBox(height: 4),
              Text(
                'and ${total - 6} more',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.micro,
                ),
              ),
            ],
            if (canOpen) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  key: const ValueKey('work-open-approvals'),
                  onPressed: widget.onOpenApprovals,
                  icon: const Icon(Icons.fact_check_outlined, size: 16),
                  label: const Text('Review approvals'),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'p opens the pending writes and commands',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.micro,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _pendingRow({
    required String glyph,
    required Color tone,
    required String label,
    required String detail,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 14,
            child: Text(
              glyph,
              style: TextStyle(
                color: tone,
                fontSize: TypeScale.key,
                fontWeight: FontWeight.w700,
                fontFamily: 'monospace',
              ),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.label,
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  detail,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _unavailableChanges(ChangeSummary changes) {
    final message = changes.message.trim();
    final reason = changes.reason.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.remove_circle_outline,
              size: 14,
              color: LockedInColors.muted,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                message.isEmpty
                    ? 'the working tree could not be read'
                    : message,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ),
        if (reason.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            'reason · $reason',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
            ),
          ),
        ],
      ],
    );
  }

  /// The changed files. A long list scrolls inside a bounded box so the card
  /// stays usable at 800×600 instead of pushing the rest of the detail away.
  Widget _changeFileList(List<ChangeFile> files) {
    final rows = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [for (final file in files) _changeFileRow(file)],
    );
    if (files.length <= 6) return rows;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 260),
      child: SingleChildScrollView(child: rows),
    );
  }

  Widget _changeFileRow(ChangeFile file) {
    final status = _changeStatus(file.status);
    final where = <String>[
      if (file.staged) 'staged',
      if (file.unstaged) 'unstaged',
    ];
    // A list row, not a card: one hairline under it, no fill.
    return Container(
      margin: const EdgeInsets.only(bottom: Space.hair),
      padding: const EdgeInsets.fromLTRB(
        Space.xs,
        Space.xs - 1,
        Space.xs,
        Space.xs - 1,
      ),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: LockedInColors.line,
            width: Stroke.hairline,
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 16,
            child: Text(
              status.glyph,
              style: TextStyle(
                color: status.tone,
                fontSize: TypeScale.body,
                fontWeight: FontWeight.w700,
                fontFamily: 'monospace',
              ),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  file.path.isEmpty ? '(unnamed file)' : file.path,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.key,
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(height: 3),
                Wrap(
                  spacing: 8,
                  runSpacing: 2,
                  children: [
                    Text(
                      status.label,
                      style: TextStyle(
                        color: status.tone,
                        fontSize: TypeScale.micro,
                      ),
                    ),
                    if (file.added > 0)
                      Text(
                        '+${file.added}',
                        style: TextStyle(
                          color: LockedInColors.success,
                          fontSize: TypeScale.micro,
                        ),
                      ),
                    if (file.removed > 0)
                      Text(
                        '-${file.removed}',
                        style: TextStyle(
                          color: LockedInColors.error,
                          fontSize: TypeScale.micro,
                        ),
                      ),
                    if (where.isNotEmpty)
                      Text(
                        where.join(' · '),
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.micro,
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _instructionsCard() {
    final instructions = widget.project.instructions.trim();
    final editable = widget.onSaveInstructions != null;
    return SectionCard(
      label: 'INSTRUCTIONS',
      trailing: editable
          ? TextButton(
              key: const ValueKey('work-edit-instructions'),
              onPressed: () => unawaited(_editInstructions()),
              child: const Text('edit'),
            )
          : null,
      child: instructions.isEmpty
          ? _EmptyNote(
              tone: LockedInColors.muted,
              title: 'no project instructions yet',
              body:
                  'Each agent uses its own instructions. Open an agent with '
                  'Enter to edit its prompt.',
            )
          : Text(
              instructions,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.proseSmall,
                height: 1.5,
              ),
            ),
    );
  }

  /// Edit the project's standing instructions.
  ///
  /// The value lives in `work/projects/<id>/meta.json`; nothing inside the
  /// registered folder is touched. A refusal stays in the dialog with the
  /// core's own sentence and keeps the previous text.
  Future<void> _editInstructions() async {
    final save = widget.onSaveInstructions;
    if (save == null) return;
    await showDialog<void>(
      context: context,
      builder: (_) => _InstructionsEditor(
        initial: widget.project.instructions,
        onSave: save,
      ),
    );
  }

  Widget _chatCard() {
    final canOpen = widget.onOpenChat != null;
    final count = widget.chatCount;
    final latest = widget.latestChatId;
    return SectionCard(
      label: 'CHAT',
      trailing: ValueChip(count == 1 ? '1 chat' : '$count chats'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'A project chat sees only the files inside this project’s folder. '
            'The tools are read-only by default; nothing is written until you '
            'approve it.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          if (latest != null && latest.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'latest · $latest',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                fontFamily: 'monospace',
              ),
            ),
          ],
          if (canOpen) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                key: const ValueKey('work-open-chat'),
                onPressed: widget.onOpenChat,
                icon: const Icon(Icons.forum_outlined, size: 16),
                label: Text(
                  latest == null || latest.isEmpty ? 'Start chat' : 'Open chat',
                ),
              ),
            ),
            if (latest == null || latest.isEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'This project has no chats yet. Starting one writes a new '
                'transcript under the project metadata.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.micro,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _swarmCard() {
    final runs = widget.swarmRuns;
    final newest = runs.isEmpty ? null : runs.last;
    final canOpen = widget.onOpenSwarm != null;
    final error = widget.swarmError;
    final status = newest == null
        ? null
        : swarmStatusStyle(newest.isRunning ? 'running' : newest.status);
    return SectionCard(
      label: 'SWARM',
      trailing: ValueChip(
        runs.isEmpty
            ? 'no runs'
            : runs.length == 1
            ? '1 run'
            : '${runs.length} runs',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.swarmLoading) ...[
            Text(
              'reading swarm runs…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (error != null) ...[
            _ErrorState(message: error),
            const SizedBox(height: 10),
          ],
          Text(
            'A swarm is a coordinator’s plan of independent tasks. Each task '
            'runs in its own read-only worker: it can read the project and can '
            'never write a file or run a command.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          if (newest != null && status != null) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Text(
                    newest.objective.isEmpty
                        ? 'newest run · ${newest.runId}'
                        : newest.objective,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.foreground,
                      fontSize: TypeScale.key,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ValueChip(
                  swarmStatusText(newest.isRunning ? 'running' : newest.status),
                  tone: status.tone,
                ),
              ],
            ),
          ] else if (!widget.swarmLoading) ...[
            const SizedBox(height: 8),
            Text(
              'no swarm runs yet · w opens the board',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
          if (canOpen) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                key: const ValueKey('work-open-swarm'),
                onPressed: widget.onOpenSwarm,
                icon: const Icon(Icons.hub_outlined, size: 16),
                label: const Text('Open swarm'),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'w opens the swarm board',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.micro,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// The count of decisions the core already recorded for this project.
  ///
  /// It is a read-only card: the log records what was approved, denied or run,
  /// and never a file body, a prompt or a command's output. `l` opens the log.
  Widget _activityCard() {
    final count = widget.activityCount;
    final canOpen = widget.onOpenActivity != null;
    final error = widget.activityError;
    return SectionCard(
      label: 'ACTIVITY',
      trailing: ValueChip(
        // The log is read with a filter and a page cap, so this is the number
        // of rows the card can open, not the project's total.
        count == 0 ? 'no records' : '$count shown',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (widget.activityLoading) ...[
            Text(
              'reading activity…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
            const SizedBox(height: 8),
          ],
          if (error != null) ...[
            _ErrorState(message: error),
            const SizedBox(height: 10),
          ],
          Text(
            'Every write approval, command decision and swarm run is recorded '
            'here. The log is metadata only: no file bodies, no prompts and no '
            'output.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          if (canOpen) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                key: const ValueKey('work-open-activity'),
                onPressed: widget.onOpenActivity,
                icon: const Icon(Icons.history_outlined, size: 16),
                label: const Text('Open activity log'),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'l opens the log',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.micro,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _agentsCard() {
    final agents = _agents;
    final editable = _canEditAgents;
    return SectionCard(
      label: 'AGENTS',
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_savingAgent) ...[
            ValueChip('saving…', tone: LockedInColors.warning),
            const SizedBox(width: 6),
          ],
          ValueChip(agents.length == 1 ? '1 agent' : '${agents.length} agents'),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_agentError != null) ...[
            _ErrorState(message: _agentError!),
            const SizedBox(height: 10),
          ],
          if (agents.isEmpty) ...[
            _EmptyNote(
              tone: LockedInColors.muted,
              title: 'no agents yet',
              body: editable
                  ? 'A chat project otherwise uses the core default profile.'
                  : 'A chat project uses the core default profile.',
            ),
            if (editable) ...[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  key: const ValueKey('work-agent-add'),
                  onPressed: _savingAgent ? null : _createAgent,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('add agent'),
                ),
              ),
            ],
          ] else
            for (var index = 0; index < agents.length; index++)
              _agentRow(agents[index], index, editable: editable),
          if (editable) ...[
            const SizedBox(height: 10),
            // `Wrap`, not `Row`: at 800 px the hint and the button together
            // are wider than the card, and a `Spacer` cannot shrink text.
            Wrap(
              spacing: 10,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  'a new · Enter edit · d delete · m default',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
                  ),
                ),
                TextButton.icon(
                  key: const ValueKey('work-agent-add-inline'),
                  onPressed: _savingAgent ? null : _createAgent,
                  icon: const Icon(Icons.add, size: 15),
                  // Not "new agent": that is the editor dialog's title, and
                  // two widgets with one label make a test tap ambiguous.
                  label: const Text('add'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _agentRow(
    AgentProfileView agent,
    int index, {
    required bool editable,
  }) {
    final isDefault = widget.project.defaultAgent == agent.id;
    final isSelected = editable && index == _selected;
    final model = agent.model.trim();
    final role = agent.role.trim();
    final template = agent.template.trim();
    final tools = agent.allowedTools.length;
    return Padding(
      key: _agentKey(agent.id),
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: isSelected ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.control),
        child: InkWell(
          key: ValueKey('work-agent-${agent.id}'),
          borderRadius: BorderRadius.circular(Radii.control),
          // A click is Enter: select the agent and open its editor.
          onTap: editable
              ? () {
                  _selectAgent(index);
                  if (widget.onSaveAgent != null) _editAgent();
                }
              : null,
          child: Container(
            key: isSelected ? _selectedAgentKey : null,
            padding: const EdgeInsets.fromLTRB(
              Space.xs,
              Space.xs,
              Space.xs,
              Space.xs,
            ),
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(
                  color: isSelected
                      ? LockedInColors.primary
                      : LockedInColors.line,
                  width: isSelected ? Stroke.focus : Stroke.hairline,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.person_outline,
                      size: 15,
                      color: LockedInColors.muted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        agent.name.isEmpty ? 'unnamed agent' : agent.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    if (isDefault) ...[
                      const SizedBox(width: 8),
                      ValueChip('default', tone: LockedInColors.primary),
                    ],
                  ],
                ),
                const SizedBox(height: 7),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    ValueChip(
                      agent.readOnly ? 'read-only' : 'write',
                      tone: agent.readOnly
                          ? LockedInColors.success
                          : LockedInColors.warning,
                    ),
                    ValueChip(
                      agent.allowCommand ? 'command' : 'no command',
                      tone: agent.allowCommand
                          ? LockedInColors.warning
                          : LockedInColors.muted,
                    ),
                  ],
                ),
                if (agent.instructions.trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    agent.instructions.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.45,
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  [
                    if (role.isNotEmpty) 'role: $role',
                    model.isEmpty ? 'model: project default' : 'model: $model',
                    '${agent.maxToolCalls} tool calls',
                    tools == 0 ? 'no tools listed' : '$tools tools',
                    if (template.isNotEmpty) 'template: $template',
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.micro,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _summaryCard() {
    final project = widget.project;
    return SectionCard(
      label: 'SUMMARY',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _summaryRow('mode', project.mode.isEmpty ? 'chat' : project.mode),
          if (project.swarmName.trim().isNotEmpty)
            _summaryRow('swarm', project.swarmName),
          _summaryRow('tasks', '${project.tasks}'),
          _summaryRow(
            'git',
            project.hasGit ? 'repository present' : 'no repository',
          ),
          _summaryRow('last opened', _openedLabel(project.lastOpened)),
        ],
      ),
    );
  }

  Widget _summaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.key,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _subtitle(WorkProjectDetail project) {
  final mode = project.mode.isEmpty ? 'chat' : project.mode;
  final agents = project.agents.length;
  final label = agents == 1 ? 'agent' : 'agents';
  final swarm = project.swarmName.trim();
  final name = swarm.isEmpty ? mode : '$mode · $swarm';
  return '$name · $agents $label · ${_openedLabel(project.lastOpened)}';
}

String _openedLabel(String value) {
  if (value.isEmpty) return 'not opened yet';
  final stamp = value.replaceFirst('T', ' ');
  final cut = stamp.length > 16 ? stamp.substring(0, 16) : stamp;
  return 'opened $cut';
}

/// One pending write as a single line: its kind and summed line counts.
String _writeSummary(WorkWriteProposal write) {
  final kind = write.kind.isEmpty ? 'change' : write.kind;
  final added = write.stats.added;
  final removed = write.stats.removed;
  final counts = [if (added > 0) '+$added', if (removed > 0) '-$removed'];
  return counts.isEmpty ? kind : '$kind · ${counts.join(' ')}';
}

/// The glyph, colour and word for one `work.changes` file status.
///
/// The word is always shown beside the glyph, so a status is never carried by
/// colour alone (`docs/design.md` §3.1).
({String glyph, Color tone, String label}) _changeStatus(String status) {
  return switch (status) {
    'added' => (glyph: '+', tone: LockedInColors.success, label: 'added'),
    'modified' => (glyph: '~', tone: LockedInColors.warning, label: 'modified'),
    'deleted' => (glyph: '-', tone: LockedInColors.error, label: 'deleted'),
    'renamed' => (glyph: '→', tone: LockedInColors.secondary, label: 'renamed'),
    'copied' => (glyph: '⧉', tone: LockedInColors.secondary, label: 'copied'),
    'typechange' => (
      glyph: 'T',
      tone: LockedInColors.warning,
      label: 'typechange',
    ),
    'untracked' => (glyph: '?', tone: LockedInColors.muted, label: 'untracked'),
    'conflicted' => (
      glyph: '!',
      tone: LockedInColors.error,
      label: 'conflicted',
    ),
    _ => (
      glyph: '•',
      tone: LockedInColors.muted,
      label: status.isEmpty ? 'changed' : status,
    ),
  };
}

/// Remove a project's registration, never its files.
