import 'dart:async';
import 'dart:convert';
import 'dart:collection';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'models.dart';
import 'errors.dart';
import 'core_methods.g.dart';
import 'protocol.dart';

/// The transport surface a [CoreStore] needs. `CoreClient` is the real one;
/// tests can pass a fake without spawning a process.
abstract class CoreConnection {
  Stream<Map<String, dynamic>> get events;

  Future<void> start({
    String executable,
    List<String> arguments,
    String? workingDirectory,
    Map<String, String>? environment,
  });

  Future<void> initialize();

  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]);

  Future<void> dispose();
}

/// Owns the Bun core process and the newline-delimited JSON-RPC connection.
///
/// The client is intentionally transport-only: it knows requests, responses and
/// notifications, not domain state. Feature models subscribe to [events] and
/// call [call] with intent-level methods.
class CoreClient implements CoreConnection {
  Process? _process;
  StreamSubscription<String>? _stdout;
  StreamSubscription<String>? _stderr;
  final _events = StreamController<Map<String, dynamic>>.broadcast();
  final _pending = <int, Completer<Map<String, dynamic>>>{};
  int _nextId = 1;

  bool get isRunning => _process != null;

  @override
  Stream<Map<String, dynamic>> get events => _events.stream;

  /// Starts the sidecar. In development this is usually:
  ///
  ///   `bun run ../src/server/main.ts`
  @override
  Future<void> start({
    String executable = 'bun',
    List<String> arguments = const ['run', '../src/server/main.ts'],
    String? workingDirectory,
    Map<String, String>? environment,
  }) async {
    if (_process != null) return;
    final process = await Process.start(
      executable,
      arguments,
      workingDirectory: workingDirectory,
      // Process.start merges this into the parent environment by default
      // (`includeParentEnvironment: true`), so a sidecar still sees PATH and
      // HOME while the shell adds the keyring addon path.
      environment: environment,
    );
    _process = process;
    // A write to a core that is already dying fails on this future, not at the
    // call site. The exit handler reports the crash; this only keeps a broken
    // pipe from surfacing as an unhandled error.
    unawaited(process.stdin.done.catchError((Object _) {}));
    _stdout = process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(_handleLine);
    _stderr = process.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => debugPrint('[core] $line'));
    unawaited(process.exitCode.then(_handleExit));
  }

  @override
  Future<void> initialize() async {
    final result = await call('initialize', {
      'protocol': protocolVersion,
      'client': 'flutter',
    });
    final version = result['protocol'];
    if (version != protocolVersion) {
      throw RpcException(
        -32000,
        'core protocol $version, shell expects $protocolVersion',
      );
    }
  }

  Future<Map<String, dynamic>> ping() => call('ping');

  @override
  Future<Map<String, dynamic>> call(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    final process = _process;
    if (process == null) {
      throw StateError('core is not running');
    }
    final id = _nextId++;
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    process.stdin.writeln(jsonEncode(rpcRequest(id, method, params)));
    // A method that runs a model, a command, an extraction or a network
    // transfer has no deadline here. Abandoning it at 30 s reported a failure
    // while the core carried on and wrote the file, and the "retry" that
    // followed was a second paid run (or a duplicate goal). A crash still fails
    // the call: `_handleExit` completes every pending request with an error.
    //
    // `session.create` is the exception: it is local file work with its own
    // deadline and a per-attempt idempotency key, so a timed-out retry joins
    // the first create instead of duplicating it (`docs/decisions/0019`).
    final deadline = deadlineFor(method);
    if (deadline == null) return completer.future;
    return completer.future.timeout(
      deadline,
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException('core did not answer $method', deadline);
      },
    );
  }

  /// A quick read gives up at 30 s; a create gets 60 s and then reports.
  static const Duration quickCallDeadline = Duration(seconds: 30);
  static const Duration createDeadline = Duration(seconds: 60);

  /// The deadline for [method], or null when it may run indefinitely.
  ///
  /// `session.create` is deliberately **not** in `_longRunning`: its timeout is
  /// what gives the wizard a way out, and its request id makes the retry safe.
  static Duration? deadlineFor(String method) {
    if (method == 'session.create') return createDeadline;
    if (_longRunning.contains(method)) return null;
    return quickCallDeadline;
  }

  /// Methods whose reply legitimately takes longer than a quick read.
  ///
  /// Provider runs (steps, documents, outputs, lessons, a course plan, a key
  /// validation), an approved command (the service allows 120 s), source
  /// extraction and copying, zip exports, and the archive's network transfers.
  static const _longRunning = <String>{
    'session.generateSteps',
    'session.document',
    'session.output.build',
    'session.instructions.import',
    'session.instructions.reextract',
    'session.archive',
    'session.export',
    'source.add',
    'skill.create',
    'skill.lesson.build',
    'skill.sources.add',
    'skill.archive',
    'skill.export',
    'archive.list',
    'archive.restore',
    'archive.remove',
    'work.command.decide',
    'provider.link',
    'mcp.refresh',
  };

  void _handleLine(String line) {
    if (line.trim().isEmpty) return;
    Object? decoded;
    try {
      decoded = jsonDecode(line);
    } on FormatException catch (error) {
      debugPrint('[core] invalid JSON: $error');
      return;
    }
    if (decoded is! Map<String, dynamic>) {
      debugPrint('[core] non-object message');
      return;
    }

    final id = decoded['id'];
    if (id is int) {
      final completer = _pending.remove(id);
      if (completer == null || completer.isCompleted) return;
      final error = decoded['error'];
      if (error is Map<String, dynamic>) {
        completer.completeError(
          RpcException(
            error['code'] is int ? error['code'] as int : -32603,
            error['message']?.toString() ?? 'core error',
            error['data'],
          ),
        );
        return;
      }
      final result = decoded['result'];
      completer.complete(
        result is Map<String, dynamic> ? result : <String, dynamic>{},
      );
      return;
    }

    final method = decoded['method'];
    if (method is String) {
      final params = decoded['params'];
      _events.add(
        params is Map<String, dynamic>
            ? {'method': method, 'params': params}
            : {'method': method},
      );
    }
  }

  void _handleExit(int code) {
    final error = RpcException(-32000, 'core exited with code $code');
    for (final completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(error);
    }
    _pending.clear();
    _process = null;
    // `dispose` kills the process and closes the stream; the exit code then
    // arrives here. Adding to a closed controller throws, and nobody is
    // listening for an exit they asked for.
    if (_events.isClosed) return;
    _events.add({
      'method': 'core.exit',
      'params': {'code': code},
    });
  }

  @override
  Future<void> dispose() async {
    await _stdout?.cancel();
    await _stderr?.cancel();
    _process?.kill();
    _process = null;
    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.completeError(RpcException(-32000, 'core disposed'));
      }
    }
    _pending.clear();
    await _events.close();
  }
}

enum CoreStatus { offline, connecting, online, failed }

/// One concrete way to launch the core.
class SidecarLaunch {
  const SidecarLaunch({
    required this.executable,
    required this.arguments,
    this.workingDirectory,
    this.environment,
  });

  final String executable;
  final List<String> arguments;
  final String? workingDirectory;

  /// Extra environment for the sidecar, merged into the parent environment by
  /// [Process.start]. Null means "inherit exactly", which is what `bun run`
  /// development launches want.
  final Map<String, String>? environment;
}

/// The `node_modules` path a packaged bundle keeps beside its executable.
///
/// Segments, not a joined string: Windows needs `\` between them, and a mixed
/// `C:\\bundle/node_modules/@napi-rs/…` path is what a hard-coded `/` produces.
const keyringAddonSegments = [
  'node_modules',
  '@napi-rs',
  'keyring',
  'index.js',
];

/// The addon path relative to a bundle directory, using this platform's
/// separator.
String keyringAddonRelativePath({String? separator}) =>
    keyringAddonSegments.join(separator ?? Platform.pathSeparator);

/// The environment additions a packaged sidecar needs in [directory].
///
/// `bun build --compile` cannot embed a native `.node` addon, so the release
/// bundle copies `@napi-rs/keyring` next to the shell and the core is pointed
/// at it explicitly. Without the file the map is empty, and the core falls back
/// to its documented `secret-tool` path: this helper never invents a path that
/// is not on disk.
///
/// It is a pure function of [directory] so a test can point it at a temp
/// folder instead of the real executable directory.
Map<String, String> sidecarEnvironment(String directory) {
  // Absolute even when the caller passes something relative: the core runs from
  // a neutral working directory, so a relative addon path would resolve against
  // the wrong folder.
  final base = Directory(directory).absolute.path;
  final addon =
      '$base${Platform.pathSeparator}'
      '${keyringAddonRelativePath()}';
  if (!File(addon).existsSync()) return const {};
  return {'LOCKEDIN_KEYRING_ADDON': addon};
}

/// Prefer a bundled sidecar next to the app executable; fall back to `bun run`
/// for development. The release build copies `lockedin-core` into the bundle,
/// so a packaged app never needs a Bun install.
SidecarLaunch resolveSidecar() {
  final directory = File(Platform.resolvedExecutable).parent.path;
  final names = Platform.isWindows
      ? const ['lockedin-core.exe']
      : const ['lockedin-core'];
  for (final name in names) {
    final candidate = File('$directory${Platform.pathSeparator}$name');
    if (candidate.existsSync()) {
      // Run from a neutral directory: a `bunfig.toml` in the launch folder
      // (for example this repository's test preload) is read by the Bun
      // runtime inside the compiled binary and would break startup.
      final environment = sidecarEnvironment(directory);
      return SidecarLaunch(
        executable: candidate.path,
        arguments: const [],
        workingDirectory: Directory.systemTemp.path,
        environment: environment.isEmpty ? null : environment,
      );
    }
  }
  return const SidecarLaunch(
    executable: 'bun',
    arguments: ['run', '../src/server/main.ts'],
  );
}

/// The Knowledge scopes the surface offers, in chip order.
///
/// `search` accepts all four (`all|school|skills|work`); `tree` accepts
/// `all|school|skills` only, so a `work` scope is projected to `all` for the
/// tree read and the page says work items appear in search.
const knowledgeScopeValues = ['all', 'school', 'skills', 'work'];

/// A projection of the core for the shell and feature widgets.
///
/// The store owns no domain state: it starts the sidecar, performs the initial
/// snapshot, and forwards intent-level calls. Feature pages read the projections
/// and subscribe through [CoreScope].
class CoreStore extends ChangeNotifier {
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

  /// Read the teaching record for [goalId].
  Future<void> readTeaching(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return;
    final ticket = ++_teachingTicket;
    try {
      final json = await _connection.call(CoreMethod.teachState, {
        'goalId': id,
      });
      if (ticket != _teachingTicket) return;
      final record = json['record'];
      teaching = record is Map
          ? TeachingState.fromJson(Map<String, dynamic>.from(record))
          : null;
      teachingError = null;
    } catch (failure) {
      if (ticket != _teachingTicket) return;
      teachingError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Measure the learner and plan the route (`teach.measure`).
  ///
  /// One model call, no retry: a refusal is the core's own sentence and leaves
  /// any previous record exactly as it was.
  Future<bool> measureTeaching(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    teachingVerdict = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachMeasure, {
        'goalId': id,
      });
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Open the next step, a chosen branch, or a new wording of the open one
  /// (`teach.step`).
  Future<bool> teachNextStep(
    String goalId, {
    bool again = false,
    String? stepId,
  }) async {
    final id = goalId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    teachingVerdict = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachStep, {
        'goalId': id,
        if (again) 'again': true,
        if (stepId != null && stepId.trim().isNotEmpty) 'stepId': stepId.trim(),
      });
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Build a practice set from what the lesson has established.
  ///
  /// One model call, no retry. Refused until a step has passed its check: a
  /// session cannot practise what it never landed.
  Future<bool> practiseTeaching(String goalId) async {
    return _teachingCall(goalId, 'teach.practice', {});
  }

  /// Record one practice verdict (`solved` or `missed`).
  Future<bool> answerPractice(
    String goalId,
    String problemId,
    String verdict,
  ) async {
    return _teachingCall(goalId, 'teach.practice.result', {
      'problemId': problemId,
      'verdict': verdict,
    });
  }

  /// The shared body of every `teach.*` write: busy flag, ticket, one refusal.
  Future<bool> _teachingCall(
    String goalId,
    String method,
    Map<String, dynamic> extra,
  ) async {
    final id = goalId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    notifyListeners();
    try {
      final json = await _connection.call(method, {'goalId': id, ...extra});
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Answer the open step's check (`teach.check`).
  ///
  /// A `correct` verdict passes the step and clears it in the core's record, so
  /// the next [teachNextStep] moves on; anything else keeps the step open for a
  /// repair.
  Future<bool> checkTeaching(
    String goalId,
    String answer, {
    String thinking = '',
    int? confidence,
  }) async {
    final id = goalId.trim();
    if (id.isEmpty || answer.trim().isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingLoading = true;
    teachingError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachCheck, {
        'goalId': id,
        'answer': answer,
        if (thinking.trim().isNotEmpty) 'thinking': thinking.trim(),
        'confidence': ?confidence,
      });
      if (ticket != _teachingTicket) return false;
      teaching = TeachingState.fromJson(
        Map<String, dynamic>.from(json['record'] as Map),
      );
      teachingVerdict = TeachingCheckResult.fromJson(json);
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingLoading = false;
        notifyListeners();
      }
    }
  }

  /// Read one step's side thread (`teach.side.snapshot`).
  ///
  /// Read-only. A missing thread is `[]`, not an error.
  Future<void> openTeachingSide(String goalId, String stepId) async {
    final id = goalId.trim();
    if (id.isEmpty || stepId.isEmpty) return;
    final ticket = ++_teachingTicket;
    teachingSideLoading = true;
    teachingSideError = null;
    // A different step's thread must not flash while this one loads.
    teachingSide = const [];
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachSideSnapshot, {
        'goalId': id,
        'stepId': stepId,
      });
      if (ticket != _teachingTicket) return;
      teachingSide = _sideMessages(json['messages']);
    } catch (failure) {
      if (ticket != _teachingTicket) return;
      teachingSideError = _messageOf(failure);
    } finally {
      if (ticket == _teachingTicket) {
        teachingSideLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask one side question (`teach.side.send`).
  ///
  /// One model call, no retry. The exchange is written by the core only after a
  /// reply exists, so a failure leaves the thread unchanged.
  Future<bool> askTeachingSide(
    String goalId,
    String stepId,
    String text,
  ) async {
    final id = goalId.trim();
    final question = text.trim();
    if (id.isEmpty || stepId.isEmpty || question.isEmpty) return false;
    final ticket = ++_teachingTicket;
    teachingSideLoading = true;
    teachingSideError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachSideSend, {
        'goalId': id,
        'stepId': stepId,
        'text': question,
      });
      if (ticket != _teachingTicket) return false;
      teachingSide = _sideMessages(json['messages']);
      return true;
    } catch (failure) {
      if (ticket != _teachingTicket) return false;
      teachingSideError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _teachingTicket) {
        teachingSideLoading = false;
        notifyListeners();
      }
    }
  }

