/**
 * Contribution-style heatmap grids.
 *
 * One implementation serves the plugin SDK (`heatmap()` draws scene nodes) and
 * the app's Stats calendar. The grid is column-per-week and row-per-weekday;
 * each day gets an intensity level and a ramp glyph, so busy days read darker
 * without relying on colour alone.
 */
export type HeatmapDay = { runs: number; tokens: number } | null

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4

export type HeatmapCell = {
  level: HeatmapLevel
  glyph: string
  /** Palette role for the cell: `muted` at rest, `primary` when active. */
  tone: "muted" | "primary"
}

export type HeatmapLayout = {
  /** Month labels positioned at their week columns. */
  months: string
  /** Weekday labels, Monday first. */
  days: readonly string[]
  /** One row per weekday; one cell per week. */
  cells: HeatmapCell[][]
  /** Columns per week. */
  cellWidth: number
  /** Width of the grid in cells (weeks × cellWidth). */
  width: number
}

export type HeatmapOptions = {
  weeks: readonly (readonly HeatmapDay[])[]
  months?: readonly { week: number; label: string }[]
  /** Columns per week; 1 or 2. Defaults to 1. */
  cellWidth?: number
  dayLabels?: readonly string[]
  /** Glyph ramp from level 0 to 4; defaults to dots and blocks. */
  ramp?: readonly string[]
  /** Tokens that fill the top level; defaults to the busiest day. */
  max?: number
}

export const HEATMAP_RAMP = ["·", "░", "▒", "▓", "█"] as const
export const HEATMAP_DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function levelFor(day: HeatmapDay, max: number): HeatmapLevel {
  if (day === null) return 0
  const tokens = Number.isFinite(day.tokens) && day.tokens > 0 ? day.tokens : 0
  if (tokens === 0) return day.runs > 0 ? 1 : 0
  const ratio = Math.max(0, Math.min(1, tokens / Math.max(1, max)))
  return Math.min(4, Math.max(1, 1 + Math.floor(ratio * 3.999))) as HeatmapLevel
}

function peakTokens(weeks: readonly (readonly HeatmapDay[])[]): number {
  let peak = 0
  for (const week of weeks) {
    for (const day of week) {
      if (day !== null && Number.isFinite(day.tokens)) peak = Math.max(peak, day.tokens)
    }
  }
  return Math.max(1, peak)
}

function monthLine(
  months: readonly { week: number; label: string }[],
  width: number,
  cellWidth: number,
): string {
  const cells = Array.from({ length: width }, () => " ")
  for (const month of months) {
    const start = month.week * cellWidth
    if (start + month.label.length > width) continue
    for (let index = 0; index < month.label.length; index++) {
      const at = start + index
      if (at < width) cells[at] = month.label[index]!
    }
  }
  return cells.join("")
}

export function heatmapLayout(options: HeatmapOptions): HeatmapLayout {
  const cellWidth = clamp(Math.floor(options.cellWidth ?? 1), 1, 2)
  const days = options.dayLabels ?? HEATMAP_DAYS
  const ramp = options.ramp && options.ramp.length >= 5 ? options.ramp : HEATMAP_RAMP
  const weeks = options.weeks
  const width = weeks.length * cellWidth
  const max =
    options.max !== undefined && Number.isFinite(options.max) && options.max > 0
      ? options.max
      : peakTokens(weeks)
  const cells: HeatmapCell[][] = days.map(() => [])

  for (let week = 0; week < weeks.length; week++) {
    for (let row = 0; row < days.length; row++) {
      const day = weeks[week]?.[row] ?? null
      const level = levelFor(day, max)
      cells[row]!.push({
        level,
        glyph: day === null ? " " : ramp[level]!,
        tone: level === 0 ? "muted" : "primary",
      })
    }
  }

  return {
    months: monthLine(options.months ?? [], width, cellWidth),
    days,
    cells,
    cellWidth,
    width,
  }
}
