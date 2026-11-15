import { expect, test } from "bun:test"

import { progressRingLayout, progressRingText } from "../../src/ui/progress-ring"

test("a half-full ring marks about half its cells", () => {
  const layout = progressRingLayout({ value: 0.5, size: 6 })
  expect(layout.width).toBe(6)
  expect(layout.height).toBe(3)
  expect(layout.percent).toBe(50)
  expect(layout.label).toBe("50%")
  expect(layout.rows).toHaveLength(3)
  expect(layout.rows[0]!.text).toHaveLength(6)
  const cells = layout.rows.flatMap((row) => row.cells)
  const ring = cells.filter((cell) => cell.text !== " ")
  const filled = cells.filter((cell) => cell.filled)
  expect(ring.length).toBeGreaterThan(4)
  expect(filled.length).toBeGreaterThan(0)
  expect(filled.length).toBeLessThan(ring.length)
  // The centre stays hollow.
  expect(layout.rows[1]!.cells.slice(2, 4).every((cell) => cell.text === " ")).toBe(true)
})

test("empty and complete rings are the two extremes", () => {
  const empty = progressRingLayout({ value: 0, size: 6 })
  expect(empty.rows.flatMap((row) => row.cells).some((cell) => cell.filled)).toBe(false)
  const full = progressRingLayout({ value: 1, size: 6 })
  expect(full.rows.flatMap((row) => row.cells).every((cell) => cell.filled || cell.text === " ")).toBe(true)
  const ring = full.rows.flatMap((row) => row.cells).filter((cell) => cell.text !== " ")
  expect(ring.every((cell) => cell.filled)).toBe(true)
})

test("values are clamped and labels are honoured", () => {
  expect(progressRingLayout({ value: -1 }).percent).toBe(0)
  expect(progressRingLayout({ value: 2 }).percent).toBe(100)
  expect(progressRingLayout({ value: 0.64, label: "64% used" }).label).toBe("64% used")
  expect(progressRingText({ value: 0, size: 6 }).split("\n")).toHaveLength(3)
})

test("custom sizes and thicknesses stay square", () => {
  const small = progressRingLayout({ value: 0.5, size: 4 })
  expect(small.width).toBe(4)
  expect(small.height).toBe(2)
  const thick = progressRingLayout({ value: 0.5, size: 8, thickness: 0.5 })
  const thin = progressRingLayout({ value: 0.5, size: 8, thickness: 0.2 })
  const ringDots = (layout: typeof thick) =>
    layout.rows.flatMap((row) => row.cells).filter((cell) => cell.text !== " ").length
  expect(ringDots(thick)).toBeGreaterThan(ringDots(thin))
})
