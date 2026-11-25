import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_chat.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(900, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: child),
    ),
  );
  await tester.pumpAndSettle();
}

const _context = SessionContextView(
  messages: 12,
  kept: 8,
  summaryChars: 200,
  through: 4,
  tokens: 62000,
  window: 128000,
  fraction: 0.48,
  compactable: true,
);

void main() {
  testWidgets('the context strip reports the window and compacts', (
    tester,
  ) async {
    var loaded = 0;
    var compacted = 0;
    var expanded = 0;
    await _pump(
      tester,
      SessionChatView(
        detail: null,
        chat: null,
        loading: false,
        context: _context,
        onContextLoad: () => loaded += 1,
        onCompact: () => compacted += 1,
        onUncompact: () => expanded += 1,
      ),
    );

    expect(loaded, 1);
    expect(find.byKey(const ValueKey('session-context-strip')), findsOneWidget);
    expect(find.text('62.0k / 128.0k'), findsOneWidget);
    expect(find.text('summarised 4'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('session-context-compact')));
    await tester.pump();
    expect(compacted, 1);

    await tester.tap(find.byKey(const ValueKey('session-context-uncompact')));
    await tester.pump();
    expect(expanded, 1);
  });

  testWidgets('a chat with no context read shows no strip', (tester) async {
    await _pump(
      tester,
      const SessionChatView(detail: null, chat: null, loading: false),
    );
    expect(find.byKey(const ValueKey('session-context-strip')), findsNothing);
  });

  testWidgets('a context failure is one readable line', (tester) async {
    await _pump(
      tester,
      SessionChatView(
        detail: null,
        chat: null,
        loading: false,
        context: SessionContextView.empty,
        contextError: 'context.json is not valid JSON',
        onCompact: () {},
      ),
    );
    expect(find.byKey(const ValueKey('session-context-error')), findsOneWidget);
    expect(find.textContaining('not valid JSON'), findsOneWidget);
  });
}
