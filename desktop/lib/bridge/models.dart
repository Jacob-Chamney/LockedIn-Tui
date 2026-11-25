/// Typed projections of the core's JSON-RPC payloads.
///
/// The types mirror `src/server/` and are intentionally read-only: the shell
/// never computes domain totals, it only formats these values.
String _string(Object? value) => value is String ? value : '';
int _int(Object? value) => value is num ? value.toInt() : 0;
double _double(Object? value) => value is num ? value.toDouble() : 0;
bool _bool(Object? value) => value is bool ? value : false;

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((map) => Map<String, dynamic>.from(map))
      .toList();
}

List<String> _strings(Object? value) =>
    value is List ? value.whereType<String>().toList() : const [];

class WorkspaceInfo {
  const WorkspaceInfo({
    required this.path,
    required this.dataDir,
    required this.configured,
    required this.model,
    required this.provider,
  });

  final String path;
  final String dataDir;
  final bool configured;
  final String model;
  final String provider;

  factory WorkspaceInfo.fromJson(Map<String, dynamic> json) => WorkspaceInfo(
    path: _string(json['path']),
    dataDir: _string(json['dataDir']),
    configured: _bool(json['configured']),
    model: _string(json['model']),
    provider: _string(json['provider']),
  );
}

class SessionRow {
  const SessionRow({
    required this.id,
    required this.name,
    required this.date,
    required this.sources,
    required this.stepsDone,
    required this.stepsTotal,
    required this.archived,
    this.broken,
  });

  final String id;
  final String name;
  final String date;
  final int sources;
  final int stepsDone;
  final int stepsTotal;
  final bool archived;
  final String? broken;

  factory SessionRow.fromJson(Map<String, dynamic> json) {
    final steps = json['steps'];
    final stepMap = steps is Map
        ? Map<String, dynamic>.from(steps)
        : const <String, dynamic>{};
    final broken = json['broken'];
    return SessionRow(
      id: _string(json['id']),
      name: _string(json['name']),
      date: _string(json['date']),
      sources: _int(json['sources']),
      stepsDone: _int(stepMap['done']),
      stepsTotal: _int(stepMap['total']),
      archived: _bool(json['archived']),
      broken: broken is String && broken.isNotEmpty ? broken : null,
    );
  }
}

/// One archived item from `archive.list`: a session, goal or project copy.
///
/// The archive row is a projection of what the core listed; restore, delete and
/// export are `archive.*` calls, not this model. Parsing is tolerant: a
/// missing or mistyped field becomes an empty string or zero rather than
/// throwing, because one malformed row must not blank the whole picker.
class ArchiveRow {
  const ArchiveRow({
    required this.id,
    required this.side,
    required this.name,
    required this.date,
    required this.sizeBytes,
    required this.backend,
    required this.kind,
  });

  final String id;

  /// `school` or `skills`; a value this shell does not know is kept as-is so the
  /// page can still group it.
  final String side;
  final String name;

  /// ISO-8601 archive instant, rendered as its date part.
  final String date;
  final int sizeBytes;

  /// The adapter that produced the row: `folder` or `github`.
  final String backend;

  /// `session`, `goal` or `project`.
  final String kind;

  /// The title to show, falling back to the id when the archive has no name.
  String get displayName {
    final title = name.trim();
    return title.isEmpty ? id : title;
  }

  factory ArchiveRow.fromJson(Map<String, dynamic> json) => ArchiveRow(
    id: _string(json['id']),
    side: _string(json['side']).toLowerCase(),
    name: _string(json['name']),
    date: _string(json['date']),
    sizeBytes: _bytes(json['sizeBytes']),
    backend: _string(json['backend']).toLowerCase(),
    kind: _string(json['kind']).toLowerCase(),
  );

  /// A byte count from a number or a numeric string; anything else is zero.
  static int _bytes(Object? value) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value.trim()) ?? 0;
    return 0;
  }
}

/// One file copied into a lock-in session's `sources/` folder.
class SessionSource {
  const SessionSource({
    required this.name,
    required this.originalPath,
    required this.storedPath,
    required this.hash,
    required this.kind,
  });

  final String name;

  /// Informational only: the core reads through [storedPath].
  final String originalPath;
  final String storedPath;
  final String hash;
  final String kind;

  factory SessionSource.fromJson(Map<String, dynamic> json) => SessionSource(
    name: _string(json['name']),
    originalPath: _string(json['originalPath']),
    storedPath: _string(json['storedPath']),
    hash: _string(json['hash']),
    kind: _string(json['kind']),
  );
}

/// `source.add` – what the core copied into the session's `sources/` folder.
///
/// [skipped] counts files whose bytes are already attached: the core stores one
/// copy per hash, so re-adding the same file is a no-op rather than a duplicate
/// row. The counts are the core's answer, not something the shell derives.
class SourceAddResult {
  const SourceAddResult({required this.added, required this.skipped});

  final int added;
  final int skipped;

  bool get nothingNew => added == 0;

  factory SourceAddResult.fromJson(Map<String, dynamic> json) =>
      SourceAddResult(
        added: _int(json['added']),
        skipped: _int(json['skipped']),
      );
}

/// The session's `assignment-steps.md` and the counts parsed from it.
class SessionSteps {
  const SessionSteps({
    required this.done,
    required this.total,
    required this.exists,
    required this.markdown,
  });

  final int done;
  final int total;

  /// False when the session has no steps file yet; [markdown] is then empty.
  final bool exists;
  final String markdown;

  factory SessionSteps.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return SessionSteps(
      done: _int(json['done']),
      total: _int(json['total']),
      exists: _bool(json['exists']),
      markdown: _string(json['markdown']),
    );
  }
}

/// `session.toggleStep` — one assignment step toggled.
///
/// The core rewrites exactly one bracket character and the progress line, then
/// returns the whole new `assignment-steps.md`. [markdown] is that document and
/// [hash] describes the same bytes, so the shell replaces its copy instead of
/// re-reading or re-deriving a count.
class StepToggleResult {
  const StepToggleResult({
    required this.index,
    required this.checked,
    required this.done,
    required this.total,
    required this.markdown,
    required this.hash,
  });

  /// The task-item ordinal that was toggled, zero-based in file order.
  final int index;

  /// The new state of that one item.
  final bool checked;
  final int done;
  final int total;

  /// The whole `assignment-steps.md` after the write.
  final String markdown;

  /// `sha256:<hex>` of [markdown].
  final String hash;

  factory StepToggleResult.fromJson(Map<String, dynamic> json) =>
      StepToggleResult(
        index: _int(json['index']),
        checked: _bool(json['checked']),
        done: _int(json['done']),
        total: _int(json['total']),
        markdown: _string(json['markdown']),
        hash: _string(json['hash']),
      );
}

/// `session.generateSteps` — the rebuilt `assignment-steps.md` and what the
/// merge did with checked work.
///
/// The core owns the transaction: it reads the session's own sources, asks the
/// model for a plan, validates it, merges checked steps by exact text and writes
/// the file atomically. [markdown] is that file; [kept] and [lost] count the
/// checked steps the merge preserved and dropped, so the shell can report the
/// outcome without reading the previous document.
class StepGenerateResult {
  const StepGenerateResult({
    required this.markdown,
    required this.kept,
    required this.lost,
  });

  /// The whole `assignment-steps.md` after the write.
  final String markdown;

  /// Checked steps whose exact text the new plan contains.
  final int kept;

  /// Checked steps whose text the new plan does not contain.
  final int lost;

  factory StepGenerateResult.fromJson(Map<String, dynamic> json) =>
      StepGenerateResult(
        markdown: _string(json['markdown']),
        kept: _int(json['kept']),
        lost: _int(json['lost']),
      );
}

/// The session's stored memory note (`memory.md`) from `session.open`.
///
/// This is **history, labelled session memory — never a source**: it never
/// appears in [SessionDetail.sources], never counts as a fact a chat may cite and
/// never enters source coverage. [points] are the kept key points in document
/// order, [folded] their overflowing `earlier:` lines, and [updated] the
/// ISO-8601 instant of the last written turn.
///
/// The core omits the whole block when no memory has been written yet, so an
/// absent key parses to a null [SessionDetail.memory] rather than an empty note.
/// Parsing is tolerant: a missing or mistyped field becomes an empty value or an
/// empty list, because one odd memory block must not blank the session.
class SessionMemory {
  const SessionMemory({
    required this.points,
    required this.folded,
    required this.updated,
  });

  /// Kept key points, in the note's order.
  final List<String> points;

  /// Overflowing lines the note folded behind `earlier:`.
  final List<String> folded;

  /// ISO-8601 instant of the last written turn; empty when absent.
  final String updated;

  /// True when the note carries nothing a card can render.
  bool get isEmpty => points.isEmpty && folded.isEmpty;

  factory SessionMemory.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return SessionMemory(
      points: _strings(json['points']),
      folded: _strings(json['folded']),
      updated: _string(json['updated']),
    );
  }
}

/// One source's entry in a session's source coverage (`session.coverage`).
///
/// This is a **lexical** fact, not a citation: [count] is the number of
/// case-insensitive mentions of the source's name or its origin file name across
/// the session's documents, [documents] lists the kinds that mention it (`steps`,
/// `chat`, `outputs`, `memory`), and [firstLine] is the first matching line. A
/// mention is not proof that a claim came from that source, and the coverage
/// card says so.
///
/// Memory is a **document**, never a source: a source mentioned only in
/// `memory.md` keeps `referenced: true` with [fromMemoryOnly] so the shell can
/// label it history rather than a fact the session cites.
class SourceCoverage {
  const SourceCoverage({
    required this.hash,
    required this.name,
    required this.originalPath,
    required this.count,
    required this.documents,
    required this.firstLine,
    required this.referenced,
    required this.fromMemoryOnly,
  });

  final String hash;
  final String name;

  /// Informational only: the core reads through the session's own copy.
  final String originalPath;

  /// Occurrences across all documents; overlapping name/origin matches count
  /// once.
  final int count;

  /// The document kinds that mention it, in the core's order.
  final List<String> documents;

  /// The first matching line, trimmed and capped by the core, or null.
  final String? firstLine;

  /// True when [count] is greater than zero.
  final bool referenced;

  /// True when `memory` is the only document that mentions it.
  final bool fromMemoryOnly;

  factory SourceCoverage.fromJson(Map<String, dynamic> json) {
    final firstLine = _string(json['firstLine']).trim();
    return SourceCoverage(
      hash: _string(json['hash']),
      name: _string(json['name']),
      originalPath: _string(json['originalPath']),
      count: _int(json['count']),
      documents: _strings(json['documents']),
      firstLine: firstLine.isEmpty ? null : firstLine,
      referenced: _bool(json['referenced']),
      fromMemoryOnly: _bool(json['fromMemoryOnly']),
    );
  }
}

/// The session's source coverage report (`session.coverage`).
///
/// The core computes it from the session's own `sources/` and its labelled
/// documents, and the shell only formats it. Parsing is tolerant: a malformed
/// field becomes an empty value, because one odd report must not blank the
/// detail or the review surface.
class CoverageReport {
  const CoverageReport({
    required this.sources,
    required this.unreferenced,
    required this.total,
    required this.referencedCount,
  });

  static const empty = CoverageReport(
    sources: <SourceCoverage>[],
    unreferenced: <SourceCoverage>[],
    total: 0,
    referencedCount: 0,
  );

  /// Every deduped source, sorted by count descending then by name.
  final List<SourceCoverage> sources;

  /// The gap list: the same entries with `referenced: false`, sorted by name.
  final List<SourceCoverage> unreferenced;

  /// The number of deduped sources.
  final int total;

  /// The number of sources with at least one mention.
  final int referencedCount;

  /// True when there is at least one source and every one is mentioned. An empty
  /// source list is never "covered": there is nothing to cite yet.
  bool get fullyCovered => total > 0 && referencedCount == total;

  /// True when the session has no sources to measure.
  bool get hasNoSources => total == 0;

  factory CoverageReport.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return CoverageReport(
      sources: _maps(json['sources']).map(SourceCoverage.fromJson).toList(),
      unreferenced: _maps(json['unreferenced'])
          .map(SourceCoverage.fromJson)
          .toList(),
      total: _int(json['total']),
      referencedCount: _int(json['referencedCount']),
    );
  }
}

/// `session.open` – one lock-in session, read by the core from its folder.
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

  /// The stored memory note, or null when the core omitted the block.
  ///
  /// Memory is history, not a source: it is labelled session memory and never
  /// joins [sources].
  final SessionMemory? memory;

  factory SessionDetail.fromJson(Map<String, dynamic> json) => SessionDetail(
    id: _string(json['id']),
    name: _string(json['name']),
    created: _string(json['created']),
    archived: _bool(json['archived']),
    prompt: _string(json['prompt']),
    sources: _maps(json['sources']).map(SessionSource.fromJson).toList(),
    steps: SessionSteps.fromJson(json['steps']),
    memory: json['memory'] is Map
        ? SessionMemory.fromJson(json['memory'])
        : null,
  );
}

/// `session.create` — the id and name the core wrote.
///
/// The core owns the transaction (copy sources, extract an instructions file,
/// write `meta.json` and `prompt.md`), so this is deliberately not a second copy
/// of [SessionDetail]: the shell calls `session.open` for the detail.
class SessionCreateResult {
  const SessionCreateResult({required this.id, required this.name});

  final String id;
  final String name;

  factory SessionCreateResult.fromJson(Map<String, dynamic> json) =>
      SessionCreateResult(id: _string(json['id']), name: _string(json['name']));
}

