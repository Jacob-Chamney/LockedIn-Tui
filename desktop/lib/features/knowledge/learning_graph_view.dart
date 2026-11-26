import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A read-only drawing of the learning graph.
///
/// The list below it is still the keyboard surface; this canvas is the picture
/// the text list cannot give: which artifacts exist, how they cluster by kind,
/// and which edges join them. Layout is deterministic and derived only from the
/// wire model, so two reads of an unchanged workspace draw the same frame.
class LearningGraphCanvas extends StatelessWidget {
  const LearningGraphCanvas({
    super.key,
    required this.graph,
    required this.selectedIndex,
    this.onSelect,
  });

  final LearningGraph graph;
  final int selectedIndex;
  final ValueChanged<int>? onSelect;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final positions = _positions(constraints.biggest);
        return GestureDetector(
          key: const ValueKey('knowledge-graph-canvas'),
          behavior: HitTestBehavior.opaque,
          onTapDown: (details) {
            final picked = _nearest(positions, details.localPosition);
            if (picked != null) onSelect?.call(picked);
          },
          child: CustomPaint(
            painter: _GraphPainter(
              graph: graph,
              positions: positions,
              selectedIndex: selectedIndex,
            ),
            child: const SizedBox.expand(),
          ),
        );
      },
    );
  }

  /// One position per node, grouped into a column per kind.
  List<Offset> _positions(Size size) {
    final kinds = <String>[];
    for (final node in graph.nodes) {
      if (!kinds.contains(node.kind)) kinds.add(node.kind);
    }
    final counts = <String, int>{};
    for (final node in graph.nodes) {
      counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    }
    const pad = 26.0;
    final columns = kinds.isEmpty ? 1 : kinds.length;
    final usableW = (size.width - pad * 2).clamp(1.0, double.infinity);
    final usableH = (size.height - pad * 2).clamp(1.0, double.infinity);
    final seen = <String, int>{};
    return [
      for (final node in graph.nodes)
        () {
          final column = kinds.indexOf(node.kind);
          final row = seen[node.kind] = (seen[node.kind] ?? 0) + 1;
          final total = counts[node.kind] ?? 1;
          final x = columns == 1
              ? size.width / 2
              : pad + usableW * column / (columns - 1);
          final y = pad + usableH * row / (total + 1);
          return Offset(x, y);
        }(),
    ];
  }

  int? _nearest(List<Offset> positions, Offset point) {
    int? best;
    var bestDistance = 22.0;
    for (var index = 0; index < positions.length; index++) {
      final distance = (positions[index] - point).distance;
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }
}

class _GraphPainter extends CustomPainter {
  _GraphPainter({
    required this.graph,
    required this.positions,
    required this.selectedIndex,
  });

  final LearningGraph graph;
  final List<Offset> positions;
  final int selectedIndex;

  @override
  void paint(Canvas canvas, Size size) {
    final byId = <String, int>{
      for (var index = 0; index < graph.nodes.length; index++)
        graph.nodes[index].id: index,
    };
    final edge = Paint()
      ..color = LockedInColors.line
      ..strokeWidth = Stroke.hairline;
    for (final relation in graph.edges) {
      final from = byId[relation.from];
      final to = byId[relation.to];
      if (from == null || to == null) continue;
      canvas.drawLine(positions[from], positions[to], edge);
    }
    for (var index = 0; index < graph.nodes.length; index++) {
      final node = graph.nodes[index];
      final selected = index == selectedIndex;
      final colour = _kindColour(node.kind);
      canvas.drawCircle(
        positions[index],
        selected ? 9 : 5.5,
        Paint()..color = selected ? colour : colour.withValues(alpha: 0.75),
      );
      if (selected) {
        canvas.drawCircle(
          positions[index],
          12,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = Stroke.focus
            ..color = LockedInColors.primary,
        );
        final label = TextPainter(
          text: TextSpan(
            text: node.label,
            style: TextStyle(
              color: LockedInColors.foreground,
              fontSize: TypeScale.label,
              fontFamily: LockedInType.mono,
            ),
          ),
          textDirection: TextDirection.ltr,
          maxLines: 1,
          ellipsis: '…',
        )..layout(maxWidth: 180);
        final origin = positions[index] + const Offset(14, -8);
        label.paint(canvas, origin);
      }
    }
  }

  Color _kindColour(String kind) {
    return switch (kind) {
      'goal' => LockedInColors.primary,
      'step' => LockedInColors.secondary,
      'source' => LockedInColors.success,
      'session' => LockedInColors.accent,
      'card' => LockedInColors.warning,
      'task' => LockedInColors.error,
      'research' => LockedInColors.secondary,
      'figure' => LockedInColors.muted,
      _ => LockedInColors.muted,
    };
  }

  @override
  bool shouldRepaint(covariant _GraphPainter old) =>
      old.graph != graph || old.selectedIndex != selectedIndex;
}
