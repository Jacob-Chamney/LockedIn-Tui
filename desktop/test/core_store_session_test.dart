import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';

import 'fake_core.dart';

/// Let the broadcast stream deliver the events the fake queued synchronously
/// during the call. A zero timer runs after the pending microtasks, and there
/// is no wall-clock dependency.
Future<void> settle() => Future<void>.delayed(Duration.zero);

void main() {
  test('opening a session sets the detail and its chat snapshot', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await store.openSession(FakeCore.sessionId);
    await settle();

    expect(store.activeSessionId, FakeCore.sessionId);
    expect(store.activeSession?.name, 'Physics — Unit 4');
    expect(store.activeSession?.prompt, 'Explain the problem set.');
    expect(store.activeSession?.archived, isFalse);
    expect(store.activeSession?.sources, hasLength(2));
    expect(store.activeSession?.sources.first.name, 'lecture-4.md');
    expect(store.activeSession?.sources.last.kind, 'pdf');
    expect(store.activeSession?.steps.exists, isTrue);
    expect(store.activeSession?.steps.total, 1);
    expect(store.activeSession?.steps.done, 0);
    expect(store.activeSession?.steps.markdown, contains('- [ ]'));

    expect(store.sessionChat, isNotNull);
    expect(store.sessionChat?.messages, isEmpty);
    expect(store.sessionChats.keys, contains(FakeCore.sessionId));
    expect(store.error, isNull);
    expect(core.calls, contains('session.open'));
    expect(core.calls, contains('session.chat.snapshot'));
  });

  test('sessionChats is a read-only view', () async {
    final store = CoreStore(connection: FakeCore());
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    expect(
      () => store.sessionChats['other'] = const ChatSnapshot(
        status: 'idle',
        model: null,
        streamed: '',
        messages: [],
        usage: ChatUsageView(tokens: 0, costMicroUsd: null, durationMs: null),
      ),
      throwsUnsupportedError,
    );
  });

  test('sending routes to session.chat.send, never to chat.send', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    await store.sendSessionChat(FakeCore.sessionId, 'derive it');
    await settle();

    expect(core.calls, contains('session.chat.send'));
    expect(core.calls, isNot(contains('chat.send')));
    expect(store.sessionChat?.messages, hasLength(2));
    expect(store.sessionChat?.messages.first.text, 'derive it');
    expect(store.sessionChat?.messages.last.text, 'Session echo: derive it');
    // The Chill transcript is untouched by a session turn.
    expect(store.chat?.messages, isEmpty);
  });

  test('a session.chat.state event updates the session map', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    await store.sendSessionChat(FakeCore.sessionId, 'one');
    await settle();
    await store.sendSessionChat(FakeCore.sessionId, 'two');
    await settle();

    expect(store.sessionChatFor(FakeCore.sessionId)?.messages, hasLength(4));
    expect(store.sessionChat?.messages.last.text, 'Session echo: two');
    // Still one cached entry per session, keyed by the event's sessionId.
    expect(store.sessionChats.keys, [FakeCore.sessionId]);
  });

  test(
    'a Chill chat.state event never overwrites a session transcript',
    () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);
      await store.sendSessionChat(FakeCore.sessionId, 'session turn');
      await settle();

      expect(store.sessionChat?.messages, hasLength(2));

      await store.sendChat('chill turn');
      await settle();

      expect(store.chat?.messages, hasLength(2));
      expect(store.chat?.messages.last.text, 'Echo: chill turn');
      expect(store.sessionChat?.messages, hasLength(2));
      expect(
        store.sessionChat?.messages.last.text,
        'Session echo: session turn',
      );
    },
  );

  test(
    'closeSession keeps the cached transcript and reopening restores it',
    () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);
      await store.sendSessionChat(FakeCore.sessionId, 'keep me');
      await settle();

      store.closeSession();

      expect(store.activeSession, isNull);
      expect(store.activeSessionId, isNull);
      expect(store.sessionChat, isNull);
      // The cache survives, so reopening can paint before the snapshot lands.
      expect(store.sessionChatFor(FakeCore.sessionId)?.messages, hasLength(2));

      await store.openSession(FakeCore.sessionId);
      await settle();

      expect(store.activeSessionId, FakeCore.sessionId);
      expect(store.sessionChat?.messages, hasLength(2));
      expect(store.sessionChat?.messages.first.text, 'keep me');
    },
  );

  test('a missing session leaves the previous session active', () async {
    final store = CoreStore(connection: FakeCore());
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);
    await store.sendSessionChat(FakeCore.sessionId, 'keep me');
    await settle();
    final before = store.sessionChat;

    await store.openSession('2026-01-01-0000-missing');

    expect(store.error, 'session 2026-01-01-0000-missing was not found');
    expect(store.activeSessionId, FakeCore.sessionId);
    expect(store.activeSession?.name, 'Physics — Unit 4');
    // The previous transcript is untouched by the failed open.
    expect(store.sessionChat, same(before));
    expect(store.sessionChat?.messages, hasLength(2));
  });

  test('a failed open is reported once and does not throw', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await expectLater(store.openSession('missing-session'), completes);

    expect(store.error, 'session missing-session was not found');
    expect(store.activeSession, isNull);
    expect(store.sessionChat, isNull);
    expect(core.calls, contains('session.open'));
    expect(core.calls, isNot(contains('session.chat.snapshot')));
  });

  test('cancelling a session chat calls session.chat.cancel', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    await store.cancelSessionChat(FakeCore.sessionId);

    expect(core.calls, contains('session.chat.cancel'));
    expect(core.calls, isNot(contains('chat.cancel')));
    expect(store.error, isNull);
  });

  test('SessionDetail tolerates missing fields', () {
    final detail = SessionDetail.fromJson(const <String, dynamic>{});
    expect(detail.id, '');
    expect(detail.name, '');
    expect(detail.created, '');
    expect(detail.archived, isFalse);
    expect(detail.prompt, '');
    expect(detail.sources, isEmpty);
    expect(detail.steps.done, 0);
    expect(detail.steps.total, 0);
    expect(detail.steps.exists, isFalse);
    expect(detail.steps.markdown, '');

    final partial = SessionDetail.fromJson(const <String, dynamic>{
      'id': 'x',
      'sources': [
        {'name': 'a.md'},
        'not-a-map',
      ],
      'steps': {'total': 3},
    });
    expect(partial.id, 'x');
    expect(partial.sources, hasLength(1));
    expect(partial.sources.single.kind, '');
    expect(partial.steps.total, 3);
    expect(partial.steps.exists, isFalse);
  });
}
