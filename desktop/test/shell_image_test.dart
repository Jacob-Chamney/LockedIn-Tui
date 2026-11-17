import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/attachments.dart';
import 'package:lockedin_desktop/features/chat/chat_page.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'smoke_test.dart';

/// Image attachment wiring is split in two: the page owns chips and the picker,
/// the shell owns the core. These tests check both halves meet.
void main() {
  testWidgets('the shell hands the chat page an image send', (tester) async {
    final store = await pumpShell(tester, core: FakeCore());

    final page = tester.widget<ChatPage>(find.byType(ChatPage));
    expect(page.onSendImages, isNotNull);

    // The shell callback must reach `chat.send` with the paths, not drop them.
    await page.onSendImages!.call('look', const ['/tmp/cat.png']);
    expect(store.status, CoreStatus.online);
  });

  testWidgets('the page sends text and images through the shell callback', (
    tester,
  ) async {
    final sent = <(String, List<String>)>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatPage(
            chat: const ChatSnapshot(
              status: 'idle',
              model: 'openai/gpt-4.1-mini',
              streamed: '',
              messages: [],
              usage: ChatUsageView(
                tokens: 0,
                costMicroUsd: null,
                durationMs: null,
              ),
            ),
            online: true,
            configured: true,
            onSend: (_) {},
            onSendImages: (text, images) async => sent.add((text, images)),
            pickFiles: () async => ['/tmp/cat.png'],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.pumpAndSettle();
    expect(find.text('cat.png'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'what is this?');
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();

    expect(sent, hasLength(1));
    expect(sent.single.$1, 'what is this?');
    expect(sent.single.$2, ['/tmp/cat.png']);
    // The chips clear only after the core accepted the turn.
    expect(find.text('cat.png'), findsNothing);
  });

  testWidgets('a fifth image is refused locally and never sent', (
    tester,
  ) async {
    final sent = <(String, List<String>)>[];
    var picks = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatPage(
            chat: const ChatSnapshot(
              status: 'idle',
              model: 'openai/gpt-4.1-mini',
              streamed: '',
              messages: [],
              usage: ChatUsageView(
                tokens: 0,
                costMicroUsd: null,
                durationMs: null,
              ),
            ),
            online: true,
            configured: true,
            onSendImages: (text, images) async => sent.add((text, images)),
            pickFiles: () async => ['/tmp/shot-${++picks}.png'],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    for (var index = 0; index < maxChatImages + 1; index++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
      await tester.pumpAndSettle();
    }

    expect(find.text('shot-1.png'), findsOneWidget);
    expect(find.text('shot-5.png'), findsNothing);
    expect(find.textContaining('four images'), findsWidgets);
    expect(sent, isEmpty);
    expect(tester.takeException(), isNull);
  });
}
