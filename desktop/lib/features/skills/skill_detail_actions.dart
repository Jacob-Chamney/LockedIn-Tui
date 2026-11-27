part of 'skill_detail.dart';

/// Source and stage actions: pick files, add sources, and the stage editor.
extension _SkillDetailActions on _SkillDetailViewState {
  /// dialog, so the action is never dead and the shell still never reads a file.
  Future<List<String>> _defaultPickFiles() async {
    try {
      final files = await openFiles();
      return [
        for (final file in files)
          if (file.path.trim().isNotEmpty) file.path,
      ];
    } on MissingPluginException {
      if (!mounted) return const [];
      return _askForPaths();
    } on UnimplementedError {
      if (!mounted) return const [];
      return _askForPaths();
    }
  }

  Future<List<String>> _askForPaths() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('add a source file'),
        content: SizedBox(
          width: 480,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'This build has no native file dialog. Paste the absolute path '
                'of a file a lesson or chat may cite; the core copies it into '
                'this goal and the original is never moved.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const ValueKey('skill-sources-path-field'),
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: '/home/you/notes/intel-sdm.md',
                ),
                onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const ValueKey('skill-sources-path-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null) return const [];
    return [
      for (final line in text.split('\n'))
        if (line.trim().isNotEmpty) line.trim(),
    ];
  }

