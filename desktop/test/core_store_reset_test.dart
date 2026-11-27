import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/core_client.dart';

import 'fake_core.dart';

/// A retry builds a new process, which may even boot a different workspace.
/// Everything the dead process told the store has to go back to its constructor
/// default, or the shell shows a screen the new process cannot vouch for.
///
/// This used to be a hand-written list inside `_reconnect`, and it had drifted:
/// `sessions` was kept while `skills` and `projects` were cleared, the `*Loaded`
/// flags were never cleared (so the sidebar printed a fabricated `0`), and
/// `settings`, `stats`, `achievements`, `decision`, `workPermissions`, the
/// custom palette, the study document and the staged lesson all survived.
///
/// Loading every projection into one store and then retrying **that** store is
/// what keeps the list honest: a field added to the store with no line in
/// `_resetForNewProcess` fails here rather than shipping a stale screen.
/// FakeCore plus the projections the reset test needs and the shared fake does
/// not serve (teaching, research, figures, prompts, graph, context, update).
class _RichCore extends FakeCore {
  _RichCore({super.fail});

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    switch (method) {
      case 'teach.state':
        return Future.value({
          'record': {
            'goal': 'Read disassembly output confidently',
            'prior': 'I know C',
            'held': ['Registers hold values'],
            'gaps': <String>[],
            'plan': [
              {'id': 'step-1', 'title': 'Read one instruction'},
            ],
            'checks': <Object>[],
          },
        });
      case 'research.list':
        return Future.value({
          'items': [
            {
              'id': 'research-1',
              'question': 'What does a call save?',
              'created': '2026-11-20T10:00:00Z',
              'sources': [
                {'url': 'https://example.org/a', 'title': 'A'},
              ],
            },
          ],
        });
      case 'research.read':
        return Future.value({
          'item': {
            'id': 'research-1',
            'question': 'What does a call save?',
            'created': '2026-11-20T10:00:00Z',
            'sources': <Object>[],
          },
          'markdown': '# Brief\n\nA saved answer.\n',
        });
      case 'session.figure.list':
        return Future.value({
          'figures': [
            {
              'id': 'figure-1',
              'source': 'sources/notes.pdf',
              'page': 2,
              'caption': 'A stack frame',
              'note': '',
              'file': 'figure-1.png',
              'createdAt': '2026-11-20T10:00:00Z',
            },
          ],
        });
      case 'prompts.list':
        return Future.value({
          'items': [
            {
              'id': 'measure',
              'label': 'measure and plan',
              'description': 'The measurement prompt',
              'note': 'prefer short sentences',
              'custom': true,
            },
          ],
        });
      case 'knowledge.graph':
        return Future.value({
          'graph': {
            'nodes': <Object>[],
            'edges': <Object>[],
            'counts': <String, int>{},
            'diagnostics': <Object>[],
            'truncated': false,
          },
        });
      case 'session.chat.context':
        return Future.value({
          'messages': 12,
          'kept': 8,
          'summaryChars': 210,
          'through': 4,
          'tokens': 1840,
          'window': 128000,
          'fraction': 0.014,
          'compactable': true,
        });
      case 'update.info':
        return Future.value({
          'current': '2026.11.27',
          'repo': 'Jacob-Chamney/LockedIn-Tui',
        });
      case 'update.check':
        return Future.value({
          'current': '2026.11.27',
          'kind': 'current',
          'latest': '2026.11.27',
        });
    }
    return super.call(method, params);
  }
}

