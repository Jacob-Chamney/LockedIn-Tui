import 'dart:async';

import 'package:lockedin_desktop/bridge/core_client.dart';
import 'package:lockedin_desktop/bridge/protocol.dart';
import 'package:lockedin_desktop/keymap/binding.dart';
import 'package:lockedin_desktop/theme/palette.dart';

/// A transport-only fake for widget tests; no process, no workspace.
class FakeCore implements CoreConnection {
  FakeCore({
    this.configured = true,
    this.fail = false,
    this.withProjects = true,
    this.mcpRefreshFailure,
    this.generateStepsFailure,
    this.documentFailure,
    this.skillChapterFailure,
    this.skillSourcesFailure,
    this.skillLessonFailure,
    this.skillLessonBuildFailure,
    this.skillStagesFailure,
    this.skillManagerFailure,
    this.sessionActionFailure,
    this.instructionsFailure,
    this.statsExportFailure,
    this.archiveEmpty = false,
    this.archiveFailure,
    this.knowledgeFailure,
    this.knowledgeReadFailure,
    this.knowledgeEmpty = false,
    this.archiveRestoreFailure,
    this.archiveRemoveFailure,
    this.outputMissing = false,
    this.outputFailure,
    this.reviewMarkFailure,
    this.approvalDecideFailure,
    this.withSwarms = true,
    this.activityEmpty = false,
    this.activityFailure,
    this.achievementsFailure,
    this.achievementsWarning,
    this.swarmFailure,
    this.permissionConfirmFailure,
    this.withMemory = true,
    this.coverageEmpty = false,
    this.coverageFailure,
    String? stepsMarkdown,
    String? sessionPrompt,
    Map<String, dynamic>? instructionsSource,
  }) : _stepsMarkdown = stepsMarkdown ?? _defaultStepsMarkdown {
    _chatModel = configured ? 'openai/gpt-4.1-mini' : '';
    _linked = configured;
    _prompt = sessionPrompt ?? 'Explain the problem set.';
    if (instructionsSource != null) {
      _instructionsBySession[sessionId] = Map<String, dynamic>.from(
        instructionsSource,
      );
    }
    if (withProjects) _seedProjects();
    _seedSkillChats();
    _seedApprovals();
    if (withSwarms) _seedSwarms();
  }

  final bool configured;
  final bool fail;

  /// Seed the two Work projects. A test that needs the empty state passes
  /// `withProjects: false`.
  final bool withProjects;

  /// A connect failure `mcp.refresh` reports on the second server's row, so a
  /// test can render a failed server beside healthy ones. `mcp.list` always
  /// answers the healthy rows.
  final String? mcpRefreshFailure;

  /// When set, `session.generateSteps` answers with this typed generation error
  /// (`data.kind == "generation"`) and writes nothing, exactly like a provider
  /// failure or a workspace with no model. A test that needs a successful build
  /// leaves it null.
  final String? generateStepsFailure;

  /// When set, `session.document` answers with this typed generation error
  /// (`data.kind == "generation"`) and writes nothing, exactly like a provider
  /// failure, a refused plan or a workspace with no model. An `attempt`
  /// containing `reject` is the per-request sentinel for the same refusal.
  final String? documentFailure;

  /// When set, `skill.chapter` answers with this typed chapter error
  /// (`data.kind == "chapter"`) and reads nothing, exactly like a missing or
  /// unreadable lesson file. A test that needs a successful read leaves it null.
  final String? skillChapterFailure;

  /// When set, `skill.sources.list` and `skill.sources.add` answer with this
  /// typed `source` refusal (`data.kind == "source"`) and touch nothing, exactly
  /// like a goal whose `meta.json` cannot be read or a copy the core refused. A
  /// file path containing `reject` is the per-request add sentinel.
  final String? skillSourcesFailure;

  /// When set, `skill.lesson.read` and `skill.lesson.build` answer with this
  /// typed `lesson` refusal (`data.kind == "lesson"`) and write nothing, exactly
  /// like an unreadable lesson file, a refused citation or a failed build. A
  /// stage id of [readyLessonStageId] is the per-request `confirm` sentinel.
  final String? skillLessonFailure;

  /// When set, only `skill.lesson.build` answers with this typed `lesson`
  /// refusal, exactly like a build the core refused, so a test can read a
  /// lesson successfully and then fail only the rebuild.
  final String? skillLessonBuildFailure;

  /// When set, `skill.stages.save` answers with this typed `stages` refusal and
  /// writes nothing, exactly like a core that rejected the curriculum (for
  /// example removing a `done` stage without `confirmed`).
  final String? skillStagesFailure;

  /// When set, `skill.archive`, `skill.remove` and `skill.export` answer with
  /// this typed `skill-action` refusal and touch nothing, exactly like a core
  /// that attempted the action and did not do it. A test that needs a successful
  /// action leaves it null.
  final String? skillManagerFailure;

  /// When set, `session.archive`, `session.remove` and `session.export` answer
  /// with this typed `session-action` refusal and touch nothing, exactly like a
  /// core that attempted the action and did not do it. A test that needs a
  /// successful action leaves it null.
  final String? sessionActionFailure;

  /// When set, `session.instructions.save/import/reextract` answer with this
  /// typed `instructions` refusal and touch nothing, exactly like a core that
  /// could not write the prompt. `session.instructions.get` still answers, so a
  /// test can load the pane and then fail a write. A file path containing
  /// `reject` is the per-request import sentinel.
  final String? instructionsFailure;

  /// When set, `stats.export` answers with this typed `stats` error
  /// (`data.kind == "stats"`) and returns no document, exactly like a core whose
  /// counters could not be read. A test that needs a successful export leaves it
  /// null.
  final String? statsExportFailure;

  /// When true, `archive.list` answers the documented empty success
  /// (`{rows: []}`), like a folder backend with nothing archived yet. A test
  /// that needs the two rows leaves it false.
  final bool archiveEmpty;

  /// When set, `archive.list` answers with this typed `archive` refusal
  /// (`data.kind == "archive"`) and lists nothing, exactly like a core whose
  /// configured backend cannot be built. A test that needs a successful read
  /// leaves it null.
  final String? archiveFailure;

  /// When set, `archive.restore` answers with this typed `session-action`
  /// refusal and moves nothing, exactly like a core whose restore was attempted
  /// and failed. A test that needs a successful restore leaves it null.
  final String? archiveRestoreFailure;

  /// When set, `archive.remove` answers with this typed `archive` refusal and
  /// deletes nothing, exactly like a core whose delete was attempted and failed.
  final String? archiveRemoveFailure;

  /// When set, `knowledge.tree` and `knowledge.search` answer with this typed
  /// `knowledge` refusal and read nothing, exactly like a core whose vaults
  /// cannot be read. Mutable so one test can succeed first and then fail, and
  /// clear it again to prove a retry starts clean.
  String? knowledgeFailure;

  /// When true, `knowledge.tree` answers the documented empty success
  /// (`{groups: []}`), like a workspace with no Markdown yet. A test that needs
  /// the two topic groups leaves it false.
  final bool knowledgeEmpty;

  /// The `knowledge.search` queries, in call order. A cleared query never calls.
  final knowledgeQueries = <String>[];

  /// The `knowledge.search`/`knowledge.tree` scope (the tree sends `side`), in
  /// call order, so a test can prove the tree read is scoped.
  final knowledgeScopes = <String>[];

  /// When set, `knowledge.read` answers with this typed `knowledge` refusal and
  /// returns no body, exactly like an id the core cannot resolve. Separate from
  /// [knowledgeFailure] so a test can read the tree and fail only the item read.
  String? knowledgeReadFailure;

  /// When true, `knowledge.read` sets `truncated: true`, like a copied source the
  /// core capped to a safe size.
  bool knowledgeReadTruncated = false;

  /// The `knowledge.read` ids, in call order. A refused read is recorded too:
  /// the request was made, the core refused it.
  final knowledgeReadIds = <String>[];

  /// The `archive.restore` payloads, in call order: `{id, side}`. A refused
  /// restore adds nothing here.
  final archiveRestores = <Map<String, dynamic>>[];

  /// The `archive.remove` payloads, in call order: `{id, side}`. A refused
  /// delete adds nothing here.
  final archiveRemoves = <Map<String, dynamic>>[];

  /// When true, `session.output.read` answers the documented empty success
  /// (`{markdown: "", exists: false}`) for a session output that was never
  /// built, so a test can render the reader's build state. A successful build
  /// in the same run flips it for that output, exactly like the real core
  /// writing the file.
  final bool outputMissing;

  /// When set, `session.output.build` answers with this typed generation error
  /// (`data.kind == "generation"`) and writes nothing, exactly like a provider
  /// failure or a workspace with no model.
  final String? outputFailure;

  /// When set, `review.mark` answers with this typed `review` refusal and leaves
  /// the fake queue untouched, exactly like a core whose write failed. An
  /// `itemId` containing `reject` is the per-request sentinel for the same
  /// refusal.
  final String? reviewMarkFailure;

  /// When set, `work.write.decide` and `work.command.decide` answer with this
  /// typed refusal and keep the pending row, exactly like a blocked profile or a
  /// hash conflict. A test that needs a successful decision leaves it null.
  final String? approvalDecideFailure;

  /// Seed the one settled swarm run. A test that needs the empty board passes
  /// `withSwarms: false`.
  final bool withSwarms;

  /// When set, `achievements.list` answers with this typed `achievements`
  /// refusal and returns no rows, exactly like a core whose award read failed.
  final String? achievementsFailure;

  /// When set, `achievements.list` carries this note beside six healthy rows,
  /// exactly like a core whose awards file could not be read: the rows still
  /// render and only the award dates are affected.
  final String? achievementsWarning;

  /// When set, every `work.swarm.*` method answers with this typed `swarm`
  /// refusal and changes nothing, exactly like a core whose swarm service or
  /// board read failed. A test that needs a successful call leaves it null.
  final String? swarmFailure;

  /// When set, `mcp.confirm` answers with this typed `permission` refusal and
  /// keeps the request pending, exactly like a core whose answer could not be
  /// delivered. A test that needs a successful answer leaves it null.
  final String? permissionConfirmFailure;

  /// Seed the fixed session's memory note. A test that needs the card's empty
  /// state passes `withMemory: false`, which omits the `memory` block exactly
  /// like a session whose chat has not completed a turn yet.
  final bool withMemory;

  /// When true, `session.coverage` answers the documented empty report for a
  /// session with no sources, so a test can render the coverage card's empty
  /// state. The default seeds two sources: one referenced, one a gap.
  final bool coverageEmpty;

  /// When set, `session.coverage` answers with this typed session refusal and
  /// reads nothing. Mutable on purpose: a test can read the report once, then
  /// fail the same store's next read, proving the previous report survives.
  String? coverageFailure;

  /// The `session.coverage` session ids, in call order.
  final coverageRequests = <String>[];

  /// The `mcp.permission` params this fake pushed, in emission order, so a test
  /// can assert what the core would have sent.
  final permissionEvents = <Map<String, dynamic>>[];

  /// The `mcp.confirm` payloads, in call order: `{requestId, allow}`. A refused
  /// answer adds nothing here.
  final permissionConfirms = <Map<String, dynamic>>[];

  /// The request ids still waiting for an answer, exactly like the core's
  /// in-memory prompts. `mcp.confirm` consumes one.
  final _pendingPermissions = <String>{};

  /// The request ids still waiting for an answer, in emission order.
  List<String> get pendingPermissionIds => _pendingPermissions.toList();

  /// Push one `mcp.permission` notification, exactly like the core's gate, and
  /// return the request id so a test can answer it.
  String emitPermission({
    String requestId = 'perm-1',
    String server = 'notes',
    String tool = 'write_note',
    Map<String, dynamic> input = const {
      'path': 'notes/a.md',
      'body': 'remember this',
    },
    bool write = true,
  }) {
    final params = <String, dynamic>{
      'requestId': requestId,
      'server': server,
      'tool': tool,
      'input': input,
      'write': write,
    };
    _pendingPermissions.add(requestId);
    permissionEvents.add(params);
    emitEvent('mcp.permission', params);
    return requestId;
  }

  /// The `session.output.build` requests, in call order.
  final outputBuilds = <Map<String, dynamic>>[];

  /// The `session.output.read` requests, in call order: `{id, kind, part}`.
  /// `part` is the value the caller supplied (null for the primary document).
  final outputReads = <Map<String, dynamic>>[];

  /// The session outputs the fake has written. An id is `"<sessionId>:<kind>"`;
  /// a study guide covers its answers part too.
  final _builtOutputs = <String>{};

  /// The generated documents `session.output.read` serves. A build replaces
  /// them, so a rebuild is visibly a new document instead of the same bytes.
  static const studyGuideMarkdown =
      '# Study guide — Physics — Unit 4\n\n'
      '> 0 of 2 sections reviewed\n\n'
      '## Energy balance\n\n'
      'What limits the integral?\n\n'
      '- [ ] Reviewed\n\n'
      '## Boundary conditions\n\n'
      'Why do they set the limits?\n\n'
      '- [ ] Reviewed\n';

  static const studyGuideAnswers =
      '# Study guide answers — Physics — Unit 4\n\n'
      '## Energy balance\n\n'
      'The boundary conditions determine the integral limits.\n\n'
      '## Boundary conditions\n\n'
      'They fix the domain of integration.\n';

  static const flashcardMarkdown =
      '# Flashcards — Physics — Unit 4\n\n'
      '## Card 1\n\n'
      'Q: What does the learning rate control?\n'
      'A: The step size of each update.\n'
      'M: no\n'
      'K: no\n\n'
      '### Choices\n'
      '- [x] The step size of each update.\n'
      '- [ ] The number of layers.\n'
      '- [ ] The batch size.\n'
      '- [ ] The learning schedule.\n';

  /// The documents a rebuild writes. They are deliberately different from the
  /// seed, so a test can tell "built again" from "showed the old document".
  static const rebuiltGuideMarkdown =
      '# Study guide — Physics — Unit 4\n\n'
      '> 0 of 3 sections reviewed\n\n'
      '## Energy balance, rebuilt\n\n'
      'Which quantity is conserved?\n\n'
      '- [ ] Reviewed\n';

  static const rebuiltAnswersMarkdown =
      '# Study guide answers — Physics — Unit 4\n\n'
      '## Energy balance, rebuilt\n\n'
      'The total energy of a closed system is conserved.\n';

  static const rebuiltFlashcardMarkdown =
      '# Flashcards — Physics — Unit 4\n\n'
      '## Card 1\n\n'
      'Q: Which quantity is conserved?\n'
      'A: Energy.\n'
      'M: no\n'
      'K: no\n\n'
      '### Choices\n'
      '- [x] Energy.\n'
      '- [ ] Momentum.\n'
      '- [ ] Mass.\n'
      '- [ ] Charge.\n';

  var _guideMarkdown = studyGuideMarkdown;
  var _answersMarkdown = studyGuideAnswers;
  var _cardsMarkdown = flashcardMarkdown;

  /// The `stats.export` requests, in call order: `{range, scope, format}`. A
  /// refused request adds nothing here.
  final statsExports = <Map<String, dynamic>>[];

  /// The text `session.instructions.save` last wrote, in call order.
  final instructionsSaves = <String>[];

  /// The file paths passed to `session.instructions.import`, in call order. A
  /// refused import adds nothing here.
  final instructionsImports = <String>[];

  /// How many successful `session.instructions.reextract` calls were made.
  var instructionsReextracts = 0;

  /// The fixed session's mutable `prompt.md`.
  late String _prompt;

  /// The copied instructions file's provenance, keyed by session id.
  final _instructionsBySession = <String, Map<String, dynamic>>{};

  /// The ids passed to `session.archive`, `session.remove` and `session.export`,
  /// in call order. A refused action adds nothing here.
  final archiveCalls = <String>[];
  final removeCalls = <String>[];
  final exportCalls = <String>[];

  /// The `session.document` requests, in call order: `{id, kind, attempt}`.
  /// A refused request adds nothing here.
  final documentCalls = <Map<String, dynamic>>[];

  /// Ids archived or deleted. The real `session.list` reports the open side
  /// only, so an archived or removed row leaves [sessionRows] and lands here.
  final archivedSessionIds = <String>[];
  final removedSessionIds = <String>[];
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final calls = <String>[];

  /// The environment map [CoreStore.start] passed to the sidecar, or null when
  /// it passed none (the `bun run` development launch). The shell adds
  /// `LOCKEDIN_KEYRING_ADDON` for a packaged sidecar; the fake only records it,
  /// so a test can assert what the shell would have handed the core.
  Map<String, String>? launchedEnvironment;

  /// The `side` passed to each `review.queue` request, in call order. The fake
  /// answers the same snapshot for every side — the real core projects it — so a
  /// test asserts the request and lets the page own the chip state.
  final reviewSides = <String>[];

  /// The `review.mark` payloads, in call order: `{itemId, result}`. A refused
  /// mark adds nothing here.
  final reviewMarks = <Map<String, dynamic>>[];
  final _chatMessages = <Map<String, dynamic>>[];

  /// The `chat.send` payloads, in call order. The `images` key is present only
  /// when the shell sent at least one picked path, exactly like the real
  /// request, so a test can prove a text-only turn is unchanged.
  final chatSends = <Map<String, dynamic>>[];
  final _sessionMessages = <String, List<Map<String, dynamic>>>{};
  final _sessionTurns = <String, int>{};

  /// The fake session's `sources/` rows. `source.add` appends to this and
  /// `source.list` / `session.open` both read it, so a test sees the same list
  /// the real core would report after a copy.
  final _sources = <Map<String, dynamic>>[
    {
      'name': 'lecture-4.md',
      'originalPath': '/home/me/input/lecture-4.md',
      'storedPath': 'sources/lecture-4.md',
      'hash': 'sha256:1111',
      'kind': 'markdown',
    },
    {
      'name': 'complex-numbers.pdf',
      'originalPath': '/home/me/input/complex-numbers.pdf',
      'storedPath': 'sources/complex-numbers.pdf',
      'hash': 'sha256:2222',
      'kind': 'pdf',
    },
  ];

  /// Sessions created through `session.create`, keyed by the id the fake gave
  /// back. `session.open` and the session chat read them exactly like the fixed
  /// [sessionId], so a create followed by an open behaves like the real core.
  final _created = <String, Map<String, dynamic>>{};
  var _createdCount = 0;

  /// The params of every `session.create`, in call order.
  final List<Map<String, dynamic>> sessionCreateRequests = [];

  /// When true, the next `session.create` throws a timeout instead of
  /// answering, then clears itself. Exercises the wizard's retry path.
  bool sessionCreateTimeout = false;

  /// Registered Work projects (`work.list` rows) and their details
  /// (`work.open`). `work.create` appends to both, so a test sees exactly what
  /// the real core's registry would report after a registration.
  final _projects = <Map<String, dynamic>>[];
  final _projectDetails = <String, Map<String, dynamic>>{};

  /// The `work.create` parameters, in call order.
  final workCreates = <Map<String, dynamic>>[];

  /// Each project's saved chat ids (`work.chat.list`). The registered project
  /// starts with `chat-1`; a created project starts with none, so
  /// `work.chat.open` has both the resume and the create-first cases.
  final _projectChats = <String, List<String>>{};

  /// Project chat transcripts, keyed `<projectId>:<chatId>`.
  final _workChatMessages = <String, List<Map<String, dynamic>>>{};

  /// Turn counters per project chat, so a send appends uniquely named records.
  final _workChatTurns = <String, int>{};

  /// The `work.agent.save` payloads, in call order. A create carries no `id`.
  final agentSaves = <Map<String, dynamic>>[];

  /// The rows `work.templates.list` serves: the three built-ins and one project
  /// template, so a picker test can assert where each row came from.
  static const workTemplateRows = <Map<String, dynamic>>[
    {
      'id': 'reviewer',
      'name': 'Reviewer',
      'role': 'reviewer',
      'summary':
          'Review the work for correctness, regressions, security issues and '
          'missing tests. Report findings and cite file paths; do not change '
          'files.',
      'source': 'built-in',
      'instructions':
          'Review the work for correctness, regressions, security issues and '
          'missing tests. Report findings and cite file paths; do not change '
          'files.',
      'maxToolCalls': 8,
      'allowedTools': ['list_files', 'read_file', 'search_files'],
    },
    {
      'id': 'implementer',
      'name': 'Implementer',
      'role': 'implementer',
      'summary':
          'Implement the next concrete step. Inspect existing code first and '
          'propose small, reviewable edits.',
      'source': 'built-in',
      'instructions':
          'Implement the next concrete step. Inspect existing code first and '
          'propose small, reviewable edits.',
      'maxToolCalls': 10,
      'allowedTools': <String>[],
    },
    {
      'id': 'researcher',
      'name': 'Researcher',
      'role': 'researcher',
      'summary':
          'Map the relevant files, APIs and constraints. Search before reading, '
          'and report evidence with file paths.',
      'source': 'built-in',
      'instructions':
          'Map the relevant files, APIs and constraints. Search before reading, '
          'and report evidence with file paths.',
      'maxToolCalls': 12,
      'allowedTools': ['list_files', 'read_file', 'search_files'],
    },
    {
      'id': 'pair-programmer',
      'name': 'Pair programmer',
      'role': 'pair',
      'summary': 'Work one small step at a time and explain each edit.',
      'source': 'project',
      'instructions': 'Work one small step at a time and explain each edit.',
      'maxToolCalls': 6,
      'allowedTools': ['read_file', 'search_files'],
    },
  ];

  /// The `work.templates.list` queries the store sent, in call order.
  final workTemplateQueries = <Map<String, dynamic>>[];

