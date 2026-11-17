import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _sessions = <SessionRow>[
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
  SessionRow(
    id: 'history-cold-war',
    name: 'History — Cold War',
    date: '2026-10-02',
    sources: 12,
    stepsDone: 6,
    stepsTotal: 6,
    archived: false,
    broken: 'missing sources/lecture.pdf',
  ),
];

Future<void> pumpSessions(
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
  await tester.pump();
}

void main() {
  testWidgets('renders the header, rows, counts and badges', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    expect(find.text('LOCK-IN SESSIONS'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(find.text('History — Cold War'), findsOneWidget);

    // Date column shows only the day part of the stored timestamp.
    expect(find.text('2026-11-01'), findsOneWidget);
    expect(find.text('2026-10-24'), findsOneWidget);
    expect(find.text('2026-10-02'), findsOneWidget);

    expect(find.text('3 src'), findsOneWidget);
    expect(find.text('12 src'), findsOneWidget);
    expect(find.text('4/8 steps'), findsOneWidget);
    expect(find.text('no steps'), findsOneWidget);
    expect(find.text('6/6 steps'), findsOneWidget);
    expect(find.text('archived'), findsOneWidget);
    expect(find.text('missing sources/lecture.pdf'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('search filters the list by name', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    await tester.enterText(
      find.byKey(const ValueKey('sessions-search')),
      'chem',
    );
    await tester.pump();

    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(find.text('Physics — Unit 4'), findsNothing);
    expect(find.text('History — Cold War'), findsNothing);
    expect(find.text('1 of 3'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('sessions-search')),
      'zzz',
    );
    await tester.pump();

    expect(find.text('no sessions match “zzz”'), findsOneWidget);
    expect(find.text('Esc clears the search'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('sessions-search')), '');
    await tester.pump();

    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty state teaches the next action', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: <SessionRow>[], loading: false),
    );

    expect(find.text('no sessions yet'), findsOneWidget);
    expect(find.text('n starts a new lock-in'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('loading state is stated, not a blank screen', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: <SessionRow>[], loading: true),
    );

    expect(find.text('loading sessions…'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('error state names the failure and retries', (tester) async {
    var retries = 0;
    await pumpSessions(
      tester,
      SessionsPage(
        sessions: const <SessionRow>[],
        loading: false,
        error: 'could not read the workspace sessions folder',
        onRefresh: () => retries++,
      ),
    );

    expect(
      find.text('could not read the workspace sessions folder'),
      findsOneWidget,
    );
    expect(find.text('Retry'), findsOneWidget);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(retries, 1);
    expect(tester.takeException(), isNull);

    // Without a refresh callback there is nothing to retry.
    await pumpSessions(
      tester,
      const SessionsPage(
        sessions: <SessionRow>[],
        loading: false,
        error: 'could not read the workspace sessions folder',
      ),
    );

    expect(find.text('Retry'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('error banner sits above an existing list', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(
        sessions: _sessions,
        loading: false,
        error: 'refresh failed — showing the last snapshot',
      ),
    );

    expect(
      find.text('refresh failed — showing the last snapshot'),
      findsOneWidget,
    );
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('arrow keys move the selected row', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('session-row-selected')),
        matching: find.text('Physics — Unit 4'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('session-row-selected')),
        matching: find.text('Chemistry — Bonding'),
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(const ValueKey('session-row-selected')),
        matching: find.text('Physics — Unit 4'),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('lays out at 800x600 without overflow', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
      width: 800,
      height: 600,
    );

    expect(find.text('2026-11-01'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('below 700 wide the date column is dropped, not clipped', (
    tester,
  ) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
      width: 640,
      height: 600,
    );

    expect(find.text('2026-11-01'), findsNothing);
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('4/8 steps'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
