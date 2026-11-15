import { expect, test } from "bun:test"

import { SKELETON_PATTERN, skeletonLines } from "../../src/ui/skeleton"

test("rows follow the ragged default pattern", () => {
  const lines = skeletonLines({ width: 20, rows: 3 })
  expect(lines.map((line) => line.width)).toEqual([20, 16, 18])
  expect(lines.map((line) => line.text.length)).toEqual([20, 16, 18])
  expect(lines.every((line) => line.text.startsWith("░"))).toBe(true)
  expect(SKELETON_PATTERN).toHaveLength(5)
})

test("the row count defaults to three", () => {
  expect(skeletonLines({ width: 10 })).toHaveLength(3)
})

test("custom glyphs and patterns are honoured", () => {
  const lines = skeletonLines({ width: 10, rows: 2, glyph: "█", pattern: [0.5] })
  expect(lines.map((line) => line.text)).toEqual(["█████", "█████"])
})

test("an empty glyph falls back to the block", () => {
  expect(skeletonLines({ width: 4, rows: 1, glyph: "" })[0]!.text).toBe("░░░░")
})

test("zero rows or width draw nothing", () => {
  expect(skeletonLines({ width: 20, rows: 0 })).toEqual([])
  expect(skeletonLines({ width: 0, rows: 3 })).toEqual([])
})

test("a tiny width still draws one cell", () => {
  expect(skeletonLines({ width: 1, rows: 1 })[0]!.text).toBe("░")
})
