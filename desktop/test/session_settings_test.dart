import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/features/sessions/session_settings.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Fixtures — plain values only. No core, no filesystem, no network.
// ---------------------------------------------------------------------------

const _detail = SessionDetail(
  id: FakeCore.sessionId,
  name: 'Physics — Unit 4',
  created: '2026-11-01T09:00:00Z',
  archived: false,
  prompt: 'Explain the problem set in sections 4.2 and 4.3.',
  sources: [],
  steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
);

const _pdfSource = InstructionsSource(
  name: 'assignment.pdf',
  storedPath: 'sources/2b09044a-assignment.pdf',
  hash: 'sha256:beefcafe1234',
  kind: 'pdf',
  extractedAt: '2026-11-16T10:00:00Z',
  characters: 248,
  pages: 2,
);

const _plainSource = InstructionsSource(
  name: 'assignment.md',
  storedPath: 'sources/2b09044a-assignment.md',
  hash: 'sha256:c0ffee5678',
  kind: 'markdown',
  extractedAt: '2026-11-16T10:00:00Z',
  characters: 96,
);

Future<void> pumpPage(
  WidgetTester tester,
  Widget child, {
  double width = 800,
  double height = 600,
  bool settle = true,
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
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

String fieldText(WidgetTester tester) {
  final field = tester.widget<TextField>(
    find.byKey(const ValueKey('session-prompt-field')),
  );
  return field.controller?.text ?? '';
}

/// Scroll a settings action into view, then press it. The pane is a scrolling
/// list, so a button below the fold is still a real target once visible.
Future<void> tapButton(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders the loaded prompt and its provenance', (tester) async {
    await pumpPage(
      tester,
      const SessionSettingsView(
        detail: _detail,
        instructions: SessionInstructions(
          prompt: 'Explain the problem set in sections 4.2 and 4.3.',
          instructionsSource: _pdfSource,
        ),
        loading: false,
      ),
    );

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(
      fieldText(tester),
      'Explain the problem set in sections 4.2 and 4.3.',
    );
    expect(find.text('assignment.pdf'), findsOneWidget);
    expect(find.textContaining('248 characters'), findsOneWidget);
    expect(find.textContaining('2 pages'), findsOneWidget);
    expect(find.text('re-extract from original'), findsOneWidget);
    // A saved, non-empty prompt is labelled, and nothing says unsaved.
    expect(find.text('saved'), findsOneWidget);
    expect(find.text('unsaved changes'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Save sends the edited text and marks it saved', (tester) async {
    final saved = <String>[];
    var prompt = 'Explain the problem set.';
    var source = _pdfSource;
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SessionSettingsView(
            detail: _detail,
            instructions: SessionInstructions(
              prompt: prompt,
              instructionsSource: source,
            ),
            loading: false,
            onSave: (text) async {
              saved.add(text);
              setHost(() {
                prompt = text;
                source = _pdfSource;
              });
              return true;
            },
          );
        },
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('session-prompt-field')),
      'Read each source, then answer.',
    );
    await tester.pump();
    expect(find.text('unsaved changes'), findsWidgets);

    await tapButton(tester, 'instructions-save');

    expect(saved, ['Read each source, then answer.']);
    expect(fieldText(tester), 'Read each source, then answer.');
    expect(find.text('saved prompt.md'), findsOneWidget);
    expect(find.text('unsaved changes'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty prompt is allowed and explained', (tester) async {
    final saved = <String>[];
    await pumpPage(
      tester,
      SessionSettingsView(
        detail: _detail,
        instructions: const SessionInstructions(prompt: ''),
        loading: false,
        onSave: (text) async {
          saved.add(text);
          return true;
        },
      ),
    );

    // The empty state is explained and Save stays inert until something changes.
    expect(find.textContaining('An empty prompt is allowed'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const ValueKey('instructions-save')))
          .onPressed,
      isNull,
    );

    // Clearing a prompt is a real edit and saves the empty string.
    await pumpPage(
      tester,
      SessionSettingsView(
        detail: _detail,
        instructions: const SessionInstructions(
          prompt: 'Explain the problem set.',
        ),
        loading: false,
        onSave: (text) async {
          saved.add(text);
          return true;
        },
      ),
    );
    await tester.enterText(
      find.byKey(const ValueKey('session-prompt-field')),
      '',
    );
    await tester.pump();
    expect(find.textContaining('An empty prompt is allowed'), findsOneWidget);

    await tapButton(tester, 'instructions-save');
    expect(saved, ['']);
    expect(find.text('saved prompt.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('import replaces a non-empty prompt and shows provenance', (
    tester,
  ) async {
    final imported = <String>[];
    var prompt = 'Existing prompt.';
    InstructionsSource? source;
    var added = true;
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SessionSettingsView(
            detail: _detail,
            instructions: SessionInstructions(
              prompt: prompt,
              instructionsSource: source,
            ),
            loading: false,
            pickFile: () async => '/home/me/input/assignment.md',
            onImport: (file) async {
              imported.add(file);
              final result = InstructionsImportResult(
                prompt: 'Extracted from assignment.md.',
                instructions: _plainSource,
                added: added,
              );
              setHost(() {
                prompt = result.prompt;
                source = result.instructions;
              });
              return result;
            },
          );
        },
      ),
    );

    await tapButton(tester, 'instructions-import');

    // A non-empty prompt asks first; cancelling changes nothing.
    expect(find.text('replace the prompt?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('instructions-replace-cancel')));
    await tester.pumpAndSettle();
    expect(imported, isEmpty);
    expect(fieldText(tester), 'Existing prompt.');

    await tapButton(tester, 'instructions-import');
    await tester.tap(
      find.byKey(const ValueKey('instructions-replace-confirm')),
    );
    await tester.pumpAndSettle();

    expect(imported, ['/home/me/input/assignment.md']);
    expect(fieldText(tester), 'Extracted from assignment.md.');
    expect(find.text('assignment.md'), findsOneWidget);
    expect(find.textContaining('imported assignment.md'), findsOneWidget);
    expect(
      find.text('imported assignment.md · copied into this session'),
      findsOneWidget,
    );

    // The same bytes are already a source: the notice says so.
    added = false;
    await tapButton(tester, 'instructions-import');
    await tester.tap(
      find.byKey(const ValueKey('instructions-replace-confirm')),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('already a source'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('re-extract asks before discarding manual edits', (tester) async {
    final calls = <int>[];
    var prompt = 'Explain the problem set.';
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SessionSettingsView(
            detail: _detail,
            instructions: SessionInstructions(
              prompt: prompt,
              instructionsSource: _pdfSource,
            ),
            loading: false,
            onSave: (_) async => true,
            onReextract: () async {
              calls.add(1);
              setHost(() => prompt = 'Re-extracted from assignment.pdf.');
              return prompt;
            },
          );
        },
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('session-prompt-field')),
      'my manual edit',
    );
    await tester.pump();

    await tapButton(tester, 'instructions-reextract');
    expect(find.text('re-extract instructions?'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('instructions-reextract-cancel')),
    );
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(fieldText(tester), 'my manual edit');

    await tapButton(tester, 'instructions-reextract');
    await tester.tap(
      find.byKey(const ValueKey('instructions-reextract-confirm')),
    );
    await tester.pumpAndSettle();

    expect(calls, [1]);
    expect(fieldText(tester), 'Re-extracted from assignment.pdf.');
    expect(find.text('re-extracted the instructions'), findsOneWidget);
    expect(find.text('unsaved changes'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unsaved changes ask before leaving the pane', (tester) async {
    var backs = 0;
    await pumpPage(
      tester,
      SessionSettingsView(
        detail: _detail,
        instructions: const SessionInstructions(
          prompt: 'Explain the problem set.',
        ),
        loading: false,
        onSave: (_) async => true,
        onBack: () => backs++,
      ),
    );

    // No edits: Esc leaves immediately.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);

    await tester.enterText(
      find.byKey(const ValueKey('session-prompt-field')),
      'unsaved edit',
    );
    await tester.pump();

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('discard unsaved changes?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('instructions-leave-cancel')));
    await tester.pumpAndSettle();
    expect(backs, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('instructions-leave-confirm')));
    await tester.pumpAndSettle();
    expect(backs, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a read failure is one message with a retry', (tester) async {
    var retries = 0;
    await pumpPage(
      tester,
      SessionSettingsView(
        detail: _detail,
        instructions: null,
        loading: false,
        error: 'could not read prompt.md',
        onRetry: () async => retries++,
      ),
    );

    expect(find.text('could not read the instructions'), findsOneWidget);
    expect(find.textContaining('could not read prompt.md'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('instructions-retry')));
    await tester.pumpAndSettle();
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed save keeps the prompt and explains the failure', (
    tester,
  ) async {
    final attempts = <String>[];
    var prompt = 'Explain the problem set.';
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SessionSettingsView(
            detail: _detail,
            instructions: SessionInstructions(prompt: prompt),
            loading: false,
            onSave: (text) async {
              attempts.add(text);
              // The shell records its own message; the store's prompt is kept.
              setHost(() => prompt = 'Explain the problem set.');
              return false;
            },
          );
        },
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('session-prompt-field')),
      'a rewritten prompt',
    );
    await tester.pump();
    await tapButton(tester, 'instructions-save');

    expect(attempts, ['a rewritten prompt']);
    // The editor keeps the unsaved text so the user can retry, and the message
    // names the failure.
    expect(fieldText(tester), 'a rewritten prompt');
    expect(find.textContaining('the prompt was not saved'), findsOneWidget);
    expect(find.text('unsaved changes'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the detail header fits a narrow window with settings', (
    tester,
  ) async {
    for (final size in const [Size(800, 600), Size(560, 600), Size(480, 720)]) {
      await pumpPage(
        tester,
        SessionDetailView(
          detail: _detail,
          loading: false,
          onOpenSettings: () {},
        ),
        width: size.width,
        height: size.height,
      );
      expect(
        find.byKey(const ValueKey('session-settings-open')),
        findsOneWidget,
      );
      if (size.width >= 560) {
        expect(find.text('Edit instructions'), findsOneWidget);
      }
      expect(tester.takeException(), isNull, reason: 'detail at $size');
    }
  });

  testWidgets('settings fit 800x600 and a narrow window', (tester) async {
    for (final size in const [Size(800, 600), Size(560, 600), Size(480, 720)]) {
      await pumpPage(
        tester,
        const SessionSettingsView(
          detail: _detail,
          instructions: SessionInstructions(
            prompt: 'Explain the problem set.',
            instructionsSource: _pdfSource,
          ),
          loading: false,
          error: 'could not write prompt.md',
        ),
        width: size.width,
        height: size.height,
      );
      expect(tester.takeException(), isNull, reason: 'settings at $size');
    }
  });

  testWidgets('Ctrl+S saves the prompt', (tester) async {
    final saved = <String>[];
    await pumpPage(
      tester,
      SessionSettingsView(
        detail: _detail,
        instructions: const SessionInstructions(
          prompt: 'Explain the problem set.',
        ),
        loading: false,
        onSave: (text) async {
          saved.add(text);
          return true;
        },
      ),
    );

    await tester.enterText(
      find.byKey(const ValueKey('session-prompt-field')),
      'saved from the keyboard',
    );
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(saved, ['saved from the keyboard']);
    expect(tester.takeException(), isNull);
  });

  // -------------------------------------------------------------------------
  // Store — the real projection over a fake core.
  // -------------------------------------------------------------------------

  test('openSession loads instructions and save updates the prompt', () async {
    final core = FakeCore(
      instructionsSource: const {
        'name': 'assignment.pdf',
        'storedPath': 'sources/2b09044a-assignment.pdf',
        'hash': 'sha256:beefcafe1234',
        'kind': 'pdf',
        'extractedAt': '2026-11-16T10:00:00Z',
        'characters': 248,
        'pages': 2,
      },
    );
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    expect(core.calls, contains('session.instructions.get'));
    expect(store.sessionInstructions?.prompt, 'Explain the problem set.');
    expect(
      store.sessionInstructions?.instructionsSource?.name,
      'assignment.pdf',
    );
    expect(store.sessionInstructions?.instructionsSource?.pages, 2);
    expect(store.instructionsError, isNull);

    final ok = await store.saveSessionInstructions(FakeCore.sessionId, '');
    expect(ok, isTrue);
    expect(core.instructionsSaves, ['']);
    expect(store.sessionInstructions?.prompt, '');
    expect(store.activeSession?.prompt, '');
    // The provenance is not a prompt and survives a text edit.
    expect(
      store.sessionInstructions?.instructionsSource?.name,
      'assignment.pdf',
    );

    // A later open reads what the core wrote, not a stale copy.
    await store.openSession(FakeCore.sessionId);
    expect(store.sessionInstructions?.prompt, '');
    expect(store.activeSession?.prompt, '');

    store.closeSession();
    expect(store.sessionInstructions, isNull);
    expect(store.instructionsError, isNull);
  });

  test('import adds provenance and reextract rebuilds the prompt', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    final imported = await store.importSessionInstructions(
      FakeCore.sessionId,
      '/home/me/input/assignment.md',
    );
    expect(core.instructionsImports, ['/home/me/input/assignment.md']);
    expect(imported?.added, isTrue);
    expect(imported?.prompt, 'Extracted from assignment.md.');
    expect(store.sessionInstructions?.prompt, 'Extracted from assignment.md.');
    expect(
      store.sessionInstructions?.instructionsSource?.name,
      'assignment.md',
    );
    expect(store.sessionInstructions?.instructionsSource?.kind, 'markdown');
    expect(store.activeSession?.prompt, 'Extracted from assignment.md.');

    // Identical bytes are stored once: the second import reports `added: false`.
    final again = await store.importSessionInstructions(
      FakeCore.sessionId,
      '/home/me/input/assignment.md',
    );
    expect(again?.added, isFalse);

    final prompt = await store.reextractSessionInstructions(FakeCore.sessionId);
    expect(prompt, 'Re-extracted from assignment.md.');
    expect(core.instructionsReextracts, 1);
    expect(store.sessionInstructions?.prompt, prompt);
    expect(store.activeSession?.prompt, prompt);
    expect(store.instructionsError, isNull);
  });

  test('a refused write keeps the previous prompt and reports once', () async {
    final core = FakeCore(instructionsFailure: 'could not write prompt.md');
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    final before = store.sessionInstructions!.prompt;
    expect(
      await store.saveSessionInstructions(FakeCore.sessionId, 'rewritten'),
      isFalse,
    );
    expect(store.instructionsError, 'could not write prompt.md');
    expect(store.sessionInstructions?.prompt, before);
    expect(store.activeSession?.prompt, before);

    expect(
      await store.importSessionInstructions(
        FakeCore.sessionId,
        '/home/me/input/assignment.md',
      ),
      isNull,
    );
    expect(store.sessionInstructions?.prompt, before);

    expect(
      await store.reextractSessionInstructions(FakeCore.sessionId),
      isNull,
    );
    expect(store.sessionInstructions?.prompt, before);

    // A later read clears the write failure and restores the projection.
    await store.loadSessionInstructions(FakeCore.sessionId);
    expect(store.instructionsError, isNull);
    expect(store.sessionInstructions?.prompt, before);
  });

  // -------------------------------------------------------------------------
  // Shell — `s` opens the layer, `Esc` returns to the detail.
  // -------------------------------------------------------------------------

  testWidgets('s opens session settings and Esc returns to the detail', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final core = FakeCore(
      instructionsSource: const {
        'name': 'assignment.pdf',
        'storedPath': 'sources/2b09044a-assignment.pdf',
        'hash': 'sha256:beefcafe1234',
        'kind': 'pdf',
        'extractedAt': '2026-11-16T10:00:00Z',
        'characters': 248,
        'pages': 2,
      },
    );
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);
    await tester.pumpWidget(LockedInApp(store: store));
    await tester.pumpAndSettle();

    // Sessions surface.
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();

    expect(find.text('SESSION'), findsOneWidget);
    expect(find.text('Edit instructions'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();

    expect(find.text('SESSION SETTINGS'), findsOneWidget);
    expect(find.byKey(const ValueKey('session-prompt-field')), findsOneWidget);
    expect(find.text('assignment.pdf'), findsOneWidget);
    // The pane header and the shell status bar both name the save key.
    expect(find.text('Ctrl+S save · Esc back'), findsWidgets);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('SESSION SETTINGS'), findsNothing);
    expect(find.text('SESSION'), findsOneWidget);
    expect(find.text('Explain the problem set.'), findsOneWidget);
    expect(find.byKey(const ValueKey('session-prompt-field')), findsNothing);
    expect(store.activeSessionId, FakeCore.sessionId);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the session detail opens settings by action', (tester) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);
    await tester.pumpWidget(LockedInApp(store: store));
    await tester.pumpAndSettle();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('session-settings-open')));
    await tester.pumpAndSettle();

    expect(find.text('SESSION SETTINGS'), findsOneWidget);
    expect(find.text('session settings · prompt.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
