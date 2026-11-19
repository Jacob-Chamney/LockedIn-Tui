import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/app.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/skills/goal_wizard.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

// ---------------------------------------------------------------------------
// Helpers — plain values and the fake core. No filesystem, no provider.
// ---------------------------------------------------------------------------

const _goalKey = ValueKey('goal-wizard-goal');
const _priorKey = ValueKey('goal-wizard-prior');
const _nextKey = ValueKey('goal-wizard-next');
const _createKey = ValueKey('goal-wizard-create');
const _errorKey = ValueKey('goal-wizard-error');

/// A create the step-navigation tests must never reach.
Future<SkillCreateResult> _neverCreate({
  required String goal,
  required String prior,
}) async {
  fail('the wizard must not create in this test');
}

Future<void> pumpWizard(
  WidgetTester tester, {
  GoalCreateCallback onCreate = _neverCreate,
  VoidCallback? onCancel,
  ValueChanged<String>? onCreated,
  double width = 800,
  double height = 600,
}) async {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: lockedInTheme(),
      home: Scaffold(
        body: GoalWizard(
          // A fresh state per pump keeps the loop-driven layout test honest.
          key: UniqueKey(),
          onCreate: onCreate,
          onCancel: onCancel ?? () {},
          onCreated: onCreated ?? (_) {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// `enterText` does not focus a field in a widget test, and a focused control
/// would swallow Enter, so the field is tapped first — exactly what a keyboard
/// user does with Tab.
Future<void> enterGoal(WidgetTester tester, String goal) async {
  await tester.tap(find.byKey(_goalKey));
  await tester.pump();
  await tester.enterText(find.byKey(_goalKey), goal);
  await tester.pump();
}

Future<void> enterPrior(WidgetTester tester, String prior) async {
  await tester.tap(find.byKey(_priorKey));
  await tester.pump();
  await tester.enterText(find.byKey(_priorKey), prior);
  await tester.pump();
}

Future<void> tapAndSettle(WidgetTester tester, Key key) async {
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

/// Goal → Review for a named goal, without naming a prior.
Future<void> goToReview(WidgetTester tester, String goal) async {
  await enterGoal(tester, goal);
  await tapAndSettle(tester, _nextKey);
}

Future<CoreStore> pumpShell(
  WidgetTester tester, {
  FakeCore? core,
  Size size = const Size(1280, 800),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  await tester.pumpWidget(LockedInApp(store: store));
  await tester.pumpAndSettle();
  return store;
}

/// `Alt+N` for one surface: the shell maps the digit to `Surface.values[N - 1]`.
/// The leader key per surface ordinal (1 = Chat … 0 = Settings), matching the
/// terminal app's grammar: `Space c`, `Space h`, `Space g`, `Space s`, `Space t`,
/// `Space p`, `Space v`, `Space f`, `Space n`, `Space ,`.
const _surfaceLeaderKeys = <LogicalKeyboardKey>[
  LogicalKeyboardKey.keyC,
  LogicalKeyboardKey.keyH,
  LogicalKeyboardKey.keyG,
  LogicalKeyboardKey.keyS,
  LogicalKeyboardKey.keyT,
  LogicalKeyboardKey.keyP,
  LogicalKeyboardKey.keyV,
  LogicalKeyboardKey.keyF,
  LogicalKeyboardKey.keyN,
  LogicalKeyboardKey.comma,
];

/// Open a surface the way the terminal app does: `Space`, then the leader key.
Future<void> openSurface(WidgetTester tester, int surface) async {
  // Leave INSERT first: the leader is a NORMAL-mode chord, exactly as in the
  // terminal app, and the chat composer holds the keyboard on first paint. The
  // status bar is the shell's own answer for the mode, so this never presses
  // Esc on a page that would treat it as "back".
  if (find.text('INSERT').evaluate().isNotEmpty) {
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
  }
  // The alternate leader: `Space` is a local action on the deck, the steps
  // reader and the approvals view, and navigation must work from all of them.
  await tester.sendKeyEvent(LogicalKeyboardKey.backslash);
  await tester.pumpAndSettle();
  // `0` is the tenth surface (Settings), as in the terminal app.
  final index = surface == 0 ? _surfaceLeaderKeys.length - 1 : surface - 1;
  await tester.sendKeyEvent(_surfaceLeaderKeys[index]);
  await tester.pumpAndSettle();
}

void main() {
  group('GoalWizard', () {
    testWidgets('a goal is required and prior knowledge is optional', (
      tester,
    ) async {
      var creates = 0;
      await pumpWizard(
        tester,
        onCreate: ({required goal, required prior}) async {
          creates++;
          return const SkillCreateResult(
            id: 'bash-basics',
            name: 'Bash basics',
            plan: 'template',
          );
        },
      );

      // An empty goal is blocked before Review, and nothing was sent.
      await tapAndSettle(tester, _nextKey);
      expect(
        find.descendant(
          of: find.byKey(_errorKey),
          matching: find.textContaining('A goal is required'),
        ),
        findsOneWidget,
      );
      expect(find.text('REVIEW'), findsNothing);
      expect(creates, 0);

      // A goal alone reaches Review: prior knowledge is optional.
      await goToReview(tester, 'Bash basics');

      expect(find.text('REVIEW'), findsOneWidget);
      expect(find.text('Bash basics'), findsOneWidget);
      expect(find.text('not recorded'), findsOneWidget);
      expect(find.text('plan · model or template'), findsOneWidget);
      expect(
        find.textContaining('configured model', findRichText: true),
        findsOneWidget,
      );
      expect(find.byKey(_goalKey), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Create sends the trimmed goal and prior and reports the id', (
      tester,
    ) async {
      final sent = <(String, String)>[];
      final created = <String>[];
      await pumpWizard(
        tester,
        onCreate: ({required goal, required prior}) async {
          sent.add((goal, prior));
          return const SkillCreateResult(
            id: 'bash-basics',
            name: 'Bash basics',
            plan: 'template',
          );
        },
        onCreated: created.add,
      );

      await enterGoal(tester, '  Bash basics  ');
      await enterPrior(tester, '  I know some Python  ');
      await tapAndSettle(tester, _nextKey);

      expect(find.text('Bash basics'), findsOneWidget);
      expect(find.text('I know some Python'), findsOneWidget);

      await tapAndSettle(tester, _createKey);

      expect(sent, [('Bash basics', 'I know some Python')]);
      expect(created, ['bash-basics']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a rejected create stays on Review with the core message', (
      tester,
    ) async {
      var created = 0;
      await pumpWizard(
        tester,
        onCreate: ({required goal, required prior}) async =>
            throw const RpcException(-32000, 'skill create failed', {
              'kind': 'skill-create',
              'message': 'could not write the goal folder',
            }),
        onCreated: (_) => created++,
      );

      await goToReview(tester, 'Bash basics');
      expect(find.byKey(_createKey), findsOneWidget);

      await tapAndSettle(tester, _createKey);

      // Still on Review, one actionable message, no success callback.
      expect(find.byKey(_createKey), findsOneWidget);
      expect(find.byKey(_goalKey), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(_errorKey),
          matching: find.text('could not write the goal folder'),
        ),
        findsOneWidget,
      );
      expect(created, 0);
      // The state is kept, so the user can retry without retyping.
      expect(find.text('Bash basics'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Esc backs out one layer and cancels from the Goal step', (
      tester,
    ) async {
      var cancels = 0;
      await pumpWizard(tester, onCancel: () => cancels++);

      await goToReview(tester, 'Bash basics');

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byKey(_goalKey), findsOneWidget);
      expect(find.text('Bash basics'), findsOneWidget);
      expect(cancels, 0);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(cancels, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Enter continues from the goal field and creates on Review', (
      tester,
    ) async {
      final sent = <String>[];
      await pumpWizard(
        tester,
        onCreate: ({required goal, required prior}) async {
          sent.add(goal);
          return const SkillCreateResult(
            id: 'bash-basics',
            name: 'Bash basics',
            plan: 'template',
          );
        },
      );

      await enterGoal(tester, 'Bash basics');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.byKey(_createKey), findsOneWidget);

      // Nothing is focused inside a field on Review, so Enter is the shortcut.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(sent, ['Bash basics']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Create shows a pending state until the core answers', (
      tester,
    ) async {
      final gate = Completer<SkillCreateResult>();
      final created = <String>[];
      await pumpWizard(
        tester,
        onCreate: ({required goal, required prior}) => gate.future,
        onCreated: created.add,
      );

      await goToReview(tester, 'Bash basics');
      await tester.tap(find.byKey(_createKey));
      await tester.pump();

      expect(find.text('creating…'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(_createKey)).onPressed,
        isNull,
      );
      expect(created, isEmpty);

      gate.complete(
        const SkillCreateResult(
          id: 'bash-basics',
          name: 'Bash basics',
          plan: 'template',
        ),
      );
      await tester.pumpAndSettle();

      expect(created, ['bash-basics']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the wizard fits 800x600 and a narrow window', (tester) async {
      for (final size in const [
        Size(800, 600),
        Size(640, 600),
        Size(460, 640),
      ]) {
        await pumpWizard(tester, width: size.width, height: size.height);
        expect(tester.takeException(), isNull, reason: 'goal at $size');

        await goToReview(tester, 'Bash basics');
        expect(tester.takeException(), isNull, reason: 'review at $size');
      }
    });
  });

  group('SkillsPage onCreate', () {
    testWidgets('n asks the shell for the wizard', (tester) async {
      var creates = 0;
      tester.view.physicalSize = const Size(800, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: lockedInTheme(),
          home: Scaffold(
            body: SkillsPage(
              skills: const <SkillRow>[],
              loading: false,
              onCreate: () => creates++,
            ),
          ),
        ),
      );
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pump();
      expect(creates, 1);

      // The empty state offers the same action, not a dead button.
      await tester.tap(find.byKey(const ValueKey('skills-new-goal')));
      await tester.pump();
      expect(creates, 2);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore.createSkill', () {
    test('creates through skill.create and then opens the new goal', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      core.calls.clear();

      final result = await store.createSkill(
        goal: 'Bash scripting basics',
        prior: 'I know some Python',
      );

      expect(
        core.calls,
        containsAllInOrder(['skill.create', 'skill.list', 'skill.open']),
      );
      expect(core.skillCreates.single, {
        'goal': 'Bash scripting basics',
        'prior': 'I know some Python',
      });
      expect(result.plan, 'template');
      expect(result.templatePlan, isTrue);
      // The shell lands on the new goal's index, with the template chapter.
      expect(store.activeSkillId, result.id);
      expect(store.activeSkill?.goal, 'Bash scripting basics');
      expect(store.activeSkill?.prior, 'I know some Python');
      expect(store.activeSkill?.chapters.single.title, 'Getting started');
      expect(store.activeSkill?.modelPlan, isFalse);
      expect(store.skills.any((row) => row.id == result.id), isTrue);
      expect(store.error, isNull);
    });

    test('an omitted prior is not sent, and a refusal rethrows', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      core.calls.clear();

      await store.createSkill(goal: 'Bash basics');
      expect(core.skillCreates.single, {'goal': 'Bash basics', 'prior': ''});

      // An invalid create is the wizard's to show: it never reaches [error].
      await expectLater(
        store.createSkill(goal: '   '),
        throwsA(isA<RpcException>()),
      );
      expect(store.error, isNull);
      expect(store.activeSkillId, isNotNull);
    });
  });

  group('Shell New skill goal', () {
    testWidgets('n opens the wizard and Create lands on the new goal', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await pumpShell(
        tester,
        core: core,
        size: const Size(800, 600),
      );
      await openSurface(tester, 3);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();

      expect(find.text('New skill goal'), findsOneWidget);
      expect(find.text('NEW SKILL'), findsOneWidget);
      expect(find.text('Tab next · Enter continue · Esc back'), findsOneWidget);
      expect(find.text('Read disassembly output'), findsNothing);
      expect(tester.takeException(), isNull);

      await enterGoal(tester, 'Bash scripting basics');
      await enterPrior(tester, 'I know some Python');
      await tapAndSettle(tester, _nextKey);
      expect(find.text('REVIEW'), findsOneWidget);

      await tapAndSettle(tester, _createKey);

      expect(core.skillCreates.single, {
        'goal': 'Bash scripting basics',
        'prior': 'I know some Python',
      });
      expect(store.activeSkillId, isNotNull);
      expect(store.activeSkill?.goal, 'Bash scripting basics');
      // The shell swapped the wizard for the new goal's course index.
      expect(find.text('New skill goal'), findsNothing);
      expect(find.text('SKILL'), findsOneWidget);
      expect(find.text('plan · template'), findsOneWidget);
      expect(find.text('Getting started'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Esc cancels the wizard without a create or an open goal', (
      tester,
    ) async {
      final core = FakeCore();
      final store = await pumpShell(tester, core: core);
      await openSurface(tester, 3);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(find.text('New skill goal'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();

      expect(find.text('New skill goal'), findsNothing);
      expect(find.text('SKILLS'), findsWidgets);
      expect(store.activeSkill, isNull);
      expect(core.skillCreates, isEmpty);
      expect(core.calls.where((call) => call == 'skill.create'), isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('leaving Skills closes the wizard and keeps the open goal', (
      tester,
    ) async {
      final store = await pumpShell(tester);
      await openSurface(tester, 3);

      // The wizard is a layer of Skills: another surface closes it.
      await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
      await tester.pumpAndSettle();
      expect(find.text('New skill goal'), findsOneWidget);

      await openSurface(tester, 1);
      await openSurface(tester, 3);
      expect(find.text('New skill goal'), findsNothing);
      expect(find.text('SKILLS'), findsWidgets);
      expect(store.activeSkill, isNull);

      // An open goal survives the same round trip.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(store.activeSkillId, FakeCore.skillId);

      await openSurface(tester, 1);
      await openSurface(tester, 3);
      expect(store.activeSkillId, FakeCore.skillId);
      expect(find.text('SKILL'), findsOneWidget);
      expect(find.text('COURSE'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