/// `session.document` — one generated study document for a lock-in session.
///
/// The core generates the document from the session's own sources and writes it
/// atomically inside the session folder, so [text] and the bytes on disk agree.
/// [name] is the session-relative file (`contract.md`, `contradictions.md` or
/// `check.md`). These are **generated session documents, not sources**: they
/// never become a source row and never enter source coverage.
class SessionDocumentResult {
  const SessionDocumentResult({required this.text, required this.name});

  /// The document's own Markdown, exactly as the core wrote it.
  final String text;

  /// `contract.md`, `contradictions.md` or `check.md`.
  final String name;

  factory SessionDocumentResult.fromJson(Map<String, dynamic> json) =>
      SessionDocumentResult(
        text: _string(json['text']),
        name: _string(json['name']),
      );
}

/// `session.output.build` — one generated session output.
///
/// [kind] is `study-guide` or `flashcards`. [markdown] is the document the
/// reader renders (the guide or the deck) and [answers] is the study guide's
/// answers document, present only for a guide. [files] names the files inside
/// the session's outputs folder — never an absolute path — keyed by part
/// (`guide`, `answers`, `cards`).
///
/// These are **generated outputs, not sources**: they never become a source
/// row, never enter source coverage and never count as a fact a chat may cite.
class SessionOutputResult {
  const SessionOutputResult({
    required this.kind,
    required this.markdown,
    required this.answers,
    required this.files,
  });

  final String kind;

  /// The whole guide or deck, exactly as the core wrote it.
  final String markdown;

  /// The study guide's answers document; null for a deck.
  final String? answers;

  /// Session-relative output file names, keyed by part.
  final Map<String, String> files;

  factory SessionOutputResult.fromJson(Map<String, dynamic> json) {
    final answers = _string(json['answers']);
    final rawFiles = json['files'];
    final files = <String, String>{};
    if (rawFiles is Map) {
      rawFiles.forEach((key, value) {
        if (key is String && value is String && value.isNotEmpty) {
          files[key] = value;
        }
      });
    }
    return SessionOutputResult(
      kind: _string(json['kind']),
      markdown: _string(json['markdown']),
      answers: answers.isEmpty ? null : answers,
      files: files,
    );
  }
}

/// `session.output.read` — one already-built output document.
///
/// [exists] false is a success, not an error: the reader's empty state with a
/// next action (`session.output.build`). [markdown] is then empty.
class SessionOutputRead {
  const SessionOutputRead({required this.markdown, required this.exists});

  final String markdown;
  final bool exists;

  factory SessionOutputRead.fromJson(Map<String, dynamic> json) =>
      SessionOutputRead(
        markdown: _string(json['markdown']),
        exists: _bool(json['exists']),
      );
}

/// The copied original whose text became a session's `prompt.md`.
///
/// The core copies the chosen file into the session's `sources/` folder and
/// records where the prompt came from. This is **provenance**, not a second
/// prompt: [storedPath] is the session's own copy, and the shell never receives
/// the user's original path because it only needs the copy the session owns.
class InstructionsSource {
  const InstructionsSource({
    required this.name,
    required this.storedPath,
    required this.hash,
    required this.kind,
    required this.extractedAt,
    required this.characters,
    this.pages,
  });

  final String name;
  final String storedPath;
  final String hash;

  /// `markdown`, `text`, `code`, `pdf`, `docx` or `other`.
  final String kind;

  /// ISO-8601 UTC instant when `prompt.md` was last extracted.
  final String extractedAt;

  /// Extracted text length in characters; `0` when the core did not record it.
  final int characters;

  /// Page count for a PDF, absent otherwise.
  final int? pages;

  factory InstructionsSource.fromJson(Map<String, dynamic> json) =>
      InstructionsSource(
        name: _string(json['name']),
        storedPath: _string(json['storedPath']),
        hash: _string(json['hash']),
        kind: _string(json['kind']),
        extractedAt: _string(json['extractedAt']),
        characters: _int(json['characters']),
        pages: json['pages'] is num ? _int(json['pages']) : null,
      );
}

/// `session.instructions.get` — the text the model reads, plus provenance.
///
/// [prompt] is `prompt.md` verbatim; an empty string is a valid state (the
/// session simply has no instructions yet). [instructionsSource] is present only
/// when the prompt came from a copied file.
class SessionInstructions {
  const SessionInstructions({required this.prompt, this.instructionsSource});

  final String prompt;
  final InstructionsSource? instructionsSource;

  factory SessionInstructions.fromJson(Map<String, dynamic> json) {
    final source = json['instructionsSource'];
    return SessionInstructions(
      prompt: _string(json['prompt']),
      instructionsSource: source is Map
          ? InstructionsSource.fromJson(Map<String, dynamic>.from(source))
          : null,
    );
  }
}

/// `session.instructions.import` — the extracted prompt and the copied file.
///
/// [added] is false when the same bytes were already a source in this session:
/// the core reuses one copy per hash, so importing the same file twice updates
/// the prompt without duplicating the row.
class InstructionsImportResult {
  const InstructionsImportResult({
    required this.prompt,
    required this.instructions,
    required this.added,
  });

  final String prompt;
  final InstructionsSource instructions;
  final bool added;

  factory InstructionsImportResult.fromJson(Map<String, dynamic> json) {
    final source = json['instructions'];
    return InstructionsImportResult(
      prompt: _string(json['prompt']),
      instructions: InstructionsSource.fromJson(
        source is Map
            ? Map<String, dynamic>.from(source)
            : const <String, dynamic>{},
      ),
      added: _bool(json['added']),
    );
  }
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

  factory StatsOverview.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return StatsOverview(
      runs: _int(json['runs']),
      failed: _int(json['failed']),
      input: _int(json['input']),
      output: _int(json['output']),
    );
  }
}

class StatsModelRow {
  const StatsModelRow({
    required this.model,
    required this.runs,
    required this.input,
    required this.output,
    required this.costMicroUsd,
  });

  final String model;
  final int runs;
  final int input;
  final int output;
  final int? costMicroUsd;

  int get tokens => input + output;

  factory StatsModelRow.fromJson(Map<String, dynamic> json) => StatsModelRow(
    model: _string(json['model']),
    runs: _int(json['runs']),
    input: _int(json['input']),
    output: _int(json['output']),
    costMicroUsd: json['costMicroUsd'] is num
        ? _int(json['costMicroUsd'])
        : null,
  );
}

class StatsToolRow {
  const StatsToolRow({required this.name, required this.calls});

  final String name;
  final int calls;

  factory StatsToolRow.fromJson(Map<String, dynamic> json) =>
      StatsToolRow(name: _string(json['name']), calls: _int(json['calls']));
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

  factory LearningStats.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return LearningStats(
      steps: _int(json['steps']),
      cardsKnown: _int(json['cardsKnown']),
      cardsMissed: _int(json['cardsMissed']),
      lessons: _int(json['lessons']),
    );
  }
}

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

class StatsPeriod {
  const StatsPeriod({required this.from, required this.to});

  final String from;
  final String to;

  factory StatsPeriod.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return StatsPeriod(from: _string(json['from']), to: _string(json['to']));
  }
}

class StatsSummary {
  const StatsSummary({
    required this.range,
    required this.scope,
    required this.overview,
    required this.costMicroUsd,
    required this.costLabel,
    required this.models,
    required this.tools,
    required this.learning,
    required this.activity,
    required this.bestStreak,
    required this.activeDays,
    required this.period,
    required this.diagnostic,
  });

  final String range;
  final String scope;
  final StatsOverview overview;
  final int? costMicroUsd;
  final String costLabel;
  final List<StatsModelRow> models;
  final List<StatsToolRow> tools;
  final LearningStats learning;
  final List<ActivityDay> activity;
  final int bestStreak;
  final int activeDays;
  final StatsPeriod period;
  final String? diagnostic;

  int get tokens => overview.input + overview.output;

  factory StatsSummary.fromJson(Map<String, dynamic> json) {
    final diagnostic = json['diagnostic'];
    return StatsSummary(
      range: _string(json['range']),
      scope: _string(json['scope']),
      overview: StatsOverview.fromJson(json['overview']),
      costMicroUsd: json['costMicroUsd'] is num
          ? _int(json['costMicroUsd'])
          : null,
      costLabel: _string(json['costLabel']),
      models: _maps(json['models']).map(StatsModelRow.fromJson).toList(),
      tools: _maps(json['tools']).map(StatsToolRow.fromJson).toList(),
      learning: LearningStats.fromJson(json['learning']),
      activity: _maps(json['activity']).map(ActivityDay.fromJson).toList(),
      bestStreak: _int(json['bestStreak']),
      activeDays: _int(json['activeDays']),
      period: StatsPeriod.fromJson(json['period']),
      diagnostic: diagnostic is String && diagnostic.isNotEmpty
          ? diagnostic
          : null,
    );
  }
}

/// `stats.export` — one Stats document and the format the core produced.
///
/// The core writes no file: [text] is the whole document and saving or copying
/// it is the shell's job. [format] echoes what was produced (`md` or `csv`) so
/// the page can label the panel and choose an extension; an omitted request
/// format is `md` on the core side.
class StatsExportResult {
  const StatsExportResult({required this.text, required this.format});

  /// The document text, exactly as the core produced it.
  final String text;

  /// `md` or `csv`.
  final String format;

  factory StatsExportResult.fromJson(Map<String, dynamic> json) =>
      StatsExportResult(
        text: _string(json['text']),
        format: _string(json['format']),
      );
}

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
  final List<String> pluginServers;
  final bool hideHints;
  final List<String> pluginDirs;
  final List<String> disabledPlugins;

  factory SettingsView.fromJson(Map<String, dynamic> json) {
    List<String> strings(Object? value) =>
        value is List ? value.whereType<String>().toList() : const [];
    return SettingsView(
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
      pluginServers: strings(json['pluginServers']),
      hideHints: _bool(json['hideHints']),
      pluginDirs: strings(json['pluginDirs']),
      disabledPlugins: strings(json['disabledPlugins']),
    );
  }
}

/// `theme.custom.get` / `theme.custom.set` — the stored `[ui.custom_theme]` map.
///
/// The view carries only what the core stores: token name -> `#RRGGBB`. It has
/// **no defaults**: the palette catalogue and every fallback colour live in the
/// shell (`desktop/lib/theme/palette.dart`), so a missing token is absent here
/// and the shell paints crimson for it. Parsing is tolerant of a malformed
/// payload (a non-map, non-string entries or blank values are dropped) because
/// one odd answer must not blank the theme.
class ThemeTokens {
  const ThemeTokens([this.values = const <String, String>{}]);

  /// No overrides: a valid answer on a fresh workspace.
  static const empty = ThemeTokens();

  /// The stored overrides, keyed by token name.
  final Map<String, String> values;

  bool get isEmpty => values.isEmpty;
  int get length => values.length;

  /// One stored token, or null when it has no override.
  String? operator [](String token) => values[token];

  factory ThemeTokens.fromJson(Object? json) {
    if (json is! Map) return ThemeTokens.empty;
    final values = <String, String>{};
    for (final entry in json.entries) {
      final key = entry.key;
      final value = entry.value;
      if (key is String && value is String && value.trim().isNotEmpty) {
        values[key] = value;
      }
    }
    return ThemeTokens(Map<String, String>.unmodifiable(values));
  }

  /// The request body for `theme.custom.set`. An empty map clears the overrides.
  Map<String, dynamic> toJson() => <String, dynamic>{...values};
}

/// `decision.get` / `decision.set` — the optional decision layer's stored view.
///
/// The layer is **off by default** and, in this build, **rules-only**: [enabled]
/// records whether the optional ranking layer may run, and [rulesOnly] is the
/// core's literal `true` because no local model runtime is bundled. The rules
/// themselves (tool set, context-aware shortcuts, file-size limits, side of the
/// wall) are always on and are not a setting.
///
/// [localModelSupported] is `false` and [localModelReason] is the core's one
/// sentence saying why: no local model can classify or rank anything here. The
/// shell renders that sentence; it never offers a control the core cannot honour.
///
/// Parsing is tolerant: a malformed field falls back to the documented default,
/// and an absent `localModel` block reads `supported: false` with no reason, so
/// one odd payload cannot blank the Settings group.
class DecisionView {
  const DecisionView({
    required this.enabled,
    required this.model,
    required this.rulesOnly,
    required this.localModelSupported,
    required this.localModelReason,
  });

  /// The off/rules-only view a workspace with no stored decision layer reports.
  static const disabled = DecisionView(
    enabled: false,
    model: '',
    rulesOnly: true,
    localModelSupported: false,
    localModelReason: '',
  );

  /// Whether the optional ranking layer may run. Always false in this build
  /// unless the user enables it with an empty model.
  final bool enabled;

  /// The stored `decision_layer.model`. Only ever empty in this build.
  final String model;

  /// True when the layer makes rules-only decisions, which is this build.
  final bool rulesOnly;

  /// True when a local model could classify or rank. Always false here.
  final bool localModelSupported;

  /// The core's one-sentence reason the local model is unavailable.
  final String localModelReason;

  factory DecisionView.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    final local = json['localModel'];
    final localModel = local is Map
        ? Map<String, dynamic>.from(local)
        : const <String, dynamic>{};
    // An absent `rulesOnly` still means this build's rules-only mode: a payload
    // that omits the flag must not make the shell claim a local model exists.
    final rulesOnly = json.containsKey('rulesOnly')
        ? _bool(json['rulesOnly'])
        : true;
    return DecisionView(
      enabled: _bool(json['enabled']),
      model: _string(json['model']),
      rulesOnly: rulesOnly,
      localModelSupported: _bool(localModel['supported']),
      localModelReason: _string(localModel['reason']),
    );
  }
}

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

  factory ChatMessageView.fromJson(Map<String, dynamic> json) {
    final outcome = json['outcome'];
    return ChatMessageView(
      id: _string(json['id']),
      role: _string(json['role']),
      text: _string(json['text']),
      outcome: outcome is String && outcome.isNotEmpty ? outcome : null,
    );
  }
}

