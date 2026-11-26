import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/settings/settings_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

SettingsView settingsSnapshot() => const SettingsView(
  username: 'friend',
  theme: 'crimson',
  chatModel: 'openai/gpt-4.1-mini',
  baseUrl: '',
  maxToolCalls: 8,
  maxTokensPerRequest: 16000,
  budgetUsd: 5,
  period: 'day',
  warnAt: 0.8,
  pauseAtLimit: false,
  dataDir: '/tmp/lockedin-data',
  archiveBackend: 'folder',
  archiveFolder: '',
  historyLimit: 20,
  responseStyle: 'normal',
  tutorPolicy: 'direct',
  pluginServers: ['filesystem'],
  hideHints: false,
  pluginDirs: [],
  disabledPlugins: [],
);

/// The reason the core gives for the absent local model. Rendered verbatim, so
/// the test can assert the row shows the core's own sentence.
const _reason =
    'No local model runtime is bundled in this build, so the decision layer '
    'runs rules only.';

const _off = DecisionView(
  enabled: false,
  model: '',
  rulesOnly: true,
  localModelSupported: false,
  localModelReason: _reason,
);

const _on = DecisionView(
  enabled: true,
  model: '',
  rulesOnly: true,
  localModelSupported: false,
  localModelReason: _reason,
);

Future<void> pumpPage(
  WidgetTester tester,
  Widget page, {
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: page),
    ),
  );
  await tester.pumpAndSettle();
}

Finder markedRow(String id) => find.descendant(
  of: find.byKey(ValueKey('settings-row-$id')),
  matching: find.byKey(const ValueKey('settings-selected')),
);

/// Walk the cursor from the top of the page to [id]. The row count grows with
/// the groups, so counting the presses here would pin the test to the catalogue.
Future<void> selectRow(WidgetTester tester, String id) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.home);
  await tester.pumpAndSettle();
  for (var step = 0; step < 200; step++) {
    if (markedRow(id).evaluate().isNotEmpty) return;
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
  }
  fail('row "$id" was not reachable from the top of the page');
}

