part of 'skill_detail.dart';

/// The goal page composition: header, body, sections, side panel and tabs.
extension _SkillDetailPage on _SkillDetailViewState {
  /// The small title/milestone prompt the add and rename actions share.
  Future<({String title, String? milestone})?> _askStage({
    required String dialogTitle,
    required String confirmLabel,
    required String fieldKeyPrefix,
    String initialTitle = '',
    String initialMilestone = '',
  }) {
    return showDialog<({String title, String? milestone})>(
      context: context,
      builder: (dialogContext) => StagePromptDialog(
        dialogTitle: dialogTitle,
        confirmLabel: confirmLabel,
        fieldKeyPrefix: fieldKeyPrefix,
        initialTitle: initialTitle,
        initialMilestone: initialMilestone,
      ),
    );
  }

  void _openChapter({bool practical = false}) {
    final open = widget.onOpenChapter;
    final chapter = _selectedRow;
    if (open == null || chapter == null) return;
    if (practical && !chapter.hasPractical) {
      refresh(() => _notice = 'this chapter has no practical');
      return;
    }
    refresh(() => _notice = null);
    open(chapter.id, practical: practical);
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    // Modified chords belong to the shell's registry (`Ctrl+K` palette,
    // `Ctrl+R` reconnect). A bare-letter page key must never read them.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;

    // The reader is one layer above the goal page: `Esc` closes it, and the
    // scroll keys move the text. Everything else is left to the shell, so the
    // leader and `?` keep working while a chapter is open.
    if (widget.chapterOpen) {
      if (key == LogicalKeyboardKey.escape) {
        if (widget.onCloseChapter == null) return KeyEventResult.ignored;
        widget.onCloseChapter!();
        return KeyEventResult.handled;
      }
      final scrolled = scrollKey(_chapterScroll, event);
      if (scrolled != null) return scrolled;
      return KeyEventResult.ignored;
    }

    // The curriculum editor is a mode of its own: it owns every unmodified key,
    // so `Esc` leaves the mode (not the goal), and `Enter`/`l` (open lesson) and
    // `b` (build) cannot fire while editing.
    if (_editingStages) {
      if (key == LogicalKeyboardKey.escape ||
          key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter) {
        if (event is KeyDownEvent) _leaveStageEdit();
        return KeyEventResult.handled;
      }
      if (HardwareKeyboard.instance.isControlPressed ||
          HardwareKeyboard.instance.isMetaPressed) {
        return KeyEventResult.ignored;
      }
      final shift = HardwareKeyboard.instance.isShiftPressed;
      if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
        if (shift) {
          if (event is KeyDownEvent) unawaited(_moveStageOrder(-1));
        } else {
          _moveStage(-1);
        }
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.arrowDown ||
          key == LogicalKeyboardKey.keyJ) {
        if (shift) {
          if (event is KeyDownEvent) unawaited(_moveStageOrder(1));
        } else {
          _moveStage(1);
        }
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyA && !_stagesBusy) {
        if (event is KeyDownEvent) unawaited(_addStage());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyR && !_stagesBusy) {
        if (event is KeyDownEvent) unawaited(_renameStage());
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyD && !_stagesBusy) {
        if (event is KeyDownEvent) unawaited(_removeStage());
        return KeyEventResult.handled;
      }
      // Anything else (Space for the leader, `?`, `:`) belongs to the shell:
      // this mode owns its letters, not the whole keyboard.
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.escape) {
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    // The four phases are one press each, so the rail is reachable without a
    // pointer. They are bare digits, not leader chords: the rail is the page's
    // own map and this page has no other digit action.
    final phaseKey = switch (key) {
      LogicalKeyboardKey.digit1 || LogicalKeyboardKey.numpad1 => Phase.measure,
      LogicalKeyboardKey.digit2 || LogicalKeyboardKey.numpad2 => Phase.plan,
      LogicalKeyboardKey.digit3 || LogicalKeyboardKey.numpad3 => Phase.teach,
      LogicalKeyboardKey.digit4 || LogicalKeyboardKey.numpad4 => Phase.practice,
      _ => null,
    };
    if (phaseKey != null) {
      if (event is KeyDownEvent) _gotoPhase(phaseKey);
      return KeyEventResult.handled;
    }
    // The teaching loop's own keys. They exist only when the core has a
    // teaching record, so a course/stage goal keeps its old grammar.
    final teaching = widget.teaching;
    if (teaching != null) {
      final measured = teaching.measured;
      if (key == LogicalKeyboardKey.keyM &&
          !measured &&
          widget.onMeasure != null &&
          !widget.teachingLoading) {
        if (event is KeyDownEvent) widget.onMeasure!();
        return KeyEventResult.handled;
      }
      if (measured) {
        if (key == LogicalKeyboardKey.keyN &&
            widget.onNextStep != null &&
            !widget.teachingLoading) {
          if (event is KeyDownEvent) widget.onNextStep!();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.keyI && teaching.current != null) {
          if (event is KeyDownEvent) _answerFocus.requestFocus();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.keyS &&
            teaching.current != null &&
            widget.onSideSend != null) {
          if (event is KeyDownEvent) _toggleSide();
          return KeyEventResult.handled;
        }
        // Enter submits the check when the page (not a field) has the
        // keyboard. With no open step it still opens the selected
        // stage/chapter below, so the legacy path is untouched.
        if ((key == LogicalKeyboardKey.enter ||
                key == LogicalKeyboardKey.numpadEnter) &&
            teaching.current != null &&
            _answer.text.trim().isNotEmpty) {
          if (event is KeyDownEvent) _submitCheck();
          return KeyEventResult.handled;
        }
      }
    }
    // `e` edits the curriculum. It is separate from `a` (add sources), so the
    // sources action is not shadowed outside edit mode.
    if (key == LogicalKeyboardKey.keyE) {
      if (widget.onSaveStages == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) _enterStageEdit();
      return KeyEventResult.handled;
    }
    // `c` opens this goal's chat. A focused text field consumes the keystroke
    // before this page's Focus sees it, so typing `c` in a composer is safe.
    if (key == LogicalKeyboardKey.keyC) {
      if (widget.onOpenChat == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) widget.onOpenChat!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyN &&
        HardwareKeyboard.instance.isShiftPressed) {
      if (widget.onNewChat == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) widget.onNewChat!();
      return KeyEventResult.handled;
    }
    // `a` gathers files into this goal. It is separate from the chapter keys
    // (`Enter`, `p`, `j/k`) and from `c`, so no action is shadowed.
    if (key == LogicalKeyboardKey.keyA) {
      if (widget.onAddSources == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) _addSources();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.keyJ) {
      if (_stages.isNotEmpty) {
        _moveStage(1);
      } else {
        _move(1);
      }
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
      if (_stages.isNotEmpty) {
        _moveStage(-1);
      } else {
        _move(-1);
      }
      return KeyEventResult.handled;
    }
    if (_stages.isNotEmpty) {
      // A curriculum goal selects a stage, not a chapter: the stage list is its
      // index and its rows are the only lesson entry point.
      if (key == LogicalKeyboardKey.enter ||
          key == LogicalKeyboardKey.numpadEnter ||
          key == LogicalKeyboardKey.keyL) {
        if (widget.onOpenStage == null) return KeyEventResult.ignored;
        _openStage();
        return KeyEventResult.handled;
      }
      if (key == LogicalKeyboardKey.keyB) {
        if (widget.onBuildStage == null) return KeyEventResult.ignored;
        if (event is KeyDownEvent) _buildStage();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (widget.onOpenChapter == null) return KeyEventResult.ignored;
      _openChapter();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyP) {
      _openChapter(practical: true);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  Widget _goalPage() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _header(),
        if (widget.loading)
          LinearProgressIndicator(
            minHeight: 2,
            color: LockedInColors.primary,
            backgroundColor: LockedInColors.line,
          ),
        Expanded(child: _body()),
      ],
    );
  }

