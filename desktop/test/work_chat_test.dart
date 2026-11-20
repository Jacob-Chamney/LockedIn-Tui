import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// Open the one fake project's detail through the Work list.
Future<CoreStore> openProject(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  final store = await pumpShell(tester, core: core, size: size);
  await openSurface(tester, 6);
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
  return store;
}

Future<void> openProjectChat(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
  await tester.pumpAndSettle();
}

Future<void> sendWorkTurn(WidgetTester tester, String text) async {
  const composer = ValueKey('work-chat-composer');
  await tester.tap(find.byKey(composer));
  await tester.pump();
  await tester.enterText(find.byKey(composer), text);
  await tester.pump();
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
}

/// Let the broadcast stream deliver the events the fake queued synchronously
/// during the call, with no wall-clock dependency.
Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  testWidgets('c opens the project chat and renders its transcript', (
    tester,
  ) async {
    final store = await openProject(tester);

    expect(store.activeProjectId, FakeCore.projectId);
    expect(store.projectChats, ['chat-1']);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(find.text('1 chat'), findsOneWidget);
    expect(find.text('Open chat'), findsOneWidget);

    await openProjectChat(tester);

    expect(store.activeWorkChatId, 'chat-1');
    expect(store.workChat, isNotNull);
    expect(find.byKey(const ValueKey('work-chat-composer')), findsOneWidget);
    expect(find.text('PROJECT CHAT'), findsOneWidget);
    expect(
      find.textContaining('project chat · chat-1', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Where should pagination go?'), findsOneWidget);
    expect(
      find.textContaining('Start with the list endpoint.', findRichText: true),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the detail action opens the newest chat too', (tester) async {
    final store = await openProject(tester);

    await tester.tap(find.byKey(const ValueKey('work-open-chat')));
    await tester.pumpAndSettle();

    expect(store.activeWorkChatId, 'chat-1');
    expect(find.byKey(const ValueKey('work-chat-composer')), findsOneWidget);
    expect(find.text('PROJECT CHAT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a send calls work.chat.send, never chat or session chat', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await openProject(tester, core: core);
    await openProjectChat(tester);

    await sendWorkTurn(tester, 'hello');

    expect(core.calls, contains('work.chat.send'));
    expect(core.calls, isNot(contains('chat.send')));
    expect(core.calls, isNot(contains('session.chat.send')));
    expect(
      find.textContaining('Project echo: hello', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('hello'), findsOneWidget);
    expect(store.workChat?.messages, hasLength(4));
    expect(store.chat?.messages, isEmpty);
    expect(store.sessionChats, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc returns to the project and Chill keeps no project echo', (
    tester,
  ) async {
    final store = await openProject(tester);
    await openProjectChat(tester);
    await sendWorkTurn(tester, 'hello');
    expect(
      find.textContaining('Project echo: hello', findRichText: true),
      findsOneWidget,
    );

    // The composer holds the keyboard after a send: the first Esc leaves
    // INSERT, the second leaves the chat.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('work-chat-composer')), findsOneWidget);
    expect(find.text('NORMAL'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('work-chat-composer')), findsNothing);
    expect(find.text('Prefer small diffs.'), findsOneWidget);
    expect(find.text('PROJECT'), findsOneWidget);
    expect(store.activeProjectId, FakeCore.projectId);
    // The chat id and its snapshot survive the collapse.
    expect(store.activeWorkChatId, 'chat-1');
    expect(store.workChat?.messages, hasLength(4));

    await openSurface(tester, 1);

    expect(find.text('Chill'), findsWidgets);
    expect(
      find.textContaining('Project echo: hello', findRichText: true),
      findsNothing,
    );
    expect(find.text('hello'), findsNothing);
    expect(store.chat?.messages, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a state for another project chat never replaces the active one',
    (tester) async {
      final core = FakeCore();
      final store = await openProject(tester, core: core);
      await openProjectChat(tester);

      core.emitEvent('work.chat.state', {
        'projectId': FakeCore.projectId,
        'chatId': 'chat-2',
        'status': 'idle',
        'model': store.workChat?.model,
        'streamed': '',
        'messages': [
          {
            'id': 'other-1',
            'role': 'assistant',
            'text': 'Other chat turn',
            'outcome': 'done',
          },
        ],
        'blocked': null,
        'error': null,
        'usage': {'tokens': 3, 'costMicroUsd': null, 'durationMs': null},
      });
      await tester.pumpAndSettle();

      expect(store.activeWorkChatId, 'chat-1');
      expect(store.workChatFor(FakeCore.projectId, 'chat-2'), isNotNull);
      expect(
        find.textContaining('Other chat turn', findRichText: true),
        findsNothing,
      );
      expect(find.text('Where should pagination go?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the project composer reports INSERT and NORMAL', (tester) async {
    await openProject(tester);
    await openProjectChat(tester);

    expect(find.text('NORMAL'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('work-chat-composer')));
    await tester.pump();
    expect(find.text('INSERT'), findsOneWidget);

    // Esc leaves INSERT and the chat stays; `i` returns to the composer, and
    // an Esc from NORMAL is the way back to the project.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsNothing);
    expect(find.text('NORMAL'), findsOneWidget);
    expect(find.text('PROJECT CHAT'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyI);
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('PROJECT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the project chat fits 800x600', (tester) async {
    final store = await openProject(tester, size: const Size(800, 600));
    await openProjectChat(tester);

    expect(store.activeWorkChatId, 'chat-1');
    expect(find.byKey(const ValueKey('work-chat-composer')), findsOneWidget);
    expect(find.text('PROJECT CHAT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  group('CoreStore project chat', () {
    test(
      'openProject loads the chat ids and opening resumes the newest',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();

        await store.openProject(FakeCore.projectId);

        expect(core.calls, contains('work.chat.list'));
        expect(store.projectChats, ['chat-1']);
        expect(store.activeWorkChatId, isNull);
        expect(store.workChat, isNull);

        final opened = await store.openWorkChat(FakeCore.projectId);
        await settle();

        expect(opened, isTrue);
        expect(core.calls, contains('work.chat.open'));
        expect(store.activeWorkChatId, 'chat-1');
        expect(store.workChat?.messages, hasLength(2));
        expect(store.workChats.keys, ['${FakeCore.projectId}:chat-1']);
      },
    );

    test('closeWorkChat keeps the cached transcript', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);
      await store.openWorkChat(FakeCore.projectId);

      store.closeWorkChat();

      expect(store.activeWorkChatId, isNull);
      expect(store.workChat, isNull);
      expect(
        store.workChatFor(FakeCore.projectId, 'chat-1')?.messages,
        hasLength(2),
      );

      await store.openWorkChat(FakeCore.projectId, chatId: 'chat-1');
      expect(store.workChat?.messages, hasLength(2));
    });

    test(
      'a missing chat reports once and keeps the previous transcript',
      () async {
        final store = CoreStore(connection: FakeCore());
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);
        await store.openWorkChat(FakeCore.projectId);
        await store.sendWorkChat(FakeCore.projectId, 'chat-1', 'keep me');
        await settle();
        final before = store.workChat;

        final opened = await store.openWorkChat(
          FakeCore.projectId,
          chatId: 'chat-9',
        );

        expect(opened, isFalse);
        expect(store.error, 'there is no chat "chat-9" in this project');
        expect(store.activeWorkChatId, 'chat-1');
        expect(store.workChat, same(before));
        expect(store.workChat?.messages, hasLength(4));
      },
    );

    test(
      'a work.chat.done clears the chat error without touching Chill',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);
        await store.openWorkChat(FakeCore.projectId);

        core.emitEvent('work.chat.error', {
          'projectId': FakeCore.projectId,
          'chatId': 'chat-1',
          'message': 'one failure',
        });
        await settle();
        expect(store.workChatError, 'one failure');

        core.emitEvent('work.chat.done', {
          'projectId': FakeCore.projectId,
          'chatId': 'chat-1',
          'kind': 'cancelled',
        });
        await settle();
        expect(store.workChatError, isNull);
        expect(store.chat?.messages, isEmpty);
        expect(store.chat?.status, 'idle');
      },
    );

    test('workChats is a read-only view', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);
      await store.openWorkChat(FakeCore.projectId);

      expect(
        () => store.workChats['x:y'] = const ChatSnapshot(
          status: 'idle',
          model: null,
          streamed: '',
          messages: [],
          usage: ChatUsageView(tokens: 0, costMicroUsd: null, durationMs: null),
        ),
        throwsUnsupportedError,
      );
    });
  });
}
