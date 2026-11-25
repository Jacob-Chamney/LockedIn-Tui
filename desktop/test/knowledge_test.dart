import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/knowledge/knowledge_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The documented `knowledge.tree` shape: two topics and three notes.
List<KnowledgeGroup> treeFixture() => [
  for (final group in const [
    {
      'topic': 'Physics',
      'notes': [
        {
          'path': 'school/vault/concepts/entropy.md',
          'title': 'Entropy and the second law',
          'updated': '2026-11-02T09:00:00.000Z',
        },
        {
          'path': 'school/vault/concepts/boundary-conditions.md',
          'title': 'Boundary conditions',
          'updated': '2026-11-01T12:30:00.000Z',
        },
      ],
    },
    {
      'topic': 'Assembly',
      'notes': [
        {
          'path': 'skills/vault/knowledge/registers.md',
          'title': 'Registers and stack frames',
          'updated': '2026-10-28T16:05:00.000Z',
        },
      ],
    },
  ])
    KnowledgeGroup.fromJson(Map<String, dynamic>.from(group)),
];

/// One hit per kind the page styles differently: a note, a source, session
/// memory and a Work project. The source and the memory row are history.
List<KnowledgeHit> hitsFixture() => [
  for (final hit in const [
    {
      'id': 'note:school/vault/concepts/entropy.md',
      'kind': 'note',
      'title': 'Entropy and the second law',
      'excerpt': 'Entropy counts the microstates a system can occupy.',
      'side': 'school',
      'path': 'school/vault/concepts/entropy.md',
      'updated': '2026-11-02T09:00:00.000Z',
      'score': 1.0,
    },
    {
      'id': 'source:physics:lecture-4.md',
      'kind': 'source',
      'title': 'lecture-4.md',
      'excerpt': 'Boundary conditions set the integral limits.',
      'side': 'school',
      'path': 'school/sessions/physics/sources/lecture-4.md',
      'updated': '2026-11-01T14:35:00.000Z',
      'score': 0.7,
    },
    {
      'id': 'memory:physics',
      'kind': 'memory',
      'title': 'Physics — Unit 4 memory',
      'excerpt': 'Boundary conditions determine the integral limits.',
      'side': 'school',
      'path': 'school/sessions/physics/memory.md',
      'updated': '2026-11-01T15:00:00.000Z',
      'score': 0.6,
    },
    {
      'id': 'project:my-app-4f2a1c',
      'kind': 'project',
      'title': 'My app',
      'excerpt': 'Registered Work project.',
      'side': 'work',
      'path': 'work/projects/my-app-4f2a1c',
      'updated': '2026-10-20T10:00:00.000Z',
      'score': 0.4,
    },
  ])
    KnowledgeHit.fromJson(Map<String, dynamic>.from(hit)),
];