  /// The agent ids passed to `work.agent.delete`, in call order.
  final agentDeletes = <String>[];

  /// The `agentId` passed to `work.defaultAgent` (null clears the default).
  final agentDefaults = <String?>[];

  /// The one pending write `work.approvals.list` seeds: an update with two
  /// hunks, so the approval screen has a real diff, real hunk selection and real
  /// added/removed counts.
  static const writeProposalId = 'write-0f0c';
  static const commandProposalId = 'command-5a1d';

  /// Pending approvals, mutable: `work.write.decide` / `work.command.decide`
  /// remove the row exactly like the core consuming a proposal.
  final approvalsWrites = <Map<String, dynamic>>[];
  final approvalsCommands = <Map<String, dynamic>>[];

  /// The `work.write.decide` payloads, in call order.
  final writeDecisions = <Map<String, dynamic>>[];

  /// The `work.command.decide` payloads, in call order.
  final commandDecisions = <Map<String, dynamic>>[];

  /// The activity log records `activity.list` serves, newest first.
  ///
  /// A write decision, a command decision and two swarm lifecycle events, so a
  /// page test can assert every row kind, the relative path, the argv, the
  /// decision word and the time. [activitySkipped] is the one corrupt line the
  /// fake reports beside them, exactly like a core whose log had one interrupted
  /// append.
  static const activitySkipped = 1;

  static const activityRows = <Map<String, dynamic>>[
    {
      'kind': 'swarm',
      'project': projectId,
      'run': 'run-7c1a',
      'event': 'finished',
      'status': 'failed',
      'at': '2026-11-15T10:04:00.000Z',
    },
    {
      'kind': 'swarm',
      'project': projectId,
      'run': 'run-7c1a',
      'event': 'started',
      'at': '2026-11-15T10:00:00.000Z',
    },
    {
      'kind': 'command-decision',
      'project': projectId,
      'argv': ['printf', 'ok'],
      'cwd': '.',
      'decision': 'deny',
      'exitCode': null,
      'timedOut': false,
      'at': '2026-11-15T10:02:00.000Z',
    },
    {
      'kind': 'write-decision',
      'project': projectId,
      'path': 'notes.md',
      'decision': 'approve',
      'hunks': [0],
      'at': '2026-11-15T10:01:00.000Z',
    },
  ];

  /// Every `activity.list` query the store sent, in call order.
  ///
  /// A page test asserts that the shell opened the log with the active project id
  /// and that `s` sent the next kind, so the filter is proven to be the core's
  /// answer rather than a local guess.
  final activityQueries = <Map<String, dynamic>>[];

  /// True when `activity.list` answers the documented empty success
  /// (`{records: [], skipped: 0, empty: true}`), like a workspace whose log does
  /// not exist yet. A test that needs the four rows leaves it false.
  final bool activityEmpty;

  /// When set, `activity.list` answers this typed `activity` refusal
  /// (`data.kind == "activity"`) and returns no rows, exactly like a core whose
  /// log cannot be read. A test that needs a successful read leaves it null.
  final String? activityFailure;

  void _seedApprovals() {
    approvalsWrites.add({
      'id': writeProposalId,
      'projectId': projectId,
      'path': 'notes.md',
      'kind': 'update',
      'diff':
          '--- a/notes.md\n'
          '+++ b/notes.md\n'
          '@@ -1,2 +1,2 @@\n'
          ' # Notes\n'
          '-old first line\n'
          '+new first line\n'
          '@@ -5,1 +5,2 @@\n'
          ' tail\n'
          '+added tail\n',
      'hunks': [
        {
          'index': 0,
          'oldStart': 1,
          'oldCount': 2,
          'newStart': 1,
          'newCount': 2,
          'lines': [
            {'kind': 'context', 'text': '# Notes', 'newline': true},
            {'kind': 'remove', 'text': 'old first line', 'newline': true},
            {'kind': 'add', 'text': 'new first line', 'newline': true},
          ],
          'oldLines': ['# Notes\n', 'old first line\n'],
          'newLines': ['# Notes\n', 'new first line\n'],
        },
        {
          'index': 1,
          'oldStart': 5,
          'oldCount': 1,
          'newStart': 5,
          'newCount': 2,
          'lines': [
            {'kind': 'context', 'text': 'tail', 'newline': true},
            {'kind': 'add', 'text': 'added tail', 'newline': true},
          ],
          'oldLines': ['tail\n'],
          'newLines': ['tail\n', 'added tail\n'],
        },
      ],
      'stats': {'added': 2, 'removed': 1},
      'baseHash': 'sha256:abc123',
    });
    approvalsCommands.add({
      'id': commandProposalId,
      'projectId': projectId,
      'argv': ['printf', 'ok'],
      'cwd': '.',
      'reason': 'check the approval path',
      'risk':
          'This process can read and write outside the project and can reach '
          'the network.',
    });
  }

  /// The one project the fake serves for the Work detail, and the archived
  /// swarm whose folder is gone (the missing-root case).
  static const projectId = 'my-app-4f2a1c';
  static const archivedProjectId = 'api-service-7c1d2e';

  /// The settled swarm run the fake serves, its two task ids, and the run the
  /// `work.swarm.run` reply creates.
  static const swarmRunId = 'run-7c1a';
  static const swarmTaskDoneId = 'task-1';
  static const swarmTaskFailedId = 'task-2';

  /// Swarm boards by run id, oldest first in insertion order. `work.swarm.run`
  /// appends, so `runs.last` is the newest — exactly the core's ordering.
  final _swarmBoards = <String, Map<String, dynamic>>{};

  /// The `work.swarm.run` payloads, in call order. A refused run adds nothing.
  final swarmRunRequests = <Map<String, dynamic>>[];

  /// The run ids passed to `work.swarm.cancel`, in call order.
  final swarmCancels = <String>[];

  /// The run ids passed to `work.swarm.remove`, in call order.
  final swarmRemoves = <String>[];

  /// The `work.swarm.retry` payloads, in call order: `{runId, taskId}`.
  final swarmRetries = <Map<String, String>>[];

  var _swarmRunCount = 0;

  void _seedSwarms() {
    _swarmBoards[swarmRunId] = {
      'runId': swarmRunId,
      'projectId': projectId,
      'objective': 'Review the pagination change',
      'status': 'failed',
      'parallel': 2,
      'startedAt': '2026-11-15T10:00:00.000Z',
      'finishedAt': '2026-11-15T10:04:00.000Z',
      'reportPath':
          '/home/me/LockedIn/work/projects/$projectId/reports/'
          '$swarmRunId.md',
      'live': false,
      'tasks': [
        {
          'id': swarmTaskDoneId,
          'title': 'Read the pagination code',
          'agentId': 'reviewer-9ab12c',
          'assignment': 'Read src/pages.ts and note the offset handling.',
          'status': 'done',
          'summary': 'Read src/pages.ts and noted the offset handling.',
        },
        {
          'id': swarmTaskFailedId,
          'title': 'Check the API tests',
          'agentId': 'reviewer-9ab12c',
          'assignment': 'Check the offset handling against the API tests.',
          'status': 'failed',
          'error': 'the provider rejected the request',
        },
      ],
    };
  }

  void _seedProjects() {
    const reviewerRow = {
      'id': 'reviewer-9ab12c',
      'name': 'Reviewer',
      'task': 'Review only.',
      'model': '',
      'permissions': 'read-only',
    };
    const builderRow = {
      'id': 'builder-3cd45e',
      'name': 'Builder',
      'task': 'Build the small pieces.',
      'model': 'openai/gpt-4.1-mini',
      'permissions': 'read-only',
    };
    const testerRow = {
      'id': 'tester-5ef67a',
      'name': 'Tester',
      'task': 'Check the result.',
      'model': '',
      'permissions': 'read-only',
    };
    _projects.addAll([
      {
        'id': projectId,
        'name': 'My app',
        'folder': '/home/me/Projects/my-app',
        'mode': 'chat',
        'swarmName': '',
        'archived': false,
        'agents': [reviewerRow],
      },
      {
        'id': archivedProjectId,
        'name': 'API service',
        'folder': '/home/me/Projects/api-service',
        'mode': 'swarm',
        'swarmName': 'Review crew',
        'archived': true,
        'agents': [builderRow, testerRow],
      },
    ]);
    _projectDetails[projectId] = {
      'id': projectId,
      'name': 'My app',
      'root': '/home/me/Projects/my-app',
      'rootMissing': false,
      'mode': 'chat',
      'swarmName': '',
      'archived': false,
      'instructions': 'Prefer small diffs.',
      'defaultAgent': 'reviewer-9ab12c',
      'agents': [
        {
          'id': 'reviewer-9ab12c',
          'name': 'Reviewer',
          'role': 'reviewer',
          'instructions': 'Review only.',
          'model': '',
          'maxToolCalls': 8,
          'allowedTools': ['list_files', 'read_file', 'search_files'],
          'allowWrite': false,
          'allowCommand': false,
          'template': '',
        },
      ],
      'tasks': 3,
      'hasGit': true,
      'lastOpened': '2026-11-14T09:12:00Z',
    };
    _projectDetails[archivedProjectId] = {
      'id': archivedProjectId,
      'name': 'API service',
      'root': '/home/me/Projects/api-service',
      'rootMissing': true,
      'mode': 'swarm',
      'swarmName': 'Review crew',
      'archived': true,
      'instructions': '',
      'defaultAgent': null,
      'agents': [
        {
          'id': 'builder-3cd45e',
          'name': 'Builder',
          'role': 'builder',
          'instructions': 'Build the small pieces.',
          'model': 'openai/gpt-4.1-mini',
          'maxToolCalls': 8,
          'allowedTools': ['read_file'],
          'allowWrite': false,
          'allowCommand': false,
          'template': '',
        },
        {
          'id': 'tester-5ef67a',
          'name': 'Tester',
          'role': 'reviewer',
          'instructions': 'Check the result.',
          'model': '',
          'maxToolCalls': 4,
          'allowedTools': const [],
          'allowWrite': false,
          'allowCommand': false,
          'template': '',
        },
      ],
      'tasks': 0,
      'hasGit': false,
      'lastOpened': '',
    };

    _projectChats[projectId] = ['chat-1'];
    _workChatMessages[_projectChatKey(projectId, 'chat-1')] = [
      {
        'id': 'wc1-u',
        'role': 'user',
        'text': 'Where should pagination go?',
        'outcome': 'done',
      },
      {
        'id': 'wc1-a',
        'role': 'assistant',
        'text': 'Start with the list endpoint.',
        'outcome': 'done',
      },
    ];
  }

  /// One transcript's `ChatSnapshot` shape, exactly like a session chat's.
  Map<String, dynamic> _workChat(String projectId, String chatId) => {
    'status': 'idle',
    'model': _chatModel.isEmpty ? null : _chatModel,
    'streamed': '',
    'messages':
        _workChatMessages[_projectChatKey(projectId, chatId)] ??
        const <Map<String, dynamic>>[],
    'blocked': null,
    'error': null,
    'usage': {'tokens': 0, 'costMicroUsd': null, 'durationMs': null},
  };

  static String _projectChatKey(String projectId, String chatId) =>
      '$projectId:$chatId';

  /// `work.changes` for the registered project: two files, one staged and one
  /// unstaged, so the card can show a branch, both counts, statuses and line
  /// counts from one answer.
  static const _changesSummary = <String, dynamic>{
    'available': true,
    'branch': 'main',
    'detached': false,
    'dirty': true,
    'staged': 1,
    'unstaged': 1,
    'files': [
      {
        'path': 'src/app.ts',
        'status': 'modified',
        'added': 12,
        'removed': 3,
        'staged': false,
        'unstaged': true,
      },
      {
        'path': 'docs/readme.md',
        'status': 'added',
        'added': 40,
        'removed': 0,
        'staged': true,
        'unstaged': false,
      },
    ],
  };

  /// `work.changes` for a project whose folder is gone: the core's documented
  /// unavailable shape, which is a success and never an error.
  static const _unavailableChanges = <String, dynamic>{
    'available': false,
    'reason': 'missing folder',
    'message':
        'the project folder is gone, so there is no working tree to read',
  };

  /// The two goals the fake serves: one real course and one whose `meta.json`
  /// cannot be read. The list carries both, so a test can render a healthy row
  /// beside a broken one.
  static const skillId = 'disassembly-basics-3f9a1c';
  static const brokenSkillId = 'rust-ownership-9c2d4e';

  /// A curriculum goal: stages, no chapters, so the staged-lesson reader has a
  /// real index to select from. Its stage-2 lesson exists, stage-1 has none and
  /// stage-3 is already `ready` (the rebuild `confirm` sentinel).
  static const stagedSkillId = 'stack-frames-7b1c9d';
  static const missingLessonStageId = 'stage-1';
  static const existingLessonStageId = 'stage-2';
  static const readyLessonStageId = 'stage-3';

  static const _skillRows = <Map<String, dynamic>>[
    {
      'id': skillId,
      'name': 'Read disassembly output',
      'stage': {'done': 2, 'total': 4},
      'chapters': {'done': 1, 'total': 3},
      'lastOpened': '2026-11-15T08:30:00Z',
      'chats': 2,
      'archived': false,
    },
    {
      'id': brokenSkillId,
      'name': 'Rust ownership',
      'stage': {'done': 0, 'total': 0},
      'lastOpened': '',
      'chats': 0,
      'archived': true,
      'broken': 'meta.json could not be read',
    },
    {
      'id': stagedSkillId,
      'name': 'Stack frames',
      'stage': {'done': 1, 'total': 3},
      'lastOpened': '2026-11-10T09:00:00Z',
      'chats': 0,
      'archived': false,
    },
  ];

  /// Goals created through `skill.create`, keyed by the id the fake gave back.
  /// `skill.list` and `skill.open` read them, so a create followed by an open
  /// behaves like the real core's template course.
  final _createdSkills = <String, Map<String, dynamic>>{};

  /// The `skill.create` parameters, in call order.
  final skillCreates = <Map<String, dynamic>>[];

  /// Each goal's saved chat ids (`skill.chat.list`), in file order. The seeded
  /// course starts with two; a created goal starts with none, so
  /// `skill.chat.open` has both the resume and the create-first cases.
  final _skillGoalChats = <String, List<String>>{
    skillId: ['chat-1', 'chat-2'],
  };

  /// Goal chat transcripts, keyed `<goalId>:<chatId>`.
  final _skillChatMessages = <String, List<Map<String, dynamic>>>{};

  /// Turn counters per goal chat, so a send appends uniquely named records.
  final _skillChatTurns = <String, int>{};

  /// Each goal's gathered sources (`skill.sources.list` rows), keyed by goal id.
  /// The seeded course has two; a created goal starts with none, so both the
  /// populated card and its empty state are real.
  final _skillSources = <String, List<Map<String, dynamic>>>{
    skillId: [
      {
        'name': 'lecture-4.md',
        'storedPath': 'sources/sha256-a1b2-lecture-4.md',
        'kind': 'markdown',
        'hash': 'sha256:a1b2',
        'excerpt': 'Boundary conditions set the limits.',
        'excerptLocation': 'sources/sha256-a1b2-lecture-4.md',
      },
      {
        'name': 'registers-cheatsheet.md',
        'storedPath': 'sources/sha256-c3d4-registers-cheatsheet.md',
        'kind': 'markdown',
        'hash': 'sha256:c3d4',
        'excerpt': null,
        'excerptLocation': null,
      },
    ],
  };

  /// The `skill.sources.add` path batches, in call order. A refused add adds
  /// nothing here.
  final skillSourceAdds = <List<String>>[];

  /// The goals a **new** chat was started for, in call order. `skill.chat.open`
  /// never touches this: only `skill.chat.create` does.
  final skillChatCreates = <String>[];

  /// Lessons built through `skill.lesson.build`, keyed `<goalId>:<stageId>`.
  /// `skill.lesson.read` prefers them, so a build followed by a re-read behaves
  /// like the core writing the file.
  final _builtLessons = <String, Map<String, dynamic>>{};

  static String _skillLessonKey(String goalId, String stageId) =>
      '$goalId:$stageId';

  /// Each goal's curriculum as `skill.stages.save` last stored it, keyed by goal
  /// id. Absent means the static seed below still stands, so a save followed by
  /// `skill.open` behaves like the core writing `meta.json`.
  final _skillStages = <String, List<Map<String, dynamic>>>{};

  /// The `skill.stages.save` payloads, in call order:
  /// `{goalId, stages, confirmed}`. A refused save adds nothing here.
  final skillStageSaves = <Map<String, dynamic>>[];

  /// The ids passed to `skill.archive`, `skill.remove` and `skill.export`, in
  /// call order. A refused action adds nothing here.
  final skillArchiveCalls = <String>[];
  final skillRemoveCalls = <String>[];
  final skillExportCalls = <String>[];

  /// Goals moved aside or deleted. `skill.list` reports the live side only, so
  /// an archived or removed row leaves the list and every other method refuses
  /// it, exactly like a folder that moved.
  final archivedSkillIds = <String>[];
  final removedSkillIds = <String>[];

  /// One goal's current stages: what was saved, otherwise the static seed.
  List<Map<String, dynamic>> _skillStagesOf(String goalId) {
    final saved = _skillStages[goalId];
    if (saved != null) {
      return [for (final row in saved) Map<String, dynamic>.from(row)];
    }
    final Object? raw = switch (goalId) {
      stagedSkillId => _stagedDetail['stages'],
      skillId => _skillDetail['stages'],
      _ => _createdSkills[goalId]?['stages'],
    };
    if (raw is! List) return const [];
    return [
      for (final row in raw)
        if (row is Map) Map<String, dynamic>.from(row),
    ];
  }

  /// The core's typed `stages` refusal for a curriculum the core did not store.
  RpcException _skillStageRefusal(String goalId, String message) {
    return RpcException(-32000, message, {
      'kind': 'stages',
      'goalId': goalId,
      'message': message,
    });
  }

  /// The core's typed `confirm` refusal: removing a `done` stage loses finished
  /// progress, so it needs `confirmed: true`.
  RpcException _skillStageConfirm(String goalId, String titles) {
    final message =
        'removing $titles discards completed progress; '
        'save again with confirmed: true';
    return RpcException(-32000, message, {
      'kind': 'stage',
      'goalId': goalId,
      'message': message,
    });
  }

  /// The core's typed `skill-action` refusal for an archive/delete/export.
  RpcException _skillActionRefusal(
    String goalId,
    String action,
    String message,
  ) {
    return RpcException(-32000, message, {
      'kind': 'skill-action',
      'goalId': goalId,
      'action': action,
      'message': message,
    });
  }

  /// One goal's source rows, sorted by name then stored path like the core.
  List<Map<String, dynamic>> _skillSourcesFor(String goalId) {
    final rows = [
      for (final row in _skillSources[goalId] ?? const <Map<String, dynamic>>[])
        Map<String, dynamic>.from(row),
    ];
    rows.sort((left, right) {
      final byName = '${left['name']}'.compareTo('${right['name']}');
      if (byName != 0) return byName;
      return '${left['storedPath']}'.compareTo('${right['storedPath']}');
    });
    return rows;
  }

  /// The core's typed `source` refusal shape for a goal's gathered sources.
  RpcException _skillSourceFailure(String goalId, String message) {
    return RpcException(-32000, message, {
      'kind': 'source',
      'goalId': goalId,
      'message': message,
    });
  }

  static String _skillChatKey(String goalId, String chatId) =>
      '$goalId:$chatId';

  /// The seeded transcripts: `chat-1` has one exchange, `chat-2` has two, so a
  /// test can tell the resumed chat from the other one.
  void _seedSkillChats() {
    _skillChatMessages[_skillChatKey(skillId, 'chat-1')] = [
      {
        'id': 'kc1-u',
        'role': 'user',
        'text': 'Where do I start?',
        'outcome': 'done',
      },
      {
        'id': 'kc1-a',
        'role': 'assistant',
        'text': 'Start with the first chapter: Getting started.',
        'outcome': 'done',
      },
    ];
    _skillChatMessages[_skillChatKey(skillId, 'chat-2')] = [
      {
        'id': 'kc2-u1',
        'role': 'user',
        'text': 'What is a stack frame?',
        'outcome': 'done',
      },
      {
        'id': 'kc2-a1',
        'role': 'assistant',
        'text': 'A stack frame is the memory a call reserves.',
        'outcome': 'done',
      },
      {
        'id': 'kc2-u2',
        'role': 'user',
        'text': 'Show me one.',
        'outcome': 'done',
      },
      {
        'id': 'kc2-a2',
        'role': 'assistant',
        'text': 'Push the frame pointer, then move the stack pointer.',
        'outcome': 'done',
      },
    ];
  }

  /// One transcript's `ChatSnapshot` shape, exactly like a project chat's.
  Map<String, dynamic> _skillChat(String goalId, String chatId) => {
    'status': 'idle',
    'model': _chatModel.isEmpty ? null : _chatModel,
    'streamed': '',
    'messages':
        _skillChatMessages[_skillChatKey(goalId, chatId)] ??
        const <Map<String, dynamic>>[],
    'blocked': null,
    'error': null,
    'usage': {'tokens': 0, 'costMicroUsd': null, 'durationMs': null},
  };

  /// A goal's saved chat ids, or an empty list for a goal with no chats yet.
  List<String> _skillChatIdsFor(String goalId) =>
      _skillGoalChats[goalId] ?? const <String>[];

