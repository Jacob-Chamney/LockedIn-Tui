import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'core_methods.g.dart';
import 'core_transport.dart';
import 'errors.dart';
import 'models.dart';
import 'protocol.dart';

part 'core_store_archive.dart';
part 'core_store_chat.dart';
part 'core_store_sessions.dart';
part 'core_store_skills.dart';
part 'core_store_work.dart';
part 'core_store_work_chat.dart';
part 'core_store_teaching.dart';
part 'core_store_review.dart';
part 'core_store_settings.dart';
part 'core_store_session_extras.dart';
part 'core_store_outputs.dart';
part 'core_store_documents.dart';
part 'core_store_activity.dart';
part 'core_store_skill_chat.dart';
part 'core_store_projects.dart';
part 'core_store_knowledge.dart';

class CoreStore extends ChangeNotifier {
  /// The last `chat.send` refusal, shown in the Chill banner. Per-surface: a
  /// refused Chill send never appears on another page.
  String? chatSendError;

  /// The last `chat.snapshot` failure, or null. The previous [chat] stays, so a
  /// failed re-read never blanks a transcript the user is reading.
  String? chatError;

  CoreStore({
    CoreConnection? connection,
    this.reconnectFactory,
    DateTime Function()? clock,
    this.permissionTimeout = const Duration(seconds: 120),
  }) : _connection = connection ?? CoreClient(),
       _now = clock ?? DateTime.now;

  /// The wall clock, replaceable so a test can age a permission prompt.
  final DateTime Function() _now;

  CoreConnection _connection;

  /// Builds a fresh connection for `retry()`. Without it, a retry reuses the
  /// existing process, whose boot failure is memoised by design.
  final CoreConnection Function()? reconnectFactory;
  StreamSubscription<Map<String, dynamic>>? _subscription;

  CoreStatus status = CoreStatus.offline;
  String? error;
  WorkspaceInfo? workspace;
  List<SessionRow> sessions = const [];

  /// True once a list read has succeeded (an empty list counts). A surface
  /// whose read has not answered prints no count rather than `0`, which reads
  /// as "you have nothing".
  bool sessionsLoaded = false;
  StatsSummary? stats;
  SettingsView? settings;
  ChatSnapshot? chat;
  List<ProviderRow> providers = const [];
  bool _starting = false;
  bool _retrying = false;
  String? _providersError;

  /// The stored `ui.keybinds` table (`keybinds.get`): action id -> the
  /// documented string form. Empty until the first read, and empty is a valid
  /// answer — the shell's [KeymapRegistry] fills in every default.
  Map<String, String> keybinds = const <String, String>{};

  /// The stored `ui.fixed_keybinds` table, on the same terms as [keybinds].
  Map<String, String> fixedKeybinds = const <String, String>{};

  /// The stored `ui.custom_theme` overrides (`theme.custom.get`).
  ///
  /// Token name -> `#RRGGBB`, exactly what the core stores. [ThemeTokens.empty]
  /// is a valid answer on a fresh workspace: the shell fills crimson per token,
  /// so the core never invents a colour and a partial map still paints.
  ThemeTokens customThemeTokens = ThemeTokens.empty;

  /// The configured MCP servers (`mcp.list` / `mcp.refresh`). Empty until the
  /// settings page asks: reading them can start nothing, but it is still not
  /// part of the first frame.
  List<McpServerView> mcpServers = const [];

  /// The stored policy matrix, verbatim from the core. It is never invented:
  /// an absent cell stays absent and the page prints `default`.
  PluginPolicy mcpPolicy = PluginPolicy.empty;

  /// The last MCP read failure. The previous [mcpServers] row list is kept, so
  /// the page can say "could not refresh" instead of "no servers".
  String? mcpError;

  /// The optional decision layer's stored view (`decision.get`), or null before
  /// the first read.
  ///
  /// The layer is off by default and rules-only in this build, so the Settings
  /// group renders `off` and the honest "not shipped" note from the core's own
  /// view. A failed read keeps the previous [decision] and records its reason in
  /// [decisionError], never inventing a local model.
  DecisionView? decision;

  /// True while `decision.get` is in flight.
  bool decisionLoading = false;

  /// Generations for the reads that had none: an older reply must not land on
  /// a newer one, and must not clear a flag the newer request still owns.
  int _decisionTicket = 0;
  int _workPermissionsTicket = 0;
  int _workTemplatesTicket = 0;

  /// The last decision-layer read failure, or null.
  ///
  /// Page-local, like [mcpError]: it never replaces [error] and never clears
  /// [decision], so a broken read still shows the values the shell last received.
  String? decisionError;

  /// The global Work opt-in (`work.permissions.get`), or null before the first
  /// read.
  ///
  /// This is the **outer** gate on an approval, stored in `config.toml` `[work]`
  /// and read from the core: the shell never edits a config file and never infers
  /// a permission. Null means "not read yet", which the settings page and the
  /// approvals view treat as "no opinion", not as "allowed".
  WorkPermissions? workPermissions;

  /// True while `work.permissions.get` is in flight.
  bool workPermissionsLoading = false;

  /// The last Work-permissions read failure, or null.
  ///
  /// Page-local, like [decisionError]: it never replaces [error] and never
  /// clears [workPermissions], so a broken read shows the core's message beside
  /// the values the shell last received.
  String? workPermissionsError;

  /// The plugin write permission prompt to answer now (`mcp.permission`), or
  /// null.
  ///
  /// The core emits one notification per write-capable plugin call and waits up
  /// to 120 s for `mcp.confirm`. Turns are serialised per chat, not across
  /// chats, so two chats can each be waiting on an answer: the requests queue
  /// in arrival order and this is the oldest. Replacing the first with the
  /// second left the first unanswerable, and its turn hung until the core
  /// denied it. The request's input is untrusted data — the modal renders it
  /// and never executes or interprets it.
  PluginPermissionRequest? get pendingPermission =>
      _permissionQueue.isEmpty ? null : _permissionQueue.first.$1;

  /// How many prompts are waiting behind [pendingPermission].
  int get queuedPermissions =>
      _permissionQueue.isEmpty ? 0 : _permissionQueue.length - 1;

  /// Each waiting prompt with the moment it arrived.
  final _permissionQueue = <(PluginPermissionRequest, DateTime)>[];

  /// How long the core waits for `mcp.confirm` before it denies the call.
  static const permissionWindow = Duration(seconds: 120);

  /// How long a plugin prompt may wait before the core's own denial applies.
  final Duration permissionTimeout;

  /// Timers that mark a prompt expired when the core's own deadline passes.
  final _permissionTimers = <String, Timer>{};

  /// Prompts the core has already denied by timeout. They stay on screen until
  /// dismissed, marked as expired, so the modal never offers an Allow that
  /// cannot run the tool.
  final _expiredPermissions = <String>{};

  /// True when [requestId] waited past the core's window.
  bool permissionExpired(String requestId) =>
      _expiredPermissions.contains(requestId);

  /// Drop an expired prompt. Nothing is sent: the core already denied it.
  void dismissPermission(String requestId) {
    _permissionTimers.remove(requestId)?.cancel();
    _expiredPermissions.remove(requestId);
    _permissionQueue.removeWhere((entry) => entry.$1.requestId == requestId);
    notifyListeners();
  }

  void _expirePermission(String requestId) {
    _permissionTimers.remove(requestId);
    if (!_permissionQueue.any((entry) => entry.$1.requestId == requestId)) {
      return;
    }
    _expiredPermissions.add(requestId);
    pluginPermissionError = null;
    notifyListeners();
  }

  /// The last `mcp.confirm` failure, or null.
  ///
  /// Page-local, like [stepsError]: a failed answer keeps [pendingPermission]
  /// on screen so the user can decide again, and never replaces [error].
  String? pluginPermissionError;

  /// The read-only Review queue (`review.queue`), or null before the first read.
  ///
  /// The queue is a snapshot of what the workspace already records; marking
  /// known/missed goes through [markReview]. A failed read keeps the snapshot
  /// and records its reason in [reviewError].
  ReviewQueue? review;

