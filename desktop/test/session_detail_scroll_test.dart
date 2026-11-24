import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:material_ui/material_ui.dart';

/// A long instructions card pushes the cards below it past the fold. Those cards
/// must stay reachable with the keyboard alone — no action may need a mouse.
SessionDetail _detail({required String prompt}) => SessionDetail(
  id: '2026-11-15-1030-physics',
  name: 'Physics — Unit 4',
  created: '2026-11-15T10:30:00.000Z',
  archived: false,
  prompt: prompt,
  sources: const [],
  steps: const SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
  memory: const SessionMemory(
    points: ['Boundary conditions set the limits'],
    folded: [],
    updated: '2026-11-15T11:00:00.000Z',
  ),
);

final _longPrompt = List.generate(
  40,
  (index) => 'Paragraph $index of a long assignment briefing that wraps.',
).join('\n\n');

Future<void> _pump(WidgetTester tester, SessionDetail detail) async {
  tester.view.physicalSize = const Size(1280, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SessionDetailView(
          detail: detail,
          loading: false,
          onBack: () {},
          onOpenChat: () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// The page's own scroll, by key: the step list beside it is a second
/// Scrollable on a wide window.
ScrollPosition _position(WidgetTester tester) => tester
    .state<ScrollableState>(
      find.descendant(
        of: find.byKey(SessionDetailView.pageScrollKey),
        matching: find.byType(Scrollable),
      ),
    )
    .position;

void main() {
  testWidgets('Page Down scrolls a long prompt towards the cards below', (
    tester,
  ) async {
    await _pump(tester, _detail(prompt: _longPrompt));

    final before = _position(tester);
    expect(before.maxScrollExtent, greaterThan(0));

    await tester.sendKeyEvent(LogicalKeyboardKey.pageDown);
    await tester.pumpAndSettle();

    expect(_position(tester).pixels, greaterThan(0));
    expect(tester.takeException(), isNull);
  });

  testWidgets('End reaches the bottom and Home returns to the top', (
    tester,
  ) async {
    await _pump(tester, _detail(prompt: _longPrompt));

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    final bottom = _position(tester);
    expect(bottom.pixels, bottom.maxScrollExtent);
    // The memory card lives at the bottom of the page.
    expect(find.text('session memory · not a source'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    expect(_position(tester).pixels, 0);
    expect(find.text('INSTRUCTIONS'), findsOneWidget);
  });

  testWidgets('Ctrl+U scrolls back a page', (tester) async {
    await _pump(tester, _detail(prompt: _longPrompt));

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    final atBottom = _position(tester).pixels;

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyU);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(_position(tester).pixels, lessThan(atBottom));
  });

  testWidgets('Page Down clamps at the end instead of overscrolling', (
    tester,
  ) async {
    await _pump(tester, _detail(prompt: 'Read chapter 4.'));

    for (var press = 0; press < 10; press++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.pageDown);
      await tester.pumpAndSettle();
    }

    final position = _position(tester);
    expect(position.pixels, position.maxScrollExtent);
    expect(tester.takeException(), isNull);
  });
}