Future<void> pumpKnowledge(
  WidgetTester tester, {
  List<KnowledgeHit>? hits,
  List<KnowledgeGroup>? groups,
  bool loading = false,
  String? error,
  String query = '',
  String scope = 'all',
  Future<void> Function(String query)? onSearch,
  ValueChanged<String>? onScope,
  VoidCallback? onRefresh,
  VoidCallback? onBack,
  ValueChanged<String>? onOpen,
  LearningGraph graph = learningGraphEmpty,
  VoidCallback? onLoadGraph,
  Size size = const Size(1280, 800),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: KnowledgePage(
          hits: hits ?? const <KnowledgeHit>[],
          groups: groups ?? const <KnowledgeGroup>[],
          loading: loading,
          error: error,
          query: query,
          scope: scope,
          onSearch: onSearch,
          onScope: onScope,
          onRefresh: onRefresh,
          onOpen: onOpen,
          onBack: onBack,
          graph: graph,
          onLoadGraph: onLoadGraph,
        ),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

void main() {
  test('KnowledgeHit tolerates missing and mistyped fields', () {
    final hit = KnowledgeHit.fromJson({
      'id': 'kept',
      'kind': 'MEMORY',
      'title': '',
      'excerpt': null,
      'side': 'SCHOOL',
      'path': 'school/a.md',
      'updated': 7,
      'score': '0.5',
    });
    expect(hit.kind, 'memory');
    expect(hit.side, 'school');
    expect(hit.title, '');
    expect(hit.displayTitle, 'school/a.md');
    expect(hit.excerpt, '');
    expect(hit.updated, '');
    expect(hit.score, 0.5);
    expect(hit.isHistory, isTrue);

    final broken = KnowledgeHit.fromJson({'kind': 9, 'score': 'not a number'});
    expect(broken.kind, '');
    expect(broken.score, 0);
    expect(broken.isHistory, isFalse);

    final group = KnowledgeGroup.fromJson({
      'topic': 'Physics',
      'notes': [
        {'path': 'school/a.md', 'title': null, 'updated': 3},
        {'path': 7},
      ],
    });
    expect(group.topic, 'Physics');
    expect(group.notes, hasLength(2));
    expect(group.notes.first.displayTitle, 'school/a.md');
    expect(KnowledgeGroup.fromJson({'notes': 'nope'}).notes, isEmpty);
  });

  test(
    'a blank search clears hits without a call, and a failure keeps rows',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.searchKnowledge('entropy');
      expect(store.knowledgeHits, hasLength(1));
      expect(store.knowledgeQuery, 'entropy');
      expect(core.knowledgeQueries, ['entropy']);

      await store.searchKnowledge('   ');
      expect(store.knowledgeHits, isEmpty);
      expect(store.knowledgeQuery, '');
      expect(core.knowledgeQueries, [
        'entropy',
      ], reason: 'no request for blank');

      // A tree read that fails keeps the groups already on screen.
      await store.loadKnowledgeTree();
      expect(store.knowledgeGroups, hasLength(2));
      core.knowledgeFailure = 'the vault could not be read';
      await store.loadKnowledgeTree();
      expect(store.knowledgeError, 'the vault could not be read');
      expect(store.knowledgeGroups, hasLength(2));
      expect(store.knowledgeLoading, isFalse);

      // Clearing the error on retry: the next read starts clean.
      core.knowledgeFailure = null;
      await store.loadKnowledgeTree();
      expect(store.knowledgeError, isNull);
    },
  );

  test('a stale search answer cannot replace a newer one', () async {
    final core = _SlowCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    final first = store.searchKnowledge('entropy');
    await store.searchKnowledge('registers');
    await first;

    expect(store.knowledgeQuery, 'registers');
    expect(store.knowledgeHits, hasLength(1));
    expect(store.knowledgeHits.single.title, 'Registers and stack frames');
  });

  test('a scope change re-runs the search or reloads the tree with all', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await store.loadKnowledgeTree();
    await store.searchKnowledge('boundary');
    expect(core.knowledgeScopes, ['all', 'all']);
    expect(store.knowledgeScope, 'all');
    // One ordering per reply: the reader walks exactly these ids.
    expect(store.knowledgeHitOrder, [
      'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
      'memory:2026-11-01-0900-physics-unit-4',
    ]);

    // A query is still showing, so the new scope re-runs the search.
    await store.selectKnowledgeScope('school');
    expect(store.knowledgeScope, 'school');
    expect(core.knowledgeScopes.last, 'school');
    expect(core.knowledgeQueries, ['boundary', 'boundary']);
    expect(store.knowledgeHits, hasLength(2));

    // Clearing the query returns to the tree, which is read with `all` because
    // it only covers the two vaults; the scope itself stays `work`.
    await store.searchKnowledge('');
    expect(store.knowledgeHitOrder, isEmpty);
    await store.selectKnowledgeScope('work');
    expect(store.knowledgeScope, 'work');
    expect(core.knowledgeScopes.last, 'all');

    // An unknown scope is never forwarded.
    final before = core.knowledgeScopes.length;
    await store.selectKnowledgeScope('nowhere');
    expect(store.knowledgeScope, 'work');
    expect(core.knowledgeScopes, hasLength(before));
  });

  test(
    'the reader only reports a position inside a search result set',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.readKnowledge('note:school/vault/concepts/entropy.md');
      expect(
        store.knowledgeHitIndex,
        isNull,
        reason: 'a tree note has no ordering to walk',
      );

      await store.searchKnowledge('boundary');
      await store.readKnowledge('memory:2026-11-01-0900-physics-unit-4');
      expect(store.knowledgeHitIndex, 1);

      // A sibling opens in place without going back to the list.
      await store.openKnowledgeHit(0);
      expect(
        store.knowledgeDocumentId,
        'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
      );
      expect(store.knowledgeHitIndex, 0);

      // Out of range is a no-op, not a request for a hit that does not exist.
      final reads = core.knowledgeReadIds.length;
      await store.openKnowledgeHit(9);
      await store.openKnowledgeHit(-1);
      expect(core.knowledgeReadIds, hasLength(reads));

      store.closeKnowledgeDocument();
      expect(store.knowledgeHitIndex, isNull);
    },
  );

  testWidgets('the tree renders topics with their notes, paths and counts', (
    tester,
  ) async {
    await pumpKnowledge(tester, groups: treeFixture());

    expect(find.text('KNOWLEDGE'), findsOneWidget);
    expect(find.text('3 notes · 2 topics'), findsOneWidget);
    expect(find.text('PHYSICS'), findsOneWidget);
    expect(find.text('ASSEMBLY'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);
    expect(find.text('Boundary conditions'), findsOneWidget);
    expect(find.text('Registers and stack frames'), findsOneWidget);
    expect(
      find.text('school/vault/concepts/entropy.md · 2026-11-02'),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('knowledge-history-note')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty tree says where notes come from', (tester) async {
    await pumpKnowledge(tester);

    expect(find.byKey(const ValueKey('knowledge-empty')), findsOneWidget);
    expect(
      find.text('no notes yet · notes appear here once a vault has Markdown'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('knowledge-list')), findsOneWidget);
  });

  testWidgets('typing is debounced into one dispatched search', (tester) async {
    final searches = <String>[];
    await pumpKnowledge(
      tester,
      groups: treeFixture(),
      onSearch: (query) async => searches.add(query),
    );

    await tester.enterText(
      find.byKey(const ValueKey('knowledge-search')),
      'ent',
    );
    await tester.pump(const Duration(milliseconds: 100));
    expect(searches, isEmpty, reason: 'the debounce must not fire early');

    await tester.pump(const Duration(milliseconds: 200));
    expect(searches, ['ent']);

    // Two quick edits collapse into the last word only.
    await tester.enterText(
      find.byKey(const ValueKey('knowledge-search')),
      'entr',
    );
    await tester.pump(const Duration(milliseconds: 100));
    await tester.enterText(
      find.byKey(const ValueKey('knowledge-search')),
      'entropy',
    );
    await tester.pump(const Duration(milliseconds: 300));
    expect(searches, ['ent', 'entropy']);
  });

  testWidgets('a query renders kind tags, side badges and history markers', (
    tester,
  ) async {
    await pumpKnowledge(
      tester,
      hits: hitsFixture(),
      query: 'boundary',
      onSearch: (_) async {},
    );

    expect(find.text('4 hits · scope all'), findsOneWidget);
    expect(find.text('NOTE'), findsOneWidget);
    expect(find.text('SOURCE'), findsOneWidget);
    expect(find.text('MEMORY'), findsOneWidget);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('school'), findsWidgets);
    // `work` is both a side badge and a scope chip, so the label is found twice.
    expect(find.text('work'), findsWidgets);
    expect(
      find.text('Entropy counts the microstates a system can occupy.'),
      findsOneWidget,
    );
    expect(
      find.text('school/vault/concepts/entropy.md · 2026-11-02'),
      findsOneWidget,
    );

    // Memory and source excerpts are labelled history; a plain note is not.
    expect(
      find.byKey(const ValueKey('knowledge-history-memory:physics')),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey('knowledge-history-source:physics:lecture-4.md'),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'knowledge-history-note:school/vault/concepts/entropy.md',
        ),
      ),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a query with no hits explains itself', (tester) async {
    await pumpKnowledge(tester, query: 'zzzz', onSearch: (_) async {});

    expect(find.byKey(const ValueKey('knowledge-no-hits')), findsOneWidget);
    expect(find.text('no matches for “zzzz”'), findsOneWidget);
    expect(
      find.text('try another word · Esc to browse the tree'),
      findsOneWidget,
    );
  });

  testWidgets('a failed read keeps the rows and offers a retry', (
    tester,
  ) async {
    var retries = 0;
    await pumpKnowledge(
      tester,
      groups: treeFixture(),
      error: 'the vault could not be read',
      onRefresh: () => retries += 1,
    );

    expect(find.text('the vault could not be read'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('knowledge-retry')));
    await tester.pumpAndSettle();
    expect(retries, 1);
  });

  testWidgets('j/k move the selection and Enter returns the selected id', (
    tester,
  ) async {
    final opened = <String>[];
    await pumpKnowledge(
      tester,
      hits: hitsFixture(),
      query: 'boundary',
      onOpen: opened.add,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(opened, hasLength(1));
    // The second row's hit id, not the first: j moved the selection.
    expect(opened.single, isNot(hitsFixture().first.id));
  });

  testWidgets('without a reader layer Enter says so instead of nothing', (
    tester,
  ) async {
    await pumpKnowledge(tester, hits: hitsFixture(), query: 'boundary');

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('no reader in this build'), findsOneWidget);
  });

  testWidgets('/ focuses the search field', (tester) async {
    await pumpKnowledge(tester, groups: treeFixture());

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();

    final focus = FocusManager.instance.primaryFocus?.context;
    final editing =
        focus != null &&
        (focus.widget is EditableText ||
            focus.findAncestorWidgetOfExactType<EditableText>() != null);
    expect(editing, isTrue);

    await tester.enterText(
      find.byKey(const ValueKey('knowledge-search')),
      'entropy',
    );
    // Let the debounce fire rather than leaving a timer for teardown.
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('knowledge-search')))
          .controller
          ?.text,
      'entropy',
    );
  });

  testWidgets('a query cleared by the core restores the tree', (tester) async {
    await pumpKnowledge(
      tester,
      hits: hitsFixture(),
      groups: treeFixture(),
      query: 'boundary',
    );
    expect(find.text('PHYSICS'), findsNothing);

    // The store reports the query as gone (a core restart): the page follows.
    await pumpKnowledge(tester, groups: treeFixture());
    await tester.pumpAndSettle();

    expect(find.text('PHYSICS'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);
  });

  testWidgets('Esc clears the query and restores the tree', (tester) async {
    final searches = <String>[];
    await pumpKnowledge(
      tester,
      hits: hitsFixture(),
      groups: treeFixture(),
      query: 'boundary',
      onSearch: (query) async => searches.add(query),
    );
    expect(find.text('PHYSICS'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(searches, ['']);
    expect(find.text('PHYSICS'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);
  });

  testWidgets('the page fits 800x600', (tester) async {
    await pumpKnowledge(
      tester,
      groups: treeFixture(),
      size: const Size(800, 600),
    );
    expect(find.text('KNOWLEDGE'), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the page fits a narrow window', (tester) async {
    await pumpKnowledge(
      tester,
      hits: hitsFixture(),
      groups: treeFixture(),
      query: 'boundary',
      size: const Size(480, 600),
    );
    expect(find.text('KNOWLEDGE'), findsOneWidget);
    expect(find.text('NOTE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the scope chips show the selected projection', (tester) async {
    await pumpKnowledge(tester, groups: treeFixture(), scope: 'school');

    for (final scope in const ['all', 'school', 'skills', 'work']) {
      expect(find.byKey(ValueKey('knowledge-scope-$scope')), findsOneWidget);
    }
    // The selected chip carries a tick glyph beside its label; the tick is the
    // signal, so the state never rests on the accent fill alone.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('knowledge-scope-school')),
        matching: find.textContaining('✓'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('knowledge-scope-all')),
        matching: find.byIcon(Icons.check),
      ),
      findsNothing,
    );
    // The tree summary names the projection, so the rows are never ambiguous.
    expect(find.text('3 notes · 2 topics · scope school'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('s cycles all, school, skills, work and wraps to all', (
    tester,
  ) async {
    final scopes = <String>[];
    for (final current in const ['all', 'school', 'skills', 'work']) {
      await pumpKnowledge(
        tester,
        groups: treeFixture(),
        scope: current,
        onScope: scopes.add,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
    }
    expect(scopes, ['school', 'skills', 'work', 'all']);

    // A chip is the secondary path and asks for exactly its own value.
    await tester.tap(find.byKey(const ValueKey('knowledge-scope-work')));
    await tester.pumpAndSettle();
    expect(scopes.last, 'work');
    expect(tester.takeException(), isNull);
  });

  testWidgets('a work scope explains why the tree still lists both vaults', (
    tester,
  ) async {
    await pumpKnowledge(tester, groups: treeFixture(), scope: 'work');

    expect(find.byKey(const ValueKey('knowledge-work-note')), findsOneWidget);
    expect(
      find.text(
        'the tree covers school and skills; work items appear in search',
      ),
      findsOneWidget,
    );
    // The tree read is `all`, so both sides of the wall are still listed.
    expect(find.text('Entropy and the second law'), findsOneWidget);
    expect(find.text('Registers and stack frames'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a work-scope search shows hits without the tree note', (
    tester,
  ) async {
    await pumpKnowledge(
      tester,
      hits: hitsFixture(),
      query: 'boundary',
      scope: 'work',
    );
    expect(find.byKey(const ValueKey('knowledge-work-note')), findsNothing);
    expect(find.text('4 hits · scope work'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the scope chips fit 800x600', (tester) async {
    await pumpKnowledge(
      tester,
      groups: treeFixture(),
      size: const Size(800, 600),
    );
    expect(find.byKey(const ValueKey('knowledge-scope-chips')), findsOneWidget);
    expect(find.byKey(const ValueKey('knowledge-scope-work')), findsOneWidget);
    expect(find.text('Entropy and the second law'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

/// A fake whose `knowledge.search` answer is delayed, so two overlapping
/// searches can finish out of order.
class _SlowCore extends FakeCore {
  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    final result = await super.call(method, params);
    if (method == 'knowledge.search') {
      final query = params?['query'];
      final slow = query == 'entropy';
      await Future<void>.delayed(Duration(milliseconds: slow ? 120 : 5));
    }
    return result;
  }
}
