import { expect, test } from "bun:test"

import {
  DEFINITION_ROLES,
  definitionListLayout,
  definitionListText,
  definitionRole,
} from "../../src/ui/definition-list"

const ITEMS = [
  { term: "today", description: "1652 tok · $0.0039" },
  { term: "month", description: "11000 tok · $0.0420" },
]

test("terms share a column and descriptions sit after the gap", () => {
  const layout = definitionListLayout({ items: ITEMS, width: 40 })
  expect(layout.termWidth).toBe(5)
  expect(layout.rows[0]!.text).toBe("today  1652 tok · $0.0039")
  expect(layout.rows[1]!.text).toBe("month  11000 tok · $0.0420")
  expect(layout.height).toBe(2)
  expect(definitionListText({ items: ITEMS, width: 40 })).toHaveLength(2)
})

test("long descriptions wrap and continuation lines align", () => {
  const layout = definitionListLayout({
    items: [{ term: "note", description: "one two three four five six seven eight" }],
    width: 20,
  })
  expect(layout.rows[0]!.lines.length).toBeGreaterThan(1)
  expect(layout.rows[0]!.text.startsWith("note  one")).toBe(true)
  expect(layout.rows[0]!.continuation[0]!.startsWith("      ")).toBe(true)
  expect(layout.height).toBe(layout.rows[0]!.lines.length)
})

test("maxLines clips with an ellipsis and custom widths are honoured", () => {
  const layout = definitionListLayout({
    items: [{ term: "a", description: "one two three four five six seven" }],
    width: 14,
    termWidth: 2,
    gap: 1,
    maxLines: 1,
  })
  expect(layout.termWidth).toBe(2)
  expect(layout.rows[0]!.lines).toHaveLength(1)
  expect(layout.rows[0]!.text.endsWith("…")).toBe(true)
  for (const line of layout.lines) expect(line.length).toBeLessThanOrEqual(14)
})

test("tones map to roles and empty input is safe", () => {
  expect(definitionRole("error")).toBe(DEFINITION_ROLES.error)
  expect(definitionRole()).toBe("foreground")
  const layout = definitionListLayout({
    items: [{ term: "x", description: "y", tone: "warning" }],
    width: 20,
  })
  expect(layout.rows[0]!.tone).toBe("warning")
  expect(definitionListLayout({ items: ITEMS, width: 0 }).rows).toEqual([])
  expect(definitionListLayout({ items: [], width: 20 }).rows).toEqual([])
})

test("narrow widths never overflow", () => {
  for (const width of [1, 2, 3]) {
    const lines = definitionListText({ items: ITEMS, width })
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(width)
  }
})
