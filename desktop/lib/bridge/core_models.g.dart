// GENERATED FILE — do not edit by hand.
// dart format off
//
// Generated from the exported types in: src/server/protocol.ts, src/server/knowledge.ts, src/server/chat-wire.ts, src/stats/types.ts, src/services/knowledge/learning-graph.ts, src/types/settings.ts, src/services/lockin/figures.ts, src/services/work/agents.ts, src/domain/source.ts.
// Regenerate: `bun run scripts/generate-dart-models.ts`.
//
// The shell reads these models from the wire; every field is tolerant of a
// missing or mistyped value so one odd reply cannot blank a surface.

String _string(Object? value) => value is String ? value : '';

String _stringOrDefault(Object? value, String fallback) =>
    value is String ? value : fallback;

int _int(Object? value) => value is num ? value.toInt() : 0;

double _double(Object? value) => value is num ? value.toDouble() : 0;

bool _bool(Object? value) => value is bool ? value : false;

List<String> _strings(Object? value) =>
    value is List ? value.whereType<String>().toList(growable: false) : const [];

/// A number from a number or a numeric string; anything else is zero.
double _numberOrString(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim()) ?? 0;
  return 0;
}

Map<String, dynamic> _map(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : const <String, dynamic>{};

/// Parse a list of objects, skipping entries that are not maps.
List<T> _models<T>(Object? value, T Function(Map<String, dynamic>) parse) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((map) => parse(Map<String, dynamic>.from(map)))
      .toList(growable: false);
}

Map<String, int> _intMap(Object? value) {
  if (value is! Map) return const <String, int>{};
  final out = <String, int>{};
  value.forEach((key, entry) {
    if (key is String && entry is num) out[key] = entry.toInt();
  });
  return out;
}

String? _stringOrNull(Object? value) =>
    value is String && value.isNotEmpty ? value : null;

int? _intOrNull(Object? value) => value is num ? value.toInt() : null;

T? _modelOrNull<T>(Object? value, T Function(Map<String, dynamic>) parse) =>
    value is Map ? parse(Map<String, dynamic>.from(value)) : null;

/// One knowledge search result (`docs/product.md` §6.3).
///
/// `side` is the wall: a school row can never be a skills row. `path` is always
/// relative to the workspace root — never an absolute path and never note
/// content — so the shell can show it without leaking the machine layout.
class KnowledgeHit {
  const KnowledgeHit({
    required this.id,
    required this.kind,
    required this.title,
    required this.excerpt,
    required this.side,
    required this.path,
    required this.updated,
    required this.score,
  });

  final String id;

  final String kind;

  final String title;

  final String excerpt;

  final String side;

  final String path;

  /// ISO-8601, or `""` when the source records no timestamp.
  final String updated;

  /// 3 = title prefix, 2 = word match, 1 = body substring; 0 on a direct read.
  final double score;

  factory KnowledgeHit.fromJson(Map<String, dynamic> json) => KnowledgeHit(
    id: _string(json['id']),
    kind: _string(json['kind']).toLowerCase(),
    title: _string(json['title']),
    excerpt: _string(json['excerpt']),
    side: _string(json['side']).toLowerCase(),
    path: _string(json['path']),
    updated: _string(json['updated']),
    score: _numberOrString(json['score']),
  );
}

/// One note row in a topic group. `path` is workspace-relative.
class KnowledgeNote {
  const KnowledgeNote({
    required this.path,
    required this.title,
    required this.updated,
  });

  final String path;

  final String title;

  final String updated;

  factory KnowledgeNote.fromJson(Map<String, dynamic> json) => KnowledgeNote(
    path: _string(json['path']),
    title: _string(json['title']),
    updated: _string(json['updated']),
  );
}

/// One topic heading plus its notes; a topic with no notes is kept.
class KnowledgeGroup {
  const KnowledgeGroup({
    required this.topic,
    required this.notes,
  });

  final String topic;

  final List<KnowledgeNote> notes;

  factory KnowledgeGroup.fromJson(Map<String, dynamic> json) => KnowledgeGroup(
    topic: _string(json['topic']),
    notes: _models(json['notes'], KnowledgeNote.fromJson),
  );
}

