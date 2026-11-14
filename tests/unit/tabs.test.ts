import { expect, test } from "bun:test"

import { tabLayout } from "../../src/ui/tabs"

test("an empty strip has no chips", () => {
  expect(tabLayout({ tabs: [], selected: 0, width: 40 })).toEqual([])
  expect(tabLayout({ tabs: [{ label: "7d" }], selected: 0, width: 0 })).toEqual([])
})

test("chips carry padding, a gap and their selected flag", () => {
  const segments = tabLayout({
    tabs: [{ label: "7d" }, { label: "30d" }],
    selected: 1,
    width: 40,
    padding: 1,
    gap: 1,
  })
  expect(segments).toEqual([
    { text: " 7d ", selected: false, x: 0, width: 4, index: 0 },
    { text: " 30d ", selected: true, x: 5, width: 5, index: 1 },
  ])
})

test("counts are appended to the label", () => {
  const [segment] = tabLayout({
    tabs: [{ label: "work", count: 3 }],
    selected: 0,
    width: 40,
    padding: 1,
  })
  expect(segment!.text).toBe(" work 3 ")
  expect(segment!.selected).toBe(true)
})

test("the selection is clamped to the list", () => {
  const tabs = [{ label: "a" }, { label: "b" }]
  expect(tabLayout({ tabs, selected: 99, width: 20 }).at(-1)!.selected).toBe(true)
  expect(tabLayout({ tabs, selected: -3, width: 20 })[0]!.selected).toBe(true)
})

test("the first chip that does not fit ends the strip", () => {
  const segments = tabLayout({
    tabs: [{ label: "7d" }, { label: "30d" }, { label: "90d" }],
    selected: 0,
    width: 10,
    padding: 1,
  })
  expect(segments.map((segment) => segment.text)).toEqual([" 7d ", " 30d "])
})

test("a lone too-wide chip is truncated", () => {
  const [segment] = tabLayout({
    tabs: [{ label: "statistics" }],
    selected: 0,
    width: 5,
    padding: 1,
  })
  expect(segment!.width).toBe(5)
  expect(segment!.text.endsWith("…")).toBe(true)
  expect(segment!.selected).toBe(true)
})

test("padding and gap are clamped to sane values", () => {
  const segments = tabLayout({
    tabs: [{ label: "a" }, { label: "b" }],
    selected: 0,
    width: 40,
    padding: -4,
    gap: 99,
  })
  expect(segments[0]!.text).toBe("a")
  expect(segments[1]!.x).toBe(1 + 8)
})
