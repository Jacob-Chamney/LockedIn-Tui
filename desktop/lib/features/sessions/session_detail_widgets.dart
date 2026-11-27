part of 'session_detail.dart';

/// The step rows, failure surfaces and the small card primitives.
extension _SessionDetailWidgets on _SessionDetailViewState {
  /// detail never advertises a dead key.
  String _stepsHint({
    required bool interactive,
    required bool canGenerate,
    required bool canSettings,
    required bool canOutputs,
  }) {
    return [
      if (interactive) 'Space toggle',
      if (canGenerate) 'R rebuild',
      if (canOutputs) 'g guide · f cards',
      if (canSettings) 's settings',
      'Enter chat',
      'Esc back',
    ].join(' · ');
  }

  Widget _stepRow(StepRow row, {required bool selected}) {
    if (row.heading) {
      return Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 6),
        child: Text(
          row.text,
          style: TextStyle(
            color: LockedInColors.foreground,
            fontSize: TypeScale.proseSmall,
            fontWeight: FontWeight.w700,
            height: 1.35,
          ),
        ),
      );
    }

    final index = row.index;
    if (index == null) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 3),
        child: Text(
          row.text,
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.key,
            height: 1.4,
          ),
        ),
      );
    }

    final checked = row.checked ?? false;
    return Padding(
      key: ValueKey('step-row-$index'),
      padding: const EdgeInsets.only(bottom: 4),
      child: GestureDetector(
        key: _stepKey(index),
        behavior: HitTestBehavior.opaque,
        onTap: () => refresh(() => _selectedStep = index),
        child: Container(
          key: selected ? const ValueKey('step-row-selected') : null,
          padding: const EdgeInsets.fromLTRB(0, 7, 10, 7),
          decoration: BoxDecoration(
            color: selected ? LockedInColors.panel : Colors.transparent,
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
                height: 20,
                decoration: BoxDecoration(
                  color: selected ? LockedInColors.primary : Colors.transparent,
                  borderRadius: const BorderRadius.horizontal(
                    right: Radius.circular(Radii.control),
                  ),
                ),
              ),
              const SizedBox(width: 9),
              // The glyph is the pointer's toggle: a checkbox that cannot be
              // clicked is the first thing a mouse user tries.
              InkWell(
                key: ValueKey('step-check-$index'),
                borderRadius: BorderRadius.circular(Radii.control),
                onTap: widget.onToggleStep == null
                    ? null
                    : () {
                        refresh(() => _selectedStep = index);
                        unawaited(_toggle(index));
                      },
                child: SizedBox(
                  width: 26,
                  height: 22,
                  child: Center(
                    child: Text(
                      checked ? '☑' : '☐',
                      style: TextStyle(
                        color: checked
                            ? LockedInColors.success
                            : LockedInColors.muted,
                        fontSize: TypeScale.prose,
                        height: 1.2,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  row.text,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: TypeScale.proseSmall,
                    height: 1.45,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stepError(String message) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
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
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// A generation refusal, with the retry that makes it actionable. The previous
  /// steps stay above it: a failed build never throws away the file on screen.
  Widget _generationError(String message, {required VoidCallback? onRetry}) {
    return Container(
      key: const ValueKey('steps-error'),
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
              child: Text(
                message,
                style: TextStyle(
                  color: LockedInColors.error,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: const ValueKey('steps-retry'),
            onPressed: onRetry,
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  /// Record the text in the form. A refused write keeps the text, so the
  /// learner can shorten it instead of retyping.
  Future<void> _recordMistake() async {
    final record = widget.onRecordMistake;
    if (record == null || _mistakeBusy) return;
    final text = _mistakeText.text.trim();
    if (text.isEmpty) {
      refresh(() => _mistakeNotice = 'write the mistake first');
      return;
    }
    final step = _mistakeStep.text.trim();
    refresh(() {
      _mistakeBusy = true;
      _mistakeNotice = null;
    });
    try {
      await record(text, step: step.isEmpty ? null : step);
      _mistakeText.clear();
      _mistakeStep.clear();
      if (mounted) refresh(() => _mistakeNotice = 'recorded');
    } catch (failure) {
      if (mounted) refresh(() => _mistakeNotice = userMessage(failure));
    } finally {
      if (mounted) refresh(() => _mistakeBusy = false);
    }
  }

  /// Ask for the corrected understanding, then promote. An empty correction is
  /// allowed: the note then says it is not written yet rather than pretending
  /// the mistake is settled.
  Future<void> _promoteMistake(int index) async {
    final promote = widget.onPromoteMistake;
    if (promote == null || _mistakeBusy) return;
    final correction = await _askCorrection(index);
    if (correction == null || !mounted) return;
    refresh(() {
      _mistakeBusy = true;
      _mistakeNotice = null;
    });
    try {
      final outcome = await promote(
        index,
        correction: correction.trim().isEmpty ? null : correction.trim(),
      );
      final name = outcome.note.path.split('/').last;
      if (mounted) {
        refresh(
          () => _mistakeNotice = outcome.already
              ? 'already promoted to $name'
              : 'promoted to $name',
        );
      }
    } catch (failure) {
      if (mounted) refresh(() => _mistakeNotice = userMessage(failure));
    } finally {
      if (mounted) refresh(() => _mistakeBusy = false);
    }
  }

  /// Write the right answer under a promoted note.
  Future<void> _correctMistake(int index) async {
    final correct = widget.onCorrectMistake;
    if (correct == null || _mistakeBusy) return;
    final correction = await _askCorrection(index, correcting: true);
    if (correction == null || !mounted) return;
    final text = correction.trim();
    if (text.isEmpty) {
      refresh(() => _mistakeNotice = 'write the correction first');
      return;
    }
    refresh(() {
      _mistakeBusy = true;
      _mistakeNotice = null;
    });
    try {
      await correct(index, text);
      if (mounted) refresh(() => _mistakeNotice = 'corrected');
    } catch (failure) {
      if (mounted) refresh(() => _mistakeNotice = userMessage(failure));
    } finally {
      if (mounted) refresh(() => _mistakeBusy = false);
    }
  }

  Future<String?> _askCorrection(int index, {bool correcting = false}) async {
    final controller = _correctionController..clear();
    final answer = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          correcting
              ? 'correct mistake ${index + 1}'
              : 'promote mistake ${index + 1}',
        ),
        content: SizedBox(
          width: 520,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'This writes a knowledge note in the school vault, labelled '
                'with the session and step it came from. It is your own record, '
                'not a source. The corrected understanding is optional.',
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: ValueKey('mistake-correction-$index'),
                controller: controller,
                autofocus: true,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  hintText: 'what is right, in your own words',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            key: const ValueKey('mistake-promote-cancel'),
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: ValueKey('mistake-promote-confirm-$index'),
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: Text(correcting ? 'Save correction' : 'Promote'),
          ),
        ],
      ),
    );
    return answer;
  }

  Widget _card({
    required String label,
    required Widget child,
    Widget? trailing,
    Key? key,
    EdgeInsets? padding,
    double gap = 10,
  }) {
    final theme = Theme.of(context);
    return Container(
      key: key,
      padding: padding ?? const EdgeInsets.fromLTRB(14, 12, 14, 14),
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
          SizedBox(height: gap),
          child,
        ],
      ),
    );
  }

  Widget _countChip(String text, {Color? tone}) {
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
          color: tone ?? LockedInColors.muted,
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _errorBanner(String message) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.layer),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, size: 16, color: LockedInColors.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: LockedInColors.error,
                fontSize: TypeScale.label,
                height: 1.45,
              ),
            ),
          ),
          if (widget.onRetry != null) ...[
            const SizedBox(width: 8),
            TextButton(onPressed: widget.onRetry, child: const Text('Retry')),
          ],
        ],
      ),
    );
  }

  Widget _stateCard({
    required IconData icon,
    required Color tone,
    required String title,
    required String body,
    required List<Widget> actions,
  }) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(Radii.layer),
              border: Border.all(color: LockedInColors.line),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 17, color: tone),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(title, style: theme.textTheme.titleMedium),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: TypeScale.body,
                    height: 1.5,
                  ),
                ),
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.end,
                    children: actions,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