  /// True while `review.queue` is in flight.
  bool reviewLoading = false;

  /// The last Review read failure, or null.
  ///
  /// Page-local, like [stepsError]: it never replaces [error] and never clears
  /// [review], so a broken read still shows the rows the shell last received.
  String? reviewError;

  /// The items whose `review.mark` is in flight, oldest first.
  ///
  /// A set, not one slot: two marks can overlap (the page allows a second row
  /// while the first is answering), and one slot let the first `finally` clear
  /// the flag while the second was still running. Page-local, like
  /// [reviewError]: a mark never blocks the rest of the shell.
  final _markingIds = <String>{};

  /// The item whose `review.mark` is in flight, or null when none is.
  ///
  /// The page shows `marking…` on that one row; with two in flight it names the
  /// newest, which is the one the user just pressed.
  String? get reviewMarkingId => _markingIds.isEmpty ? null : _markingIds.last;

  /// True while [itemId]'s mark is in flight.
  bool isMarking(String itemId) => _markingIds.contains(itemId);

  /// The side of the wall the queue is projected to: `all`, `school` or
  /// `skills`. The core validates it; the page only cycles the three values.
  String reviewSide = 'all';

  /// The generation of the newest `review.mark`. See [markReview].
  int _reviewWriteTicket = 0;

  /// Bumped on every Review request and every clear, so an answer for an older
  /// side cannot replace the snapshot the user is now looking at.
  int _reviewTicket = 0;

  /// One counter per detail the user can open and close. The core answers
  /// requests concurrently, so an `open` reply can land after the user pressed
  /// Back or opened something else; a reply whose ticket is stale is dropped
  /// instead of reopening a closed detail or replacing the current one.
  int _sessionOpenTicket = 0;
  int _projectOpenTicket = 0;
  int _skillOpenTicket = 0;
  int _skillChapterTicket = 0;

  /// Bumped whenever the open project changes or closes, so a project-scoped
  /// read that was already in flight cannot fill the next project's cards.
  int _projectEpoch = 0;

  /// The archived items (`archive.list`), empty before the first read.
  ///
  /// The Archive surface is read-only: nothing here restores, deletes, exports
  /// or moves an entry. A failed read keeps the previous rows and records its
  /// reason in [archiveError], so a broken read never invents an empty archive.
  List<ArchiveRow> archiveRows = const [];

  /// True while `archive.list` is in flight.
  bool archiveLoading = false;

  /// The last Archive read failure, or null.
  ///
  /// Page-local, like [reviewError]: it never replaces [error] and never clears
  /// [archiveRows], so a failed refresh still shows the rows the shell last
  /// received with one Retry beside them.
  String? archiveError;

  /// Bumped on every Archive request and every clear, so a late answer for an
  /// older read cannot replace the rows a newer one produced.
  int _archiveTicket = 0;

  /// The Knowledge search results (`knowledge.search`), empty before a search.
  ///
  /// Knowledge is read-only and unified: a hit names existing material and never
  /// invents a fact. A failed search keeps the previous hits and records its
  /// reason in [knowledgeError], so one broken request never blanks the page.
  List<KnowledgeHit> knowledgeHits = const [];

  /// The Knowledge topic tree (`knowledge.tree`), empty before the first read.
  ///
  /// The tree is a snapshot over the vaults, so it is read when the surface
  /// opens rather than at startup. A failed read keeps the previous groups and
  /// records its reason in [knowledgeError].
  List<KnowledgeGroup> knowledgeGroups = const [];

  /// True while `knowledge.search` or `knowledge.tree` is in flight.
  bool knowledgeLoading = false;

  /// The last Knowledge read failure, or null.
  ///
  /// Page-local, like [reviewError]: it never replaces [error] and never clears
  /// [knowledgeHits] or [knowledgeGroups], so a broken read still shows what the
  /// shell last received with one Retry beside it.
  String? knowledgeError;

  /// The query the visible hits answer; empty means the tree is showing.
  String knowledgeQuery = '';

  /// The side the Knowledge surface is projected to: `all`, `school`, `skills`
  /// or `work`. The core validates it; the page only sends a known value.
  ///
  /// It is part of the store rather than the page so a surface switch keeps the
  /// projection the user picked, exactly like [reviewSide]. The tree only
  /// accepts `all|school|skills`, so [loadKnowledgeTree] sends `all` while this
  /// stays `work` and the page explains why.
  String knowledgeScope = 'all';

  /// The ids of the last `knowledge.search` reply, in reply order.
  ///
  /// The reader walks this list with `[`/`]` instead of keeping its own copy of
  /// the results, so one search has one ordering and a surface switch cannot
  /// leave the reader pointing at a list the page no longer has. It is empty
  /// when the tree is showing, which is why a tree item has no ordering to walk.
  List<String> knowledgeHitOrder = const [];

  /// Where the open document sits inside [knowledgeHitOrder], or null when it
  /// came from the tree (which has no ordering to walk).
  int? knowledgeHitIndex;

  /// Bumped on every Knowledge request and every clear, so a stale answer for an
  /// older query or tree cannot replace what the user is now looking at.
  int _knowledgeTicket = 0;

  /// The tree has its own counter. Sharing the search's meant a keystroke
  /// during the first tree read dropped the tree, and clearing the query then
  /// showed an empty vault with no error.
  int _knowledgeTreeTicket = 0;
  bool _knowledgeSearching = false;
  bool _knowledgeTreeLoading = false;

  void _syncKnowledgeLoading() {
    knowledgeLoading = _knowledgeSearching || _knowledgeTreeLoading;
  }

  /// The Knowledge item the reader is showing (`knowledge.read`), or null
  /// before one is requested.
  ///
  /// It is a **read-only** body: a note's Markdown, a session memory note or a
  /// copied source's text. Opening one never writes, marks, archives or calls a
  /// model; `source` and `memory` stay labelled history, never a new fact.
  KnowledgeDocument? knowledgeDocument;

  /// True while `knowledge.read` is in flight. The reader opens on the request,
  /// so a slow read shows `reading…` instead of an empty page.
  bool knowledgeDocumentLoading = false;

  /// The last `knowledge.read` failure, or null. The reader stays open with the
  /// core's own message and one Retry; it never throws into the page.
  String? knowledgeDocumentError;

  /// The id the reader asked for, kept so a retry asks for exactly that item.
  String? knowledgeDocumentId;

  /// Bumped on every `knowledge.read` and every close, so a late answer for an
  /// item the user already left cannot reopen the reader.
  int _knowledgeReadTicket = 0;

  /// True when the Knowledge reader is the visible layer.
  bool get knowledgeDocumentOpen =>
      knowledgeDocumentLoading ||
      knowledgeDocument != null ||
      knowledgeDocumentError != null;

  /// The achievement inventory (`achievements.list`), empty before the first
  /// read.
  ///
  /// The rows are the core's catalogue projection, in catalogue order, so the
  /// shell never keeps a copy of the list. An unlocked row carries the day the
  /// core first saw it earned. The list is a snapshot and the core may record
  /// award dates when it is read, so it is read when the surface opens rather
  /// than at startup; a failed read keeps the previous rows.
  List<AchievementRow> achievements = const [];

  /// How many of [achievements] are unlocked, as the core counted them.
  int achievementsEarned = 0;

  /// The catalogue size the core reported, the pair of [achievementsEarned].
  int achievementsTotal = 0;

  /// The core's note about an unreadable awards file, or null.
  ///
  /// It is a muted note beside the rows, never an error: the inventory is still
  /// complete and only the award dates are missing.
  String? achievementsWarning;

  /// True while `achievements.list` is in flight.
  bool achievementsLoading = false;

  /// The last Achievements read failure, or null.
  ///
  /// Page-local, like [reviewError]: it never replaces [error] and never clears
  /// [achievements], so a failed refresh still shows the last inventory.
  String? achievementsError;

  /// Bumped on every Achievements read, so a late answer for an older request
  /// cannot replace the inventory a newer one produced.
  int _achievementsTicket = 0;

