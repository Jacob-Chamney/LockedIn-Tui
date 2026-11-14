import { expect, test } from "bun:test"

import { barRows } from "../../src/ui/bars"

const items = [
  { label: "gpt-4.1", value: 60, text: "60%" },
  { label: "claude", value: 40, text: "40%" },
]

test("an empty chart has no rows", () => {
  expect(barRows({ items: [], width: 40 })).toEqual([])
})

test("rows share a label column and a proportional bar", () => {
  const rows = barRows({ items, width: 40, labelWidth: 10, valueWidth: 4 })
  expect(rows).toHaveLength(2)
  const first = rows[0]!
  expect(first.label).toBe("gpt-4.1   ")
  expect(first.labelWidth).toBe(10)
  expect(first.valueWidth).toBe(4)
  expect(first.barWidth).toBe(24)
  expect(first.text).toBe("60%")
  expect(first.fraction).toBe(1)
  expect(first.filled).toBe(24)
  expect(first.empty).toBe(0)
  const second = rows[1]!
  expect(second.filled).toBe(16)
  expect(second.empty).toBe(8)
})

test("the value column defaults to the widest text", () => {
  const rows = barRows({ items, width: 40, labelWidth: 10 })
  expect(rows[0]!.valueWidth).toBe(3)
  expect(rows[0]!.barWidth).toBe(25)
})

test("max fixes the scale and minBar keeps small values visible", () => {
  const rows = barRows({
    items: [{ label: "tiny", value: 1 }],
    width: 30,
    labelWidth: 6,
    valueWidth: 0,
    max: 1000,
    minBar: 2,
  })
  expect(rows[0]!.fraction).toBeCloseTo(0.001)
  expect(rows[0]!.filled).toBe(2)
  expect(rows[0]!.empty).toBe(rows[0]!.barWidth - 2)
})

test("a zero value leaves the bar empty", () => {
  const rows = barRows({ items: [{ label: "none", value: 0 }], width: 30, valueWidth: 0 })
  expect(rows[0]!.filled).toBe(0)
  expect(rows[0]!.fraction).toBe(0)
})

test("labels truncate with an ellipsis", () => {
  const rows = barRows({
    items: [{ label: "a-very-long-model-name", value: 1 }],
    width: 30,
    labelWidth: 8,
    valueWidth: 0,
  })
  expect(rows[0]!.label).toBe("a-very-…")
})

test("a narrow row still leaves at least one bar cell", () => {
  const rows = barRows({ items, width: 10, valueWidth: 4 })
  const row = rows[0]!
  expect(row.barWidth).toBeGreaterThanOrEqual(1)
  expect(row.labelWidth + row.barWidth + row.valueWidth + row.gap * 2).toBeLessThanOrEqual(10)
})

test("the gap is clamped", () => {
  const rows = barRows({ items, width: 40, gap: 99 })
  expect(rows[0]!.gap).toBe(4)
})
