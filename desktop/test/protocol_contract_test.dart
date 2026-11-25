import 'package:flutter_test/flutter_test.dart';
import 'package:lockedin_desktop/bridge/models.dart';

/// The shell's decoders against the documented core shapes.
///
/// This is a hand-written drift guard: a rename on the TypeScript side that the
/// bridge does not follow should fail here, before it becomes a blank screen.
/// It is deliberately not a generated binding yet; it covers the models the
/// shell reads on every surface.
void main() {
  test('SettingsView reads the documented shape', () {
    final view = SettingsView.fromJson({
      'username': 'friend',
      'theme': 'lockedin',
      'chatModel': 'openai/gpt-4.1-mini',
      'baseUrl': '',
      'maxToolCalls': 8,
      'maxTokensPerRequest': 16000,
      'budgetUsd': 5.0,
      'period': 'month',
      'warnAt': 0.8,
      'pauseAtLimit': true,
      'dataDir': '/home/friend/.local/share/lockedin',
      'archiveBackend': 'folder',
      'archiveFolder': '/home/friend/archive',
      'historyLimit': 20,
      'responseStyle': 'normal',
      'tutorPolicy': 'direct',
      'pluginServers': ['notes'],
      'hideHints': false,
      'pluginDirs': [],
      'disabledPlugins': [],
    });
    expect(view.username, 'friend');
    expect(view.chatModel, 'openai/gpt-4.1-mini');
    expect(view.budgetUsd, 5.0);
    expect(view.period, 'month');
    expect(view.pluginServers, ['notes']);
  });

  test('ChatSnapshot reads messages, usage and a failure', () {
    final snapshot = ChatSnapshot.fromJson({
      'status': 'failed',
      'model': 'openai/gpt-4.1-mini',
      'streamed': '',
      'messages': [
        {'id': 'm1', 'role': 'user', 'text': 'hello', 'outcome': 'done'},
        {'id': 'm2', 'role': 'assistant', 'text': '', 'outcome': 'failed'},
      ],
      'usage': {'tokens': 12, 'costMicroUsd': 1000, 'durationMs': 250},
      'error': {
        'failed': 'provider refused',
        'kept': 'nothing was sent',
        'next': 'fix the key',
      },
    });
    expect(snapshot.status, 'failed');
    expect(snapshot.hasModel, isTrue);
    expect(snapshot.messages, hasLength(2));
    expect(snapshot.usage.tokens, 12);
    expect(snapshot.usage.costMicroUsd, 1000);
    expect(snapshot.error?.failed, 'provider refused');
  });

  test('SessionDetail reads sources, steps and memory', () {
    final detail = SessionDetail.fromJson({
      'id': '2026-11-01-0900-physics',
      'name': 'Physics',
      'created': '2026-11-01T09:00:00Z',
      'archived': false,
      'prompt': 'Summarise.',
      'sources': [
        {
          'name': 'lecture.md',
          'originalPath': '/input/lecture.md',
          'storedPath': 'sources/lecture.md',
          'hash': 'sha256:abc',
          'kind': 'markdown',
        },
      ],
      'steps': {
        'done': 1,
        'total': 2,
        'exists': true,
        'markdown': '# Steps\n\n- [x] one\n- [ ] two\n',
      },
      'memory': {
        'points': ['boundary conditions set the limits'],
        'folded': [],
        'updated': '2026-11-01T15:00:00Z',
      },
    });
    expect(detail.sources.single.name, 'lecture.md');
    expect(detail.steps.done, 1);
    expect(detail.memory?.points.single, contains('boundary'));
  });

  test('SkillDetail reads chapters, chats and stages', () {
    final skill = SkillDetail.fromJson({
      'id': 'read-disassembly',
      'name': 'Read disassembly',
      'goal': 'Read disassembly',
      'prior': 'C',
      'created': '2026-11-01T09:00:00Z',
      'plan': 'model',
      'chapters': [
        {
          'id': 'ch-1',
          'title': 'Registers',
          'guide': '01-registers.md',
          'practical': '01-registers-practical.md',
          'done': true,
        },
      ],
      'chats': [
        {
          'id': 'chat-1',
          'title': 'Where do I start?',
          'lastUsed': '2026-11-01T09:05:06Z',
          'messages': 2,
        },
      ],
      'stages': [
        {'id': 'stage-1', 'title': 'Basics', 'status': 'active'},
      ],
    });
    expect(skill.modelPlan, isTrue);
    expect(skill.chapters.single.done, isTrue);
    expect(skill.chats.single.title, 'Where do I start?');
    expect(skill.stages.single.status, 'active');
  });

  test('UpdateView and PromptNoteView read their shapes', () {
    final update = UpdateView.fromJson({
      'current': '2026.11.12',
      'kind': 'available',
      'version': '2026.12.1',
      'asset': 'lockedin-2026.12.1-bun-linux-x64',
      'url': 'https://github.com/a/b/releases/tag/v2026.12.1',
    });
    expect(update.available, isTrue);
    expect(update.version, '2026.12.1');

    final prompt = PromptNoteView.fromJson({
      'id': 'step',
      'label': 'teach one step',
      'description': 'The prose and check.',
      'note': 'one example',
      'custom': true,
    });
    expect(prompt.custom, isTrue);
    expect(prompt.note, 'one example');
  });

  test('LearningGraph reads nodes, edges and grounding', () {
    final graph = LearningGraph.fromJson({
      'nodes': [
        {
          'id': 'goal:g',
          'kind': 'goal',
          'label': 'Read',
          'detail': 'goal',
          'side': 'skills',
          'context': 'Read',
          'grounded': 'record',
        },
        {
          'id': 'step:g:1',
          'kind': 'step',
          'label': 'A step',
          'detail': 'agent explanation',
          'side': 'skills',
          'context': 'Read',
          'grounded': 'agent',
        },
      ],
      'edges': [
        {'from': 'goal:g', 'to': 'step:g:1', 'kind': 'contains'},
      ],
      'counts': {'goal': 1, 'step': 1},
      'diagnostics': [],
      'truncated': false,
    });
    expect(graph.nodes, hasLength(2));
    expect(graph.node('step:g:1')?.isAgent, isTrue);
    expect(graph.edges.single.kind, 'contains');
  });
}
