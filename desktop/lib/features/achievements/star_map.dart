import 'dart:math';
import 'dart:ui' show Offset;

import '../../bridge/models.dart';

/// The Achievements screen as a sky: every achievement is a star, and each
/// category is a constellation.
///
/// The layout is pure and deterministic — a seeded generator, no clock, no
/// widget — so the same catalogue always draws the same sky and a test can
/// assert positions and navigation without pumping a frame.

/// One star: its row, and where it sits in the pane (unit coordinates, 0–1).
class StarNode {
  const StarNode({
    required this.row,
    required this.category,
    required this.unit,
    required this.index,
  });

  final AchievementRow row;

  /// The constellation this star belongs to (`starter`, `learning`, …).
  final String category;

  /// Centre in unit coordinates: (0,0) is the top-left of the star pane.
  final Offset unit;

  /// Position in the catalogue order the page navigates in.
  final int index;
}

/// Where each constellation sits. Spread so no two anchors collide at any
/// aspect ratio, and so the four shelves read as four corners rather than a
/// line.
const starAnchors = <String, Offset>{
  'starter': Offset(0.20, 0.26),
  'learning': Offset(0.58, 0.20),
  'work': Offset(0.80, 0.62),
  'collection': Offset(0.33, 0.74),
};

/// The anchor for a shelf the core sends but this table does not know.
const starFallbackAnchor = Offset(0.62, 0.86);

/// A compass direction for keyboard navigation.
enum StarDirection { left, right, up, down }

/// Lay [rows] out as stars, one constellation per category.
///
/// Inside a constellation the stars sit on a ring around its anchor; the ring's
/// radius grows with the member count and every star gets a small seeded jitter
/// so the constellation looks drawn by hand. [seed] keeps that jitter stable
/// across runs.
List<StarNode> layoutStars(List<AchievementRow> rows, {int seed = 17}) {
  final random = Random(seed);
  final byCategory = <String, List<AchievementRow>>{};
  for (final row in rows) {
    byCategory.putIfAbsent(_categoryOf(row), () => []).add(row);
  }

  final nodes = <StarNode>[];
  for (final entry in byCategory.entries) {
    final anchor = starAnchors[entry.key] ?? starFallbackAnchor;
    final members = entry.value;
    // A ring radius in unit space: 0.05 for one star, up to 0.17 for a shelf.
    final radius = members.length == 1
        ? 0.0
        : (0.055 + 0.012 * min(members.length, 10)).clamp(0.055, 0.17);
    for (var i = 0; i < members.length; i++) {
      // Two rings of stars read better than one crowded one.
      final ringOffset = i % 2 == 0 ? 0.0 : radius * 0.55;
      final angle =
          (i / max(members.length, 1)) * pi * 2 + random.nextDouble() * 0.35;
      final jitter = Offset(
        (random.nextDouble() - 0.5) * 0.02,
        (random.nextDouble() - 0.5) * 0.02,
      );
      final unit = Offset(
        (anchor.dx + cos(angle) * (radius - ringOffset) + jitter.dx).clamp(
          0.05,
          0.95,
        ),
        (anchor.dy + sin(angle) * (radius - ringOffset) + jitter.dy).clamp(
          0.06,
          0.94,
        ),
      );
      nodes.add(
        StarNode(
          row: members[i],
          category: entry.key,
          unit: unit,
          index: nodes.length,
        ),
      );
    }
  }
  return nodes;
}

String _categoryOf(AchievementRow row) {
  const known = ['starter', 'learning', 'work', 'collection'];
  final category = row.category.trim().toLowerCase();
  return known.contains(category) ? category : 'other';
}

/// The star the keyboard should land on when moving [direction] from [from].
///
/// It picks the nearest star whose centre lies in that half-plane (a positive
/// component in the direction, with a bias toward staying on the same row or
/// column), so `j`/`k` walk stars vertically and `h`/`l` horizontally instead of
/// jumping to whichever star is closest overall. Returns [from] when there is
/// nothing to move to.
int nearestInDirection(
  List<StarNode> nodes,
  int from,
  StarDirection direction, {
  double aspectRatio = 1.6,
}) {
  if (nodes.isEmpty) return -1;
  if (from < 0 || from >= nodes.length) return 0;
  final origin = nodes[from].unit;

  Offset toVector(Offset point) {
    // Weight x by the pane's aspect ratio so "nearest" means nearest on screen,
    // not nearest in unit space.
    return Offset((point.dx - origin.dx) * aspectRatio, point.dy - origin.dy);
  }

  final axis = switch (direction) {
    StarDirection.left => const Offset(-1, 0),
    StarDirection.right => const Offset(1, 0),
    StarDirection.up => const Offset(0, -1),
    StarDirection.down => const Offset(0, 1),
  };

  var bestIndex = -1;
  var bestScore = double.infinity;
  for (final node in nodes) {
    if (node.index == from) continue;
    final delta = toVector(node.unit);
    final along = delta.dx * axis.dx + delta.dy * axis.dy;
    if (along <= 1e-6) continue;
    // Distance, penalised by drift across the movement axis: a star directly
    // above is preferred over a closer one far to the side.
    final across = (delta.dx * axis.dy - delta.dy * axis.dx).abs();
    final score = along + across * 1.6;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = node.index;
    }
  }
  return bestIndex == -1 ? from : bestIndex;
}
