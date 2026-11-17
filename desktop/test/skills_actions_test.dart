import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/skills/skills_page.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _skills = <SkillRow>[
  SkillRow(
    id: 'disassembly-basics-3f9a1c',
    name: 'Read disassembly output',
    stageDone: 2,
    stageTotal: 4,
    chaptersDone: 1,
    chaptersTotal: 3,
    lastOpened: '2026-11-15T08:30:00Z',
    chats: 2,
    archived: false,
  ),
  SkillRow(
    id: 'rust-ownership-9c2d4e',
    name: 'Rust ownership',
    stageDone: 0,
    stageTotal: 0,
    lastOpened: '',
    chats: 0,
    archived: false,
  ),
];

const _firstId = 'disassembly-basics-3f9a1c';
const _firstName = 'Read disassembly output';

Future<void> pumpSkills(
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

Future<CoreStore> startedStore([FakeCore? core]) async {
  final store = CoreStore(connection: core ?? FakeCore());
  addTearDown(store.dispose);
  await store.start();
  // The goal rows are read when the Skills surface is entered, not on boot.
  await store.refreshSkills();
  return store;
}

void main() {
  group('skills manager actions', () {
    testWidgets('a asks first and names the goal', (tester) async {
      final archived = <String>[];
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onArchive: (id) async {
            archived.add(id);
            return 'folder';
          },
        ),
      );

      expect(find.text('a archive · d delete · x export'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();

      expect(find.text('archive goal'), findsOneWidget);
      expect(find.text('Archive “$_firstName”?'), findsOneWidget);
      expect(find.textContaining('chats are not included'), findsOneWidget);
      expect(archived, isEmpty);

      await tester.tap(find.byKey(const ValueKey('skill-archive-cancel')));
      await tester.pumpAndSettle();

      expect(find.text('archive goal'), findsNothing);
      expect(archived, isEmpty);
      expect(find.text(_firstName), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('confirming the archive calls the core once and reports it', (
      tester,
    ) async {
      final archived = <String>[];
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onArchive: (id) async {
            archived.add(id);
            return 'folder';
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('skill-archive-confirm')));
      await tester.pumpAndSettle();

      expect(archived, [_firstId]);
      expect(
        find.text('archived “$_firstName” to the folder archive'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('skills-action-notice')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('d names the goal and lists what a delete removes', (
      tester,
    ) async {
      final deleted = <String>[];
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onDelete: (id) async => deleted.add(id),
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();

      expect(find.text('delete goal'), findsOneWidget);
      expect(find.text('Delete “$_firstName”?'), findsOneWidget);
      expect(find.textContaining('goal and its lessons'), findsOneWidget);
      expect(deleted, isEmpty);

      await tester.tap(find.byKey(const ValueKey('skill-delete-cancel')));
      await tester.pumpAndSettle();
      expect(deleted, isEmpty);
      expect(find.text(_firstName), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('skill-delete-confirm')));
      await tester.pumpAndSettle();

      expect(deleted, [_firstId]);
      expect(find.text('deleted “$_firstName”'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('x asks first and reports the path the core chose', (
      tester,
    ) async {
      final exported = <String>[];
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onExport: (id) async {
            exported.add(id);
            return '/tmp/lockedin/exports/goal-$id.zip';
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();

      expect(find.text('export goal'), findsOneWidget);
      expect(find.text('Export “$_firstName”?'), findsOneWidget);
      expect(exported, isEmpty);

      await tester.tap(find.byKey(const ValueKey('skill-export-confirm')));
      await tester.pumpAndSettle();

      expect(exported, [_firstId]);
      expect(
        find.text('exported to /tmp/lockedin/exports/goal-$_firstId.zip'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a refused action shows the core message and keeps the row', (
      tester,
    ) async {
      const message = 'set an archive folder in Settings → Storage first';
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onArchive: (id) async {
            throw const RpcException(-32000, message, {
              'kind': 'archive',
              'id': _firstId,
              'message': message,
            });
          },
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('skill-archive-confirm')));
      await tester.pumpAndSettle();

      expect(find.text(message), findsOneWidget);
      expect(find.byKey(const ValueKey('skills-action-error')), findsOneWidget);
      expect(find.text(_firstName), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an in-flight action marks the row and blocks the verbs', (
      tester,
    ) async {
      final pending = Completer<String?>();
      var deletes = 0;
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onArchive: (id) => pending.future,
          onDelete: (id) async => deletes++,
        ),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('skill-archive-confirm')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('skill-row-busy')), findsOneWidget);
      expect(find.text('working…'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.pump();
      expect(find.byType(AlertDialog), findsNothing);
      expect(deletes, 0);

      pending.complete('folder');
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('skill-row-busy')), findsNothing);
      expect(
        find.text('archived “$_firstName” to the folder archive'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('the action hints and a confirmation fit 800x600 and narrow', (
      tester,
    ) async {
      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onArchive: (id) async => 'folder',
          onDelete: (id) async {},
          onExport: (id) async => '/tmp/export.zip',
        ),
        size: const Size(800, 600),
      );

      expect(find.text('a archive · d delete · x export'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pumpAndSettle();
      expect(find.text('Archive “$_firstName”?'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(find.byKey(const ValueKey('skill-archive-cancel')));
      await tester.pumpAndSettle();

      await pumpSkills(
        tester,
        SkillsPage(
          skills: _skills,
          loading: false,
          onArchive: (id) async => 'folder',
          onDelete: (id) async {},
          onExport: (id) async => '/tmp/export.zip',
        ),
        size: const Size(560, 640),
      );
      await tester.pumpAndSettle();
      expect(find.text('a archive · d delete · x export'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyX);
      await tester.pumpAndSettle();
      expect(find.text('Export “$_firstName”?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('CoreStore skill actions', () {
    test(
      'archiveSkill drops the row, closes the goal and names the backend',
      () async {
        final core = FakeCore();
        final store = await startedStore(core);
        await store.openSkill(FakeCore.stagedSkillId);
        expect(store.activeSkillId, FakeCore.stagedSkillId);

        final backend = await store.archiveSkill(FakeCore.stagedSkillId);

        expect(backend, 'folder');
        expect(core.skillArchiveCalls, [FakeCore.stagedSkillId]);
        expect(core.archivedSkillIds, [FakeCore.stagedSkillId]);
        expect(
          store.skills.map((row) => row.id),
          isNot(contains(FakeCore.stagedSkillId)),
        );
        expect(store.activeSkill, isNull);
        expect(store.activeSkillId, isNull);
        // The list was re-read after the confirmed move.
        expect(core.calls.last, 'skill.list');
        expect(store.error, isNull);
      },
    );

    test('removeSkill deletes the row and closes an open goal', () async {
      final core = FakeCore();
      final store = await startedStore(core);
      await store.openSkill(FakeCore.stagedSkillId);
      expect(store.activeSkillId, FakeCore.stagedSkillId);

      await store.removeSkill(FakeCore.stagedSkillId);

      expect(core.skillRemoveCalls, [FakeCore.stagedSkillId]);
      expect(core.removedSkillIds, [FakeCore.stagedSkillId]);
      expect(
        store.skills.map((row) => row.id),
        isNot(contains(FakeCore.stagedSkillId)),
      );
      expect(store.activeSkill, isNull);
      expect(core.calls.last, 'skill.list');
      expect(store.error, isNull);
    });

    test('exportSkill returns the zip path and keeps the row', () async {
      final core = FakeCore();
      final store = await startedStore(core);

      final path = await store.exportSkill(FakeCore.stagedSkillId);

      expect(path, '/tmp/lockedin/exports/goal-${FakeCore.stagedSkillId}.zip');
      expect(core.skillExportCalls, [FakeCore.stagedSkillId]);
      expect(
        store.skills.map((row) => row.id),
        contains(FakeCore.stagedSkillId),
      );
      expect(core.calls.last, 'skill.list');
      expect(store.error, isNull);
    });

    test('a refused manager action rethrows and leaves everything', () async {
      const message = 'set an archive folder in Settings → Storage first';
      final core = FakeCore(skillManagerFailure: message);
      final store = await startedStore(core);

      await expectLater(
        store.archiveSkill(FakeCore.stagedSkillId),
        throwsA(isA<RpcException>()),
      );

      expect(core.skillArchiveCalls, isEmpty);
      expect(core.archivedSkillIds, isEmpty);
      expect(
        store.skills.map((row) => row.id),
        contains(FakeCore.stagedSkillId),
      );
      // A page-local refusal never becomes the shell's transport error.
      expect(store.error, isNull);
    });

    test('saveSkillStages sends the whole list and adopts the reply', () async {
      final core = FakeCore();
      final store = await startedStore(core);
      await store.openSkill(FakeCore.stagedSkillId);
      final stages = store.activeSkill!.stages;

      final saved = await store.saveSkillStages(FakeCore.stagedSkillId, [
        SkillStage(
          id: stages[0].id,
          title: 'Registers',
          status: stages[0].status,
          milestone: 'Explain a stack frame',
        ),
        SkillStage(
          id: stages[1].id,
          title: 'Branches and jumps',
          status: stages[1].status,
        ),
        SkillStage(
          id: stages[2].id,
          title: stages[2].title,
          status: stages[2].status,
          milestone: stages[2].milestone,
        ),
        SkillStage(
          id: '',
          title: 'Tooling',
          status: 'pending',
          milestone: 'Disassemble one binary',
        ),
      ]);

      expect(core.skillStageSaves, hasLength(1));
      expect(core.skillStageSaves.single['confirmed'], isFalse);
      expect(saved.stages, hasLength(4));
      expect(saved.stages.map((stage) => stage.title), [
        'Registers',
        'Branches and jumps',
        'Calling conventions',
        'Tooling',
      ]);
      expect(saved.stages.last.id, 'stage-4');
      expect(saved.stages.last.status, 'pending');
      expect(saved.stages.last.milestone, 'Disassemble one binary');
      // The open goal's stages are replaced from the reply, not a local guess.
      expect(store.activeSkill!.stages.last.title, 'Tooling');
      expect(store.activeSkill!.stages[1].title, 'Branches and jumps');
      expect(store.error, isNull);
    });

    test('a refused curriculum save rethrows and keeps the stages', () async {
      const message =
          'removing “Calling conventions” discards completed progress';
      final core = FakeCore(skillStagesFailure: message);
      final store = await startedStore(core);
      await store.openSkill(FakeCore.stagedSkillId);
      final before = store.activeSkill!.stages;
      final titles = before.map((stage) => stage.title).toList();

      await expectLater(
        store.saveSkillStages(FakeCore.stagedSkillId, [
          SkillStage(
            id: before.first.id,
            title: 'Registers',
            status: before.first.status,
          ),
        ]),
        throwsA(isA<RpcException>()),
      );

      expect(core.skillStageSaves, isEmpty);
      expect(store.activeSkill!.stages.map((stage) => stage.title), titles);
      expect(store.error, isNull);
    });

    test('removing a done stage needs confirmed, then saves', () async {
      final core = FakeCore();
      final store = await startedStore(core);
      await store.openSkill(FakeCore.stagedSkillId);
      final stages = store.activeSkill!.stages;
      final kept = [
        for (final stage in stages)
          if (stage.id != FakeCore.readyLessonStageId)
            SkillStage(
              id: stage.id,
              title: stage.title,
              status: stage.status,
              milestone: stage.milestone,
            ),
      ];

      await expectLater(
        store.saveSkillStages(FakeCore.stagedSkillId, kept),
        throwsA(isA<RpcException>()),
      );
      expect(core.skillStageSaves, isEmpty);

      final saved = await store.saveSkillStages(
        FakeCore.stagedSkillId,
        kept,
        confirmed: true,
      );

      expect(core.skillStageSaves.single['confirmed'], isTrue);
      expect(saved.stages.map((stage) => stage.id), [
        FakeCore.missingLessonStageId,
        FakeCore.existingLessonStageId,
      ]);
      expect(store.activeSkill!.stages, hasLength(2));
    });
  });
}
