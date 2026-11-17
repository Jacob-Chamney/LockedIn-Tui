import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _detail = WorkProjectDetail(
  id: 'my-app-4f2a1c',
  name: 'My app',
  root: '/home/me/Projects/my-app',
  rootMissing: false,
  mode: 'chat',
  swarmName: '',
  archived: false,
  instructions: 'Prefer small diffs.',
  defaultAgent: 'reviewer-9ab12c',
  agents: [
    AgentProfileView(
      id: 'reviewer-9ab12c',
      name: 'Reviewer',
      role: 'reviewer',
      instructions: 'Review only.',
      model: '',
      maxToolCalls: 8,
      allowedTools: ['list_files', 'read_file', 'search_files'],
      allowWrite: false,
      allowCommand: false,
      template: '',
    ),
  ],
  tasks: 3,
  hasGit: true,
  lastOpened: '2026-11-14T09:12:00Z',
);

/// The `work.changes` answer the fake serves for [FakeCore.projectId], parsed
/// through the same model the store uses.
final _available = ChangeSummary.fromJson(const <String, dynamic>{
  'available': true,
  'branch': 'main',
  'detached': false,
  'dirty': true,
  'staged': 1,
  'unstaged': 1,
  'files': [
    {
      'path': 'src/app.ts',
      'status': 'modified',
      'added': 12,
      'removed': 3,
      'staged': false,
      'unstaged': true,
    },
    {
      'path': 'docs/readme.md',
      'status': 'added',
      'added': 40,
      'removed': 0,
      'staged': true,
      'unstaged': false,
    },
  ],
});

/// The documented unavailable shape: a success, not an error.
final _unavailable = ChangeSummary.fromJson(const <String, dynamic>{
  'available': false,
  'reason': 'not a git repository',
  'message':
      '“My app” is not a git repository, so there are no changes to show',
});

Future<void> pumpWork(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(900, 700),
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
  await tester.pump();
}

/// A fake whose `work.changes` can start failing after a successful read, so a
/// test can prove the previous rows survive one failed refresh.
class _FlakyChangesCore extends FakeCore {
  bool failChanges = false;

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    if (method == 'work.changes' && failChanges) {
      calls.add(method);
      throw const RpcException(-32000, 'git is not available', {
        'kind': 'changes',
        'projectId': 'my-app-4f2a1c',
        'message': 'git is not available',
      });
    }
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

const _digits = [
  LogicalKeyboardKey.digit1,
  LogicalKeyboardKey.digit2,
  LogicalKeyboardKey.digit3,
  LogicalKeyboardKey.digit4,
  LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6,
  LogicalKeyboardKey.digit7,
];

/// `Alt+N`, one-based over `Surface.values`.
Future<void> pressAlt(WidgetTester tester, int digit) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
  await tester.sendKeyEvent(_digits[digit - 1]);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
  await tester.pumpAndSettle();
}

