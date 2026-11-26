import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

/// Open the seeded goal through the Skills list.
Future<CoreStore> openGoal(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  final store = await pumpShell(tester, core: core, size: size);
  await openSurface(tester, 3);
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
  return store;
}

Future<void> openGoalChat(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
  await tester.pumpAndSettle();
}

Future<void> sendSkillTurn(WidgetTester tester, String text) async {
  const composer = ValueKey('skill-chat-composer');
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
  testWidgets('c opens the goal chat and renders its transcript', (
    tester,
  ) async {
    final store = await openGoal(tester);

    expect(store.activeSkillId, FakeCore.skillId);
    expect(store.skillChats.map((chat) => chat.id), ['chat-1', 'chat-2']);
    expect(find.text('TEACHING'), findsOneWidget);
    await tester.ensureVisible(
      find.byKey(const ValueKey('skill-context-tab-chats')),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('skill-context-tab-chats')));
    await tester.pumpAndSettle();
    expect(find.text('2 chats'), findsOneWidget);
    expect(find.text('Open chat'), findsOneWidget);

    await openGoalChat(tester);

    // The newest chat is the one the core resumes.
    expect(store.activeSkillChatId, 'chat-2');
    expect(store.skillChat, isNotNull);
    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.text('TEACHING CHAT'), findsOneWidget);
    expect(
      find.textContaining('goal chat · chat-2', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('What is a stack frame?'), findsOneWidget);
    expect(
      find.textContaining(
        'A stack frame is the memory a call reserves.',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the goal page action opens the newest chat too', (tester) async {
    final store = await openGoal(tester);

    await tester.tap(find.byKey(const ValueKey('skill-open-chat')));
    await tester.pumpAndSettle();

    expect(store.activeSkillChatId, 'chat-2');
    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.text('TEACHING CHAT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('N starts a second chat instead of resuming the newest', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await openGoal(tester, core: core);
    expect(store.skillChats.map((chat) => chat.id), ['chat-1', 'chat-2']);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pumpAndSettle();

    // `skill.chat.create` allocated a fresh transcript: never a resume.
    expect(core.skillChatCreates, [FakeCore.skillId]);
    expect(core.calls, contains('skill.chat.create'));
    expect(core.calls, isNot(contains('skill.chat.open')));
    expect(store.activeSkillChatId, 'chat-3');
    expect(store.skillChat?.messages, isEmpty);
    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.text('TEACHING CHAT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the New chat button does the same through the pointer', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await openGoal(tester, core: core);

    await tester.tap(find.byKey(const ValueKey('skill-new-chat')));
    await tester.pumpAndSettle();

    expect(core.skillChatCreates, [FakeCore.skillId]);
    expect(store.activeSkillChatId, 'chat-3');
    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a send calls skill.chat.send, never chat, session or work', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await openGoal(tester, core: core);
    await openGoalChat(tester);

    await sendSkillTurn(tester, 'hello');

    expect(core.calls, contains('skill.chat.send'));
    expect(core.calls, isNot(contains('chat.send')));
    expect(core.calls, isNot(contains('session.chat.send')));
    expect(core.calls, isNot(contains('work.chat.send')));
    expect(
      find.textContaining('Skill echo: hello', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('hello'), findsOneWidget);
    expect(store.skillChat?.messages, hasLength(6));
    expect(store.chat?.messages, isEmpty);
    expect(store.sessionChats, isEmpty);
    expect(store.workChats, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc returns to the goal and Chill keeps no goal echo', (
    tester,
  ) async {
    final store = await openGoal(tester);
    await openGoalChat(tester);
    await sendSkillTurn(tester, 'hello');
    expect(
      find.textContaining('Skill echo: hello', findRichText: true),
      findsOneWidget,
    );

    // The composer still holds the keyboard after the send: the first Esc
    // leaves INSERT and the chat stays, the second leaves the chat.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.text('NORMAL'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('skill-chat-composer')), findsNothing);
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(find.text('TEACHING'), findsOneWidget);
    expect(store.activeSkillId, FakeCore.skillId);
    // The chat id and its snapshot survive the collapse.
    expect(store.activeSkillChatId, 'chat-2');
    expect(store.skillChat?.messages, hasLength(6));

    await openSurface(tester, 1);

    expect(find.text('Chill'), findsWidgets);
    expect(
      find.textContaining('Skill echo: hello', findRichText: true),
      findsNothing,
    );
    expect(find.text('hello'), findsNothing);
    expect(store.chat?.messages, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a state for another goal chat never replaces the active one', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await openGoal(tester, core: core);
    await openGoalChat(tester);

    core.emitEvent('skill.chat.state', {
      'goalId': FakeCore.skillId,
      'chatId': 'chat-1',
      'status': 'idle',
      'model': store.skillChat?.model,
      'streamed': '',
      'messages': [
        {
          'id': 'other-1',
          'role': 'assistant',
          'text': 'Other goal chat turn',
          'outcome': 'done',
        },
      ],
      'blocked': null,
      'error': null,
      'usage': {'tokens': 3, 'costMicroUsd': null, 'durationMs': null},
    });
    await tester.pumpAndSettle();

    expect(store.activeSkillChatId, 'chat-2');
    expect(store.skillChatFor(FakeCore.skillId, 'chat-1'), isNotNull);
    expect(
      find.textContaining('Other goal chat turn', findRichText: true),
      findsNothing,
    );
    expect(find.text('What is a stack frame?'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the goal composer reports INSERT and NORMAL', (tester) async {
    await openGoal(tester);
    await openGoalChat(tester);

    expect(find.text('NORMAL'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('skill-chat-composer')));
    await tester.pump();
    expect(find.text('INSERT'), findsOneWidget);

    // Esc leaves INSERT, not the chat: NORMAL is a real mode to read and
    // scroll from, and `i` returns to the composer.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsNothing);
    expect(find.text('NORMAL'), findsOneWidget);
    expect(find.text('TEACHING CHAT'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyI);
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsOneWidget);

    // From NORMAL, Esc is "back": the goal page.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('TEACHING'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the goal chat fits 800x600', (tester) async {
    final store = await openGoal(tester, size: const Size(800, 600));
    await openGoalChat(tester);

    expect(store.activeSkillChatId, 'chat-2');
    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.text('TEACHING CHAT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  group('CoreStore goal chat', () {
    test(
      'openSkill loads the saved chats, opening resumes the newest',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();

        await store.openSkill(FakeCore.skillId);

        expect(core.calls, contains('skill.chat.list'));
        expect(store.skillChats.map((chat) => chat.id), ['chat-1', 'chat-2']);
        expect(store.activeSkillChatId, isNull);
        expect(store.skillChat, isNull);

        final opened = await store.openSkillChat(FakeCore.skillId);
        await settle();

        expect(opened, isTrue);
        expect(core.calls, contains('skill.chat.open'));
        expect(store.activeSkillChatId, 'chat-2');
        expect(store.skillChat?.messages, hasLength(4));
        expect(store.skillChats.map((chat) => chat.id), ['chat-1', 'chat-2']);
      },
    );

    test('closeSkillChat keeps the cached transcript', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.skillId);
      await store.openSkillChat(FakeCore.skillId);

      store.closeSkillChat();

      expect(store.activeSkillChatId, isNull);
      expect(store.skillChat, isNull);
      expect(
        store.skillChatFor(FakeCore.skillId, 'chat-2')?.messages,
        hasLength(4),
      );

      await store.openSkillChat(FakeCore.skillId, chatId: 'chat-2');
      expect(store.skillChat?.messages, hasLength(4));
    });

    test(
      'a missing chat reports once and keeps the previous transcript',
      () async {
        final store = CoreStore(connection: FakeCore());
        addTearDown(store.dispose);
        await store.start();
        await store.openSkill(FakeCore.skillId);
        await store.openSkillChat(FakeCore.skillId);
        await store.sendSkillChat(FakeCore.skillId, 'chat-2', 'keep me');
        await settle();
        final before = store.skillChat;

        final opened = await store.openSkillChat(
          FakeCore.skillId,
          chatId: 'chat-9',
        );

        expect(opened, isFalse);
        expect(store.error, 'there is no chat "chat-9" in this goal');
        expect(store.activeSkillChatId, 'chat-2');
        expect(store.skillChat, same(before));
        expect(store.skillChat?.messages, hasLength(6));
      },
    );

    test('a skill.chat.done clears the error without touching Chill', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.skillId);
      await store.openSkillChat(FakeCore.skillId);

      core.emitEvent('skill.chat.error', {
        'goalId': FakeCore.skillId,
        'chatId': 'chat-2',
        'message': 'one failure',
      });
      await settle();
      expect(store.skillChatError, 'one failure');

      core.emitEvent('skill.chat.done', {
        'goalId': FakeCore.skillId,
        'chatId': 'chat-2',
        'kind': 'cancelled',
      });
      await settle();
      expect(store.skillChatError, isNull);
      expect(store.chat?.messages, isEmpty);
      expect(store.chat?.status, 'idle');
    });

    test(
      'leaving the goal clears the chat slice but keeps the goal rows',
      () async {
        final store = CoreStore(connection: FakeCore());
        addTearDown(store.dispose);
        await store.start();
        await store.openSkill(FakeCore.skillId);
        await store.openSkillChat(FakeCore.skillId);

        store.closeSkill();

        expect(store.activeSkill, isNull);
        expect(store.activeSkillId, isNull);
        expect(store.activeSkillChatId, isNull);
        expect(store.skillChats, isEmpty);
        expect(store.skillChat, isNull);
      },
    );

    test(
      'a created goal starts with no chats and open starts chat-1',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();

        final created = await store.createSkill(goal: 'Read ELF headers');

        expect(store.skillChats, isEmpty);
        final opened = await store.openSkillChat(created.id);
        await settle();

        expect(opened, isTrue);
        expect(store.activeSkillChatId, 'chat-1');
        expect(store.skillChat?.messages, isEmpty);
        expect(store.skillChats.map((chat) => chat.id), ['chat-1']);
        expect(store.skillChats.first.messages, 0);
      },
    );
  });

  testWidgets('a wide window keeps the learning tree beside the goal chat', (
    tester,
  ) async {
    await openGoal(tester);
    await openGoalChat(tester);

    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.byKey(const ValueKey('skill-learning-pane')), findsOneWidget);
    expect(find.text('LEARNING TREE'), findsOneWidget);
    expect(find.text('TEACHING CHAT'), findsOneWidget);
  });

  testWidgets('a narrow window keeps the chat full width', (tester) async {
    await openGoal(tester, size: const Size(800, 600));
    await openGoalChat(tester);

    expect(find.byKey(const ValueKey('skill-chat-composer')), findsOneWidget);
    expect(find.byKey(const ValueKey('skill-learning-pane')), findsNothing);
  });
}
