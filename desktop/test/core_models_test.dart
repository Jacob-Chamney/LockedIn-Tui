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

  test('the stats summary tolerates absent nullable and nested values', () {
    final summary = StatsSummary.fromJson({
      'range': '30d',
      'scope': 'all',
      'overview': {'runs': 2, 'input': 10, 'output': 5},
      'costMicroUsd': null,
      'models': [
        {'model': 'local/llama', 'runs': 2, 'input': 10, 'output': 5},
        'not-a-map',
      ],
      'learning': {'steps': 1},
      'activity': [],
      'bestStreak': 1,
      'activeDays': 2,
      'period': {'from': '2026-11-01', 'to': '2026-11-02'},
      'diagnostic': '',
    });
    expect(summary.overview.runs, 2);
    expect(summary.overview.failed, 0);
    expect(summary.tokens, 15);
    expect(summary.costMicroUsd, isNull);
    expect(summary.models, hasLength(1));
    expect(summary.models.single.tokens, 15);
    expect(summary.models.single.costMicroUsd, isNull);
    expect(summary.learning.steps, 1);
    expect(summary.learning.lessons, 0);
    expect(summary.period.to, '2026-11-02');
    expect(summary.diagnostic, isNull);
  });

  test('the learning graph parses counts, nodes and their relations', () {
    final graph = LearningGraph.fromJson({
      'nodes': [
        {'id': 'goal:g', 'kind': 'goal', 'label': 'Read', 'grounded': 'agent'},
        'not-a-map',
      ],
      'edges': [
        {'from': 'goal:g', 'to': 'step:g:1', 'kind': 'contains'},
      ],
      'counts': {'goal': 1, 'step': 2, 'ignored': 'x'},
      'diagnostics': ['one'],
      'truncated': false,
    });
    expect(graph.nodes, hasLength(1));
    expect(graph.nodes.single.isAgent, isTrue);
    expect(graph.edges.single.kind, 'contains');
    expect(graph.counts, {'goal': 1, 'step': 2});
    expect(graph.node('goal:g')?.label, 'Read');
    expect(graph.node('missing'), isNull);
  });

  test('the settings view decodes and tolerates missing values', () {
    final view = SettingsView.fromJson({
      'username': 'me',
      'maxToolCalls': 8,
      'budgetUsd': 5,
      'pauseAtLimit': true,
      'pluginServers': ['notes', 2],
    });
    expect(view.username, 'me');
    expect(view.maxToolCalls, 8);
    expect(view.budgetUsd, 5.0);
    expect(view.pauseAtLimit, isTrue);
    expect(view.pluginServers, ['notes']);
    // Every absent field is its empty value, not an exception.
    expect(view.theme, '');
    expect(view.historyLimit, 0);
    expect(view.warnAt, 0.0);
    expect(view.hideHints, isFalse);
    expect(view.disabledPlugins, isEmpty);
  });

  test('the session figure decodes and reports a crop', () {
    final figure = SessionFigure.fromJson({
      'id': 'figure-1',
      'source': 'sources/paper.pdf',
      'page': 4,
      'x': 10,
      'y': 20,
      'width': 300,
      'height': 200,
      'caption': 'The loop',
      'note': 'look at the offset',
      'file': 'figures/figure-1.png',
      'createdAt': '2026-11-01T10:00:00.000Z',
    });
    expect(figure.page, 4);
    expect(figure.cropped, isTrue);
    expect(figure.caption, 'The loop');

    final whole = SessionFigure.fromJson({'id': 'figure-2', 'page': '4'});
    expect(whole.page, 0);
    expect(whole.cropped, isFalse);
    expect(whole.note, '');
  });
}
