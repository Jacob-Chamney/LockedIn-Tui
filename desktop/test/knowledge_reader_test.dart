import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/markdown.dart';
import 'package:lockedin_desktop/features/knowledge/knowledge_reader.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// One `knowledge.read` reply from the fake, parsed the way the store parses it,
/// so the widget assertions and the store assertions read the same bytes.
Future<KnowledgeDocument> readFixture(String id) async {
  final reply = await FakeCore().call('knowledge.read', {'id': id});
  return KnowledgeDocument.fromJson(reply);
}

Future<void> pumpReader(
  WidgetTester tester, {
  required String id,
  KnowledgeDocument? document,
  bool loading = false,
  String? error,
  List<String> hitIds = const <String>[],
  int? hitIndex,
  ValueChanged<int>? onNavigate,
  VoidCallback? onRetry,
  VoidCallback? onBack,
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
        body: KnowledgeReader(
          documentId: id,
          document: document,
          loading: loading,
          error: error,
          hitIds: hitIds,
          hitIndex: hitIndex,
          onNavigate: onNavigate,
          onRetry: onRetry,
          onBack: onBack,
        ),
      ),
    ),
  );
  // A pending spinner never settles, so the loading state pumps one frame.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

void main() {
  test('KnowledgeDocument tolerates missing and mistyped fields', () {
    final hit = {
      'id': 'note:school/a.md',
      'kind': 'NOTE',
      'title': 'A note',
      'side': 'SCHOOL',
      'path': 'school/a.md',
      'updated': '2026-11-02T09:00:00.000Z',
      'score': 2,
    };
    final document = KnowledgeDocument.fromJson({
      'hit': hit,
      'body': '# A note\n\ntext',
      'truncated': 'yes',
    });
    expect(document.hit.kind, 'note');
    expect(document.hit.side, 'school');
    expect(document.body, '# A note\n\ntext');
    expect(document.truncated, isFalse, reason: 'a non-bool is false');
    expect(document.hasNoBody, isFalse);

    final broken = KnowledgeDocument.fromJson({
      'hit': 'not a map',
      'body': 7,
      'truncated': true,
    });
    expect(broken.hit.id, '');
    expect(broken.hit.kind, '');
    expect(broken.body, '');
    expect(broken.hasNoBody, isTrue);
    expect(broken.truncated, isTrue);
  });

  test('the store reads an item, records the id and clears on close', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    expect(store.knowledgeDocumentOpen, isFalse);
    await store.readKnowledge('memory:2026-11-01-0900-physics-unit-4');

    expect(core.knowledgeReadIds, ['memory:2026-11-01-0900-physics-unit-4']);
    expect(store.knowledgeDocumentOpen, isTrue);
    expect(store.knowledgeDocumentLoading, isFalse);
    expect(store.knowledgeDocumentError, isNull);
    expect(store.knowledgeDocumentId, 'memory:2026-11-01-0900-physics-unit-4');
    expect(store.knowledgeDocument?.hit.kind, 'memory');
    expect(
      store.knowledgeDocument?.body,
      contains('Boundary conditions determine the integral limits.'),
    );

    store.closeKnowledgeDocument();
    expect(store.knowledgeDocumentOpen, isFalse);
    expect(store.knowledgeDocument, isNull);
    expect(store.knowledgeDocumentId, isNull);
    expect(store.knowledgeDocumentError, isNull);
  });

  test(
    'a failed read is one message and never throws, and retry clears it',
    () async {
      final core = FakeCore(knowledgeReadFailure: 'the note could not be read');
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.readKnowledge('note:school/vault/concepts/entropy.md');
      expect(store.knowledgeDocumentError, 'the note could not be read');
      expect(store.knowledgeDocument, isNull);
      expect(store.knowledgeDocumentLoading, isFalse);
      expect(
        store.knowledgeDocumentOpen,
        isTrue,
        reason: 'the reader stays open on the failure',
      );

      // Retry clears the error before asking again, and the id is unchanged.
      core.knowledgeReadFailure = null;
      await store.retryKnowledgeDocument();
      expect(store.knowledgeDocumentError, isNull);
      expect(store.knowledgeDocument?.hit.kind, 'note');
      expect(core.knowledgeReadIds, hasLength(2));
      expect(
        core.knowledgeReadIds.last,
        'note:school/vault/concepts/entropy.md',
      );
    },
  );

  test('a stale read cannot reopen the reader after close', () async {
    final core = _SlowReadCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    final pending = store.readKnowledge(
      'note:school/vault/concepts/entropy.md',
    );
    store.closeKnowledgeDocument();
    await pending;

    expect(store.knowledgeDocument, isNull);
    expect(store.knowledgeDocumentOpen, isFalse);
    expect(store.knowledgeDocumentError, isNull);
  });

  testWidgets('a note renders its own Markdown with kind and side', (
    tester,
  ) async {
    final document = await readFixture('note:school/vault/concepts/entropy.md');
    await pumpReader(
      tester,
      id: 'note:school/vault/concepts/entropy.md',
      document: document,
    );

    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('knowledge-reader-title')))
          .data,
      'Entropy and the second law',
    );
    expect(find.text('NOTE'), findsOneWidget);
    expect(find.text('school'), findsOneWidget);
    expect(
      find.textContaining(
        'kind note · side school · school/vault/concepts/entropy.md · '
        '2026-11-02',
      ),
      findsOneWidget,
    );
    expect(find.byType(ChatMarkdown), findsOneWidget);
    expect(
      find.textContaining('Entropy counts the microstates', findRichText: true),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-memory-label')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-source-label')),
      findsNothing,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-truncated')),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('session memory is labelled history, not a source', (
    tester,
  ) async {
    final document = await readFixture('memory:2026-11-01-0900-physics-unit-4');
    await pumpReader(
      tester,
      id: 'memory:2026-11-01-0900-physics-unit-4',
      document: document,
    );

    expect(find.text('MEMORY'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('knowledge-reader-memory-label')),
      findsOneWidget,
    );
    expect(find.text('session memory · history, not a source'), findsOneWidget);
    expect(
      find.textContaining('Boundary conditions determine', findRichText: true),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-source-label')),
      findsNothing,
    );
  });

  testWidgets('a copied source is content, not a new citation', (tester) async {
    final document = await readFixture(
      'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
    );
    await pumpReader(
      tester,
      id: 'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
      document: document,
    );

    expect(find.text('SOURCE'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('knowledge-reader-source-label')),
      findsOneWidget,
    );
    expect(
      find.text('copied source · content, not a new citation'),
      findsOneWidget,
    );
    expect(
      find.textContaining(
        'uniform field is the special case',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-memory-label')),
      findsNothing,
    );
  });

  testWidgets('a capped body says it is not the whole file', (tester) async {
    final core = FakeCore()..knowledgeReadTruncated = true;
    final reply = await core.call('knowledge.read', {
      'id': 'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
    });
    await pumpReader(
      tester,
      id: 'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
      document: KnowledgeDocument.fromJson(reply),
    );

    expect(
      find.byKey(const ValueKey('knowledge-reader-truncated')),
      findsOneWidget,
    );
    expect(
      find.text(
        'truncated · the core capped this body, so this is not the whole file',
      ),
      findsOneWidget,
    );
  });

  testWidgets('loading says reading and a failure offers a retry', (
    tester,
  ) async {
    await pumpReader(
      tester,
      id: 'note:school/vault/concepts/entropy.md',
      loading: true,
      settle: false,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-loading')),
      findsOneWidget,
    );
    expect(find.text('reading…'), findsWidgets);

    var retries = 0;
    await pumpReader(
      tester,
      id: 'note:school/vault/concepts/entropy.md',
      error: 'the note could not be read',
      onRetry: () => retries += 1,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-error')),
      findsOneWidget,
    );
    expect(find.text('the note could not be read'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('knowledge-reader-retry')));
    await tester.pumpAndSettle();
    expect(retries, 1);
  });

  testWidgets('Esc and the back control return to the list', (tester) async {
    var backs = 0;
    await pumpReader(
      tester,
      id: 'note:school/vault/concepts/entropy.md',
      document: await readFixture('note:school/vault/concepts/entropy.md'),
      onBack: () => backs += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);

    await tester.tap(find.byKey(const ValueKey('knowledge-reader-back')));
    await tester.pumpAndSettle();
    expect(backs, 2);
  });

  testWidgets('the reader fits 800x600', (tester) async {
    await pumpReader(
      tester,
      id: 'note:school/vault/concepts/entropy.md',
      document: await readFixture('note:school/vault/concepts/entropy.md'),
      size: const Size(800, 600),
    );

    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('knowledge-reader-title')))
          .data,
      'Entropy and the second law',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on a tree note opens it and Esc keeps the selection', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    // The tree's second note, so the selection is a real move rather than 0.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(core.knowledgeReadIds, [
      'school/vault/concepts/boundary-conditions.md',
    ]);
    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('knowledge-reader-title')))
          .data,
      'Boundary conditions',
    );
    expect(
      find.textContaining(
        'fixes the value or the derivative',
        findRichText: true,
      ),
      findsOneWidget,
    );
    // The status bar names the surface while the item is open.
    expect(find.text('KNOWLEDGE'), findsWidgets);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('knowledge-reader')), findsNothing);
    expect(find.text('PHYSICS'), findsOneWidget);
    // The cursor is still on the row that was opened.
    expect(
      find.descendant(
        of: find.byKey(
          const ValueKey(
            'knowledge-note-school/vault/concepts/boundary-conditions.md',
          ),
        ),
        matching: find.byKey(const ValueKey('knowledge-cursor')),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter on a search hit reads that hit', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    await tester.enterText(
      find.byKey(const ValueKey('knowledge-search')),
      'boundary',
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(core.knowledgeReadIds, [
      'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
    ]);
    expect(
      find.text('copied source · content, not a new citation'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed read shows the core message and retries in place', (
    tester,
  ) async {
    final core = FakeCore(knowledgeReadFailure: 'the note could not be read');
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(
      find.byKey(const ValueKey('knowledge-reader-error')),
      findsOneWidget,
    );
    expect(find.text('the note could not be read'), findsOneWidget);

    core.knowledgeReadFailure = null;
    await tester.tap(find.byKey(const ValueKey('knowledge-reader-retry')));
    await tester.pumpAndSettle();

    expect(core.knowledgeReadIds, hasLength(2));
    expect(find.byKey(const ValueKey('knowledge-reader-error')), findsNothing);
    expect(
      find.textContaining('Entropy counts the microstates', findRichText: true),
      findsOneWidget,
    );
  });

  testWidgets('switching surfaces collapses the reader', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 9);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);

    await openSurface(tester, 1);
    expect(find.byKey(const ValueKey('knowledge-reader')), findsNothing);

    await openSurface(tester, 9);
    expect(find.byKey(const ValueKey('knowledge-reader')), findsNothing);
    expect(find.text('PHYSICS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the header shows a position only for a search hit', (
    tester,
  ) async {
    final document = await readFixture('note:school/vault/concepts/entropy.md');
    await pumpReader(
      tester,
      id: 'hit:2',
      document: document,
      hitIds: [for (var index = 0; index < 12; index++) 'hit:$index'],
      hitIndex: 2,
    );

    expect(
      find.byKey(const ValueKey('knowledge-reader-position')),
      findsOneWidget,
    );
    expect(find.text('3 of 12'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('knowledge-reader-navhint')),
      findsNothing,
      reason: 'the hint only shows with an end-of-list note',
    );

    // A tree item has no result set, so it has no position to report.
    await pumpReader(
      tester,
      id: 'school/vault/concepts/entropy.md',
      document: document,
    );
    expect(
      find.byKey(const ValueKey('knowledge-reader-position')),
      findsNothing,
    );
  });

  testWidgets('[ and ] walk the hits, clamp at the ends and never wrap', (
    tester,
  ) async {
    final ids = [
      'note:school/vault/concepts/entropy.md',
      'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
      'memory:2026-11-01-0900-physics-unit-4',
    ];
    final documents = [for (final id in ids) await readFixture(id)];
    await pumpReaderHarness(tester, ids: ids, documents: documents);

    expect(find.text('1 of 3'), findsOneWidget);
    expect(
      find.textContaining('Entropy counts the microstates', findRichText: true),
      findsOneWidget,
    );

    // At the first hit `[` clamps instead of wrapping round to the last.
    await tester.sendKeyEvent(LogicalKeyboardKey.bracketLeft);
    await tester.pumpAndSettle();
    expect(find.text('first hit'), findsOneWidget);
    expect(find.text('1 of 3'), findsOneWidget);

    // `]` opens the next hit in place, without going back to the list.
    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    expect(find.text('2 of 3'), findsOneWidget);
    expect(
      find.text('copied source · content, not a new citation'),
      findsOneWidget,
    );
    expect(find.text('first hit'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    expect(find.text('3 of 3'), findsOneWidget);
    expect(find.text('session memory · history, not a source'), findsOneWidget);

    // The last hit clamps too.
    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    expect(find.text('last hit'), findsOneWidget);
    expect(find.text('3 of 3'), findsOneWidget);

    // And `[` walks back.
    await tester.sendKeyEvent(LogicalKeyboardKey.bracketLeft);
    await tester.pumpAndSettle();
    expect(find.text('2 of 3'), findsOneWidget);
    expect(find.text('last hit'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a tree item has no hits to move through', (tester) async {
    var navigations = 0;
    await pumpReader(
      tester,
      id: 'school/vault/concepts/entropy.md',
      document: await readFixture('note:school/vault/concepts/entropy.md'),
      onNavigate: (_) => navigations += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();

    expect(find.text('no hits to move through'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('knowledge-reader-position')),
      findsNothing,
    );
    expect(navigations, 0);
  });

  testWidgets('the reader with a hit position fits 800x600', (tester) async {
    await pumpReader(
      tester,
      id: 'hit:1',
      document: await readFixture('note:school/vault/concepts/entropy.md'),
      hitIds: ['hit:0', 'hit:1', 'hit:2'],
      hitIndex: 1,
      size: const Size(800, 600),
    );

    expect(find.text('2 of 3'), findsOneWidget);
    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a 635-pane drops the kind chip (pane, not window)', (
    tester,
  ) async {
    final document = await readFixture('note:school/vault/concepts/entropy.md');
    tester.view.physicalSize = const Size(900, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          // The pane is narrower than the window: only a pane-measured header
          // can notice, which is what the review asked to settle.
          body: Align(
            alignment: Alignment.centerLeft,
            child: SizedBox(
              width: 635,
              height: 800,
              child: KnowledgeReader(
                documentId: 'note:school/vault/concepts/entropy.md',
                document: document,
                loading: false,
                error: null,
                hitIds: const ['note:school/vault/concepts/entropy.md'],
                hitIndex: 0,
                onNavigate: (_) {},
                onRetry: () {},
                onBack: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);
    expect(find.text('NOTE'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

/// A reader whose parent owns the hit index, so `[`/`]` really move through a
/// result set instead of asking for the same index twice.
Future<void> pumpReaderHarness(
  WidgetTester tester, {
  required List<String> ids,
  required List<KnowledgeDocument> documents,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: _ReaderHarness(ids: ids, documents: documents),
    ),
  );
  await tester.pumpAndSettle();
}

class _ReaderHarness extends StatefulWidget {
  const _ReaderHarness({required this.ids, required this.documents});

  final List<String> ids;
  final List<KnowledgeDocument> documents;

  @override
  State<_ReaderHarness> createState() => _ReaderHarnessState();
}

class _ReaderHarnessState extends State<_ReaderHarness> {
  var _index = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: KnowledgeReader(
        documentId: widget.ids[_index],
        document: widget.documents[_index],
        hitIds: widget.ids,
        hitIndex: _index,
        onNavigate: (index) => setState(() => _index = index),
      ),
    );
  }
}

/// A fake whose `knowledge.read` answer arrives late, so a close can race the
/// answer it was waiting for.
class _SlowReadCore extends FakeCore {
  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    final result = await super.call(method, params);
    if (method == 'knowledge.read') {
      await Future<void>.delayed(const Duration(milliseconds: 120));
    }
    return result;
  }
}