class ChatUsageView {
  const ChatUsageView({
    required this.tokens,
    required this.costMicroUsd,
    required this.durationMs,
  });

  final int tokens;
  final int? costMicroUsd;
  final int? durationMs;

  factory ChatUsageView.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return ChatUsageView(
      tokens: _int(json['tokens']),
      costMicroUsd: json['costMicroUsd'] is num
          ? _int(json['costMicroUsd'])
          : null,
      durationMs: json['durationMs'] is num ? _int(json['durationMs']) : null,
    );
  }
}

class ChatBlocked {
  const ChatBlocked({required this.reason, required this.fix});

  final String reason;
  final String fix;

  factory ChatBlocked.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return ChatBlocked(
      reason: _string(json['reason']),
      fix: _string(json['fix']),
    );
  }
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

  factory ChatFailure.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return ChatFailure(
      failed: _string(json['failed']),
      kept: _string(json['kept']),
      next: _string(json['next']),
    );
  }
}

class ChatSnapshot {
  const ChatSnapshot({
    required this.status,
    required this.model,
    required this.streamed,
    required this.messages,
    required this.usage,
    this.blocked,
    this.error,
  });

  final String status;
  final String? model;
  final String streamed;
  final List<ChatMessageView> messages;
  final ChatUsageView usage;
  final ChatBlocked? blocked;
  final ChatFailure? error;

  bool get streaming => status == 'streaming';
  bool get hasModel => model != null && model!.isNotEmpty;

  factory ChatSnapshot.fromJson(Map<String, dynamic> json) {
    final model = json['model'];
    final blocked = json['blocked'];
    final error = json['error'];
    return ChatSnapshot(
      status: _string(json['status']),
      model: model is String && model.isNotEmpty ? model : null,
      streamed: _string(json['streamed']),
      messages: _maps(json['messages']).map(ChatMessageView.fromJson).toList(),
      usage: ChatUsageView.fromJson(json['usage']),
      blocked: blocked is Map ? ChatBlocked.fromJson(blocked) : null,
      error: error is Map ? ChatFailure.fromJson(error) : null,
    );
  }
}

/// One agent inside a Work project row (`work.list` / `work.open`).
///
/// The list row carries the shell's flat shape: [task] is the profile's
/// instructions and [permissions] its capability sentence. The full profile
/// (`work.open` agents) is [AgentProfileView].
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

  /// True when the core describes this agent as read-only. The badge is textual
  /// as well as coloured, so the state never relies on colour alone.
  bool get readOnly => permissions.toLowerCase().contains('read');

  factory ProjectAgent.fromJson(Map<String, dynamic> json) => ProjectAgent(
    id: _string(json['id']),
    name: _string(json['name']),
    task: _string(json['task']),
    model: _string(json['model']),
    permissions: _string(json['permissions']),
  );
}

/// `work.list` — one registered Work project.
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

  /// The registered project root. The shell never reads it; the core confines
  /// every project tool to this folder.
  final String folder;

  /// `chat` (single agent) or `swarm` (coordinator plus workers).
  final String mode;

  /// Display name of the swarm; empty for a `chat` project.
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
    agents: _maps(json['agents']).map(ProjectAgent.fromJson).toList(),
  );
}

/// One full agent profile from `work.open`.
///
/// The Work detail edits this profile through `work.agent.save`; the shell
/// never grants a capability itself, it only sends the flags the user chose.
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

  final String id;
  final String name;
  final String role;
  final String instructions;

  /// Empty means the project default model.
  final String model;
  final int maxToolCalls;
  final List<String> allowedTools;
  final bool allowWrite;
  final bool allowCommand;
  final String template;

  /// True when this profile cannot write files or run commands.
  bool get readOnly => !allowWrite && !allowCommand;

  /// The `work.agent.save` input for this profile.
  ///
  /// An empty [id] means **create**: the core generates a stable id from the
  /// name. A present id updates that profile in place, so renaming never breaks
  /// a default that points at it. Every other field is sent verbatim; an empty
  /// [model] is the project default and an empty [allowedTools] is the set the
  /// profile's capabilities permit, both of which are the core's rules.
  Map<String, dynamic> toSaveJson() => {
    if (id.trim().isNotEmpty) 'id': id.trim(),
    'name': name.trim(),
    'role': role.trim(),
    'instructions': instructions.trim(),
    'model': model.trim(),
    'maxToolCalls': maxToolCalls,
    'allowedTools': allowedTools,
    'allowWrite': allowWrite,
    'allowCommand': allowCommand,
    'template': template.trim(),
  };

  factory AgentProfileView.fromJson(Map<String, dynamic> json) =>
      AgentProfileView(
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

/// `work.templates.list` — one row a template picker can offer.
///
/// A template **seeds** an agent editor: choosing one fills [name], [role],
/// [instructions], [maxToolCalls] and [allowedTools], then the profile is still
/// saved through `work.agent.save`. Nothing applies a template implicitly, and
/// the row carries no `allowWrite`/`allowCommand`, so a pick can never grant a
/// capability the user did not turn on.
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

  /// The template id recorded in the profile's free-string `template` field.
  final String id;
  final String name;
  final String role;

  /// The instructions collapsed to one line, for the picker row.
  final String summary;

  /// `built-in` for the three shipped profiles, `project` for a project file.
  final String source;

  /// The instructions a pick copies into the editor, verbatim.
  final String instructions;
  final int maxToolCalls;
  final List<String> allowedTools;

  /// True when this row is one of the shipped profiles. The word is shown beside
  /// the name, so the distinction never relies on colour alone.
  bool get builtin => source == 'built-in';

  factory AgentTemplateRow.fromJson(Map<String, dynamic> json) =>
      AgentTemplateRow(
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

/// `work.permissions.get` / `work.permissions.set` — the global Work opt-in.
///
/// Both flags default to `false` in the core (`config.toml` `[work]`), and they
/// are the **outer** gate on an approval: `work.write.decide` and
/// `work.command.decide` still require the per-action approval and the agent
/// profile's own flag. This view is read-only state; the settings page writes
/// it through the store, never by editing a config file.
class WorkPermissions {
  const WorkPermissions({required this.allowWrite, required this.allowCommand});

  /// The documented default: a fresh workspace refuses every approval.
  static const off = WorkPermissions(allowWrite: false, allowCommand: false);

  /// The global opt-in for applying a proposed write.
  final bool allowWrite;

  /// The global opt-in for running a proposed command.
  final bool allowCommand;

  factory WorkPermissions.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    // A missing payload is the documented default, never an implicit "allowed".
    return WorkPermissions(
      allowWrite: _bool(json['allowWrite']),
      allowCommand: _bool(json['allowCommand']),
    );
  }
}

/// `work.open` — one project with the metadata the detail page renders.
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
    required this.defaultAgent,
    required this.agents,
    required this.tasks,
    required this.hasGit,
    required this.lastOpened,
  });

  final String id;
  final String name;
  final String root;

  /// True when the registered folder vanished after registration. The metadata
  /// still opens; the page says the root is missing instead of pretending.
  final bool rootMissing;
  final String mode;
  final String swarmName;
  final bool archived;
  final String instructions;

  /// The default agent profile id, or null when none is marked default.
  final String? defaultAgent;
  final List<AgentProfileView> agents;
  final int tasks;
  final bool hasGit;

  /// ISO-8601, or empty when the project has never been opened.
  final String lastOpened;

  factory WorkProjectDetail.fromJson(Map<String, dynamic> json) {
    final defaultAgent = json['defaultAgent'];
    return WorkProjectDetail(
      id: _string(json['id']),
      name: _string(json['name']),
      root: _string(json['root']),
      rootMissing: _bool(json['rootMissing']),
      mode: _string(json['mode']),
      swarmName: _string(json['swarmName']),
      archived: _bool(json['archived']),
      instructions: _string(json['instructions']),
      defaultAgent: defaultAgent is String && defaultAgent.isNotEmpty
          ? defaultAgent
          : null,
      agents: _maps(json['agents']).map(AgentProfileView.fromJson).toList(),
      tasks: _int(json['tasks']),
      hasGit: _bool(json['hasGit']),
      lastOpened: _string(json['lastOpened']),
    );
  }
}

/// `work.create` — the id and name the core registered.
///
/// Registration writes `work/projects/<id>/meta.json` only: the project folder
/// is never moved, copied or deleted, so this is not a copy of the detail.
class WorkCreateResult {
  const WorkCreateResult({required this.id, required this.name});

  final String id;
  final String name;

  factory WorkCreateResult.fromJson(Map<String, dynamic> json) =>
      WorkCreateResult(id: _string(json['id']), name: _string(json['name']));
}

/// One changed file in a Work project's read-only Changes summary.
///
/// The row mirrors `work.changes` (`docs/product.md` §8.5). [added] and
/// [removed] are the core's summed line counts (`0` for a binary file), and
/// [staged]/[unstaged] say where that change lives. The shell only formats
/// these values; it never re-reads the repository.
class ChangeFile {
  const ChangeFile({
    required this.path,
    required this.status,
    required this.added,
    required this.removed,
    required this.staged,
    required this.unstaged,
  });

  final String path;

  /// `added`, `modified`, `deleted`, `renamed`, `copied`, `typechange`,
  /// `untracked` or `conflicted`.
  final String status;
  final int added;
  final int removed;
  final bool staged;
  final bool unstaged;

  factory ChangeFile.fromJson(Map<String, dynamic> json) => ChangeFile(
    path: _string(json['path']),
    status: _string(json['status']),
    added: _int(json['added']),
    removed: _int(json['removed']),
    staged: _bool(json['staged']),
    unstaged: _bool(json['unstaged']),
  );
}

/// `work.changes` — the read-only Changes summary for one Work project.
///
/// [available] false is a success, not an error: the folder is gone, is not a
/// git repository, or `git` is not installed. The core then carries [reason]
/// (one of `not a git repository`, `git not found`, `missing folder`) and a
/// one-sentence [message] the page prints in a muted note. When [available] is
/// true the summary describes the working tree and never stages, commits or
/// writes anything.
///
/// Parsing is tolerant: a malformed or absent field falls back to an empty
/// value, so a changes card never throws on a partial payload.
class ChangeSummary {
  const ChangeSummary({
    required this.available,
    required this.branch,
    required this.detached,
    required this.dirty,
    required this.staged,
    required this.unstaged,
    required this.files,
    required this.reason,
    required this.message,
  });

  final bool available;
  final String branch;
  final bool detached;
  final bool dirty;
  final int staged;
  final int unstaged;

  /// Changed files, sorted by [ChangeFile.path] by the core.
  final List<ChangeFile> files;

  /// Why the summary is unavailable. Empty when [available] is true.
  final String reason;

  /// The core's one-sentence explanation for an unavailable summary.
  final String message;

  factory ChangeSummary.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return ChangeSummary(
      available: _bool(json['available']),
      branch: _string(json['branch']),
      detached: _bool(json['detached']),
      dirty: _bool(json['dirty']),
      staged: _int(json['staged']),
      unstaged: _int(json['unstaged']),
      files: _maps(json['files']).map(ChangeFile.fromJson).toList(),
      reason: _string(json['reason']),
      message: _string(json['message']),
    );
  }
}

/// One line of a proposed write's hunk (`work.approvals.list`).
///
/// [kind] is `context`, `add` or `remove`; [text] has no line terminator, which
/// is how the core sends it. The shell colours the line by kind and never
/// recomputes the diff.
class HunkLineView {
  const HunkLineView({required this.kind, required this.text});

  final String kind;
  final String text;

  factory HunkLineView.fromJson(Map<String, dynamic> json) =>
      HunkLineView(kind: _string(json['kind']), text: _string(json['text']));
}

/// One hunk of a proposed write (`work.approvals.list`).
///
/// [index] is the stable index `work.write.decide` accepts. [oldLines] and
/// [newLines] carry terminators and are the strict re-apply contract; the
/// approval screen renders [lines] and never edits either side.
class HunkView {
  const HunkView({
    required this.index,
    required this.oldStart,
    required this.oldCount,
    required this.newStart,
    required this.newCount,
    required this.lines,
    required this.oldLines,
    required this.newLines,
  });

  final int index;
  final int oldStart;
  final int oldCount;
  final int newStart;
  final int newCount;
  final List<HunkLineView> lines;
  final List<String> oldLines;
  final List<String> newLines;

  factory HunkView.fromJson(Map<String, dynamic> json) => HunkView(
    index: _int(json['index']),
    oldStart: _int(json['oldStart']),
    oldCount: _int(json['oldCount']),
    newStart: _int(json['newStart']),
    newCount: _int(json['newCount']),
    lines: _maps(json['lines']).map(HunkLineView.fromJson).toList(),
    oldLines: _strings(json['oldLines']),
    newLines: _strings(json['newLines']),
  );
}

/// The summed line counts of one proposed write (`stats`).
class WriteStats {
  const WriteStats({required this.added, required this.removed});

  static const zero = WriteStats(added: 0, removed: 0);

  final int added;
  final int removed;

  factory WriteStats.fromJson(Object? value) {
    if (value is! Map) return zero;
    return WriteStats(
      added: _int(value['added']),
      removed: _int(value['removed']),
    );
  }
}

/// One write waiting for an approval (`work.approvals.list`).
///
/// This is the **view**, not the proposal: the core never sends `newContent`
/// because the approval screen reviews the diff. [diff] is the whole unified
/// diff, [hunks] are what `work.write.decide` selects between, and [baseHash] is
/// `sha256:` of the bytes the diff was made against (null for a create).
///
/// Parsing is tolerant: a malformed field becomes an empty value so one bad row
/// cannot blank the pending list.
class WorkWriteProposal {
  const WorkWriteProposal({
    required this.id,
    required this.projectId,
    required this.path,
    required this.kind,
    required this.diff,
    required this.hunks,
    required this.stats,
    required this.baseHash,
  });

