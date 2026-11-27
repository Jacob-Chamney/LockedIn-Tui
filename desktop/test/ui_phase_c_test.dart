import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/chat_page.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/shell/chrome.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The UI review's Phase C: the first-run action, one composer, and the
/// session page's own outputs in reach.

const _usage = ChatUsageView(tokens: 0, costMicroUsd: null, durationMs: null);

ChatSnapshot _chat({String model = 'openai/gpt-4.1-mini'}) => ChatSnapshot(
  status: 'idle',
  model: model,
  streamed: '',
  messages: const [],
  usage: _usage,
);

const _textSession = SessionDetail(
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
      hash: 'sha256:0badf00d5678',
      kind: 'markdown',
    ),
  ],
  steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
);

const _pdfSession = SessionDetail(
  id: '2026-11-01-1430-physics-unit-4',
  name: 'Physics — Unit 4',
  created: '2026-11-01T14:30:00Z',
  archived: false,
  prompt: 'Explain the problem set.',
  sources: [
    SessionSource(
      name: 'lecture-4.pdf',
      originalPath: '/home/me/input/lecture-4.pdf',
      storedPath: 'sources/lecture-4.pdf',
      hash: 'sha256:0badf00d5678',
      kind: 'pdf',
    ),
  ],
  steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
);

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1280, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_app(child));
  await tester.pumpAndSettle();
}

const _sessionRows = <SessionRow>[
  SessionRow(
    id: 'alpha',
    name: 'Zoology',
    date: '2026-11-01T14:30:00Z',
    sources: 2,
    stepsDone: 0,
    stepsTotal: 2,
    archived: false,
  ),
];

const _skillRows = <SkillRow>[
  SkillRow(
    id: 'read-disassembly',
    name: 'Read disassembly output',
    stageDone: 0,
    stageTotal: 1,
    lastOpened: '2026-11-10T09:00:00Z',
    chats: 0,
    archived: false,
  ),
];

const _project = WorkProjectDetail(
  id: 'my-app-4f2a1c',
  name: 'My app',
  root: '/home/me/Projects/my-app',
  rootMissing: false,
  mode: 'chat',
  swarmName: '',
  archived: false,
  instructions: 'Prefer small diffs.',
  defaultAgent: null,
  agents: [],
  tasks: 0,
  hasGit: false,
  lastOpened: '2026-11-14T09:12:00Z',
);

