part of 'stats_page.dart';

class _StatsFooter extends StatelessWidget {
  const _StatsFooter({
    required this.canCycleRange,
    required this.canCycleScope,
    required this.canExport,
    this.canOpenAchievements = false,
  });

  final bool canCycleRange;
  final bool canCycleScope;
  final bool canExport;

  /// True when the shell wired `a` to the Achievements layer.
  final bool canOpenAchievements;

  @override
  Widget build(BuildContext context) {
    final hints = <String>[
      if (canCycleRange) 'r range',
      if (canCycleScope) 's scope',
      if (canOpenAchievements) 'a achievements',
      if (canExport) 'x export',
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 10),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: LockedInColors.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              hints.join(' · '),
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ),
          Text(
            'estimates, not a bill',
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

class _Dashboard extends StatelessWidget {
  const _Dashboard({
    required this.summary,
    required this.range,
    required this.scope,
    this.scrollController,
    this.onRange,
    this.onScope,
    this.onAchievements,
    this.onExport,
  });

  final StatsSummary summary;
  final String range;
  final String scope;

  /// The page's scroll position, so the keyboard can move the dashboard.
  final ScrollController? scrollController;
  final ValueChanged<String>? onRange;
  final ValueChanged<String>? onScope;

  /// The header's pointer paths for `a` and `x`.
  final VoidCallback? onAchievements;
  final VoidCallback? onExport;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final values = summary.activity
        .map((day) => day.tokens.toDouble())
        .toList();
    final peak = values.isEmpty ? 0.0 : values.reduce((a, b) => a > b ? a : b);
    final normalized = peak <= 0
        ? values
        : values.map((value) => value / peak).toList(growable: false);
    final periodDays = _periodDays(summary.period);
    final activePercent = periodDays == 0
        ? 0
        : ((summary.activeDays / periodDays) * 100).round();

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= Breakpoints.columns;
        final columns = wide ? 4 : 2;
        final gap = 12.0;
        // The content column is capped below, so the cards are sized from the
        // column they sit in, not from the window: sizing them from the window
        // made four cards wider than the column and wrapped the fourth onto a
        // row of its own on any window wider than 1220 px. The half pixel keeps
        // a rounding error from wrapping the last card.
        const contentMax = Breakpoints.contentWide;
        final contentWidth = math.min(constraints.maxWidth - 40, contentMax);
        final cardWidth = (contentWidth - gap * (columns - 1)) / columns - 0.5;
        return SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 28),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: contentMax),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Text('STATS', style: theme.textTheme.titleLarge),
                      const Spacer(),
                      Text(
                        _periodLabel(summary.period),
                        style: TextStyle(
                          color: LockedInColors.muted,
                          fontSize: TypeScale.label,
                        ),
                      ),
                      // The two header actions are keys (`a`, `x`); the buttons
                      // are their pointer path, not a second implementation.
                      if (onAchievements != null) ...[
                        const SizedBox(width: 10),
                        TextButton.icon(
                          key: const ValueKey('stats-achievements'),
                          onPressed: onAchievements,
                          icon: const Icon(
                            Icons.emoji_events_outlined,
                            size: 15,
                          ),
                          label: const Text('achievements'),
                        ),
                      ],
                      if (onExport != null) ...[
                        const SizedBox(width: 6),
                        OutlinedButton.icon(
                          key: const ValueKey('stats-export'),
                          onPressed: onExport,
                          icon: const Icon(Icons.download_outlined, size: 15),
                          label: const Text('export'),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _Chip(
                        label: 'range',
                        value: range,
                        selected: true,
                        onTap: onRange == null
                            ? null
                            : () => onRange!(_nextRange(range)),
                      ),
                      for (final value in const ['7d', '30d', '90d'])
                        _Chip(
                          label: value,
                          selected: range == value,
                          onTap: onRange == null ? null : () => onRange!(value),
                        ),
                      const SizedBox(width: 16),
                      _Chip(
                        label: 'scope',
                        value: scope,
                        selected: true,
                        onTap: onScope == null
                            ? null
                            : () => onScope!(_nextScope(scope)),
                      ),
                      for (final value in const ['school', 'skills', 'work'])
                        _Chip(
                          label: value,
                          selected: scope == value,
                          onTap: onScope == null ? null : () => onScope!(value),
                        ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Wrap(
                    spacing: gap,
                    runSpacing: gap,
                    children: [
                      _KpiCard(
                        width: cardWidth,
                        label: 'TOKENS',
                        value: _compact(summary.tokens),
                        detail:
                            '${_compact(summary.overview.input)} in · ${_compact(summary.overview.output)} out',
                      ),
                      _KpiCard(
                        width: cardWidth,
                        label: 'SESSIONS',
                        value: '${summary.overview.runs}',
                        detail: summary.overview.failed > 0
                            ? '${summary.overview.failed} failed'
                            : 'none failed',
                        tone: summary.overview.failed > 0
                            ? LockedInColors.error
                            : null,
                      ),
                      _KpiCard(
                        width: cardWidth,
                        label: 'ACTIVE DAYS',
                        value: '${summary.activeDays}',
                        detail:
                            '$activePercent% of range · ${summary.bestStreak}d streak',
                      ),
                      _KpiCard(
                        width: cardWidth,
                        label: 'COST',
                        value: summary.costMicroUsd == null
                            ? 'unknown'
                            : summary.costLabel,
                        detail: summary.costMicroUsd == null
                            ? 'not priced'
                            : 'estimated',
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  _Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            const _SectionTitle('TOKENS OVER TIME'),
                            const Spacer(),
                            Text(
                              peak > 0
                                  ? 'peak ${_compact(peak.round())}/day'
                                  : 'no activity',
                              style: tabular(
                                TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: TypeScale.label,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        if (normalized.isEmpty)
                          Padding(
                            padding: EdgeInsets.symmetric(vertical: 48),
                            child: Center(
                              child: Text(
                                'no activity in this range',
                                style: TextStyle(color: LockedInColors.muted),
                              ),
                            ),
                          )
                        else
                          SizedBox(
                            height: 190,
                            child: CustomPaint(
                              painter: _AreaChartPainter(
                                values: normalized,
                                line: LockedInColors.primary,
                                fill: LockedInColors.primary.withValues(
                                  alpha: 0.22,
                                ),
                                grid: LockedInColors.line,
                              ),
                            ),
                          ),
                        if (summary.activity.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                _shortDate(summary.activity.first.date),
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: TypeScale.label,
                                ),
                              ),
                              Text(
                                _shortDate(summary.activity.last.date),
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: TypeScale.label,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (summary.models.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _Panel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              const _SectionTitle('MODELS'),
                              const Spacer(),
                              Text(
                                '${_plural(summary.models.length, 'model')} · ${_plural(summary.overview.runs, 'run')}',
                                style: tabular(
                                  TextStyle(
                                    color: LockedInColors.muted,
                                    fontSize: TypeScale.label,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 14),
                          for (final model in _topModels()) ...[
                            _ModelRow(
                              name: model.model,
                              runs: model.runs,
                              share: _modelShare(model),
                            ),
                            const SizedBox(height: 8),
                          ],
                        ],
                      ),
                    ),
                  ],
                  if (summary.tools.isNotEmpty || _hasLearning()) ...[
                    const SizedBox(height: 12),
                    _Panel(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (summary.tools.isNotEmpty)
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const _SectionTitle('TOOLS'),
                                  const SizedBox(height: 10),
                                  for (final tool in summary.tools.take(4))
                                    Padding(
                                      padding: const EdgeInsets.only(bottom: 6),
                                      child: Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              tool.name,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color:
                                                    LockedInColors.foreground,
                                                fontSize: TypeScale.label,
                                              ),
                                            ),
                                          ),
                                          Text(
                                            _plural(tool.calls, 'call'),
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
                          if (summary.tools.isNotEmpty && _hasLearning())
                            const SizedBox(width: 24),
                          if (_hasLearning())
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const _SectionTitle('LEARNING'),
                                  const SizedBox(height: 10),
                                  _LearningLine(
                                    label: 'steps',
                                    value: '${summary.learning.steps}',
                                  ),
                                  _LearningLine(
                                    label: 'cards',
                                    value:
                                        '${summary.learning.cardsKnown} known · ${summary.learning.cardsMissed} missed',
                                  ),
                                  _LearningLine(
                                    label: 'lessons',
                                    value: '${summary.learning.lessons}',
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                  if (summary.diagnostic != null) ...[
                    const SizedBox(height: 12),
                    _Notice(text: summary.diagnostic!),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  bool _hasLearning() {
    final learning = summary.learning;
    return learning.steps > 0 ||
        learning.cardsKnown > 0 ||
        learning.cardsMissed > 0 ||
        learning.lessons > 0;
  }

  List<StatsModelRow> _topModels() {
    final models = [...summary.models]
      ..sort((a, b) => b.tokens.compareTo(a.tokens));
    return models.take(4).toList();
  }

  double _modelShare(StatsModelRow model) {
    final total = summary.models.fold<int>(0, (sum, row) => sum + row.tokens);
    return total == 0 ? 0 : model.tokens / total;
  }
}

class _State extends StatelessWidget {
  const _State({required this.loading, this.error, this.onRetry});

  final bool loading;
  final String? error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('STATS', style: theme.textTheme.titleLarge),
            const SizedBox(height: 12),
            if (loading)
              const CircularProgressIndicator(strokeWidth: 2)
            else if (error != null) ...[
              Text(
                error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: LockedInColors.error),
              ),
              if (onRetry != null) ...[
                const SizedBox(height: 14),
                FilledButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            ] else ...[
              Text(
                'no stats yet',
                style: TextStyle(color: LockedInColors.muted),
              ),
              const SizedBox(height: 6),
              Text(
                'send a message or run a generation to fill this page',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: LockedInColors.muted,
                  fontSize: TypeScale.label,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 3, height: 14, color: LockedInColors.primary),
        const SizedBox(width: 7),
        Text(
          text,
          style: TextStyle(
            color: LockedInColors.secondary,
            fontSize: TypeScale.label,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8,
          ),
        ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: child,
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    this.value,
    this.selected = false,
    this.onTap,
  });

  final String label;
  final String? value;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    // The same chip as every other surface: `ValueChip` with the accent fill
    // when selected. The fill belongs to the chip itself — a parent `Material`
    // painted the red while the chip kept its panel grey, so the selected label
    // was dark-on-grey and nearly invisible.
    final text = value == null ? label : '$label  $value';
    final accent = LockedInColors.primary;
    final onAccent = Theme.of(context).colorScheme.onPrimary;
    final chip = ValueChip(
      text,
      tone: selected ? onAccent : null,
      background: selected ? accent : null,
      border: selected ? accent : null,
    );
    if (onTap == null && !selected) return chip;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(Radii.control),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.control),
        child: chip,
      ),
    );
  }
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.width,
    required this.label,
    required this.value,
    required this.detail,
    this.tone,
  });

  final double width;
  final String label;
  final String value;
  final String detail;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 13),
      decoration: BoxDecoration(
        color: LockedInColors.surface,
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: TypeScale.micro,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            key: ValueKey('kpi-${label.toLowerCase()}'),
            style: tabular(
              TextStyle(
                color: LockedInColors.foreground,
                fontSize: TypeScale.display,
                fontWeight: FontWeight.w600,
                height: 1.1,
              ),
            ),
          ),
          const SizedBox(height: 3),
          Text(
            detail,
            style: TextStyle(
              color: tone ?? LockedInColors.muted,
              fontSize: TypeScale.label,
            ),
          ),
        ],
      ),
    );
  }
}