  /// Clear one step's side thread (`teach.side.clear`).
  Future<void> clearTeachingSide(String goalId, String stepId) async {
    final id = goalId.trim();
    if (id.isEmpty || stepId.isEmpty) return;
    final ticket = ++_teachingTicket;
    teachingSideLoading = true;
    teachingSideError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.teachSideClear, {
        'goalId': id,
        'stepId': stepId,
      });
      if (ticket != _teachingTicket) return;
      teachingSide = _sideMessages(json['messages']);
    } catch (failure) {
      if (ticket != _teachingTicket) return;
      teachingSideError = _messageOf(failure);
    } finally {
      if (ticket == _teachingTicket) {
        teachingSideLoading = false;
        notifyListeners();
      }
    }
  }

  static List<TeachingSideMessage> _sideMessages(Object? value) => value is List
      ? value
            .whereType<Map>()
            .map(
              (row) =>
                  TeachingSideMessage.fromJson(Map<String, dynamic>.from(row)),
            )
            .where((message) => message.text.isNotEmpty)
            .toList(growable: false)
      : const [];

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

  /// Read the Stats summary for [range] and [scope], or for the selection the
  /// user last made when either is omitted. Throws on failure.
  Future<void> refreshStats({String? range, String? scope}) async {
    statsRange = range ?? statsRange;
    statsScope = scope ?? statsScope;
    final ticket = ++_statsTicket;
    final json = await _connection.call(CoreMethod.statsSummary, {
      'range': statsRange,
      'scope': statsScope,
    });
    // A slower reply for an earlier selection must not replace a newer one.
    if (ticket != _statsTicket) return;
    stats = StatsSummary.fromJson(json);
    notifyListeners();
  }

  /// Read the achievement inventory (`achievements.list`).
  ///
  /// This is the one read that can write: the core records the UTC day of each
  /// newly unlocked achievement in its **data directory** (never the
  /// workspace). The shell only renders the answer; it never infers an unlock,
  /// invents a date or writes a file. Dev builds unlock the whole catalogue on
  /// purpose, so an "all unlocked" list is the core's honest answer, not a bug.
  ///
  /// A failed read keeps the previous rows and records its reason in
  /// [achievementsError], so a broken refresh never blanks the surface.
  Future<void> refreshAchievements() async {
    final ticket = ++_achievementsTicket;
    achievementsLoading = true;
    achievementsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.achievementsList);
      if (ticket != _achievementsTicket) return;
      final raw = json['achievements'];
      achievements = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      AchievementRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      achievementsEarned = _countOf(json['earned']);
      achievementsTotal = _countOf(json['total']);
      final warning = json['warning'];
      achievementsWarning = warning is String && warning.trim().isNotEmpty
          ? warning
          : null;
    } catch (failure) {
      if (ticket != _achievementsTicket) return;
      achievementsError = _messageOf(failure);
    } finally {
      if (ticket == _achievementsTicket) {
        achievementsLoading = false;
        notifyListeners();
      }
    }
  }

  /// The last `settings.get` failure, or null.
  ///
  /// Per-surface, like the chat and lesson errors: the Settings page used to
  /// render the single global `error`, so a Chill provider failure replaced the
  /// whole page with "Settings could not load" — and its Retry could not clear
  /// a slot it did not own.
  String? settingsError;

  /// Read the configuration. A failure is recorded once in [settingsError] and
  /// the previous snapshot stays; a success clears it, so the page's Retry
  /// works.
  Future<void> refreshSettings() async {
    try {
      final json = await _connection.call(CoreMethod.settingsGet);
      settings = SettingsView.fromJson(json);
      settingsError = null;
      notifyListeners();
    } catch (failure) {
      settingsError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the running version and repository (`update.info`).
  ///
  /// Cheap and offline; quiet on failure, because a build with no update
  /// surface still runs.
  Future<void> refreshUpdateInfo() async {
    try {
      final json = await _connection.call(CoreMethod.updateInfo);
      appVersion = json['current'] is String ? json['current'] as String : null;
      updateRepo = json['repo'] is String ? json['repo'] as String : null;
      notifyListeners();
    } catch (_) {
      // A missing update surface is not a session error.
    }
  }

  /// Ask the release feed for a newer build (`update.check`).
  ///
  /// One explicit request, no retry, no automatic download. The previous result
  /// stays visible until the new one arrives or the check fails.
  Future<void> checkForUpdates() async {
    if (updateChecking) return;
    updateChecking = true;
    updateError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.updateCheck);
      updateState = UpdateView.fromJson(json);
      appVersion ??= updateState?.current;
    } catch (failure) {
      updateError = _messageOf(failure);
    } finally {
      updateChecking = false;
      notifyListeners();
    }
  }

  /// Read the two stored keybind tables (`keybinds.get`).
  ///
  /// This is a startup projection alongside the workspace and settings, but it
  /// is deliberately quiet: a build (or a fake) with no keybind storage still
  /// runs, and the shell's defaults apply. The maps are only ever replaced by a
  /// core answer, so the shell cannot store a binding it invented.
  Future<void> refreshKeybinds() async {
    try {
      final json = await _connection.call(CoreMethod.keybindsGet);
      final maps = KeybindMaps.fromJson(json);
      keybinds = maps.keybinds;
      fixedKeybinds = maps.fixedKeybinds;
      notifyListeners();
    } catch (_) {
      // No keybind storage in this build: keep the defaults the shell already
      // renders rather than failing the whole boot.
    }
  }

  /// Read the custom palette overrides (`theme.custom.get`).
  ///
  /// A quiet projection like [refreshKeybinds]: a build (or a fake) with no
  /// palette storage still runs, and the shell's crimson defaults apply. A
  /// failed read keeps the previous tokens rather than falling back to "no
  /// custom palette", so a transient error cannot repaint the app.
  Future<void> refreshCustomTheme() async {
    try {
      final json = await _connection.call(CoreMethod.themeCustomGet);
      customThemeTokens = ThemeTokens.fromJson(json['tokens']);
      notifyListeners();
    } catch (_) {
      // Keep the tokens the shell already had.
    }
  }

  /// Replace the custom palette overrides (`theme.custom.set`).
  ///
  /// The map is a replacement: a token absent from [tokens] is cleared, and an
  /// empty map clears the palette. The core validates names and `#RRGGBB`; the
  /// reply is the stored map, so the shell replaces its snapshot from this one
  /// message. A refusal throws its [RpcException] unchanged and leaves the
  /// previous tokens in place, so the editor can show the core's own sentence.
  Future<ThemeTokens> setCustomTheme(Map<String, String> tokens) async {
    final json = await _connection.call(CoreMethod.themeCustomSet, {
      'tokens': <String, dynamic>{...tokens},
    });
    customThemeTokens = ThemeTokens.fromJson(json['tokens']);
    notifyListeners();
    return customThemeTokens;
  }

  /// Write one binding (`keybinds.set`) and replace both tables with the core's
  /// answer.
  ///
  /// [binding] is the documented string form; `null` clears the override back to
  /// the shell's default (the core stores a cleared entry, and the registry
  /// reads it as "use the default"). [fixed] selects `ui.fixed_keybinds` for the
  /// mode and navigation keys.
  ///
  /// The reply is the whole stored pair, so the shell replaces its snapshot from
  /// this one message instead of patching what it asked for. A refusal — a
  /// duplicate, an unknown form — rethrows the [RpcException] untouched, leaves
  /// both maps exactly as they were and writes nothing; the Settings editor
  /// shows the core's own sentence inline and keeps the old binding.
  Future<void> setKeybind(
    String action,
    String? binding, {
    bool fixed = false,
  }) async {
    final id = action.trim();
    if (id.isEmpty) {
      throw ArgumentError.value(action, 'action', 'must not be blank');
    }
    final text = binding?.trim();
    final json = await _connection.call(CoreMethod.keybindsSet, {
      'action': id,
      // Omitted means "clear": the core documents `null` and an absent
      // `binding` as the same request, and an explicit empty string as a
      // malformed one.
      'binding': ?text,
      'fixed': fixed,
    });
    final maps = KeybindMaps.fromJson(json);
    keybinds = maps.keybinds;
    fixedKeybinds = maps.fixedKeybinds;
    notifyListeners();
  }

  /// Fetch the provider catalogue. Called when Settings opens, not at startup:
  /// reading keychain presence should not delay the first frame.
  Future<List<ProviderRow>> refreshProviders() async {
    try {
      final json = await _connection.call(CoreMethod.providerList);
      final raw = json['providers'];
      providers = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) => ProviderRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      _providersError = null;
      notifyListeners();
    } catch (failure) {
      _providersError = _messageOf(failure);
      notifyListeners();
    }
    return providers;
  }

  /// Read the configured MCP servers and the stored policy matrix.
  ///
  /// Called when Settings opens, never from [refreshAll]: the list itself starts
  /// no process, but the page is the only surface that needs it. A failure is
  /// recorded once in [mcpError] and the previous rows stay: a broken read never
  /// invents an empty list.
  Future<void> refreshMcp() async {
    try {
      final json = await _connection.call(CoreMethod.mcpList);
      mcpServers = _mcpRows(json);
      mcpPolicy = PluginPolicy.fromJson(json['policy']);
      mcpError = null;
      notifyListeners();
    } catch (failure) {
      mcpError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Write one cell of the MCP policy matrix (`mcp.policy.set`).
  ///
  /// The core validates the command, server and value, refuses `on` for
  /// `flashcards` and `study-guide`, and writes configuration only: this never
  /// starts, refreshes or calls a plugin server. On success the whole stored
  /// matrix is replaced with the core's answer; a refusal throws its
  /// [RpcException] unchanged so the settings page can keep it inline beside
  /// the row and let the user retry.
  Future<void> setMcpPolicy(String command, String server, String value) async {
    final json = await _connection.call(CoreMethod.mcpPolicySet, {
      'command': command,
      'server': server,
      'value': value,
    });
    mcpPolicy = PluginPolicy.fromJson(json['policy']);
    notifyListeners();
  }

  /// Read the decision layer's stored view (`decision.get`).
  ///
  /// This is a read: it writes no configuration, calls no model and starts no
  /// local runtime. The layer is off by default and rules-only in this build, so
  /// the answer says so and the Settings group never invents a local-model
  /// control. Loading is the shell's call when Settings opens (not [refreshAll]),
  /// because the page is the only surface that shows it.
  ///
  /// A failure is recorded once in [decisionError] and the previous [decision]
  /// stays, so a broken read shows the core's own message with a retry instead of
  /// a blank or a fabricated view. The method never throws.
  Future<void> refreshDecision() async {
    // Ticketed like every other read: Settings fires this on each entry, so two
    // opens could let an older reply land after a newer one and clear the flag
    // while the newer request was still running.
    final ticket = ++_decisionTicket;
    decisionLoading = true;
    decisionError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.decisionGet);
      if (ticket != _decisionTicket) return;
      decision = DecisionView.fromJson(json);
    } catch (failure) {
      if (ticket != _decisionTicket) return;
      decisionError = _messageOf(failure);
    } finally {
      if (ticket == _decisionTicket) {
        decisionLoading = false;
        notifyListeners();
      }
    }
  }

  /// Write the decision layer's stored values (`decision.set`).
  ///
  /// [enabled] toggles the optional layer; [model] is only ever empty in this
  /// build, because no local model runtime is bundled and the core refuses a
  /// non-empty name. The reply is the whole view after the write — the same
  /// shape `decision.get` returns — so the shell replaces [decision] from this
  /// one message instead of flipping a flag locally.
  ///
  /// A refusal rethrows the [RpcException] untouched and leaves [decision]
  /// exactly as it was; the Settings row shows the core's own sentence inline and
  /// keeps the old state. Nothing is retried here.
  Future<void> setDecision({bool? enabled, String? model}) async {
    final json = await _connection.call(CoreMethod.decisionSet, {
      'enabled': ?enabled,
      'model': ?model,
    });
    decision = DecisionView.fromJson(json);
    decisionError = null;
    notifyListeners();
  }

  /// Read the global Work opt-in (`work.permissions.get`).
  ///
  /// Both flags default to `false` in the core, so a workspace that never opened
  /// Settings → Work refuses every approval even with a write-capable profile.
  /// Loading is the shell's call when Settings opens (not [refreshAll]), because
  /// the page and the approvals view are the only surfaces that show it.
  ///
  /// A failure is recorded once in [workPermissionsError] and the previous view
  /// stays, so a broken read shows the core's own message with a retry rather
  /// than a fabricated "allowed". The method never throws.
  Future<void> refreshWorkPermissions() async {
    final ticket = ++_workPermissionsTicket;
    workPermissionsLoading = true;
    workPermissionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workPermissionsGet);
      if (ticket != _workPermissionsTicket) return;
      workPermissions = WorkPermissions.fromJson(json);
    } catch (failure) {
      if (ticket != _workPermissionsTicket) return;
      workPermissionsError = _messageOf(failure);
    } finally {
      if (ticket == _workPermissionsTicket) {
        workPermissionsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Write the global Work opt-in (`work.permissions.set`).
  ///
  /// The reply is the whole view after the write, read back from `config.toml`,
  /// so the shell replaces [workPermissions] from this one message instead of
  /// flipping a flag locally. A refusal rethrows the [RpcException] untouched and
  /// leaves the previous view exactly as it was; the settings row shows the
  /// core's own sentence inline and keeps the old state. Nothing is retried here.
  ///
  /// Enabling a flag does not approve anything: the next decision still needs the
  /// per-action approval and the agent profile's own permission.
  Future<void> setWorkPermissions({
    bool? allowWrite,
    bool? allowCommand,
  }) async {
    final json = await _connection.call(CoreMethod.workPermissionsSet, {
      'allowWrite': ?allowWrite,
      'allowCommand': ?allowCommand,
    });
    workPermissions = WorkPermissions.fromJson(json);
    workPermissionsError = null;
    notifyListeners();
  }

  /// Answer one plugin write permission prompt (`mcp.confirm`).
  ///
  /// [allow] `true` runs that one tool call; `false` declines it and reports a
  /// typed tool result to the model, which is a normal result rather than a
  /// failed turn. The pending request is cleared only on success, so a refused
  /// answer keeps the prompt on screen with [pluginPermissionError] set to the
  /// core's own sentence. The [RpcException] is rethrown untouched for the modal
  /// to show inline; it is never retried here.
  Future<void> confirmPermission(String requestId, bool allow) async {
    final id = requestId.trim();
    if (id.isEmpty) {
      throw ArgumentError.value(requestId, 'requestId', 'must not be blank');
    }
    final index = _permissionQueue.indexWhere(
      (entry) => entry.$1.requestId == id,
    );
    // The same window the expiry timer uses: with the two out of step, a prompt
    // could be marked expired on screen and still send an `mcp.confirm`.
    final window = permissionTimeout;
    if (index >= 0 && _now().difference(_permissionQueue[index].$2) >= window) {
      // The core stopped waiting and denied this call. `mcp.confirm` would
      // answer `{ok: true}` for an id it no longer knows, and an Allow would
      // then look as if it had run the tool. Say what actually happened.
      final expired = _permissionQueue.removeAt(index).$1;
      pluginPermissionError = null;
      error =
          'the ${expired.server} · ${expired.tool} prompt expired after '
          '${window.inSeconds} s; the core denied it and nothing ran';
      notifyListeners();
      return;
    }
    try {
      await _connection.call(CoreMethod.mcpConfirm, {
        'requestId': id,
        'allow': allow,
      });
    } catch (failure) {
      pluginPermissionError = _messageOf(failure);
      notifyListeners();
      rethrow;
    }
    _permissionTimers.remove(id)?.cancel();
    _expiredPermissions.remove(id);
    _permissionQueue.removeWhere((entry) => entry.$1.requestId == id);
    pluginPermissionError = null;
    notifyListeners();
  }

  /// Reconnect the configured MCP servers (`mcp.refresh`).
  ///
  /// This is the only call that may spawn a stdio server, so it is explicit: the
  /// settings page's `r` key. Rows are replaced; the policy matrix is not part of
  /// the answer and stays as it was. A failure keeps the previous rows and
  /// records the reason in [mcpError].
  Future<void> refreshMcpServers() async {
    try {
      final json = await _connection.call(CoreMethod.mcpRefresh);
      mcpServers = _mcpRows(json);
      mcpError = null;
      notifyListeners();
    } catch (failure) {
      mcpError = _messageOf(failure);
      notifyListeners();
    }
  }

  static List<McpServerView> _mcpRows(Map<String, dynamic> json) {
    final raw = json['servers'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((row) => McpServerView.fromJson(Map<String, dynamic>.from(row)))
        .toList();
  }

  /// Read the Review queue (`review.queue`) for one side of the wall.
  ///
  /// The core reports what the workspace already records — unchecked steps,
  /// missed cards, unfinished skill stages and session memory — and the shell
  /// renders that snapshot. [side] is `all`, `school` or `skills`; an omitted or
  /// blank value keeps [reviewSide].
  ///
  /// Failure is recorded once in [reviewError] and the previous [review] stays
  /// on screen, so a broken read never invents an empty queue. The method never
  /// throws. An answer for a side the user has already left is dropped.
  Future<void> refreshReview({String? side}) async {
    final requested = side?.trim() ?? '';
    final target = requested.isEmpty ? reviewSide : requested;
    final ticket = ++_reviewTicket;
    reviewLoading = true;
    reviewError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.reviewQueue, {
        'side': target,
      });
      if (ticket != _reviewTicket) return;
      review = ReviewQueue.fromJson(json['queue']);
      reviewSide = target;
    } catch (failure) {
      if (ticket != _reviewTicket) return;
      reviewError = _messageOf(failure);
    } finally {
      if (ticket == _reviewTicket) {
        reviewLoading = false;
        notifyListeners();
      }
    }
  }

  /// Project the queue to another side of the wall and refetch it.
  Future<void> selectReviewSide(String side) => refreshReview(side: side);

  /// Record one Review verdict (`review.mark`) and replace the queue with the
  /// answer.
  ///
  /// [itemId] is the exact id from the current queue and [result] is `known` or
  /// `missed`. The core writes the workspace and returns the whole queue after
  /// the mark, so the shell replaces its snapshot instead of patching a count.
  /// [reviewMarkingId] is set while the request is in flight.
  ///
  /// The method **throws** on failure, leaving [review] untouched: the Review
  /// page shows the core's own message inline beside the rows, which is a page
  /// state rather than a failed read.
  Future<void> markReview(String itemId, String result) async {
    final id = itemId.trim();
    if (id.isEmpty) {
      throw ArgumentError.value(itemId, 'itemId', 'must not be blank');
    }
    if (result != 'known' && result != 'missed') {
      throw ArgumentError.value(result, 'result', 'must be known or missed');
    }
    _markingIds.add(id);
    final write = ++_reviewWriteTicket;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.reviewMark, {
        'itemId': id,
        'result': result,
      });
      // The reply carries this mark's queue. With two marks in flight the older
      // answer can arrive last and would repaint rows from before the newer
      // mark, so only the most recently issued write may replace the queue.
      if (write != _reviewWriteTicket) return;
      // A queue read that started before the mark would repaint the pre-mark
      // rows over this answer; it is abandoned, and its loading flag with it.
      _reviewTicket += 1;
      reviewLoading = false;
      if (reviewSide == 'all') {
        review = ReviewQueue.fromJson(json['queue']);
      } else {
        // `review.mark` answers with every side's queue. Under a `school` or
        // `skills` chip that would list the other side's items, so the
        // projection the user picked is read again instead.
        await refreshReview();
      }
    } finally {
      _markingIds.remove(id);
      notifyListeners();
    }
  }

  /// Read the archive picker (`archive.list`).
  ///
  /// This is the read half of the archive only: the core reports what is already
  /// archived on both sides of the wall and the shell never restores, deletes,
  /// exports or writes. Rows come from the configured backend, so the local
  /// `archive-index/*.json` files are a cache and never the truth.
  ///
  /// A failure is recorded once in [archiveError] and the previous [archiveRows]
  /// stay on screen; the method never throws, so the page shows the core's own
  /// message with a Retry instead of an empty archive.
  Future<void> refreshArchive() async {
    final ticket = ++_archiveTicket;
    archiveLoading = true;
    archiveError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.archiveList);
      if (ticket != _archiveTicket) return;
      final raw = json['rows'];
      archiveRows = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) => ArchiveRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
    } catch (failure) {
      if (ticket != _archiveTicket) return;
      archiveError = _messageOf(failure);
    } finally {
      if (ticket == _archiveTicket) {
        archiveLoading = false;
        notifyListeners();
      }
    }
  }

  /// Search the unified Knowledge index (`knowledge.search`).
  ///
  /// [query] is the text the user typed; an empty or whitespace-only query
  /// **clears** the visible hits and returns to the tree without a request, so
  /// clearing the box never costs a round trip. [scope] is `all`, `school`,
  /// `skills` or `work`; an omitted or blank value keeps [knowledgeScope].
  ///
  /// A stale answer is dropped: every request takes a ticket and only the
  /// newest one may replace [knowledgeHits]. A failure is recorded once in
  /// [knowledgeError] and the previous hits stay on screen; the method never
  /// throws, so the page shows the core's own message with a Retry.
  Future<void> searchKnowledge(String query, {String? scope}) async {
    final text = query.trim();
    final requested = scope?.trim() ?? '';
    final target = requested.isEmpty ? knowledgeScope : requested;
    final ticket = ++_knowledgeTicket;
    // `knowledgeQuery` is what the visible hits answer, so it is assigned with
    // them below, not here: a failed search used to relabel the previous rows.
    knowledgeScope = target;
    knowledgeError = null;
    if (text.isEmpty) {
      // An empty query is the tree: no request, no loading state, no error. The
      // result set is gone with it, so the reader has no ordering left to walk —
      // and the query goes too, because `selectKnowledgeScope` reads it to decide
      // between a search and a tree reload.
      knowledgeQuery = '';
      knowledgeHits = const [];
      knowledgeHitOrder = const [];
      knowledgeHitIndex = null;
      _knowledgeSearching = false;
      _syncKnowledgeLoading();
      notifyListeners();
      return;
    }
    _knowledgeSearching = true;
    _syncKnowledgeLoading();
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.knowledgeSearch, {
        'query': text,
        'scope': target,
      });
      if (ticket != _knowledgeTicket) return;
      knowledgeQuery = text;
      final raw = json['hits'];
      knowledgeHits = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      KnowledgeHit.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      // One ordering per reply: the reader walks these ids, so a new result set
      // replaces the list a document opened from the previous one used.
      knowledgeHitOrder = [for (final hit in knowledgeHits) hit.id];
      final at = knowledgeHitOrder.indexOf(knowledgeDocumentId ?? '');
      knowledgeHitIndex = at >= 0 ? at : null;
    } catch (failure) {
      if (ticket != _knowledgeTicket) return;
      knowledgeError = _messageOf(failure);
    } finally {
      if (ticket == _knowledgeTicket) {
        _knowledgeSearching = false;
        _syncKnowledgeLoading();
        notifyListeners();
      }
    }
  }

  /// Read the Knowledge topic tree (`knowledge.tree`).
  ///
  /// [scope] is `all`, `school`, `skills` or `work`; an omitted or blank value
  /// keeps [knowledgeScope]. The tree only covers the two vaults, so a `work`
  /// scope is kept in [knowledgeScope] and the tree is read with `all`: the
  /// page says work items appear in search instead of showing an empty tree.
  /// The core knows the tree; the shell only groups and renders it. A failure is
  /// recorded once in [knowledgeError] and the previous [knowledgeGroups] stay
  /// on screen, so the page never claims an empty vault because one read failed.
  Future<void> loadKnowledgeTree({String? scope}) async {
    final requested = scope?.trim() ?? '';
    final target = requested.isEmpty ? knowledgeScope : requested;
    final ticket = ++_knowledgeTreeTicket;
    knowledgeScope = target;
    _knowledgeTreeLoading = true;
    _syncKnowledgeLoading();
    knowledgeError = null;
    notifyListeners();
    try {
      final side = target == 'work' ? 'all' : target;
      final json = await _connection.call(CoreMethod.knowledgeTree, {
        'side': side,
      });
      if (ticket != _knowledgeTreeTicket) return;
      final raw = json['groups'];
      knowledgeGroups = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (group) =>
                      KnowledgeGroup.fromJson(Map<String, dynamic>.from(group)),
                )
                .toList()
          : const [];
    } catch (failure) {
      if (ticket != _knowledgeTreeTicket) return;
      knowledgeError = _messageOf(failure);
    } finally {
      if (ticket == _knowledgeTreeTicket) {
        _knowledgeTreeLoading = false;
        _syncKnowledgeLoading();
        notifyListeners();
      }
    }
  }

  /// Read one Knowledge item's body (`knowledge.read`).
  ///
  /// [id] is a hit id (`note:…`, `memory:…`, `source:…`, `project:…`) or the
  /// `note:<workspace path>` id a tree row maps to — never a filesystem path the
  /// shell may open. The core resolves it, confines the read to the workspace and
  /// returns the row plus its body.
  ///
  /// The reader opens while the call is in flight and stays open on failure so
  /// one message with a Retry is visible; a success replaces [knowledgeDocument]
  /// with the core's own text. A stale answer for an item the user already left
  /// is dropped, and this method never throws.
  Future<void> readKnowledge(String id) async {
    final target = id.trim();
    if (target.isEmpty) return;
    final ticket = ++_knowledgeReadTicket;
    knowledgeDocumentId = target;
    // Only a search result set has an ordering to walk; a tree note (a bare
    // workspace path) is not a member of one, so it reports no position.
    final at = knowledgeHitOrder.indexOf(target);
    knowledgeHitIndex = at >= 0 ? at : null;
    knowledgeDocumentLoading = true;
    knowledgeDocumentError = null;
    knowledgeDocument = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.knowledgeRead, {
        'id': target,
      });
      if (ticket != _knowledgeReadTicket) return;
      knowledgeDocument = KnowledgeDocument.fromJson(json);
    } catch (failure) {
      if (ticket != _knowledgeReadTicket) return;
      knowledgeDocumentError = _messageOf(failure);
    } finally {
      if (ticket == _knowledgeReadTicket) {
        knowledgeDocumentLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the Knowledge item that last failed.
  Future<void> retryKnowledgeDocument() async {
    final id = knowledgeDocumentId;
    if (id == null || knowledgeDocumentLoading) return;
    await readKnowledge(id);
  }

  /// Open the hit at [index] in [knowledgeHitOrder].
  ///
  /// The reader's `[`/`]` call this instead of re-running the search, so moving
  /// between hits never returns to the list. The index is clamped by the caller
  /// (the reader shows `first hit`/`last hit`), and an out-of-range index is a
  /// no-op here rather than a request for a hit that does not exist.
  Future<void> openKnowledgeHit(int index) async {
    if (index < 0 || index >= knowledgeHitOrder.length) return;
    await readKnowledge(knowledgeHitOrder[index]);
  }

  /// Change the Knowledge projection and re-run what the surface is showing.
  ///
  /// A query re-runs `knowledge.search` with the new scope; with no query the
  /// tree is reloaded, which sends `all` for a `work` scope because the tree
  /// only covers the two vaults. [knowledgeScope] stays the scope the user
  /// picked, so a surface switch keeps it and the page can explain the tree.
  /// An unknown scope keeps the current one rather than being forwarded.
  Future<void> selectKnowledgeScope(String scope) async {
    final target = scope.trim();
    if (!knowledgeScopeValues.contains(target)) return;
    knowledgeScope = target;
    final query = knowledgeQuery.trim();
    if (query.isEmpty) {
      await loadKnowledgeTree(scope: target);
    } else {
      await searchKnowledge(query, scope: target);
    }
  }

  /// Collapse the Knowledge reader back to the surface.
  ///
  /// The tree, hits and the page's own selection stay exactly as they were, so
  /// closing is one `Esc` and reopening is one `Enter`.
  void closeKnowledgeDocument() {
    if (!knowledgeDocumentOpen && knowledgeDocumentId == null) return;
    _clearKnowledgeDocument();
    notifyListeners();
  }

  void _clearKnowledgeDocument() {
    knowledgeDocument = null;
    knowledgeDocumentLoading = false;
    knowledgeDocumentError = null;
    knowledgeDocumentId = null;
    knowledgeHitIndex = null;
    _knowledgeReadTicket += 1;
  }

  /// Restore one archived item into the live workspace (`archive.restore`).
  ///
  /// The destination is configuration, never a parameter: the core moves the
  /// archived copy back through the same service the TUI uses. The folder
  /// backend restores **both** sides of the wall — a school row is a session,
  /// a skills row is a goal — so [side] decides which live list is re-read
  /// afterwards.
  ///
  /// On success the item is live again, so the archive list and that side's list
  /// are re-read: the archive no longer lists it and `session.list` (school) or
  /// `skill.list` (skills) reports it. A refusal rethrows the [RpcException]
  /// untouched, exactly like [archiveSession], so the page shows the core's own
  /// message inline and no row moves. A failed re-read after a confirmed move
  /// goes to [error] (like [removeSession]) so a successful restore is never
  /// dressed up as a failed action.
  Future<void> restoreArchive({
    required String id,
    required String side,
  }) async {
    await _connection.call(CoreMethod.archiveRestore, {'id': id, 'side': side});
    await refreshArchive();
    try {
      if (side.trim() == 'skills') {
        await refreshSkills();
      } else {
        await refreshSessions();
      }
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Delete one **archived** item (`archive.remove`).
  ///
  /// This removes the archive copy only: the live session or goal is owned by
  /// `session.remove`/the goal manager and is never touched by this path. The
  /// shell has already asked for a named confirmation; this executes the
  /// confirmed delete.
  ///
  /// On success the archive list is re-read and the matching live list is
  /// refreshed (school → [refreshSessions], skills → [refreshSkills]), so a
  /// deleted row disappears without inventing or removing a live item. A
  /// refusal rethrows the [RpcException] untouched for the page's inline
  /// message, and no row moves.
  Future<void> removeArchive({required String id, required String side}) async {
    await _connection.call(CoreMethod.archiveRemove, {'id': id, 'side': side});
    await refreshArchive();
    try {
      if (side.trim() == 'skills') {
        await refreshSkills();
      } else {
        await refreshSessions();
      }
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// One authenticated validation. A failure throws so the dialog can show the
  /// exact reason and stay open; nothing is saved on failure.
  Future<ProviderLink> linkProvider({
    required String providerId,
    required String key,
    String? baseUrl,
  }) async {
    final json = await _connection.call(CoreMethod.providerLink, {
      'providerId': providerId,
      'key': key,
      if (baseUrl != null && baseUrl.trim().isNotEmpty)
        'baseUrl': baseUrl.trim(),
    });
    final link = ProviderLink.fromJson(json);
    await refreshProviders();
    return link;
  }

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

  Future<void> refreshChat() async {
    try {
      final json = await _connection.call(CoreMethod.chatSnapshot);
      if (_acceptChatSnapshot(_chillChatKey, json['seq'])) {
        chat = ChatSnapshot.fromJson(json);
        chatError = null;
      }
      notifyListeners();
    } catch (failure) {
      // Every other read keeps the previous value on failure; this one used to
      // set `chat = null`, so a transient `chat.snapshot` failure after a model
      // change erased the conversation on screen and reported nothing.
      chatError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Send one Chill turn (`chat.send`).
  ///
  /// [images] are absolute paths the **user picked**, at most four. The core
  /// derives each media type from its extension and reads the bytes at send
  /// time; the shell never opens the file, and nothing is persisted — the
  /// transcript stays text only. The key is omitted when there is no image, so
  /// a text-only turn is byte-identical to the old request.
  /// The last `chat.send` refusal, shown in the Chill banner. Per-surface: a
  /// refused Chill send never appears on another page.
  String? chatSendError;

  /// The last `chat.snapshot` failure, or null. The previous [chat] stays, so a
  /// failed re-read never blanks a transcript the user is reading.
  String? chatError;

  Future<bool> sendChat(String text, {List<String> images = const []}) async {
    try {
      await _connection.call(CoreMethod.chatSend, {
        'text': text,
        if (images.isNotEmpty) 'images': images,
      });
      chatSendError = null;
      notifyListeners();
      return true;
    } catch (failure) {
      // Per-surface, not the global error: the chat shows it in its banner and
      // keeps the composer text, and no other page is told about it.
      chatSendError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  Future<void> cancelChat() async {
    try {
      await _connection.call(CoreMethod.chatCancel);
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Open a lock-in session and load its transcript.
  ///
  /// Failure is reported once through [error], never thrown: the caller (a
  /// session list, the shell) shows the banner and keeps the user where they
  /// are. Nothing is mutated until `session.open` succeeds, so a missing or
  /// broken session leaves the previous [activeSession] in place. A failed
  /// `session.chat.snapshot` still opens the session: the detail is usable and
  /// the cached transcript (if any) stays on screen.
  Future<void> openSession(String id) async {
    final ticket = ++_sessionOpenTicket;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.sessionOpen, {'id': id});
    } catch (failure) {
      if (ticket != _sessionOpenTicket) return;
      error = _messageOf(failure);
      notifyListeners();
      return;
    }
    // The user closed the detail or opened another session while this one was
    // being read: its reply must not reopen or replace what they chose.
    if (ticket != _sessionOpenTicket) return;

    final raw = json['session'];
    final detail = SessionDetail.fromJson(
      raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
    );
    final sessionId = detail.id.isEmpty ? id : detail.id;
    activeSession = detail;
    activeSessionId = sessionId;
    error = null;
    // A page-local generation failure belongs to the session it happened in.
    stepsError = null;
    _clearDocument();
    _clearInstructions();
    _clearOutput();
    _clearCoverage();
    _clearMistakes();
    _sessionChatErrors.remove(sessionId);

    try {
      final snapshot = await _connection.call(CoreMethod.sessionChatSnapshot, {
        'id': sessionId,
      });
      // The transcript is keyed by session, so it is kept whichever session
      // is open now.
      if (_acceptChatSnapshot('session:$sessionId', snapshot['seq'])) {
        _sessionChats[sessionId] = ChatSnapshot.fromJson(snapshot);
      }
    } catch (failure) {
      if (ticket == _sessionOpenTicket) error = _messageOf(failure);
    }
    if (ticket != _sessionOpenTicket) return;
    // The instruction text is the settings pane's read: a failure is page-local
    // and never stops the detail from opening.
    await loadSessionInstructions(sessionId);
    // Source coverage is a read of the session that just opened. A failure is
    // page-local in [coverageError]: the detail still renders and the card
    // offers a retry.
    await readCoverage(sessionId);
    // The mistake ledger is page-local too: a failure leaves the detail usable
    // and the card shows one message with a retry.
    await loadMistakes(sessionId);
    notifyListeners();
  }

  /// Read one session's source coverage (`session.coverage`).
  ///
  /// [sessionId] is a session folder name, never a path. The report is derived
  /// from the session's own copied sources and its steps, chat, outputs and
  /// memory, so this is a read: it writes nothing, calls no model and contacts no
  /// network. An empty source list is a valid empty report, not an error.
  ///
  /// A failure is recorded once in [coverageError] and the previous [coverage]
  /// stays, so the card shows the core's own message with a retry instead of an
  /// invented empty report. The method never throws. An answer for a session the
  /// user has already left is dropped by the ticket and id guards.
  Future<void> readCoverage(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_coverageTicket;
    coverageLoading = true;
    coverageError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionCoverage, {
        'id': id,
      });
      if (ticket != _coverageTicket) return;
      if (activeSessionId != null && activeSessionId != id) return;
      coverage = CoverageReport.fromJson(json['coverage']);
    } catch (failure) {
      if (ticket != _coverageTicket) return;
      if (activeSessionId != null && activeSessionId != id) return;
      coverageError = _messageOf(failure);
    } finally {
      if (ticket == _coverageTicket) {
        coverageLoading = false;
        notifyListeners();
      }
    }
  }

  /// Drop the coverage projection and any in-flight answer for it.
  void _clearCoverage() {
    _coverageTicket += 1;
    coverage = null;
    coverageLoading = false;
    coverageError = null;
  }

  /// Drop the mistake ledger and any in-flight answer for it.
  void _clearMistakes() {
    _mistakesTicket += 1;
    mistakes = const [];
    mistakesLoading = false;
    mistakesError = null;
  }

  static List<SessionMistake> _mistakeRows(Object? entries) {
    if (entries is! List) return const [];
    return [
      for (final entry in entries)
        if (entry is Map)
          SessionMistake.fromJson(Map<String, dynamic>.from(entry)),
    ];
  }

  /// Read the open session's misconception ledger (`session.mistake.list`).
  ///
  /// Read-only: it writes nothing, calls no model and contacts no network. A
  /// failure is recorded once in [mistakesError] and the previous rows stay, so
  /// the card shows the core's own message with a retry rather than an invented
  /// empty ledger. An answer for a session the user has already left is dropped.
  Future<void> loadMistakes(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_mistakesTicket;
    mistakesLoading = true;
    mistakesError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionMistakeList, {
        'id': id,
      });
      if (ticket != _mistakesTicket) return;
      if (activeSessionId != null && activeSessionId != id) return;
      mistakes = _mistakeRows(json['entries']);
    } catch (failure) {
      if (ticket != _mistakesTicket) return;
      mistakesError = _messageOf(failure);
    } finally {
      if (ticket == _mistakesTicket) {
        mistakesLoading = false;
        notifyListeners();
      }
    }
  }

  /// Record one mistake (`session.mistake.record`).
  ///
  /// [text] is normalised to one line and bounded by the core; an over-long or
  /// blank entry is a refusal and the inline message is the caller's to show.
  /// Nothing is written when the call fails, and the reply replaces the rows.
  Future<void> recordMistake(
    String sessionId,
    String text, {
    String? step,
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final json = await _connection.call(CoreMethod.sessionMistakeRecord, {
      'id': id,
      'text': text,
      if (step != null && step.trim().isNotEmpty) 'step': step.trim(),
    });
    if (activeSessionId != null && activeSessionId != id) return;
    mistakes = _mistakeRows(json['entries']);
    mistakesError = null;
    notifyListeners();
  }

  /// Write (or replace) a promoted mistake's corrected understanding
  /// (`session.mistake.correct`).
  ///
  /// Promotion is not one-way: a note promoted before the learner knew the
  /// answer can be completed later. The reply is the updated note, and the
  /// ledger is re-read so the row shows `corrected`.
  Future<MistakeNote> correctMistake(
    String sessionId,
    int index,
    String correction,
  ) async {
    final id = sessionId.trim();
    final json = await _connection.call(CoreMethod.sessionMistakeCorrect, {
      'id': id,
      'index': index,
      'correction': correction,
    });
    final note = MistakeNote.fromJson(json['note']);
    await loadMistakes(id);
    return note;
  }

  /// Promote one ledger entry into a labelled school note
  /// (`session.mistake.promote`).
  ///
  /// [correction] is the learner's own right answer; when it is omitted the
  /// note stays `status: open` and says the correction is not written yet.
  /// Promoting an entry twice returns the existing note with [MistakePromotion.already]
  /// set, so a double click cannot create a duplicate. The ledger is re-read
  /// afterwards, because the promotion marks the entry.
  Future<MistakePromotion> promoteMistake(
    String sessionId,
    int index, {
    String? correction,
    String? title,
  }) async {
    final id = sessionId.trim();
    final json = await _connection.call(CoreMethod.sessionMistakePromote, {
      'id': id,
      'index': index,
      if (correction != null && correction.trim().isNotEmpty)
        'correction': correction.trim(),
      if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
    });
    final promotion = MistakePromotion.fromJson(json);
    await loadMistakes(id);
    return promotion;
  }

  /// Create one lock-in session through `session.create`.
  ///
  /// [name], [prompt], [files] and [instructionsFile] are the wizard's values:
  /// the paths are files the **user picked**, never destinations, and the core
  /// copies them and extracts the instructions file itself. Nothing is written
  /// when the call fails.
  ///
  /// On success the new session is opened (`session.open`, so the shell lands on
  /// its detail) and the result is returned. On failure the [RpcException] is
  /// rethrown untouched, exactly like [linkProvider]: the wizard shows the
  /// core's own message and stays on its Review step, so a create refusal is
  /// never mistaken for a transport failure and never reaches [error].
  Future<SessionCreateResult> createSession({
    required String name,
    String prompt = '',
    List<String> files = const [],
    String? instructionsFile,
    bool steps = true,
    String requestId = '',
  }) async {
    final json = await _connection.call(CoreMethod.sessionCreate, {
      'name': name,
      if (requestId.trim().isNotEmpty) 'requestId': requestId.trim(),
      if (prompt.trim().isNotEmpty) 'prompt': prompt,
      if (files.isNotEmpty) 'files': files,
      if (instructionsFile != null && instructionsFile.trim().isNotEmpty)
        'instructionsFile': instructionsFile,
      'steps': steps,
    });
    final result = SessionCreateResult.fromJson(json);
    await openSession(result.id);
    return result;
  }

  /// Archive one session (`session.archive`), moving its live folder aside.
  ///
  /// The destination is configuration, never a parameter: Settings decides
  /// whether a folder or a GitHub repo receives the session, and the core
  /// refuses with one actionable sentence when no backend is usable. A refusal
  /// rethrows the [RpcException] untouched, so the manager shows the core's own
  /// message inline and no row disappears.
  ///
  /// On success the session is no longer live (`session.list` reports the open
  /// side only), so the row is dropped from [sessions], an open session with the
  /// same id is closed with its cached transcript, and the list is re-read. The
  /// reply is the backend that took the folder (`folder` or `github`), or null
  /// when the core did not name one.
  Future<String?> archiveSession(String id) async {
    final json = await _connection.call(CoreMethod.sessionArchive, {'id': id});
    final backend = json['backend'];
    await _afterSessionGone(id);
    return backend is String && backend.isNotEmpty ? backend : null;
  }

  /// Delete one session's live folder (`session.remove`).
  ///
  /// The shell has already asked; this executes the confirmed delete. Only the
  /// live folder goes: no note, no Work project and no archived copy of the same
  /// id is touched, so an archive still restores later. A refusal rethrows the
  /// [RpcException] for the page's inline message and leaves the row in place.
  Future<void> removeSession(String id) async {
    await _connection.call(CoreMethod.sessionRemove, {'id': id});
    await _afterSessionGone(id);
  }

  /// Export one session as a zip (`session.export`).
  ///
  /// There is no destination parameter: the core writes
  /// `<workspace>/exports/session-<id>.zip` itself and returns that path, so the
  /// shell cannot point an export at a folder the core does not own. The live
  /// session is untouched, so a second export is safe. A refusal rethrows the
  /// [RpcException] for the page's inline message; the reply is the zip path, or
  /// null when the core did not name one.
  Future<String?> exportSession(String id) async {
    final json = await _connection.call(CoreMethod.sessionExport, {'id': id});
    final path = json['path'];
    await _refreshSessionsQuietly();
    return path is String && path.isNotEmpty ? path : null;
  }

  /// Apply one confirmed archive/delete to the shell's projection.
  ///
  /// The core confirmed the folder moved or was deleted, so the row is no longer
  /// live. Dropping it before the re-read keeps the list honest even if the read
  /// fails, and closing the matching open session releases its cached transcript
  /// instead of leaving a detail for a folder that is gone.
  Future<void> _afterSessionGone(String id) async {
    sessions = sessions.where((row) => row.id != id).toList();
    if (activeSessionId == id) {
      activeSession = null;
      activeSessionId = null;
      stepsError = null;
      _clearDocument();
      _clearInstructions();
      _clearOutput();
      _clearCoverage();
      _sessionChats.remove(id);
      _sessionChatErrors.remove(id);
    }
    notifyListeners();
    await _refreshSessionsQuietly();
  }

  /// Re-read the session list after a confirmed action without dressing a failed
  /// read up as a failed action: the core already did the work, so the read
  /// failure goes to [error] and the next refresh (surface entry, `r`) corrects
  /// the rows.
  Future<void> _refreshSessionsQuietly() async {
    try {
      await refreshSessions();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Toggle one assignment step: the steps reader's only write.
  ///
  /// [index] is the task-item ordinal in `assignment-steps.md`; the core
  /// rewrites exactly one bracket character and the progress line and returns
  /// the whole new document. When this is the open session its [activeSession]
  /// steps are replaced with that document and its counts, and listeners are
  /// notified so the reader repaints from the core's answer — never from a
  /// local guess and never from a re-read.
  ///
  /// Failure rethrows the [RpcException] untouched, like [addSources]: a
  /// rejected toggle is a page-local action, so the reader shows one inline
  /// message and keeps the previous markdown instead of raising [error] for the
  /// whole shell.
  Future<StepToggleResult> toggleStep(String sessionId, int index) async {
    final json = await _connection.call(CoreMethod.sessionToggleStep, {
      'id': sessionId,
      'index': index,
    });
    final result = StepToggleResult.fromJson(json);
    final current = activeSession;
    if (current != null && activeSessionId == sessionId) {
      activeSession = SessionDetail(
        id: current.id,
        // Memory is not part of this write; dropping it here hid the card until
        // the session was reopened.
        memory: current.memory,
        name: current.name,
        created: current.created,
        archived: current.archived,
        prompt: current.prompt,
        sources: current.sources,
        steps: SessionSteps(
          done: result.done,
          total: result.total,
          exists: result.markdown.trim().isNotEmpty,
          markdown: result.markdown,
        ),
      );
      notifyListeners();
    }
    return result;
  }

  /// Build or rebuild one session's `assignment-steps.md`.
  ///
  /// `session.generateSteps` is a provider run: the core reads the session's own
  /// sources, asks for a plan, merges checked work by exact step text and writes
  /// the file atomically. The reply is the new document plus `kept`/`lost`; it
  /// carries no counts, so the panel's badge is counted from those bytes (the
  /// same document the core wrote) with the core's markdown still authoritative.
  ///
  /// Only the open session is updated. When [sessionId] is not the
  /// [activeSessionId] the answer is ignored: the store keeps no cached step
  /// rows for a session it is not showing, and opening it later re-reads the
  /// file through `session.open`.
  ///
  /// A failure is recorded once in [stepsError] and the previous steps stay
  /// exactly as they were. The method never throws, so the detail page can show
  /// the message inline with a retry (the same contract as [linkProvider]).
  Future<void> generateSteps(String sessionId) async {
    // One build at a time: it is a paid provider run, and a second request for
    // the same session must never be sent twice. The slot used to be global, so
    // pressing `R` on session B while A was building returned before setting a
    // pending state or an error — the key looked dead. A different session is
    // now told why it cannot start instead of being ignored.
    if (_generatingStepsFor != null) {
      if (_generatingStepsFor == sessionId) return;
      if (activeSessionId == sessionId) {
        stepsError =
            'another session is building its steps; try again when it '
            'finishes';
        notifyListeners();
      }
      return;
    }
    _generatingStepsFor = sessionId;
    stepsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionGenerateSteps, {
        'id': sessionId,
      });
      final result = StepGenerateResult.fromJson(json);
      final current = activeSession;
      if (current != null && activeSessionId == sessionId) {
        final total = _countTaskItems(result.markdown);
        final done = _countCheckedItems(result.markdown);
        activeSession = SessionDetail(
          id: current.id,
          // Memory is not part of this write; dropping it here hid the card until
          // the session was reopened.
          memory: current.memory,
          name: current.name,
          created: current.created,
          archived: current.archived,
          prompt: current.prompt,
          sources: current.sources,
          steps: SessionSteps(
            done: done,
            total: total,
            exists: result.markdown.trim().isNotEmpty,
            markdown: result.markdown,
          ),
        );
      }
    } catch (failure) {
      // The failure is shown on the session it belongs to. If the user has
      // moved on, the reader would print it under the wrong session.
      if (activeSessionId == sessionId) stepsError = _messageOf(failure);
    } finally {
      _generatingStepsFor = null;
      notifyListeners();
    }
  }

  /// Generate one session study document (`session.document`).
  ///
  /// [kind] is exactly `contract` (the assignment's done-when checklist),
  /// `contradictions` (a report of conflicting sources) or `check` (a review of
  /// one learner attempt). [attempt] is only meaningful for `check`; a blank
  /// value is treated as absent.
  ///
  /// This is a provider run, so the store shows a pending state and a second
  /// request while one is in flight is ignored rather than queued. A success
  /// stores the document's own Markdown and file name; a failure is recorded
  /// once in [documentError] and never thrown, so the detail page can show the
  /// core's own sentence with a retry. Neither path adds a source row or a chat
  /// turn: the core writes the file and the shell only renders it.
  Future<void> generateDocument(
    String sessionId,
    String kind, {
    String? attempt,
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty || documentLoading) return;
    final ticket = ++_documentTicket;
    _documentKind = kind;
    _documentAttempt = attempt;
    documentLoading = true;
    documentError = null;
    documentText = null;
    documentName = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionDocument, {
        'id': id,
        'kind': kind,
        if (attempt != null && attempt.trim().isNotEmpty)
          'attempt': attempt.trim(),
      });
      if (ticket != _documentTicket) return;
      final result = SessionDocumentResult.fromJson(json);
      documentText = result.text;
      documentName = result.name;
    } catch (failure) {
      if (ticket != _documentTicket) return;
      documentError = _messageOf(failure);
    } finally {
      if (ticket == _documentTicket) {
        documentLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the document that last failed, with the same kind and
  /// attempt. A no-op when nothing has been requested.
  Future<void> retryDocument() async {
    final sessionId = activeSessionId;
    final kind = _documentKind;
    if (sessionId == null || kind == null) return;
    await generateDocument(sessionId, kind, attempt: _documentAttempt);
  }

  /// Collapse the document reader back to the session detail.
  ///
  /// The session, its steps and its chat stay exactly as they were; only the
  /// generated document on screen is released.
  void closeDocument() {
    if (!documentOpen && _documentKind == null) return;
    _clearDocument();
    notifyListeners();
  }

  /// Drop the reader and any in-flight answer for it.
  void _clearDocument() {
    _documentTicket += 1;
    documentText = null;
    documentName = null;
    documentLoading = false;
    documentError = null;
    _documentKind = null;
    _documentAttempt = null;
  }

  /// Read one already-built output (`session.output.read`).
  ///
  /// [kind] is `study-guide` or `flashcards`; [part] is `answers` for the study
  /// guide's answers document, and null for the kind's primary document (the
  /// guide or the deck). This is the reader's read half: it never generates and
  /// writes nothing.
  ///
  /// A missing file is a **success** with `exists: false`, not an error, so the
  /// reader opens on its build state. A genuine failure is recorded once in
  /// [outputError] and the previous document stays on screen; the method never
  /// throws. An answer for a reader the user has already closed or replaced is
  /// dropped by the ticket guard.
  /// Mark one study-guide section reviewed (`session.output.mark`).
  ///
  /// The core rewrites one bracket and the progress line and returns the whole
  /// document, so the reader replaces what it renders and never re-reads the
  /// file. A refusal leaves the previous document and records one message.
  Future<bool> markGuideSection(String sessionId, int index) async {
    final id = sessionId.trim();
    if (id.isEmpty) return false;
    try {
      final json = await _connection.call(CoreMethod.sessionOutputMark, {
        'id': id,
        'index': index,
      });
      // The mark is written either way. If the reader has since moved to the
      // deck or to another session, its Markdown must not be replaced by the
      // guide's.
      if (activeSessionId != id || outputKind != 'study-guide') return true;
      final markdown = json['markdown'];
      if (markdown is! String) {
        outputError = 'the core did not return the study guide';
        notifyListeners();
        return false;
      }
      outputMarkdown = markdown;
      outputError = null;
      notifyListeners();
      return true;
    } catch (failure) {
      if (activeSessionId != id || outputKind != 'study-guide') return false;
      outputError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  Future<void> readOutput(String sessionId, String kind, {String? part}) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_outputTicket;
    _outputPart = part;
    _outputWasBuild = false;
    outputKind = kind;
    outputLoading = true;
    outputError = null;
    if (part == null) {
      // A fresh primary read starts from the empty state; the answers part is
      // not shown until it is read for this document.
      outputMarkdown = null;
      outputExists = false;
      outputAnswers = null;
      if (kind != 'flashcards') deckSchedule = null;
    }
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionOutputRead, {
        'id': id,
        'kind': kind,
        'part': ?part,
      });
      if (ticket != _outputTicket) return;
      final result = SessionOutputRead.fromJson(json);
      if (part == null) {
        outputMarkdown = result.markdown;
        outputExists = result.exists;
        if (kind == 'flashcards') unawaited(readDeckSchedule(id));
      } else {
        // `exists: false` on the answers part is still the reader's empty state;
        // an empty string lets the view say so without a second flag.
        outputAnswers = result.exists ? result.markdown : '';
      }
    } catch (failure) {
      if (ticket != _outputTicket) return;
      outputError = _messageOf(failure);
    } finally {
      if (ticket == _outputTicket) {
        outputLoading = false;
        notifyListeners();
      }
    }
  }

  /// Build one session output (`session.output.build`).
  ///
  /// This is one model call and is never retried automatically: a rebuild
  /// replaces the generated document, so the view asks for confirmation first.
  /// On success the returned Markdown is the document on screen and the answers
  /// part is reset to "not read yet"; the shell never re-reads or re-parses a
  /// file the core just wrote. A failure is recorded once in [outputError] and
  /// the previous document stays exactly as it was. The method never throws.
  /// Read the open session's figures (`session.figure.list`).
  Future<void> readFigures(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_figureTicket;
    figuresLoading = true;
    figureError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionFigureList, {
        'id': id,
      });
      if (ticket != _figureTicket) return;
      final rows = json['figures'];
      figures = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      SessionFigure.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
    } catch (failure) {
      if (ticket != _figureTicket) return;
      figureError = _messageOf(failure);
    } finally {
      if (ticket == _figureTicket) {
        figuresLoading = false;
        notifyListeners();
      }
    }
  }

  /// Crop one figure from the session's own PDF (`session.figure.extract`).
  Future<bool> extractFigure(
    String sessionId, {
    required int page,
    int? x,
    int? y,
    int? width,
    int? height,
    String caption = '',
    String note = '',
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty || page < 1) return false;
    figureBusy = true;
    figureError = null;
    notifyListeners();
    try {
      await _connection.call(CoreMethod.sessionFigureExtract, {
        'id': id,
        'page': page,
        'x': ?x,
        'y': ?y,
        'width': ?width,
        'height': ?height,
        if (caption.trim().isNotEmpty) 'caption': caption.trim(),
        if (note.trim().isNotEmpty) 'note': note.trim(),
      });
      await readFigures(id);
      return true;
    } catch (failure) {
      figureError = _messageOf(failure);
      return false;
    } finally {
      figureBusy = false;
      notifyListeners();
    }
  }

  /// Load one figure's PNG bytes (`session.figure.read`).
  Future<void> loadFigure(String sessionId, String figureId) async {
    final id = sessionId.trim();
    if (id.isEmpty || figureId.isEmpty) return;
    try {
      final json = await _connection.call(CoreMethod.sessionFigureRead, {
        'id': id,
        'figureId': figureId,
      });
      final base64 = json['base64'];
      if (base64 is String) {
        figureImages[figureId] = base64Decode(base64);
      }
      figureError = null;
    } catch (failure) {
      figureError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Change one figure's caption or note (`session.figure.annotate`).
  Future<void> annotateFigure(
    String sessionId,
    String figureId, {
    String? caption,
    String? note,
  }) async {
    final id = sessionId.trim();
    if (id.isEmpty || figureId.isEmpty) return;
    try {
      await _connection.call(CoreMethod.sessionFigureAnnotate, {
        'id': id,
        'figureId': figureId,
        'caption': ?caption,
        'note': ?note,
      });
      await readFigures(id);
    } catch (failure) {
      figureError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Remove one figure (`session.figure.remove`).
  Future<void> removeFigure(String sessionId, String figureId) async {
    final id = sessionId.trim();
    if (id.isEmpty || figureId.isEmpty) return;
    try {
      await _connection.call(CoreMethod.sessionFigureRemove, {
        'id': id,
        'figureId': figureId,
      });
      figureImages.remove(figureId);
      await readFigures(id);
    } catch (failure) {
      figureError = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the prompt catalogue (`prompts.list`).
  Future<void> refreshPrompts() async {
    try {
      final json = await _connection.call(CoreMethod.promptsList);
      final rows = json['items'];
      prompts = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      PromptNoteView.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      promptsError = null;
    } catch (failure) {
      promptsError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Set or clear one prompt note (`prompts.set`). Empty text clears it.
  Future<void> setPrompt(String id, String text) async {
    try {
      final json = await _connection.call(CoreMethod.promptsSet, {
        'id': id,
        'text': text,
      });
      final rows = json['items'];
      prompts = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      PromptNoteView.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      promptsError = null;
    } catch (failure) {
      promptsError = _messageOf(failure);
    }
    notifyListeners();
  }

  /// Derive the learning graph (`knowledge.graph`).
  ///
  /// Read-only and derived; a broken folder comes back as a diagnostic in the
  /// graph, not as a failed request.
  Future<void> readLearningGraph() async {
    if (learningGraphLoading) return;
    learningGraphLoading = true;
    learningGraphError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.knowledgeGraph);
      final graph = json['graph'];
      learningGraph = graph is Map
          ? LearningGraph.fromJson(Map<String, dynamic>.from(graph))
          : learningGraphEmpty;
    } catch (failure) {
      learningGraphError = _messageOf(failure);
    } finally {
      learningGraphLoading = false;
      notifyListeners();
    }
  }

  /// Read the open goal's saved briefs (`research.list`).
  Future<void> readResearch(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return;
    final ticket = ++_researchTicket;
    researchLoading = true;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.researchList, {
        'goalId': id,
      });
      if (ticket != _researchTicket) return;
      final rows = json['items'];
      research = rows is List
          ? rows
                .whereType<Map>()
                .map(
                  (row) =>
                      ResearchItem.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList(growable: false)
          : const [];
      researchError = null;
    } catch (failure) {
      if (ticket != _researchTicket) return;
      researchError = _messageOf(failure);
    } finally {
      if (ticket == _researchTicket) {
        researchLoading = false;
        notifyListeners();
      }
    }
  }

  /// Start one background brief (`research.start`).
  ///
  /// The reply is only an acknowledgement; `research.updated` carries the
  /// result. A refusal is shown in the card and nothing is left running.
  Future<bool> startResearch(
    String goalId,
    String question,
    List<String> urls,
  ) async {
    final id = goalId.trim();
    final text = question.trim();
    if (id.isEmpty || text.isEmpty || urls.isEmpty) return false;
    researchRunning = true;
    researchError = null;
    notifyListeners();
    try {
      await _connection.call(CoreMethod.researchStart, {
        'goalId': id,
        'question': text,
        'urls': urls,
      });
      return true;
    } catch (failure) {
      researchRunning = false;
      researchError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Open one saved brief (`research.read`).
  Future<void> openResearch(String goalId, String researchId) async {
    final id = goalId.trim();
    if (id.isEmpty || researchId.isEmpty) return;
    try {
      final json = await _connection.call(CoreMethod.researchRead, {
        'goalId': id,
        'id': researchId,
      });
      researchMarkdown = json['markdown'] is String
          ? json['markdown'] as String
          : '';
      researchOpenId = researchId;
      researchError = null;
    } catch (failure) {
      researchError = _messageOf(failure);
    }
    notifyListeners();
  }

  void closeResearch() {
    researchMarkdown = null;
    researchOpenId = null;
    notifyListeners();
  }

  /// Read one session chat's context meter (`session.chat.context`).
  Future<void> readSessionContext(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_contextTicket;
    sessionContextLoading = true;
    sessionContextError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionChatContext, {
        'id': id,
      });
      if (ticket != _contextTicket) return;
      sessionContext = SessionContextView.fromJson(json);
    } catch (failure) {
      if (ticket != _contextTicket) return;
      sessionContextError = _messageOf(failure);
    } finally {
      if (ticket == _contextTicket) {
        sessionContextLoading = false;
        notifyListeners();
      }
    }
  }

  /// Compact the older part of a session chat (`session.chat.compact`).
  ///
  /// One explicit model call, no retry; the reply is the new meter.
  Future<void> compactSessionChat(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty || sessionContextLoading) return;
    final ticket = ++_contextTicket;
    sessionContextLoading = true;
    sessionContextError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionChatCompact, {
        'id': id,
      });
      if (ticket != _contextTicket) return;
      sessionContext = SessionContextView.fromJson(json);
    } catch (failure) {
      if (ticket != _contextTicket) return;
      sessionContextError = _messageOf(failure);
    } finally {
      if (ticket == _contextTicket) {
        sessionContextLoading = false;
        notifyListeners();
      }
    }
  }

  /// Drop the stored summary (`session.chat.uncompact`).
  Future<void> uncompactSessionChat(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty || sessionContextLoading) return;
    final ticket = ++_contextTicket;
    sessionContextLoading = true;
    sessionContextError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionChatUncompact, {
        'id': id,
      });
      if (ticket != _contextTicket) return;
      sessionContext = SessionContextView.fromJson(json);
    } catch (failure) {
      if (ticket != _contextTicket) return;
      sessionContextError = _messageOf(failure);
    } finally {
      if (ticket == _contextTicket) {
        sessionContextLoading = false;
        notifyListeners();
      }
    }
  }

  /// Read one session's flashcard schedule (`session.deck.state`).
  Future<void> readDeckSchedule(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_deckTicket;
    deckScheduleLoading = true;
    deckScheduleError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionDeckState, {
        'id': id,
      });
      if (ticket != _deckTicket) return;
      deckSchedule = DeckSchedule.fromJson(json);
    } catch (failure) {
      if (ticket != _deckTicket) return;
      deckScheduleError = _messageOf(failure);
    } finally {
      if (ticket == _deckTicket) {
        deckScheduleLoading = false;
        notifyListeners();
      }
    }
  }

  /// Grade one card (`session.deck.grade`).
  ///
  /// One write, atomic. The reply is the whole schedule, so the deck replaces
  /// its view rather than patching a card locally.
  Future<void> gradeDeckCard(String sessionId, int index, String grade) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_deckTicket;
    deckScheduleLoading = true;
    deckScheduleError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionDeckGrade, {
        'id': id,
        'index': index,
        'grade': grade,
      });
      if (ticket != _deckTicket) return;
      deckSchedule = DeckSchedule.fromJson(json);
    } catch (failure) {
      if (ticket != _deckTicket) return;
      deckScheduleError = _messageOf(failure);
    } finally {
      if (ticket == _deckTicket) {
        deckScheduleLoading = false;
        notifyListeners();
      }
    }
  }

  Future<void> buildOutput(String sessionId, String kind) async {
    final id = sessionId.trim();
    if (id.isEmpty || outputLoading) return;
    final ticket = ++_outputTicket;
    _outputPart = null;
    _outputWasBuild = true;
    outputKind = kind;
    outputLoading = true;
    outputError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionOutputBuild, {
        'id': id,
        'kind': kind,
      });
      if (ticket != _outputTicket) return;
      final result = SessionOutputResult.fromJson(json);
      outputKind = kind;
      outputMarkdown = result.markdown;
      outputAnswers = null;
      outputExists = true;
    } catch (failure) {
      if (ticket != _outputTicket) return;
      outputError = _messageOf(failure);
    } finally {
      if (ticket == _outputTicket) {
        outputLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the output request that last failed, with the same kind and
  /// part (or the same build). A no-op when no reader is open.
  Future<void> retryOutput() async {
    final sessionId = activeSessionId;
    final kind = outputKind;
    if (sessionId == null || kind == null) return;
    if (_outputWasBuild) {
      await buildOutput(sessionId, kind);
      return;
    }
    await readOutput(sessionId, kind, part: _outputPart);
  }

  /// Collapse the output reader back to the session detail.
  ///
  /// The session, its steps and its chat stay exactly as they were; only the
  /// generated output on screen is released.
  void closeOutput() {
    if (outputKind == null && !outputLoading && outputError == null) return;
    _clearOutput();
    notifyListeners();
  }

  /// Drop the output reader and any in-flight answer for it.
  void _clearOutput() {
    _outputTicket += 1;
    outputKind = null;
    outputMarkdown = null;
    outputAnswers = null;
    outputExists = false;
    outputLoading = false;
    outputError = null;
    _outputPart = null;
    _outputWasBuild = false;
  }

  /// Read the open session's instructions (`session.instructions.get`).
  ///
  /// [sessionId] is a session folder name, never a path. This is a read: it
  /// writes nothing, and an empty `prompt.md` is a valid answer. A failure is
  /// recorded once in [instructionsError] and [sessionInstructions] is left
  /// alone, so the pane can show the last text with a retry instead of a blank
  /// form. The method never throws.
  Future<void> loadSessionInstructions(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return;
    final ticket = ++_instructionsLoadTicket;
    // The write generation when the read began: a save, an import or a close
    // that lands first is newer than this read's answer.
    final generation = _instructionsTicket;
    bool stale() =>
        ticket != _instructionsLoadTicket || generation != _instructionsTicket;
    instructionsLoading = true;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionInstructionsGet, {
        'id': id,
      });
      if (stale()) return;
      sessionInstructions = SessionInstructions.fromJson(json);
    } catch (failure) {
      if (stale()) return;
      instructionsError = _messageOf(failure);
    } finally {
      if (ticket == _instructionsLoadTicket) {
        instructionsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Replace the open session's `prompt.md` (`session.instructions.save`).
  ///
  /// [text] is written verbatim: an empty string is allowed and clears the
  /// prompt. On success the local prompt and [SessionDetail.prompt] follow the
  /// core's answer, so the detail and the settings pane cannot disagree. A
  /// failure is recorded once in [instructionsError], leaves the previous prompt
  /// in place, and returns false; the method never throws.
  Future<bool> saveSessionInstructions(String sessionId, String text) async {
    final id = sessionId.trim();
    if (id.isEmpty) return false;
    final ticket = ++_instructionsTicket;
    instructionsLoading = false;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.sessionInstructionsSave, {
        'id': id,
        'text': text,
      });
      if (ticket != _instructionsTicket) return false;
      final prompt = json['prompt'] is String ? json['prompt'] as String : text;
      _applyInstructions(id, prompt: prompt);
      notifyListeners();
      return true;
    } catch (failure) {
      if (ticket != _instructionsTicket) return false;
      instructionsError = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Load a user-picked file as the instructions
  /// (`session.instructions.import`).
  ///
  /// [file] is the original the user chose, never a destination: the core copies
  /// it into this session's `sources/`, extracts its text into `prompt.md` and
  /// records the provenance in one transaction. [added] is false when the same
  /// bytes were already a source. A failure is recorded once in
  /// [instructionsError], leaves the previous prompt and provenance, and returns
  /// null; the method never throws.
  Future<InstructionsImportResult?> importSessionInstructions(
    String sessionId,
    String file,
  ) async {
    final id = sessionId.trim();
    final path = file.trim();
    if (id.isEmpty || path.isEmpty) return null;
    final ticket = ++_instructionsTicket;
    instructionsLoading = false;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(
        CoreMethod.sessionInstructionsImport,
        {'id': id, 'file': path},
      );
      if (ticket != _instructionsTicket) return null;
      final result = InstructionsImportResult.fromJson(json);
      _applyInstructions(
        id,
        prompt: result.prompt,
        source: result.instructions,
      );
      notifyListeners();
      return result;
    } catch (failure) {
      if (ticket != _instructionsTicket) return null;
      instructionsError = _messageOf(failure);
      notifyListeners();
      return null;
    }
  }

  /// Re-extract the copied instruction file into `prompt.md`
  /// (`session.instructions.reextract`).
  ///
  /// The copied original inside the session is the source of truth, so a later
  /// edit to the user's original cannot change the session; manual prompt edits
  /// are discarded. A failure — including a text-only session with no
  /// instruction file — is recorded once in [instructionsError] and returns
  /// false; the method never throws.
  Future<String?> reextractSessionInstructions(String sessionId) async {
    final id = sessionId.trim();
    if (id.isEmpty) return null;
    final ticket = ++_instructionsTicket;
    instructionsLoading = false;
    instructionsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(
        CoreMethod.sessionInstructionsReextract,
        {'id': id},
      );
      if (ticket != _instructionsTicket) return null;
      final prompt = json['prompt'] is String
          ? json['prompt'] as String
          : sessionInstructions?.prompt ?? '';
      final raw = json['instructions'];
      final source = raw is Map
          ? InstructionsSource.fromJson(Map<String, dynamic>.from(raw))
          : null;
      _applyInstructions(id, prompt: prompt, source: source);
      notifyListeners();
      return prompt;
    } catch (failure) {
      if (ticket != _instructionsTicket) return null;
      instructionsError = _messageOf(failure);
      notifyListeners();
      return null;
    }
  }

  /// Project a successful instruction write onto the open session only.
  ///
  /// A write for a session that is no longer open changes nothing here: the
  /// store keeps no instruction projection for a session it is not showing, and
  /// opening it later reads `prompt.md` again.
  void _applyInstructions(
    String sessionId, {
    required String prompt,
    InstructionsSource? source,
  }) {
    if (activeSessionId != sessionId) return;
    final current = activeSession;
    if (current != null) {
      activeSession = SessionDetail(
        id: current.id,
        // Memory is not part of this write; dropping it here hid the card until
        // the session was reopened.
        memory: current.memory,
        name: current.name,
        created: current.created,
        archived: current.archived,
        prompt: prompt,
        sources: current.sources,
        steps: current.steps,
      );
    }
    sessionInstructions = SessionInstructions(
      prompt: prompt,
      instructionsSource: source ?? sessionInstructions?.instructionsSource,
    );
    instructionsError = null;
  }

  /// Drop the instruction projection and any in-flight answer for it.
  void _clearInstructions() {
    _instructionsTicket += 1;
    sessionInstructions = null;
    instructionsLoading = false;
    instructionsError = null;
  }

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

  /// Copy user-picked files into one session and refresh its source rows.
  ///
  /// [paths] are files the user chose; the core copies them into the session,
  /// de-duplicates by hash and refuses anything from the skills side. The shell
  /// never reads, moves or writes a file.
  ///
  /// Failure rethrows the [RpcException] and leaves [activeSession] untouched,
  /// so the page can show the exact reason inline (the same pattern as
  /// [linkProvider]). A page-local copy failure is not a transport failure, so
  /// it does not raise [error]. Only the re-read after a successful copy is
  /// recorded in [error]: the files are already attached at that point.
  Future<SourceAddResult> addSources(
    String sessionId,
    List<String> paths,
  ) async {
    final json = await _connection.call(CoreMethod.sourceAdd, {
      'sessionId': sessionId,
      'paths': paths,
    });
    final result = SourceAddResult.fromJson(json);
    if (error != null) {
      error = null;
      notifyListeners();
    }
    try {
      await refreshSources(sessionId);
    } catch (failure) {
      // The copy succeeded; only the re-read failed. Keep the result usable and
      // let the shell surface that the list may be stale.
      error = _messageOf(failure);
      notifyListeners();
    }
    return result;
  }

  /// Re-read one session's `sources/` rows from `source.list`.
  ///
  /// When [sessionId] is the open session, [activeSession] is replaced with the
  /// same detail and the new rows. The chat snapshot is left alone: adding a
  /// source must not reload a transcript.
  Future<List<SessionSource>> refreshSources(String sessionId) async {
    final json = await _connection.call(CoreMethod.sourceList, {
      'sessionId': sessionId,
    });
    final raw = json['sources'];
    final rows = raw is List
        ? raw
              .whereType<Map>()
              .map(
                (row) => SessionSource.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList()
        : const <SessionSource>[];
    final current = activeSession;
    if (current != null && activeSessionId == sessionId) {
      activeSession = SessionDetail(
        id: current.id,
        // Memory is not part of this write; dropping it here hid the card until
        // the session was reopened.
        memory: current.memory,
        name: current.name,
        created: current.created,
        archived: current.archived,
        prompt: current.prompt,
        sources: rows,
        steps: current.steps,
      );
      notifyListeners();
    }
    return rows;
  }

  /// Send one turn to a session's chat. Never touches the Chill transcript.
  ///
  /// Like [openSession], a failure is recorded in [error] rather than thrown:
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

  /// Re-read the registered Work projects.
  ///
  /// Failure is recorded once in [error] and the previous [projects] list stays
  /// on screen: a broken read never invents an empty list, so the page can say
  /// "the list could not be refreshed" instead of "no projects yet".
  Future<void> refreshProjects() async {
    try {
      final json = await _connection.call(CoreMethod.workList);
      projects = _projectRows(json);
      projectsLoaded = true;
      error = null;
      notifyListeners();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the agent templates a picker can offer (`work.templates.list`).
  ///
  /// [projectId] is the open project, so the built-ins and that project's own
  /// templates are read together; a null or blank id reads the built-ins only.
  /// The call is a read: the core opens `work/templates/` for reading and writes
  /// nothing, so this is safe to repeat.
  ///
  /// Returns the rows it read, and keeps the previous list when the read fails:
  /// a broken read is recorded once in [workTemplatesError], never turned into
  /// "no templates". A failure is not thrown, because the picker shows the
  /// sentence beside the rows it already has.
  Future<List<AgentTemplateRow>> refreshWorkTemplates(String? projectId) async {
    final id = projectId?.trim() ?? '';
    // The flags are set without an early notify: a caller can start this from
    // build-adjacent code (the agent dialog's `didChangeDependencies`), where
    // notifying would mark the scope dirty mid-build. The finish below is the
    // one notification, and it carries both the rows and the cleared flag.
    final ticket = ++_workTemplatesTicket;
    workTemplatesLoading = true;
    workTemplatesError = null;
    try {
      final json = await _connection.call(CoreMethod.workTemplatesList, {
        if (id.isNotEmpty) 'projectId': id,
      });
      // The reply names templates for THIS project. Without the ticket a slow
      // answer for project A could populate project B's picker.
      if (ticket != _workTemplatesTicket) return workTemplates;
      final raw = json['templates'];
      workTemplates = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      AgentTemplateRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      return workTemplates;
    } catch (failure) {
      if (ticket != _workTemplatesTicket) return workTemplates;
      workTemplatesError = _messageOf(failure);
      return workTemplates;
    } finally {
      if (ticket == _workTemplatesTicket) {
        workTemplatesLoading = false;
        notifyListeners();
      }
    }
  }

  /// Open one Work project (`work.open`).
  ///
  /// Failure is reported once through [error], never thrown, and the previous
  /// [activeProject] survives: a project whose metadata cannot be read leaves
  /// the user on the project they already had. Nothing is mutated until the
  /// call succeeds.
  Future<void> openProject(String id) async {
    final ticket = ++_projectOpenTicket;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.workOpen, {'id': id});
    } catch (failure) {
      if (ticket != _projectOpenTicket) return;
      error = _messageOf(failure);
      notifyListeners();
      return;
    }
    // Closed, or another project chosen, while this one was being read.
    if (ticket != _projectOpenTicket) return;

    final raw = json['project'];
    final detail = WorkProjectDetail.fromJson(
      raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
    );
    final projectId = detail.id.isEmpty ? id : detail.id;
    if (activeProjectId != projectId) {
      // A different project: nothing read for the previous one may show under
      // this one's name while its own reads are in flight (or if they fail).
      _projectEpoch += 1;
      activeWorkChatId = null;
      projectChats = const [];
      workChanges = null;
      workChangesLoading = false;
      workChangesError = null;
      _clearApprovals();
      _clearSwarms();
      _clearActivity();
    }
    activeProject = detail;
    activeProjectId = projectId;
    error = null;
    notifyListeners();
    // Each read below is for the project captured above, never for whatever is
    // open when it runs: the user may close this project between two awaits.
    bool current() => ticket == _projectOpenTicket;
    // The chat ids belong to the project that just opened; a failure is kept
    // page-local in [error] and the detail still renders.
    await refreshProjectChats(projectId);
    if (!current()) return;
    // Pending approvals are process memory in the core, so they are read for
    // the project that just opened. A failure is page-local and the card still
    // renders the last rows the shell received.
    await refreshApprovals(projectId);
    if (!current()) return;
    // Swarm runs are process memory too; the detail's SWARM card shows the
    // count and the newest run without waiting for the board to open.
    await refreshSwarms(projectId);
    if (!current()) return;
    // The activity log is metadata about decisions already taken, so the
    // detail's ACTIVITY card can show its count before the log is opened. It is
    // a read: nothing is written and no decision is applied.
    await refreshActivity(project: projectId);
  }

  /// Return from a project detail to the Work list.
  ///
  /// The project's chat list and active chat go with it: they are properties of
  /// the open project, and reopening it reads them again.
  void closeProject() {
    // An open still in flight is abandoned even when nothing is open yet.
    _projectOpenTicket += 1;
    if (activeProject == null && activeProjectId == null) return;
    _projectEpoch += 1;
    activeProject = null;
    activeProjectId = null;
    activeWorkChatId = null;
    projectChats = const [];
    workChanges = null;
    workChangesLoading = false;
    workChangesError = null;
    _clearApprovals();
    _clearSwarms();
    _clearActivity();
    notifyListeners();
  }

  /// Read the open project's chat ids (`work.chat.list`).
  ///
  /// Failure is recorded once in [error] and the previous [projectChats] list
  /// stays: a broken read never invents "this project has no chats".
  Future<void> refreshProjectChats(String projectId) async {
    final epoch = _projectEpoch;
    try {
      final json = await _connection.call(CoreMethod.workChatList, {
        'projectId': projectId,
      });
      // The list belongs to one project: a reply that lands after the project
      // closed or changed would give the next one a chat count it does not have.
      if (epoch != _projectEpoch) return;
      final raw = json['chats'];
      projectChats = raw is List ? raw.whereType<String>().toList() : const [];
      notifyListeners();
    } catch (failure) {
      if (epoch != _projectEpoch) return;
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the open project's read-only Changes summary (`work.changes`).
  ///
  /// The core runs git itself with a fixed argv and `GIT_OPTIONAL_LOCKS=0`, so
  /// this is a read: nothing is staged, committed, checked out or written
  /// inside the project root. An answer with `available: false` is a success
  /// (the folder is gone, is not a repository, or git is not installed) and is
  /// projected as such, so the page prints the core's own sentence instead of
  /// an error.
  ///
  /// A failure is recorded once in [workChangesError] and the previous
  /// [workChanges] stays: a broken read never invents an empty working tree.
  /// The method never throws. An answer for a project that is no longer open is
  /// dropped, so a refresh finishing after [closeProject] cannot resurrect
  /// rows for a closed project.
  Future<void> refreshWorkChanges(String projectId) async {
    final id = projectId.trim();
    if (id.isEmpty) return;
    final epoch = _projectEpoch;
    workChangesLoading = true;
    workChangesError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workChanges, {
        'projectId': id,
      });
      // Dropped when the project closed or changed while git ran: the epoch
      // catches a close (nothing open any more), the id a direct switch.
      if (epoch != _projectEpoch) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      workChanges = ChangeSummary.fromJson(json['changes']);
    } catch (failure) {
      if (epoch != _projectEpoch) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      workChangesError = _messageOf(failure);
    } finally {
      // The flag is the current project's. A stale reply leaves it alone: the
      // close or the switch already reset it.
      if (epoch == _projectEpoch) workChangesLoading = false;
      notifyListeners();
    }
  }

  /// Read the open project's pending approvals (`work.approvals.list`).
  ///
  /// This is the **read-only** half of the approval surface: a proposal lives in
  /// the core's process memory only, so a view asks again after a tab switch and
  /// this method never applies, runs, writes or consumes anything.
  ///
  /// A failure is recorded once in [approvalsError] and the previous rows stay,
  /// so a broken read never invents "nothing is pending". An answer for a
  /// project that is no longer open is dropped, so a refresh finishing after
  /// [closeProject] cannot resurrect its rows.
  Future<void> refreshApprovals(String projectId) async {
    final id = projectId.trim();
    if (id.isEmpty) return;
    final ticket = ++_approvalsTicket;
    approvalsLoading = true;
    approvalsError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workApprovalsList, {
        'projectId': id,
      });
      if (ticket != _approvalsTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      final approvals = WorkApprovals.fromJson(json, projectId: id);
      pendingWrites = approvals.writes;
      pendingCommands = approvals.commands;
    } catch (failure) {
      if (ticket != _approvalsTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      approvalsError = _messageOf(failure);
    } finally {
      if (ticket == _approvalsTicket) {
        approvalsLoading = false;
        notifyListeners();
      }
    }
  }

  /// Approve or reject one pending write (`work.write.decide`).
  ///
  /// [hunks] is only meaningful for `approve`: an omitted value means "all", and
  /// the page refuses an empty selection before calling. A rejection writes
  /// nothing. On success the row is dropped from [pendingWrites] immediately
  /// (the core emits `work.approval.resolved` too) and the open project's
  /// working tree is re-read, so the Changes card reports the write the user
  /// just approved. A refusal rethrows the [RpcException] untouched for the
  /// page's inline message, and the row stays because nothing changed.
  Future<void> decideWrite(
    String id,
    String decision, {
    List<int>? hunks,
  }) async {
    final proposalId = id.trim();
    if (proposalId.isEmpty) return;
    await _connection.call(CoreMethod.workWriteDecide, {
      'id': proposalId,
      'decision': decision,
      'hunks': ?hunks,
    });
    _dropWrite(proposalId);
    notifyListeners();
    final projectId = activeProjectId;
    if (projectId != null) await refreshWorkChanges(projectId);
  }

  /// Approve or deny one pending command (`work.command.decide`).
  ///
  /// A denial starts nothing. On success the row is dropped from
  /// [pendingCommands] and the open project's working tree is re-read, because a
  /// command may have changed files. A refusal rethrows for the page's inline
  /// message and the row stays.
  Future<void> decideCommand(String id, String decision) async {
    final proposalId = id.trim();
    if (proposalId.isEmpty) return;
    // A command may run for two minutes; the user can switch project meanwhile.
    // The outcome belongs to the project that proposed it, so a late answer for
    // a project that is no longer open is dropped rather than painted on the
    // next project's approvals view.
    final owner = activeProjectId;
    final json = await _connection.call(CoreMethod.workCommandDecide, {
      'id': proposalId,
      'decision': decision,
    });
    _dropCommand(proposalId);
    if (owner != null && activeProjectId != owner) {
      notifyListeners();
      return;
    }
    lastCommandOutcome = CommandOutcome.fromJson(json);
    notifyListeners();
    final projectId = activeProjectId;
    if (projectId != null) await refreshWorkChanges(projectId);
  }

  /// The open project's pending approvals, as one value for the page.
  WorkApprovals get workApprovals =>
      WorkApprovals(writes: pendingWrites, commands: pendingCommands);

  /// How many proposals the open project is waiting on.
  int get pendingApprovalCount => pendingWrites.length + pendingCommands.length;

  /// Leave the approval layer. The pending rows belong to the open project, so
  /// this is only the read projection being cleared.
  void closeApprovals() {
    if (pendingWrites.isEmpty &&
        pendingCommands.isEmpty &&
        !approvalsLoading &&
        approvalsError == null) {
      return;
    }
    _clearApprovals();
    notifyListeners();
  }

  /// Dismiss the last command's result (the approvals view's `x`).
  void dismissCommandOutcome() {
    if (lastCommandOutcome == null) return;
    lastCommandOutcome = null;
    notifyListeners();
  }

  void _clearApprovals() {
    _approvalsTicket += 1;
    pendingWrites = const [];
    pendingCommands = const [];
    lastCommandOutcome = null;
    approvalsLoading = false;
    approvalsError = null;
  }

  void _dropWrite(String id) {
    if (!pendingWrites.any((write) => write.id == id)) return;
    pendingWrites = [
      for (final write in pendingWrites)
        if (write.id != id) write,
    ];
  }

  void _dropCommand(String id) {
    if (!pendingCommands.any((command) => command.id == id)) return;
    pendingCommands = [
      for (final command in pendingCommands)
        if (command.id != id) command,
    ];
  }

  /// Open one project chat (`work.chat.open`).
  ///
  /// An omitted [chatId] resumes the newest chat, or starts the project's first
  /// one — the core decides. On success the snapshot is cached under
  /// `<projectId>:<chatId>` and that chat becomes [activeWorkChatId]. Failure is
  /// reported once through [error], never thrown, and the previous chat and its
  /// snapshot survive, so a typo cannot blank a transcript. Returns whether the
  /// chat is open.
  Future<bool> openWorkChat(String projectId, {String? chatId}) async {
    // The project open when the user asked. If it closed or changed before the
    // reply, the transcript is still cached under its own key, but it must not
    // become the active chat of a project it does not belong to.
    final owner = activeProjectId;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.workChatOpen, {
        'projectId': projectId,
        if (chatId != null && chatId.trim().isNotEmpty) 'chatId': chatId.trim(),
      });
    } catch (failure) {
      if (activeProjectId != owner) return false;
      error = _messageOf(failure);
      notifyListeners();
      return false;
    }

    final rawChatId = json['chatId'];
    final resolved = rawChatId is String && rawChatId.isNotEmpty
        ? rawChatId
        : chatId ?? '';
    if (resolved.isEmpty) {
      if (activeProjectId != owner) return false;
      error = 'the core did not name the project chat';
      notifyListeners();
      return false;
    }

    final raw = json['snapshot'];
    final rawSnapshot = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final workKey = _workChatKey(projectId, resolved);
    if (_acceptChatSnapshot('work:$workKey', rawSnapshot['seq'])) {
      _workChats[workKey] = ChatSnapshot.fromJson(rawSnapshot);
    }
    _workChatErrors.remove(_workChatKey(projectId, resolved));
    if (activeProjectId != owner) return false;
    activeWorkChatId = resolved;
    if (!projectChats.contains(resolved)) {
      projectChats = [...projectChats, resolved];
    }
    error = null;
    notifyListeners();
    return true;
  }

  /// Send one turn to a project chat. Never touches Chill or a session chat.
  ///
  /// The transcript grows only from the core's `work.chat.state` events. A
  /// request failure is kept for that one chat in [workChatErrorFor], so a
  /// project chat refusal never looks like a shell-wide transport failure.
  Future<bool> sendWorkChat(
    String projectId,
    String chatId,
    String text,
  ) async {
    final key = _workChatKey(projectId, chatId);
    try {
      await _connection.call(CoreMethod.workChatSend, {
        'projectId': projectId,
        'chatId': chatId,
        'text': text,
      });
      if (_workChatErrors.remove(key) != null) notifyListeners();
      return true;
    } catch (failure) {
      _workChatErrors[key] = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Stop a project chat's in-flight turn. Nothing running is a no-op.
  Future<void> cancelWorkChat(String projectId, String chatId) async {
    try {
      await _connection.call(CoreMethod.workChatCancel, {
        'projectId': projectId,
        'chatId': chatId,
      });
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Collapse from the chat back to the project detail.
  ///
  /// The transcript and the chat id stay in the store, so reopening the chat
  /// paints the previous conversation and does not reset it.
  void closeWorkChat() {
    if (activeWorkChatId == null) return;
    activeWorkChatId = null;
    notifyListeners();
  }

  /// Read the open project's swarm runs (`work.swarm.runs`).
  ///
  /// A board is process state in the core, so this is a read of the runs this
  /// process knows — `[]` is the documented empty answer, not an error. A
  /// failure is recorded once in [swarmError] and the previous [swarmRuns] stays
  /// on screen. An answer for a project that is no longer open is dropped.
  Future<void> refreshSwarms(String projectId) async {
    final id = projectId.trim();
    if (id.isEmpty) return;
    final ticket = ++_swarmTicket;
    swarmLoading = true;
    swarmError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workSwarmRuns, {
        'projectId': id,
      });
      if (ticket != _swarmTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      final raw = json['runs'];
      final runs = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      SwarmBoardView.fromJson(Map<String, dynamic>.from(row)),
                )
                .where((run) => run.runId.isNotEmpty)
                .toList()
          : <SwarmBoardView>[];
      swarmRuns = List.unmodifiable(runs);
      final activeId = activeSwarmId;
      if (activeId != null) {
        var found = false;
        for (final run in runs) {
          if (run.runId == activeId) {
            activeSwarm = run;
            found = true;
            break;
          }
        }
        // A run the new list does not know (a core that forgot its process
        // state, or one removed elsewhere) must not keep the board rendering.
        if (!found) {
          activeSwarm = null;
          activeSwarmId = null;
        }
      }
    } catch (failure) {
      if (ticket != _swarmTicket) return;
      final open = activeProjectId;
      if (open != null && open != id) return;
      swarmError = _messageOf(failure);
    } finally {
      if (ticket == _swarmTicket) {
        swarmLoading = false;
        notifyListeners();
      }
    }
  }

  /// Open one swarm board (`work.swarm.board`). Returns whether it is open.
  ///
  /// Failure is recorded once in [swarmError], never thrown, and the previous
  /// board survives, so a typo cannot blank the page. The method never applies,
  /// runs or cancels anything.
  Future<bool> openSwarm(String projectId, String runId) async {
    final project = projectId.trim();
    final run = runId.trim();
    if (project.isEmpty || run.isEmpty) return false;
    final ticket = ++_swarmBoardTicket;
    swarmLoading = true;
    swarmError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.workSwarmBoard, {
        'projectId': project,
        'runId': run,
      });
      if (ticket != _swarmBoardTicket) return false;
      final open = activeProjectId;
      if (open != null && open != project) return false;
      final board = SwarmBoardView.fromJson(json['board']);
      if (board.runId.isEmpty) {
        swarmError = 'the core did not name the swarm run';
        return false;
      }
      activeSwarm = board;
      activeSwarmId = board.runId;
      _applySwarmBoard(board);
      return true;
    } catch (failure) {
      if (ticket != _swarmBoardTicket) return false;
      final open = activeProjectId;
      if (open != null && open != project) return false;
      swarmError = _messageOf(failure);
      return false;
    } finally {
      if (ticket == _swarmBoardTicket) {
        swarmLoading = false;
        notifyListeners();
      }
    }
  }

  /// Start one swarm run (`work.swarm.run`) and open its board.
  ///
  /// The reply names the run while its workers are still going, so the board is
  /// live here and `work.swarm.updated` carries every later change. A refusal
  /// rethrows the [RpcException] untouched, like [createProject]: the run dialog
  /// shows the core's own sentence and stays open, and no run was started.
  Future<SwarmRunResult> runSwarm(
    String projectId, {
    required String objective,
    required List<SwarmPlanEntry> plan,
    int parallel = 1,
  }) async {
    final json = await _connection.call(CoreMethod.workSwarmRun, {
      'projectId': projectId.trim(),
      'objective': objective.trim(),
      'plan': [for (final entry in plan) entry.toJson()],
      'parallel': parallel,
    });
    final result = SwarmRunResult.fromJson(json);
    if (result.runId.isNotEmpty) {
      activeSwarm = result.board;
      activeSwarmId = result.runId;
      _applySwarmBoard(result.board);
      swarmError = null;
      notifyListeners();
    }
    return result;
  }

  /// Cancel one live run (`work.swarm.cancel`).
  ///
  /// Cooperative: running and pending tasks become `cancelled` and the core
  /// writes the report once the workers settle. A finished run is a no-op that
  /// returns its board. A refusal rethrows for the page's inline message.
  Future<void> cancelSwarm(String projectId, String runId) async {
    final json = await _connection.call(CoreMethod.workSwarmCancel, {
      'projectId': projectId.trim(),
      'runId': runId.trim(),
    });
    final board = SwarmBoardView.fromJson(json['board']);
    if (board.runId.isEmpty) return;
    _applySwarmBoard(board);
    if (activeSwarmId == board.runId) activeSwarm = board;
    notifyListeners();
  }

  /// Drop one run record (`work.swarm.remove`).
  ///
  /// This forgets the **process** record only: the Markdown report stays on
  /// disk, and no file inside the project root is read, written or deleted.
  /// When the removed run was the one on screen, the newest remaining run is
  /// selected, or the page falls back to its empty state.
  Future<void> removeSwarm(String projectId, String runId) async {
    final id = runId.trim();
    await _connection.call(CoreMethod.workSwarmRemove, {
      'projectId': projectId.trim(),
      'runId': id,
    });
    swarmRuns = [
      for (final run in swarmRuns)
        if (run.runId != id) run,
    ];
    if (activeSwarmId == id) {
      activeSwarm = swarmRuns.isEmpty ? null : swarmRuns.last;
      activeSwarmId = activeSwarm?.runId;
    }
    notifyListeners();
  }

  /// Retry one failed or blocked task (`work.swarm.retry`).
  ///
  /// The core starts a **new** single-agent read-only run and returns its id;
  /// `retryOf` on the new board names the original run and task. The original
  /// run, its board and its report are untouched. The new run becomes the open
  /// board, and a refusal rethrows for the page's inline message.
  Future<SwarmRunResult> retrySwarmTask(
    String projectId,
    String runId,
    String taskId,
  ) async {
    final json = await _connection.call(CoreMethod.workSwarmRetry, {
      'projectId': projectId.trim(),
      'runId': runId.trim(),
      'taskId': taskId.trim(),
    });
    final result = SwarmRunResult.fromJson(json);
    if (result.runId.isNotEmpty) {
      activeSwarm = result.board;
      activeSwarmId = result.runId;
      _applySwarmBoard(result.board);
      swarmError = null;
      notifyListeners();
    }
    return result;
  }

  /// Mark one completed swarm task verified (`work.swarm.verify`).
  ///
  /// Verification is a person's decision, not a worker's claim: it only applies
  /// to a `done` task. The core rewrites the run's report and records the
  /// decision in the activity log. A refusal rethrows for the page's message.
  Future<void> verifySwarmTask(
    String projectId,
    String runId,
    String taskId, {
    bool verified = true,
  }) async {
    final json = await _connection.call(CoreMethod.workSwarmVerify, {
      'projectId': projectId.trim(),
      'runId': runId.trim(),
      'taskId': taskId.trim(),
      'verified': verified,
    });
    final raw = json['board'];
    if (raw is Map) {
      final board = SwarmBoardView.fromJson(Map<String, dynamic>.from(raw));
      _applySwarmBoard(board);
      if (activeSwarmId == board.runId) activeSwarm = board;
      swarmError = null;
      notifyListeners();
    }
  }

  /// Replace or append one board in [swarmRuns], keeping the active board live.
  void _applySwarmBoard(SwarmBoardView board) {
    final runs = [...swarmRuns];
    final index = runs.indexWhere((run) => run.runId == board.runId);
    if (index >= 0) {
      runs[index] = board;
    } else {
      runs.add(board);
    }
    swarmRuns = List.unmodifiable(runs);
    if (activeSwarmId == board.runId) activeSwarm = board;
  }

  void _clearSwarms() {
    _swarmTicket += 1;
    _swarmBoardTicket += 1;
    swarmRuns = const [];
    activeSwarm = null;
    activeSwarmId = null;
    swarmLoading = false;
    swarmError = null;
  }

  /// Read the Work activity log (`activity.list`).
  ///
  /// This is a **read-only** metadata view: the log records write and command
  /// decisions and swarm lifecycle events, and never a file body, diff, prompt
  /// or command output. [kind] filters to one kind (`write-decision`,
  /// `command-decision` or `swarm`; null means every kind) and [project] filters
  /// to one project id (null means every project). The core filters, so the
  /// shell cannot re-derive a different answer.
  ///
  /// A changed query clears the visible rows before the request, because rows
  /// for a different project or kind would misreport the filter. A failure of
  /// the *same* query keeps the previous rows and records its reason once in
  /// [activityError]; the next request clears that reason. An answer for a query
  /// the user has left is dropped by the ticket, so a late reply cannot replace
  /// what is on screen.
  Future<void> refreshActivity({String? kind, String? project}) async {
    final filterKind = kind?.trim();
    final filterProject = project?.trim();
    final queryChanged =
        filterKind != activityKind || filterProject != activityProject;
    activityKind = filterKind;
    activityProject = filterProject;
    final ticket = ++_activityTicket;
    if (queryChanged) {
      activityRecords = const [];
      activitySkipped = 0;
      activityEmpty = true;
    }
    activityLoading = true;
    activityError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.activityList, {
        if (filterKind != null && filterKind.isNotEmpty) 'kind': filterKind,
        if (filterProject != null && filterProject.isNotEmpty)
          'project': filterProject,
      });
      if (ticket != _activityTicket) return;
      final result = ActivityListResult.fromJson(json);
      activityRecords = result.records;
      activitySkipped = result.skipped;
      activityEmpty = result.empty;
    } catch (failure) {
      if (ticket != _activityTicket) return;
      activityError = _messageOf(failure);
    } finally {
      if (ticket == _activityTicket) {
        activityLoading = false;
        notifyListeners();
      }
    }
  }

  /// Forget the visible activity log and any read in flight.
  ///
  /// The log itself lives in the core's data directory and is untouched; this
  /// only drops the projection when the project closes.
  void _clearActivity() {
    _activityTicket += 1;
    activityRecords = const [];
    activitySkipped = 0;
    activityEmpty = true;
    activityLoading = false;
    activityError = null;
    activityKind = null;
    activityProject = null;
  }

  /// Re-read the Skills goal rows (`skill.list`).
  ///
  /// Failure is recorded once in [error] and the previous [skills] list stays on
  /// screen: a broken read never invents an empty list, so the page can say the
  /// list could not be refreshed instead of "no goals yet".
  Future<void> refreshSkills() async {
    try {
      final json = await _connection.call(CoreMethod.skillList);
      final raw = json['skills'];
      skills = raw is List
          ? raw
                .whereType<Map>()
                .map((row) => SkillRow.fromJson(Map<String, dynamic>.from(row)))
                .toList()
          : const [];
      skillsLoaded = true;
      // A successful read answers the question a previous failure was about.
      // Without this one refused `skill.open` stayed on screen as the list's
      // error until the app restarted.
      error = null;
      notifyListeners();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Open one goal (`skill.open`).
  ///
  /// Failure is reported once through [error], never thrown, and the previous
  /// [activeSkill] survives: a goal whose `meta.json` cannot be read leaves the
  /// user on the goal they already had. Nothing is mutated until the call
  /// succeeds. A reader open on a previous goal is closed with it.
  Future<void> openSkill(String id) async {
    final ticket = ++_skillOpenTicket;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.skillOpen, {'id': id});
    } catch (failure) {
      if (ticket != _skillOpenTicket) return;
      error = _messageOf(failure);
      notifyListeners();
      return;
    }
    // Closed, or another goal chosen, while this one was being read.
    if (ticket != _skillOpenTicket) return;

    final raw = json['skill'];
    final detail = SkillDetail.fromJson(
      raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
    );
    final goalId = detail.id.isEmpty ? id : detail.id;
    activeSkill = detail;
    activeSkillId = goalId;
    error = null;
    _clearChapter();
    // A staged lesson belongs to the goal that opened it.
    _clearSkillLesson();
    // A chat belongs to the goal that opened it; the new goal starts on its
    // page with no chat selected.
    activeSkillChatId = null;
    skillChats = const [];
    _clearSkillSources();
    research = const [];
    researchOpenId = null;
    researchMarkdown = null;
    researchError = null;
    unawaited(readResearch(goalId));
    notifyListeners();
    // The saved-chat list is a property of the open goal, so it is read here.
    // A failure is recorded in [error] and the page still renders.
    // Both reads are for the goal captured above; the user may close it
    // between the two awaits, and `activeSkillId!` would then throw.
    await refreshSkillChats(goalId);
    if (ticket != _skillOpenTicket) return;
    // The gathered sources are the goal's citable material, so the detail reads
    // them when it opens. A failure is page-local in [skillSourcesError] and
    // never stops the goal page from rendering.
    await refreshSkillSources(goalId);
  }

  /// Create one goal through `skill.create`, then open it.
  ///
  /// [goal] is what the learner wants to learn and [prior] is optional context;
  /// both are the wizard's values. The core owns the id, the goal folder and the
  /// curriculum, and makes **no provider call**: the plan is the built-in
  /// configured model when available, otherwise the built-in template.
  /// charged here.
  ///
  /// On success the goal rows are refreshed (`skill.list`) and the new course is
  /// opened (`skill.open`), so the shell lands on its index. On failure the
  /// [RpcException] is rethrown untouched, like [createSession]: the wizard
  /// shows the core's own message and stays on Review, so a create refusal is
  /// never mistaken for a transport failure and never reaches [error].
  Future<SkillCreateResult> createSkill({
    required String goal,
    String prior = '',
  }) async {
    final json = await _connection.call(CoreMethod.skillCreate, {
      'goal': goal,
      if (prior.trim().isNotEmpty) 'prior': prior.trim(),
    });
    final result = SkillCreateResult.fromJson(json);
    await refreshSkills();
    await openSkill(result.id);
    return result;
  }

  /// Read one chapter body (`skill.chapter`), the lesson or the practical.
  ///
  /// [chapterId] is an id from the open goal's index, never a path. The reader
  /// opens while the call is in flight and stays open on failure so one message
  /// with a retry is visible; a success replaces [activeSkillChapter] with the
  /// core's own Markdown. This method never throws.
  Future<void> openSkillChapter(
    String id,
    String chapterId, {
    bool practical = false,
  }) async {
    final goalId = id.trim();
    final target = chapterId.trim();
    if (goalId.isEmpty || target.isEmpty) return;
    final ticket = ++_skillChapterTicket;
    activeSkillChapterId = target;
    activeSkillChapterPractical = practical;
    skillChapterLoading = true;
    skillChapterError = null;
    activeSkillChapter = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillChapter, {
        'id': goalId,
        'chapterId': target,
        'practical': practical,
      });
      // The reader was closed, or another chapter (or its other half) was
      // asked for, while this body was being read. Whichever reply lands last
      // must not win.
      if (ticket != _skillChapterTicket) return;
      activeSkillChapter = SkillChapterBody.fromJson(json);
    } catch (failure) {
      if (ticket != _skillChapterTicket) return;
      skillChapterError = _messageOf(failure);
    } finally {
      if (ticket == _skillChapterTicket) {
        skillChapterLoading = false;
        notifyListeners();
      }
    }
  }

  /// Ask again for the chapter that last failed, with the same practical flag.
  Future<void> retrySkillChapter() async {
    final goalId = activeSkillId;
    final chapterId = activeSkillChapterId;
    if (goalId == null || chapterId == null) return;
    await openSkillChapter(
      goalId,
      chapterId,
      practical: activeSkillChapterPractical,
    );
  }

  /// Collapse the chapter reader back to the goal page.
  ///
  /// The goal and its index stay open, so reopening a chapter is one key away.
  void closeChapter() {
    if (!skillChapterOpen && activeSkillChapterId == null) return;
    _clearChapter();
    notifyListeners();
  }

  /// Open one curriculum stage's lesson (`skill.lesson.read`).
  ///
  /// [goalId] and [stageId] come from the open goal's `skill.open` index, never
  /// from a path. A stage with no lesson is a **success**: [skillLessonExists]
  /// is false and the reader shows its empty state with a build action. A
  /// failure is recorded once in [skillLessonError] and never thrown, so the
  /// reader stays open with the core's own message and one retry.
  Future<void> openSkillLesson(String goalId, String stageId) async {
    final goal = goalId.trim();
    final stage = stageId.trim();
    if (goal.isEmpty || stage.isEmpty) return;
    final ticket = ++_skillLessonTicket;
    activeSkillStageId = stage;
    _skillLessonRetryBuild = false;
    skillLessonLoading = true;
    skillLessonError = null;
    skillLessonMarkdown = '';
    skillLessonExists = false;
    skillLessonCitations = const [];
    skillLessonStatus = '';
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillLessonRead, {
        'goalId': goal,
        'stageId': stage,
      });
      if (ticket != _skillLessonTicket) return;
      final result = SkillLessonResult.read(json);
      skillLessonMarkdown = result.markdown;
      skillLessonExists = result.exists;
      skillLessonStatus = result.status;
      skillLessonCitations = result.citations;
    } catch (failure) {
      if (ticket != _skillLessonTicket) return;
      skillLessonError = _messageOf(failure);
      skillLessonNeedsConfirm = _isConfirmFailure(failure);
    } finally {
      if (ticket == _skillLessonTicket) {
        skillLessonLoading = false;
        notifyListeners();
      }
    }
  }

  /// Build one stage's lesson (`skill.lesson.build`).
  ///
  /// This is one model call and is never retried automatically. On success the
  /// reader replaces its copy from the reply, so the Markdown on screen and the
  /// file on disk agree. A refusal — including the core's `confirm` shape when
  /// the lesson is already `ready` — is recorded once in [skillLessonError] with
  /// the core's own sentence and the previous lesson stays visible: the shell
  /// asks the user before a second attempt, never the store.
  /// Build one stage's lesson.
  ///
  /// [confirmed] is only true after the user agreed to replace an existing
  /// `ready` lesson; without it the core refuses with `kind: "confirm"` and the
  /// file is untouched.
  Future<void> buildSkillLesson(
    String goalId,
    String stageId, {
    bool includeSolution = false,
    bool confirmed = false,
  }) async {
    final goal = goalId.trim();
    final stage = stageId.trim();
    if (goal.isEmpty || stage.isEmpty) return;
    final ticket = ++_skillLessonTicket;
    activeSkillStageId = stage;
    _skillLessonRetryBuild = true;
    skillLessonLoading = true;
    skillLessonError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillLessonBuild, {
        'goalId': goal,
        'stageId': stage,
        if (includeSolution) 'includeSolution': true,
        if (confirmed) 'confirmed': true,
      });
      if (ticket != _skillLessonTicket) return;
      final result = SkillLessonResult.build(json);
      skillLessonNeedsConfirm = false;
      skillLessonMarkdown = result.markdown;
      skillLessonExists = result.exists;
      skillLessonStatus = result.status;
      skillLessonCitations = result.citations;
    } catch (failure) {
      if (ticket != _skillLessonTicket) return;
      skillLessonError = _messageOf(failure);
      // A `confirm` refusal is a decision, not a failure: the view asks by name
      // instead of offering a Retry that would be refused again.
      skillLessonNeedsConfirm = _isConfirmFailure(failure);
    } finally {
      if (ticket == _skillLessonTicket) {
        skillLessonLoading = false;
        notifyListeners();
      }
    }
  }

  /// Repeat the lesson request that failed: a build after `b`, a read otherwise.
  Future<void> retrySkillLesson() async {
    final goalId = activeSkillId;
    final stageId = activeSkillStageId;
    if (goalId == null || stageId == null) return;
    // A retry is the user repeating a request they have already seen refused.
    // Without `confirmed` a `ready` lesson refuses identically every time, which
    // is what made this button dead.
    if (_skillLessonRetryBuild) {
      await buildSkillLesson(
        goalId,
        stageId,
        confirmed: skillLessonNeedsConfirm,
      );
    } else {
      await openSkillLesson(goalId, stageId);
    }
  }

  /// Collapse the lesson reader back to the goal page.
  ///
  /// The goal and its stage index stay open, so reopening a lesson is one key
  /// away.
  void closeSkillLesson() {
    if (!skillLessonOpen) return;
    _clearSkillLesson();
    notifyListeners();
  }

  void _clearSkillLesson() {
    _skillLessonTicket += 1;
    activeSkillStageId = null;
    skillLessonMarkdown = '';
    skillLessonExists = false;
    skillLessonCitations = const [];
    skillLessonStatus = '';
    skillLessonLoading = false;
    skillLessonError = null;
    skillLessonNeedsConfirm = false;
    _skillLessonRetryBuild = false;
  }

  /// Leave the Skills surface for the goal list.
  ///
  /// The goal, its chapter reader and its chat go with it; reopening the goal
  /// reads its index and chats again. The cached rows in [skills] stay so the
  /// list does not flash.
  void closeSkill() {
    // An open still in flight is abandoned even when nothing is open yet.
    _skillOpenTicket += 1;
    // The clears run before this check: an early return used to leave
    // `skillLessonOpen` set forever once the goal itself was gone (after a
    // reconnect, say), and no later call could close the layer.
    final hadGoal = activeSkill != null || activeSkillId != null;
    _clearSkillLesson();
    _clearSkillSources();
    _clearChapter();
    teaching = null;
    teachingError = null;
    teachingLoading = false;
    teachingVerdict = null;
    _teachingTicket += 1;
    skillChats = const [];
    if (!hadGoal) {
      notifyListeners();
      return;
    }
    activeSkill = null;
    activeSkillId = null;
    activeSkillChatId = null;
    notifyListeners();
  }

  /// Save one goal's whole curriculum, in order (`skill.stages.save`).
  ///
  /// [stages] is the complete list the editor holds: the core assigns an id to
  /// a stage whose [SkillStage.id] is empty, keeps every existing status by id
  /// and stores the order it was given. [confirmed] is only true for removing a
  /// `done` stage, whose finished progress the core refuses to drop otherwise.
  ///
  /// The reply is the stored list, so the open goal's stages are replaced from
  /// it and listeners repaint from the core's answer, never from a local guess.
  /// A refusal rethrows the [RpcException] untouched and leaves [activeSkill]
  /// and the previous order alone, so the page shows the core's own sentence
  /// inline. Nothing is written on the shell's side.
  Future<SkillStageSaveResult> saveSkillStages(
    String goalId,
    List<SkillStage> stages, {
    bool confirmed = false,
  }) async {
    final json = await _connection.call(CoreMethod.skillStagesSave, {
      'goalId': goalId,
      // A new stage must **omit** `id`: the core treats a present id as "this
      // stage already exists" and refuses a blank one, so sending `id: ""`
      // made adding the first stage impossible.
      'stages': [
        for (final stage in stages)
          {
            if (stage.id.isNotEmpty) 'id': stage.id,
            'title': stage.title,
            if (stage.milestone != null && stage.milestone!.isNotEmpty)
              'milestone': stage.milestone,
          },
      ],
      if (confirmed) 'confirmed': true,
    });
    // A reply without `stages` would blank the curriculum, so the request's own
    // order is kept in that case rather than inventing an empty goal.
    final result = json['stages'] is List
        ? SkillStageSaveResult.fromJson(json)
        : SkillStageSaveResult(stages: stages);
    final current = activeSkill;
    if (current != null && activeSkillId == goalId) {
      activeSkill = SkillDetail(
        id: current.id,
        name: current.name,
        goal: current.goal,
        prior: current.prior,
        created: current.created,
        plan: current.plan,
        chapters: current.chapters,
        chats: current.chats,
        stages: result.stages,
      );
      notifyListeners();
    }
    return result;
  }

  /// Archive one goal (`skill.archive`), moving its folder to the configured
  /// archive.
  ///
  /// The destination is configuration, never a parameter, so the core refuses
  /// with one actionable sentence when no backend is usable. A refusal rethrows
  /// the [RpcException] untouched and leaves the row in place. On success the
  /// row is dropped, an open goal with the same id is closed with its chapter,
  /// lesson, source and chat projections, and the list is re-read. The reply is
  /// the backend that took the folder, or null when the core did not name one.
  Future<String?> archiveSkill(String id) async {
    final json = await _connection.call(CoreMethod.skillArchive, {
      'goalId': id,
    });
    final outcome = SkillActionOutcome.fromJson(json);
    await _afterSkillGone(id);
    return outcome.backend;
  }

  /// Delete one goal's folder (`skill.remove`).
  ///
  /// The shell has already asked; this executes the confirmed delete. The goal
  /// folder and its lessons go; no archived copy of the same id is touched, so
  /// an archive still restores later. A refusal rethrows the [RpcException] for
  /// the page's inline message and leaves the row and open goal in place.
  Future<void> removeSkill(String id) async {
    await _connection.call(CoreMethod.skillRemove, {'goalId': id});
    await _afterSkillGone(id);
  }

  /// Export one goal as a zip (`skill.export`).
  ///
  /// There is no destination parameter: the core writes the zip itself and
  /// returns that path, so the shell cannot point an export at a folder the core
  /// does not own. The live goal is untouched, so a second export is safe. A
  /// refusal rethrows the [RpcException] for the page's inline message; the reply
  /// is the zip path, or null when the core did not name one. The list is
  /// re-read so any change the core made is visible.
  Future<String?> exportSkill(String id) async {
    final json = await _connection.call(CoreMethod.skillExport, {'goalId': id});
    final outcome = SkillActionOutcome.fromJson(json);
    await refreshSkills();
    return outcome.path;
  }

  /// Apply one confirmed archive/delete to the shell's projection.
  ///
  /// The core confirmed the folder moved or was deleted, so the row is no longer
  /// live. Dropping it before the re-read keeps the list honest even if the read
  /// fails, and closing the matching open goal releases the chapter, lesson,
  /// source and chat projections instead of leaving a detail for a folder that
  /// is gone.
  Future<void> _afterSkillGone(String id) async {
    skills = skills.where((row) => row.id != id).toList();
    if (activeSkillId == id || activeSkill?.id == id) closeSkill();
    notifyListeners();
    await refreshSkills();
  }

  /// Read the open goal's saved chats (`skill.chat.list`).
  ///
  /// Failure is recorded once in [error] and the previous [skillChats] list
  /// stays: a broken read never invents "this goal has no chats".
  Future<void> refreshSkillChats(String goalId) async {
    try {
      final json = await _connection.call(CoreMethod.skillChatList, {
        'goalId': goalId,
      });
      if (activeSkillId != null && activeSkillId != goalId) return;
      final raw = json['chats'];
      skillChats = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      SkillChatRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
      notifyListeners();
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Read the open goal's gathered sources (`skill.sources.list`).
  ///
  /// [goalId] is a goal folder name, never a path. The rows are copies inside
  /// that goal's `sources/`, so this is the only material a goal chat may cite;
  /// the shell renders them read-only and never joins [SkillSourceRow.storedPath]
  /// against a path of its own.
  ///
  /// A failure is recorded once in [skillSourcesError] and the previous rows
  /// stay: a broken read never invents "this goal has no sources". The method
  /// never throws, so the page shows the core's own message with a Retry. An
  /// answer for a goal the user has already left is dropped, and a newer request
  /// supersedes an older one.
  Future<void> refreshSkillSources(String goalId) async {
    final id = goalId.trim();
    if (id.isEmpty) return;
    final ticket = ++_skillSourcesTicket;
    skillSourcesLoading = true;
    skillSourcesError = null;
    notifyListeners();
    try {
      final json = await _connection.call(CoreMethod.skillSourcesList, {
        'goalId': id,
      });
      if (ticket != _skillSourcesTicket) return;
      if (activeSkillId != null && activeSkillId != id) return;
      final raw = json['sources'];
      skillSources = raw is List
          ? raw
                .whereType<Map>()
                .map(
                  (row) =>
                      SkillSourceRow.fromJson(Map<String, dynamic>.from(row)),
                )
                .toList()
          : const [];
    } catch (failure) {
      if (ticket != _skillSourcesTicket) return;
      if (activeSkillId != null && activeSkillId != id) return;
      skillSourcesError = _messageOf(failure);
    } finally {
      if (ticket == _skillSourcesTicket) {
        skillSourcesLoading = false;
        notifyListeners();
      }
    }
  }

  /// Gather user-picked files into one goal (`skill.sources.add`).
  ///
  /// [paths] are files the **user picked**, never destinations: the core copies
  /// each into the goal's `sources/`, extracts its text, saves an excerpt and
  /// records it in `meta.json` in one service call, so the shell cannot name a
  /// write target. Identical bytes are stored once, so a repeat add counts in
  /// [SourceAddResult.skipped] and adds no row. The originals are never moved or
  /// deleted.
  ///
  /// Failure rethrows the [RpcException] untouched and leaves [skillSources]
  /// alone, so the page shows the core's own sentence inline (the same pattern
  /// as [addSources]). On success the list is re-read, so a copy is never
  /// reported as added while the rows still lack it.
  Future<SourceAddResult> addSkillSources(
    String goalId,
    List<String> paths,
  ) async {
    final json = await _connection.call(CoreMethod.skillSourcesAdd, {
      'goalId': goalId,
      'files': paths,
    });
    final result = SourceAddResult.fromJson(json);
    // The add succeeded, so an older list failure no longer describes the state.
    skillSourcesError = null;
    await refreshSkillSources(goalId);
    return result;
  }

  /// Drop the goal-source projection and any in-flight answer for it.
  void _clearSkillSources() {
    _skillSourcesTicket += 1;
    skillSources = const [];
    skillSourcesLoading = false;
    skillSourcesError = null;
  }

  /// Open one goal chat (`skill.chat.open`).
  ///
  /// An omitted [chatId] resumes the newest chat, or starts the goal's first one
  /// — the core decides. On success the snapshot is cached under
  /// `<goalId>:<chatId>` and that chat becomes [activeSkillChatId]. Failure is
  /// reported once through [error], never thrown, and the previous chat and its
  /// snapshot survive, so a refusal cannot blank a transcript. Returns whether
  /// the chat is open.
  Future<bool> openSkillChat(String goalId, {String? chatId}) async {
    // See [openWorkChat]: a reply for a goal that is no longer the open one is
    // cached, never activated.
    final owner = activeSkillId;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.skillChatOpen, {
        'goalId': goalId,
        if (chatId != null && chatId.trim().isNotEmpty) 'chatId': chatId.trim(),
      });
    } catch (failure) {
      if (activeSkillId != owner) return false;
      error = _messageOf(failure);
      notifyListeners();
      return false;
    }

    final rawChatId = json['chatId'];
    final resolved = rawChatId is String && rawChatId.isNotEmpty
        ? rawChatId
        : chatId ?? '';
    if (resolved.isEmpty) {
      if (activeSkillId != owner) return false;
      error = 'the core did not name the goal chat';
      notifyListeners();
      return false;
    }

    final raw = json['snapshot'];
    final rawSnapshot = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final skillKey = _skillChatKey(goalId, resolved);
    if (_acceptChatSnapshot('skill:$skillKey', rawSnapshot['seq'])) {
      _skillChats[skillKey] = ChatSnapshot.fromJson(rawSnapshot);
    }
    _skillChatErrors.remove(_skillChatKey(goalId, resolved));
    if (activeSkillId != owner) return false;
    activeSkillChatId = resolved;
    if (!skillChats.any((chat) => chat.id == resolved)) {
      skillChats = [
        ...skillChats,
        SkillChatRow(id: resolved, title: '', lastUsed: '', messages: 0),
      ];
    }
    error = null;
    notifyListeners();
    return true;
  }

  /// Start a **new** goal chat, always.
  ///
  /// `skill.chat.open` resumes the newest transcript and a goal chat has many,
  /// so without this a user could never get past `chat-1`. Refusals are kept on
  /// the shell-wide [error] like [openSkillChat]; the caller decides whether to
  /// open the chat layer.
  Future<bool> createSkillChat(String goalId) async {
    final owner = activeSkillId;
    final Map<String, dynamic> json;
    try {
      json = await _connection.call(CoreMethod.skillChatCreate, {
        'goalId': goalId,
      });
    } catch (failure) {
      if (activeSkillId != owner) return false;
      error = _messageOf(failure);
      notifyListeners();
      return false;
    }

    final rawChatId = json['chatId'];
    if (rawChatId is! String || rawChatId.isEmpty) {
      if (activeSkillId != owner) return false;
      error = 'the core did not name the new goal chat';
      notifyListeners();
      return false;
    }

    final raw = json['snapshot'];
    final rawSnapshot = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
    final skillKey = _skillChatKey(goalId, rawChatId);
    if (_acceptChatSnapshot('skill:$skillKey', rawSnapshot['seq'])) {
      _skillChats[skillKey] = ChatSnapshot.fromJson(rawSnapshot);
    }
    _skillChatErrors.remove(_skillChatKey(goalId, rawChatId));
    if (activeSkillId != owner) return false;
    activeSkillChatId = rawChatId;
    if (!skillChats.any((chat) => chat.id == rawChatId)) {
      skillChats = [
        ...skillChats,
        SkillChatRow(id: rawChatId, title: '', lastUsed: '', messages: 0),
      ];
    }
    error = null;
    notifyListeners();
    return true;
  }

  /// Send one turn to a goal chat. Never touches Chill, a session or a project.
  ///
  /// The transcript grows only from the core's `skill.chat.state` events. A
  /// request failure is kept for that one chat in [skillChatErrorFor], so a goal
  /// chat refusal never looks like a shell-wide transport failure.
  Future<bool> sendSkillChat(String goalId, String chatId, String text) async {
    final key = _skillChatKey(goalId, chatId);
    try {
      await _connection.call(CoreMethod.skillChatSend, {
        'goalId': goalId,
        'chatId': chatId,
        'text': text,
      });
      if (_skillChatErrors.remove(key) != null) notifyListeners();
      return true;
    } catch (failure) {
      _skillChatErrors[key] = _messageOf(failure);
      notifyListeners();
      return false;
    }
  }

  /// Stop a goal chat's in-flight turn. Nothing running is a no-op.
  Future<void> cancelSkillChat(String goalId, String chatId) async {
    try {
      await _connection.call(CoreMethod.skillChatCancel, {
        'goalId': goalId,
        'chatId': chatId,
      });
    } catch (failure) {
      error = _messageOf(failure);
      notifyListeners();
    }
  }

  /// Collapse from the goal chat back to the goal page.
  ///
  /// The transcript and the chat id stay in the store, so reopening the chat
  /// paints the previous conversation and does not reset it.
  void closeSkillChat() {
    if (activeSkillChatId == null) return;
    activeSkillChatId = null;
    notifyListeners();
  }

  void _clearChapter() {
    // Closing the reader abandons a body still being read.
    _skillChapterTicket += 1;
    activeSkillChapter = null;
    activeSkillChapterId = null;
    activeSkillChapterPractical = false;
    skillChapterLoading = false;
    skillChapterError = null;
  }

  /// Register one folder as a Work project (`work.create`).
  ///
  /// [folder] is the path the **user typed or picked**; the core resolves it,
  /// creates the leaf when it does not exist and writes only
  /// `work/projects/<id>/meta.json`. The folder itself is never moved or
  /// deleted.
  ///
  /// On success the list is refreshed and the new project opened, so the shell
  /// lands on its detail. On failure the [RpcException] is rethrown untouched,
  /// like [linkProvider]: the dialog shows the core's own message and stays
  /// open, so a registration refusal never reaches [error].
  Future<WorkCreateResult> createProject({
    required String name,
    required String folder,
    required String mode,
  }) async {
    final json = await _connection.call(CoreMethod.workCreate, {
      'name': name,
      'folder': folder,
      'mode': mode,
    });
    final result = WorkCreateResult.fromJson(json);
    await refreshProjects();
    await openProject(result.id);
    return result;
  }

  static List<ProjectRow> _projectRows(Map<String, dynamic> json) {
    final raw = json['projects'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((row) => ProjectRow.fromJson(Map<String, dynamic>.from(row)))
        .toList();
  }

  /// Create or update one agent profile (`work.agent.save`).
  ///
  /// [agent] is the dialog's profile: an empty id creates a new one and a saved
  /// id updates it in place. The core writes only
  /// `work/projects/<id>/meta.json`; no file inside the project folder is read,
  /// written, moved or deleted.
  ///
  /// On success the project list is refreshed so the agent count follows, and
  /// the open project is re-read so the detail renders exactly what the core
  /// stored (a delete may have cleared the default, a save may have renamed a
  /// profile). On failure the [RpcException] is rethrown untouched, like
  /// [createProject]: the dialog shows the core's own sentence and stays open,
  /// so a refused save never reaches [error].
  Future<String> saveAgent(String projectId, AgentProfileView agent) async {
    final json = await _connection.call(CoreMethod.workAgentSave, {
      'projectId': projectId,
      'agent': agent.toSaveJson(),
    });
    final saved = json['id'];
    await _reloadProjectAfterAgentChange(projectId);
    return saved is String && saved.isNotEmpty ? saved : agent.id;
  }

  /// Delete one agent profile (`work.agent.delete`).
  ///
  /// Deleting the default leaves the project with no default; the re-read below
  /// reports that state instead of promoting a neighbour. Failure rethrows the
  /// [RpcException] for the page's inline message.
  Future<void> deleteAgent(String projectId, String agentId) async {
    await _connection.call(CoreMethod.workAgentDelete, {
      'projectId': projectId,
      'agentId': agentId,
    });
    await _reloadProjectAfterAgentChange(projectId);
  }

  /// Set the project default agent, or clear it with a null [agentId]
  /// (`work.defaultAgent`). Failure rethrows for the page's inline message.
  Future<void> setDefaultAgent(String projectId, String? agentId) async {
    final id = agentId?.trim() ?? '';
    await _connection.call(CoreMethod.workDefaultAgent, {
      'projectId': projectId,
      if (id.isNotEmpty) 'agentId': id,
    });
    await _reloadProjectAfterAgentChange(projectId);
  }

  /// Refresh the list and, when it is the open one, re-read the project.
  ///
  /// Both reads record their own failure in [error] and keep the previous
  /// projection, so a metadata write that succeeded is never reported as a
  /// failed write: only the follow-up read can fail here.
  Future<void> _reloadProjectAfterAgentChange(String projectId) async {
    await refreshProjects();
    if (activeProjectId == projectId) await openProject(projectId);
  }

  /// Export the Stats view as a document (`stats.export`).
  ///
  /// [range] and [scope] are the chips the page is showing, and [format] is
  /// `md` or `csv`. The core writes **no file**: it returns the whole document
  /// text plus the format it produced, so saving or copying is the shell's job
  /// and the workspace is left byte-identical. A refusal rethrows the
  /// [RpcException] untouched for the page's inline message and retry; the
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
