// GENERATED FILE — do not edit by hand.
// dart format off
//
// Generated from the exported types in `src/server/protocol.ts`.
// Regenerate: `bun run scripts/generate-dart-models.ts`.
//
// The shell reads these models from the wire; every field is tolerant of a
// missing or mistyped value so one odd reply cannot blank a surface.

String _string(Object? value) => value is String ? value : '';

/// Parse a list of objects, skipping entries that are not maps.
List<T> _models<T>(Object? value, T Function(Map<String, dynamic>) parse) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((map) => parse(Map<String, dynamic>.from(map)))
      .toList(growable: false);
}

/// A number from a number or a numeric string; anything else is zero.
double _numberOrString(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim()) ?? 0;
  return 0;
}

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
