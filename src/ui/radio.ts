/**
 * Radio rows: a one-of-many marker, a label and an optional cursor marker.
 *
 * One implementation serves the plugin SDK (`radio()` places scene nodes) and
 * the app's theme picker. Markers are three cells (`(•)`, `( )`); the prefix is
 * the marker column (when selectable), the box and one space, so labels line up.
 */
export type RadioGlyphs = {
  on: string
  off: string
}

export const RADIO_GLYPHS: Readonly<RadioGlyphs> = {
  on: "(•)",
  off: "( )",
}

export function radioGlyphs(overrides?: Partial<RadioGlyphs>): RadioGlyphs {
  return { ...RADIO_GLYPHS, ...overrides }
}

export function radioBox(checked: boolean, glyphs: RadioGlyphs = RADIO_GLYPHS): string {
  return checked ? glyphs.on : glyphs.off
}

export type RadioItem = {
  id: string
  label: string
  /** The value currently in force. */
  checked?: boolean
}

export type RadioRow = {
  id: string
  index: number
  marker: string
  box: string
  label: string
  checked: boolean
  selected: boolean
  boxWidth: number
  /** Cells used before the label starts. */
  prefixWidth: number
}

export type RadioOptions = {
  items: readonly RadioItem[]
  /** Total row width in cells, including the marker column when selectable. */
  width: number
  /** Draw a marker column and mark this row. */
  selected?: number
  marker?: { selected?: string; rest?: string }
  glyphs?: Partial<RadioGlyphs>
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function radioRows(options: RadioOptions): RadioRow[] {
  const items = options.items
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(options.width))
  const glyphs = radioGlyphs(options.glyphs)
  const selectable = options.selected !== undefined
  const selectedMarker = options.marker?.selected ?? "▌ "
  const restMarker = options.marker?.rest ?? "  "
  const boxWidth = Math.max(glyphs.on.length, glyphs.off.length)

  return items.map((item, index) => {
    const selected = selectable && index === options.selected
    const marker = selectable ? (selected ? selectedMarker : restMarker) : ""
    const box = radioBox(item.checked === true, glyphs).padEnd(boxWidth)
    const prefixWidth = marker.length + box.length + 1
    return {
      id: item.id,
      index,
      marker,
      box,
      label: fit(item.label, Math.max(1, width - prefixWidth)),
      checked: item.checked === true,
      selected,
      boxWidth,
      prefixWidth,
    }
  })
}
