import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/chat_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _usage = ChatUsageView(tokens: 12, costMicroUsd: 400, durationMs: 900);

ChatSnapshot _chat({
  String status = 'idle',
  List<ChatMessageView> messages = const [],
  String streamed = '',
  ChatBlocked? blocked,
}) => ChatSnapshot(
  status: status,
  model: 'openai/gpt-4.1-mini',
  streamed: streamed,
  messages: messages,
  usage: _usage,
  blocked: blocked,
);

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

void main() {
  testWidgets('a send is an intent, not a local message', (tester) async {
    var sent = '';
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (text) => sent = text,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'hello');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();

    expect(sent, 'hello');
    expect(find.text('Echo: hello'), findsNothing);
  });

  testWidgets('Shift+Enter is not intercepted, so it never sends', (
    tester,
  ) async {
    var sent = '';
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (text) => sent = text,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField));
    await tester.enterText(find.byType(TextField), 'line one');
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();

    // The field keeps its own newline handling; the page must not send.
    expect(sent, '');
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller?.text, 'line one');
    expect(field.maxLines, greaterThan(1));
  });

  testWidgets('focusing the composer reports INSERT to the shell', (
    tester,
  ) async {
    bool? mode;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) {},
          onModeChanged: (insert) => mode = insert,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(mode, isTrue);
  });

  testWidgets('streaming shows Stop and cancel reaches the shell', (
    tester,
  ) async {
    var cancelled = false;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(
            status: 'streaming',
            messages: const [
              ChatMessageView(
                id: 'u',
                role: 'user',
                text: 'hi',
                outcome: 'done',
              ),
              ChatMessageView(
                id: 'a',
                role: 'assistant',
                text: '',
                outcome: null,
              ),
            ],
            streamed: 'partial answer',
          ),
          online: true,
          configured: true,
          onCancel: () => cancelled = true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('partial answer'), findsOneWidget);
    expect(find.text('Stop'), findsOneWidget);
    await tester.tap(find.text('Stop'));
    expect(cancelled, isTrue);
  });

  testWidgets('core outcomes map to stopped and failed markers', (
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
                text: 'half an answer',
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

    expect(find.text('— stopped'), findsOneWidget);
    expect(find.text('× failed'), findsOneWidget);
  });

  testWidgets('a blocked chat explains the reason and fix', (tester) async {
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(
            blocked: const ChatBlocked(
              reason: 'day budget reached',
              fix: 'raise it in Settings',
            ),
          ),
          online: true,
          configured: false,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('day budget reached'), findsOneWidget);
    expect(find.textContaining('raise it in Settings'), findsOneWidget);
    expect(find.text('Send'), findsOneWidget);
  });

  testWidgets('typing a draft is allowed without a model; send is not', (
    tester,
  ) async {
    var sent = '';
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: false,
          onSend: (text) => sent = text,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'a draft');
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller?.text,
      'a draft',
    );

    await tester.tap(find.text('Send'));
    await tester.pump();
    expect(sent, '');
  });

  testWidgets('offline shows the reason and a retry', (tester) async {
    var retried = false;
    await tester.pumpWidget(
      _app(
        ChatPage(
          online: false,
          configured: false,
          error: 'bun not found',
          onRetry: () => retried = true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('core offline'), findsWidgets);
    expect(find.text('bun not found'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retried, isTrue);
  });

  testWidgets('an empty transcript invites a message', (tester) async {
    await tester.pumpWidget(
      _app(ChatPage(chat: _chat(), online: true, configured: true)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ask anything…'), findsOneWidget);
    expect(find.textContaining('read-only'), findsWidgets);
  });
}
