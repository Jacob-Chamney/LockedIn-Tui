/**
 * Example: a multi-column session table with a cell cursor.
 *
 * `table` aligns and truncates fixed-width columns, highlights the selected
 * row and one cell. `ctrl+n`/`ctrl+p` move between rows, `[`/`]` between
 * columns, and `o` acts on the selected cell. The cursor is persisted in
 * `ctx.store`; the timer advances rows until a key takes over.
 */
import { definePlugin, footerActions, table, window } from "@lockedin/sdk"

const columns = [
  { label: "session", width: 22 },
  { label: "time", width: 7, align: "right" as const },
  { label: "state", width: 9, align: "center" as const },
]

const rows = [
  { cells: ["Deep work", "25:00", "running"] },
  { cells: ["Review: type systems", "12 cards", "queued"] },
  { cells: ["Design review", "14:30", "today"] },
  { cells: ["Reading: compiler notes", "8 pages", "later"] },
  { cells: ["Plan tomorrow", "5 tasks", "todo"] },
]

let manualRow: number | null = null
let column = 0
let anchor: { row: number; column: number } | null = null
let head: { row: number; column: number } | null = null

function clampRow(index: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(index)))
}

function clampColumn(index: number): number {
  return Math.max(0, Math.min(columns.length - 1, Math.round(index)))
}

export default definePlugin({
  id: "example.scene-table",
  name: "Session table",
  fps: 10,

  activate(ctx) {
    const savedRow = ctx.store.get("row")
    if (typeof savedRow === "number") manualRow = clampRow(savedRow)
    const savedColumn = ctx.store.get("column")
    if (typeof savedColumn === "number") column = clampColumn(savedColumn)
    const anchorRow = ctx.store.get("anchorRow")
    const anchorColumn = ctx.store.get("anchorColumn")
    if (typeof anchorRow === "number" && typeof anchorColumn === "number") {
      anchor = { row: clampRow(anchorRow), column: clampColumn(anchorColumn) }
    }
    const headRow = ctx.store.get("headRow")
    const headColumn = ctx.store.get("headColumn")
    if (typeof headRow === "number" && typeof headColumn === "number") {
      head = { row: clampRow(headRow), column: clampColumn(headColumn) }
    }
  },

  commands: {
    "table-next"(ctx) {
      manualRow = clampRow((manualRow ?? 0) + 1)
      ctx.store.set("row", manualRow)
      ctx.store.set("column", column)
      return `session ${manualRow}`
    },
    "table-prev"(ctx) {
      manualRow = clampRow((manualRow ?? 0) - 1)
      ctx.store.set("row", manualRow)
      ctx.store.set("column", column)
      return `session ${manualRow}`
    },
    "table-col-next"(ctx) {
      column = clampColumn(column + 1)
      manualRow ??= 0
      ctx.store.set("row", manualRow)
      ctx.store.set("column", column)
      return `cell ${manualRow}:${column} · ${rows[manualRow]!.cells[column] ?? ""}`
    },
    "table-col-prev"(ctx) {
      column = clampColumn(column - 1)
      manualRow ??= 0
      ctx.store.set("row", manualRow)
      ctx.store.set("column", column)
      return `cell ${manualRow}:${column} · ${rows[manualRow]!.cells[column] ?? ""}`
    },
    "table-select-start"(ctx) {
      const pointer = ctx.pointer
      if (!pointer || pointer.row === undefined || pointer.column === undefined) return
      manualRow = clampRow(pointer.row)
      column = clampColumn(pointer.column)
      anchor = { row: manualRow, column }
      head = { ...anchor }
      ctx.store.set("row", manualRow)
      ctx.store.set("column", column)
    },
    "table-select-move"(ctx) {
      const pointer = ctx.pointer
      if (!pointer || !anchor || pointer.row === undefined || pointer.column === undefined) return
      head = { row: clampRow(pointer.row), column: clampColumn(pointer.column) }
      manualRow = head.row
      column = head.column
    },
    "table-select-end"(ctx) {
      if (!anchor || !head) return
      manualRow = head.row
      column = head.column
      ctx.store.set("row", manualRow)
      ctx.store.set("column", column)
      ctx.store.set("anchorRow", anchor.row)
      ctx.store.set("anchorColumn", anchor.column)
      ctx.store.set("headRow", head.row)
      ctx.store.set("headColumn", head.column)
      return `range ${anchor.row}:${anchor.column} → ${head.row}:${head.column}`
    },
    "table-open"(ctx) {
      const row = manualRow ?? 0
      ctx.store.set("row", row)
      ctx.store.set("column", column)
      return `${columns[column]!.label}: ${rows[row]!.cells[column] ?? ""}`
    },
  },

  compose(ctx) {
    const time = ctx.time ?? 0
    const selected = manualRow ?? Math.floor(time / 1.8) % rows.length
    return {
      nodes: [
        window({
          id: "table",
          focusable: true,
          anchor: "top-left",
          x: 4,
          y: 4,
          width: 50,
          height: 16,
          title: " sessions ",
          titleAlign: "center",
          padding: 1,
          gap: 1,
          focused: ctx.state?.focusedWindow === "table",
          focusedColor: "accent",
          bg: "surface",
          header: [
            { kind: "text", anchor: "top-left", x: 0, y: 0, text: "Up next", fg: "accent" },
          ],
          body: table({
            columns,
            rows,
            selected,
            column,
            height: 5,
            selectedBg: "accent",
            selectedFg: "surface",
            cursorBg: "warning",
            cursorFg: "background",
            hit: true,
            ...(anchor && head
              ? {
                  selection: { anchor, head },
                  selectionBg: "secondary",
                  selectionFg: "background",
                }
              : {}),
            fg: "muted",
          }),
          footer: [
            footerActions([
              { key: "ctrl+n/p", label: "row" },
              { key: "[ ]", label: "col" },
              { key: "o", label: "open" },
            ]),
          ],
          footerRule: true,
        }),
      ],
    }
  },
})
