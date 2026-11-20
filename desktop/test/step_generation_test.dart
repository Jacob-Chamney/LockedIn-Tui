import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

// ---------------------------------------------------------------------------
// Fixtures — plain values only. No core, no filesystem, no network.
// ---------------------------------------------------------------------------

const _checkedDetail = SessionDetail(
  id: '2026-11-01-1430-physics-unit-4',
  name: 'Physics — Unit 4',
  created: '2026-11-01T14:30:00Z',
  archived: false,
  prompt: 'Explain the problem set.',
  sources: [
    SessionSource(
      name: 'lecture-4.md',
      originalPath: '/home/me/input/lecture-4.md',
      storedPath: 'sources/lecture-4.md',
      hash: 'sha256:deadbeefcafe1234',
      kind: 'markdown',
    ),
  ],
  steps: SessionSteps(
    done: 1,
    total: 2,
    exists: true,
    markdown:
        '# Assignment steps\n\n'
        '> 1 of 2 steps done\n\n'
        '- [x] Read section 4.2 and summarise the boundary conditions\n'
        '- [ ] Derive the energy balance\n',
  ),
);

const _emptyDetail = SessionDetail(
  id: '2026-10-02-0900-blank',
  name: 'Blank session',
  created: '',
  archived: false,
  prompt: '',
  sources: [],
  steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
);

/// The same session after `session.generateSteps` answered with the fake plan.
const _generatedDetail = SessionDetail(
  id: '2026-10-02-0900-blank',
  name: 'Blank session',
  created: '',
  archived: false,
  prompt: '',
  sources: [],
  steps: SessionSteps(
    done: 0,
    total: 2,
    exists: true,
    markdown: FakeCore.generatedStepsMarkdown,
  ),
);

Future<void> pumpPage(
  WidgetTester tester,
  Widget child, {
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
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

/// Walk the wizard from Sources to Review with a name and written instructions.
Future<void> fillWizard(
  WidgetTester tester, {
  required String name,
  String prompt = 'Explain the set.',
}) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const ValueKey('new-session-name')), name);
  await tester.pump();
  await tester.tap(find.byKey(const ValueKey('new-session-next')));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byKey(const ValueKey('new-session-prompt')),
    prompt,
  );
  await tester.pump();
  await tester.tap(find.byKey(const ValueKey('new-session-next')));
  await tester.pumpAndSettle();
}

