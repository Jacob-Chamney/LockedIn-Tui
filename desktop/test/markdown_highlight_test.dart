import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/chat/code_highlight.dart';
import 'package:lockedin_desktop/features/chat/markdown.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: child,
    ),
  ),
);

/// Every span reachable from the rendered Markdown.
List<InlineSpan> _spans(WidgetTester tester) {
  final spans = <InlineSpan>[];
  void walk(InlineSpan span) {
    spans.add(span);
    if (span is TextSpan && span.children != null) {
      for (final child in span.children!) {
        walk(child);
      }
    }
  }

  for (final text in tester.widgetList<Text>(find.byType(Text))) {
    final span = text.textSpan;
    if (span != null) walk(span);
  }
  return spans;
}

TextSpan _spanWith(List<InlineSpan> spans, String text) {
  for (final span in spans) {
    if (span is TextSpan && span.text == text) return span;
  }
  throw TestFailure('no span with text "$text"');
}

void main() {
  test('a Dart line classifies comments, strings, numbers and keywords', () {
    final tokens = highlightCodeLine('final count = 12; // how many', 'dart');
    final byText = {for (final token in tokens) token.text: token.kind};

    expect(byText['final'], CodeTokenKind.keyword);
    expect(byText['12'], CodeTokenKind.number);
    expect(byText['// how many'], CodeTokenKind.comment);
    expect(
      highlightCodeLine(
        'var name = "locked";',
        'dart',
      ).any((token) => token.kind == CodeTokenKind.string),
      isTrue,
    );
    expect(
      highlightCodeLine(
        'var flag = true;',
        'dart',
      ).any((token) => token.kind == CodeTokenKind.literal),
      isTrue,
    );
  });

  test('every shipped language tokenises without throwing', () {
    for (final label in const [
      'dart',
      'ts',
      'typescript',
      'js',
      'javascript',
      'json',
      'bash',
      'sh',
      'python',
      'c',
      'cpp',
      'markdown',
      'md',
    ]) {
      final tokens = highlightCode('a "b\n# c\n// d\n', label);
      expect(tokens, isNotNull, reason: label);
      expect(tokens!.map((token) => token.text).join(), 'a "b\n# c\n// d\n');
    }
  });

  test('an unknown language does no work and returns null', () {
    expect(codeLanguageFor('brainfuck'), isNull);
    expect(codeLanguageFor(''), isNull);
    expect(highlightCode('let x = 1;', 'brainfuck'), isNull);
  });

  test('a 200-line block tokenises and round-trips its bytes', () {
    final code = [
      for (var index = 0; index < 200; index++)
        'final value$index = $index; // line $index',
    ].join('\n');

    final tokens = highlightCode(code, 'dart');

    expect(tokens, isNotNull);
    expect(tokens!.length, greaterThan(200));
    expect(
      tokens.where((token) => token.kind == CodeTokenKind.keyword).length,
      200,
    );
    expect(
      tokens.where((token) => token.kind == CodeTokenKind.comment).length,
      200,
    );
    expect(tokens.map((token) => token.text).join(), code);
  });

  testWidgets('a Dart fence colours comment, string, number and keyword', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        const ChatMarkdown(
          text:
              '```dart\n'
              '// a note\n'
              'final name = "locked";\n'
              'final count = 12;\n'
              '```',
        ),
      ),
    );
    await tester.pumpAndSettle();

    final spans = _spans(tester);
    final comment = _spanWith(spans, '// a note');
    final string = _spanWith(spans, '"locked"');
    final number = _spanWith(spans, '12');
    final keyword = _spanWith(spans, 'final');

    expect(comment.style?.color, LockedInColors.muted);
    expect(string.style?.color, LockedInColors.success);
    expect(number.style?.color, LockedInColors.accent);
    expect(keyword.style?.color, LockedInColors.primary);
    expect(comment.style?.color, isNot(string.style?.color));
    expect(string.style?.color, isNot(keyword.style?.color));
    expect(tester.takeException(), isNull);
  });

  testWidgets('an unterminated string and a partial fence never throw', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(const ChatMarkdown(text: '```dart\nfinal x = "oops\n```')),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    final spans = _spans(tester);
    expect(_spanWith(spans, '"oops').style?.color, LockedInColors.success);

    // A streaming answer with no closing fence at all is the same case.
    await tester.pumpWidget(
      _app(const ChatMarkdown(text: '```dart\nfinal x = "still typing')),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(
      find.textContaining('still typing', findRichText: true),
      findsOneWidget,
    );
  });

  testWidgets('an unknown language renders plain foreground', (tester) async {
    await tester.pumpWidget(
      _app(const ChatMarkdown(text: '```brainfuck\nlet x = 1;\n```')),
    );
    await tester.pumpAndSettle();

    expect(find.text('let x = 1;'), findsOneWidget);
    final code = tester.widget<Text>(find.text('let x = 1;'));
    expect(code.style?.fontFamily, 'monospace');
    expect(code.style?.color, LockedInColors.foreground);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a fenced block keeps its horizontal scroll and monospace panel',
    (tester) async {
      await tester.pumpWidget(
        _app(
          const ChatMarkdown(text: '```dart\nfinal x = 1;\nfinal y = 2;\n```'),
        ),
      );
      await tester.pumpAndSettle();

      final horizontal = tester
          .widgetList<SingleChildScrollView>(find.byType(SingleChildScrollView))
          .where((view) => view.scrollDirection == Axis.horizontal)
          .toList();
      expect(horizontal, hasLength(1));

      // The highlighted line still renders as one monospace block.
      final text = tester
          .widgetList<Text>(find.byType(Text))
          .firstWhere(
            (widget) =>
                widget.textSpan?.toPlainText() == 'final x = 1;\nfinal y = 2;',
          );
      expect(text.textSpan?.style?.fontFamily, 'monospace');
      expect(tester.takeException(), isNull);
    },
  );
}
