import { expect, test } from "bun:test"

import { segmentedLayout } from "../../src/ui/segmented"

test("segments split the width and centre their labels", () => {
  const layout = segmentedLayout({ options: ["day", "month"], selected: 1, width: 14 })
  expect(layout.segments.map((segment) => [segment.text, segment.x, segment.width])).toEqual([
    ["  day  ", 0, 7],
    [" month ", 7, 7],
  ])
  expect(layout.segments.map((segment) => segment.selected)).toEqual([false, true])
})

test("an odd width gives the remainder to the last segment", () => {
  const layout = segmentedLayout({ options: ["day", "month"], selected: 0, width: 15 })
  expect(layout.segments.map((segment) => segment.width)).toEqual([7, 8])
  expect(layout.segments[1]!.text).toBe(" month  ")
})

test("selection is clamped", () => {
  expect(segmentedLayout({ options: ["a", "b"], selected: 9, width: 10 }).selected).toBe(1)
  expect(segmentedLayout({ options: ["a", "b"], selected: -2, width: 10 }).selected).toBe(0)
})

test("labels truncate at one cell per option", () => {
  const layout = segmentedLayout({ options: ["day", "month"], selected: 0, width: 2 })
  expect(layout.segments.map((segment) => segment.text)).toEqual(["…", "…"])
})

test("too little width hides every option", () => {
  expect(segmentedLayout({ options: ["day", "month"], selected: 0, width: 1 })).toMatchObject({
    segments: [],
    hidden: 2,
  })
  expect(segmentedLayout({ options: [], selected: 0, width: 10 }).segments).toEqual([])
  expect(segmentedLayout({ options: ["day"], selected: 0, width: 0 }).segments).toEqual([])
})
