import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/shell/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

void main() {
  testWidgets('Alt+8 opens Archive with both sides of the wall', (
    tester,
  ) async {
    final core = FakeCore();
    final store = await pumpShell(tester, core: core);
    expect(callsTo(core, 'archive.list'), 0);

    await openSurface(tester, 8);

    expect(callsTo(core, 'archive.list'), 1);
    expect(store.archiveError, isNull);
    expect(store.archiveRows.length, 2);
    expect(find.text('ARCHIVE'), findsWidgets);
    expect(find.text('SCHOOL'), findsOneWidget);
    expect(find.text('SKILLS'), findsOneWidget);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.textContaining('18.0 KB · folder'), findsOneWidget);
    expect(find.textContaining('2.0 KB · folder'), findsOneWidget);
    expect(
      find.text('j/k move · Enter restore · d delete · r refresh'),
      findsOneWidget,
    );
    expect(find.text('r refresh · Esc back'), findsWidgets);
    expect(find.text('Restore'), findsNothing);
    expect(find.text('Delete'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r reads archive.list again', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 8);
    expect(callsTo(core, 'archive.list'), 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    expect(callsTo(core, 'archive.list'), 2);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty archive shows the next action', (tester) async {
    await pumpShell(tester, core: FakeCore(archiveEmpty: true));
    await openSurface(tester, 8);

    expect(find.text('nothing archived yet'), findsOneWidget);
    expect(
      find.text(
        'archive one from Sessions or Teaching with a; it appears here',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a backend failure is one message and Retry asks again', (
    tester,
  ) async {
    const failure =
        'no archive folder is configured: set one in Settings → Storage';
    final core = FakeCore(archiveFailure: failure);
    final store = await pumpShell(tester, core: core);

    await openSurface(tester, 8);

    expect(callsTo(core, 'archive.list'), 1);
    expect(store.archiveError, failure);
    expect(find.byKey(const ValueKey('archive-error')), findsOneWidget);
    expect(find.text(failure), findsOneWidget);
    expect(find.byKey(const ValueKey('archive-empty')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('archive-retry')));
    await tester.pumpAndSettle();
    expect(callsTo(core, 'archive.list'), 2);
    expect(find.text(failure), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Space , opens Settings and Settings stays last', (tester) async {
    await pumpShell(tester);

    await openSurface(tester, 8);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);

    await openSurface(tester, 0);
    expect(find.text('friend'), findsOneWidget);
    expect(find.text('Chemistry — Bonding'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Ctrl+K lists Archive and Enter opens the surface', (
    tester,
  ) async {
    await pumpShell(tester);
    await pressCtrlK(tester);

    expect(
      find.descendant(
        of: find.byType(CommandPalette),
        matching: find.text('Archive'),
      ),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const ValueKey('palette-search')),
      'archive',
    );
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.byType(CommandPalette), findsNothing);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Esc returns from Archive to chat', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 8);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('Chemistry — Bonding'), findsNothing);
    expect(find.text('Ask anything…'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the Archive surface fits 800x600 without overflow', (
    tester,
  ) async {
    await pumpShell(tester, size: const Size(800, 600));
    await openSurface(tester, 8);

    expect(find.text('ARCHIVE'), findsWidgets);
    expect(find.text('Chemistry — Bonding'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.drag(
      find.byKey(const ValueKey('archive-list')),
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
