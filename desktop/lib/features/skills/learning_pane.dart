import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// The learning tree beside a goal chat.
///
/// A goal chat answers questions about the goal's sources; the tree is the
/// route. Keeping it beside the transcript on a wide window means a learner can
/// see what they hold and what comes next without leaving the conversation.
/// Tapping an available step opens it and returns to the goal page.
class LearningPane extends StatelessWidget {
  const LearningPane({
    super.key,
    required this.teaching,
    this.onOpenGoal,
    this.onMeasure,
    this.onOpenStep,
  });

  final TeachingState? teaching;
  final VoidCallback? onOpenGoal;
  final VoidCallback? onMeasure;
  final void Function(String stepId)? onOpenStep;

  @override
  Widget build(BuildContext context) {
    final record = teaching;
    final measured = record?.measured ?? false;
    return Container(
      key: const ValueKey('skill-learning-pane'),
      color: LockedInColors.surface,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          Space.sm,
          Space.sm,
          Space.sm,
          Space.lg,
        ),
        children: [
          SectionLabel(
            'learning tree',
            trailing: measured
                ? '${record!.passedCount}/${record.plan.length} held'
                : null,
          ),
          const SizedBox(height: Space.xs),
          if (!measured) ...[
            Text(
              'Measure the goal to see the route. The tree appears here beside '
              'the chat once the core has a plan.',
              style: LockedInType.proseSmall.copyWith(
                color: LockedInColors.muted,
              ),
            ),
            const SizedBox(height: Space.sm),
            if (onMeasure != null)
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton(
                  key: const ValueKey('skill-pane-measure'),
                  onPressed: onMeasure,
                  child: const Text('measure what I hold'),
                ),
              )
            else if (onOpenGoal != null)
              TextButton(
                key: const ValueKey('skill-pane-open-goal'),
                onPressed: onOpenGoal,
                child: const Text('open the goal'),
              ),
          ] else ...[
            if (record!.held.isNotEmpty) ...[
              Text(
                'held',
                style: LockedInType.micro.copyWith(
                  color: LockedInColors.secondary,
                ),
              ),
              const SizedBox(height: Space.xxs),
              for (final item in record.held)
                Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: Text(
                    '✓ $item',
                    style: LockedInType.label.copyWith(
                      color: LockedInColors.success,
                      height: 1.45,
                    ),
                  ),
                ),
              const SizedBox(height: Space.sm),
            ],
            for (final (index, _) in record.plan.indexed)
              _PaneRow(teaching: record, index: index, onTap: onOpenStep),
            const SizedBox(height: Space.sm),
            if (onOpenGoal != null)
              TextButton(
                key: const ValueKey('skill-pane-open-goal'),
                onPressed: onOpenGoal,
                child: const Text('open the goal'),
              ),
          ],
        ],
      ),
    );
  }
}

class _PaneRow extends StatelessWidget {
  const _PaneRow({required this.teaching, required this.index, this.onTap});

  final TeachingState teaching;
  final int index;
  final void Function(String stepId)? onTap;

  @override
  Widget build(BuildContext context) {
    final step = teaching.plan[index];
    final passed = teaching.checks.any(
      (check) => check.stepId == step.id && check.verdict == 'correct',
    );
    final locked = teaching.lockedOf(index);
    final current = index == teaching.nextIndex;
    final tone = current
        ? LockedInColors.foreground
        : locked
        ? LockedInColors.muted
        : LockedInColors.secondary;
    return InkWell(
      key: ValueKey('skill-pane-step-${step.id}'),
      onTap: locked || passed || onTap == null ? null : () => onTap!(step.id),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 22,
              child: Text(
                passed
                    ? '✓'
                    : locked
                    ? '⊘'
                    : current
                    ? '▸'
                    : '○',
                style: LockedInType.micro.copyWith(
                  color: passed
                      ? LockedInColors.success
                      : current
                      ? LockedInColors.primary
                      : LockedInColors.muted,
                ),
              ),
            ),
            Expanded(
              child: Text(
                step.title,
                style: LockedInType.label.copyWith(color: tone, height: 1.4),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
