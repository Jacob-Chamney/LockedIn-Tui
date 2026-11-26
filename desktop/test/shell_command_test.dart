import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/keymap/registry.dart';
import 'package:lockedin_desktop/shell/command_line.dart';
import 'package:lockedin_desktop/shell/leader.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:material_ui/material_ui.dart';

import 'support/shell.dart';

/// `:` is Shift+Semicolon on a US layout; the character is what the registry
/// resolves, so the test sends exactly what a keyboard would report.
Future<void> pressColon(WidgetTester tester) async {
  await tester.sendKeyEvent(LogicalKeyboardKey.semicolon, character: ':');
  await tester.pumpAndSettle();
}

Finder inCommandLine(String text) =>
    find.descendant(of: find.byType(CommandLine), matching: find.text(text));

/// The highlighted row. Scoped lookups must use this when the query equals a
/// command's own name: `find.text('help')` would also match the input field.
Finder selectedCommandRow() => find.byKey(const ValueKey('command-selected'));

Finder inSelectedRow(String text) =>
    find.descendant(of: selectedCommandRow(), matching: find.text(text));

void main() {
  testWidgets('colon opens the command line and lists the registry actions', (
    tester,
  ) async {
    await pumpShell(tester);
    // `:` is a NORMAL-mode chord: the chat composer does not hold the keyboard.
    expect(find.text('NORMAL'), findsOneWidget);

    await pressColon(tester);

    expect(find.byType(CommandLine), findsOneWidget);
    expect(find.text('COMMAND'), findsOneWidget);
    expect(find.text('↑↓ move · Enter run · Esc close'), findsOneWidget);
    // The documented names from `docs/product.md` §13.
    for (final name in const [
      'chill',
      'sessions',
      'skills',
      'sources',
      'stats',
      'work',
      'review',
      'archive',
      'knowledge',
      'settings',
      'help',
      'refresh',
      'retry',
      'close',
    ]) {
      expect(inCommandLine(name), findsOneWidget, reason: 'missing :$name');
    }
    // A surface's row shows the real chord from the registry.
    expect(
      find.descendant(
        of: find.byType(CommandLine),
        matching: find.textContaining('Space t'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('typing sta filters to Stats and Enter switches the surface', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressColon(tester);

    await tester.enterText(find.byKey(const ValueKey('command-input')), 'sta');
    await tester.pumpAndSettle();

    expect(inCommandLine('stats'), findsOneWidget);
    expect(inCommandLine('chill'), findsNothing);
    expect(inCommandLine('sessions'), findsNothing);
    expect(inCommandLine('settings'), findsNothing);
    expect(inCommandLine('refresh'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandLine), findsNothing);
    expect(find.text('TOKENS'), findsOneWidget);
  });

  testWidgets('an unknown command says so inline and keeps the line open', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressColon(tester);

    await tester.enterText(find.byKey(const ValueKey('command-input')), 'nope');
    await tester.pumpAndSettle();

    expect(find.text('no such command · try :help'), findsOneWidget);
    expect(inCommandLine('stats'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandLine), findsOneWidget);
    expect(find.text('no such command · try :help'), findsOneWidget);
    // The surface underneath is untouched: the chat is still on screen.
    expect(find.text('Ask anything…'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byType(CommandLine), findsNothing);
    expect(find.text('Ask anything…'), findsOneWidget);
  });

  testWidgets('Esc closes the command line without changing the surface', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 2);
    expect(find.text('Physics — Unit 4'), findsOneWidget);

    await pressColon(tester);
    expect(find.byType(CommandLine), findsOneWidget);
    expect(find.text('COMMAND'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byType(CommandLine), findsNothing);
    expect(find.text('Physics — Unit 4'), findsOneWidget);
    expect(find.text('TOKENS'), findsNothing);
  });

  testWidgets(':help opens the same overlay ? opens', (tester) async {
    await pumpShell(tester);
    await pressColon(tester);

    await tester.enterText(find.byKey(const ValueKey('command-input')), 'help');
    await tester.pumpAndSettle();
    expect(inSelectedRow('help'), findsOneWidget);
    expect(find.byKey(const ValueKey('command-row-refresh')), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandLine), findsNothing);
    expect(find.byType(LeaderOverlay), findsOneWidget);
    expect(find.text('LEADER'), findsOneWidget);
  });

  testWidgets(':close dismisses the line and leaves the surface alone', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 2);
    await pressColon(tester);

    await tester.enterText(find.byKey(const ValueKey('command-input')), 'q');
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandLine), findsNothing);
    // `Esc`-equivalent: the session list is still the surface.
    expect(find.text('Physics — Unit 4'), findsOneWidget);
  });

  testWidgets('a rebound surface changes the command row hint', (tester) async {
    final store = await pumpShell(tester);
    // `space+1` is free: every surface default is a letter, as in the terminal
    // app, so a digit is an obvious override to prove the row follows the
    // registry rather than a hard-coded list.
    await store.setKeybind('surface.stats', 'space+1');
    await tester.pumpAndSettle();

    await pressColon(tester);

    expect(
      find.descendant(
        of: find.byType(CommandLine),
        matching: find.textContaining('Space 1'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byType(CommandLine),
        matching: find.textContaining('Space t'),
      ),
      findsNothing,
    );
  });

  testWidgets('a colon typed into a page text field is a character', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 2);

    // `/` focuses the Sessions search field; the field then holds the keyboard.
    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('sessions-search')),
      'phys',
    );
    await tester.pumpAndSettle();

    await pressColon(tester);

    // Bare chords are NORMAL-mode keys. Opening the command line from a text
    // field meant "Task 1: …" could not be typed into the lock-in
    // instructions; `Ctrl+K` is the chord that works from inside a field.
    expect(find.byType(CommandLine), findsNothing);

    // Esc leaves the field, and the same key is then a command again.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await pressColon(tester);
    expect(find.byType(CommandLine), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the palette lists the command line as a real action', (
    tester,
  ) async {
    await pumpShell(tester);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('commands'),
      ),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'command',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.byType(CommandLine), findsOneWidget);
  });

  testWidgets('the command line fits 800x600 without overflow', (tester) async {
    await pumpShell(tester, size: const Size(800, 600));
    await pressColon(tester);

    expect(find.byType(CommandLine), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The rows scroll instead of overflowing.
    await tester.drag(
      find.byKey(const ValueKey('command-list')),
      const Offset(0, -300),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(CommandLine), findsOneWidget);
  });

  group('command list', () {
    test('every command is a name for a registry action', () {
      final keymap = KeymapRegistry();
      final entries = commandEntries(keymap);

      // Every action has exactly one command named by its own label.
      for (final row in keymap.editorRows()) {
        expect(
          entries.where((entry) => entry.actionId == row.id),
          isNotEmpty,
          reason: 'no command for ${row.id}',
        );
      }
      // Surfaces keep their registry id: a command never invents a handler.
      final stats = entries.firstWhere((entry) => entry.name == 'stats');
      expect(stats.actionId, 'surface.stats');
      expect(stats.label, 'stats');
      // The documented alias resolves to the same action, not a copy of it.
      final chill = entries.firstWhere((entry) => entry.name == 'chill');
      expect(chill.actionId, 'surface.chat');
      expect(chill.alias, isTrue);
      // A name the catalogue already carries is not repeated by the alias table.
      expect(entries.where((entry) => entry.name == 'close'), hasLength(1));
      expect(entries.where((entry) => entry.name == 'q'), hasLength(1));
    });

    test('a rebound action changes its hint, a removed action its command', () {
      final rebound = KeymapRegistry(
        keybinds: const {'surface.stats': 'space+t'},
      );
      expect(
        commandEntries(rebound)
            .firstWhere((entry) => entry.name == 'stats')
            .hint,
        'Space t · usage and cost',
      );

      final reduced = KeymapRegistry(
        catalogue: [
          for (final spec in defaultActionCatalogue())
            if (spec.id != 'retry') spec,
        ],
      );
      final names = commandEntries(reduced).map((entry) => entry.name);
      expect(names, isNot(contains('retry')));
      // The alias that pointed at it is gone too, rather than dangling.
      expect(
        commandEntries(reduced).where((entry) => entry.actionId == 'retry'),
        isEmpty,
      );
      // Everything else still resolves.
      expect(names, contains('refresh'));
    });

    test('filtering matches the command name and the action label', () {
      final entries = commandEntries(KeymapRegistry());
      final sta = [
        for (final entry in entries)
          if (entry.matches('sta')) entry.name,
      ];
      expect(sta, ['stats']);
      // The label matches even when the typed name is an alias: `chat` reaches
      // the `chill` row's action through its label.
      final chat = [
        for (final entry in entries)
          if (entry.matches('chat')) entry.name,
      ];
      expect(chat, contains('chill'));
      expect(
        entries.firstWhere((entry) => entry.name == 'stats').matches(''),
        isTrue,
      );
    });
  });
}
