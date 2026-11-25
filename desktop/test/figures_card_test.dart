import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/sessions/session_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

const _detail = SessionDetail(
  id: '2026-11-01-1430-physics-unit-4',
  name: 'Physics — Unit 4',
  created: '2026-11-01T14:30:00Z',
  archived: false,
  prompt: 'Explain the problem set.',
  sources: [
    SessionSource(
      name: 'ComplexNumbers.pdf',
      originalPath: '/home/me/input/ComplexNumbers.pdf',
      storedPath: 'sources/ComplexNumbers.pdf',
      hash: 'sha256:0badf00d5678',
      kind: 'pdf',
    ),
  ],
  steps: SessionSteps(done: 0, total: 0, exists: false, markdown: ''),
);

Future<void> _pump(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(1200, 1700);
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

void main() {
  testWidgets('a page and a caption extract one figure', (tester) async {
    int? sentPage;
    String? sentCaption;
    await _pump(
      tester,
      SessionDetailView(
        detail: _detail,
        loading: false,
        onExtractFigure:
            ({
              required int page,
              int? x,
              int? y,
              int? width,
              int? height,
              String caption = '',
            }) async {
              sentPage = page;
              sentCaption = caption;
            },
      ),
    );

    expect(find.text('FIGURES'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('figure-page')), '2');
    await tester.enterText(
      find.byKey(const ValueKey('figure-caption')),
      'The complex plane',
    );
    await tester.tap(find.byKey(const ValueKey('figure-extract')));
    await tester.pump();

    expect(sentPage, 2);
    expect(sentCaption, 'The complex plane');
  });

  testWidgets('a partial crop is refused in place', (tester) async {
    var calls = 0;
    await _pump(
      tester,
      SessionDetailView(
        detail: _detail,
        loading: false,
        onExtractFigure:
            ({
              required int page,
              int? x,
              int? y,
              int? width,
              int? height,
              String caption = '',
            }) async {
              calls += 1;
            },
      ),
    );
    await tester.enterText(find.byKey(const ValueKey('figure-crop-x')), '10');
    await tester.tap(find.byKey(const ValueKey('figure-extract')));
    await tester.pump();
    expect(calls, 0);
    expect(find.byKey(const ValueKey('figure-notice')), findsOneWidget);
  });

  testWidgets('a saved figure loads and removes on demand', (tester) async {
    String? loaded;
    String? removed;
    await _pump(
      tester,
      SessionDetailView(
        detail: _detail,
        loading: false,
        figures: const [
          SessionFigure(
            id: 'figure-1',
            source: 'sources/ComplexNumbers.pdf',
            page: 2,
            caption: 'The complex plane',
            note: 'the real axis is horizontal',
            file: 'figure-1.png',
            createdAt: '2026-11-24T10:00:00.000Z',
            x: 0,
            y: 0,
            width: 100,
            height: 60,
          ),
        ],
        onExtractFigure: ({
          required int page,
          int? x,
          int? y,
          int? width,
          int? height,
          String caption = '',
        }) async {},
        onLoadFigure: (id) async {
          loaded = id;
        },
        onRemoveFigure: (id) async {
          removed = id;
        },
      ),
    );

    expect(find.text('The complex plane'), findsOneWidget);
    expect(find.textContaining('the real axis'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('figure-load-figure-1')));
    await tester.pump();
    expect(loaded, 'figure-1');

    await tester.tap(find.byKey(const ValueKey('figure-remove-figure-1')));
    await tester.pump();
    expect(removed, 'figure-1');
  });
}
