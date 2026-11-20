import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../../bridge/models.dart';
import '../../bridge/protocol.dart';
import '../../theme/palette.dart';
import '../keys.dart';
import '../chat/transcript_scroll.dart';
import 'export_saver.dart';

/// Requests one Stats export document from the shell (`stats.export`).
///
/// The page never reaches the core itself: the shell owns the store, so the
/// callback is the only path to the export and the page only renders the text
/// the core returned. It writes no file.
typedef StatsExportHandler = Future<StatsExportResult> Function({
  required String range,
  required String scope,
  required String format,
});

/// The Stats surface: the dashboard, its range/scope chips and the `x` export.
///
/// The shell owns the store and passes the latest [StatsSummary] in; the page
/// formats it and forwards the user's intents. `r` and `s` cycle the chips and
/// `x` asks [onExport] for the document text, which is shown in a dialog with
/// Save, Copy and Close. Saving is the shell's documented half of
/// `stats.export`: the core returns text, and a file is written only to a path
/// the user picked (`s` or Save… in the open dialog).
class StatsPage extends StatefulWidget {
  const StatsPage({
    super.key,
    this.summary,
    this.loading = false,
    this.error,
    this.onRetry,
    this.range = 'all',
    this.scope = 'all',
    this.onRange,
    this.onScope,
    this.onExport,
    this.pickSavePath,
    this.onAchievements,
  });

  final StatsSummary? summary;
  final bool loading;
  final String? error;
  final VoidCallback? onRetry;
  final String range;
  final String scope;
  final ValueChanged<String>? onRange;
  final ValueChanged<String>? onScope;

  /// Called with the page's current range/scope and the chosen format on `x`.
  ///
  /// When it is null the export action is not offered: a footer hint for a
  /// key that does nothing would be a lie. A failure is the core's own
  /// message, shown inline in the dialog with Retry.
  final StatsExportHandler? onExport;

  /// The destination picker the export dialog's Save action uses.
  ///
  /// Defaults to the platform Save dialog. Tests inject a scripted path; a
  /// `null` answer cancels and writes nothing. The core never returns a path,
  /// so this is the only way a file is written.
  final SavePathPicker? pickSavePath;

  /// `a` opens the Achievements layer over Stats.
  ///
  /// Achievements is a layer of this surface, not a surface of its own: the
  /// global chord and the palette row live in the keymap registry
  /// (`achievements`), and this page-local `a` is the same layer's shortcut
  /// while Stats has focus. When it is null the key is not offered, so the
  /// footer never names a key that does nothing.
  final VoidCallback? onAchievements;

  @override
  State<StatsPage> createState() => _StatsPageState();
}

