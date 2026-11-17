import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/archive/archive_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

/// The two archived items the fixture uses: one school session and one skills
/// goal. The folder backend restores and deletes either side.
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
  Future<void> Function(ArchiveRow row)? onDelete,
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
        body: _ArchiveHost(
          initialRows: rows ?? archiveFixture(),
          onRestore: onRestore,
          onDelete: onDelete,
          onRefresh: onRefresh,
          onBack: onBack,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// A page host that drops a row once its action succeeds, exactly like the shell
/// after `refreshArchive()` reports the item is gone.
class _ArchiveHost extends StatefulWidget {
  const _ArchiveHost({
    required this.initialRows,
    this.onRestore,
    this.onDelete,
    this.onRefresh,
    this.onBack,
  });

  final List<ArchiveRow> initialRows;
  final Future<void> Function(ArchiveRow row)? onRestore;
  final Future<void> Function(ArchiveRow row)? onDelete;
  final VoidCallback? onRefresh;
  final VoidCallback? onBack;

  @override
  State<_ArchiveHost> createState() => _ArchiveHostState();
}

class _ArchiveHostState extends State<_ArchiveHost> {
  late List<ArchiveRow> _rows = widget.initialRows;

  Future<void> _run(
    Future<void> Function(ArchiveRow row)? action,
    ArchiveRow row,
  ) async {
    if (action == null) return;
    await action(row);
    if (!mounted) return;
    setState(() => _rows = _rows.where((item) => item.id != row.id).toList());
  }

  @override
  Widget build(BuildContext context) {
    return ArchivePage(
      rows: _rows,
      onRefresh: widget.onRefresh,
      onBack: widget.onBack,
      onRestore: widget.onRestore == null
          ? null
          : (row) => _run(widget.onRestore, row),
      onDelete: widget.onDelete == null
          ? null
          : (row) => _run(widget.onDelete, row),
    );
  }
}

Future<void> confirmRestore(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('archive-restore-confirm')));
  await tester.pumpAndSettle();
}

Future<void> confirmDelete(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('archive-delete-confirm')));
  await tester.pumpAndSettle();
}

Future<void> pressShiftR(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pumpAndSettle();
}

int _calls(FakeCore core, String method) =>
    core.calls.where((call) => call == method).length;