  /// A goal's `skill.chat.list` rows. The message count is the transcript's own
  /// length, so a send is visible without a second read.
  List<Map<String, dynamic>> _skillChatRowsFor(String goalId) {
    final byId = {
      for (final row in _skillChatDetailRows)
        if (row['id'] is String) row['id'] as String: row,
    };
    return [
      for (final chatId in _skillChatIdsFor(goalId))
        {
          'id': chatId,
          'title': byId[chatId]?['title'] ?? '',
          'lastUsed': byId[chatId]?['lastUsed'] ?? '',
          'messages':
              (_skillChatMessages[_skillChatKey(goalId, chatId)] ??
                      const <Map<String, dynamic>>[])
                  .length,
        },
    ];
  }

  /// The core's typed `chat` refusal shape for a goal chat.
  RpcException _unknownSkillChat(String goalId, String chatId) {
    final message = 'there is no chat "$chatId" in this goal';
    return RpcException(-32000, message, {
      'kind': 'chat',
      'goalId': goalId,
      'chatId': chatId,
      'message': message,
    });
  }

  /// The one goal a chat can be opened on, or null when the id is unknown.
  /// An archived or deleted goal is unknown: its folder left the live side.
  Map<String, dynamic>? _skillFor(Object? raw) {
    if (raw is! String) return null;
    final id = raw.trim();
    if (id.isEmpty) return null;
    if (archivedSkillIds.contains(id) || removedSkillIds.contains(id)) {
      return null;
    }
    if (id == skillId) return _skillDetail;
    if (id == stagedSkillId) return _stagedDetail;
    return _createdSkills[id];
  }

  /// The id the fake derives for a goal, in the same shape the core's
  /// `courseId` uses: a 48-character kebab slug, suffixed when already taken.
  static String _skillIdFor(String goal, Set<String> taken) {
    var slug = goal
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    if (slug.length > 48) slug = slug.substring(0, 48);
    if (slug.isEmpty) slug = 'skill';
    if (!taken.contains(slug)) return slug;
    for (var index = 2; ; index++) {
      final candidate = '$slug-$index';
      if (!taken.contains(candidate)) return candidate;
    }
  }

  /// A created goal's `skill.list` row, derived from the course it was given.
  static Map<String, dynamic> _skillRowOf(Map<String, dynamic> detail) {
    final chapters = detail['chapters'];
    final total = chapters is List ? chapters.length : 0;
    return {
      'id': detail['id'],
      'name': detail['name'],
      'stage': {'done': 0, 'total': 0},
      'chapters': {'done': 0, 'total': total},
      'lastOpened': detail['created'],
      'chats': 0,
      'archived': false,
    };
  }

  /// The two chats the seeded course already has, as `skill.open` reports them.
  /// `skill.chat.list` derives its rows from the same table, so the page and the
  /// manager cannot disagree.
  static const _skillChatDetailRows = <Map<String, dynamic>>[
    {
      'id': 'chat-1',
      'title': 'Where do I start?',
      'lastUsed': '2026-11-01T09:05:06Z',
      'messages': 2,
    },
    {
      'id': 'chat-2',
      'title': 'What is a stack frame?',
      'lastUsed': '2026-11-02T10:00:00Z',
      'messages': 4,
    },
  ];

  /// `skill.open` for [skillId]: the course index and the goal's saved chats.
  static const _skillDetail = <String, dynamic>{
    'id': skillId,
    'name': 'Read disassembly output',
    'goal': 'Read disassembly output confidently',
    'prior': 'I know a little C',
    'created': '2026-11-01T09:00:00Z',
    'plan': 'model',
    'chapters': [
      {
        'id': 'ch-1',
        'title': 'Getting started',
        'guide': '01-getting-started.md',
        'practical': '01-getting-started-practical.md',
        'done': true,
      },
      {
        'id': 'ch-2',
        'title': 'Registers and memory',
        'guide': '02-registers.md',
        'practical': '',
        'done': false,
      },
      {
        'id': 'ch-3',
        'title': 'Control flow',
        'guide': '03-control-flow.md',
        'practical': '03-control-flow-practical.md',
        'done': false,
      },
    ],
    'chats': _skillChatDetailRows,
  };

  /// Chapter ids and titles from the index above, in file order.
  static const _skillChapters = <String, String>{
    'ch-1': 'Getting started',
    'ch-2': 'Registers and memory',
    'ch-3': 'Control flow',
  };

  /// `skill.open` for [stagedSkillId]: a curriculum (stages, no chapters). The
  /// stage ids are the only ids `skill.lesson.*` accepts.
  static const _stagedDetail = <String, dynamic>{
    'id': stagedSkillId,
    'name': 'Stack frames',
    'goal': 'Trace stack frames in a debugger',
    'prior': '',
    'created': '2026-11-10T09:00:00Z',
    'plan': 'template',
    'chapters': <Map<String, dynamic>>[],
    'stages': [
      {
        'id': missingLessonStageId,
        'title': 'Registers and memory',
        'status': 'active',
        'milestone': 'Explain a stack frame',
      },
      {
        'id': existingLessonStageId,
        'title': 'Control flow',
        'status': 'pending',
      },
      {
        'id': readyLessonStageId,
        'title': 'Calling conventions',
        'status': 'done',
        'milestone': 'Trace a call across frames',
      },
    ],
    'chats': <Map<String, dynamic>>[],
  };

  /// Stage ids and titles from the curriculum above, in curriculum order.
  static const _stagedStages = <String, String>{
    missingLessonStageId: 'Registers and memory',
    existingLessonStageId: 'Control flow',
    readyLessonStageId: 'Calling conventions',
  };

  /// The lesson bodies `skill.lesson.read` answers: stage-2 has one, stage-3 is
  /// already `ready`, and stage-1 has none (the reader's empty state).
  static String? _lessonTextFor(String stageId) {
    final title = _stagedStages[stageId];
    if (title == null) return null;
    return switch (stageId) {
      existingLessonStageId =>
        '# Lesson: $title\n\n'
            'Trace the loop with the frame pointer [src: lecture-4.md].\n\n'
            '## Exercise\n\n- [ ] Trace one loop\n',
      readyLessonStageId =>
        '# Lesson: $title\n\n'
            '(agent explanation) A call pushes the return address.\n',
      _ => null,
    };
  }

  /// The core's typed `stage` refusal for an unknown curriculum stage.
  RpcException _unknownStage(String goalId, String stageId) {
    final message = 'the skill "$goalId" has no stage "$stageId"';
    return RpcException(-32000, message, {
      'kind': 'stage',
      'goalId': goalId,
      'stageId': stageId,
      'message': message,
    });
  }

  /// The core's typed `lesson` refusal for a failed read or build.
  RpcException _skillLessonRefusal(
    String goalId,
    String stageId,
    String message,
  ) {
    return RpcException(-32000, message, {
      'kind': 'lesson',
      'goalId': goalId,
      'stageId': stageId,
      'message': message,
    });
  }

  /// The core's typed `confirm` refusal: rebuilding a `ready` lesson needs the
  /// user's explicit consent, which this protocol has no parameter for yet.
  RpcException _skillLessonConfirm(
    String goalId,
    String stageId,
    String title,
  ) {
    final message =
        'the lesson for "$title" is ready; rebuilding it replaces that work';
    return RpcException(-32000, message, {
      'kind': 'confirm',
      'goalId': goalId,
      'stageId': stageId,
      'status': 'ready',
      'message': message,
    });
  }

  /// The lesson body the fake returns for each chapter. A practical uses its own
  /// heading, so a test can tell the two reads apart.
  static String _chapterText(String chapterId, bool practical) {
    final title = _skillChapters[chapterId] ?? chapterId;
    if (practical) {
      return '# Practical: $title\n\n'
          'Try the exercise for **$title**.\n\n'
          '- [ ] Write the answer down\n';
    }
    return '# Lesson: $title\n\n'
        'Read the lesson for **$title**.\n\n'
        '- [x] Open the course\n'
        '- [ ] Skim the guide\n';
  }

  /// The core's typed `skill` refusal for a goal with no readable course.
  RpcException _unknownSkill(String id) {
    final message = 'the skill "$id" has no readable course in this workspace';
    return RpcException(-32000, message, {
      'kind': 'skill',
      'id': id,
      'message': message,
    });
  }

  /// The core's typed `chapter` refusal for an unknown or unreadable chapter.
  RpcException _unknownChapter(String id, String chapterId) {
    final message = 'the skill "$id" has no chapter "$chapterId"';
    return RpcException(-32000, message, {
      'kind': 'chapter',
      'id': id,
      'chapterId': chapterId,
      'message': message,
    });
  }

  /// The core's typed `chat` refusal shape for a project chat.
  RpcException _unknownChat(String projectId, String chatId) {
    final message = 'there is no chat "$chatId" in this project';
    return RpcException(-32000, message, {
      'kind': 'chat',
      'projectId': projectId,
      'chatId': chatId,
      'message': message,
    });
  }

  /// Deliver one notification the way the core would. Event-routing tests use
  /// this to prove a state for another project or chat cannot replace the one
  /// on screen.
  void emitEvent(String method, Map<String, dynamic> params) {
    _events.add({'method': method, 'params': params});
  }

  /// The `mcp.list` answer: two servers, one with a read tool and one with a
  /// write tool, plus a stored policy for two commands.
  /// A mutable copy for the server-editing methods.
  late final _mcpServerRows = [
    for (final row in _mcpServers) Map<String, dynamic>.from(row),
  ];

  static const _mcpServers = <Map<String, dynamic>>[
    {
      'name': 'notes',
      'transport': 'stdio',
      'enabled': true,
      'status': 'connected',
      'tools': [
        {'name': 'read_note', 'write': false},
      ],
    },
    {
      'name': 'wiki',
      'transport': 'stdio',
      'enabled': true,
      'status': 'connected',
      'tools': [
        {'name': 'write_note', 'write': true},
      ],
    },
  ];

  /// The mutable policy matrix `mcp.list` reports and `mcp.policy.set` edits,
  /// so a write and a later read agree exactly like the real core.
  final _mcpPolicy = <String, Map<String, String>>{
    'chill': {'notes': 'on'},
    'lockin': {'notes': 'explicit'},
  };

  /// The `mcp.policy.set` payloads, in call order. A refused write adds nothing.
  final mcpPolicySets = <Map<String, dynamic>>[];

  /// The `archive.list` rows: one archived school session and one archived
  /// skills goal, so a test can render both sides of the wall, the human
  /// readable size and the backend from one answer.
  ///
  /// Mutable: `archive.restore` removes the row (and, for the school side, adds
  /// the session back to [sessionRows] exactly like the real core moving the
  /// folder back), and `archive.remove` deletes the archived row only.
  final archiveRows = <Map<String, dynamic>>[
    {
      'id': '2026-10-01-0900-chemistry-bonding',
      'side': 'school',
      'name': 'Chemistry — Bonding',
      'date': '2026-10-01T10:00:00Z',
      'sizeBytes': 18422,
      'backend': 'folder',
      'kind': 'session',
    },
    {
      'id': 'read-disassembly-output-confidently-3f9a1c',
      'side': 'skills',
      'name': 'Read disassembly output',
      'date': '2026-10-03T08:00:00Z',
      'sizeBytes': 2048,
      'backend': 'folder',
      'kind': 'goal',
    },
  ];

  /// The one snapshot `review.queue` answers: an unchecked step, a missed card,
  /// a balanced nudge and one skipped folder whose metadata cannot be read.
  /// The counts agree with the rows, and the diagnostic is not an error.
  static const _reviewQueue = <String, dynamic>{
    'items': [
      {
        'id': 'step:$sessionId:1',
        'kind': 'step',
        'label': 'Derive the energy balance',
        'context': 'Physics — Unit 4',
        'contextId': sessionId,
        'reason': 'unchecked',
        'priority': 1,
        'count': 0,
        'origin': 'steps',
      },
      {
        'id': 'card:physics-unit-4:2',
        'kind': 'card',
        'label': 'What does the learning rate control?',
        'context': 'Physics — Unit 4',
        'contextId': sessionId,
        'reason': 'missed',
        'priority': 2,
        'count': 2,
        'origin': 'flashcards',
      },
    ],
    'nudge': {
      'intensity': 'balanced',
      'threshold': 3,
      'due': ['card:physics-unit-4:2'],
      'suggestions': ['review the missed card before the next step'],
    },
    'counts': {
      'total': 2,
      'byKind': {'card': 1, 'step': 1, 'stage': 0, 'memory': 0},
    },
    'diagnostics': [
      {
        'kind': 'review',
        'path': 'skills/goals/rust-ownership-9c2d4e',
        'message': 'meta.json could not be read',
        'next': 'open the goal folder and fix or remove its meta.json',
      },
    ],
    'coverage': [
      {
        'sessionId': sessionId,
        'name': 'Physics — Unit 4',
        'report': _seededCoverage,
      },
    ],
    'intensity': 'balanced',
  };

  /// The mutable `review.queue` snapshot. `review.mark` edits it, so a mark
  /// followed by a refresh reports exactly what the real core records: a known
  /// step or card leaves the queue, a missed card stays with one more miss, and
  /// counts follow the rows.
  late final Map<String, dynamic> _reviewQueueState = Map<String, dynamic>.from(
    _cloneJson(_reviewQueue) as Map,
  );

  /// Six `achievements.list` rows across the four shelves.
  ///
  /// Two are unlocked and carry an award date; the other four are locked and
  /// carry raw progress, so one page test can prove the header count, the group
  /// counts, an unlocked row and a locked row's `3 / 10 steps` line at once.
  /// The real core sends the whole catalogue (35 rows); the projection is the
  /// same shape and the page must not care how many rows arrive.
  static List<Map<String, dynamic>> _achievementRows() => [
    {
      'id': 'first-light',
      'name': 'First Light',
      'task': 'Send your first message.',
      'category': 'starter',
      'metric': 'messages',
      'target': 1,
      'value': 1,
      'progress': 12,
      'unlocked': true,
      'difficulty': 'easiest',
      'awardedAt': '2026-11-01',
    },
    {
      'id': 'open-book',
      'name': 'Open Book',
      'task': 'Create your first lock-in session.',
      'category': 'starter',
      'metric': 'sessions',
      'target': 1,
      'value': 1,
      'progress': 1,
      'unlocked': true,
      'difficulty': 'easiest',
      'awardedAt': '2026-11-02',
    },
    {
      'id': 'first-steps',
      'name': 'First Steps',
      'task': 'Tick off ten assignment steps.',
      'category': 'learning',
      'metric': 'steps',
      'target': 10,
      'value': 3,
      'progress': 3,
      'unlocked': false,
      'difficulty': 'easiest',
    },
    {
      'id': 'long-march',
      'name': 'Long March',
      'task': 'Tick off one hundred assignment steps.',
      'category': 'learning',
      'metric': 'steps',
      'target': 100,
      'value': 3,
      'progress': 3,
      'unlocked': false,
      'difficulty': 'hard',
    },
    {
      'id': 'toolsmith',
      'name': 'Toolsmith',
      'task': 'Make twenty-five tool calls.',
      'category': 'work',
      'metric': 'toolCalls',
      'target': 25,
      'value': 7,
      'progress': 7,
      'unlocked': false,
      'difficulty': 'easy',
    },
    {
      'id': 'locked-in',
      'name': 'Locked In',
      'task': 'Create ten lock-in sessions.',
      'category': 'collection',
      'metric': 'sessions',
      'target': 10,
      'value': 2,
      'progress': 2,
      'unlocked': false,
      'difficulty': 'easiest',
    },
  ];

  static Object? _cloneJson(Object? value) {
    if (value is Map) {
      return <String, dynamic>{
        for (final entry in value.entries)
          '${entry.key}': _cloneJson(entry.value),
      };
    }
    if (value is List) return [for (final entry in value) _cloneJson(entry)];
    return value;
  }

