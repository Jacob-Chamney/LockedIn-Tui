/**
 * Data tables: shared column widths, a header rule and one selected row.
 *
 * One implementation serves the plugin SDK (`dataTable()` paints the rows) and
 * the app's MCP tool list. Column widths follow their contents and shrink from
 * the widest until every row fits; cells align left, right or centre and are
 * fitted with `…`. A selection marker is added only when `selected` is set.
 */
export type DataTableAlign = "left" | "right" | "center"

export type DataTableColumn = {
  label: string
  align?: DataTableAlign
}

export type DataTableOptions = {
  columns: readonly DataTableColumn[]
  rows: readonly (readonly string[])[]
  width: number
  /** Selected row index; omitted means no marker column. */
  selected?: number
  /** Spaces between columns; defaults 2. */
  gap?: number
  /** Draw the header row; defaults true. */
  header?: boolean
  /** Draw the rule under the header; defaults true. */
  headerRule?: boolean
}

export type DataTableRow = {
  index: number
  cells: string[]
  text: string
  selected: boolean
}

export type DataTableLayout = {
  header: string
  rule: string
  rows: DataTableRow[]
  widths: number[]
  width: number
  height: number
  gap: number
  columns: readonly DataTableColumn[]
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

function pad(text: string, width: number, align: DataTableAlign): string {
  const shown = fit(text, width)
  if (shown.length >= width) return shown
  const room = width - shown.length
  if (align === "right") return `${" ".repeat(room)}${shown}`
  if (align === "center") {
    const left = Math.floor(room / 2)
    return `${" ".repeat(left)}${shown}${" ".repeat(room - left)}`
  }
  return `${shown}${" ".repeat(room)}`
}

export function dataTableLayout(options: DataTableOptions): DataTableLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 2)))
  const columns = options.columns
  const selectable = options.selected !== undefined
  const markerWidth = selectable ? 2 : 0
  if (width === 0 || columns.length === 0) {
    return {
      header: "",
      rule: "",
      rows: [],
      widths: [],
      width,
      height: 0,
      gap,
      columns,
    }
  }
  const widths = columns.map((column, index) => {
    let cell = Math.max(1, column.label.length)
    for (const row of options.rows) cell = Math.max(cell, (row[index] ?? "").length)
    return Math.max(2, cell)
  })
  const natural =
    markerWidth +
    widths.reduce((sum, cell) => sum + cell, 0) +
    gap * Math.max(0, widths.length - 1)
  let excess = natural - width
  while (excess > 0) {
    let widest = -1
    for (let index = 0; index < widths.length; index++) {
      if (widths[index]! > 2 && (widest === -1 || widths[index]! > widths[widest]!)) widest = index
    }
    if (widest === -1) break
    widths[widest] = widths[widest]! - 1
    excess -= 1
  }
  const renderRow = (cells: readonly string[], marker = ""): string => {
    const padded = columns.map((column, index) => pad(cells[index] ?? "", widths[index]!, column.align ?? "left"))
    return `${marker.padEnd(markerWidth)}${padded.join(" ".repeat(gap))}`
  }
  const showHeader = options.header !== false
  const header = showHeader ? renderRow(columns.map((column) => column.label)) : ""
  const rule = showHeader && options.headerRule !== false ? "─".repeat(Math.max(0, width)) : ""
  const selected = options.selected === undefined ? -1 : Math.max(0, Math.min(options.rows.length - 1, Math.round(options.selected)))
  const rows = options.rows.map((cells, index) => ({
    index,
    cells: cells.map((cell, column) => pad(cell, widths[column]!, columns[column]?.align ?? "left")),
    text: renderRow(cells, selectable ? (index === selected ? "▸ " : "  ") : ""),
    selected: index === selected,
  }))
  return {
    header,
    rule,
    rows,
    widths,
    width,
    height: (showHeader ? 1 : 0) + (rule === "" ? 0 : 1) + rows.length,
    gap,
    columns,
  }
}

/** The data table as plain lines, header and rule first. */
export function dataTableText(options: DataTableOptions): string[] {
  const layout = dataTableLayout(options)
  if (layout.rows.length === 0) return layout.header === "" ? [] : [layout.header, ...(layout.rule === "" ? [] : [layout.rule])]
  return [
    ...(layout.header === "" ? [] : [layout.header]),
    ...(layout.rule === "" ? [] : [layout.rule]),
    ...layout.rows.map((row) => row.text),
  ]
}
