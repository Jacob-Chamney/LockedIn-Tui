/**
 * Timeline rows: a time column, a status glyph and a label.
 *
 * One implementation serves the plugin SDK (`timeline()` draws scene nodes)
 * and the app's Activity log. Entries with a `detail` take two rows; the rail
 * glyph on the second row connects them. A selected entry adds a marker column
 * so the same layout can back a cursor-driven list.
 */
export type TimelineTone = "info" | "success" | "warning" | "error" | "muted"

export type TimelineEntry = {
  /** Timestamp text, already formatted for display. */
  time: string
  /** The main line. */
  label: string
  /** A second line under the label; draws the rail. */
  detail?: string
  /** Status glyph; defaults to `●`. */
  glyph?: string
  tone?: TimelineTone
}

export type TimelineRow = {
  index: number
  /** Row offset from the timeline's top (1 or 2 per entry). */
  y: number
  /** Selection marker, or spaces when the layout is not selectable. */
  marker: string
  /** Fitted and padded to `timeWidth`. */
  time: string
  glyph: string
  label: string
  detail?: string
  tone: TimelineTone
  timeWidth: number
  glyphWidth: number
  gap: number
  contentWidth: number
}

export type TimelineLayoutOptions = {
  entries: readonly TimelineEntry[]
  /** Total row width in cells, including the marker column when selectable. */
  width: number
  /** Time column width; defaults to the longest time. */
  timeWidth?: number
  /** Glyph column width; defaults to the widest glyph. */
  glyphWidth?: number
  /** Spaces between columns; defaults to 1. */
  gap?: number
  /** Draw a marker column and mark this entry. */
  selected?: number
  selectable?: boolean
  marker?: { selected?: string; rest?: string }
  /** Render `detail` rows; defaults to true. */
  details?: boolean
}

/** The palette role each tone uses. */
export const TIMELINE_ROLES: Readonly<Record<TimelineTone, string>> = {
  info: "secondary",
  success: "success",
  warning: "warning",
  error: "error",
  muted: "muted",
}

export function timelineRole(tone: TimelineTone = "info"): string {
  return TIMELINE_ROLES[tone] ?? "secondary"
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function timelineRows(options: TimelineLayoutOptions): TimelineRow[] {
  const entries = options.entries
  if (entries.length === 0) return []
  const width = Math.max(1, Math.floor(options.width))
  const gap = clamp(Math.floor(options.gap ?? 1), 0, 4)
  const timeWidth = clamp(
    Math.floor(options.timeWidth ?? Math.max(0, ...entries.map((entry) => entry.time.length))),
    0,
    Math.max(0, Math.floor(width / 3)),
  )
  const glyphWidth = clamp(
    Math.floor(
      options.glyphWidth ??
        Math.max(1, ...entries.map((entry) => (entry.glyph ?? "●").length)),
    ),
    1,
    3,
  )
  const selectable = options.selectable === true || options.selected !== undefined
  const selected = options.selected ?? -1
  const selectedMarker = options.marker?.selected ?? "▸"
  const restMarker = options.marker?.rest ?? " "
  const markerWidth = selectable ? Math.max(selectedMarker.length, restMarker.length) + 1 : 0
  const columns =
    markerWidth + timeWidth + (timeWidth > 0 ? gap : 0) + glyphWidth + gap
  const contentWidth = Math.max(4, width - columns)
  const details = options.details !== false
  let y = 0

  return entries.map((entry, index) => {
    const detail = details && entry.detail ? fit(entry.detail, contentWidth) : undefined
    const marker = selectable
      ? `${index === selected ? selectedMarker : restMarker}`.padEnd(markerWidth)
      : ""
    const row: TimelineRow = {
      index,
      y,
      marker,
      time: fit(entry.time, timeWidth).padEnd(timeWidth),
      glyph: fit(entry.glyph ?? "●", glyphWidth).padEnd(glyphWidth),
      label: fit(entry.label, contentWidth),
      ...(detail === undefined ? {} : { detail }),
      tone: entry.tone ?? "info",
      timeWidth,
      glyphWidth,
      gap,
      contentWidth,
    }
    y += detail === undefined ? 1 : 2
    return row
  })
}
