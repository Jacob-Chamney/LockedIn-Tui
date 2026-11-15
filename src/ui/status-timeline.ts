/**
 * Vertical status timelines: a time column, connectors, state glyphs and labels.
 *
 * One implementation serves the plugin SDK (`statusTimeline()` paints the rail)
 * and the app's Usage breakdown. Entries draw one row; a detail adds a second
 * row connected by the rail. The last entry closes with `└─`, so the list reads
 * as a timeline rather than a plain table.
 */
export type StatusTimelineState = "info" | "success" | "warning" | "error" | "muted"

export type StatusTimelineEntry = {
  id: string
  /** Time text, already formatted for display. */
  time?: string
  label: string
  /** A second line under the label. */
  detail?: string
  state?: StatusTimelineState
  /** State glyph; defaults are chosen from the state. */
  glyph?: string
}

export type StatusTimelineRoles = Readonly<Record<StatusTimelineState, string>>

export const STATUS_TIMELINE_ROLES: StatusTimelineRoles = {
  info: "secondary",
  success: "success",
  warning: "warning",
  error: "error",
  muted: "muted",
}

const STATE_GLYPHS: Readonly<Record<StatusTimelineState, string>> = {
  info: "·",
  success: "✓",
  warning: "!",
  error: "×",
  muted: "·",
}

export function statusTimelineRole(state: StatusTimelineState = "info"): string {
  return STATUS_TIMELINE_ROLES[state] ?? "secondary"
}

export function statusTimelineGlyph(state: StatusTimelineState = "info"): string {
  return STATE_GLYPHS[state] ?? "·"
}

export type StatusTimelineOptions = {
  entries: readonly StatusTimelineEntry[]
  /** Total row width in cells. */
  width: number
  /** Time column width; defaults to the longest time, or 0 when none has a time. */
  timeWidth?: number
  /** Spaces between columns; defaults 1. */
  gap?: number
  /** Render detail rows; defaults true. */
  details?: boolean
  /** Entries kept; omitted means all. */
  maxEntries?: number
}

export type StatusTimelineRow = {
  kind: "entry" | "detail"
  entryIndex: number
  y: number
  time: string
  connector: string
  glyph: string
  label: string
  state: StatusTimelineState
  timeWidth: number
  connectorWidth: number
  glyphWidth: number
  gap: number
}

export type StatusTimelineLayout = {
  rows: StatusTimelineRow[]
  hidden: number
  width: number
  timeWidth: number
  connectorWidth: number
  glyphWidth: number
  gap: number
  height: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function statusTimelineLayout(options: StatusTimelineOptions): StatusTimelineLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 1)))
  const details = options.details !== false
  const all = options.entries
  const maxEntries = options.maxEntries === undefined ? all.length : Math.max(0, Math.floor(options.maxEntries))
  const visible = all.slice(0, maxEntries)
  const hidden = all.length - visible.length
  const timed = visible.filter((entry) => (entry.time ?? "") !== "")
  const wantedTimeWidth = Math.max(
    0,
    Math.floor(options.timeWidth ?? (timed.length === 0 ? 0 : Math.max(...timed.map((entry) => (entry.time ?? "").length)))),
  )
  const connectorWidth = 2
  const glyphWidth = Math.max(
    1,
    ...visible.map((entry) => entry.glyph?.length ?? statusTimelineGlyph(entry.state).length),
  )
  const base = connectorWidth + gap + glyphWidth + gap + 1
  if (width === 0 || visible.length === 0 || width < base) {
    return {
      rows: [],
      hidden,
      width,
      timeWidth: 0,
      connectorWidth,
      glyphWidth,
      gap,
      height: 0,
    }
  }
  const timeWidth = Math.min(wantedTimeWidth, Math.max(0, width - base - gap))
  const used =
    (timeWidth > 0 ? timeWidth + gap : 0) + connectorWidth + gap + glyphWidth + gap
  const labelWidth = Math.max(1, width - used)
  const rows: StatusTimelineRow[] = []
  let y = 0
  visible.forEach((entry, entryIndex) => {
    const last = entryIndex === visible.length - 1
    const state = entry.state ?? "info"
    rows.push({
      kind: "entry",
      entryIndex,
      y,
      time: fit(entry.time ?? "", timeWidth).padEnd(timeWidth),
      connector: last ? "└─" : "├─",
      glyph: (entry.glyph ?? statusTimelineGlyph(state)).padEnd(glyphWidth),
      label: fit(entry.label, labelWidth),
      state,
      timeWidth,
      connectorWidth,
      glyphWidth,
      gap,
    })
    y += 1
    if (details && entry.detail !== undefined && entry.detail !== "") {
      rows.push({
        kind: "detail",
        entryIndex,
        y,
        time: " ".repeat(timeWidth),
        connector: last ? "  " : "│ ",
        glyph: " ".repeat(glyphWidth),
        label: fit(entry.detail, labelWidth),
        state,
        timeWidth,
        connectorWidth,
        glyphWidth,
        gap,
      })
      y += 1
    }
  })

  return { rows, hidden, width, timeWidth, connectorWidth, glyphWidth, gap, height: y }
}

/** Each timeline row as one plain line. */
export function statusTimelineText(options: StatusTimelineOptions): string[] {
  return statusTimelineLayout(options).rows.map((row) => {
    const time = row.timeWidth > 0 ? `${row.time}${" ".repeat(row.gap)}` : ""
    return `${time}${row.connector}${" ".repeat(row.gap)}${row.glyph}${" ".repeat(row.gap)}${row.label}`
  })
}