  /// The open lock-in session, if any. `null` means Chill is the target.
  SessionDetail? activeSession;
  String? activeSessionId;

  /// True while `session.generateSteps` is in flight for the open session.
  ///
  /// The detail page reads this to disable its build/rebuild action and to show
  /// `building steps…`, so a provider run is never offered twice.
  /// True while the **open** session's steps are being built.
  ///
  /// The build is tracked per session: opening session B while A is building
  /// must not show B as busy, and A's failure must not appear on B.
  bool get generatingSteps =>
      _generatingStepsFor != null && _generatingStepsFor == activeSessionId;

  /// The session whose steps are in flight, or null.
  String? _generatingStepsFor;

  /// The last step-generation failure, or null.
  ///
  /// A generation refusal is page-local, like a rejected toggle: it never
  /// replaces [error] and it never clears the previous steps. The detail page
  /// shows the message inline with a retry.
  String? stepsError;

  /// The generated session study document on screen, or null.
  ///
  /// `session.document` returns the document's own Markdown plus the
  /// session-relative file it was written to; the shell renders this text
  /// directly and never re-reads the file. A generated document is **not** a
  /// source: it is never added to [activeSession]'s source rows.
  String? documentText;

  /// `contract.md`, `contradictions.md` or `check.md` for [documentText].
  String? documentName;

  /// True while `session.document` is in flight for the open session.
  bool documentLoading = false;

  /// The last study-document failure, or null.
  ///
  /// Page-local, like [stepsError]: it never replaces [error] and never detaches
  /// [activeSession]. The detail shows one readable line with a retry.
  String? documentError;

  /// The open session's source coverage (`session.coverage`), or null before the
  /// first read.
  ///
  /// Read-only and derived: the core counts mentions of each copied source
  /// across the session's steps, chat, outputs and memory, and the shell only
  /// formats the report. A failed read keeps the previous report and records its
  /// reason in [coverageError], so the card shows one message with a retry and
  /// never invents an empty report.
  CoverageReport? coverage;

  /// True while `session.coverage` is in flight for the open session.
  bool coverageLoading = false;

  /// The last coverage-read failure, or null.
  ///
  /// Page-local, like [stepsError]: it never replaces [error] and never clears
  /// [coverage], so a broken read still shows the counts the shell last received.
  String? coverageError;

  /// Bumped on every coverage request and every clear, so an answer for a
  /// session the user has already left cannot replace the visible report.
  int _coverageTicket = 0;

  /// The open session's misconception ledger (`session.mistake.list`).
  ///
  /// Process history, never a source: each row says what the learner got wrong
  /// and whether it has graduated into a [MistakeNote]. The core owns the file
  /// and the note; the shell only renders the rows and sends intents.
  List<SessionMistake> mistakes = const [];

  /// True while the ledger is being read or re-read for the open session.
  bool mistakesLoading = false;

  /// The last ledger read or write failure, or null.
  ///
  /// Page-local like [coverageError]: one broken read never replaces [error],
  /// and the previous rows stay so the card can show them with a retry.
  String? mistakesError;

  /// Bumped on every ledger request and every clear, so an answer for a
  /// session the user has already left cannot replace the visible rows.
  int _mistakesTicket = 0;

  /// The open session's `prompt.md` and provenance (`session.instructions.get`).
  ///
  /// This is the text the model reads, not a second copy of the session detail:
  /// [SessionDetail.prompt] is the `session.open` projection and this is a read
  /// of the same file through the settings pane. A failed read keeps the last
  /// value and records its reason in [instructionsError].
  SessionInstructions? sessionInstructions;

  /// True while `session.instructions.*` read is in flight.
  bool instructionsLoading = false;

  /// The last instruction-read or instruction-write failure, or null.
  ///
  /// Page-local, like [stepsError]: it never replaces [error] and never clears
  /// [sessionInstructions], so a failed save leaves the previous prompt on
  /// screen with one readable message.
  String? instructionsError;

  /// Bumped on every instruction request and every clear, so an answer that
  /// arrives after the pane closed cannot reappear.
  int _instructionsTicket = 0;

  /// The read's own counter. [_instructionsTicket] is the write generation: a
  /// read that shared it could cancel a save in flight, which then returned
  /// false with no message although the core had written the file.
  int _instructionsLoadTicket = 0;

  /// The kind and attempt of the last request, kept so a retry asks for exactly
  /// the same document.
  String? _documentKind;
  String? _documentAttempt;

  /// Bumped on every request and every clear, so an answer that arrives after
  /// the reader closed cannot reappear.
  int _documentTicket = 0;

  /// True when the document reader is the visible layer.
  bool get documentOpen =>
      documentLoading || documentText != null || documentError != null;

  /// The kind of the generated output on screen: `study-guide` or `flashcards`.
  ///
  /// Null means the output reader is closed. The shell derives the reader layer
  /// from this, so closing the reader is one assignment, not a second flag.
  /// [outputMarkdown] is the primary document (the guide or the deck) and
  /// [outputAnswers] is the study guide's answers part once it has been read.
  ///
  /// An output is **generated, not a source**: nothing here becomes a source
  /// row and nothing here is written by the shell.
  String? outputKind;

  /// The guide or deck the reader renders, or null before the first read.
  String? outputMarkdown;

  /// The study guide's answers document.
  ///
  /// Null means the answers part has not been read (the toggle is off); an
  /// empty string means the core answered that the file does not exist yet, so
  /// the reader can say so instead of rendering a blank panel.
  String? outputAnswers;

  /// True when the primary output file exists. False is the documented empty
  /// state — the reader offers to build it instead of reporting an error.
  bool outputExists = false;

  /// True while `session.output.read` or `session.output.build` is in flight.
  bool outputLoading = false;

  /// The last output read/build failure, or null.
  ///
  /// Page-local, like [documentError]: it never replaces [error], never detaches
  /// [activeSession] and never clears an output the shell already received, so
  /// a failed rebuild still shows the previous document with one retry.
  String? outputError;

  /// The part and operation of the last output request, kept so [retryOutput]
  /// asks for exactly the same thing.
  String? _outputPart;
  bool _outputWasBuild = false;

  /// Bumped on every output request and every clear, so an answer for a reader
  /// the user has already left cannot replace the visible document.
  int _outputTicket = 0;

  /// True when the output reader is the visible layer.
  bool get outputOpen => outputKind != null;

  /// The registered Work projects, read by `work.list`.
  List<ProjectRow> projects = const [];

  /// The agent templates a project's editor can offer (`work.templates.list`).
  ///
  /// The built-ins always ship; a project's own `work/templates/*.json` join
  /// them. The rows are a snapshot of what the picker would show — choosing one
  /// only fills editor fields, so nothing here is applied on its own.
  List<AgentTemplateRow> workTemplates = const [];

  /// True while `work.templates.list` is in flight.
  bool workTemplatesLoading = false;

  /// The last template-read failure, or null.
  ///
  /// Page-local, like [workChangesError]: the picker says the list could not be
  /// read instead of pretending the workspace has no templates.
  String? workTemplatesError;

  /// The open Work project, if any. `null` means the project list is showing.
  ///
  /// The shell keeps this across surface switches: leaving Work and coming back
  /// returns to the same project, never a reset list.
  WorkProjectDetail? activeProject;
  String? activeProjectId;

  /// The open project's saved chat ids (`work.chat.list`).
  ///
  /// Replaced when a project opens; a chat created by `work.chat.open` is
  /// appended so the detail's count follows without a second list read.
  List<String> projectChats = const [];

  /// The open project's read-only Changes summary (`work.changes`).
  ///
  /// Loaded when a project opens and refreshed on demand, never from
  /// [refreshAll]: a git read is not part of the first frame. Null until the
  /// first answer arrives; a failed refresh keeps the previous summary and
  /// records its reason in [workChangesError].
  ChangeSummary? workChanges;

  /// True while `work.changes` is in flight for the open project.
  bool workChangesLoading = false;