class _StatsPageState extends State<StatsPage> {
  /// The dashboard is taller than 800×600; it has to scroll by keyboard.
  final _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  KeyEventResult _handleKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    // Modified chords belong to the shell's registry.
    if (modifierHeld) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final scrolled = scrollKey(_scroll, event);
    if (scrolled != null) return scrolled;
    if (key == LogicalKeyboardKey.keyA && widget.onAchievements != null) {
      widget.onAchievements!();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyX) {
      final export = widget.onExport;
      if (export == null || widget.summary == null) {
        return KeyEventResult.ignored;
      }
      unawaited(_openExport(export));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyR) {
      final onRange = widget.onRange;
      if (onRange == null) return KeyEventResult.ignored;
      onRange(_nextRange(widget.range));
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.keyS) {
      final onScope = widget.onScope;
      if (onScope == null) return KeyEventResult.ignored;
      onScope(_nextScope(widget.scope));
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  Future<void> _openExport(StatsExportHandler export) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => _ExportDialog(
        range: widget.range,
        scope: widget.scope,
        onExport: export,
        pickSavePath: widget.pickSavePath,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final summary = widget.summary;
    if (summary == null) {
      return Focus(
        autofocus: true,
        onKeyEvent: _handleKey,
        child: _State(
          loading: widget.loading,
          error: widget.error,
          onRetry: widget.onRetry,
        ),
      );
    }
    return Focus(
      autofocus: true,
      onKeyEvent: _handleKey,
      child: Column(
        children: [
          Expanded(
            child: _Dashboard(
              summary: summary,
              range: widget.range,
              scope: widget.scope,
              scrollController: _scroll,
              onRange: widget.onRange,
              onScope: widget.onScope,
              onAchievements: widget.onAchievements,
              onExport: widget.onExport == null
                  ? null
                  : () => unawaited(_openExport(widget.onExport!)),
            ),
          ),
          _StatsFooter(
            canCycleRange: widget.onRange != null,
            canCycleScope: widget.onScope != null,
            canExport: widget.onExport != null,
            canOpenAchievements: widget.onAchievements != null,
          ),
        ],
      ),
    );
  }
}

/// The one footer line for the surface: only the keys that actually work are
/// named, so the bar never advertises an action the shell did not wire.
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
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
          Text(
            'estimates, not a bill',
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
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
        final wide = constraints.maxWidth >= 980;
        final columns = wide ? 4 : 2;
        final gap = 12.0;
        // The content column is capped below, so the cards are sized from the
        // column they sit in, not from the window: sizing them from the window
        // made four cards wider than the column and wrapped the fourth onto a
        // row of its own on any window wider than 1220 px. The half pixel keeps
        // a rounding error from wrapping the last card.
        const contentMax = 1180.0;
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
                          fontSize: 12,
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
                              style: TextStyle(
                                color: LockedInColors.muted,
                                fontSize: 12,
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
                                  fontSize: 11,
                                ),
                              ),
                              Text(
                                _shortDate(summary.activity.last.date),
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: 11,
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
                                style: TextStyle(
                                  color: LockedInColors.muted,
                                  fontSize: 12,
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
                                                fontSize: 12,
                                              ),
                                            ),
                                          ),
                                          Text(
                                            _plural(tool.calls, 'call'),
                                            style: TextStyle(
                                              color: LockedInColors.muted,
                                              fontSize: 11,
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
                style: TextStyle(color: LockedInColors.muted, fontSize: 12),
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
            fontSize: 11,
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
        borderRadius: BorderRadius.circular(8),
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
    final text = value == null ? label : '$label  $value';
    return Material(
      color: selected ? LockedInColors.primary : LockedInColors.panel,
      borderRadius: BorderRadius.circular(5),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(5),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(5),
            border: Border.all(
              color: selected ? LockedInColors.primary : LockedInColors.line,
            ),
          ),
          child: Text(
            text,
            style: TextStyle(
              color: selected
                  ? Theme.of(context).colorScheme.onPrimary
                  : LockedInColors.muted,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
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
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: LockedInColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: LockedInColors.muted,
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.0,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            style: TextStyle(
              color: LockedInColors.foreground,
              fontSize: 23,
              fontWeight: FontWeight.w600,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            detail,
            style: TextStyle(color: tone ?? LockedInColors.muted, fontSize: 11),
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
            style: TextStyle(color: LockedInColors.foreground, fontSize: 13),
          ),
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(3),
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
            style: TextStyle(color: LockedInColors.muted, fontSize: 11),
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
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(color: LockedInColors.foreground, fontSize: 12),
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
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: LockedInColors.warning.withValues(alpha: 0.4),
        ),
      ),
      child: Text(
        '! $text',
        style: TextStyle(color: LockedInColors.warning, fontSize: 12),
      ),
    );
  }
}

class _AreaChartPainter extends CustomPainter {
  const _AreaChartPainter({
    required this.values,
    required this.line,
    required this.fill,
    required this.grid,
  });

  final List<double> values;
  final Color line;
  final Color fill;
  final Color grid;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty || size.isEmpty) return;
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (var row = 0; row <= 4; row++) {
      final y = size.height * row / 4;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    final points = <Offset>[];
    for (var index = 0; index < values.length; index++) {
      final x = values.length == 1
          ? 0.0
          : size.width * index / (values.length - 1);
      final y = size.height - values[index] * size.height;
      points.add(Offset(x, y));
    }

    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (var index = 1; index < points.length; index++) {
      final previous = points[index - 1];
      final current = points[index];
      final midX = (previous.dx + current.dx) / 2;
      path.cubicTo(midX, previous.dy, midX, current.dy, current.dx, current.dy);
    }

    final area = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(area, Paint()..color = fill);
    canvas.drawPath(
      path,
      Paint()
        ..color = line
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );

    final dot = Paint()..color = line;
    for (final point in points) {
      canvas.drawCircle(point, 2.5, dot);
    }
  }

  @override
  bool shouldRepaint(_AreaChartPainter oldDelegate) {
    return oldDelegate.values != values ||
        oldDelegate.line != line ||
        oldDelegate.fill != fill ||
        oldDelegate.grid != grid;
  }
}

