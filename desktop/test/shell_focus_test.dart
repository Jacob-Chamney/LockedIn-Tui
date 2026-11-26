import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/shell/command_line.dart';
import 'package:lockedin_desktop/shell/leader.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

Future<void> press(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyEvent(key);
  await tester.pumpAndSettle();
}

/// `\`, then the leader key: the alternate leader works from every layer.
Future<void> leader(WidgetTester tester, LogicalKeyboardKey key) async {
  await press(tester, LogicalKeyboardKey.backslash);
  await press(tester, key);
}

Future<void> pressCtrl(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pumpAndSettle();
}

const _cursor = ValueKey('sidebar-row-cursor');

void main() {
  testWidgets('Esc leaves the Chill composer for NORMAL, then Space leads', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1000, 700));

    await tester.tap(find.byKey(const ValueKey('chat-composer')));
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsOneWidget);

    // Esc was dead here: the page ignored it and the shell dropped every bare
    // chord in INSERT, so NORMAL could only be reached with the pointer.
    await press(tester, LogicalKeyboardKey.escape);
    expect(find.text('NORMAL'), findsOneWidget);
    expect(find.text('INSERT'), findsNothing);

    await press(tester, LogicalKeyboardKey.space);
    expect(find.byType(LeaderOverlay), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K on Review opens the palette and marks nothing', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await leader(tester, LogicalKeyboardKey.keyV);
    expect(find.text('REVIEW'), findsWidgets);

    // `k` is "known" on this page. A page handler runs before the shell's, and
    // it read Ctrl+K as k: the chord wrote to disk instead of opening the
    // palette.
    await pressCtrl(tester, LogicalKeyboardKey.keyK);

    expect(find.byType(CommandPalette), findsOneWidget);
    expect(core.calls, isNot(contains('review.mark')));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a palette action does not wipe a half-filled wizard', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1000, 700));
    await leader(tester, LogicalKeyboardKey.keyL);
    expect(find.text('NEW LOCK-IN'), findsOneWidget);

    const name = ValueKey('new-session-name');
    await tester.tap(find.byKey(name));
    await tester.pump();
    await tester.enterText(find.byKey(name), 'Thermodynamics — Unit 2');
    await tester.pumpAndSettle();

    // Running any palette row used to remount the page to hand the keyboard
    // back, which threw the form away.
    await pressCtrl(tester, LogicalKeyboardKey.keyK);
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'refresh',
    );
    await tester.pumpAndSettle();
    await press(tester, LogicalKeyboardKey.enter);

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('Thermodynamics — Unit 2'), findsOneWidget);
    // And the keyboard is back in the field it came from.
    expect(
      tester.widget<TextField>(find.byKey(name)).focusNode?.hasFocus,
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('expanding the rail with the button leaves the page the keys', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1000, 700));

    await tester.tap(find.byKey(const ValueKey('sidebar-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('LEARN'), findsOneWidget);
    // A pointer user is about to click: the rail must not take the keyboard,
    // or the page cannot accept the focus the click asks for.
    expect(find.byKey(_cursor), findsNothing);

    await tester.tap(find.byKey(const ValueKey('chat-composer')));
    await tester.pumpAndSettle();
    expect(find.text('INSERT'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a click in the page releases a keyboard-focused rail', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1000, 700));
    await leader(tester, LogicalKeyboardKey.keyE);
    expect(find.byKey(_cursor), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('chat-composer')));
    await tester.pumpAndSettle();

    expect(find.byKey(_cursor), findsNothing);
    expect(find.text('INSERT'), findsOneWidget);
    expect(find.text('LEARN'), findsOneWidget, reason: 'the rail stays open');
    expect(tester.takeException(), isNull);
  });

  testWidgets('an overlay opened from the rail gives the rail back its keys', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1000, 700));
    await leader(tester, LogicalKeyboardKey.keyE);
    await press(tester, LogicalKeyboardKey.keyJ);
    expect(
      find.ancestor(of: find.text('Sessions'), matching: find.byKey(_cursor)),
      findsOneWidget,
    );

    // Space is the leader inside the rail too. Closing it used to leave the
    // rail holding the keyboard with no cursor drawn, and Esc swallowed.
    await press(tester, LogicalKeyboardKey.space);
    expect(find.byType(LeaderOverlay), findsOneWidget);
    await press(tester, LogicalKeyboardKey.escape);
    expect(find.byType(LeaderOverlay), findsNothing);

    expect(
      find.ancestor(of: find.text('Sessions'), matching: find.byKey(_cursor)),
      findsOneWidget,
    );
    await press(tester, LogicalKeyboardKey.enter);
    expect(find.text('LOCK-IN SESSIONS'), findsOneWidget);
    expect(find.byKey(_cursor), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an overlay opened from another overlay owns the keyboard', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(1000, 700));
    await pressCtrl(tester, LogicalKeyboardKey.keyK);
    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'command',
    );
    await tester.pumpAndSettle();
    await press(tester, LogicalKeyboardKey.enter);

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.byType(CommandLine), findsOneWidget);

    // The line was on screen but the page underneath had the keys, so nothing
    // typed reached it and Esc could not close it.
    await press(tester, LogicalKeyboardKey.escape);
    expect(find.byType(CommandLine), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a held Esc closes one layer, not two', (tester) async {
    await pumpShell(tester, size: const Size(1000, 700));
    await leader(tester, LogicalKeyboardKey.keyI);
    expect(find.text('ACHIEVEMENTS'), findsWidgets);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await tester.sendKeyRepeatEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    await tester.sendKeyUpEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // The repeat used to close a second layer as well. Achievements is a layer
    // over the surface it was opened from (Chat here), so one Esc lands on the
    // chat and a second would leave the surface.
    expect(find.text('ACHIEVEMENTS'), findsNothing);
    expect(find.byKey(const ValueKey('chat-composer')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
