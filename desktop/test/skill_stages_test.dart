import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _stages = <SkillStage>[
  SkillStage(
    id: 'stage-1',
    title: 'Registers and memory',
    status: 'active',
    milestone: 'Explain a stack frame',
  ),
  SkillStage(id: 'stage-2', title: 'Control flow', status: 'pending'),
  SkillStage(
    id: 'stage-3',
    title: 'Calling conventions',
    status: 'done',
    milestone: 'Trace a call across frames',
  ),
];

const _detail = SkillDetail(
  id: 'stack-frames-7b1c9d',
  name: 'Stack frames',
  goal: 'Trace stack frames in a debugger',
  prior: '',
  created: '2026-11-10T09:00:00Z',
  plan: 'template',
  chapters: <SkillChapter>[],
  chats: <SkillChatRow>[],
  stages: _stages,
);

/// Records every save and answers like the core: existing ids keep their
/// status, a new stage gets the next `stage-<n>` id and `pending`.
class _StageSaver {
  final calls = <({List<SkillStage> stages, bool confirmed})>[];
  var _next = 10;

  List<SkillStage> get sent => calls.last.stages;

  Future<SkillStageSaveResult> save(
    List<SkillStage> stages, {
    bool confirmed = false,
  }) async {
    calls.add((stages: List<SkillStage>.of(stages), confirmed: confirmed));
    return SkillStageSaveResult(
      stages: [
        for (final stage in stages)
          SkillStage(
            id: stage.id.isEmpty ? 'stage-${_next++}' : stage.id,
            title: stage.title,
            status: stage.status,
            milestone: stage.milestone,
          ),
      ],
    );
  }
}

/// A saver that always refuses with the core's `stage` shape.
Future<SkillStageSaveResult> _refuse(
  List<SkillStage> stages, {
  bool confirmed = false,
}) async {
  const message =
      'removing “Calling conventions” discards completed progress; '
      'save again with confirmed: true';
  throw const RpcException(-32000, message, {
    'kind': 'stage',
    'goalId': 'stack-frames-7b1c9d',
    'message': message,
  });
}

Future<void> pumpDetail(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(900, 700),
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
  await tester.pump();
}

/// Presses [key] with Shift held, so `K`/`J` and `Shift+↑`/`Shift+↓` are real.
Future<void> pressShift(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pumpAndSettle();
}