  Widget _header() {
    final theme = Theme.of(context);
    final detail = widget.detail;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to skills',
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
                  detail.name.isEmpty ? 'goal' : detail.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                // The goal, not the counts: in a teaching session the goal is
                // the north star, so it stays on screen through every phase. The
                // plan/chapter/chat counts live in the rail and the panes.
                Text(
                  detail.goal.trim().isEmpty ? _subtitle(detail) : detail.goal,
                  key: const ValueKey('skill-goal-line'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.secondary,
                    fontWeight: FontWeight.w400,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ),
          if (widget.onOpenChat != null) ...[
            const SizedBox(width: 8),
            IconButton(
              key: const ValueKey('skill-open-chat'),
              tooltip: 'Open chat (c)',
              onPressed: widget.onOpenChat,
              icon: const Icon(Icons.forum_outlined, size: 18),
            ),
          ],
          if (widget.onNewChat != null) ...[
            const SizedBox(width: 4),
            IconButton(
              key: const ValueKey('skill-new-chat'),
              tooltip: 'New chat (Shift+N)',
              onPressed: widget.onNewChat,
              icon: const Icon(Icons.add_comment_outlined, size: 18),
            ),
          ],
        ],
      ),
    );
  }

  Widget _body() {
    return LayoutBuilder(
      builder: (context, constraints) {
        // The rail needs 176 px and the page at least 420: below that it
        // becomes a numbered strip, still complete as a control.
        final compactRail = constraints.maxWidth < Breakpoints.column;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _phaseRail(compact: compactRail),
            const VRule(),
            Expanded(child: _sections()),
          ],
        );
      },
    );
  }

  /// Every section of the session, in one scroll.
  ///
  /// The phases are a *navigator*, not a filter: measure, plan, teach and
  /// practice are the four things a session has, and hiding three of them to
  /// show one took the stage list, the sources and the chats off screen — and
  /// with them every key that acts on them (`a`, `e`, `Enter`, `j`/`k`). One
  /// scroll with four anchored sections keeps every control mounted and makes
  /// the rail a jump-to-section map.
  Widget _sections() {
    return ListView(
      controller: _sectionsScroll,
      padding: const EdgeInsets.fromLTRB(
        Space.lg,
        Space.md,
        Space.lg,
        Space.xxl,
      ),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  ErrorBanner(message: widget.error!, onRetry: widget.onRetry),
                  const SizedBox(height: Space.sm),
                ],
                if (_notice != null) ...[
                  Notice(message: _notice!),
                  const SizedBox(height: Space.sm),
                ],
                if (_sourcesFailure != null) ...[
                  ErrorBanner(message: _sourcesFailure!),
                  const SizedBox(height: Space.sm),
                ],
                if (_sourcesNotice != null) ...[
                  SourceNotice(message: _sourcesNotice!),
                  const SizedBox(height: Space.sm),
                ],
                KeyedSubtree(
                  key: _sectionKey(Phase.teach),
                  child: _teachingCard(),
                ),
                const SizedBox(height: Space.md),
                // Practice is part of the harness, not context: it follows the
                // learning surface.
                KeyedSubtree(
                  key: _sectionKey(Phase.practice),
                  child: _practiceCard(),
                ),
                const SizedBox(height: Space.md),
                if (_chapters.isNotEmpty) ...[
                  KeyedSubtree(key: _courseKey, child: _courseCard()),
                  const SizedBox(height: Space.md),
                ],
                // A curriculum goal's stage list is its plan; it stays primary
                // until the teaching loop has a measured plan of its own.
                if ((_stages.isNotEmpty &&
                        !(widget.teaching?.measured ?? false)) ||
                    _editingStages) ...[
                  KeyedSubtree(key: _stagesKey, child: _stagesCard()),
                  const SizedBox(height: Space.md),
                ],
                _contextTabBar(),
                const SizedBox(height: Space.xs),
                Offstage(offstage: _contextTab != 0, child: _sourcesCard()),
                Offstage(offstage: _contextTab != 1, child: _chatsCard()),
                Offstage(offstage: _contextTab != 2, child: _researchCard()),
                Offstage(offstage: _contextTab != 3, child: _goalCard()),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The teaching loop: measure, the plan as a map, one step with its check.
  ///
  /// This is the harness (`desktop/docs/redesign.md` §2.1). The model's reply is
  /// structured — held, gaps, plan, one step, one verdict — so the card renders
  /// fields and never parses prose. One action per state: measure when there is
  /// no plan, open a step when none is open, answer when one is. Every state has
  /// its next key, so the loop never dead-ends.
  /// Open or close the side panel, loading the thread on the way in.
  void _toggleSide() {
    refresh(() => _sideOpen = !_sideOpen);
    if (_sideOpen) widget.onSideOpen?.call();
  }

  /// Send the typed side question. The core writes the exchange only after the
  /// reply exists, so the panel keeps the question visible while it waits.
  void _sendSide() {
    final send = widget.onSideSend;
    if (send == null || widget.sideLoading) return;
    final text = _sideInput.text.trim();
    if (text.isEmpty) return;
    send(text);
    _sideInput.clear();
  }

  /// The side thread, inside the step card.
  ///
  /// It is one small conversation about this step, not a second lesson: the
  /// answers are short, they never enter the transcript, and closing the panel
  /// loses nothing.
  Widget _sidePanel() {
    return Container(
      key: const ValueKey('teach-side-panel'),
      padding: const EdgeInsets.fromLTRB(
        Space.sm,
        Space.xs,
        Space.sm,
        Space.sm,
      ),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border.all(color: LockedInColors.line, width: Stroke.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(child: SectionLabel('side question')),
              if (widget.sideMessages.isNotEmpty && widget.onSideClear != null)
                TextButton(
                  key: const ValueKey('teach-side-clear'),
                  onPressed: widget.sideLoading ? null : widget.onSideClear,
                  child: const Text('clear'),
                ),
              TextButton(
                key: const ValueKey('teach-side-close'),
                onPressed: () => refresh(() => _sideOpen = false),
                child: const Text('close'),
              ),
            ],
          ),
          if (widget.sideError != null) ...[
            Text(
              widget.sideError!,
              key: const ValueKey('teach-side-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
            const SizedBox(height: Space.xxs),
          ],
          if (widget.sideMessages.isEmpty)
            Text(
              'Ask anything about this step. The answer stays here, not in the '
              'lesson.',
              key: const ValueKey('teach-side-empty'),
              style: LockedInType.proseSmall.copyWith(
                color: LockedInColors.muted,
              ),
            )
          else
            for (final (index, message) in widget.sideMessages.indexed) ...[
              const SizedBox(height: Space.xxs),
              Text(
                message.isUser ? 'you' : 'companion',
                key: ValueKey('teach-side-role-$index'),
                style: LockedInType.micro.copyWith(
                  color: message.isUser
                      ? LockedInColors.primary
                      : LockedInColors.muted,
                ),
              ),
              Text(
                message.text,
                key: ValueKey('teach-side-message-$index'),
                style: LockedInType.proseSmall.copyWith(
                  color: LockedInColors.foreground,
                ),
              ),
            ],
          const SizedBox(height: Space.xs),
          TextField(
            key: const ValueKey('teach-side-input'),
            controller: _sideInput,
            minLines: 1,
            maxLines: 3,
            onSubmitted: (_) => _sendSide(),
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.foreground,
            ),
            decoration: const InputDecoration(
              hintText: 'ask about this step — Enter to send',
            ),
          ),
          const SizedBox(height: Space.xs),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              key: const ValueKey('teach-side-send'),
              onPressed: widget.sideLoading || widget.onSideSend == null
                  ? null
                  : _sendSide,
              style: FilledButton.styleFrom(
                backgroundColor: LockedInColors.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
              child: Text(widget.sideLoading ? 'thinking…' : 'ask'),
            ),
          ),
        ],
      ),
    );
  }

  /// Send one answer, its reasoning and the chosen confidence.
  void _submitCheck() {
    final onCheck = widget.onCheck;
    if (onCheck == null || widget.teachingLoading) return;
    final answer = _answer.text.trim();
    if (answer.isEmpty) return;
    onCheck(answer, _thinking.text.trim(), _confidence);
    _answer.clear();
    _thinking.clear();
    refresh(() => _confidence = 0);
  }

  Widget _goalCard() {
    final prior = widget.detail.prior.trim();
    final plan = widget.detail.modelPlan ? 'model' : 'template';
    return SectionCard(
      label: 'GOAL',
      trailing: ValueChip('plan · $plan'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The goal itself is in the header, on every phase. Repeating it here
          // made the session say the same sentence twice within 100 px.
          Text(
            'Where this session starts, and what it was asked for.',
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.muted,
            ),
          ),
          const SizedBox(height: Space.xs),
          _labelled('starting point', prior.isEmpty ? 'not recorded' : prior),
          const SizedBox(height: 6),
          _labelled('created', _createdLabel(widget.detail.created)),
        ],
      ),
    );
  }

  Widget _labelled(String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
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
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }

  /// The context tabs: sources, chats, research, goal metadata.
  ///
  /// The learning surface is the page; everything a lesson is *built from* or
}
