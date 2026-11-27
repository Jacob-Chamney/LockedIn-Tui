import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/chat_page.dart';
import 'package:lockedin_desktop/features/chat/markdown.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:lockedin_desktop/theme/tokens.dart';
import 'package:material_ui/material_ui.dart';

const _usage = ChatUsageView(tokens: 12, costMicroUsd: 400, durationMs: 900);

ChatSnapshot _chat({
  String status = 'idle',
  List<ChatMessageView> messages = const [],
  String streamed = '',
}) => ChatSnapshot(
  status: status,
  model: 'openai/gpt-4.1-mini',
  streamed: streamed,
  messages: messages,
  usage: _usage,
);

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

Widget _markdown(String text) => _app(
  SingleChildScrollView(
    padding: const EdgeInsets.all(16),
    child: ChatMarkdown(text: text),
  ),
);

/// Every span reachable from a [Text] widget, so inline styling can be
/// asserted without depending on the widget tree shape.
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

TextSpan? _spanWith(List<InlineSpan> spans, String content) {
  for (final span in spans) {
    if (span is TextSpan && span.text == content) return span;
  }
  return null;
}

void main() {
  testWidgets('headings, lists, numbered items and inline code render', (
    tester,
  ) async {
    await tester.pumpWidget(
      _markdown(
        '## Heading\n\n'
        'A paragraph with `code` and **bold** and *italic*.\n\n'
        '- bullet one\n'
        '- bullet two\n\n'
        '1. first\n'
        '2. second',
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Heading'), findsOneWidget);
    expect(find.text('bullet one'), findsOneWidget);
    expect(find.text('bullet two'), findsOneWidget);
    expect(find.text('first'), findsOneWidget);
    expect(find.text('second'), findsOneWidget);

    final spans = _spans(tester);
    final code = _spanWith(spans, 'code');
    expect(code, isNotNull);
    expect(code!.style?.fontFamily, LockedInType.mono);

    final bold = _spanWith(spans, 'bold');
    expect(bold?.style?.fontWeight, FontWeight.w700);

    final italic = _spanWith(spans, 'italic');
    expect(italic?.style?.fontStyle, FontStyle.italic);
  });

  testWidgets('a fenced code block scrolls horizontally', (tester) async {
    await tester.pumpWidget(
      _markdown('```dart\nfinal x = 1;\nfinal y = 2;\n```'),
    );
    await tester.pumpAndSettle();

    final horizontal = tester
        .widgetList<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .where((view) => view.scrollDirection == Axis.horizontal)
        .toList();
    expect(horizontal, hasLength(1));

    // A known language is highlighted into spans; its plain text is unchanged.
    final code = tester
        .widgetList<Text>(find.byType(Text))
        .firstWhere(
          (widget) =>
              widget.textSpan?.toPlainText() == 'final x = 1;\nfinal y = 2;',
        );
    expect(code.textSpan?.style?.fontFamily, LockedInType.mono);
    expect(code.textSpan?.toPlainText(), 'final x = 1;\nfinal y = 2;');
  });

  testWidgets('checkbox items show checked and unchecked glyphs', (
    tester,
  ) async {
    await tester.pumpWidget(_markdown('- [ ] todo\n- [x] done'));
    await tester.pumpAndSettle();

    expect(find.text('☐'), findsOneWidget);
    expect(find.text('☑'), findsOneWidget);
    expect(find.text('todo'), findsOneWidget);
    expect(find.text('done'), findsOneWidget);
  });

  testWidgets('partial streaming markdown does not throw', (tester) async {
    await tester.pumpWidget(_markdown('## title\n- item\n```dart\nunclosed'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('title'), findsOneWidget);
    expect(find.text('item'), findsOneWidget);
    expect(find.text('unclosed'), findsOneWidget);

    // A dangling emphasis marker renders literally rather than vanishing.
    await tester.pumpWidget(_markdown('a **b'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('a **b'), findsOneWidget);

    await tester.pumpWidget(_markdown(''));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('ChatPage renders assistant markdown with outcome markers', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(
            messages: const [
              ChatMessageView(
                id: 'a',
                role: 'assistant',
                text: '## Answer\n\nThe steps are:\n\n- one\n- two',
                outcome: 'stopped',
              ),
              ChatMessageView(
                id: 'b',
                role: 'assistant',
                text: 'no answer',
                outcome: 'failed',
              ),
            ],
          ),
          online: true,
          configured: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ChatMarkdown), findsNWidgets(2));
    expect(find.text('Answer'), findsOneWidget);
    expect(find.text('one'), findsOneWidget);
    expect(find.text('two'), findsOneWidget);
    expect(find.text('— stopped'), findsOneWidget);
    expect(find.text('× failed'), findsOneWidget);
  });

  testWidgets('a long code block does not overflow at 800x600', (tester) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final longLine = 'x' * 500;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(
            status: 'streaming',
            streamed: '```\n$longLine\n```\n',
            messages: const [
              ChatMessageView(
                id: 'a',
                role: 'assistant',
                text: '',
                outcome: null,
              ),
            ],
          ),
          online: true,
          configured: true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(ChatMarkdown), findsOneWidget);
    expect(find.text(longLine), findsOneWidget);
  });
}