  final String id;
  final String projectId;

  /// Relative to the project root; never an absolute path.
  final String path;

  /// `create`, `update` or `delete`.
  final String kind;
  final String diff;
  final List<HunkView> hunks;
  final WriteStats stats;

  /// `sha256:<hex>` of the base bytes, or null for a create.
  final String? baseHash;

  factory WorkWriteProposal.fromJson(
    Map<String, dynamic> json, {
    String projectId = '',
  }) {
    final base = json['baseHash'];
    final ownProject = _string(json['projectId']);
    return WorkWriteProposal(
      id: _string(json['id']),
      projectId: ownProject.isEmpty ? projectId : ownProject,
      path: _string(json['path']),
      kind: _string(json['kind']),
      diff: _string(json['diff']),
      hunks: _maps(json['hunks']).map(HunkView.fromJson).toList(),
      stats: WriteStats.fromJson(json['stats']),
      baseHash: base is String && base.isNotEmpty ? base : null,
    );
  }
}

/// One command waiting for an approval (`work.approvals.list`).
///
/// [argv] is an argument array, never a shell line. [risk] is the core's fixed
/// sentence, so the warning cannot be reworded by a model.
class WorkCommandProposal {
  const WorkCommandProposal({
    required this.id,
    required this.projectId,
    required this.argv,
    required this.cwd,
    required this.reason,
    required this.risk,
  });

  final String id;
  final String projectId;
  final List<String> argv;

  /// Relative to the project root; `"."` when the proposal did not name one.
  final String cwd;
  final String reason;
  final String risk;

  factory WorkCommandProposal.fromJson(
    Map<String, dynamic> json, {
    String projectId = '',
  }) {
    final ownProject = _string(json['projectId']);
    return WorkCommandProposal(
      id: _string(json['id']),
      projectId: ownProject.isEmpty ? projectId : ownProject,
      argv: _strings(json['argv']),
      cwd: _string(json['cwd']),
      reason: _string(json['reason']),
      risk: _string(json['risk']),
    );
  }
}

/// `work.command.decide` — what happened to one decided command.
///
/// An approved command is a process the user chose to run, so its result is
/// theirs to see: the exit code, whether it hit the service's time limit, and
/// what it printed. A denial starts nothing and carries no output.
class CommandOutcome {
  const CommandOutcome({
    required this.decision,
    required this.argv,
    required this.cwd,
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    required this.timedOut,
  });

  /// `approve` or `deny`.
  final String decision;
  final List<String> argv;
  final String cwd;

  /// The process's exit code, or null when nothing ran (a denial) or the
  /// process ended without one (a timeout).
  final int? exitCode;
  final String stdout;
  final String stderr;
  final bool timedOut;

  bool get approved => decision == 'approve';

  /// True only for a command that ran to completion and exited 0.
  bool get succeeded => approved && !timedOut && exitCode == 0;

  factory CommandOutcome.fromJson(Map<String, dynamic> json) {
    final code = json['exitCode'];
    return CommandOutcome(
      decision: _string(json['decision']),
      argv: _strings(json['argv']),
      cwd: _string(json['cwd']),
      exitCode: code is num ? code.toInt() : null,
      stdout: _string(json['stdout']),
      stderr: _string(json['stderr']),
      timedOut: _bool(json['timedOut']),
    );
  }
}

/// `work.approvals.list` — the pending writes and commands for one project.
///
/// Both lists are a projection of the core's process memory: a proposal is a
/// value until `work.write.decide` / `work.command.decide` consumes it. The
/// shell never applies or runs anything itself.
class WorkApprovals {
  const WorkApprovals({required this.writes, required this.commands});

  static const empty = WorkApprovals(
    writes: <WorkWriteProposal>[],
    commands: <WorkCommandProposal>[],
  );

  final List<WorkWriteProposal> writes;
  final List<WorkCommandProposal> commands;

  bool get isEmpty => writes.isEmpty && commands.isEmpty;
  bool get isNotEmpty => !isEmpty;
  int get total => writes.length + commands.length;

  factory WorkApprovals.fromJson(Object? value, {String projectId = ''}) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return WorkApprovals(
      writes: _maps(json['writes'])
          .map((row) => WorkWriteProposal.fromJson(row, projectId: projectId))
          .where((write) => write.id.isNotEmpty)
          .toList(),
      commands: _maps(json['commands'])
          .map((row) => WorkCommandProposal.fromJson(row, projectId: projectId))
          .where((command) => command.id.isNotEmpty)
          .toList(),
    );
  }
}

/// One task row on a project's swarm board (`work.swarm.*`).
///
/// [status] is `pending`, `running`, `done`, `failed`, `blocked` or
/// `cancelled`. A worker is always read-only, so nothing here can describe a
/// write or a command; [summary] is the worker's one-line answer and [error] is
/// a failure reason. Parsing is tolerant: a malformed field becomes empty, so
/// one bad row cannot blank the board.
class SwarmTaskRow {
  const SwarmTaskRow({
    required this.id,
    required this.title,
    required this.agentId,
    required this.status,
    this.summary,
    this.error,
    this.requires = const [],
  });

  /// Stable for the life of the run (`task-1`, `task-2`, …).
  final String id;
  final String title;

  /// The agent profile the task ran under; empty means the project default.
  final String agentId;

  /// `pending`, `running`, `done`, `failed`, `blocked` or `cancelled`.
  final String status;

  /// The worker's one-line answer, or null before it settles.
  final String? summary;

  /// A failure reason, metadata only. Null when the task did not fail.
  final String? error;

  /// Task ids this task waited for.
  final List<String> requires;

  /// True when `work.swarm.retry` may start a fresh read-only run for this
  /// task. A running, pending, cancelled or done task is never retried.
  bool get retryable => status == 'failed' || status == 'blocked';

  factory SwarmTaskRow.fromJson(Map<String, dynamic> json) => SwarmTaskRow(
    id: _string(json['id']),
    title: _string(json['title']),
    agentId: _string(json['agentId']),
    status: _string(json['status']),
    summary: _nonEmpty(json['summary']),
    error: _nonEmpty(json['error']),
    requires: json['requires'] is List
        ? (json['requires'] as List).whereType<String>().toList(growable: false)
        : const [],
  );
}

/// Which run and task a retried run was started from (`retryOf`).
class SwarmRetryOf {
  const SwarmRetryOf({required this.runId, required this.taskId});

  final String runId;
  final String taskId;

  factory SwarmRetryOf.fromJson(Map<String, dynamic> json) => SwarmRetryOf(
    runId: _string(json['runId']),
    taskId: _string(json['taskId']),
  );
}

/// One swarm board (`work.swarm.runs`, `work.swarm.board`, a run reply).
///
/// A board is **process state** in the core: a restart forgets every run
/// record, and the report under `work/projects/<id>/reports/` is the durable
/// artefact. [live] is true while workers may still change the rows, so the
/// page shows it as `running` rather than trusting [status] alone.
class SwarmBoardView {
  const SwarmBoardView({
    required this.runId,
    required this.projectId,
    required this.objective,
    required this.status,
    required this.parallel,
    required this.startedAt,
    this.finishedAt,
    this.reportPath,
    this.retryOf,
    required this.live,
    required this.tasks,
  });

  final String runId;
  final String projectId;
  final String objective;

  /// `running`, `done`, `failed` or `cancelled`.
  final String status;

  /// The coordinator's lane width, 1–4.
  final int parallel;

  /// ISO-8601.
  final String startedAt;

  /// ISO-8601 once the run settled, or null while it is still live.
  final String? finishedAt;

  /// Absolute path once the report has been written; null until then.
  final String? reportPath;

  /// Set only on a run created by `work.swarm.retry`.
  final SwarmRetryOf? retryOf;

  /// True while workers may still change the rows.
  final bool live;
  final List<SwarmTaskRow> tasks;

  /// True when the board should read as `running`.
  bool get isRunning => live || status == 'running';

  /// The tasks that failed or were blocked, in board order.
  List<SwarmTaskRow> get retryableTasks => [
    for (final task in tasks)
      if (task.retryable) task,
  ];

  factory SwarmBoardView.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    final rawRetry = json['retryOf'];
    return SwarmBoardView(
      runId: _string(json['runId']),
      projectId: _string(json['projectId']),
      objective: _string(json['objective']),
      status: _string(json['status']),
      parallel: _int(json['parallel']),
      startedAt: _string(json['startedAt']),
      finishedAt: _nonEmpty(json['finishedAt']),
      reportPath: _nonEmpty(json['reportPath']),
      retryOf: rawRetry is Map
          ? SwarmRetryOf.fromJson(Map<String, dynamic>.from(rawRetry))
          : null,
      live: _bool(json['live']),
      tasks: _maps(json['tasks']).map(SwarmTaskRow.fromJson).toList(),
    );
  }
}

/// `work.swarm.run` and `work.swarm.retry` — the id and the board it started.
///
/// The board is sent as soon as the run is registered, so it may still be
/// live; `work.swarm.updated` carries every later change.
class SwarmRunResult {
  const SwarmRunResult({required this.runId, required this.board});

  final String runId;
  final SwarmBoardView board;

  factory SwarmRunResult.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    final board = SwarmBoardView.fromJson(json['board']);
    final rawRun = json['runId'];
    return SwarmRunResult(
      runId: rawRun is String && rawRun.trim().isNotEmpty
          ? rawRun.trim()
          : board.runId,
      board: board,
    );
  }
}

/// One entry of the coordinator's plan sent to `work.swarm.run`.
///
/// An absent [agentId] means the project's default agent. The core trims the
/// strings and enforces its own caps, so this is only the wire shape.
class SwarmPlanEntry {
  const SwarmPlanEntry({
    required this.title,
    required this.assignment,
    this.agentId,
    this.requires = const [],
  });

  final String title;
  final String assignment;

  /// A profile id from `work.open`, or null for the project default.
  final String? agentId;

  /// Earlier task numbers (1-based) this task waits for.
  final List<int> requires;

  Map<String, dynamic> toJson() => {
    'title': title.trim(),
    if (agentId != null && agentId!.trim().isNotEmpty)
      'agentId': agentId!.trim(),
    'assignment': assignment.trim(),
    if (requires.isNotEmpty) 'requires': requires,
  };
}

/// One record of the Work activity log (`activity.list`).
///
/// The log stores **metadata only** (`docs/data-model.md` §6.3): a write or
/// command decision, or one swarm lifecycle event. There is deliberately no
/// file body, diff, prompt, `stdout`/`stderr`, image or secret field here,
/// because the core's per-kind whitelist never writes one. [path] and [cwd] are
/// project-relative, so no absolute path crosses the wire.
///
/// Parsing is tolerant: a malformed or absent field becomes empty, so one odd
/// record cannot blank the log.
class ActivityRecordView {
  const ActivityRecordView({
    required this.kind,
    required this.project,
    required this.at,
    this.path,
    this.decision,
    this.hunks = const <int>[],
    this.argv = const <String>[],
    this.cwd,
    this.exitCode,
    this.durationMs,
    this.timedOut = false,
    this.run,
    this.event,
    this.status,
    this.task,
  });

  /// `write-decision`, `command-decision` or `swarm`.
  final String kind;

  /// The project id, never a path. Ids are stable, so a rename does not split
  /// the history.
  final String project;

  /// ISO-8601.
  final String at;

  /// Project-relative file path; only a write decision carries one.
  final String? path;

  /// `approve` / `reject` on a write, `approve` / `deny` on a command.
  final String? decision;

  /// The hunk indices a write approval applied.
  final List<int> hunks;

  /// The command's arguments; only a command decision carries them.
  final List<String> argv;

  /// The command's working directory, relative to the project root.
  final String? cwd;

  /// The process exit code; null for a denial.
  final int? exitCode;

  /// How long an approved command ran, in milliseconds.
  final int? durationMs;

  /// True when an approved command hit the core's time limit.
  final bool timedOut;

  /// The swarm run id; only a swarm record carries one.
  final String? run;

  /// `started`, `task`, `finished`, `cancelled` or `failed`.
  final String? event;

  /// A task or run status the event carried, when there was one.
  final String? status;

  /// The task id, for a per-task swarm record.
  final String? task;

  factory ActivityRecordView.fromJson(Map<String, dynamic> json) {
    final rawHunks = json['hunks'];
    final rawExit = json['exitCode'];
    final rawDuration = json['durationMs'];
    return ActivityRecordView(
      kind: _string(json['kind']),
      project: _string(json['project']),
      at: _string(json['at']),
      path: _nonEmpty(json['path']),
      decision: _nonEmpty(json['decision']),
      hunks: rawHunks is List
          ? [
              for (final hunk in rawHunks)
                if (hunk is num) hunk.toInt(),
            ]
          : const <int>[],
      argv: _strings(json['argv']),
      cwd: _nonEmpty(json['cwd']),
      exitCode: rawExit is num ? rawExit.toInt() : null,
      durationMs: rawDuration is num ? rawDuration.toInt() : null,
      timedOut: _bool(json['timedOut']),
      run: _nonEmpty(json['run']),
      event: _nonEmpty(json['event']),
      status: _nonEmpty(json['status']),
      task: _nonEmpty(json['task']),
    );
  }
}

