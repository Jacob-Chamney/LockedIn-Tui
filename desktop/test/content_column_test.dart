import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/features/achievements/achievements_page.dart';
import 'package:lockedin_desktop/features/archive/archive_page.dart';
import 'package:lockedin_desktop/features/knowledge/knowledge_page.dart';
import 'package:lockedin_desktop/features/review/review_page.dart';
import 'package:lockedin_desktop/features/sessions/sessions_page.dart';
import 'package:lockedin_desktop/features/shared/content_column.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/features/work/work_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// Review #21: every list manager shares the detail views' content cap, so a
/// wide window does not stretch a row's sentence and its trailing control to
/// opposite edges. This is the geometry half of the screenshot pass.
void main() {
  Future<void> pump(
    WidgetTester tester,
    Widget child, {
    Size size = const Size(1400, 900),
  }) async {
    tester.view.physicalSize = size;
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

  testWidgets(
    'the shared column is 900 on a wide page and the window below it',
    (tester) async {
      await pump(
        tester,
        const ContentColumn(
          child: SizedBox(
            key: ValueKey('content'),
            width: double.infinity,
            height: 20,
          ),
        ),
      );
      expect(tester.getSize(find.byKey(const ValueKey('content'))).width, 900);
    },
  );

  testWidgets('the shared column fills a narrow window', (tester) async {
    await pump(
      tester,
      const ContentColumn(
        child: SizedBox(
          key: ValueKey('content'),
          width: double.infinity,
          height: 20,
        ),
      ),
      size: const Size(700, 600),
    );
    expect(tester.getSize(find.byKey(const ValueKey('content'))).width, 700);
  });

  /// The wrapper's own box is the Align, which fills the page; the cap is the
  /// ConstrainedBox it wraps, so that is the width to measure.
  double columnWidth(WidgetTester tester) {
    final inner = find
        .descendant(
          of: find.byType(ContentColumn),
          matching: find.byType(ConstrainedBox),
        )
        .first;
    return tester.getSize(inner).width;
  }

  final managers = <String, Widget>{
    'sessions': const SessionsPage(sessions: [], loading: false),
    'skills': const SkillsPage(skills: [], loading: false),
    'review': const ReviewPage(),
    'archive': const ArchivePage(),
    'knowledge': const KnowledgePage(),
    'work': const WorkPage(projects: [], loading: false),
    'achievements': const AchievementsPage(),
  };

  for (final entry in managers.entries) {
    testWidgets('${entry.key} caps its list at 900 on a 1400 window', (
      tester,
    ) async {
      await pump(tester, entry.value);
      expect(find.byType(ContentColumn), findsOneWidget);
      expect(columnWidth(tester), 900);
      expect(tester.takeException(), isNull);
    });

    testWidgets('${entry.key} fills 800x600 without overflow', (tester) async {
      await pump(tester, entry.value, size: const Size(800, 600));
      expect(columnWidth(tester), 800);
      expect(tester.takeException(), isNull);
    });
  }
}
