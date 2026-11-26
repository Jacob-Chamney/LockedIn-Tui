import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/models.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/features/skills/skill_detail.dart';
import 'package:lockedin_desktop/theme/palette.dart';
import 'package:material_ui/material_ui.dart';

import 'fake_core.dart';

const _chapters = <SkillChapter>[
  SkillChapter(
    id: 'ch-1',
    title: 'Getting started',
    guide: '01-getting-started.md',
    practical: '01-getting-started-practical.md',
    done: false,
  ),
];

const _detail = SkillDetail(
  id: 'disassembly-basics-3f9a1c',
  name: 'Read disassembly output',
  goal: 'Read disassembly output confidently',
  prior: '',
  created: '2026-11-01T09:00:00Z',
  plan: 'template',
  chapters: _chapters,
  chats: <SkillChatRow>[],
);

const _sources = <SkillSourceRow>[
  SkillSourceRow(
    name: 'lecture-4.md',
    storedPath: 'sources/sha256-a1b2-lecture-4.md',
    kind: 'markdown',
    hash: 'sha256:a1b2',
    excerpt: 'Boundary conditions set the limits.',
    excerptLocation: 'sources/sha256-a1b2-lecture-4.md',
  ),
  SkillSourceRow(
    name: 'registers-cheatsheet.pdf',
    storedPath: 'sources/sha256-c3d4-registers-cheatsheet.pdf',
    kind: 'pdf',
    hash: 'sha256:c3d4',
  ),
];

