import { expect, test } from "bun:test"

import { scrollbarLayout } from "../../src/ui/scrollbar"

test("the thumb length follows the viewport ratio", () => {
  const layout = scrollbarLayout({ content: 100, viewport: 10, offset: 0, length: 20 })
  expect(layout.scrollable).toBe(true)
  expect(layout.thumbSize).toBe(2)
  expect(layout.thumbStart).toBe(0)
  expect(layout.before).toBe(0)
  expect(layout.after).toBe(18)
})

test("the thumb start follows the offset", () => {
  const middle = scrollbarLayout({ content: 100, viewport: 10, offset: 45, length: 20 })
  expect(middle.position).toBeCloseTo(0.5)
  expect(middle.thumbStart).toBe(9)
  expect(middle.after).toBe(9)
  const end = scrollbarLayout({ content: 100, viewport: 10, offset: 90, length: 20 })
  expect(end.position).toBe(1)
  expect(end.thumbStart).toBe(18)
  expect(end.after).toBe(0)
})

test("content that fits is not scrollable", () => {
  const layout = scrollbarLayout({ content: 8, viewport: 10, offset: 0, length: 12 })
  expect(layout.scrollable).toBe(false)
  expect(layout.thumbSize).toBe(12)
  expect(layout.before).toBe(0)
})

test("a minimum thumb is honoured", () => {
  const layout = scrollbarLayout({ content: 1000, viewport: 10, offset: 0, length: 20, minThumb: 3 })
  expect(layout.thumbSize).toBe(3)
})

test("offsets are clamped and zero length hides everything", () => {
  expect(scrollbarLayout({ content: 100, viewport: 10, offset: -5, length: 20 }).thumbStart).toBe(0)
  expect(scrollbarLayout({ content: 100, viewport: 10, offset: 500, length: 20 }).position).toBe(1)
  expect(scrollbarLayout({ content: 100, viewport: 10, offset: 0, length: 0 }).scrollable).toBe(false)
})

test("orientation supplies the track glyph", () => {
  expect(scrollbarLayout({ content: 100, viewport: 10, offset: 0, length: 20, orientation: "horizontal" }).glyphs.track).toBe("─")
  expect(scrollbarLayout({ content: 100, viewport: 10, offset: 0, length: 20 }).glyphs.track).toBe("│")
})
