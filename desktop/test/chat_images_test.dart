import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/attachments.dart';
import 'package:lockedin_desktop/features/chat/chat_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _usage = ChatUsageView(tokens: 0, costMicroUsd: null, durationMs: null);

ChatSnapshot _chat({ChatBlocked? blocked}) => ChatSnapshot(
  status: 'idle',
  model: 'openai/gpt-4.1-mini',
  streamed: '',
  messages: const [],
  usage: _usage,
  blocked: blocked,
);

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

/// A picker that answers one fresh path per call, so "the fifth attach" is a
/// real fifth pick rather than the same path deduplicated.
AttachmentPicker _countingPicker(String prefix) {
  var count = 0;
  return () async => ['/home/me/Pictures/$prefix-${count++}.png'];
}

/// `Ctrl+Shift+X`, held and released like a keyboard, not a bare key event.
Future<void> _clearAllByKey(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

Future<void> _attachByTap(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('chat-attach')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('p opens the picker and attaches one chip', (tester) async {
    var picks = 0;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) async => true,
          pickFiles: () async {
            picks += 1;
            return ['/home/me/Pictures/diagram.png'];
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.pumpAndSettle();

    expect(picks, 1);
    expect(find.byKey(const ValueKey('chat-attachments')), findsOneWidget);
    expect(find.text('diagram.png'), findsOneWidget);
  });

  testWidgets('four images are accepted and the fifth is refused', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) async => true,
          pickFiles: _countingPicker('shot'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    for (var index = 0; index < maxChatImages; index++) {
      await _attachByTap(tester);
    }
    expect(find.byKey(const ValueKey('chat-attachment-0')), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-attachment-3')), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-attach-notice')), findsNothing);

    await _attachByTap(tester);

    // The fifth pick is refused with a message: no chip, no silent drop.
    expect(find.byKey(const ValueKey('chat-attachment-4')), findsNothing);
    expect(find.byKey(const ValueKey('chat-attach-notice')), findsOneWidget);
    expect(find.textContaining('four images max'), findsOneWidget);
  });

  testWidgets('a chip can be removed and Ctrl+Shift+X clears the rest', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) async => true,
          pickFiles: _countingPicker('shot'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await _attachByTap(tester);
    await _attachByTap(tester);
    expect(find.text('shot-0.png'), findsOneWidget);
    expect(find.text('shot-1.png'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-attachment-remove-0')));
    await tester.pumpAndSettle();
    expect(find.text('shot-0.png'), findsNothing);
    expect(find.text('shot-1.png'), findsOneWidget);

    await _clearAllByKey(tester);
    expect(find.text('shot-1.png'), findsNothing);
    expect(find.byKey(const ValueKey('chat-attachments')), findsNothing);
  });

  testWidgets('a send carries the chip paths and clears them', (tester) async {
    String? sentText;
    List<String>? sentImages;
    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) async => true,
          onSendImages: (text, images) async {
            sentText = text;
            sentImages = images;
            return true;
          },
          pickFiles: _countingPicker('shot'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await _attachByTap(tester);
    await tester.enterText(find.byType(TextField), 'what is this?');
    await tester.pump();

    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await tester.pumpAndSettle();

    expect(sentText, 'what is this?');
    expect(sentImages, ['/home/me/Pictures/shot-0.png']);
    expect(find.text('shot-0.png'), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller?.text,
      '',
    );
  });

  testWidgets('a blocked chat keeps the chips and disables Send', (
    tester,
  ) async {
    var imagesSent = 0;
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
          onSend: (_) async => true,
          onSendImages: (text, images) async {
            imagesSent += 1;
            return true;
          },
          pickFiles: _countingPicker('shot'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await _attachByTap(tester);
    expect(find.text('shot-0.png'), findsOneWidget);
    expect(find.textContaining('day budget reached'), findsOneWidget);

    final send = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Send'),
    );
    expect(send.onPressed, isNull);

    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await tester.pumpAndSettle();
    expect(imagesSent, 0);
    expect(find.text('shot-0.png'), findsOneWidget);
  });

  testWidgets('four chips fit at 800x600 without an overflow', (tester) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _app(
        ChatPage(
          chat: _chat(),
          online: true,
          configured: true,
          onSend: (_) async => true,
          onSendImages: (text, images) async {
            return true;
          },
          pickFiles: _countingPicker('shot'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    for (var index = 0; index < maxChatImages; index++) {
      await _attachByTap(tester);
    }

    expect(find.byKey(const ValueKey('chat-attachment-3')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  group('CoreStore.sendChat', () {
    test('omits images when no image is attached', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.sendChat('hello');

      expect(core.chatSends, [
        {'text': 'hello'},
      ]);
      expect(core.chatSends.single.containsKey('images'), isFalse);
    });

    test('forwards the picked paths when images are attached', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.sendChat('look', images: ['/tmp/a.png', '/tmp/b.png']);

      expect(core.chatSends.single['text'], 'look');
      expect(core.chatSends.single['images'], ['/tmp/a.png', '/tmp/b.png']);
    });
  });
}
