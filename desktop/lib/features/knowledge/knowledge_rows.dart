part of 'knowledge_page.dart';

/// One projection chip, matching the Review surface's `_SideChip`.
class _ScopeChip extends StatelessWidget {
  const _ScopeChip({
    super.key,
    required this.label,
    required this.selected,
    this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? LockedInColors.primary : Colors.transparent,
      borderRadius: BorderRadius.circular(Radii.control),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.control),
        child: Padding(
          padding: const EdgeInsets.all(Radii.control),
          child: ValueChip(
            selected ? '✓ $label' : label,
            tone: selected ? Theme.of(context).colorScheme.onPrimary : null,
          ),
        ),
      ),
    );
  }
}

class _TopicHeading extends StatelessWidget {
  const _TopicHeading({required this.group});

  final KnowledgeGroup group;

  @override
  Widget build(BuildContext context) {
    final topic = group.topic.trim().isEmpty ? 'untitled' : group.topic;
    return Row(
      key: ValueKey('knowledge-topic-$topic'),
      children: [
        Icon(Icons.folder_outlined, size: 13, color: LockedInColors.muted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            topic.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Text(
          '${group.notes.length}',
          style: TextStyle(
            color: LockedInColors.muted,
            fontSize: TypeScale.micro,
          ),
        ),
      ],
    );
  }
}

class _NoteTile extends StatelessWidget {
  const _NoteTile({
    super.key,
    required this.note,
    this.selected = false,
    this.onTap,
  });

  final KnowledgeNote note;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(Radii.control),
          border: Border.all(
            color: selected ? LockedInColors.primary : LockedInColors.line,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 14,
              child: selected
                  ? Text(
                      '▌',
                      key: const ValueKey('knowledge-cursor'),
                      style: TextStyle(
                        color: LockedInColors.primary,
                        fontSize: TypeScale.body,
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    note.displayTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    joinDot([note.path, dateLabel(note.updated)]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: LockedInColors.muted,
                      fontSize: TypeScale.label,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HitTile extends StatelessWidget {
  const _HitTile({
    super.key,
    required this.hit,
    this.selected = false,
    this.onTap,
  });

  final KnowledgeHit hit;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final meta = joinDot([hit.path, dateLabel(hit.updated)]);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 9, 12, 9),
        decoration: BoxDecoration(
          color: selected ? LockedInColors.panel : LockedInColors.surface,
          borderRadius: BorderRadius.circular(Radii.control),
          border: Border.all(
            color: selected ? LockedInColors.primary : LockedInColors.line,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 14,
              child: selected
                  ? Text(
                      '▌',
                      key: const ValueKey('knowledge-cursor'),
                      style: TextStyle(
                        color: LockedInColors.primary,
                        fontSize: TypeScale.body,
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _KindTag(kind: hit.kind),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          hit.displayTitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: selected
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _SideBadge(side: hit.side),
                    ],
                  ),
                  if (hit.excerpt.trim().isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      hit.excerpt,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: LockedInColors.foreground,
                        fontSize: TypeScale.label,
                        height: 1.4,
                      ),
                    ),
                  ],
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (hit.isHistory) ...[
                        _HistoryTag(hitId: hit.id),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          meta,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: LockedInColors.muted,
                            fontSize: TypeScale.label,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A row's kind, paired with a glyph so colour is never the only signal.
class _KindTag extends StatelessWidget {
  const _KindTag({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    final color = _kindColor(kind);
    final label = kind.trim().isEmpty ? 'item' : kind;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_kindIcon(kind), size: 11, color: color),
          const SizedBox(width: 4),
          Text(
            label.toUpperCase(),
            style: TextStyle(
              color: color,
              fontSize: TypeScale.micro,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
            ),
          ),
        ],
      ),
    );
  }
}

/// The wall a hit belongs to, always labelled, never colour only.
class _SideBadge extends StatelessWidget {
  const _SideBadge({required this.side});

  final String side;

  @override
  Widget build(BuildContext context) {
    final label = side.trim().isEmpty ? 'unknown' : side;
    return Container(
      key: ValueKey('knowledge-side-$label'),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.background,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: sideColor(label),
          fontSize: TypeScale.micro,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// The `history` marker on memory and source rows.
class _HistoryTag extends StatelessWidget {
  const _HistoryTag({required this.hitId});

  final String hitId;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('knowledge-history-$hitId'),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: LockedInColors.success.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(
          color: LockedInColors.success.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.history, size: 10, color: LockedInColors.success),
          const SizedBox(width: 3),
          Text(
            'history',
            style: TextStyle(
              color: LockedInColors.success,
              fontSize: TypeScale.micro,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorBlock extends StatelessWidget {
  const _ErrorBlock({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('knowledge-error'),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.error.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.error_outline, size: 16, color: LockedInColors.error),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(
                    color: LockedInColors.error,
                    fontSize: TypeScale.label,
                    height: 1.45,
                  ),
                ),
              ),
            ],
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                key: const ValueKey('knowledge-retry'),
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 15),
                label: const Text('Retry'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState({required this.searching});

  final bool searching;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: LockedInColors.primary,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              searching ? 'searching…' : 'loading knowledge…',
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyTree extends StatelessWidget {
  const _EmptyTree();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      key: const ValueKey('knowledge-empty'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.hub_outlined, size: 26, color: LockedInColors.muted),
          const SizedBox(height: 10),
          Text(
            'no notes yet · notes appear here once a vault has Markdown',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _NoHits extends StatelessWidget {
  const _NoHits({required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      key: const ValueKey('knowledge-no-hits'),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.search_off, size: 26, color: LockedInColors.muted),
          const SizedBox(height: 10),
          Text(
            query.isEmpty ? 'no matches' : 'no matches for “$query”',
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            'try another word · Esc to browse the tree',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ],
      ),
    );
  }
}

Color _kindColor(String kind) => switch (kind) {
  'note' => LockedInColors.primary,
  'memory' => LockedInColors.success,
  'source' => LockedInColors.secondary,
  'session' => LockedInColors.accent,
  'goal' => LockedInColors.secondary,
  'project' => LockedInColors.accent,
  'archive' => LockedInColors.warning,
  _ => LockedInColors.muted,
};

IconData _kindIcon(String kind) => switch (kind) {
  'note' => Icons.description_outlined,
  'memory' => Icons.memory,
  'source' => Icons.article_outlined,
  'session' => Icons.history,
  'goal' => Icons.school_outlined,
  'project' => Icons.work_outline,
  'archive' => Icons.archive_outlined,
  _ => Icons.circle_outlined,
};
