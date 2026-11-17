import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';

import 'fake_core.dart';

void main() {
  test('start performs the handshake and loads the projections', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.start();

    expect(store.status, CoreStatus.online);
    expect(store.error, isNull);
    expect(store.workspace?.configured, isTrue);
    expect(store.workspace?.model, 'openai/gpt-4.1-mini');
    expect(store.sessions, hasLength(2));
    expect(store.sessions.first.name, 'Audit session');
    expect(store.stats?.tokens, 24350);
    expect(store.stats?.models, hasLength(2));
    expect(store.settings?.username, 'friend');
    expect(store.chat, isNotNull);
    expect(store.chat?.status, 'idle');
    expect(core.calls, contains('initialize'));
    expect(core.calls, contains('stats.summary'));
  });

  test('a sidecar failure is visible and retryable', () async {
    final store = CoreStore(connection: FakeCore(fail: true));
    addTearDown(store.dispose);

    await store.start();

    expect(store.status, CoreStatus.failed);
    expect(store.error, isNotNull);
    expect(store.isOnline, isFalse);
  });

  test('sending a message updates the transcript from chat.state', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await store.sendChat('hello');
    await Future<void>.delayed(const Duration(milliseconds: 10));

    expect(store.chat?.messages, hasLength(2));
    expect(store.chat?.messages.first.text, 'hello');
    expect(store.chat?.messages.last.text, 'Echo: hello');
  });

  test('retry restarts the sidecar, so a boot refusal can recover', () async {
    var attempts = 0;
    final store = CoreStore(
      connection: FakeCore(fail: true),
      reconnectFactory: () {
        attempts += 1;
        return FakeCore();
      },
    );
    addTearDown(store.dispose);

    await store.start();
    expect(store.status, CoreStatus.failed);

    await store.retry();
    expect(attempts, 1);
    expect(store.status, CoreStatus.online);
    expect(store.workspace?.configured, isTrue);
  });

  test(
    'provider.list and link project the catalogue without saving a key',
    () async {
      final core = FakeCore(configured: false);
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.refreshProviders();
      expect(store.providers.map((row) => row.id), contains('openai'));
      expect(
        store.providers.firstWhere((row) => row.id == 'anthropic').linked,
        isFalse,
      );

      final link = await store.linkProvider(
        providerId: 'openai',
        key: 'sk-test',
      );
      expect(link.models, ['gpt-4.1-mini', 'gpt-4.1']);
      expect(
        store.providers.firstWhere((row) => row.id == 'openai').linked,
        isTrue,
      );
      // Linking must not pick a model on its own.
      expect(store.workspace?.configured, isFalse);
    },
  );

  test('a rejected key throws and saves nothing', () async {
    final core = FakeCore(configured: false);
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await expectLater(
      store.linkProvider(providerId: 'openai', key: 'bad'),
      throwsA(isA<RpcException>()),
    );
    expect(store.workspace?.configured, isFalse);
  });

  test('settings.patch updates the view and the workspace model', () async {
    final core = FakeCore(configured: false);
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await store.saveSettings({
      'models': {'chat': 'openai/gpt-4.1-mini'},
    });

    expect(store.settings?.chatModel, 'openai/gpt-4.1-mini');
    expect(store.workspace?.configured, isTrue);
    expect(store.workspace?.provider, 'openai');
    expect(store.chat?.model, 'openai/gpt-4.1-mini');
  });

  test('a range change asks the core for that range', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();

    await store.selectStats(range: '7d', scope: 'school');

    expect(store.stats?.range, '7d');
    expect(store.stats?.scope, 'school');
  });
}
