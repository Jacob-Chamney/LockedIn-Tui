import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../shell/chrome.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

class ConfidenceKey extends StatelessWidget {
  const ConfidenceKey({
    super.key,
    required this.level,
    required this.selected,
    required this.onTap,
  });

  final int level;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'confidence $level of 5',
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        child: Container(
          width: 22,
          height: 22,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? LockedInColors.primary : Colors.transparent,
            border: Border.all(
              color: selected ? LockedInColors.primary : LockedInColors.line,
              width: Stroke.hairline,
            ),
            borderRadius: BorderRadius.circular(Radii.control),
          ),
          child: Text(
            '$level',
            style: LockedInType.micro.copyWith(
              color: selected
                  ? Theme.of(context).colorScheme.onPrimary
                  : LockedInColors.muted,
              letterSpacing: 0,
            ),
          ),
        ),
      ),
    );
  }
}

class PlanRow extends StatelessWidget {
  const PlanRow({
    super.key,
    required this.number,
    required this.title,
    required this.passed,
    required this.current,
    this.depth = 0,
    this.needs = 0,
    this.locked = false,
    this.blockedBy = const [],
    this.onTap,
  });

  final int number;
  final String title;
  final bool passed;
  final bool current;

  /// How far down the prerequisite map this step sits; drives the indent.
  final int depth;

  /// How many earlier steps it builds on (0 = a root).
  final int needs;

  /// True when a prerequisite is not held yet. A locked row is legible but not
  /// an invitation: the tree says what unlocks it instead of opening it.
  final bool locked;

  /// The titles of the steps that still block this one, in plan order.
  final List<String> blockedBy;

