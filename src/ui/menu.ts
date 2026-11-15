/**
 * Menus: section headings, shortcut keys, labels and right-aligned meta.
 *
 * One implementation serves the plugin SDK (`menu()` paints the rows) and the
 * app's leader popup. Sections group entries with a heading; separators are
 * available between groups. A selectable menu adds a marker column, and labels
 * shrink to leave room for a key and meta without wrapping.
 */
export type MenuTone = "normal" | "muted" | "error" | "warning" | "success"

export type MenuEntry = {
  id: string
  label: string
  /** A shortcut or keycap text shown before the label. */
  key?: string
  /** Right-aligned context. */
  meta?: string
  disabled?: boolean
  tone?: MenuTone
}

export type MenuSection = {
  id: string
  title?: string
  entries: readonly MenuEntry[]
  /** Draw a rule after this section; defaults false. */
  separator?: boolean
}

export type MenuOptions = {
  sections: readonly MenuSection[]
  width: number
  /** Add a marker column and mark this entry (absolute entry index). */
  selectable?: boolean
  selected?: number
  /** Selection marker; defaults `▸ `. */
  marker?: string
  /** Prefix on each key, such as a leading space. */
  keyPrefix?: string
  /** Key column width; defaults to the longest key. */
  keyWidth?: number
  /** Spaces after the key and before meta; defaults 1. */
  gap?: number
  /** Rows kept; omitted means all. */
  maxRows?: number
}

export type MenuPartKind = "marker" | "key" | "label" | "meta" | "heading" | "separator"

export type MenuPart = {
  kind: MenuPartKind
  text: string
  x: number
  width: number
}

export type MenuRowKind = "heading" | "separator" | "entry"

export type MenuRow = {
  kind: MenuRowKind
  id: string
  text: string
  parts: MenuPart[]
  tone: MenuTone
  disabled: boolean
  sectionIndex: number
  entryIndex: number | null
  selected: boolean
  keyWidth: number
  markerWidth: number
  gap: number
}

export type MenuLayout = {
  rows: MenuRow[]
  width: number
  hidden: number
  keyWidth: number
  markerWidth: number
  gap: number
  selected: number
  entryCount: number
}

export const MENU_ROLES: Readonly<Record<MenuTone, string>> = {
  normal: "foreground",
  muted: "muted",
  error: "error",
  warning: "warning",
  success: "success",
}

export function menuRole(tone: MenuTone = "normal"): string {
  return MENU_ROLES[tone] ?? "foreground"
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function menuLayout(options: MenuOptions): MenuLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 1)))
  const marker = options.marker ?? "▸ "
  const markerWidth = options.selectable === true ? marker.length : 0
  const keyPrefix = options.keyPrefix ?? ""
  const sections = options.sections
  const entryCount = sections.reduce((sum, section) => sum + section.entries.length, 0)
  const keys = sections.flatMap((section) => section.entries.map((entry) => `${keyPrefix}${entry.key ?? ""}`))
  const keyWidth = Math.min(
    Math.max(
      0,
      Math.floor(options.keyWidth ?? (keys.length === 0 ? 0 : Math.max(0, ...keys.map((key) => key.length)))),
    ),
    Math.max(0, width - markerWidth - gap - 1),
  )
  if (width === 0 || sections.length === 0) {
    return { rows: [], width, hidden: 0, keyWidth, markerWidth, gap, selected: 0, entryCount }
  }
  const selectedEntry = entryCount === 0 ? -1 : Math.max(0, Math.min(entryCount - 1, Math.round(options.selected ?? 0)))
  let entryIndex = 0

  const rows: MenuRow[] = []
  sections.forEach((section, sectionIndex) => {
    if (section.title !== undefined && section.title !== "") {
      const text = fit(section.title, width)
      rows.push({
        kind: "heading",
        id: `${section.id}:heading`,
        text,
        parts: [{ kind: "heading", text, x: 0, width: text.length }],
        tone: "muted",
        disabled: false,
        sectionIndex,
        entryIndex: null,
        selected: false,
        keyWidth,
        markerWidth,
        gap,
      })
    }
    for (const entry of section.entries) {
      const index = entryIndex
      entryIndex += 1
      const selected = options.selectable === true && index === selectedEntry
      const markerText = selected ? marker : " ".repeat(markerWidth)
      const keyText = keyWidth === 0 ? "" : fit(`${keyPrefix}${entry.key ?? ""}`, keyWidth).padEnd(keyWidth)
      const parts: MenuPart[] = []
      let x = 0
      if (markerWidth > 0) {
        parts.push({ kind: "marker", text: markerText, x, width: markerWidth })
        x += markerWidth
      }
      if (keyWidth > 0) {
        const text = `${keyText}${" ".repeat(gap)}`
        parts.push({ kind: "key", text, x, width: keyWidth + gap })
        x += keyWidth + gap
      }
      const available = Math.max(0, width - x)
      let meta = entry.meta ?? ""
      let labelWidth = available
      if (meta !== "" && available >= meta.length + 5) labelWidth = available - meta.length - 1
      else meta = ""
      const label = fit(entry.label, labelWidth)
      parts.push({ kind: "label", text: label, x, width: labelWidth })
      x += label.length
      if (meta !== "") {
        const spaces = Math.max(1, width - x - meta.length)
        parts.push({ kind: "meta", text: `${" ".repeat(spaces)}${meta}`, x, width: spaces + meta.length })
        x += spaces + meta.length
      }
      rows.push({
        kind: "entry",
        id: entry.id,
        text: parts.map((part) => part.text).join("").slice(0, width),
        parts,
        tone: entry.disabled ? "muted" : (entry.tone ?? "normal"),
        disabled: entry.disabled === true,
        sectionIndex,
        entryIndex: index,
        selected,
        keyWidth,
        markerWidth,
        gap,
      })
    }
    if (section.separator === true && sectionIndex < sections.length - 1) {
      const text = "─".repeat(width)
      rows.push({
        kind: "separator",
        id: `${section.id}:separator`,
        text,
        parts: [{ kind: "separator", text, x: 0, width }],
        tone: "muted",
        disabled: false,
        sectionIndex,
        entryIndex: null,
        selected: false,
        keyWidth,
        markerWidth,
        gap,
      })
    }
  })

  const maxRows = options.maxRows === undefined ? rows.length : Math.max(0, Math.floor(options.maxRows))
  const visible = rows.slice(0, maxRows)
  return {
    rows: visible,
    width,
    hidden: rows.length - visible.length,
    keyWidth,
    markerWidth,
    gap,
    selected: selectedEntry,
    entryCount,
  }
}

/** The menu as plain lines. */
export function menuText(options: MenuOptions): string[] {
  return menuLayout(options).rows.map((row) => row.text)
}
