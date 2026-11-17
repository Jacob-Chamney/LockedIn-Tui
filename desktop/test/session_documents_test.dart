import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _detail = SessionDetail(
  id: '2026-11-01-1430-physics-unit-4',
  name: 'Physics — Unit 4',
  created: '2026-11-01T14:30:00Z',
  archived: false,
  prompt: 'Explain the problem set in sections 4.2 and 4.3.',
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
        '- [x] Read section 4.2\n'
        '- [ ] Derive the energy balance\n',
  ),
);

Future<void> pumpDetail(
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

/// Tap a study action, scrolling the detail first: at 800×600 the card sits
/// below the fold, exactly as it does for a real user.
Future<void> tapStudy(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pump();
}

/// A small host that plays the shell: it owns the document props the store
/// would and answers each request from the fake core's own documents.
///
/// Using the same Markdown as [FakeCore] keeps the widget assertions and the
/// store assertions honest about the same bytes.
class _DocHost extends StatefulWidget {
  const _DocHost({super.key, required this.detail, this.failures = 0});

  final SessionDetail detail;

  /// The first N document requests fail with the core's typed generation
  /// message, so a retry has something to fix.
  final int failures;

  @override
  State<_DocHost> createState() => _DocHostState();
}

class _DocHostState extends State<_DocHost> {
  final calls = <({String kind, String? attempt})>[];
  String? text;
  String? name;
  String? error;
  bool loading = false;

  /// When true the next request waits for [release], so a test can assert the
  /// pending state instead of racing it.
  bool hold = false;
  Completer<void>? _gate;
  var _requests = 0;
  var backs = 0;
  var chats = 0;

  void release() {
    _gate?.complete();
    _gate = null;
    hold = false;
  }

  Future<void> generate(String kind, {String? attempt}) async {
    calls.add((kind: kind, attempt: attempt));
    setState(() {
      loading = true;
      error = null;
      text = null;
      name = null;
    });
    if (hold) {
      _gate ??= Completer<void>();
      await _gate!.future;
    } else {
      await Future<void>.delayed(Duration.zero);
    }
    if (!mounted) return;
    _requests += 1;
    final refused =
        _requests <= widget.failures || (attempt ?? '').contains('reject');
    setState(() {
      loading = false;
      if (refused) {
        error = 'the provider rejected the request';
        text = null;
        name = null;
        return;
      }
      name = switch (kind) {
        'contract' => 'contract.md',
        'contradictions' => 'contradictions.md',
        _ => 'check.md',
      };
      text = switch (kind) {
        'contract' => FakeCore.contractDocument,
        'contradictions' => FakeCore.contradictionsDocument,
        _ => FakeCore.checkDocument(attempt ?? ''),
      };
    });
  }

  Future<void> retry() async {
    if (calls.isEmpty) return;
    final last = calls.last;
    await generate(last.kind, attempt: last.attempt);
  }

  void close() {
    setState(() {
      text = null;
      name = null;
      error = null;
      loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return SessionDetailView(
      detail: widget.detail,
      loading: false,
      documentText: text,
      documentName: name,
      documentLoading: loading,
      documentError: error,
      onGenerateDocument: generate,
      onRetryDocument: retry,
      onCloseDocument: close,
      onOpenChat: () => chats++,
      onBack: () => backs++,
    );
  }
}

void main() {
  testWidgets('the done-when contract renders its text, name and label', (
    tester,
  ) async {
    final host = GlobalKey<_DocHostState>();
    await pumpDetail(tester, _DocHost(key: host, detail: _detail));

    expect(find.text('STUDY TOOLS'), findsOneWidget);
    expect(find.text('generated · not sources'), findsOneWidget);

    await tapStudy(tester, 'study-contract');
    await tester.pumpAndSettle();

    expect(host.currentState!.calls.single.kind, 'contract');
    expect(host.currentState!.calls.single.attempt, isNull);

    expect(find.text('GENERATED SESSION DOCUMENT'), findsOneWidget);
    expect(find.text('contract.md'), findsOneWidget);
    expect(find.textContaining('not a source'), findsOneWidget);
    expect(
      find.textContaining(
        'Explain the boundary conditions',
        findRichText: true,
      ),
      findsOneWidget,
    );

    // The reader is a layer: the detail's source card is behind it.
    expect(find.text('SOURCES'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the contradictions action renders its own document', (
    tester,
  ) async {
    final host = GlobalKey<_DocHostState>();
    await pumpDetail(tester, _DocHost(key: host, detail: _detail));

    // `2` is the keyboard route to the same action.
    await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
    await tester.pumpAndSettle();

    expect(host.currentState!.calls.single.kind, 'contradictions');
    expect(find.text('GENERATED SESSION DOCUMENT'), findsOneWidget);
    expect(find.text('contradictions.md'), findsOneWidget);
    expect(
      find.textContaining('the field is uniform', findRichText: true),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('check requires a non-empty attempt and sends it', (
    tester,
  ) async {
    final host = GlobalKey<_DocHostState>();
    await pumpDetail(tester, _DocHost(key: host, detail: _detail));

    await tapStudy(tester, 'study-check');
    await tester.pumpAndSettle();

    final field = find.byKey(const ValueKey('study-attempt-field'));
    final generateButton = find.byKey(const ValueKey('study-attempt-generate'));
    expect(field, findsOneWidget);
    expect(tester.widget<FilledButton>(generateButton).onPressed, isNull);

    // Whitespace is still empty: the core can never receive a blank attempt.
    await tester.enterText(field, '   ');
    await tester.pump();
    expect(tester.widget<FilledButton>(generateButton).onPressed, isNull);

    await tester.enterText(field, 'Boundary conditions fix the limits.');
    await tester.pump();
    expect(tester.widget<FilledButton>(generateButton).onPressed, isNotNull);

    await tester.tap(generateButton);
    await tester.pumpAndSettle();

    expect(host.currentState!.calls.single.kind, 'check');
    expect(
      host.currentState!.calls.single.attempt,
      'Boundary conditions fix the limits.',
    );
    expect(find.text('check.md'), findsOneWidget);
    expect(
      find.textContaining(
        'Checked: "Boundary conditions fix the limits."',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('cancelling the attempt dialog sends nothing', (tester) async {
    final host = GlobalKey<_DocHostState>();
    await pumpDetail(tester, _DocHost(key: host, detail: _detail));

    await tapStudy(tester, 'study-check');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('study-attempt-cancel')));
    await tester.pumpAndSettle();

    expect(host.currentState!.calls, isEmpty);
    expect(find.text('STUDY TOOLS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a generation shows its pending state and one retryable error', (
    tester,
  ) async {
    final host = GlobalKey<_DocHostState>();
    await pumpDetail(tester, _DocHost(key: host, detail: _detail, failures: 1));

    host.currentState!.hold = true;
    await tapStudy(tester, 'study-contract');
    await tester.pump();

    expect(find.text('GENERATED SESSION DOCUMENT'), findsOneWidget);
    expect(find.text('generating…'), findsOneWidget);

    host.currentState!.release();
    await tester.pumpAndSettle();

    expect(find.text('could not generate this document'), findsOneWidget);
    expect(find.text('the provider rejected the request'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('study-document-retry')));
    await tester.pumpAndSettle();

    // The retry asks for the same document, and its success clears the error.
    expect(host.currentState!.calls.length, 2);
    expect(host.currentState!.calls.last.kind, 'contract');
    expect(find.text('could not generate this document'), findsNothing);
    expect(find.text('contract.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'close and Esc return to the detail without leaving the session',
    (tester) async {
      final host = GlobalKey<_DocHostState>();
      await pumpDetail(tester, _DocHost(key: host, detail: _detail));

      await tapStudy(tester, 'study-contract');
      await tester.pumpAndSettle();
      expect(find.text('GENERATED SESSION DOCUMENT'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('study-document-close')));
      await tester.pumpAndSettle();

      expect(find.text('GENERATED SESSION DOCUMENT'), findsNothing);
      expect(find.text('SOURCES'), findsOneWidget);
      expect(find.text('STUDY TOOLS'), findsOneWidget);
      expect(host.currentState!.backs, 0);
      expect(host.currentState!.chats, 0);

      // Esc while the reader is open closes the reader, not the session.
      await tapStudy(tester, 'study-contract');
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(find.text('GENERATED SESSION DOCUMENT'), findsNothing);
      expect(find.text('STUDY TOOLS'), findsOneWidget);
      expect(host.currentState!.backs, 0);

      // With the reader closed, Esc is the detail's own back action again.
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(host.currentState!.backs, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('the generated reader fits 800x600', (tester) async {
    await pumpDetail(
      tester,
      _DocHost(detail: _detail),
      width: 800,
      height: 600,
    );

    await tapStudy(tester, 'study-contradictions');
    await tester.pumpAndSettle();

    expect(find.text('contradictions.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the study tools are read-only without a handler', (
    tester,
  ) async {
    await pumpDetail(
      tester,
      const SessionDetailView(detail: _detail, loading: false),
    );

    final button = tester.widget<OutlinedButton>(
      find.byKey(const ValueKey('study-contract')),
    );
    expect(button.onPressed, isNull);

    // The digits are inert when the shell did not wire the action.
    await tester.sendKeyEvent(LogicalKeyboardKey.digit1);
    await tester.pumpAndSettle();
    expect(find.text('GENERATED SESSION DOCUMENT'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test('store document success, error, retry and clear', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    final messagesBefore =
        store.sessionChatFor(FakeCore.sessionId)?.messages.length ?? 0;
    final sourcesBefore = store.activeSession!.sources.length;

    await store.generateDocument(FakeCore.sessionId, 'contract');

    expect(core.documentCalls.single, {
      'id': FakeCore.sessionId,
      'kind': 'contract',
      'attempt': null,
    });
    expect(store.documentText, FakeCore.contractDocument);
    expect(store.documentName, 'contract.md');
    expect(store.documentLoading, isFalse);
    expect(store.documentError, isNull);
    expect(store.documentOpen, isTrue);

    // A generated document is not a source and creates no chat turn.
    expect(store.activeSession!.sources, hasLength(sourcesBefore));
    expect(
      store.sessionChatFor(FakeCore.sessionId)?.messages.length,
      messagesBefore,
    );

    store.closeDocument();
    expect(store.documentText, isNull);
    expect(store.documentName, isNull);
    expect(store.documentOpen, isFalse);

    // A refusal is recorded once and never thrown; nothing is stored.
    await store.generateDocument(
      FakeCore.sessionId,
      'check',
      attempt: 'reject this attempt',
    );
    expect(store.documentText, isNull);
    expect(store.documentLoading, isFalse);
    expect(store.documentError, contains('provider rejected'));

    final requests = core.calls
        .where((method) => method == 'session.document')
        .length;
    await store.retryDocument();
    expect(
      core.calls.where((method) => method == 'session.document').length,
      requests + 1,
    );
    expect(store.documentError, contains('provider rejected'));

    // Closing the session releases the reader and its error.
    store.closeSession();
    expect(store.documentText, isNull);
    expect(store.documentError, isNull);
    expect(store.documentOpen, isFalse);
    expect(store.error, isNull);
  });

  test(
    'a missing model is one typed generation message, not a crash',
    () async {
      final core = FakeCore(
        documentFailure: 'link a model in Settings → Providers',
      );
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSession(FakeCore.sessionId);

      await store.generateDocument(FakeCore.sessionId, 'contract');

      expect(store.documentText, isNull);
      expect(store.documentLoading, isFalse);
      expect(store.documentError, 'link a model in Settings → Providers');
      expect(core.documentCalls, isEmpty);
      expect(store.error, isNull);
      expect(store.activeSession, isNotNull);
    },
  );
}
