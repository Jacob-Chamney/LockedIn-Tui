part of 'skill_detail.dart';

/// The teaching, practice and research cards of one goal.
///
/// They read the page's own signals and callbacks, so they stay an extension on
/// its state rather than a second copy of it.
extension _SkillCards on _SkillDetailViewState {
  /// Run one research brief and list the saved ones.
  ///
  /// The question and its sources are typed here; the core fetches, asks for a
  /// cited paragraph and stores it. A saved brief opens in place, so reading it
  /// never loses the lesson.
  Widget _researchCard() {
    final canRun = widget.onResearch != null;
    return SectionCard(
      label: 'RESEARCH',
      trailing: widget.researchRunning
          ? const ValueChip('researching…')
          : widget.research.isEmpty
          ? null
          : ValueChip(
              '${widget.research.length} brief${widget.research.length == 1 ? '' : 's'}',
            ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Ask one question the lesson cannot answer, and name the pages the '
            'answer should come from. The brief cites them.',
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.muted,
            ),
          ),
          const SizedBox(height: Space.sm),
          TextField(
            key: const ValueKey('research-question'),
            controller: _researchQuestion,
            enabled: canRun,
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.foreground,
            ),
            decoration: const InputDecoration(
              hintText: 'what do you need to look up?',
            ),
          ),
          const SizedBox(height: Space.xs),
          TextField(
            key: const ValueKey('research-sources'),
            controller: _researchSources,
            enabled: canRun,
            minLines: 1,
            maxLines: 3,
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.foreground,
            ),
            decoration: const InputDecoration(
              hintText: 'https://… one source per line',
            ),
          ),
          if (_researchNotice != null) ...[
            const SizedBox(height: Space.xxs),
            Text(
              _researchNotice!,
              key: const ValueKey('research-notice'),
              style: LockedInType.label.copyWith(color: LockedInColors.warning),
            ),
          ],
          if (widget.researchError != null) ...[
            const SizedBox(height: Space.xxs),
            Text(
              widget.researchError!,
              key: const ValueKey('research-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
          ],
          const SizedBox(height: Space.xs),
          Align(
            alignment: Alignment.centerLeft,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                FilledButton(
                  key: const ValueKey('research-run'),
                  onPressed: !canRun || widget.researchRunning
                      ? null
                      : _runResearch,
                  style: FilledButton.styleFrom(
                    backgroundColor: LockedInColors.primary,
                    foregroundColor: Theme.of(context).colorScheme.onPrimary,
                  ),
                  child: Text(
                    widget.researchRunning ? 'researching…' : 'research this',
                  ),
                ),
                // A running brief is a long fetch and a model call; a spinner
                // with no way out is a dead end (`docs/design.md` §8).
                if (widget.researchRunning &&
                    widget.onCancelResearch != null) ...[
                  const SizedBox(width: Space.xs),
                  OutlinedButton(
                    key: const ValueKey('research-cancel'),
                    onPressed: widget.onCancelResearch,
                    child: const Text('Cancel'),
                  ),
                ],
              ],
            ),
          ),
          if (widget.research.isNotEmpty) ...[
            const SizedBox(height: Space.sm),
            const Rule(),
            const SizedBox(height: Space.xs),
            for (final item in widget.research)
              InkWell(
                key: ValueKey('research-item-${item.id}'),
                onTap: widget.onOpenResearch == null
                    ? null
                    : () => widget.onOpenResearch!(item.id),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: Space.xxs),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.question,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: LockedInType.body.copyWith(
                            fontSize: TypeScale.key,
                            color: item.id == widget.researchOpenId
                                ? LockedInColors.primary
                                : LockedInColors.foreground,
                          ),
                        ),
                      ),
                      Text(
                        '${item.sources.length} src',
                        style: LockedInType.micro.copyWith(
                          color: LockedInColors.muted,
                          letterSpacing: 0,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
          if (widget.researchMarkdown != null) ...[
            const SizedBox(height: Space.sm),
            Container(
              key: const ValueKey('research-brief'),
              padding: const EdgeInsets.all(Space.sm),
              decoration: BoxDecoration(
                color: LockedInColors.surface,
                border: Border.all(
                  color: LockedInColors.line,
                  width: Stroke.hairline,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Expanded(child: SectionLabel('brief')),
                      TextButton(
                        key: const ValueKey('research-close'),
                        onPressed: widget.onCloseResearch,
                        child: const Text('close'),
                      ),
                    ],
                  ),
                  ChatMarkdown(
                    text: _briefBody(widget.researchMarkdown!),
                    style: LockedInType.proseSmall.copyWith(
                      color: LockedInColors.foreground,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Strip the brief's frontmatter; the reader renders the prose only.
  String _briefBody(String markdown) {
    if (!markdown.startsWith('---')) return markdown;
    final end = markdown.indexOf('\n---', 3);
    return end == -1 ? markdown : markdown.substring(end + 4).trimLeft();
  }

  /// Send the question and every non-empty source.
  void _runResearch() {
    final run = widget.onResearch;
    if (run == null) return;
    final question = _researchQuestion.text.trim();
    final urls = _researchSources.text
        .split(RegExp(r'[\s,]+'))
        .map((url) => url.trim())
        .where((url) => url.isNotEmpty)
        .toList(growable: false);
    if (question.isEmpty || urls.isEmpty) {
      refresh(() {
        _researchNotice = 'a question and at least one https source';
      });
      return;
    }
    refresh(() => _researchNotice = null);
    run(question, urls);
    _researchQuestion.clear();
    _researchSources.clear();
  }

  Widget _teachingCard() {
    final record = widget.teaching;
    final verdict = widget.teachingVerdict;
    if (record == null || !record.measured) {
      return SectionCard(
        label: 'TEACHING LOOP',
        trailing: widget.teachingLoading ? const ValueChip('measuring…') : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Measure first. The harness asks what you already hold, then plans '
              'the shortest route to the goal — one idea per step, each checked.',
              style: LockedInType.proseSmall.copyWith(
                color: LockedInColors.muted,
              ),
            ),
            if (widget.teachingError != null) ...[
              const SizedBox(height: Space.xs),
              Text(
                widget.teachingError!,
                key: const ValueKey('teach-error'),
                style: LockedInType.label.copyWith(color: LockedInColors.error),
              ),
            ],
            const SizedBox(height: Space.sm),
            if (widget.onMeasure != null)
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton(
                  key: const ValueKey('teach-measure'),
                  onPressed: widget.teachingLoading ? null : widget.onMeasure,
                  style: FilledButton.styleFrom(
                    backgroundColor: LockedInColors.primary,
                    foregroundColor: Theme.of(context).colorScheme.onPrimary,
                  ),
                  child: Text(
                    widget.teachingLoading
                        ? 'measuring…'
                        : 'measure what I hold',
                  ),
                ),
              ),
          ],
        ),
      );
    }

    final step = record.current;
    final index = record.nextIndex;
    final done = index >= record.plan.length;
    return SectionCard(
      label: 'TEACHING LOOP',
      trailing: ValueChip('${record.passedCount}/${record.plan.length} held'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // What the measure heard. The starting point is the whole reason the
          // plan can be short, so it is shown, not summarised.
          SectionLabel('held', trailing: '${record.held.length}'),
          const SizedBox(height: Space.xxs),
          for (final item in record.held)
            _bullet(glyph: '✓', tone: LockedInColors.success, text: item),
          if (record.gaps.isNotEmpty) ...[
            const SizedBox(height: Space.xs),
            SectionLabel('still unclear'),
            const SizedBox(height: Space.xxs),
            for (final item in record.gaps)
              _bullet(glyph: '?', tone: LockedInColors.warning, text: item),
          ],
          const SizedBox(height: Space.md),
          const Rule(),
          const SizedBox(height: Space.sm),
          KeyedSubtree(
            key: _planKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionLabel(
                  'learning tree',
                  trailing:
                      '${record.passedCount} of ${record.plan.length} held',
                ),
                const SizedBox(height: Space.xxs),
                Text(
                  'Start at the top. A branch unlocks once every step it needs is held.',
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.muted,
                    letterSpacing: 0,
                  ),
                ),
                const SizedBox(height: Space.xs),
                for (final (position, entry) in record.plan.indexed)
                  PlanRow(
                    key: ValueKey('teach-plan-${entry.id}'),
                    number: position + 1,
                    title: entry.title,
                    passed: record.checks.any(
                      (check) =>
                          check.stepId == entry.id &&
                          check.verdict == 'correct',
                    ),
                    current: position == index && !done,
                    depth: record.depthOf(position),
                    needs: entry.requires.length,
                    locked: record.lockedOf(position),
                    blockedBy: record.blockersOf(position),
                    onTap:
                        widget.onOpenStep == null ||
                            record.lockedOf(position) ||
                            record.checks.any(
                              (check) =>
                                  check.stepId == entry.id &&
                                  check.verdict == 'correct',
                            )
                        ? null
                        : () => widget.onOpenStep!(entry.id),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Space.md),
          if (widget.teachingError != null) ...[
            Text(
              widget.teachingError!,
              key: const ValueKey('teach-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
            const SizedBox(height: Space.sm),
          ],
          if (done)
            Text(
              'Every step is held. Read the goal back, then practise it.',
              key: const ValueKey('teach-complete'),
              style: LockedInType.proseSmall.copyWith(
                color: LockedInColors.success,
              ),
            )
          else if (step == null)
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton(
                key: const ValueKey('teach-next-step'),
                onPressed: widget.teachingLoading ? null : widget.onNextStep,
                style: FilledButton.styleFrom(
                  backgroundColor: LockedInColors.primary,
                  foregroundColor: Theme.of(context).colorScheme.onPrimary,
                ),
                child: Text(
                  widget.teachingLoading
                      ? 'preparing…'
                      : 'teach step ${index + 1}',
                ),
              ),
            )
          else ...[
            // One idea, then one check. The prose is a paragraph, so it is Plex
            // at the reading measure, not mono.
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: Space.proseMeasure),
              child: Text(
                step.prose,
                key: const ValueKey('teach-prose'),
                style: LockedInType.prose.copyWith(
                  color: LockedInColors.foreground,
                ),
              ),
            ),
            const SizedBox(height: Space.xxs),
            // A step either quotes its source or says it is the model's own
            // explanation. There is no third, unlabelled state.
            if (step.citations.isEmpty)
              Text(
                'agent explanation',
                key: const ValueKey('teach-agent-explanation'),
                style: LockedInType.micro.copyWith(
                  color: LockedInColors.muted,
                  letterSpacing: 0,
                ),
              )
            else
              for (final citation in step.citations)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    'source · ${citation.name}: “${citation.quote}”',
                    key: ValueKey('teach-citation-${citation.name}'),
                    style: LockedInType.micro.copyWith(
                      color: LockedInColors.secondary,
                      letterSpacing: 0,
                      height: 1.5,
                    ),
                  ),
                ),
            const SizedBox(height: Space.sm),
            Container(
              padding: const EdgeInsets.fromLTRB(
                Space.sm,
                Space.xs,
                Space.sm,
                Space.sm,
              ),
              decoration: BoxDecoration(
                color: LockedInColors.panel,
                border: Border(
                  left: BorderSide(
                    color: LockedInColors.primary,
                    width: Stroke.focus,
                  ),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SectionLabel('check'),
                  const SizedBox(height: Space.xxs),
                  Text(
                    step.question,
                    key: const ValueKey('teach-question'),
                    style: LockedInType.proseSmall.copyWith(
                      color: LockedInColors.foreground,
                    ),
                  ),
                  const SizedBox(height: Space.xs),
                  TextField(
                    key: const ValueKey('teach-answer'),
                    controller: _answer,
                    focusNode: _answerFocus,
                    minLines: 1,
                    maxLines: 3,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submitCheck(),
                    style: LockedInType.proseSmall.copyWith(
                      color: LockedInColors.foreground,
                    ),
                    decoration: const InputDecoration(
                      hintText: 'your answer — Enter to check',
                    ),
                  ),
                  const SizedBox(height: Space.xs),
                  TextField(
                    key: const ValueKey('teach-thinking'),
                    controller: _thinking,
                    minLines: 1,
                    maxLines: 3,
                    style: LockedInType.proseSmall.copyWith(
                      color: LockedInColors.foreground,
                    ),
                    decoration: const InputDecoration(
                      hintText: 'how you got there (optional)',
                    ),
                  ),
                  const SizedBox(height: Space.xs),
                  Row(
                    children: [
                      Text(
                        'confidence',
                        style: LockedInType.micro.copyWith(
                          color: LockedInColors.muted,
                        ),
                      ),
                      const SizedBox(width: Space.xs),
                      for (var level = 1; level <= 5; level++)
                        Padding(
                          padding: const EdgeInsets.only(right: 2),
                          child: ConfidenceKey(
                            key: ValueKey('teach-confidence-$level'),
                            level: level,
                            selected: _confidence == level,
                            onTap: () => refresh(
                              () => _confidence = _confidence == level
                                  ? 0
                                  : level,
                            ),
                          ),
                        ),
                      const Spacer(),
                      if (_confidence > 0)
                        Text(
                          switch (_confidence) {
                            1 => 'guessing',
                            2 => 'unsure',
                            3 => 'half',
                            4 => 'fairly sure',
                            _ => 'certain',
                          },
                          style: LockedInType.micro.copyWith(
                            color: LockedInColors.secondary,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: Space.xs),
                  Wrap(
                    spacing: Space.xs,
                    runSpacing: Space.xs,
                    children: [
                      FilledButton(
                        key: const ValueKey('teach-check'),
                        onPressed:
                            widget.teachingLoading || widget.onCheck == null
                            ? null
                            : _submitCheck,
                        style: FilledButton.styleFrom(
                          backgroundColor: LockedInColors.primary,
                          foregroundColor: Theme.of(context)
                              .colorScheme
                              .onPrimary,
                        ),
                        child: Text(
                          widget.teachingLoading ? 'checking…' : 'check',
                        ),
                      ),
                      if (widget.onNextStep != null)
                        TextButton(
                          key: const ValueKey('teach-again'),
                          onPressed: widget.teachingLoading
                              ? null
                              : widget.onNextStep,
                          child: const Text('say it differently'),
                        ),
                      if (widget.onSideSend != null)
                        TextButton(
                          key: const ValueKey('teach-side-open'),
                          onPressed: _toggleSide,
                          child: Text(
                            _sideOpen ? 'hide the question' : 'ask about this',
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (_sideOpen) ...[const SizedBox(height: Space.sm), _sidePanel()],
            if (verdict != null) ...[
              const SizedBox(height: Space.sm),
              Container(
                key: const ValueKey('teach-verdict'),
                padding: const EdgeInsets.symmetric(
                  horizontal: Space.sm,
                  vertical: Space.xs,
                ),
                decoration: BoxDecoration(
                  color: LockedInColors.panel,
                  border: Border(
                    left: BorderSide(
                      color: switch (verdict.verdict) {
                        'correct' => LockedInColors.success,
                        'partial' => LockedInColors.warning,
                        _ => LockedInColors.error,
                      },
                      width: Stroke.focus,
                    ),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SectionLabel(switch (verdict.verdict) {
                      'correct' => 'correct',
                      'partial' => 'partly there',
                      _ => 'not yet',
                    }),
                    const SizedBox(height: Space.xxs),
                    Text(
                      verdict.correction,
                      style: LockedInType.proseSmall.copyWith(
                        color: LockedInColors.foreground,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  /// One line of held material or a gap: a glyph and a sentence.
  Widget _bullet({
    required String glyph,
    required Color tone,
    required String text,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(glyph, style: LockedInType.micro.copyWith(color: tone)),
        const SizedBox(width: Space.xs),
        Expanded(
          child: Text(
            text,
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.foreground,
            ),
          ),
        ),
      ],
    );
  }

  /// Practice: problems that need the idea without naming it.
  ///
  /// The fourth phase (`desktop/docs/redesign.md` §2.1). Practice is refused
  /// until a step has passed its check — a session cannot practise what it never
  /// landed — so this card has three states: nothing held yet, no set generated,
  /// and a set with a verdict per problem.
  Widget _practiceCard() {
    final stages = _stages;
    final held = stages.where((stage) => stage.done).length;
    final record = widget.teaching;
    final practice = record?.practice;
    final loading = widget.teachingLoading;
    final chip = ValueChip(
      stages.isEmpty ? 'nothing yet' : '$held/${stages.length} held',
    );
    return SectionCard(
      label: 'PRACTICE',
      trailing: chip,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'A problem that needs the idea before it names it. Answer, then judge '
            'yourself: the key shows what a correct answer contains.',
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.muted,
            ),
          ),
          if (widget.teachingError != null) ...[
            const SizedBox(height: Space.xs),
            Text(
              widget.teachingError!,
              key: const ValueKey('practice-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
          ],
          const SizedBox(height: Space.sm),
          if (record == null)
            _practiceLine(
              'measure the session first: practice draws on what the lesson '
              'established',
            )
          else if (practice == null || practice.empty)
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _practiceLine(
                  record.passedCount == 0
                      ? 'teach a step and pass its check first'
                      : 'ready: ${record.passedCount} step(s) held',
                ),
                const SizedBox(height: Space.xs),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton(
                    key: const ValueKey('practice-generate'),
                    onPressed:
                        loading ||
                            record.passedCount == 0 ||
                            widget.onPractise == null
                        ? null
                        : widget.onPractise,
                    style: FilledButton.styleFrom(
                      backgroundColor: LockedInColors.primary,
                      foregroundColor: Theme.of(context).colorScheme.onPrimary,
                    ),
                    child: Text(
                      loading ? 'writing problems…' : 'generate practice',
                    ),
                  ),
                ),
              ],
            )
          else ...[
            for (final problem in practice.problems) ...[
              PracticeRow(
                key: ValueKey('practice-${problem.id}'),
                problem: problem,
                solved: practice.solved.contains(problem.id),
                missed: practice.missed.contains(problem.id),
                onVerdict: widget.onPracticeResult == null || loading
                    ? null
                    : (verdict) =>
                          widget.onPracticeResult!(problem.id, verdict),
              ),
              const SizedBox(height: Space.xs),
            ],
            Row(
              children: [
                Expanded(
                  child: _practiceLine(
                    '${practice.solved.length} solved · '
                    '${practice.missed.length} to revisit',
                  ),
                ),
                TextButton(
                  key: const ValueKey('practice-regenerate'),
                  onPressed: loading || widget.onPractise == null
                      ? null
                      : widget.onPractise,
                  child: Text(loading ? 'writing…' : 'new set'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _practiceLine(String text) => Text(
    text,
    style: LockedInType.proseSmall.copyWith(color: LockedInColors.muted),
  );

  GlobalKey _sectionKey(Phase phase) => switch (phase) {
    // Measure, the tree and the step all live in the teaching card. The tree
    // has its own key so `2 plan` lands on it rather than the card's top, and
    // a curriculum goal falls back to its stage list when there is no tree.
    Phase.measure => _teachKey,
    Phase.plan =>
      (widget.teaching?.measured ?? false)
          ? _planKey
          : _stages.isEmpty
          ? _teachKey
          : _stagesKey,
    Phase.teach => _teachKey,
    Phase.practice => _practiceKey,
  };

  /// Scroll one phase's section into view and mark it current.
  void _gotoPhase(Phase phase) {
    refresh(() => _phase = phase);
    final target = _sectionKey(phase).currentContext;
    if (target != null) {
      Scrollable.ensureVisible(
        target,
        alignment: 0.08,
        duration: motionFor(context, Motion.settle),
        curve: Motion.settleCurve,
      );
    }
    // `teach` starts at the first stage that is not held: the only useful
    // default when the user asks to be taught something.
    if (phase == Phase.teach) {
      final next = _stages.indexWhere((stage) => !stage.done);
      if (next >= 0) refresh(() => _selectedStage = next);
    }
  }

  /// The four phases of a teaching session, as the map of where you are.
  ///
  /// `desktop/docs/redesign.md` §2.1: measure → plan → teach → practice is one
  /// surface whose centre changes, so the rail is always visible and `Esc`
  /// never loses the session. Each row carries a state summary, so the rail is
  /// also the answer to "how far in am I".
  Widget _phaseRail({required bool compact}) {
    final stages = _stages;
    final done = stages.where((stage) => stage.done).length;
    final stageIndex = _stageIndex;
    final stage = stageIndex < 0 ? null : stages[stageIndex];
    final teaching = widget.teaching;
    final measured = teaching?.measured ?? false;
    final practice = teaching?.practice;
    final rows = <(Phase, String, String)>[
      (
        Phase.measure,
        'measure',
        teaching == null
            ? 'not measured'
            : '${teaching.held.length} held · ${teaching.gaps.length} gap'
                  '${teaching.gaps.length == 1 ? '' : 's'}',
      ),
      (
        Phase.plan,
        'plan',
        measured
            ? '${teaching!.passedCount}/${teaching.plan.length} held'
            : _chapters.isNotEmpty
            ? 'course ${_chapters.where((chapter) => chapter.done).length}/'
                  '${_chapters.length}'
            : stages.isEmpty
            ? 'not planned'
            : '$done/${stages.length} held',
      ),
      (
        Phase.teach,
        'teach',
        measured
            ? teaching!.current != null
                  ? 'step ${teaching.nextIndex + 1} of ${teaching.plan.length}'
                  : teaching.nextIndex >= teaching.plan.length
                  ? 'all steps held'
                  : 'step ${teaching.nextIndex + 1} ready'
            : stage == null
            ? 'pick a stage'
            : stage.done
            ? 'held'
            : 'stage ${stageIndex + 1}',
      ),
      (
        Phase.practice,
        'practice',
        practice != null && practice.problems.isNotEmpty
            ? '${practice.solved.length} solved · ${practice.missed.length} to revisit'
            : measured
            ? 'after a check'
            : stages.isEmpty
            ? 'after the plan'
            : '${stages.length - done} to hold',
      ),
    ];
    return Container(
      width: compact ? 64 : 176,
      color: LockedInColors.surface,
      padding: const EdgeInsets.symmetric(vertical: Space.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!compact)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Space.sm,
                Space.xxs,
                Space.sm,
                Space.xs,
              ),
              child: SectionLabel('session'),
            ),
          for (final (index, row) in rows.indexed) ...[
            PhaseRow(
              key: ValueKey('teach-phase-${row.$1.name}'),
              number: index + 1,
              label: row.$2,
              summary: row.$3,
              selected: _phase == row.$1,
              compact: compact,
              onTap: () => _gotoPhase(row.$1),
            ),
          ],
          const Spacer(),
          if (!compact)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.sm),
              child: Text(
                measured
                    ? '1–4 jump · n next · i answer · s ask'
                    : teaching == null
                    ? '1–4 jump · m measure'
                    : '1–4 jump · m measure · Enter check',
                style: LockedInType.micro.copyWith(
                  color: LockedInColors.muted,
                  letterSpacing: 0,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The goal's material cards: sources, stages, the course index and chats.
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
