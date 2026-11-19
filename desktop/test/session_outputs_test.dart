import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/features/sessions/session_outputs.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _sessionName = 'Physics — Unit 4';

Future<void> pumpOutput(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(800, 600),
}) async {
  tester.view.physicalSize = size;
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

SessionOutputView guideView({
  String? markdown = FakeCore.studyGuideMarkdown,
  String? answers,
  bool exists = true,
  bool loading = false,
  String? error,
  Future<void> Function()? onBuild,
  Future<void> Function()? onReadAnswers,
  Future<void> Function()? onRetry,
  VoidCallback? onBack,
}) {
  return SessionOutputView(
    key: UniqueKey(),
    sessionName: _sessionName,
    kind: 'study-guide',
    markdown: markdown,
    answers: answers,
    exists: exists,
    loading: loading,
    error: error,
    onBuild: onBuild,
    onReadAnswers: onReadAnswers,
    onRetry: onRetry,
    onBack: onBack,
  );
}

SessionOutputView deckView({
  String? markdown = FakeCore.flashcardMarkdown,
  bool exists = true,
  bool loading = false,
  String? error,
  Future<void> Function()? onBuild,
  Future<void> Function()? onRetry,
  VoidCallback? onBack,
}) {
  return SessionOutputView(
    key: UniqueKey(),
    sessionName: _sessionName,
    kind: 'flashcards',
    markdown: markdown,
    answers: null,
    exists: exists,
    loading: loading,
    error: error,
    onBuild: onBuild,
    onRetry: onRetry,
    onBack: onBack,
  );
}

/// A core whose `session.output.read` waits for [gate], so a test can prove an
/// answer that arrives after the reader closed is dropped.
class _GatedOutputCore extends FakeCore {
  final gate = Completer<void>();

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    if (method == 'session.output.read') await gate.future;
    return super.call(method, params);
  }
}

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

