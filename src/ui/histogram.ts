/**
 * Histograms: values counted into bins and drawn as block columns.
 *
 * One implementation serves the plugin SDK (`histogram()` paints the chart)
 * and the app's Usage run-size block. Values are split into equal-width bins
 * across their own range; each column's height is its count relative to the
 * busiest bin. Empty bins stay blank so gaps read as gaps.
 */
export type HistogramOptions = {
  values: readonly number[]
  /** Total chart width in cells. */
  width: number
  /** Chart rows; defaults 3. */
  height?: number
  /** Number of bins; defaults to the width. */
  bins?: number
  /** Bar glyph; defaults `█`. */
  glyph?: string
}

export type HistogramBin = {
  index: number
  /** Inclusive lower bound. */
  from: number
  /** Exclusive upper bound, except the last bin which includes max. */
  to: number
  count: number
  /** Rows filled from the bottom. */
  level: number
}

export type HistogramLayout = {
  rows: string[]
  bins: HistogramBin[]
  width: number
  height: number
  total: number
  min: number
  max: number
  maxCount: number
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function round(value: number): number {
  return Number(value.toFixed(3))
}

export function histogramLayout(options: HistogramOptions): HistogramLayout {
  const width = Math.max(0, Math.floor(options.width))
  const height = Math.max(1, Math.floor(options.height ?? 3))
  const values = options.values.map(finite)
  if (width === 0 || values.length === 0) {
    return {
      rows: [],
      bins: [],
      width,
      height,
      total: values.length,
      min: 0,
      max: 0,
      maxCount: 0,
    }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const binCount = Math.max(1, Math.min(width, Math.floor(options.bins ?? width)))
  const span = max > min ? max - min : 1
  const counts = Array.from({ length: binCount }, () => 0)
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(((value - min) / span) * binCount)))
    counts[index] = (counts[index] ?? 0) + 1
  }
  const maxCount = Math.max(0, ...counts)
  const bins = counts.map((count, index) => {
    const from = min + (span * index) / binCount
    const to = index === binCount - 1 ? max : min + (span * (index + 1)) / binCount
    return {
      index,
      from: round(from),
      to: round(to),
      count,
      level: count === 0 || maxCount === 0 ? 0 : Math.max(1, Math.round((count / maxCount) * height)),
    }
  })
  const glyph = options.glyph === undefined || options.glyph === "" ? "█" : options.glyph
  const rows = Array.from({ length: height }, (_, row) => {
    const fromBottom = height - row
    return bins.map((bin) => (bin.level >= fromBottom ? glyph : " ")).join("")
  })
  return { rows, bins, width, height, total: values.length, min, max, maxCount }
}

/** The histogram as plain lines, top first. */
export function histogramText(options: HistogramOptions): string[] {
  return histogramLayout(options).rows
}
