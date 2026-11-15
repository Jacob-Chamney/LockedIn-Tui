import { expect, test } from "bun:test"

import { RADIO_GLYPHS, radioBox, radioGlyphs, radioRows } from "../../src/ui/radio"

const ITEMS = [
  { id: "lockedin", label: "LockedIn Crimson", checked: true },
  { id: "dracula", label: "Dracula" },
  { id: "mono", label: "Mono" },
]

test("markers follow the checked value", () => {
  expect(radioBox(true)).toBe("(•)")
  expect(radioBox(false)).toBe("( )")
  expect(RADIO_GLYPHS.off).toBe("( )")
})

test("rows carry a marker, box and fitted label", () => {
  const rows = radioRows({ items: ITEMS, width: 30, selected: 0 })
  expect(rows.map((row) => row.marker)).toEqual(["▌ ", "  ", "  "])
  expect(rows.map((row) => row.box)).toEqual(["(•)", "( )", "( )"])
  expect(rows[0]!.prefixWidth).toBe(6)
  expect(rows[0]!.label).toBe("LockedIn Crimson")
  expect(rows[0]!.selected).toBe(true)
  expect(rows[0]!.checked).toBe(true)
})

test("labels truncate to the row", () => {
  const rows = radioRows({
    items: [{ id: "a", label: "a-very-long-option-name-that-will-not-fit" }],
    width: 14,
  })
  expect(rows[0]!.label.endsWith("…")).toBe(true)
})

test("custom glyphs set the box width", () => {
  const glyphs = radioGlyphs({ on: "●", off: "○" })
  const rows = radioRows({ items: ITEMS, width: 30, glyphs })
  expect(rows.map((row) => row.box)).toEqual(["●", "○", "○"])
  expect(rows[0]!.prefixWidth).toBe(2)
})

test("an empty list has no rows", () => {
  expect(radioRows({ items: [], width: 40 })).toEqual([])
})

test("no selection means no marker column", () => {
  const rows = radioRows({ items: ITEMS, width: 30 })
  expect(rows.every((row) => row.marker === "")).toBe(true)
  expect(rows[0]!.prefixWidth).toBe(4)
})
