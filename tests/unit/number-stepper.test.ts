import { expect, test } from "bun:test"

import { NUMBER_STEPPER_GLYPHS, numberStepperLayout, numberStepperText } from "../../src/ui/number-stepper"

test("the stepper shows minus, value and plus", () => {
  const layout = numberStepperLayout({ value: 5, min: 0, max: 10 })
  expect(layout.text).toBe("− 5 +")
  expect(layout.segments.map((segment) => [segment.kind, segment.text, segment.x])).toEqual([
    ["minus", "− ", 0],
    ["value", "5", 2],
    ["value", " ", 3],
    ["plus", "+", 4],
  ])
  expect(layout.canDecrement).toBe(true)
  expect(layout.canIncrement).toBe(true)
  expect(NUMBER_STEPPER_GLYPHS.plus).toBe("+")
})

test("values clamp and controls disable at the limits", () => {
  const low = numberStepperLayout({ value: 0, min: 0, max: 10 })
  expect(low.canDecrement).toBe(false)
  expect(low.canIncrement).toBe(true)
  const high = numberStepperLayout({ value: 99, min: 0, max: 10 })
  expect(high.value).toBe(10)
  expect(high.canIncrement).toBe(false)
  expect(numberStepperLayout({ value: 5, min: 0, max: 10, disabled: true }).canDecrement).toBe(false)
})

test("text and precision format the value", () => {
  expect(numberStepperText({ value: 5, precision: 2 })).toBe("− 5.00 +")
  expect(numberStepperText({ value: 5, text: "$5.00" })).toBe("− $5.00 +")
})

test("the whole line fits a width", () => {
  const layout = numberStepperLayout({ value: 12345, min: 0, max: 20000, width: 7 })
  expect(layout.width).toBe(7)
  expect(layout.text.length).toBeLessThanOrEqual(7)
  expect(numberStepperLayout({ value: 1, width: 0 }).text).toBe("")
})

test("narrow steppers keep their segments inside the width", () => {
  for (const width of [1, 2, 3, 4]) {
    const layout = numberStepperLayout({ width, value: 12345, min: 0, max: 20000 })
    for (const segment of layout.segments) {
      expect(segment.x + segment.width).toBeLessThanOrEqual(width)
    }
    expect(layout.text.length).toBeLessThanOrEqual(width)
  }
  const two = numberStepperLayout({ width: 2, value: 5, min: 0, max: 10 })
  expect(two.segments).toHaveLength(2)
  expect(two.segments[1]!.x).toBe(1)
})