void main() {
  test('a new stage is saved with no id, so the first add works', () async {
    // The core treats a present id as "this stage already exists" and refuses a
    // blank one, so sending `id: ""` made the first add fail in the packaged
    // app. The fake now mirrors that refusal, so this cannot regress.
    final core = FakeCore();
    final store = CoreStore(connection: core);
    addTearDown(store.dispose);
    await store.start();
    await store.openSkill(FakeCore.stagedSkillId);

    final before = store.activeSkill?.stages ?? const <SkillStage>[];
    await store.saveSkillStages(FakeCore.stagedSkillId, [
      ...before,
      const SkillStage(id: '', title: 'Tooling', status: 'pending'),
    ]);

    final after = store.activeSkill?.stages ?? const <SkillStage>[];
    expect(after.map((stage) => stage.title), contains('Tooling'));
    expect(after.last.id, isNotEmpty);
  });

  testWidgets('e enters the curriculum editor and Enter leaves it', (
    tester,
  ) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    expect(find.text('CURRICULUM STAGES'), findsOneWidget);
    expect(find.text('editing'), findsNothing);
    expect(find.textContaining('e edit stages'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();

    expect(find.text('editing'), findsOneWidget);
    expect(find.textContaining('a add'), findsOneWidget);
    expect(find.textContaining('r rename'), findsOneWidget);
    expect(find.textContaining('d remove'), findsOneWidget);
    expect(find.textContaining('Enter done'), findsOneWidget);
    expect(saver.calls, isEmpty);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(find.text('editing'), findsNothing);
    expect(find.textContaining('e edit stages'), findsOneWidget);
    expect(saver.calls, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a adds a stage by sending the whole list', (tester) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(find.text('add a stage'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('skill-stage-add-title')),
      'Profile a crash',
    );
    await tester.enterText(
      find.byKey(const ValueKey('skill-stage-add-milestone')),
      'Name the faulting frame',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('skill-stage-add-confirm')));
    await tester.pumpAndSettle();

    expect(saver.calls, hasLength(1));
    expect(saver.sent, hasLength(4));
    expect(saver.sent.first.id, 'stage-1');
    expect(saver.sent.last.id, '');
    expect(saver.sent.last.title, 'Profile a crash');
    expect(saver.sent.last.status, 'pending');
    expect(saver.sent.last.milestone, 'Name the faulting frame');
    // The reply replaces the visible list, including the assigned id.
    expect(find.text('Profile a crash'), findsOneWidget);
    expect(find.text('Name the faulting frame'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the add prompt refuses a blank title', (tester) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    final confirm = tester.widget<FilledButton>(
      find.byKey(const ValueKey('skill-stage-add-confirm')),
    );
    expect(confirm.onPressed, isNull);

    await tester.tap(find.byKey(const ValueKey('skill-stage-add-cancel')));
    await tester.pumpAndSettle();
    expect(saver.calls, isEmpty);
    expect(find.text('add a stage'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('r renames the selected stage and keeps its status', (
    tester,
  ) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();

    expect(find.text('rename stage'), findsOneWidget);

    await tester.enterText(
      find.byKey(const ValueKey('skill-stage-rename-title')),
      'Branches and jumps',
    );
    await tester.enterText(
      find.byKey(const ValueKey('skill-stage-rename-milestone')),
      'Trace a conditional jump',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('skill-stage-rename-confirm')));
    await tester.pumpAndSettle();

    expect(saver.calls, hasLength(1));
    expect(saver.sent, hasLength(3));
    expect(saver.sent[0].id, 'stage-1');
    expect(saver.sent[1].id, 'stage-2');
    expect(saver.sent[1].title, 'Branches and jumps');
    expect(saver.sent[1].status, 'pending');
    expect(saver.sent[1].milestone, 'Trace a conditional jump');
    expect(saver.sent[2].id, 'stage-3');
    expect(find.text('Branches and jumps'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('d removes a pending stage after a named confirmation', (
    tester,
  ) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();

    expect(find.text('remove stage'), findsOneWidget);
    expect(find.text('Remove “Control flow”?'), findsOneWidget);
    expect(find.textContaining('loses its finished progress'), findsNothing);

    await tester.tap(find.byKey(const ValueKey('skill-stage-remove-cancel')));
    await tester.pumpAndSettle();
    expect(saver.calls, isEmpty);
    expect(find.text('Control flow'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('skill-stage-remove-confirm')));
    await tester.pumpAndSettle();

    expect(saver.calls, hasLength(1));
    expect(saver.calls.single.confirmed, isFalse);
    expect(saver.sent.map((stage) => stage.id), ['stage-1', 'stage-3']);
    expect(find.text('Control flow'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a done-stage removal asks for the extra confirmation', (
    tester,
  ) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
    await tester.pumpAndSettle();

    expect(find.text('Remove “Calling conventions”?'), findsOneWidget);
    expect(find.textContaining('loses its finished progress'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('skill-stage-remove-confirm')));
    await tester.pumpAndSettle();

    expect(saver.calls, hasLength(1));
    expect(saver.calls.single.confirmed, isTrue);
    expect(saver.sent.map((stage) => stage.id), ['stage-1', 'stage-2']);
    expect(find.text('Calling conventions'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('J and K reorder and send the whole list in order', (
    tester,
  ) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();

    await pressShift(tester, LogicalKeyboardKey.keyJ);
    expect(saver.calls, hasLength(1));
    expect(saver.sent.map((stage) => stage.id), [
      'stage-2',
      'stage-1',
      'stage-3',
    ]);

    await pressShift(tester, LogicalKeyboardKey.keyK);
    expect(saver.calls, hasLength(2));
    expect(saver.sent.map((stage) => stage.id), [
      'stage-1',
      'stage-2',
      'stage-3',
    ]);

    await pressShift(tester, LogicalKeyboardKey.arrowDown);
    expect(saver.calls, hasLength(3));
    expect(saver.sent.map((stage) => stage.id), [
      'stage-2',
      'stage-1',
      'stage-3',
    ]);

    await pressShift(tester, LogicalKeyboardKey.arrowUp);
    expect(saver.calls, hasLength(4));
    expect(saver.sent.map((stage) => stage.id), [
      'stage-1',
      'stage-2',
      'stage-3',
    ]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a refusal keeps the previous order and shows the message', (
    tester,
  ) async {
    await pumpDetail(
      tester,
      const SkillDetailView(detail: _detail, onSaveStages: _refuse),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('skill-stage-rename-title')),
      'A name the core refuses',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('skill-stage-rename-confirm')));
    await tester.pumpAndSettle();

    expect(find.textContaining('discards completed progress'), findsOneWidget);
    // The previous curriculum is still what the page shows.
    expect(find.text('Control flow'), findsOneWidget);
    expect(find.text('A name the core refuses'), findsNothing);
    expect(find.text('editing'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Enter, l and b do not open or build while editing', (
    tester,
  ) async {
    final saver = _StageSaver();
    final opened = <String>[];
    final built = <String>[];
    await pumpDetail(
      tester,
      SkillDetailView(
        detail: _detail,
        onSaveStages: saver.save,
        onOpenStage: opened.add,
        onBuildStage: built.add,
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('editing'), findsNothing);
    expect(opened, isEmpty);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
    await tester.pump();
    expect(find.text('editing'), findsOneWidget);
    expect(opened, isEmpty);
    expect(built, isEmpty);

    // Outside edit mode the lesson keys work again.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('editing'), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(opened, ['stage-1']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the card is read-only when the store has no writer', (
    tester,
  ) async {
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onOpenStage: (_) {}),
    );

    expect(find.textContaining('Enter lesson'), findsOneWidget);
    expect(find.textContaining('l lesson'), findsOneWidget);
    expect(find.textContaining('e edit stages'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    expect(find.text('editing'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the editor fits 800x600 and a narrow column', (tester) async {
    final saver = _StageSaver();
    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
      size: const Size(800, 600),
    );

    expect(find.text('CURRICULUM STAGES'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    expect(find.text('editing'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await pumpDetail(
      tester,
      SkillDetailView(detail: _detail, onSaveStages: saver.save),
      size: const Size(520, 700),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.keyE);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();
    expect(find.text('add a stage'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