class StatsOverview {
  const StatsOverview({
    required this.runs,
    required this.failed,
    required this.input,
    required this.output,
  });

  final int runs;

  final int failed;

  final int input;

  final int output;

  factory StatsOverview.fromJson(Map<String, dynamic> json) => StatsOverview(
    runs: _int(json['runs']),
    failed: _int(json['failed']),
    input: _int(json['input']),
    output: _int(json['output']),
  );
}

class StatsModelRow {
  const StatsModelRow({
    required this.model,
    required this.runs,
    required this.input,
    required this.output,
    this.costMicroUsd,
  });

  final String model;

  final int runs;

  final int input;

  final int output;

  final int? costMicroUsd;

  factory StatsModelRow.fromJson(Map<String, dynamic> json) => StatsModelRow(
    model: _string(json['model']),
    runs: _int(json['runs']),
    input: _int(json['input']),
    output: _int(json['output']),
    costMicroUsd: _intOrNull(json['costMicroUsd']),
  );
}

class StatsToolRow {
  const StatsToolRow({
    required this.name,
    required this.calls,
  });

  final String name;

  final int calls;

  factory StatsToolRow.fromJson(Map<String, dynamic> json) => StatsToolRow(
    name: _string(json['name']),
    calls: _int(json['calls']),
  );
}

class LearningStats {
  const LearningStats({
    required this.steps,
    required this.cardsKnown,
    required this.cardsMissed,
    required this.lessons,
  });

  final int steps;

  final int cardsKnown;

  final int cardsMissed;

  final int lessons;

  factory LearningStats.fromJson(Map<String, dynamic> json) => LearningStats(
    steps: _int(json['steps']),
    cardsKnown: _int(json['cardsKnown']),
    cardsMissed: _int(json['cardsMissed']),
    lessons: _int(json['lessons']),
  );
}

/// One local day with activity, for the contribution calendar.
class ActivityDay {
  const ActivityDay({
    required this.date,
    required this.runs,
    required this.tokens,
  });

  final String date;

  final int runs;

  final int tokens;

  factory ActivityDay.fromJson(Map<String, dynamic> json) => ActivityDay(
    date: _string(json['date']),
    runs: _int(json['runs']),
    tokens: _int(json['tokens']),
  );
}

/// Inclusive local-date period the summary covers, as `YYYY-MM-DD`.
class StatsPeriod {
  const StatsPeriod({
    required this.from,
    required this.to,
  });

  final String from;

  final String to;

  factory StatsPeriod.fromJson(Map<String, dynamic> json) => StatsPeriod(
    from: _string(json['from']),
    to: _string(json['to']),
  );
}

class StatsSummary {
  const StatsSummary({
    required this.range,
    required this.scope,
    required this.overview,
    this.costMicroUsd,
    required this.costLabel,
    required this.models,
    required this.tools,
    required this.learning,
    required this.activity,
    required this.bestStreak,
    required this.activeDays,
    required this.period,
    this.diagnostic,
  });

  final String range;

  final String scope;

  final StatsOverview overview;

  /// `null` means "cost unknown" — never rendered as $0.0000.
  final int? costMicroUsd;

  final String costLabel;

  final List<StatsModelRow> models;

  final List<StatsToolRow> tools;

  final LearningStats learning;

  /// Days with at least one run, in local-date order.
  final List<ActivityDay> activity;

  final int bestStreak;

  final int activeDays;

  final StatsPeriod period;

  /// Present when a counter file was corrupt or unreadable.
  final String? diagnostic;

  factory StatsSummary.fromJson(Map<String, dynamic> json) => StatsSummary(
    range: _string(json['range']),
    scope: _string(json['scope']),
    overview: StatsOverview.fromJson(_map(json['overview'])),
    costMicroUsd: _intOrNull(json['costMicroUsd']),
    costLabel: _string(json['costLabel']),
    models: _models(json['models'], StatsModelRow.fromJson),
    tools: _models(json['tools'], StatsToolRow.fromJson),
    learning: LearningStats.fromJson(_map(json['learning'])),
    activity: _models(json['activity'], ActivityDay.fromJson),
    bestStreak: _int(json['bestStreak']),
    activeDays: _int(json['activeDays']),
    period: StatsPeriod.fromJson(_map(json['period'])),
    diagnostic: _stringOrNull(json['diagnostic']),
  );
}

