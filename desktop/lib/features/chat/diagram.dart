import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../../theme/palette.dart';
import '../../theme/tokens.dart';

/// A small Mermaid flowchart renderer, written for this app.
///
/// The supported grammar is the one lesson diagrams actually use: a `graph` or
/// `flowchart` header with a direction, node ids with an optional label in
/// `[]`, `()` or `{}`, and `-->` / `---` / `-.->` / `==>` edges with an
/// optional `|label|` or `-- label -->`. Anything else is skipped; a diagram
/// with no edges is not a diagram, so the caller keeps the source block.
///
/// Layout is a layered graph: a node's layer is its longest distance from a
/// root, which is enough for the small acyclic charts we draw. A cycle is
/// broken at the edge that closes it rather than hanging the layout.
class Flowchart extends StatelessWidget {
  const Flowchart(this.source, {super.key});

  final String source;

  @override
  Widget build(BuildContext context) {
    final chart = parseFlowchart(source);
    if (chart == null) return const SizedBox.shrink();
    return _FlowchartCanvas(chart: chart);
  }
}

enum FlowDirection { topDown, bottomUp, leftRight, rightLeft }

class FlowNode {
  const FlowNode({required this.id, required this.label, this.shape = 'rect'});
  final String id;
  final String label;
  final String shape;
}

class FlowEdge {
  const FlowEdge({required this.from, required this.to, this.label = ''});
  final String from;
  final String to;
  final String label;
}

class FlowChart {
  const FlowChart({
    required this.direction,
    required this.nodes,
    required this.edges,
  });
  final FlowDirection direction;
  final List<FlowNode> nodes;
  final List<FlowEdge> edges;
}

final _header = RegExp(r'^\s*(graph|flowchart)\s+(TD|TB|BT|LR|RL)\s*$');
final _edge = RegExp(
  r'^\s*([A-Za-z0-9_]+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*'
  r'(?:--\s*([^>]*?)\s*-->|-->(\|[^|]*\|)?|---|-.->|==>|--)\s*'
  r'(?:\|([^|]*)\|)?\s*'
  r'([A-Za-z0-9_]+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*$',
);

/// Parse a flowchart, or null when the source has no header or no edge.
FlowChart? parseFlowchart(String source) {
  final lines = source
      .replaceAll('\r\n', '\n')
      .split('\n')
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .toList();
  if (lines.isEmpty) return null;
  final header = _header.firstMatch(lines.first);
  if (header == null) return null;
  final direction = switch (header.group(2)) {
    'BT' => FlowDirection.bottomUp,
    'LR' => FlowDirection.leftRight,
    'RL' => FlowDirection.rightLeft,
    _ => FlowDirection.topDown,
  };

  final nodes = <String, FlowNode>{};
  final edges = <FlowEdge>[];
  void learn(String id, String? label, String? shape) {
    final clean = id.trim();
    if (clean.isEmpty) return;
    final existing = nodes[clean];
    if (existing == null) {
      nodes[clean] = FlowNode(
        id: clean,
        label: label?.trim() ?? clean,
        shape: shape ?? 'rect',
      );
    } else if (label != null &&
        label.trim().isNotEmpty &&
        existing.label == existing.id) {
      nodes[clean] = FlowNode(
        id: clean,
        label: label.trim(),
        shape: shape ?? existing.shape,
      );
    }
  }

  for (final line in lines.skip(1)) {
    if (line.startsWith('subgraph') ||
        line == 'end' ||
        line.startsWith('classDef') ||
        line.startsWith('class ') ||
        line.startsWith('style ') ||
        line.startsWith('click ') ||
        line.startsWith('%%')) {
      continue;
    }
    final match = _edge.firstMatch(line);
    if (match == null) continue;
    final from = match.group(1)!;
    final fromLabel = match.group(2) ?? match.group(3) ?? match.group(4);
    final to = match.group(8)!;
    final toLabel = match.group(9) ?? match.group(10) ?? match.group(11);
    learn(from, fromLabel, _shapeOf(match, 2, 3, 4));
    learn(to, toLabel, _shapeOf(match, 9, 10, 11));
    final label = (match.group(5) ?? match.group(6) ?? match.group(7) ?? '')
        .replaceAll('|', '')
        .trim();
    edges.add(FlowEdge(from: from, to: to, label: label));
  }
  if (edges.isEmpty) return null;
  // A node that only appears as a target was learned by the edge above.
  return FlowChart(
    direction: direction,
    nodes: nodes.values.toList(growable: false),
    edges: edges,
  );
}

