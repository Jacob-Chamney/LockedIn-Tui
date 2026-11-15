import { expect, test } from "bun:test"

import { thresholdBarLayout, thresholdBarText } from "../../src/ui/threshold-bar"

test("the track fills to the value and places marker ticks", () => {
  const layout = thresholdBarLayout({
    width: 30,
    value: 4.8,
    min: 1,
    max: 21,
    markers: [{ value: 4.5 }, { value: 7 }],
    label: "4.8:1 AA pass",
  })
  expect(layout.trackWidth).toBe(16)
  expect(layout.valuePosition).toBe(3)
  expect(layout.markerPositions).toEqual([3, 5])
  expect(layout.segments.map((segment) => [segment.kind, segment.text, segment.x])).toEqual([
    ["filled", "███", 0],
    ["value", "●", 3],
    ["empty", "░", 4],
    ["marker", "┊", 5],
    ["empty", "░░░░░░░░░░", 6],
    ["empty", " ", 16],
    ["label", "4.8:1 AA pass", 17],
  ])
  expect(layout.text).toBe("███●░┊░░░░░░░░░░ 4.8:1 AA pass")
  expect(layout.text).toHaveLength(30)
})

test("values and markers are clamped", () => {
  const layout = thresholdBarLayout({ width: 12, value: 99, min: 0, max: 10, showLabel: false, markers: [{ value: -2 }] })
  expect(layout.fraction).toBe(1)
  expect(layout.valuePosition).toBe(layout.trackWidth - 1)
  expect(layout.markerPositions[0]).toBe(0)
})

test("a label too wide is fitted and the bar stays the width", () => {
  const text = thresholdBarText({ width: 10, value: 0.5, label: "a long label" })
  expect(text).toHaveLength(10)
  expect(text.endsWith("…")).toBe(true)
})

test("custom glyphs and zero width are handled", () => {
  const layout = thresholdBarLayout({
    width: 10,
    value: 0.5,
    label: "half",
    glyphs: { empty: "-", filled: "=", marker: "|", value: "O" },
    markers: [{ value: 0.2 }],
  })
  expect(layout.text).toContain("O")
  expect(layout.text).toContain("|")
  expect(thresholdBarLayout({ width: 0, value: 0 }).text).toBe("")
})