void main() {
  testWidgets('the Chill first run offers connect a model as a button', (
    tester,
  ) async {
    var linked = 0;
    await _pump(
      tester,
      ChatPage(
        chat: _chat(model: ''),
        online: true,
        configured: false,
        onSend: (_) async => true,
        onLinkModel: () => linked += 1,
      ),
    );

    final cta = find.byKey(const ValueKey('chat-link-model'));
    expect(cta, findsOneWidget);
    expect(
      tester.widget<FilledButton>(cta),
      isA<FilledButton>(),
      reason: 'the one first-run action is a button, not a warning link',
    );
    await tester.tap(cta);
    expect(linked, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the Chill composer sends with the same arrow button', (
    tester,
  ) async {
    await _pump(
      tester,
      ChatPage(
        chat: _chat(),
        online: true,
        configured: true,
        onSend: (_) async => true,
      ),
    );

    final send = find.widgetWithText(FilledButton, 'Send');
    expect(send, findsOneWidget);
    expect(
      find.descendant(of: send, matching: find.byIcon(Icons.arrow_upward)),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a session puts its outputs above the prompt', (tester) async {
    String? opened;
    await _pump(
      tester,
      SessionDetailView(
        detail: _textSession,
        loading: false,
        onOpenOutput: (kind) async => opened = kind,
        onGenerateDocument: (kind, {attempt}) async {},
        onExtractFigure: ({
          required int page,
          int? x,
          int? y,
          int? width,
          int? height,
          String caption = '',
        }) async {},
      ),
    );

    expect(find.text('STUDY TOOLS'), findsOneWidget);
    final tools = tester.getTopLeft(find.text('STUDY TOOLS')).dy;
    final instructions = tester.getTopLeft(find.text('INSTRUCTIONS')).dy;
    expect(
      tools,
      lessThan(instructions),
      reason: 'the outputs are the point of the session',
    );

    await tester.tap(find.byKey(const ValueKey('study-guide-open')));
    expect(opened, 'study-guide');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the figure form waits for a PDF source', (tester) async {
    await _pump(
      tester,
      SessionDetailView(
        detail: _textSession,
        loading: false,
        onExtractFigure: ({
          required int page,
          int? x,
          int? y,
          int? width,
          int? height,
          String caption = '',
        }) async {},
      ),
    );

    expect(find.byKey(const ValueKey('figure-page')), findsNothing);
    expect(find.byKey(const ValueKey('figures-missing-pdf')), findsOneWidget);
    expect(find.textContaining('add one to crop a diagram'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a session row offers its verbs without opening it', (
    tester,
  ) async {
    await _pump(
      tester,
      SessionsPage(
        sessions: _sessionRows,
        loading: false,
        onArchive: (_) async => 'folder',
        onExport: (_) async => '/tmp/x.zip',
        onDelete: (_) async {},
      ),
      size: const Size(1000, 700),
    );

    final menu = find.byKey(const ValueKey('session-row-menu-alpha'));
    expect(menu, findsOneWidget);
    await tester.tap(menu);
    await tester.pumpAndSettle();
    expect(find.text('archive'), findsOneWidget);
    expect(find.text('export'), findsOneWidget);
    expect(find.text('delete'), findsOneWidget);

    await tester.tap(find.text('archive'));
    await tester.pumpAndSettle();
    // The menu runs the same named confirmation the key runs.
    expect(find.text('Archive “Zoology”?'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('session-archive-cancel')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a goal row offers its verbs without opening it', (tester) async {
    await _pump(
      tester,
      SkillsPage(
        skills: _skillRows,
        loading: false,
        onArchive: (_) async => 'folder',
        onExport: (_) async => '/tmp/x.zip',
        onDelete: (_) async {},
      ),
      size: const Size(1000, 700),
    );

    final menu = find.byKey(const ValueKey('skill-row-menu-read-disassembly'));
    expect(menu, findsOneWidget);
    await tester.tap(menu);
    await tester.pumpAndSettle();
    await tester.tap(find.text('archive'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Archive “Read disassembly output”'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('skill-archive-cancel')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a project row removes its metadata after a named confirmation', (
    tester,
  ) async {
    String? removed;
    await _pump(
      tester,
      WorkPage(
        projects: const [
          ProjectRow(
            id: 'my-app',
            name: 'My app',
            folder: '/home/me/Projects/my-app',
            mode: 'chat',
            swarmName: '',
            archived: false,
            agents: [],
          ),
        ],
        loading: false,
        onRemove: (id) async => removed = id,
      ),
      size: const Size(1000, 700),
    );

    await tester.tap(find.byKey(const ValueKey('project-row-menu-my-app')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('remove'));
    await tester.pumpAndSettle();

    // The confirmation names the project and says its files stay.
    expect(
      find.textContaining('Its files stay at /home/me/Projects/my-app'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const ValueKey('project-remove-confirm')));
    await tester.pumpAndSettle();
    expect(removed, 'my-app');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the project detail offers its layers as one row', (
    tester,
  ) async {
    var chat = 0;
    var approvals = 0;
    var swarm = 0;
    var activity = 0;
    await _pump(
      tester,
      WorkDetailView(
        project: _project,
        onOpenChat: () => chat += 1,
        onOpenApprovals: () => approvals += 1,
        onOpenSwarm: () => swarm += 1,
        onOpenActivity: () => activity += 1,
      ),
    );

    for (final (key, check) in [
      ('work-nav-chat', () => chat),
      ('work-nav-approvals', () => approvals),
      ('work-nav-swarm', () => swarm),
      ('work-nav-activity', () => activity),
    ]) {
      final action = find.byKey(ValueKey(key));
      expect(action, findsOneWidget, reason: 'missing $key');
      expect(
        find.descendant(of: action, matching: find.byType(KeyCap)),
        findsOneWidget,
        reason: '$key names its chord',
      );
      await tester.tap(action);
      await tester.pump();
      expect(check(), 1, reason: '$key runs its callback');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('a session with a PDF keeps the crop form', (tester) async {
    await _pump(
      tester,
      SessionDetailView(
        detail: _pdfSession,
        loading: false,
        onExtractFigure: ({
          required int page,
          int? x,
          int? y,
          int? width,
          int? height,
          String caption = '',
        }) async {},
      ),
    );

    expect(find.byKey(const ValueKey('figure-page')), findsOneWidget);
    expect(find.byKey(const ValueKey('figures-missing-pdf')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