String _shapeOf(RegExpMatch match, int bracket, int paren, int brace) {
  if (match.group(bracket) != null) return 'rect';
  if (match.group(paren) != null) return 'round';
  if (match.group(brace) != null) return 'diamond';
  return 'rect';
}

class _Placed {
  _Placed(this.node, this.rect);
  final FlowNode node;
  final Rect rect;
}

class _FlowchartCanvas extends StatelessWidget {
  const _FlowchartCanvas({required this.chart});

  final FlowChart chart;

  static const _gap = 28.0;
  static const _nodeGap = 18.0;

  @override
  Widget build(BuildContext context) {
    final textStyle = TextStyle(
      color: LockedInColors.foreground,
      fontFamily: 'JetBrainsMono',
      fontSize: 12,
      height: 1.2,
    );
    final sizes = <String, Size>{};
    for (final node in chart.nodes) {
      final painter = TextPainter(
        text: TextSpan(text: node.label, style: textStyle),
        textDirection: TextDirection.ltr,
        maxLines: 2,
      )..layout(maxWidth: 180);
      sizes[node.id] = Size(
        math.max(64, painter.width + 24),
        math.max(30, painter.height + 14),
      );
    }

    final layers = _layers(chart);
    final placed = <String, _Placed>{};
    var width = 0.0;
    var height = 0.0;

    if (chart.direction == FlowDirection.topDown ||
        chart.direction == FlowDirection.bottomUp) {
      final layerWidths = <double>[
        for (final layer in layers)
          layer.fold<double>(0, (sum, id) => sum + sizes[id]!.width) +
              math.max(0, layer.length - 1) * _nodeGap,
      ];
      width = layerWidths.fold<double>(0, math.max);
      var y = 0.0;
      for (final (row, layer) in layers.indexed) {
        final rowWidth = layerWidths[row];
        var x = (width - rowWidth) / 2;
        final rowHeight = layer.fold<double>(
          0,
          (tallest, id) => math.max(tallest, sizes[id]!.height),
        );
        for (final id in layer) {
          final size = sizes[id]!;
          placed[id] = _Placed(
            chart.nodes.firstWhere((node) => node.id == id),
            Rect.fromLTWH(x, y, size.width, size.height),
          );
          x += size.width + _nodeGap;
        }
        y += rowHeight + _gap;
      }
      height = math.max(0, y - _gap);
    } else {
      final layerHeights = <double>[
        for (final layer in layers)
          layer.fold<double>(0, (sum, id) => sum + sizes[id]!.height) +
              math.max(0, layer.length - 1) * _nodeGap,
      ];
      height = layerHeights.fold<double>(0, math.max);
      var x = 0.0;
      for (final (column, layer) in layers.indexed) {
        final columnHeight = layerHeights[column];
        var y = (height - columnHeight) / 2;
        final columnWidth = layer.fold<double>(
          0,
          (widest, id) => math.max(widest, sizes[id]!.width),
        );
        for (final id in layer) {
          final size = sizes[id]!;
          placed[id] = _Placed(
            chart.nodes.firstWhere((node) => node.id == id),
            Rect.fromLTWH(x, y, size.width, size.height),
          );
          y += size.height + _nodeGap;
        }
        x += columnWidth + _gap;
      }
      width = math.max(0, x - _gap);
    }

    final canvas = Size(math.max(width, 120), math.max(height, 40));
    return Container(
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        border: Border.all(color: LockedInColors.line, width: Stroke.hairline),
      ),
      padding: const EdgeInsets.all(Space.sm),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: canvas.width,
          height: canvas.height,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _EdgePainter(
                    chart: chart,
                    placed: placed,
                    color: LockedInColors.muted,
                    labelColor: LockedInColors.secondary,
                  ),
                ),
              ),
              for (final entry in placed.values)
                Positioned.fromRect(
                  rect: entry.rect,
                  child: _NodeBox(node: entry.node),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// Longest-path layers, with cycle edges ignored after the first visit.
  List<List<String>> _layers(FlowChart chart) {
    final incoming = <String, int>{for (final node in chart.nodes) node.id: 0};
    final out = <String, List<String>>{
      for (final node in chart.nodes) node.id: <String>[],
    };
    for (final edge in chart.edges) {
      if (!out.containsKey(edge.from) || !out.containsKey(edge.to)) continue;
      out[edge.from]!.add(edge.to);
      incoming[edge.to] = (incoming[edge.to] ?? 0) + 1;
    }
    final depth = <String, int>{for (final node in chart.nodes) node.id: 0};
    final queue = <String>[
      for (final node in chart.nodes)
        if ((incoming[node.id] ?? 0) == 0) node.id,
    ];
    if (queue.isEmpty) queue.add(chart.nodes.first.id);
    final seen = <String>{...queue};
    while (queue.isNotEmpty) {
      final id = queue.removeAt(0);
      for (final next in out[id]!) {
        depth[next] = math.max(depth[next] ?? 0, (depth[id] ?? 0) + 1);
        if (seen.add(next)) queue.add(next);
      }
    }
    final maxDepth = depth.values.fold<int>(0, math.max);
    final layers = List.generate(maxDepth + 1, (_) => <String>[]);
    for (final node in chart.nodes) {
      layers[depth[node.id] ?? 0].add(node.id);
    }
    return layers;
  }
}