/// `activity.list` — the readable records plus the lines that were not.
///
/// [skipped] counts corrupt or truncated lines, which are reported beside the
/// rows and never become an error: one interrupted append must not hide every
/// other decision. [empty] is the core's own flag for a log that does not exist
/// yet — an empty state with a next action, not a failure.
class ActivityListResult {
  const ActivityListResult({
    required this.records,
    required this.skipped,
    required this.empty,
  });

  static const emptyResult = ActivityListResult(
    records: <ActivityRecordView>[],
    skipped: 0,
    empty: true,
  );

  final List<ActivityRecordView> records;
  final int skipped;
  final bool empty;

  factory ActivityListResult.fromJson(Object? value) {
    final json = value is Map
        ? Map<String, dynamic>.from(value)
        : const <String, dynamic>{};
    return ActivityListResult(
      records: _maps(json['records']).map(ActivityRecordView.fromJson).toList(),
      skipped: _int(json['skipped']),
      empty: _bool(json['empty']),
    );
  }
}

String? _nonEmpty(Object? value) {
  if (value is! String) return null;
  final text = value.trim();
  return text.isEmpty ? null : text;
}

class ProviderRow {
  const ProviderRow({
    required this.id,
    required this.label,
    required this.keyRequired,
    required this.baseUrl,
    required this.note,
    required this.linked,
  });

  final String id;
  final String label;
  final bool keyRequired;
  final String baseUrl;
  final String note;
  final bool linked;

  factory ProviderRow.fromJson(Map<String, dynamic> json) => ProviderRow(
    id: _string(json['id']),
    label: _string(json['label']),
    keyRequired: _bool(json['keyRequired']),
    baseUrl: _string(json['baseUrl']),
    note: _string(json['note']),
    linked: _bool(json['linked']),
  );
}

class ProviderLink {
  const ProviderLink({
    required this.providerId,
    required this.models,
    required this.secretRef,
  });

  final String providerId;
  final List<String> models;
  final String secretRef;

  factory ProviderLink.fromJson(Map<String, dynamic> json) {
    final models = json['models'];
    return ProviderLink(
      providerId: _string(json['providerId']),
      models: models is List ? models.whereType<String>().toList() : const [],
      secretRef: _string(json['secretRef']),
    );
  }
}

/// One tool a configured MCP server advertises (`mcp.list`).
///
/// [write] is the core's own classification; the shell only labels it. The row
/// never carries tool *output*, only the name.
class McpToolView {
  const McpToolView({required this.name, required this.write});

  final String name;

  /// True when the tool can change something outside the conversation.
  final bool write;

  factory McpToolView.fromJson(Map<String, dynamic> json) =>
      McpToolView(name: _string(json['name']), write: _bool(json['write']));
}

/// One configured MCP server as the read-only `mcp.*` surface reports it.
///
/// The row carries exactly what a settings page can show: name, transport,
/// enabled flag, connection status and tool names. The core never sends
/// `command`, `args`, `env` or a credential, so there is nothing here to hide.
/// A failed connect is [status] `failed` plus the core's raw [failure] message;
/// the page prints that message and keeps every other row on screen.
class McpServerView {
  const McpServerView({
    required this.name,
    required this.transport,
    required this.enabled,
    required this.status,
    required this.tools,
    this.failure,
  });

  final String name;

  /// `stdio` in v1; carried so the row can say what the server is.
  final String transport;
  final bool enabled;

  /// `connected`, `stopped` or `failed`.
  final String status;
  final List<McpToolView> tools;

  /// The core's own failure message, kept verbatim for the inline row.
  final String? failure;

  bool get failed => failure != null && failure!.isNotEmpty;

  factory McpServerView.fromJson(Map<String, dynamic> json) {
    final rawStatus = json['status'];
    var status = _string(rawStatus);
    var failure = '';
    if (rawStatus is Map) {
      status = 'failed';
      failure = _string(rawStatus['failed']);
    }
    if (status.isEmpty) status = 'stopped';
    return McpServerView(
      name: _string(json['name']),
      transport: _string(json['transport']),
      enabled: _bool(json['enabled']),
      status: status,
      tools: _maps(json['tools']).map(McpToolView.fromJson).toList(),
      failure: failure.isEmpty ? null : failure,
    );
  }
}

/// The stored per-command MCP policy matrix, `command → server → cell`.
///
/// The core returns it verbatim and never invents a cell, so an absent command
/// or server is absent here too and the page prints `default`. Parsing is
/// tolerant: a malformed row or an undocumented cell is dropped rather than
/// thrown on, because a settings page must still render the rest of the
/// snapshot.
class PluginPolicy {
  const PluginPolicy(this.cells);

  static const empty = PluginPolicy(<String, Map<String, String>>{});

  /// `on`, `explicit` or `off`, keyed by command and then server.
  final Map<String, Map<String, String>> cells;

  /// The configured servers for one command, in the core's order.
  Map<String, String> rowFor(String command) =>
      cells[command] ?? const <String, String>{};

  bool get isEmpty => cells.isEmpty;

  factory PluginPolicy.fromJson(Object? value) {
    if (value is! Map) return empty;
    final cells = <String, Map<String, String>>{};
    value.forEach((command, row) {
      if (command is! String || command.isEmpty || row is! Map) return;
      final servers = <String, String>{};
      row.forEach((server, cell) {
        if (server is! String || server.isEmpty || cell is! String) return;
        final normalized = cell.trim().toLowerCase();
        if (!_pluginPolicyCells.contains(normalized)) return;
        servers[server] = normalized;
      });
      if (servers.isNotEmpty) cells[command] = servers;
    });
    return PluginPolicy(cells);
  }
}

const _pluginPolicyCells = <String>{'on', 'explicit', 'off'};

/// One pending plugin write permission prompt (`mcp.permission`).
///
/// The core emits this for every write-capable plugin tool call and waits up to
/// 120 s for `mcp.confirm`. [input] is the model's tool call verbatim: untrusted
/// data the shell renders and never executes or treats as instructions. A second
/// request replaces the first, because the core serialises turns per chat.
class PluginPermissionRequest {
  const PluginPermissionRequest({
    required this.requestId,
    required this.server,
    required this.tool,
    required this.input,
    required this.write,
  });

  /// The opaque id `mcp.confirm` must echo back.
  final String requestId;

  /// The configured MCP server that owns the tool.
  final String server;

  /// The tool the model asked to call.
  final String tool;

  /// The tool call's input, exactly as the model produced it.
  final Object? input;

  /// The core's own write classification, carried so the prompt can say so.
  final bool write;

  factory PluginPermissionRequest.fromJson(Map<String, dynamic> json) =>
      PluginPermissionRequest(
        requestId: _string(json['requestId']),
        server: _string(json['server']),
        tool: _string(json['tool']),
        input: json['input'],
        write: _bool(json['write']),
      );
}

/// One goal in `skill.list` — the Skills manager's projection.
///
/// [stageDone]/[stageTotal] count curriculum stages; [chaptersDone] and
/// [chaptersTotal] are present only for a course, which is why they are
/// nullable. A goal folder whose `meta.json` cannot be read is still a row: the
/// core carries [broken] with its reason instead of hiding or inventing one.
class SkillRow {
  const SkillRow({
    required this.id,
    required this.name,
    required this.stageDone,
    required this.stageTotal,
    required this.lastOpened,
    required this.chats,
    required this.archived,
    this.chaptersDone,
    this.chaptersTotal,
    this.broken,
  });

  final String id;
  final String name;
  final int stageDone;
  final int stageTotal;

  /// Curriculum chapter counts, or null when the folder is not a course.
  final int? chaptersDone;
  final int? chaptersTotal;

  /// ISO-8601; empty when the goal has never been opened.
  final String lastOpened;

  /// The number of saved chats in the goal folder.
  final int chats;
  final bool archived;

  /// The core's own reason when the goal folder cannot be read.
  final String? broken;

  bool get complete => stageTotal > 0 && stageDone >= stageTotal;

  factory SkillRow.fromJson(Map<String, dynamic> json) {
    final stage = json['stage'];
    final stageMap = stage is Map
        ? Map<String, dynamic>.from(stage)
        : const <String, dynamic>{};
    final chapters = json['chapters'];
    final chapterMap = chapters is Map
        ? Map<String, dynamic>.from(chapters)
        : null;
    final broken = json['broken'];
    return SkillRow(
      id: _string(json['id']),
      name: _string(json['name']),
      stageDone: _int(stageMap['done']),
      stageTotal: _int(stageMap['total']),
      chaptersDone: chapterMap == null ? null : _int(chapterMap['done']),
      chaptersTotal: chapterMap == null ? null : _int(chapterMap['total']),
      lastOpened: _string(json['lastOpened']),
      chats: _int(json['chats']),
      archived: _bool(json['archived']),
      broken: broken is String && broken.isNotEmpty ? broken : null,
    );
  }
}

/// One chapter in a goal's course index (`skill.open`).
///
/// [guide] and [practical] are file names inside the goal's `chapters/` folder;
/// the body is read by `skill.chapter`, never from this index. An empty
/// [practical] means the chapter has no exercise.
class SkillChapter {
  const SkillChapter({
    required this.id,
    required this.title,
    required this.guide,
    required this.practical,
    required this.done,
  });

  final String id;
  final String title;
  final String guide;
  final String practical;
  final bool done;

  bool get hasPractical => practical.trim().isNotEmpty;

  factory SkillChapter.fromJson(Map<String, dynamic> json) => SkillChapter(
    id: _string(json['id']),
    title: _string(json['title']),
    guide: _string(json['guide']),
    practical: _string(json['practical']),
    done: _bool(json['done']),
  );
}

/// One saved chat in a goal folder (`skill.open` chats).
class SkillChatRow {
  const SkillChatRow({
    required this.id,
    required this.title,
    required this.lastUsed,
    required this.messages,
  });

  final String id;

  /// The first user message clipped to 60 characters, or the id when empty.
  final String title;

  /// ISO-8601, or empty for a chat with no records yet.
  final String lastUsed;
  final int messages;

  factory SkillChatRow.fromJson(Map<String, dynamic> json) => SkillChatRow(
    id: _string(json['id']),
    title: _string(json['title']),
    lastUsed: _string(json['lastUsed']),
    messages: _int(json['messages']),
  );
}

/// One gathered source in a goal folder (`skill.sources.list`).
///
/// A skill source is a **copy the workspace owns**, so this row carries no
/// original absolute path: [storedPath] is relative to the goal folder and
/// always inside its `sources/`. [excerpt] is the saved excerpt a lesson or a
/// chat can cite, and [excerptLocation] is the copied file it came from; both
/// are null when the source has no usable excerpt.
class SkillSourceRow {
  const SkillSourceRow({
    required this.name,
    required this.storedPath,
    required this.kind,
    required this.hash,
    this.excerpt,
    this.excerptLocation,
  });

  final String name;

  /// Goal-relative, always inside `sources/`. The shell never joins it against
  /// a path of its own.
  final String storedPath;

  /// `markdown`, `text`, `code`, `pdf`, `docx`, `image` or `other`.
  final String kind;

  /// `sha256:<hex>` of the copied bytes.
  final String hash;
  final String? excerpt;
  final String? excerptLocation;

  factory SkillSourceRow.fromJson(Map<String, dynamic> json) {
    final excerpt = _string(json['excerpt']).trim();
    final location = _string(json['excerptLocation']).trim();
    return SkillSourceRow(
      name: _string(json['name']),
      storedPath: _string(json['storedPath']),
      kind: _string(json['kind']),
      hash: _string(json['hash']),
      excerpt: excerpt.isEmpty ? null : excerpt,
      excerptLocation: location.isEmpty ? null : location,
    );
  }
}

/// One curriculum stage in a goal's index (`skill.open` stages).
///
/// A goal is either a **course** (chapters, usually no stages) or a
/// **curriculum** (stages, no chapters); the shell renders whichever the core
/// returned. [id] is what `skill.lesson.read` and `skill.lesson.build` accept,
/// so the stage list is the only place a stage id comes from. [status] is
/// `pending`, `active` or `done`; [milestone] is absent when the goal stores an
/// empty one.
/// One step of a teaching plan (`teach.state` / `teach.measure`).
class TeachingStep {
  const TeachingStep({
    required this.id,
    required this.title,
    this.requires = const [],
  });

  final String id;
  final String title;

  /// The earlier steps this one builds on, by id. Empty means a root.
  ///
  /// A record written before the plan map existed has no `requires`; the state
  /// reader fills in the chain so the map still renders and the next step is
  /// still correct.
  final List<String> requires;

  static TeachingStep fromJson(
    Map<String, dynamic> json, {
    List<String> fallback = const [],
  }) => TeachingStep(
    id: json['id'] is String ? json['id'] as String : '',
    title: json['title'] is String ? json['title'] as String : '',
    requires: json['requires'] is List
        ? (json['requires'] as List).whereType<String>().toList(growable: false)
        : fallback,
  );
}

/// The teaching record the core stores beside a goal.
///
/// `desktop/docs/redesign.md` §2.1: the measure makes both knowledge states
/// concrete — what is held, and the concrete goal — and the plan is the route
/// between them. The UI renders these fields; it never parses prose to guess.
class TeachingState {
  const TeachingState({
    required this.goal,
    required this.prior,
    required this.held,
    required this.gaps,
    required this.plan,
    required this.checks,
    this.current,
    this.practice = const TeachingPractice(
      problems: [],
      solved: {},
      missed: {},
    ),
  });

  /// The record a session has before it is measured.
  static const empty = TeachingState(
    goal: '',
    prior: '',
    held: [],
    gaps: [],
    plan: [],
    checks: [],
  );

  final String goal;
  final String prior;

  /// What the learner is taken to hold: the plan's starting points.
  final List<String> held;

  /// Where the measurement could not decide.
  final List<String> gaps;

  /// The minimal route from held to goal.
  final List<TeachingStep> plan;

