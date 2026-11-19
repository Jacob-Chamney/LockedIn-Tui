import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/work/activity_page.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The four records the fake serves, parsed through the same model the store
/// uses.
final _list = ActivityListResult.fromJson(<String, dynamic>{
  'records': FakeCore.activityRows,
  'skipped': FakeCore.activitySkipped,
  'empty': false,
});

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

/// A fake whose `activity.list` can start failing after a successful read, so a
/// test can prove the previous rows survive one failed refresh of the same
/// query.
class _FlakyActivityCore extends FakeCore {
  bool failActivity = false;

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    if (method == 'activity.list' && failActivity) {
      calls.add(method);
      throw const RpcException(-32000, 'the activity log could not be read', {
        'kind': 'activity',
        'message': 'the activity log could not be read',
      });
    }
    return super.call(method, params);
  }
}

Future<void> pumpPage(
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

/// Open Work, open the first project, then open its activity log with `l`.
Future<void> openLog(WidgetTester tester) async {
  await openSurface(tester, 6);
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pumpAndSettle();
  await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a click expands a record and a second click collapses it', (
    tester,
  ) async {
    await pumpPage(
      tester,
      ActivityPage(
        records: _list.records,
        skipped: _list.skipped,
        empty: _list.empty,
        project: FakeCore.projectId,
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('activity-expanded-0')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('activity-row-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('activity-expanded-0')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('activity-row-0')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('activity-expanded-0')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  group('ActivityPage', () {
    testWidgets('rows render kind, path or argv, decision and time', (
      tester,
    ) async {
      await pumpPage(
        tester,
        ActivityPage(
          records: _list.records,
          skipped: _list.skipped,
          empty: _list.empty,
          project: FakeCore.projectId,
        ),
      );

      // Header: the title, the count and the skipped note (a note, not an
      // error).
      expect(find.text('ACTIVITY'), findsOneWidget);
      expect(find.text('4 records'), findsOneWidget);
      expect(find.text('skipped 1 unreadable line(s)'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsNothing);

      // One tag per kind; two swarm records share the tag.
      expect(find.text('write'), findsOneWidget);
      expect(find.text('command'), findsOneWidget);
      expect(find.text('swarm'), findsNWidgets(2));

      // The subject: the relative path for a write, the argv for a command.
      expect(find.text('notes.md'), findsOneWidget);
      expect(find.text('printf ok'), findsOneWidget);
      expect(find.text('run-7c1a'), findsNWidgets(2));

      // The project and the decision word on every row. The log stores the
      // stable project id, never a display name re-derived by the shell.
      expect(find.text(FakeCore.projectId), findsNWidgets(4));
      expect(find.text('approve'), findsOneWidget);
      expect(find.text('deny'), findsOneWidget);
      expect(find.text('started'), findsOneWidget);
      expect(find.text('finished'), findsOneWidget);

      // The time, shortened without re-deriving a timezone.
      expect(find.text('11-15 10:01'), findsOneWidget);
      expect(find.text('11-15 10:04'), findsOneWidget);

      // The honest limit of the surface.
      expect(
        find.text('metadata only · no file bodies, no prompts, no output'),
        findsOneWidget,
      );
      expect(find.text('project · ${FakeCore.projectId}'), findsOneWidget);
      expect(find.text('kind · all'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('s cycles the kind filter all → write → command → swarm', (
      tester,
    ) async {
      final kinds = <String?>[];
      String? kind;
      await pumpPage(
        tester,
        StatefulBuilder(
          builder: (context, setLocal) => ActivityPage(
            records: _list.records,
            skipped: _list.skipped,
            kind: kind,
            onKind: (next) {
              kinds.add(next);
              setLocal(() => kind = next);
            },
          ),
        ),
      );

      for (var press = 0; press < 4; press++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
        await tester.pump();
      }

      expect(kinds, ['write-decision', 'command-decision', 'swarm', null]);
      // The page asks the shell; it never filters the rows itself.
      expect(kind, isNull);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a filtered page names its filter and its empty state', (
      tester,
    ) async {
      await pumpPage(
        tester,
        const ActivityPage(
          records: [],
          kind: 'swarm',
          project: FakeCore.projectId,
        ),
      );

      expect(find.text('kind · swarm'), findsOneWidget);
      expect(
        find.text(
          'no swarm records for this project · s cycles the kind filter',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('an empty log says what fills it', (tester) async {
      await pumpPage(tester, const ActivityPage(records: [], empty: true));

      expect(
        find.text(
          'no decisions recorded yet · approve or deny a Work change to '
          'fill this',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a read failure is one message with Retry', (tester) async {
      var refreshes = 0;
      await pumpPage(
        tester,
        ActivityPage(
          records: const [],
          error: 'the activity log could not be read',
          onRefresh: () => refreshes++,
        ),
      );

      expect(find.text('the activity log could not be read'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
      await tester.pump();
      expect(refreshes, 1);

      await tester.tap(find.text('Retry'));
      await tester.pump();
      expect(refreshes, 2);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the log fits 800x600 and a narrow window', (tester) async {
      for (final size in const [Size(800, 600), Size(420, 600)]) {
        await pumpPage(
          tester,
          ActivityPage(
            records: _list.records,
            skipped: _list.skipped,
            project: FakeCore.projectId,
          ),
          size: size,
        );
        expect(find.text('notes.md'), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    });
  });

  group('WorkDetailView activity card', () {
    testWidgets('the card shows the count and l opens the log', (tester) async {
      var opened = 0;
      await pumpPage(
        tester,
        WorkDetailView(
          project: _detail,
          activityCount: 4,
          onOpenActivity: () => opened++,
        ),
        size: const Size(1200, 1800),
      );

      expect(find.text('ACTIVITY'), findsOneWidget);
      expect(find.text('4 records'), findsOneWidget);
      expect(find.text('l opens the log'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
      await tester.pump();
      expect(opened, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('without a callback the card is read-only and drops l', (
      tester,
    ) async {
      await pumpPage(
        tester,
        const WorkDetailView(project: _detail, activityCount: 2),
        size: const Size(1200, 1800),
      );

      expect(find.text('2 records'), findsOneWidget);
      expect(find.text('l opens the log'), findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore activity', () {
    test(
      'refreshActivity sends project and kind and keeps the rows on failure',
      () async {
        final core = _FlakyActivityCore();
        final store = CoreStore(connection: core);
        addTearDown(store.dispose);
        await store.start();

        await store.refreshActivity(project: FakeCore.projectId);
        expect(store.activityError, isNull);
        expect(store.activityRecords, hasLength(4));
        expect(store.activitySkipped, 1);
        expect(store.activityEmpty, isFalse);
        expect(core.activityQueries.last, {'project': FakeCore.projectId});

        await store.refreshActivity(
          kind: 'write-decision',
          project: FakeCore.projectId,
        );
        expect(store.activityKind, 'write-decision');
        expect(store.activityRecords, hasLength(1));
        expect(store.activityRecords.single.path, 'notes.md');
        expect(core.activityQueries.last, {
          'kind': 'write-decision',
          'project': FakeCore.projectId,
        });

        core.failActivity = true;
        await store.refreshActivity(
          kind: 'write-decision',
          project: FakeCore.projectId,
        );
        expect(store.activityError, 'the activity log could not be read');
        // The same query keeps the rows it already had.
        expect(store.activityRecords, hasLength(1));

        core.failActivity = false;
        await store.refreshActivity(
          kind: 'write-decision',
          project: FakeCore.projectId,
        );
        expect(store.activityError, isNull);
        expect(store.activityRecords, hasLength(1));
      },
    );

    test('an empty log is a success with its own state', () async {
      final store = CoreStore(connection: FakeCore(activityEmpty: true));
      addTearDown(store.dispose);
      await store.start();

      await store.refreshActivity(project: FakeCore.projectId);

      expect(store.activityError, isNull);
      expect(store.activityRecords, isEmpty);
      expect(store.activitySkipped, 0);
      expect(store.activityEmpty, isTrue);
    });

    test('a kind filter is answered by the core, not re-derived', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.refreshActivity(kind: 'swarm', project: FakeCore.projectId);

      expect(store.activityRecords, hasLength(2));
      expect(
        store.activityRecords.every((record) => record.kind == 'swarm'),
        isTrue,
      );
      expect(core.activityQueries.last, {
        'kind': 'swarm',
        'project': FakeCore.projectId,
      });
    });
  });

  group('Shell activity layer', () {
    testWidgets('l opens the log with the active project id and Esc returns', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await pumpShell(tester, core: core);

      await openLog(tester);

      // The status bar names the layer and the log renders its rows.
      expect(find.text('ACTIVITY'), findsWidgets);
      expect(find.text('notes.md'), findsOneWidget);
      expect(find.text('printf ok'), findsOneWidget);
      expect(store.activityProject, FakeCore.projectId);
      expect(core.activityQueries.last, {'project': FakeCore.projectId});
      // The last read is the log's own, so `l` re-reads for the open project.
      expect(core.activityQueries.length, greaterThan(1));

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      // Back on the project detail: the log's own note and rows are gone.
      // (The detail has an ACTIVITY card and a pending `notes.md` write, so
      // neither the title nor that path is the test.)
      expect(
        find.text('metadata only · no file bodies, no prompts, no output'),
        findsNothing,
      );
      expect(find.text('PROJECT'), findsOneWidget);
      expect(find.text('ROOT'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('s cycles the kind filter and re-reads with the new kind', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await pumpShell(tester, core: core);
      await openLog(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
      expect(store.activityKind, 'write-decision');
      expect(core.activityQueries.last, {
        'kind': 'write-decision',
        'project': FakeCore.projectId,
      });
      expect(find.text('notes.md'), findsOneWidget);
      expect(find.text('printf ok'), findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
      expect(store.activityKind, 'command-decision');
      expect(core.activityQueries.last, {
        'kind': 'command-decision',
        'project': FakeCore.projectId,
      });
      expect(find.text('printf ok'), findsOneWidget);
      expect(find.text('notes.md'), findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.pumpAndSettle();
      expect(store.activityKind, 'swarm');
      expect(core.activityQueries.last, {
        'kind': 'swarm',
        'project': FakeCore.projectId,
      });
      expect(find.text('run-7c1a'), findsWidgets);
      expect(find.text('notes.md'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('switching surfaces collapses the log', (tester) async {
      await pumpShell(tester);
      await openLog(tester);
      expect(find.text('ACTIVITY'), findsWidgets);

      await openSurface(tester, 1);
      await openSurface(tester, 6);

      expect(find.text('PROJECT'), findsOneWidget);
      expect(
        find.text('metadata only · no file bodies, no prompts, no output'),
        findsNothing,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('the project detail fits 800x600 and the log opens there', (
      tester,
    ) async {
      await pumpShell(tester, size: const Size(800, 600));
      await openLog(tester);

      expect(find.text('ACTIVITY'), findsWidgets);
      expect(find.text('notes.md'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
