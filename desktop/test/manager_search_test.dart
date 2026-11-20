import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'support/shell.dart';

void main() {
  testWidgets('the Skills manager filters as you type', (tester) async {
    await pumpShell(tester);
    await openSurface(tester, 3);

    // The fake serves three goals.
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('Rust ownership'), findsOneWidget);
    expect(find.text('Stack frames'), findsOneWidget);

    // `/` focuses the box, then typing narrows the list.
    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('skills-search')), 'rust');
    await tester.pumpAndSettle();

    expect(find.text('Rust ownership'), findsOneWidget);
    expect(find.text('Read disassembly output'), findsNothing);
    expect(find.text('Stack frames'), findsNothing);
    // The header reports the filtered size against the total.
    expect(find.text('1 of 3'), findsOneWidget);

    // `Esc` clears the query before it leaves the surface.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Read disassembly output'), findsOneWidget);
    expect(find.text('3'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the Work manager filters projects by name and folder', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 6);

    expect(find.text('My app'), findsOneWidget);
    expect(find.text('API service'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('work-search')), 'api');
    await tester.pumpAndSettle();

    expect(find.text('API service'), findsOneWidget);
    expect(find.text('My app'), findsNothing);
    expect(find.text('1 of 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a query that matches nothing keeps a next action', (
    tester,
  ) async {
    await pumpShell(tester);
    await openSurface(tester, 3);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('skills-search')),
      'nothing matches this',
    );
    await tester.pumpAndSettle();

    // The empty state names the query and the key that clears it.
    expect(
      find.textContaining('no goal matches', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Esc clears the search'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