  /// Completed checks, newest last.
  final List<TeachingCheckRecord> checks;

  /// The step on screen, when one is open.
  final TeachingStepBody? current;

  /// The practice set, once generated.
  final TeachingPractice practice;

  bool get measured => plan.isNotEmpty;

  /// The index of the step to teach: the first unpassed step whose
  /// prerequisites are held.
  ///
  /// The plan is a dependency map (`desktop/docs/redesign.md` §2.1), not a
  /// queue: a branch whose own prerequisite passed is available even when it
  /// sits after an unrelated branch that has not.
  int get nextIndex {
    final passed = checks
        .where((check) => check.verdict == 'correct')
        .map((check) => check.stepId)
        .toSet();
    for (var index = 0; index < plan.length; index++) {
      final step = plan[index];
      if (passed.contains(step.id)) continue;
      if (step.requires.every(passed.contains)) return index;
    }
    final open = plan.indexWhere((step) => !passed.contains(step.id));
    return open == -1 ? plan.length : open;
  }

  /// How deep a step sits in the prerequisite map, for the map's indentation.
  int depthOf(int index) {
    final seen = <int>{};
    int depth(int current) {
      if (current < 0 || current >= plan.length || !seen.add(current)) return 0;
      final positions = plan[current].requires
          .map((id) => plan.indexWhere((step) => step.id == id))
          .where((position) => position >= 0 && position < current)
          .toList();
      if (positions.isEmpty) return 0;
      return 1 + positions.map(depth).reduce((a, b) => a > b ? a : b);
    }

    return depth(index);
  }

  int get passedCount => plan.where((step) => _passed(step.id)).length;

  bool _passed(String id) =>
      checks.any((check) => check.stepId == id && check.verdict == 'correct');

  /// A plan, with a chain filled in for records written before `requires`.
  static List<TeachingStep> _readPlan(Object? value) {
    if (value is! List) return const [];
    final steps = <TeachingStep>[];
    for (final row in value.whereType<Map>()) {
      final json = Map<String, dynamic>.from(row);
      final id = json['id'] is String ? json['id'] as String : '';
      if (id.isEmpty) continue;
      final fallback = steps.isEmpty ? const <String>[] : [steps.last.id];
      steps.add(TeachingStep.fromJson(json, fallback: fallback));
    }
    return steps;
  }

  static TeachingState fromJson(Map<String, dynamic> json) {
    final state = json['state'] is Map
        ? Map<String, dynamic>.from(json['state'] as Map)
        : const <String, dynamic>{};
    List<String> strings(Object? value) => value is List
        ? value.whereType<String>().toList(growable: false)
        : const <String>[];
    return TeachingState(
      goal: state['goal'] is String ? state['goal'] as String : '',
      prior: state['prior'] is String ? state['prior'] as String : '',
      held: strings(state['held']),
      gaps: strings(state['gaps']),
      plan: _readPlan(state['plan']),
      checks: json['checks'] is List
          ? (json['checks'] as List)
                .whereType<Map>()
                .map(
                  (row) => TeachingCheckRecord.fromJson(
                    Map<String, dynamic>.from(row),
                  ),
                )
                .toList(growable: false)
          : const [],
      current: json['current'] is Map
          ? TeachingStepBody.fromJson(
              Map<String, dynamic>.from(json['current'] as Map),
            )
          : null,
      practice: TeachingPractice.fromJson(
        json['practice'] is Map
            ? Map<String, dynamic>.from(json['practice'] as Map)
            : null,
      ),
    );
  }
}

/// The open step: its prose and its check.
class TeachingStepBody {
  const TeachingStepBody({
    required this.stepId,
    required this.prose,
    required this.question,
    this.citations = const [],
  });

  final String stepId;
  final String prose;
  final String question;

  /// The sources this step quoted. Empty means the step is the model's own
  /// explanation, shown as `agent explanation`.
  final List<TeachingCitation> citations;

  bool get isAgentExplanation => citations.isEmpty;

  static TeachingStepBody fromJson(Map<String, dynamic> json) =>
      TeachingStepBody(
        stepId: json['stepId'] is String ? json['stepId'] as String : '',
        prose: json['prose'] is String ? json['prose'] as String : '',
        question: json['question'] is String ? json['question'] as String : '',
        citations: json['citations'] is List
            ? (json['citations'] as List)
                  .whereType<Map>()
                  .map(
                    (row) => TeachingCitation.fromJson(
                      Map<String, dynamic>.from(row),
                    ),
                  )
                  .where((citation) => citation.name.isNotEmpty)
                  .toList(growable: false)
            : const [],
      );
}

/// One source a step quotes, with the words that prove it.
class TeachingCitation {
  const TeachingCitation({required this.name, required this.quote});

  final String name;
  final String quote;

  static TeachingCitation fromJson(Map<String, dynamic> json) =>
      TeachingCitation(
        name: json['name'] is String ? json['name'] as String : '',
        quote: json['quote'] is String ? json['quote'] as String : '',
      );
}

/// One prompt note (`prompts.list`).
class PromptNoteView {
  const PromptNoteView({
    required this.id,
    required this.label,
    required this.description,
    required this.note,
    required this.custom,
  });

  final String id;
  final String label;
  final String description;
  final String note;
  final bool custom;

  static PromptNoteView fromJson(Map<String, dynamic> json) => PromptNoteView(
    id: json['id'] is String ? json['id'] as String : '',
    label: json['label'] is String ? json['label'] as String : '',
    description: json['description'] is String
        ? json['description'] as String
        : '',
    note: json['note'] is String ? json['note'] as String : '',
    custom: json['custom'] == true,
  );
}

/// The source-grounded learning graph (`knowledge.graph`).
class LearningGraph {
  const LearningGraph({
    required this.nodes,
    required this.edges,
    required this.counts,
    required this.diagnostics,
    required this.truncated,
  });

  static const empty = LearningGraph(
    nodes: [],
    edges: [],
    counts: {},
    diagnostics: [],
    truncated: false,
  );

  final List<LearningNode> nodes;
  final List<LearningEdge> edges;
  final Map<String, int> counts;
  final List<String> diagnostics;
  final bool truncated;

  LearningNode? node(String id) {
    for (final node in nodes) {
      if (node.id == id) return node;
    }
    return null;
  }

