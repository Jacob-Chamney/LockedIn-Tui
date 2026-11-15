import { expect, test } from "bun:test"

import { kanbanLayout } from "../../src/ui/kanban"

const COLUMNS = [
  {
    id: "active",
    title: "ACTIVE",
    cards: [
      { id: "a", title: "build" },
      { id: "b", title: "review" },
    ],
  },
  { id: "done", title: "DONE", cards: [{ id: "c", title: "ship" }] },
]

test("columns split the width and count their cards", () => {
  const layout = kanbanLayout({ columns: COLUMNS, width: 21, selected: "b" })
  expect(layout.gap).toBe(1)
  expect(layout.columns.map((column) => column.width)).toEqual([10, 10])
  expect(layout.columns.map((column) => column.x)).toEqual([0, 11])
  expect(layout.columns.map((column) => column.title)).toEqual(["ACTIVE (2)", "DONE (1)"])
  expect(layout.columns[0]!.cards.map((card) => card.text)).toEqual(["  build", "▌ review"])
  expect(layout.columns[0]!.cards[1]!.selected).toBe(true)
})

test("maxCards keeps the first cards and reports the rest", () => {
  const layout = kanbanLayout({ columns: COLUMNS, width: 30, maxCards: 1 })
  expect(layout.columns[0]!.cards).toHaveLength(1)
  expect(layout.columns[0]!.hidden).toBe(1)
  expect(layout.columns[1]!.hidden).toBe(0)
  expect(layout.height).toBe(3)
})

test("cards and titles fit their column", () => {
  const layout = kanbanLayout({
    columns: [{ id: "a", title: "A-VERY-LONG-TITLE", cards: [{ id: "x", title: "a-long-card-title" }] }],
    width: 12,
  })
  expect(layout.columns[0]!.title.endsWith("…")).toBe(true)
  expect(layout.columns[0]!.cards[0]!.text.endsWith("…")).toBe(true)
})

test("column tones are inherited and cards can override", () => {
  const layout = kanbanLayout({
    columns: [
      { id: "a", title: "A", tone: "warning", cards: [{ id: "x", title: "x" }, { id: "y", title: "y", tone: "error" }] },
    ],
    width: 20,
  })
  expect(layout.columns[0]!.cards.map((card) => card.tone)).toEqual(["warning", "error"])
})

test("empty columns and zero width", () => {
  expect(kanbanLayout({ columns: [], width: 20 })).toEqual({ columns: [], width: 20, height: 0, gap: 0 })
  expect(kanbanLayout({ columns: COLUMNS, width: 0 }).columns).toEqual([])
})

test("a custom gap is honoured", () => {
  const layout = kanbanLayout({ columns: COLUMNS, width: 22, gap: 2 })
  expect(layout.columns.map((column) => column.x)).toEqual([0, 12])
})
