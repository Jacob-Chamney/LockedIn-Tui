part of 'stats_page.dart';

class _AreaChartPainter extends CustomPainter {
  const _AreaChartPainter({
    required this.values,
    required this.line,
    required this.fill,
    required this.grid,
  });

  final List<double> values;
  final Color line;
  final Color fill;
  final Color grid;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty || size.isEmpty) return;
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (var row = 0; row <= 4; row++) {
      final y = size.height * row / 4;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    final points = <Offset>[];
    for (var index = 0; index < values.length; index++) {
      final x = values.length == 1
          ? 0.0
          : size.width * index / (values.length - 1);
      final y = size.height - values[index] * size.height;
      points.add(Offset(x, y));
    }

    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (var index = 1; index < points.length; index++) {
      final previous = points[index - 1];
      final current = points[index];
      final midX = (previous.dx + current.dx) / 2;
      path.cubicTo(midX, previous.dy, midX, current.dy, current.dx, current.dy);
    }

    final area = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(area, Paint()..color = fill);
    canvas.drawPath(
      path,
      Paint()
        ..color = line
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );

    final dot = Paint()..color = line;
    for (final point in points) {
      canvas.drawCircle(point, 2.5, dot);
    }
  }

  @override
  bool shouldRepaint(_AreaChartPainter oldDelegate) {
    return oldDelegate.values != values ||
        oldDelegate.line != line ||
        oldDelegate.fill != fill ||
        oldDelegate.grid != grid;
  }
}

/// `1 call`, `2 calls` — a count with the right noun.
String _plural(int count, String noun) =>
    '$count $noun${count == 1 ? '' : 's'}';

String _compact(int value) {
  if (value >= 1000000000) {
    return '${(value / 1000000000).toStringAsFixed(1).replaceAll('.0', '')}B';
  }
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(1).replaceAll('.0', '')}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(1).replaceAll('.0', '')}K';
  }
  return '$value';
}

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String _shortDate(String iso) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(iso);
  if (match == null) return iso;
  final month = int.tryParse(match.group(2)!) ?? 1;
  return '${_months[month - 1]} ${match.group(3)}';
}

String _periodLabel(StatsPeriod period) {
  final from = RegExp(r'^(\d{4})-(\d{2})').firstMatch(period.from);
  final to = RegExp(r'^(\d{4})-(\d{2})').firstMatch(period.to);
  if (from == null || to == null) return '';
  final fromMonth = _months[(int.tryParse(from.group(2)!) ?? 1) - 1];
  final toMonth = _months[(int.tryParse(to.group(2)!) ?? 1) - 1];
  if (from.group(1) == to.group(1)) {
    return from.group(2) == to.group(2)
        ? '$fromMonth ${from.group(1)}'
        : '$fromMonth – $toMonth ${to.group(1)}';
  }
  return '$fromMonth ${from.group(1)} – $toMonth ${to.group(1)}';
}

int _periodDays(StatsPeriod period) {
  final from = DateTime.tryParse(period.from);
  final to = DateTime.tryParse(period.to);
  if (from == null || to == null || to.isBefore(from)) return 0;
  return to.difference(from).inDays + 1;
}

String _nextRange(String value) {
  const order = ['7d', '30d', '90d', 'all'];
  final at = order.indexOf(value);
  return order[(at + 1) % order.length];
}

String _nextScope(String value) {
  const order = ['all', 'school', 'skills', 'work'];
  final at = order.indexOf(value);
  return order[(at + 1) % order.length];
}

/// The export dialog: format chips, the document text and Save/Copy/Close.
///
/// The dialog owns the request state so a format change refetches exactly once
/// and a late answer cannot replace a newer one. [onExport] is the shell's
/// `stats.export`; the page writes nothing and never re-reads a counter.
///
/// Saving is the shell's half of the contract: the core returned [text], and
/// the only destination is the one [pickSavePath] returns. A cancelled picker
/// writes nothing and says nothing; a failed write is one inline line and the
/// dialog stays open. `s` and Save… are the same path, so the action is
/// reachable without a mouse.
