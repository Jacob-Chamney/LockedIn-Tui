import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/achievements/star_map.dart';

AchievementRow row(
  String id, {
  String category = 'starter',
  bool unlocked = false,
  int value = 0,
  int target = 1,
}) => AchievementRow(
  id: id,
  name: id,
  task: 'task $id',
  category: category,
  metric: 'messages',
  target: target,
  value: value,
  progress: value,
  unlocked: unlocked,
  difficulty: 'easiest',
  awardedAt: unlocked ? '2026-11-01' : null,
);

void main() {
  group('the sky is deterministic', () {
    final rows = [
      row('a'),
      row('b'),
      row('c', category: 'learning'),
      row('d', category: 'work'),
      row('e', category: 'collection'),
      row('f', category: 'collection'),
    ];

    test('the same catalogue lays out the same stars', () {
      final first = layoutStars(rows);
      final second = layoutStars(rows);
      expect(first.length, rows.length);
      for (var i = 0; i < first.length; i++) {
        expect(first[i].row.id, second[i].row.id);
        expect(first[i].unit, second[i].unit);
      }
    });

    test('every star lands inside the pane', () {
      for (final node in layoutStars(rows)) {
        expect(node.unit.dx, inInclusiveRange(0.05, 0.95));
        expect(node.unit.dy, inInclusiveRange(0.06, 0.94));
      }
    });

    test('each shelf keeps its own constellation', () {
      final nodes = layoutStars(rows);
      final collection = nodes
          .where((node) => node.category == 'collection')
          .map((node) => node.unit)
          .toList();
      final starters = nodes
          .where((node) => node.category == 'starter')
          .map((node) => node.unit)
          .toList();
      expect(collection, hasLength(2));
      // The two shelves do not overlap on screen.
      expect(
        (collection.first.dx - starters.first.dx).abs(),
        greaterThan(0.05),
      );
    });

    test('an unknown category still gets a place', () {
      final nodes = layoutStars([row('x', category: 'mystery')]);
      expect(nodes, hasLength(1));
      expect(nodes.single.category, 'other');
    });
  });

  group('keyboard navigation', () {
    // A plus shape: centre, right, below. Direction is unambiguous.
    final nodes = [
      const StarNode(
        row: AchievementRow(
          id: 'centre',
          name: 'centre',
          task: '',
          category: 'starter',
          metric: '',
          target: 1,
          value: 0,
          progress: 0,
          unlocked: false,
          difficulty: '',
        ),
        category: 'starter',
        unit: Offset(0.5, 0.5),
        index: 0,
      ),
      const StarNode(
        row: AchievementRow(
          id: 'right',
          name: 'right',
          task: '',
          category: 'starter',
          metric: '',
          target: 1,
          value: 0,
          progress: 0,
          unlocked: false,
          difficulty: '',
        ),
        category: 'starter',
        unit: Offset(0.75, 0.5),
        index: 1,
      ),
      const StarNode(
        row: AchievementRow(
          id: 'below',
          name: 'below',
          task: '',
          category: 'starter',
          metric: '',
          target: 1,
          value: 0,
          progress: 0,
          unlocked: false,
          difficulty: '',
        ),
        category: 'starter',
        unit: Offset(0.5, 0.8),
        index: 2,
      ),
    ];

    test('right, down and back resolve to the expected star', () {
      expect(nearestInDirection(nodes, 0, StarDirection.right), 1);
      expect(nearestInDirection(nodes, 0, StarDirection.down), 2);
      expect(nearestInDirection(nodes, 1, StarDirection.left), 0);
      expect(nearestInDirection(nodes, 2, StarDirection.up), 0);
    });

    test('a direction with nothing in it keeps the cursor', () {
      expect(nearestInDirection(nodes, 0, StarDirection.up), 0);
      expect(nearestInDirection(nodes, 0, StarDirection.left), 0);
    });

    test('a diagonal neighbour is still the nearest star downwards', () {
      // From the right-hand star, "down" is the star below and to the left: a
      // free sky follows the compass, it does not need a grid.
      expect(nearestInDirection(nodes, 1, StarDirection.down), 2);
    });

    test('an empty sky has nowhere to go', () {
      expect(nearestInDirection(const [], 0, StarDirection.right), -1);
    });
  });

  group('the detail card', () {
    test('reports the counter, not a promise', () {
      final node = StarNode(
        row: row('a', unlocked: false, value: 3, target: 10),
        category: 'starter',
        unit: Offset.zero,
        index: 0,
      );
      expect(node.row.value, 3);
      expect(node.row.target, 10);
      expect(node.row.unlocked, isFalse);
    });
  });
}
