/**
 * Checklist rows: a checkbox, a label and an optional cursor marker.
 *
 * One implementation serves the plugin SDK (`checklist()` places scene nodes)
 * and the app's plugin manager. Boxes are three cells (`[x]`, `[ ]`, `[-]`);
 * the prefix is the marker column (when selectable), the box and one space, so
 * labels line up under each other.
 */
export type ChecklistGlyphs = {
  checked: string
  unchecked: string
  disabled: string
}

export const CHECKLIST_GLYPHS: Readonly<ChecklistGlyphs> = {
  checked: "[x]",
  unchecked: "[ ]",
  disabled: "[-]",
}

export function checklistGlyphs(overrides?: Partial<ChecklistGlyphs>): ChecklistGlyphs {
  return { ...CHECKLIST_GLYPHS, ...overrides }
}

/** The box for one item; disabled wins over checked. */
export function checklistBox(
  checked: boolean,
  disabled = false,
  glyphs: ChecklistGlyphs = CHECKLIST_GLYPHS,
): string {
  if (disabled) return glyphs.disabled
  return checked ? glyphs.checked : glyphs.unchecked
}

export type ChecklistItem = {
  id: string
  label: string
  checked: boolean
  /** Unavailable; renders `[-]` and keeps its checked state. */
  disabled?: boolean
}

export type ChecklistRow = {
  id: string
  index: number
  marker: string
  box: string
  label: string
  checked: boolean
  disabled: boolean
  selected: boolean
  boxWidth: number
  /** Cells used before the label starts. */
  prefixWidth: number
}

export type ChecklistOptions = {
  items: readonly ChecklistItem[]
  /** Total row width in cells, including the marker column when selectable. */
  width: number
  /** Draw a marker column and mark this row. */
  selected?: number
  marker?: { selected?: string; rest?: string }
  glyphs?: Partial<ChecklistGlyphs>
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function checklistRows(options: ChecklistOptions): ChecklistRow[] {
  const items = options.items
  if (items.length === 0) return []
  const width = Math.max(1, Math.floor(options.width))
  const glyphs = checklistGlyphs(options.glyphs)
  const selectable = options.selected !== undefined
  const selectedMarker = options.marker?.selected ?? "▌ "
  const restMarker = options.marker?.rest ?? "  "
  const boxWidth = Math.max(
    glyphs.checked.length,
    glyphs.unchecked.length,
    glyphs.disabled.length,
  )

  return items.map((item, index) => {
    const selected = selectable && index === options.selected
    const marker = selectable ? (selected ? selectedMarker : restMarker) : ""
    const box = checklistBox(item.checked, item.disabled === true, glyphs).padEnd(boxWidth)
    const prefixWidth = marker.length + box.length + 1
    return {
      id: item.id,
      index,
      marker,
      box,
      label: fit(item.label, Math.max(1, width - prefixWidth)),
      checked: item.checked,
      disabled: item.disabled === true,
      selected,
      boxWidth,
      prefixWidth,
    }
  })
}