class LearningNode {
  const LearningNode({
    required this.id,
    required this.kind,
    required this.label,
    required this.detail,
    required this.side,
    required this.context,
    required this.grounded,
  });

  final String id;

  final String kind;

  final String label;

  /// One short line of state; never a body.
  final String detail;

  final String side;

  /// The goal or session name this node belongs to.
  final String context;

  final String grounded;

  factory LearningNode.fromJson(Map<String, dynamic> json) => LearningNode(
    id: _string(json['id']),
    kind: _string(json['kind']),
    label: _string(json['label']),
    detail: _string(json['detail']),
    side: _string(json['side']),
    context: _string(json['context']),
    grounded: _stringOrDefault(json['grounded'], 'record'),
  );
}

class LearningEdge {
  const LearningEdge({
    required this.from,
    required this.to,
    required this.kind,
  });

  final String from;

  final String to;

  final String kind;

  factory LearningEdge.fromJson(Map<String, dynamic> json) => LearningEdge(
    from: _string(json['from']),
    to: _string(json['to']),
    kind: _string(json['kind']),
  );
}

class LearningGraph {
  const LearningGraph({
    required this.nodes,
    required this.edges,
    required this.counts,
    required this.diagnostics,
    required this.truncated,
  });

  final List<LearningNode> nodes;

  final List<LearningEdge> edges;

  final Map<String, int> counts;

  final List<String> diagnostics;

  /// True when the node cap was reached; the list is still usable.
  final bool truncated;

  factory LearningGraph.fromJson(Map<String, dynamic> json) => LearningGraph(
    nodes: _models(json['nodes'], LearningNode.fromJson),
    edges: _models(json['edges'], LearningEdge.fromJson),
    counts: _intMap(json['counts']),
    diagnostics: _strings(json['diagnostics']),
    truncated: _bool(json['truncated']),
  );
}

/// The settings snapshot the core returns and the shell renders.
///
/// It lives here, not in a frontend, because both the TUI (removed) and the
/// desktop shell consume the same projection from `src/server`.
class SettingsView {
  const SettingsView({
    required this.username,
    required this.theme,
    required this.chatModel,
    required this.baseUrl,
    required this.maxToolCalls,
    required this.maxTokensPerRequest,
    required this.budgetUsd,
    required this.period,
    required this.warnAt,
    required this.pauseAtLimit,
    required this.dataDir,
    required this.archiveBackend,
    required this.archiveFolder,
    required this.historyLimit,
    required this.responseStyle,
    required this.tutorPolicy,
    required this.pluginServers,
    required this.hideHints,
    required this.pluginDirs,
    required this.disabledPlugins,
  });

  final String username;

  final String theme;

  final String chatModel;

  final String baseUrl;

  final int maxToolCalls;

  final int maxTokensPerRequest;

  final double budgetUsd;

  final String period;

  final double warnAt;

  final bool pauseAtLimit;

  final String dataDir;

  final String archiveBackend;

  final String archiveFolder;

  final int historyLimit;

  final String responseStyle;

  final String tutorPolicy;

  /// MCP server names from config, for the Plugins surface.
  final List<String> pluginServers;

  /// `ui.hide_hints`: the chat's own hint rows are hidden.
  final bool hideHints;

  /// `ui.plugins.dirs`: folders that contain plugin directories.
  final List<String> pluginDirs;

  /// `ui.plugins.disabled`: discovered plugin ids that are not mounted.
  final List<String> disabledPlugins;

