import { expect, test } from "bun:test"

import { RANGE_SLIDER_GLYPHS, rangeSliderLayout, rangeSliderText } from "../../src/ui/range-slider"

test("handles sit at their fractions with a filled span", () => {
  const layout = rangeSliderLayout({ width: 18, values: [0.8, 1] })
  expect(layout.trackWidth).toBe(9)
  expect(layout.left).toBe(6)
  expect(layout.right).toBe(8)
  expect(layout.segments.map((segment) => [segment.kind, segment.text])).toEqual([
    ["empty", "──────"],
    ["handle", "●"],
    ["filled", "━"],
    ["handle", "●"],
    ["empty", " "],
    ["label", "80%–100%"],
  ])
  expect(layout.text).toBe("──────●━● 80%–100%")
  expect(RANGE_SLIDER_GLYPHS.handle).toBe("●")
})

test("values are ordered and clamped", () => {
  const layout = rangeSliderLayout({ width: 12, values: [1, 0.2], min: 0, max: 1, showLabel: false })
  expect(layout.left).toBeLessThan(layout.right)
  expect(rangeSliderText({ width: 20, values: [-2, 4], min: 0, max: 1 })).toContain("0%–100%")
})

test("a collapsed range shows one handle", () => {
  const layout = rangeSliderLayout({ width: 14, values: [0.5, 0.5], showLabel: false })
  expect(layout.collapsed).toBe(true)
  expect(layout.segments.filter((segment) => segment.kind === "handle")).toHaveLength(1)
})

test("a custom label and glyphs are honoured", () => {
  const layout = rangeSliderLayout({
    width: 16,
    values: [0, 0.5],
    label: "half",
    glyphs: { empty: "-", filled: "=", handle: "O" },
  })
  expect(layout.text).toBe("O====O----- half")
  expect(layout.label).toBe("half")
})

test("zero width is empty", () => {
  expect(rangeSliderLayout({ width: 0, values: [0, 1] }).text).toBe("")
})
