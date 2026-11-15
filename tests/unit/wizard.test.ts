import { expect, test } from "bun:test"

import { WIZARD_GLYPHS, wizardLayout } from "../../src/ui/wizard"

const STEPS = [
  { id: "choose", label: "Choose" },
  { id: "review", label: "Review" },
]

test("steps show done, current and upcoming markers", () => {
  expect(WIZARD_GLYPHS.current).toBe("●")
  const first = wizardLayout({ steps: STEPS, current: 0, width: 40 })
  expect(first.segments.map((segment) => segment.text)).toEqual(["● 1 Choose", "○ 2 Review"])
  const second = wizardLayout({ steps: STEPS, current: 1, width: 40 })
  expect(second.segments.map((segment) => segment.text)).toEqual(["✓ 1 Choose", "● 2 Review"])
  expect(second.segments.map((segment) => segment.status)).toEqual(["done", "current"])
})

test("steps carry a gap and the first that does not fit ends the strip", () => {
  const layout = wizardLayout({ steps: STEPS, current: 0, width: 10 })
  expect(layout.segments).toHaveLength(1)
  expect(layout.hidden).toBe(1)
  expect(layout.segments[0]!.x).toBe(0)
})

test("a current step that would be cut off is shown alone", () => {
  const layout = wizardLayout({ steps: STEPS, current: 1, width: 12 })
  expect(layout.segments).toHaveLength(1)
  expect(layout.segments[0]!.text).toBe("● 2 Review")
  expect(layout.segments[0]!.current).toBe(true)
  expect(layout.hidden).toBe(1)
})

test("narrow widths fit the current label", () => {
  expect(wizardLayout({ steps: STEPS, current: 1, width: 6 }).segments[0]!.text).toBe("● 2 R…")
})

test("current is clamped, glyphs change and empty input stays empty", () => {
  expect(wizardLayout({ steps: STEPS, current: 9, width: 40 }).current).toBe(1)
  expect(
    wizardLayout({ steps: STEPS, current: 0, width: 40, glyphs: { current: ">", upcoming: "." } }).segments[0]!.text,
  ).toBe("> 1 Choose")
  expect(wizardLayout({ steps: [], current: 0, width: 40 })).toMatchObject({ segments: [], hidden: 0 })
  expect(wizardLayout({ steps: STEPS, current: 0, width: 0 }).segments).toEqual([])
})

test("a non-finite current step falls back to the first step", () => {
  expect(wizardLayout({ steps: STEPS, current: Number.NaN, width: 40 })).toMatchObject({ current: 0 })
  expect(wizardLayout({ steps: STEPS, current: Number.POSITIVE_INFINITY, width: 40 }).current).toBe(0)
})
