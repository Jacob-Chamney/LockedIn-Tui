import { expect, test } from "bun:test"

import { histogramLayout, histogramText } from "../../src/ui/histogram"

test("values land in equal-width bins", () => {
  const layout = histogramLayout({ values: [1, 2, 2, 4], width: 4, height: 3 })
  expect(layout.bins.map((bin) => [bin.from, bin.to, bin.count])).toEqual([
    [1, 1.75, 1],
    [1.75, 2.5, 2],
    [2.5, 3.25, 0],
    [3.25, 4, 1],
  ])
  expect(layout.total).toBe(4)
  expect(layout.maxCount).toBe(2)
  expect(layout.rows).toEqual([" █  ", "██ █", "██ █"])
})

test("the busiest bin fills the height and empty bins stay blank", () => {
  const layout = histogramLayout({ values: [1, 1, 1, 5], width: 5, height: 2 })
  expect(layout.bins[0]!.level).toBe(2)
  expect(layout.bins.at(-1)!.level).toBe(1)
  expect(layout.bins.filter((bin) => bin.count === 0).every((bin) => bin.level === 0)).toBe(true)
  expect(layout.rows).toHaveLength(2)
})

test("identical and single values are safe", () => {
  const same = histogramLayout({ values: [5, 5, 5], width: 4 })
  expect(same.bins).toHaveLength(4)
  expect(same.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3)
  const one = histogramLayout({ values: [7], width: 4, bins: 2 })
  expect(one.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(1)
})

test("custom glyphs, bin caps and empty input are handled", () => {
  const layout = histogramLayout({ values: [1, 2, 3], width: 10, bins: 2, glyph: "#" })
  expect(layout.bins).toHaveLength(2)
  expect(layout.rows[0]).toContain("#")
  expect(histogramText({ values: [1, 2], width: 4, height: 1 })).toHaveLength(1)
  expect(histogramLayout({ values: [], width: 10 }).rows).toEqual([])
  expect(histogramLayout({ values: [1], width: 0 }).rows).toEqual([])
})
