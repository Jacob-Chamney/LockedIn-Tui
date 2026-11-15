import { expect, test } from "bun:test"

import { sliderLayout } from "../../src/ui/slider"

test("the knob sits at the fraction and the label follows", () => {
  const layout = sliderLayout({ value: 0.8, width: 18 })
  expect(layout.fraction).toBeCloseTo(0.8)
  expect(layout.trackWidth).toBe(14)
  expect(layout.filled).toBe(10)
  expect(layout.thumb).toBe(10)
  expect(layout.empty).toBe(3)
  expect(layout.label).toBe("80%")
  expect(layout.text).toBe("━━━━━━━━━━●─── 80%")
})

test("values are clamped and min/max are honoured", () => {
  expect(sliderLayout({ value: 2, width: 10, showLabel: false }).fraction).toBe(1)
  expect(sliderLayout({ value: -1, width: 10, showLabel: false }).fraction).toBe(0)
  expect(sliderLayout({ value: 5, min: 0, max: 10, width: 10, showLabel: false }).fraction).toBe(0.5)
})

test("the label can be hidden or replaced", () => {
  const bare = sliderLayout({ value: 0.5, width: 10, showLabel: false })
  expect(bare.label).toBe("")
  expect(bare.text).toBe("━━━━━●────")
  expect(sliderLayout({ value: 0.5, width: 12, label: "half" }).label).toBe("half")
})

test("custom glyphs are honoured", () => {
  const layout = sliderLayout({
    value: 0.5,
    width: 10,
    showLabel: false,
    glyphs: { filled: "=", thumb: "O", empty: "-" },
  })
  expect(layout.text).toBe("=====O----")
})

test("a tiny width drops the label instead of overflowing", () => {
  expect(sliderLayout({ value: 0.5, width: 2 }).text).toBe("━●")
  expect(sliderLayout({ value: 0.5, width: 0 }).text).toBe("")
})