  static LearningGraph fromJson(Map<String, dynamic> json) => LearningGraph(
    nodes: json['nodes'] is List
        ? (json['nodes'] as List)
              .whereType<Map>()
              .map(
                (row) => LearningNode.fromJson(Map<String, dynamic>.from(row)),
              )
              .where((node) => node.id.isNotEmpty)
              .toList(growable: false)
        : const [],
    edges: json['edges'] is List
        ? (json['edges'] as List)
              .whereType<Map>()
              .map(
                (row) => LearningEdge.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList(growable: false)
        : const [],
    counts: json['counts'] is Map
        ? {
            for (final entry in (json['counts'] as Map).entries)
              if (entry.key is String && entry.value is int)
                entry.key as String: entry.value as int,
          }
        : const {},
    diagnostics: json['diagnostics'] is List
        ? (json['diagnostics'] as List).whereType<String>().toList(
            growable: false,
          )
        : const [],
    truncated: json['truncated'] == true,
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
  final String detail;
  final String side;
  final String context;
  final String grounded;

  bool get isAgent => grounded == 'agent';

  static LearningNode fromJson(Map<String, dynamic> json) => LearningNode(
    id: json['id'] is String ? json['id'] as String : '',
    kind: json['kind'] is String ? json['kind'] as String : '',
    label: json['label'] is String ? json['label'] as String : '',
    detail: json['detail'] is String ? json['detail'] as String : '',
    side: json['side'] is String ? json['side'] as String : '',
    context: json['context'] is String ? json['context'] as String : '',
    grounded: json['grounded'] is String
        ? json['grounded'] as String
        : 'record',
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

  static LearningEdge fromJson(Map<String, dynamic> json) => LearningEdge(
    from: json['from'] is String ? json['from'] as String : '',
    to: json['to'] is String ? json['to'] as String : '',
    kind: json['kind'] is String ? json['kind'] as String : '',
  );
}

/// One figure cropped from a session's own PDF (`session.figure.*`).
class SessionFigure {
  const SessionFigure({
    required this.id,
    required this.source,
    required this.page,
    required this.caption,
    required this.note,
    required this.file,
    required this.createdAt,
    this.x,
    this.y,
    this.width,
    this.height,
  });

  final String id;
  final String source;
  final int page;
  final String caption;
  final String note;
  final String file;
  final String createdAt;
  final int? x;
  final int? y;
  final int? width;
  final int? height;

  bool get cropped => x != null && y != null && width != null && height != null;

  static SessionFigure fromJson(Map<String, dynamic> json) => SessionFigure(
    id: json['id'] is String ? json['id'] as String : '',
    source: json['source'] is String ? json['source'] as String : '',
    page: json['page'] is int ? json['page'] as int : 0,
    caption: json['caption'] is String ? json['caption'] as String : '',
    note: json['note'] is String ? json['note'] as String : '',
    file: json['file'] is String ? json['file'] as String : '',
    createdAt: json['createdAt'] is String ? json['createdAt'] as String : '',
    x: json['x'] is int ? json['x'] as int : null,
    y: json['y'] is int ? json['y'] as int : null,
    width: json['width'] is int ? json['width'] as int : null,
    height: json['height'] is int ? json['height'] as int : null,
  );
}

/// One saved research brief (`research.list`).
class ResearchItem {
  const ResearchItem({
    required this.id,
    required this.question,
    required this.created,
    required this.sources,
  });

  final String id;
  final String question;
  final String created;
  final List<ResearchSource> sources;

  static ResearchItem fromJson(Map<String, dynamic> json) => ResearchItem(
    id: json['id'] is String ? json['id'] as String : '',
    question: json['question'] is String ? json['question'] as String : '',
    created: json['created'] is String ? json['created'] as String : '',
    sources: json['sources'] is List
        ? (json['sources'] as List)
              .whereType<Map>()
              .map(
                (row) =>
                    ResearchSource.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList(growable: false)
        : const [],
  );
}

class ResearchSource {
  const ResearchSource({required this.url, required this.title});

  final String url;
  final String title;

  static ResearchSource fromJson(Map<String, dynamic> json) => ResearchSource(
    url: json['url'] is String ? json['url'] as String : '',
    title: json['title'] is String ? json['title'] as String : '',
  );
}

/// The conversation's context meter (`session.chat.context`).
class SessionContextView {
  const SessionContextView({
    required this.messages,
    required this.kept,
    required this.summaryChars,
    required this.through,
    required this.tokens,
    required this.window,
    required this.fraction,
    required this.compactable,
    this.summary,
  });

  static const empty = SessionContextView(
    messages: 0,
    kept: 0,
    summaryChars: 0,
    through: 0,
    tokens: 0,
    window: 0,
    fraction: 0,
    compactable: false,
  );

  final int messages;
  final int kept;
  final int summaryChars;
  final int through;
  final int tokens;
  final int window;
  final double fraction;
  final bool compactable;
  final String? summary;

  bool get compacted => through > 0 && summaryChars > 0;

  static SessionContextView fromJson(Map<String, dynamic> json) =>
      SessionContextView(
        messages: json['messages'] is int ? json['messages'] as int : 0,
        kept: json['kept'] is int ? json['kept'] as int : 0,
        summaryChars: json['summaryChars'] is int
            ? json['summaryChars'] as int
            : 0,
        through: json['through'] is int ? json['through'] as int : 0,
        tokens: json['tokens'] is int ? json['tokens'] as int : 0,
        window: json['window'] is int ? json['window'] as int : 0,
        fraction: json['fraction'] is num
            ? (json['fraction'] as num).toDouble()
            : 0,
        compactable: json['compactable'] == true,
        summary: json['summary'] is String ? json['summary'] as String : null,
      );
}

/// One card's spaced-repetition state (`session.deck.*`).
class DeckCardSchedule {
  const DeckCardSchedule({
    required this.index,
    required this.question,
    required this.due,
    required this.dueAt,
    required this.intervalDays,
    required this.ease,
    required this.reps,
    required this.lapses,
    this.lastGrade,
  });

  final int index;
  final String question;
  final bool due;
  final String dueAt;
  final double intervalDays;
  final double ease;
  final int reps;
  final int lapses;
  final String? lastGrade;

  static DeckCardSchedule fromJson(Map<String, dynamic> json) =>
      DeckCardSchedule(
        index: json['index'] is int ? json['index'] as int : 0,
        question: json['question'] is String ? json['question'] as String : '',
        due: json['due'] == true,
        dueAt: json['dueAt'] is String ? json['dueAt'] as String : '',
        intervalDays: json['intervalDays'] is num
            ? (json['intervalDays'] as num).toDouble()
            : 0,
        ease: json['ease'] is num ? (json['ease'] as num).toDouble() : 2.5,
        reps: json['reps'] is int ? json['reps'] as int : 0,
        lapses: json['lapses'] is int ? json['lapses'] as int : 0,
        lastGrade: json['lastGrade'] is String
            ? json['lastGrade'] as String
            : null,
      );
}

/// A session's whole schedule, in deck order.
class DeckSchedule {
  const DeckSchedule({
    required this.due,
    required this.total,
    required this.cards,
  });

  static const empty = DeckSchedule(due: 0, total: 0, cards: []);

  final int due;
  final int total;
  final List<DeckCardSchedule> cards;

  static DeckSchedule fromJson(Map<String, dynamic> json) => DeckSchedule(
    due: json['due'] is int ? json['due'] as int : 0,
    total: json['total'] is int ? json['total'] as int : 0,
    cards: json['cards'] is List
        ? (json['cards'] as List)
              .whereType<Map>()
              .map(
                (row) =>
                    DeckCardSchedule.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList(growable: false)
        : const [],
  );
}

/// The result of `update.check`.
///
/// `kind` is `available`, `current` or `unavailable`. An available build
/// carries the release page, never a download: the desktop app cannot replace
/// its own bundle from here.
class UpdateView {
  const UpdateView({
    required this.current,
    required this.kind,
    this.version,
    this.latest,
    this.asset,
    this.url,
    this.message,
  });

  final String current;
  final String kind;
  final String? version;
  final String? latest;
  final String? asset;
  final String? url;
  final String? message;

  bool get available => kind == 'available';
  bool get currentBuild => kind == 'current';

  static UpdateView fromJson(Map<String, dynamic> json) => UpdateView(
    current: json['current'] is String ? json['current'] as String : '',
    kind: json['kind'] is String ? json['kind'] as String : 'unavailable',
    version: json['version'] is String ? json['version'] as String : null,
    latest: json['latest'] is String ? json['latest'] as String : null,
    asset: json['asset'] is String ? json['asset'] as String : null,
    url: json['url'] is String ? json['url'] as String : null,
    message: json['message'] is String ? json['message'] as String : null,
  );
}

/// One message in a step's side thread (`teach.side.*`).
///
/// A side thread is a small, tool-free conversation about one step. It is not
/// the lesson chat: it never enters the transcript and never changes the plan.
class TeachingSideMessage {
  const TeachingSideMessage({
    required this.role,
    required this.text,
    this.at = '',
  });

  final String role;
  final String text;
  final String at;

  bool get isUser => role == 'user';

  static TeachingSideMessage fromJson(Map<String, dynamic> json) =>
      TeachingSideMessage(
        role: json['role'] is String ? json['role'] as String : '',
        text: json['text'] is String ? json['text'] as String : '',
        at: json['at'] is String ? json['at'] as String : '',
      );
}

/// One completed check.
class TeachingCheckRecord {
  const TeachingCheckRecord({
    required this.stepId,
    required this.verdict,
    required this.correction,
    this.thinking,
    this.confidence,
    this.citations = const [],
  });

  final String stepId;
  final String verdict;
  final String correction;

  /// The learner's own reasoning, when they wrote any.
  final String? thinking;

  /// Self-reported 1–5 confidence, when they gave one.
  final int? confidence;

  /// The citations the step carried when it was checked.
  final List<TeachingCitation> citations;

  static TeachingCheckRecord fromJson(
    Map<String, dynamic> json,
  ) => TeachingCheckRecord(
    stepId: json['stepId'] is String ? json['stepId'] as String : '',
    verdict: json['verdict'] is String ? json['verdict'] as String : '',
    correction: json['correction'] is String
        ? json['correction'] as String
        : '',
    thinking: json['thinking'] is String ? json['thinking'] as String : null,
    confidence: json['confidence'] is int ? json['confidence'] as int : null,
    citations: json['citations'] is List
        ? (json['citations'] as List)
              .whereType<Map>()
              .map(
                (row) =>
                    TeachingCitation.fromJson(Map<String, dynamic>.from(row)),
              )
              .toList(growable: false)
        : const [],
  );
}

/// One practice problem: a task and a criterion to judge against.
class TeachingProblem {
  const TeachingProblem({
    required this.id,
    required this.prompt,
    required this.answer,
  });

  final String id;
  final String prompt;
  final String answer;

  static TeachingProblem fromJson(Map<String, dynamic> json) => TeachingProblem(
    id: json['id'] is String ? json['id'] as String : '',
    prompt: json['prompt'] is String ? json['prompt'] as String : '',
    answer: json['answer'] is String ? json['answer'] as String : '',
  );
}

/// The practice set and what has been answered in it.
class TeachingPractice {
  const TeachingPractice({
    required this.problems,
    required this.solved,
    required this.missed,
  });

  final List<TeachingProblem> problems;

  /// Problem ids answered `solved`.
  final Set<String> solved;

  /// Problem ids answered `missed`.
  final Set<String> missed;

  bool get empty => problems.isEmpty;

  static TeachingPractice fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const TeachingPractice(problems: [], solved: {}, missed: {});
    }
    final problems = json['problems'] is List
        ? (json['problems'] as List)
              .whereType<Map>()
              .map(
                (row) =>
                    TeachingProblem.fromJson(Map<String, dynamic>.from(row)),
              )
              .where((problem) => problem.id.isNotEmpty)
              .toList(growable: false)
        : const <TeachingProblem>[];
    final solved = <String>{};
    final missed = <String>{};
    if (json['attempts'] is List) {
      for (final row in json['attempts'] as List) {
        if (row is! Map) continue;
        final id = row['problemId'];
        if (id is! String) continue;
        if (row['verdict'] == 'solved') {
          solved.add(id);
          missed.remove(id);
        } else if (row['verdict'] == 'missed') {
          missed.add(id);
          solved.remove(id);
        }
      }
    }
    return TeachingPractice(problems: problems, solved: solved, missed: missed);
  }
}

/// The verdict of one answer (`teach.check`).
class TeachingCheckResult {
  const TeachingCheckResult({
    required this.verdict,
    required this.correction,
    required this.passed,
    required this.nextIndex,
    required this.total,
  });

  final String verdict;
  final String correction;
  final bool passed;
  final int nextIndex;
  final int total;

  static TeachingCheckResult fromJson(Map<String, dynamic> json) =>
      TeachingCheckResult(
        verdict: json['verdict'] is String ? json['verdict'] as String : '',
        correction: json['correction'] is String
            ? json['correction'] as String
            : '',
        passed: json['passed'] == true,
        nextIndex: json['nextIndex'] is int ? json['nextIndex'] as int : 0,
        total: json['total'] is int ? json['total'] as int : 0,
      );
}

class SkillStage {
  const SkillStage({
    required this.id,
    required this.title,
    required this.status,
    this.milestone,
  });

  final String id;
  final String title;

  /// `pending`, `active` or `done`.
  final String status;

  /// The stage's concrete milestone, or null when it has none.
  final String? milestone;

  bool get done => status == 'done';
  bool get active => status == 'active';

  factory SkillStage.fromJson(Map<String, dynamic> json) {
    final milestone = _string(json['milestone']).trim();
    return SkillStage(
      id: _string(json['id']),
      title: _string(json['title']),
      status: _string(json['status']),
      milestone: milestone.isEmpty ? null : milestone,
    );
  }
}

/// `skill.stages.save` — the curriculum the core stored, in order.
///
/// The reply is the whole list, so the shell replaces its copy from this and
/// never guesses what the core did with a new stage's id or a kept status.
/// [stages] is empty only when the goal now has no stages at all.
class SkillStageSaveResult {
  const SkillStageSaveResult({required this.stages});

  final List<SkillStage> stages;

  factory SkillStageSaveResult.fromJson(Map<String, dynamic> json) =>
      SkillStageSaveResult(
        stages: _maps(json['stages']).map(SkillStage.fromJson).toList(),
      );
}

/// `skill.archive` / `skill.export` — the action the core took.
///
/// [action] is the verb the core echoed (`archive`, `export`); [backend] is the
/// archive that took the goal (`folder` or `github`), null when the core did not
/// name one; [path] is the zip the core wrote, null when it did not name one.
/// Both optional values are absent rather than empty strings.
class SkillActionOutcome {
  const SkillActionOutcome({required this.action, this.backend, this.path});

  final String action;
  final String? backend;
  final String? path;

  factory SkillActionOutcome.fromJson(Map<String, dynamic> json) {
    final backend = _string(json['backend']).trim();
    final path = _string(json['path']).trim();
    return SkillActionOutcome(
      action: _string(json['action']),
      backend: backend.isEmpty ? null : backend,
      path: path.isEmpty ? null : path,
    );
  }
}

/// One source citation a built lesson carries (`skill.lesson.build`).
///
/// [name] is the gathered source's name, [location] is its path relative to the
/// goal folder and [excerpt] is the saved text the claim came from. A built
/// lesson cites only these; an unsourced paragraph is labelled
/// `(agent explanation)` by the core.
typedef SkillCitation = ({String name, String location, String excerpt});

/// `skill.lesson.read` / `skill.lesson.build` — one staged lesson.
///
/// A read reports [exists] false as a success (the reader's empty state with a
/// build next action); [status] is then empty and [citations] is empty. A build
/// reports the lesson's own [markdown] and its [status] (`draft` or `ready`) plus
/// the [citations] the frontmatter records. The shell renders [markdown]
/// directly; it never reads the lesson file.
class SkillLessonResult {
  const SkillLessonResult({
    required this.markdown,
    required this.exists,
    required this.status,
    required this.citations,
  });

  final String markdown;

  /// False when the stage has no lesson file yet.
  final bool exists;

  /// `draft`, `ready`, or empty for a read.
  final String status;
  final List<SkillCitation> citations;

  bool get built => status.isNotEmpty;

  factory SkillLessonResult.read(Map<String, dynamic> json) =>
      SkillLessonResult(
        markdown: _string(json['markdown']),
        exists: _bool(json['exists']),
        status: '',
        citations: const [],
      );

  factory SkillLessonResult.build(Map<String, dynamic> json) {
    final markdown = _string(json['markdown']);
    return SkillLessonResult(
      markdown: markdown,
      exists: markdown.trim().isNotEmpty,
      status: _string(json['status']),
      citations: _maps(json['citations']).map((row) {
        return (
          name: _string(row['name']),
          location: _string(row['location']),
          excerpt: _string(row['excerpt']),
        );
      }).toList(),
    );
  }
}

/// `skill.open` — one goal's course index and its saved chats.
///
/// This is the page, not the lesson: [chapters] carries titles and file names
/// only. [stages] is the curriculum when the goal has one, and is what the
/// staged-lesson reader selects from. [plan] is `model` or `template`; a course
/// that predates the plan flag is reported as `template` by the core.
class SkillDetail {
  const SkillDetail({
    required this.id,
    required this.name,
    required this.goal,
    required this.prior,
    required this.created,
    required this.plan,
    required this.chapters,
    required this.chats,
    this.stages = const [],
  });

  final String id;
  final String name;
  final String goal;
  final String prior;
  final String created;

  /// `model` or `template`.
  final String plan;
  final List<SkillChapter> chapters;
  final List<SkillChatRow> chats;
  final List<SkillStage> stages;

  bool get modelPlan => plan == 'model';
  bool get hasStages => stages.isNotEmpty;

  factory SkillDetail.fromJson(Map<String, dynamic> json) => SkillDetail(
    id: _string(json['id']),
    name: _string(json['name']),
    goal: _string(json['goal']),
    prior: _string(json['prior']),
    created: _string(json['created']),
    plan: _string(json['plan']),
    chapters: _maps(json['chapters']).map(SkillChapter.fromJson).toList(),
    chats: _maps(json['chats']).map(SkillChatRow.fromJson).toList(),
    stages: _maps(json['stages']).map(SkillStage.fromJson).toList(),
  );
}

/// `skill.create` — the id, name and plan source the core wrote.
///
/// Creation makes **no provider call**: the curriculum is the built-in template
/// plan until a model-written plan ships, so [plan] is `template` today. The
/// shell calls `skill.open` for the chapters, so this is deliberately not a
/// second copy of [SkillDetail].
class SkillCreateResult {
  const SkillCreateResult({
    required this.id,
    required this.name,
    required this.plan,
  });

  final String id;

  /// The goal text clipped by the core; it is also the course name.
  final String name;

  /// `model` or `template`. A course built before the flag existed reports
  /// `template`, which is what it was.
  final String plan;

  bool get templatePlan => plan != 'model';

  factory SkillCreateResult.fromJson(Map<String, dynamic> json) =>
      SkillCreateResult(
        id: _string(json['id']),
        name: _string(json['name']),
        plan: _string(json['plan']),
      );
}

/// `skill.chapter` — one chapter body and the header it belongs to.
///
/// The core returns the file's own Markdown bytes in [text], plus [practical]
/// and the chapter id/title so the reader header needs no second lookup. The
/// shell renders [text] directly; it never reads the chapter file.
class SkillChapterBody {
  const SkillChapterBody({
    required this.text,
    required this.practical,
    required this.chapterId,
    required this.chapterTitle,
  });

  final String text;
  final bool practical;
  final String chapterId;
  final String chapterTitle;

  factory SkillChapterBody.fromJson(Map<String, dynamic> json) {
    final chapter = json['chapter'];
    final chapterMap = chapter is Map
        ? Map<String, dynamic>.from(chapter)
        : const <String, dynamic>{};
    return SkillChapterBody(
      text: _string(json['text']),
      practical: _bool(json['practical']),
      chapterId: _string(chapterMap['id']),
      chapterTitle: _string(chapterMap['title']),
    );
  }
}

/// One row in the read-only Review queue (`review.queue`).
///
/// The core decides what needs attention; the shell only labels and orders it.
/// [kind] is `card`, `step`, `stage` or `memory` — an unknown kind is kept
/// verbatim so a newer core still renders — [reason] is the core's own short
/// reason (`missed`, `unchecked`, …) and [count] is the recorded miss count.
class ReviewItem {
  const ReviewItem({
    required this.id,
    required this.kind,
    required this.label,
    required this.context,
    required this.contextId,
    required this.reason,
    required this.priority,
    required this.count,
    required this.origin,
  });

  final String id;
  final String kind;
  final String label;
  final String context;
  final String contextId;
  final String reason;
  final int priority;
  final int count;

  /// Where the item came from: `steps`, `flashcards`, `curriculum`, `memory`.
  final String origin;

  factory ReviewItem.fromJson(Map<String, dynamic> json) => ReviewItem(
    id: _string(json['id']),
    kind: _string(json['kind']),
    label: _string(json['label']),
    context: _string(json['context']),
    contextId: _string(json['contextId']),
    reason: _string(json['reason']),
    priority: _int(json['priority']),
    count: _int(json['count']),
    origin: _string(json['origin']),
  );
}

/// The adaptive-nudge state the core reports with the queue.
///
/// [due] is the ids of items that crossed the configured threshold and
/// [suggestions] is the core's short copy; the shell prints it, never invents
/// one, and a missing nudge is simply absent.
class ReviewNudge {
  const ReviewNudge({
    required this.intensity,
    required this.threshold,
    required this.due,
    required this.suggestions,
  });

  /// `gentle`, `balanced` or `intensive`.
  final String intensity;
  final int threshold;
  final List<String> due;
  final List<String> suggestions;

  factory ReviewNudge.fromJson(Object? value) {
    if (value is! Map) {
      return const ReviewNudge(
        intensity: '',
        threshold: 0,
        due: <String>[],
        suggestions: <String>[],
      );
    }
    return ReviewNudge(
      intensity: _string(value['intensity']),
      threshold: _int(value['threshold']),
      due: _strings(value['due']),
      suggestions: _strings(value['suggestions']),
    );
  }
}

/// Per-kind totals for the queue (`counts.byKind`), parsed tolerantly.
class ReviewCounts {
  const ReviewCounts({required this.total, required this.byKind});

  static const zero = ReviewCounts(total: 0, byKind: <String, int>{});

  final int total;

  /// `card`, `step`, `stage` and `memory` totals; an absent kind is zero.
  final Map<String, int> byKind;

  int countFor(String kind) => byKind[kind] ?? 0;

  factory ReviewCounts.fromJson(Object? value) {
    if (value is! Map) return zero;
    final byKind = <String, int>{};
    final raw = value['byKind'];
    if (raw is Map) {
      raw.forEach((kind, count) {
        if (kind is! String || kind.isEmpty || count is! num) return;
        byKind[kind] = count.toInt();
      });
    }
    return ReviewCounts(total: _int(value['total']), byKind: byKind);
  }
}

/// One skipped folder the queue could not read (`review.queue` diagnostics).
///
/// A diagnostic is **not** a request failure: the queue still renders and the
/// page prints [message] with the core's [next] action.
class ReviewDiagnostic {
  const ReviewDiagnostic({
    required this.kind,
    required this.path,
    required this.message,
    required this.next,
  });

  final String kind;
  final String path;
  final String message;

  /// One actionable sentence from the core.
  final String next;

  factory ReviewDiagnostic.fromJson(Map<String, dynamic> json) =>
      ReviewDiagnostic(
        kind: _string(json['kind']),
        path: _string(json['path']),
        message: _string(json['message']),
        next: _string(json['next']),
      );
}

/// One session's coverage row on the Review surface (`review.queue.coverage`).
///
/// The report is the same `CoverageReport` `session.coverage` returns for that
/// session, so the two surfaces cannot disagree. [sessionId] is a folder name,
/// never a path, and [name] is the session's display name.
class SessionCoverageRow {
  const SessionCoverageRow({
    required this.sessionId,
    required this.name,
    required this.report,
  });

  final String sessionId;
  final String name;
  final CoverageReport report;

  /// The name to show, falling back to the id when the session has none.
  String get displayName {
    final title = name.trim();
    return title.isEmpty ? sessionId : title;
  }

  factory SessionCoverageRow.fromJson(Map<String, dynamic> json) =>
      SessionCoverageRow(
        sessionId: _string(json['sessionId']),
        name: _string(json['name']),
        report: CoverageReport.fromJson(json['report']),
      );
}

/// `review.queue` — the read-only Review snapshot.
///
/// Parsing is tolerant: a malformed row or an absent section is dropped rather
/// than thrown on, because the page must still render the rest of a snapshot a
/// newer core sent.
class ReviewQueue {
  const ReviewQueue({
    required this.items,
    this.nudge,
    required this.counts,
    required this.diagnostics,
    required this.intensity,
    this.coverage = const <SessionCoverageRow>[],
  });

  static const empty = ReviewQueue(
    items: <ReviewItem>[],
    counts: ReviewCounts.zero,
    diagnostics: <ReviewDiagnostic>[],
    intensity: 'balanced',
  );

  final List<ReviewItem> items;
  final ReviewNudge? nudge;
  final ReviewCounts counts;
  final List<ReviewDiagnostic> diagnostics;

  /// The nudge intensity the queue was built with.
  final String intensity;

  /// Each readable school session's source coverage, one entry per session.
  ///
  /// Derived, never stored: it is the same report `session.coverage` returns. A
  /// skills projection carries no rows, and a core that predates the field
  /// parses to an empty list so the page shows no extra line.
  final List<SessionCoverageRow> coverage;

  bool get isEmpty => items.isEmpty;

  int get total => counts.total;

  factory ReviewQueue.fromJson(Object? value) {
    if (value is! Map) return empty;
    final rawNudge = value['nudge'];
    return ReviewQueue(
      items: _maps(value['items']).map(ReviewItem.fromJson).toList(),
      nudge: rawNudge is Map ? ReviewNudge.fromJson(rawNudge) : null,
      counts: ReviewCounts.fromJson(value['counts']),
      diagnostics: _maps(value['diagnostics'])
          .map(ReviewDiagnostic.fromJson)
          .toList(),
      intensity: _string(value['intensity']),
      coverage: _maps(value['coverage'])
          .map(SessionCoverageRow.fromJson)
          .where((row) {
            return row.sessionId.isNotEmpty;
          })
          .toList(),
    );
  }
}

/// One Knowledge search result (`knowledge.search`).
///
/// The Knowledge surface is read-only and unified: a hit is a projection of what
/// the workspace already stores, never a new fact. [kind] is one of `note`,
/// `memory`, `source`, `session`, `goal`, `project` or `archive` — an unknown
/// kind is kept verbatim so a newer core still renders — and [side] is the wall
/// the row belongs to (`school`, `skills`, `work`). [path] is workspace-relative
/// and never a filesystem path the shell may open.
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

  /// ISO-8601 instant, rendered as its date part.
  final String updated;

  /// The core's own ranking score; `0` when it sent none.
  final double score;

  /// True for material the product labels **history**, not a fact: session
  /// memory and the source excerpts gathered with it. The page marks these so a
  /// remembered line is never mistaken for a new source claim.
  bool get isHistory => kind == 'memory' || kind == 'source';

  /// The title to show, falling back to the path when the core sent none.
  String get displayTitle {
    final text = title.trim();
    return text.isEmpty ? path : text;
  }

  factory KnowledgeHit.fromJson(Map<String, dynamic> json) => KnowledgeHit(
    id: _string(json['id']),
    kind: _string(json['kind']).toLowerCase(),
    title: _string(json['title']),
    excerpt: _string(json['excerpt']),
    side: _string(json['side']).toLowerCase(),
    path: _string(json['path']),
    updated: _string(json['updated']),
    score: _score(json['score']),
  );

  /// A score from a number or a numeric string; anything else is zero.
  static double _score(Object? value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value.trim()) ?? 0;
    return 0;
  }
}

/// One note under a topic in the Knowledge tree (`knowledge.tree`).
///
/// [path] is workspace-relative; the reader that opens it (`KnowledgeReader`)
/// receives the same id from the tree.
class KnowledgeNote {
  const KnowledgeNote({
    required this.path,
    required this.title,
    required this.updated,
  });