  /// The last `work.changes` failure, or null.
  ///
  /// Page-local, like [stepsError]: it never replaces [error] and never clears
  /// [workChanges], so an unreadable working tree still shows the rows the
  /// shell last received.
  String? workChangesError;

  /// The open project's pending writes (`work.approvals.list` / proposals).
  ///
  /// A proposal is a value: the core keeps it in process memory until
  /// `work.write.decide` consumes it, and the shell never applies it itself. The
  /// list is scoped to the open project; a proposal for another project is
  /// dropped until that project is opened and read again.
  List<WorkWriteProposal> pendingWrites = const [];

  /// The open project's pending commands, on the same terms as [pendingWrites].
  List<WorkCommandProposal> pendingCommands = const [];

  /// The result of the last command the user decided for the open project.
  ///
  /// Kept so the approvals view can show the exit code and the output: the
  /// proposal row is consumed by the decision, and a failed or timed-out
  /// command would otherwise look exactly like a successful one. Cleared when
  /// the project closes or changes; [dismissCommandOutcome] clears it by hand.
  CommandOutcome? lastCommandOutcome;

  /// True while `work.approvals.list` is in flight.
  bool approvalsLoading = false;

  /// The last approvals read failure, or null.
  ///
  /// Page-local, like [workChangesError]: it never replaces [error] and never
  /// clears the pending rows, so a failed refresh still shows what the shell
  /// last received with one readable line.
  String? approvalsError;

  /// Bumped on every approvals read and every clear, so a late answer for a
  /// project the user has left cannot replace the visible pending list.
  int _approvalsTicket = 0;

  /// The open project's swarm runs (`work.swarm.runs`), oldest first.
  ///
  /// A board is **process state**: a core restart forgets every run record and
  /// only the Markdown report under `work/projects/<id>/reports/` survives.
  /// Replaced when a project opens and refreshed on demand; a failure keeps the
  /// previous list and records its reason in [swarmError], so a broken read never
  /// invents "no runs yet".
  List<SwarmBoardView> swarmRuns = const [];

  /// The board the swarm page is showing, or null when no run is open.
  SwarmBoardView? activeSwarm;
  String? activeSwarmId;

  /// True while a swarm read, open or mutation is in flight.
  bool swarmLoading = false;

  /// The last swarm failure, or null.
  ///
  /// Page-local, like [approvalsError]: it never replaces [error] and never
  /// clears a board the shell already received, so a failed refresh still shows
  /// the rows from the last answer with one readable line.
  String? swarmError;

  /// Bumped on every swarm read and every clear, so a late answer for a project
  /// the user has left cannot replace the visible board.
  int _swarmTicket = 0;

  /// The board read has its own counter: sharing the list's meant a list
  /// refresh that overlapped an open made the open return false in silence.
  int _swarmBoardTicket = 0;

  /// The Work activity log rows (`activity.list`), newest first as the core
  /// sends them.
  ///
  /// The log is metadata only: a decision or a swarm lifecycle event, never a
  /// file body, a prompt or output. It is not read at startup; opening the
  /// project detail reads it for the count, and `l` opens the log itself. A
  /// failed read keeps the previous rows and records its reason in
  /// [activityError], so a broken read never invents "no decisions yet".
  List<ActivityRecordView> activityRecords = const [];

  /// Corrupt lines the core skipped on the last read. Shown beside the rows, it
  /// is never an error.
  int activitySkipped = 0;

  /// The core's own flag for a log file that does not exist yet.
  bool activityEmpty = true;

  /// True while `activity.list` is in flight.
  bool activityLoading = false;

  /// The last activity read failure, or null.
  ///
  /// Page-local, like [approvalsError]: it never replaces [error] and never
  /// clears the rows, so a failed refresh still shows what the shell last
  /// received with one readable line beside it.
  String? activityError;

  /// The kind filter the visible rows answer: null for every kind, otherwise
  /// `write-decision`, `command-decision` or `swarm`.
  String? activityKind;

  /// The project id the visible rows answer, or null for every project.
  String? activityProject;

  /// Bumped on every activity read and every clear, so a late answer for a
  /// project or filter the user has left cannot replace the visible log.
  int _activityTicket = 0;

  /// The open project chat id, if any. `null` means the project detail.
  ///
  /// The shell keeps this while collapsing back to the detail, so `c` reopens
  /// the transcript the user was last reading. [closeWorkChat] clears it and
  /// [closeProject] clears it with the project.
  String? activeWorkChatId;

  final Map<String, ChatSnapshot> _sessionChats = {};
  final Map<String, String> _sessionChatErrors = {};

  /// The highest state `seq` seen per chat stream.
  ///
  /// The core numbers every snapshot and every state event on one stream with
  /// the same counter (`seq` in `chatSnapshot`). A frame at or below the last
  /// one accepted is stale — a coalesced flush racing a request, or a snapshot
  /// delivered after a newer event — and is dropped rather than allowed to
  /// overwrite the transcript. A stream without `seq` (an older core) is
  /// accepted as before.
  final Map<String, int> _chatSeqs = {};
  static const String _chillChatKey = 'chat';

  /// True when a state event is newer than the last frame accepted for its
  /// stream. Equal is stale: the core increments once per emitted frame.
  bool _acceptChatEvent(String key, Object? seq) {
    if (seq is! int) return true;
    final last = _chatSeqs[key];
    if (last != null && seq <= last) return false;
    _chatSeqs[key] = seq;
    return true;
  }

  /// True when a snapshot is not older than the last event accepted. A
  /// snapshot is a whole state, so an equal sequence is still applied.
  bool _acceptChatSnapshot(String key, Object? seq) {
    if (seq is! int) return true;
    final last = _chatSeqs[key];
    if (last != null && seq < last) return false;
    _chatSeqs[key] = seq;
    return true;
  }

  /// Project chat transcripts, keyed `<projectId>:<chatId>`.
  ///
  /// A project may hold several chats (`chats/chat-<n>.jsonl`), so unlike a
  /// lock-in session the key carries both ids. Every `work.chat.state` event
  /// echoes both, so a stray update can never replace the visible transcript.
  final Map<String, ChatSnapshot> _workChats = {};
  final Map<String, String> _workChatErrors = {};

  /// Cached session transcripts, keyed by session id. A view: the store owns
  /// the map, so a page cannot mutate it behind the shell's back.
  Map<String, ChatSnapshot> get sessionChats =>
      UnmodifiableMapView(_sessionChats);

  /// The active session's transcript. Null before a session is opened or before
  /// its first snapshot arrives.
  ChatSnapshot? get sessionChat =>
      activeSessionId == null ? null : _sessionChats[activeSessionId];

  /// The last `session.chat.error` for the active session, if any. Session chat
  /// failures are kept separate from [error] so a session failure never looks
  /// like a transport failure for the whole shell.
  String? get sessionChatError =>
      activeSessionId == null ? null : _sessionChatErrors[activeSessionId];

  /// Transcript for one session, cached or not: a closed session keeps its
  /// snapshot so reopening does not flash an empty transcript.
  ChatSnapshot? sessionChatFor(String id) => _sessionChats[id];

  /// Cached project chat transcripts, keyed `<projectId>:<chatId>`. A view: the
  /// store owns the map, so a page cannot mutate it behind the shell's back.
  Map<String, ChatSnapshot> get workChats => UnmodifiableMapView(_workChats);

  /// The active project chat's transcript, or null before it is opened.
  ChatSnapshot? get workChat {
    final key = _activeWorkChatKey;
    return key == null ? null : _workChats[key];
  }

  /// The last `work.chat.error` (or failed send) for the active project chat.
  String? get workChatError {
    final key = _activeWorkChatKey;
    return key == null ? null : _workChatErrors[key];
  }

  /// Transcript for one project chat, cached or not: a collapsed chat keeps its
  /// snapshot so reopening does not flash an empty transcript.
  ChatSnapshot? workChatFor(String projectId, String chatId) =>
      _workChats[_workChatKey(projectId, chatId)];

