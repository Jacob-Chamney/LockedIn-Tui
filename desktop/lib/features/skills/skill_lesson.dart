import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../chat/transcript_scroll.dart';
import '../keys.dart';
import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../chat/markdown.dart';
import '../shared/cards.dart';

/// One curriculum stage's lesson, read or built.
///
/// The shell owns the store and passes this stage's own state in; `b` is an
/// intent and the document on screen changes only when the core replies. The
/// page reads no files and calls no core method, so the Markdown and the
/// citations are the core's answer, never a shell rewrite.
///
/// A stage with no lesson is a normal state: the reader says so and offers the
/// build. A build of an already `ready` lesson is refused by the core with a
/// `confirm` message, which is shown here verbatim — the page never confirms on
/// the user's behalf.
class SkillLessonView extends StatefulWidget {
  const SkillLessonView({
    super.key,
    required this.stageId,
    required this.stageTitle,
    required this.markdown,
    required this.exists,
    required this.citations,
    this.stageStatus = '',
    this.goalName = '',
    this.status = '',
    this.loading = false,
    this.error,
    this.onBack,
    this.onBuild,
    this.onRebuild,
    this.onRetry,
    this.needsConfirm = false,
    this.onReplace,
  });

  /// The stage folder id the core resolved (`stage-1`, `stage-2`, …).
  final String stageId;

  /// The stage title from the goal index.
  final String stageTitle;

  /// `pending`, `active` or `done`, from the goal index.
  final String stageStatus;

  /// The goal's display name, for the header context.
  final String goalName;

  /// The lesson's own Markdown, exactly as the core returned it.
  final String markdown;

  /// False when the stage has no lesson file yet.
  final bool exists;

  /// `draft`, `ready` or empty (a read reports no lesson status).
  final String status;

  /// The citations the lesson's frontmatter records; labelled as source
  /// citations, never mixed into the body.
  final List<SkillCitation> citations;

  final bool loading;

  /// One readable failure from the shell, shown with a retry.
  final String? error;

  /// `Esc` and the back control return to the goal page.
  final VoidCallback? onBack;

  /// Build this stage's lesson (`skill.lesson.build`). Null hides the action.
  final VoidCallback? onBuild;

  /// Rebuild an existing lesson. It is the same core call as [onBuild]; the
  /// difference is the user's intent, and a `ready` lesson answers with the
  /// core's confirm message instead of a write.
  final VoidCallback? onRebuild;

  /// Repeat the read or build that failed.
  final VoidCallback? onRetry;

  /// True when the only reason the build failed is that the lesson is already
  /// `ready`. The card then offers a named replacement, not a dead Retry.
  final bool needsConfirm;

  /// Replace the existing ready lesson, after the caller asked by name.
  final VoidCallback? onReplace;

  @override
  State<SkillLessonView> createState() => _SkillLessonViewState();
}