  factory SettingsView.fromJson(Map<String, dynamic> json) => SettingsView(
    username: _string(json['username']),
    theme: _string(json['theme']),
    chatModel: _string(json['chatModel']),
    baseUrl: _string(json['baseUrl']),
    maxToolCalls: _int(json['maxToolCalls']),
    maxTokensPerRequest: _int(json['maxTokensPerRequest']),
    budgetUsd: _double(json['budgetUsd']),
    period: _string(json['period']),
    warnAt: _double(json['warnAt']),
    pauseAtLimit: _bool(json['pauseAtLimit']),
    dataDir: _string(json['dataDir']),
    archiveBackend: _string(json['archiveBackend']),
    archiveFolder: _string(json['archiveFolder']),
    historyLimit: _int(json['historyLimit']),
    responseStyle: _string(json['responseStyle']),
    tutorPolicy: _string(json['tutorPolicy']),
    pluginServers: _strings(json['pluginServers']),
    hideHints: _bool(json['hideHints']),
    pluginDirs: _strings(json['pluginDirs']),
    disabledPlugins: _strings(json['disabledPlugins']),
  );
}

class SessionFigure {
  const SessionFigure({
    required this.id,
    required this.source,
    required this.page,
    this.x,
    this.y,
    this.width,
    this.height,
    required this.caption,
    required this.note,
    required this.file,
    required this.createdAt,
  });

  final String id;

  /// Session-relative stored path of the source PDF.
  final String source;

  final int page;

  final int? x;

  final int? y;

  final int? width;

  final int? height;

  final String caption;

  final String note;

  final String file;

  final String createdAt;

  factory SessionFigure.fromJson(Map<String, dynamic> json) => SessionFigure(
    id: _string(json['id']),
    source: _string(json['source']),
    page: _int(json['page']),
    x: _intOrNull(json['x']),
    y: _intOrNull(json['y']),
    width: _intOrNull(json['width']),
    height: _intOrNull(json['height']),
    caption: _string(json['caption']),
    note: _string(json['note']),
    file: _string(json['file']),
    createdAt: _string(json['createdAt']),
  );
}

/// One message in a chat snapshot (`chat.state`, `session.chat.state`, …).
class ChatMessageView {
  const ChatMessageView({
    required this.id,
    required this.role,
    required this.text,
    this.outcome,
  });

  final String id;

  final String role;

  final String text;

  final String? outcome;

  factory ChatMessageView.fromJson(Map<String, dynamic> json) => ChatMessageView(
    id: _string(json['id']),
    role: _string(json['role']),
    text: _string(json['text']),
    outcome: _stringOrNull(json['outcome']),
  );
}

/// The usage figures a chat snapshot carries.
class ChatUsageView {
  const ChatUsageView({
    required this.tokens,
    this.costMicroUsd,
    this.durationMs,
  });

  final int tokens;

  final int? costMicroUsd;

  final int? durationMs;

  factory ChatUsageView.fromJson(Map<String, dynamic> json) => ChatUsageView(
    tokens: _int(json['tokens']),
    costMicroUsd: _intOrNull(json['costMicroUsd']),
    durationMs: _intOrNull(json['durationMs']),
  );
}

class ChatBlocked {
  const ChatBlocked({
    required this.reason,
    required this.fix,
  });

  final String reason;

  final String fix;

  factory ChatBlocked.fromJson(Map<String, dynamic> json) => ChatBlocked(
    reason: _string(json['reason']),
    fix: _string(json['fix']),
  );
}

class ChatFailure {
  const ChatFailure({
    required this.failed,
    required this.kept,
    required this.next,
  });

  final String failed;

  final String kept;

  final String next;

  factory ChatFailure.fromJson(Map<String, dynamic> json) => ChatFailure(
    failed: _string(json['failed']),
    kept: _string(json['kept']),
    next: _string(json['next']),
  );
}

/// One chat projection. `seq` is the stream's frame number; the Flutter shell
/// tracks it separately and does not store it on its snapshot model.
class ChatSnapshot {
  const ChatSnapshot({
    required this.status,
    this.model,
    required this.streamed,
    required this.messages,
    this.blocked,
    this.error,
    required this.usage,
  });

  final String status;

  final String? model;

  final String streamed;

  final List<ChatMessageView> messages;