void main() {
  testWidgets(
    'the decision group renders the toggle, the note and the reason',
    (tester) async {
      await pumpPage(
        tester,
        SettingsPage(
          settings: settingsSnapshot(),
          loading: false,
          decision: _off,
        ),
      );

      expect(find.text('DECISION LAYER'), findsOneWidget);
      expect(find.text('enabled'), findsOneWidget);
      expect(find.text('model'), findsOneWidget);
      expect(find.text('off'), findsOneWidget);
      // Not shipped, named as such, and the core's own sentence beside it.
      expect(find.text('not shipped in this build'), findsOneWidget);
      expect(find.text(_reason), findsOneWidget);
      // The rules are always on and the layer decides nothing that matters.
      expect(find.textContaining('The rules are always on.'), findsOneWidget);
      expect(find.textContaining('never decides a write'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Enter on enabled writes the flipped value and shows the answer',
    (tester) async {
      var calls = 0;
      bool? asked;
      late StateSetter setHost;
      var view = _off;
      await pumpPage(
        tester,
        StatefulBuilder(
          builder: (context, setState) {
            setHost = setState;
            return SettingsPage(
              settings: settingsSnapshot(),
              loading: false,
              decision: view,
              onSetDecision: ({bool? enabled, String? model}) async {
                calls += 1;
                asked = enabled;
                setHost(() => view = _on);
              },
            );
          },
        ),
      );

      expect(find.text('off'), findsOneWidget);
      await selectRow(tester, 'decision-enabled');
      expect(markedRow('decision-enabled'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(calls, 1);
      expect(asked, isTrue);
      // The row reads the new state from the core's view, never a local flip.
      expect(find.text('on'), findsOneWidget);
      expect(find.text('off'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Space toggles the waiting state and keeps the old value on fail',
    (tester) async {
      final gate = Completer<void>();
      bool? asked;
      await pumpPage(
        tester,
        SettingsPage(
          settings: settingsSnapshot(),
          loading: false,
          decision: _off,
          onSetDecision: ({bool? enabled, String? model}) async {
            asked = enabled;
            await gate.future;
            throw const RpcException(
              -32000,
              'the decision layer could not be written',
            );
          },
        ),
      );

      await selectRow(tester, 'decision-enabled');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      // `saving…` replaces the value while the write is in flight, and the row
      // has not flipped yet.
      expect(asked, isTrue);
      expect(find.text('saving…'), findsOneWidget);
      expect(find.text('off'), findsNothing);

      gate.complete();
      await tester.pumpAndSettle();

      // No optimistic flip: the refusal leaves the row off, with the message.
      expect(find.text('off'), findsOneWidget);
      expect(find.text('on'), findsNothing);
      expect(
        find.text('the decision layer could not be written'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the model row opens no editor and restates the reason', (
    tester,
  ) async {
    var writes = 0;
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decision: _off,
        onSetDecision: ({bool? enabled, String? model}) async {
          writes += 1;
        },
      ),
    );

    await selectRow(tester, 'decision-model');
    expect(markedRow('decision-model'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    // No dialog, no text field, no write: just the core's reason on screen.
    expect(find.byType(AlertDialog), findsNothing);
    expect(find.byKey(const ValueKey('settings-edit-field')), findsNothing);
    expect(
      find.byKey(const ValueKey('settings-row-notice-decision-model')),
      findsOneWidget,
    );
    expect(find.text(_reason), findsWidgets);
    expect(writes, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a rules-only view never offers a local-model control', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decision: _off,
        onSetDecision: ({bool? enabled, String? model}) async {},
      ),
    );

    // The only actionable row is the toggle; the model row is a projection.
    expect(find.byKey(const ValueKey('settings-search')), findsOneWidget);
    expect(find.byType(Switch), findsNothing);
    expect(find.byType(Slider), findsNothing);
    expect(find.text('not shipped in this build'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an unread decision layer says so instead of inventing a view', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decisionLoading: true,
      ),
    );

    expect(find.text('DECISION LAYER'), findsOneWidget);
    expect(find.text('not read yet'), findsOneWidget);
    expect(find.text('loading the decision layer…'), findsOneWidget);
    expect(find.text('not shipped in this build'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed read shows the message and keeps the last view', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decision: _off,
        decisionError: 'the decision layer is not available in this build',
      ),
    );

    expect(
      find.textContaining('the decision layer could not load'),
      findsOneWidget,
    );
    expect(find.textContaining('not available in this build'), findsOneWidget);
    // The previous view is still rendered rather than replaced by an error page.
    expect(find.text('not shipped in this build'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('800x600 renders the decision group without overflow', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decision: _off,
        onSetDecision: ({bool? enabled, String? model}) async {},
      ),
      size: const Size(800, 600),
    );
    expect(tester.takeException(), isNull);

    await selectRow(tester, 'decision-model');
    expect(markedRow('decision-model'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a narrow column wraps the reason without overflow', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decision: _off,
        onSetDecision: ({bool? enabled, String? model}) async {},
      ),
      size: const Size(420, 640),
    );
    expect(tester.takeException(), isNull);

    await selectRow(tester, 'decision-enabled');
    expect(markedRow('decision-enabled'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a future build without rules-only omits the not-shipped note', (
    tester,
  ) async {
    const future = DecisionView(
      enabled: false,
      model: 'local/qwen',
      rulesOnly: false,
      localModelSupported: true,
      localModelReason: '',
    );
    await pumpPage(
      tester,
      SettingsPage(
        settings: settingsSnapshot(),
        loading: false,
        decision: future,
      ),
    );

    // No fabricated control and no "not shipped" claim: the stored model is a
    // projection until a build exposes a local-model editor.
    expect(find.text('not shipped in this build'), findsNothing);
    expect(find.text('local/qwen'), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-search')), findsOneWidget);
    expect(find.textContaining('The rules are always on.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('model reads the rules-only view and writes nothing', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    expect(store.decision, isNull);
    await store.refreshDecision();

    final view = store.decision;
    expect(view, isNotNull);
    expect(view!.enabled, isFalse);
    expect(view.model, isEmpty);
    expect(view.rulesOnly, isTrue);
    expect(view.localModelSupported, isFalse);
    expect(view.localModelReason, contains('rules only'));
    expect(store.decisionLoading, isFalse);
    expect(store.decisionError, isNull);

    // `refreshAll` is the first-frame snapshot; the decision layer is a Settings
    // read, so the shell asks for it when the page opens.
    final frameCore = FakeCore();
    final frameStore = CoreStore(connection: frameCore);
    addTearDown(frameStore.dispose);
    await frameStore.refreshAll();
    expect(frameCore.calls, isNot(contains('decision.get')));
    expect(frameStore.decision, isNull);
    expect(core.decisionSets, isEmpty);
  });

  test('setDecision stores enabled and replaces the view', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.refreshDecision();
    expect(store.decision!.enabled, isFalse);

    await store.setDecision(enabled: true);

    expect(core.decisionSets, [
      {'enabled': true},
    ]);
    expect(store.decision!.enabled, isTrue);
    expect(store.decision!.rulesOnly, isTrue);
    expect(store.decisionError, isNull);
  });

  test('a refused model rethrows and keeps the stored view', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.refreshDecision();
    final before = store.decision;
    expect(before!.model, isEmpty);

    await expectLater(
      store.setDecision(model: 'local/qwen'),
      throwsA(
        isA<RpcException>().having(
          (error) => error.message,
          'message',
          contains('rules-only'),
        ),
      ),
    );

    expect(store.decision, same(before));
    expect(store.decision!.model, isEmpty);
    expect(core.decisionSets, isEmpty);
  });

  test('a failed write keeps the previous state and records nothing', () async {
    final core = _FlakyDecisionCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);

    await store.refreshDecision();
    expect(store.decision!.enabled, isFalse);

    core.down = true;
    await expectLater(
      store.setDecision(enabled: true),
      throwsA(isA<RpcException>()),
    );

    // The refusal is the page's inline message; the store keeps the old view.
    expect(store.decision!.enabled, isFalse);
    expect(core.decisionSets, isEmpty);
  });
}

/// A fake whose decision writes can start failing, to prove a refusal changes
/// nothing the shell renders.
class _FlakyDecisionCore extends FakeCore {
  bool down = false;

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    if (down && method == 'decision.set') {
      throw const RpcException(
        -32000,
        'the decision layer could not be written',
        {
          'kind': 'decision',
          'message': 'the decision layer could not be written',
        },
      );
    }
    return super.call(method, params);
  }
}
