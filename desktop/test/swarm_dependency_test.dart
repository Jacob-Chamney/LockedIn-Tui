import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';

/// The wire shape for dependency-aware swarms.
void main() {
  test('a plan entry carries its requires to the core', () {
    const entry = SwarmPlanEntry(
      title: 'Two',
      assignment: 'read two',
      requires: [1, 2],
    );
    expect(entry.toJson()['requires'], [1, 2]);

    const none = SwarmPlanEntry(title: 'One', assignment: 'read one');
    expect(none.toJson().containsKey('requires'), isFalse);
  });

  test('a board row reads the task ids it waited for', () {
    final row = SwarmTaskRow.fromJson({
      'id': 'task-2',
      'title': 'Two',
      'agentId': 'reader',
      'status': 'pending',
      'requires': ['task-1'],
    });
    expect(row.requires, ['task-1']);
  });
}
