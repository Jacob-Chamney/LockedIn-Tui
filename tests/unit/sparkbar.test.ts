import { expect, test } from "bun:test"

import { sparkbarLayout, sparkbarText } from "../../src/ui/sparkbar"

test("columns rise from the bottom in whole cells", () => {
  const layout = sparkbarLayout({ values: [1, 2, 4], width: 3, height: 2 })
  expect(layout.max).toBe(4)
  expect(layout.levels).toEqual([1, 1, 2])
  expect(layout.rows).toEqual(["  █", "███"])
  expect(sparkbarText({ values: [0, 4], width: 2, height: 2 })).toEqual([" █", " █"])
})

test("buckets collapse a long series", () => {
  const layout = sparkbarLayout({ values: [1, 2, 3, 4], width: 2, height: 1, reduce: "sum" })
  expect(layout.buckets).toEqual([3, 7])
  expect(sparkbarLayout({ values: [1, 9, 2, 3], width: 2, height: 1, reduce: "max" }).buckets).toEqual([9, 3])
  expect(sparkbarLayout({ values: [2, 4, 6, 8], width: 2, height: 1, reduce: "mean" }).buckets).toEqual([3, 7])
})

test("an explicit max and glyph are honoured", () => {
  const layout = sparkbarLayout({ values: [5], width: 1, height: 2, max: 10, glyph: "#" })
  expect(layout.max).toBe(10)
  expect(layout.levels).toEqual([1])
  expect(layout.rows).toEqual([" ", "#"])
})

test("empty and zero widths are safe", () => {
  expect(sparkbarLayout({ values: [], width: 4, height: 2 })).toMatchObject({ buckets: [], levels: [] })
  expect(sparkbarLayout({ values: [1], width: 0 }).rows).toEqual([])
})
