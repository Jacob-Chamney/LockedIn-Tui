import { expect, test } from "bun:test"

import { distributionSegments } from "../../src/ui/distribution"

test("cells fill the width with largest-remainder rounding", () => {
  const segments = distributionSegments({
    items: [
      { label: "gpt", value: 78 },
      { label: "claude", value: 22 },
    ],
    width: 20,
  })
  expect(segments.map((segment) => segment.cells)).toEqual([16, 4])
  expect(segments.map((segment) => segment.start)).toEqual([0, 16])
  expect(segments[0]!.fraction).toBeCloseTo(0.78)
  expect(segments[0]!.tone).toBe("primary")
  expect(segments[1]!.tone).toBe("secondary")
})

test("a tiny slice still keeps the bar full", () => {
  const segments = distributionSegments({
    items: [
      { label: "a", value: 1 },
      { label: "b", value: 1 },
      { label: "c", value: 1 },
    ],
    width: 2,
  })
  expect(segments.reduce((sum, segment) => sum + segment.cells, 0)).toBe(2)
  expect(segments.map((segment) => segment.cells)).toEqual([1, 1, 0])
})

test("one item takes every cell", () => {
  const segments = distributionSegments({ items: [{ label: "only", value: 5 }], width: 7 })
  expect(segments[0]).toMatchObject({ cells: 7, start: 0, fraction: 1 })
})

test("custom tones and the default cycle are honoured", () => {
  const segments = distributionSegments({
    items: [
      { label: "a", value: 1, tone: "warning" },
      { label: "b", value: 1 },
      { label: "c", value: 1 },
    ],
    width: 9,
    tones: ["line", "surface"],
  })
  expect(segments.map((segment) => segment.tone)).toEqual(["warning", "surface", "line"])
})

test("zero or empty inputs draw nothing", () => {
  expect(distributionSegments({ items: [], width: 10 })).toEqual([])
  expect(distributionSegments({ items: [{ label: "a", value: 0 }], width: 10 })).toEqual([])
  expect(distributionSegments({ items: [{ label: "a", value: 1 }], width: 0 })).toEqual([])
})