/// `1 call`, `2 calls` — a count with the right noun.
String _plural(int count, String noun) =>
    '$count $noun${count == 1 ? '' : 's'}';

String _compact(int value) {
  if (value >= 1000000000) {
    return '${(value / 1000000000).toStringAsFixed(1).replaceAll('.0', '')}B';
  }
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(1).replaceAll('.0', '')}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(1).replaceAll('.0', '')}K';
  }
  return '$value';
}

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

String _shortDate(String iso) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(iso);
  if (match == null) return iso;
  final month = int.tryParse(match.group(2)!) ?? 1;
  return '${_months[month - 1]} ${match.group(3)}';
}

String _periodLabel(StatsPeriod period) {
  final from = RegExp(r'^(\d{4})-(\d{2})').firstMatch(period.from);
  final to = RegExp(r'^(\d{4})-(\d{2})').firstMatch(period.to);
  if (from == null || to == null) return '';
  final fromMonth = _months[(int.tryParse(from.group(2)!) ?? 1) - 1];
  final toMonth = _months[(int.tryParse(to.group(2)!) ?? 1) - 1];
  if (from.group(1) == to.group(1)) {
    return from.group(2) == to.group(2)
        ? '$fromMonth ${from.group(1)}'
        : '$fromMonth – $toMonth ${to.group(1)}';
  }
  return '$fromMonth ${from.group(1)} – $toMonth ${to.group(1)}';
}

int _periodDays(StatsPeriod period) {
  final from = DateTime.tryParse(period.from);
  final to = DateTime.tryParse(period.to);
  if (from == null || to == null || to.isBefore(from)) return 0;
  return to.difference(from).inDays + 1;
}

String _nextRange(String value) {
  const order = ['7d', '30d', '90d', 'all'];
  final at = order.indexOf(value);
  return order[(at + 1) % order.length];
}

String _nextScope(String value) {
  const order = ['all', 'school', 'skills', 'work'];
  final at = order.indexOf(value);
  return order[(at + 1) % order.length];
}

/// The export dialog: format chips, the document text and Save/Copy/Close.
///
/// The dialog owns the request state so a format change refetches exactly once
/// and a late answer cannot replace a newer one. [onExport] is the shell's
/// `stats.export`; the page writes nothing and never re-reads a counter.
///
/// Saving is the shell's half of the contract: the core returned [text], and
/// the only destination is the one [pickSavePath] returns. A cancelled picker
/// writes nothing and says nothing; a failed write is one inline line and the
/// dialog stays open. `s` and Save… are the same path, so the action is
/// reachable without a mouse.
class _ExportDialog extends StatefulWidget {
  const _ExportDialog({
    required this.range,
    required this.scope,
    required this.onExport,
    this.pickSavePath,
  });

  final String range;
  final String scope;
  final StatsExportHandler onExport;
  final SavePathPicker? pickSavePath;

  @override
  State<_ExportDialog> createState() => _ExportDialogState();
}

class _ExportDialogState extends State<_ExportDialog> {
  /// The chips in display order, mapped to the core's `format` values.
  static const _formats = <String, String>{'markdown': 'md', 'csv': 'csv'};

  String _format = 'markdown';
  String _text = '';
  String? _error;
  bool _loading = true;
  bool _copied = false;
  bool _saving = false;

  /// Where the last export was written, or why it could not be. Both are
  /// cleared when the document changes, because the old file no longer
  /// matches what the dialog shows.
  String? _savedPath;
  String? _saveError;