Future<void> pumpPage(
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

void main() {
  testWidgets('the sources card shows names, kinds and saved excerpts', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SkillDetailView(detail: _detail, sources: _sources),
    );

    expect(find.text('SOURCES'), findsOneWidget);
    expect(find.text('2 sources'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.text('registers-cheatsheet.pdf'), findsOneWidget);
    expect(find.text('markdown'), findsOneWidget);
    expect(find.text('pdf'), findsOneWidget);
    expect(find.text('Boundary conditions set the limits.'), findsOneWidget);
    // A source row never shows an original absolute path.
    expect(find.textContaining('/home/'), findsNothing);
    // The read-only page offers no add action.
    expect(find.byKey(const ValueKey('skill-sources-add')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the empty card teaches the add action', (tester) async {
    final picked = <List<String>>[];
    await pumpPage(
      tester,
      SkillDetailView(
        detail: _detail,
        onAddSources: (paths) async {
          picked.add(paths);
          return const SourceAddResult(added: 0, skipped: 0);
        },
      ),
    );

    expect(find.text('0 sources'), findsOneWidget);
    expect(find.text('no sources yet'), findsOneWidget);
    expect(
      find.text('add sources so lessons and chat can cite them'),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('skill-sources-add')), findsOneWidget);
    expect(picked, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a picks files, forwards the paths and reports the counts', (
    tester,
  ) async {
    final picked = <List<String>>[];
    await pumpPage(
      tester,
      SkillDetailView(
        detail: _detail,
        pickFiles: () async => [
          '/home/me/input/bytecode.md',
          '/home/me/input/lecture-4.md',
        ],
        onAddSources: (paths) async {
          picked.add(paths);
          return const SourceAddResult(added: 1, skipped: 1);
        },
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(picked, [
      ['/home/me/input/bytecode.md', '/home/me/input/lecture-4.md'],
    ]);
    expect(find.text('added 1 · skipped 1'), findsOneWidget);
    expect(find.byKey(const ValueKey('skill-sources-notice')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a duplicate-only gather says already gathered', (tester) async {
    await pumpPage(
      tester,
      SkillDetailView(
        detail: _detail,
        sources: _sources,
        pickFiles: () async => ['/home/me/input/lecture-4.md'],
        onAddSources: (paths) async =>
            const SourceAddResult(added: 0, skipped: 1),
      ),
    );

    await tester.ensureVisible(find.byKey(const ValueKey('skill-sources-add')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('skill-sources-add')));
    await tester.pumpAndSettle();

    expect(find.text('already gathered'), findsOneWidget);
    expect(find.textContaining('added 0'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a cancelled pick adds nothing and says nothing', (tester) async {
    var calls = 0;
    await pumpPage(
      tester,
      SkillDetailView(
        detail: _detail,
        sources: _sources,
        pickFiles: () async => const <String>[],
        onAddSources: (paths) async {
          calls += 1;
          return const SourceAddResult(added: 0, skipped: 0);
        },
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(calls, 0);
    expect(find.byKey(const ValueKey('skill-sources-notice')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a refused add shows the core message and keeps the rows', (
    tester,
  ) async {
    await pumpPage(
      tester,
      SkillDetailView(
        detail: _detail,
        sources: _sources,
        pickFiles: () async => ['/home/me/input/reject.pdf'],
        onAddSources: (paths) async {
          throw const RpcException(-32000, 'could not copy reject.pdf', {
            'kind': 'source',
            'goalId': 'disassembly-basics-3f9a1c',
            'message': 'could not copy reject.pdf',
          });
        },
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
    await tester.pumpAndSettle();

    expect(find.text('could not copy reject.pdf'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed list is stated with a retry', (tester) async {
    var retries = 0;
    await pumpPage(
      tester,
      SkillDetailView(
        detail: _detail,
        sources: _sources,
        sourcesError: 'the goal’s source list is malformed',
        onRetrySources: () => retries += 1,
      ),
    );

    expect(find.text('the goal’s source list is malformed'), findsOneWidget);

    await tester.ensureVisible(find.text('Retry'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sources card and the course card fit 800x600', (
    tester,
  ) async {
    await pumpPage(
      tester,
      const SkillDetailView(detail: _detail, sources: _sources),
      size: const Size(800, 600),
    );

    expect(find.text('SOURCES'), findsOneWidget);
    expect(find.text('lecture-4.md'), findsOneWidget);
    expect(find.text('COURSE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  group('CoreStore goal sources', () {
    test('openSkill loads the gathered sources', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.openSkill(FakeCore.skillId);

      expect(core.calls, contains('skill.sources.list'));
      expect(store.skillSources.map((row) => row.name), [
        'lecture-4.md',
        'registers-cheatsheet.md',
      ]);
      expect(
        store.skillSources.first.excerpt,
        'Boundary conditions set the limits.',
      );
      expect(store.skillSources.last.excerpt, isNull);
      expect(store.skillSourcesError, isNull);
      expect(store.skillSourcesLoading, isFalse);
    });

    test('addSkillSources forwards the paths and refreshes the rows', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.skillId);

      final result = await store.addSkillSources(FakeCore.skillId, [
        '/home/me/input/bytecode.md',
      ]);

      expect(result.added, 1);
      expect(result.skipped, 0);
      expect(core.skillSourceAdds, [
        ['/home/me/input/bytecode.md'],
      ]);
      expect(core.calls, contains('skill.sources.add'));
      expect(store.skillSources.map((row) => row.name), [
        'bytecode.md',
        'lecture-4.md',
        'registers-cheatsheet.md',
      ]);
      expect(store.skillSourcesError, isNull);
    });

    test('re-adding the same file is skipped and adds no row', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.skillId);
      final before = store.skillSources.length;

      final result = await store.addSkillSources(FakeCore.skillId, [
        '/home/me/input/lecture-4.md',
      ]);

      expect(result.added, 0);
      expect(result.skipped, 1);
      expect(store.skillSources, hasLength(before));
    });

    test('a refused add rethrows and leaves the rows alone', () async {
      final core = FakeCore();
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.skillId);
      final before = store.skillSources.map((row) => row.name).toList();

      await expectLater(
        store.addSkillSources(FakeCore.skillId, ['/home/me/input/reject.pdf']),
        throwsA(isA<RpcException>()),
      );

      expect(store.skillSources.map((row) => row.name), before);
      expect(core.skillSourceAdds, isEmpty);
    });

    test('a failed list is page-local and keeps the previous rows', () async {
      final core = FakeCore(
        skillSourcesFailure: 'the goal folder is unreadable',
      );
      final store = CoreStore(connection: core);
      addTearDown(store.dispose);
      await store.start();

      await store.openSkill(FakeCore.skillId);

      expect(store.skillSourcesError, 'the goal folder is unreadable');
      expect(store.skillSources, isEmpty);
      // The goal page still opens; a source failure is not a shell failure.
      expect(store.error, isNull);
      expect(store.activeSkillId, FakeCore.skillId);
    });

    test('closeSkill clears the source slice', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();
      await store.openSkill(FakeCore.skillId);
      expect(store.skillSources, isNotEmpty);

      store.closeSkill();

      expect(store.skillSources, isEmpty);
      expect(store.skillSourcesError, isNull);
      expect(store.skillSourcesLoading, isFalse);
    });

    test('a created goal starts with no gathered sources', () async {
      final store = CoreStore(connection: FakeCore());
      addTearDown(store.dispose);
      await store.start();

      final created = await store.createSkill(goal: 'Read ELF headers');

      expect(store.activeSkillId, created.id);
      expect(store.skillSources, isEmpty);
      expect(store.skillSourcesError, isNull);
    });
  });
}