  String? get _activeWorkChatKey {
    final projectId = activeProjectId;
    final chatId = activeWorkChatId;
    if (projectId == null || chatId == null) return null;
    return _workChatKey(projectId, chatId);
  }

  static String _workChatKey(String projectId, String chatId) =>
      '$projectId:$chatId';

  /// The Skills goal rows (`skill.list`). Empty until the Skills surface asks:
  /// the goal folder is a read, but it is not part of the first frame.
  List<SkillRow> skills = const [];

  /// See [sessionsLoaded].
  bool skillsLoaded = false;

  /// See [sessionsLoaded].
  bool projectsLoaded = false;

  /// The open goal (`skill.open`), or null when the list is showing.
  ///
  /// The shell keeps this across surface switches, so leaving Skills and coming
  /// back returns to the same goal, never a reset list.
  SkillDetail? activeSkill;
  String? activeSkillId;

  /// The chapter body the reader is showing, or null before one is requested.
  ///
  /// It carries the practical flag and the chapter id/title the core echoed, so
  /// the reader header never re-derives them from the index.
  SkillChapterBody? activeSkillChapter;

  /// True while `skill.chapter` is in flight. The reader shows its pending state
  /// and the detail's `Enter`/`p` are not offered twice.
  bool skillChapterLoading = false;

  /// The last chapter read failure. It never clears [activeSkill]: the goal page
  /// is still usable and shows one readable message with a retry.
  String? skillChapterError;

  /// The chapter id and practical flag of the last request, kept so the reader's
  /// retry asks for exactly the same body.
  String? activeSkillChapterId;
  bool activeSkillChapterPractical = false;

  /// True when the chapter reader is the visible layer.
  bool get skillChapterOpen =>
      skillChapterLoading ||
      activeSkillChapter != null ||
      skillChapterError != null;

  /// The curriculum stage whose lesson reader is open, if any.
  ///
  /// A stage id comes from the open goal's `skill.open` index; the shell never
  /// derives one. `null` means the goal page is the visible layer.
  String? activeSkillStageId;

  /// The lesson Markdown the staged-lesson reader renders.
  String skillLessonMarkdown = '';

  /// False when the stage has no lesson file yet: the reader's empty state with
  /// a `skill.lesson.build` next action, not an error.
  bool skillLessonExists = false;

  /// The citations a built lesson carries, labelled as source citations.
  List<SkillCitation> skillLessonCitations = const [];

  /// `draft`, `ready` or empty (a read does not report a status).
  String skillLessonStatus = '';

  /// True while `skill.lesson.read` or `skill.lesson.build` is in flight.
  bool skillLessonLoading = false;

  /// The last read/build failure, or null. A `confirm` refusal from a rebuild
  /// of a `ready` lesson lands here as the core's own message: the shell shows
  /// it and never retries on the user's behalf.
  String? skillLessonError;

  /// True when the last build was refused only because a `ready` lesson
  /// exists. The view turns this into a named "replace" confirmation instead
  /// of a Retry that would fail the same way.
  bool skillLessonNeedsConfirm = false;

  /// True when the open stage is the visible lesson layer.
  bool get skillLessonOpen => activeSkillStageId != null;

  /// The open stage from the goal's index, or null when it is not known.
  SkillStage? get activeSkillStage {
    final id = activeSkillStageId;
    final stages = activeSkill?.stages;
    if (id == null || stages == null) return null;
    for (final stage in stages) {
      if (stage.id == id) return stage;
    }
    return null;
  }

  /// Bumped on every lesson read, build and clear, so an answer for a stage the
  /// user has already left cannot replace the visible lesson.
  int _skillLessonTicket = 0;

  /// Whether the retry beside a failed lesson should build rather than read.
  bool _skillLessonRetryBuild = false;

  /// The open goal's saved chats (`skill.chat.list`).
  ///
  /// Replaced when a goal opens; a chat created by `skill.chat.open` is appended
  /// so the detail's list follows without a second read.
  List<SkillChatRow> skillChats = const [];

  /// The open goal chat id, if any. `null` means the goal page.
  ///
  /// The shell keeps this while collapsing back to the goal, so `c` reopens the
  /// transcript the user was last reading; [closeSkillChat] clears it.
  String? activeSkillChatId;

  /// Goal chat transcripts, keyed `<goalId>:<chatId>`.
  ///
  /// A goal may hold several chats (`chats/chat-<n>.jsonl`), so the key carries
  /// both ids and every `skill.chat.state` echoes both. A stray update can then
  /// never replace the visible transcript.
  final Map<String, ChatSnapshot> _skillChats = {};
  final Map<String, String> _skillChatErrors = {};

  /// The active goal chat's transcript, or null before one is opened.
  ChatSnapshot? get skillChat {
    final key = _activeSkillChatKey;
    return key == null ? null : _skillChats[key];
  }

  /// The last `skill.chat.error` (or failed send) for the active goal chat.
  String? get skillChatError {
    final key = _activeSkillChatKey;
    return key == null ? null : _skillChatErrors[key];
  }

  /// The teaching record for the open goal (`teach.state`), or null.
  ///
  /// Measure, plan, the open step and its checks are one record from the core,
  /// so the surface renders fields instead of parsing prose
  /// (`desktop/docs/redesign.md` §2.1). A failed read keeps the previous record.
  TeachingState? teaching;

  /// True while a `teach.*` call is in flight.
  bool teachingLoading = false;

  /// The last teaching failure, or null.
  String? teachingError;

  /// The verdict of the last `teach.check`.
  TeachingCheckResult? teachingVerdict;

  /// The open step's side thread, newest last.
  List<TeachingSideMessage> teachingSide = const [];

  /// True while a side read or question is in flight.
  bool teachingSideLoading = false;

  /// The last side failure, shown inside the panel.
  String? teachingSideError;

  /// The running build's version (`update.info`), once read.
  String? appVersion;

  /// The public release repository (`update.info`).
  String? updateRepo;

  /// The last update check, or null before one ran.
  UpdateView? updateState;

  /// True while `update.check` is in flight.
  bool updateChecking = false;

  /// One readable update failure. A check is explicit, so this is shown in
  /// Settings and nowhere else.
  String? updateError;

  /// The open deck's spaced-repetition schedule, or null before a read.
  DeckSchedule? deckSchedule;

  /// True while a deck schedule read or grade is in flight.
  bool deckScheduleLoading = false;

  /// The last deck schedule failure, shown beside the deck.
  String? deckScheduleError;

  /// The open session chat's context meter, or null before a read.
  SessionContextView? sessionContext;

  /// True while a context read or compaction is in flight.
  bool sessionContextLoading = false;

  /// The last context failure, shown beside the meter.
  String? sessionContextError;

  /// Saved research briefs for the open goal.
  List<ResearchItem> research = const [];

  /// True while the list is being read.
  bool researchLoading = false;

  /// True while a brief is being fetched and written.
  bool researchRunning = false;

  /// The last research failure, shown in the card.
  String? researchError;

  /// The open brief's Markdown, or null when none is open.
  String? researchMarkdown;

  /// The open brief's id.
  String? researchOpenId;

  /// The prompt catalogue with its stored notes.
  List<PromptNoteView> prompts = const [];

  /// The last prompt-note failure, shown in Settings.
  String? promptsError;

  /// The learning graph, or null before a read.
  LearningGraph? learningGraph;

  /// True while the graph is being derived.
  bool learningGraphLoading = false;

  /// The last graph failure, shown in the Knowledge surface.
  String? learningGraphError;

  /// Figures cropped from the open session's PDFs.
  List<SessionFigure> figures = const [];

  /// Decoded PNG bytes by figure id, loaded on demand.
  final Map<String, Uint8List> figureImages = {};

  bool figuresLoading = false;
  bool figureBusy = false;
  String? figureError;
  int _figureTicket = 0;

  int _researchTicket = 0;

  int _deckTicket = 0;
  int _contextTicket = 0;

  int _teachingTicket = 0;

