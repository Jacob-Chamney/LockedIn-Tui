import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/sessions/new_session.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Helpers — plain values, a fake core and a scripted picker. No filesystem.
// ---------------------------------------------------------------------------

const _nameKey = ValueKey('new-session-name');
const _promptKey = ValueKey('new-session-prompt');
const _nextKey = ValueKey('new-session-next');
const _backKey = ValueKey('new-session-back');
const _createKey = ValueKey('new-session-create');
const _pickKey = ValueKey('new-session-pick');
const _errorKey = ValueKey('new-session-error');

/// A create the step-navigation tests must never reach.
Future<SessionCreateResult> _neverCreate(NewSessionInput input) async {
  fail('the wizard must not create in this test');
}

Future<void> pumpWizard(
  WidgetTester tester, {
  Future<SessionCreateResult> Function(NewSessionInput input) onCreate =
      _neverCreate,
  VoidCallback? onCancel,
  ValueChanged<String>? onCreated,
  Future<List<String>> Function()? pickFiles,
  double width = 800,
  double height = 600,
}) async {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: NewSessionWizard(
          // A fresh state per pump keeps the loop-driven layout test honest.
          key: UniqueKey(),
          onCreate: onCreate,
          onCancel: onCancel ?? () {},
          onCreated: onCreated ?? (_) {},
          pickFiles: pickFiles,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> enterName(WidgetTester tester, String name) async {
  // `enterText` does not itself focus a field in a widget test, and a focused
  // control would swallow Enter, so the name field is tapped first — exactly
  // what a keyboard user does with Tab.
  await tester.tap(find.byKey(_nameKey));
  await tester.pump();
  await tester.enterText(find.byKey(_nameKey), name);
  await tester.pump();
}

/// Sources → Instructions. The name is required, so every later step starts
/// from a named session.
Future<void> goToInstructions(WidgetTester tester, String name) async {
  await enterName(tester, name);
  await tester.tap(find.byKey(_nextKey));
  await tester.pumpAndSettle();
}

Future<void> tapAndSettle(WidgetTester tester, Key key) async {
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

void main() {
  group('NewSessionWizard', () {
    testWidgets('the three steps render and Next/Back move between them', (
      tester,
    ) async {
      await pumpWizard(tester);

      // Sources: the step chips, the name field and the picker.
      expect(find.text('1 Sources'), findsOneWidget);
      expect(find.text('2 Instructions'), findsOneWidget);
      expect(find.text('3 Review'), findsOneWidget);
      expect(find.byKey(_nameKey), findsOneWidget);
      expect(find.byKey(_pickKey), findsOneWidget);
      expect(find.byKey(_createKey), findsNothing);

      await goToInstructions(tester, 'Physics');

      // Instructions: the prompt field replaced the name field.
      expect(find.byKey(_promptKey), findsOneWidget);
      expect(find.byKey(_nameKey), findsNothing);

      await tapAndSettle(tester, _backKey);

      expect(find.byKey(_nameKey), findsOneWidget);
      expect(find.byKey(_promptKey), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Enter continues from Sources and Review creates', (
      tester,
    ) async {
      final inputs = <NewSessionInput>[];
      await pumpWizard(
        tester,
        pickFiles: () async => ['/home/me/input/lecture-4.md'],
        onCreate: (input) async {
          inputs.add(input);
          return const SessionCreateResult(id: 'id-1', name: 'Physics');
        },
      );

      await tapAndSettle(tester, _pickKey);
      await enterName(tester, 'Physics');

      // The name field owns Enter, so it submits instead of advancing: the
      // handler must not double-fire.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.byKey(_promptKey), findsOneWidget);

      await tester.enterText(find.byKey(_promptKey), 'Explain it');
      await tester.pump();
      await tapAndSettle(tester, _nextKey);
      expect(find.byKey(_createKey), findsOneWidget);

      // Nothing is focused inside a field on Review, so Enter is the shortcut.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(inputs, hasLength(1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('Esc backs out one layer and cancels from Sources', (
      tester,
    ) async {
      var cancels = 0;
      await pumpWizard(tester, onCancel: () => cancels++);

      await goToInstructions(tester, 'Physics');

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byKey(_nameKey), findsOneWidget);
      expect(cancels, 0);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(cancels, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unnamed, empty session is blocked with the rule', (
      tester,
    ) async {
      var creates = 0;
      await pumpWizard(
        tester,
        onCreate: (input) async {
          creates++;
          return const SessionCreateResult(id: 'id-1', name: 'Physics');
        },
      );

      await tapAndSettle(tester, _nextKey);

      // The blocked copy names both halves of the rule, and nothing was sent.
      final banner = find.byKey(_errorKey);
      expect(banner, findsOneWidget);
      expect(
        find.descendant(
          of: banner,
          matching: find.textContaining('A lock-in needs a name'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(_nameKey), findsOneWidget);
      expect(creates, 0);

      // A name alone reaches Instructions, where the content rule blocks.
      await goToInstructions(tester, 'Physics');
      await tapAndSettle(tester, _nextKey);

      expect(find.byKey(_promptKey), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(_errorKey),
          matching: find.textContaining('Add at least one source'),
        ),
        findsOneWidget,
      );
      expect(creates, 0);
    });

    testWidgets('picking two files lists both and Create sends them', (
      tester,
    ) async {
      final inputs = <NewSessionInput>[];
      final created = <String>[];
      var picks = 0;
      await pumpWizard(
        tester,
        pickFiles: () async {
          picks++;
          return ['/home/me/input/lecture-4.md', '/home/me/input/notes.pdf'];
        },
        onCreate: (input) async {
          inputs.add(input);
          return const SessionCreateResult(
            id: '2026-11-16-1200-physics',
            name: 'Physics',
          );
        },
        onCreated: created.add,
      );

      await enterName(tester, 'Physics');
      await tapAndSettle(tester, _pickKey);

      expect(picks, 1);
      expect(find.text('lecture-4.md'), findsOneWidget);
      expect(find.text('notes.pdf'), findsOneWidget);
      expect(find.text('/home/me/input'), findsNWidgets(2));

      await goToInstructions(tester, 'Physics');
      await tester.enterText(find.byKey(_promptKey), '  Explain the set.  ');
      await tester.pump();
      await tapAndSettle(tester, _nextKey);

      // Review: the values, not just the inputs.
      expect(find.text('Physics'), findsOneWidget);
      expect(find.text('2 files'), findsOneWidget);
      expect(find.text('written'), findsOneWidget);

      await tapAndSettle(tester, _createKey);

      expect(inputs, hasLength(1));
      final input = inputs.single;
      expect(input.name, 'Physics');
      expect(input.prompt, 'Explain the set.');
      expect(input.files, [
        '/home/me/input/lecture-4.md',
        '/home/me/input/notes.pdf',
      ]);
      expect(input.instructionsFile, isNull);
      expect(input.steps, isTrue);
      expect(created, ['2026-11-16-1200-physics']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a picked source can be removed before creating', (
      tester,
    ) async {
      await pumpWizard(
        tester,
        pickFiles: () async => ['/tmp/a.md', '/tmp/b.pdf'],
      );

      await tapAndSettle(tester, _pickKey);
      expect(find.text('a.md'), findsOneWidget);
      expect(find.text('b.pdf'), findsOneWidget);

      await tapAndSettle(tester, const ValueKey('new-session-remove-0'));

      expect(find.text('a.md'), findsNothing);
      expect(find.text('b.pdf'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an instructions file is one choice and is sent as a path', (
      tester,
    ) async {
      final inputs = <NewSessionInput>[];
      await pumpWizard(
        tester,
        pickFiles: () async => ['/home/me/input/ComplexNumbers.pdf'],
        onCreate: (input) async {
          inputs.add(input);
          return const SessionCreateResult(id: 'id-1', name: 'Physics');
        },
      );

      await enterName(tester, 'Physics');
      await goToInstructions(tester, 'Physics');
      await tapAndSettle(tester, const ValueKey('new-session-mode-file'));
      await tapAndSettle(
        tester,
        const ValueKey('new-session-instructions-pick'),
      );

      expect(find.text('ComplexNumbers.pdf'), findsOneWidget);
      expect(find.byKey(_promptKey), findsNothing);

      await tapAndSettle(tester, _nextKey);
      expect(find.text('file · ComplexNumbers.pdf'), findsOneWidget);

      await tapAndSettle(tester, _createKey);

      expect(
        inputs.single.instructionsFile,
        '/home/me/input/ComplexNumbers.pdf',
      );
      // Typed instructions would be ignored by the core, so they are not sent.
      expect(inputs.single.prompt, '');
      expect(tester.takeException(), isNull);
    });

    testWidgets('the steps toggle is on by default and can be turned off', (
      tester,
    ) async {
      final inputs = <NewSessionInput>[];
      await pumpWizard(
        tester,
        onCreate: (input) async {
          inputs.add(input);
          return const SessionCreateResult(id: 'id-1', name: 'Physics');
        },
      );

      await goToInstructions(tester, 'Physics');
      await tester.enterText(find.byKey(_promptKey), 'Do the set');
      await tester.pump();
      await tapAndSettle(tester, _nextKey);

      final toggle = tester.widget<Switch>(
        find.byKey(const ValueKey('new-session-steps')),
      );
      expect(toggle.value, isTrue);

      await tester.tap(find.byKey(const ValueKey('new-session-steps')));
      await tester.pumpAndSettle();
      await tapAndSettle(tester, _createKey);

      expect(inputs.single.steps, isFalse);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a rejected create stays on Review with the core message', (
      tester,
    ) async {
      var created = 0;
      await pumpWizard(
        tester,
        pickFiles: () async => ['/home/me/input/lecture-4.md'],
        onCreate: (input) async => throw const RpcException(
          -32000,
          'session create failed',
          {'kind': 'session-create', 'message': 'could not copy lecture-4.md'},
        ),
        onCreated: (_) => created++,
      );

      await enterName(tester, 'Physics');
      await tapAndSettle(tester, _pickKey);
      await goToInstructions(tester, 'Physics');
      await tapAndSettle(tester, _nextKey);
      expect(find.byKey(_createKey), findsOneWidget);

      await tapAndSettle(tester, _createKey);

      // Still on Review, one actionable message, no success callback.
      expect(find.byKey(_createKey), findsOneWidget);
      expect(find.byKey(_nameKey), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(_errorKey),
          matching: find.text('could not copy lecture-4.md'),
        ),
        findsOneWidget,
      );
      expect(created, 0);

      // The state is kept, so the user can retry without retyping.
      expect(find.text('Physics'), findsOneWidget);
      expect(find.text('1 file'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Create shows a pending state until the core answers', (
      tester,
    ) async {
      final gate = Completer<SessionCreateResult>();
      final created = <String>[];
      await pumpWizard(
        tester,
        onCreate: (input) => gate.future,
        onCreated: created.add,
      );

      await goToInstructions(tester, 'Physics');
      await tester.enterText(find.byKey(_promptKey), 'Do the set');
      await tester.pump();
      await tapAndSettle(tester, _nextKey);

      await tester.tap(find.byKey(_createKey));
      await tester.pump();

      expect(find.text('creating…'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(_createKey)).onPressed,
        isNull,
      );
      expect(created, isEmpty);

      gate.complete(const SessionCreateResult(id: 'id-9', name: 'Physics'));
      await tester.pumpAndSettle();

      expect(created, ['id-9']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the wizard fits 800x600 and a narrow window', (tester) async {
      for (final size in const [
        Size(800, 600),
        Size(640, 600),
        Size(460, 640),
      ]) {
        await pumpWizard(tester, width: size.width, height: size.height);
        expect(tester.takeException(), isNull, reason: 'sources at $size');

        await goToInstructions(tester, 'Physics');
        expect(tester.takeException(), isNull, reason: 'instructions at $size');

        await tester.enterText(find.byKey(_promptKey), 'Do the set');
        await tester.pump();
        await tapAndSettle(tester, _nextKey);
        expect(tester.takeException(), isNull, reason: 'review at $size');
      }
    });
  });

  group('SessionsPage onCreate', () {
    Future<void> pumpSessions(WidgetTester tester, SessionsPage page) async {
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: lockedInTheme(),
          home: Scaffold(body: page),
        ),
      );
      await tester.pump();
    }

    testWidgets('n asks the shell for the wizard, including on an empty list', (
      tester,
    ) async {
      var creates = 0;
      await pumpSessions(
        tester,
        SessionsPage(
          sessions: const <SessionRow>[],
          loading: false,
          onCreate: () => creates++,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pump();
      expect(creates, 1);

      // `/` still focuses the search field, where `n` is text, not an action.
      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.pump();
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('sessions-search')))
            .focusNode
            ?.hasFocus,
        isTrue,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pump();
      expect(creates, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('n is inert without an onCreate handler', (tester) async {
      await pumpSessions(
        tester,
        const SessionsPage(sessions: <SessionRow>[], loading: false),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pump();

      expect(find.text('no sessions yet'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore.createSession', () {
    test(
      'creates through session.create and then opens the new session',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        core.calls.clear();

        final result = await store.createSession(
          name: 'Physics',
          prompt: 'Explain the set.',
          files: ['/home/me/input/lecture-4.md'],
        );

        expect(
          core.calls,
          containsAllInOrder(['session.create', 'session.open']),
        );
        expect(result.id, isNotEmpty);
        expect(result.name, 'Physics');
        // The shell lands on the new session's detail, with its copied rows.
        expect(store.activeSessionId, result.id);
        expect(store.activeSession?.name, 'Physics');
        expect(store.activeSession?.sources.single.name, 'lecture-4.md');
        expect(store.error, isNull);
      },
    );

    test('sends an instructions file instead of prompt text', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      final result = await store.createSession(
        name: 'Physics',
        instructionsFile: '/home/me/input/ComplexNumbers.pdf',
        steps: false,
      );

      expect(result.id, isNotEmpty);
      expect(store.activeSession?.prompt, '');
      expect(store.activeSession?.steps.exists, isFalse);
    });

    test('a refused create rethrows and leaves the target alone', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      await expectLater(
        store.createSession(
          name: 'Physics',
          files: ['/home/me/input/reject.pdf'],
        ),
        throwsA(
          isA<RpcException>().having(
            (error) => error.data,
            'data',
            containsPair('kind', 'session-create'),
          ),
        ),
      );

      // A create refusal is the wizard's to show: it is not a shell failure.
      expect(store.error, isNull);
      expect(store.activeSessionId, FakeCore.sessionId);
    });
  });
}
