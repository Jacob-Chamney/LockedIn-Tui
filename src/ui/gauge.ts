/**
 * Gauge levels and labels.
 *
 * One implementation serves the plugin SDK (`gauge()` draws an arc ring) and
 * the app's achievement progress line. The shared part is the level: clamped
 * fraction, rounded percentage and a `value / max` label. The SDK turns that
 * into a ring; the app draws a compact text bar.
 */
export type GaugeLayout = {
  /** Clamped value and limit. */
  value: number
  max: number
  /** 0..1 share of the limit. */
  fraction: number
  /** Rounded 0..100 for display. */
  percent: number
  /** `3 / 10`, or `3` when no limit is meaningful. */
  valueText: string
  /** `30%`. */
  percentText: string
  /** The caller's label, or "". */
  label: string
}

export type GaugeOptions = {
  value: number
  /** Limit; 0 or missing means no meaningful level. Defaults to `value`. */
  max?: number
  /** A caption shown under the ring. */
  label?: string
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function gaugeLayout(options: GaugeOptions): GaugeLayout {
  const rawMax = options.max === undefined ? Math.max(0, finite(options.value)) : finite(options.max)
  const max = rawMax > 0 ? rawMax : 0
  const value =
    max === 0 ? Math.max(0, finite(options.value)) : Math.max(0, Math.min(max, finite(options.value)))
  const fraction = max === 0 ? 0 : Math.max(0, Math.min(1, value / max))
  const percent = Math.round(fraction * 100)
  return {
    value,
    max,
    fraction,
    percent,
    valueText: max === 0 ? `${value}` : `${value} / ${max}`,
    percentText: `${percent}%`,
    label: options.label ?? "",
  }
}
