import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/document_search.dart';
import 'package:lockedin_desktop/features/knowledge/knowledge_reader.dart';
import 'package:lockedin_desktop/features/sessions/session_outputs.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _hit = KnowledgeHit(
  id: 'note:school/demo.md',
  kind: 'note',
  title: 'Demo note',
  excerpt: '',
  side: 'school',
  path: 'school/demo.md',
  updated: '2026-11-01T09:00:00Z',
  score: 0,
);

KnowledgeDocument _document(String body) =>
    KnowledgeDocument(hit: _hit, body: body);

Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(800, 600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

String _countText(WidgetTester tester) => tester
    .widget<Text>(find.byKey(const ValueKey('document-search-count')))
    .data!;

/// `/`, type [query], then Enter so the reader owns `n`/`N` again.
Future<void> _search(WidgetTester tester, String query) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.slash);
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('document-search-field')),
    query,
  );
  await tester.pump();
  await tester.testTextInput.receiveAction(TextInputAction.search);
  await tester.pumpAndSettle();
}

Future<void> _pressShiftN(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pumpAndSettle();
}

void main() {
  test('the matcher is case-insensitive and non-overlapping', () {
    const text = 'Alpha alpha ALPHA';
    final matches = findDocumentMatches(text, 'aLpHa');
    expect(matches, hasLength(3));
    expect(matches.first.start, 0);
    expect(matches.first.textIn(text), 'Alpha');
    expect(matches.last.end, text.length);
  });

  test('the matcher caps at 200 matches', () {
    final text = List.filled(250, 'ab').join(' ');
    final matches = findDocumentMatches(text, 'AB');
    expect(matches, hasLength(200));
    expect(matches.last.end, lessThanOrEqualTo(text.length));
  });

  test('a blank query is an empty result, not an error', () {
    expect(findDocumentMatches('alpha', ''), isEmpty);
    expect(findDocumentMatches('alpha', '   '), isEmpty);
    expect(findDocumentMatches('', 'alpha'), isEmpty);
  });

  testWidgets('the bar shows the count and n/N step and clamp at the ends', (
    tester,
  ) async {
    await _pump(
      tester,
      KnowledgeReader(
        documentId: _hit.id,
        document: _document(
          '# Boundary\n\n'
          'The first boundary condition fixes the value.\n\n'
          'The second boundary condition fixes the derivative.\n',
        ),
        onBack: () {},
      ),
    );

    await _search(tester, 'boundary');

    expect(find.byKey(const ValueKey('document-search-bar')), findsOneWidget);
    expect(_countText(tester), '1 of 3');
    expect(find.byKey(const ValueKey('document-search-match')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();
    expect(_countText(tester), '2 of 3');

    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();
    expect(_countText(tester), '3 of 3');

    // The last match clamps rather than wrapping round.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();
    expect(_countText(tester), '3 of 3');

    await _pressShiftN(tester);
    expect(_countText(tester), '2 of 3');

    // The first match clamps too.
    await _pressShiftN(tester);
    expect(_countText(tester), '1 of 3');
    await _pressShiftN(tester);
    expect(_countText(tester), '1 of 3');
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc closes the bar and leaves the document readable', (
    tester,
  ) async {
    await _pump(
      tester,
      KnowledgeReader(
        documentId: _hit.id,
        document: _document('The boundary condition is discussed here.\n'),
        onBack: () {},
      ),
    );

    await _search(tester, 'boundary');
    expect(find.byKey(const ValueKey('document-search-bar')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('document-search-bar')), findsNothing);
    expect(
      find.textContaining(
        'boundary condition is discussed',
        findRichText: true,
      ),
      findsOneWidget,
    );
    // Esc restored the reader rather than leaving the reader layer.
    expect(find.byKey(const ValueKey('knowledge-reader')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a no-match query says so and keeps the document readable', (
    tester,
  ) async {
    await _pump(
      tester,
      KnowledgeReader(
        documentId: _hit.id,
        document: _document('The boundary condition is discussed here.\n'),
        onBack: () {},
      ),
    );

    await _search(tester, 'absent');

    expect(_countText(tester), 'no matches');
    expect(find.byKey(const ValueKey('document-search-match')), findsNothing);
    expect(
      find.textContaining(
        'boundary condition is discussed',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('search works in the deck reader', (tester) async {
    const deck =
        '# Flashcards\n\n'
        '## Card 1\n\n'
        'Q: What does the learning rate control?\n'
        'A: The step size of each update.\n\n'
        '## Card 2\n\n'
        'Q: Why does the learning rate matter?\n'
        'A: It changes convergence.\n';

    await _pump(
      tester,
      const SessionOutputView(
        sessionName: 'Physics — Unit 4',
        kind: 'flashcards',
        markdown: deck,
        answers: null,
        exists: true,
        loading: false,
        error: null,
      ),
    );

    await _search(tester, 'learning rate');

    expect(find.text('FLASHCARDS'), findsOneWidget);
    expect(find.byKey(const ValueKey('document-search-bar')), findsOneWidget);
    expect(_countText(tester), '1 of 2');

    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();
    expect(_countText(tester), '2 of 2');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the search bar fits 800x600 without overflow', (tester) async {
    await _pump(
      tester,
      KnowledgeReader(
        documentId: _hit.id,
        document: _document(
          [
            for (var index = 0; index < 120; index++)
              'Paragraph $index mentions the boundary condition.',
          ].join('\n\n'),
        ),
        onBack: () {},
      ),
    );

    await _search(tester, 'boundary');

    expect(find.byKey(const ValueKey('document-search-bar')), findsOneWidget);
    expect(_countText(tester), '1 of 120');
    expect(tester.takeException(), isNull);
  });
}
