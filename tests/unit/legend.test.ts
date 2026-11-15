import { expect, test } from "bun:test"

import { legendLayout } from "../../src/ui/legend"

test("an empty legend has no segments", () => {
  expect(legendLayout({ items: [], width: 20 })).toEqual([])
  expect(legendLayout({ items: [{ glyph: "·" }], width: 0 })).toEqual([])
})

test("entries carry a gap and keep their tone", () => {
  const segments = legendLayout({
    items: [
      { glyph: "·", label: "less", tone: "muted" },
      { glyph: "█", label: "more", tone: "primary" },
    ],
    width: 20,
  })
  expect(segments).toEqual([
    { glyph: "·", label: "less", tone: "muted", x: 0, width: 6, index: 0 },
    { glyph: "█", label: "more", tone: "primary", x: 8, width: 6, index: 1 },
  ])
})

test("the first entry that does not fit ends the row", () => {
  const segments = legendLayout({
    items: [
      { glyph: "·", label: "less" },
      { glyph: "█", label: "more" },
      { glyph: "x", label: "no" },
    ],
    width: 7,
  })
  expect(segments).toHaveLength(1)
})

test("labels can be hidden and glyphs still fit", () => {
  const segments = legendLayout({
    items: [{ glyph: "·", label: "less" }, { glyph: "█", label: "more" }],
    width: 10,
    labels: false,
    gap: 1,
  })
  expect(segments.map((segment) => [segment.glyph, segment.label, segment.x, segment.width])).toEqual([
    ["·", "", 0, 1],
    ["█", "", 2, 1],
  ])
})

test("the default tone and gap are applied", () => {
  const segments = legendLayout({
    items: [{ glyph: "a" }, { glyph: "b" }],
    width: 20,
    tone: "accent",
  })
  expect(segments[0]).toMatchObject({ tone: "accent", x: 0 })
  expect(segments[1]!.x).toBe(3)
})
