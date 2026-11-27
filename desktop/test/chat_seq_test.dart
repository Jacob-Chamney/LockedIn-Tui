import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';

import 'fake_core.dart';

/// State frames are numbered per stream, so a stale frame cannot overwrite a
/// newer transcript (the reconnect and coalesced-flush case).
void main() {
  Map<String, dynamic> frame(String text, int seq) => {
    'seq': seq,
    'status': 'idle',
    'model': 'openai/gpt-4.1-mini',
    'streamed': '',
    'blocked': null,
    'error': null,
    'messages': [
      {'id': 'm1', 'role': 'assistant', 'text': text, 'outcome': 'done'},
    ],
    'usage': {'tokens': 0, 'costMicroUsd': null, 'durationMs': null},
  };

  test('a stale or duplicate chat.state is dropped', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    core.emitEvent('chat.state', frame('newer', 5));
    await Future<void>.delayed(Duration.zero);
    expect(store.chat?.messages.single.text, 'newer');

    core.emitEvent('chat.state', frame('older', 4));
    await Future<void>.delayed(Duration.zero);
    expect(store.chat?.messages.single.text, 'newer');

    // Equal is not newer: a duplicate flush must not repaint the transcript.
    core.emitEvent('chat.state', frame('duplicate', 5));
    await Future<void>.delayed(Duration.zero);
    expect(store.chat?.messages.single.text, 'newer');

    core.emitEvent('chat.state', frame('newest', 6));
    await Future<void>.delayed(Duration.zero);
    expect(store.chat?.messages.single.text, 'newest');
  });

  test('a snapshot older than an applied frame is ignored', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    core.emitEvent('chat.state', frame('live', 9));
    await Future<void>.delayed(Duration.zero);
    expect(store.chat?.messages.single.text, 'live');

    // A delayed `chat.snapshot` reply that predates the frame above. Applying
    // it would erase the live message.
    core.snapshotSeq = 3;
    await store.refreshChat();
    expect(store.chat?.messages.single.text, 'live');

    // A snapshot at the same sequence is the same state and is applied.
    core.snapshotSeq = 9;
    await store.refreshChat();
    expect(store.chat?.messages, isEmpty);
  });

  test('session frames are numbered per session', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    Map<String, dynamic> sessionFrame(String text, int seq) => {
      'sessionId': FakeCore.sessionId,
      ...frame(text, seq),
    };

    core.emitEvent('session.chat.state', sessionFrame('newer', 3));
    await Future<void>.delayed(Duration.zero);
    expect(
      store.sessionChatFor(FakeCore.sessionId)?.messages.single.text,
      'newer',
    );

    core.emitEvent('session.chat.state', sessionFrame('older', 2));
    await Future<void>.delayed(Duration.zero);
    expect(
      store.sessionChatFor(FakeCore.sessionId)?.messages.single.text,
      'newer',
    );
  });

  test(
    'a new process restarts the counter and its frames are accepted',
    () async {
      final first = FakeCore();
      late FakeCore second;
      var restarts = 0;
      final store = CoreStore(
        connection: first,
        reconnectFactory: () {
          restarts += 1;
          second = FakeCore();
          return second;
        },
      );
      addTearDown(store.dispose);
      await store.start();

      first.emitEvent('chat.state', frame('before', 9));
      await Future<void>.delayed(Duration.zero);
      expect(store.chat?.messages.single.text, 'before');

      // The process dies; a retry boots a fresh core whose counter starts at 1.
      first.emitEvent('core.exit', const {});
      await Future<void>.delayed(Duration.zero);
      expect(store.status, CoreStatus.failed);

      await store.retry();
      expect(restarts, 1);
      expect(store.status, CoreStatus.online);

      second.emitEvent('chat.state', frame('after restart', 1));
      await Future<void>.delayed(Duration.zero);
      expect(store.chat?.messages.single.text, 'after restart');
    },
  );
  test('a failed Chill turn is a banner, not a shell-wide error', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    core.emitEvent('chat.error', {'message': 'the provider rejected the key'});
    await Future<void>.delayed(Duration.zero);

    // Every other surface renders `error`; a Chill failure is Chill's only.
    expect(store.error, isNull);
    expect(store.chatSendError, 'the provider rejected the key');

    // A new turn clears the banner.
    core.emitEvent('chat.state', {...frame('', 1), 'status': 'streaming'});
    await Future<void>.delayed(Duration.zero);
    expect(store.chatSendError, isNull);

    // And a completed turn drops a stale one.
    core.emitEvent('chat.error', {'message': 'rate limited'});
    await Future<void>.delayed(Duration.zero);
    expect(store.chatSendError, 'rate limited');
    core.emitEvent('chat.done', {'outcome': 'done'});
    await Future<void>.delayed(Duration.zero);
    expect(store.chatSendError, isNull);
  });
}
