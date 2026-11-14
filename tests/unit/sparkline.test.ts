import { expect, test } from "bun:test"

import { SPARKLINE_RAMP, sparklineText } from "../../src/ui/sparkline"

test("an empty series has no glyphs", () => {
  expect(sparklineText({ values: [] })).toBe("")
})

test("the tallest value fills the top glyph and zero the bottom", () => {
  expect(sparklineText({ values: [0, 4, 2, 8] })).toBe("▁▄▂█")
  expect(sparklineText({ values: [8, 8] })).toBe("██")
  expect(sparklineText({ values: [0, 0] })).toBe("▁▁")
})

test("negative and non-finite values count as zero", () => {
  expect(sparklineText({ values: [-3, Number.NaN, 0, 2] })).toBe("▁▁▁█")
})

test("more values than columns collapse into buckets", () => {
  expect(sparklineText({ values: [1, 2, 3, 4], width: 2 })).toBe("▄█")
  expect(sparklineText({ values: [1, 1, 1, 1], width: 2, reduce: "mean" })).toBe("██")
  expect(sparklineText({ values: [1, 5, 2, 3], width: 2, reduce: "max" })).toBe("█▅")
})

test("a short series is never stretched", () => {
  expect(sparklineText({ values: [1, 2, 3], width: 10 })).toHaveLength(3)
})

test("an explicit max keeps the scale stable across frames", () => {
  expect(sparklineText({ values: [1, 2], max: 4 })).toBe("▂▄")
  expect(sparklineText({ values: [0, 0], max: 4 })).toBe("▁▁")
})

test("a custom ramp and a too-short ramp are handled", () => {
  expect(sparklineText({ values: [0, 1], ramp: ".-" })).toBe(".-")
  expect(sparklineText({ values: [0, 1], ramp: "x" })).toBe("")
  expect(SPARKLINE_RAMP).toHaveLength(8)
})
