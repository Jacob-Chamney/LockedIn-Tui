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
  ChatFailure? error,
  String model = 'openai/gpt-4.1-mini',
}) => ChatSnapshot(
  status: status,
  model: model,
  streamed: streamed,
  messages: messages,
  usage: _usage,
  blocked: blocked,
  error: error,
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
          onSend: (text) async {
            sent = text;
            return true;
          },
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
          onSend: (text) async {
            sent = text;
            return true;
          },
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
          onSend: (_) async => true,
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

  testWidgets('i returns to the composer from NORMAL', (tester) async {
    var mode = false;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(messages: const []),
          online: true,
          configured: true,
          onSend: (_) async => true,
          onModeChanged: (insert) => mode = insert,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Leave the composer, then `i` brings it back: the terminal app's insert.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyI);
    await tester.pumpAndSettle();

    expect(mode, isTrue);
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.focusNode?.hasFocus, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc stops the reply, with the composer still focused', (
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

    // The composer holds focus while a turn streams; Esc must still stop it.
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();

    expect(cancelled, isTrue);
    expect(tester.takeException(), isNull);
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
          onSend: (text) async {
            sent = text;
            return true;
          },
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

  testWidgets('offline shows the reason and reconnects', (tester) async {
    var reconnected = false;
    await tester.pumpWidget(
      _app(
        ChatPage(
          online: false,
          configured: false,
          error: 'bun not found',
          onRetry: () {},
          onReconnect: () => reconnected = true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('core offline'), findsWidgets);
    expect(find.text('bun not found'), findsOneWidget);
    // Restarting the core is a reconnect, not a retry of the last message.
    await tester.tap(find.text('Reconnect'));
    expect(reconnected, isTrue);
  });

  testWidgets('a launch in progress says connecting, not offline', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(ChatPage(online: false, configured: false, connecting: true)),
    );
    await tester.pumpAndSettle();

    // The body card and the composer line both say it is starting.
    expect(find.text('connecting…'), findsWidgets);
    expect(find.text('core offline'), findsNothing);
    expect(find.text('Reconnect'), findsNothing);
  });

  testWidgets('a failed turn keeps the transcript and offers a retry', (
    tester,
  ) async {
    var retried = false;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(
            messages: const [
              ChatMessageView(
                id: 'm1',
                role: 'user',
                text: 'where do the limits come from?',
              ),
            ],
            error: const ChatFailure(
              failed: 'provider rejected the request',
              kept: 'your question is kept',
              next: 'relink the key',
            ),
          ),
          online: true,
          configured: true,
          onRetry: () => retried = true,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The message is still readable: the failure is a banner, not a page.
    expect(find.text('where do the limits come from?'), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-failure-banner')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('chat-failure-retry')));
    await tester.pump();
    expect(retried, isTrue);
  });

  testWidgets('a refused send keeps the composer text', (tester) async {
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) async => false,
          sendError: 'the core is busy',
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const ValueKey('chat-composer')),
      'a question worth keeping',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('chat-composer')));
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('chat-composer')))
          .controller
          ?.text,
      'a question worth keeping',
    );
    expect(find.textContaining('the core is busy'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the header ellipsises a long model id at 800x600', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final longModel = 'openrouter/${'a-very-long-vendor-model-tag/' * 4}end';
    await tester.pumpWidget(
      _app(
        ChatPage(chat: _chat(model: longModel), online: true, configured: true),
      ),
    );
    await tester.pumpAndSettle();

    // The model string is a value, not a layout decision: it may not overflow.
    expect(tester.takeException(), isNull);
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