void main() {
  group('WorkDetailView changes', () {
    testWidgets('an available summary renders branch, counts and files', (
      tester,
    ) async {
      await pumpWork(
        tester,
        WorkDetailView(project: _detail, changes: _available),
      );

      expect(find.text('CHANGES'), findsOneWidget);
      expect(find.text('main'), findsOneWidget);
      expect(find.text('dirty'), findsOneWidget);
      expect(find.text('1 staged'), findsOneWidget);
      expect(find.text('1 unstaged'), findsOneWidget);
      expect(find.text('2 files'), findsOneWidget);

      expect(find.text('src/app.ts'), findsOneWidget);
      expect(find.text('docs/readme.md'), findsOneWidget);
      expect(find.text('modified'), findsOneWidget);
      expect(find.text('added'), findsOneWidget);
      expect(find.text('+12'), findsOneWidget);
      expect(find.text('-3'), findsOneWidget);
      expect(find.text('+40'), findsOneWidget);
      expect(find.text('unstaged'), findsOneWidget);
      expect(find.text('staged'), findsOneWidget);
      expect(
        find.text('read-only summary · writes are approved later'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('an unavailable summary is a muted sentence, not an error', (
      tester,
    ) async {
      await pumpWork(
        tester,
        WorkDetailView(project: _detail, changes: _unavailable),
      );

      expect(
        find.text(
          '“My app” is not a git repository, so there are no changes to show',
        ),
        findsOneWidget,
      );
      expect(find.text('reason · not a git repository'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsNothing);
      expect(find.text('Retry'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('g and r each ask for one refresh', (tester) async {
      var refreshes = 0;
      await pumpWork(
        tester,
        WorkDetailView(
          project: _detail,
          changes: _available,
          onRefreshChanges: () => refreshes++,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyG);
      await tester.pump();
      expect(refreshes, 1);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pump();
      expect(refreshes, 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('loading says reading changes… until the answer lands', (
      tester,
    ) async {
      await pumpWork(
        tester,
        const WorkDetailView(
          project: _detail,
          changesLoading: true,
          onRefreshChanges: _noop,
        ),
      );

      expect(find.text('reading changes…'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long file list scrolls inside 800x600', (tester) async {
      final many = ChangeSummary.fromJson({
        'available': true,
        'branch': 'main',
        'dirty': true,
        'staged': 0,
        'unstaged': 40,
        'files': [
          for (var index = 0; index < 40; index++)
            {
              'path': 'src/file-$index.dart',
              'status': 'modified',
              'added': index,
              'removed': 0,
              'staged': false,
              'unstaged': true,
            },
        ],
      });

      await pumpWork(
        tester,
        WorkDetailView(project: _detail, changes: many),
        size: const Size(800, 600),
      );

      expect(find.text('CHANGES'), findsOneWidget);
      expect(find.text('40 files'), findsOneWidget);
      expect(find.text('src/file-0.dart'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore work changes', () {
    test(
      'refreshWorkChanges reads work.changes once and projects it',
      () async {
        final core = FakeCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);

        expect(store.workChanges, isNull);
        final before = core.calls
            .where((call) => call == 'work.changes')
            .length;

        await store.refreshWorkChanges(FakeCore.projectId);

        expect(
          core.calls.where((call) => call == 'work.changes').length,
          before + 1,
        );
        final changes = store.workChanges;
        expect(changes, isNotNull);
        expect(changes!.available, isTrue);
        expect(changes.branch, 'main');
        expect(changes.detached, isFalse);
        expect(changes.dirty, isTrue);
        expect(changes.staged, 1);
        expect(changes.unstaged, 1);
        expect(changes.files, hasLength(2));
        expect(changes.files.first.path, 'src/app.ts');
        expect(changes.files.first.status, 'modified');
        expect(changes.files.first.added, 12);
        expect(changes.files.first.removed, 3);
        expect(changes.files.first.staged, isFalse);
        expect(changes.files.first.unstaged, isTrue);
        expect(changes.files.last.path, 'docs/readme.md');
        expect(changes.files.last.staged, isTrue);
        expect(store.workChangesLoading, isFalse);
        expect(store.workChangesError, isNull);
      },
    );

    testWidgets(
      'a failed refresh keeps the previous rows and shows the message',
      (tester) async {
        final core = _FlakyChangesCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();
        await store.openProject(FakeCore.projectId);
        await store.refreshWorkChanges(FakeCore.projectId);

        final previous = store.workChanges;
        expect(previous, isNotNull);
        expect(previous!.files, hasLength(2));

        core.failChanges = true;
        await store.refreshWorkChanges(FakeCore.projectId);

        expect(core.calls.where((call) => call == 'work.changes').length, 2);
        expect(store.workChanges, same(previous));
        expect(store.workChanges!.files, hasLength(2));
        expect(store.workChangesError, 'git is not available');
        expect(store.workChangesLoading, isFalse);

        await pumpWork(
          tester,
          WorkDetailView(
            project: _detail,
            changes: store.workChanges,
            changesError: store.workChangesError,
            onRefreshChanges: () {},
          ),
        );

        expect(find.text('src/app.ts'), findsOneWidget);
        expect(find.text('git is not available'), findsOneWidget);
        expect(find.text('Retry'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    test('an unavailable summary is parsed as a success', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.archivedProjectId);

      await store.refreshWorkChanges(FakeCore.archivedProjectId);

      expect(store.workChanges, isNotNull);
      expect(store.workChanges!.available, isFalse);
      expect(store.workChanges!.reason, 'missing folder');
      expect(store.workChanges!.message, isNotEmpty);
      expect(store.workChangesError, isNull);
    });

    test('closing a project clears the summary and its state', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openProject(FakeCore.projectId);
      await store.refreshWorkChanges(FakeCore.projectId);
      expect(store.workChanges, isNotNull);

      store.closeProject();

      expect(store.workChanges, isNull);
      expect(store.workChangesLoading, isFalse);
      expect(store.workChangesError, isNull);
    });

    test('Work models tolerate missing and malformed fields', () {
      final empty = ChangeSummary.fromJson(const <String, dynamic>{});
      expect(empty.available, isFalse);
      expect(empty.branch, '');
      expect(empty.dirty, isFalse);
      expect(empty.staged, 0);
      expect(empty.unstaged, 0);
      expect(empty.files, isEmpty);
      expect(empty.reason, '');
      expect(empty.message, '');

      final malformed = ChangeSummary.fromJson(const <String, dynamic>{
        'available': true,
        'files': [
          {'path': 'a.ts', 'added': 'seven', 'staged': 'yes'},
          'not-a-map',
        ],
      });
      expect(malformed.available, isTrue);
      expect(malformed.files, hasLength(1));
      expect(malformed.files.single.path, 'a.ts');
      expect(malformed.files.single.added, 0);
      expect(malformed.files.single.staged, isFalse);

      final absent = ChangeSummary.fromJson(null);
      expect(absent.available, isFalse);
    });
  });

  group('shell changes wiring', () {
    testWidgets('opening a project loads changes and closing clears them', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await pumpShell(tester, core: core);

      await pressAlt(tester, 6);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(core.calls, contains('work.changes'));
      expect(store.workChanges, isNotNull);
      expect(store.workChanges!.available, isTrue);
      expect(find.text('CHANGES'), findsOneWidget);
      expect(find.text('src/app.ts'), findsOneWidget);
      expect(find.text('PROJECT'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(store.activeProject, isNull);
      expect(store.workChanges, isNull);
      expect(find.text('WORK PROJECTS'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

void _noop() {}