void main() {
  /// Fill every projection the store can hold from a live core.
  Future<void> loadEveryProjection(CoreStore store) async {
    await store.start();

    // Surfaces read on entry rather than at boot.
    await store.refreshSkills();
    await store.refreshProjects();
    await store.refreshDecision();
    await store.refreshWorkPermissions();
    await store.refreshAchievements();
    await store.refreshCustomTheme();
    await store.refreshWorkTemplates(FakeCore.projectId);
    await store.refreshArchive();
    await store.refreshReview();
    await store.refreshMcp();
    await store.selectStats(range: '30d', scope: 'skills');
    await store.searchKnowledge('registers');

    // An open session, with its instructions, coverage and output.
    await store.openSession(FakeCore.sessionId);
    await store.readCoverage(FakeCore.sessionId);
    await store.readOutput(FakeCore.sessionId, 'study-guide');
    await store.saveSessionInstructions(FakeCore.sessionId, 'new prompt');

    // An open project and goal, and the knowledge tree.
    await store.openProject(FakeCore.projectId);
    await store.refreshWorkChanges(FakeCore.projectId);
    await store.openSkill(FakeCore.skillId);
    await store.loadKnowledgeTree();

    // The projections added after the reset list was first written.
    await store.readTeaching(FakeCore.skillId);
    await store.readResearch(FakeCore.skillId);
    await store.openResearch(FakeCore.skillId, 'research-1');
    await store.readFigures(FakeCore.sessionId);
    await store.refreshPrompts();
    await store.readLearningGraph();
    await store.readSessionContext(FakeCore.sessionId);
    await store.refreshUpdateInfo();
    await store.checkForUpdates();
  }

  test('every projection the fixture fills really holds data', () async {
    final store = CoreStore(connection: _RichCore());
    addTearDown(store.dispose);
    await loadEveryProjection(store);

    // The guard for the test below: if this fails, the reset assertions are
    // passing because there was nothing to reset.
    expect(store.workspace, isNotNull);
    expect(store.sessions, isNotEmpty);
    expect(store.sessionsLoaded, isTrue);
    expect(store.skills, isNotEmpty);
    expect(store.skillsLoaded, isTrue);
    expect(store.projects, isNotEmpty);
    expect(store.projectsLoaded, isTrue);
    expect(store.stats, isNotNull);
    expect(store.statsRange, '30d');
    expect(store.statsScope, 'skills');
    expect(store.settings, isNotNull);
    expect(store.chat, isNotNull);
    expect(store.decision, isNotNull);
    expect(store.workPermissions, isNotNull);
    expect(store.achievements, isNotEmpty);
    expect(store.workTemplates, isNotEmpty);
    expect(store.archiveRows, isNotEmpty);
    expect(store.review, isNotNull);
    expect(store.mcpServers, isNotEmpty);
    expect(store.knowledgeHits, isNotEmpty);
    expect(store.knowledgeQuery, 'registers');
    expect(store.activeSessionId, FakeCore.sessionId);
    expect(store.activeProjectId, FakeCore.projectId);
    expect(store.activeSkillId, FakeCore.skillId);
    expect(store.outputKind, 'study-guide');
    expect(store.coverage, isNotNull);

    // The late projections must hold data too, or their reset assertions
    // below would pass for the wrong reason.
    expect(store.teaching, isNotNull);
    expect(store.research, isNotEmpty);
    expect(store.researchMarkdown, isNotNull);
    expect(store.figures, isNotEmpty);
    expect(store.prompts, isNotEmpty);
    expect(store.learningGraph, isNotNull);
    expect(store.sessionContext, isNotNull);
    expect(store.appVersion, '2026.11.27');
    expect(store.updateState, isNotNull);
  });

  test('a retry clears every projection the dead process filled', () async {
    // The replacement process fails to boot, so nothing can be re-read: what
    // the store holds after `retry()` is exactly what the reset produced.
    final store = CoreStore(
      connection: _RichCore(),
      reconnectFactory: () => _RichCore(fail: true),
    );
    addTearDown(store.dispose);
    await loadEveryProjection(store);
    expect(store.sessions, isNotEmpty, reason: 'fixture did not load');

    await store.retry();

    // Identity and configuration.
    expect(store.workspace, isNull, reason: 'workspace survived the retry');
    expect(store.settings, isNull, reason: 'settings survived the retry');
    expect(store.settingsError, isNull);

    // Lists and their `Loaded` flags: a stale `true` prints a fabricated 0.
    expect(store.sessions, isEmpty);
    expect(store.sessionsLoaded, isFalse);
    expect(store.skills, isEmpty);
    expect(store.skillsLoaded, isFalse);
    expect(store.projects, isEmpty);
    expect(store.projectsLoaded, isFalse);

    // Read-on-entry projections.
    expect(store.stats, isNull);
    expect(store.statsRange, 'all');
    expect(store.statsScope, 'all');
    expect(store.decision, isNull);
    expect(store.decisionError, isNull);
    expect(store.workPermissions, isNull);
    expect(store.workPermissionsError, isNull);
    expect(store.achievements, isEmpty);
    expect(store.achievementsEarned, 0);
    expect(store.achievementsTotal, 0);
    expect(store.workTemplates, isEmpty);
    expect(store.mcpServers, isEmpty);
    expect(store.archiveRows, isEmpty);
    expect(store.review, isNull);
    expect(store.keybinds, isEmpty);
    expect(store.fixedKeybinds, isEmpty);

    // Chat.
    expect(store.chat, isNull);
    expect(store.chatSendError, isNull);
    expect(store.chatError, isNull);

    // Knowledge, including the query that labels the visible hits.
    expect(store.knowledgeHits, isEmpty);
    expect(store.knowledgeGroups, isEmpty);
    expect(store.knowledgeQuery, '');
    expect(store.knowledgeDocumentOpen, isFalse);

    // Session, project and goal layers.
    expect(store.activeSessionId, isNull);
    expect(store.activeSession, isNull);
    expect(store.activeProjectId, isNull);
    expect(store.activeProject, isNull);
    expect(store.activeWorkChatId, isNull);
    expect(store.activeSkillId, isNull);
    expect(store.activeSkill, isNull);
    expect(store.outputKind, isNull);
    expect(store.outputMarkdown, isNull);
    expect(store.coverage, isNull);
    expect(store.documentOpen, isFalse);
    expect(store.documentLoading, isFalse);
    expect(store.skillLessonOpen, isFalse);

    // The teaching harness, research, figures, deck, context, graph, prompts
    // and update metadata.
    expect(store.teaching, isNull);
    expect(store.teachingError, isNull);
    expect(store.teachingVerdict, isNull);
    expect(store.teachingSide, isEmpty);
    expect(store.research, isEmpty);
    expect(store.researchError, isNull);
    expect(store.researchMarkdown, isNull);
    expect(store.researchOpenId, isNull);
    expect(store.figures, isEmpty);
    expect(store.figureError, isNull);
    expect(store.deckSchedule, isNull);
    expect(store.deckScheduleError, isNull);
    expect(store.sessionContext, isNull);
    expect(store.sessionContextError, isNull);
    expect(store.learningGraph, isNull);
    expect(store.learningGraphError, isNull);
    expect(store.prompts, isEmpty);
    expect(store.promptsError, isNull);
    expect(store.appVersion, isNull);
    expect(store.updateState, isNull);
    expect(store.updateChecking, isFalse);
    expect(store.updateError, isNull);

    // The store is honest about which process it is talking to.
    expect(store.status, CoreStatus.failed);
  });

  test('a retry against a healthy core re-reads every projection', () async {
    final store = CoreStore(
      connection: _RichCore(),
      reconnectFactory: _RichCore.new,
    );
    addTearDown(store.dispose);
    await loadEveryProjection(store);

    // A different model, so a surviving value is visible rather than
    // accidentally identical.
    await store.selectStats(range: '7d');
    await store.retry();

    expect(store.status, CoreStatus.online);
    expect(store.sessions, isNotEmpty);
    expect(store.sessionsLoaded, isTrue);
    expect(store.settings, isNotNull);
    expect(store.error, isNull);
    expect(store.chat, isNotNull);
    // The range is re-derived from the new snapshot, not carried over.
    expect(store.statsRange, 'all');
  });
}
