/**
 * Legend layout: coloured glyphs with optional labels.
 *
 * One implementation serves the plugin SDK (`legend()` places scene nodes) and
 * the app's Stats heatmap legend. Entries are laid out left to right with a gap;
 * the first entry that does not fit ends the row, so a legend never wraps or
 * clips mid-swatch.
 */
export type LegendItem = {
  /** A glyph or swatch; one or more cells. */
  glyph: string
  /** Optional text after the glyph. */
  label?: string
  /** Palette role for the glyph; defaults to the legend's `tone` or `muted`. */
  tone?: string
}

export type LegendSegment = {
  glyph: string
  label: string
  tone: string
  /** Offset from the legend's left edge. */
  x: number
  /** Cells used by glyph + label. */
  width: number
  index: number
}

export type LegendOptions = {
  items: readonly LegendItem[]
  /** Available columns for the whole row. */
  width: number
  /** Spaces between entries; defaults to 2. */
  gap?: number
  /** Draw labels; defaults true (an item without a label still shows its glyph). */
  labels?: boolean
  /** Tone for items that do not set one; defaults to `muted`. */
  tone?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function legendLayout(options: LegendOptions): LegendSegment[] {
  const items = options.items
  if (items.length === 0) return []
  const width = Math.max(0, Math.floor(options.width))
  if (width === 0) return []
  const gap = clamp(Math.floor(options.gap ?? 2), 0, 8)
  const labels = options.labels !== false
  const fallbackTone = options.tone ?? "muted"
  const out: LegendSegment[] = []
  let x = 0

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!
    const label = labels ? (item.label ?? "") : ""
    const text = label === "" ? item.glyph : `${item.glyph} ${label}`
    const at = out.length === 0 ? 0 : x + gap
    if (at + text.length > width) break
    out.push({
      glyph: item.glyph,
      label,
      tone: item.tone ?? fallbackTone,
      x: at,
      width: text.length,
      index,
    })
    x = at + text.length
  }
  return out
}
