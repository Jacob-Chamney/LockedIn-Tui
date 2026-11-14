import { expect, test } from "bun:test"

import { meterCells } from "../../src/ui/meter"

test("a meter splits the track at the fraction", () => {
  expect(meterCells(0.5, 1, 10)).toEqual({ filled: 5, empty: 5, fraction: 0.5 })
  expect(meterCells(2, 8, 8)).toEqual({ filled: 2, empty: 6, fraction: 0.25 })
})

test("values outside the range are clamped", () => {
  expect(meterCells(20, 10, 4)).toEqual({ filled: 4, empty: 0, fraction: 1 })
  expect(meterCells(-5, 10, 4)).toEqual({ filled: 0, empty: 4, fraction: 0 })
  expect(meterCells(Number.NaN, 10, 4)).toEqual({ filled: 0, empty: 4, fraction: 0 })
})

test("a zero or missing limit leaves the track empty", () => {
  expect(meterCells(5, 0, 6)).toEqual({ filled: 0, empty: 6, fraction: 0 })
  expect(meterCells(5, Number.NaN, 6)).toEqual({ filled: 0, empty: 6, fraction: 0 })
})

test("zero columns and fractional widths do not produce stray cells", () => {
  expect(meterCells(0.5, 1, 0)).toEqual({ filled: 0, empty: 0, fraction: 0 })
  expect(meterCells(0.5, 1, 4.9)).toEqual({ filled: 2, empty: 2, fraction: 0.5 })
})

test("the fill rounds to the nearest cell", () => {
  expect(meterCells(0.24, 1, 10).filled).toBe(2)
  expect(meterCells(0.26, 1, 10).filled).toBe(3)
})
