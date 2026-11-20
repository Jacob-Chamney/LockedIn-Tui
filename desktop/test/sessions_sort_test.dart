import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// Three rows whose date, name and size orders are all different, so one cycle
/// of `o` proves which order is active:
///
/// * date ↓ — Anatomy (11-10), Zoology (11-01), Botany (10-20)
/// * date ↑ — Botany, Zoology, Anatomy
/// * name A–Z — Anatomy, Botany, Zoology
/// * sources ↓ — Zoology (7 sources), Anatomy (5), Botany (1)
const _sessions = <SessionRow>[
  SessionRow(
    id: 'alpha',
    name: 'Zoology',
    date: '2026-11-01T14:30:00Z',
    sources: 7,
    stepsDone: 1,
    stepsTotal: 4,
    archived: false,
  ),
  SessionRow(
    id: 'beta',
    name: 'Anatomy',
    date: '2026-11-10T09:05:00Z',
    sources: 5,
    stepsDone: 0,
    stepsTotal: 2,
    archived: false,
  ),
  SessionRow(
    id: 'gamma',
    name: 'Botany',
    date: '2026-10-20',
    sources: 1,
    stepsDone: 3,
    stepsTotal: 3,
    archived: true,
  ),
];

Future<void> pumpSessions(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(800, 600),
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

Future<void> pressO(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.keyO);
  await tester.pumpAndSettle();
}

/// Asserts the rows appear top to bottom in [names], independent of which one is
/// selected: a sort changes positions, not labels.
void expectOrder(WidgetTester tester, List<String> names) {
  var previous = double.negativeInfinity;
  for (final name in names) {
    final y = tester.getTopLeft(find.text(name)).dy;
    expect(
      y,
      greaterThan(previous),
      reason: '$name should be below the row that precedes it in $names',
    );
    previous = y;
  }
}

/// The selected row's name, read from the row that carries the selection key.
String selectedName(WidgetTester tester) {
  final names = tester
      .widgetList<Text>(
        find.descendant(
          of: find.byKey(const ValueKey('session-row-selected')),
          matching: find.byType(Text),
        ),
      )
      .map((text) => text.data ?? '')
      .where((data) => ['Zoology', 'Anatomy', 'Botany'].contains(data));
  expect(names, hasLength(1));
  return names.single;
}

void main() {
  testWidgets('o cycles all four orders and the header shows the current one', (
    tester,
  ) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    expect(find.text('sort · date ↓'), findsOneWidget);
    expect(
      find.text('↑↓ move · Enter open · o sort · n new · / search'),
      findsOneWidget,
    );

    for (final label in ['date ↑', 'name A–Z', 'sources ↓', 'date ↓']) {
      await pressO(tester);
      expect(find.text('sort · $label'), findsOneWidget);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('date, name and size each order the three rows', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    // The default is newest first.
    expectOrder(tester, ['Anatomy', 'Zoology', 'Botany']);

    await pressO(tester);
    expect(find.text('sort · date ↑'), findsOneWidget);
    expectOrder(tester, ['Botany', 'Zoology', 'Anatomy']);

    await pressO(tester);
    expect(find.text('sort · name A–Z'), findsOneWidget);
    expectOrder(tester, ['Anatomy', 'Botany', 'Zoology']);

    await pressO(tester);
    expect(find.text('sort · sources ↓'), findsOneWidget);
    // The size proxy is source count first, largest first.
    expectOrder(tester, ['Zoology', 'Anatomy', 'Botany']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the selection follows the row id across a re-sort', (
    tester,
  ) async {
    SessionRow? opened;
    await pumpSessions(
      tester,
      SessionsPage(
        sessions: _sessions,
        loading: false,
        onOpen: (row) => opened = row,
      ),
    );

    // Default date ↓: Anatomy, Zoology, Botany. Move to Zoology.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(selectedName(tester), 'Zoology');

    // date ↑ puts Zoology in the middle instead of second: the id stays.
    await pressO(tester);
    expect(find.text('sort · date ↑'), findsOneWidget);
    expect(selectedName(tester), 'Zoology');

    // name A–Z moves it to the end; the selection still follows it.
    await pressO(tester);
    expect(find.text('sort · name A–Z'), findsOneWidget);
    expect(selectedName(tester), 'Zoology');
    expectOrder(tester, ['Anatomy', 'Botany', 'Zoology']);

    // Enter opens the row the re-sort kept selected, not the old position.
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(opened?.id, 'alpha');
    expect(opened?.name, 'Zoology');

    // sources ↓ leads with Zoology now, and Enter still opens the same session.
    await pressO(tester);
    expect(find.text('sort · sources ↓'), findsOneWidget);
    expect(selectedName(tester), 'Zoology');
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(opened?.id, 'alpha');
    expect(tester.takeException(), isNull);
  });

  testWidgets('search filtering still applies under a non-default order', (
    tester,
  ) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    // name A–Z, then filter to the two names that contain an "a".
    await pressO(tester);
    await pressO(tester);
    expect(find.text('sort · name A–Z'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('sessions-search')), 'a');
    await tester.pumpAndSettle();

    expect(find.text('Zoology'), findsNothing);
    expect(find.text('2 of 3'), findsOneWidget);
    expectOrder(tester, ['Anatomy', 'Botany']);

    // Clearing the filter restores all three in the same active order.
    await tester.enterText(find.byKey(const ValueKey('sessions-search')), '');
    await tester.pumpAndSettle();
    expectOrder(tester, ['Anatomy', 'Botany', 'Zoology']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('o is text while the search field has focus', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
    );

    await tester.enterText(
      find.byKey(const ValueKey('sessions-search')),
      'logy',
    );
    await tester.pumpAndSettle();
    expect(find.text('1 of 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyO);
    await tester.pumpAndSettle();

    // The order did not change: `o` belonged to the focused field.
    expect(find.text('sort · date ↓'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sorted manager fits 800x600', (tester) async {
    await pumpSessions(
      tester,
      const SessionsPage(sessions: _sessions, loading: false),
      size: const Size(800, 600),
    );

    for (var press = 0; press < 4; press++) {
      await pressO(tester);
    }

    expect(find.text('sort · date ↓'), findsOneWidget);
    expect(find.text('Zoology'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
