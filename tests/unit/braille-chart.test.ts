/** Braille chart geometry: sub-cell bars and areas. */
import { expect, test } from "bun:test"

import { brailleChartLayout, brailleChartText } from "../../src/ui/braille-chart"

test("bars use the full cell width and height", () => {
  const layout = brailleChartLayout({ values: [0, 1, 2, 3], width: 4, height: 2, mode: "bar" })
  expect(layout.width).toBe(4)
  expect(layout.height).toBe(2)
  expect(layout.rows).toHaveLength(2)
  for (const row of layout.rows) expect(row).toHaveLength(4)
  expect(layout.max).toBe(3)
})

test("the tallest bar reaches the top and a zero leaves a blank", () => {
  const layout = brailleChartLayout({ values: [4, 0], width: 2, height: 2, mode: "bar" })
  // The first column is full; the second has no dots at all.
  expect(layout.rows[0]![0]).not.toBe(" ")
  expect(layout.rows[0]![1]).toBe(" ")
  expect(layout.rows[1]![1]).toBe(" ")
})

test("an area fills below its line", () => {
  const layout = brailleChartLayout({ values: [1, 4], width: 4, height: 2, mode: "area" })
  const top = layout.rows[0]!
  const bottom = layout.rows[1]!
  // The high end reaches the top; the low end only fills the bottom.
  expect(top.trimEnd().length).toBeGreaterThan(0)
  expect(bottom.trimEnd().length).toBe(4)
  expect(layout.buckets).toHaveLength(8)
})

test("a max override keeps the scale stable as values change", () => {
  const small = brailleChartLayout({ values: [1], width: 1, height: 2, max: 10 })
  const large = brailleChartLayout({ values: [10], width: 1, height: 2, max: 10 })
  expect(small.rows[0]![0]).toBe(" ")
  expect(large.rows[0]![0]).not.toBe(" ")
  expect(small.max).toBe(10)
})

test("empty values are blank rows of the requested width", () => {
  const layout = brailleChartLayout({ values: [], width: 5, height: 3 })
  expect(layout.rows).toEqual(["     ", "     ", "     "])
  expect(layout.buckets).toEqual([])
})

test("the chart text is rows, top first", () => {
  const rows = brailleChartText({ values: [1, 2, 3], width: 3, height: 2 })
  expect(rows).toHaveLength(2)
  expect(rows.join("").trim().length).toBeGreaterThan(0)
  expect(rows.every((row) => row.length === 3)).toBe(true)
})
