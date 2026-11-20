import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

Finder inPalette(String text) =>
    find.descendant(of: find.byType(CommandPalette), matching: find.text(text));

Finder rowOfText(String text) => find.ancestor(
  of: inPalette(text),
  matching: find.byKey(const ValueKey('palette-selected')),
);

void main() {
  testWidgets('every registry row shows its own chord', (tester) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    // The palette is where a keyboard user learns a binding, so a row that is
    // a registry action carries the chord that runs it.
    expect(
      tester
          .widget<Text>(
            find.byKey(const ValueKey('palette-binding-surface.sessions')),
          )
          .data,
      'Space h',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('palette-binding-sidebar')))
          .data,
      'Space e',
    );
    expect(
      tester
          .widget<Text>(find.byKey(const ValueKey('palette-binding-commands')))
          .data,
      ':',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K opens the palette over Chat with every action', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    expect(find.byType(CommandPalette), findsOneWidget);
    for (final label in const [
      'Chat',
      'Sessions',
      'Skills',
      'Sources',
      'Stats',
      'Work',
      'Review',
      'Archive',
      'Knowledge',
      'Settings',
      'refresh',
      'retry',
      'close',
    ]) {
      expect(inPalette(label), findsOneWidget, reason: 'missing row: $label');
    }
    expect(find.text('↑↓ move · Enter run · Esc close'), findsOneWidget);
    expect(inPalette('Chat'), findsOneWidget);
    expect(rowOfText('Chat'), findsOneWidget);
  });

  testWidgets('typing sta filters to Stats and Enter opens it', (tester) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    await tester.enterText(find.byKey(const ValueKey('palette-search')), 'sta');
    await tester.pumpAndSettle();

    expect(inPalette('Stats'), findsOneWidget);
    expect(inPalette('Chat'), findsNothing);
    expect(inPalette('Sessions'), findsNothing);
    expect(inPalette('Settings'), findsNothing);
    expect(inPalette('refresh'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('TOKENS'), findsOneWidget);
  });

  testWidgets('a name outranks a hint that merely mentions the query', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    // Stats' hint lists `a achievements`, so both rows match `achiev`. The
    // action whose *name* matches must be the one Enter runs.
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'achiev',
    );
    await tester.pumpAndSettle();

    expect(rowOfText('achievements'), findsOneWidget);
    expect(inPalette('Stats'), findsOneWidget);
    expect(rowOfText('Stats'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc closes the palette without changing the surface', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);
    expect(find.byType(CommandPalette), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(find.text('Chill'), findsWidgets);
    expect(find.text('TOKENS'), findsNothing);
  });

  testWidgets('down and up move the palette selection', (tester) async {
    await pumpShell(tester);
    await pressCtrlK(tester);
    expect(rowOfText('Chat'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(rowOfText('Sessions'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(rowOfText('Skills'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(rowOfText('Sources'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(rowOfText('Skills'), findsOneWidget);
    expect(find.byType(CommandPalette), findsOneWidget);
  });

  testWidgets('Ctrl+K still works after the chat composer takes focus', (
    tester,
  ) async {
    await pumpShell(tester);

    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'a draft question');
    await tester.pump();

    await pressCtrlK(tester);
    expect(find.byType(CommandPalette), findsOneWidget);
    expect(find.byKey(const ValueKey('palette-search')), findsOneWidget);

    // The palette owns typing once it is open, not the composer underneath.
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'settings',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('friend'), findsOneWidget);
  });

  testWidgets('refresh runs the store command and closes the palette', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    final before = core.calls.where((call) => call == 'workspace.info').length;

    await pressCtrlK(tester);
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'workspace',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    final after = core.calls.where((call) => call == 'workspace.info').length;
    expect(after, greaterThan(before));
    expect(find.byType(CommandPalette), findsNothing);
  });

  testWidgets('the palette fits 800x600 without overflow', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await pressCtrlK(tester);

    expect(find.byType(CommandPalette), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The rows scroll instead of overflowing; dragging stays exception-free.
    await tester.drag(
      find.byKey(const ValueKey('palette-list')),
      const Offset(0, -200),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(CommandPalette), findsOneWidget);
  });
}
