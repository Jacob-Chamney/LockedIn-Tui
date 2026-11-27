import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/chat/markdown.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/shell/chrome.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:lockedin_desktop/theme/tokens.dart';
import 'package:material_ui/material_ui.dart';

/// The UI review's Phase B: one geometry, one reading face, verbs as buttons.

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
];

Widget _app(Widget child) => MaterialApp(
  theme: lockedInTheme(),
  home: Scaffold(body: child),
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(1200, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_app(child));
  await tester.pumpAndSettle();
}

void main() {
  test("outlined buttons share the theme's square hairline geometry", () {
    final style = lockedInTheme().outlinedButtonTheme.style!;
    final shape = style.shape!.resolve({})! as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(Radii.control));
    final side = style.side!.resolve({})!;
    expect(side.color, LockedInColors.line);
    expect(side.width, Stroke.hairline);
    expect(style.foregroundColor!.resolve({}), LockedInColors.foreground);
  });

  testWidgets('the header offers its verbs as buttons with their caps', (
    tester,
  ) async {
    var created = 0;
    await _pump(
      tester,
      SessionsPage(
        sessions: _sessions,
        loading: false,
        onCreate: () => created += 1,
        onArchive: (_) async => 'folder',
      ),
    );

    final newAction = find.byKey(const ValueKey('sessions-new'));
    expect(newAction, findsOneWidget);
    expect(
      find.descendant(of: newAction, matching: find.byType(KeyCap)),
      findsOneWidget,
      reason: 'the chord is printed beside the verb',
    );
    // The passive hint line is gone; the action is the pointer path.
    expect(find.text('a archive · d delete · x export'), findsNothing);

    await tester.tap(newAction);
    expect(created, 1);

    final archive = find.byKey(const ValueKey('sessions-archive'));
    expect(archive, findsOneWidget);
    expect(tester.widget<HeaderAction>(archive).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a narrow header keeps the actions as icons and still fits', (
    tester,
  ) async {
    await _pump(
      tester,
      SessionsPage(
        sessions: _sessions,
        loading: false,
        onCreate: () {},
        onArchive: (_) async => 'folder',
        onDelete: (_) async {},
        onExport: (_) async => '/tmp/x.zip',
      ),
      size: const Size(800, 600),
    );

    expect(find.byKey(const ValueKey('sessions-new')), findsOneWidget);
    expect(find.byKey(const ValueKey('sessions-archive')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('markdown prose reads in the sans face and code in mono', (
    tester,
  ) async {
    await _pump(tester, const ChatMarkdown(text: 'A paragraph of prose.'));
    // The paragraph is a nested span under `Text`'s default style, so the
    // paragraph's own family is on the span, not the outer RichText style.
    final text = tester
        .widgetList<Text>(find.byType(Text))
        .firstWhere(
          (widget) => widget.textSpan?.toPlainText() == 'A paragraph of prose.',
        );
    expect(text.textSpan?.style?.fontFamily, LockedInType.sans);

    await _pump(tester, const ChatMarkdown(text: '```dart\nfinal x = 1;\n```'));
    final code = tester
        .widgetList<Text>(find.byType(Text))
        .firstWhere(
          (widget) => (widget.textSpan?.toPlainText() ?? widget.data ?? '')
              .contains('final x = 1;'),
        );
    final codeStyle = code.style ?? code.textSpan?.style;
    expect(codeStyle?.fontFamily, LockedInType.mono);
  });
}
