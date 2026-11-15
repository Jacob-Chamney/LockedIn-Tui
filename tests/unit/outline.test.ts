import { expect, test } from "bun:test"

import { OUTLINE_GLYPHS, outlineDepthGlyph, outlineLayout } from "../../src/ui/outline"

const ITEMS = [
  { id: "a", label: "Intro", depth: 1 },
  { id: "b", label: "Detail", depth: 2 },
  { id: "c", label: "Deep", depth: 3 },
]

test("depth markers differ and the current item gets an arrow", () => {
  expect(outlineDepthGlyph(1)).toBe("◆")
  expect(outlineDepthGlyph(2)).toBe("◇")
  expect(outlineDepthGlyph(3)).toBe("·")
  expect(OUTLINE_GLYPHS.current).toBe("▸")
  const layout = outlineLayout({ items: ITEMS, width: 60, current: 1 })
  expect(layout.segments.map((segment) => segment.text)).toEqual([
    "◆  Intro",
    "◇▸ Detail",
    "·  Deep",
  ])
  expect(layout.segments.map((segment) => segment.current)).toEqual([false, true, false])
})

test("entries carry a gap and stop when the row is full", () => {
  const layout = outlineLayout({ items: ITEMS, width: 20, current: 0 })
  expect(layout.segments.map((segment) => segment.x)).toEqual([0, 10])
  expect(layout.hidden).toBe(1)
})

test("a current item that would be cut off is shown alone", () => {
  const layout = outlineLayout({ items: ITEMS, width: 14, current: 1 })
  expect(layout.segments).toHaveLength(1)
  expect(layout.segments[0]).toMatchObject({ text: "◇▸ Detail", current: true, x: 0 })
  expect(layout.hidden).toBe(2)
})

test("a too-narrow current label is fitted", () => {
  const layout = outlineLayout({ items: ITEMS, width: 7, current: 1 })
  expect(layout.segments[0]!.text).toBe("◇▸ Det…")
})

test("current is clamped, glyphs change and empty input stays empty", () => {
  expect(outlineLayout({ items: ITEMS, width: 60, current: 99 }).currentIndex).toBe(2)
  expect(outlineLayout({ items: ITEMS, width: 60, current: -2 }).currentIndex).toBe(0)
  expect(
    outlineLayout({ items: ITEMS, width: 60, current: 0, glyphs: { root: "R", child: "C", leaf: "L" } }).segments[1]!.text,
  ).toBe("C  Detail")
  expect(outlineLayout({ items: [], width: 60 })).toMatchObject({ segments: [], hidden: 0, currentIndex: -1 })
  expect(outlineLayout({ items: ITEMS, width: 0 }).segments).toEqual([])
})
