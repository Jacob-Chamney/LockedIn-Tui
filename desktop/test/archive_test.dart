import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/archive/archive_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// Two archived items, one per side of the wall: a school session and a skills
/// goal, with sizes far enough apart that the human readable label is testable.
List<ArchiveRow> archiveFixture() => [
  ArchiveRow.fromJson({
    'id': '2026-10-01-0900-chemistry-bonding',
    'side': 'school',
    'name': 'Chemistry — Bonding',
    'date': '2026-10-01T10:00:00Z',
    'sizeBytes': 18422,
    'backend': 'folder',
    'kind': 'session',
  }),
  ArchiveRow.fromJson({
    'id': 'read-disassembly-output-confidently-3f9a1c',
    'side': 'skills',
    'name': 'Read disassembly output confidently',
    'date': '2026-10-03T08:00:00Z',
    'sizeBytes': 2048,
    'backend': 'folder',
    'kind': 'goal',
  }),
];

Future<void> pumpArchive(
  WidgetTester tester, {
  List<ArchiveRow>? rows,
  bool loading = false,
  String? error,
  VoidCallback? onRefresh,
  VoidCallback? onBack,
  Size size = const Size(1280, 800),
  bool settle = true,
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
          loading: loading,
          error: error,
          onRefresh: onRefresh,
          onBack: onBack,
        ),
      ),
    ),
  );
  // A live spinner never settles, so the loading state pumps one frame.
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

void main() {
  testWidgets('restore and delete are buttons on the row', (tester) async {
    final restored = <String>[];
    final deleted = <String>[];
    final rows = [
      ArchiveRow.fromJson({
        'id': '2026-11-01-0900-physics',
        'side': 'school',
        'name': 'Physics — Unit 4',
        'date': '2026-11-01T10:00:00Z',
        'sizeBytes': 18422,
        'backend': 'folder',
        'kind': 'session',
      }),
    ];

    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        theme: lockedInTheme(),
        home: Scaffold(
          body: ArchivePage(
            rows: rows,
            loading: false,
            onRestore: (row) async => restored.add(row.id),
            onDelete: (row) async => deleted.add(row.id),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The buttons start the same confirmation flow the keys do; the page owns
    // it, so a tap opens the named confirm rather than acting at once.
    await tester.tap(find.byKey(ValueKey('archive-restore-${rows.first.id}')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Restore'), findsWidgets);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(ValueKey('archive-delete-${rows.first.id}')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Delete'), findsWidgets);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(restored, isEmpty);
    expect(deleted, isEmpty);
    expect(tester.takeException(), isNull);
  });

  test('ArchiveRow tolerates missing and mistyped fields', () {
    final row = ArchiveRow.fromJson({
      'id': 'kept',
      'side': 'SCHOOL',
      'name': null,
      'sizeBytes': '2048',
      'backend': 'FOLDER',
      'kind': 'session',
    });
    expect(row.id, 'kept');
    expect(row.side, 'school');
    expect(row.name, '');
    expect(row.displayName, 'kept');
    expect(row.sizeBytes, 2048);
    expect(row.backend, 'folder');
    expect(row.date, '');
    expect(row.kind, 'session');

    final broken = ArchiveRow.fromJson({
      'sizeBytes': 'not a number',
      'side': 7,
    });
    expect(broken.id, '');
    expect(broken.side, '');
    expect(broken.name, '');
    expect(broken.displayName, '');
    expect(broken.sizeBytes, 0);
    expect(broken.backend, '');
    expect(broken.kind, '');
  });

  testWidgets('rows group by side with counts, sizes and backends', (
    tester,
  ) async {
    await pumpArchive(tester, rows: archiveFixture());

    expect(find.text('ARCHIVE'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('archive-total')),
        matching: find.text('2'),
      ),
      findsOneWidget,
    );

    // One group per side, each with its own count.
    expect(find.text('SCHOOL'), findsOneWidget);
    expect(find.text('SKILLS'), findsOneWidget);
    for (final side in const ['school', 'skills']) {
      expect(
        find.descendant(
          of: find.byKey(ValueKey('archive-group-$side-count')),
          matching: find.text('1'),
        ),
        findsOneWidget,
      );
    }

    // Every row carries its name, kind, date, size and backend.
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(
      find.textContaining('2026-10-01 · 18.0 KB · folder'),
      findsOneWidget,
    );
    expect(find.text('Read disassembly output confidently'), findsOneWidget);
    expect(find.textContaining('2026-10-03 · 2.0 KB · folder'), findsOneWidget);
    expect(find.text('SESSION'), findsOneWidget);
    expect(find.text('GOAL'), findsOneWidget);

    // School is grouped above skills, whichever order the core listed.
    final schoolY = tester.getTopLeft(find.text('Chemistry — Bonding')).dy;
    final skillsY = tester
        .getTopLeft(find.text('Read disassembly output confidently'))
        .dy;
    expect(schoolY, lessThan(skillsY));

    // This page has no handlers, so it advertises no verb and no dead key.
    expect(find.text('read-only'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-restore-hint')), findsOneWidget);
    expect(find.text('Restore'), findsNothing);
    expect(find.text('Delete'), findsNothing);
    expect(find.byType(ElevatedButton), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty archive says what fills it', (tester) async {
    await pumpArchive(tester);

    expect(find.byKey(const ValueKey('archive-empty')), findsOneWidget);
    expect(find.text('nothing archived yet'), findsOneWidget);
    expect(
      find.text(
        'archive one from Sessions or Skills with `a`; it appears here',
      ),
      findsOneWidget,
    );
    expect(find.text('read-only'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-error')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed read keeps the rows and offers Retry', (tester) async {
    var refreshes = 0;
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      error:
          'github archive is not configured: set a repo and link a token in '
          'Settings',
      onRefresh: () => refreshes += 1,
    );

    expect(find.byKey(const ValueKey('archive-error')), findsOneWidget);
    expect(
      find.textContaining('github archive is not configured'),
      findsOneWidget,
    );
    // The previous rows are still on screen, not an empty archive.
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-empty')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('archive-retry')));
    await tester.pumpAndSettle();
    expect(refreshes, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r refreshes once and Esc goes back', (tester) async {
    var refreshes = 0;
    var backs = 0;
    await pumpArchive(
      tester,
      rows: archiveFixture(),
      onRefresh: () => refreshes += 1,
      onBack: () => backs += 1,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(refreshes, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(backs, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a first read with no rows shows the loading state', (
    tester,
  ) async {
    await pumpArchive(tester, loading: true, settle: false);

    expect(find.text('loading archive…'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-empty')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('long names ellipsize and the page fits 800x600', (tester) async {
    final rows = [
      ArchiveRow.fromJson({
        'id': 'long',
        'side': 'school',
        'name':
            'A very long archived session name that cannot possibly fit on one '
            'row of an 800 pixel wide window',
        'date': '2026-10-01T10:00:00Z',
        'sizeBytes': 18422,
        'backend': 'folder',
        'kind': 'session',
      }),
      ...archiveFixture(),
    ];
    await pumpArchive(tester, rows: rows, size: const Size(800, 600));

    expect(find.text('ARCHIVE'), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-list')), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The list scrolls instead of overflowing.
    await tester.drag(
      find.byKey(const ValueKey('archive-list')),
      const Offset(0, -160),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
