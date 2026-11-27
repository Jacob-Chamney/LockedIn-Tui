part of 'session_detail.dart';

/// The session header and body: breadcrumb, panes and the current step hero.
extension _SessionDetailBody on _SessionDetailViewState {
  Widget _header() {
    // Measured on the pane, not the window: the rail is 64–208 px of the
    // window, so `MediaQuery` said "roomy" while the header had 200 px less.
    return LayoutBuilder(
      builder: (context, constraints) => _headerAt(constraints.maxWidth),
    );
  }

  Widget _headerAt(double width) {
    final theme = Theme.of(context);
    final detail = widget.detail;
    final compact = width < Breakpoints.hint;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to sessions',
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
                  detail == null || detail.name.isEmpty
                      ? 'session'
                      : detail.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                if (detail != null)
                  Text(
                    _subtitle(detail),
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
          if (detail?.archived ?? false) ...[
            const SizedBox(width: 10),
            const ArchivedBadge(),
          ],
          if (detail != null && widget.onOpenSettings != null) ...[
            const SizedBox(width: 8),
            if (compact)
              IconButton(
                key: const ValueKey('session-settings-open'),
                tooltip: 'Edit instructions',
                onPressed: widget.onOpenSettings,
                icon: const Icon(Icons.tune, size: 18),
              )
            else
              OutlinedButton.icon(
                key: const ValueKey('session-settings-open'),
                onPressed: widget.onOpenSettings,
                icon: const Icon(Icons.tune, size: 16),
                label: const Text('Edit instructions'),
              ),
          ],
          if (detail != null) ...[
            const SizedBox(width: 12),
            FilledButton.icon(
              onPressed: widget.onOpenChat,
              icon: const Icon(Icons.forum_outlined, size: 16),
              label: const Text('Open chat'),
            ),
          ],
        ],
      ),
    );
  }

  String _subtitle(SessionDetail detail) {
    final sources = detail.sources.length;
    final label = sources == 1 ? 'source' : 'sources';
    return '${createdLabel(detail.created)} · $sources $label';
  }

  Widget _body() {
    final detail = widget.detail;
    if (detail == null) {
      if (widget.loading) {
        return const SessionLoading(label: 'loading session…');
      }
      final error = widget.error;
      if (error != null) {
        return _stateCard(
          icon: Icons.error_outline,
          tone: LockedInColors.error,
          title: 'could not open this session',
          body: error,
          actions: [
            if (widget.onRetry != null)
              FilledButton(
                onPressed: widget.onRetry,
                child: const Text('Retry'),
              ),
            if (widget.onBack != null)
              OutlinedButton(
                onPressed: widget.onBack,
                child: const Text('Back to sessions'),
              ),
          ],
        );
      }
      return _stateCard(
        icon: Icons.info_outline,
        tone: LockedInColors.warning,
        title: 'session unavailable',
        body:
            'The core returned no session for this id. Go back and pick one '
            'from the list.',
        actions: [
          if (widget.onBack != null)
            OutlinedButton(
              onPressed: widget.onBack,
              child: const Text('Back to sessions'),
            ),
        ],
      );
    }

    if (_readerVisible) return _documentReader();

    // A lock-in session is a **focus surface**, not a lecture
    // (`desktop/docs/redesign.md` §4a): the step you are on is the loudest
    // thing on screen, the ordered list sits beside it, and the files, memory
    // and coverage are demoted to context underneath. The user can already do
    // the work; the page's only job is to keep the next action obvious.
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= Breakpoints.columns;
        final centre = _centrePane(detail, includeSteps: !wide);
        if (!wide) return centre;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 328,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  Space.md,
                  Space.md,
                  Space.sm,
                  Space.xl,
                ),
                child: _stepsPane(detail),
              ),
            ),
            const VRule(),
            Expanded(child: centre),
          ],
        );
      },
    );
  }

  /// The centre: the current step, then everything that is context.
  ///
  /// `includeSteps` is true on a narrow window, where the step list has no
  /// column of its own and follows the current step instead.
  Widget _centrePane(SessionDetail detail, {required bool includeSteps}) {
    final hasPdf = detail.sources.any((source) => source.kind == 'pdf');
    return ListView(
      key: SessionDetailView.pageScrollKey,
      controller: _pageScroll,
      padding: const EdgeInsets.fromLTRB(
        Space.lg,
        Space.md,
        Space.lg,
        Space.xxl,
      ),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.error != null) ...[
                  _errorBanner(widget.error!),
                  const SizedBox(height: Space.sm),
                ],
                _currentStepHero(detail),
                if (includeSteps) ...[
                  const SizedBox(height: Space.md),
                  _stepsPane(detail),
                ],
                // Outputs are the point of a session, so they sit under the
                // step instead of being buried past the prompt, sources,
                // figures, memory and mistakes.
                if (widget.onOpenOutput != null ||
                    widget.onGenerateDocument != null) ...[
                  const SizedBox(height: Space.md),
                  _studyToolsCard(),
                ],
                const SizedBox(height: Space.lg),
                _promptCard(detail),
                const SizedBox(height: Space.md),
                _sourcesCard(detail),
                // The crop form is four number fields and a page: it belongs
                // on screen only when the session actually carries a PDF. A
                // text-only session used to show it above the fold while its
                // own outputs sat at the bottom.
                if (widget.figures.isNotEmpty ||
                    (widget.onExtractFigure != null && hasPdf)) ...[
                  const SizedBox(height: Space.md),
                  _figuresCard(),
                ] else if (widget.onExtractFigure != null) ...[
                  const SizedBox(height: Space.md),
                  Text(
                    'figures come from a PDF source · add one to crop a diagram',
                    key: const ValueKey('figures-missing-pdf'),
                    style: LockedInType.label.copyWith(
                      color: LockedInColors.muted,
                    ),
                  ),
                ],
                const SizedBox(height: Space.md),
                _memoryCard(detail),
                const SizedBox(height: Space.md),
                _mistakesCard(),
                if (_coverageWired) ...[
                  const SizedBox(height: Space.md),
                  _coverageCard(),
                ],
                const SizedBox(height: Space.lg),
                const Rule(),
                const SizedBox(height: Space.xs),
                Text(
                  _stepsHint(
                    interactive: widget.onToggleStep != null,
                    canGenerate: widget.onGenerateSteps != null,
                    canSettings: widget.onOpenSettings != null,
                    canOutputs: widget.onOpenOutput != null,
                  ),
                  key: const ValueKey('session-keys'),
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.muted,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The one step in front: its text, where it sits, and how far the session is.
  ///
  /// Nothing else on the page is this large. That is the whole design of a
  /// focus surface — the work is the only thing competing for attention.
  Widget _currentStepHero(SessionDetail detail) {
    final steps = detail.steps;
    final ready = steps.exists && steps.markdown.trim().isNotEmpty;
    final rows = ready ? parseSteps(steps.markdown) : const <StepRow>[];
    final tasks = [
      for (final row in rows)
        if (row.index != null) row,
    ];
    if (!ready || tasks.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionLabel('current step'),
          const SizedBox(height: Space.xs),
          Text(
            ready ? 'this session has no steps yet' : 'steps not built yet',
            key: const ValueKey('session-hero-empty'),
            style: LockedInType.title.copyWith(color: LockedInColors.muted),
          ),
        ],
      );
    }

    final index = _selectedStep.clamp(0, tasks.length - 1);
    final row = tasks[index];
    final checked = row.checked ?? false;
    final done = steps.done;
    final total = steps.total;
    final fraction = total == 0 ? 0.0 : done / total;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            // `SectionLabel` is itself a Row: a bare Row child would get
            // unbounded width.
            Expanded(
              child: SectionLabel('step ${index + 1} of ${tasks.length}'),
            ),
            ValueChip(
              checked ? 'done' : 'next',
              tone: checked ? LockedInColors.success : LockedInColors.primary,
            ),
          ],
        ),
        const SizedBox(height: Space.xs),
        // The step itself: display size, mono, wrapped at the reading measure.
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: Space.proseMeasure),
          child: Text(
            row.text,
            key: const ValueKey('session-hero-step'),
            style: LockedInType.display.copyWith(
              color: checked ? LockedInColors.muted : LockedInColors.foreground,
              fontSize: TypeScale.display,
              height: 1.35,
              decoration: checked ? TextDecoration.lineThrough : null,
            ),
          ),
        ),
        const SizedBox(height: Space.md),
        Meter(value: fraction),
        const SizedBox(height: Space.xs),
        Row(
          children: [
            Text(
              '$done of $total done',
              style: LockedInType.micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
            const Spacer(),
            // The page's key row at the foot already names every key; this is
            // the position, so the hero stays one line at 480 px.
            Text(
              'step ${index + 1} / ${tasks.length}',
              style: LockedInType.micro.copyWith(
                color: LockedInColors.muted,
                fontWeight: FontWeight.w500,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// The ordered list: the map beside the step, and the session's progress.
  Widget _stepsPane(SessionDetail detail) {
    final steps = detail.steps;
    final ready = steps.exists && steps.markdown.trim().isNotEmpty;
    final complete = steps.total > 0 && steps.done >= steps.total;
    final canGenerate = widget.onGenerateSteps != null;
    final generating = widget.generatingSteps || _requestingSteps;
    final rows = ready ? parseSteps(steps.markdown) : const <StepRow>[];
    final tasks = [
      for (final row in rows)
        if (row.index != null) row.index!,
    ];
    final selected = tasks.isEmpty
        ? null
        : _selectedStep.clamp(0, tasks.length - 1);
    final error = _stepsError;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(child: SectionLabel('steps')),
            Text(
              ready ? '${steps.done}/${steps.total} steps' : 'no steps',
              style: LockedInType.micro.copyWith(
                color: ready && complete
                    ? LockedInColors.success
                    : LockedInColors.muted,
                fontWeight: FontWeight.w600,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
        const SizedBox(height: Space.xs),
        if (ready)
          for (final row in rows)
            _stepRow(row, selected: row.index != null && row.index == selected)
        else
          SessionEmptyNote(
            tone: LockedInColors.warning,
            title: 'steps missing',
            body: canGenerate
                ? 'This session has no assignment-steps.md yet. Build it from '
                      'the session sources; the plan is generated once and saved '
                      'to the session.'
                : 'This session has no assignment-steps.md yet. Open the chat '
                      'and press R to build the steps.',
          ),
        if (canGenerate && !ready) ...[
          const SizedBox(height: Space.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              key: const ValueKey('steps-generate'),
              onPressed: generating ? null : () => unawaited(_generateSteps()),
              style: FilledButton.styleFrom(
                backgroundColor: LockedInColors.primary,
                foregroundColor: Theme.of(context).colorScheme.onPrimary,
              ),
              child: Text(generating ? 'building steps…' : 'build steps'),
            ),
          ),
        ],
        if (ready && canGenerate) ...[
          const SizedBox(height: Space.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: const ValueKey('steps-regenerate'),
              onPressed: generating ? null : () => unawaited(_generateSteps()),
              child: Text(generating ? 'rebuilding…' : 'rebuild steps'),
            ),
          ),
        ],
        if (_toggling) ...[
          const SizedBox(height: Space.xs),
          Text(
            'saving step…',
            style: LockedInType.micro.copyWith(color: LockedInColors.muted),
          ),
        ],
        if (_toggleError != null) ...[
          const SizedBox(height: Space.xs),
          _stepError(_toggleError!),
        ],
        if (error != null) ...[
          const SizedBox(height: Space.xs),
          _generationError(
            error,
            onRetry: generating ? null : () => unawaited(_generateSteps()),
          ),
        ],
      ],
    );
  }

  /// Figures cropped from the session's own PDF, with the form that adds one.
  ///
  /// The PDF is the session's copied source, never an arbitrary path; the core
  /// confines and renders it. The image bytes are loaded on demand so opening a
  Widget _studyButton({
    required String keyName,
    required IconData icon,
    required String label,
    required VoidCallback? onPressed,
  }) {
    return OutlinedButton.icon(
      key: ValueKey(keyName),
      onPressed: onPressed,
      icon: Icon(icon, size: 16),
      label: Text(label),
    );
  }

  /// The generated document reader: one layer over the detail, so `Esc` returns
  /// to the session and the chat/steps are untouched.
}
