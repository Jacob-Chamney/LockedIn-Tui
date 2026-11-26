import 'dart:math';

import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import 'star_map.dart';
import '../../theme/tokens.dart';

/// The Achievements sky: constellation lines, a fixed dust field and one star
/// button per achievement.
///
/// Static by default — no repeating animation — because a forever-ticking
/// painter would make every `pumpAndSettle` in the shell suite hang, and the
/// screen has to be calm to be readable. What moves is the selection: a ring
/// fades in when the cursor lands on a star.
///
/// Mouse and keyboard are the same selection: hover moves the cursor, click
/// selects (and opens on a narrow layout), the arrow keys move by compass
/// direction, and every star is also a focus target for screen readers.
class StarField extends StatefulWidget {
  const StarField({
    super.key,
    required this.nodes,
    required this.selected,
    required this.onSelect,
    this.onOpen,
  });

  final List<StarNode> nodes;
  final int selected;

  /// Move the cursor to a star (hover or click).
  final ValueChanged<int> onSelect;

  /// Open the selected star's detail (Enter, or a click on a narrow layout).
  final ValueChanged<int>? onOpen;

  @override
  State<StarField> createState() => _StarFieldState();
}

class _StarFieldState extends State<StarField>
    with SingleTickerProviderStateMixin {
  late final AnimationController _selection = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 260),
    animationBehavior: AnimationBehavior.preserve,
  )..value = 1;

  @override
  void didUpdateWidget(covariant StarField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected == widget.selected) return;
    if (MediaQuery.disableAnimationsOf(context)) {
      _selection.value = 1;
      return;
    }
    _selection.forward(from: 0);
  }

  @override
  void dispose() {
    _selection.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        return Stack(
          children: [
            Positioned.fill(
              child: RepaintBoundary(
                child: CustomPaint(
                  painter: _SkyPainter(
                    nodes: widget.nodes,
                    selected: widget.selected,
                  ),
                ),
              ),
            ),
            for (final node in widget.nodes)
              Positioned(
                left: node.unit.dx * size.width - 16,
                top: node.unit.dy * size.height - 16,
                child: _Star(
                  node: node,
                  selected: node.index == widget.selected,
                  highlight: _selection,
                  onEnter: () => widget.onSelect(node.index),
                  onTap: () {
                    widget.onSelect(node.index);
                    widget.onOpen?.call(node.index);
                  },
                ),
              ),
          ],
        );
      },
    );
  }
}

/// One star: a glow for an unlocked achievement, a dim ring for a locked one,
/// and its name when the cursor is on it.
class _Star extends StatelessWidget {
  const _Star({
    required this.node,
    required this.selected,
    required this.highlight,
    required this.onEnter,
    required this.onTap,
  });

  final StarNode node;
  final bool selected;
  final Animation<double> highlight;
  final VoidCallback onEnter;
  final VoidCallback onTap;

  static const _starSize = 7.0;