  final ChatBlocked? blocked;

  final ChatFailure? error;

  final ChatUsageView usage;

  factory ChatSnapshot.fromJson(Map<String, dynamic> json) => ChatSnapshot(
    status: _string(json['status']),
    model: _stringOrNull(json['model']),
    streamed: _string(json['streamed']),
    messages: _models(json['messages'], ChatMessageView.fromJson),
    blocked: _modelOrNull(json['blocked'], ChatBlocked.fromJson),
    error: _modelOrNull(json['error'], ChatFailure.fromJson),
    usage: ChatUsageView.fromJson(_map(json['usage'])),
  );
}

class AgentProfileView {
  const AgentProfileView({
    required this.id,
    required this.name,
    required this.role,
    required this.instructions,
    required this.model,
    required this.maxToolCalls,
    required this.allowedTools,
    required this.allowWrite,
    required this.allowCommand,
    required this.template,
  });

  /// Stable for the life of the agent; renaming never changes it.
  final String id;

  final String name;

  final String role;

  final String instructions;

  /// `""` means the project/chat default model.
  final String model;

  final int maxToolCalls;

  /// The tools this profile may call. An empty list means "every tool the
  /// profile's capabilities permit" (the same rule WP-502 applies at chat time).
  final List<String> allowedTools;

  final bool allowWrite;

  final bool allowCommand;

  /// The template id this profile was seeded from, or `""`.
  final String template;

  factory AgentProfileView.fromJson(Map<String, dynamic> json) => AgentProfileView(
    id: _string(json['id']),
    name: _string(json['name']),
    role: _string(json['role']),
    instructions: _string(json['instructions']),
    model: _string(json['model']),
    maxToolCalls: _int(json['maxToolCalls']),
    allowedTools: _strings(json['allowedTools']),
    allowWrite: _bool(json['allowWrite']),
    allowCommand: _bool(json['allowCommand']),
    template: _string(json['template']),
  );
}

class SessionSource {
  const SessionSource({
    required this.originalPath,
    required this.storedPath,
    required this.name,
    required this.hash,
    required this.kind,
  });

  /// Where the user picked it. Informational only; never read back.
  final String originalPath;

  /// Relative to the session folder, always under `sources/`.
  final String storedPath;

  final String name;

  /// `sha256:<64 hex>` — the de-duplication key.
  final String hash;

  final String kind;

  factory SessionSource.fromJson(Map<String, dynamic> json) => SessionSource(
    originalPath: _string(json['originalPath']),
    storedPath: _string(json['storedPath']),
    name: _string(json['name']),
    hash: _string(json['hash']),
    kind: _string(json['kind']),
  );
}

/// The steps half of a `session.open` projection.
class SessionSteps {
  const SessionSteps({
    required this.done,
    required this.total,
    required this.exists,
    required this.markdown,
  });

  final int done;

  final int total;

  final bool exists;

  final String markdown;

  factory SessionSteps.fromJson(Map<String, dynamic> json) => SessionSteps(
    done: _int(json['done']),
    total: _int(json['total']),
    exists: _bool(json['exists']),
    markdown: _string(json['markdown']),
  );
}

/// The memory half of a `session.open` projection (history, never a source).
class SessionMemory {
  const SessionMemory({
    required this.points,
    required this.folded,
    required this.updated,
  });

  final List<String> points;

  final List<String> folded;

  final String updated;

  factory SessionMemory.fromJson(Map<String, dynamic> json) => SessionMemory(
    points: _strings(json['points']),
    folded: _strings(json['folded']),
    updated: _string(json['updated']),
  );
}

/// The whole `session.open` detail the Flutter shell renders.
class SessionDetail {
  const SessionDetail({
    required this.id,
    required this.name,
    required this.created,
    required this.archived,
    required this.prompt,
    required this.sources,
    required this.steps,
    this.memory,
  });

  final String id;

  final String name;

  final String created;

  final bool archived;

  final String prompt;

  final List<SessionSource> sources;

  final SessionSteps steps;

  final SessionMemory? memory;

