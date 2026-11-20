/// How a turn's cost is written, in one place.
///
/// `null` is "unknown" (an unpriced model), `0` is "free" (a local model), and a
/// real cost below half a tenth of a cent is shown as a bound rather than
/// rounding to `$0.0000` — which reads as "no price applies". The four chat
/// surfaces and the status bar used five copies of the old expression.
String chatCostLabel(int? microUsd) {
  if (microUsd == null) return 'cost unknown';
  if (microUsd <= 0) return 'free';
  if (microUsd < 50) return '<\$0.0001';
  return '\$${(microUsd / 1000000).toStringAsFixed(4)}';
}
