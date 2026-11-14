import { expect, test } from "bun:test"

import { heatmapLayout } from "../../src/ui/heatmap"

const week = (tokens: number[]) => tokens.map((value) => ({ runs: value > 0 ? 1 : 0, tokens: value }))

test("levels follow the token scale", () => {
  const layout = heatmapLayout({
    weeks: [week([0, 100, 50, 12, 1, 0, 25])],
    max: 100,
  })
  expect(layout.width).toBe(1)
  expect(layout.cells).toHaveLength(7)
  expect(layout.cells.map((row) => row[0]!.level)).toEqual([0, 4, 2, 1, 1, 0, 1])
  expect(layout.cells.map((row) => row[0]!.glyph)).toEqual(["·", "█", "▒", "░", "░", "·", "░"])
  expect(layout.cells[0]![0]!.tone).toBe("muted")
  expect(layout.cells[1]![0]!.tone).toBe("primary")
})

test("days outside the period are blank", () => {
  const layout = heatmapLayout({ weeks: [[null, null, null, null, null, null, null]] })
  expect(layout.cells.every((row) => row[0]!.glyph === " ")).toBe(true)
  expect(layout.cells.every((row) => row[0]!.tone === "muted")).toBe(true)
})

test("a day with runs but no tokens still counts", () => {
  const layout = heatmapLayout({ weeks: [[{ runs: 2, tokens: 0 }, null, null, null, null, null, null]] })
  expect(layout.cells[0]![0]!.level).toBe(1)
})

test("cellWidth doubles the grid and the month positions", () => {
  const layout = heatmapLayout({
    weeks: [
      week([0, 0, 0, 0, 0, 0, 0]),
      week([0, 0, 0, 0, 0, 0, 0]),
      week([0, 0, 0, 0, 0, 0, 0]),
      week([0, 0, 0, 0, 0, 0, 0]),
    ],
    cellWidth: 2,
    months: [{ week: 2, label: "Mar" }],
  })
  expect(layout.cellWidth).toBe(2)
  expect(layout.width).toBe(8)
  expect(layout.months).toBe("    Mar ")
})

test("an empty grid keeps seven rows", () => {
  const layout = heatmapLayout({ weeks: [] })
  expect(layout.width).toBe(0)
  expect(layout.months).toBe("")
  expect(layout.cells).toHaveLength(7)
  expect(layout.cells[0]).toEqual([])
})

test("custom labels and ramps are honoured", () => {
  const layout = heatmapLayout({
    weeks: [week([0, 1, 0, 0, 0, 0, 0])],
    ramp: [".", "a", "b", "c", "d"],
    dayLabels: ["1", "2", "3", "4", "5", "6", "7"],
  })
  expect(layout.days).toEqual(["1", "2", "3", "4", "5", "6", "7"])
  expect(layout.cells[0]![0]!.glyph).toBe(".")
  expect(layout.cells[1]![0]!.glyph).toBe("d")
})