class _ModelRow extends StatelessWidget {
  const _ModelRow({
    required this.name,
    required this.runs,
    required this.share,
  });

  final String name;
  final int runs;
  final double share;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(
          width: 190,
          child: Text(
            name,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: LockedInColors.foreground,
              fontSize: TypeScale.body,
            ),
          ),
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(Radii.control),
            child: LinearProgressIndicator(
              value: share,
              minHeight: 8,
              backgroundColor: LockedInColors.line,
              color: LockedInColors.primary,
            ),
          ),
        ),
        const SizedBox(width: 12),
        SizedBox(
          width: 96,
          child: Text(
            '$runs runs · ${(share * 100).round()}%',
            textAlign: TextAlign.right,
            style: tabular(
              TextStyle(color: LockedInColors.muted, fontSize: TypeScale.label),
            ),
          ),
        ),
      ],
    );
  }
}

class _LearningLine extends StatelessWidget {
  const _LearningLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(
            width: 62,
            child: Text(
              label,
              style: TextStyle(
                color: LockedInColors.muted,
                fontSize: TypeScale.label,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: tabular(
                TextStyle(
                  color: LockedInColors.foreground,
                  fontSize: TypeScale.label,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: LockedInColors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(Radii.control),
        border: Border.all(
          color: LockedInColors.warning.withValues(alpha: 0.4),
        ),
      ),
      child: Text(
        '! $text',
        style: TextStyle(
          color: LockedInColors.warning,
          fontSize: TypeScale.label,
        ),
      ),
    );
  }
}
