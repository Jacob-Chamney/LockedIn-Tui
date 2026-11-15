/**
 * Braille charts: sub-cell columns and areas on a 2×4 dot grid.
 *
 * A terminal cell holds eight braille dots, so a chart can use four vertical
 * levels per row and two horizontal samples per column. Bars and filled areas
 * both come from the same layout, which is what makes the Stats charts crisp
 * without an image protocol.
 */
export type BrailleChartMode = "bar" | "area"

export type BrailleChartOptions = {
  values: readonly number[]
  /** Character width; each cell is two dot columns. */
  width: number
  /** Character height; each cell is four dot rows. */
  height?: number
  /** Scale top; defaults to the tallest value. */
  max?: number
  /** Bars keep each value over its own slice; areas interpolate between them. */
  mode?: BrailleChartMode
}

export type BrailleChartLayout = {
  rows: string[]
  width: number
  height: number
  max: number
  /** Values after the per-column mapping, for tests and tooltips. */
  buckets: number[]
}

/** Dot bits for a 2×4 cell, indexed [row][column]. */
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

const BLANK = " "

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function braille(bits: number): string {
  if (bits === 0) return BLANK
  // A fully covered cell is a solid block; only the partial edge keeps dots.
  // This is what makes a bar read as a bar instead of a stipple.
  if (bits === 0xff) return "█"
  return String.fromCharCode(0x2800 + bits)
}

export function brailleChartLayout(options: BrailleChartOptions): BrailleChartLayout {
  const width = Math.max(0, Math.floor(options.width))
  const height = Math.max(1, Math.floor(options.height ?? 4))
  if (width === 0) return { rows: [], width: 0, height, max: 1, buckets: [] }

  const values = options.values.map(finite)
  if (values.length === 0) {
    return { rows: Array.from({ length: height }, () => " ".repeat(width)), width, height, max: 1, buckets: [] }
  }

  const mode = options.mode ?? "bar"
  const dotWidth = width * 2
  const dotHeight = height * 4
  const peak = Math.max(1, ...values)
  const max = options.max !== undefined && Number.isFinite(options.max) && options.max > 0 ? options.max : peak

  const buckets = Array.from({ length: dotWidth }, (_, column) => {
    if (mode === "bar") {
      const index = Math.min(values.length - 1, Math.floor((column * values.length) / dotWidth))
      return values[index]!
    }
    // Area: interpolate between samples so a short series is a smooth line
    // rather than a staircase.
    const at = values.length === 1 ? 0 : (column / Math.max(1, dotWidth - 1)) * (values.length - 1)
    const from = Math.floor(at)
    const to = Math.min(values.length - 1, from + 1)
    const t = at - from
    return values[from]! * (1 - t) + values[to]! * t
  })

  const bits = Array.from({ length: height }, () => Array.from({ length: width }, () => 0))
  const setDot = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= dotWidth || y >= dotHeight) return
    const cellX = Math.floor(x / 2)
    const cellY = Math.floor(y / 4)
    bits[cellY]![cellX]! |= DOTS[y % 4]![x % 2]!
  }

  for (let column = 0; column < dotWidth; column++) {
    const value = buckets[column]!
    if (value <= 0) continue
    const fill = Math.min(dotHeight, Math.max(1, Math.round((value / max) * dotHeight)))
    if (mode === "bar") {
      for (let row = dotHeight - fill; row < dotHeight; row++) setDot(column, row)
    } else {
      const line = dotHeight - fill
      setDot(column, line)
      for (let row = line + 1; row < dotHeight; row++) setDot(column, row)
    }
  }

  return {
    rows: bits.map((row) => row.map(braille).join("")),
    width,
    height,
    max,
    buckets,
  }
}

/** The chart as plain lines, top first. */
export function brailleChartText(options: BrailleChartOptions): string[] {
  return brailleChartLayout(options).rows
}
