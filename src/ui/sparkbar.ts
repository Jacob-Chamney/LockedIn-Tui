/**
 * Sparkbars: a compact column chart made of stacked block glyphs.
 *
 * One implementation serves the plugin SDK (`sparkbar()` paints the columns)
 * and the app's Stats hero. Values bucket to the chart width; each column is a
 * whole number of cells from the bottom up. Empty values leave a blank column.
 */
export type SparkbarReduce = "sum" | "max" | "mean"

export type SparkbarOptions = {
  values: readonly number[]
  width: number
  /** Rows; defaults 2. */
  height?: number
  /** Scale top; defaults to the tallest bucket. */
  max?: number
  /** Fill glyph; defaults `█`. */
  glyph?: string
  reduce?: SparkbarReduce
}

export type SparkbarLayout = {
  rows: string[]
  buckets: number[]
  levels: number[]
  width: number
  height: number
  max: number
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function bucketValues(values: readonly number[], width: number, reduce: SparkbarReduce): number[] {
  if (values.length === 0 || width <= 0) return []
  if (values.length <= width) return values.map(finite)
  const out: number[] = []
  for (let column = 0; column < width; column++) {
    const from = Math.floor((column * values.length) / width)
    const to = Math.max(from + 1, Math.floor(((column + 1) * values.length) / width))
    const slice = values.slice(from, to).map(finite)
    if (reduce === "max") out.push(Math.max(...slice))
    else if (reduce === "mean") out.push(slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length))
    else out.push(slice.reduce((sum, value) => sum + value, 0))
  }
  return out
}

export function sparkbarLayout(options: SparkbarOptions): SparkbarLayout {
  const width = Math.max(0, Math.floor(options.width))
  const height = Math.max(1, Math.floor(options.height ?? 2))
  if (width === 0) return { rows: [], buckets: [], levels: [], width: 0, height, max: 1 }
  const buckets = bucketValues(options.values, width, options.reduce ?? "sum")
  const peak = buckets.length === 0 ? 0 : Math.max(...buckets)
  const max =
    options.max !== undefined && Number.isFinite(options.max) && options.max > 0
      ? options.max
      : Math.max(1, peak)
  const glyph = options.glyph === undefined || options.glyph === "" ? "█" : options.glyph
  const levels = buckets.map((value) =>
    value <= 0 ? 0 : Math.max(1, Math.min(height, Math.ceil((value / max) * height))),
  )
  const rows = Array.from({ length: height }, (_, row) => {
    const fromBottom = height - row
    return levels.map((level) => (level >= fromBottom ? glyph : " ")).join("")
  })
  return { rows, buckets, levels, width, height, max }
}

/** The sparkbar as plain lines, top first. */
export function sparkbarText(options: SparkbarOptions): string[] {
  return sparkbarLayout(options).rows
}