void main() {
  testWidgets('skills: Enter restores the goal after the named confirmation', (
    tester,
  ) async {
    final calls = <ArchiveRow>[];
    await pumpArchive(
      tester,
      onRestore: (row) async => calls.add(row),
      onDelete: (row) async {},
    );

    // j moves from the school row to the skills goal.
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

    await confirmRestore(tester);
    expect(calls.length, 1);
    expect(calls.single.id, skillsArchiveId);
    expect(calls.single.side, 'skills');
    expect(find.text('restored “Read disassembly output”'), findsOneWidget);
    expect(find.text('Read disassembly output'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('skills: Cancel and Esc cancel the restore without a call', (
    tester,
  ) async {
    var calls = 0;
    var backs = 0;
    await pumpArchive(
      tester,
      onRestore: (row) async => calls += 1,
      onDelete: (row) async {},
      onBack: () => backs += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('archive-restore-cancel')));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Restore “Read disassembly output”?'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    // The dialog owns Esc; the page's back key is not reached.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(backs, 0);
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('d asks by name and deletes the archived school row', (
    tester,
  ) async {
    final calls = <ArchiveRow>[];
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) async => calls.add(row),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();

    expect(
      find.text('Delete “Chemistry — Bonding” from the archive?'),
      findsOneWidget,
    );
    expect(
      find.text('The archived copy goes; the live item is untouched.'),
      findsOneWidget,
    );
    expect(calls, isEmpty);

    await confirmDelete(tester);
    expect(calls.length, 1);
    expect(calls.single.id, schoolArchiveId);
    expect(calls.single.side, 'school');
    expect(
      find.text('deleted “Chemistry — Bonding” from the archive'),
      findsOneWidget,
    );
    expect(find.text('Chemistry — Bonding'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('d deletes a skills row too', (tester) async {
    final calls = <ArchiveRow>[];
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) async => calls.add(row),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    expect(
      find.text('Delete “Read disassembly output” from the archive?'),
      findsOneWidget,
    );

    await confirmDelete(tester);
    expect(calls.length, 1);
    expect(calls.single.id, skillsArchiveId);
    expect(calls.single.side, 'skills');
    expect(find.text('Read disassembly output'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('delete cancel is silent and keeps the row', (tester) async {
    var calls = 0;
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) async => calls += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('archive-delete-cancel')));
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.byKey(const ValueKey('archive-action-banner')), findsNothing);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);

    // Esc inside the dialog dismisses it without reaching the page's back key.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(calls, 0);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed delete keeps the row with the core message', (
    tester,
  ) async {
    const failure = 'the archived folder could not be deleted';
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) async => throw RpcException(-32000, failure, {
        'kind': 'archive',
        'id': row.id,
        'side': row.side,
        'message': failure,
      }),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    await confirmDelete(tester);

    expect(find.byKey(const ValueKey('archive-action-banner')), findsOneWidget);
    expect(find.text(failure), findsOneWidget);
    // The row is still there, and Retry asks for the same delete again.
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('archive-restore-retry')));
    await tester.pumpAndSettle();
    expect(
      find.text('Delete “Chemistry — Bonding” from the archive?'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the row reads deleting… while archive.remove is in flight', (
    tester,
  ) async {
    final gate = Completer<void>();
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) => gate.future,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('archive-delete-confirm')));
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const ValueKey('archive-deleting')), findsOneWidget);
    expect(find.text('deleting…'), findsOneWidget);

    gate.complete();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('archive-deleting')), findsNothing);
    expect(find.text('Chemistry — Bonding'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the footer names the real keys', (tester) async {
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) async {},
      onRefresh: () {},
    );

    expect(
      find.text('j/k move · Enter restore · d delete · r reload'),
      findsOneWidget,
    );
    // `r` is still the reload, never a verb.
    expect(find.text('Restore'), findsNothing);
    expect(find.text('Delete'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a page with no handlers advertises no verb', (tester) async {
    await pumpArchive(tester);

    expect(find.text('read-only'), findsOneWidget);
    expect(find.text('Restore'), findsNothing);
    expect(find.text('Delete'), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('archive-delete-confirm')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('restore and delete fit 800x600', (tester) async {
    await pumpArchive(
      tester,
      onRestore: (row) async {},
      onDelete: (row) async {},
      onRefresh: () {},
      size: const Size(800, 600),
    );

    expect(find.text('ARCHIVE'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-restore-hint')), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-list')), findsOneWidget);

    await tester.drag(
      find.byKey(const ValueKey('archive-list')),
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // The delete confirmation still fits the narrow window.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    expect(
      find.text('Delete “Chemistry — Bonding” from the archive?'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  test(
    'a failed skills delete keeps both rows and refreshes nothing',
    () async {
      const failure = 'the archived goal could not be deleted';
      final core = FakeCore(archiveRemoveFailure: failure);
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshArchive();

      expect(store.archiveRows.length, 2);
      await expectLater(
        store.removeArchive(id: skillsArchiveId, side: 'skills'),
        throwsA(
          isA<RpcException>().having(
            (error) => error.data,
            'data',
            containsPair('message', failure),
          ),
        ),
      );
      expect(core.archiveRemoves, isEmpty);
      expect(store.archiveRows.length, 2);
      expect(_calls(core, 'skill.list'), 0);
    },
  );

  test(
    'removeArchive calls archive.remove then re-reads the archive and skills',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshArchive();
      expect(store.archiveRows.length, 2);

      await store.removeArchive(id: skillsArchiveId, side: 'skills');

      expect(core.archiveRemoves.length, 1);
      expect(core.archiveRemoves.single['id'], skillsArchiveId);
      expect(core.archiveRemoves.single['side'], 'skills');
      // The archive is re-read and the goals list is refreshed; the live
      // session list is untouched by a skills delete (only boot read it).
      expect(_calls(core, 'archive.list'), 2);
      expect(_calls(core, 'skill.list'), 1);
      expect(_calls(core, 'session.list'), 1);
      expect(store.archiveRows.length, 1);
      expect(store.archiveRows.single.side, 'school');
      expect(store.skills.length, 3);
    },
  );

  test(
    'a school delete never turns the archived row into a live session',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshArchive();
      final liveBefore = store.sessions.map((row) => row.id).toList();
      final rowsBefore = core.sessionRows.length;

      await store.removeArchive(id: schoolArchiveId, side: 'school');

      expect(core.archiveRemoves.single['side'], 'school');
      expect(store.archiveRows.length, 1);
      expect(store.archiveRows.single.side, 'skills');
      // `archive.remove` deletes the archive copy only: no live session appears
      // and no live session disappears.
      expect(store.sessions.map((row) => row.id).toList(), liveBefore);
      expect(core.sessionRows.length, rowsBefore);
      expect(store.sessions.any((row) => row.id == schoolArchiveId), isFalse);
      // A school delete refreshes the school list it is already projecting.
      expect(_calls(core, 'session.list'), 2);
    },
  );

  test(
    'restoreArchive moves a goal back, refreshes skills and not sessions',
    () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.refreshArchive();

      await store.restoreArchive(id: skillsArchiveId, side: 'skills');

      expect(core.archiveRestores.length, 1);
      expect(core.archiveRestores.single['id'], skillsArchiveId);
      expect(core.archiveRestores.single['side'], 'skills');
      expect(_calls(core, 'archive.list'), 2);
      expect(_calls(core, 'skill.list'), 1);
      expect(_calls(core, 'session.list'), 1);
      expect(
        store.archiveRows.any((row) => row.id == skillsArchiveId),
        isFalse,
      );
      expect(store.skills.length, 3);
      // A goal is not a session: the live session list is untouched.
      expect(store.sessions.any((row) => row.id == skillsArchiveId), isFalse);
      expect(
        core.sessionRows.any((row) => row['id'] == skillsArchiveId),
        isFalse,
      );
    },
  );

  test('a failed removeArchive rethrows and keeps every row', () async {
    const failure = 'there is no archived session "gone" on the school side';
    final core = FakeCore(archiveRemoveFailure: failure);
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.refreshArchive();

    await expectLater(
      store.removeArchive(id: schoolArchiveId, side: 'school'),
      throwsA(
        isA<RpcException>().having(
          (error) => error.message,
          'message',
          failure,
        ),
      ),
    );

    expect(core.archiveRemoves, isEmpty);
    expect(store.archiveRows.length, 2);
    expect(_calls(core, 'archive.list'), 1);
  });
}
