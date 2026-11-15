import { expect, test } from "bun:test"

import { matrixLayout, matrixText } from "../../src/ui/matrix"

const OPTIONS = {
  rows: ["chill", "lockin"],
  columns: ["notes", "files"],
  cells: [
    ["any", "any"],
    ["explicit only", "never"],
  ],
  width: 40,
  headerWidth: 11,
}

test("the header and rows share fitted columns", () => {
  const layout = matrixLayout(OPTIONS)
  expect(layout.widths).toEqual([13, 5])
  expect(layout.header).toBe(`${" ".repeat(11)}  ${"notes".padEnd(13)}  ${"files".padEnd(5)}`)
  expect(layout.rows[0]!.text).toBe(`${"chill".padEnd(11)}  ${"any".padEnd(13)}  ${"any".padEnd(5)}`)
  expect(layout.rows[1]!.cells).toEqual(["explicit only", "never"])
  expect(matrixText(OPTIONS)).toHaveLength(3)
})

test("the widest column shrinks until the row fits", () => {
  const layout = matrixLayout({ ...OPTIONS, width: 30 })
  expect(layout.widths).toEqual([10, 5])
  expect(layout.rows[1]!.cells[0]).toBe("explicit …")
  for (const row of layout.rows) expect(row.text.length).toBeLessThanOrEqual(30)
})

test("notes add a trailing column and whole rows carry tones", () => {
  const layout = matrixLayout({
    ...OPTIONS,
    width: 40,
    notes: ["", "locked"],
    rowTones: ["normal", "muted"],
  })
  expect(layout.rows[0]!.note.trim()).toBe("")
  expect(layout.rows[1]!.note).toBe("locked")
  expect(layout.rows[1]!.text).toContain("locked")
  expect(layout.rows[1]!.tone).toBe("muted")
})

test("custom gaps and very narrow widths are safe", () => {
  const layout = matrixLayout({ ...OPTIONS, gap: 1, width: 20 })
  expect(layout.gap).toBe(1)
  for (const row of layout.rows) expect(row.text.length).toBeLessThanOrEqual(20)
  expect(matrixLayout({ ...OPTIONS, width: 0 }).rows).toEqual([])
})
