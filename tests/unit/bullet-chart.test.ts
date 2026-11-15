import { expect, test } from "bun:test"

import { BULLET_CHART_GLYPHS, bulletChartLayout, bulletChartText } from "../../src/ui/bullet-chart"

test("the fill follows the value and the target marks its cell", () => {
  const layout = bulletChartLayout({ value: 8, max: 10, target: 9, width: 12 })
  expect(layout.trackWidth).toBe(12)
  expect(layout.fraction).toBe(0.8)
  expect(layout.valuePosition).toBe(9)
  expect(layout.targetPosition).toBe(10)
  expect(layout.segments.map((segment) => [segment.kind, segment.text, segment.x])).toEqual([
    ["filled", "██████████", 0],
    ["target", "┊", 10],
    ["empty", "░", 11],
  ])
  expect(layout.text).toBe("██████████┊░")
  expect(BULLET_CHART_GLYPHS.target).toBe("┊")
})

test("a target inside the fill replaces a filled cell", () => {
  const layout = bulletChartLayout({ value: 9, max: 10, target: 4, width: 10 })
  expect(layout.segments[0]).toMatchObject({ kind: "filled", text: "████" })
  expect(layout.segments[1]).toMatchObject({ kind: "target", text: "┊" })
  expect(layout.segments[2]).toMatchObject({ kind: "filled", text: "████" })
  expect(layout.segments[3]).toMatchObject({ kind: "empty", text: "░" })
  expect(layout.text).toBe("████┊████░")
})

test("values clamp and min shifts the scale", () => {
  const low = bulletChartLayout({ value: -5, max: 10, width: 10 })
  expect(low.fraction).toBe(0)
  const high = bulletChartLayout({ value: 99, max: 10, width: 10 })
  expect(high.fraction).toBe(1)
  expect(high.text).toBe("██████████")
  const shifted = bulletChartLayout({ value: 5, min: 5, max: 15, width: 10 })
  expect(shifted.fraction).toBe(0)
})

test("a label follows the track and is fitted", () => {
  const layout = bulletChartLayout({ value: 2, max: 4, width: 20, label: "half" })
  expect(layout.trackWidth).toBe(15)
  expect(layout.label).toBe("half")
  expect(layout.text).toBe("████████░░░░░░░ half")
  expect(bulletChartText({ value: 2, max: 4, width: 8, label: "a long label" })).toHaveLength(8)
  expect(bulletChartText({ value: 2, max: 4, width: 8, showLabel: false })).toBe("████░░░░")
})

test("custom glyphs and zero width are handled", () => {
  const layout = bulletChartLayout({
    value: 1,
    max: 2,
    target: 1.5,
    width: 8,
    glyphs: { empty: "-", filled: "=", target: "|" },
  })
  expect(layout.text).toContain("=")
  expect(layout.text).toContain("-")
  expect(layout.text).toContain("|")
  expect(bulletChartLayout({ value: 1, max: 2, width: 0 }).text).toBe("")
})
