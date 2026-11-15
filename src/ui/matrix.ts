/**
 * Matrices: a fixed label column, shared data columns and an optional note.
 *
 * One implementation serves the plugin SDK (`matrix()` draws the table) and the
 * app's MCP policy grid. Column widths derive from their contents, then shrink
 * from the widest column until the row fits; every cell is fitted with `…`.
 * Tones mark whole rows as normal or muted.
 */
export type MatrixRowTone = "normal" | "muted" | "error"

export type MatrixOptions = {
  rows: readonly string[]
  columns: readonly string[]
  /** One cell row per matrix row, in column order. */
  cells: readonly (readonly string[])[]
  width: number
  /** Fixed width of the row-label column; defaults to the longest label. */
  headerWidth?: number
  /** Spaces between columns; defaults 2. */
  gap?: number
  /** Optional trailing note per row, such as a locked reason. */
  notes?: readonly string[]
  rowTones?: readonly MatrixRowTone[]
}

export type MatrixLayoutRow = {
  label: string
  cells: string[]
  note: string
  text: string
  tone: MatrixRowTone
  index: number
}

export type MatrixLayout = {
  header: string
  rows: MatrixLayoutRow[]
  widths: number[]
  width: number
  headerWidth: number
  gap: number
}

function fit(text: string, width: number): string {
  if (width <= 0) return ""
  return text.length <= width ? text : width === 1 ? "…" : `${text.slice(0, width - 1)}…`
}

export function matrixLayout(options: MatrixOptions): MatrixLayout {
  const width = Math.max(0, Math.floor(options.width))
  const gap = Math.max(0, Math.min(4, Math.floor(options.gap ?? 2)))
  const rows = options.rows
  const columns = options.columns
  const notes = options.notes ?? []
  const headerWidth = Math.max(
    1,
    Math.min(
      Math.floor(options.headerWidth ?? Math.max(1, ...rows.map((row) => row.length))),
      Math.max(1, width - 2),
    ),
  )
  if (width === 0 || rows.length === 0 || columns.length === 0) {
    return { header: "", rows: [], widths: [], width, headerWidth, gap }
  }

  const widths = columns.map((column, index) => {
    let cell = column.length
    for (const row of options.cells) cell = Math.max(cell, (row[index] ?? "").length)
    return Math.max(3, cell)
  })
  const noteWidth = notes.some((note) => note !== "")
    ? Math.max(1, ...notes.map((note) => note.length))
    : 0
  const all = noteWidth > 0 ? [...widths, noteWidth] : [...widths]
  const natural = headerWidth + gap + all.reduce((sum, cell) => sum + cell, 0) + gap * Math.max(0, all.length - 1)
  let excess = natural - width
  while (excess > 0) {
    let widest = -1
    for (let index = 0; index < all.length; index++) {
      if (all[index]! > 3 && (widest === -1 || all[index]! > all[widest]!)) widest = index
    }
    if (widest === -1) break
    all[widest] = all[widest]! - 1
    excess -= 1
  }
  const cellWidths = all.slice(0, widths.length)
  const shownNoteWidth = noteWidth > 0 ? all[all.length - 1]! : 0

  const header = fit(
    " ".repeat(headerWidth) +
      " ".repeat(gap) +
      columns.map((column, index) => fit(column, cellWidths[index]!).padEnd(cellWidths[index]!)).join(" ".repeat(gap)) +
      (shownNoteWidth > 0 ? " ".repeat(gap) + " ".repeat(shownNoteWidth) : ""),
    width,
  )

  return {
    header,
    widths: cellWidths,
    width,
    headerWidth,
    gap,
    rows: rows.map((row, index) => {
      const cells = (options.cells[index] ?? []).map((cell, column) => fit(cell, cellWidths[column]!).padEnd(cellWidths[column]!))
      const rawNote = notes[index] ?? ""
      const note = shownNoteWidth > 0 ? fit(rawNote, shownNoteWidth).padEnd(shownNoteWidth) : ""
      return {
        label: fit(row, headerWidth).padEnd(headerWidth),
        cells,
        note,
        text: fit(
          fit(row, headerWidth).padEnd(headerWidth) +
            " ".repeat(gap) +
            cells.join(" ".repeat(gap)) +
            (shownNoteWidth > 0 ? " ".repeat(gap) + note : ""),
          width,
        ),
        tone: options.rowTones?.[index] ?? "normal",
        index,
      }
    }),
  }
}

/** The matrix as plain lines, header first. */
export function matrixText(options: MatrixOptions): string[] {
  const layout = matrixLayout(options)
  if (layout.rows.length === 0) return []
  return [layout.header, ...layout.rows.map((row) => row.text)]
}