  /// Transcript for one goal chat, cached or not: a collapsed chat keeps its
  /// snapshot so reopening does not flash an empty transcript.
  ChatSnapshot? skillChatFor(String goalId, String chatId) =>
      _skillChats[_skillChatKey(goalId, chatId)];

  String? get _activeSkillChatKey {
    final goalId = activeSkillId;
    final chatId = activeSkillChatId;
    if (goalId == null || chatId == null) return null;
    return _skillChatKey(goalId, chatId);
  }

  static String _skillChatKey(String goalId, String chatId) =>
      '$goalId:$chatId';

  /// The open goal's gathered, citable sources (`skill.sources.list`).
  ///
  /// A skill source is a copy inside the goal's `sources/`, so the rows carry no
  /// original absolute path. They are the only material a goal chat may cite, so
  /// the detail page lists them read-only; the shell never edits or re-derives
  /// them.
  List<SkillSourceRow> skillSources = const [];

  /// True while `skill.sources.list` is in flight for the open goal.
  bool skillSourcesLoading = false;

  /// The last source-list failure, or null.
  ///
  /// Page-local, like [skillChapterError]: it never replaces [error] and never
  /// clears [skillSources], so a broken read still shows the rows the shell last
  /// received with one Retry beside them.
  String? skillSourcesError;

  /// Bumped on every source read and every clear, so an answer for a goal the
  /// user has already left cannot replace the visible list.
  int _skillSourcesTicket = 0;

  bool get isOnline => status == CoreStatus.online;
  bool get configured => workspace?.configured ?? false;
  String? get providersError => _providersError;

  Future<void> start({
    String? executable,
    List<String>? arguments,
    String? workingDirectory,
  }) async {
    if (_starting) return;
    _starting = true;
    status = CoreStatus.connecting;
    error = null;
    notifyListeners();
    _subscription ??= _connection.events.listen(_handleEvent);
    final launch = executable == null && arguments == null
        ? resolveSidecar()
        : SidecarLaunch(
            executable: executable ?? 'bun',
            arguments: arguments ?? const ['run', '../src/server/main.ts'],
            workingDirectory: workingDirectory,
          );
    // One connection for the whole start: `_connection` is a field a retry can
    // replace, and initialising a different object from the one just started
    // fails with "core is not running".
    final connection = _connection;
    try {
      await connection.start(
        executable: launch.executable,
        arguments: launch.arguments,
        workingDirectory: launch.workingDirectory ?? workingDirectory,
        environment: launch.environment,
      );
      await connection.initialize();
      status = CoreStatus.online;
      await refreshAll();
      await refreshChat();
    } catch (failure) {
      status = CoreStatus.failed;
      error = _messageOf(failure);
      notifyListeners();
    } finally {
      _starting = false;
    }
  }

  Future<void> refreshAll() async {
    // The lists the sidebar counts are loaded at startup, not on first open:
    // a count that reads `0` until the user visits the surface is worse than no
    // count. Only the three library listings belong here: they are folder
    // reads the shell already needs. The review queue is not (it scores every
    // session's coverage), the archive is not (its GitHub backend would make a
    // network call on the first frame), and the achievements snapshot is not
    // (reading it records award dates, a write that belongs to opening the
    // layer). Those counts appear once their surface has been opened.
    await Future.wait([
      refreshWorkspace(),
      refreshSessions(),
      refreshSkills(),
      refreshProjects(),
      refreshStats(),
      refreshSettings(),
      refreshKeybinds(),
    ]);
  }

  Future<void> refreshWorkspace() async {
    final json = await _connection.call(CoreMethod.workspaceInfo);
    workspace = WorkspaceInfo.fromJson(json);
    notifyListeners();
  }