class _NodeBox extends StatelessWidget {
  const _NodeBox({required this.node});
  final FlowNode node;

  @override
  Widget build(BuildContext context) {
    final radius = switch (node.shape) {
      'round' => 999.0,
      'diamond' => 2.0,
      _ => 2.0,
    };
    return Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        border: Border.all(color: LockedInColors.line, width: Stroke.hairline),
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Text(
        node.label,
        textAlign: TextAlign.center,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: LockedInColors.foreground,
          fontFamily: 'JetBrainsMono',
          fontSize: 12,
          height: 1.2,
        ),
      ),
    );
  }
}

class _EdgePainter extends CustomPainter {
  _EdgePainter({
    required this.chart,
    required this.placed,
    required this.color,
    required this.labelColor,
  });

  final FlowChart chart;
  final Map<String, _Placed> placed;
  final Color color;
  final Color labelColor;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    for (final edge in chart.edges) {
      final from = placed[edge.from];
      final to = placed[edge.to];
      if (from == null || to == null) continue;
      final start = _anchor(from.rect, to.rect.center);
      final end = _anchor(to.rect, from.rect.center);
      canvas.drawLine(start, end, paint);
      _arrow(canvas, paint, start, end);
      if (edge.label.isNotEmpty) {
        _label(
          canvas,
          edge.label,
          Offset((start.dx + end.dx) / 2, (start.dy + end.dy) / 2),
        );
      }
    }
  }

  Offset _anchor(Rect rect, Offset toward) {
    final center = rect.center;
    final dx = toward.dx - center.dx;
    final dy = toward.dy - center.dy;
    if (dx == 0 && dy == 0) return center;
    final scaleX = dx == 0 ? double.infinity : (rect.width / 2) / dx.abs();
    final scaleY = dy == 0 ? double.infinity : (rect.height / 2) / dy.abs();
    final scale = math.min(scaleX, scaleY);
    return Offset(center.dx + dx * scale, center.dy + dy * scale);
  }

  void _arrow(Canvas canvas, Paint paint, Offset start, Offset end) {
    final angle = math.atan2(end.dy - start.dy, end.dx - start.dx);
    const length = 6.0;
    const spread = 0.45;
    canvas.drawLine(
      end,
      end - Offset(math.cos(angle - spread), math.sin(angle - spread)) * length,
      paint,
    );
    canvas.drawLine(
      end,
      end - Offset(math.cos(angle + spread), math.sin(angle + spread)) * length,
      paint,
    );
  }

  void _label(Canvas canvas, String text, Offset center) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: labelColor,
          fontFamily: 'JetBrainsMono',
          fontSize: 10,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final rect = Rect.fromCenter(
      center: center,
      width: painter.width + 8,
      height: painter.height + 4,
    );
    canvas.drawRect(rect, Paint()..color = LockedInColors.surface);
    painter.paint(canvas, Offset(rect.left + 4, rect.top + 2));
  }

  @override
  bool shouldRepaint(covariant _EdgePainter old) =>
      old.chart != chart || old.color != color;
}
