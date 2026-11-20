import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/shell/plugin_permission.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

Future<CoreStore> pumpShell(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

/// The leader key per surface ordinal (1 = Chat … 0 = Settings), matching the
/// terminal app's grammar: `Space c`, `Space h`, `Space g`, `Space s`, `Space t`,
/// `Space p`, `Space v`, `Space f`, `Space n`, `Space ,`.
const _surfaceLeaderKeys = <LogicalKeyboardKey>[
  LogicalKeyboardKey.keyC,
  LogicalKeyboardKey.keyH,
  LogicalKeyboardKey.keyG,
  LogicalKeyboardKey.keyS,
  LogicalKeyboardKey.keyT,
  LogicalKeyboardKey.keyP,
  LogicalKeyboardKey.keyV,
  LogicalKeyboardKey.keyF,
  LogicalKeyboardKey.keyN,
  LogicalKeyboardKey.comma,
];

/// Open a surface the way the terminal app does: `Space`, then the leader key.
Future<void> openSurface(WidgetTester tester, int surface) async {
  // Leave INSERT first: the leader is a NORMAL-mode chord, exactly as in the
  // terminal app, and the chat composer holds the keyboard on first paint. The
  // status bar is the shell's own answer for the mode, so this never presses
  // Esc on a page that would treat it as "back".
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals view, and navigation must work from all of them.
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  // `0` is the tenth surface (Settings), as in the terminal app.
  final index = surface == 0 ? _surfaceLeaderKeys.length - 1 : surface - 1;
  await tester.sendKeyEvent(_surfaceLeaderKeys[index]);
  await tester.pumpAndSettle();
}

/// The title of the row the Sessions list is currently selecting.
String selectedSessionTitle(WidgetTester tester) {
  final row = find.byKey(const ValueKey('session-row-selected'));
  expect(row, findsOneWidget);
  return tester
      .widgetList<Text>(find.descendant(of: row, matching: find.byType(Text)))
      .map((text) => text.data)
      .whereType<String>()
      .join(' | ');
}

Future<void> emitPermission(WidgetTester tester, FakeCore core) async {
  core.emitPermission();
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('mcp.permission shows the prompt with the pretty-printed input', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);

    core.emitPermission(
      input: const {'path': 'notes/a.md', 'body': 'remember this'},
    );
    await tester.pumpAndSettle();

    expect(store.pendingPermission?.requestId, 'perm-1');
    expect(find.byType(PluginPermissionModal), findsOneWidget);
    expect(find.text('PLUGIN WRITE · notes'), findsOneWidget);
    expect(find.text('write_note'), findsOneWidget);
    expect(
      find.text('{\n  "path": "notes/a.md",\n  "body": "remember this"\n}'),
      findsOneWidget,
    );
    expect(
      find.text(
        'Plugin output is still sent to the model. This decision applies to '
        'this one call only.',
      ),
      findsOneWidget,
    );
    expect(find.text('y allow · n deny · Esc deny'), findsOneWidget);
    expect(find.text('Allow'), findsOneWidget);
    expect(find.text('Deny'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('y allows the one call and closes the prompt', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await emitPermission(tester, core);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
    await tester.pumpAndSettle();

    expect(core.permissionConfirms, [
      {'requestId': 'perm-1', 'allow': true},
    ]);
    expect(core.pendingPermissionIds, isEmpty);
    expect(store.pendingPermission, isNull);
    expect(store.pluginPermissionError, isNull);
    expect(find.byType(PluginPermissionModal), findsNothing);
  });

  testWidgets('n denies the call and closes the prompt', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await emitPermission(tester, core);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();

    expect(core.permissionConfirms, [
      {'requestId': 'perm-1', 'allow': false},
    ]);
    expect(store.pendingPermission, isNull);
    expect(find.byType(PluginPermissionModal), findsNothing);
  });

  testWidgets('Esc denies instead of dismissing with no answer', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await emitPermission(tester, core);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(core.permissionConfirms, [
      {'requestId': 'perm-1', 'allow': false},
    ]);
    expect(store.pendingPermission, isNull);
    expect(find.byType(PluginPermissionModal), findsNothing);
  });

  testWidgets('the Allow button allows and the Deny button denies', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await emitPermission(tester, core);

    await tester.tap(find.byKey(PluginPermissionModal.denyKey));
    await tester.pumpAndSettle();
    expect(core.permissionConfirms.last, {
      'requestId': 'perm-1',
      'allow': false,
    });
    expect(store.pendingPermission, isNull);

    core.emitPermission(requestId: 'perm-2');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(PluginPermissionModal.allowKey));
    await tester.pumpAndSettle();
    expect(core.permissionConfirms.last, {
      'requestId': 'perm-2',
      'allow': true,
    });
    expect(store.pendingPermission, isNull);
  });

  testWidgets('a failed confirm keeps the prompt with one inline message', (
    tester,
  ) async {
    final core = FakeCore(
      permissionConfirmFailure:
          'the plugin server did not answer the permission request',
    );
    final store = await pumpShell(tester, core: core);
    await emitPermission(tester, core);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
    await tester.pumpAndSettle();

    expect(find.byType(PluginPermissionModal), findsOneWidget);
    expect(
      find.text('the plugin server did not answer the permission request'),
      findsOneWidget,
    );
    expect(find.byKey(PluginPermissionModal.errorKey), findsOneWidget);
    expect(core.permissionConfirms, isEmpty);
    expect(core.pendingPermissionIds, ['perm-1']);
    expect(store.pendingPermission?.requestId, 'perm-1');
    expect(store.pluginPermissionError, isNotNull);
    // One failure, one message: the decision can be made again.
    expect(find.byKey(PluginPermissionModal.allowKey), findsOneWidget);
  });

  testWidgets('a second request waits behind the first prompt', (tester) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);

    core.emitPermission(
      requestId: 'perm-1',
      server: 'notes',
      tool: 'write_note',
    );
    await tester.pumpAndSettle();
    expect(find.text('PLUGIN WRITE · notes'), findsOneWidget);
    expect(find.text('write_note'), findsOneWidget);

    // Two chats can each be waiting on an answer. The first prompt must stay
    // answerable: replacing it left its turn hanging until the core denied it.
    core.emitPermission(
      requestId: 'perm-2',
      server: 'wiki',
      tool: 'delete_note',
      input: const {'title': 'Old page'},
    );
    await tester.pumpAndSettle();

    expect(store.pendingPermission?.requestId, 'perm-1');
    expect(store.queuedPermissions, 1);
    expect(find.text('PLUGIN WRITE · notes'), findsOneWidget);
    expect(find.text('1 more waiting'), findsOneWidget);
    expect(find.text('delete_note'), findsNothing);

    // Each prompt is answered on its own, in arrival order.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
    await tester.pumpAndSettle();
    expect(store.pendingPermission?.requestId, 'perm-2');
    expect(find.text('PLUGIN WRITE · wiki'), findsOneWidget);
    expect(find.text('{\n  "title": "Old page"\n}'), findsOneWidget);
    expect(find.text('1 more waiting'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pumpAndSettle();
    expect(store.pendingPermission, isNull);
    expect(core.permissionConfirms, [
      {'requestId': 'perm-1', 'allow': true},
      {'requestId': 'perm-2', 'allow': false},
    ]);
  });

  test('an answer after the core stopped waiting says it expired', () async {
    var now = DateTime.utc(2026, 11, 19, 10);
    final core = FakeCore();
    final store = CoreStore(connection: core, clock: () => now);
    addTearDown(store.dispose);
    await store.start();

    core.emitPermission(
      requestId: 'perm-1',
      server: 'notes',
      tool: 'write_note',
    );
    await Future<void>.delayed(Duration.zero);
    expect(store.pendingPermission?.requestId, 'perm-1');

    // The core denies an unanswered prompt at 120 s and forgets the id. A late
    // Allow would be acknowledged with `{ok: true}` and look as if it ran.
    now = now.add(const Duration(seconds: 121));
    await store.confirmPermission('perm-1', true);

    expect(core.permissionConfirms, isEmpty, reason: 'nothing is sent');
    expect(store.pendingPermission, isNull);
    expect(store.error, contains('expired'));
    expect(store.error, contains('nothing ran'));
  });

  testWidgets('the prompt traps j/k so the surface underneath does not move', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    await openSurface(tester, 2);

    final before = selectedSessionTitle(tester);
    expect(before, contains('Audit session'));

    await emitPermission(tester, core);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();

    expect(selectedSessionTitle(tester), before);
    expect(find.byType(PluginPermissionModal), findsOneWidget);
    expect(store.pendingPermission, isNotNull);

    // A modifier chord is trapped too: Alt+5 must not switch to Stats.
    await openSurface(tester, 5);
    expect(find.text('TOKENS'), findsNothing);
    expect(find.byType(PluginPermissionModal), findsOneWidget);
  });

  testWidgets('the prompt fits 800x600 without overflow', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core, size: const Size(800, 600));

    core.emitPermission(
      input: const {
        'path': 'notes/a-very-long-note-name-that-wraps-inside-the-block.md',
        'body': 'a line that is long enough to need the block to scroll',
      },
    );
    await tester.pumpAndSettle();

    expect(find.byType(PluginPermissionModal), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The input scrolls inside its own block instead of overflowing.
    await tester.drag(
      find.byKey(PluginPermissionModal.inputKey),
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(PluginPermissionModal), findsOneWidget);
  });

  testWidgets('an in-flight answer disables both buttons and takes no second', (
    tester,
  ) async {
    final gate = Completer<void>();
    final answers = <bool>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: PluginPermissionModal(
            request: const PluginPermissionRequest(
              requestId: 'perm-1',
              server: 'notes',
              tool: 'write_note',
              input: <String, dynamic>{'path': 'notes/a.md'},
              write: true,
            ),
            onConfirm: (allow) {
              answers.add(allow);
              return gate.future;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.keyY);
    await tester.pump();

    expect(answers, [true]);
    expect(find.text('answering…'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(PluginPermissionModal.allowKey))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextButton>(find.byKey(PluginPermissionModal.denyKey))
          .onPressed,
      isNull,
    );

    // A second key while the first answer is in flight is not a second answer.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
    await tester.pump();
    expect(answers, [true]);

    gate.complete();
    await tester.pumpAndSettle();
    expect(find.text('answering…'), findsNothing);
  });
}