  /// Open this step when it is available. A locked or held row has none.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tone = current
        ? LockedInColors.foreground
        : passed
        ? LockedInColors.muted
        : locked
        ? LockedInColors.muted
        : LockedInColors.secondary;
    final after = blockedBy.isEmpty ? '' : blockedBy.join(', ');
    return Semantics(
      label: locked
          ? '$title — locked${after.isEmpty ? '' : '; after $after'}'
          : title,
      selected: current,
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: Space.xs - 3),
          decoration: BoxDecoration(
            color: current ? LockedInColors.panel : Colors.transparent,
            border: Border(
              left: BorderSide(
                color: current ? LockedInColors.primary : Colors.transparent,
                width: Stroke.focus,
              ),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // The map, not a list: a branch is indented under what it needs.
              if (depth > 0) ...[
                SizedBox(width: 14.0 * (depth - 1)),
                SizedBox(
                  width: 14,
                  child: Text(
                    '└',
                    style: LockedInType.micro.copyWith(
                      color: LockedInColors.line,
                    ),
                  ),
                ),
              ],
              SizedBox(
                width: 32,
                child: locked
                    ? Icon(
                        Icons.lock_outline,
                        size: 13,
                        color: LockedInColors.muted,
                      )
                    : Text(
                        passed ? '✓' : '$number',
                        textAlign: TextAlign.center,
                        style: LockedInType.micro.copyWith(
                          color: passed ? LockedInColors.success : tone,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
              ),
              const SizedBox(width: Space.xs),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: LockedInType.body.copyWith(
                        fontSize: TypeScale.key,
                        color: tone,
                      ),
                    ),
                    if (locked && after.isNotEmpty)
                      Text(
                        'after $after',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LockedInType.micro.copyWith(
                          color: LockedInColors.muted,
                          letterSpacing: 0,
                        ),
                      ),
                  ],
                ),
              ),
              if (current)
                Text(
                  'here',
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.primary,
                    letterSpacing: 0,
                  ),
                )
              else if (locked)
                Text(
                  'locked',
                  style: LockedInType.micro.copyWith(
                    color: LockedInColors.muted,
                    letterSpacing: 0,
                  ),
                )
              else if (needs > 1)
                Padding(
                  padding: const EdgeInsets.only(left: Space.xxs),
                  child: Text(
                    'needs $needs',
                    style: LockedInType.micro.copyWith(
                      color: LockedInColors.muted,
                      letterSpacing: 0,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One practice problem: the task, the verdict keys, and the key on demand.
///
/// The answer is collapsed until asked for, because reading it first turns
/// practice into recognition — the thing the method is trying to avoid.

class PracticeRow extends StatefulWidget {
  const PracticeRow({
    super.key,
    required this.problem,
    required this.solved,
    required this.missed,
    required this.onVerdict,
  });

  final TeachingProblem problem;
  final bool solved;
  final bool missed;
  final ValueChanged<String>? onVerdict;

  @override
  State<PracticeRow> createState() => PracticeRowState();
}

class PracticeRowState extends State<PracticeRow> {
  var _revealed = false;

  @override
  Widget build(BuildContext context) {
    final tone = widget.solved
        ? LockedInColors.success
        : widget.missed
        ? LockedInColors.warning
        : LockedInColors.muted;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        Space.sm,
        Space.xs,
        Space.sm,
        Space.xs,
      ),
      decoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: tone, width: Stroke.focus),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.problem.prompt,
            style: LockedInType.proseSmall.copyWith(
              color: LockedInColors.foreground,
            ),
          ),
          const SizedBox(height: Space.xs),
          Row(
            children: [
              TextButton(
                key: ValueKey('practice-reveal-${widget.problem.id}'),
                onPressed: () => setState(() => _revealed = !_revealed),
                child: Text(_revealed ? 'hide key' : 'show key'),
              ),
              const Spacer(),
              if (widget.solved)
                StatusTag(
                  glyph: '✓',
                  label: 'solved',
                  tone: LockedInColors.success,
                )
              else if (widget.missed)
                StatusTag(
                  glyph: '!',
                  label: 'revisit',
                  tone: LockedInColors.warning,
                )
              else ...[
                TextButton(
                  key: ValueKey('practice-missed-${widget.problem.id}'),
                  onPressed: widget.onVerdict == null
                      ? null
                      : () => widget.onVerdict!('missed'),
                  child: const Text('missed'),
                ),
                const SizedBox(width: Space.xxs),
                FilledButton(
                  key: ValueKey('practice-solved-${widget.problem.id}'),
                  onPressed: widget.onVerdict == null
                      ? null
                      : () => widget.onVerdict!('solved'),
                  style: FilledButton.styleFrom(
                    backgroundColor: LockedInColors.success,
                    foregroundColor: Theme.of(context).colorScheme.onPrimary,
                  ),
                  child: const Text('solved'),
                ),
              ],
            ],
          ),
          if (_revealed) ...[
            const SizedBox(height: Space.xxs),
            Text(
              widget.problem.answer,
              key: ValueKey('practice-answer-${widget.problem.id}'),
              style: LockedInType.proseSmall.copyWith(
                color: LockedInColors.secondary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The four phases of a teaching session (`desktop/docs/redesign.md` §2.1).
enum Phase { measure, plan, teach, practice }

/// One phase in the rail: number, name, and how far into it the session is.

class PhaseRow extends StatelessWidget {
  const PhaseRow({
    super.key,
    required this.number,
    required this.label,
    required this.summary,
    required this.selected,
    required this.compact,
    required this.onTap,
  });

  final int number;
  final String label;
  final String summary;
  final bool selected;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = selected ? LockedInColors.primary : LockedInColors.muted;
    return Tooltip(
      message: compact ? '$number $label · $summary' : '',
      waitDuration: const Duration(milliseconds: 400),
      child: InkWell(
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.symmetric(
            horizontal: Space.xxs,
            vertical: 1,
          ),
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 0 : Space.xs,
            vertical: Space.xs - 2,
          ),
          decoration: BoxDecoration(
            color: selected ? LockedInColors.panel : Colors.transparent,
            border: Border(
              left: BorderSide(
                color: selected ? LockedInColors.primary : Colors.transparent,
                width: Stroke.focus,
              ),
            ),
          ),
          child: compact
              ? Center(
                  child: Text(
                    '$number',
                    style: LockedInType.key.copyWith(color: tone),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          '$number',
                          style: LockedInType.micro.copyWith(
                            color: tone,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: Space.xs),
                        Text(
                          label,
                          style: LockedInType.body.copyWith(
                            fontSize: TypeScale.key,
                            color: selected
                                ? LockedInColors.foreground
                                : LockedInColors.muted,
                            fontWeight: selected
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      ],
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 14, top: 1),
                      child: Text(
                        summary,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: LockedInType.micro.copyWith(
                          color: LockedInColors.muted,
                          fontWeight: FontWeight.w400,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
