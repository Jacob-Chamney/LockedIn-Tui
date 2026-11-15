import { expect, test } from "bun:test"

import { donutLayout, donutLegendLayout, donutSegments } from "../../src/ui/donut"

const SEGMENTS = [
  { label: "big", value: 75 },
  { label: "small", value: 25 },
]

test("segment shares accumulate in order", () => {
  const segments = donutSegments(SEGMENTS)
  expect(segments.map((segment) => segment.percent)).toEqual([75, 25])
  expect(segments[0]).toMatchObject({ fraction: 0.75, start: 0, end: 0.75 })
  expect(segments[1]).toMatchObject({ fraction: 0.25, start: 0.75, end: 1 })
})

test("ring cells take the segment that owns their angle", () => {
  const layout = donutLayout({ segments: SEGMENTS, size: 8 })
  expect(layout.size).toBe(8)
  expect(layout.height).toBe(4)
  expect(layout.rows).toHaveLength(4)
  for (const row of layout.rows) expect(row.text).toHaveLength(8)
  const cells = layout.rows.flatMap((row) => row.cells).filter((cell) => cell.text !== " ")
  expect(cells.length).toBeGreaterThan(8)
  expect(cells.some((cell) => cell.segment === 0)).toBe(true)
  expect(cells.some((cell) => cell.segment === 1)).toBe(true)
  // The larger share owns most of the ring.
  expect(cells.filter((cell) => cell.segment === 0).length).toBeGreaterThan(
    cells.filter((cell) => cell.segment === 1).length,
  )
})

test("zero totals and bad values leave a bare ring", () => {
  const layout = donutLayout({ segments: [{ label: "none", value: 0 }, { label: "bad", value: Number.NaN }] })
  expect(layout.total).toBe(0)
  expect(layout.rows.flatMap((row) => row.cells).every((cell) => cell.segment === -1)).toBe(true)
  expect(donutSegments([{ label: "x", value: -4 }])[0]).toMatchObject({ value: 0, percent: 0 })
})

test("the legend fits labels and reports hidden rows", () => {
  const layout = donutLegendLayout({ segments: donutSegments(SEGMENTS), width: 20 })
  expect(layout.rows[0]!.text).toBe("● big            75%")
  expect(layout.rows[0]!.text).toHaveLength(20)
  expect(layout.rows[1]!.text).toContain("25%")
  expect(layout.hidden).toBe(0)
  const narrow = donutLegendLayout({ segments: donutSegments(SEGMENTS), width: 8 })
  expect(narrow.rows[0]!.text.endsWith("75%")).toBe(true)
  const capped = donutLegendLayout({ segments: donutSegments(SEGMENTS), width: 20, maxRows: 1 })
  expect(capped.rows).toHaveLength(1)
  expect(capped.hidden).toBe(1)
})
