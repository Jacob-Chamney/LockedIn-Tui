import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/archive/archive_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The two archived items the fixture uses: one school session that this build
/// can restore and one skills goal that it refuses by name.
const schoolArchiveId = '2026-10-01-0900-chemistry-bonding';
const skillsArchiveId = 'read-disassembly-output-confidently-3f9a1c';

List<ArchiveRow> archiveFixture() => [
  ArchiveRow.fromJson({
    'id': schoolArchiveId,
    'side': 'school',
    'name': 'Chemistry — Bonding',
    'date': '2026-10-01T10:00:00Z',
    'sizeBytes': 18422,
    'backend': 'folder',
    'kind': 'session',
  }),
  ArchiveRow.fromJson({
    'id': skillsArchiveId,
    'side': 'skills',
    'name': 'Read disassembly output',
    'date': '2026-10-03T08:00:00Z',
    'sizeBytes': 2048,
    'backend': 'folder',
    'kind': 'goal',
  }),
];

Future<void> pumpArchive(
  WidgetTester tester, {
  List<ArchiveRow>? rows,
  Future<void> Function(ArchiveRow row)? onRestore,
  VoidCallback? onRefresh,
  VoidCallback? onBack,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: ArchivePage(
          rows: rows ?? const <ArchiveRow>[],
          onRefresh: onRefresh,
          onBack: onBack,
          onRestore: onRestore,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> pressShiftR(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pumpAndSettle();
}

Future<void> confirmRestore(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('archive-restore-confirm')));
  await tester.pumpAndSettle();
}

Future<void> pumpShell(
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

int _calls(FakeCore core, String method) =>
    core.calls.where((call) => call == method).length;

void main() {
  testWidgets('Enter opens the named restore confirmation and confirms once', (
    tester,
  ) async {
    final calls = <ArchiveRow>[];
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      onRestore: (row) async => calls.add(row),
    );

    // The first row is selected by default and the read-only verbs are offered.
    expect(find.byKey(const ValueKey('archive-restore-hint')), findsOneWidget);
    expect(find.text('Restore'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('Restore “Chemistry — Bonding”?'), findsOneWidget);
    expect(
      find.text('The archived copy moves back; chat history was not archived.'),
      findsOneWidget,
    );
    expect(calls, isEmpty);

    await confirmRestore(tester);
    expect(calls.length, 1);
    expect(calls.single.id, schoolArchiveId);
    expect(find.text('restored “Chemistry — Bonding”'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Cancel and Esc cancel the restore without a call', (
    tester,
  ) async {
    var calls = 0;
    var backs = 0;
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      onRestore: (row) async => calls += 1,
      onBack: () => backs += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('archive-restore-cancel')));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Restore “Chemistry — Bonding”?'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    // The dialog owns Esc; the page's back key is not reached.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(backs, 0);
    expect(find.text('Restore “Chemistry — Bonding”?'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('j/k move the selection, R restores and r reloads', (
    tester,
  ) async {
    final calls = <ArchiveRow>[];
    var refreshes = 0;
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      onRestore: (row) async => calls.add(row),
      onRefresh: () => refreshes += 1,
    );

    // j moves to the skills row: restore is offered there too, and its named
    // confirmation says what a goal restore brings back.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Restore “Read disassembly output”?'), findsOneWidget);
    expect(
      find.text(
        "The goal's curriculum and sources come back; chats were not archived.",
      ),
      findsOneWidget,
    );
    expect(calls, isEmpty);
    await tester.tap(find.byKey(const ValueKey('archive-restore-cancel')));
    await tester.pumpAndSettle();

    // k moves back to the school row, where `R` restores it.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pumpAndSettle();
    await pressShiftR(tester);
    expect(find.text('Restore “Chemistry — Bonding”?'), findsOneWidget);
    await confirmRestore(tester);
    expect(calls.length, 1);
    expect(calls.single.id, schoolArchiveId);

    // Plain `r` is still the reload, never the restore.
    refreshes = 0;
    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(refreshes, 1);
    expect(calls.length, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a skills row restores through the same named confirmation', (
    tester,
  ) async {
    final calls = <ArchiveRow>[];
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      onRestore: (row) async => calls.add(row),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('Restore “Read disassembly output”?'), findsOneWidget);
    expect(calls, isEmpty);
    await tester.tap(find.byKey(const ValueKey('archive-restore-confirm')));
    await tester.pumpAndSettle();

    expect(calls.length, 1);
    expect(calls.single.id, skillsArchiveId);
    expect(calls.single.side, 'skills');
    expect(find.text('restored “Read disassembly output”'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test(
    'archive.restore calls the core once and refreshes both lists',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshArchive();
      expect(store.archiveRows.length, 2);
      final sessionsBefore = store.sessions.length;
      final archiveReads = _calls(core, 'archive.list');
      final sessionReads = _calls(core, 'session.list');

      await store.restoreArchive(id: schoolArchiveId, side: 'school');

      expect(core.archiveRestores.length, 1);
      expect(core.archiveRestores.single['id'], schoolArchiveId);
      expect(core.archiveRestores.single['side'], 'school');
      // One successful restore re-reads both lists exactly once.
      expect(_calls(core, 'archive.list'), archiveReads + 1);
      expect(_calls(core, 'session.list'), sessionReads + 1);
      expect(store.archiveRows.length, 1);
      expect(store.archiveRows.single.side, 'skills');
      expect(store.sessions.length, sessionsBefore + 1);
      expect(store.sessions.any((row) => row.id == schoolArchiveId), isTrue);
    },
  );

  test(
    'a failed restore keeps every row and throws the core message',
    () async {
      const failure = 'could not move the archived copy';
      final core = FakeCore(archiveRestoreFailure: failure);
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshArchive();
      final sessionsBefore = store.sessions.length;

      await expectLater(
        store.restoreArchive(id: schoolArchiveId, side: 'school'),
        throwsA(
          isA<RpcException>().having(
            (error) => error.data,
            'data',
            containsPair('message', failure),
          ),
        ),
      );

      expect(core.archiveRestores, isEmpty);
      expect(store.archiveRows.length, 2);
      expect(store.sessions.length, sessionsBefore);
      expect(
        core.sessionRows.any((row) => row['id'] == schoolArchiveId),
        isFalse,
      );
    },
  );

  test('a goal restore moves the row back without a live session row', () async {
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.refreshArchive();
    expect(store.archiveRows.length, 2);
    final archiveReads = _calls(core, 'archive.list');
    final skillReads = _calls(core, 'skill.list');
    final sessionReads = _calls(core, 'session.list');

    await store.restoreArchive(id: skillsArchiveId, side: 'skills');

    expect(core.archiveRestores.length, 1);
    expect(core.archiveRestores.single['id'], skillsArchiveId);
    expect(core.archiveRestores.single['side'], 'skills');
    // The archive is re-read and the goals list is refreshed; a goal is never a
    // live session, so `session.list` is only the boot read.
    expect(_calls(core, 'archive.list'), archiveReads + 1);
    expect(_calls(core, 'skill.list'), skillReads + 1);
    expect(_calls(core, 'session.list'), sessionReads);
    expect(store.archiveRows.any((row) => row.id == skillsArchiveId), isFalse);
    expect(
      core.sessionRows.any((row) => row['id'] == skillsArchiveId),
      isFalse,
    );
  });

  testWidgets('the shell restores a school row and both lists follow', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 8);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await confirmRestore(tester);

    expect(core.archiveRestores.length, 1);
    expect(_calls(core, 'archive.restore'), 1);
    // The row leaves the archive list after the refresh.
    expect(find.text('Chemistry — Bonding'), findsNothing);
    expect(find.text('Read disassembly output'), findsOneWidget);

    // It is live again, so the Sessions surface reports it.
    await openSurface(tester, 2);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the restorable surface fits 800x600', (tester) async {
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      onRestore: (row) async {},
      size: const Size(800, 600),
    );

    expect(find.text('ARCHIVE'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-restore-hint')), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-list')), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.drag(
      find.byKey(const ValueKey('archive-list')),
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // The confirmation still fits the narrow window.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Restore “Chemistry — Bonding”?'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
