import { expect, test } from "bun:test"

import {
  CHECKLIST_GLYPHS,
  checklistBox,
  checklistGlyphs,
  checklistRows,
} from "../../src/ui/checklist"

const ITEMS = [
  { id: "a", label: "notes", checked: true },
  { id: "b", label: "filesystem", checked: false },
  { id: "c", label: "legacy", checked: true, disabled: true },
]

test("boxes follow checked and disabled state", () => {
  expect(checklistBox(true)).toBe("[x]")
  expect(checklistBox(false)).toBe("[ ]")
  expect(checklistBox(true, true)).toBe("[-]")
  expect(checklistBox(false, false)).toBe("[ ]")
  expect(CHECKLIST_GLYPHS.unchecked).toBe("[ ]")
})

test("rows carry a marker, box and fitted label", () => {
  const rows = checklistRows({ items: ITEMS, width: 30, selected: 1 })
  expect(rows.map((row) => row.marker)).toEqual(["  ", "▌ ", "  "])
  expect(rows.map((row) => row.box)).toEqual(["[x]", "[ ]", "[-]"])
  expect(rows[0]!.prefixWidth).toBe(6)
  expect(rows[0]!.label).toBe("notes")
  expect(rows[1]!.selected).toBe(true)
  expect(rows[2]!.disabled).toBe(true)
})

test("labels truncate to the row", () => {
  const rows = checklistRows({
    items: [{ id: "a", label: "a-very-long-plugin-name-that-will-not-fit", checked: false }],
    width: 14,
  })
  expect(rows[0]!.label.endsWith("…")).toBe(true)
})

test("custom glyphs set the box width", () => {
  const glyphs = checklistGlyphs({ checked: "✓", unchecked: "·", disabled: "-" })
  const rows = checklistRows({ items: ITEMS, width: 30, glyphs })
  expect(rows.map((row) => row.box)).toEqual(["✓", "·", "-"])
  expect(rows[0]!.prefixWidth).toBe(2)
})

test("an empty list has no rows", () => {
  expect(checklistRows({ items: [], width: 40 })).toEqual([])
})