void main() {
  testWidgets('the guide marks a section from the keyboard', (tester) async {
    final marked = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: SessionOutputView(
            sessionName: _sessionName,
            kind: 'study-guide',
            markdown:
                '# Study guide — Physics\n\n> 0 of 2 sections reviewed\n\n'
                '## Energy balance\n\nWhat limits it?\n\n- [ ] Reviewed\n\n'
                '## Momentum\n\nWhat is conserved?\n\n- [ ] Reviewed\n',
            answers: null,
            exists: true,
            loading: false,
            error: null,
            onMarkSection: (index) async => marked.add(index),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // `[`/`]` move the section cursor, `x` marks the section under it.
    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.bracketRight);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(marked, [1]);

    await tester.sendKeyEvent(LogicalKeyboardKey.bracketLeft);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();
    expect(marked, [1, 0]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('guide sections are chips that mark the section they name', (
    tester,
  ) async {
    final marked = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: SessionOutputView(
            sessionName: _sessionName,
            kind: 'study-guide',
            markdown:
                '# Study guide — Physics\n\n> 0 of 2 sections reviewed\n\n'
                '## Energy balance\n\nWhat limits it?\n\n- [ ] Reviewed\n\n'
                '## Momentum\n\nWhat is conserved?\n\n- [ ] Reviewed\n',
            answers: null,
            exists: true,
            loading: false,
            error: null,
            onMarkSection: (index) async => marked.add(index),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.textContaining('0 of 2 reviewed', findRichText: true),
      findsOneWidget,
    );
    await tester.ensureVisible(find.byKey(const ValueKey('guide-section-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('guide-section-1')));
    await tester.pumpAndSettle();

    expect(marked, [1]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the study guide renders its header, label and body', (
    tester,
  ) async {
    await pumpOutput(tester, guideView(onReadAnswers: () async {}));

    expect(find.text('STUDY GUIDE'), findsOneWidget);
    expect(find.text(_sessionName), findsOneWidget);
    expect(find.text('generated · not a source'), findsOneWidget);
    expect(
      find.textContaining('What limits the integral?', findRichText: true),
      findsOneWidget,
    );
    expect(
      find.textContaining('generated output, not a source', findRichText: true),
      findsOneWidget,
    );
    // A guide has an answers toggle; a deck does not.
    expect(
      find.byKey(const ValueKey('session-output-answers')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the answers toggle reads the answers part and shows it once', (
    tester,
  ) async {
    var reads = 0;
    String? answers;
    await pumpOutput(
      tester,
      StatefulBuilder(
        builder: (context, setState) => SessionOutputView(
          sessionName: _sessionName,
          kind: 'study-guide',
          markdown: FakeCore.studyGuideMarkdown,
          answers: answers,
          exists: true,
          loading: false,
          error: null,
          onReadAnswers: () async {
            reads += 1;
            setState(() => answers = FakeCore.studyGuideAnswers);
          },
          onBack: () {},
        ),
      ),
    );

    expect(find.text('ANSWERS'), findsNothing);
    expect(
      find.textContaining('determine the integral limits', findRichText: true),
      findsNothing,
    );

    await tester.tap(find.byKey(const ValueKey('session-output-answers')));
    await tester.pumpAndSettle();

    expect(reads, 1);
    expect(find.text('ANSWERS'), findsOneWidget);
    expect(
      find.textContaining('determine the integral limits', findRichText: true),
      findsOneWidget,
    );

    // Hiding the panel is local; it never asks the core again.
    await tester.tap(find.byKey(const ValueKey('session-output-answers')));
    await tester.pumpAndSettle();
    expect(reads, 1);
    expect(find.text('ANSWERS'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the flashcard deck renders read-only', (tester) async {
    await pumpOutput(tester, deckView());

    expect(find.text('FLASHCARDS'), findsOneWidget);
    expect(find.text(_sessionName), findsOneWidget);
    expect(
      find.textContaining(
        'What does the learning rate control?',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining('Read-only deck', findRichText: true),
      findsOneWidget,
    );
    // Flip and marking are a later packet: no answers toggle on a deck.
    expect(find.byKey(const ValueKey('session-output-answers')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a missing output offers a build action', (tester) async {
    var builds = 0;
    await pumpOutput(
      tester,
      guideView(
        markdown: null,
        exists: false,
        onBuild: () async => builds += 1,
      ),
    );

    expect(find.text('no study guide yet'), findsOneWidget);
    expect(find.text('generated · not a source'), findsOneWidget);
    expect(find.byKey(const ValueKey('session-output-rebuild')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('session-output-build')));
    await tester.pumpAndSettle();

    expect(builds, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a deck with no file offers to build the deck', (tester) async {
    await pumpOutput(
      tester,
      deckView(markdown: null, exists: false, onBuild: () async {}),
    );

    expect(find.text('no flashcard deck yet'), findsOneWidget);
    expect(find.text('build flashcards'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a rebuild asks first and Cancel changes nothing', (
    tester,
  ) async {
    var builds = 0;
    await pumpOutput(tester, guideView(onBuild: () async => builds += 1));

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(find.text('rebuild study guide?'), findsOneWidget);
    expect(
      find.text('a rebuild replaces the generated document'),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey('session-output-rebuild-cancel')),
    );
    await tester.pumpAndSettle();
    expect(builds, 0);
    expect(find.text('STUDY GUIDE'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey('session-output-rebuild-confirm')),
    );
    await tester.pumpAndSettle();

    expect(builds, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a build failure is one message with a retry', (tester) async {
    var retries = 0;
    await pumpOutput(
      tester,
      guideView(
        markdown: null,
        exists: false,
        error: 'link a model in Settings → Providers',
        onBuild: () async {},
        onRetry: () async => retries += 1,
      ),
    );

    expect(find.text('could not open this output'), findsOneWidget);
    expect(find.text('link a model in Settings → Providers'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('session-output-retry')));
    await tester.pumpAndSettle();

    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc and Close return to the session detail', (tester) async {
    var backs = 0;
    await pumpOutput(tester, guideView(onBack: () => backs += 1));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);

    await tester.tap(find.byKey(const ValueKey('session-output-close')));
    await tester.pumpAndSettle();
    expect(backs, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a long document scrolls at 800x600 without overflow', (
    tester,
  ) async {
    final long = [
      for (var index = 0; index < 120; index++)
        '## Section $index\n\nBody text that is long enough to need scrolling.',
    ].join('\n\n');
    await pumpOutput(tester, guideView(markdown: long));

    expect(find.text('STUDY GUIDE'), findsOneWidget);

    // `d` scrolls a page; the header stays visible above the scrolled body.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    expect(find.text('STUDY GUIDE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('store reads a guide, its answers and a deck, then clears', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    await store.readOutput(FakeCore.sessionId, 'study-guide');
    expect(core.outputReads.last, {
      'id': FakeCore.sessionId,
      'kind': 'study-guide',
      'part': null,
    });
    expect(store.outputKind, 'study-guide');
    expect(store.outputMarkdown, FakeCore.studyGuideMarkdown);
    expect(store.outputExists, isTrue);
    expect(store.outputLoading, isFalse);
    expect(store.outputError, isNull);
    expect(store.outputOpen, isTrue);
    expect(store.outputAnswers, isNull);

    await store.readOutput(FakeCore.sessionId, 'study-guide', part: 'answers');
    expect(core.outputReads.last['part'], 'answers');
    expect(store.outputAnswers, FakeCore.studyGuideAnswers);
    // Reading the answers part leaves the guide itself on screen.
    expect(store.outputMarkdown, FakeCore.studyGuideMarkdown);

    // A rebuild replaces the generated document and drops the cached answers.
    await store.buildOutput(FakeCore.sessionId, 'study-guide');
    expect(core.outputBuilds.single, {
      'id': FakeCore.sessionId,
      'kind': 'study-guide',
    });
    expect(store.outputMarkdown, FakeCore.rebuiltGuideMarkdown);
    expect(store.outputAnswers, isNull);
    expect(store.outputExists, isTrue);

    await store.readOutput(FakeCore.sessionId, 'flashcards');
    expect(store.outputKind, 'flashcards');
    expect(store.outputMarkdown, FakeCore.flashcardMarkdown);
    expect(store.outputAnswers, isNull);

    await store.buildOutput(FakeCore.sessionId, 'flashcards');
    expect(store.outputMarkdown, FakeCore.rebuiltFlashcardMarkdown);

    store.closeOutput();
    expect(store.outputKind, isNull);
    expect(store.outputMarkdown, isNull);
    expect(store.outputAnswers, isNull);
    expect(store.outputExists, isFalse);
    expect(store.outputOpen, isFalse);
    expect(store.error, isNull);

    // Closing the session clears the reader too.
    await store.readOutput(FakeCore.sessionId, 'study-guide');
    store.closeSession();
    expect(store.outputKind, isNull);
    expect(store.outputMarkdown, isNull);
    expect(store.outputOpen, isFalse);
  });

  test(
    'a missing output opens the build state and a build flips exists',
    () async {
      final core = FakeCore(outputMissing: true);
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      await store.readOutput(FakeCore.sessionId, 'study-guide');
      expect(store.outputKind, 'study-guide');
      expect(store.outputExists, isFalse);
      expect(store.outputMarkdown, '');
      expect(store.outputError, isNull);

      await store.buildOutput(FakeCore.sessionId, 'study-guide');
      expect(store.outputExists, isTrue);
      expect(store.outputMarkdown, FakeCore.rebuiltGuideMarkdown);
      expect(store.outputError, isNull);

      // The answers written by the same build are now readable.
      await store.readOutput(
        FakeCore.sessionId,
        'study-guide',
        part: 'answers',
      );
      expect(store.outputAnswers, FakeCore.rebuiltAnswersMarkdown);
    },
  );

  test('a build failure is one message and retryOutput asks again', () async {
    final core = FakeCore(
      outputFailure: 'link a model in Settings → Providers',
    );
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    await store.buildOutput(FakeCore.sessionId, 'study-guide');
    expect(store.outputKind, 'study-guide');
    expect(store.outputError, 'link a model in Settings → Providers');
    expect(store.outputLoading, isFalse);
    expect(store.outputMarkdown, isNull);
    expect(store.outputExists, isFalse);
    expect(core.outputBuilds, isEmpty);

    await store.retryOutput();
    expect(
      core.calls.where((method) => method == 'session.output.build').length,
      2,
    );
    expect(store.outputError, 'link a model in Settings → Providers');
    expect(store.error, isNull);
    expect(store.activeSession, isNotNull);
  });

  test('an answer for a closed reader cannot reappear', () async {
    final core = _GatedOutputCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    final pending = store.readOutput(FakeCore.sessionId, 'study-guide');
    await Future<void>.delayed(Duration.zero);
    expect(store.outputLoading, isTrue);

    store.closeOutput();
    expect(store.outputKind, isNull);

    core.gate.complete();
    await pending;

    expect(store.outputKind, isNull);
    expect(store.outputMarkdown, isNull);
    expect(store.outputLoading, isFalse);
    expect(store.outputError, isNull);
  });

  testWidgets('g opens the guide, f the deck, and Esc returns to the detail', (
    tester,
  ) async {
    final store = await pumpShell(tester);
    await store.openSession(FakeCore.sessionId);
    await tester.pumpAndSettle();
    await openSurface(tester, 2);

    expect(find.text('SESSION'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
    await tester.pumpAndSettle();

    expect(find.text('STUDY GUIDE'), findsWidgets);
    expect(
      find.textContaining('What limits the integral?', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('STUDY TOOLS'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('STUDY TOOLS'), findsOneWidget);
    expect(find.text('SESSION'), findsOneWidget);
    expect(store.outputKind, isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyF);
    await tester.pumpAndSettle();
    expect(find.text('FLASHCARDS'), findsWidgets);
    expect(
      find.textContaining(
        'What does the learning rate control?',
        findRichText: true,
      ),
      findsOneWidget,
    );

    // Leaving Sessions collapses the reader back to the detail.
    await openSurface(tester, 1);
    await openSurface(tester, 2);
    expect(find.text('STUDY TOOLS'), findsOneWidget);
    expect(find.text('STUDY GUIDE'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the output reader and detail fit 800x600 in the shell', (
    tester,
  ) async {
    final store = await pumpShell(tester, size: const Size(800, 600));
    await store.openSession(FakeCore.sessionId);
    await tester.pumpAndSettle();
    await openSurface(tester, 2);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
    await tester.pumpAndSettle();

    expect(find.text('STUDY GUIDE'), findsWidgets);
    expect(tester.takeException(), isNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('STUDY TOOLS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