  @override
  Widget build(BuildContext context) {
    final unlocked = node.row.unlocked;
    final colour = unlocked
        ? (selected ? LockedInColors.accent : LockedInColors.primary)
        : LockedInColors.muted;
    final label = node.row.name.isEmpty ? node.row.id : node.row.name;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => onEnter(),
      child: Tooltip(
        message: unlocked ? '$label · unlocked' : '$label · locked',
        waitDuration: const Duration(milliseconds: 500),
        child: GestureDetector(
          key: ValueKey('achievement-star-${node.row.id}'),
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            width: 32,
            height: 32,
            child: AnimatedBuilder(
              animation: highlight,
              builder: (context, _) {
                final pulse = selected ? highlight.value : 0.0;
                return Stack(
                  alignment: Alignment.center,
                  clipBehavior: Clip.none,
                  children: [
                    // The selection ring: what "the cursor is here" looks like
                    // without relying on colour alone (it is a shape).
                    if (pulse > 0)
                      Container(
                        width: 18 + 10 * pulse,
                        height: 18 + 10 * pulse,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: LockedInColors.foreground.withValues(
                              alpha: 0.35 + 0.45 * pulse,
                            ),
                          ),
                        ),
                      ),
                    if (unlocked)
                      Container(
                        width: 18,
                        height: 18,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: RadialGradient(
                            colors: [
                              colour.withValues(alpha: 0.55),
                              colour.withValues(alpha: 0.0),
                            ],
                          ),
                        ),
                      ),
                    Container(
                      width: _starSize,
                      height: _starSize,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: colour,
                      ),
                    ),
                    if (selected)
                      Positioned(
                        // A star near the bottom edge gets its label above, so
                        // the two lines stay inside the clipped sky.
                        top: node.unit.dy > 0.8 ? -34 : 30,
                        left: -40,
                        right: -40,
                        child: Text(
                          label,
                          key: ValueKey(
                            'achievement-star-label-${node.row.id}',
                          ),
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.foreground,
                            fontSize: 11,
                            height: 1.3,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// The constellation lines and the background dust, painted once per layout.
class _SkyPainter extends CustomPainter {
  _SkyPainter({required this.nodes, required this.selected});

  final List<StarNode> nodes;
  final int selected;

  @override
  void paint(Canvas canvas, Size size) {
    _paintDust(canvas, size);
    _paintConstellations(canvas, size);
  }

  /// A fixed dust field: a seeded scatter so it is the same sky every launch,
  /// and faint enough that a star always reads as the brighter point.
  void _paintDust(Canvas canvas, Size size) {
    final random = Random(29);
    final paint = Paint()..color = LockedInColors.line.withValues(alpha: 0.7);
    for (var i = 0; i < 90; i++) {
      final point = Offset(
        random.nextDouble() * size.width,
        random.nextDouble() * size.height,
      );
      canvas.drawCircle(point, random.nextDouble() < 0.15 ? 1.1 : 0.7, paint);
    }
  }

  void _paintConstellations(Canvas canvas, Size size) {
    final byCategory = <String, List<Offset>>{};
    for (final node in nodes) {
      byCategory
          .putIfAbsent(node.category, () => [])
          .add(Offset(node.unit.dx * size.width, node.unit.dy * size.height));
    }
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = LockedInColors.line.withValues(alpha: 0.9);
    for (final points in byCategory.values) {
      if (points.length < 2) continue;
      final sorted = [...points]
        ..sort(
          (a, b) => a.dx == b.dx ? a.dy.compareTo(b.dy) : a.dx.compareTo(b.dx),
        );
      final path = Path()..moveTo(sorted.first.dx, sorted.first.dy);
      for (final point in sorted.skip(1)) {
        path.lineTo(point.dx, point.dy);
      }
      canvas.drawPath(path, line);
    }
  }

  @override
  bool shouldRepaint(_SkyPainter oldDelegate) =>
      !identical(oldDelegate.nodes, nodes) || oldDelegate.selected != selected;
}

/// The detail card for the selected star: name, task, progress, difficulty and
/// the award date the core recorded.
class StarDetail extends StatelessWidget {
  const StarDetail({super.key, required this.node, this.compact = false});

  final StarNode? node;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final row = node?.row;
    if (row == null) {
      return Text(
        'no star selected',
        style: TextStyle(color: LockedInColors.muted, fontSize: 12),
      );
    }
    final unlocked = row.unlocked;
    final target = row.target <= 0 ? 1 : row.target;
    final progress = (row.progress / target).clamp(0.0, 1.0);
    return Column(
      key: const ValueKey('achievement-detail'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Icon(
              unlocked ? Icons.star : Icons.star_border,
              size: 16,
              color: unlocked ? LockedInColors.accent : LockedInColors.muted,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                row.name.isEmpty ? row.id : row.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleMedium?.copyWith(fontSize: 15),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          row.task,
          style: TextStyle(
            color: LockedInColors.foreground,
            fontSize: 12.5,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Text(
              '${row.value} of $target',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: 11,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(Radii.control),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 5,
                  color: unlocked
                      ? LockedInColors.success
                      : LockedInColors.primary,
                  backgroundColor: LockedInColors.panel,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            _Chip(label: row.category),
            _Chip(label: row.difficulty),
            if (row.awardedAt != null)
              _Chip(
                label: 'awarded ${row.awardedAt}',
                tone: LockedInColors.success,
              )
            else
              _Chip(
                label: unlocked ? 'unlocked' : 'locked',
                tone: unlocked ? LockedInColors.success : LockedInColors.muted,
              ),
          ],
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, this.tone});

  final String label;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: tone ?? LockedInColors.muted,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
