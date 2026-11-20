import '../../bridge/models.dart';

/// How a turn's cost is written, in one place.
///
/// `null` is "unknown" (an unpriced model), `0` is "free" (a local model), and a
/// real cost below half a tenth of a cent is shown as a bound rather than
/// rounding to `$0.0000` — which reads as "no price applies".
String chatCostLabel(int? microUsd) {
  if (microUsd == null) return 'cost unknown';
  if (microUsd <= 0) return 'free';
  if (microUsd < 50) return '<\$0.0001';
  return '\$${(microUsd / 1000000).toStringAsFixed(4)}';
}

/// `950`, `2K`, `1.5K`, `2M` — a token count short enough for one status line.
///
/// The `.0` is dropped so `2000` reads `2K`. The status bar had its own copy
/// that kept it (`2.0K` beside the chat's `2K`), which is the drift this
/// function exists to prevent.
String compactTokens(int value) {
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(1).replaceAll('.0', '')}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(1).replaceAll('.0', '')}K';
  }
  return '$value';
}

/// `2K tok · $0.0021 · 4.2s` — one turn's usage, the same on every chat.
///
/// The duration is omitted when the core did not report one, so a turn that
/// never finished does not claim `0.0s`.
String chatUsageLabel(ChatUsageView usage) {
  final parts = <String>[
    '${compactTokens(usage.tokens)} tok',
    chatCostLabel(usage.costMicroUsd),
    if (usage.durationMs != null)
      '${(usage.durationMs! / 1000).toStringAsFixed(1)}s',
  ];
  return parts.join(' · ');
}
