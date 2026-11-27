part of 'skill_detail.dart';

extension _SkillMaterialCards on _SkillDetailViewState {
  Widget _sourcesCard() {
    final sources = widget.sources;
    final interactive = widget.onAddSources != null;
    return SectionCard(
      label: 'SOURCES',
      trailing: ValueChip(
        sources.length == 1 ? '1 source' : '${sources.length} sources',
        tone: sources.isEmpty ? LockedInColors.muted : LockedInColors.secondary,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Lessons and this goal’s chat may cite only the files gathered '
            'here. The core keeps one copy per source inside the goal folder.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          if (sources.isEmpty &&
              !widget.sourcesLoading &&
              widget.sourcesError == null)
            EmptyNote(
              tone: interactive ? LockedInColors.warning : LockedInColors.muted,
              title: 'no sources yet',
              body: 'add sources so lessons and chat can cite them',
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < sources.length; index++) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      color: LockedInColors.line,
                    ),
                  _skillSourceRow(sources[index]),
                ],
              ],
            ),
          if (widget.sourcesError != null) ...[
            const SizedBox(height: 10),
            ErrorBanner(
              message: widget.sourcesError!,
              onRetry: widget.onRetrySources,
            ),
          ],
          if (widget.sourcesLoading) ...[
            const SizedBox(height: 10),
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          ],
          if (interactive) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                FilledButton.icon(
                  key: const ValueKey('skill-sources-add'),
                  onPressed: _sourcesBusy ? null : _addSources,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('add sources'),
                ),
                const SizedBox(width: 12),
                Text(
                  'a add sources',
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// One gathered source: name, kind and the saved excerpt it can be cited by.
  ///
  /// The row never shows an original path: a skill source is the goal's own
  /// copy, and [SkillSourceRow.storedPath] is relative to that folder.
  Widget _skillSourceRow(SkillSourceRow source) {
    final excerpt = source.excerpt;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            skillSourceIcon(source.kind),
            size: 15,
            color: LockedInColors.muted,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        source.name.isEmpty ? 'unnamed source' : source.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ValueChip(source.kind.isEmpty ? 'file' : source.kind),
                  ],
                ),
                if (excerpt != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    excerpt,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                      height: 1.4,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The curriculum stages of a goal that has them. Each row is one stage with
  /// its status and milestone; the selected row is what `Enter`/`l` opens and
  /// `b` builds. `e` turns the list into an editor: the cursor moves with `j/k`,
  /// `a`/`r`/`d` add, rename and remove, and `J`/`K` (or shifted arrows) reorder.
  ///
  /// Every edit sends the whole list in order, so the core always stores one
  /// curriculum and the reply is what the card shows next.
  Widget _stagesCard() {
    final stages = _stages;
    final done = stages.where((stage) => stage.done).length;
    final interactive = widget.onOpenStage != null;
    final editable = widget.onSaveStages != null;
    final selected = _stageIndex;
    return SectionCard(
      label: 'CURRICULUM STAGES',
      trailing: ValueChip(
        _editingStages
            ? 'editing'
            : stages.isEmpty
            ? 'no stages'
            : '$done/${stages.length} stages',
        tone: _editingStages
            ? LockedInColors.primary
            : stages.isNotEmpty && done == stages.length
            ? LockedInColors.success
            : LockedInColors.muted,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'A lesson is built one stage at a time from this goal’s gathered '
            'sources. An unsourced claim is labelled as an agent explanation.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          if (stages.isEmpty)
            EmptyNote(
              tone: LockedInColors.warning,
              title: 'no stages yet',
              body: editable
                  ? 'a adds the first stage; every change saves the whole '
                        'curriculum.'
                  : 'This goal has no curriculum stages.',
            )
          else
            for (var index = 0; index < stages.length; index++)
              _stageRow(
                stages[index],
                index,
                selected: (_editingStages || interactive) && index == selected,
              ),
          if (_stagesFailure != null) ...[
            const SizedBox(height: 10),
            ErrorBanner(message: _stagesFailure!),
          ],
          if (_stagesBusy) ...[
            const SizedBox(height: 10),
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          ],
          // The pointer path for `b`: build the selected stage's lesson.
          if (!_editingStages &&
              interactive &&
              widget.onBuildStage != null &&
              _selectedStageRow != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                key: const ValueKey('skill-build-lesson'),
                onPressed: _stagesBusy ? null : _buildStage,
                icon: const Icon(Icons.auto_stories_outlined, size: 15),
                label: const Text('build lesson'),
              ),
            ),
          ],
          if (stages.isNotEmpty || _editingStages) ...[
            const SizedBox(height: 10),
            Text(
              _editingStages
                  ? [
                      'j/k move',
                      'a add',
                      'r rename',
                      'd remove',
                      if (stages.length > 1) 'J/K reorder',
                      'Enter done',
                      'Esc done',
                    ].join(' · ')
                  : [
                      if (interactive) 'j/k move',
                      if (interactive) 'Enter lesson',
                      if (interactive) 'l lesson',
                      if (widget.onBuildStage != null) 'b build',
                      if (editable) 'e edit stages',
                      'Esc back',
                    ].join(' · '),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _stageRow(SkillStage stage, int index, {required bool selected}) {
    final (tone, glyph) = switch (stage.status) {
      'done' => (LockedInColors.success, Icons.check_circle_outline),
      'active' => (LockedInColors.primary, Icons.play_circle_outline),
      _ => (LockedInColors.muted, Icons.radio_button_unchecked),
    };
    return Padding(
      key: _stageKey(stage.id),
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          key: ValueKey('skill-stage-${stage.id}'),
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: (widget.onOpenStage == null && !_editingStages)
              ? null
              : () {
                  refresh(() {
                    _selectedStage = index;
                    _notice = null;
                  });
                  // A click on a stage is Enter: open its lesson. Editing the
                  // curriculum keeps click = select so rows can be reordered.
                  if (!_editingStages) _openStage();
                },
          child: Container(
            key: selected ? _SkillDetailViewState._selectedStageKey : null,
            padding: const EdgeInsets.fromLTRB(0, 8, 10, 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(
                color: selected
                    ? LockedInColors.primary.withValues(alpha: 0.5)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 3,
                  height: 22,
                  decoration: BoxDecoration(
                    color: selected
                        ? LockedInColors.primary
                        : Colors.transparent,
                    borderRadius: const BorderRadius.horizontal(
                      right: Radius.circular(Radii.control),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(glyph, size: 16, color: tone),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        stage.title.isEmpty ? 'untitled stage' : stage.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                      if (stage.milestone != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          stage.milestone!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.micro,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                ValueChip(
                  stage.status.isEmpty ? 'pending' : stage.status,
                  tone: tone,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _courseCard() {
    final chapters = _chapters;
    final done = chapters.where((chapter) => chapter.done).length;
    final interactive = widget.onOpenChapter != null;
    final selected = _selected;
    return SectionCard(
      label: 'COURSE',
      trailing: ValueChip(
        chapters.isEmpty ? 'no chapters' : '$done/${chapters.length} chapters',
        tone: chapters.isNotEmpty && done == chapters.length
            ? LockedInColors.success
            : LockedInColors.muted,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (chapters.isEmpty)
            EmptyNote(
              tone: LockedInColors.warning,
              title: 'no chapters yet',
              body:
                  'This course has no lesson files. Rebuild the goal from the '
                  'Goals list to generate a plan; nothing is generated here.',
            )
          else
            for (var index = 0; index < chapters.length; index++)
              _chapterRow(
                chapters[index],
                index,
                selected: interactive && index == selected,
              ),
          if (chapters.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              [
                if (interactive) 'j/k move',
                if (interactive) 'Enter lesson',
                if (interactive) 'p practical',
                if (widget.onOpenChat != null) 'c chat',
                'Esc back',
              ].join(' · '),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chapterRow(
    SkillChapter chapter,
    int index, {
    required bool selected,
  }) {
    final practical = chapter.hasPractical;
    return Padding(
      key: _chapterKey(chapter.id),
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected ? LockedInColors.panel : Colors.transparent,
        borderRadius: BorderRadius.circular(Radii.layer),
        child: InkWell(
          borderRadius: BorderRadius.circular(Radii.layer),
          onTap: widget.onOpenChapter == null
              ? null
              : () {
                  refresh(() {
                    _selectedChapter = index;
                    _notice = null;
                  });
                  _openChapter();
                },
          child: Container(
            key: selected ? _SkillDetailViewState._selectedChapterKey : null,
            padding: const EdgeInsets.fromLTRB(0, 8, 10, 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(
                color: selected
                    ? LockedInColors.primary.withValues(alpha: 0.5)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 3,
                  height: 22,
                  decoration: BoxDecoration(
                    color: selected
                        ? LockedInColors.primary
                        : Colors.transparent,
                    borderRadius: const BorderRadius.horizontal(
                      right: Radius.circular(Radii.control),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  chapter.done
                      ? Icons.check_circle_outline
                      : Icons.radio_button_unchecked,
                  size: 16,
                  color: chapter.done
                      ? LockedInColors.success
                      : LockedInColors.muted,
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        chapter.title.isEmpty
                            ? 'untitled chapter'
                            : chapter.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: LockedInColors.foreground,
                          fontSize: TypeScale.body,
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                      ),
                      if (chapter.guide.trim().isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          chapter.guide,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.micro,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (chapter.done) ...[
                  const SizedBox(width: 8),
                  ValueChip('done', tone: LockedInColors.success),
                ],
                if (practical) ...[
                  const SizedBox(width: 8),
                  const ValueChip('practical'),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _chatsCard() {
    final chats = widget.chats ?? widget.detail.chats;
    final canOpen = widget.onOpenChat != null;
    return SectionCard(
      label: 'CHATS',
      trailing: ValueChip(
        chats.length == 1 ? '1 chat' : '${chats.length} chats',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'A goal chat sees only this goal’s gathered sources. Facts come '
            'from them or are labelled as an agent explanation.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          if (chats.isEmpty)
            EmptyNote(
              tone: LockedInColors.muted,
              title: 'no chats yet',
              body: canOpen
                  ? 'c starts one grounded in this goal’s sources.'
                  : 'Saved transcripts in the goal folder are listed here.',
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < chats.length; index++) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      color: LockedInColors.line,
                    ),
                  _chatRow(chats[index]),
                ],
              ],
            ),
          if (canOpen) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  FilledButton.icon(
                    key: const ValueKey('skill-open-chat-card'),
                    onPressed: widget.onOpenChat,
                    icon: const Icon(Icons.forum_outlined, size: 16),
                    label: Text(chats.isEmpty ? 'Start chat' : 'Open chat'),
                  ),
                  if (chats.isNotEmpty && widget.onNewChat != null) ...[
                    const SizedBox(width: 10),
                    OutlinedButton.icon(
                      key: const ValueKey('skill-new-chat-card'),
                      onPressed: widget.onNewChat,
                      icon: const Icon(Icons.add_comment_outlined, size: 16),
                      label: const Text('New chat · Shift+N'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chatRow(SkillChatRow chat) {
    final used = _usedLabel(chat.lastUsed);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Icon(Icons.forum_outlined, size: 15, color: LockedInColors.muted),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              chat.title.isEmpty ? chat.id : chat.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.body,
              ),
            ),
          ),
          if (used.isNotEmpty) ...[
            const SizedBox(width: 10),
            Text(
              used,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.micro,
              ),
            ),
          ],
          const SizedBox(width: 10),
          Text(
            chat.messages == 1 ? '1 message' : '${chat.messages} messages',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
            ),
          ),
        ],
      ),
    );
  }
}
