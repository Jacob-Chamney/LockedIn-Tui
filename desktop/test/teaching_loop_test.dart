import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

/// The teaching loop on the Teaching surface: measure → plan → step → check.
///
/// `desktop/docs/redesign.md` §2.1. The card renders fields the core sent, so
/// these tests drive it with records rather than with a model.
const _detail = SkillDetail(
  id: 'read-disassembly-3f9a1c',
  name: 'Read disassembly output',
  goal: 'Read disassembly output confidently',
  prior: 'I know C',
  created: '2026-11-01T09:00:00Z',
  plan: 'template',
  chapters: <SkillChapter>[],
  chats: <SkillChatRow>[],
  stages: <SkillStage>[],
);

const _measured = TeachingState(
  goal: 'Read a function and say what it does',
  prior: 'I know C',
  held: ['registers hold working state', 'the stack grows down'],
  gaps: ['argument passing'],
  plan: [
    TeachingStep(id: 'step-1', title: 'A register is a named slot'),
    TeachingStep(id: 'step-2', title: 'A call pushes a return address'),
    TeachingStep(id: 'step-3', title: 'Arguments arrive in registers'),
  ],
  checks: [],
);

const _openStep = TeachingStepBody(
  stepId: 'step-1',
  prose: 'A register is a named slot inside the processor.',
  question: 'Where does a call keep the address it must come back to?',
);

Future<void> pump(
  WidgetTester tester,
  SkillDetailView view, {
  Size size = const Size(1100, 900),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(body: view),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('an unmeasured session offers exactly one action', (
    tester,
  ) async {
    var measured = 0;
    await pump(
      tester,
      SkillDetailView(detail: _detail, onMeasure: () => measured += 1),
    );

    expect(find.text('TEACHING LOOP'), findsOneWidget);
    expect(find.textContaining('Measure first'), findsOneWidget);
    expect(find.byKey(const ValueKey('teach-next-step')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('teach-measure')));
    await tester.pump();
    expect(measured, 1);
  });

  testWidgets('a measured session renders held, gaps and the plan map', (
    tester,
  ) async {
    await pump(
      tester,
      SkillDetailView(
        detail: _detail,
        teaching: _measured,
        onMeasure: () {},
        onNextStep: () {},
      ),
    );

    // What the measure heard, and what it could not decide.
    expect(find.text('registers hold working state'), findsOneWidget);
    expect(find.text('the stack grows down'), findsOneWidget);
    expect(find.textContaining('argument passing'), findsOneWidget);

    // The whole route, with the first step marked current.
    expect(find.text('A register is a named slot'), findsOneWidget);
    expect(find.text('A call pushes a return address'), findsOneWidget);
    expect(find.text('here'), findsOneWidget);

    // No step is open, so the one action is to teach the first.
    expect(find.byKey(const ValueKey('teach-next-step')), findsOneWidget);
    expect(find.byKey(const ValueKey('teach-question')), findsNothing);
  });

  testWidgets(
    'an open step shows its prose and its check, and sends an answer',
    (tester) async {
      String? sent;
      await pump(
        tester,
        SkillDetailView(
          detail: _detail,
          teaching: TeachingState(
            goal: _measured.goal,
            prior: _measured.prior,
            held: _measured.held,
            gaps: _measured.gaps,
            plan: _measured.plan,
            checks: const [],
            current: _openStep,
          ),
          onCheck: (answer) => sent = answer,
        ),
      );

      expect(
        find.text('A register is a named slot inside the processor.'),
        findsOneWidget,
      );
      expect(find.textContaining('come back to'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('teach-answer')),
        'on the stack',
      );
      await tester.tap(find.byKey(const ValueKey('teach-check')));
      await tester.pump();

      expect(sent, 'on the stack');
    },
  );

  testWidgets('the verdict card states the verdict in words', (tester) async {
    await pump(
      tester,
      SkillDetailView(
        detail: _detail,
        teaching: TeachingState(
          goal: _measured.goal,
          prior: _measured.prior,
          held: _measured.held,
          gaps: _measured.gaps,
          plan: _measured.plan,
          checks: const [
            TeachingCheckRecord(
              stepId: 'step-1',
              verdict: 'partial',
              correction: 'Half right: the address, not the arguments.',
            ),
          ],
          current: _openStep,
        ),
        teachingVerdict: const TeachingCheckResult(
          verdict: 'partial',
          correction: 'Half right: the address, not the arguments.',
          passed: false,
          nextIndex: 0,
          total: 3,
        ),
      ),
    );

    expect(find.byKey(const ValueKey('teach-verdict')), findsOneWidget);
    // Section labels are micro caps, so the verdict reads in caps.
    expect(find.text('PARTLY THERE'), findsOneWidget);
    expect(find.textContaining('Half right'), findsOneWidget);
  });

  testWidgets(
    'a passed step is ticked in the map and the next one is current',
    (tester) async {
      await pump(
        tester,
        SkillDetailView(
          detail: _detail,
          teaching: TeachingState(
            goal: _measured.goal,
            prior: _measured.prior,
            held: _measured.held,
            gaps: _measured.gaps,
            plan: _measured.plan,
            checks: const [
              TeachingCheckRecord(
                stepId: 'step-1',
                verdict: 'correct',
                correction: 'yes',
              ),
            ],
          ),
          onNextStep: () {},
        ),
      );

      expect(find.text('1/3 held'), findsOneWidget);
      expect(find.text('here'), findsOneWidget);
      // The tick replaces the number for a passed step.
      expect(find.text('✓'), findsWidgets);
    },
  );

  testWidgets('a refusal is one readable line, not a dead end', (tester) async {
    await pump(
      tester,
      SkillDetailView(
        detail: _detail,
        teaching: _measured,
        teachingError: 'link a model in Settings → Providers',
        onNextStep: () {},
      ),
    );

    expect(find.byKey(const ValueKey('teach-error')), findsOneWidget);
    expect(find.textContaining('link a model'), findsOneWidget);
    // The action is still there, so the user can retry after linking.
    expect(find.byKey(const ValueKey('teach-next-step')), findsOneWidget);
  });

  testWidgets('the loop fits at 800x600', (tester) async {
    await pump(
      tester,
      SkillDetailView(detail: _detail, teaching: _measured, onNextStep: () {}),
      size: const Size(800, 600),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('TEACHING LOOP'), findsOneWidget);
    // The rail compacts to a numbered strip and stays usable.
    expect(find.byKey(const ValueKey('teach-phase-teach')), findsOneWidget);
  });
}
