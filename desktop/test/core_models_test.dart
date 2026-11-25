import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';

/// The generated `KnowledgeHit` decoder plus the hand-written view helpers.
void main() {
  test('decodes the documented shape', () {
    final hit = KnowledgeHit.fromJson({
      'id': 'note:school:school/vault/concepts/boundary.md',
      'kind': 'note',
      'title': 'Boundary conditions',
      'excerpt': 'They set the integral limits.',
      'side': 'school',
      'path': 'school/vault/concepts/boundary.md',
      'updated': '2026-11-01T10:00:00.000Z',
      'score': 3,
    });
    expect(hit.kind, 'note');
    expect(hit.score, 3.0);
    expect(hit.isHistory, isFalse);
    expect(hit.displayTitle, 'Boundary conditions');
  });

  test('keeps the hand-written tolerances: lowercase and numeric strings', () {
    final hit = KnowledgeHit.fromJson({
      'kind': 'MEMORY',
      'side': 'SCHOOL',
      'excerpt': 'A remembered point',
      'score': '0.5',
    });
    expect(hit.kind, 'memory');
    expect(hit.side, 'school');
    expect(hit.score, 0.5);
    expect(hit.isHistory, isTrue);
  });

  test('a missing or mistyped field is empty, not an exception', () {
    final hit = KnowledgeHit.fromJson({'kind': 9, 'score': 'not a number'});
    expect(hit.id, '');
    expect(hit.kind, '');
    expect(hit.title, '');
    expect(hit.score, 0.0);
    // No title: the path is the fallback, and it is empty here too.
    expect(hit.displayTitle, '');
  });

  test('a missing title falls back to the path', () {
    final hit = KnowledgeHit.fromJson({'path': 'school/vault/a.md'});
    expect(hit.displayTitle, 'school/vault/a.md');
  });

  test('the Knowledge tree parses nested notes and skips a non-map', () {
    final group = KnowledgeGroup.fromJson({
      'topic': 'Physics',
      'notes': [
        {'path': 'school/vault/a.md', 'title': 'A', 'updated': '2026-11-01'},
        'not-a-map',
        {'path': 'school/vault/b.md'},
      ],
    });
    expect(group.topic, 'Physics');
    expect(group.notes, hasLength(2));
    expect(group.notes.first.displayTitle, 'A');
    expect(group.notes.last.displayTitle, 'school/vault/b.md');
  });
}
