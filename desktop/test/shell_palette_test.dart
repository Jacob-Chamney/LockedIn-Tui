import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/keymap/registry.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:lockedin_desktop/shell/chrome.dart';
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
    // The chord is a `KeyCap` now: one widget for every key the app prints.
    expect(
      tester
          .widget<KeyCap>(
            find.byKey(const ValueKey('palette-binding-surface.sessions')),
          )
          .keyLabel,
      'Space h',
    );
    expect(
      tester
          .widget<KeyCap>(find.byKey(const ValueKey('palette-binding-sidebar')))
          .keyLabel,
      'Space e',
    );
    expect(
      tester
          .widget<KeyCap>(
            find.byKey(const ValueKey('palette-binding-commands')),
          )
          .keyLabel,
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
      'Teaching',
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

  testWidgets('the palette is the catalogue: one row per action, no hand list', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    final keymap = KeymapRegistry(catalogue: shellActionCatalogue());
    final expected = keymap.rows
        .where((row) => row.id != 'leader' && row.id != 'close')
        .length;
    // Every catalogue action, plus the palette's own `close` row. This is the
    // regression guard against a second hand-written list growing back: adding
    // an action to the catalogue adds a row here without an edit.
    expect(find.byType(PaletteRow), findsNWidgets(expected + 1));

    // The visible rows carry the registry's chord, not a literal: the first
    // surface row shows the same `Space c` the leader overlay prints.
    expect(inPalette('Space c'), findsOneWidget);
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
    expect(rowOfText('Teaching'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(rowOfText('Sources'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(rowOfText('Teaching'), findsOneWidget);
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

  /// The same one-frame window as a leader chord: `Ctrl+K` opens the palette, and
  /// its search field takes focus in a post-frame callback, so a character typed
  /// in the same frame landed where nothing was listening.
  testWidgets('a fast first character reaches the palette search field', (
    tester,
  ) async {
    await pumpShell(tester);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    // No pump: the field has not been built, let alone focused.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();

    final field = find.byKey(const ValueKey('palette-search'));
    expect(field, findsOneWidget);
    expect(tester.widget<TextField>(field).controller?.text, 's');
  });
  testWidgets('a fast first character reaches the command line too', (
    tester,
  ) async {
    await pumpShell(tester);

    // `:` opens the command line; `s` follows with no frame between them.
    await tester.sendKeyEvent(LogicalKeyboardKey.semicolon, character: ':');
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.pumpAndSettle();

    final field = find.byKey(const ValueKey('command-input'));
    expect(field, findsOneWidget);
    expect(tester.widget<TextField>(field).controller?.text, 's');
  });

  testWidgets('a character typed after the palette has focus is not doubled', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    await tester.enterText(find.byKey(const ValueKey('palette-search')), 'st');
    await tester.pumpAndSettle();

    // The buffer only seeds an unfocused field: typing into a focused one is the
    // field's own business, and must not be re-appended by the shell.
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('palette-search')))
          .controller
          ?.text,
      'st',
    );
  });
}