  /// Recompute the queue's totals and nudge ids from the rows that remain.
  void _recountReview() {
    final raw = _reviewQueueState['items'];
    final items = raw is List ? raw.whereType<Map>().toList() : <Map>[];
    final byKind = <String, int>{'card': 0, 'step': 0, 'stage': 0, 'memory': 0};
    for (final item in items) {
      final kind = item['kind'] is String ? item['kind'] as String : '';
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
    _reviewQueueState['counts'] = {'total': items.length, 'byKind': byKind};
    final nudge = _reviewQueueState['nudge'];
    if (nudge is Map) {
      final ids = {for (final item in items) item['id']};
      final due = nudge['due'];
      if (due is List) {
        nudge['due'] = [
          for (final id in due)
            if (ids.contains(id)) id,
        ];
      }
    }
  }

  /// The core's typed `review` refusal shape.
  RpcException _reviewFailure(String itemId, String message) {
    return RpcException(-32000, message, {
      'kind': 'review',
      'itemId': itemId,
      'message': message,
    });
  }

  /// The core's typed `knowledge` refusal shape: one message, no retry.
  static RpcException _knowledgeFailure(String message) {
    return RpcException(-32000, message, {
      'kind': 'knowledge',
      'message': message,
    });
  }

  /// The `mcp.refresh` answer: the same two servers with one more tool on
  /// `notes`, so a test can see the rows change. With [mcpRefreshFailure] set,
  /// the second server reports a failed connect instead.
  List<Map<String, dynamic>> _mcpRefreshedRows() {
    final failure = mcpRefreshFailure;
    return [
      {
        'name': 'notes',
        'transport': 'stdio',
        'enabled': true,
        'status': 'connected',
        'tools': [
          {'name': 'read_note', 'write': false},
          {'name': 'search_notes', 'write': false},
        ],
      },
      {
        'name': 'wiki',
        'transport': 'stdio',
        'enabled': true,
        'status': failure == null ? 'connected' : {'failed': failure},
        'tools': [
          {'name': 'write_note', 'write': true},
        ],
      },
    ];
  }

  /// The id the fake derives from a name, in the same slug-plus-suffix shape
  /// the core uses. Registration in a test never collides: names differ.
  static String _projectIdFor(String name) {
    final slug = name
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return '${slug.isEmpty ? 'project' : slug}-4f2a1c';
  }

  var _chatModel = '';
  var _linked = false;

  /// The stored `decision_layer.enabled` (`decision.get` / `decision.set`). Off
  /// by default, exactly like a workspace that never enabled the layer.
  var _decisionEnabled = false;

  /// The stored `decision_layer.model`. Always empty: this build documents a
  /// refused non-empty value, and `decision.set` never stores one.
  final _decisionModel = '';

  /// The `decision.set` payloads, in call order: only the fields the caller
  /// supplied. A refused write adds nothing here.
  final decisionSets = <Map<String, dynamic>>[];

  /// The documented `decision.get` / `decision.set` view: off by default and
  /// rules-only, with the local model absent for the reason the core gives.
  Map<String, dynamic> _decisionView() => {
    'enabled': _decisionEnabled,
    'model': _decisionModel,
    'rulesOnly': true,
    'localModel': {
      'supported': false,
      'reason':
          'No local model runtime is bundled in this build, so the decision '
          'layer runs rules only.',
    },
  };

  /// The stored global Work opt-in (`work.permissions.get` / `.set`). Both off
  /// by default, exactly like a workspace that never opened Settings → Work.
  var _workAllowWrite = false;
  var _workAllowCommand = false;

  /// The `work.permissions.set` payloads, in call order.
  final workPermissionSets = <Map<String, dynamic>>[];

  /// The documented `work.permissions.get` / `.set` view.
  Map<String, dynamic> _workPermissions() => {
    'allowWrite': _workAllowWrite,
    'allowCommand': _workAllowCommand,
  };

  /// The stored `ui.keybinds` table, seeded with the two overrides every test
  /// sees. They are deliberately *not* surface shortcuts or the palette: a
  /// seeded override must never change what an existing test presses.
  final _keybinds = <String, String>{'refresh': 'space+z', 'retry': 'space+y'};

  /// The stored `ui.fixed_keybinds` table. Empty by default; a test that needs a
  /// fixed-table override seeds one through `keybinds.set`.
  final _fixedKeybinds = <String, String>{};

  /// The `keybinds.set` payloads, in call order. A refused write adds nothing.
  final keybindWrites = <Map<String, dynamic>>[];

  /// The stored `ui.custom_theme` map (`theme.custom.get`). Empty by default:
  /// the shell fills crimson per token, so an empty map is a full answer.
  final themeTokens = <String, String>{};

  /// The `theme.custom.set` payloads, in call order. A refused write adds
  /// nothing, and a successful one replaces [themeTokens] like the core does.
  final themeTokenWrites = <Map<String, dynamic>>[];

  RpcException _unknownProject(Object? raw) {
    final id = raw is String ? raw : '';
    return RpcException(-32000, 'project $id was not found', {
      'kind': 'project',
      'id': id,
      'message': 'project $id was not found',
    });
  }

  /// The `runId` every swarm method requires; a blank one is `-32602`.
  String _swarmRunParam(Map<String, dynamic>? params, String method) {
    final raw = params?['runId'];
    if (raw is! String || raw.trim().isEmpty) {
      throw RpcException(-32602, '$method requires a run id');
    }
    return raw.trim();
  }

  /// The core's typed `swarm` refusal for an unknown run.
  RpcException _unknownSwarmRun(String projectId, String runId) {
    final message = 'there is no swarm run "$runId" in this project';
    return RpcException(-32000, message, {
      'kind': 'swarm',
      'projectId': projectId,
      'runId': runId,
      'message': message,
    });
  }

  String _swarmReportPath(String projectId, String runId) =>
      '/home/me/LockedIn/work/projects/$projectId/reports/$runId.md';

  /// The board a live run settles into: every task done, the report written.
  Map<String, dynamic>? _settledSwarm(String projectId, String runId) {
    final board = _swarmBoards[runId];
    if (board == null) return null;
    final rows = board['tasks'] is List ? board['tasks'] as List : const [];
    return <String, dynamic>{
      ...board,
      'status': 'done',
      'live': false,
      'finishedAt': '2026-11-16T09:01:00.000Z',
      'reportPath': _swarmReportPath(projectId, runId),
      'tasks': [
        for (final row in rows.whereType<Map>())
          {
            ...Map<String, dynamic>.from(row),
            'status': 'done',
            'summary': 'Finished: ${row['title']}',
          },
      ],
    };
  }

  /// The core's typed `agent` refusal shape.
  RpcException _agentFailure(
    String projectId,
    String message, {
    String? agentId,
  }) {
    return RpcException(-32000, message, {
      'kind': 'agent',
      'projectId': projectId,
      'agentId': ?agentId,
      'message': message,
    });
  }

  List<Map<String, dynamic>> _agentProfiles(Map<String, dynamic> detail) {
    final raw = detail['agents'];
    if (raw is! List) return <Map<String, dynamic>>[];
    return raw
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  /// The id the fake derives for a new profile, in the same slug-plus-suffix
  /// shape the core's `makeAgentId` uses. Deterministic, so a test can name it.
  static String _agentIdFor(String name, Set<String> taken) {
    final slug = name
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    var sum = 0;
    for (final unit in name.codeUnits) {
      sum = (sum * 31 + unit) & 0xffffff;
    }
    final suffix = sum.toRadixString(16).padLeft(6, '0');
    final base = slug.isEmpty ? 'agent' : slug;
    var id = '$base-$suffix';
    var counter = 2;
    while (taken.contains(id)) {
      id = '$base-$suffix-$counter';
      counter += 1;
    }
    return id;
  }

  /// Mirror one project's saved profiles into its `work.list` row, so a save,
  /// delete or default change is visible without re-registering the project.
  void _syncProjectRow(String projectId) {
    Map<String, dynamic>? row;
    for (final project in _projects) {
      if (project['id'] == projectId) {
        row = project;
        break;
      }
    }
    final detail = _projectDetails[projectId];
    if (row == null || detail == null) return;
    row['agents'] = [
      for (final profile in _agentProfiles(detail))
        {
          'id': profile['id'],
          'name': profile['name'],
          'task': profile['instructions'] ?? '',
          'model': profile['model'] ?? '',
          'permissions':
              profile['allowWrite'] == true || profile['allowCommand'] == true
              ? 'write'
              : 'read-only',
        },
    ];
  }

  /// The one session the fake can open; anything else is a typed session error.
  static const sessionId = '2026-11-01-0900-physics';

  /// The `session.list` rows. Mutable because a confirmed archive or delete
  /// takes the row off the open side, exactly like the real list, which reports
  /// the live folders only.
  final sessionRows = <Map<String, dynamic>>[
    {
      'id': '2026-11-15-1200-audit-session',
      'name': 'Audit session',
      'date': '2026-11-15T12:00:00Z',
      'sources': 2,
      'steps': {'done': 0, 'total': 0},
      'archived': false,
    },
    {
      'id': '2026-11-01-1430-physics',
      'name': 'Physics — Unit 4',
      'date': '2026-11-01T14:30:00Z',
      'sources': 4,
      'steps': {'done': 3, 'total': 8},
      'archived': false,
    },
  ];

  /// True when the id names something the fake can act on: a listed row, the one
  /// openable session, or a session created through `session.create`.
  bool _sessionKnown(Object? raw) {
    if (raw is! String || raw.trim().isEmpty) return false;
    final id = raw.trim();
    if (id == sessionId || _created.containsKey(id)) return true;
    return sessionRows.any((row) => row['id'] == id);
  }

  /// The fixed session's mutable `assignment-steps.md`. `session.toggleStep`
  /// rewrites this in place and `session.open` reads it, so a toggle followed by
  /// a reopen reports exactly what the real core would. A test that needs a
  /// different deck passes [FakeCore.stepsMarkdown].
  static const _defaultStepsMarkdown =
      '# Assignment steps\n\n> 0 of 1 steps done\n\n'
      '- [ ] Derive the energy balance\n';

  late String _stepsMarkdown;

  static final _stepLinePattern = RegExp(r'^[-*]\s+\[([ xX])\]');
  static final _progressPattern = RegExp(
    r'^(\s*>\s*)\d+ of \d+( steps done)\s*$',
  );
  static final _stepTextPattern = RegExp(r'^[-*]\s+\[[ xX]\]\s+(.*)$');
  static final _checkedTextPattern = RegExp(r'^[-*]\s+\[[xX]\]\s+(.*)$');

  /// The plan `session.generateSteps` writes: two concrete steps, so a test can
  /// tell the generated document from the one-step seed and from an empty file.
  static const generatedStepsMarkdown =
      '# Assignment steps\n\n'
      '> 0 of 2 steps done\n\n'
      '## Understand\n\n'
      '- [ ] Read the sources\n'
      '- [ ] Summarise the key points\n';

  /// The three generated study documents `session.document` writes. Each has a
  /// distinct body and file name, so a test can tell the three actions apart.
  static const contractDocument =
      '# Done when\n\n'
      '- [ ] Explain the boundary conditions\n'
      '- [ ] Derive the energy balance\n'
      '- [ ] Check the units\n';

  static const contradictionsDocument =
      '# Source contradictions\n\n'
      '- lecture-4.md says the field is uniform.\n'
      '- complex-numbers.pdf implies it varies.\n';

  static String checkDocument(String attempt) =>
      '# Attempt check\n\n'
      'Checked: "$attempt"\n\n'
      '- The energy balance is stated.\n'
      '- The boundary conditions are missing.\n';

  /// The checked step texts in [markdown], in file order. The merge compares
  /// them by exact text, like the core's `regenerateSteps`.
  static List<String> _checkedTexts(String markdown) {
    final texts = <String>[];
    for (final line in markdown.split('\n')) {
      final match = _checkedTextPattern.firstMatch(line.trimLeft());
      if (match != null) texts.add(match.group(1)!.trimRight());
    }
    return texts;
  }

  static Set<String> _stepTexts(String markdown) {
    final texts = <String>{};
    for (final line in markdown.split('\n')) {
      final match = _stepTextPattern.firstMatch(line.trimLeft());
      if (match != null) texts.add(match.group(1)!.trimRight());
    }
    return texts;
  }

  /// Checked work the new plan keeps, by exact step text.
  static int _keptCount(String before, String after) {
    final plan = _stepTexts(after);
    return _checkedTexts(before).where(plan.contains).length;
  }

  /// The fake's own count of the task-list items in [markdown]. The real core
  /// parses the same file; this is display-only arithmetic for the test double,
  /// never a second source of truth for the shell.
  Map<String, dynamic> _stepsOf(String markdown, {bool exists = true}) {
    final states = _stepStates(markdown);
    return {
      'done': states.where((checked) => checked).length,
      'total': states.length,
      'exists': exists,
      'markdown': markdown,
    };
  }

  List<bool> _stepStates(String markdown) {
    final states = <bool>[];
    for (final line in markdown.split('\n')) {
      final match = _stepLinePattern.firstMatch(line.trimLeft());
      if (match == null) continue;
      states.add(match.group(1)!.toLowerCase() == 'x');
    }
    return states;
  }

  /// Rewrites the bracket of the [index]th task item and the progress line, the
  /// same two things the core touches. Returns null when the index is out of
  /// range so the caller can answer with the steps error shape.
  String? _toggleStepText(String markdown, int index) {
    final lines = markdown.split('\n');
    var seen = 0;
    for (var line = 0; line < lines.length; line++) {
      final match = _stepLinePattern.firstMatch(lines[line].trimLeft());
      if (match == null) continue;
      if (seen++ != index) continue;
      final checked = match.group(1)!.toLowerCase() == 'x';
      final bracket = lines[line].indexOf('[');
      lines[line] = lines[line].replaceRange(
        bracket + 1,
        bracket + 2,
        checked ? ' ' : 'x',
      );
      final states = _stepStates(lines.join('\n'));
      final done = states.where((state) => state).length;
      for (var progressLine = 0; progressLine < lines.length; progressLine++) {
        final progress = _progressPattern.firstMatch(lines[progressLine]);
        if (progress == null) continue;
        lines[progressLine] =
            '${progress.group(1)}$done of ${states.length}${progress.group(2)}';
      }
      return lines.join('\n');
    }
    return null;
  }

  static final _cardHeadingPattern = RegExp(
    r'^##\s+Card\b',
    caseSensitive: false,
  );

  /// Rewrites only one card's `M:`/`K:` lines, the same bytes the core's
  /// `markCard` rewrites (`src/server/protocol.ts`). A card missing either line
  /// gets them after its `A:` line. Returns null when [number] is out of range,
  /// so the caller can answer with the review refusal shape.
  String? _markCardText(String markdown, int number, String result) {
    final lines = markdown.split('\n');
    final starts = <int>[];
    for (var line = 0; line < lines.length; line++) {
      if (_cardHeadingPattern.hasMatch(lines[line].trim())) starts.add(line);
    }
    if (number < 1 || number > starts.length) return null;
    final start = starts[number - 1];
    final end = number < starts.length ? starts[number] : lines.length;
    var missedAt = -1;
    var knownAt = -1;
    var answerAt = -1;
    for (var line = start; line < end; line++) {
      final text = lines[line].trimRight();
      if (text.startsWith('M:')) missedAt = line;
      if (text.startsWith('K:')) knownAt = line;
      if (text.startsWith('A:')) answerAt = line;
    }
    final missed = result == 'missed' ? 'yes' : 'no';
    final known = result == 'known' ? 'yes' : 'no';
    final updated = [...lines];
    if (missedAt >= 0) updated[missedAt] = 'M: $missed';
    if (knownAt >= 0) updated[knownAt] = 'K: $known';
    if (missedAt < 0 || knownAt < 0) {
      final insertAt = (answerAt >= 0 ? answerAt : start) + 1;
      updated.insertAll(insertAt, [
        if (missedAt < 0) 'M: $missed',
        if (knownAt < 0) 'K: $known',
      ]);
    }
    return updated.join('\n');
  }

  Map<String, dynamic>? _detailFor(Object? raw) {
    if (raw is! String) return null;
    if (raw == sessionId) return _sessionDetail();
    return _created[raw];
  }

  /// One session's current `prompt.md`. The fixed session keeps it in a field
  /// because `session.open` builds a fresh map each call; a created session's
  /// detail map is persistent.
  String _promptFor(String id, Map<String, dynamic> detail) {
    if (id == sessionId) return _prompt;
    final prompt = detail['prompt'];
    return prompt is String ? prompt : '';
  }

  void _setPromptFor(String id, Map<String, dynamic> detail, String text) {
    if (id == sessionId) {
      _prompt = text;
    } else {
      detail['prompt'] = text;
    }
  }

  Map<String, dynamic> _settings() => {
    'username': 'friend',
    'theme': 'lockedin',
    'chatModel': _chatModel,
    'baseUrl': '',
    'maxToolCalls': 8,
    'maxTokensPerRequest': 16000,
    'budgetUsd': 5.0,
    'period': 'day',
    'warnAt': 0.8,
    'pauseAtLimit': false,
    'dataDir': '/tmp/lockedin-data',
    'archiveBackend': 'folder',
    'archiveFolder': '',
    'historyLimit': 20,
    'responseStyle': 'normal',
    'tutorPolicy': 'direct',
    'pluginServers': ['filesystem'],
    'hideHints': false,
    'pluginDirs': ['/tmp/plugins'],
    'disabledPlugins': [],
  };

  /// A small Stats document shaped like the core's `stats.export`: the Markdown
  /// carries the estimate note, the CSV carries the same numbers. The requested
  /// range and scope are in the document, so a test sees what was forwarded.
  static String _statsExportText(String range, String scope, String format) {
    if (format == 'csv') {
      return 'metric,value\n'
          'range,$range\n'
          'scope,$scope\n'
          'tokens,24350\n'
          'runs,12\n'
          'failed,2\n';
    }
    return '# Stats — $range · $scope\n\n'
        '> Estimates, not a bill.\n\n'
        '- Tokens: 24,350\n'
        '- Runs: 12 (2 failed)\n'
        '- Active days: 18\n';
  }

  /// When set, snapshots carry this `seq` (the real core always numbers them).
  int? snapshotSeq;

  /// The fake session's misconception ledger, in file order.
  final List<Map<String, dynamic>> mistakeEntries = [];

  /// When set, every `session.mistake.*` call refuses with this message.
  String? mistakeFailure;

  Map<String, dynamic> _chat() => {
    if (snapshotSeq != null) 'seq': snapshotSeq,
    'status': 'idle',
    'model': _chatModel.isEmpty ? null : _chatModel,
    'streamed': '',
    'messages': _chatMessages,
    'blocked': null,
    'error': null,
    'usage': {'tokens': 42, 'costMicroUsd': null, 'durationMs': null},
  };

  Map<String, dynamic> _sessionChat(String id) => {
    if (snapshotSeq != null) 'seq': snapshotSeq,
    'status': 'idle',
    'model': _chatModel.isEmpty ? null : _chatModel,
    'streamed': '',
    'messages': _sessionMessages[id] ?? const <Map<String, dynamic>>[],
    'blocked': null,
    'error': null,
    'usage': {'tokens': 0, 'costMicroUsd': null, 'durationMs': null},
  };

  Map<String, dynamic> _sessionDetail() => {
    'id': sessionId,
    'name': 'Physics — Unit 4',
    'created': '2026-11-01T09:00:00Z',
    'archived': false,
    'prompt': _prompt,
    'sources': _sources,
    'steps': _stepsOf(_stepsMarkdown),
    if (withMemory)
      'memory': {
        'points': const [
          'Boundary conditions set the limits of the integral.',
          'The energy balance runs over the stated domain.',
        ],
        'folded': const [
          'energy is conserved in a closed system, so the total is fixed',
        ],
        'updated': '2026-11-01T15:00:00Z',
      },
  };

  List<Map<String, dynamic>> _mistakeRows() => [
    for (final entry in mistakeEntries) Map<String, dynamic>.from(entry),
  ];

  void _throwIfMistakeFailed(Object? id) {
    final failure = mistakeFailure;
    if (failure == null) return;
    throw RpcException(-32000, failure, {
      'kind': 'mistake',
      'id': id,
      'message': failure,
    });
  }

  RpcException _unknownSession(Object? raw) {
    final id = raw is String ? raw : '';
    return RpcException(-32000, 'session not found', {
      'kind': 'session',
      'id': id,
      'message': 'session $id was not found',
    });
  }

  /// `session.coverage` for the seeded session: `lecture-4.md` is mentioned by
  /// the steps and the chat, and `complex-numbers.pdf` is the gap. No document
  /// here is a source file: memory is only ever a labelled document.
  Map<String, dynamic> _coverageReport() =>
      coverageEmpty ? _emptyCoverage : _seededCoverage;

  static const _seededCoverage = <String, dynamic>{
    'sources': [
      {
        'hash': 'sha256:1111',
        'name': 'lecture-4.md',
        'originalPath': '/home/me/input/lecture-4.md',
        'count': 3,
        'documents': ['steps', 'chat'],
        'firstLine': 'Read lecture-4.md and summarise the boundary conditions',
        'referenced': true,
        'fromMemoryOnly': false,
      },
      {
        'hash': 'sha256:2222',
        'name': 'complex-numbers.pdf',
        'originalPath': '/home/me/input/complex-numbers.pdf',
        'count': 0,
        'documents': <String>[],
        'firstLine': null,
        'referenced': false,
        'fromMemoryOnly': false,
      },
    ],
    'unreferenced': [
      {
        'hash': 'sha256:2222',
        'name': 'complex-numbers.pdf',
        'originalPath': '/home/me/input/complex-numbers.pdf',
        'count': 0,
        'documents': <String>[],
        'firstLine': null,
        'referenced': false,
        'fromMemoryOnly': false,
      },
    ],
    'total': 2,
    'referencedCount': 1,
  };

  static const _emptyCoverage = <String, dynamic>{
    'sources': <Map<String, dynamic>>[],
    'unreferenced': <Map<String, dynamic>>[],
    'total': 0,
    'referencedCount': 0,
  };

  /// The Knowledge tree: two topics and three notes, both sides of the wall.
  static const _knowledgeTree = <Map<String, dynamic>>[
    {
      'topic': 'Physics',
      'notes': [
        {
          'path': 'school/vault/concepts/entropy.md',
          'title': 'Entropy and the second law',
          'updated': '2026-11-02T09:00:00.000Z',
        },
        {
          'path': 'school/vault/concepts/boundary-conditions.md',
          'title': 'Boundary conditions',
          'updated': '2026-11-01T12:30:00.000Z',
        },
      ],
    },
    {
      'topic': 'Assembly',
      'notes': [
        {
          'path': 'skills/vault/knowledge/registers.md',
          'title': 'Registers and stack frames',
          'updated': '2026-10-28T16:05:00.000Z',
        },
      ],
    },
  ];

  /// The tree projected to one side of the wall: notes whose workspace path
  /// lives in that vault, with a group left out when none of its notes survive.
  /// The real core does the same, so a `school` read never shows skills notes.
  static List<Map<String, dynamic>> _knowledgeTreeFor(String side) {
    final groups = <Map<String, dynamic>>[];
    for (final group in _knowledgeTree) {
      final notes = group['notes'];
      if (notes is! List) continue;
      final kept = [
        for (final note in notes)
          if (note is Map && '${note['path']}'.startsWith('$side/')) note,
      ];
      if (kept.isEmpty) continue;
      groups.add({'topic': group['topic'], 'notes': kept});
    }
    return groups;
  }

  /// The Knowledge search corpus: notes, memory and a source (all history on the
  /// school side), a skills note and a Work project. The fake filters it by a
  /// case-insensitive substring of the title, excerpt and path, then by side, so
  /// the shell exercises the real reply shape rather than a canned list.
  static const _knowledgeHits = <Map<String, dynamic>>[
    {
      'id': 'note:school/vault/concepts/entropy.md',
      'kind': 'note',
      'title': 'Entropy and the second law',
      'excerpt': 'Entropy counts the microstates a system can occupy.',
      'side': 'school',
      'path': 'school/vault/concepts/entropy.md',
      'updated': '2026-11-02T09:00:00.000Z',
      'score': 1.0,
    },
    {
      'id': 'source:2026-11-01-0900-physics-unit-4:lecture-4.md',
      'kind': 'source',
      'title': 'lecture-4.md',
      'excerpt': 'Boundary conditions set the integral limits.',
      'side': 'school',
      'path':
          'school/sessions/2026-11-01-0900-physics-unit-4/sources/'
          'lecture-4.md',
      'updated': '2026-11-01T14:35:00.000Z',
      'score': 0.7,
    },
    {
      'id': 'memory:2026-11-01-0900-physics-unit-4',
      'kind': 'memory',
      'title': 'Physics — Unit 4 memory',
      'excerpt': 'Boundary conditions determine the integral limits.',
      'side': 'school',
      'path': 'school/sessions/2026-11-01-0900-physics-unit-4/memory.md',
      'updated': '2026-11-01T15:00:00.000Z',
      'score': 0.6,
    },
    {
      'id': 'note:skills/vault/knowledge/registers.md',
      'kind': 'note',
      'title': 'Registers and stack frames',
      'excerpt': 'Registers hold working state across calls.',
      'side': 'skills',
      'path': 'skills/vault/knowledge/registers.md',
      'updated': '2026-10-28T16:05:00.000Z',
      'score': 0.5,
    },
    {
      'id': 'project:my-app-4f2a1c',
      'kind': 'project',
      'title': 'My app',
      'excerpt': 'Registered Work project.',
      'side': 'work',
      'path': 'work/projects/my-app-4f2a1c',
      'updated': '2026-10-20T10:00:00.000Z',
      'score': 0.4,
    },
  ];

  /// The row a `knowledge.read` id names: a search hit first, then a vault note.
  ///
  /// A tree row carries only its workspace-relative path, and the core accepts
  /// that bare path as the read id for a note, so the fake resolves both the way
  /// the real thing does.
  static Map<String, dynamic>? _knowledgeReadHit(String id) {
    for (final hit in _knowledgeHits) {
      if (hit['id'] == id) return hit;
    }
    final path = id.startsWith('note:') ? id.substring('note:'.length) : id;
    if (!path.startsWith('school/') && !path.startsWith('skills/')) return null;
    for (final group in _knowledgeTree) {
      final notes = group['notes'];
      if (notes is! List) continue;
      for (final note in notes) {
        if (note is Map && note['path'] == path) {
          return {
            'id': 'note:$path',
            'kind': 'note',
            'title': note['title'] ?? '',
            'excerpt': '',
            'side': path.startsWith('skills/') ? 'skills' : 'school',
            'path': path,
            'updated': note['updated'] ?? '',
            'score': 0,
          };
        }
      }
    }
    return null;
  }

  /// The body a stable id reads, so a note, a memory hit and a source hit each
  /// have their own text and a widget test can name the difference.
  static String _knowledgeBody(Map<String, dynamic> hit) {
    final id = '${hit['id']}';
    if (id.startsWith('memory:')) {
      return '# Key points\n\n'
          '- Boundary conditions determine the integral limits.\n'
          '- The energy balance closes the loop once the limits are fixed.\n';
    }
    if (id.startsWith('source:')) {
      return '# Lecture 4 — boundary conditions\n\n'
          'The integral limits follow from the boundary conditions, so a '
          'uniform field is the special case, not the rule.\n\n'
          '```\nE = q / (4 pi eps0 r^2)\n```\n';
    }
    if (id.startsWith('project:')) {
      return 'Registered Work project.\n\nRead-only: this surface never opens a '
          'file inside the project.';
    }
    if (id.startsWith('note:skills/')) {
      return '# Registers and stack frames\n\n'
          'Registers hold working state across calls. A stack frame is the '
          'callee\'s window into that state.\n';
    }
    if (id.startsWith('note:school/vault/concepts/boundary-conditions.md')) {
      return '# Boundary conditions\n\n'
          'A boundary condition fixes the value or the derivative at an edge.\n';
    }
    return '# Entropy and the second law\n\n'
        'Entropy counts the microstates a system can occupy. The second law '
        'says that count does not fall in a closed system.\n';
  }

  /// The last path segment, whatever the separator. The fake never touches the
  /// filesystem: a test only needs the name a real copy would store.
  static String _baseName(String path) => path.split(RegExp(r'[/\\]')).last;

  static String _hashOf(String name) {
    var sum = 0;
    for (final unit in name.codeUnits) {
      sum = (sum * 31 + unit) & 0xffffffff;
    }
    return 'sha256:${sum.toRadixString(16).padLeft(4, '0')}';
  }

  static String _kindOf(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.md')) return 'markdown';
    if (lower.endsWith('.pdf')) return 'pdf';
    if (lower.endsWith('.docx')) return 'docx';
    if (lower.endsWith('.txt')) return 'text';
    if (lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg')) {
      return 'image';
    }
    return 'other';
  }

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  @override
  Future<void> start({
    String executable = 'bun',
    List<String> arguments = const [],
    String? workingDirectory,
    Map<String, String>? environment,
  }) async {
    launchedEnvironment = environment;
    if (fail) throw StateError('sidecar not found');
  }

  @override
  Future<void> initialize() async {
    calls.add('initialize');
  }

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) async {
    calls.add(method);
    if (fail) throw const RpcException(-32000, 'core unavailable');
    if (method == 'theme.custom.get') {
      return {
        'tokens': {...themeTokens},
      };
    }
    if (method == 'research.start') {
      _events.add({
        'method': 'research.updated',
        'params': {
          'goalId': params?['goalId'],
          'id': 'research-1',
          'status': 'running',
        },
      });
      return {'id': 'research-1', 'status': 'running'};
    }
    if (method == 'research.cancel') {
      _events.add({
        'method': 'research.updated',
        'params': {
          'goalId': params?['goalId'],
          'id': params?['id'] ?? 'research-1',
          'status': 'cancelled',
        },
      });
      return {'cancelled': true};
    }
    if (method == 'theme.custom.set') {
      final raw = params?['tokens'];
      if (raw is! Map) {
        throw const RpcException(
          -32602,
          'theme.custom.set requires a tokens object',
        );
      }
      final next = <String, String>{};
      for (final entry in raw.entries) {
        final name = entry.key;
        final value = entry.value;
        if (name is! String || !customThemeTokenNames.contains(name)) {
          throw RpcException(
            -32602,
            'theme.custom.set: ${name is String ? '"$name"' : name} is not a '
            'theme token; use ${customThemeTokenNames.join(', ')}',
          );
        }
        if (value is! String || !isHexColour(value)) {
          throw RpcException(
            -32602,
            'theme.custom.set: $name must be a #RRGGBB colour '
            '(got ${value is String ? '"$value"' : value})',
          );
        }
        // The core normalises to one stored spelling; the fake does the same.
        next[name] = hexOfColour(parseHexColour(value)!);
      }
      themeTokenWrites.add({
        'tokens': {...next},
      });
      themeTokens
        ..clear()
        ..addAll(next);
      return {
        'tokens': {...themeTokens},
      };
    }
    if (method == 'keybinds.get') {
      return {
        'keybinds': {..._keybinds},
        'fixedKeybinds': {..._fixedKeybinds},
      };
    }
    if (method == 'keybinds.set') {
      final action = params?['action'];
      if (action is! String || action.trim().isEmpty) {
        throw const RpcException(-32602, 'keybinds.set requires an action id');
      }
      final fixed = params?['fixed'] == true;
      final raw = params?['binding'];
      if (raw != null && raw is! String) {
        throw const RpcException(
          -32602,
          'keybinds.set binding must be a string',
        );
      }
      if (raw == null) {
        // Omitted/null clears the override in either table, exactly as the core
        // documents ("a move between tables is a clear plus the set").
        _keybinds.remove(action);
        _fixedKeybinds.remove(action);
        keybindWrites.add({'action': action, 'binding': null, 'fixed': fixed});
        return {
          'keybinds': {..._keybinds},
          'fixedKeybinds': {..._fixedKeybinds},
        };
      }
      final text = raw.trim();
      if (text.isEmpty) {
        throw const RpcException(
          -32602,
          'a keybind must be space+<key>, a character, a named key or '
          'ctrl+<key>; omit binding to clear it',
        );
      }
      final binding = Binding.tryParse(text);
      if (binding == null || !binding.isStorable) {
        throw RpcException(
          -32602,
          'unsupported key binding "$text": use space+<key>, a character, a '
          'named key or ctrl+<key>',
        );
      }
      final own = fixed ? _fixedKeybinds : _keybinds;
      final other = fixed ? _keybinds : _fixedKeybinds;
      for (final entry in [...own.entries, ...other.entries]) {
        if (entry.key == action) continue;
        final held = Binding.tryParse(entry.value);
        if (held == null || held.format() != binding.format()) continue;
        final message = '${binding.display} is already bound to ${entry.key}.';
        throw RpcException(-32000, message, {
          'kind': 'keybind',
          'action': action,
          'binding': binding.format(),
          'conflict': entry.key,
          'message': message,
        });
      }
      // A move between tables is a clear of the old entry plus the set.
      (fixed ? _keybinds : _fixedKeybinds).remove(action);
      own[action] = binding.format();
      keybindWrites.add({
        'action': action,
        'binding': binding.format(),
        'fixed': fixed,
      });
      return {
        'keybinds': {..._keybinds},
        'fixedKeybinds': {..._fixedKeybinds},
      };
    }
    if (method == 'provider.link') {
      final key = params?['key'] is String ? params!['key'] as String : '';
      if (key == 'bad') {
        throw const RpcException(-32000, 'the provider rejected the key', {
          'kind': 'auth',
        });
      }
      _linked = true;
      return {
        'providerId': params?['providerId'] ?? 'openai',
        'models': ['gpt-4.1-mini', 'gpt-4.1'],
        'secretRef': 'lockedin/openai',
      };
    }
    if (method == 'decision.get') {
      return _decisionView();
    }
    if (method == 'decision.set') {
      final rawEnabled = params?['enabled'];
      if (rawEnabled != null && rawEnabled is! bool) {
        throw const RpcException(
          -32602,
          'decision.set: enabled must be a boolean',
        );
      }
      final rawModel = params?['model'];
      if (rawModel != null && rawModel is! String) {
        throw const RpcException(
          -32602,
          'decision.set: model must be a string',
        );
      }
      final model = rawModel is String ? rawModel.trim() : '';
      if (model.isNotEmpty) {
        // This build has no local model runtime, so a non-empty model would be a
        // promise the app cannot keep: the write is refused and nothing changes.
        const message =
            'This build has no local model runtime, so the decision layer is '
            'rules-only; leave the model empty.';
        throw const RpcException(-32000, message, {
          'kind': 'decision',
          'message': message,
        });
      }
      if (rawEnabled is bool) _decisionEnabled = rawEnabled;
      decisionSets.add({
        if (rawEnabled is bool) 'enabled': rawEnabled,
        if (rawModel is String) 'model': rawModel,
      });
      return _decisionView();
    }
    if (method == 'work.permissions.get') {
      return _workPermissions();
    }
    if (method == 'work.permissions.set') {
      final rawWrite = params?['allowWrite'];
      if (rawWrite != null && rawWrite is! bool) {
        throw const RpcException(
          -32602,
          'work.permissions.set: allowWrite must be true or false',
        );
      }
      final rawCommand = params?['allowCommand'];
      if (rawCommand != null && rawCommand is! bool) {
        throw const RpcException(
          -32602,
          'work.permissions.set: allowCommand must be true or false',
        );
      }
      if (rawWrite is bool) _workAllowWrite = rawWrite;
      if (rawCommand is bool) _workAllowCommand = rawCommand;
      workPermissionSets.add({
        if (rawWrite is bool) 'allowWrite': rawWrite,
        if (rawCommand is bool) 'allowCommand': rawCommand,
      });
      return _workPermissions();
    }
    if (method == 'settings.patch') {
      final patch = params?['patch'];
      final models = patch is Map ? patch['models'] : null;
      if (models is Map && models['chat'] is String) {
        _chatModel = models['chat'] as String;
      }
      return _settings();
    }
    if (method == 'chat.clear') {
      _chatMessages.clear();
      _events.add({'method': 'chat.state', 'params': _chat()});
      return {'ok': true};
    }
    if (method == 'chat.send') {
      final text = params?['text'] is String ? params!['text'] as String : '';
      final rawImages = params?['images'];
      final images = rawImages is List
          ? rawImages.whereType<String>().toList()
          : const <String>[];
      if (images.isEmpty) {
        chatSends.add({'text': text});
      } else {
        chatSends.add({'text': text, 'images': images});
      }
      _chatMessages
        ..add({'id': 'u1', 'role': 'user', 'text': text, 'outcome': 'done'})
        ..add({
          'id': 'a1',
          'role': 'assistant',
          'text': 'Echo: $text',
          'outcome': 'done',
        });
      _events.add({'method': 'chat.state', 'params': _chat()});
      return {'turnId': 'test-turn'};
    }
    if (method == 'source.list') {
      final id = params?['sessionId'];
      if (id != sessionId) throw _unknownSession(id);
      return {'sources': _sources};
    }
    if (method == 'source.add') {
      final id = params?['sessionId'];
      if (id != sessionId) throw _unknownSession(id);
      final raw = params?['paths'];
      final paths = raw is List
          ? raw.whereType<String>().toList()
          : const <String>[];
      if (paths.isEmpty) {
        throw const RpcException(
          -32602,
          'source.add requires a non-empty array of file paths',
        );
      }
      if (paths.any((path) => path.trim().isEmpty)) {
        throw const RpcException(
          -32602,
          'source.add: every entry in paths must be a non-empty string',
        );
      }
      // A test sentinel for the core's copy failure: the real core reports the
      // path it could not copy, and nothing is attached.
      if (paths.any((path) => path.contains('reject'))) {
        final rejected = paths.firstWhere((path) => path.contains('reject'));
        final message = 'could not copy ${_baseName(rejected)}';
        throw RpcException(-32000, message, {
          'kind': 'source',
          'sessionId': sessionId,
          'message': message,
        });
      }
      var added = 0;
      var skipped = 0;
      for (final path in paths) {
        final name = _baseName(path);
        if (_sources.any((source) => source['name'] == name)) {
          skipped += 1;
          continue;
        }
        _sources.add({
          'name': name,
          'originalPath': path,
          'storedPath': 'sources/$name',
          'hash': _hashOf(name),
          'kind': _kindOf(name),
        });
        added += 1;
      }
      return {'added': added, 'skipped': skipped};
    }
    if (method == 'work.remove') {
      final raw = params?['id'];
      if (raw is! String || raw.trim().isEmpty) {
        throw const RpcException(-32602, 'work.remove requires a project id');
      }
      final id = raw.trim();
      final index = _projects.indexWhere((project) => project['id'] == id);
      if (index < 0) {
        throw RpcException(-32000, 'there is no project "$id"');
      }
      final row = _projects[index];
      if (params?['confirmed'] != true) {
        return {
          'removed': false,
          'id': id,
          'name': row['name'],
          'root': row['folder'],
          'message': 'Remove this project? Its files stay.',
        };
      }
      _projects.removeAt(index);
      _projectDetails.remove(id);
      _projectChats.remove(id);
      return {
        'removed': true,
        'id': id,
        'name': row['name'],
        'root': row['folder'],
        'message': 'Removed.',
      };
    }
    if (method == 'work.list') {
      return {'projects': _projects};
    }
    if (method == 'work.templates.list') {
      final raw = params?['projectId'];
      if (raw != null && raw is! String) {
        throw const RpcException(
          -32602,
          'work.templates.list: projectId must be a string',
        );
      }
      final projectId = raw is String ? raw.trim() : '';
      if (projectId.isNotEmpty && !_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      workTemplateQueries.add({'projectId': projectId});
      return {
        'templates': [
          for (final row in workTemplateRows) {...row},
        ],
      };
    }
    if (method == 'mcp.server.get') {
      final name = params?['name'];
      final index = _mcpServerRows.indexWhere((row) => row['name'] == name);
      if (index < 0) {
        throw RpcException(-32000, 'no MCP server named "$name" is configured');
      }
      final row = _mcpServerRows[index];
      return {
        'name': name,
        'transport': 'stdio',
        'command': 'mcp-$name',
        'args': <String>[],
        'enabled': row['enabled'] != false,
      };
    }
    if (method == 'mcp.server.set') {
      final name = params?['name'];
      if (name is! String || name.trim().isEmpty) {
        throw const RpcException(-32602, 'mcp.server.set requires a name');
      }
      final command = params?['command'];
      if (command is! String || command.trim().isEmpty) {
        throw const RpcException(-32602, 'mcp.server.set requires a command');
      }
      final row = <String, dynamic>{
        'name': name.trim(),
        'transport': 'stdio',
        'enabled': params?['enabled'] != false,
        'status': 'stopped',
        'tools': <Object>[],
      };
      final index = _mcpServerRows.indexWhere(
        (row) => row['name'] == name.trim(),
      );
      if (index < 0) {
        _mcpServerRows.add(row);
      } else {
        _mcpServerRows[index] = row;
      }
      return {'servers': _mcpServerRows, 'policy': _mcpPolicy};
    }
    if (method == 'mcp.server.remove') {
      final name = params?['name'];
      final index = _mcpServerRows.indexWhere((row) => row['name'] == name);
      if (index < 0) {
        throw RpcException(-32000, 'no MCP server named "$name" is configured');
      }
      _mcpServerRows.removeAt(index);
      return {'servers': _mcpServerRows, 'policy': _mcpPolicy};
    }
    if (method == 'mcp.list') {
      return {'servers': _mcpServerRows, 'policy': _mcpPolicy};
    }
    if (method == 'mcp.policy.set') {
      const commands = {
        'chill',
        'lockin',
        'skill',
        'flashcards',
        'study-guide',
      };
      const values = {'on', 'explicit', 'off'};
      final rawCommand = params?['command'];
      final command = rawCommand is String ? rawCommand.trim() : '';
      if (!commands.contains(command)) {
        throw const RpcException(
          -32602,
          'mcp.policy.set requires one of chill, lockin, skill, flashcards '
          'or study-guide',
        );
      }
      final rawServer = params?['server'];
      final server = rawServer is String ? rawServer.trim() : '';
      if (server.isEmpty) {
        throw const RpcException(-32602, 'mcp.policy.set requires a server');
      }
      final rawValue = params?['value'];
      final value = rawValue is String ? rawValue.trim() : '';
      if (!values.contains(value)) {
        throw const RpcException(
          -32602,
          'mcp.policy.set requires on, explicit or off',
        );
      }
      if ((command == 'flashcards' || command == 'study-guide') &&
          value == 'on') {
        final message =
            '$command never calls plugins, so plugins.policy.$command.$server '
            'cannot be "on". Set it to "off"; this command never calls a '
            'plugin.';
        throw RpcException(-32000, message, {
          'kind': 'plugin',
          'command': command,
          'server': server,
          'message': message,
        });
      }
      final known =
          _mcpServerRows.any((row) => row['name'] == server) ||
          _mcpPolicy.values.any((row) => row.containsKey(server));
      if (!known) {
        final message = 'there is no configured plugin server "$server"';
        throw RpcException(-32000, message, {
          'kind': 'plugin',
          'command': command,
          'server': server,
          'message': message,
        });
      }
      mcpPolicySets.add({'command': command, 'server': server, 'value': value});
      (_mcpPolicy[command] ??= <String, String>{})[server] = value;
      return {'policy': _mcpPolicy};
    }
    if (method == 'mcp.confirm') {
      final rawId = params?['requestId'];
      if (rawId is! String || rawId.trim().isEmpty) {
        throw const RpcException(-32602, 'mcp.confirm requires a request id');
      }
      final allow = params?['allow'];
      if (allow is! bool) {
        throw const RpcException(
          -32602,
          'mcp.confirm requires an allow boolean',
        );
      }
      final requestId = rawId.trim();
      final failure = permissionConfirmFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'permission',
          'requestId': requestId,
          'message': failure,
        });
      }
      // The prompt is consumed by its answer, exactly like the core's in-memory
      // gate; a second answer for the same id would be a benign no-op there.
      _pendingPermissions.remove(requestId);
      permissionConfirms.add({'requestId': requestId, 'allow': allow});
      return {'ok': true};
    }
    if (method == 'knowledge.read') {
      final rawId = params?['id'];
      final id = rawId is String ? rawId.trim() : '';
      if (id.isEmpty) {
        throw const RpcException(-32602, 'knowledge.read requires an id');
      }
      knowledgeReadIds.add(id);
      final failure = knowledgeReadFailure;
      if (failure != null) throw _knowledgeFailure(failure);
      final hit = _knowledgeReadHit(id);
      if (hit == null) {
        throw _knowledgeFailure('there is no knowledge item "$id"');
      }
      return {
        'hit': hit,
        'body': _knowledgeBody(hit),
        'truncated': knowledgeReadTruncated,
      };
    }
    if (method == 'knowledge.tree') {
      final rawSide = params?['side'];
      final side = rawSide is String && rawSide.trim().isNotEmpty
          ? rawSide.trim()
          : 'all';
      knowledgeScopes.add(side);
      final failure = knowledgeFailure;
      if (failure != null) throw _knowledgeFailure(failure);
      // The real tree accepts `all|school|skills` only; `work` is a protocol
      // error there, so the fake refuses it too instead of quietly answering.
      if (side != 'all' && side != 'school' && side != 'skills') {
        throw _knowledgeFailure('knowledge.tree does not accept side "$side"');
      }
      if (knowledgeEmpty) return {'groups': <Map<String, dynamic>>[]};
      if (side == 'all') return {'groups': _knowledgeTree};
      return {'groups': _knowledgeTreeFor(side)};
    }
    if (method == 'knowledge.search') {
      final rawQuery = params?['query'];
      final query = rawQuery is String ? rawQuery.trim().toLowerCase() : '';
      final rawScope = params?['scope'];
      final scope = rawScope is String && rawScope.trim().isNotEmpty
          ? rawScope.trim()
          : 'all';
      knowledgeQueries.add(query);
      knowledgeScopes.add(scope);
      final failure = knowledgeFailure;
      if (failure != null) throw _knowledgeFailure(failure);
      if (query.isEmpty) return {'hits': <Map<String, dynamic>>[]};
      final hits = <Map<String, dynamic>>[
        for (final hit in _knowledgeHits)
          if ((scope == 'all' || hit['side'] == scope) &&
              '${hit['title']} ${hit['excerpt']} ${hit['path']}'
                  .toLowerCase()
                  .contains(query))
            hit,
      ];
      return {'hits': hits};
    }
    if (method == 'archive.list') {
      final failure = archiveFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'archive',
          'message': failure,
        });
      }
      if (archiveEmpty) return const {'rows': <Map<String, dynamic>>[]};
      return {'rows': archiveRows};
    }
    if (method == 'archive.restore') {
      final rawId = params?['id'];
      final id = rawId is String ? rawId.trim() : '';
      if (id.isEmpty) {
        throw const RpcException(
          -32602,
          'archive.restore requires a session id',
        );
      }
      final rawSide = params?['side'];
      if (rawSide != 'school' && rawSide != 'skills') {
        throw const RpcException(
          -32602,
          'archive.restore side must be school or skills',
        );
      }
      final side = rawSide as String;
      final failure = archiveRestoreFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'session-action',
          'id': id,
          'action': 'restore',
          'message': failure,
        });
      }
      final index = archiveRows.indexWhere(
        (row) => row['id'] == id && row['side'] == side,
      );
      if (index < 0) {
        final message = 'there is no archived session "$id"';
        throw RpcException(-32000, message, {
          'kind': 'session-action',
          'id': id,
          'action': 'restore',
          'message': message,
        });
      }
      final row = archiveRows.removeAt(index);
      archiveRestores.add({'id': id, 'side': side});
      // A school restore is a session coming back live. A skills restore is a
      // goal folder; it never appears in `session.list`, so the live sessions
      // are left exactly as they were.
      if (side == 'school') {
        sessionRows.add({
          'id': id,
          'name': row['name'] ?? id,
          'date': row['date'] ?? '',
          'sources': 0,
          'steps': {'done': 0, 'total': 0},
          'archived': false,
        });
      }
      return {'action': 'restore', 'side': side, 'id': id};
    }
    if (method == 'archive.remove') {
      final rawId = params?['id'];
      final id = rawId is String ? rawId.trim() : '';
      if (id.isEmpty) {
        throw const RpcException(
          -32602,
          'archive.remove requires an archived item id',
        );
      }
      final rawSide = params?['side'];
      if (rawSide != 'school' && rawSide != 'skills') {
        throw const RpcException(
          -32602,
          'archive.remove side must be school or skills',
        );
      }
      final side = rawSide as String;
      final failure = archiveRemoveFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'archive',
          'id': id,
          'side': side,
          'message': failure,
        });
      }
      final index = archiveRows.indexWhere(
        (row) => row['id'] == id && row['side'] == side,
      );
      if (index < 0) {
        final message = 'there is no archived session "$id" on the $side side';
        throw RpcException(-32000, message, {
          'kind': 'archive',
          'id': id,
          'side': side,
          'message': message,
        });
      }
      archiveRows.removeAt(index);
      archiveRemoves.add({'id': id, 'side': side});
      return {'action': 'delete', 'side': side, 'id': id};
    }
    if (method == 'mcp.refresh') {
      return {'servers': _mcpRefreshedRows()};
    }
    if (method == 'work.open') {
      final id = params?['id'];
      final detail = id is String ? _projectDetails[id] : null;
      if (detail == null) {
        final key = id is String ? id : '';
        throw RpcException(-32000, 'project not found', {
          'kind': 'project',
          'id': key,
          'message': 'project $key was not found',
        });
      }
      return {'project': detail};
    }
    if (method == 'work.changes') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(-32602, 'work.changes requires a project id');
      }
      if (!_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      // The archived swarm's root is gone, so the real core answers with the
      // documented unavailable shape: a success, not an error. A test can render
      // that muted note beside the healthy project's summary.
      if (projectId == archivedProjectId) {
        return const {'changes': _unavailableChanges};
      }
      return const {'changes': _changesSummary};
    }
    if (method == 'work.approvals.list') {
      final rawProject = params?['projectId'];
      if (rawProject != null &&
          (rawProject is! String || rawProject.trim().isEmpty)) {
        throw const RpcException(
          -32602,
          'work.approvals.list: projectId must be a non-empty string when '
          'supplied',
        );
      }
      final projectFilter = rawProject is String ? rawProject.trim() : null;
      return {
        'writes': [
          for (final write in approvalsWrites)
            if (projectFilter == null || write['projectId'] == projectFilter)
              write,
        ],
        'commands': [
          for (final command in approvalsCommands)
            if (projectFilter == null || command['projectId'] == projectFilter)
              command,
        ],
      };
    }
    if (method == 'activity.list') {
      final rawKind = params?['kind'];
      if (rawKind != null &&
          (rawKind is! String || !_activityKinds.contains(rawKind))) {
        throw const RpcException(
          -32602,
          'activity.list: unknown kind; expected one of write-decision, '
          'command-decision, swarm',
        );
      }
      final rawProject = params?['project'];
      if (rawProject != null &&
          (rawProject is! String || rawProject.trim().isEmpty)) {
        throw const RpcException(
          -32602,
          'activity.list: project must be a project id',
        );
      }
      final rawLimit = params?['limit'];
      if (rawLimit != null &&
          (rawLimit is! int || rawLimit < 1 || rawLimit > 500)) {
        throw const RpcException(
          -32602,
          'activity.list: limit must be a whole number from 1 to 500',
        );
      }
      activityQueries.add({
        'kind': ?rawKind,
        if (rawProject != null) 'project': (rawProject as String).trim(),
        'limit': ?rawLimit,
      });
      if (activityFailure != null) {
        throw RpcException(-32000, activityFailure!, {
          'kind': 'activity',
          'message': activityFailure,
        });
      }
      if (activityEmpty) {
        return const {'records': [], 'skipped': 0, 'empty': true};
      }
      final projectFilter = rawProject is String ? rawProject.trim() : null;
      return {
        'records': [
          for (final record in activityRows)
            if (rawKind == null || record['kind'] == rawKind)
              if (projectFilter == null || record['project'] == projectFilter)
                record,
        ],
        'skipped': activitySkipped,
        'empty': false,
      };
    }
    if (method == 'work.swarm.runs' ||
        method == 'work.swarm.board' ||
        method == 'work.swarm.run' ||
        method == 'work.swarm.cancel' ||
        method == 'work.swarm.remove' ||
        method == 'work.swarm.retry') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw RpcException(-32602, '$method requires a project id');
      }
      if (!_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      if (swarmFailure != null) {
        throw RpcException(-32000, swarmFailure!, {
          'kind': 'swarm',
          'projectId': projectId,
          'message': swarmFailure,
        });
      }
      if (method == 'work.swarm.runs') {
        return {
          'runs': [
            for (final board in _swarmBoards.values)
              if (board['projectId'] == projectId) board,
          ],
        };
      }
      if (method == 'work.swarm.board') {
        final runId = _swarmRunParam(params, method);
        final board = _swarmBoards[runId];
        if (board == null || board['projectId'] != projectId) {
          throw _unknownSwarmRun(projectId, runId);
        }
        return {'board': board};
      }
      if (method == 'work.swarm.run') {
        final rawObjective = params?['objective'];
        if (rawObjective is! String || rawObjective.trim().isEmpty) {
          throw const RpcException(
            -32602,
            'work.swarm.run requires a non-empty objective',
          );
        }
        final objective = rawObjective.trim();
        final rawPlan = params?['plan'];
        if (rawPlan is! List || rawPlan.isEmpty) {
          throw const RpcException(
            -32602,
            'work.swarm.run requires a non-empty plan',
          );
        }
        final plan = <Map<String, dynamic>>[];
        for (final entry in rawPlan) {
          if (entry is! Map) {
            throw const RpcException(
              -32602,
              'work.swarm.run: every plan task must be an object',
            );
          }
          final row = Map<String, dynamic>.from(entry);
          final title = row['title'];
          if (title is! String || title.trim().isEmpty) {
            throw const RpcException(
              -32602,
              'work.swarm.run: every task needs a non-empty title',
            );
          }
          if (row['assignment'] is! String) {
            throw const RpcException(
              -32602,
              'work.swarm.run: every task needs an assignment string',
            );
          }
          final agentId = row['agentId'];
          if (agentId != null &&
              (agentId is! String || agentId.trim().isEmpty)) {
            throw const RpcException(
              -32602,
              'work.swarm.run: an agentId must be a non-empty string',
            );
          }
          plan.add(row);
        }
        final rawParallel = params?['parallel'];
        final parallel = rawParallel is int ? rawParallel : 1;
        if (rawParallel != null && (parallel < 1 || parallel > 4)) {
          throw const RpcException(
            -32602,
            'work.swarm.run: parallel must be a whole number from 1 to 4',
          );
        }
        swarmRunRequests.add({
          'projectId': projectId,
          'objective': objective,
          'plan': [for (final entry in plan) Map<String, dynamic>.from(entry)],
          'parallel': parallel,
        });
        _swarmRunCount += 1;
        final runId = 'run-new-$_swarmRunCount';
        final board = <String, dynamic>{
          'runId': runId,
          'projectId': projectId,
          'objective': objective,
          'status': 'running',
          'parallel': parallel,
          'startedAt': '2026-11-16T09:00:00.000Z',
          'reportPath': null,
          'live': true,
          'tasks': [
            for (var index = 0; index < plan.length; index++)
              {
                'id': 'task-${index + 1}',
                'title': plan[index]['title'],
                'agentId': plan[index]['agentId'] ?? 'reviewer-9ab12c',
                'assignment': plan[index]['assignment'],
                'status': index < parallel ? 'running' : 'pending',
              },
          ],
        };
        _swarmBoards[runId] = board;
        // The reply names the run while it is still live; the settled board
        // arrives as the documented `work.swarm.updated` notification.
        Timer(const Duration(milliseconds: 5), () {
          final settled = _settledSwarm(projectId, runId);
          if (settled == null) return;
          _swarmBoards[runId] = settled;
          emitEvent('work.swarm.updated', {
            'projectId': projectId,
            'runId': runId,
            'board': settled,
          });
        });
        return {'runId': runId, 'board': board};
      }
      if (method == 'work.swarm.cancel') {
        final runId = _swarmRunParam(params, method);
        final board = _swarmBoards[runId];
        if (board == null || board['projectId'] != projectId) {
          throw _unknownSwarmRun(projectId, runId);
        }
        swarmCancels.add(runId);
        // Cancelling a finished run is a no-op that returns its board.
        if (board['live'] != true) return {'board': board};
        final rows = board['tasks'] is List ? board['tasks'] as List : const [];
        final cancelled = <String, dynamic>{
          ...board,
          'status': 'cancelled',
          'live': false,
          'finishedAt': '2026-11-16T09:02:00.000Z',
          'reportPath': _swarmReportPath(projectId, runId),
          'tasks': [
            for (final row in rows.whereType<Map>())
              {
                ...Map<String, dynamic>.from(row),
                if (row['status'] == 'running' || row['status'] == 'pending')
                  'status': 'cancelled',
              },
          ],
        };
        _swarmBoards[runId] = cancelled;
        return {'board': cancelled};
      }
      if (method == 'work.swarm.remove') {
        final runId = _swarmRunParam(params, method);
        final board = _swarmBoards[runId];
        if (board == null) return {'removed': false, 'reportPath': null};
        if (board['live'] == true) {
          throw RpcException(
            -32000,
            'cancel the swarm before removing its record',
            {
              'kind': 'swarm',
              'projectId': projectId,
              'runId': runId,
              'message': 'cancel the swarm before removing its record',
            },
          );
        }
        _swarmBoards.remove(runId);
        swarmRemoves.add(runId);
        return {'removed': true, 'reportPath': board['reportPath']};
      }
      // work.swarm.retry
      final runId = _swarmRunParam(params, method);
      final rawTask = params?['taskId'];
      if (rawTask is! String || rawTask.trim().isEmpty) {
        throw const RpcException(-32602, 'work.swarm.retry requires a task id');
      }
      final taskId = rawTask.trim();
      final board = _swarmBoards[runId];
      if (board == null || board['projectId'] != projectId) {
        throw _unknownSwarmRun(projectId, runId);
      }
      final rows = board['tasks'] is List ? board['tasks'] as List : const [];
      final matches = rows
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .where((row) => row['id'] == taskId)
          .toList();
      final task = matches.isEmpty ? null : matches.first;
      if (task == null) {
        throw RpcException(-32000, 'task "$taskId" is not on run "$runId"', {
          'kind': 'swarm',
          'projectId': projectId,
          'runId': runId,
          'message': 'task "$taskId" is not on run "$runId"',
        });
      }
      if (task['status'] != 'failed' && task['status'] != 'blocked') {
        throw RpcException(
          -32000,
          'only a failed or blocked task can be retried',
          {
            'kind': 'swarm',
            'projectId': projectId,
            'runId': runId,
            'message': 'only a failed or blocked task can be retried',
          },
        );
      }
      swarmRetries.add({'runId': runId, 'taskId': taskId});
      _swarmRunCount += 1;
      final newId = 'run-new-$_swarmRunCount';
      final retryBoard = <String, dynamic>{
        'runId': newId,
        'projectId': projectId,
        'objective': task['title'],
        'status': 'done',
        'parallel': 1,
        'startedAt': '2026-11-16T09:05:00.000Z',
        'finishedAt': '2026-11-16T09:06:00.000Z',
        'reportPath': _swarmReportPath(projectId, newId),
        'retryOf': {'runId': runId, 'taskId': taskId},
        'live': false,
        'tasks': [
          {
            'id': 'task-1',
            'title': task['title'],
            'agentId': task['agentId'],
            'assignment': task['assignment'],
            'status': 'done',
            'summary': 'Retried and read the project.',
          },
        ],
      };
      _swarmBoards[newId] = retryBoard;
      return {'runId': newId, 'board': retryBoard};
    }
    if (method == 'work.write.decide') {
      final rawId = params?['id'];
      if (rawId is! String || rawId.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'work.write.decide requires a proposal id',
        );
      }
      final proposalId = rawId.trim();
      final decision = params?['decision'];
      if (decision != 'approve' && decision != 'reject') {
        throw const RpcException(
          -32602,
          'work.write.decide requires decision "approve" or "reject"',
        );
      }
      final rawHunks = params?['hunks'];
      if (rawHunks != null && decision != 'approve') {
        throw const RpcException(
          -32602,
          'work.write.decide: hunks are only accepted with an approve decision',
        );
      }
      List<int>? hunks;
      if (rawHunks != null) {
        if (rawHunks is! List) {
          throw const RpcException(
            -32602,
            'work.write.decide: hunks must be an array of hunk indices',
          );
        }
        hunks = [];
        for (final entry in rawHunks) {
          if (entry is! int || entry < 0) {
            throw const RpcException(
              -32602,
              'work.write.decide: every hunk index must be a non-negative '
              'whole number',
            );
          }
          hunks.add(entry);
        }
      }
      final index = approvalsWrites.indexWhere(
        (write) => write['id'] == proposalId,
      );
      if (index < 0) {
        final message =
            'there is no pending write proposal "$proposalId"; propose it again';
        throw RpcException(-32000, message, {
          'kind': 'write',
          'id': proposalId,
          'message': message,
        });
      }
      final write = approvalsWrites[index];
      final path = write['path'] is String ? write['path'] as String : '';
      if (approvalDecideFailure != null) {
        throw RpcException(-32000, approvalDecideFailure!, {
          'kind': 'write',
          'projectId': projectId,
          'path': path,
          'message': approvalDecideFailure,
        });
      }
      if (decision == 'approve' && hunks != null && hunks.isEmpty) {
        const message = 'select at least one hunk before approving this write';
        throw RpcException(-32000, message, {
          'kind': 'write',
          'projectId': projectId,
          'path': path,
          'message': message,
        });
      }
      writeDecisions.add({
        'id': proposalId,
        'decision': decision,
        'hunks': ?hunks,
      });
      approvalsWrites.removeAt(index);
      final applied = decision == 'approve';
      final appliedHunks = applied ? hunks ?? const [0, 1] : const <int>[];
      return {
        'decision': decision,
        'applied': applied,
        'path': path,
        'hunks': appliedHunks,
        'bytes': applied ? 42 : 0,
      };
    }
    if (method == 'work.command.decide') {
      final rawId = params?['id'];
      if (rawId is! String || rawId.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'work.command.decide requires a proposal id',
        );
      }
      final proposalId = rawId.trim();
      final decision = params?['decision'];
      if (decision != 'approve' && decision != 'deny') {
        throw const RpcException(
          -32602,
          'work.command.decide requires decision "approve" or "deny"',
        );
      }
      final rawReason = params?['reason'];
      if (rawReason != null && rawReason is! String) {
        throw const RpcException(
          -32602,
          'work.command.decide: reason must be a string',
        );
      }
      final index = approvalsCommands.indexWhere(
        (command) => command['id'] == proposalId,
      );
      if (index < 0) {
        final message =
            'there is no pending command proposal "$proposalId"; propose it '
            'again';
        throw RpcException(-32000, message, {
          'kind': 'command',
          'id': proposalId,
          'message': message,
        });
      }
      if (approvalDecideFailure != null) {
        throw RpcException(-32000, approvalDecideFailure!, {
          'kind': 'command',
          'projectId': projectId,
          'message': approvalDecideFailure,
        });
      }
      final command = approvalsCommands[index];
      commandDecisions.add({
        'id': proposalId,
        'decision': decision,
        'reason': ?rawReason,
      });
      approvalsCommands.removeAt(index);
      final approved = decision == 'approve';
      return {
        'decision': decision,
        'argv': command['argv'] ?? const <String>[],
        'cwd': command['cwd'] ?? '.',
        'exitCode': approved ? 0 : null,
        'stdout': approved ? 'ok' : '',
        'stderr': '',
        'timedOut': false,
      };
    }
    if (method == 'work.create') {
      final rawName = params?['name'];
      final name = rawName is String ? rawName.trim() : '';
      if (name.isEmpty) {
        throw const RpcException(
          -32602,
          'work.create requires a non-empty name string',
        );
      }
      final rawFolder = params?['folder'];
      final folder = rawFolder is String ? rawFolder.trim() : '';
      if (folder.isEmpty) {
        throw const RpcException(-32602, 'work.create requires a folder path');
      }
      final rawMode = params?['mode'];
      if (rawMode != 'chat' && rawMode != 'swarm') {
        throw const RpcException(
          -32602,
          'work.create requires mode "chat" or "swarm"',
        );
      }
      final mode = rawMode as String;
      // A test sentinel for the core's refusal: nothing is registered.
      if (folder.contains('reject')) {
        const message = 'could not register the folder: permission denied';
        throw const RpcException(-32000, message, {
          'kind': 'project-create',
          'message': message,
        });
      }
      workCreates.add({'name': name, 'folder': folder, 'mode': mode});
      final id = _projectIdFor(name);
      _projects.add({
        'id': id,
        'name': name,
        'folder': folder,
        'mode': mode,
        'swarmName': '',
        'archived': false,
        'agents': const <Map<String, dynamic>>[],
      });
      _projectDetails[id] = {
        'id': id,
        'name': name,
        'root': folder,
        'rootMissing': false,
        'mode': mode,
        'swarmName': '',
        'archived': false,
        'instructions': '',
        'defaultAgent': null,
        'agents': const <Map<String, dynamic>>[],
        'tasks': 0,
        'hasGit': false,
        'lastOpened': '',
      };
      return {'id': id, 'name': name};
    }
    if (method == 'work.agent.save') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.agent.save requires a project id',
        );
      }
      final detail = _projectDetails[projectId];
      if (detail == null) throw _unknownProject(projectId);
      final rawAgent = params?['agent'];
      if (rawAgent is! Map) {
        throw const RpcException(
          -32602,
          'work.agent.save requires an agent object',
        );
      }
      final payload = Map<String, dynamic>.from(rawAgent);
      agentSaves.add(payload);
      final profiles = _agentProfiles(detail);
      final rawId = payload['id'];
      final id = rawId is String ? rawId.trim() : '';
      final rawName = payload['name'];
      final name = rawName is String ? rawName.trim() : '';
      if (name.isEmpty && id.isEmpty) {
        throw const RpcException(
          -32602,
          'work.agent.save requires agent.name when creating an agent',
        );
      }
      if (name.isNotEmpty) {
        final clash = profiles.any(
          (profile) =>
              profile['id'] != id &&
              (profile['name'] is String
                      ? (profile['name'] as String).toLowerCase()
                      : '') ==
                  name.toLowerCase(),
        );
        if (clash) {
          throw _agentFailure(
            projectId,
            'an agent named "$name" already exists in this project',
            agentId: id.isEmpty ? null : id,
          );
        }
      }
      late String savedId;
      if (id.isEmpty) {
        savedId = _agentIdFor(name, {
          for (final profile in profiles)
            if (profile['id'] is String) profile['id'] as String,
        });
        profiles.add({
          'id': savedId,
          'name': name,
          'role': payload['role'] ?? '',
          'instructions': payload['instructions'] ?? '',
          'model': payload['model'] ?? '',
          'maxToolCalls': payload['maxToolCalls'] ?? 8,
          'allowedTools': payload['allowedTools'] ?? const <String>[],
          'allowWrite': payload['allowWrite'] ?? false,
          'allowCommand': payload['allowCommand'] ?? false,
          'template': payload['template'] ?? '',
        });
      } else {
        final index = profiles.indexWhere((profile) => profile['id'] == id);
        if (index < 0) {
          throw _agentFailure(
            projectId,
            'agent $id was not found in this project',
            agentId: id,
          );
        }
        savedId = id;
        final current = profiles[index];
        profiles[index] = <String, dynamic>{
          ...current,
          for (final field in const [
            'name',
            'role',
            'instructions',
            'model',
            'maxToolCalls',
            'allowedTools',
            'allowWrite',
            'allowCommand',
            'template',
          ])
            if (payload.containsKey(field)) field: payload[field],
          'id': id,
        };
      }
      detail['agents'] = profiles;
      _syncProjectRow(projectId);
      return {'id': savedId};
    }
    if (method == 'work.agent.delete') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.agent.delete requires a project id',
        );
      }
      final detail = _projectDetails[projectId];
      if (detail == null) throw _unknownProject(projectId);
      final rawAgent = params?['agentId'];
      final agentId = rawAgent is String ? rawAgent.trim() : '';
      if (agentId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.agent.delete requires an agent id',
        );
      }
      agentDeletes.add(agentId);
      final profiles = _agentProfiles(detail);
      final index = profiles.indexWhere((profile) => profile['id'] == agentId);
      if (index < 0) {
        throw _agentFailure(
          projectId,
          'agent $agentId was not found in this project',
          agentId: agentId,
        );
      }
      profiles.removeAt(index);
      detail['agents'] = profiles;
      // Deleting the default leaves the project with no default; a neighbour is
      // never promoted silently.
      if (detail['defaultAgent'] == agentId) detail['defaultAgent'] = null;
      _syncProjectRow(projectId);
      return {'ok': true};
    }
    if (method == 'work.defaultAgent') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.defaultAgent requires a project id',
        );
      }
      final detail = _projectDetails[projectId];
      if (detail == null) throw _unknownProject(projectId);
      final rawAgent = params?['agentId'];
      if (rawAgent != null && rawAgent is! String) {
        throw const RpcException(
          -32602,
          'work.defaultAgent: agentId must be a string or null',
        );
      }
      final agentId = rawAgent is String ? rawAgent.trim() : '';
      if (agentId.isEmpty) {
        agentDefaults.add(null);
        detail['defaultAgent'] = null;
        return {'defaultAgent': null};
      }
      final known = _agentProfiles(detail)
          .any((profile) => profile['id'] == agentId);
      if (!known) {
        throw _agentFailure(
          projectId,
          'agent $agentId was not found in this project',
          agentId: agentId,
        );
      }
      agentDefaults.add(agentId);
      detail['defaultAgent'] = agentId;
      return {'defaultAgent': agentId};
    }
    if (method == 'work.chat.list') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.chat.list requires a project id',
        );
      }
      if (!_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      return {
        'chats': List<String>.from(
          _projectChats[projectId] ?? const <String>[],
        ),
      };
    }
    if (method == 'work.chat.open') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.chat.open requires a project id',
        );
      }
      if (!_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      final chats = _projectChats.putIfAbsent(projectId, () => <String>[]);
      final rawChat = params?['chatId'];
      late final String chatId;
      if (rawChat != null) {
        if (rawChat is! String || rawChat.trim().isEmpty) {
          throw const RpcException(
            -32602,
            'work.chat.open: chatId must be a non-empty string when supplied',
          );
        }
        chatId = rawChat.trim();
        if (!chats.contains(chatId)) throw _unknownChat(projectId, chatId);
      } else {
        chatId = chats.isEmpty ? 'chat-1' : chats.last;
        if (!chats.contains(chatId)) chats.add(chatId);
      }
      _workChatMessages.putIfAbsent(
        _projectChatKey(projectId, chatId),
        () => <Map<String, dynamic>>[],
      );
      return {'chatId': chatId, 'snapshot': _workChat(projectId, chatId)};
    }
    if (method == 'work.chat.send') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.chat.send requires a project id',
        );
      }
      if (!_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      final rawChat = params?['chatId'];
      if (rawChat is! String || rawChat.trim().isEmpty) {
        throw const RpcException(-32602, 'work.chat.send requires a chat id');
      }
      final chatId = rawChat.trim();
      final chats = _projectChats[projectId] ?? const <String>[];
      if (!chats.contains(chatId)) throw _unknownChat(projectId, chatId);
      final text = params?['text'] is String ? params!['text'] as String : '';
      if (text.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'work.chat.send requires a non-empty text string',
        );
      }
      final key = _projectChatKey(projectId, chatId);
      final turn = (_workChatTurns[key] ?? 0) + 1;
      _workChatTurns[key] = turn;
      _workChatMessages.putIfAbsent(key, () => []).addAll([
        {'id': 'w$turn-u', 'role': 'user', 'text': text, 'outcome': 'done'},
        {
          'id': 'w$turn-a',
          'role': 'assistant',
          'text': 'Project echo: $text',
          'outcome': 'done',
        },
      ]);
      _events.add({
        'method': 'work.chat.state',
        'params': {
          'projectId': projectId,
          'chatId': chatId,
          ..._workChat(projectId, chatId),
        },
      });
      return {'turnId': key};
    }
    if (method == 'work.chat.cancel') {
      final rawProject = params?['projectId'];
      final projectId = rawProject is String ? rawProject.trim() : '';
      if (projectId.isEmpty) {
        throw const RpcException(
          -32602,
          'work.chat.cancel requires a project id',
        );
      }
      if (!_projectDetails.containsKey(projectId)) {
        throw _unknownProject(projectId);
      }
      final rawChat = params?['chatId'];
      if (rawChat is! String || rawChat.trim().isEmpty) {
        throw const RpcException(-32602, 'work.chat.cancel requires a chat id');
      }
      return {'ok': true};
    }
    if (method == 'skill.list') {
      return {
        'skills': [
          for (final row in _skillRows)
            if (!archivedSkillIds.contains(row['id']) &&
                !removedSkillIds.contains(row['id']))
              row,
          for (final detail in _createdSkills.values)
            if (!archivedSkillIds.contains(detail['id']) &&
                !removedSkillIds.contains(detail['id']))
              _skillRowOf(detail),
        ],
      };
    }
    if (method == 'skill.open') {
      final rawId = params?['id'];
      if (rawId is! String || rawId.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.open requires a skill id');
      }
      final id = rawId.trim();
      final detail = _skillFor(id);
      if (detail == null) throw _unknownSkill(id);
      // The stored curriculum is the authoritative one, so a save followed by a
      // reopen reports exactly what was saved.
      return {
        'skill': {...detail, 'stages': _skillStagesOf(id)},
      };
    }
    if (method == 'skill.create') {
      final rawGoal = params?['goal'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.create requires a non-empty goal string',
        );
      }
      final goal = rawGoal.trim();
      if (goal.length > 200) {
        throw const RpcException(
          -32602,
          'skill.create: a goal is at most 200 characters',
        );
      }
      final rawPrior = params?['prior'];
      if (rawPrior != null && rawPrior is! String) {
        throw const RpcException(
          -32602,
          'skill.create: prior must be a string',
        );
      }
      final prior = rawPrior is String ? rawPrior.trim() : '';
      if (prior.length > 2000) {
        throw const RpcException(
          -32602,
          'skill.create: prior is at most 2000 characters',
        );
      }
      skillCreates.add({'goal': goal, 'prior': prior});
      final taken = {
        for (final row in [..._skillRows, ..._createdSkills.values])
          if (row['id'] is String) row['id'] as String,
      };
      final id = _skillIdFor(goal, taken);
      final name = goal.length > 60 ? goal.substring(0, 60) : goal;
      // The core writes one template chapter and calls no provider, so the
      // course is the built-in plan and the reply says so.
      _createdSkills[id] = {
        'id': id,
        'name': name,
        'goal': goal,
        'prior': prior,
        'created': '2026-11-16T12:00:00Z',
        'plan': 'template',
        'chapters': [
          {
            'id': 'ch-1',
            'title': 'Getting started',
            'guide': '01-getting-started.md',
            'practical': '01-getting-started-practical.md',
            'done': false,
          },
        ],
        'chats': const <Map<String, dynamic>>[],
      };
      return {'id': id, 'name': name, 'plan': 'template'};
    }
    if (method == 'skill.stages.save') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.stages.save requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final rawConfirmed = params?['confirmed'];
      if (rawConfirmed != null && rawConfirmed is! bool) {
        throw const RpcException(
          -32602,
          'skill.stages.save: confirmed must be a boolean',
        );
      }
      final confirmed = rawConfirmed == true;
      final raw = params?['stages'];
      if (raw is! List) {
        throw const RpcException(
          -32602,
          'skill.stages.save requires a stages array',
        );
      }
      if (raw.isEmpty || raw.length > 16) {
        throw RpcException(
          -32602,
          'skill.stages.save: a curriculum holds 1–16 stages; '
          'this save has ${raw.length}',
        );
      }
      final failure = skillStagesFailure;
      if (failure != null) throw _skillStageRefusal(goalId, failure);

      final existing = {
        for (final row in _skillStagesOf(goalId)) '${row['id']}': row,
      };
      final requested = <({String? id, String title, String milestone})>[];
      final kept = <String>{};
      for (final entry in raw) {
        if (entry is! Map) {
          throw const RpcException(
            -32602,
            'skill.stages.save: every stage is an object',
          );
        }
        final record = Map<String, dynamic>.from(entry);
        final rawId = record['id'];
        if (rawId != null && rawId is! String) {
          throw const RpcException(
            -32602,
            'skill.stages.save: a stage id must be a string',
          );
        }
        // The core refuses a present-but-blank id: a new stage omits the key.
        // Mirroring that here is what catches a client that sends `id: ""`.
        if (rawId is String && rawId.trim().isEmpty) {
          throw RpcException(
            -32602,
            'skill.stages.save: stage ${raw.indexOf(entry) + 1} has an empty id',
          );
        }
        final id = rawId is String ? rawId.trim() : null;
        if (id != null && !existing.containsKey(id)) {
          throw RpcException(
            -32602,
            'skill.stages.save: this goal has no stage "${id.trim()}"',
          );
        }
        if (id != null) {
          if (!kept.add(id)) {
            throw RpcException(
              -32602,
              'skill.stages.save: two stages share the id "$id"',
            );
          }
        }
        final rawTitle = record['title'];
        if (rawTitle is! String || rawTitle.trim().isEmpty) {
          throw const RpcException(
            -32602,
            'skill.stages.save: every stage needs a title',
          );
        }
        final rawMilestone = record['milestone'];
        if (rawMilestone != null && rawMilestone is! String) {
          throw const RpcException(
            -32602,
            'skill.stages.save: a milestone must be a string',
          );
        }
        requested.add((
          id: id,
          title: rawTitle.trim(),
          milestone: rawMilestone is String ? rawMilestone.trim() : '',
        ));
      }

      // Removing a `done` stage discards completed work, so it needs the
      // shell's explicit confirmation.
      if (!confirmed) {
        final lost = [
          for (final row in existing.values)
            if (!kept.contains('${row['id']}') && row['status'] == 'done') row,
        ];
        if (lost.isNotEmpty) {
          final titles = lost.map((row) => '“${row['title']}”').join(', ');
          throw _skillStageConfirm(goalId, titles);
        }
      }

      final taken = {for (final row in existing.values) '${row['id']}'};
      var next = 1;
      String freshId() {
        for (;;) {
          final candidate = 'stage-$next';
          next += 1;
          if (taken.contains(candidate)) continue;
          taken.add(candidate);
          return candidate;
        }
      }

      final stored = <Map<String, dynamic>>[];
      for (final stage in requested) {
        final id = stage.id;
        if (id != null) {
          stored.add({
            'id': id,
            'title': stage.title,
            if (stage.milestone.isNotEmpty) 'milestone': stage.milestone,
            'status': existing[id]!['status'] ?? 'pending',
          });
        } else {
          stored.add({
            'id': freshId(),
            'title': stage.title,
            if (stage.milestone.isNotEmpty) 'milestone': stage.milestone,
            'status': 'pending',
          });
        }
      }
      _skillStages[goalId] = stored;
      skillStageSaves.add({
        'goalId': goalId,
        'stages': [
          for (final stage in requested)
            {
              'id': stage.id,
              'title': stage.title,
              if (stage.milestone.isNotEmpty) 'milestone': stage.milestone,
            },
        ],
        'confirmed': confirmed,
      });
      return {
        'stages': [for (final row in stored) Map<String, dynamic>.from(row)],
      };
    }
    if (method == 'skill.archive' || method == 'skill.remove') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw RpcException(-32602, '$method requires a goal id');
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final action = method == 'skill.archive' ? 'archive' : 'delete';
      final failure = skillManagerFailure;
      if (failure != null) throw _skillActionRefusal(goalId, action, failure);
      if (action == 'archive') {
        skillArchiveCalls.add(goalId);
        archivedSkillIds.add(goalId);
        return {'action': 'archive', 'backend': 'folder'};
      }
      skillRemoveCalls.add(goalId);
      removedSkillIds.add(goalId);
      return {'action': 'delete'};
    }
    if (method == 'skill.export') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.export requires a goal id');
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final failure = skillManagerFailure;
      if (failure != null) throw _skillActionRefusal(goalId, 'export', failure);
      skillExportCalls.add(goalId);
      return {
        'action': 'export',
        'path': '/tmp/lockedin/exports/goal-$goalId.zip',
      };
    }
    if (method == 'skill.chapter') {
      final rawId = params?['id'];
      if (rawId is! String || rawId.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.chapter requires a skill id');
      }
      final id = rawId.trim();
      final rawChapter = params?['chapterId'];
      if (rawChapter is! String || rawChapter.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.chapter requires a chapter id');
      }
      final chapterId = rawChapter.trim();
      final rawPractical = params?['practical'];
      if (rawPractical != null && rawPractical is! bool) {
        throw const RpcException(
          -32602,
          'skill.chapter practical must be a boolean',
        );
      }
      final practical = rawPractical == true;
      if (id != skillId) throw _unknownSkill(id);
      final title = _skillChapters[chapterId];
      if (title == null) throw _unknownChapter(id, chapterId);
      final failure = skillChapterFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'chapter',
          'id': id,
          'chapterId': chapterId,
          'message': failure,
        });
      }
      return {
        'text': _chapterText(chapterId, practical),
        'practical': practical,
        'chapter': {'id': chapterId, 'title': title},
      };
    }
    if (method == 'skill.lesson.read') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.lesson.read requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      final rawStage = params?['stageId'];
      if (rawStage is! String || rawStage.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.lesson.read requires a stage id',
        );
      }
      final stageId = rawStage.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      if (!_stagedStages.containsKey(stageId)) {
        throw _unknownStage(goalId, stageId);
      }
      final failure = skillLessonFailure;
      if (failure != null) {
        throw _skillLessonRefusal(goalId, stageId, failure);
      }
      final built = _builtLessons[_skillLessonKey(goalId, stageId)];
      if (built != null) {
        return {'markdown': built['markdown'], 'exists': true};
      }
      final text = _lessonTextFor(stageId);
      return {'markdown': text ?? '', 'exists': text != null};
    }
    if (method == 'skill.lesson.build') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.lesson.build requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      final rawStage = params?['stageId'];
      if (rawStage is! String || rawStage.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.lesson.build requires a stage id',
        );
      }
      final stageId = rawStage.trim();
      final rawSolution = params?['includeSolution'];
      if (rawSolution != null && rawSolution is! bool) {
        throw const RpcException(
          -32602,
          'skill.lesson.build includeSolution must be a boolean',
        );
      }
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final title = _stagedStages[stageId];
      if (title == null) throw _unknownStage(goalId, stageId);
      final failure = skillLessonFailure;
      if (failure != null) {
        throw _skillLessonRefusal(goalId, stageId, failure);
      }
      final buildFailure = skillLessonBuildFailure;
      if (buildFailure != null) {
        throw _skillLessonRefusal(goalId, stageId, buildFailure);
      }
      // A `ready` lesson is never replaced without the user's consent: the
      // first build answers with the `confirm` shape, and only a repeat with
      // `confirmed: true` writes.
      final rawConfirm = params?['confirmed'];
      if (rawConfirm != null && rawConfirm is! bool) {
        throw const RpcException(
          -32602,
          'skill.lesson.build confirmed must be a boolean',
        );
      }
      if (stageId == readyLessonStageId && rawConfirm != true) {
        throw _skillLessonConfirm(goalId, stageId, title);
      }
      final solution = rawSolution == true
          ? '\n\n## Solution\n\n- [x] Trace the call across both frames\n'
          : '';
      final markdown =
          '# $title\n\n'
          'Built draft from this goal’s sources [src: lecture-4.md].$solution';
      final citation = {
        'name': 'lecture-4.md',
        'location': 'sources/sha256-a1b2-lecture-4.md',
        'excerpt': 'Boundary conditions set the limits.',
      };
      _builtLessons[_skillLessonKey(goalId, stageId)] = {
        'markdown': markdown,
        'status': 'draft',
        'citations': [citation],
      };
      return {
        'path':
            'lessons/${stageId.split('-').last}-'
            '${title.toLowerCase().replaceAll(' ', '-')}.md',
        'markdown': markdown,
        'status': 'draft',
        'citations': [citation],
      };
    }
    if (method == 'skill.sources.list') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.sources.list requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final failure = skillSourcesFailure;
      if (failure != null) throw _skillSourceFailure(goalId, failure);
      return {'sources': _skillSourcesFor(goalId)};
    }
    if (method == 'skill.sources.add') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.sources.add requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final raw = params?['files'];
      if (raw is! List ||
          raw.isEmpty ||
          !raw.every((path) => path is String && path.trim().isNotEmpty)) {
        throw const RpcException(
          -32602,
          'skill.sources.add requires a non-empty array of file paths',
        );
      }
      final files = raw.whereType<String>().map((path) => path.trim()).toList();
      final failure = skillSourcesFailure;
      if (failure != null) throw _skillSourceFailure(goalId, failure);
      // A test sentinel for the core's refused copy: nothing is gathered.
      if (files.any((path) => path.contains('reject'))) {
        final rejected = files.firstWhere((path) => path.contains('reject'));
        throw _skillSourceFailure(
          goalId,
          'could not copy ${_baseName(rejected)}',
        );
      }
      final rows = _skillSources.putIfAbsent(
        goalId,
        () => <Map<String, dynamic>>[],
      );
      var added = 0;
      var skipped = 0;
      for (final path in files) {
        final name = _baseName(path);
        // Identical bytes are stored once, so a name already present is the
        // core's `skipped` case rather than a duplicate row.
        if (rows.any((row) => row['name'] == name)) {
          skipped += 1;
          continue;
        }
        final hash = _hashOf(name);
        final storedPath =
            'sources/${hash.replaceFirst('sha256:', 'sha256-')}'
            '-$name';
        rows.add({
          'name': name,
          'storedPath': storedPath,
          'kind': _kindOf(name),
          'hash': hash,
          'excerpt': 'Gathered from $name.',
          'excerptLocation': storedPath,
        });
        added += 1;
      }
      skillSourceAdds.add(List<String>.from(files));
      return {'added': added, 'skipped': skipped};
    }
    if (method == 'skill.chat.list') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.chat.list requires a goal id');
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      return {'chats': _skillChatRowsFor(goalId)};
    }
    if (method == 'skill.chat.open') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.chat.open requires a goal id');
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final chats = _skillGoalChats.putIfAbsent(goalId, () => <String>[]);
      final rawChat = params?['chatId'];
      late final String chatId;
      if (rawChat != null) {
        if (rawChat is! String || rawChat.trim().isEmpty) {
          throw const RpcException(
            -32602,
            'skill.chat.open: chatId must be a non-empty string when supplied',
          );
        }
        chatId = rawChat.trim();
        if (!chats.contains(chatId)) throw _unknownSkillChat(goalId, chatId);
      } else {
        chatId = chats.isEmpty ? 'chat-1' : chats.last;
        if (!chats.contains(chatId)) chats.add(chatId);
      }
      _skillChatMessages.putIfAbsent(
        _skillChatKey(goalId, chatId),
        () => <Map<String, dynamic>>[],
      );
      return {'chatId': chatId, 'snapshot': _skillChat(goalId, chatId)};
    }
    if (method == 'skill.chat.create') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.chat.create requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final chats = _skillGoalChats.putIfAbsent(goalId, () => <String>[]);
      // Always a fresh transcript: `chat-<n+1>`, never a reuse.
      var next = chats.length + 1;
      while (chats.contains('chat-$next')) {
        next += 1;
      }
      final chatId = 'chat-$next';
      chats.add(chatId);
      _skillChatMessages.putIfAbsent(
        _skillChatKey(goalId, chatId),
        () => <Map<String, dynamic>>[],
      );
      skillChatCreates.add(goalId);
      return {'chatId': chatId, 'snapshot': _skillChat(goalId, chatId)};
    }
    if (method == 'skill.chat.send') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.chat.send requires a goal id');
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final rawChat = params?['chatId'];
      if (rawChat is! String || rawChat.trim().isEmpty) {
        throw const RpcException(-32602, 'skill.chat.send requires a chat id');
      }
      final chatId = rawChat.trim();
      if (!_skillChatIdsFor(goalId).contains(chatId)) {
        throw _unknownSkillChat(goalId, chatId);
      }
      final text = params?['text'] is String ? params!['text'] as String : '';
      if (text.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.chat.send requires a non-empty text string',
        );
      }
      final key = _skillChatKey(goalId, chatId);
      final turn = (_skillChatTurns[key] ?? 0) + 1;
      _skillChatTurns[key] = turn;
      _skillChatMessages.putIfAbsent(key, () => []).addAll([
        {'id': 'k$turn-u', 'role': 'user', 'text': text, 'outcome': 'done'},
        {
          'id': 'k$turn-a',
          'role': 'assistant',
          'text': 'Skill echo: $text',
          'outcome': 'done',
        },
      ]);
      _events.add({
        'method': 'skill.chat.state',
        'params': {
          'goalId': goalId,
          'chatId': chatId,
          ..._skillChat(goalId, chatId),
        },
      });
      return {'turnId': key};
    }
    if (method == 'skill.chat.cancel') {
      final rawGoal = params?['goalId'];
      if (rawGoal is! String || rawGoal.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.chat.cancel requires a goal id',
        );
      }
      final goalId = rawGoal.trim();
      if (_skillFor(goalId) == null) throw _unknownSkill(goalId);
      final rawChat = params?['chatId'];
      if (rawChat is! String || rawChat.trim().isEmpty) {
        throw const RpcException(
          -32602,
          'skill.chat.cancel requires a chat id',
        );
      }
      return {'ok': true};
    }
    if (method.startsWith('session.instructions.')) {
      final rawId = params?['id'];
      final id = rawId is String ? rawId.trim() : '';
      if (id.isEmpty) {
        throw RpcException(-32602, '$method requires a session id');
      }
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);

      RpcException refusal(String message) => RpcException(-32000, message, {
        'kind': 'instructions',
        'id': id,
        'message': message,
      });

      if (method == 'session.instructions.get') {
        final instructions = _instructionsBySession[id];
        return {
          'prompt': _promptFor(id, detail),
          'instructionsSource': ?instructions,
        };
      }
      final failure = instructionsFailure;
      if (failure != null) throw refusal(failure);
      if (method == 'session.instructions.save') {
        final text = params?['text'];
        if (text is! String) {
          throw const RpcException(
            -32602,
            'session.instructions.save requires a text string',
          );
        }
        instructionsSaves.add(text);
        _setPromptFor(id, detail, text);
        return {'prompt': text};
      }
      if (method == 'session.instructions.import') {
        final rawFile = params?['file'];
        final file = rawFile is String ? rawFile.trim() : '';
        if (file.isEmpty) {
          throw const RpcException(
            -32602,
            'session.instructions.import requires a non-empty file path',
          );
        }
        // A test sentinel for the core's refused extraction: nothing is copied
        // and the previous prompt stays.
        if (file.contains('reject')) {
          throw refusal('could not extract ${_baseName(file)}');
        }
        instructionsImports.add(file);
        final name = _baseName(file);
        final prompt = 'Extracted from $name.';
        final source = <String, dynamic>{
          'name': name,
          'storedPath': 'sources/$name',
          'hash': _hashOf(name),
          'kind': _kindOf(name),
          'extractedAt': '2026-11-16T12:00:00Z',
          'characters': prompt.length,
          if (_kindOf(name) == 'pdf') 'pages': 2,
        };
        var added = false;
        final sources = detail['sources'];
        if (sources is List &&
            !sources.any((row) => row is Map && row['name'] == name)) {
          sources.add({
            'name': name,
            'originalPath': file,
            'storedPath': 'sources/$name',
            'hash': _hashOf(name),
            'kind': _kindOf(name),
          });
          added = true;
        }
        _instructionsBySession[id] = source;
        _setPromptFor(id, detail, prompt);
        return {'prompt': prompt, 'instructions': source, 'added': added};
      }
      if (method == 'session.instructions.reextract') {
        final source = _instructionsBySession[id];
        if (source == null) {
          throw refusal('this session has no instructions file to re-extract');
        }
        instructionsReextracts += 1;
        final prompt = 'Re-extracted from ${source['name']}.';
        _setPromptFor(id, detail, prompt);
        return {'prompt': prompt, 'instructions': source};
      }
      throw RpcException(-32601, 'unknown method $method');
    }
    if (method == 'session.archive' ||
        method == 'session.remove' ||
        method == 'session.export') {
      final rawId = params?['id'];
      final id = rawId is String ? rawId.trim() : '';
      if (id.isEmpty) {
        throw RpcException(-32602, '$method requires a session id');
      }
      if (!_sessionKnown(id)) throw _unknownSession(id);
      final action = method.substring(method.indexOf('.') + 1);
      final failure = sessionActionFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'session-action',
          'id': id,
          'action': action,
          'message': failure,
        });
      }
      if (action == 'archive') {
        archiveCalls.add(id);
        sessionRows.removeWhere((row) => row['id'] == id);
        archivedSessionIds.add(id);
        return {'action': 'archive', 'backend': 'folder'};
      }
      if (action == 'remove') {
        removeCalls.add(id);
        sessionRows.removeWhere((row) => row['id'] == id);
        removedSessionIds.add(id);
        return {'action': 'delete'};
      }
      exportCalls.add(id);
      return {
        'action': 'export',
        'path': '/tmp/lockedin/exports/session-$id.zip',
      };
    }
    if (method == 'session.create') {
      sessionCreateRequests.add(Map<String, dynamic>.from(params ?? const {}));
      if (sessionCreateTimeout) {
        sessionCreateTimeout = false;
        throw TimeoutException(
          'core did not answer session.create',
          const Duration(seconds: 60),
        );
      }
      final rawName = params?['name'];
      final name = rawName is String ? rawName.trim() : '';
      if (name.isEmpty) {
        throw const RpcException(
          -32602,
          'session.create requires a non-empty name string',
        );
      }
      final prompt = params?['prompt'] is String
          ? params!['prompt'] as String
          : '';
      final rawFiles = params?['files'];
      final files = rawFiles is List
          ? rawFiles.whereType<String>().toList()
          : const <String>[];
      final instructionsFile = params?['instructionsFile'] is String
          ? params!['instructionsFile'] as String
          : '';
      if (prompt.trim().isEmpty &&
          files.isEmpty &&
          instructionsFile.trim().isEmpty) {
        const message =
            'a session needs at least one source, written instructions, or an '
            'instructions file';
        throw const RpcException(-32000, message, {
          'kind': 'session-create',
          'message': message,
        });
      }
      // A test sentinel for the core's atomic refusal: the copy fails and
      // nothing is created (`AGENTS.md` §2.9).
      if (files.any((path) => path.contains('reject'))) {
        const message = 'could not copy reject.pdf';
        throw const RpcException(-32000, message, {
          'kind': 'session-create',
          'message': message,
        });
      }
      _createdCount += 1;
      final id = '2026-11-16-1200-created-$_createdCount';
      final sources = [
        for (final path in files)
          {
            'name': _baseName(path),
            'originalPath': path,
            'storedPath': 'sources/${_baseName(path)}',
            'hash': _hashOf(_baseName(path)),
            'kind': _kindOf(_baseName(path)),
          },
      ];
      final wantsSteps = params?['steps'] is bool
          ? params!['steps'] as bool
          : true;
      _created[id] = {
        'id': id,
        'name': name,
        'created': '2026-11-16T12:00:00Z',
        'archived': false,
        'prompt': prompt,
        'sources': sources,
        'steps': _stepsOf(
          wantsSteps
              ? '# Assignment steps\n\n> 0 of 1 steps done\n\n'
                    '- [ ] Read the sources\n'
              : '',
          exists: wantsSteps,
        ),
      };
      return {'id': id, 'name': name};
    }
    if (method == 'session.output.read') {
      final id = params?['id'];
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);
      final rawKind = params?['kind'];
      if (rawKind is! String ||
          !const {'study-guide', 'flashcards'}.contains(rawKind)) {
        throw const RpcException(
          -32602,
          'session.output.read kind must be study-guide or flashcards',
        );
      }
      final kind = rawKind;
      final rawPart = params?['part'];
      if (rawPart != null) {
        if (rawPart is! String ||
            !const {'guide', 'answers', 'cards'}.contains(rawPart)) {
          throw const RpcException(
            -32602,
            'session.output.read part must be guide, answers or cards',
          );
        }
        final allowed = kind == 'study-guide'
            ? const {'guide', 'answers'}
            : const {'cards'};
        if (!allowed.contains(rawPart)) {
          throw RpcException(
            -32602,
            'session.output.read: "$rawPart" belongs to another kind',
          );
        }
      }
      final part = rawPart is String
          ? rawPart
          : (kind == 'study-guide' ? 'guide' : 'cards');
      outputReads.add({'id': id, 'kind': kind, 'part': rawPart});
      // A missing output is the documented empty state, not a failure. A build
      // in this run writes the file, so a later read reports it.
      final sessionKey = id is String ? id : '';
      if (outputMissing && !_builtOutputs.contains('$sessionKey:$kind')) {
        return const {'markdown': '', 'exists': false};
      }
      final markdown = switch (part) {
        'answers' => _answersMarkdown,
        'cards' => _cardsMarkdown,
        _ => _guideMarkdown,
      };
      return {'markdown': markdown, 'exists': true};
    }
    if (method == 'session.output.build') {
      final id = params?['id'];
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);
      final rawKind = params?['kind'];
      if (rawKind is! String ||
          !const {'study-guide', 'flashcards'}.contains(rawKind)) {
        throw const RpcException(
          -32602,
          'session.output.build kind must be study-guide or flashcards',
        );
      }
      final failure = outputFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'generation',
          'id': id is String ? id : '',
          'message': failure,
        });
      }
      final kind = rawKind;
      final sessionKey = id is String ? id : '';
      outputBuilds.add({'id': id, 'kind': kind});
      _builtOutputs.add('$sessionKey:$kind');
      if (kind == 'study-guide') {
        _guideMarkdown = rebuiltGuideMarkdown;
        _answersMarkdown = rebuiltAnswersMarkdown;
        return {
          'kind': kind,
          'markdown': _guideMarkdown,
          'answers': _answersMarkdown,
          'files': {
            'guide': 'study-guide.md',
            'answers': 'study-guide-answers.md',
          },
        };
      }
      _cardsMarkdown = rebuiltFlashcardMarkdown;
      return {
        'kind': kind,
        'markdown': _cardsMarkdown,
        'files': {'cards': 'flashcards.md'},
      };
    }
    if (method == 'session.document') {
      final id = params?['id'];
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);
      final rawKind = params?['kind'];
      if (rawKind is! String ||
          !const {'contract', 'contradictions', 'check'}.contains(rawKind)) {
        throw const RpcException(
          -32602,
          'session.document kind must be contract, contradictions or check',
        );
      }
      final kind = rawKind;
      final rawAttempt = params?['attempt'];
      if (rawAttempt != null && rawAttempt is! String) {
        throw const RpcException(
          -32602,
          'session.document: attempt must be a string',
        );
      }
      final attempt = rawAttempt is String ? rawAttempt.trim() : '';
      if (attempt.isNotEmpty && kind != 'check') {
        throw const RpcException(
          -32602,
          'session.document: attempt is only accepted for check',
        );
      }
      final failure = documentFailure;
      if (failure != null || attempt.contains('reject')) {
        final message = failure ?? 'the provider rejected the check request';
        throw RpcException(-32000, message, {
          'kind': 'generation',
          'id': id is String ? id : '',
          'message': message,
        });
      }
      documentCalls.add({
        'id': id,
        'kind': kind,
        'attempt': attempt.isEmpty ? null : attempt,
      });
      return switch (kind) {
        'contract' => {'text': contractDocument, 'name': 'contract.md'},
        'contradictions' => {
          'text': contradictionsDocument,
          'name': 'contradictions.md',
        },
        _ => {'text': checkDocument(attempt), 'name': 'check.md'},
      };
    }
    if (method == 'session.generateSteps') {
      final id = params?['id'];
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);
      final failure = generateStepsFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'generation',
          'id': id is String ? id : '',
          'message': failure,
        });
      }
      final sessionKey = id as String;
      final steps = detail['steps'];
      final before = steps is Map && steps['markdown'] is String
          ? steps['markdown'] as String
          : '';
      final kept = _keptCount(before, generatedStepsMarkdown);
      final lost = _checkedTexts(before).length - kept;
      // A later `session.open` must read exactly what the core wrote, so the
      // fixed session's markdown and a created session's steps are both updated.
      if (sessionKey == sessionId) {
        _stepsMarkdown = generatedStepsMarkdown;
      } else {
        detail['steps'] = _stepsOf(generatedStepsMarkdown);
      }
      return {'markdown': generatedStepsMarkdown, 'kept': kept, 'lost': lost};
    }
    if (method == 'session.toggleStep') {
      final id = params?['id'];
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);
      final index = params?['index'];
      if (index is! int || index < 0) {
        throw const RpcException(
          -32602,
          'session.toggleStep requires a non-negative integer index',
        );
      }
      final sessionKey = id as String;
      final steps = detail['steps'];
      final markdown = steps is Map && steps['markdown'] is String
          ? steps['markdown'] as String
          : '';
      if (markdown.trim().isEmpty) {
        throw RpcException(-32000, 'session has no steps', {
          'kind': 'steps',
          'id': sessionKey,
          'message': 'this session has no steps to toggle',
        });
      }
      final toggled = _toggleStepText(markdown, index);
      if (toggled == null) {
        throw RpcException(-32000, 'step $index is out of range', {
          'kind': 'steps',
          'id': sessionKey,
          'message': 'step ${index + 1} is out of range',
        });
      }
      final next = _stepsOf(toggled);
      if (sessionKey == sessionId) {
        _stepsMarkdown = toggled;
      } else {
        detail['steps'] = next;
      }
      final states = _stepStates(toggled);
      return {
        'index': index,
        'checked': index < states.length ? states[index] : false,
        'done': next['done'],
        'total': next['total'],
        'markdown': toggled,
        'hash': _hashOf(toggled),
      };
    }
    if (method == 'session.open') {
      final id = params?['id'];
      final detail = _detailFor(id);
      if (detail == null) throw _unknownSession(id);
      return {'session': detail};
    }
    if (method == 'session.coverage') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      coverageRequests.add(id as String);
      final failure = coverageFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'session',
          'id': id,
          'message': failure,
        });
      }
      return {'coverage': _coverageReport()};
    }
    if (method == 'session.mistake.list') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      _throwIfMistakeFailed(id);
      return {'entries': _mistakeRows()};
    }
    if (method == 'session.mistake.record') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      _throwIfMistakeFailed(id);
      final text = params?['text'];
      if (text is! String || text.trim().isEmpty) {
        throw RpcException(-32000, 'a mistake needs some text', {
          'kind': 'mistake',
          'id': id,
          'message': 'a mistake needs some text',
        });
      }
      final step = params?['step'];
      mistakeEntries.add({
        'index': mistakeEntries.length,
        'text': text.trim(),
        if (step is String && step.trim().isNotEmpty) 'step': step.trim(),
        'note': null,
      });
      return {'entries': _mistakeRows()};
    }
    if (method == 'session.mistake.promote') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      _throwIfMistakeFailed(id);
      final index = params?['index'];
      if (index is! int || index < 0 || index >= mistakeEntries.length) {
        throw RpcException(-32000, 'there is no mistake at index $index', {
          'kind': 'mistake',
          'id': id,
          'message': 'there is no mistake at index $index',
        });
      }
      final entry = mistakeEntries[index];
      final existing = entry['note'];
      if (existing is Map) {
        return {'note': existing, 'already': true};
      }
      final note = {
        'path': 'school/vault/knowledge/mistake-$index.md',
        'title': entry['text'] is String ? entry['text'] : 'mistake',
        'created': '2026-11-01T10:00:00.000Z',
        'status': 'open',
      };
      entry['note'] = note;
      return {'note': note, 'already': false};
    }
    if (method == 'session.mistake.correct') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      _throwIfMistakeFailed(id);
      final index = params?['index'];
      final correction = params?['correction'];
      if (correction is! String || correction.trim().isEmpty) {
        throw RpcException(-32000, 'a correction needs some text', {
          'kind': 'mistake',
          'id': id,
          'message': 'a correction needs some text',
        });
      }
      if (index is! int || index < 0 || index >= mistakeEntries.length) {
        throw RpcException(-32000, 'there is no promoted mistake $index', {
          'kind': 'mistake',
          'id': id,
          'message': 'there is no promoted mistake $index',
        });
      }
      final note = mistakeEntries[index]['note'];
      if (note is! Map) {
        throw RpcException(-32000, 'there is no promoted mistake $index', {
          'kind': 'mistake',
          'id': id,
          'message': 'there is no promoted mistake $index',
        });
      }
      note['status'] = 'corrected';
      return {'note': note};
    }
    if (method == 'session.chat.snapshot') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      return _sessionChat(id as String);
    }
    if (method == 'session.chat.send') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      final sessionKey = id as String;
      final text = params?['text'] is String ? params!['text'] as String : '';
      final turn = (_sessionTurns[sessionKey] ?? 0) + 1;
      _sessionTurns[sessionKey] = turn;
      _sessionMessages.putIfAbsent(sessionKey, () => []).addAll([
        {'id': 's$turn-u', 'role': 'user', 'text': text, 'outcome': 'done'},
        {
          'id': 's$turn-a',
          'role': 'assistant',
          'text': 'Session echo: $text',
          'outcome': 'done',
        },
      ]);
      _events.add({
        'method': 'session.chat.state',
        'params': {'sessionId': sessionKey, ..._sessionChat(sessionKey)},
      });
      return {'turnId': sessionKey};
    }
    if (method == 'session.chat.cancel') {
      final id = params?['id'];
      if (_detailFor(id) == null) throw _unknownSession(id);
      return {'ok': true};
    }
    if (method == 'review.mark') {
      final rawItem = params?['itemId'];
      final itemId = rawItem is String ? rawItem.trim() : '';
      if (itemId.isEmpty) {
        throw const RpcException(-32602, 'review.mark requires an item id');
      }
      final rawResult = params?['result'];
      final result = rawResult is String ? rawResult.trim() : '';
      if (result != 'known' && result != 'missed') {
        throw const RpcException(
          -32602,
          'review.mark result must be known or missed',
        );
      }
      final failure = reviewMarkFailure;
      if (failure != null || itemId.contains('reject')) {
        throw _reviewFailure(itemId, failure ?? 'could not record the verdict');
      }
      // A deck card is marked through its own `card-N` id even when it is not in
      // the review queue (a card that is not missed yet never appears there).
      // The real core rewrites that card's `M:`/`K:` lines, so a later
      // `session.output.read` reports the same bytes.
      final card = RegExp(r'^card:([^:]+):card-(\d+)$').firstMatch(itemId);
      if (card != null) {
        final session = card.group(1)!;
        final number = int.parse(card.group(2)!);
        if (!_sessionKnown(session)) throw _unknownSession(session);
        final next = _markCardText(_cardsMarkdown, number, result);
        if (next == null) {
          throw _reviewFailure(itemId, 'there is no card-$number in this deck');
        }
        _cardsMarkdown = next;
        reviewMarks.add({'itemId': itemId, 'result': result});
        return {'queue': _reviewQueueState};
      }
      final raw = _reviewQueueState['items'];
      final items = raw is List ? raw : <Object?>[];
      final index = items.indexWhere(
        (row) => row is Map && row['id'] == itemId,
      );
      if (index < 0) {
        throw _reviewFailure(itemId, 'there is no review item "$itemId"');
      }
      final item = items[index] as Map;
      final kind = item['kind'];
      // Session memory is history, not a reviewable item: the core refuses it
      // and writes nothing.
      if (kind == 'memory') {
        throw _reviewFailure(
          itemId,
          'session memory is read-only and cannot be marked',
        );
      }
      reviewMarks.add({'itemId': itemId, 'result': result});
      if (result == 'known') {
        items.removeAt(index);
      } else {
        final count = item['count'];
        item['count'] = (count is int ? count : 0) + 1;
      }
      _recountReview();
      return {'queue': _reviewQueueState};
    }
    if (method == 'achievements.list') {
      final failure = achievementsFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'achievements',
          'message': failure,
        });
      }
      final rows = _achievementRows();
      return {
        'achievements': rows,
        'earned': rows.where((row) => row['unlocked'] == true).length,
        'total': rows.length,
        'warning': achievementsWarning,
      };
    }
    if (method == 'review.queue') {
      final rawSide = params?['side'] ?? 'all';
      if (rawSide is! String ||
          !const {'all', 'school', 'skills', 'work'}.contains(rawSide)) {
        throw const RpcException(
          -32602,
          'review.queue side must be all, school, skills or work',
        );
      }
      reviewSides.add(rawSide);
      return {'queue': _reviewQueueState};
    }
    if (method == 'stats.export') {
      final rawRange = params?['range'];
      if (rawRange is! String ||
          !const {'7d', '30d', '90d', 'all'}.contains(rawRange)) {
        throw const RpcException(
          -32602,
          'stats.export range must be 7d, 30d, 90d or all',
        );
      }
      final rawScope = params?['scope'];
      if (rawScope is! String ||
          !const {'all', 'school', 'skills', 'work'}.contains(rawScope)) {
        throw const RpcException(
          -32602,
          'stats.export scope must be all, school, skills or work',
        );
      }
      final rawFormat = params?['format'] ?? 'md';
      if (rawFormat is! String || !const {'md', 'csv'}.contains(rawFormat)) {
        throw const RpcException(
          -32602,
          'stats.export format must be md or csv',
        );
      }
      final failure = statsExportFailure;
      if (failure != null) {
        throw RpcException(-32000, failure, {
          'kind': 'stats',
          'message': failure,
        });
      }
      statsExports.add({
        'range': rawRange,
        'scope': rawScope,
        'format': rawFormat,
      });
      return {
        'text': _statsExportText(rawRange, rawScope, rawFormat),
        'format': rawFormat,
      };
    }
    return switch (method) {
      'workspace.info' => {
        'path': '/tmp/lockedin',
        'dataDir': '/tmp/lockedin-data',
        'configured': _chatModel.isNotEmpty,
        'model': _chatModel,
        'provider': _chatModel.contains('/')
            ? _chatModel.substring(0, _chatModel.indexOf('/'))
            : '',
      },
      'session.list' => {'sessions': sessionRows},
      'stats.summary' => {
        'range': params?['range'] ?? 'all',
        'scope': params?['scope'] ?? 'all',
        'overview': {'runs': 12, 'failed': 2, 'input': 18240, 'output': 6110},
        'costMicroUsd': 128400,
        'costLabel': r'$0.1284',
        'models': [
          {
            'model': 'openai/gpt-4.1-mini',
            'runs': 9,
            'input': 14000,
            'output': 4900,
            'costMicroUsd': 128400,
          },
          {
            'model': 'local/llama',
            'runs': 3,
            'input': 4240,
            'output': 1210,
            'costMicroUsd': null,
          },
        ],
        'tools': [
          {'name': 'read_file', 'calls': 7},
          {'name': 'search_files', 'calls': 2},
        ],
        'learning': {
          'steps': 5,
          'cardsKnown': 4,
          'cardsMissed': 2,
          'lessons': 1,
        },
        'activity': [
          {'date': '2026-11-01', 'runs': 2, 'tokens': 1800},
          {'date': '2026-11-02', 'runs': 1, 'tokens': 600},
          {'date': '2026-11-03', 'runs': 3, 'tokens': 2400},
        ],
        'bestStreak': 14,
        'activeDays': 18,
        'period': {'from': '2026-01-05', 'to': '2026-11-02'},
        'diagnostic': null,
      },
      'chat.snapshot' => _chat(),
      'chat.send' => {'turnId': 'test-turn'},
      'chat.cancel' => {'ok': true},
      'settings.get' => _settings(),
      'provider.list' => {
        'providers': [
          {
            'id': 'openai',
            'label': 'OpenAI',
            'keyRequired': true,
            'baseUrl': 'https://api.openai.com/v1',
            'note': '',
            'linked': _linked || configured,
          },
          {
            'id': 'anthropic',
            'label': 'Anthropic',
            'keyRequired': true,
            'baseUrl': 'https://api.anthropic.com/v1',
            'note': '',
            'linked': false,
          },
          {
            'id': 'custom',
            'label': 'Custom OpenAI-compatible',
            'keyRequired': false,
            'baseUrl': '',
            'note': 'Ollama, LM Studio and llama.cpp',
            'linked': false,
          },
        ],
        'linked': _linked || configured ? ['openai'] : [],
      },
      _ => {'ok': true},
    };
  }

  @override
  Future<void> dispose() async {
    await _events.close();
  }
}

/// The three activity kinds `activity.list` accepts (`src/services/work/activity.ts`).
const _activityKinds = <String>{'write-decision', 'command-decision', 'swarm'};
