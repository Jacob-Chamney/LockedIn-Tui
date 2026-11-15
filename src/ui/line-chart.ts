/**
 * Line charts: scaled points, optional y-axis labels and row fitting.
 *
 * One implementation serves the plugin SDK (`lineChart()` places the rows) and
 * the app's Stats hero. Values are bucketed to the plot width with sum, peak or
 * mean; the scale starts at `min` (0 by default) and ends at the largest bucket.
 * Each row is `label│grid` when the axis is on, so the chart reads without a
 * second layout pass.
 */
export type LineChartReduce = "sum" | "max" | "mean"

export type LineChartGlyphs = {
  point: string
  vertical: string
  axis: string
}

export const LINE_CHART_GLYPHS: Readonly<LineChartGlyphs> = {
  point: "•",
  vertical: "│",
  axis: "│",
}

export type LineChartOptions = {
  values: readonly number[]
  /** Total chart width including the axis. */
  width: number
  /** Plot rows; defaults to 4. */
  height?: number
  min?: number
  max?: number
  reduce?: LineChartReduce
  /** Draw y-axis labels and the `│` column; defaults true. */
  axis?: boolean
  /** Axis column width; defaults 4. */
  axisWidth?: number
  /** Top and bottom axis labels; defaults to the rounded max/min. */
  labels?: readonly [string, string]
  glyphs?: Partial<LineChartGlyphs>
}

export type LineChartPoint = {
  x: number
  /** Row from the top. */
  y: number
  value: number
}

export type LineChartLayout = {
  rows: string[]
  points: LineChartPoint[]
  width: number
  height: number
  plotWidth: number
  axisWidth: number
  min: number
  max: number
  /** Bucketed values, one per plot column. */
  buckets: number[]
  labels: readonly [string, string]
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function bucketValues(values: readonly number[], width: number, reduce: LineChartReduce): number[] {
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

function rounded(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function lineChartLayout(options: LineChartOptions): LineChartLayout {
  const width = Math.max(0, Math.floor(options.width))
  const height = Math.max(1, Math.floor(options.height ?? 4))
  if (width === 0) {
    return {
      rows: [],
      points: [],
      width: 0,
      height,
      plotWidth: 0,
      axisWidth: 0,
      min: 0,
      max: 1,
      buckets: [],
      labels: ["0", "0"],
    }
  }
  const axis = options.axis !== false
  const axisWidth = axis ? Math.max(1, Math.min(Math.floor(options.axisWidth ?? 4), Math.max(1, width - 1))) : 0
  const plotWidth = Math.max(0, width - axisWidth)
  const glyphs = { ...LINE_CHART_GLYPHS, ...options.glyphs }
  const buckets = bucketValues(options.values, plotWidth, options.reduce ?? "sum")
  const peak = buckets.length === 0 ? 0 : Math.max(...buckets)
  const min = Number.isFinite(options.min) ? (options.min as number) : 0
  const rawMax = options.max !== undefined && Number.isFinite(options.max) ? options.max : peak
  const max = rawMax > min ? rawMax : min + 1
  const labels: readonly [string, string] = options.labels ?? [rounded(max), rounded(min)]

  const grid = Array.from({ length: height }, () => Array.from({ length: plotWidth }, () => " "))
  const points: LineChartPoint[] = buckets.map((value, x) => {
    const fraction = Math.max(0, Math.min(1, (value - min) / (max - min)))
    const y = height - 1 - Math.round(fraction * (height - 1))
    return { x, y, value }
  })

  points.forEach((point, index) => {
    if (plotWidth === 0) return
    const previous = points[index - 1]
    if (previous && previous.x === point.x - 1 && previous.y !== point.y) {
      const from = Math.min(previous.y, point.y) + 1
      const to = Math.max(previous.y, point.y)
      for (let y = from; y < to; y++) {
        if (grid[y]![point.x] === " ") grid[y]![point.x] = glyphs.vertical
      }
    }
    grid[point.y]![point.x] = glyphs.point
  })

  const rows = grid.map((cells, row) => {
    const plot = cells.join("")
    if (!axis) return plot
    const label = row === 0 ? labels[0] : row === height - 1 ? labels[1] : ""
    const room = Math.max(0, axisWidth - 1)
    const fitted =
      label.length <= room ? label : room === 0 ? "" : `${label.slice(0, Math.max(0, room - 1))}…`
    return `${fitted.padStart(room)}${glyphs.axis}${plot}`
  })

  return {
    rows,
    points,
    width,
    height,
    plotWidth,
    axisWidth,
    min,
    max,
    buckets,
    labels,
  }
}