  final String path;
  final String title;

  /// ISO-8601 instant, rendered as its date part.
  final String updated;

  /// The title to show, falling back to the path when the core sent none.
  String get displayTitle {
    final text = title.trim();
    return text.isEmpty ? path : text;
  }

  factory KnowledgeNote.fromJson(Map<String, dynamic> json) => KnowledgeNote(
    path: _string(json['path']),
    title: _string(json['title']),
    updated: _string(json['updated']),
  );
}

/// One topic heading plus its notes (`knowledge.tree.groups`).
///
/// A topic with no notes is kept: the core owns the tree shape, and an empty
/// topic still tells the user where a vault sits. Parsing is tolerant, because
/// one malformed row must not blank the whole tree.
class KnowledgeGroup {
  const KnowledgeGroup({required this.topic, required this.notes});

  final String topic;
  final List<KnowledgeNote> notes;

  factory KnowledgeGroup.fromJson(Map<String, dynamic> json) => KnowledgeGroup(
    topic: _string(json['topic']),
    notes: _maps(json['notes']).map(KnowledgeNote.fromJson).toList(),
  );
}

/// One Knowledge item's body (`knowledge.read`): the row the id names plus the
/// text the core read for it.
///
/// A vault note's Markdown, a session memory note or the extracted text of a
/// copied source all arrive here as `body`. The shell renders the body and never
/// reads the file itself, so [KnowledgeHit.path] stays a workspace-relative
/// label rather than a path the UI may open.
///
/// [truncated] says the core capped the body: the reader then says the document
/// on screen is not the whole file instead of pretending it is complete.
///
/// Parsing is tolerant — a malformed `hit` becomes an empty row rather than
/// blanking the reader — because the body is still worth showing.
class KnowledgeDocument {
  const KnowledgeDocument({
    required this.hit,
    required this.body,
    this.truncated = false,
  });

  /// The row this body belongs to, as the core re-reported it.
  final KnowledgeHit hit;

  /// The document text: Markdown for a note or memory, plain text for a source.
  final String body;

  /// True when the core cut the body to a safe size.
  final bool truncated;

  /// True when the core sent no text at all.
  bool get hasNoBody => body.trim().isEmpty;

  factory KnowledgeDocument.fromJson(Map<String, dynamic> json) {
    final raw = json['hit'];
    return KnowledgeDocument(
      hit: KnowledgeHit.fromJson(
        raw is Map ? Map<String, dynamic>.from(raw) : const <String, dynamic>{},
      ),
      body: _string(json['body']),
      truncated: _bool(json['truncated']),
    );
  }
}

/// The two stored keybind tables (`keybinds.get` / `keybinds.set`).
///
/// `ui.keybinds` holds leader and direct chords; `ui.fixed_keybinds` holds the
/// mode and navigation keys. Both are `action id -> documented string form`, and
/// an empty string is a cleared override, so it is dropped here: the shell's
/// registry then applies its own default. The shell never invents a binding.
class KeybindMaps {
  const KeybindMaps({
    this.keybinds = const <String, String>{},
    this.fixedKeybinds = const <String, String>{},
  });

  static const empty = KeybindMaps();

  final Map<String, String> keybinds;
  final Map<String, String> fixedKeybinds;

  factory KeybindMaps.fromJson(Object? value) {
    Map<String, String> table(Object? raw) {
      if (raw is! Map) return const <String, String>{};
      final entries = <String, String>{};
      raw.forEach((key, entry) {
        if (key is! String || key.trim().isEmpty) return;
        if (entry is! String) return;
        final binding = entry.trim();
        if (binding.isEmpty) return;
        entries[key] = binding.toLowerCase();
      });
      return entries;
    }

    if (value is! Map) return empty;
    return KeybindMaps(
      keybinds: table(value['keybinds']),
      fixedKeybinds: table(value['fixedKeybinds']),
    );
  }
}

/// One achievement row (`achievements.list`).
///
/// The core sends one row per catalogue entry, in catalogue order, so the shell
/// never keeps a copy of the list. [value] is the bar value (clamped to
/// [target] by the core) and [progress] is the raw counter, which lets an
/// over-achieved row read `142 / 100` while the bar stays full.
///
/// [unlocked] and [awardedAt] are the core's own award record: the page never
/// infers an unlock from the counter, because a dev build unlocks the whole
/// catalogue on purpose and a release build does not.
///
/// Parsing is tolerant: a missing or mistyped field falls back to an empty row
/// rather than dropping a catalogue entry the core sent.
class AchievementRow {
  const AchievementRow({
    this.id = '',
    this.name = '',
    this.task = '',
    this.category = '',
    this.metric = '',
    this.target = 0,
    this.value = 0,
    this.progress = 0,
    this.unlocked = false,
    this.difficulty = '',
    this.awardedAt,
  });

  /// Stable catalogue id, e.g. `first-light`.
  final String id;

  /// Display name, e.g. `First Light`.
  final String name;

  /// One sentence describing what earns it.
  final String task;

  /// `starter`, `learning`, `work` or `collection`. Any other value is kept as
  /// sent so the page can group it rather than lose the row.
  final String category;

  /// The counter the achievement measures (`messages`, `steps`, `sessions`, …).
  final String metric;

  /// The milestone the counter must reach.
  final int target;

  /// The bar value: `min(progress, target)`.
  final int value;

  /// The raw counter, uncapped.
  final int progress;

  /// True when the core recorded the achievement as earned.
  final bool unlocked;

  /// The `easiest … legendary` band derived from [target]; presentational only.
  final String difficulty;

  /// The stored `YYYY-MM-DD` award day, or null when there is none.
  final String? awardedAt;

  /// The bar's fill between 0 and 1.
  double get fraction {
    if (target <= 0) return unlocked ? 1 : 0;
    return (value / target).clamp(0.0, 1.0);
  }

  factory AchievementRow.fromJson(Map<String, dynamic> json) {
    final awardedAt = json['awardedAt'];
    return AchievementRow(
      id: _string(json['id']),
      name: _string(json['name']),
      task: _string(json['task']),
      category: _string(json['category']),
      metric: _string(json['metric']),
      target: _int(json['target']),
      value: _int(json['value']),
      progress: _int(json['progress']),
      unlocked: _bool(json['unlocked']),
      difficulty: _string(json['difficulty']),
      awardedAt: awardedAt is String && awardedAt.trim().isNotEmpty
          ? awardedAt
          : null,
    );
  }
}
