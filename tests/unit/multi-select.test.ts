import { expect, test } from "bun:test"

import { MULTI_SELECT_GLYPHS, multiSelectLayout, multiSelectWindow } from "../../src/ui/multi-select"

const ITEMS = [
  { id: "a", label: "notes.md", checked: true },
  { id: "b", label: "diagram.png", checked: false, meta: "12 KB" },
  { id: "c", label: "archive", checked: false, meta: "folder", box: "▸" },
  { id: "d", label: "blocked.bin", checked: false, disabled: true },
]

test("rows share a cursor and checkbox prefix", () => {
  const layout = multiSelectLayout({ items: ITEMS, width: 40, cursor: 1 })
  expect(layout.prefixWidth).toBe(6)
  expect(layout.rows[0]!.text.startsWith("  [x] notes.md")).toBe(true)
  expect(layout.rows[1]!.text.startsWith("▌ [ ] diagram.png")).toBe(true)
  expect(layout.rows[2]!.text.startsWith("  ▸   archive")).toBe(true)
  expect(layout.rows[3]!.text.startsWith("  [-] blocked.bin")).toBe(true)
  expect(MULTI_SELECT_GLYPHS.checked).toBe("[x]")
})

test("meta is right-aligned when it fits", () => {
  const layout = multiSelectLayout({ items: ITEMS, width: 40, cursor: 0 })
  expect(layout.rows[1]!.text).toHaveLength(40)
  expect(layout.rows[1]!.text.endsWith("12 KB")).toBe(true)
  expect(layout.rows[1]!.meta).toBe("12 KB")
})

test("the viewport follows the cursor and reports what is hidden", () => {
  const layout = multiSelectLayout({ items: ITEMS, width: 30, cursor: 3, rows: 2 })
  expect(layout.rows.map((row) => row.index)).toEqual([2, 3])
  expect(layout.hiddenBefore).toBe(2)
  expect(layout.hiddenAfter).toBe(0)
  expect(multiSelectWindow(8, 5, 3)).toBe(4)
})

test("custom glyphs and markers are honoured", () => {
  const layout = multiSelectLayout({
    items: ITEMS.slice(0, 2),
    width: 30,
    cursor: 1,
    glyphs: { checked: "+", unchecked: "-", disabled: "x" },
    marker: "> ",
  })
  expect(layout.rows[0]!.text.startsWith("  + notes.md")).toBe(true)
  expect(layout.rows[1]!.text.startsWith("> - diagram.png")).toBe(true)
})

test("labels fit and zero width is empty", () => {
  const narrow = multiSelectLayout({ items: [{ id: "a", label: "a very long file name", checked: false }], width: 16, cursor: 0 })
  expect(narrow.rows[0]!.text).toHaveLength(16)
  expect(narrow.rows[0]!.text.endsWith("…")).toBe(true)
  expect(multiSelectLayout({ items: ITEMS, width: 0, cursor: 0 }).rows).toEqual([])
  expect(multiSelectLayout({ items: [], width: 20, cursor: 0 }).rows).toEqual([])
})