  Future<void> _addSources() async {
    final onAdd = widget.onAddSources;
    if (onAdd == null || _sourcesBusy) return;
    final pick = widget.pickFiles ?? _defaultPickFiles;

    final List<String> paths;
    try {
      paths = await pick();
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _sourcesNotice = null;
        _sourcesFailure = userMessage(failure);
      });
      return;
    }
    if (paths.isEmpty || !mounted) return;

    refresh(() {
      _sourcesBusy = true;
      _sourcesNotice = null;
      _sourcesFailure = null;
    });
    try {
      final result = await onAdd(paths);
      if (!mounted) return;
      refresh(() {
        _sourcesBusy = false;
        _sourcesNotice = _sourceFeedback(result);
      });
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _sourcesBusy = false;
        _sourcesFailure = userMessage(failure);
      });
    }
  }

  /// The core's counts are the answer: never a local guess at what was stored.
  String _sourceFeedback(SourceAddResult result) {
    if (result.added > 0) {
      return 'added ${result.added} · skipped ${result.skipped}';
    }
    if (result.skipped > 0) return 'already gathered';
    return 'nothing added';
  }

  GlobalKey _chapterKey(String id) => _chapterKeys.putIfAbsent(
    id,
    () => GlobalKey(debugLabel: 'skill-chapter-$id'),
  );

  GlobalKey _stageKey(String id) => _stageKeys.putIfAbsent(
    id,
    () => GlobalKey(debugLabel: 'skill-stage-$id'),
  );

  void _move(int delta) {
    if (_chapters.length < 2) return;
    final current = _selected;
    final next = (current + delta).clamp(0, _chapters.length - 1);
    if (next == current) return;
    refresh(() {
      _selectedChapter = next;
      _notice = null;
    });
    final id = _chapters[next].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _chapterKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  void _moveStage(int delta) {
    if (_stages.length < 2) return;
    final current = _stageIndex;
    final next = (current + delta).clamp(0, _stages.length - 1);
    if (next == current) return;
    refresh(() {
      _selectedStage = next;
      _notice = null;
    });
    final id = _stages[next].id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _stageKeys[id]?.currentContext;
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: const Duration(milliseconds: 120),
        curve: Curves.easeOut,
      );
    });
  }

  /// Open the selected stage's lesson. A stage with no lesson opens the reader's
  /// empty state, which offers the build, so the key is never dead.
  void _openStage() {
    final open = widget.onOpenStage;
    final stage = _selectedStageRow;
    if (open == null || stage == null) return;
    refresh(() => _notice = null);
    open(stage.id);
  }

  /// Build the selected stage's lesson as a draft.
  void _buildStage() {
    final build = widget.onBuildStage;
    final stage = _selectedStageRow;
    if (build == null || stage == null) return;
    refresh(() => _notice = null);
    build(stage.id);
  }

  /// Enter the curriculum editor. Read-only when the store has no writer.
  void _enterStageEdit() {
    if (widget.onSaveStages == null) return;
    refresh(() {
      _editingStages = true;
      _stagesFailure = null;
      _notice = null;
    });
  }

  /// Leave the curriculum editor. The stored curriculum stays on screen.
  void _leaveStageEdit() {
    if (!_editingStages) return;
    refresh(() {
      _editingStages = false;
      _stagesFailure = null;
    });
  }

  /// Send the whole list in order and adopt the core's reply.
  ///
  /// Nothing is applied locally before the core answers, so a refusal keeps the
  /// previous order and shows the core's own sentence. [cursor] moves the
  /// selection to the stage the edit acted on.
  Future<void> _saveStages(
    List<SkillStage> next, {
    bool confirmed = false,
    int? cursor,
  }) async {
    final save = widget.onSaveStages;
    if (save == null || _stagesBusy) return;
    refresh(() {
      _stagesBusy = true;
      _stagesFailure = null;
    });
    try {
      final result = await save(next, confirmed: confirmed);
      if (!mounted) return;
      refresh(() {
        _stagesBusy = false;
        _stageEdit = result.stages;
        final last = result.stages.isEmpty ? 0 : result.stages.length - 1;
        _selectedStage = (cursor ?? _selectedStage).clamp(0, last);
      });
    } catch (failure) {
      if (!mounted) return;
      refresh(() {
        _stagesBusy = false;
        _stagesFailure = userMessage(failure);
      });
    }
  }

  /// Add one stage at the end with a small title/milestone prompt.
  Future<void> _addStage() async {
    if (widget.onSaveStages == null || _stagesBusy) return;
    final value = await _askStage(
      dialogTitle: 'add a stage',
      confirmLabel: 'Add',
      fieldKeyPrefix: 'skill-stage-add',
    );
    if (value == null || !mounted) return;
    final next = [
      ..._stages,
      SkillStage(
        // An empty id asks the core to assign one; the reply names it.
        id: '',
        title: value.title,
        status: 'pending',
        milestone: value.milestone,
      ),
    ];
    await _saveStages(next, cursor: next.length - 1);
  }

  /// Rename the selected stage, keeping its id and status.
  Future<void> _renameStage() async {
    final index = _stageIndex;
    if (widget.onSaveStages == null || _stagesBusy || index < 0) return;
    final stage = _stages[index];
    final value = await _askStage(
      dialogTitle: 'rename stage',
      confirmLabel: 'Rename',
      fieldKeyPrefix: 'skill-stage-rename',
      initialTitle: stage.title,
      initialMilestone: stage.milestone ?? '',
    );
    if (value == null || !mounted) return;
    final next = [..._stages];
    next[index] = SkillStage(
      id: stage.id,
      title: value.title,
      status: stage.status,
      milestone: value.milestone,
    );
    await _saveStages(next);
  }

  /// Remove the selected stage after a named confirmation.
  ///
  /// Removing a `done` stage loses its finished progress, so the confirmation
  /// says so and the save carries `confirmed: true`; the core refuses that
  /// removal otherwise.
  Future<void> _removeStage() async {
    final index = _stageIndex;
    if (widget.onSaveStages == null || _stagesBusy || index < 0) return;
    final stage = _stages[index];
    final confirmed = await confirmSkillStageRemove(
      context,
      title: stage.title.isEmpty ? 'untitled stage' : stage.title,
      done: stage.done,
    );
    if (!confirmed || !mounted) return;
    final next = [..._stages]..removeAt(index);
    await _saveStages(
      next,
      confirmed: stage.done,
      cursor: index >= next.length ? next.length - 1 : index,
    );
  }

  /// Move the selected stage one place up (-1) or down (1).
  Future<void> _moveStageOrder(int delta) async {
    final index = _stageIndex;
    if (widget.onSaveStages == null || _stagesBusy || index < 0) return;
    final target = index + delta;
    if (target < 0 || target >= _stages.length) return;
    final next = [..._stages];
    final moved = next.removeAt(index);
    next.insert(target, moved);
    await _saveStages(next, cursor: target);
  }
}
