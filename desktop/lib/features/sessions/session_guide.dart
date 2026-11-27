part of 'session_outputs.dart';

extension _SessionOutputGuide on _SessionOutputViewState {
  /// One chip per section: the pointer path for marking it reviewed.
  Widget _guideSectionList(List<_GuideSection> sections) {
    final done = sections.where((section) => section.checked).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '$done of ${sections.length} reviewed · [ ] move · x mark · click a '
          'section',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            for (var index = 0; index < sections.length; index++)
              InkWell(
                key: ValueKey('guide-section-$index'),
                borderRadius: BorderRadius.circular(Radii.control),
                onTap: () {
                  refresh(() => _sectionCursor = index);
                  unawaited(widget.onMarkSection!.call(index));
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: LockedInColors.panel,
                    borderRadius: BorderRadius.circular(Radii.control),
                    border: Border.all(
                      color: index == _sectionCursor
                          ? LockedInColors.primary
                          : LockedInColors.line,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        sections[index].checked ? '☑' : '☐',
                        style: TextStyle(
                          color: sections[index].checked
                              ? LockedInColors.success
                              : LockedInColors.muted,
                          fontSize: TypeScale.label,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        sections[index].title,
                        style: TextStyle(
                          color: sections[index].checked
                              ? LockedInColors.muted
                              : LockedInColors.foreground,
                          fontSize: TypeScale.label,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }

  List<Widget> _answersSection() {
    final answers = widget.answers;
    return [
      const SizedBox(height: 16),
      Divider(height: 1, thickness: 1, color: LockedInColors.line),
      const SizedBox(height: 10),
      Text(
        'ANSWERS',
        style: TextStyle(
          color: LockedInColors.secondary,
          fontSize: TypeScale.micro,
          letterSpacing: 1.4,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 8),
      if (answers != null && answers.trim().isNotEmpty)
        ChatMarkdown(text: answers)
      else if (_answersLoading)
        Text(
          'reading…',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
        )
      else if (answers != null)
        Text(
          'no answers document yet — rebuild the guide to create one',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
            height: 1.45,
          ),
        )
      else
        Text(
          'the answers part is not loaded yet',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
            height: 1.45,
          ),
        ),
    ];
  }

  Widget _emptyState() {
    final busy = widget.loading || _pending != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.info_outline, size: 14, color: LockedInColors.warning),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _isDeck ? 'no flashcard deck yet' : 'no study guide yet',
                style: TextStyle(
                  color: LockedInColors.warning,
                  fontSize: TypeScale.key,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          _isDeck
              ? 'A deck is built from this session\'s own sources and saved as '
                    'a generated output. It is never counted as a source.'
              : 'A study guide is built from this session\'s own sources, with '
                    'a matching answers document, and saved as a generated '
                    'output. It is never counted as a source.',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
            height: 1.45,
          ),
        ),
        if (widget.onBuild != null) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              key: const ValueKey('session-output-build'),
              onPressed: busy ? null : () => unawaited(_build(confirm: false)),
              icon: busy
                  ? const Icon(Icons.hourglass_top, size: 16)
                  : const Icon(Icons.auto_awesome_outlined, size: 16),
              label: Text(
                busy
                    ? 'building…'
                    : _isDeck
                    ? 'build flashcards'
                    : 'build study guide',
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _loadingRow() {
    return Row(
      children: [
        SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: LockedInColors.primary,
          ),
        ),
        const SizedBox(width: 10),
        Text(
          _pending ?? 'reading…',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.label,
          ),
        ),
      ],
    );
  }

  /// One readable failure with the retry that makes it actionable. The previous
  /// document, when there is one, stays above it.
  Widget _error(String message) {
    return Container(
      key: const ValueKey('session-output-error'),
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
                    _lastWasBuild
                        ? 'could not build this output'
                        : 'could not open this output',
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
            key: const ValueKey('session-output-retry'),
            onPressed: widget.onRetry == null || widget.loading
                ? null
                : () => unawaited(_retry()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _card({
    required String label,
    required Widget child,
    Widget? trailing,
  }) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: LockedInColors.secondary,
                  letterSpacing: 1.4,
                ),
              ),
              const Spacer(),
              ?trailing,
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }

  Widget _chip(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: LockedInColors.muted,
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