void main() {
  group('CoreStore.generateSteps', () {
    test('updates the active steps, counts and the pending flag', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      // The fake's seed is the one unchecked step; generation must replace it.
      expect(store.activeSession?.steps.total, 1);

      final flags = <bool>[];
      store.addListener(() => flags.add(store.generatingSteps));

      await store.generateSteps(FakeCore.sessionId);

      expect(core.calls, contains('session.generateSteps'));
      // The only two notifications bracket the run: true, then false.
      expect(flags.first, isTrue);
      expect(flags.last, isFalse);
      expect(store.generatingSteps, isFalse);
      expect(store.stepsError, isNull);

      expect(store.activeSession?.steps.exists, isTrue);
      expect(
        store.activeSession?.steps.markdown,
        FakeCore.generatedStepsMarkdown,
      );
      expect(store.activeSession?.steps.total, 2);
      expect(store.activeSession?.steps.done, 0);
      // The rest of the detail survives the steps-only replacement.
      expect(store.activeSession?.name, 'Physics — Unit 4');
      expect(store.activeSession?.sources, hasLength(2));
      expect(store.error, isNull);

      // A later open reads the document the core wrote, not a stale copy.
      await store.openSession(FakeCore.sessionId);
      expect(
        store.activeSession?.steps.markdown,
        FakeCore.generatedStepsMarkdown,
      );
      expect(store.activeSession?.steps.total, 2);
    });

    test('a failure records one message and keeps the old steps', () async {
      const failure = 'link a model in Settings → Providers';
      final core = FakeCore(generateStepsFailure: failure);
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);
      final before = store.activeSession!.steps;

      await expectLater(store.generateSteps(FakeCore.sessionId), completes);

      expect(core.calls, contains('session.generateSteps'));
      expect(store.stepsError, failure);
      expect(store.activeSession?.steps.markdown, before.markdown);
      expect(store.activeSession?.steps.total, before.total);
      expect(store.activeSession?.steps.done, before.done);
      expect(store.generatingSteps, isFalse);
      // A generation refusal is page-local: it never raises the shell error.
      expect(store.error, isNull);

      // Reopening the same session clears the old page-local message.
      await store.openSession(FakeCore.sessionId);
      expect(store.stepsError, isNull);
    });

    test(
      'a generation for another session never rewrites the active one',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        final created = await store.createSession(
          name: 'Second session',
          prompt: 'A second problem set.',
        );
        await store.openSession(FakeCore.sessionId);
        final before = store.activeSession!.steps;

        await store.generateSteps(created.id);

        expect(core.calls, contains('session.generateSteps'));
        expect(store.activeSession?.steps.markdown, before.markdown);
        expect(store.activeSession?.steps.total, before.total);
        expect(store.activeSessionId, FakeCore.sessionId);
      },
    );
  });

  group('SessionDetailView step generation', () {
    testWidgets('missing steps show build steps, and R/build each call once', (
      tester,
    ) async {
      var calls = 0;
      await pumpPage(
        tester,
        SessionDetailView(
          detail: _emptyDetail,
          loading: false,
          onGenerateSteps: () async => calls++,
        ),
      );

      expect(find.text('steps missing'), findsOneWidget);
      expect(find.text('build steps'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('steps-generate')));
      await tester.pumpAndSettle();
      expect(calls, 1);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('while generating the action is disabled and says so', (
      tester,
    ) async {
      var calls = 0;
      await pumpPage(
        tester,
        SessionDetailView(
          detail: _emptyDetail,
          loading: false,
          generatingSteps: true,
          onGenerateSteps: () async => calls++,
        ),
      );

      expect(find.text('building steps…'), findsOneWidget);
      final button = tester.widget<FilledButton>(
        find.byKey(const ValueKey('steps-generate')),
      );
      expect(button.onPressed, isNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pumpAndSettle();
      expect(calls, 0);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a generation error is inline and Retry asks again', (
      tester,
    ) async {
      var calls = 0;
      await pumpPage(
        tester,
        SessionDetailView(
          detail: _generatedDetail,
          loading: false,
          stepsError: 'link a model in Settings → Providers',
          onGenerateSteps: () async => calls++,
        ),
      );

      expect(find.text('link a model in Settings → Providers'), findsOneWidget);
      // The previous steps stay on screen beside the message.
      expect(find.text('Read the sources'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const ValueKey('steps-retry')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('steps-retry')));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'checked work asks before regenerating and Cancel writes nothing',
      (tester) async {
        var calls = 0;
        await pumpPage(
          tester,
          SessionDetailView(
            detail: _checkedDetail,
            loading: false,
            onGenerateSteps: () async => calls++,
          ),
        );

        await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
        await tester.pumpAndSettle();

        expect(find.text('regenerate steps?'), findsOneWidget);
        expect(
          find.textContaining('Checked work is merged by step text'),
          findsOneWidget,
        );
        expect(calls, 0);

        await tester.tap(find.byKey(const ValueKey('steps-regenerate-cancel')));
        await tester.pumpAndSettle();
        expect(find.text('regenerate steps?'), findsNothing);
        expect(calls, 0);

        // The visible action takes the same confirmation path.
        await tester.tap(find.byKey(const ValueKey('steps-regenerate')));
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('steps-regenerate-confirm')),
        );
        await tester.pumpAndSettle();
        expect(calls, 1);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('a successful build replaces the rows and clears the message', (
      tester,
    ) async {
      var detail = _emptyDetail;
      String? error = 'link a model in Settings → Providers';
      late StateSetter setHost;
      await pumpPage(
        tester,
        StatefulBuilder(
          builder: (context, setState) {
            setHost = setState;
            return SessionDetailView(
              detail: detail,
              loading: false,
              stepsError: error,
              onGenerateSteps: () async {
                setHost(() {
                  detail = _generatedDetail;
                  error = null;
                });
              },
            );
          },
        ),
      );

      expect(find.text('steps missing'), findsOneWidget);
      expect(find.text('link a model in Settings → Providers'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('steps-generate')));
      await tester.pumpAndSettle();

      expect(find.text('steps missing'), findsNothing);
      expect(find.text('link a model in Settings → Providers'), findsNothing);
      expect(find.text('0/2 steps'), findsOneWidget);
      expect(find.text('Read the sources'), findsOneWidget);
      expect(find.text('Summarise the key points'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('generation states fit 800x600 without overflow', (
      tester,
    ) async {
      await pumpPage(
        tester,
        SessionDetailView(
          detail: _emptyDetail,
          loading: false,
          generatingSteps: true,
          onGenerateSteps: () async {},
        ),
        width: 800,
        height: 600,
      );
      expect(tester.takeException(), isNull, reason: 'building at 800x600');

      await pumpPage(
        tester,
        SessionDetailView(
          detail: _checkedDetail,
          loading: false,
          stepsError: 'the provider rejected the request',
          onGenerateSteps: () async {},
        ),
        width: 800,
        height: 600,
      );
      expect(tester.takeException(), isNull, reason: 'error at 800x600');
    });
  });

  group('Shell step generation', () {
    testWidgets('creating with steps calls generateSteps and shows the plan', (
      tester,
    ) async {
      final core = FakeCore();
      await pumpShell(tester, core: core);
      await openSurface(tester, 2);
      await fillWizard(tester, name: 'Chemistry — Unit 5');
      await tester.tap(find.byKey(const ValueKey('new-session-create')));
      await tester.pumpAndSettle();

      expect(core.calls, contains('session.generateSteps'));
      expect(core.calls, contains('session.create'));
      expect(core.calls, contains('session.open'));

      // The detail shows the generated plan and its counts, not the empty state.
      expect(find.text('steps missing'), findsNothing);
      expect(find.text('0/2 steps'), findsOneWidget);
      expect(find.text('Read the sources'), findsOneWidget);
      expect(find.text('Summarise the key points'), findsOneWidget);
      expect(find.text('building steps…'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('creating without steps never calls generateSteps', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await pumpShell(tester, core: core);
      await openSurface(tester, 2);
      await fillWizard(tester, name: 'History — Unit 2');

      await tester.tap(find.byKey(const ValueKey('new-session-steps')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('new-session-create')));
      await tester.pumpAndSettle();

      expect(core.calls, isNot(contains('session.generateSteps')));
      expect(store.activeSession?.steps.exists, isFalse);
      expect(find.text('steps missing'), findsOneWidget);
      expect(find.text('build steps'), findsOneWidget);
      expect(store.stepsError, isNull);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the generated session detail fits 800x600', (tester) async {
      final core = FakeCore();
      await pumpShell(tester, core: core, size: const Size(800, 600));
      await openSurface(tester, 2);
      await fillWizard(tester, name: 'Biology — Unit 1');
      await tester.tap(find.byKey(const ValueKey('new-session-create')));
      await tester.pumpAndSettle();

      expect(core.calls, contains('session.generateSteps'));
      expect(find.text('Read the sources'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
