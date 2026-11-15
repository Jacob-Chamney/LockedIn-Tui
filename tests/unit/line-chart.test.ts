import { expect, test } from "bun:test"

import { LINE_CHART_GLYPHS, lineChartLayout } from "../../src/ui/line-chart"

test("a short series stretches across the plot width", () => {
  const layout = lineChartLayout({ values: [0, 10, 5, 20], width: 14, height: 4, axis: false })
  expect(layout.max).toBe(20)
  expect(layout.min).toBe(0)
  expect(layout.plotWidth).toBe(14)
  expect(layout.points.map((point) => point.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  expect(new Set(layout.points.map((point) => point.y))).toEqual(new Set([0, 1, 2, 3]))
  expect(layout.rows).toHaveLength(4)
  for (const row of layout.rows) expect(row).toHaveLength(14)
  expect(layout.rows[0]!.slice(11)).toBe("•••")
  expect(layout.rows[3]!.slice(0, 4)).toBe("••••")
  expect(layout.rows[1]!).toContain("│")
  expect(LINE_CHART_GLYPHS.point).toBe("•")
})

test("the axis reserves a labelled column", () => {
  const layout = lineChartLayout({
    values: [0, 9],
    width: 12,
    height: 3,
    labels: ["9", "0"],
  })
  expect(layout.axisWidth).toBe(4)
  expect(layout.plotWidth).toBe(8)
  expect(layout.rows[0]!.startsWith("  9│")).toBe(true)
  expect(layout.rows[1]!.startsWith("   │")).toBe(true)
  expect(layout.rows[2]!.startsWith("  0│")).toBe(true)
  for (const row of layout.rows) expect(row).toHaveLength(12)
})

test("long axis labels are fitted, not allowed to widen the row", () => {
  const layout = lineChartLayout({
    values: [1, 2],
    width: 8,
    height: 2,
    axisWidth: 4,
    labels: ["123456", "0"],
  })
  expect(layout.rows[0]!.startsWith("12…│")).toBe(true)
  expect(layout.rows[0]).toHaveLength(8)
})

test("values bucket to the plot width", () => {
  const sum = lineChartLayout({ values: [1, 2, 3, 4], width: 2, height: 4, axis: false })
  expect(sum.buckets).toEqual([3, 7])
  const peak = lineChartLayout({ values: [1, 9, 2, 3], width: 2, height: 4, axis: false, reduce: "max" })
  expect(peak.buckets).toEqual([9, 3])
  const mean = lineChartLayout({ values: [2, 4, 6, 8], width: 2, height: 4, axis: false, reduce: "mean" })
  expect(mean.buckets).toEqual([3, 7])
})

test("empty input and zero width are safe", () => {
  const empty = lineChartLayout({ values: [], width: 10, height: 3 })
  expect(empty.points).toEqual([])
  expect(empty.rows).toHaveLength(3)
  for (const row of empty.rows) expect(row).toHaveLength(10)
  expect(lineChartLayout({ values: [1], width: 0 }).rows).toEqual([])
})

test("custom glyphs are honoured", () => {
  const layout = lineChartLayout({
    values: [0, 9],
    width: 8,
    height: 3,
    axis: false,
    glyphs: { point: "*", vertical: "|" },
  })
  expect(layout.rows[0]).toContain("*")
  expect(layout.rows[1]).toContain("|")
})
