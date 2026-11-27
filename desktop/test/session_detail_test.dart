import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/sessions/session_chat.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Fixtures — plain values only. No core, no filesystem, no network.
// ---------------------------------------------------------------------------

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
    SessionSource(
      name: 'ComplexNumbers.pdf',
      originalPath: '/home/me/input/ComplexNumbers.pdf',
      storedPath: 'sources/ComplexNumbers.pdf',
      hash: 'sha256:0badf00d5678',
      kind: 'pdf',
    ),
  ],
  steps: SessionSteps(
    done: 1,
    total: 2,
    exists: true,
    markdown:
        '# Assignment steps\n\n'
        '> 1 of 2 steps done\n\n'
        '## Understand\n\n'
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

const _usage = ChatUsageView(
  tokens: 1234,
  costMicroUsd: 2100,
  durationMs: 2400,
);

const _rows = <SessionRow>[
  SessionRow(
    id: 'physics-unit-4',
    name: 'Physics — Unit 4',
    date: '2026-11-01T14:30:00Z',
    sources: 3,
    stepsDone: 4,
    stepsTotal: 8,
    archived: false,
  ),
  SessionRow(
    id: 'chemistry-bonding',
    name: 'Chemistry — Bonding',
    date: '2026-10-24T09:05:00Z',
    sources: 1,
    stepsDone: 0,
    stepsTotal: 0,
    archived: true,
  ),
];

ChatSnapshot _chat({
  String status = 'idle',
  String? model = 'openai/gpt-4.1-mini',
  List<ChatMessageView> messages = const [],
  String streamed = '',
  ChatUsageView usage = _usage,
  ChatBlocked? blocked,
  ChatFailure? error,
}) => ChatSnapshot(
  status: status,
  model: model,
  streamed: streamed,
  messages: messages,
  usage: usage,
  blocked: blocked,
  error: error,
);

const _userTurn = ChatMessageView(
  id: 'u1',
  role: 'user',
  text: 'what is a boundary condition?',
  outcome: 'done',
);

const _assistantTurn = ChatMessageView(
  id: 'a1',
  role: 'assistant',
  text: 'It fixes the limits of the integral for this problem.',
  outcome: 'done',
);

/// The same session with a different `assignment-steps.md`, as the core would
/// return it from `session.toggleStep`.
SessionDetail detailWithSteps({
  required String markdown,
  required int done,
  required int total,
}) => SessionDetail(
  id: _detail.id,
  name: _detail.name,
  created: _detail.created,
  archived: _detail.archived,
  prompt: _detail.prompt,
  sources: _detail.sources,
  steps: SessionSteps(
    done: done,
    total: total,
    exists: true,
    markdown: markdown,
  ),
);

const _stepsBothUnchecked =
    '# Assignment steps\n\n'
    '> 0 of 2 steps done\n\n'
    '## Understand\n\n'
    '- [ ] Read section 4.2 and summarise the boundary conditions\n'
    '- [ ] Derive the energy balance\n';

const _stepsSecondChecked =
    '# Assignment steps\n\n'
    '> 1 of 2 steps done\n\n'
    '## Understand\n\n'
    '- [ ] Read section 4.2 and summarise the boundary conditions\n'
    '- [x] Derive the energy balance\n';

/// A steps file long enough that the page really scrolls at 800x600.
String tallStepsMarkdown() {
  final buffer = StringBuffer('# Assignment steps\n\n> 0 of 30 steps done\n\n');
  for (var index = 0; index < 30; index++) {
    buffer.writeln(
      '- [ ] Step ${index + 1}: summarise section ${index + 1} of the unit',
    );
  }
  return buffer.toString();
}

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
  // A loading state paints an indeterminate spinner, which never settles; the
  // tests that assert it pump one frame instead.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

void main() {
  testWidgets('a 620 pane inside a 900 window renders the compact header', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: Align(
            alignment: Alignment.centerLeft,
            child: SizedBox(
              width: 620,
              height: 700,
              child: SessionDetailView(
                detail: detailWithSteps(
                  markdown: _stepsBothUnchecked,
                  done: 0,
                  total: 2,
                ),
                loading: false,
                onToggleStep: (_) async {},
                onOpenSettings: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Settled: at 620 the header is still the wide variant (the compact
    // threshold is 560) and it fits — no overflow, no clipped control.
    expect(find.byKey(const ValueKey('session-settings-open')), findsOneWidget);
    expect(find.text('Edit instructions'), findsOneWidget);
    expect(find.text('Open chat'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a 555 pane inside a 900 window renders the icon header', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(900, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: Align(
            alignment: Alignment.centerLeft,
            child: SizedBox(
              width: 555,
              height: 700,
              child: SessionDetailView(
                detail: detailWithSteps(
                  markdown: _stepsBothUnchecked,
                  done: 0,
                  total: 2,
                ),
                loading: false,
                onToggleStep: (_) async {},
                onOpenSettings: () {},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Below the hint threshold the pane-measured header folds to the icon even
    // though the window still claims 900.
    expect(find.byKey(const ValueKey('session-settings-open')), findsOneWidget);
    expect(find.text('Edit instructions'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('initialStep puts the cursor on the named step', (tester) async {
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detailWithSteps(
          markdown: _stepsBothUnchecked,
          done: 0,
          total: 2,
        ),
        loading: false,
        initialStep: 1,
        onToggleStep: (_) async {},
      ),
    );

    // The reader opens with the second step selected, which is what a review
    // row about that step asks for.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('step-row-selected')),
        matching: find.text('Derive the energy balance'),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('clicking a step checkbox toggles that step', (tester) async {
    final toggled = <int>[];
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detailWithSteps(
          markdown: _stepsBothUnchecked,
          done: 0,
          total: 2,
        ),
        loading: false,
        onToggleStep: (index) async => toggled.add(index),
      ),
    );

    // The glyph is a button, and it toggles the step it is drawn on — not the
    // cursor's step, which starts at 0.
    final check = find.byKey(const ValueKey('step-check-1'));
    await tester.ensureVisible(check);
    await tester.pumpAndSettle();
    await tester.tap(check);
    await tester.pumpAndSettle();
    expect(toggled, [1]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('detail renders prompt, sources, steps and the checkbox rows', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SessionDetailView(detail: _detail, loading: false),
    );

    // Header: name, created date, primary action.
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.textContaining('2026-11-01'), findsWidgets);
    expect(find.text('Open chat'), findsOneWidget);
    expect(find.text('archived'), findsNothing);

    // Prompt.
    expect(
      find.text('Explain the problem set in sections 4.2 and 4.3.'),
      findsOneWidget,
    );

    // Sources: name, kind, short hash.
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.text('ComplexNumbers.pdf'), findsOneWidget);
    expect(find.text('markdown'), findsOneWidget);
    expect(find.text('pdf'), findsOneWidget);
    expect(find.textContaining('deadbeef'), findsOneWidget);
    expect(find.textContaining('0badf00d'), findsOneWidget);

    // Steps: counts plus the markdown checkbox rows rendered by ChatMarkdown.
    expect(find.text('1/2 steps'), findsOneWidget);
    expect(find.text('☑'), findsOneWidget);
    expect(find.text('☐'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty detail explains the missing prompt, sources and steps', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SessionDetailView(detail: _emptyDetail, loading: false),
    );

    expect(find.text('no instructions yet'), findsOneWidget);
    // The next action, with the key that does it.
    expect(
      find.textContaining('press s to set the prompt in session settings'),
      findsOneWidget,
    );
    expect(find.text('no sources yet'), findsOneWidget);
    expect(
      find.textContaining('Nothing outside its sources folder is visible'),
      findsOneWidget,
    );
    expect(find.text('steps missing'), findsOneWidget);
    expect(find.text('no steps'), findsOneWidget);

    // The primary action survives the empty state.
    expect(find.text('Open chat'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a broken session is one readable error with retry and back', (
    tester,
  ) async {
    var retries = 0;
    var backs = 0;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: null,
        loading: false,
        error: 'session folder is missing',
        onRetry: () => retries++,
        onBack: () => backs++,
      ),
    );

    expect(find.text('could not open this session'), findsOneWidget);
    expect(find.text('session folder is missing'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(retries, 1);

    await tester.tap(find.text('Back to sessions'));
    await tester.pump();
    expect(backs, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('loading and unavailable states are stated, not blank', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SessionDetailView(detail: null, loading: true),
      settle: false,
    );
    expect(find.text('loading session…'), findsOneWidget);

    await pumpPage(
      tester,
      const SessionDetailView(detail: null, loading: false),
    );
    expect(find.text('session unavailable'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('open chat and back callbacks fire, including from Esc', (
    tester,
  ) async {
    var opened = 0;
    var backs = 0;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: _detail,
        loading: false,
        onOpenChat: () => opened++,
        onBack: () => backs++,
      ),
    );

    await tester.tap(find.text('Open chat'));
    await tester.pump();
    expect(opened, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);

    // `c` is the keyboard route to the chat, so the page is never mouse-only.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.pumpAndSettle();
    expect(opened, 2);

    await tester.tap(find.byTooltip('Back to sessions'));
    await tester.pump();
    expect(backs, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a refresh failure keeps the detail and offers a retry', (
    tester,
  ) async {
    var retries = 0;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: _detail,
        loading: false,
        error: 'refresh failed — showing the last snapshot',
        onRetry: () => retries++,
      ),
    );

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(
      find.text('refresh failed — showing the last snapshot'),
      findsOneWidget,
    );
    expect(find.text('lecture-4.md'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('chat renders turns, stopped/failed markers and usage', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(
          messages: const [
            _userTurn,
            _assistantTurn,
            ChatMessageView(
              id: 'a2',
              role: 'assistant',
              text: 'half an answer',
              outcome: 'stopped',
            ),
            ChatMessageView(
              id: 'a3',
              role: 'assistant',
              text: 'no answer',
              outcome: 'failed',
            ),
          ],
        ),
      ),
    );

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.textContaining('openai/gpt-4.1-mini'), findsOneWidget);

    expect(find.text('you'), findsOneWidget);
    expect(find.text('locked in'), findsNWidgets(3));
    expect(find.text('what is a boundary condition?'), findsOneWidget);
    expect(
      find.textContaining(
        'It fixes the limits of the integral',
        findRichText: true,
      ),
      findsOneWidget,
    );

    expect(find.text('— stopped'), findsOneWidget);
    expect(find.text('× failed'), findsOneWidget);

    // Usage lives in the shell's status bar, not under the composer: the two
    // lines said the same numbers 20 px apart.
    expect(find.textContaining('1.2K tok'), findsNothing);
    expect(find.textContaining(r'$0.0021'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter sends once and Stop cancels the turn', (tester) async {
    final sent = <String>[];
    var cancelled = 0;
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(messages: const [_userTurn, _assistantTurn]),
        onSend: (text) async {
          sent.add(text);
          return true;
        },
        onCancel: () => cancelled++,
      ),
    );

    await tester.tap(find.byKey(const ValueKey('session-chat-composer')));
    await tester.enterText(
      find.byKey(const ValueKey('session-chat-composer')),
      '  what comes next?  ',
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();

    expect(sent, ['what comes next?']);
    expect(sent.length, 1);
    expect(cancelled, 0);

    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(
          status: 'streaming',
          messages: const [
            _userTurn,
            ChatMessageView(
              id: 'a1',
              role: 'assistant',
              text: '',
              outcome: null,
            ),
          ],
          streamed: 'partial answer',
        ),
        onSend: (text) async {
          sent.add(text);
          return true;
        },
        onCancel: () => cancelled++,
      ),
    );

    expect(find.text('partial answer'), findsOneWidget);
    await tester.tap(find.text('Stop'));
    await tester.pump();
    expect(cancelled, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a blocked chat disables send, keeps the draft and explains why',
    (tester) async {
      final sent = <String>[];
      await pumpPage(
        tester,
        SessionChatView(
          detail: _detail,
          loading: false,
          chat: _chat(
            messages: const [_userTurn],
            blocked: const ChatBlocked(
              reason: 'day budget reached',
              fix: 'raise it in Settings',
            ),
          ),
          onSend: (text) async {
            sent.add(text);
            return true;
          },
        ),
      );

      expect(find.textContaining('day budget reached'), findsOneWidget);
      expect(find.textContaining('raise it in Settings'), findsOneWidget);

      final send = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Send'),
      );
      expect(send.onPressed, isNull);

      await tester.enterText(
        find.byKey(const ValueKey('session-chat-composer')),
        'a draft',
      );
      await tester.pump();
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('session-chat-composer')),
            )
            .controller
            ?.text,
        'a draft',
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(sent, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('an empty session chat invites the first question', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(),
        onSend: (_) async => true,
      ),
    );

    expect(find.text('ask the first question'), findsOneWidget);
    expect(find.text('Write a question'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Tab and c focus the composer; Esc returns to the detail', (
    tester,
  ) async {
    var backs = 0;
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(messages: const [_userTurn, _assistantTurn]),
        onSend: (_) async => true,
        onBack: () => backs++,
      ),
    );

    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isFalse,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );

    // Esc in INSERT leaves the composer and stays in the chat.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 0);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isFalse,
    );

    // Esc in NORMAL is "back".
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter with no model keeps the text and sends nothing', (
    tester,
  ) async {
    final sent = <String>[];
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(model: null),
        onSend: (text) async {
          sent.add(text);
          return true;
        },
      ),
    );

    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'a question worth keeping');
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    // The Send button is disabled without a model; Enter must agree with it.
    // It used to send anyway and clear the composer the core then refused.
    expect(sent, isEmpty);
    expect(find.text('a question worth keeping'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('focusing the composer reports INSERT, leaving reports NORMAL', (
    tester,
  ) async {
    final modes = <bool>[];
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(messages: const [_userTurn, _assistantTurn]),
        onSend: (_) async => true,
        onModeChanged: modes.add,
      ),
    );

    // The shell already shows NORMAL on arrival; nothing is reported until the
    // composer takes focus.
    expect(modes, isEmpty);

    await tester.tap(find.byKey(const ValueKey('session-chat-composer')));
    await tester.pump();
    expect(modes, isNotEmpty);
    expect(modes.last, isTrue);

    // `Esc` leaves the composer, so the shell lands back in NORMAL.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(modes.last, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('session chat failure keeps the transcript and offers a retry', (
    tester,
  ) async {
    var retried = 0;
    await pumpPage(
      tester,
      SessionChatView(
        detail: _detail,
        loading: false,
        chat: _chat(
          messages: const [_userTurn, _assistantTurn],
          error: const ChatFailure(
            failed: 'provider rejected the request',
            kept: 'your message is kept',
            next: 'relink the key in Settings',
          ),
        ),
        onRetry: () => retried++,
      ),
    );

    // The failure is a banner beside the transcript, not a card that replaces
    // it: the earlier turns are still readable (docs/product.md §3.2).
    expect(find.byKey(const ValueKey('chat-failure-banner')), findsOneWidget);
    expect(find.text(_userTurn.text), findsOneWidget);
    expect(
      find.textContaining('provider rejected the request'),
      findsOneWidget,
    );
    expect(find.textContaining('your message is kept'), findsOneWidget);
    expect(find.textContaining('relink the key in Settings'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-failure-retry')));
    await tester.pump();
    expect(retried, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('sessions list: Enter opens the selected row once', (
    tester,
  ) async {
    final opened = <String>[];
    await pumpPage(
      tester,
      SessionsPage(
        sessions: _rows,
        loading: false,
        onOpen: (row) => opened.add(row.id),
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(opened, ['chemistry-bonding']);

    // Without an onOpen handler Enter stays inert, so the list keeps working.
    await pumpPage(tester, const SessionsPage(sessions: _rows, loading: false));
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('no overflow at 800x600 and 1280x800', (tester) async {
    for (final size in const [Size(800, 600), Size(1280, 800)]) {
      await pumpPage(
        tester,
        const SessionDetailView(detail: _detail, loading: false),
        width: size.width,
        height: size.height,
      );
      expect(tester.takeException(), isNull, reason: 'detail at $size');

      await pumpPage(
        tester,
        SessionChatView(
          detail: _detail,
          loading: false,
          chat: _chat(messages: const [_userTurn, _assistantTurn]),
          onSend: (_) async => true,
        ),
        width: size.width,
        height: size.height,
      );
      expect(tester.takeException(), isNull, reason: 'chat at $size');

      await pumpPage(
        tester,
        const SessionDetailView(detail: _emptyDetail, loading: false),
        width: size.width,
        height: size.height,
      );
      expect(tester.takeException(), isNull, reason: 'empty detail at $size');
    }
  });

  testWidgets('steps render as rows and Up/Down moves the selected task', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SessionDetailView(detail: _detail, loading: false),
    );

    expect(find.text('1/2 steps'), findsOneWidget);
    expect(find.text('Understand'), findsOneWidget);
    expect(find.byKey(const ValueKey('step-row-0')), findsOneWidget);
    expect(find.byKey(const ValueKey('step-row-1')), findsOneWidget);

    // The first task is selected: accent bar, panel fill and the heavier weight
    // so selection is never colour-only.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('step-row-selected')),
        matching: find.textContaining('Read section 4.2'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('step-row-selected')),
        matching: find.text('Derive the energy balance'),
      ),
      findsOneWidget,
    );
    final boldText = tester.widget<Text>(
      find.descendant(
        of: find.byKey(const ValueKey('step-row-selected')),
        matching: find.text('Derive the energy balance'),
      ),
    );
    expect(boldText.style?.fontWeight, FontWeight.w600);

    // `k` moves back up, so both vim keys and arrows work.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('step-row-selected')),
        matching: find.textContaining('Read section 4.2'),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Space sends the selected index once and renders the answer', (
    tester,
  ) async {
    final sent = <int>[];
    var detail = _detail;
    late StateSetter setHost;
    await pumpPage(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          setHost = setState;
          return SessionDetailView(
            detail: detail,
            loading: false,
            onToggleStep: (index) async {
              sent.add(index);
              // The core answers with the whole new file; the shell replaces
              // the detail and never writes locally.
              setHost(
                () => detail = index == 0
                    ? detailWithSteps(
                        markdown: _stepsBothUnchecked,
                        done: 0,
                        total: 2,
                      )
                    : detailWithSteps(
                        markdown: _stepsSecondChecked,
                        done: 1,
                        total: 2,
                      ),
              );
            },
          );
        },
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    expect(sent, [0]);
    expect(find.text('0/2 steps'), findsOneWidget);
    expect(find.text('☐'), findsNWidgets(2));
    expect(find.text('☑'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(sent, [0, 1]);
    expect(find.text('1/2 steps'), findsOneWidget);
    expect(find.text('☑'), findsOneWidget);
    expect(find.text('☐'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a rejected toggle keeps the rows and retries on the next Space',
    (tester) async {
      final sent = <int>[];
      var attempts = 0;
      var detail = _detail;
      late StateSetter setHost;
      await pumpPage(
        tester,
        StatefulBuilder(
          builder: (context, setState) {
            setHost = setState;
            return SessionDetailView(
              detail: detail,
              loading: false,
              onToggleStep: (index) async {
                sent.add(index);
                attempts += 1;
                if (attempts == 1) {
                  throw const RpcException(-32000, 'toggle failed', {
                    'kind': 'steps',
                    'id': '2026-11-01-1430-physics-unit-4',
                    'message': 'could not write assignment-steps.md',
                  });
                }
                setHost(
                  () => detail = detailWithSteps(
                    markdown: _stepsBothUnchecked,
                    done: 0,
                    total: 2,
                  ),
                );
              },
            );
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();

      // One message, the previous markdown and counts, and the same selection.
      expect(sent, [0]);
      expect(find.text('could not write assignment-steps.md'), findsOneWidget);
      expect(find.text('1/2 steps'), findsOneWidget);
      expect(find.text('☑'), findsOneWidget);
      expect(find.text('☐'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('step-row-selected')),
          matching: find.textContaining('Read section 4.2'),
        ),
        findsOneWidget,
      );

      // A second Space is a fresh attempt, and its success clears the message.
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();
      expect(sent, [0, 0]);
      expect(find.text('could not write assignment-steps.md'), findsNothing);
      expect(find.text('0/2 steps'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('steps stay read-only without an onToggleStep handler', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SessionDetailView(detail: _detail, loading: false),
    );

    expect(find.text('Enter chat · Esc back'), findsOneWidget);
    expect(find.text('Space toggle · Enter chat · Esc back'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('1/2 steps'), findsOneWidget);
    expect(find.byKey(const ValueKey('step-row-selected')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Space toggles without scrolling the page', (tester) async {
    var toggles = 0;
    await pumpPage(
      tester,
      SessionDetailView(
        detail: detailWithSteps(
          markdown: tallStepsMarkdown(),
          done: 0,
          total: 30,
        ),
        loading: false,
        onToggleStep: (_) async => toggles += 1,
      ),
    );

    final scrollable = tester.state<ScrollableState>(
      find.descendant(
        of: find.byType(ListView),
        matching: find.byType(Scrollable),
      ),
    );
    scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
    await tester.pumpAndSettle();
    final before = scrollable.position.pixels;
    expect(before, greaterThan(0));

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    expect(toggles, 1);
    expect(scrollable.position.pixels, before);
    expect(tester.takeException(), isNull);
  });

  testWidgets('interactive steps fit 800x600 and a narrow window', (
    tester,
  ) async {
    for (final size in const [Size(800, 600), Size(640, 600), Size(480, 720)]) {
      await pumpPage(
        tester,
        SessionDetailView(
          detail: _detail,
          loading: false,
          onToggleStep: (_) async {},
        ),
        width: size.width,
        height: size.height,
      );
      expect(tester.takeException(), isNull, reason: 'steps at $size');
    }
  });

  test('toggleStep replaces the active steps only for the matching session', () async {
    const twoItemsOneDone =
        '# Assignment steps\n\n'
        '> 1 of 2 steps done\n\n'
        '- [x] Derive the energy balance\n'
        '- [ ] Check the units\n';
    final core = FakeCore(stepsMarkdown: twoItemsOneDone);
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSession(FakeCore.sessionId);

    expect(store.activeSession?.steps.done, 1);
    expect(store.activeSession?.steps.total, 2);

    final result = await store.toggleStep(FakeCore.sessionId, 1);

    expect(core.calls, contains('session.toggleStep'));
    expect(result.index, 1);
    expect(result.checked, isTrue);
    expect(result.done, 2);
    expect(result.total, 2);
    expect(result.markdown, contains('- [x] Check the units'));
    expect(result.hash, startsWith('sha256:'));
    expect(store.activeSession?.steps.markdown, result.markdown);
    expect(store.activeSession?.steps.done, 2);
    expect(store.activeSession?.steps.total, 2);
    // The rest of the detail survives the steps-only replacement.
    expect(store.activeSession?.name, 'Physics — Unit 4');
    expect(store.activeSession?.sources, hasLength(2));
    expect(store.error, isNull);

    // A later open reads the written markdown, not a stale copy.
    await store.openSession(FakeCore.sessionId);
    expect(store.activeSession?.steps.markdown, result.markdown);
    expect(store.activeSession?.steps.done, 2);

    // A toggle for another session never rewrites the active detail.
    final created = await store.createSession(
      name: 'Second session',
      prompt: 'A second problem set.',
    );
    await store.openSession(FakeCore.sessionId);
    final activeBefore = store.activeSession!.steps.markdown;
    await store.toggleStep(created.id, 0);
    expect(store.activeSession?.steps.markdown, activeBefore);
    expect(store.activeSession?.steps.done, 2);

    // A refused toggle throws the core's error and never raises the shell-wide
    // one; the active detail keeps its last snapshot.
    await expectLater(
      store.toggleStep('2026-01-01-0000-missing', 0),
      throwsA(isA<RpcException>()),
    );
    expect(store.error, isNull);
    expect(store.activeSession?.steps.markdown, activeBefore);
  });
}
