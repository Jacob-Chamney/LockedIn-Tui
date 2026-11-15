/**
 * Multi-select listboxes: a cursor column, checkbox state and one detail line.
 *
 * One implementation serves the plugin SDK (`multiSelect()` paints the rows)
 * and the app's Sources picker. Rows share a fixed prefix so labels line up;
 * the selected row gets a bar, checked rows a filled box, and disabled rows the
 * disabled glyph. A viewport keeps the cursor visible.
 */
export type MultiSelectGlyphs = {
  checked: string
  unchecked: string
  disabled: string
}

export const MULTI_SELECT_GLYPHS: Readonly<MultiSelectGlyphs> = {
  checked: "[x]",
  unchecked: "[ ]",
  disabled: "[-]",
}

export type MultiSelectItem = {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  /** Right-aligned context, such as a size or kind. */
  meta?: string
  /** Override the box, e.g. a folder caret. */
  box?: string
}

export type MultiSelectRow = {
  id: string
  index: number
  selected: boolean
  checked: boolean
  disabled: boolean
  marker: string
  box: string
  label: string
  meta: string
  text: string
  /** Cells before the label starts. */
  prefixWidth: number
}

export type MultiSelectOptions = {
  items: readonly MultiSelectItem[]
  width: number
  cursor: number
  /** First visible item; defaults 0. */
  offset?: number
  /** Visible rows; omitted means all. */
  rows?: number
  glyphs?: Partial<MultiSelectGlyphs>
  /** Selection marker; defaults `▌ `. */
  marker?: string
}

export type MultiSelectLayout = {
  rows: MultiSelectRow[]
  /** Items scrolled above the viewport. */
  hiddenBefore: number
  /** Items after the viewport. */
  hiddenAfter: number
  width: number
  prefixWidth: number
  cursor: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

/** The viewport start that keeps the cursor visible. */
export function multiSelectWindow(count: number, cursor: number, rows: number): number {
  if (count <= rows) return 0
  const half = Math.floor(rows / 2)
  return Math.max(0, Math.min(count - rows, cursor - half))
}

export function multiSelectLayout(options: MultiSelectOptions): MultiSelectLayout {
  const width = Math.max(0, Math.floor(options.width))
  const marker = options.marker ?? "▌ "
  const glyphs = { ...MULTI_SELECT_GLYPHS, ...options.glyphs }
  const boxWidth = Math.max(glyphs.checked.length, glyphs.unchecked.length, glyphs.disabled.length, 1)
  const prefixWidth = marker.length + boxWidth + 1
  const items = options.items
  const cursor = items.length === 0 ? 0 : Math.max(0, Math.min(items.length - 1, Math.round(options.cursor)))
  if (width === 0 || items.length === 0) {
    return { rows: [], hiddenBefore: 0, hiddenAfter: items.length, width, prefixWidth, cursor }
  }
  const rows = Math.max(1, Math.floor(options.rows ?? items.length))
  const offset = Math.max(0, Math.min(Math.max(0, items.length - rows), Math.floor(options.offset ?? multiSelectWindow(items.length, cursor, rows))))
  const visible = items.slice(offset, offset + rows)

  return {
    rows: visible.map((item, at) => {
      const index = offset + at
      const selected = index === cursor
      const disabled = item.disabled === true
      const box = (item.box ?? (disabled ? glyphs.disabled : item.checked ? glyphs.checked : glyphs.unchecked)).padEnd(boxWidth)
      const meta = item.meta ?? ""
      const prefix = `${selected ? marker : " ".repeat(marker.length)}`
      const room = Math.max(0, width - prefixWidth - (meta === "" ? 0 : meta.length + 1))
      const label = fit(item.label, room)
      const labelWidth = prefix.length + box.length + 1 + label.length
      let text: string
      let shownMeta = ""
      if (meta !== "" && labelWidth + 1 + meta.length <= width) {
        text = `${prefix}${box} ${label}${" ".repeat(width - labelWidth - meta.length)}${meta}`
        shownMeta = meta
      } else {
        text = `${prefix}${box} ${label}`
      }
      return {
        id: item.id,
        index,
        selected,
        checked: item.checked,
        disabled,
        marker: prefix,
        box,
        label,
        meta: shownMeta,
        text: fit(text, width),
        prefixWidth,
      }
    }),
    hiddenBefore: offset,
    hiddenAfter: Math.max(0, items.length - offset - visible.length),
    width,
    prefixWidth,
    cursor,
  }
}
