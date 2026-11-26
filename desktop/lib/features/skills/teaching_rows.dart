import 'package:material_ui/material_ui.dart';

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
