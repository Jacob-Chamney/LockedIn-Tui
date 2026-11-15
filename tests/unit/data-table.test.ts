import { expect, test } from "bun:test"

import { dataTableLayout, dataTableText } from "../../src/ui/data-table"

const COLUMNS = [{ label: "TOOL" }, { label: "ACCESS" }]
const ROWS = [
  ["read_note", "read-only"],
  ["write_note", "write-capable"],
]

test("the header, rule and rows share fitted columns", () => {
  const layout = dataTableLayout({ columns: COLUMNS, rows: ROWS, width: 40, selected: 0 })
  expect(layout.widths).toEqual([10, 13])
  expect(layout.header).toBe("  TOOL        ACCESS       ")
  expect(layout.rule).toHaveLength(40)
  expect(layout.rows[0]!.text).toBe("▸ read_note   read-only    ")
  expect(layout.rows[1]!.text).toBe("  write_note  write-capable")
  expect(layout.rows[0]!.selected).toBe(true)
  expect(layout.height).toBe(4)
})

test("no selection means no marker column", () => {
  const layout = dataTableLayout({ columns: COLUMNS, rows: ROWS, width: 40 })
  expect(layout.rows[0]!.text).toBe("read_note   read-only    ")
  expect(layout.rows[0]!.selected).toBe(false)
})

test("columns shrink until the width fits and keep their alignment", () => {
  const layout = dataTableLayout({
    columns: [{ label: "a", align: "right" }, { label: "b", align: "center" }],
    rows: [["one", "two"]],
    width: 9,
    gap: 1,
  })
  expect(layout.widths.reduce((sum, cell) => sum + cell, 0) + 1).toBeLessThanOrEqual(9)
  for (const row of layout.rows) expect(row.text.length).toBeLessThanOrEqual(9)
})

test("header and rule can be hidden", () => {
  const layout = dataTableLayout({ columns: COLUMNS, rows: ROWS, width: 20, header: false })
  expect(layout.header).toBe("")
  expect(layout.rule).toBe("")
  expect(layout.height).toBe(2)
  expect(dataTableText({ columns: COLUMNS, rows: ROWS, width: 20 })).toHaveLength(4)
})

test("zero width and no columns are empty", () => {
  expect(dataTableLayout({ columns: COLUMNS, rows: ROWS, width: 0 }).rows).toEqual([])
  expect(dataTableLayout({ columns: [], rows: ROWS, width: 20 }).rows).toEqual([])
})

test("narrow widths clip instead of overflowing", () => {
  for (const width of [3, 7, 9]) {
    const lines = dataTableText({ columns: COLUMNS, rows: ROWS, width, selected: 0 })
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(width)
  }
})
