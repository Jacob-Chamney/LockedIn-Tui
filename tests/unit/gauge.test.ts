import { expect, test } from "bun:test"

import { gaugeLayout } from "../../src/ui/gauge"

test("a gauge reports its clamped level and labels", () => {
  expect(gaugeLayout({ value: 3, max: 10 })).toEqual({
    value: 3,
    max: 10,
    fraction: 0.3,
    percent: 30,
    valueText: "3 / 10",
    percentText: "30%",
    label: "",
  })
})

test("values outside the limit are clamped", () => {
  expect(gaugeLayout({ value: 12, max: 10 }).fraction).toBe(1)
  expect(gaugeLayout({ value: -2, max: 10 }).fraction).toBe(0)
  expect(gaugeLayout({ value: 12, max: 10 }).percentText).toBe("100%")
})

test("no limit draws level zero but keeps the value", () => {
  const layout = gaugeLayout({ value: 5, max: 0 })
  expect(layout.fraction).toBe(0)
  expect(layout.percent).toBe(0)
  expect(layout.valueText).toBe("5")
})

test("a missing max defaults to the value", () => {
  expect(gaugeLayout({ value: 4 })).toMatchObject({ fraction: 1, percent: 100, valueText: "4 / 4" })
  expect(gaugeLayout({ value: 0 })).toMatchObject({ fraction: 0, percent: 0, valueText: "0" })
})

test("percentages round and labels are kept", () => {
  expect(gaugeLayout({ value: 2, max: 3 }).percentText).toBe("67%")
  expect(gaugeLayout({ value: 1, max: 3, label: "1 / 3" }).label).toBe("1 / 3")
})

test("non-finite values count as zero", () => {
  expect(gaugeLayout({ value: Number.NaN, max: 5 }).value).toBe(0)
})