class _SkillLessonViewState extends State<SkillLessonView> {
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) {
      if (widget.onBack == null) return KeyEventResult.ignored;
      widget.onBack!();
      return KeyEventResult.handled;
    }
    // A lesson is long: scroll it from the keyboard.
    final scrolled = scrollKey(_scroll, event);
    if (scrolled != null) return scrolled;
    if (widget.loading) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.keyB) {
      if (widget.onBuild == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) widget.onBuild!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR &&
        HardwareKeyboard.instance.isShiftPressed) {
      if (widget.onRebuild == null) return KeyEventResult.ignored;
      if (event is KeyDownEvent) widget.onRebuild!();
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
          _header(),
          if (widget.loading)
            LinearProgressIndicator(
              minHeight: 2,
              color: LockedInColors.primary,
              backgroundColor: LockedInColors.line,
            ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _header() {
    final theme = Theme.of(context);
    final title = widget.stageTitle.trim().isEmpty
        ? 'staged lesson'
        : widget.stageTitle;
    final status = widget.status.trim();
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 14, 8),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back to the goal',
            onPressed: widget.onBack,
            icon: const Icon(Icons.arrow_back, size: 18),
          ),
          const SizedBox(width: 2),
          Container(width: 3, height: 28, color: LockedInColors.primary),
          const SizedBox(width: 10),
          Expanded(
            flex: 3,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium,
                ),
                Text(
                  _subtitle(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          if (status.isNotEmpty) ValueChip('lesson · $status'),
          if (widget.loading) ...[
            const SizedBox(width: 10),
            SizedBox(
              width: 15,
              height: 15,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: LockedInColors.primary,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _subtitle() {
    final parts = <String>[
      widget.stageId,
      if (widget.stageStatus.isNotEmpty) widget.stageStatus,
      if (widget.goalName.isNotEmpty) widget.goalName,
    ];
    return parts.join(' · ');
  }

  Widget _body() {
    if (widget.loading && widget.markdown.trim().isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: LockedInColors.primary,
              ),
            ),
            SizedBox(height: 14),
            Text(
              'loading lesson…',
              style: TextStyle(color: LockedInColors.muted, fontSize: 12),
            ),
          ],
        ),
      );
    }

    final error = widget.error;
    if (error != null) {
      // A `confirm` refusal is not a failure to retry: replacing a ready
      // lesson is a decision, so it is asked by name.
      final replace = widget.needsConfirm && widget.onReplace != null;
      return _stateCard(
        icon: Icons.error_outline,
        tone: replace ? LockedInColors.warning : LockedInColors.error,
        title: replace
            ? 'this lesson is already ready'
            : 'could not build or read this lesson',
        body: error,
        actions: [
          if (replace)
            FilledButton(
              key: const ValueKey('skill-lesson-replace'),
              onPressed: widget.onReplace,
              child: const Text('Replace lesson'),
            )
          else if (widget.onRetry != null)
            FilledButton(
              key: const ValueKey('skill-lesson-retry'),
              onPressed: widget.onRetry,
              child: const Text('Retry'),
            ),
          if (widget.onBack != null)
            OutlinedButton(
              onPressed: widget.onBack,
              child: const Text('Back to the goal'),
            ),
        ],
      );
    }

    if (!widget.exists || widget.markdown.trim().isEmpty) {
      return _stateCard(
        icon: Icons.auto_stories_outlined,
        tone: LockedInColors.warning,
        title: 'no lesson for this stage yet',
        body:
            'Build a draft from this goal’s gathered sources. Every paragraph '
            'either cites one of them or is labelled as an agent explanation.',
        actions: [
          if (widget.onBuild != null)
            FilledButton.icon(
              key: const ValueKey('skill-lesson-build'),
              onPressed: widget.onBuild,
              icon: const Icon(Icons.construction_outlined, size: 16),
              label: const Text('Build lesson'),
            ),
          if (widget.onBack != null)
            OutlinedButton(
              onPressed: widget.onBack,
              child: const Text('Back to the goal'),
            ),
        ],
      );
    }

    return ListView(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
      children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ChatMarkdown(text: widget.markdown),
                if (widget.citations.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  _citationsCard(widget.citations),
                ],
                const SizedBox(height: 18),
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  children: [
                    if (widget.onBuild != null)
                      OutlinedButton.icon(
                        key: const ValueKey('skill-lesson-build'),
                        onPressed: widget.onBuild,
                        icon: const Icon(Icons.construction_outlined, size: 16),
                        label: const Text('b build'),
                      ),
                    if (widget.onRebuild != null)
                      OutlinedButton.icon(
                        key: const ValueKey('skill-lesson-rebuild'),
                        onPressed: widget.onRebuild,
                        icon: const Icon(Icons.refresh, size: 16),
                        label: const Text('R rebuild'),
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'Esc back',
                  style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The lesson's own citations, kept apart from the body and labelled so a
  /// source fact is never confused with the model's prose.
  Widget _citationsCard(List<SkillCitation> citations) {
    return SectionCard(
      label: 'SOURCE CITATIONS',
      trailing: ValueChip(
        citations.length == 1 ? '1 source' : '${citations.length} sources',
        tone: LockedInColors.secondary,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'These are the gathered sources this lesson cites. A paragraph '
            'without a citation is marked as an agent explanation.',
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 12,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 10),
          for (var index = 0; index < citations.length; index++) ...[
            if (index > 0)
              Divider(height: 1, thickness: 1, color: LockedInColors.line),
            _citationRow(citations[index]),
          ],
        ],
      ),
    );
  }

  Widget _citationRow(SkillCitation citation) {
    final name = citation.name.trim();
    final excerpt = citation.excerpt.trim();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.format_quote_outlined,
            size: 15,
            color: LockedInColors.muted,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name.isEmpty ? 'unnamed source' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: LockedInColors.foreground,
                    fontSize: 13,
                  ),
                ),
                if (citation.location.trim().isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    citation.location,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 10.5,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
                if (excerpt.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    excerpt,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: 11.5,
                      height: 1.45,
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

  Widget _stateCard({
    required IconData icon,
    required Color tone,
    required String title,
    required String body,
    required List<Widget> actions,
  }) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Container(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            decoration: BoxDecoration(
              color: LockedInColors.surface,
              borderRadius: BorderRadius.circular(10),
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
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  style: TextStyle(
                    color: LockedInColors.muted,
                    fontSize: 13,
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
