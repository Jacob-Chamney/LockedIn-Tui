/**
 * Combobox filtering and fitting.
 *
 * One implementation serves the command palette and the plugin SDK. Ranking is
 * prefix-first: an exact id wins, then non-alias prefixes, alias prefixes, and
 * only when no prefix matches, substring and description matches. One row per
 * destination keeps an alias from repeating its target.
 */
export type ComboboxOption = {
  id: string
  label: string
  /** Right-aligned note, such as an alias target. */
  meta?: string
  /** Extra searchable text beyond the label. */
  description?: string
  /** Deprioritise this option behind real ids. */
  secondary?: boolean
  /** Dedupe key; defaults to `id`. */
  group?: string
}

export type RankAccessors<T> = {
  id: (item: T) => string
  label: (item: T) => string
  /** Extra text that can match when the id does not. */
  search?: (item: T) => string
  secondary?: (item: T) => boolean
  group?: (item: T) => string
}

/** Filter and rank items; returns every match in priority order. */
export function rankOptions<T>(items: readonly T[], query: string, accessors: RankAccessors<T>): T[] {
  const text = query.trim().toLowerCase()
  if (text === "") return [...items]
  const id = accessors.id
  const label = accessors.search ?? accessors.label
  const secondary = accessors.secondary ?? (() => false)
  const group = accessors.group ?? id
  const exact = items.filter((item) => id(item).toLowerCase() === text)
  const prefix = items.filter(
    (item) => id(item).toLowerCase() !== text && id(item).toLowerCase().startsWith(text) && !secondary(item),
  )
  const secondaryPrefix = items.filter(
    (item) => id(item).toLowerCase() !== text && id(item).toLowerCase().startsWith(text) && secondary(item),
  )
  const contains = items.filter(
    (item) => !id(item).toLowerCase().startsWith(text) && id(item).toLowerCase().includes(text) && !secondary(item),
  )
  const byLabel = items.filter(
    (item) => !id(item).toLowerCase().includes(text) && label(item).toLowerCase().includes(text),
  )
  const prefixes = [...prefix, ...secondaryPrefix]
  const ranked = prefixes.length > 0 ? [...exact, ...prefixes] : [...exact, ...contains, ...byLabel]
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of ranked) {
    const key = group(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

export type ComboboxOptions = {
  options: readonly ComboboxOption[]
  query: string
  /** Available columns. */
  width: number
  /** Selected row; clamped to the matches. */
  selected?: number
  /** Rows kept; defaults to 8. */
  maxRows?: number
  /** Selection marker; defaults `▸ `. */
  marker?: string
  /** Marker/spaces column width; defaults to the marker width. */
  markerWidth?: number
}

export type ComboboxRow = {
  id: string
  label: string
  meta: string
  marker: string
  /** Marker, label and right-aligned meta, fitted to the width. */
  text: string
  /** Cells before the meta starts. */
  labelWidth: number
  metaWidth: number
  selected: boolean
  index: number
}

export type ComboboxLayout = {
  rows: ComboboxRow[]
  hidden: number
  selected: number
  matches: ComboboxOption[]
  width: number
  query: string
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function comboboxLayout(options: ComboboxOptions): ComboboxLayout {
  const width = Math.max(0, Math.floor(options.width))
  if (width === 0) {
    return { rows: [], hidden: options.options.length, selected: -1, matches: [], width: 0, query: options.query }
  }
  const maxRows = Math.max(1, Math.floor(options.maxRows ?? 8))
  const matched = rankOptions(options.options, options.query, {
    id: (option) => option.id,
    label: (option) => option.label,
    search: (option) => `${option.label} ${option.description ?? ""}`,
    secondary: (option) => option.secondary === true,
    group: (option) => option.group ?? option.id,
  })
  const visible = matched.slice(0, maxRows)
  const selected = visible.length === 0 ? -1 : Math.max(0, Math.min(visible.length - 1, Math.round(options.selected ?? 0)))
  const marker = options.marker ?? "▸ "
  const markerWidth = Math.max(
    marker.length,
    Math.floor(options.markerWidth ?? marker.length),
  )
  const rows: ComboboxRow[] = visible.map((option, index) => {
    const isSelected = index === selected
    const prefix = `${isSelected ? marker : " ".repeat(marker.length)}`.padEnd(markerWidth)
    const meta = option.meta ?? ""
    const room = Math.max(0, width - markerWidth)
    const label = fit(option.label, Math.max(0, room - (meta === "" ? 0 : meta.length + 1)))
    let text: string
    let labelWidth = prefix.length + label.length
    let metaWidth = 0
    if (meta !== "" && label !== "" && labelWidth + 1 + meta.length <= width) {
      const gap = width - labelWidth - meta.length
      text = `${prefix}${label}${" ".repeat(gap)}${meta}`
      metaWidth = meta.length
    } else {
      text = `${prefix}${label}`
      labelWidth = Math.min(width, labelWidth)
    }
    return {
      id: option.id,
      label,
      meta: metaWidth > 0 ? meta : "",
      marker: prefix,
      text: fit(text, width),
      labelWidth,
      metaWidth,
      selected: isSelected,
      index,
    }
  })
  return {
    rows,
    hidden: matched.length - visible.length,
    selected,
    matches: visible,
    width,
    query: options.query,
  }
}
