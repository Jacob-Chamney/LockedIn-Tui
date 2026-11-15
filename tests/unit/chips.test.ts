import { expect, test } from "bun:test"

import { chipLayout } from "../../src/ui/chips"

const ITEMS = [
  { id: "a", label: "a.png", removable: true },
  { id: "b", label: "b.png", removable: true, active: true },
]

test("chips carry brackets, gaps and the active tone", () => {
  const layout = chipLayout({ items: ITEMS, width: 30 })
  expect(layout.chips.map((chip) => chip.text)).toEqual(["[a.png ×]", "[b.png ×]"])
  expect(layout.chips.map((chip) => chip.x)).toEqual([0, 10])
  expect(layout.chips.map((chip) => chip.tone)).toEqual(["surface", "primary"])
  expect(layout.activeIndex).toBe(1)
  expect(layout.hidden).toBe(0)
})

test("non-removable chips have no marker", () => {
  const layout = chipLayout({ items: [{ id: "a", label: "plain" }], width: 20 })
  expect(layout.chips[0]!.text).toBe("[plain]")
})

test("the first chip that does not fit ends the row", () => {
  const layout = chipLayout({ items: ITEMS, width: 10 })
  expect(layout.chips).toHaveLength(1)
  expect(layout.hidden).toBe(1)
})

test("a lone too-wide chip truncates its label", () => {
  const layout = chipLayout({ items: [{ id: "a", label: "verylong", removable: true }], width: 8 })
  expect(layout.chips[0]!.text).toBe("[ver… ×]")
  expect(layout.chips[0]!.width).toBe(8)
})

test("custom markers and gaps are honoured", () => {
  const layout = chipLayout({
    items: [{ id: "a", label: "a", removable: true }, { id: "b", label: "b" }],
    width: 30,
    gap: 2,
    marker: "x",
  })
  expect(layout.chips.map((chip) => chip.text)).toEqual(["[a x]", "[b]"])
  expect(layout.chips[1]!.x).toBe(7)
})

test("empty input has no chips", () => {
  expect(chipLayout({ items: [], width: 20 })).toMatchObject({ chips: [], hidden: 0 })
  expect(chipLayout({ items: ITEMS, width: 0 }).chips).toEqual([])
})
