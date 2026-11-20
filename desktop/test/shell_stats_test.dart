import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';
import 'support/shell.dart';

void main() {
  testWidgets('Alt+5 opens Stats and x exports through the core', (
    tester,
  ) async {
    final core = FakeCore();
    await pumpShell(tester, core: core);
    await openSurface(tester, 5);

    expect(find.text('TOKENS'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('status-hint'))).data,
      'r range · s scope · a achievements · x export',
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('export stats'), findsOneWidget);
    expect(core.statsExports, hasLength(1));
    expect(core.statsExports.single['range'], 'all');
    expect(core.statsExports.single['scope'], 'all');
    expect(core.statsExports.single['format'], 'md');
    expect(tester.takeException(), isNull);
  });

  testWidgets('the export dialog fits 800x600', (tester) async {
    final core = FakeCore();
    await pumpShell(tester, core: core, size: const Size(800, 600));
    await openSurface(tester, 5);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
    await tester.pumpAndSettle();

    expect(find.text('export stats'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