  factory SessionDetail.fromJson(Map<String, dynamic> json) => SessionDetail(
    id: _string(json['id']),
    name: _string(json['name']),
    created: _string(json['created']),
    archived: _bool(json['archived']),
    prompt: _string(json['prompt']),
    sources: _models(json['sources'], SessionSource.fromJson),
    steps: SessionSteps.fromJson(_map(json['steps'])),
    memory: _modelOrNull(json['memory'], SessionMemory.fromJson),
  );
}

/// The `work.open` project detail the Flutter shell renders.
class WorkProjectDetail {
  const WorkProjectDetail({
    required this.id,
    required this.name,
    required this.root,
    required this.rootMissing,
    required this.mode,
    required this.swarmName,
    required this.archived,
    required this.instructions,
    this.defaultAgent,
    required this.agents,
    required this.tasks,
    required this.hasGit,
    required this.lastOpened,
  });

  final String id;

  final String name;

  final String root;

  final bool rootMissing;

  final String mode;

  final String swarmName;

  final bool archived;

  final String instructions;

  final String? defaultAgent;

  final List<AgentProfileView> agents;

  final int tasks;

  final bool hasGit;

  final String lastOpened;

  factory WorkProjectDetail.fromJson(Map<String, dynamic> json) => WorkProjectDetail(
    id: _string(json['id']),
    name: _string(json['name']),
    root: _string(json['root']),
    rootMissing: _bool(json['rootMissing']),
    mode: _string(json['mode']),
    swarmName: _string(json['swarmName']),
    archived: _bool(json['archived']),
    instructions: _string(json['instructions']),
    defaultAgent: _stringOrNull(json['defaultAgent']),
    agents: _models(json['agents'], AgentProfileView.fromJson),
    tasks: _int(json['tasks']),
    hasGit: _bool(json['hasGit']),
    lastOpened: _string(json['lastOpened']),
  );
}

/// One agent row in the `work.list` project row.
class ProjectAgent {
  const ProjectAgent({
    required this.id,
    required this.name,
    required this.task,
    required this.model,
    required this.permissions,
  });

  final String id;

  final String name;

  final String task;

  final String model;

  final String permissions;

  factory ProjectAgent.fromJson(Map<String, dynamic> json) => ProjectAgent(
    id: _string(json['id']),
    name: _string(json['name']),
    task: _string(json['task']),
    model: _string(json['model']),
    permissions: _string(json['permissions']),
  );
}

/// One registered Work project as `work.list` returns it.
class ProjectRow {
  const ProjectRow({
    required this.id,
    required this.name,
    required this.folder,
    required this.mode,
    required this.swarmName,
    required this.archived,
    required this.agents,
  });

  final String id;

  final String name;

  final String folder;

  final String mode;

  final String swarmName;

  final bool archived;

  final List<ProjectAgent> agents;

  factory ProjectRow.fromJson(Map<String, dynamic> json) => ProjectRow(
    id: _string(json['id']),
    name: _string(json['name']),
    folder: _string(json['folder']),
    mode: _string(json['mode']),
    swarmName: _string(json['swarmName']),
    archived: _bool(json['archived']),
    agents: _models(json['agents'], ProjectAgent.fromJson),
  );
}

/// One row of the `work.templates.list` template picker.
class AgentTemplateRow {
  const AgentTemplateRow({
    required this.id,
    required this.name,
    required this.role,
    required this.summary,
    required this.source,
    required this.instructions,
    required this.maxToolCalls,
    required this.allowedTools,
  });

  final String id;

  final String name;

  final String role;

  final String summary;

  final String source;

  final String instructions;

  final int maxToolCalls;

  final List<String> allowedTools;

  factory AgentTemplateRow.fromJson(Map<String, dynamic> json) => AgentTemplateRow(
    id: _string(json['id']),
    name: _string(json['name']),
    role: _string(json['role']),
    summary: _string(json['summary']),
    source: _string(json['source']),
    instructions: _string(json['instructions']),
    maxToolCalls: _int(json['maxToolCalls']),
    allowedTools: _strings(json['allowedTools']),
  );
}
