part of 'session_detail.dart';

/// The session's material cards: figures, prompt, sources, mistakes, memory,
/// coverage and the study tools.
extension _SessionDetailCards on _SessionDetailViewState {
  /// session does not read every PNG.
  Widget _figuresCard() {
    final canExtract = widget.onExtractFigure != null;
    return SectionCard(
      label: 'FIGURES',
      trailing: widget.figuresLoading
          ? const ValueChip('reading…')
          : widget.figures.isEmpty
          ? null
          : ValueChip('${widget.figures.length}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Crop a diagram out of this session\'s own PDF. The page number is '
            'the PDF\'s, so the figure keeps its provenance.',
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.muted,
            ),
          ),
          const SizedBox(height: Space.sm),
          Row(
            children: [
              SizedBox(
                width: 64,
                child: TextField(
                  key: const ValueKey('figure-page'),
                  controller: _figurePage,
                  enabled: canExtract,
                  keyboardType: TextInputType.number,
                  style: LockedInType.body.copyWith(fontSize: TypeScale.key),
                  decoration: const InputDecoration(hintText: 'page'),
                ),
              ),
              const SizedBox(width: Space.xs),
              Expanded(
                child: TextField(
                  key: const ValueKey('figure-caption'),
                  controller: _figureCaption,
                  enabled: canExtract,
                  style: LockedInType.body.copyWith(fontSize: TypeScale.key),
                  decoration: const InputDecoration(
                    hintText: 'caption (optional)',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.xxs),
          Row(
            children: [
              for (final (key, controller, hint) in [
                ('figure-crop-x', _figureX, 'x'),
                ('figure-crop-y', _figureY, 'y'),
                ('figure-crop-w', _figureW, 'w'),
                ('figure-crop-h', _figureH, 'h'),
              ]) ...[
                Expanded(
                  child: TextField(
                    key: ValueKey(key),
                    controller: controller,
                    enabled: canExtract,
                    keyboardType: TextInputType.number,
                    style: LockedInType.body.copyWith(
                      fontSize: TypeScale.label,
                    ),
                    decoration: InputDecoration(hintText: hint),
                  ),
                ),
                const SizedBox(width: 4),
              ],
              FilledButton(
                key: const ValueKey('figure-extract'),
                onPressed: !canExtract || widget.figureBusy
                    ? null
                    : _extractFigure,
                style: FilledButton.styleFrom(
                  backgroundColor: LockedInColors.primary,
                  foregroundColor: Theme.of(context).colorScheme.onPrimary,
                ),
                child: Text(widget.figureBusy ? 'rendering…' : 'extract'),
              ),
            ],
          ),
          if (_figureNotice != null) ...[
            const SizedBox(height: Space.xxs),
            Text(
              _figureNotice!,
              key: const ValueKey('figure-notice'),
              style: LockedInType.label.copyWith(color: LockedInColors.warning),
            ),
          ],
          if (widget.figureError != null) ...[
            const SizedBox(height: Space.xxs),
            Text(
              widget.figureError!,
              key: const ValueKey('figure-error'),
              style: LockedInType.label.copyWith(color: LockedInColors.error),
            ),
          ],
          for (final figure in widget.figures) ...[
            const SizedBox(height: Space.sm),
            Container(
              key: ValueKey('figure-item-${figure.id}'),
              padding: const EdgeInsets.all(Space.xs),
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
                      Expanded(
                        child: Text(
                          figure.caption.isEmpty
                              ? 'figure ${figure.id} · page ${figure.page}'
                              : figure.caption,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: LockedInType.body.copyWith(
                            fontSize: TypeScale.key,
                          ),
                        ),
                      ),
                      if (widget.onLoadFigure != null &&
                          !widget.figureImages.containsKey(figure.id))
                        TextButton(
                          key: ValueKey('figure-load-${figure.id}'),
                          onPressed: () => widget.onLoadFigure!(figure.id),
                          child: const Text('view'),
                        ),
                      if (widget.onRemoveFigure != null)
                        TextButton(
                          key: ValueKey('figure-remove-${figure.id}'),
                          onPressed: () => widget.onRemoveFigure!(figure.id),
                          child: const Text('remove'),
                        ),
                    ],
                  ),
                  if (widget.figureImages[figure.id] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: Space.xxs),
                      child: Image.memory(
                        widget.figureImages[figure.id]!,
                        key: ValueKey('figure-image-${figure.id}'),
                        fit: BoxFit.contain,
                        height: 220,
                      ),
                    ),
                  if (figure.note.trim().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: Space.xxs),
                      child: Text(
                        figure.note,
                        style: LockedInType.proseSmall.copyWith(
                          color: LockedInColors.muted,
                        ),
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

  /// Parse the form and ask the core for one crop.
  void _extractFigure() {
    final extract = widget.onExtractFigure;
    if (extract == null) return;
    final page = int.tryParse(_figurePage.text.trim());
    if (page == null || page < 1) {
      refresh(() => _figureNotice = 'the page must be a whole number');
      return;
    }
    final cropTexts = [
      _figureX.text.trim(),
      _figureY.text.trim(),
      _figureW.text.trim(),
      _figureH.text.trim(),
    ];
    final anyCrop = cropTexts.any((text) => text.isNotEmpty);
    final allCrop = cropTexts.every((text) => text.isNotEmpty);
    if (anyCrop && !allCrop) {
      refresh(() => _figureNotice = 'a crop needs x, y, width and height');
      return;
    }
    final numbers = cropTexts.map(int.tryParse).toList(growable: false);
    if (anyCrop && numbers.any((value) => value == null || value < 0)) {
      refresh(() => _figureNotice = 'crop values must be whole pixels');
      return;
    }
    refresh(() => _figureNotice = null);
    unawaited(
      extract(
        page: page,
        x: anyCrop ? numbers[0] : null,
        y: anyCrop ? numbers[1] : null,
        width: anyCrop ? numbers[2] : null,
        height: anyCrop ? numbers[3] : null,
        caption: _figureCaption.text.trim(),
      ),
    );
    _figureCaption.clear();
  }

  Widget _promptCard(SessionDetail detail) {
    final prompt = detail.prompt.trim();
    return _card(
      label: 'INSTRUCTIONS',
      child: prompt.isEmpty
          ? SessionEmptyNote(
              tone: LockedInColors.warning,
              title: 'no instructions yet',
              body:
                  'The chat can still answer from the sources below. Add '
                  'sources, or press s to set the prompt in session settings.',
            )
          : Text(
              prompt,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.proseSmall,
                height: 1.5,
              ),
            ),
    );
  }

  Widget _sourcesCard(SessionDetail detail) {
    final sources = detail.sources;
    return _card(
      label: 'SOURCES',
      trailing: _countChip('${sources.length}'),
      child: sources.isEmpty
          ? SessionEmptyNote(
              tone: LockedInColors.muted,
              title: 'no sources yet',
              body:
                  'Lock-in chat reads only the files copied into this '
                  'session. Nothing outside its sources folder is visible.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < sources.length; index++) ...[
                  if (index > 0)
                    Divider(
                      height: 1,
                      thickness: 1,
                      color: LockedInColors.line,
                    ),
                  _sourceRow(sources[index]),
                ],
              ],
            ),
    );
  }

  Widget _sourceRow(SessionSource source) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          Icon(sourceIcon(source.kind), size: 15, color: LockedInColors.muted),
          const SizedBox(width: 9),
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
          _countChip(source.kind.isEmpty ? 'file' : source.kind),
          const SizedBox(width: 8),
          Text(
            shortHash(source.hash),
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }

  /// The misconception ledger, shown after session memory.
  ///
  /// Labelled as the learner's own record: promotion writes a **school
  /// knowledge note**, never a source of this session. The card is the only
  /// place mistakes are recorded, so a session with no ledger still has a next
  /// action instead of an empty panel.
  Widget _mistakesCard() {
    final entries = widget.mistakes;
    final canRecord = widget.onRecordMistake != null;
    return _card(
      key: const ValueKey('session-mistakes-card'),
      label: 'MISTAKES',
      trailing: _countChip('${entries.length} recorded'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'your record · not a source',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 6),
          if (widget.mistakesLoading && entries.isEmpty)
            Text(
              'reading the ledger…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            )
          else if (widget.mistakesError != null) ...[
            Text(
              widget.mistakesError!,
              key: const ValueKey('session-mistakes-error'),
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: TypeScale.label,
              ),
            ),
            if (widget.onRetryMistakes != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: const ValueKey('session-mistakes-retry'),
                  onPressed: widget.onRetryMistakes,
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Retry'),
                ),
              ),
          ] else if (entries.isEmpty)
            Text(
              'no mistakes recorded yet · add one below',
              key: const ValueKey('session-mistakes-empty'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.25,
              ),
            )
          else
            for (final entry in entries) _mistakeRow(entry),
          if (canRecord) ...[
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('mistake-text-field'),
              controller: _mistakeText,
              enabled: !_mistakeBusy,
              decoration: const InputDecoration(
                labelText: 'record a mistake',
                hintText: 'one line: what did you get wrong?',
              ),
              onSubmitted: (_) => _recordMistake(),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const ValueKey('mistake-step-field'),
                    controller: _mistakeStep,
                    enabled: !_mistakeBusy,
                    decoration: const InputDecoration(
                      labelText: 'step (optional)',
                      hintText: 'the assignment step it belongs to',
                    ),
                    onSubmitted: (_) => _recordMistake(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const ValueKey('mistake-record-button'),
                  onPressed: _mistakeBusy ? null : _recordMistake,
                  child: const Text('Add'),
                ),
              ],
            ),
          ],
          if (_mistakeNotice != null) ...[
            const SizedBox(height: 8),
            Text(
              _mistakeNotice!,
              key: const ValueKey('mistake-notice'),
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.3,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _mistakeRow(SessionMistake entry) {
    final note = entry.note;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${entry.index + 1}. ${entry.text}',
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.label,
                    height: 1.35,
                  ),
                ),
                if (entry.step != null)
                  Text(
                    'step: ${entry.step}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.micro,
                    ),
                  ),
                if (note != null)
                  Text(
                    'promoted → ${note.path.split('/').last} · ${note.status}',
                    key: ValueKey('mistake-promoted-${entry.index}'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: note.corrected
                          ? LockedInColors.success
                          : LockedInColors.muted,
                      fontSize: TypeScale.micro,
                    ),
                  ),
              ],
            ),
          ),
          if (note == null && widget.onPromoteMistake != null)
            TextButton(
              key: ValueKey('mistake-promote-${entry.index}'),
              onPressed: _mistakeBusy
                  ? null
                  : () => _promoteMistake(entry.index),
              child: const Text('Promote'),
            ),
          if (note != null && widget.onCorrectMistake != null)
            TextButton(
              key: ValueKey('mistake-correct-${entry.index}'),
              onPressed: _mistakeBusy
                  ? null
                  : () => _correctMistake(entry.index),
              child: Text(note.corrected ? 'Edit' : 'Correct'),
            ),
        ],
      ),
    );
  }

  /// The session's stored memory note (`memory.md`), shown after the sources.
  ///
  /// It is **history, labelled session memory and never a source**: it is not a
  /// [`SessionSource`] and a chat may not cite it as a fact from the session's
  /// sources. The card is read-only — no toggle, no build, no clear — and it is
  /// kept dense so the steps card stays where the reader expects it.
  Widget _memoryCard(SessionDetail detail) {
    final memory = detail.memory;
    final points = memory?.points ?? const <String>[];
    final folded = memory?.folded ?? const <String>[];
    final updated = memory?.updated.trim() ?? '';
    final empty = points.isEmpty && folded.isEmpty;
    return _card(
      key: const ValueKey('session-memory-card'),
      label: 'SESSION MEMORY',
      trailing: _countChip('history'),
      padding: EdgeInsets.fromLTRB(14, empty ? 8 : 10, 14, empty ? 8 : 10),
      gap: empty ? 4 : 6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The label copy wraps at a narrow window instead of overflowing the
          // card header. It is the one line that says what this card is.
          Text(
            'session memory · not a source',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              letterSpacing: 0.4,
            ),
          ),
          if (empty) ...[
            const SizedBox(height: 2),
            Text(
              'no memory yet · it fills after a completed chat turn',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.25,
              ),
            ),
          ] else ...[
            const SizedBox(height: 8),
            for (final point in points) _memoryPoint(point),
            if (folded.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'earlier',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.0,
                ),
              ),
              const SizedBox(height: 4),
              for (final line in folded) _memoryFolded(line),
            ],
            if (updated.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'updated ${shortStamp(updated)}',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _memoryPoint(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '•',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.body,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.body,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _memoryFolded(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text(
        '· $text',
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.label,
          height: 1.4,
        ),
      ),
    );
  }

  /// True when the shell supplied any coverage state.
  ///
  /// A shell that has not wired `session.coverage` passes nothing, and the card
  /// stays hidden: rendering the empty state there would claim the session has
  /// no sources when nothing was read.
  bool get _coverageWired =>
      widget.coverage != null ||
      widget.coverageLoading ||
      widget.coverageError != null ||
      widget.onRetryCoverage != null;

  /// The session's source coverage, read from `session.coverage`.
  ///
  /// The card is read-only: it counts mentions and reports the gaps, and it
  /// never toggles, builds, writes or asks for a model call. Its one action is
  /// the retry beside a failed read. It says plainly that a mention is a lexical
  /// fact, not proof that a claim came from that source, and that memory is a
  /// labelled document rather than a source.
  Widget _coverageCard() {
    final report = widget.coverage;
    final loading = widget.coverageLoading;
    final error = widget.coverageError;
    final full = report?.fullyCovered ?? false;
    final header = report == null
        ? (loading ? 'reading…' : 'no report')
        : '${report.referencedCount} of ${report.total} sources referenced';
    return _card(
      key: const ValueKey('session-coverage-card'),
      label: 'COVERAGE',
      trailing: _countChip(
        header,
        tone: full ? LockedInColors.success : LockedInColors.muted,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'which sources the steps, chat, outputs and memory mention',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              letterSpacing: 0.4,
            ),
          ),
          if (loading && report != null) ...[
            const SizedBox(height: 8),
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          ],
          if (report != null && !report.hasNoSources) ...[
            const SizedBox(height: 8),
            // Each source is listed once: the referenced ones with their
            // counts here, the rest under `not referenced yet`. Listing every
            // source in both places printed a session with no mentions twice.
            for (var index = 0; index < report.sources.length; index++)
              if (report.sources[index].referenced)
                _coverageSourceRow(report.sources[index], index),
            if (report.unreferenced.isNotEmpty) ...[
              if (report.referencedCount > 0) const SizedBox(height: 10),
              Text(
                'not referenced yet',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.0,
                ),
              ),
              const SizedBox(height: 4),
              for (var index = 0; index < report.unreferenced.length; index++)
                _coverageGapRow(report.unreferenced[index], index),
              const SizedBox(height: 6),
              Text(
                'mention a source in chat or the steps, or add steps',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.4,
                ),
              ),
            ],
          ] else if (report != null && !loading && error == null) ...[
            const SizedBox(height: 2),
            Text(
              'no sources yet · add sources so coverage can be measured',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.25,
              ),
            ),
          ],
          if (loading && report == null) ...[
            const SizedBox(height: 8),
            Text(
              'loading coverage…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
          if (error != null) ...[
            const SizedBox(height: 10),
            _coverageFailure(error),
          ],
          const SizedBox(height: 10),
          Text(
            'a mention is a lexical fact, not proof that a claim came from '
            'that source',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }

  /// One source row: name, how often it is mentioned and where.
  Widget _coverageSourceRow(SourceCoverage source, int index) {
    final name = source.name.trim().isEmpty
        ? (source.originalPath.trim().isEmpty
              ? 'unnamed source'
              : source.originalPath)
        : source.name;
    final documents = [
      for (final kind in source.documents)
        if (kind.trim().isNotEmpty) kind,
    ];
    final count = source.count;
    final detail = [
      '$count ${count == 1 ? 'mention' : 'mentions'}',
      if (documents.isNotEmpty) documents.join(' · '),
    ].join(' · ');
    return Padding(
      key: ValueKey('coverage-source-$index'),
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            source.referenced
                ? Icons.check_circle_outline
                : Icons.remove_circle_outline,
            size: 14,
            color: source.referenced
                ? LockedInColors.success
                : LockedInColors.muted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.body,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  detail,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.label,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          if (source.fromMemoryOnly) ...[
            const SizedBox(width: 8),
            _countChip('history only'),
          ],
        ],
      ),
    );
  }

  /// One gap row: a source nothing but the source list mentions yet.
  Widget _coverageGapRow(SourceCoverage source, int index) {
    final name = source.name.trim().isEmpty
        ? (source.originalPath.trim().isEmpty
              ? 'unnamed source'
              : source.originalPath)
        : source.name;
    return Padding(
      key: ValueKey('coverage-gap-$index'),
      padding: const EdgeInsets.only(bottom: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.circle_outlined, size: 12, color: LockedInColors.muted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.key,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// One readable coverage refusal with the retry that makes it actionable. The
  /// previous report stays above it: a failed read never discards a report the
  /// core already sent.
  Widget _coverageFailure(String message) {
    return Container(
      key: const ValueKey('coverage-error'),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 15, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'could not read coverage',
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: TypeScale.key,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    message,
                    style: TextStyle(
                      color: LockedInColors.error,
                      fontSize: TypeScale.label,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('coverage-retry'),
            onPressed: widget.onRetryCoverage,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  /// The study tools: the three generated session documents this session can
  /// build. `1` and `2` run immediately; `3` needs one attempt first.
  ///
  /// Every row says the result is a generated document, not a source, because
  /// these files are written into the session and never enter source coverage.
  Widget _studyToolsCard() {
    final enabled = widget.onGenerateDocument != null;
    final busy = widget.documentLoading || _startingDocument;
    return _card(
      label: 'STUDY TOOLS',
      trailing: _countChip('generated · not sources'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Build a study document from this session\'s own sources. It is '
            'saved inside the session folder and is never counted as a source.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _studyButton(
                keyName: 'study-contract',
                icon: Icons.rule_outlined,
                label: '1 done-when contract',
                onPressed: enabled && !busy
                    ? () => unawaited(_startDocument('contract'))
                    : null,
              ),
              _studyButton(
                keyName: 'study-contradictions',
                icon: Icons.compare_arrows,
                label: '2 contradictions',
                onPressed: enabled && !busy
                    ? () => unawaited(_startDocument('contradictions'))
                    : null,
              ),
              _studyButton(
                keyName: 'study-check',
                icon: Icons.fact_check_outlined,
                label: '3 check an attempt',
                onPressed: enabled && !busy
                    ? () => unawaited(_startDocument('check'))
                    : null,
              ),
            ],
          ),
          if (busy) ...[
            const SizedBox(height: 10),
            Text(
              'generating…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
          if (widget.onOpenOutput != null) ...[
            const SizedBox(height: 14),
            Text(
              'Read the study guide or deck built from this session.',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _studyButton(
                  keyName: 'study-guide-open',
                  icon: Icons.menu_book_outlined,
                  label: 'g study guide',
                  onPressed: busy ? null : () => _openOutput('study-guide'),
                ),
                _studyButton(
                  keyName: 'flashcards-open',
                  icon: Icons.style_outlined,
                  label: 'f flashcards',
                  onPressed: busy ? null : () => _openOutput('flashcards'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