  /// Bumped on every request and format change, so an answer for a format the
  /// user has already left is dropped instead of replacing the visible text.
  int _request = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final ticket = ++_request;
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _copied = false;
      _savedPath = null;
      _saveError = null;
    });
    try {
      final result = await widget.onExport(
        range: widget.range,
        scope: widget.scope,
        format: _formats[_format]!,
      );
      if (!mounted || ticket != _request) return;
      setState(() {
        _text = result.text;
        _loading = false;
      });
    } catch (failure) {
      if (!mounted || ticket != _request) return;
      setState(() {
        _error = _reason(failure);
        _loading = false;
      });
    }
  }

  void _selectFormat(String format) {
    if (format == _format || _loading) return;
    setState(() => _format = format);
    unawaited(_load());
  }

  bool get _canSave => !_loading && _error == null && _text.isNotEmpty;

  Future<void> _copy() async {
    if (_text.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: _text));
    if (!mounted) return;
    setState(() => _copied = true);
  }

  /// Pick a destination, then write exactly the text on screen.
  ///
  /// The write is deliberately after the picker: a dialog the user cancels
  /// must leave the filesystem alone. Nothing here logs the document.
  Future<void> _save() async {
    if (!_canSave || _saving) return;
    final pick = widget.pickSavePath ?? pickExportSavePath;
    final document = _text;
    setState(() {
      _saving = true;
      _saveError = null;
    });
    String? picked;
    try {
      picked = await pick(
        exportFileName(
          scope: widget.scope,
          range: widget.range,
          format: _formats[_format]!,
        ),
      );
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedPath = null;
        _saveError = 'could not save: ${saveFailureReason(failure)}';
      });
      return;
    }
    if (!mounted) return;
    final path = picked?.trim();
    if (path == null || path.isEmpty) {
      // Cancelled: not an error, and nothing was written.
      setState(() => _saving = false);
      return;
    }
    try {
      await writeExportFile(path, document);
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedPath = path;
        _saveError = null;
      });
    } catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _savedPath = null;
        _saveError = 'could not save: ${saveFailureReason(failure)}';
      });
    }
  }

  /// The core's own one-line reason for a refusal, never a wrapper.
  static String _reason(Object failure) {
    if (failure is RpcException) {
      final data = failure.data;
      if (data is Map) {
        final message = data['message'];
        if (message is String && message.isNotEmpty) return message;
      }
      return failure.message;
    }
    return failure.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        final key = event.logicalKey;
        if (key == LogicalKeyboardKey.escape) {
          Navigator.of(context).pop();
          return KeyEventResult.handled;
        }
        // `s` is the dialog's save. It is consumed even while the document is
        // loading, so the page's `s scope` can never fire behind the dialog.
        if (key == LogicalKeyboardKey.keyS) {
          unawaited(_save());
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: AlertDialog(
        backgroundColor: LockedInColors.surface,
        title: Row(
          children: [
            const Expanded(
              child: Text('export stats', style: TextStyle(fontSize: 17)),
            ),
            Text(
              '${widget.range} · ${widget.scope}',
              style: TextStyle(color: LockedInColors.muted, fontSize: 11),
            ),
          ],
        ),
        content: SizedBox(
          width: 540,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final entry in _formats.entries)
                    _Chip(
                      label: entry.key,
                      selected: _format == entry.key,
                      onTap: () => _selectFormat(entry.key),
                    ),
                  const SizedBox(width: 8),
                  Text(
                    's save · Esc close',
                    style: TextStyle(color: LockedInColors.muted, fontSize: 11),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _body(),
              if (_savedPath != null || _saveError != null) ...[
                const SizedBox(height: 10),
                Text(
                  _saveError ?? 'saved to $_savedPath',
                  style: TextStyle(
                    color: _saveError != null
                        ? LockedInColors.error
                        : LockedInColors.success,
                    fontSize: 12,
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _canSave && !_saving ? _save : null,
            child: Text(_saving ? 'saving…' : 'Save…'),
          ),
          TextButton(
            onPressed: _loading || _error != null || _text.isEmpty
                ? null
                : _copy,
            child: Text(_copied ? 'copied' : 'Copy'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: Center(
          child: Text(
            'exporting…',
            style: TextStyle(color: LockedInColors.muted),
          ),
        ),
      );
    }
    final error = _error;
    if (error != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            error,
            style: TextStyle(color: LockedInColors.error, fontSize: 13),
          ),
          const SizedBox(height: 10),
          OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ],
      );
    }
    return Container(
      constraints: const BoxConstraints(maxHeight: 300),
      decoration: BoxDecoration(
        color: LockedInColors.panel,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: LockedInColors.line),
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: SelectableText(
          _text,
          style: TextStyle(
            fontFamily: 'monospace',
            fontSize: 12,
            height: 1.4,
            color: LockedInColors.foreground,
          ),
        ),
      ),
    );
  }
}
