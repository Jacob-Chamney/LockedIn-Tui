/**
 * Block-glyph sparklines.
 *
 * The app and the plugin SDK share one implementation: the Stats page renders
 * the returned string as text, and `sparkline()` in the SDK places it in a
 * scene node. A short series is never stretched — fewer values means fewer
 * glyphs — so a sparkline always says exactly how many buckets it covers.
 */
export type SparklineReduce = "sum" | "max" | "mean"

/** Low to high; every glyph occupies one cell in a terminal. */
export const SPARKLINE_RAMP = "▁▂▃▄▅▆▇█"

export type SparklineOptions = {
  values: readonly number[]
  /** Columns; values are bucketed down to this width. Defaults to the count. */
  width?: number
  /** Scale top; defaults to the tallest bucket (at least 1). */
  max?: number
  /** Glyph ramp from low to high. Defaults to blocks. */
  ramp?: string
  /** How values collapse into a bucket when there are more values than columns. */
  reduce?: SparklineReduce
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function collapse(values: readonly number[], width: number, reduce: SparklineReduce): number[] {
  if (values.length <= width) return [...values]
  const out: number[] = []
  for (let column = 0; column < width; column++) {
    const from = Math.floor((column * values.length) / width)
    const to = Math.max(from + 1, Math.floor(((column + 1) * values.length) / width))
    const slice = values.slice(from, to)
    if (reduce === "max") out.push(Math.max(...slice))
    else if (reduce === "mean") {
      out.push(slice.reduce((total, value) => total + value, 0) / Math.max(1, slice.length))
    } else out.push(slice.reduce((total, value) => total + value, 0))
  }
  return out
}

/**
 * The glyph line for a series.
 *
 *   sparklineText({ values: [1, 4, 2, 9, 3] }) // "▁▄▂█▃"
 *
 * Negative and non-finite values count as zero. The highest value fills the
 * top glyph; pass `max` to keep the scale stable across frames.
 */
export function sparklineText(options: SparklineOptions): string {
  const values = options.values.map(finite)
  if (values.length === 0) return ""
  const width = Math.max(1, Math.min(values.length, Math.round(options.width ?? values.length)))
  const ramp = Array.from(options.ramp ?? SPARKLINE_RAMP)
  if (ramp.length < 2) return ""
  const buckets = collapse(values, width, options.reduce ?? "sum")
  const peak =
    options.max !== undefined && Number.isFinite(options.max) && options.max > 0
      ? options.max
      : Math.max(1, ...buckets)
  return buckets
    .map((value) => {
      const level = Math.max(0, Math.min(1, value / peak))
      const index = Math.min(ramp.length - 1, Math.floor(level * (ramp.length - 1)))
      return ramp[index]!
    })
    .join("")
}