  Future<void> refreshSessions() async {
    try {
      final json = await _connection.call(CoreMethod.sessionList);
      final raw = json['sessions'];
      sessions = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) => SessionRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      sessionsLoaded = true;
      error = null;
    } catch (failure) {
      // A throw here used to become an unhandled future: the manager kept its
      // stale rows with no banner and no way to know the read failed.
      error = _messageOf(failure);
    }
    notifyListeners();
  }

  /// The Stats range and scope the user last asked for.
  ///
  /// Kept here, not read back from [stats]: a refresh used to reset the page to
  /// `all`/`all`, and two quick chip presses each read the previous reply's
  /// values, so the first selection was lost.
  String statsRange = 'all';
  String statsScope = 'all';
  int _statsTicket = 0;

  /// The last `settings.get` failure, or null.
  ///
  /// Per-surface, like the chat and lesson errors: the Settings page used to
  /// render the single global `error`, so a Chill provider failure replaced the
  /// whole page with "Settings could not load" — and its Retry could not clear
  /// a slot it did not own.
  String? settingsError;

  /// Persist one settings patch and project the result. The core writes the
  /// file and applies it to the live service before returning.
  Future<void> saveSettings(Map<String, dynamic> patch) async {
    final json = await _connection.call(CoreMethod.settingsPatch, {
      'patch': patch,
    });
    settings = SettingsView.fromJson(json);
    // A model change drops every core chat controller, so the next snapshot
    // starts a fresh per-stream counter. Forget the old maxima or the new
    // stream's first frames would look stale.
    _chatSeqs.clear();
    notifyListeners();
    await refreshWorkspace();
    await refreshChat();
    notifyListeners();
  }

  /// the streamed `session.chat.state` events remain authoritative.
  Future<bool> sendSessionChat(String id, String text) async {
    try {
      await _connection.call(CoreMethod.sessionChatSend, {
        'id': id,
        'text': text,
      });
      _sessionChatErrors.remove(id);
      notifyListeners();
      return true;
    } catch (failure) {
      _sessionChatErrors[id] = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Stop a session's in-flight turn. Cancelling with nothing running is not an
  /// error in the core, so it is a no-op here too.
  Future<void> cancelSessionChat(String id) async {
    try {
      await _connection.call(CoreMethod.sessionChatCancel, {'id': id});
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Leave the session surface for Chill. The cached transcripts stay in
  /// [sessionChats] so reopening a session does not reset its history.
  void closeSession() {
    _sessionOpenTicket += 1;
    activeSession = null;
    activeSessionId = null;
    stepsError = null;
    _clearDocument();
    _clearInstructions();
    _clearOutput();
    _clearCoverage();
    _clearMistakes();
    notifyListeners();
  }

  /// Re-read the Skills goal rows (`skill.list`).
  ///
  /// Failure is recorded once in [error] and the previous [skills] list stays on
  /// screen: a broken read never invents an empty list, so the page can say the
  /// store keeps no export projection because the reply is a snapshot.
  Future<StatsExportResult> exportStats({
    String range = 'all',
    String scope = 'all',
    String format = 'md',
  }) async {
    final json = await _connection.call(CoreMethod.statsExport, {
      'range': range,
      'scope': scope,
      'format': format,
    });
    return StatsExportResult.fromJson(json);
  }

  Future<void> selectStats({String? range, String? scope}) async {
    try {
      await refreshStats(range: range, scope: scope);
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Restart the sidecar. A boot refusal is memoised in the process, so a
  /// genuine retry needs a new process, not another request.
  Future<void> retry() async {
    // A retry replaces the connection, so it must not overlap a start or
    // another retry: the second would dispose the process the first is still
    // initialising and leave the shell `failed` beside an orphaned core.
    if (_starting || _retrying) return;
    final reconnect = reconnectFactory;
    if (reconnect == null) {
      await start();
      return;
    }
    _retrying = true;
    try {
      await _reconnect(reconnect);
    } finally {
      _retrying = false;
    }
  }

  /// Forget everything the dead process told us.
  ///
  /// A retry builds a new process, which may even boot a different workspace, so
  /// every projection has to go back to its constructor default. This used to be
  /// a hand-written list inside `_reconnect`, and it had drifted: `sessions` was
  /// kept while `skills` and `projects` were cleared, the `*Loaded` flags were
  /// never cleared so the sidebar printed a fabricated `0` for Skills and Work,
  /// and `settings`, `stats`, `achievements`, `decision`, `workPermissions`,
  /// the custom palette, the study document and the staged lesson all survived.
  ///
  /// The order matches the field declarations, so a new field has one obvious
  /// place to go. `_reconnectResetsEveryProjection` in `core_store_test.dart`
  /// loads every projection and then asserts each default, so leaving one out
  /// fails a test rather than shipping a stale screen.
  void _resetForNewProcess() {
    status = CoreStatus.offline;
    error = null;
    workspace = null;
    sessions = const [];
    sessionsLoaded = false;
    stats = null;
    statsRange = 'all';
    statsScope = 'all';
    // `app.dart` derives the theme id from `settings.theme`, so a stale view
    // would repaint the dead workspace's palette.
    settings = null;
    settingsError = null;
    chat = null;
    chatSendError = null;
    providers = const [];
    _providersError = null;
    // A new process reads `config.toml` again, so a binding cached from the dead
    // one is a promise the shell cannot keep.
    keybinds = const <String, String>{};
    fixedKeybinds = const <String, String>{};
    customThemeTokens = ThemeTokens.empty;
    mcpServers = const [];
    mcpPolicy = PluginPolicy.empty;
    mcpError = null;
    decision = null;
    decisionLoading = false;
    decisionError = null;
    _decisionTicket += 1;
    workPermissions = null;
    workPermissionsLoading = false;
    workPermissionsError = null;
    _workPermissionsTicket += 1;
    // A prompt belongs to the process that emitted it; a new process issues new
    // request ids and forgets the old ones, so a stale modal must not survive.
    _permissionQueue.clear();
    for (final timer in _permissionTimers.values) {
      timer.cancel();
    }
    _permissionTimers.clear();
    _expiredPermissions.clear();
    pluginPermissionError = null;
    review = null;
    reviewLoading = false;
    reviewError = null;
    reviewSide = 'all';
    _markingIds.clear();
    _reviewTicket += 1;
    _reviewWriteTicket += 1;
    archiveRows = const [];
    archiveLoading = false;
    archiveError = null;
    _archiveTicket += 1;
    achievements = const [];
    achievementsEarned = 0;
    achievementsTotal = 0;
    achievementsWarning = null;
    achievementsLoading = false;
    achievementsError = null;
    _achievementsTicket += 1;
    // The Knowledge tree is a workspace read, not process state, but a new
    // process may see a different workspace; the shell re-reads it on entry.
    knowledgeHits = const [];
    knowledgeGroups = const [];
    knowledgeLoading = false;
    knowledgeError = null;
    knowledgeQuery = '';
    knowledgeScope = 'all';
    knowledgeHitOrder = const [];
    knowledgeHitIndex = null;
    _knowledgeTicket += 1;
    _knowledgeTreeTicket += 1;
    _knowledgeSearching = false;
    _knowledgeTreeLoading = false;
    // A read body belongs to the process that produced it; a new process may
    // see a different workspace, so the reader is closed rather than kept open
    // on text the shell cannot vouch for.
    _clearKnowledgeDocument();
    // A new process owns new chat controllers; a snapshot cached from the dead
    // one would be a lie.
    activeSession = null;
    activeSessionId = null;
    _generatingStepsFor = null;
    stepsError = null;
    _clearInstructions();
    _clearOutput();
    _clearCoverage();
    _clearMistakes();
    _clearDocument();
    _sessionChats.clear();
    _sessionChatErrors.clear();
    _chatSeqs.clear();
    _sessionOpenTicket += 1;
    _projectOpenTicket += 1;
    _skillOpenTicket += 1;
    _projectEpoch += 1;
    projects = const [];
    projectsLoaded = false;
    activeProject = null;
    activeProjectId = null;
    projectChats = const [];
    activeWorkChatId = null;
    _workChats.clear();
    _workChatErrors.clear();
    workChanges = null;
    workChangesLoading = false;
    workChangesError = null;
    workTemplates = const [];
    workTemplatesLoading = false;
    workTemplatesError = null;
    _workTemplatesTicket += 1;
    lastCommandOutcome = null;
    _clearApprovals();
    _clearSwarms();
    _clearActivity();
    skills = const [];
    skillsLoaded = false;
    activeSkill = null;
    activeSkillId = null;
    activeSkillChatId = null;
    skillChats = const [];
    _skillChats.clear();
    _skillChatErrors.clear();
    _clearSkillSources();
    _clearChapter();
    _clearSkillLesson();
  }

  Future<void> _reconnect(CoreConnection Function() reconnect) async {
    await _subscription?.cancel();
    _subscription = null;
    await _connection.dispose();
    _connection = reconnect();
    _subscription = _connection.events.listen(_handleEvent);
    _resetForNewProcess();
    notifyListeners();
    await start();
  }

  void _handleEvent(Map<String, dynamic> event) {
    final method = event['method'];
    final params = event['params'];
    if (method == 'research.updated' && params is Map) {
      final goalId = params['goalId'];
      final researchId = params['id'];
      final status = params['status'];
      if (goalId is String && goalId == activeSkillId) {
        if (status == 'done' || status == 'failed' || status == 'cancelled') {
          researchRunning = false;
        }
        if (status == 'failed') {
          researchError = params['message'] is String
              ? params['message'] as String
              : 'the research brief failed';
        }
        if (status == 'done') {
          researchError = null;
          unawaited(readResearch(goalId));
          if (researchId is String && researchId == researchOpenId) {
            unawaited(openResearch(goalId, researchId));
          }
        }
        notifyListeners();
      }
      return;
    }
    if (method == 'session.chat.state' && params is Map) {
      final snapshot = Map<String, dynamic>.from(params);
      final sessionId = snapshot.remove('sessionId');
      if (sessionId is String &&
          sessionId.isNotEmpty &&
          _acceptChatEvent('session:$sessionId', snapshot['seq'])) {
        final state = ChatSnapshot.fromJson(snapshot);
        _sessionChats[sessionId] = state;
        // Only a new turn clears the last failure. The core flushes its final
        // coalesced snapshot up to 33 ms *after* an error event, and clearing
        // on every snapshot erased the message almost as soon as it appeared.
        if (state.streaming) _sessionChatErrors.remove(sessionId);
        notifyListeners();
      }
      return;
    }
    if (method == 'session.chat.error' && params is Map) {
      final sessionId = params['sessionId'];
      final message = params['message'];
      if (sessionId is String && sessionId.isNotEmpty) {
        _sessionChatErrors[sessionId] = message is String && message.isNotEmpty
            ? message
            : 'session chat failed';
        notifyListeners();
      }
      return;
    }
    if (method == 'session.chat.done' && params is Map) {
      // The final `session.chat.state` carries the transcript; `done` only makes
      // a stale error disappear for the next turn.
      final sessionId = params['sessionId'];
      if (sessionId is String && _sessionChatErrors.remove(sessionId) != null) {
        notifyListeners();
      }
      return;
    }
    if (method == 'mcp.permission' && params is Map) {
      // One prompt on screen at a time, oldest first; later ones wait their
      // turn. A request without an id can never be answered, so it is dropped
      // rather than shown with a dead button, and a repeat of an id already
      // waiting is the same prompt.
      final request = PluginPermissionRequest.fromJson(
        Map<String, dynamic>.from(params),
      );
      if (request.requestId.isEmpty) return;
      if (_permissionQueue.any(
        (entry) => entry.$1.requestId == request.requestId,
      )) {
        return;
      }
      final first = _permissionQueue.isEmpty;
      _permissionQueue.add((request, _now()));
      _permissionTimers[request.requestId]?.cancel();
      _permissionTimers[request.requestId] = Timer(
        permissionTimeout,
        () => _expirePermission(request.requestId),
      );
      // A new prompt at the head clears the last answer's failure; one that
      // only joins the queue must not wipe the message under the open prompt.
      if (first) pluginPermissionError = null;
      notifyListeners();
      return;
    }
    if (method == 'work.write.proposal' && params is Map) {
      final proposal = WorkWriteProposal.fromJson(
        Map<String, dynamic>.from(params),
      );
      if (proposal.id.isEmpty) return;
      // Scoped to the open project, which means there must BE one: the list is
      // documented as the open project's, and `closeProject` returns early when
      // nothing is open, so a proposal accepted into an empty store could never
      // be cleared.
      final open = activeProjectId;
      if (open == null || proposal.projectId != open) return;
      pendingWrites = [
        for (final write in pendingWrites)
          if (write.id != proposal.id) write,
        proposal,
      ];
      notifyListeners();
      return;
    }
    if (method == 'work.command.proposal' && params is Map) {
      final proposal = WorkCommandProposal.fromJson(
        Map<String, dynamic>.from(params),
      );
      if (proposal.id.isEmpty) return;
      // Same rule as a write proposal: the list is the open project's.
      final open = activeProjectId;
      if (open == null || proposal.projectId != open) return;
      pendingCommands = [
        for (final command in pendingCommands)
          if (command.id != proposal.id) command,
        proposal,
      ];
      notifyListeners();
      return;
    }
    if (method == 'work.approval.resolved' && params is Map) {
      final id = params['id'];
      if (id is! String || id.isEmpty) return;
      final kind = params['kind'];
      if (kind == 'write' || kind == null) _dropWrite(id);
      if (kind == 'command' || kind == null) _dropCommand(id);
      notifyListeners();
      return;
    }
    if (method == 'work.swarm.updated' && params is Map) {
      // A run change is a read-only board; it can only ever replace the rows
      // for that run, never the project, a chat or a pending proposal.
      final projectId = params['projectId'];
      if (projectId is! String || projectId.isEmpty) return;
      final open = activeProjectId;
      if (open != null && open != projectId) return;
      final board = SwarmBoardView.fromJson(params['board']);
      if (board.runId.isEmpty) return;
      _applySwarmBoard(board);
      notifyListeners();
      return;
    }
    if (method == 'work.chat.state' && params is Map) {
      final snapshot = Map<String, dynamic>.from(params);
      final projectId = snapshot.remove('projectId');
      final chatId = snapshot.remove('chatId');
      if (projectId is String &&
          projectId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty &&
          _acceptChatEvent(
            'work:${_workChatKey(projectId, chatId)}',
            snapshot['seq'],
          )) {
        final key = _workChatKey(projectId, chatId);
        final state = ChatSnapshot.fromJson(snapshot);
        _workChats[key] = state;
        // See `session.chat.state`: only a new turn clears the last failure.
        if (state.streaming) _workChatErrors.remove(key);
        notifyListeners();
      }
      return;
    }
    if (method == 'work.chat.error' && params is Map) {
      final projectId = params['projectId'];
      final chatId = params['chatId'];
      final message = params['message'];
      if (projectId is String &&
          projectId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty) {
        _workChatErrors[_workChatKey(
          projectId,
          chatId,
        )] = message is String && message.isNotEmpty
            ? message
            : 'project chat failed';
        notifyListeners();
      }
      return;
    }
    if (method == 'work.chat.done' && params is Map) {
      // The final `work.chat.state` carries the transcript; `done` only makes a
      // stale error disappear for the next turn.
      final projectId = params['projectId'];
      final chatId = params['chatId'];
      if (projectId is String && chatId is String) {
        if (_workChatErrors.remove(_workChatKey(projectId, chatId)) != null) {
          notifyListeners();
        }
      }
      return;
    }
    if (method == 'skill.chat.state' && params is Map) {
      final snapshot = Map<String, dynamic>.from(params);
      final goalId = snapshot.remove('goalId');
      final chatId = snapshot.remove('chatId');
      if (goalId is String &&
          goalId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty &&
          _acceptChatEvent(
            'skill:${_skillChatKey(goalId, chatId)}',
            snapshot['seq'],
          )) {
        final key = _skillChatKey(goalId, chatId);
        final state = ChatSnapshot.fromJson(snapshot);
        _skillChats[key] = state;
        // See `session.chat.state`: only a new turn clears the last failure.
        if (state.streaming) _skillChatErrors.remove(key);
        notifyListeners();
      }
      return;
    }
    if (method == 'skill.chat.error' && params is Map) {
      final goalId = params['goalId'];
      final chatId = params['chatId'];
      final message = params['message'];
      if (goalId is String &&
          goalId.isNotEmpty &&
          chatId is String &&
          chatId.isNotEmpty) {
        _skillChatErrors[_skillChatKey(
          goalId,
          chatId,
        )] = message is String && message.isNotEmpty
            ? message
            : 'goal chat failed';
        notifyListeners();
      }
      return;
    }
    if (method == 'skill.chat.done' && params is Map) {
      // The final `skill.chat.state` carries the transcript; `done` only makes a
      // stale error disappear for the next turn.
      final goalId = params['goalId'];
      final chatId = params['chatId'];
      if (goalId is String && chatId is String) {
        if (_skillChatErrors.remove(_skillChatKey(goalId, chatId)) != null) {
          notifyListeners();
        }
      }
      return;
    }
    // Chill events only ever replace the Chill transcript; a session transcript
    // lives in its own map, so `chat.state` cannot clobber it.
    if (method == 'chat.state' && params is Map) {
      if (!_acceptChatEvent(_chillChatKey, params['seq'])) return;
      chat = ChatSnapshot.fromJson(Map<String, dynamic>.from(params));
      notifyListeners();
      return;
    }
    if (method == 'chat.error' &&
        params is Map &&
        params['message'] is String) {
      error = params['message'] as String;
      notifyListeners();
      return;
    }
    if (method == 'core.exit') {
      status = CoreStatus.failed;
      error = 'core stopped';
      // The waiting call belongs to the dead process and fails closed; there is
      // nothing left to answer, so the prompt is dropped rather than left with
      // buttons that cannot work.
      _permissionQueue.clear();
      for (final timer in _permissionTimers.values) {
        timer.cancel();
      }
      _permissionTimers.clear();
      _expiredPermissions.clear();
      pluginPermissionError = null;
      notifyListeners();
    }
  }

  /// A whole number from a reply, tolerant of a missing or mistyped field.
  static int _countOf(Object? value) => value is num ? value.toInt() : 0;

  String _messageOf(Object failure) => userMessage(failure);

  /// True when the core refused only because the lesson is already `ready`.
  static bool _isConfirmFailure(Object failure) {
    if (failure is! RpcException) return false;
    final data = failure.data;
    return data is Map && data['kind'] == 'confirm';
  }

  /// True once [dispose] ran. Every async read can finish after the widget tree
  /// is gone, and `ChangeNotifier.notifyListeners` asserts in that case.
  bool _disposed = false;

  /// Notify only while the store is alive.
  ///
  /// Reached from ~170 call sites, most of them after an `await`; guarding them
  /// one by one would be one forgotten `return` away from the same crash.
  /// The core's own step grammar (`src/domain/progress.ts`): `-`, `*` or `+`,
  /// spaces or tabs, then the box. A plan written with `+` bullets used to
  /// count as `0 of 0` here.
  static final _taskItemPattern = RegExp(r'^[-*+][ \t]+\[([ xX])\]');

  static int _countTaskItems(String markdown) => _taskItems(markdown).length;

  static int _countCheckedItems(String markdown) =>
      _taskItems(markdown).where((checked) => checked).length;

  static Iterable<bool> _taskItems(String markdown) sync* {
    for (final line in markdown.split('\n')) {
      final match = _taskItemPattern.firstMatch(line.trimLeft());
      if (match == null) continue;
      yield match.group(1)!.toLowerCase() == 'x';
    }
  }

  static List<ProjectRow> _projectRows(Map<String, dynamic> json) {
    final raw = json['projects'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((row) => ProjectRow.fromJson(Map<String, dynamic>.from(row)))
        .toList();
  }

  @override
  void notifyListeners() {
    if (_disposed) return;
    super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final timer in _permissionTimers.values) {
      timer.cancel();
    }
    _permissionTimers.clear();
    unawaited(_subscription?.cancel());
    unawaited(_connection.dispose());
    super.dispose();
  }
}
